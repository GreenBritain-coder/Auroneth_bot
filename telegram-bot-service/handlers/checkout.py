"""
Checkout handlers: Checkout flow -- payment method selection, delivery address, delivery method, order creation.
"""
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton, BufferedInputFile
from aiogram.fsm.context import FSMContext
from database.connection import get_database
from utils.bot_config import get_bot_config
from utils.callback_utils import safe_answer_callback
from utils.shop_helpers import find_by_id, _get_shipping_costs, _format_shipping_cost
from typing import Optional

router = Router()


@router.callback_query(F.data == "checkout")
async def handle_checkout(callback: CallbackQuery):
    """Create invoice and show checkout interface with tabs"""
    await safe_answer_callback(callback)

    bot_config = await get_bot_config()
    if not bot_config:
        return

    bot_id = str(bot_config["_id"])
    user_id = str(callback.from_user.id)

    db = get_database()
    carts_collection = db.carts
    invoices_collection = db.invoices

    cart = await carts_collection.find_one({
        "user_id": user_id,
        "bot_id": bot_id
    })

    if not cart or not cart.get("items"):
        await callback.message.answer("❌ Your cart is empty.")
        return

    # Calculate total and get product details
    products_collection = db.products
    total = 0
    currency = None
    product_details = []

    for item in cart["items"]:
        product_id = item["product_id"]
        product = await find_by_id(products_collection, product_id)

        if product:
            item_total = item["price"] * item["quantity"]
            total += item_total
            if not currency:
                currency = product.get("currency", "GBP")

            # Get product name with variation if applicable
            product_name = product.get("name", "Unknown Product")
            if item.get("variation_index") is not None:
                variations = product.get("variations", [])
                if item["variation_index"] < len(variations):
                    product_name += f" - {variations[item['variation_index']]['name']}"

            product_details.append({
                "name": product_name,
                "price": item["price"],
                "quantity": item["quantity"],
                "total": item_total
            })

    # Debug: Log the calculated total before creating invoice
    print(f"[Checkout] Creating invoice - Calculated total: {total} {currency}, Cart items count: {len(cart.get('items', []))}")
    for idx, item in enumerate(cart.get("items", [])):
        print(f"[Checkout]   Cart item {idx+1}: product_id={item.get('product_id')}, quantity={item.get('quantity')}, price={item.get('price')}, item_total={item.get('price', 0) * item.get('quantity', 0)}")

    # Generate short invoice ID (ensure uniqueness)
    from utils.invoice_id import generate_short_invoice_id
    from datetime import datetime
    import uuid

    invoice_id = await generate_short_invoice_id(db=db)

    # CRITICAL: Clear waiting flags on ALL other invoices for this user before creating new invoice
    # This prevents old invoices from intercepting discount/address input
    await invoices_collection.update_many(
        {
            "user_id": user_id,
            "bot_id": bot_id,
            "status": "Pending Checkout"  # Only clear flags on pending invoices
        },
        {
            "$set": {
                "waiting_for_discount": False,
                "waiting_for_address": False
            }
        }
    )

    # Create invoice document
    invoice = {
        "_id": str(uuid.uuid4()),
        "invoice_id": invoice_id,
        "bot_id": bot_id,
        "user_id": user_id,
        "cart_id": str(cart["_id"]),
        "status": "Pending Checkout",
        "items": cart["items"],
        "total": total,  # This total should NEVER be changed after invoice creation
        "currency": currency,
        "discount_code": None,
        "discount_amount": 0,
        "payment_method": None,
        "delivery_address": None,
        "delivery_method": None,
        "shipping_cost": 0,
        "waiting_for_discount": False,  # Initialize as False
        "waiting_for_address": False,  # Initialize as False
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow()
    }

    await invoices_collection.insert_one(invoice)
    print(f"[Checkout] Created new invoice {invoice_id} with total {total} {currency}, cleared waiting flags on all other invoices for this user")

    # Build checkout message
    checkout_text = f"💳 *Invoice {invoice_id}*\n\n"
    checkout_text += f"*Status:* Pending Checkout\n\n"
    checkout_text += "Enter the discount code, payment method, address and delivery method. "
    checkout_text += "Once your order has been completed, you will be given payment details.\n\n"

    # Show products
    checkout_text += "*Products:*\n"
    for product in product_details:
        checkout_text += f"• {product['name']} - {product['price']} {currency}\n"
        if product['quantity'] > 1:
            checkout_text += f"  ({product['quantity']}x = {product['total']} {currency})\n"

    # Format total based on currency
    if currency.upper() == "GBP":
        checkout_text += f"\n*Total:* £{total:.2f}\n"
    else:
        checkout_text += f"\n*Total:* {total:.2f} {currency}\n"

    # Create inline tabs - use short invoice_id instead of UUID to stay under 64-byte limit
    keyboard_buttons = [
        [InlineKeyboardButton(text="🎟️ Enter a discount code", callback_data=f"disc:{invoice_id}")],
        [InlineKeyboardButton(text="💳 Select payment method", callback_data=f"pay:{invoice_id}")],
        [InlineKeyboardButton(text="📍 Enter Delivery Address", callback_data=f"addr:{invoice_id}")],
        [InlineKeyboardButton(text="🚚 Select Delivery Method", callback_data=f"del:{invoice_id}")],
        [
            InlineKeyboardButton(text="🗑️ Delete", callback_data=f"del_inv:{invoice_id}"),
            InlineKeyboardButton(text="⬅️ Orders", callback_data="orders"),
            InlineKeyboardButton(text="📋 Menu", callback_data="menu")
        ]
    ]

    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)

    try:
        await callback.message.edit_text(checkout_text, parse_mode="Markdown", reply_markup=keyboard)
    except:
        await callback.message.answer(checkout_text, parse_mode="Markdown", reply_markup=keyboard)


async def show_checkout_invoice(invoice_id: str, callback: CallbackQuery):
    """Helper function to display checkout invoice"""
    db = get_database()
    invoices_collection = db.invoices
    products_collection = db.products

    # Try to find by short invoice_id first, then by _id
    invoice = await invoices_collection.find_one({"invoice_id": invoice_id})
    if not invoice:
        invoice = await invoices_collection.find_one({"_id": invoice_id})
    if not invoice:
        await callback.message.answer("❌ Invoice not found.")
        return

    # Use the short invoice_id for callback data
    short_invoice_id = invoice.get("invoice_id", invoice_id)

    # Build checkout message
    checkout_text = f"💳 *Invoice {invoice['invoice_id']}*\n\n"
    checkout_text += f"*Status:* {invoice['status']}\n\n"
    checkout_text += "Enter the discount code, payment method, address and delivery method. "
    checkout_text += "Once your order has been completed, you will be given payment details.\n\n"

    # Show products
    checkout_text += "*Products:*\n"
    total = invoice.get("total", 0)
    currency = invoice.get("currency", "GBP")

    # Combine items with same product_id and variation_index
    combined_items = {}
    for item in invoice.get("items", []):
        key = (item["product_id"], item.get("variation_index"))
        if key not in combined_items:
            combined_items[key] = {
                "product_id": item["product_id"],
                "variation_index": item.get("variation_index"),
                "price": item["price"],
                "quantity": 0
            }
        combined_items[key]["quantity"] += item["quantity"]

    # Display combined items
    for key, combined_item in combined_items.items():
        product_id = combined_item["product_id"]
        product = await find_by_id(products_collection, product_id)

        if product:
            product_name = product.get("name", "Unknown Product")
            if combined_item.get("variation_index") is not None:
                variations = product.get("variations", [])
                if combined_item["variation_index"] < len(variations):
                    product_name += f" - {variations[combined_item['variation_index']]['name']}"

            checkout_text += f"• {product_name} - {combined_item['price']} {currency}\n"
            if combined_item['quantity'] > 1:
                item_total = combined_item['price'] * combined_item['quantity']
                checkout_text += f"  ({combined_item['quantity']}x = {item_total} {currency})\n"

    # Apply discount and add shipping cost
    discount_amount = invoice.get("discount_amount", 0)
    shipping_cost = invoice.get("shipping_cost", 0) or 0
    final_total = total - discount_amount + shipping_cost

    # Format amounts based on currency
    if currency.upper() == "GBP":
        checkout_text += f"\n*Subtotal:* £{total:.2f}\n"
        if discount_amount > 0:
            checkout_text += f"*Discount:* -£{discount_amount:.2f}\n"
        if shipping_cost > 0:
            checkout_text += f"*Shipping:* £{shipping_cost:.2f}\n"
        checkout_text += f"*Total:* £{final_total:.2f}\n"
    else:
        checkout_text += f"\n*Subtotal:* {total:.2f} {currency}\n"
        if discount_amount > 0:
            checkout_text += f"*Discount:* -{discount_amount:.2f} {currency}\n"
        if shipping_cost > 0:
            checkout_text += f"*Shipping:* {shipping_cost:.2f} {currency}\n"
        checkout_text += f"*Total:* {final_total:.2f} {currency}\n"

    # Show selected options with green ticks
    checkout_text += "\n*Selected Options:*\n"
    if invoice.get("discount_code"):
        discount_amount = invoice.get("discount_amount", 0)
        total = invoice.get("total", 0)
        if discount_amount > 0 and total > 0:
            discount_percent = (discount_amount / total) * 100
            checkout_text += f"✅ 🎟️ Discount: {invoice['discount_code']} ({discount_percent:.0f}% off)\n"
        else:
            checkout_text += f"✅ 🎟️ Discount: {invoice['discount_code']}\n"
    else:
        checkout_text += "○ 🎟️ Discount: Not entered\n"

    if invoice.get("payment_method"):
        checkout_text += f"✅ 💳 Payment: {invoice['payment_method']}\n"
    else:
        checkout_text += "○ 💳 Payment: Not selected\n"

    if invoice.get("delivery_address"):
        checkout_text += f"✅ 📍 Address: Entered\n"
    else:
        checkout_text += "○ 📍 Address: Not entered\n"

    if invoice.get("delivery_method"):
        ship_cost = invoice.get("shipping_cost", 0) or 0
        if ship_cost > 0:
            cost_str = _format_shipping_cost(ship_cost, currency)
            checkout_text += f"✅ 🚚 Delivery: {invoice['delivery_method']} ({cost_str})\n"
        else:
            checkout_text += f"✅ 🚚 Delivery: {invoice['delivery_method']}\n"
    else:
        checkout_text += "○ 🚚 Delivery: Not selected\n"

    # Show notes if they exist
    if invoice.get("notes"):
        checkout_text += f"\n*📝 Notes:*\n{invoice['notes']}\n"

    # Create inline tabs - show selected values or action text
    keyboard_buttons = []

    # Discount code button
    if invoice.get("discount_code"):
        discount_amount = invoice.get("discount_amount", 0)
        total = invoice.get("total", 0)
        if discount_amount > 0 and total > 0:
            discount_percent = (discount_amount / total) * 100
            discount_text = f"🎟️ Discount: {invoice['discount_code']} ({discount_percent:.0f}%)"
        else:
            discount_text = f"🎟️ Discount: {invoice['discount_code']}"
        keyboard_buttons.append([InlineKeyboardButton(text=discount_text, callback_data=f"disc:{short_invoice_id}")])
    else:
        keyboard_buttons.append([InlineKeyboardButton(text="🎟️ Enter a discount code", callback_data=f"disc:{short_invoice_id}")])

    # Payment method button
    if invoice.get("payment_method"):
        keyboard_buttons.append([InlineKeyboardButton(text=f"💳 Payment: {invoice['payment_method']}", callback_data=f"pay:{short_invoice_id}")])
    else:
        keyboard_buttons.append([InlineKeyboardButton(text="💳 Select payment method", callback_data=f"pay:{short_invoice_id}")])

    # Address button
    if invoice.get("delivery_address"):
        keyboard_buttons.append([InlineKeyboardButton(text="📍 Change Delivery Address", callback_data=f"addr:{short_invoice_id}")])
    else:
        keyboard_buttons.append([InlineKeyboardButton(text="📍 Enter Delivery Address", callback_data=f"addr:{short_invoice_id}")])

    # Delivery method button
    if invoice.get("delivery_method"):
        keyboard_buttons.append([InlineKeyboardButton(text=f"🚚 Delivery: {invoice['delivery_method']}", callback_data=f"del:{short_invoice_id}")])
    else:
        keyboard_buttons.append([InlineKeyboardButton(text="🚚 Select Delivery Method", callback_data=f"del:{short_invoice_id}")])

    # Check if invoice is already paid - don't show checkout button if paid
    invoice_status = invoice.get("status", "").lower()
    is_paid = invoice_status in ["paid", "completed"]

    # Also check if order exists and is paid
    orders_collection = db.orders
    order = await orders_collection.find_one({"_id": invoice_id})
    if order and order.get("paymentStatus", "").lower() == "paid":
        is_paid = True

    # Check if all required fields are filled (payment, address, delivery method)
    all_required_filled = (
        invoice.get("payment_method") and
        invoice.get("delivery_address") and
        invoice.get("delivery_method")
    )

    # Only show checkout button if not paid and all required fields are filled
    if all_required_filled and not is_paid:
        keyboard_buttons.append([InlineKeyboardButton(text="✅ Complete Checkout", callback_data=f"complete:{short_invoice_id}")])
    elif is_paid:
        # Show view order button if paid - use order: callback which handles order details
        keyboard_buttons.append([InlineKeyboardButton(text="✅ Payment Completed - View Order", callback_data=f"order:{short_invoice_id}")])

    # Back buttons: Delete, Orders list, Main menu
    keyboard_buttons.append([
        InlineKeyboardButton(text="🗑️ Delete", callback_data=f"del_inv:{short_invoice_id}"),
        InlineKeyboardButton(text="⬅️ Orders", callback_data="orders"),
        InlineKeyboardButton(text="📋 Menu", callback_data="menu")
    ])

    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)

    # Try to edit message first (works for callbacks), fallback to answer (works for messages)
    # When called from a message handler (e.g., after discount input), we need to use answer
    # Check if this is a CallbackQuery (has edit_text) or a Message (must use answer)
    try:
        # Try edit_text first (for callbacks - works when message is from bot)
        await callback.message.edit_text(checkout_text, parse_mode="Markdown", reply_markup=keyboard)
    except Exception as e:
        # If edit_text fails (e.g., message is from user, not bot), use answer
        print(f"[show_checkout_invoice] edit_text failed (likely user message): {e}, using answer instead")
        try:
            await callback.message.answer(checkout_text, parse_mode="Markdown", reply_markup=keyboard)
        except Exception as e2:
            print(f"[show_checkout_invoice] answer with Markdown failed: {e2}, trying without parse_mode")
            # Last resort: try without parse_mode (in case of Markdown parsing errors)
            try:
                await callback.message.answer(checkout_text, reply_markup=keyboard)
            except Exception as e3:
                print(f"[show_checkout_invoice] All methods failed: {e3}")
                import traceback
                traceback.print_exc()


@router.callback_query(F.data.startswith("disc:"))
async def handle_checkout_discount(callback: CallbackQuery):
    """Handle discount code entry"""
    await safe_answer_callback(callback)

    invoice_id = callback.data.split(":")[1]

    # Find invoice by short invoice_id
    db = get_database()
    invoices_collection = db.invoices
    invoice = await invoices_collection.find_one({"invoice_id": invoice_id})
    if not invoice:
        await callback.message.answer("❌ Invoice not found.")
        return

    # Show discount code input interface
    discount_text = "🎟️ *Enter Discount Code*\n\n"
    discount_text += "Please type your discount code:"

    keyboard_buttons = [
        [InlineKeyboardButton(text="❌ Cancel", callback_data=f"back:{invoice_id}")]
    ]
    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)

    try:
        await callback.message.edit_text(discount_text, parse_mode="Markdown", reply_markup=keyboard)
    except:
        await callback.message.answer(discount_text, parse_mode="Markdown", reply_markup=keyboard)

    # Store that we're waiting for discount code input
    # CRITICAL: Clear waiting_for_discount on ALL other invoices for this user to avoid conflicts
    # Then set it only on the current invoice
    user_id = invoice.get("user_id")
    bot_id = invoice.get("bot_id")

    # Clear waiting_for_discount on all other invoices for this user/bot
    await invoices_collection.update_many(
        {
            "user_id": user_id,
            "bot_id": bot_id,
            "_id": {"$ne": invoice["_id"]}  # Exclude current invoice
        },
        {"$set": {"waiting_for_discount": False}}
    )

    # Now set waiting_for_discount on the current invoice
    result = await invoices_collection.update_one(
        {"_id": invoice["_id"]},
        {"$set": {"waiting_for_discount": True, "waiting_for_address": False}}
    )
    print(f"[Discount Button] Set waiting_for_discount=True for invoice {invoice_id}, user_id={user_id}, bot_id={bot_id}, updated={result.modified_count > 0}")


@router.callback_query(F.data.startswith("pay:"))
async def handle_checkout_payment(callback: CallbackQuery):
    """Handle payment method selection - CryptAPI first, then SHKeeper"""
    await safe_answer_callback(callback)

    invoice_id = callback.data.split(":")[1]

    # Don't show loading message - show payment options immediately using fallback list
    # If payment provider API is slow, we'll use the fallback list instantly
    db = get_database()
    invoices_collection = db.invoices
    invoice = await invoices_collection.find_one({"invoice_id": invoice_id})

    if not invoice:
        error_text = "❌ Invoice not found."
        try:
            await callback.message.edit_text(error_text, parse_mode="Markdown")
        except:
            await callback.message.answer(error_text, parse_mode="Markdown")
        return

    keyboard_buttons = []
    payment_text = "💳 *Select Payment Method*\n\n"

    # Check payment providers in order: CryptAPI first, then SHKeeper, Blockonomics, CoinPayments
    import os
    cryptapi_wallet = os.getenv("CRYPTAPI_WALLET_ADDRESS")
    cryptapi_ltc_wallet = os.getenv("CRYPTAPI_LTC_WALLET_ADDRESS")
    cryptapi_btc_wallet = os.getenv("CRYPTAPI_BTC_WALLET_ADDRESS")
    cryptapi_configured = cryptapi_wallet or cryptapi_ltc_wallet or cryptapi_btc_wallet

    shkeeper_api_key = os.getenv("SHKEEPER_API_KEY")
    shkeeper_api_url = os.getenv("SHKEEPER_API_URL")
    shkeeper_configured = shkeeper_api_key and shkeeper_api_url

    blockonomics_api_key = os.getenv("BLOCKONOMICS_API_KEY")
    blockonomics_configured = bool(blockonomics_api_key)

    coinpayments_api_key = os.getenv("PAYMENT_API_KEY")
    coinpayments_api_secret = os.getenv("PAYMENT_API_SECRET")
    coinpayments_configured = bool(coinpayments_api_key and coinpayments_api_secret)

    # If no payment provider is configured, show error
    if not cryptapi_configured and not shkeeper_configured and not blockonomics_configured and not coinpayments_configured:
        error_text = "❌ Payment system is not configured. Please contact support."
        try:
            await callback.message.edit_text(error_text, parse_mode="Markdown")
        except:
            await callback.message.answer(error_text, parse_mode="Markdown")
        return

    # Show payment options immediately using CryptAPI list if available, otherwise SHKeeper fallback
    cancel_keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="❌ Cancel", callback_data=f"back:{invoice_id}")
    ]])

    # Prefer CryptAPI currencies (includes LTC) if configured
    if cryptapi_wallet:
        from services.cryptapi import CRYPTAPI_SUPPORTED_CURRENCIES
        # Filter to only show BTC and LTC
        allowed_currencies = ["BTC", "LTC"]
        filtered_currencies = [c for c in CRYPTAPI_SUPPORTED_CURRENCIES if c.get("code", "").upper() in allowed_currencies]

        # Show only BTC and LTC
        for crypto_item in filtered_currencies:
            crypto_code = crypto_item.get("code", "")
            crypto_name = crypto_item.get("name", crypto_code)
            if crypto_code:
                keyboard_buttons.append([
                    InlineKeyboardButton(
                        text=crypto_name,
                        callback_data=f"pay_sel:{invoice_id}:{crypto_code[:10]}"
                    )
                ])
        print(f"[Payment Selection] Showing filtered currencies: {[c['code'] for c in filtered_currencies]}")
    else:
        # Use bot's configured payment methods from database
        from utils.bot_config import get_bot_config
        bot_config = await get_bot_config()
        allowed_currencies = bot_config.get("payment_methods", ["BTC", "LTC"]) if bot_config else ["BTC", "LTC"]

        from services.shkeeper import FALLBACK_CRYPTO_LIST
        filtered_currencies = [c for c in FALLBACK_CRYPTO_LIST if c.get("code", "").upper() in [ac.upper() for ac in allowed_currencies]]

        for crypto_item in filtered_currencies:
            crypto_code = crypto_item.get("code", "")
            crypto_name = crypto_item.get("name", crypto_code)
            if crypto_code:
                keyboard_buttons.append([
                    InlineKeyboardButton(
                        text=crypto_name,
                        callback_data=f"pay_sel:{invoice_id}:{crypto_code[:10]}"
                    )
                ])

    keyboard_buttons.append([
        InlineKeyboardButton(text="❌ Cancel", callback_data=f"back:{invoice_id}")
    ])

    initial_keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)

    # Show payment options immediately
    try:
        await callback.message.edit_text(payment_text, parse_mode="Markdown", reply_markup=initial_keyboard)
    except:
        await callback.message.answer(payment_text, parse_mode="Markdown", reply_markup=initial_keyboard)

    # Payment methods are already shown from bot's configured payment_methods
    # No need to fetch from SHKeeper API - if a node isn't ready, the error shows at payment time


@router.callback_query(F.data.startswith("pay_sel:"))
async def handle_checkout_payment_select(callback: CallbackQuery):
    """Handle selected payment method"""
    await safe_answer_callback(callback)

    parts = callback.data.split(":")
    invoice_id = parts[1]
    payment_method = parts[2]

    db = get_database()
    invoices_collection = db.invoices
    from datetime import datetime

    # Find invoice by short invoice_id
    invoice = await invoices_collection.find_one({"invoice_id": invoice_id})
    if not invoice:
        await callback.message.answer("❌ Invoice not found.")
        return

    await invoices_collection.update_one(
        {"_id": invoice["_id"]},
        {"$set": {"payment_method": payment_method, "updated_at": datetime.utcnow()}}
    )

    await show_checkout_invoice(invoice_id, callback)


@router.callback_query(F.data.startswith("addr:"))
async def handle_checkout_address(callback: CallbackQuery):
    """Handle delivery address entry"""
    await safe_answer_callback(callback)

    invoice_id = callback.data.split(":")[1]

    # Find invoice by short invoice_id
    db = get_database()
    invoices_collection = db.invoices
    invoice = await invoices_collection.find_one({"invoice_id": invoice_id})
    if not invoice:
        await callback.message.answer("❌ Invoice not found.")
        return

    # CRITICAL: Clear waiting_for_address on ALL other invoices for this user to avoid conflicts
    # Then set it only on the current invoice
    user_id = invoice.get("user_id")
    bot_id = invoice.get("bot_id")

    # Clear waiting_for_address on all other invoices for this user/bot
    await invoices_collection.update_many(
        {
            "user_id": user_id,
            "bot_id": bot_id,
            "_id": {"$ne": invoice["_id"]}  # Exclude current invoice
        },
        {"$set": {"waiting_for_address": False}}
    )

    # Set waiting_for_address on the current invoice
    await invoices_collection.update_one(
        {"_id": invoice["_id"]},
        {"$set": {"waiting_for_address": True, "waiting_for_discount": False}}
    )

    # Ask for shipping address with encryption explanation
    address_text = "📍 *Enter Delivery Address*\n\n"
    address_text += "You can send a message to the chat either as encrypted or as plain text. "
    address_text += "The bot will handle the encryption of the message and display it to the seller after the order is paid for.\n\n"
    address_text += "Please type your address in this format:\n\n"
    address_text += "Street Address\n"
    address_text += "City, State/Province\n"
    address_text += "Postal Code\n"
    address_text += "Country\n\n"
    address_text += "⚠️ *Address is required to complete your order.*"

    keyboard_buttons = [
        [InlineKeyboardButton(text="❌ Cancel", callback_data=f"back:{invoice_id}")]
    ]
    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)

    try:
        await callback.message.edit_text(address_text, parse_mode="Markdown", reply_markup=keyboard)
    except:
        await callback.message.answer(address_text, parse_mode="Markdown", reply_markup=keyboard)

    # Store that we're waiting for address input
    # Clear waiting_for_discount flag to avoid conflicts
    await invoices_collection.update_one(
        {"_id": invoice["_id"]},
        {"$set": {"waiting_for_address": True, "waiting_for_discount": False}}
    )
    print(f"[Address Button] Set waiting_for_address=True for invoice {invoice_id}, user_id={invoice.get('user_id')}, bot_id={invoice.get('bot_id')}")


@router.callback_query(F.data.startswith("del:"))
async def handle_checkout_delivery(callback: CallbackQuery):
    """Handle delivery method selection"""
    await safe_answer_callback(callback)

    invoice_id = callback.data.split(":")[1]

    # Find invoice by short invoice_id
    db = get_database()
    invoices_collection = db.invoices
    invoice = await invoices_collection.find_one({"invoice_id": invoice_id})
    if not invoice:
        await callback.message.answer("❌ Invoice not found.")
        return

    # Get shipping costs from bot config
    bot_config = await get_bot_config()
    costs = _get_shipping_costs(bot_config)
    currency = invoice.get("currency", "GBP")

    # Delivery method options — only show enabled methods from bot config
    method_labels = {
        "FREE": "🚚 Free Delivery",
        "EXP": "⚡ Express Delivery",
        "NXT": "📦 Next Day Delivery",
    }

    keyboard_buttons = []
    for code in sorted(costs.keys()):  # Sort for consistent order
        label = method_labels.get(code, f"{code} Delivery")
        cost = costs[code]
        button_text = f"{label} - {_format_shipping_cost(cost, currency)}"
        keyboard_buttons.append([InlineKeyboardButton(
            text=button_text,
            callback_data=f"del_sel:{invoice_id}:{code}"
        )])

    keyboard_buttons.append([InlineKeyboardButton(text="❌ Cancel", callback_data=f"back:{invoice_id}")])

    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)

    delivery_text = "🚚 *Select Delivery Method*\n\n"
    delivery_text += "Choose your preferred delivery method:"

    try:
        await callback.message.edit_text(delivery_text, parse_mode="Markdown", reply_markup=keyboard)
    except:
        await callback.message.answer(delivery_text, parse_mode="Markdown", reply_markup=keyboard)


@router.callback_query(F.data.startswith("del_sel:"))
async def handle_checkout_delivery_select(callback: CallbackQuery):
    """Handle selected delivery method"""
    await safe_answer_callback(callback)

    parts = callback.data.split(":")
    invoice_id = parts[1]
    delivery_code = parts[2]

    # Map codes to full names
    delivery_map = {
        "FREE": "Free",
        "EXP": "Express",
        "NXT": "Next Day"
    }
    delivery_method = delivery_map.get(delivery_code, delivery_code)

    # Get shipping cost for selected method
    bot_config = await get_bot_config()
    costs = _get_shipping_costs(bot_config)
    shipping_cost = float(costs.get(delivery_code, 0) or 0)

    db = get_database()
    invoices_collection = db.invoices
    from datetime import datetime

    # Find invoice by short invoice_id
    invoice = await invoices_collection.find_one({"invoice_id": invoice_id})
    if not invoice:
        await callback.message.answer("❌ Invoice not found.")
        return

    await invoices_collection.update_one(
        {"_id": invoice["_id"]},
        {"$set": {
            "delivery_method": delivery_method,
            "shipping_cost": shipping_cost,
            "shipping_method_code": delivery_code,
            "updated_at": datetime.utcnow()
        }}
    )

    await show_checkout_invoice(invoice_id, callback)


@router.callback_query(F.data.startswith("del_inv:"))
async def handle_checkout_delete(callback: CallbackQuery):
    """Handle order deletion"""
    await safe_answer_callback(callback)

    invoice_id = callback.data.split(":")[1]

    db = get_database()
    invoices_collection = db.invoices

    # Find invoice by short invoice_id
    invoice = await invoices_collection.find_one({"invoice_id": invoice_id})
    if invoice:
        await invoices_collection.delete_one({"_id": invoice["_id"]})

    await callback.message.answer("🗑️ Order deleted successfully.")

    # Return to cart
    from handlers.cart import handle_view_cart
    await handle_view_cart(callback)


@router.callback_query(F.data.startswith("back:"))
async def handle_checkout_back(callback: CallbackQuery):
    """Handle back button - return to invoice view"""
    await safe_answer_callback(callback)

    invoice_id = callback.data.split(":")[1]
    await show_checkout_invoice(invoice_id, callback)


@router.callback_query(F.data.startswith("complete:"))
async def handle_complete_checkout(callback: CallbackQuery):
    """Handle complete checkout - show confirmation message first"""
    await safe_answer_callback(callback)

    invoice_id = callback.data.split(":")[1]

    db = get_database()
    invoices_collection = db.invoices
    orders_collection = db.orders

    # Find invoice by short invoice_id
    invoice = await invoices_collection.find_one({"invoice_id": invoice_id})
    if not invoice:
        await callback.message.answer("❌ Invoice not found.")
        return

    # Check if invoice/order is already paid - prevent duplicate checkout
    invoice_status = invoice.get("status", "").lower()
    is_paid = invoice_status in ["paid", "completed"]

    # Also check order status
    order = await orders_collection.find_one({"_id": invoice_id})
    if order and order.get("paymentStatus", "").lower() == "paid":
        is_paid = True

    if is_paid:
        await callback.message.answer("ℹ️ This order has already been paid. You cannot complete checkout again.")
        # Redirect to orders view
        await callback.message.answer("📦 View your orders using the /orders command or the Orders button in the menu.")
        return

    # Verify all required fields are filled
    if not invoice.get("payment_method") or not invoice.get("delivery_address") or not invoice.get("delivery_method"):
        await callback.message.answer("❌ Please complete all required fields before checkout.")
        await show_checkout_invoice(invoice_id, callback)
        return

    # Show confirmation message
    confirmation_text = f"*Confirmation of order creation {invoice_id}*\n\n"
    confirmation_text += "Before proceeding with the checkout, make sure you are well informed about how to pay with cryptocurrency. "
    confirmation_text += "Ensure that you pay the EXACT amount mentioned and not the equivalent fiat amount. "
    confirmation_text += "Be aware of any wallet fees that may be deducted during the transaction process. "
    confirmation_text += "It's crucial to follow these steps to ensure that your order will not be cancelled.\n\n"
    confirmation_text += "⚠️ *Please read the above information carefully before proceeding.*"

    keyboard_buttons = [
        [InlineKeyboardButton(text="✅ Yes I understand", callback_data=f"confirm:{invoice_id}")],
        [InlineKeyboardButton(text="⬅️ Back", callback_data=f"back:{invoice_id}")]
    ]
    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)

    try:
        await callback.message.edit_text(confirmation_text, parse_mode="Markdown", reply_markup=keyboard)
    except:
        await callback.message.answer(confirmation_text, parse_mode="Markdown", reply_markup=keyboard)


@router.callback_query(F.data.startswith("confirm:"))
async def handle_confirm_checkout(callback: CallbackQuery):
    """Handle confirm checkout - process order and show payment details"""
    await safe_answer_callback(callback)

    invoice_id = callback.data.split(":")[1]

    db = get_database()
    invoices_collection = db.invoices
    orders_collection = db.orders
    products_collection = db.products

    # Find invoice by short invoice_id
    invoice = await invoices_collection.find_one({"invoice_id": invoice_id})
    if not invoice:
        error_text = "❌ Invoice not found."
        try:
            await callback.message.answer(error_text, parse_mode="Markdown")
        except:
            await callback.message.answer(error_text, parse_mode="Markdown")
        return

    # Check if invoice/order is already paid - prevent duplicate order creation
    invoice_status = invoice.get("status", "").lower()
    is_paid = invoice_status in ["paid", "completed"]

    # Also check order status
    existing_order = await orders_collection.find_one({"_id": invoice_id})
    if existing_order:
        if existing_order.get("paymentStatus", "").lower() == "paid":
            is_paid = True
            error_text = "ℹ️ This order has already been paid and completed. You cannot create a duplicate order."
            try:
                await callback.message.answer(error_text, parse_mode="Markdown")
            except:
                await callback.message.answer(error_text, parse_mode="Markdown")
            # Redirect to orders view
            await callback.message.answer("📦 View your orders using the /orders command or the Orders button in the menu.")
            return

    # Show loading message IMMEDIATELY
    loading_text = "⏳ *Processing your order...*\n\nPlease wait while we create your payment invoice."
    loading_keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="⏳ Processing...", callback_data="processing")
    ]])

    try:
        await callback.message.edit_text(loading_text, parse_mode="Markdown", reply_markup=loading_keyboard)
    except:
        await callback.message.answer(loading_text, parse_mode="Markdown", reply_markup=loading_keyboard)

    bot_config = await get_bot_config()
    if not bot_config:
        return

    bot_id = str(bot_config["_id"])
    user_id = str(invoice["user_id"])

    # Import required modules
    from datetime import datetime, timedelta
    from services.commission import calculate_commission, COMMISSION_RATE
    from utils.currency_converter import convert_amount
    from services.payment_provider import create_payment_invoice

    # Get invoice currency and payment currency
    invoice_currency = invoice.get("currency", "GBP")
    selected_currency = invoice.get("payment_method", "BTC")

    # Use the invoice's total field (subtotal - discount + shipping)
    total = invoice.get("total", 0)
    discount_amount = invoice.get("discount_amount", 0)
    shipping_cost = invoice.get("shipping_cost", 0) or 0
    final_total = total - discount_amount + shipping_cost  # Amount to charge

    # Use final_total as combined_amount (includes discount and shipping)
    combined_amount = final_total

    # Debug: Log invoice items to verify quantities
    invoice_items = invoice.get("items", [])
    print(f"[Checkout] Invoice has {len(invoice_items)} items:")
    for idx, item in enumerate(invoice_items):
        print(f"[Checkout]   Item {idx+1}: product_id={item.get('product_id')}, quantity={item.get('quantity')}, price={item.get('price')}")

    print(f"[Checkout] Invoice total: {total} {invoice_currency}, Discount: {discount_amount}, Shipping: {shipping_cost}, Final: {combined_amount} {invoice_currency}")

    # OPTIMIZATION: Run product fetching and currency conversion in parallel
    import asyncio
    from bson import ObjectId

    # Prepare product fetching task
    async def fetch_products():
        order_items = []
        product_ids = [item["product_id"] for item in invoice.get("items", [])]
        products_dict = {}

        # Try to fetch products by ObjectId first (batch)
        object_ids = []
        string_ids = []
        for pid in product_ids:
            try:
                if len(pid) == 24:
                    object_ids.append(ObjectId(pid))
                else:
                    string_ids.append(pid)
            except:
                string_ids.append(pid)

        # Batch fetch by ObjectId
        if object_ids:
            products = await products_collection.find({"_id": {"$in": object_ids}}).to_list(length=100)
            for p in products:
                products_dict[str(p["_id"])] = p

        # Fetch remaining by string ID (batch fetch)
        if string_ids:
            string_products = await products_collection.find({"_id": {"$in": string_ids}}).to_list(length=100)
            for p in string_products:
                products_dict[str(p.get('_id'))] = p
                products_dict[p.get('_id')] = p

        # Build order_items
        for idx, item in enumerate(invoice.get("items", [])):
            product_id = item["product_id"]
            product = products_dict.get(product_id) or products_dict.get(str(product_id))
            if product:
                order_items.append({"product": product, "item": item})

        return order_items

    # No currency conversion needed - send original fiat amount to SHKeeper
    async def convert_currency():
        return combined_amount

    # Run both tasks in parallel
    order_items_task = fetch_products()
    currency_task = convert_currency()

    # Wait for both to complete
    order_items, amount_for_shkeeper = await asyncio.gather(order_items_task, currency_task)

    # Log results
    print(f"[Checkout] === AMOUNT CALCULATION DEBUG ===")
    print(f"[Checkout] Invoice currency: {invoice_currency}")
    print(f"[Checkout] Combined amount (final_total): {combined_amount}")
    print(f"[Checkout] === FINAL AMOUNT FOR SHKEEPER: {amount_for_shkeeper} {invoice_currency} ===")

    commission = calculate_commission(combined_amount)

    # Use invoice_id as order_id (same ID for both)
    order_id = invoice_id

    # Get first product for order display (or use combined info)
    first_product = order_items[0]["product"] if order_items else None

    # OPTIMIZATION: Run secret phrase lookup and order existence check in parallel
    from utils.secret_phrase import get_or_create_user_secret_phrase
    import hashlib

    async def get_secret_phrase_hash():
        user_secret_phrase = await get_or_create_user_secret_phrase(user_id, bot_id)
        return hashlib.sha256(user_secret_phrase.encode()).hexdigest()

    async def check_existing_order():
        return await orders_collection.find_one({"_id": order_id})

    # Run both in parallel
    secret_hash_task = get_secret_phrase_hash()
    existing_order_task = check_existing_order()
    secret_phrase_hash, existing_order = await asyncio.gather(secret_hash_task, existing_order_task)

    if existing_order:
        # Order already exists - this shouldn't happen, but generate a new ID
        from utils.invoice_id import generate_short_invoice_id
        order_id = await generate_short_invoice_id(db=db)
        # Update invoice with new order_id
        await invoices_collection.update_one(
            {"_id": invoice["_id"]},
            {"$set": {"invoice_id": order_id}}
        )
        invoice_id = order_id

    order = {
        "_id": order_id,
        "botId": bot_id,
        "productId": order_items[0]["item"]["product_id"] if order_items else None,
        "userId": user_id,
        "quantity": sum([item["item"]["quantity"] for item in order_items]),
        "variation_index": order_items[0]["item"].get("variation_index") if order_items else None,
        "paymentStatus": "pending",
        "amount": combined_amount,  # Store original amount in invoice currency (includes shipping)
        "commission": commission,
        "commission_rate": COMMISSION_RATE,
        "currency": selected_currency.upper(),  # Store payment currency (BTC, LTC, etc.)
        "timestamp": datetime.utcnow(),
        "encrypted_address": invoice.get("delivery_address"),
        "delivery_method": invoice.get("delivery_method"),
        "shipping_cost": shipping_cost,
        "shipping_method_code": invoice.get("shipping_method_code"),
        "discount_code": invoice.get("discount_code"),
        "discount_amount": discount_amount,
        "items": [
            {
                **oi["item"],
                "product_name": (
                    oi["product"].get("name", "Unknown") +
                    (f" - {oi['product']['variations'][oi['item']['variation_index']]['name']}"
                     if oi["item"].get("variation_index") is not None
                     and oi["item"]["variation_index"] < len(oi["product"].get("variations", []))
                     else "")
                )
            }
            for oi in order_items
        ] if order_items else invoice.get("items", []),  # Store enriched items with product_name
        "secret_phrase_hash": secret_phrase_hash,
        "status_history": [{
            "from_status": None,
            "to_status": "pending",
            "changed_by": f"buyer:{user_id}",
            "changed_at": datetime.utcnow(),
            "note": "Order placed",
        }],
    }

    # Insert order (this is fast, no need to parallelize)
    await orders_collection.insert_one(order)

    # Store for payment invoice creation
    orders_created = [{
        "order": order,
        "product": first_product
    }]

    # Pass USD amount to SHKeeper (it expects USD)
    # Update loading message to show we're creating payment invoice
    try:
        await callback.message.edit_text(
            "⏳ *Creating payment invoice...*\n\nConnecting to payment provider. This may take a few seconds.",
            parse_mode="Markdown",
            reply_markup=loading_keyboard
        )
    except:
        pass  # If edit fails, continue anyway

    # Run SHKeeper API call in executor to avoid blocking
    import asyncio
    loop = asyncio.get_event_loop()

    # Get bot config for webhook URL
    bot_config = await get_bot_config()

    try:
        invoice_result = await loop.run_in_executor(
            None,
            lambda: create_payment_invoice(
                amount=amount_for_shkeeper,
                currency=selected_currency,
                order_id=invoice_id,
                buyer_email="",
                fiat_currency=invoice_currency.upper(),
                fiat_amount=amount_for_shkeeper,
                bot_config=bot_config
            )
        )
    except Exception as e:
        print(f"Error creating payment invoice: {e}")
        error_text = f"❌ Payment error: {str(e)}"
        try:
            await callback.message.edit_text(error_text, parse_mode="Markdown")
        except:
            await callback.message.answer(error_text, parse_mode="Markdown")
        return

    if not invoice_result.get("success"):
        error_text = f"❌ Payment error: {invoice_result.get('error', 'Unknown error')}"
        try:
            await callback.message.edit_text(error_text, parse_mode="Markdown")
        except:
            await callback.message.answer(error_text, parse_mode="Markdown")
        return

    # Get currency display name
    display_currency = invoice_result.get('display_name') or invoice_result.get('currency', selected_currency)
    crypto_currency = invoice_result.get('currency', selected_currency)
    crypto_amount = invoice_result.get('amount')
    payment_provider = invoice_result.get('provider', 'unknown')

    # Debug: Log what we got from payment provider
    print(f"[Checkout] Payment provider result ({payment_provider}) - amount: {crypto_amount}, currency: {crypto_currency}, display_name: {display_currency}")

    # Validate crypto_amount - if it looks like USD (large number > 100), something is wrong
    if crypto_amount and isinstance(crypto_amount, (int, float)) and crypto_amount > 100:
        print(f"[Checkout] WARNING: crypto_amount ({crypto_amount}) looks like USD, not crypto. Checking payment_uri...")
        # Try to extract from payment_uri if available
        payment_uri = invoice_result.get('payment_uri', '')
        if payment_uri and 'amount=' in payment_uri:
            try:
                # Extract amount from URI (e.g., "bitcoin:address?amount=0.00012345")
                uri_amount = payment_uri.split('amount=')[1].split('&')[0]
                crypto_amount = float(uri_amount)
                print(f"[Checkout] Extracted crypto amount from URI: {crypto_amount}")
            except:
                print(f"[Checkout] Could not extract amount from URI")

    # Fallback if still no valid crypto amount
    if not crypto_amount or (isinstance(crypto_amount, (int, float)) and crypto_amount > 100):
        print(f"[Checkout] ERROR: Invalid crypto_amount ({crypto_amount}), this should not happen!")
        # This is a fallback - should not reach here
        crypto_amount = 0

    # OPTIMIZATION: Run all database updates in parallel, then show invoice immediately
    payment_deadline = datetime.utcnow() + timedelta(hours=3)

    # Prepare all update operations
    async def update_order():
        # CryptAPI doesn't return txn_id, use invoice_id or address as identifier
        invoice_external_id = invoice_result.get("txn_id") or invoice_result.get("invoice_id") or invoice_result.get("address")
        if invoice_external_id:
            await orders_collection.update_one(
                {"_id": invoice_id},
                {"$set": {"invoiceId": invoice_external_id}}
            )

    async def update_invoice():
        await invoices_collection.update_one(
            {"_id": invoice["_id"]},
            {"$set": {
                "status": "Pending Payment",
                "payment_address": invoice_result["address"],
                "payment_amount": crypto_amount,
                "payment_currency": display_currency,
                "payment_currency_code": crypto_currency,
                "payment_invoice_id": invoice_result.get("txn_id") or invoice_result.get("invoice_id"),
                "payment_exchange_rate": invoice_result.get("exchange_rate"),
                "payment_deadline": payment_deadline,
                "payment_qrcode_url": invoice_result.get("qrcode_url"),
                "payment_uri": invoice_result.get("payment_uri"),
                "payment_provider": invoice_result.get("provider", "cryptapi"),  # Store provider so QR handler knows it's CryptAPI
                "updated_at": datetime.utcnow()
            }}
        )

    async def clear_cart():
        carts_collection = db.carts
        cart = await carts_collection.find_one({
            "user_id": user_id,
            "bot_id": bot_id
        })
        if cart:
            await carts_collection.update_one(
                {"_id": cart["_id"]},
                {"$set": {"items": [], "updated_at": None}}
            )

    # Run all database operations in parallel
    await asyncio.gather(
        update_order(),
        update_invoice(),
        clear_cart()
    )

    # Show payment invoice immediately after database updates
    await show_payment_invoice(invoice_id, callback)


async def show_payment_invoice(invoice_id: str, callback: CallbackQuery | Message):
    """Show payment invoice with payment details"""
    db = get_database()
    invoices_collection = db.invoices
    products_collection = db.products

    # Handle both CallbackQuery and Message
    if hasattr(callback, 'message'):
        message = callback.message
    else:
        message = callback

    invoice = await invoices_collection.find_one({"invoice_id": invoice_id})
    if not invoice:
        await message.answer("❌ Invoice not found.")
        return

    # Use the invoice_id from the database document (should be numeric after migration)
    display_invoice_id = invoice.get("invoice_id", invoice_id)

    # Calculate time left
    from datetime import datetime, timedelta
    payment_deadline = invoice.get("payment_deadline")
    if payment_deadline:
        # Handle datetime object or string
        if isinstance(payment_deadline, str):
            try:
                # Try parsing ISO format
                payment_deadline = datetime.fromisoformat(payment_deadline.replace('Z', '+00:00'))
            except:
                try:
                    # Try parsing common format
                    payment_deadline = datetime.strptime(payment_deadline, "%Y-%m-%d %H:%M:%S")
                except:
                    payment_deadline = None

        if payment_deadline:
            time_left = payment_deadline - datetime.utcnow()
            if time_left.total_seconds() > 0:
                hours = int(time_left.total_seconds() // 3600)
                minutes = int((time_left.total_seconds() % 3600) // 60)
                time_left_str = f"{hours}h {minutes}m"
            else:
                time_left_str = "Expired"
        else:
            time_left_str = "3h 0m"
    else:
        time_left_str = "3h 0m"

    # Get payment amount and format it properly
    payment_amount = invoice.get('payment_amount', 0)
    payment_currency = invoice.get('payment_currency', 'BTC')
    payment_currency_code = invoice.get('payment_currency_code', payment_currency)

    # Handle negative amounts (shouldn't happen, but fix if it does)
    if payment_amount < 0:
        payment_amount = abs(payment_amount)

    # Validate amount - if it seems too small for the invoice total, recalculate
    invoice_total = invoice.get('total', 0)
    discount_amount = invoice.get('discount_amount', 0)
    final_total = invoice_total - discount_amount
    invoice_currency = invoice.get('currency', 'GBP')

    # Convert invoice total to USD for comparison
    if invoice_currency.upper() != 'USD':
        from utils.currency_converter import convert_amount
        final_total_usd = convert_amount(final_total, invoice_currency, 'USD')
        if not final_total_usd:
            # Fallback: use cached GBP/USD rate or approximate
            from utils.currency_converter import get_exchange_rate
            gbp_usd_rate = get_exchange_rate('gbp', 'usd')
            if gbp_usd_rate and gbp_usd_rate > 0:
                final_total_usd = final_total * gbp_usd_rate
                print(f"[Payment Invoice] Converted {final_total} {invoice_currency} to {final_total_usd} USD using rate {gbp_usd_rate}")
            else:
                final_total_usd = final_total * 1.32  # Approximate GBP to USD
                print(f"[Payment Invoice] Using fallback rate: {final_total} {invoice_currency} * 1.32 = {final_total_usd} USD")
    else:
        final_total_usd = final_total

    # Validate and fix crypto amount if it seems wrong
    # Check for zero amounts or amounts that are clearly too small
    if payment_amount == 0 or payment_amount is None:
        print(f"[Payment Invoice] ERROR: {payment_currency_code} amount is 0 or None for {final_total_usd} USD invoice, recalculating...")
        should_recalculate = True
    elif payment_currency_code.upper() == 'LTC':
        expected_min_ltc = final_total_usd / 200
        if payment_amount < expected_min_ltc and final_total_usd > 5:
            print(f"[Payment Invoice] WARNING: LTC amount {payment_amount} seems too small for {final_total_usd} USD (expected at least {expected_min_ltc} LTC), recalculating...")
            should_recalculate = True
        else:
            should_recalculate = False
    elif payment_currency_code.upper() == 'BTC':
        expected_min_btc = final_total_usd / 100000
        expected_max_btc = final_total_usd / 50000
        if payment_amount < expected_min_btc and final_total_usd > 5:
            print(f"[Payment Invoice] WARNING: BTC amount {payment_amount} seems too small for {final_total_usd} USD, recalculating...")
            should_recalculate = True
        elif payment_amount > expected_max_btc:
            print(f"[Payment Invoice] WARNING: BTC amount {payment_amount} seems too large for {final_total_usd} USD (expected max {expected_max_btc} BTC), recalculating...")
            should_recalculate = True
        else:
            should_recalculate = False
    else:
        should_recalculate = False

    # Recalculate if needed
    if should_recalculate:
        try:
            from utils.currency_converter import get_exchange_rate
            print(f"[Payment Invoice] Recalculating {payment_currency_code} amount...")
            print(f"[Payment Invoice] Invoice total: {final_total} {invoice_currency}")
            print(f"[Payment Invoice] Final total USD: {final_total_usd} USD")
            print(f"[Payment Invoice] Current payment_amount: {payment_amount} {payment_currency_code}")

            crypto_rate = get_exchange_rate(payment_currency_code.lower(), 'usd')
            print(f"[Payment Invoice] Exchange rate for {payment_currency_code}: {crypto_rate} (1 {payment_currency_code} = {crypto_rate} USD)")
            if crypto_rate and crypto_rate > 0:
                recalculated_amount = final_total_usd / crypto_rate
                print(f"[Payment Invoice] Recalculated {payment_currency_code}: {final_total_usd} USD / {crypto_rate} USD per {payment_currency_code} = {recalculated_amount} {payment_currency_code}")

                if payment_currency_code.upper() == 'BTC':
                    max_reasonable_btc = final_total_usd / 50000
                    if recalculated_amount > 0 and recalculated_amount <= max_reasonable_btc:
                        payment_amount = recalculated_amount
                        await invoices_collection.update_one(
                            {"_id": invoice["_id"]},
                            {"$set": {"payment_amount": recalculated_amount}}
                        )
                        print(f"[Payment Invoice] Updated invoice with correct amount: {recalculated_amount} {payment_currency_code}")
                    else:
                        print(f"[Payment Invoice] ERROR: Recalculated amount {recalculated_amount} BTC seems invalid for {final_total_usd} USD order (max reasonable: {max_reasonable_btc} BTC)")
                elif recalculated_amount > 0 and recalculated_amount < 1000:
                    payment_amount = recalculated_amount
                    await invoices_collection.update_one(
                        {"_id": invoice["_id"]},
                        {"$set": {"payment_amount": recalculated_amount}}
                    )
                    print(f"[Payment Invoice] Updated invoice with correct amount: {recalculated_amount} {payment_currency_code}")
                else:
                    print(f"[Payment Invoice] ERROR: Recalculated amount {recalculated_amount} seems invalid (too large or negative)")
            else:
                print(f"[Payment Invoice] ERROR: Could not get exchange rate for {payment_currency_code}")
        except Exception as e:
            print(f"[Payment Invoice] Error recalculating {payment_currency_code} amount: {e}")
            import traceback
            traceback.print_exc()

    # Format amount based on currency
    # Check both display name (e.g. "Litecoin") and code (e.g. "LTC")
    _cur = payment_currency.upper()
    _code = (payment_currency_code or "").upper()
    _crypto_names = {'BTC', 'BITCOIN', 'ETH', 'ETHEREUM', 'LTC', 'LITECOIN', 'BCH', 'BITCOIN CASH', 'DOGE', 'DOGECOIN', 'XMR', 'MONERO', 'XRP', 'RIPPLE', 'AVAX', 'AVALANCHE', 'BNB'}
    if _cur in _crypto_names or _code in _crypto_names:
        formatted_amount = f"{payment_amount:.8f}".rstrip('0').rstrip('.')
    else:
        formatted_amount = f"{payment_amount:.2f}"

    # Check order status to determine invoice status
    orders_collection = db.orders
    order_status = "Pending Payment"

    order = await orders_collection.find_one({"_id": invoice_id})
    if not order:
        order = await orders_collection.find_one({"invoiceId": invoice_id})

    if order:
        payment_status = order.get("paymentStatus", "pending")
        if payment_status == "paid":
            order_status = "Paid"
            await invoices_collection.update_one(
                {"_id": invoice["_id"]},
                {"$set": {"status": "Paid"}}
            )
        else:
            order_status = "Pending Payment"
    else:
        invoice_status = invoice.get("status", "Pending Payment")
        if invoice_status == "Paid":
            order_status = "Paid"
        else:
            order_status = "Pending Payment"

    # Build invoice message
    invoice_text = f"*Invoice {display_invoice_id}*\n\n"
    invoice_text += f"⏱️ *Status:* {order_status}\n"
    if order_status == "Pending Payment":
        invoice_text += f"➡️ *Time Left:* {time_left_str} Maximum\n\n"
    else:
        invoice_text += "\n"

    invoice_text += f"*Payment Address:*\n"
    invoice_text += f"`{invoice.get('payment_address', 'N/A')}`\n\n"

    invoice_text += f"*Amount:*\n"
    invoice_text += f"{formatted_amount} {payment_currency}\n\n"

    invoice_text += "Please ensure that you send the exact amount specified. "
    invoice_text += "It's important to note that certain exchanges or wallets may deduct fees from your payment, "
    invoice_text += "so kindly double-check the amount before sending your payment to make sure you sent the correct amount.\n\n"

    # Show products
    invoice_text += "*Products:*\n"
    for item in invoice.get("items", []):
        product = await find_by_id(products_collection, item["product_id"])

        if product:
            invoice_text += f"• {product.get('name', 'Unknown')} - {item['price']} {invoice.get('currency', 'GBP')}\n"
            if item.get('quantity', 1) > 1:
                invoice_text += f"  (Quantity: {item['quantity']})\n"

    invoice_text += "\n"

    # Show discount if applicable
    if invoice.get("discount_code"):
        discount_amount = invoice.get("discount_amount", 0)
        invoice_text += f"*Discount:* {invoice['discount_code']} (-{discount_amount:.2f} {invoice.get('currency', 'GBP')})\n"

    # Show delivery and shipping cost
    if invoice.get("delivery_method"):
        shipping_cost = invoice.get("shipping_cost", 0) or 0
        if shipping_cost > 0:
            invoice_text += f"*Delivery:* {invoice['delivery_method']} (+{shipping_cost:.2f} {invoice.get('currency', 'GBP')})\n"
        else:
            invoice_text += f"*Delivery:* {invoice['delivery_method']}\n"

    # Show notes if they exist
    if invoice.get("notes"):
        invoice_text += f"\n*📝 Notes:*\n{invoice['notes']}\n"

    # Show total (subtotal - discount + shipping)
    total = invoice.get("total", 0)
    discount_amount = invoice.get("discount_amount", 0)
    shipping_cost = invoice.get("shipping_cost", 0) or 0
    final_total = total - discount_amount + shipping_cost
    currency = invoice.get("currency", "GBP")
    invoice_text += f"*Total:* {final_total:.2f} {currency}\n"

    # Create inline buttons (use original invoice_id for callbacks to ensure lookup works)
    notes_button_text = "📝 Edit Notes" if invoice.get("notes") else "📝 Add Notes"

    keyboard_buttons = [
        [InlineKeyboardButton(text=notes_button_text, callback_data=f"notes:{invoice_id}")],
        [
            InlineKeyboardButton(text="📷 Show QR", callback_data=f"qr:{invoice_id}"),
            InlineKeyboardButton(text="🔄 Refresh", callback_data=f"refresh_pay:{invoice_id}")
        ],
    ]

    # Add "Rate this order" button when order is paid/confirmed/shipped/delivered/completed and not yet rated
    if order_status in ("Paid", "Confirmed", "Shipped", "Delivered", "Completed") and order:
        reviews_collection = db.reviews
        existing_review = await reviews_collection.find_one({"order_id": invoice_id})
        if not existing_review:
            keyboard_buttons.append([InlineKeyboardButton(text="⭐ Rate this order", callback_data=f"rate_order:{invoice_id}")])

    keyboard_buttons.append([InlineKeyboardButton(text="⬅️ Back to Orders", callback_data=f"back_pay:{invoice_id}")])
    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)

    try:
        sent = await message.edit_text(invoice_text, parse_mode="Markdown", reply_markup=keyboard)
    except:
        sent = await message.answer(invoice_text, parse_mode="Markdown", reply_markup=keyboard)

    # Save message_id and chat_id so webhook can edit this message when payment is confirmed
    if sent and hasattr(sent, 'message_id'):
        try:
            chat_id = sent.chat.id if hasattr(sent, 'chat') else (message.chat.id if hasattr(message, 'chat') else None)
            if chat_id:
                await invoices_collection.update_one(
                    {"invoice_id": invoice_id},
                    {"$set": {"telegram_message_id": sent.message_id, "telegram_chat_id": chat_id}}
                )
        except Exception as e:
            print(f"[Invoice] Could not save message_id for invoice {invoice_id}: {e}")


async def show_cancelled_order_invoice(invoice_id: str, callback: CallbackQuery | Message):
    """Show cancelled/expired order details - read-only view with contact seller message"""
    db = get_database()
    invoices_collection = db.invoices
    products_collection = db.products

    if hasattr(callback, 'message'):
        message = callback.message
    else:
        message = callback

    invoice = await invoices_collection.find_one({"invoice_id": invoice_id})
    if not invoice:
        invoice = await invoices_collection.find_one({"_id": invoice_id})
    if not invoice:
        await message.answer("❌ Invoice not found.")
        return

    display_invoice_id = invoice.get("invoice_id", invoice_id)
    currency = invoice.get("currency", "GBP")
    currency_symbol = "£" if currency.upper() == "GBP" else f"{currency} "

    # Build cancelled order message
    cancelled_text = f"💳 *Invoice {display_invoice_id}*\n\n"
    cancelled_text += "Payment for the order has been cancelled. "
    cancelled_text += "If you have sent the coins but the order is still cancelled, "
    cancelled_text += "contact the seller with the order number and proof of payment.\n\n"

    # Items list
    from bson import ObjectId
    for idx, item in enumerate(invoice.get("items", []), 1):
        product_id = item.get("product_id")
        product = await find_by_id(products_collection, product_id) if product_id else None

        product_name = product.get("name", "Unknown Product") if product else "Unknown Product"
        if item.get("variation_index") is not None and product:
            variations = product.get("variations", [])
            if item["variation_index"] < len(variations):
                product_name += f" - {variations[item['variation_index']]['name']}"

        quantity = item.get("quantity", 1)
        price = item.get("price", 0)
        line_total = price * quantity
        if currency.upper() == "GBP":
            cancelled_text += f"{idx}. {product_name} {quantity:.2f} — £{line_total:.2f}\n"
        else:
            cancelled_text += f"{idx}. {product_name} {quantity:.2f} — {currency_symbol}{line_total:.2f}\n"

    # Discount
    discount_amount = invoice.get("discount_amount", 0)
    if discount_amount > 0:
        if currency.upper() == "GBP":
            cancelled_text += f"\n*Discount:* -£{discount_amount:.2f}\n"
        else:
            cancelled_text += f"\n*Discount:* -{currency_symbol}{discount_amount:.2f}\n"

    # Delivery and shipping
    if invoice.get("delivery_method"):
        shipping_cost = invoice.get("shipping_cost", 0) or 0
        if shipping_cost > 0:
            cancelled_text += f"*Delivery:* {invoice['delivery_method']} (+{currency_symbol}{shipping_cost:.2f})\n"
        else:
            cancelled_text += f"*Delivery:* {invoice['delivery_method']}\n"

    # Total (subtotal - discount + shipping)
    total = invoice.get("total", 0)
    shipping_cost = invoice.get("shipping_cost", 0) or 0
    final_total = total - discount_amount + shipping_cost
    if currency.upper() == "GBP":
        cancelled_text += f"*Total:* £{final_total:.2f}\n"
    else:
        cancelled_text += f"*Total:* {currency_symbol}{final_total:.2f}\n"

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="⬅️ Back to Orders", callback_data="orders")]
    ])

    try:
        await message.edit_text(cancelled_text, parse_mode="Markdown", reply_markup=keyboard)
    except Exception:
        await message.answer(cancelled_text, parse_mode="Markdown", reply_markup=keyboard)


@router.callback_query(F.data.startswith("notes:"))
async def handle_add_notes(callback: CallbackQuery):
    """Handle add notes button - allow user to add/edit notes for their order"""
    await safe_answer_callback(callback)

    invoice_id = callback.data.split(":")[1]

    db = get_database()
    invoices_collection = db.invoices

    # Find invoice
    invoice = await invoices_collection.find_one({"invoice_id": invoice_id})
    if not invoice:
        await callback.message.answer("❌ Invoice not found.")
        return

    bot_config = await get_bot_config()
    if not bot_config:
        return

    user_id = str(callback.from_user.id)
    bot_id = str(bot_config["_id"])

    # Verify this invoice belongs to this user
    if str(invoice.get("user_id")) != user_id or str(invoice.get("bot_id")) != bot_id:
        await callback.message.answer("❌ You don't have permission to modify this invoice.")
        return

    # Check if notes already exist
    existing_notes = invoice.get("notes", "")

    if existing_notes:
        notes_text = f"*Current Notes:*\n\n{existing_notes}\n\n"
        notes_text += "Would you like to update these notes?\n"
        notes_text += "Send your new notes (or /cancel to keep current notes):"

        keyboard = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text="❌ Cancel", callback_data=f"notes_cancel:{invoice_id}")
        ]])

        try:
            await callback.message.edit_text(notes_text, parse_mode="Markdown", reply_markup=keyboard)
        except:
            await callback.message.answer(notes_text, parse_mode="Markdown", reply_markup=keyboard)
    else:
        notes_text = "📝 *Add Notes to Your Order*\n\n"
        notes_text += "You can add notes to help us with your order. "
        notes_text += "This could include special instructions, delivery preferences, or any other information you'd like us to know.\n\n"
        notes_text += "Send your notes (or /cancel to skip):"

        keyboard = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text="❌ Cancel", callback_data=f"notes_cancel:{invoice_id}")
        ]])

        try:
            await callback.message.edit_text(notes_text, parse_mode="Markdown", reply_markup=keyboard)
        except:
            await callback.message.answer(notes_text, parse_mode="Markdown", reply_markup=keyboard)

    # Set waiting_for_notes flag
    await invoices_collection.update_one(
        {"invoice_id": invoice_id},
        {"$set": {"waiting_for_notes": True}}
    )


@router.callback_query(F.data.startswith("notes_cancel:"))
async def handle_notes_cancel(callback: CallbackQuery):
    """Cancel notes input and go back to payment invoice"""
    await safe_answer_callback(callback)

    invoice_id = callback.data.split(":")[1]

    db = get_database()
    invoices_collection = db.invoices

    # Clear waiting flag
    await invoices_collection.update_one(
        {"invoice_id": invoice_id},
        {"$unset": {"waiting_for_notes": ""}}
    )

    # Show payment invoice
    await show_payment_invoice(invoice_id, callback)


@router.callback_query(F.data.startswith("qr:"))
async def handle_show_qr(callback: CallbackQuery):
    """Handle show QR code button"""
    print(f"[QR Handler] ========== QR HANDLER CALLED ==========")
    print(f"[QR Handler] Callback data: {callback.data}")
    print(f"[QR Handler] User ID: {callback.from_user.id}")
    print(f"[QR Handler] Message ID: {callback.message.message_id if callback.message else 'None'}")

    try:
        await safe_answer_callback(callback, "Loading QR code...")
        print(f"[QR Handler] Callback answered successfully")
    except Exception as e:
        print(f"[QR Handler] Error answering callback: {e}")
        import traceback
        traceback.print_exc()

    try:
        invoice_id = callback.data.split(":")[1]
        print(f"[QR Handler] Extracted invoice_id: {invoice_id}")
    except Exception as e:
        print(f"[QR Handler] Error parsing invoice_id: {e}")
        import traceback
        traceback.print_exc()
        try:
            if callback.message:
                await callback.message.answer("❌ Invalid invoice ID.")
        except:
            pass
        return

    try:
        db = get_database()
        invoices_collection = db.invoices
        print(f"[QR Handler] Database connection successful")
    except Exception as e:
        print(f"[QR Handler] Error getting database: {e}")
        import traceback
        traceback.print_exc()
        try:
            if callback.message:
                await callback.message.answer("❌ Database error. Please try again.")
        except:
            pass
        return

    print(f"[QR Handler] Looking up invoice with ID: {invoice_id}")
    invoice = await invoices_collection.find_one({"invoice_id": invoice_id})
    print(f"[QR Handler] Invoice lookup result: {'Found' if invoice else 'Not found'}")

    if not invoice:
            invoice = await invoices_collection.find_one({"invoice_id": invoice_id.upper()})
            if not invoice:
                invoice = await invoices_collection.find_one({"invoice_id": invoice_id.lower()})
            if not invoice and invoice_id.lower().startswith("inv-"):
                invoice = await invoices_collection.find_one({"invoice_id": invoice_id[4:]})
            if not invoice and not invoice_id.lower().startswith("inv-"):
                invoice = await invoices_collection.find_one({"invoice_id": f"inv-{invoice_id}"})

    if not invoice:
        print(f"[QR Handler] Invoice not found in database")
        await callback.message.answer("❌ Invoice not found.")
        return

    print(f"[QR Handler] Invoice found, extracting payment details...")
    display_invoice_id = invoice.get("invoice_id", invoice_id)

    payment_address = invoice.get("payment_address")
    payment_amount = invoice.get("payment_amount", 0)
    payment_currency = invoice.get("payment_currency", "BTC")
    payment_currency_code = invoice.get("payment_currency_code")
    payment_uri = invoice.get("payment_uri")
    payment_provider = invoice.get("payment_provider", "").lower()

    print(f"[QR Handler] Payment details extracted:")
    print(f"  - Address: {payment_address[:30] if payment_address else 'None'}...")
    print(f"  - Amount: {payment_amount}")
    print(f"  - Currency: {payment_currency}")
    print(f"  - Currency Code: {payment_currency_code}")
    print(f"  - Provider: {payment_provider}")
    print(f"  - Payment URI stored: {payment_uri[:50] if payment_uri else 'None'}...")

    if not payment_address:
        await callback.message.answer("❌ Payment address not available.")
        return

    if payment_amount < 0:
        payment_amount = abs(payment_amount)

    # Fix for old orders: If payment_amount looks like USD (>= 1.0 for most cryptos), try to extract from payment_uri
    if payment_amount and isinstance(payment_amount, (int, float)) and payment_amount >= 1.0:
        if payment_uri and ('amount=' in payment_uri or 'value=' in payment_uri):
            try:
                if 'amount=' in payment_uri:
                    uri_amount_str = payment_uri.split('amount=')[1].split('&')[0].split('#')[0]
                elif 'value=' in payment_uri:
                    uri_amount_str = payment_uri.split('value=')[1].split('&')[0].split('#')[0]
                else:
                    uri_amount_str = None

                if uri_amount_str:
                    uri_amount = float(uri_amount_str)
                    if uri_amount < payment_amount and uri_amount < 1.0:
                        print(f"[QR Handler] Fixed amount: {payment_amount} (USD?) -> {uri_amount} (crypto from URI)")
                        payment_amount = uri_amount
                    elif uri_amount == payment_amount:
                        print(f"[QR Handler] WARNING: Both stored amount and URI have wrong value: {payment_amount}")
                        invoice_total = invoice.get("total", 0)
                        discount_amount = invoice.get("discount_amount", 0)
                        final_total = invoice_total - discount_amount
                        invoice_currency = invoice.get("currency", "GBP")

                        print(f"[QR Handler] Invoice total: {final_total} {invoice_currency}, but payment_amount is {payment_amount}")

                        if final_total > 0:
                            from utils.currency_converter import convert_amount

                            usd_amount = final_total
                            if invoice_currency.upper() != "USD":
                                converted_usd = convert_amount(final_total, invoice_currency, "USD")
                                if converted_usd:
                                    usd_amount = converted_usd
                                    print(f"[QR Handler] Converted {final_total} {invoice_currency} to {usd_amount} USD")

                            if abs(payment_amount - usd_amount) < 0.1:
                                print(f"[QR Handler] payment_amount ({payment_amount}) matches USD amount ({usd_amount}), fetching from SHKeeper API...")

                                invoice_id_for_api = invoice.get("invoice_id") or invoice.get("payment_invoice_id")
                                if invoice_id_for_api:
                                    try:
                                        from services.shkeeper import get_invoice_status
                                        import asyncio

                                        loop = asyncio.get_event_loop()
                                        invoice_status = await loop.run_in_executor(
                                            None,
                                            get_invoice_status,
                                            str(invoice_id_for_api)
                                        )

                                        if invoice_status.get("success") and invoice_status.get("invoices"):
                                            shkeeper_invoice = invoice_status["invoices"][0]

                                            transactions = shkeeper_invoice.get("txs", [])
                                            if transactions:
                                                total_crypto = sum(float(tx.get("amount", 0)) for tx in transactions)
                                                if total_crypto > 0:
                                                    print(f"[QR Handler] Got crypto amount from SHKeeper transactions: {total_crypto}")
                                                    payment_amount = total_crypto

                                                    try:
                                                        await invoices_collection.update_one(
                                                            {"_id": invoice["_id"]},
                                                            {"$set": {"payment_amount": total_crypto}}
                                                        )
                                                        print(f"[QR Handler] Updated invoice with correct crypto amount from SHKeeper: {total_crypto}")
                                                    except Exception as update_error:
                                                        print(f"[QR Handler] Could not update invoice: {update_error}")
                                                else:
                                                    print(f"[QR Handler] No valid transaction amounts found in SHKeeper response")
                                            else:
                                                stored_exchange_rate = invoice.get("payment_exchange_rate")
                                                if stored_exchange_rate:
                                                    try:
                                                        exchange_rate = float(stored_exchange_rate)
                                                        if exchange_rate > 0:
                                                            calculated_crypto = usd_amount / exchange_rate
                                                            print(f"[QR Handler] Calculated from stored exchange_rate: {usd_amount} USD / {exchange_rate} = {calculated_crypto}")
                                                            payment_amount = calculated_crypto

                                                            try:
                                                                await invoices_collection.update_one(
                                                                    {"_id": invoice["_id"]},
                                                                    {"$set": {"payment_amount": calculated_crypto}}
                                                                )
                                                                print(f"[QR Handler] Updated invoice with calculated crypto amount: {calculated_crypto}")
                                                            except Exception as update_error:
                                                                print(f"[QR Handler] Could not update invoice: {update_error}")
                                                        else:
                                                            print(f"[QR Handler] Invalid exchange_rate: {exchange_rate}")
                                                    except (ValueError, TypeError) as e:
                                                        print(f"[QR Handler] Error parsing exchange_rate: {e}")
                                                else:
                                                    print(f"[QR Handler] No transactions and no stored exchange_rate, will calculate from currency converter...")
                                        else:
                                            print(f"[QR Handler] Could not get invoice from SHKeeper: {invoice_status.get('error', 'Unknown error')}")
                                    except Exception as api_error:
                                        print(f"[QR Handler] Error calling SHKeeper API: {api_error}")

                                # Fallback: Calculate using currency converter if SHKeeper API didn't work
                                if abs(payment_amount - usd_amount) < 0.1:
                                    print(f"[QR Handler] Calculating crypto amount using currency converter...")
                                    crypto_currency_code = payment_currency_code or payment_currency.upper()

                                    currency_code_map = {
                                        "DOGE": "DOGE",
                                        "DOGECOIN": "DOGE",
                                        "BITCOIN": "BTC",
                                        "LITECOIN": "LTC",
                                        "ETHEREUM": "ETH"
                                    }
                                    crypto_code = currency_code_map.get(crypto_currency_code.upper(), crypto_currency_code.upper())

                                    crypto_amount = convert_amount(usd_amount, "USD", crypto_code)
                                    if crypto_amount:
                                        print(f"[QR Handler] Recalculated: {usd_amount} USD -> {crypto_amount} {crypto_code}")
                                        payment_amount = crypto_amount

                                        try:
                                            await invoices_collection.update_one(
                                                {"_id": invoice["_id"]},
                                                {"$set": {"payment_amount": crypto_amount}}
                                            )
                                            print(f"[QR Handler] Updated invoice with correct crypto amount: {crypto_amount}")
                                        except Exception as update_error:
                                            print(f"[QR Handler] Could not update invoice: {update_error}")
                                    else:
                                        print(f"[QR Handler] Could not convert {usd_amount} USD to {crypto_code}")
            except Exception as e:
                print(f"[QR Handler] Error extracting amount from URI: {e}")

    # Format amount based on currency for display
    # Check both display name (e.g. "Litecoin") and code (e.g. "LTC")
    currency_check = (payment_currency.upper(), (payment_currency_code or "").upper())
    crypto_names = {'BTC', 'BITCOIN', 'ETH', 'ETHEREUM', 'LTC', 'LITECOIN', 'BCH', 'BITCOIN CASH', 'DOGE', 'DOGECOIN', 'XMR', 'MONERO', 'XRP', 'RIPPLE', 'AVAX', 'AVALANCHE', 'BNB'}
    if any(c in crypto_names for c in currency_check):
        formatted_amount = f"{payment_amount:.8f}".rstrip('0').rstrip('.')
    else:
        formatted_amount = f"{payment_amount:.2f}"

    # Get bot username
    bot_config = await get_bot_config()
    bot_username = ""
    if bot_config:
        bot_username = bot_config.get("telegram_username", "")
        if not bot_username:
            bot_username = bot_config.get("name", "")

    if not bot_username:
        try:
            bot_info = await callback.bot.get_me()
            bot_username = bot_info.username or ""
        except:
            pass

    print(f"[QR Debug] Bot username: {bot_username}, Invoice ID: {display_invoice_id}, Amount: {formatted_amount}")

    # Generate payment URI
    from services.shkeeper import _generate_payment_uri
    currency_code = payment_currency_code if payment_currency_code else payment_currency.upper()

    currency_map = {
        "LITECOIN": "LTC",
        "BITCOIN": "BTC",
        "ETHEREUM": "ETH",
        "ERC20 USDT": "ETH-USDT",
        "ERC20 USDC": "ETH-USDC",
        "BEP20 USDT": "BNB-USDT",
        "BEP20 USDC": "BNB-USDC",
    }
    currency_code = currency_map.get(currency_code, currency_code)

    if currency_code not in ["BTC", "LTC", "ETH", "BNB", "AVAX", "MATIC", "XRP", "TRX", "ETH-USDT", "ETH-USDC", "BNB-USDT", "BNB-USDC"]:
        if "litecoin" in currency_code.lower() or "ltc" in currency_code.lower():
            currency_code = "LTC"
        elif "bitcoin" in currency_code.lower() or "btc" in currency_code.lower():
            currency_code = "BTC"
        elif "ethereum" in currency_code.lower() or "eth" in currency_code.lower():
            currency_code = "ETH"

    payment_provider = invoice.get("payment_provider", "").lower()
    print(f"[QR Handler] Payment provider: {payment_provider}")

    if not payment_address or len(payment_address) < 10:
        await callback.message.answer("❌ Invalid payment address.")
        return

    if payment_provider == "shkeeper":
        from services.shkeeper import _validate_address_format
        print(f"[QR Handler] Validating address format - currency: {currency_code}, address starts with: {payment_address[:10]}")
        address_valid = _validate_address_format(currency_code, payment_address)
        print(f"[QR Handler] Address validation result: {address_valid}")

        if currency_code == "LTC" and payment_address.startswith("bc1q"):
            print(f"[QR Handler] DETECTED: Litecoin with Bitcoin address format - rejecting QR generation")
            error_msg = (
                "❌ *Litecoin Wallet Not Ready*\n\n"
                "**What's happening:**\n"
                "• SHKeeper returned a Bitcoin address (`bc1q...`) for Litecoin\n"
                "• Litecoin addresses should start with `L`, `M`, or `ltc1`\n"
                "• This usually happens when the Litecoin node is still syncing\n\n"
                "**Why this happens:**\n"
                "When the Litecoin node is syncing (currently at 26%), SHKeeper may return fallback addresses or report the wallet as \"not online\". Once the node finishes syncing, SHKeeper will generate proper Litecoin addresses.\n\n"
                "**What to do:**\n"
                "1. Wait for the Litecoin node to finish syncing (currently 26%)\n"
                "2. Check SHKeeper dashboard - LTC wallet should show as \"online\" when synced\n"
                "3. Once synced, create a new order - it will use proper Litecoin addresses\n"
                "4. You can still accept payments in other cryptocurrencies (BTC, ETH, etc.) while waiting\n\n"
                "**Current address:** `" + payment_address + "`\n"
                "**Status:** Litecoin node syncing - wallet not ready yet"
            )
            await callback.message.answer(error_msg, parse_mode="Markdown")
            return

        if not address_valid:
            error_msg = (
                f"❌ *Invalid Address Format*\n\n"
                f"The address format doesn't match the expected format for {currency_code}.\n\n"
                f"Address: `{payment_address}`\n\n"
                f"Please contact support or create a new order."
            )
            await callback.message.answer(error_msg, parse_mode="Markdown")
            return
    else:
        print(f"[QR Handler] Skipping strict address validation for provider: {payment_provider}")

    print(f"[QR Handler] Generating payment URI: currency_code={currency_code}, address={payment_address}, amount={payment_amount}")
    print(f"[QR Handler] Address length: {len(payment_address)}, Address starts with: {payment_address[:10]}")
    print(f"[QR Handler] Full address: {payment_address}")

    if payment_uri and isinstance(payment_uri, str) and payment_uri.startswith(("bitcoin:", "litecoin:", "ethereum:", "binancecoin:", "avalanche:", "polygon:", "ripple:", "tron:")):
        print(f"[QR Handler] Using stored payment URI from invoice")
        print(f"[QR Handler] URI: {payment_uri[:60]}...")
    else:
        print(f"[QR Handler] No stored payment URI found, generating one...")
        try:
            from services.shkeeper import _generate_payment_uri
            payment_uri = _generate_payment_uri(currency_code, payment_address, str(payment_amount))
            print(f"[QR Handler] Generated payment URI using utility: {payment_uri[:60]}...")
        except Exception as uri_error:
            print(f"[QR Handler] Error using utility function: {uri_error}")
            if currency_code == "BTC":
                payment_uri = f"bitcoin:{payment_address}?amount={payment_amount}"
            elif currency_code == "LTC":
                payment_uri = f"litecoin:{payment_address}?amount={payment_amount}"
            elif currency_code in ["ETH", "USDT", "USDC"]:
                payment_uri = f"ethereum:{payment_address}?value={payment_amount}"
            else:
                payment_uri = f"bitcoin:{payment_address}?amount={payment_amount}"
            print(f"[QR Handler] Using fallback payment URI: {payment_uri[:60]}...")

    if not payment_uri:
        await callback.message.answer("❌ Could not generate payment URI. Please try again or contact support.")
        return

    print(f"[QR Handler] Payment URI length: {len(payment_uri) if payment_uri else 0}")

    if not payment_uri or not payment_uri.startswith(("bitcoin:", "litecoin:", "ethereum:", "binancecoin:", "avalanche:", "polygon:", "ripple:", "tron:")):
        print(f"[QR Handler] WARNING: Generated URI doesn't match expected format: {payment_uri}")

    # Generate QR code with overlay
    import importlib
    import sys
    if 'utils.qr_generator' in sys.modules:
        del sys.modules['utils.qr_generator']
    if 'utils' in sys.modules:
        try:
            importlib.reload(sys.modules['utils'])
        except:
            pass
    from utils.qr_generator import generate_qr_with_overlay

    try:
        print(f"[QR Handler] Generating QR code with invoice_id: {display_invoice_id}")
        print(f"[QR Handler] Payment URI: {payment_uri[:50] if payment_uri else 'None'}...")
        print(f"[QR Handler] Bot username: {bot_username}")
        print(f"[QR Handler] Formatted amount: {formatted_amount}, Currency: {payment_currency}")

        if not payment_uri:
            raise ValueError("Payment URI is required for QR code generation")

        print(f"[QR Handler] Starting QR code generation...")
        import asyncio
        loop = asyncio.get_event_loop()

        try:
            qr_image = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    generate_qr_with_overlay,
                    payment_uri,
                    bot_username,
                    display_invoice_id,
                    payment_address,
                    formatted_amount,
                    payment_currency
                ),
                timeout=10.0
            )
            print(f"[QR Handler] QR code generation completed")
        except asyncio.TimeoutError:
            print(f"[QR Handler] QR code generation timed out after 10 seconds")
            raise Exception("QR code generation timed out. Please try again.")

        print(f"[QR Handler] Preparing to send QR code image...")
        qr_image.seek(0)
        qr_bytes = qr_image.read()
        print(f"[QR Handler] QR image bytes read: {len(qr_bytes)} bytes")

        qr_input_file = BufferedInputFile(qr_bytes, filename=f"qr_{display_invoice_id}.png")
        print(f"[QR Handler] Sending QR code image, size: {len(qr_bytes)} bytes")
        await callback.message.answer_photo(
            photo=qr_input_file,
            caption=f"QR Code for payment {display_invoice_id}\n\nScan to pay: {formatted_amount} {payment_currency}"
        )
        print(f"[QR Handler] QR code sent successfully")
    except Exception as e:
        import traceback
        error_traceback = traceback.format_exc()
        print(f"[QR Handler] ERROR generating custom QR code: {str(e)}")
        print(f"[QR Handler] Full traceback:\n{error_traceback}")

        qrcode_url = invoice.get("payment_qrcode_url")
        if qrcode_url:
            print(f"[QR Handler] Falling back to SHKeeper QR code URL: {qrcode_url}")
            try:
                await callback.message.answer_photo(
                    photo=qrcode_url,
                    caption=f"Scan to pay: {formatted_amount} {payment_currency}"
                )
                print(f"[QR Handler] SHKeeper QR code sent successfully")
            except Exception as fallback_error:
                print(f"[QR Handler] ERROR displaying fallback QR code: {str(fallback_error)}")
                error_msg = (
                    f"❌ *Error Generating QR Code*\n\n"
                    f"**Error:** {str(e)}\n\n"
                    f"**Troubleshooting:**\n"
                    f"• The payment address is still valid: `{payment_address}`\n"
                    f"• You can manually copy the address and amount to your wallet\n"
                    f"• Amount: `{formatted_amount} {payment_currency}`\n\n"
                    f"**Payment Details:**\n"
                    f"Address: `{payment_address}`\n"
                    f"Amount: `{formatted_amount} {payment_currency}`"
                )
            await callback.message.answer(error_msg, parse_mode="Markdown")
        else:
            print(f"[QR Handler] No QR code URL available")
            error_msg = (
                f"❌ *Error Generating QR Code*\n\n"
                f"**Error:** {str(e)}\n\n"
                f"**Payment Details:**\n"
                f"Address: `{payment_address}`\n"
                f"Amount: `{formatted_amount} {payment_currency}`\n\n"
                f"You can manually copy the address and amount to your wallet."
            )
            await callback.message.answer(error_msg, parse_mode="Markdown")
        import traceback
        error_traceback = traceback.format_exc()
        print(f"[QR Handler] ========== OUTER EXCEPTION CAUGHT ==========")
        print(f"[QR Handler] Full traceback:\n{error_traceback}")
        try:
            if callback and callback.message:
                await callback.message.answer(
                    f"❌ *Error*\n\n"
                    f"An unexpected error occurred: {str(e)}\n\n"
                    f"Please try again or contact support.",
                    parse_mode="Markdown"
                )
        except Exception as msg_err:
            print(f"[QR Handler] Failed to send error message: {msg_err}")


@router.callback_query(F.data.startswith("refresh_pay:"))
async def handle_refresh_payment(callback: CallbackQuery):
    """Handle refresh payment invoice"""
    await safe_answer_callback(callback, "Refreshing...")

    invoice_id = callback.data.split(":")[1]
    await show_payment_invoice(invoice_id, callback)


@router.callback_query(F.data.startswith("back_pay:"))
async def handle_back_payment(callback: CallbackQuery):
    """Handle back from payment invoice - return to Orders list (invoices are not editable once created)"""
    await safe_answer_callback(callback)

    from handlers.orders import show_user_orders
    await show_user_orders(callback)


async def process_checkout_with_address(callback: CallbackQuery, selected_currency: str, address: Optional[str]):
    """Process checkout with or without address"""
    bot_config = await get_bot_config()
    if not bot_config:
        return

    bot_id = str(bot_config["_id"])
    user_id = str(callback.from_user.id)

    db = get_database()
    carts_collection = db.carts
    orders_collection = db.orders
    products_collection = db.products

    cart = await carts_collection.find_one({
        "user_id": user_id,
        "bot_id": bot_id
    })

    if not cart or not cart.get("items"):
        await callback.message.answer("❌ Your cart is empty.")
        return

    # Clear waiting flag
    await carts_collection.update_one(
        {"_id": cart["_id"]},
        {"$unset": {"waiting_for_address": "", "checkout_currency": ""}}
    )

    # Import currency converter and encryption
    from utils.currency_converter import convert_amount
    from utils.address_encryption import encrypt_address
    from utils.secret_phrase import get_or_create_user_secret_phrase

    # Get user's secret phrase for address encryption
    user_secret_phrase = await get_or_create_user_secret_phrase(user_id, bot_id)

    # Encrypt address (required)
    encrypted_address = None
    if not address:
        await callback.message.answer("❌ Address is required to complete your order. Please provide your shipping address.")
        return

    try:
        encrypted_address = encrypt_address(address, user_secret_phrase)
        print(f"Address encrypted successfully. Encrypted length: {len(encrypted_address)}, first 40 chars: {encrypted_address[:40]}")
        print(f"Plaintext address: {address[:50]}...")
    except Exception as e:
        print(f"Error encrypting address: {e}")
        await callback.message.answer("❌ Error processing your address. Please try again.")
        return

    # Create orders - combine items with same product_id and variation_index into single orders
    from datetime import datetime
    import uuid
    from services.commission import calculate_commission, COMMISSION_RATE

    # Group items by product_id and variation_index
    grouped_items = {}
    for item in cart["items"]:
        key = (item["product_id"], item.get("variation_index"))
        if key not in grouped_items:
            grouped_items[key] = []
        grouped_items[key].append(item)

    orders_created = []
    for (product_id, variation_index), items in grouped_items.items():
        product = await find_by_id(products_collection, product_id)

        if not product:
            continue

        total_quantity = sum(item["quantity"] for item in items)
        total_item_price = sum(item["price"] * item["quantity"] for item in items)

        item_currency = product.get("currency", "GBP")
        order_total = round(total_item_price, 2)

        commission = calculate_commission(order_total)

        order_id = str(uuid.uuid4())
        order = {
            "_id": order_id,
            "botId": bot_id,
            "productId": product_id,
            "userId": user_id,
            "quantity": total_quantity,
            "variation_index": variation_index,
            "paymentStatus": "pending",
            "amount": order_total,
            "commission": commission,
            "commission_rate": COMMISSION_RATE,
            "currency": selected_currency.upper(),
            "timestamp": datetime.utcnow(),
            "status_history": [{
                "from_status": None,
                "to_status": "pending",
                "changed_by": f"buyer:{user_id}",
                "changed_at": datetime.utcnow(),
                "note": "Order placed",
            }],
        }

        if encrypted_address:
            order["encrypted_address"] = encrypted_address
            import hashlib
            order["secret_phrase_hash"] = hashlib.sha256(user_secret_phrase.encode()).hexdigest()
            print(f"Order {order_id} created with encrypted_address (length: {len(encrypted_address)}, hash: {hashlib.sha256(encrypted_address.encode()).hexdigest()[:16]})")
            print(f"Combined {len(items)} cart items into single order with quantity {total_quantity}")
        else:
            print(f"Order {order_id} created WITHOUT encrypted_address")

        await orders_collection.insert_one(order)
        orders_created.append({
            "order": order,
            "product": product
        })

    # Generate invoices for all orders using available payment provider
    from services.payment_provider import create_payment_invoice

    invoices_sent = 0

    for order_data in orders_created:
        order = order_data["order"]
        product = order_data["product"]

        bot_config = await get_bot_config()

        invoice_result = create_payment_invoice(
            amount=order["amount"],
            currency=selected_currency,
            order_id=order["_id"],
            buyer_email="",
            fiat_currency=item_currency.upper(),
            fiat_amount=order["amount"],
            bot_config=bot_config
        )

        if invoice_result["success"]:
            await orders_collection.update_one(
                {"_id": order["_id"]},
                {"$set": {"invoiceId": invoice_result.get("txn_id") or invoice_result.get("invoice_id") or invoice_result.get("address")}}
            )
            from database.addresses import record_deposit_address
            record_deposit_address(
                get_database(),
                str(order["_id"]),
                selected_currency,
                invoice_result["address"],
                invoice_result.get("provider"),
            )

            display_currency = invoice_result.get('display_name') or invoice_result.get('currency', selected_currency)
            crypto_currency = invoice_result.get('currency', selected_currency)
            crypto_amount = invoice_result.get('amount', order["amount"])

            invoice_message = f"💳 *Payment Invoice*\n\n"
            invoice_message += f"Order ID: `{order['_id']}`\n"
            invoice_message += f"Product: {product['name']}\n"
            if order.get("quantity", 1) > 1:
                invoice_message += f"Quantity: {order['quantity']}\n"

            if invoice_result.get('provider') == 'shkeeper':
                invoice_message += f"Amount: £{order['amount']} GBP\n"
                invoice_message += f"Pay: {crypto_amount} {display_currency}\n\n"
            else:
                invoice_message += f"Amount: {crypto_amount} {display_currency}\n\n"

            invoice_message += f"Send {crypto_amount} {display_currency} to:\n"
            invoice_message += f"`{invoice_result['address']}`"

            await callback.message.answer(invoice_message, parse_mode="Markdown")

            if invoice_result.get('qrcode_url'):
                try:
                    await callback.message.answer_photo(
                        photo=invoice_result['qrcode_url'],
                        caption=f"Scan to pay: {crypto_amount} {display_currency}"
                    )
                except:
                    pass
            invoices_sent += 1
        else:
            await callback.message.answer(
                f"❌ Payment error for order {order['_id']}: {invoice_result.get('error', 'Unknown error')}"
            )

    # Clear cart
    await carts_collection.update_one(
        {"user_id": user_id, "bot_id": bot_id},
        {"$set": {"items": [], "updated_at": None}}
    )

    if invoices_sent > 0:
        await callback.message.answer(
            f"✅ Checkout complete! {invoices_sent} invoice(s) generated.\n\n"
            "Please complete payment for each invoice above."
        )

    await carts_collection.update_one(
        {"_id": cart["_id"]},
        {"$set": {"items": [], "updated_at": None}}
    )


@router.message(F.text & ~F.text.startswith("/"))
async def handle_address_input(message: Message, state: FSMContext):
    """Handle address and discount code input from user during checkout"""
    bot_config = await get_bot_config()
    if not bot_config:
        return

    # Check if user is in contact mode - if so, let contact handler process it
    from handlers.contact import ContactStates
    from handlers.shop import ReviewCommentStates
    current_state = await state.get_state()
    if current_state == ContactStates.waiting_for_message:
        return
    if current_state == ReviewCommentStates.waiting_for_comment:
        return

    # Check if this is a menu button - if so, let menu handler process it
    main_buttons = bot_config.get("main_buttons", [])
    if message.text in main_buttons:
        return

    bot_id = str(bot_config["_id"])
    user_id = str(message.from_user.id)

    db = get_database()
    invoices_collection = db.invoices
    carts_collection = db.carts

    # Check if user is waiting for notes input FIRST
    invoice_for_notes = await invoices_collection.find_one(
        {
            "user_id": user_id,
            "bot_id": bot_id,
            "waiting_for_notes": True
        },
        sort=[("created_at", -1)]
    )

    if invoice_for_notes:
        print(f"[Notes Input] Found invoice waiting for notes: {invoice_for_notes.get('invoice_id')}")
        from datetime import datetime

        notes_text = message.text.strip()

        if notes_text.lower() in ["/cancel", "cancel"]:
            invoice_id = invoice_for_notes.get("invoice_id")
            await invoices_collection.update_one(
                {"invoice_id": invoice_id},
                {"$unset": {"waiting_for_notes": ""}}
            )
            await message.answer("❌ Notes cancelled.")
            await show_payment_invoice(invoice_id, message)
            return

        if len(notes_text) < 3:
            await message.answer(
                "❌ Notes must be at least 3 characters long. Please try again or send /cancel to skip."
            )
            return

        if len(notes_text) > 1000:
            await message.answer(
                "❌ Notes are too long (maximum 1000 characters). Please shorten your notes and try again."
            )
            return

        invoice_id = invoice_for_notes.get("invoice_id")
        await invoices_collection.update_one(
            {"invoice_id": invoice_id},
            {
                "$set": {
                    "notes": notes_text,
                    "notes_updated_at": datetime.utcnow()
                },
                "$unset": {"waiting_for_notes": ""}
            }
        )

        await message.answer("✅ Notes saved successfully!")
        await show_payment_invoice(invoice_id, message)
        return

    # Check if user is waiting for address input
    invoice_for_address = await invoices_collection.find_one(
        {
        "user_id": user_id,
        "bot_id": bot_id,
            "waiting_for_address": True,
            "status": "Pending Checkout"
        },
        sort=[("created_at", -1)]
    )

    if invoice_for_address:
        print(f"[Address Input] Found invoice waiting for address: {invoice_for_address.get('invoice_id')}")
        address = message.text.strip()

        address_lines = [line.strip() for line in address.split('\n') if line.strip()]

        if len(address_lines) < 3:
            await message.answer(
                "❌ *Invalid address format.*\n\n"
                "Please provide your address in the following format:\n\n"
                "Street Address\n"
                "City, State/Province\n"
                "Postal Code\n"
                "Country",
                parse_mode="Markdown"
            )
            return

        if len(address) < 20:
            await message.answer(
                "❌ *Address is too short.*\n\n"
                "Please provide a complete shipping address with at least:\n"
                "- Street Address\n"
                "- City\n"
                "- Postal Code\n"
                "- Country",
                parse_mode="Markdown"
            )
            return

        from utils.address_encryption import encrypt_address
        from utils.secret_phrase import get_or_create_user_secret_phrase
        from datetime import datetime
        user_secret_phrase = await get_or_create_user_secret_phrase(user_id, bot_id)
        encrypted_address = encrypt_address(address, user_secret_phrase)

        await invoices_collection.update_one(
            {"_id": invoice_for_address["_id"]},
            {
                "$set": {
                    "delivery_address": encrypted_address,
                    "waiting_for_address": False,
                    "updated_at": datetime.utcnow()
                }
            }
        )

        await message.answer("✅ Address saved successfully!")

        class FakeCallback:
            def __init__(self, msg):
                self.message = msg
                self.from_user = msg.from_user

            async def answer(self):
                pass

        fake_callback = FakeCallback(message)
        fake_callback.bot = message.bot
        fake_callback.data = None
        short_invoice_id = invoice_for_address.get("invoice_id", str(invoice_for_address["_id"]))
        print(f"[Address Input] Showing updated invoice {short_invoice_id} after address input")
        try:
            await show_checkout_invoice(short_invoice_id, fake_callback)
        except Exception as e:
            print(f"[Address Input] Error showing updated invoice: {e}")
            import traceback
            traceback.print_exc()
        return

    # Check if user is waiting for discount code input
    invoice = await invoices_collection.find_one(
        {
            "user_id": user_id,
            "bot_id": bot_id,
            "waiting_for_discount": True,
            "status": "Pending Checkout"
        },
        sort=[("created_at", -1)]
    )

    print(f"[Discount Input] User {user_id}, bot {bot_id}, text: '{message.text}', waiting_for_discount check: {invoice is not None}")

    discount_applied = False
    discount_amount = 0
    discount_code = None

    if not invoice:
        all_invoices = await invoices_collection.find({
            "user_id": user_id,
            "bot_id": bot_id
        }).sort("created_at", -1).to_list(length=10)
        print(f"[Discount Input] No invoice found with waiting_for_discount=True and status='Pending Checkout'. Found {len(all_invoices)} invoices for this user.")
        for inv in all_invoices:
            print(f"[Discount Input] Invoice {inv.get('invoice_id')}: waiting_for_discount={inv.get('waiting_for_discount')}, waiting_for_address={inv.get('waiting_for_address')}, status={inv.get('status')}, total={inv.get('total')}, created_at={inv.get('created_at')}")
    else:
        print(f"[Discount Input] Found invoice waiting for discount: {invoice.get('invoice_id')}, total={invoice.get('total')}, created_at={invoice.get('created_at')}")

    if invoice:
        print(f"[Discount Input] Found invoice waiting for discount: {invoice.get('invoice_id')}")
        discount_code = message.text.strip().upper()
        print(f"[Discount Input] Processing discount code: {discount_code}")

        db = get_database()
        discounts_collection = db.discounts

        from datetime import datetime
        now = datetime.utcnow()

        discount_code = message.text.strip().upper()
        discount = await discounts_collection.find_one({
            "code": discount_code,
            "active": True,
            "valid_from": {"$lte": now},
            "valid_until": {"$gte": now}
        })

        if discount:
            bot_id = invoice.get("bot_id")
            # Check product restriction: if applicable_product_ids is set, at least one cart item must match
            applicable_product_ids = discount.get("applicable_product_ids", [])
            if applicable_product_ids:
                cart_product_ids = [str(item.get("product_id", "")) for item in invoice.get("items", [])]
                applicable_str = [str(pid) for pid in applicable_product_ids]
                if not any(pid in applicable_str for pid in cart_product_ids):
                    await message.answer(f"❌ Discount code '{discount_code}' is not valid for the products in your cart.")
                    await invoices_collection.update_one(
                        {"_id": invoice["_id"]},
                        {"$set": {"waiting_for_discount": False}}
                    )
                    return
            if not discount.get("bot_ids") or len(discount.get("bot_ids", [])) == 0 or bot_id in discount.get("bot_ids", []):
                if discount.get("usage_limit") is None or discount.get("used_count", 0) < discount.get("usage_limit", 0):
                    total = invoice.get("total", 0)
                    min_order = discount.get("min_order_amount", 0)

                    print(f"[Discount] Invoice ID: {invoice.get('invoice_id')}, Invoice total: {total}, Discount type: {discount.get('discount_type')}, Discount value: {discount.get('discount_value')}")

                    if total >= min_order:
                        if discount.get("discount_type") == "percentage":
                            discount_amount = total * (discount.get("discount_value", 0) / 100)
                            print(f"[Discount] Percentage discount: {total} * ({discount.get('discount_value', 0)} / 100) = {discount_amount}")
                            max_discount = discount.get("max_discount_amount")
                            if max_discount and discount_amount > max_discount:
                                discount_amount = max_discount
                        else:
                            discount_amount = discount.get("discount_value", 0)
                            if discount_amount > total:
                                discount_amount = total

                        discount_applied = True

                        await discounts_collection.update_one(
                            {"_id": discount["_id"]},
                            {"$inc": {"used_count": 1}}
                        )
                    else:
                        await message.answer(
                            f"❌ Minimum order amount of £{min_order:.2f} required for this discount code."
                        )
                        await invoices_collection.update_one(
                            {"_id": invoice["_id"]},
                            {"$set": {"waiting_for_discount": False}}
                        )
                        return
                else:
                    await message.answer(f"❌ Discount code '{discount_code}' has reached its usage limit.")
                    await invoices_collection.update_one(
                        {"_id": invoice["_id"]},
                        {"$set": {"waiting_for_discount": False}}
                    )
                    return
            else:
                await message.answer(f"❌ Discount code '{discount_code}' is not valid for this bot.")
                await invoices_collection.update_one(
                    {"_id": invoice["_id"]},
                    {"$set": {"waiting_for_discount": False}}
                )
                return
        else:
            await message.answer(f"❌ Invalid or expired discount code '{discount_code}'. Please try again.")
            await invoices_collection.update_one(
                {"_id": invoice["_id"]},
                {"$set": {"waiting_for_discount": False}}
            )
            return

    if discount_applied:
        print(f"[Discount] Updating invoice {invoice.get('invoice_id')} with discount_code={discount_code}, discount_amount={discount_amount}, invoice_total={invoice.get('total')} (NOT changing total)")
        from datetime import datetime
        await invoices_collection.update_one(
            {"_id": invoice["_id"]},
            {
                "$set": {
                    "discount_code": discount_code,
                    "discount_amount": discount_amount,
                    "waiting_for_discount": False,
                    "updated_at": datetime.utcnow()
                }
            }
        )

        await message.answer(f"✅ Discount code '{discount_code}' applied! You saved £{discount_amount:.2f}.")

        class FakeCallback:
            def __init__(self, msg):
                self.message = msg
                self.from_user = msg.from_user
                self.bot = msg.bot
                self.data = None

            async def answer(self):
                pass

        fake_callback = FakeCallback(message)
        short_invoice_id = invoice.get("invoice_id", str(invoice["_id"]))
        print(f"[Discount] Showing updated invoice {short_invoice_id} after discount application")
        try:
            await show_checkout_invoice(short_invoice_id, fake_callback)
        except Exception as e:
            print(f"[Discount] Error showing updated invoice: {e}")
            import traceback
            traceback.print_exc()
    return

    # Check if user is waiting for address input (old cart-based system)
    cart = await carts_collection.find_one({
        "user_id": user_id,
        "bot_id": bot_id,
        "waiting_for_address": True
    })

    if cart:
        selected_currency = cart.get("checkout_currency", "BTC")
    address = message.text.strip()

    address_lines = [line.strip() for line in address.split('\n') if line.strip()]

    if len(address_lines) < 3:
        await message.answer(
            "❌ *Invalid address format.*\n\n"
            "Please provide your address in the following format:\n\n"
            "Street Address\n"
            "City, State/Province\n"
            "Postal Code\n"
            "Country",
            parse_mode="Markdown"
        )
        return

    if len(address) < 20:
        await message.answer(
            "❌ *Address is too short.*\n\n"
            "Please provide a complete shipping address with at least:\n"
            "- Street Address\n"
            "- City\n"
            "- Postal Code\n"
            "- Country",
            parse_mode="Markdown"
        )
        return

    class FakeCallback:
        def __init__(self, msg):
            self.message = msg
            self.from_user = msg.from_user
            self.data = f"checkout_currency:{selected_currency}"

        async def answer(self):
            pass

    fake_callback = FakeCallback(message)
    await process_checkout_with_address(fake_callback, selected_currency, address)
    return

    invoice = await invoices_collection.find_one({
        "user_id": user_id,
        "bot_id": bot_id,
        "waiting_for_address": True
    })

    if invoice:
        address = message.text.strip()

        address_lines = [line.strip() for line in address.split('\n') if line.strip()]

        if len(address_lines) < 3:
            await message.answer(
                "❌ *Invalid address format.*\n\n"
                "Please provide your address in the following format:\n\n"
                "Street Address\n"
                "City, State/Province\n"
                "Postal Code\n"
                "Country",
                parse_mode="Markdown"
            )
            return

        if len(address) < 20:
            await message.answer(
                "❌ *Address is too short.*\n\n"
                "Please provide a complete shipping address with at least:\n"
                "- Street Address\n"
                "- City\n"
                "- Postal Code\n"
                "- Country",
                parse_mode="Markdown"
            )
            return

        from utils.address_encryption import encrypt_address
        from utils.secret_phrase import get_or_create_user_secret_phrase
        from datetime import datetime

        user_secret_phrase = await get_or_create_user_secret_phrase(user_id, bot_id)

        try:
            encrypted_address = encrypt_address(address, user_secret_phrase)
            await invoices_collection.update_one(
                {"_id": invoice["_id"]},
                {
                    "$set": {
                        "delivery_address": encrypted_address,
                        "waiting_for_address": False,
                        "updated_at": datetime.utcnow()
                    }
                }
            )

            await message.answer("✅ Address saved successfully!")

            class FakeCallback:
                def __init__(self, msg):
                    self.message = msg
                    self.from_user = msg.from_user

                async def answer(self):
                    pass

            fake_callback = FakeCallback(message)
            short_invoice_id = invoice.get("invoice_id", str(invoice["_id"]))
            await show_checkout_invoice(short_invoice_id, fake_callback)
        except Exception as e:
            print(f"Error encrypting address: {e}")
            await message.answer("❌ Error processing your address. Please try again.")
