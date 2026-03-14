"""
Order management handlers - view user orders
"""
from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from typing import Union
from database.connection import get_database
from utils.bot_config import get_bot_config
from utils.callback_utils import safe_answer_callback
from datetime import datetime, timedelta

router = Router()


@router.message(Command("orders"))
async def handle_orders_command(message: Message):
    """Handle /orders command"""
    await show_user_orders(message)


@router.message(F.text == "Orders")
async def handle_orders_button(message: Message):
    """Handle Orders button from main menu"""
    await show_user_orders(message)


async def show_user_orders(message_or_callback: Union[Message, CallbackQuery]):
    """Display user's orders - accepts either Message or CallbackQuery"""
    bot_config = await get_bot_config()
    if not bot_config:
        if isinstance(message_or_callback, CallbackQuery):
            await message_or_callback.message.answer("❌ Bot configuration not found.")
        else:
            await message_or_callback.answer("❌ Bot configuration not found.")
        return
    
    bot_id = str(bot_config["_id"])
    
    # Extract user and message from either Message or CallbackQuery
    if isinstance(message_or_callback, CallbackQuery):
        user = message_or_callback.from_user
        message = message_or_callback.message
        bot = message_or_callback.bot
    else:
        user = message_or_callback.from_user
        message = message_or_callback
        bot = message.bot
    
    # Get user ID
    if not user:
        if isinstance(message_or_callback, CallbackQuery):
            await message_or_callback.message.answer("❌ Could not identify user.")
        else:
            await message_or_callback.answer("❌ Could not identify user.")
        return
    
    user_id = str(user.id)
    
    # Helper: when from callback, edit message in place (stay in same menu); otherwise send new message
    async def send_message(text, **kwargs):
        if isinstance(message_or_callback, CallbackQuery):
            try:
                await message.edit_text(text, **kwargs)
            except Exception:
                await message.answer(text, **kwargs)
        else:
            await message.answer(text, **kwargs)
    
    # Also log the full user object for debugging
    print(f"[Orders Debug] User info - ID: {user_id}, Username: {user.username}, Full name: {user.full_name}")
    
    db = get_database()
    orders_collection = db.orders
    products_collection = db.products
    
    # Debug: Log what we're searching for
    print(f"[Orders Debug] Searching for orders - userId: {user_id}, botId: {bot_id}")
    
    # Get user's orders - handle both string and ObjectId botId formats
    from bson import ObjectId
    
    # Try multiple approaches to find orders
    orders = []
    
    # First try: exact string match
    try:
        orders = await orders_collection.find({
            "userId": user_id,
            "botId": bot_id
        }).sort("timestamp", -1).to_list(length=20)
        print(f"[Orders Debug] First try (string match): Found {len(orders)} orders")
    except Exception as e:
        print(f"[Orders Debug] First try error: {e}")
    
    # Second try: if botId is 24 chars, try as ObjectId
    if not orders and len(bot_id) == 24:
        try:
            orders = await orders_collection.find({
                "userId": user_id,
                "botId": ObjectId(bot_id)
            }).sort("timestamp", -1).to_list(length=20)
            print(f"[Orders Debug] Second try (ObjectId match): Found {len(orders)} orders")
        except Exception as e:
            print(f"[Orders Debug] Second try error: {e}")
    
    # Third try: fetch all orders for user and filter by botId string comparison
    if not orders:
        try:
            all_user_orders = await orders_collection.find({
                "userId": user_id
            }).sort("timestamp", -1).to_list(length=100)
            print(f"[Orders Debug] Third try: Found {len(all_user_orders)} total orders for user")
            # Filter by botId (handle both string and ObjectId)
            orders = [
                o for o in all_user_orders 
                if str(o.get("botId", "")) == bot_id
            ][:20]
            print(f"[Orders Debug] After filtering by botId: Found {len(orders)} orders")
            # Debug: Show what botIds we found
            if all_user_orders:
                for o in all_user_orders[:3]:
                    print(f"[Orders Debug] Order {o.get('_id')} has botId: {o.get('botId')} (type: {type(o.get('botId'))})")
        except Exception as e:
            print(f"[Orders Debug] Error fetching orders: {e}")
    
    if not orders:
        print(f"[Orders Debug] No orders found. userId: {user_id}, botId: {bot_id}")
        # Check if there are ANY orders for this user (for debugging)
        try:
            any_orders = await orders_collection.find({"userId": user_id}).to_list(length=5)
            if any_orders:
                print(f"[Orders Debug] Found {len(any_orders)} orders for user {user_id}, but botId doesn't match")
                for o in any_orders:
                    print(f"  Order {o.get('_id')}: botId={o.get('botId')} (expected {bot_id})")
            else:
                print(f"[Orders Debug] No orders found for user {user_id} at all")
        except Exception as e:
            print(f"[Orders Debug] Error checking for orders: {e}")
        menu_keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="📋 Back to Menu", callback_data="menu")]
        ])
        await send_message("📦 You don't have any orders yet.", reply_markup=menu_keyboard)
        return
    
    # Helper function to get display order ID
    async def get_display_order_id(order):
        """Get the order ID to display - prefer numeric invoice_id, fallback to _id"""
        order_id = str(order.get('_id', ''))
        
        # Check if it's already numeric (new format)
        if order_id.isdigit():
            return order_id
        
        # If it's a UUID, try to find related invoice
        if '-' in order_id and len(order_id) == 36:  # UUID format
            invoices_collection = db.invoices
            # Try to find invoice by order_id (for old orders that might have invoiceId)
            invoice = await invoices_collection.find_one({"invoice_id": order_id})
            if invoice:
                return invoice.get("invoice_id", order_id)
            
            # Try to find by order's invoiceId field
            invoice_id_field = order.get("invoiceId")
            if invoice_id_field:
                invoice = await invoices_collection.find_one({"payment_invoice_id": invoice_id_field})
                if invoice:
                    return invoice.get("invoice_id", order_id)
        
        # Fallback: return the order_id as-is (will be UUID for old orders)
        return order_id
    
    # Build message with all orders
    orders_text = "📦 *Your Orders*\n\n"
    
    invoices_collection = db.invoices
    
    # Group orders by status for counts (need to check expiry for pending)
    paid_orders = [o for o in orders if o.get("paymentStatus") == "paid"]
    pending_orders = [o for o in orders if o.get("paymentStatus") == "pending"]
    failed_orders = [o for o in orders if o.get("paymentStatus") in ["failed", "cancelled"]]
    # Count expired among pending (payment_deadline passed)
    expired_count = 0
    for o in pending_orders:
        inv = await invoices_collection.find_one({"invoice_id": str(o.get("_id", ""))})
        if not inv:
            inv = await invoices_collection.find_one({"_id": str(o.get("_id", ""))})
        if inv and inv.get("payment_deadline"):
            try:
                pd = inv["payment_deadline"]
                if isinstance(pd, str):
                    from dateutil import parser
                    pd = parser.parse(pd)
                if pd and datetime.utcnow() > pd:
                    expired_count += 1
            except Exception:
                pass
    
    orders_text += f"⏳ *Pending Payments:* {len(pending_orders)}\n"
    orders_text += f"✅ *Completed:* {len(paid_orders)}\n"
    if expired_count > 0 or failed_orders:
        orders_text += f"🚫 *Expired/Cancelled:* {expired_count + len(failed_orders)}\n"
    orders_text += f"*Total Orders:* {len(orders)}\n\n"
    
    # Create inline buttons for each order
    keyboard_buttons = []
    
    for order in orders[:10]:  # Show first 10 orders
        product = await get_product_info(products_collection, order.get("productId"))
        product_name = product.get("name", "Unknown Product") if product else "Unknown Product"
        currency = product.get("currency", "") if product else ""
        
        order_date = order.get("timestamp", datetime.utcnow())
        if isinstance(order_date, datetime):
            date_str = order_date.strftime("%Y-%m-%d %H:%M")
        else:
            date_str = str(order_date)
        
        display_order_id = await get_display_order_id(order)
        payment_status = order.get("paymentStatus", "pending")
        
        # Check if order has notes (via invoice)
        has_notes = False
        is_expired = False
        order_id_str = str(order.get('_id', ''))
        invoice = await invoices_collection.find_one({"invoice_id": order_id_str})
        if not invoice:
            # Try finding invoice by _id
            invoice = await invoices_collection.find_one({"_id": order_id_str})
        if invoice and invoice.get("notes"):
            has_notes = True
        # Check if pending order is expired (payment_deadline passed)
        if invoice and payment_status == "pending":
            payment_deadline = invoice.get("payment_deadline")
            if payment_deadline:
                try:
                    if isinstance(payment_deadline, str):
                        try:
                            from dateutil import parser
                            payment_deadline = parser.parse(payment_deadline)
                        except Exception:
                            try:
                                payment_deadline = datetime.strptime(payment_deadline, "%Y-%m-%d %H:%M:%S")
                            except Exception:
                                payment_deadline = None
                    if payment_deadline and datetime.utcnow() > payment_deadline:
                        is_expired = True
                except Exception:
                    pass
        
        # Determine emoji based on status
        if payment_status == "paid":
            emoji = "✅"  # Tick for completed
        elif payment_status in ["failed", "cancelled"]:
            emoji = "🚫"  # No entry for cancelled/failed
        elif is_expired:
            emoji = "🚫"  # No entry for expired
        elif payment_status == "pending":
            emoji = "⏰"  # Clock for pending payment
        else:
            emoji = "✏️"  # Pencil for editable orders
        
        # Add order to text
        orders_text += f"{emoji} Order Number {display_order_id}\n"
        orders_text += f"• {product_name}\n"
        orders_text += f"  Amount: {order.get('amount', 0)} {currency}\n"
        orders_text += f"  Date: {date_str}\n"
        if has_notes:
            orders_text += f"  📝 Has notes\n"
        orders_text += "\n"
        
        # Create inline button for this order
        # Use the order_id directly (not display_order_id) to ensure we can find the invoice
        button_text = f"{emoji} Order {display_order_id}"
        # Use the actual order _id for callback data
        actual_order_id = str(order.get('_id', ''))
        keyboard_buttons.append([
            InlineKeyboardButton(text=button_text, callback_data=f"order:{actual_order_id}")
        ])
    
    if len(orders) > 10:
        orders_text += f"*...and {len(orders) - 10} more orders*"
    
    # Add back to menu button at bottom
    keyboard_buttons.append([
        InlineKeyboardButton(text="⬅️ Back to Menu", callback_data="menu")
    ])
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)
    
    await send_message(orders_text, parse_mode="Markdown", reply_markup=keyboard)


async def get_product_info(products_collection, product_id):
    """Get product information by ID"""
    if not product_id:
        return None
    
    from bson import ObjectId
    product = None
    
    # Try as ObjectId
    try:
        if len(str(product_id)) == 24:
            product = await products_collection.find_one({"_id": ObjectId(product_id)})
    except:
        pass
    
    # Try as string
    if not product:
        product = await products_collection.find_one({"_id": product_id})
    
    # Try by string representation
    if not product:
        all_products = await products_collection.find({}).to_list(length=100)
        for p in all_products:
            if str(p.get('_id')) == str(product_id):
                product = p
                break
    
    return product


@router.callback_query(F.data.startswith("order:"))
async def handle_order_detail(callback: CallbackQuery):
    """Handle order detail button click - show payment invoice"""
    await safe_answer_callback(callback)
    
    order_id = callback.data.split(":")[1]
    print(f"[Order Detail] Looking up order_id: {order_id}")
    
    # Normalize order_id (remove "inv-" prefix if present)
    original_order_id = order_id
    if order_id.lower().startswith("inv-"):
        order_id = order_id[4:]  # Remove "inv-" prefix
        print(f"[Order Detail] Removed 'inv-' prefix, new order_id: {order_id}")
    
    # Keep original case for numeric IDs, but try both cases for alphanumeric
    order_id_variants = [order_id, order_id.upper(), order_id.lower(), original_order_id]
    print(f"[Order Detail] Trying variants: {order_id_variants}")
    
    db = get_database()
    invoices_collection = db.invoices
    orders_collection = db.orders
    
    invoice = None
    found_variant = None
    
    # Try all order_id variants to find the invoice
    for variant in order_id_variants:
        # Try to find invoice by invoice_id
        invoice = await invoices_collection.find_one({"invoice_id": variant})
        if invoice:
            found_variant = variant
            print(f"[Order Detail] Found invoice by invoice_id: {variant}")
            break
        
        # Try to find invoice by _id (some old invoices might use _id instead of invoice_id)
        invoice = await invoices_collection.find_one({"_id": variant})
        if invoice:
            found_variant = variant
            print(f"[Order Detail] Found invoice by _id: {variant}")
            break
        
        # Try to find order by _id, then find associated invoice
        order = await orders_collection.find_one({"_id": variant})
        if order:
            print(f"[Order Detail] Found order with _id: {variant}")
            print(f"[Order Detail] Order details: botId={order.get('botId')}, userId={order.get('userId')}, paymentStatus={order.get('paymentStatus')}")
            
            # CRITICAL: The order _id should match the invoice invoice_id
            # Try direct lookup first (most common case)
            invoice = await invoices_collection.find_one({"invoice_id": str(order.get("_id"))})
            if invoice:
                found_variant = str(order.get("_id"))
                print(f"[Order Detail] ✓ Found invoice by invoice_id matching order _id")
                break
            
            # Try with numeric conversion if order_id is numeric
            if variant.isdigit():
                invoice = await invoices_collection.find_one({"invoice_id": int(variant)})
                if invoice:
                    found_variant = variant
                    print(f"[Order Detail] ✓ Found invoice by numeric invoice_id")
                    break
            
            # Try to find invoice by _id matching order _id (for old format where invoice _id = order _id)
            invoice = await invoices_collection.find_one({"_id": str(order.get("_id"))})
            if invoice:
                found_variant = invoice.get("invoice_id", variant)
                print(f"[Order Detail] ✓ Found invoice by _id matching order _id")
                break
            
            # Try to find invoice by user_id and bot_id to find related invoices (for orphaned orders)
            user_id = str(order.get("userId"))
            bot_id = str(order.get("botId"))
            print(f"[Order Detail] Searching for related invoices: user_id={user_id}, bot_id={bot_id}")
            
            # Get all invoices for this user/bot around the same time
            order_timestamp = order.get("timestamp")
            related_invoices = []
            if order_timestamp:
                # Search invoices within 1 hour of order timestamp
                from datetime import timedelta
                if isinstance(order_timestamp, str):
                    from dateutil import parser
                    try:
                        order_timestamp = parser.parse(order_timestamp)
                    except:
                        order_timestamp = None
                
                if order_timestamp:
                    time_window_start = order_timestamp - timedelta(hours=1)
                    time_window_end = order_timestamp + timedelta(hours=1)
                    related_invoices = await invoices_collection.find({
                        "user_id": user_id,
                        "bot_id": bot_id,
                        "created_at": {"$gte": time_window_start, "$lte": time_window_end}
                    }).sort("created_at", -1).limit(5).to_list(length=5)
            
            # If no time-based search, just get recent invoices
            if not related_invoices:
                related_invoices = await invoices_collection.find({
                    "user_id": user_id,
                    "bot_id": bot_id
                }).sort("created_at", -1).limit(10).to_list(length=10)
            
            print(f"[Order Detail] Found {len(related_invoices)} related invoices to check")
            
            # Check if any invoice matches this order by product or items
            if related_invoices:
                order_product_id = str(order.get("productId", ""))
                order_amount = order.get("amount", 0)
                
                for inv in related_invoices:
                    inv_items = inv.get("items", [])
                    inv_total = inv.get("total", 0)
                    
                    # Check if items match
                    for inv_item in inv_items:
                        if str(inv_item.get("product_id", "")) == order_product_id:
                            # Product matches - this is likely the correct invoice
                            invoice = inv
                            found_variant = inv.get("invoice_id", str(inv.get("_id")))
                            print(f"[Order Detail] ✓ Found matching invoice by product match: {found_variant}")
                            break
                    
                    if invoice:
                        break
                    
                    # Also check by total amount (if product_id doesn't match)
                    if abs(float(inv_total) - float(order_amount)) < 0.01:  # Within 0.01 tolerance
                        invoice = inv
                        found_variant = inv.get("invoice_id", str(inv.get("_id")))
                        print(f"[Order Detail] ✓ Found matching invoice by amount match: {found_variant}")
                        break
            
            # Try to find invoice by payment_invoice_id from order
            if not invoice:
                invoice_id_field = order.get("invoiceId")
                if invoice_id_field:
                    invoice = await invoices_collection.find_one({"payment_invoice_id": invoice_id_field})
                    if invoice:
                        found_variant = invoice_id_field
                        print(f"[Order Detail] ✓ Found invoice by payment_invoice_id: {invoice_id_field}")
                        break
            
            # Last resort: try invoice_id one more time
            if not invoice:
                invoice = await invoices_collection.find_one({"invoice_id": variant})
                if invoice:
                    found_variant = variant
                    print(f"[Order Detail] ✓ Found invoice by invoice_id (final try): {variant}")
                    break
    
    if invoice:
        invoice_id = invoice.get("invoice_id", found_variant or order_id)
        print(f"[Order Detail] Using invoice_id: {invoice_id}, status: {invoice.get('status')}, has payment_address: {bool(invoice.get('payment_address'))}")
        
        # If we found the invoice but it's not directly linked to the order, link them now
        # This fixes the mismatch where order._id != invoice.invoice_id
        order_found = await orders_collection.find_one({"_id": order_id})
        if order_found and order_found.get("_id") != invoice_id:
            # Update the invoice to link back to this order (if invoice_id field exists on order)
            # Or we could update the order, but for now just ensure the relationship is clear
            print(f"[Order Detail] Linking order {order_found.get('_id')} to invoice {invoice_id}")
            # Note: We're not changing the invoice_id, but ensuring the order can be found via the invoice
        
        # Check if invoice has payment details or is already paid
        # Show payment invoice if: has payment address AND (status is Pending Payment, Paid, or Completed)
        invoice_status = invoice.get("status", "").lower()
        has_payment_address = bool(invoice.get("payment_address"))
        is_paid = invoice_status in ["paid", "completed"]
        
        # Also check order payment status
        order_found = await orders_collection.find_one({"_id": invoice_id})
        if order_found and order_found.get("paymentStatus", "").lower() == "paid":
            is_paid = True
        
        # Check if order is expired or cancelled (not paid + deadline passed or failed status)
        is_expired_or_cancelled = False
        if not is_paid:
            payment_status = order_found.get("paymentStatus", "pending") if order_found else "pending"
            if payment_status.lower() in ["failed", "cancelled"]:
                is_expired_or_cancelled = True
            else:
                payment_deadline = invoice.get("payment_deadline")
                if payment_deadline:
                    if isinstance(payment_deadline, str):
                        try:
                            from dateutil import parser
                            payment_deadline = parser.parse(payment_deadline)
                        except Exception:
                            try:
                                payment_deadline = datetime.strptime(payment_deadline, "%Y-%m-%d %H:%M:%S")
                            except Exception:
                                payment_deadline = None
                    if payment_deadline and datetime.utcnow() > payment_deadline:
                        is_expired_or_cancelled = True
        
        # Show cancelled format for expired/cancelled orders
        if is_expired_or_cancelled:
            from handlers.shop import show_cancelled_order_invoice
            await show_cancelled_order_invoice(invoice_id, callback)
        elif has_payment_address or is_paid:
            # Import and call show_payment_invoice from shop handler
            from handlers.shop import show_payment_invoice
            await show_payment_invoice(invoice_id, callback)
        else:
            # Invoice exists but payment not set up yet - show checkout invoice
            from handlers.shop import show_checkout_invoice
            await show_checkout_invoice(invoice_id, callback)
    else:
        print(f"[Order Detail] Invoice not found for any variant of order_id: {order_id_variants}")
        # Check if this might be an old order that was deleted or from a previous test
        order_exists = await orders_collection.find_one({"_id": {"$in": order_id_variants}})
        if order_exists:
            # Order exists but no invoice - might be an old format or deleted invoice
            error_msg = (
                f"❌ Invoice not found for order {order_id}.\n\n"
                f"*Possible reasons:*\n"
                f"• Invoice was deleted\n"
                f"• This is an old order from a previous test\n"
                f"• Invoice ID format changed\n\n"
                f"*Order Status:* {order_exists.get('paymentStatus', 'unknown')}\n"
                f"*Order Date:* {order_exists.get('timestamp', 'unknown')}"
            )
        else:
            # Order doesn't exist either - completely invalid ID
            error_msg = (
                f"❌ Invoice not found for order {order_id}.\n\n"
                f"This order ID doesn't exist in the system. "
                f"It may have been deleted or is from an old test session."
            )
        await callback.message.answer(error_msg, parse_mode="Markdown")

