"""
Product detail handlers: Product detail view, variation selection, quantity selection interface.
"""
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from database.connection import get_database
from utils.bot_config import get_bot_config
from utils.callback_utils import safe_answer_callback
from utils.shop_helpers import (
    safe_split, find_by_id, safe_edit_or_send, prepare_image_for_telegram,
    get_cart_total, calculate_increment_amount,
)
from typing import Optional

router = Router()


class QuantityInputStates(StatesGroup):
    waiting_for_quantity = State()


async def show_product_quantity_interface(callback: CallbackQuery, product: dict, variation_index: Optional[int] = None, current_quantity: float = None, status_message: str = None):
    """Display product with advanced quantity selection interface.
    status_message: optional text shown at the top (e.g. '✅ Added 1.00g to cart!')"""
    bot_config = await get_bot_config()
    if not bot_config:
        await callback.message.answer("❌ Bot configuration not found.")
        return

    user_id = str(callback.from_user.id)
    bot_id = str(bot_config["_id"])
    product_id = str(product.get("_id"))

    # Handle variation_index (can be None, int, or "none" string)
    actual_variation_index = None
    if variation_index is not None and variation_index != "none":
        try:
            actual_variation_index = int(variation_index)
        except (ValueError, TypeError):
            actual_variation_index = None

    # Calculate price
    base_price = product.get('base_price') or product.get('price', 0)
    variation = None
    has_variations = bool(product.get("variations"))
    if actual_variation_index is not None:
        variations = product.get("variations", [])
        if actual_variation_index < len(variations):
            variation = variations[actual_variation_index]
            base_price += variation.get('price_modifier', 0)

    # When variations exist, quantity = number of units (1, 2, 3...) not weight increments
    if has_variations and variation:
        if current_quantity is None:
            current_quantity = 1
        increment = 1
        unit = "pcs"
    else:
        if current_quantity is None:
            current_quantity = calculate_increment_amount(product, actual_variation_index)
        unit = product.get("unit", "pcs")
        increment = calculate_increment_amount(product, variation_index)

    total_price = base_price * current_quantity

    # Get cart total
    currency = product.get("currency", "GBP")
    cart_total_value = await get_cart_total(user_id, bot_id, currency)
    currency_symbol = "£" if currency == "GBP" else currency
    cart_total_display = f"{currency_symbol}{cart_total_value}"

    # Get review count (support legacy product_id and new product_ids from order reviews)
    db = get_database()
    reviews_collection = db.reviews
    pid_str = str(product_id)
    review_count = await reviews_collection.count_documents({
        "$or": [
            {"product_id": product_id},
            {"product_id": pid_str},
            {"product_ids": pid_str},
        ]
    })

    # Format quantity display
    if unit == "pcs":
        qty_display = f"{int(current_quantity) if current_quantity == int(current_quantity) else current_quantity:.2f}"
    else:
        qty_display = f"{current_quantity:.2f}"

    # Build product text
    product_text = ""
    if status_message:
        product_text += f"{status_message}\n\n"
    product_text += f"🛍️ *{product['name']}*"
    if variation:
        product_text += f" - {variation['name']}"
    product_text += f"\n\n{product.get('description', '')}\n\n"
    product_text += f"💰 Price: {base_price} {currency}"
    if variation and variation.get('stock') is not None:
        product_text += f"\n📦 Stock: {variation['stock']}"
    elif product.get('stock') is not None:
        product_text += f"\n📦 Stock: {product['stock']}"

    # Build keyboard - compact 2-button rows
    keyboard_buttons = []

    increment_str = f"{increment:.2f}" if increment != int(increment) else str(int(increment))
    var_idx_str = str(actual_variation_index) if actual_variation_index is not None else "none"
    qty_str = f"{current_quantity:.2f}"
    price_display = f"{total_price:.2f}" if currency == "GBP" else f"{total_price:.8f}"

    # Row 1: Quantity adjustment
    qty_label = f"{qty_display}x {variation['name']}" if (has_variations and variation) else f"{qty_display} {unit}"
    keyboard_buttons.append([
        InlineKeyboardButton(text=f"➖ {increment_str}", callback_data=f"adjust_qty:{product_id}:{var_idx_str}:down:{qty_str}"),
        InlineKeyboardButton(text=f"  {qty_label}  ", callback_data=f"manual_qty:{product_id}:{var_idx_str}"),
        InlineKeyboardButton(text=f"➕ {increment_str}", callback_data=f"adjust_qty:{product_id}:{var_idx_str}:up:{qty_str}"),
    ])

    # Row 2: Add to cart
    keyboard_buttons.append([
        InlineKeyboardButton(text=f"🛒 Add to Cart [{currency_symbol}{price_display}]", callback_data=f"add_cart_qty:{product_id}:{qty_str}:{var_idx_str}")
    ])

    # Row 3: Cart + Wishlist
    row3 = [
        InlineKeyboardButton(text=f"🛒 Cart ({cart_total_display})", callback_data="view_cart"),
        InlineKeyboardButton(text="❤️ Wishlist", callback_data=f"wishlist_add:{product_id}:{var_idx_str}"),
    ]
    keyboard_buttons.append(row3)

    # Row 4: Reviews (if any)
    if review_count > 0:
        keyboard_buttons.append([
            InlineKeyboardButton(text=f"⭐ {review_count} Reviews", callback_data=f"view_reviews:{product_id}")
        ])

    # Row 5: Back + Menu
    if actual_variation_index is not None:
        back_data = f"product:{product_id}"
    else:
        subcat_id = product.get('subcategory_id') or ''
        cat_id = product.get('category_id') or ''
        if subcat_id:
            back_data = f"subcategory:{subcat_id}"
        elif cat_id:
            back_data = f"category:{cat_id}"
        else:
            back_data = "shop"
    keyboard_buttons.append([
        InlineKeyboardButton(text="⬅️ Back", callback_data=back_data),
        InlineKeyboardButton(text="📋 Menu", callback_data="menu"),
    ])

    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)

    # Send or edit message - use product image or banner
    image_url = product.get("image_url")
    # For base64 images, prepare them but prefer URL-based images for edit_media
    if image_url and image_url.startswith("data:"):
        image_file = await prepare_image_for_telegram(image_url)
        if image_file:
            # Base64 images can't be used with edit_media URL - send as new if needed
            is_fake = getattr(callback, 'id', None) is None
            if is_fake:
                await callback.message.answer_photo(
                    photo=image_file, caption=product_text,
                    parse_mode="Markdown", reply_markup=keyboard
                )
            else:
                try:
                    await callback.message.delete()
                except Exception:
                    pass
                await callback.message.answer_photo(
                    photo=image_file, caption=product_text,
                    parse_mode="Markdown", reply_markup=keyboard
                )
            return
    await safe_edit_or_send(callback, product_text, parse_mode="Markdown", reply_markup=keyboard, photo_url=image_url if image_url and image_url.startswith("http") else None)


@router.callback_query(F.data.startswith("product:"))
async def handle_product(callback: CallbackQuery):
    """Handle product selection - show variations"""
    await safe_answer_callback(callback)

    product_id = callback.data.split(":")[1]
    db = get_database()
    products_collection = db.products

    product = await find_by_id(products_collection, product_id)

    if not product:
        await callback.message.answer("❌ Product not found.")
        return

    variations = product.get("variations", [])

    if not variations:
        # No variations, show advanced quantity selection interface
        await show_product_quantity_interface(callback, product, variation_index=None)
    else:
        # Sort variations by price_modifier (ascending) so weights appear in order (0.5g, 1g, 3.5g, etc.)
        sorted_variations = sorted(enumerate(variations), key=lambda x: x[1].get('price_modifier', 0))

        # Show product details with variation options
        currency = product.get('currency', 'GBP')
        currency_symbol = '£' if currency == 'GBP' else '$' if currency == 'USD' else currency + ' '
        keyboard_buttons = []
        for idx, variation in sorted_variations:
            variation_price = product['base_price'] + variation.get('price_modifier', 0)
            stock_info = f" (Stock: {variation.get('stock', '∞')})" if variation.get('stock') is not None else ""
            keyboard_buttons.append([
                InlineKeyboardButton(
                    text=f"{variation['name']} - {currency_symbol}{variation_price:.2f}{stock_info}",
                    callback_data=f"variation:{product_id}:{idx}"
                )
            ])
        subcat_id = product.get('subcategory_id') or ''
        cat_id = product.get('category_id') or ''
        if subcat_id:
            back_data = f"subcategory:{subcat_id}"
        elif cat_id:
            back_data = f"category:{cat_id}"
        else:
            back_data = "shop"
        keyboard_buttons.append([
            InlineKeyboardButton(text="⬅️ Back", callback_data=back_data)
        ])
        keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)

        # Build product detail message
        price_range = f"{currency_symbol}{product['base_price']:.2f}"
        if variations:
            max_price = product['base_price'] + max(v.get('price_modifier', 0) for v in variations)
            if max_price != product['base_price']:
                price_range += f" - {currency_symbol}{max_price:.2f}"

        product_text = f"🛍️ *{product['name']}*\n\n"
        if product.get('description'):
            desc = product['description'][:300]
            if len(product['description']) > 300:
                desc += "..."
            product_text += f"{desc}\n\n"
        product_text += f"💰 *Price:* {price_range}\n\n"
        product_text += "Select an option:"

        image_url = product.get('image_url', '')
        await safe_edit_or_send(callback, product_text, parse_mode="Markdown", reply_markup=keyboard, photo_url=image_url if image_url and image_url.startswith("http") else None)


@router.callback_query(F.data.startswith("variation:"))
async def handle_variation(callback: CallbackQuery):
    """Handle variation selection - show quantity options"""
    await safe_answer_callback(callback)

    parts = callback.data.split(":")
    product_id = parts[1]
    variation_index = int(parts[2])

    db = get_database()
    products_collection = db.products

    # Try to find product - handle both ObjectId and string IDs
    from bson import ObjectId
    product = await find_by_id(products_collection, product_id)

    if not product:
        await callback.message.answer("❌ Product not found.")
        return

    variations = product.get("variations", [])
    if variation_index >= len(variations):
        await callback.message.answer("❌ Variation not found.")
        return

    # Show advanced quantity selection interface for this variation
    await show_product_quantity_interface(callback, product, variation_index=variation_index)


@router.callback_query(F.data.startswith("adjust_qty:"))
async def handle_quantity_adjust(callback: CallbackQuery):
    """Handle +/- quantity adjustment buttons"""
    await safe_answer_callback(callback)

    product_id = safe_split(callback.data, 1)
    variation_str = safe_split(callback.data, 2, "none")
    direction = safe_split(callback.data, 3, "up")
    try:
        current_quantity = float(safe_split(callback.data, 4, "1"))
    except (ValueError, TypeError):
        current_quantity = 1.0

    db = get_database()
    products_collection = db.products

    # Get product
    from bson import ObjectId
    product = await find_by_id(products_collection, product_id)

    if not product:
        await callback.message.answer("❌ Product not found.")
        return

    # Parse variation_index
    variation_index = None
    if variation_str != "none":
        try:
            variation_index = int(variation_str)
        except (ValueError, TypeError):
            variation_index = None

    # Calculate increment — when variations exist, step by 1 unit
    has_variations = bool(product.get("variations"))
    if has_variations and variation_index is not None:
        increment = 1
    else:
        increment = calculate_increment_amount(product, variation_index)

    # Adjust quantity
    if direction == "up":
        new_quantity = current_quantity + increment
    else:  # down
        new_quantity = max(increment, current_quantity - increment)

    # Round based on unit type
    unit = product.get("unit", "pcs")
    if unit == "pcs":
        # Round to nearest 0.01 for pieces (allows 1.00, 2.00, etc.)
        new_quantity = round(new_quantity, 2)
    else:
        # Keep 2 decimal places for weight units
        new_quantity = round(new_quantity, 2)

    # Re-display product with new quantity
    await show_product_quantity_interface(callback, product, variation_index=variation_index, current_quantity=new_quantity)


@router.callback_query(F.data.startswith("manual_qty:"))
async def handle_manual_quantity_input(callback: CallbackQuery, state: FSMContext):
    """Start manual quantity input"""
    await safe_answer_callback(callback)

    parts = callback.data.split(":")
    product_id = parts[1]
    variation_str = parts[2]

    variation_index = None
    if variation_str != "none":
        try:
            variation_index = int(variation_str)
        except (ValueError, TypeError):
            variation_index = None

    # Store in state
    await state.update_data(
        product_id=product_id,
        variation_index=variation_index
    )
    await state.set_state(QuantityInputStates.waiting_for_quantity)

    await callback.message.answer(
        "📝 Please enter the quantity you want:\n\n"
        "Example: 3.5 or 2\n\n"
        "Type /cancel to go back."
    )


@router.message(QuantityInputStates.waiting_for_quantity)
async def handle_quantity_text_input(message: Message, state: FSMContext):
    """Process manual quantity entry"""
    # Check for cancel
    if message.text and message.text.lower() in ["/cancel", "cancel"]:
        await state.clear()
        await message.answer("❌ Quantity input cancelled.")
        return

    try:
        quantity = float(message.text.strip())
        if quantity <= 0:
            await message.answer("❌ Quantity must be greater than 0. Please try again or type /cancel.")
            return

        # Get product info from state
        data = await state.get_data()
        product_id = data.get("product_id")
        variation_index = data.get("variation_index")

        if not product_id:
            await state.clear()
            await message.answer("❌ Error: Product information not found. Please try again.")
            return

        # Get product
        db = get_database()
        products_collection = db.products

        product = await find_by_id(products_collection, product_id)

        if not product:
            await state.clear()
            await message.answer("❌ Product not found.")
            return

        # Clear state
        await state.clear()

        # Round based on unit
        unit = product.get("unit", "pcs")
        if unit == "pcs":
            quantity = round(quantity, 2)
        else:
            quantity = round(quantity, 2)

        # Create fake callback to reuse show_product_quantity_interface
        class FakeCallback:
            def __init__(self, msg):
                self.message = msg
                self.from_user = msg.from_user
                self.id = None

            async def answer(self, text: str = None, show_alert: bool = False):
                pass

        fake_callback = FakeCallback(message)
        await show_product_quantity_interface(fake_callback, product, variation_index=variation_index, current_quantity=quantity)

    except ValueError:
        await message.answer("❌ Please enter a valid number (e.g., 3.5 or 2). Type /cancel to go back.")
