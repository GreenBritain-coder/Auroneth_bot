"""
Cart handlers: Add to cart, view cart, clear cart, update quantities.
"""
from aiogram import Router, F
from aiogram.types import CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from database.connection import get_database
from utils.bot_config import get_bot_config
from utils.callback_utils import safe_answer_callback
from utils.shop_helpers import safe_split, find_by_id, safe_edit_or_send

router = Router()


@router.callback_query(F.data.startswith("add_cart_qty:"))
async def handle_add_to_cart_qty(callback: CallbackQuery):
    """Add product to cart with specific quantity"""
    await safe_answer_callback(callback)

    product_id = safe_split(callback.data, 1)
    try:
        quantity = float(safe_split(callback.data, 2, "1"))
    except (ValueError, TypeError):
        quantity = 1.0
    variation_str = safe_split(callback.data, 3, "none")

    variation_index = None
    if variation_str != "none":
        try:
            variation_index = int(variation_str)
        except (ValueError, TypeError):
            variation_index = None

    bot_config = await get_bot_config()
    if not bot_config:
        return

    bot_id = str(bot_config["_id"])
    user_id = str(callback.from_user.id)

    db = get_database()
    products_collection = db.products
    carts_collection = db.carts

    # Get product
    from bson import ObjectId
    product = await find_by_id(products_collection, product_id)

    if not product:
        await callback.message.answer("❌ Product not found.")
        return

    # Calculate price
    base_price = product.get('base_price') or product.get('price', 0)
    unit = product.get("unit", "pcs")

    if variation_index is not None:
        variations = product.get("variations", [])
        if variation_index < len(variations):
            variation = variations[variation_index]
            price = base_price + variation.get('price_modifier', 0)
            # Check stock
            stock = variation.get('stock')
            if stock is not None and quantity > stock:
                await callback.message.answer(f"❌ Only {stock} items available in stock.")
                return
        else:
            price = base_price
    else:
        price = base_price
        stock = product.get('stock')
        if stock is not None and quantity > stock:
            await callback.message.answer(f"❌ Only {stock} items available in stock.")
            return

    # Get or create cart
    cart = await carts_collection.find_one({
        "user_id": user_id,
        "bot_id": bot_id
    })

    if not cart:
        cart = {
            "user_id": user_id,
            "bot_id": bot_id,
            "items": [],
            "updated_at": None
        }
        result = await carts_collection.insert_one(cart)
        cart["_id"] = result.inserted_id

    # Add item to cart
    from datetime import datetime
    cart_item = {
        "product_id": product_id,
        "variation_index": variation_index,
        "quantity": quantity,
        "price": price,
        "unit": unit
    }

    # Update cart
    await carts_collection.update_one(
        {"_id": cart["_id"]},
        {
            "$push": {"items": cart_item},
            "$set": {"updated_at": datetime.utcnow()}
        }
    )

    # Build confirmation message
    unit_display = f"{int(quantity) if quantity == int(quantity) else quantity:.2f} {unit}" if unit == "pcs" else f"{quantity:.2f} {unit}"
    product_name = product['name']
    if variation_index is not None:
        variations = product.get("variations", [])
        if variation_index < len(variations):
            product_name += f" - {variations[variation_index]['name']}"

    added_msg = f"✅ Added {unit_display} {product_name} to cart!"

    # Re-render the product view in-place with confirmation and updated cart total
    from handlers.product import show_product_quantity_interface
    await show_product_quantity_interface(callback, product, variation_index=variation_index, current_quantity=quantity, status_message=added_msg)


@router.callback_query(F.data.startswith("add_cart:"))
async def handle_add_to_cart(callback: CallbackQuery):
    """Add product to cart"""
    await safe_answer_callback(callback)

    parts = callback.data.split(":")
    product_id = parts[1]
    quantity = int(parts[2])
    variation_index = int(parts[3]) if len(parts) > 3 else None

    bot_config = await get_bot_config()
    if not bot_config:
        return

    bot_id = str(bot_config["_id"])
    user_id = str(callback.from_user.id)

    db = get_database()
    products_collection = db.products
    carts_collection = db.carts

    product = await find_by_id(products_collection, product_id)

    # If still not found, try searching by string representation
    # ObjectId + string lookups above should be sufficient; no full-collection scan

    if not product:
        await callback.message.answer("❌ Product not found.")
        return

    # Calculate price - handle both base_price and price fields
    base_price = product.get('base_price') or product.get('price', 0)

    if variation_index is not None:
        variations = product.get("variations", [])
        if variation_index < len(variations):
            variation = variations[variation_index]
            price = base_price + variation.get('price_modifier', 0)
            # Check stock
            stock = variation.get('stock')
            if stock is not None and quantity > stock:
                await callback.message.answer(f"❌ Only {stock} items available in stock.")
                return
        else:
            price = base_price
    else:
        price = base_price

    # Get or create cart
    cart = await carts_collection.find_one({
        "user_id": user_id,
        "bot_id": bot_id
    })

    if not cart:
        cart = {
            "user_id": user_id,
            "bot_id": bot_id,
            "items": [],
            "updated_at": None
        }
        result = await carts_collection.insert_one(cart)
        cart["_id"] = result.inserted_id

    # Add item to cart
    from datetime import datetime
    unit = product.get("unit", "pcs")
    cart_item = {
        "product_id": product_id,
        "variation_index": variation_index,
        "quantity": quantity,
        "price": price,
        "unit": unit
    }

    # Update cart
    await carts_collection.update_one(
        {"_id": cart["_id"]},
        {
            "$push": {"items": cart_item},
            "$set": {"updated_at": datetime.utcnow()}
        }
    )

    # Send confirmation with button to view cart
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="🛒 View Cart", callback_data="view_cart"),
        InlineKeyboardButton(text="🛍️ Continue Shopping", callback_data="shop")
    ]])

    await callback.message.answer(
        f"✅ Added {quantity}x {product['name']} to cart!",
        reply_markup=keyboard
    )


@router.callback_query(F.data == "view_cart")
async def handle_view_cart(callback: CallbackQuery):
    """Display cart contents"""
    await safe_answer_callback(callback)

    bot_config = await get_bot_config()
    if not bot_config:
        return

    bot_id = str(bot_config["_id"])
    user_id = str(callback.from_user.id)

    db = get_database()
    carts_collection = db.carts
    products_collection = db.products

    cart = await carts_collection.find_one({
        "user_id": user_id,
        "bot_id": bot_id
    })

    if not cart or not cart.get("items"):
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🛍️ Continue Shopping", callback_data="shop")],
            [InlineKeyboardButton(text="📋 Back to Menu", callback_data="menu")]
        ])
        await safe_edit_or_send(callback, "🛒 Your cart is empty.", reply_markup=keyboard)
        return

    # Build cart message
    cart_text = "🛒 *Your Cart*\n\n"
    total = 0
    currency = None

    for item in cart["items"]:
        from bson import ObjectId
        try:
            product = await products_collection.find_one({"_id": ObjectId(item["product_id"])})
        except:
            product = await products_collection.find_one({"_id": item["product_id"]})
        if not product:
            continue

        currency = product["currency"]
        item_name = product["name"]
        if item.get("variation_index") is not None:
            variations = product.get("variations", [])
            if item["variation_index"] < len(variations):
                item_name += f" - {variations[item['variation_index']]['name']}"

        item_total = item["price"] * item["quantity"]
        total += item_total

        # Get unit from item or product
        unit = item.get("unit") or product.get("unit", "pcs")
        quantity = item["quantity"]

        # Format quantity with unit
        if unit == "pcs":
            qty_display = f"{int(quantity) if quantity == int(quantity) else quantity:.2f} {unit}"
        else:
            qty_display = f"{quantity:.2f} {unit}"

        cart_text += f"{qty_display} {item_name}\n"
        cart_text += f"   {item['price']} {currency} × {quantity} = {item_total} {currency}\n\n"

    # Format total based on currency
    if currency == "GBP":
        total_display = f"{total:.2f}"
    elif currency in ["BTC", "LTC", "ETH", "USDT"]:
        total_display = f"{total:.8f}"
    else:
        total_display = f"{total:.2f}"

    cart_text += f"💰 *Total: {total_display} {currency if currency else ''}*"

    # Cart action buttons
    keyboard_buttons = [
        [InlineKeyboardButton(text="💳 Checkout", callback_data="checkout"),
         InlineKeyboardButton(text="🗑️ Clear Cart", callback_data="clear_cart")],
        [InlineKeyboardButton(text="🛍️ Continue Shopping", callback_data="shop"),
         InlineKeyboardButton(text="📋 Menu", callback_data="menu")]
    ]
    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)

    await safe_edit_or_send(callback, cart_text, parse_mode="Markdown", reply_markup=keyboard)


@router.callback_query(F.data == "clear_cart")
async def handle_clear_cart(callback: CallbackQuery):
    """Clear cart"""
    await safe_answer_callback(callback)

    bot_config = await get_bot_config()
    if not bot_config:
        return

    bot_id = str(bot_config["_id"])
    user_id = str(callback.from_user.id)

    db = get_database()
    carts_collection = db.carts

    await carts_collection.update_one(
        {"user_id": user_id, "bot_id": bot_id},
        {"$set": {"items": [], "updated_at": None}}
    )

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🛍️ Continue Shopping", callback_data="shop")],
        [InlineKeyboardButton(text="📋 Back to Menu", callback_data="menu")]
    ])
    await safe_edit_or_send(callback, "🗑️ Cart cleared!", reply_markup=keyboard)
