"""
Shop navigation handlers: Categories → Subcategories → Products → Variations → Cart
"""
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton, BufferedInputFile
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from database.connection import get_database
from utils.bot_config import get_bot_config
from utils.callback_utils import safe_answer_callback
from typing import Optional

router = Router()


class QuantityInputStates(StatesGroup):
    waiting_for_quantity = State()


class ReviewCommentStates(StatesGroup):
    waiting_for_comment = State()


async def prepare_image_for_telegram(image_url: str) -> Optional[BufferedInputFile]:
    """
    Prepare image for Telegram sending.
    Handles base64 data URLs by converting them to BufferedInputFile.
    Returns BufferedInputFile if image_url is base64, None if it's a regular URL.
    """
    if not image_url or not image_url.strip():
        return None
    
    image_url = image_url.strip()
    
    # Check if it's a base64 data URL
    if image_url.startswith("data:image/"):
        try:
            # Extract base64 data (format: data:image/png;base64,<data>)
            header, base64_data = image_url.split(",", 1)
            
            # Get image format from header
            if "png" in header:
                format_type = "PNG"
                ext = "png"
            elif "jpeg" in header or "jpg" in header:
                format_type = "JPEG"
                ext = "jpg"
            elif "gif" in header:
                format_type = "GIF"
                ext = "gif"
            elif "webp" in header:
                format_type = "WEBP"
                ext = "webp"
            else:
                format_type = "PNG"
                ext = "png"
            
            # Decode base64
            import base64
            image_bytes = base64.b64decode(base64_data)
            
            # Check size - Telegram has a 10MB limit for photos
            # If larger than 9MB, try to compress/resize
            if len(image_bytes) > 9 * 1024 * 1024:  # 9MB
                print(f"[Image Handler] Image too large ({len(image_bytes)} bytes), attempting to compress...")
                try:
                    try:
                        from PIL import Image
                    except ImportError:
                        print(f"[Image Handler] PIL (Pillow) not installed, cannot compress image. Install with: pip install Pillow")
                        # If image is too large and we can't compress, skip it
                        if len(image_bytes) > 10 * 1024 * 1024:  # 10MB limit
                            print(f"[Image Handler] Image exceeds 10MB limit and compression unavailable, skipping image")
                            return None
                        # If under 10MB but over 9MB, try to send anyway
                    
                    import io
                    
                    # Open image
                    img = Image.open(io.BytesIO(image_bytes))
                    
                    # Resize if too large (max 2048px on longest side)
                    max_size = 2048
                    if img.width > max_size or img.height > max_size:
                        img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
                        print(f"[Image Handler] Resized image to {img.width}x{img.height}")
                    
                    # Compress JPEG/PNG
                    output = io.BytesIO()
                    if format_type == "JPEG":
                        img = img.convert("RGB")  # Ensure RGB for JPEG
                        img.save(output, format="JPEG", quality=85, optimize=True)
                    else:
                        img.save(output, format=format_type, optimize=True)
                    
                    output.seek(0)
                    image_bytes = output.read()
                    print(f"[Image Handler] Compressed image to {len(image_bytes)} bytes")
                    
                    if len(image_bytes) > 10 * 1024 * 1024:  # Still too large
                        print(f"[Image Handler] Warning: Image still too large after compression ({len(image_bytes)} bytes)")
                        return None
                except Exception as e:
                    print(f"[Image Handler] Error compressing image: {e}")
                    import traceback
                    traceback.print_exc()
                    # If compression fails and image is too large, skip it
                    if len(image_bytes) > 10 * 1024 * 1024:  # 10MB limit
                        return None
                    # Otherwise, try to send original
            
            # Create BufferedInputFile for Telegram
            return BufferedInputFile(image_bytes, filename=f"product.{ext}")
        except Exception as e:
            print(f"[Image Handler] Error processing base64 image: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    # Not a base64 URL, return None to use regular URL
    return None


async def get_cart_total(user_id: str, bot_id: str, currency: str = "GBP") -> str:
    """Get current cart total for user"""
    db = get_database()
    carts_collection = db.carts
    
    cart = await carts_collection.find_one({
        "user_id": user_id,
        "bot_id": bot_id
    })
    
    if not cart or not cart.get("items"):
        return f"0.00"
    
    total = sum(item.get("price", 0) * item.get("quantity", 0) for item in cart.get("items", []))
    
    # Format based on currency
    if currency in ["BTC", "LTC", "ETH", "USDT"]:
        return f"{total:.8f}"
    else:
        return f"{total:.2f}"


async def get_cart_total_display(user_id: str, bot_id: str) -> str:
    """Get formatted cart total for display (e.g. £19.00 or £0.00)"""
    db = get_database()
    carts_collection = db.carts
    products_collection = db.products
    
    cart = await carts_collection.find_one({
        "user_id": user_id,
        "bot_id": bot_id
    })
    
    if not cart or not cart.get("items"):
        return "£0.00"
    
    total = 0
    currency = "GBP"
    for item in cart.get("items", []):
        from bson import ObjectId
        try:
            product = await products_collection.find_one({"_id": ObjectId(item["product_id"])})
        except Exception:
            product = await products_collection.find_one({"_id": item["product_id"]})
        if product:
            currency = product.get("currency", "GBP")
        total += item.get("price", 0) * item.get("quantity", 0)
    
    symbol = "£" if currency == "GBP" else ("€" if currency == "EUR" else currency)
    if currency in ["BTC", "LTC", "ETH", "USDT"]:
        return f"{symbol}{total:.8f}"
    return f"{symbol}{total:.2f}"


def calculate_increment_amount(product: dict, variation=None) -> float:
    """Calculate increment amount for quantity adjustment"""
    # If product has increment_amount field, use it
    if product.get("increment_amount"):
        return float(product["increment_amount"])
    
    unit = product.get("unit", "pcs")
    base_price = product.get("base_price") or product.get("price", 0)
    
    # If variation, add price modifier
    if variation is not None:
        variation_obj = product.get("variations", [])
        if isinstance(variation, int) and variation < len(variation_obj):
            base_price += variation_obj[variation].get("price_modifier", 0)
        elif isinstance(variation, dict):
            base_price += variation.get("price_modifier", 0)
    
    # Calculate based on unit type
    if unit == "pcs":
        # For pieces (vapes, devices), increment = 1.0
        return 1.0
    elif unit == "gr":
        # For grams, base on price
        if base_price < 10:
            return 0.5
        elif base_price < 50:
            return 1.0
        elif base_price < 100:
            return 2.5
        else:
            return 5.0
    elif unit == "kg":
        # For kilograms, smaller increments
        if base_price < 10:
            return 0.1
        elif base_price < 50:
            return 0.5
        else:
            return 1.0
    else:
        # Default to 1.0 for other units
        return 1.0


async def show_product_quantity_interface(callback: CallbackQuery, product: dict, variation_index: Optional[int] = None, current_quantity: float = None):
    """Display product with advanced quantity selection interface"""
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
    
    # Get current quantity or default
    if current_quantity is None:
        current_quantity = calculate_increment_amount(product, actual_variation_index)
    
    # Calculate price
    base_price = product.get('base_price') or product.get('price', 0)
    variation = None
    if actual_variation_index is not None:
        variations = product.get("variations", [])
        if actual_variation_index < len(variations):
            variation = variations[actual_variation_index]
            base_price += variation.get('price_modifier', 0)
    
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
    product_text = f"🛍️ *{product['name']}*"
    if variation:
        product_text += f" - {variation['name']}"
    product_text += f"\n\n{product.get('description', '')}\n\n"
    product_text += f"💰 Price: {base_price} {currency}"
    if variation and variation.get('stock') is not None:
        product_text += f"\n📦 Stock: {variation['stock']}"
    elif product.get('stock') is not None:
        product_text += f"\n📦 Stock: {product['stock']}"
    
    # Build keyboard
    keyboard_buttons = []
    
    # Quantity adjustment row
    increment_str = f"{increment:.2f}" if increment != int(increment) else str(int(increment))
    var_idx_str = str(actual_variation_index) if actual_variation_index is not None else "none"
    keyboard_buttons.append([
        InlineKeyboardButton(text=f"▲ +{increment_str}", callback_data=f"adjust_qty:{product_id}:{var_idx_str}:up:{current_quantity}"),
        InlineKeyboardButton(text=f"🛒 {cart_total_display}", callback_data="view_cart"),
        InlineKeyboardButton(text=f"▼ -{increment_str}", callback_data=f"adjust_qty:{product_id}:{var_idx_str}:down:{current_quantity}")
    ])
    
    # Enter quantity manually button
    keyboard_buttons.append([
        InlineKeyboardButton(text="Enter Quantity Manually", callback_data=f"manual_qty:{product_id}:{var_idx_str}")
    ])
    
    # Add to cart button
    price_display = f"{total_price:.2f}" if currency == "GBP" else f"{total_price:.8f}"
    keyboard_buttons.append([
        InlineKeyboardButton(text=f"Add to Cart : {qty_display} {unit} [{currency_symbol}{price_display}]", callback_data=f"add_cart_qty:{product_id}:{current_quantity}:{var_idx_str}")
    ])
    
    # Wishlist and reviews row
    wishlist_buttons = []
    wishlist_buttons.append(InlineKeyboardButton(text="Add to Wishlist", callback_data=f"wishlist_add:{product_id}:{var_idx_str}"))
    if review_count > 0:
        wishlist_buttons.append(InlineKeyboardButton(text=f"{review_count} reviews for this product", callback_data=f"view_reviews:{product_id}"))
    keyboard_buttons.append(wishlist_buttons)
    
    # Back buttons - go to product list (subcategory or category)
    if actual_variation_index is not None:
        keyboard_buttons.append([
            InlineKeyboardButton(text="⬅️ Back", callback_data=f"product:{product_id}")
        ])
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
            InlineKeyboardButton(text="⬅️ Back", callback_data=back_data)
        ])
    keyboard_buttons.append([
        InlineKeyboardButton(text="📋 Back to Menu", callback_data="menu")
    ])
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)
    
    # Send or edit message
    is_fake = getattr(callback, 'id', None) is None
    image_url = product.get("image_url")
    
    try:
        # Check if image is base64 and prepare it
        image_file = await prepare_image_for_telegram(image_url) if image_url else None
        
        if is_fake:
            # For fake callbacks (from menu buttons), always send new message
            if image_file:
                await callback.message.answer_photo(
                    photo=image_file,
                    caption=product_text,
                    parse_mode="Markdown",
                    reply_markup=keyboard
                )
            elif image_url and image_url.strip():
                await callback.message.answer_photo(
                    photo=image_url,
                    caption=product_text,
                    parse_mode="Markdown",
                    reply_markup=keyboard
                )
            else:
                await callback.message.answer(product_text, parse_mode="Markdown", reply_markup=keyboard)
        else:
            # For real callbacks, try to edit
            try:
                if image_file or (image_url and image_url.strip()):
                    # If message has a photo, edit caption; otherwise can't edit to add photo
                    try:
                        await callback.message.edit_caption(
                            caption=product_text,
                            parse_mode="Markdown",
                            reply_markup=keyboard
                        )
                    except:
                        # If edit_caption fails, send new message
                        if image_file:
                            await callback.message.answer_photo(
                                photo=image_file,
                                caption=product_text,
                                parse_mode="Markdown",
                                reply_markup=keyboard
                            )
                        elif image_url and image_url.strip():
                            await callback.message.answer_photo(
                                photo=image_url,
                                caption=product_text,
                                parse_mode="Markdown",
                                reply_markup=keyboard
                            )
                        else:
                            await callback.message.answer(product_text, parse_mode="Markdown", reply_markup=keyboard)
                else:
                    await callback.message.edit_text(product_text, parse_mode="Markdown", reply_markup=keyboard)
            except:
                # If edit fails, send new message
                if image_file:
                    await callback.message.answer_photo(
                        photo=image_file,
                        caption=product_text,
                        parse_mode="Markdown",
                        reply_markup=keyboard
                    )
                elif image_url and image_url.strip():
                    await callback.message.answer_photo(
                        photo=image_url,
                        caption=product_text,
                        parse_mode="Markdown",
                        reply_markup=keyboard
                    )
                else:
                    await callback.message.answer(product_text, parse_mode="Markdown", reply_markup=keyboard)
    except Exception as e:
        print(f"Error displaying product: {e}")
        import traceback
        traceback.print_exc()
        await callback.message.answer(product_text, parse_mode="Markdown", reply_markup=keyboard)


@router.callback_query(F.data == "shop")
async def handle_shop_start(callback: CallbackQuery):
    """Handle shop button - show categories"""
    await safe_answer_callback(callback)
    
    bot_config = await get_bot_config()
    if not bot_config:
        # Check if we can edit (real callback) or need to send new message (fake callback)
        is_fake = getattr(callback, 'id', None) is None
        if is_fake:
            await callback.message.answer("❌ Bot configuration not found.")
        else:
            try:
                await callback.message.edit_text("❌ Bot configuration not found.")
            except:
                await callback.message.answer("❌ Bot configuration not found.")
        return
    
    # Check for custom shop message - include in edit to stay in same message
    messages = bot_config.get("messages", {})
    custom_message = messages.get("shop", "")
    shop_header = "📦 *Select a Category*"
    if custom_message and custom_message.strip():
        shop_header = custom_message.strip() + "\n\n" + shop_header
    
    bot_id = str(bot_config["_id"])
    db = get_database()
    categories_collection = db.categories
    
    # Get categories for this bot
    categories = await categories_collection.find({
        "bot_ids": bot_id
    }).sort("order", 1).to_list(length=50)
    
    # Create category buttons
    keyboard_buttons = []
    for category in categories:
        keyboard_buttons.append([
            InlineKeyboardButton(
                text=category["name"],
                callback_data=f"category:{category['_id']}"
            )
        ])
    
    # Add cart and back to menu buttons
    keyboard_buttons.append([
        InlineKeyboardButton(text="🛒 View Cart", callback_data="view_cart")
    ])
    keyboard_buttons.append([
        InlineKeyboardButton(text="📋 Back to Menu", callback_data="menu")
    ])
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)
    
    # Check if this is a fake callback (from menu button) or real callback (from inline button)
    is_fake = getattr(callback, 'id', None) is None
    
    no_categories_text = "📦 No categories available at the moment."
    if not categories:
        if is_fake:
            await callback.message.answer(no_categories_text)
        else:
            try:
                await callback.message.edit_text(no_categories_text)
            except Exception:
                await callback.message.answer(no_categories_text)
        return
    
    if is_fake:
        await callback.message.answer(shop_header, parse_mode="Markdown", reply_markup=keyboard)
    else:
        try:
            await callback.message.edit_text(shop_header, parse_mode="Markdown", reply_markup=keyboard)
        except Exception as e:
            print(f"[Shop] Edit failed: {e}")
            await callback.message.answer(shop_header, parse_mode="Markdown", reply_markup=keyboard)


@router.callback_query(F.data.startswith("category:"))
async def handle_category(callback: CallbackQuery):
    """Handle category selection - show subcategories"""
    await safe_answer_callback(callback)
    
    category_id = callback.data.split(":")[1]
    bot_config = await get_bot_config()
    if not bot_config:
        return
    
    bot_id = str(bot_config["_id"])
    db = get_database()
    subcategories_collection = db.subcategories
    
    from bson import ObjectId

    # Build subcategory query - support both string and ObjectId for category_id and bot_ids
    def _match_category_id(cid):
        try:
            if cid and len(str(cid)) == 24:
                return {"$in": [cid, ObjectId(cid)]}
            return cid
        except Exception:
            return cid

    def _match_bot_ids(bid):
        try:
            if bid and len(str(bid)) == 24:
                return {"$in": [bid, ObjectId(bid)]}
            return bid
        except Exception:
            return bid

    subcategories = await subcategories_collection.find({
        "category_id": _match_category_id(category_id),
        "bot_ids": _match_bot_ids(bot_id)
    }).sort("order", 1).to_list(length=50)

    # If no subcategories, show products directly under this category
    # Products can have category_id (direct) or subcategory_id (subcategory under this category)
    if not subcategories:
        products_collection = db.products
        # Get subcategory IDs for this category (without bot filter) for fallback
        all_subcats = await subcategories_collection.find({
            "category_id": _match_category_id(category_id)
        }).to_list(length=100)
        subcat_ids = []
        for s in all_subcats:
            sid = s["_id"]
            subcat_ids.append(sid)
            subcat_ids.append(str(sid))

        or_conditions = [{"category_id": _match_category_id(category_id)}]
        if subcat_ids:
            or_conditions.append({"subcategory_id": {"$in": subcat_ids}})

        products = await products_collection.find({
            "$and": [
                {"bot_ids": _match_bot_ids(bot_id)},
                {"$or": or_conditions}
            ]
        }).to_list(length=50)
        if products:
            try:
                category = await db.categories.find_one({"_id": ObjectId(category_id)})
            except Exception:
                category = await db.categories.find_one({"_id": category_id})
            category_name = category.get("name", "Products") if category else "Products"
            # Show product list as buttons first (user selects one to see details)
            product_buttons = [[InlineKeyboardButton(text=p["name"], callback_data=f"product:{p['_id']}")] for p in products]
            product_buttons.append([InlineKeyboardButton(text="⬅️ Back to Categories", callback_data="shop")])
            product_buttons.append([InlineKeyboardButton(text="📋 Back to Menu", callback_data="menu")])
            list_keyboard = InlineKeyboardMarkup(inline_keyboard=product_buttons)
            try:
                await callback.message.edit_text(
                    f"🛍️ *Products in {category_name}*\n\nSelect a product:",
                    parse_mode="Markdown",
                    reply_markup=list_keyboard
                )
            except Exception:
                await callback.message.answer(
                    f"🛍️ *Products in {category_name}*\n\nSelect a product:",
                    parse_mode="Markdown",
                    reply_markup=list_keyboard
                )
            return
        back_keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="⬅️ Back to Categories", callback_data="shop")],
            [InlineKeyboardButton(text="⬅️ Back to Menu", callback_data="menu")]
        ])
        try:
            await callback.message.edit_text(
                "📁 No subcategories or products available in this category.",
                reply_markup=back_keyboard
            )
        except Exception as e:
            print(f"Edit failed: {e}")
            try:
                await callback.message.delete()
            except:
                pass
            await callback.message.answer(
                "📁 No subcategories or products available in this category.",
                reply_markup=back_keyboard
            )
        return
    
    # Create subcategory buttons
    keyboard_buttons = []
    for subcategory in subcategories:
        keyboard_buttons.append([
            InlineKeyboardButton(
                text=subcategory["name"],
                callback_data=f"subcategory:{subcategory['_id']}"
            )
        ])
    
    # Add back buttons
    keyboard_buttons.append([
        InlineKeyboardButton(text="⬅️ Back to Categories", callback_data="shop")
    ])
    keyboard_buttons.append([
        InlineKeyboardButton(text="📋 Back to Menu", callback_data="menu")
    ])
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)
    try:
        # Try to edit the message - this should work for inline button callbacks
        await callback.message.edit_text("📁 *Select a Subcategory*", parse_mode="Markdown", reply_markup=keyboard)
    except Exception as e:
        # If edit fails, delete the old message and send a new one
        error_msg = str(e)
        print(f"Edit failed: {error_msg}")
        try:
            # Delete the message that couldn't be edited
            await callback.message.delete()
        except Exception as del_err:
            print(f"Delete also failed: {del_err}")
        # Send new message
        await callback.message.answer("📁 *Select a Subcategory*", parse_mode="Markdown", reply_markup=keyboard)


@router.callback_query(F.data.startswith("subcategory:"))
async def handle_subcategory(callback: CallbackQuery):
    """Handle subcategory selection - show products"""
    await safe_answer_callback(callback)
    
    subcategory_id = callback.data.split(":")[1]
    bot_config = await get_bot_config()
    if not bot_config:
        return
    
    bot_id = str(bot_config["_id"])
    db = get_database()
    products_collection = db.products

    from bson import ObjectId

    # Support both string and ObjectId for subcategory_id and bot_ids
    def _match_subcat_id(sid):
        try:
            if sid and len(str(sid)) == 24:
                return {"$in": [sid, ObjectId(sid)]}
            return sid
        except Exception:
            return sid

    def _match_bot_ids(bid):
        try:
            if bid and len(str(bid)) == 24:
                return {"$in": [bid, ObjectId(bid)]}
            return bid
        except Exception:
            return bid

    # Get products for this subcategory and bot (match subcategory_id, support type flexibility)
    products = await products_collection.find({
        "$and": [
            {"subcategory_id": _match_subcat_id(subcategory_id)},
            {"bot_ids": _match_bot_ids(bot_id)}
        ]
    }).to_list(length=50)
    
    if not products:
        try:
            await callback.message.edit_text("🛍️ No products available in this subcategory.")
        except Exception as e:
            print(f"Edit failed: {e}")
            try:
                await callback.message.delete()
            except:
                pass
            await callback.message.answer("🛍️ No products available in this subcategory.")
        return
    
    # First, update the navigation message to show we're viewing products
    subcategory_collection = db.subcategories
    try:
        subcategory = await subcategory_collection.find_one({"_id": ObjectId(subcategory_id)})
    except Exception:
        subcategory = await subcategory_collection.find_one({"_id": subcategory_id})
    subcategory_name = subcategory.get("name", "Products") if subcategory else "Products"
    
    # Show product list as buttons first (user selects one to see details)
    product_buttons = [[InlineKeyboardButton(text=p["name"], callback_data=f"product:{p['_id']}")] for p in products]
    parent_category_id = (subcategory or {}).get("category_id", "")
    back_callback = f"category:{parent_category_id}" if parent_category_id else "shop"
    back_text = "⬅️ Back to Subcategories" if parent_category_id else "⬅️ Back to Categories"
    product_buttons.append([InlineKeyboardButton(text=back_text, callback_data=back_callback)])
    product_buttons.append([InlineKeyboardButton(text="📋 Back to Menu", callback_data="menu")])
    list_keyboard = InlineKeyboardMarkup(inline_keyboard=product_buttons)
    try:
        await callback.message.edit_text(
            f"🛍️ *Products in {subcategory_name}*\n\nSelect a product:",
            parse_mode="Markdown",
            reply_markup=list_keyboard
        )
    except Exception:
        await callback.message.answer(
            f"🛍️ *Products in {subcategory_name}*\n\nSelect a product:",
            parse_mode="Markdown",
            reply_markup=list_keyboard
        )


@router.callback_query(F.data.startswith("product:"))
async def handle_product(callback: CallbackQuery):
    """Handle product selection - show variations"""
    await safe_answer_callback(callback)
    
    product_id = callback.data.split(":")[1]
    db = get_database()
    products_collection = db.products
    
    # Try to find product - handle both ObjectId and string IDs
    from bson import ObjectId
    product = None
    
    # First try as ObjectId (if it's a valid ObjectId string)
    try:
        if len(product_id) == 24:  # ObjectId hex string length
            product = await products_collection.find_one({"_id": ObjectId(product_id)})
    except Exception as e:
        pass
    
    # If not found, try as string
    if not product:
        product = await products_collection.find_one({"_id": product_id})
    
    # If still not found, try searching by string representation
    if not product:
        all_products = await products_collection.find({}).to_list(length=100)
        for p in all_products:
            if str(p.get('_id')) == product_id:
                product = p
                break
    
    if not product:
        await callback.message.answer("❌ Product not found.")
        return
    
    variations = product.get("variations", [])
    
    if not variations:
        # No variations, show advanced quantity selection interface
        await show_product_quantity_interface(callback, product, variation_index=None)
    else:
        # Show variations
        keyboard_buttons = []
        for idx, variation in enumerate(variations):
            variation_price = product['base_price'] + variation.get('price_modifier', 0)
            stock_info = f" (Stock: {variation.get('stock', '∞')})" if variation.get('stock') is not None else ""
        keyboard_buttons.append([
            InlineKeyboardButton(
                text=f"{variation['name']} - {variation_price} {product['currency']}{stock_info}",
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
        
        try:
            await callback.message.edit_text("📦 *Select Variation*", parse_mode="Markdown", reply_markup=keyboard)
        except:
            await callback.message.answer("📦 *Select Variation*", parse_mode="Markdown", reply_markup=keyboard)


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
    product = None
    
    # First try as ObjectId
    try:
        if len(product_id) == 24:
            product = await products_collection.find_one({"_id": ObjectId(product_id)})
    except Exception:
        pass
    
    # If not found, try as string
    if not product:
        product = await products_collection.find_one({"_id": product_id})
    
    # If still not found, try searching by string representation
    if not product:
        all_products = await products_collection.find({}).to_list(length=100)
        for p in all_products:
            if str(p.get('_id')) == product_id:
                product = p
                break
    
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
    
    parts = callback.data.split(":")
    product_id = parts[1]
    variation_str = parts[2]  # Can be "none" or a number
    direction = parts[3]  # "up" or "down"
    current_quantity = float(parts[4])
    
    db = get_database()
    products_collection = db.products
    
    # Get product
    from bson import ObjectId
    product = None
    try:
        if len(product_id) == 24:
            product = await products_collection.find_one({"_id": ObjectId(product_id)})
    except Exception:
        pass
    
    if not product:
        product = await products_collection.find_one({"_id": product_id})
    
    if not product:
        all_products = await products_collection.find({}).to_list(length=100)
        for p in all_products:
            if str(p.get('_id')) == product_id:
                product = p
                break
    
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
    
    # Calculate increment
    increment = calculate_increment_amount(product, variation_index)
    
    # Adjust quantity
    if direction == "up":
        new_quantity = current_quantity + increment
    else:  # down
        new_quantity = max(0, current_quantity - increment)
    
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
        
        from bson import ObjectId
        product = None
        try:
            if len(product_id) == 24:
                product = await products_collection.find_one({"_id": ObjectId(product_id)})
        except Exception:
            pass
        
        if not product:
            product = await products_collection.find_one({"_id": product_id})
        
        if not product:
            all_products = await products_collection.find({}).to_list(length=100)
            for p in all_products:
                if str(p.get('_id')) == product_id:
                    product = p
                    break
        
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


@router.callback_query(F.data.startswith("add_cart_qty:"))
async def handle_add_to_cart_qty(callback: CallbackQuery):
    """Add product to cart with specific quantity"""
    await safe_answer_callback(callback)
    
    parts = callback.data.split(":")
    product_id = parts[1]
    quantity = float(parts[2])
    variation_str = parts[3] if len(parts) > 3 else "none"
    
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
    product = None
    try:
        if len(product_id) == 24:
            product = await products_collection.find_one({"_id": ObjectId(product_id)})
    except Exception:
        pass
    
    if not product:
        product = await products_collection.find_one({"_id": product_id})
    
    if not product:
        all_products = await products_collection.find({}).to_list(length=100)
        for p in all_products:
            if str(p.get('_id')) == product_id:
                product = p
                break
    
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
    
    # Send confirmation with button to view cart
    unit_display = f"{int(quantity) if quantity == int(quantity) else quantity:.2f} {unit}" if unit == "pcs" else f"{quantity:.2f} {unit}"
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="🛒 View Cart", callback_data="view_cart"),
        InlineKeyboardButton(text="🛍️ Continue Shopping", callback_data="shop")
    ]])
    
    product_name = product['name']
    if variation_index is not None:
        variations = product.get("variations", [])
        if variation_index < len(variations):
            product_name += f" - {variations[variation_index]['name']}"
    
    await callback.message.answer(
        f"✅ Added {unit_display} {product_name} to cart!",
        reply_markup=keyboard
    )


@router.callback_query(F.data.startswith("wishlist_add:"))
async def handle_add_to_wishlist(callback: CallbackQuery):
    """Add product to wishlist"""
    await safe_answer_callback(callback, "Added to wishlist!")
    
    parts = callback.data.split(":")
    product_id = parts[1]
    variation_str = parts[2] if len(parts) > 2 else "none"
    
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
    wishlists_collection = db.wishlists
    
    # Get or create wishlist
    wishlist = await wishlists_collection.find_one({
        "user_id": user_id,
        "bot_id": bot_id
    })
    
    from datetime import datetime
    wishlist_item = {
        "product_id": product_id,
        "variation_index": variation_index,
        "added_at": datetime.utcnow()
    }
    
    if wishlist:
        # Check if item already exists
        existing_items = wishlist.get("items", [])
        item_exists = any(
            item.get("product_id") == product_id and item.get("variation_index") == variation_index
            for item in existing_items
        )
        
        if not item_exists:
            await wishlists_collection.update_one(
                {"_id": wishlist["_id"]},
                {"$push": {"items": wishlist_item}}
            )
            await callback.message.answer("✅ Added to wishlist!")
        else:
            await callback.message.answer("ℹ️ Item is already in your wishlist.")
    else:
        # Create new wishlist
        new_wishlist = {
            "user_id": user_id,
            "bot_id": bot_id,
            "items": [wishlist_item]
        }
        await wishlists_collection.insert_one(new_wishlist)
        await callback.message.answer("✅ Added to wishlist!")


@router.callback_query(F.data == "view_wishlist")
async def handle_view_wishlist(callback: CallbackQuery):
    """Display user's wishlist"""
    await safe_answer_callback(callback)
    
    bot_config = await get_bot_config()
    if not bot_config:
        return
    
    bot_id = str(bot_config["_id"])
    user_id = str(callback.from_user.id)
    
    db = get_database()
    wishlists_collection = db.wishlists
    products_collection = db.products
    
    wishlist = await wishlists_collection.find_one({
        "user_id": user_id,
        "bot_id": bot_id
    })
    
    if not wishlist or not wishlist.get("items"):
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="📋 Back to Menu", callback_data="menu")]
        ])
        try:
            await callback.message.edit_text("📝 Your wishlist is empty.", reply_markup=keyboard)
        except Exception:
            await callback.message.answer("📝 Your wishlist is empty.", reply_markup=keyboard)
        return
    
    wishlist_text = "📝 *Your Wishlist*\n\n"
    keyboard_buttons = []
    
    from bson import ObjectId
    for idx, item in enumerate(wishlist.get("items", [])):
        product_id = item.get("product_id")
        variation_index = item.get("variation_index")
        
        # Get product
        product = None
        try:
            if len(product_id) == 24:
                product = await products_collection.find_one({"_id": ObjectId(product_id)})
        except Exception:
            pass
        
        if not product:
            product = await products_collection.find_one({"_id": product_id})
        
        if not product:
            all_products = await products_collection.find({}).to_list(length=100)
            for p in all_products:
                if str(p.get('_id')) == product_id:
                    product = p
                    break
        
        if product:
            item_name = product["name"]
            if variation_index is not None:
                variations = product.get("variations", [])
                if variation_index < len(variations):
                    item_name += f" - {variations[variation_index]['name']}"
            
            base_price = product.get('base_price') or product.get('price', 0)
            if variation_index is not None:
                variations = product.get("variations", [])
                if variation_index < len(variations):
                    base_price += variations[variation_index].get('price_modifier', 0)
            
            wishlist_text += f"• {item_name}\n"
            wishlist_text += f"  {base_price} {product.get('currency', 'GBP')}\n\n"
            
            keyboard_buttons.append([
                InlineKeyboardButton(
                    text=f"View {item_name[:20]}...",
                    callback_data=f"product:{product_id}"
                ),
                InlineKeyboardButton(
                    text="❌ Remove",
                    callback_data=f"wishlist_remove:{str(wishlist['_id'])}:{idx}"
                )
            ])
    
    keyboard_buttons.append([
        InlineKeyboardButton(text="🛍️ Continue Shopping", callback_data="shop"),
        InlineKeyboardButton(text="📋 Back to Menu", callback_data="menu")
    ])
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)
    
    try:
        await callback.message.edit_text(wishlist_text, parse_mode="Markdown", reply_markup=keyboard)
    except:
        await callback.message.answer(wishlist_text, parse_mode="Markdown", reply_markup=keyboard)


@router.callback_query(F.data.startswith("wishlist_remove:"))
async def handle_remove_from_wishlist(callback: CallbackQuery):
    """Remove item from wishlist"""
    await safe_answer_callback(callback)
    
    parts = callback.data.split(":")
    wishlist_id = parts[1]
    item_index = int(parts[2])
    
    db = get_database()
    wishlists_collection = db.wishlists
    
    wishlist = await wishlists_collection.find_one({"_id": wishlist_id})
    if not wishlist:
        await callback.message.answer("❌ Wishlist item not found.")
        return
    
    items = wishlist.get("items", [])
    if item_index < len(items):
        items.pop(item_index)
        
        if items:
            await wishlists_collection.update_one(
                {"_id": wishlist_id},
                {"$set": {"items": items}}
            )
        else:
            await wishlists_collection.delete_one({"_id": wishlist_id})
        
        await callback.message.answer("✅ Removed from wishlist!")
        # Refresh wishlist view
        await handle_view_wishlist(callback)
    else:
        await callback.message.answer("❌ Item not found in wishlist.")


def _reviews_query_for_product(product_id: str, star_filter: Optional[int] = None):
    """Build MongoDB query for reviews of a product (legacy product_id or product_ids)."""
    pid_str = str(product_id)
    base = {"$or": [{"product_id": product_id}, {"product_id": pid_str}, {"product_ids": pid_str}]}
    if star_filter is not None:
        base["rating"] = star_filter
    return base


def _view_reviews_callback(product_id: str, star_filter: Optional[int], page: int) -> str:
    """Build callback_data for view_reviews. Format: view_reviews:pid:filter:page"""
    f = "all" if star_filter is None else str(star_filter)
    return f"view_reviews:{product_id}:{f}:{page}"


def _view_all_reviews_callback(star_filter: Optional[int], page: int) -> str:
    """Build callback_data for view_all_reviews. Format: view_all_reviews:filter:page"""
    f = "all" if star_filter is None else str(star_filter)
    return f"view_all_reviews:{f}:{page}"


async def _render_all_reviews(callback_or_message, star_filter: Optional[int], page: int):
    """Render the all-reviews view (all customers, this bot). Accepts CallbackQuery or Message."""
    if hasattr(callback_or_message, "message"):
        msg = callback_or_message.message
        bot = callback_or_message.bot
    else:
        msg = callback_or_message
        bot = msg.bot

    bot_config = await get_bot_config()
    if not bot_config:
        await msg.answer("❌ Bot configuration not found.")
        return

    bot_id = str(bot_config["_id"])
    db = get_database()
    reviews_collection = db.reviews

    query = {"bot_id": bot_id}
    if star_filter is not None:
        query["rating"] = star_filter

    all_reviews = await reviews_collection.find(query).sort("created_at", -1).to_list(length=1000)
    total_count = len(all_reviews)

    PAGE_SIZE = 5
    total_pages = max(1, (total_count + PAGE_SIZE - 1) // PAGE_SIZE)
    page = min(page, total_pages)
    start = (page - 1) * PAGE_SIZE
    reviews = all_reviews[start : start + PAGE_SIZE]

    if not all_reviews:
        reviews_text = "📊 *Rating* ⭐ —\n\n"
        reviews_text += "*All Customer Reviews*\n\n"
        reviews_text += "No reviews yet. Customers can rate their orders after purchase."
    else:
        avg_rating = sum(r.get("rating", 0) for r in all_reviews) / len(all_reviews)
        reviews_text = f"📊 *Rating* ⭐ {avg_rating:.2f}/5.0\n\n"
        reviews_text += f"*All Customer Reviews* ({total_count} total)\n\n"

        for review in reviews:
            rating = review.get("rating", 0)
            comment = review.get("comment", "")
            stars = "★" * rating + "☆" * (5 - rating)
            reviews_text += f"{stars}\n"
            if comment:
                reviews_text += f"{comment}\n"
            reviews_text += "\n"

    keyboard_buttons = []
    star_counts = {}
    for r in all_reviews:
        s = r.get("rating", 0)
        star_counts[s] = star_counts.get(s, 0) + 1

    filter_row = []
    filter_row.append(InlineKeyboardButton(
        text=f"All{'*' if star_filter is None else ''}",
        callback_data=_view_all_reviews_callback(None, 1)
    ))
    for s in [5, 4, 3, 2, 1]:
        cnt = star_counts.get(s, 0)
        filter_row.append(InlineKeyboardButton(
            text=f"{s} ★ ({cnt})",
            callback_data=_view_all_reviews_callback(s, 1)
        ))
    keyboard_buttons.append(filter_row)

    if total_pages > 1:
        page_row = []
        for p in range(1, min(total_pages + 1, 7)):
            label = f"{p}{'*' if p == page else ''}"
            if p == 6 and total_pages > 6:
                label = "6»"
            page_row.append(InlineKeyboardButton(
                text=label,
                callback_data=_view_all_reviews_callback(star_filter, p)
            ))
        keyboard_buttons.append(page_row)

    keyboard_buttons.append([InlineKeyboardButton(text="⬅️ Back to menu", callback_data="menu")])
    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)

    if hasattr(callback_or_message, "message"):
        try:
            await msg.edit_text(reviews_text, parse_mode="Markdown", reply_markup=keyboard)
        except Exception:
            await msg.answer(reviews_text, parse_mode="Markdown", reply_markup=keyboard)
    else:
        await msg.answer(reviews_text, parse_mode="Markdown", reply_markup=keyboard)


@router.callback_query(F.data.startswith("view_all_reviews"))
async def handle_view_all_reviews(callback: CallbackQuery):
    """Display all customer reviews for this bot (from main menu Reviews button)"""
    await safe_answer_callback(callback)

    parts = callback.data.split(":")
    star_filter = None
    page = 1

    if len(parts) >= 3:
        if parts[1] != "all":
            try:
                star_filter = int(parts[1])
            except (ValueError, TypeError):
                pass
        try:
            page = max(1, int(parts[2]))
        except (ValueError, TypeError, IndexError):
            page = 1

    await _render_all_reviews(callback, star_filter, page)


@router.callback_query(F.data.startswith("view_reviews:"))
async def handle_view_reviews(callback: CallbackQuery):
    """Display product reviews with star filter and pagination"""
    await safe_answer_callback(callback)

    parts = callback.data.split(":")
    product_id = parts[1]
    star_filter = None
    page = 1

    if len(parts) >= 4:
        if parts[2] != "all":
            try:
                star_filter = int(parts[2])
            except (ValueError, TypeError):
                pass
        try:
            page = max(1, int(parts[3]))
        except (ValueError, TypeError, IndexError):
            page = 1

    db = get_database()
    reviews_collection = db.reviews
    products_collection = db.products

    from bson import ObjectId
    product = None
    try:
        if len(product_id) == 24:
            product = await products_collection.find_one({"_id": ObjectId(product_id)})
    except Exception:
        pass

    if not product:
        product = await products_collection.find_one({"_id": product_id})

    if not product:
        await callback.message.answer("❌ Product not found.")
        return

    query = _reviews_query_for_product(product_id, star_filter)
    all_reviews = await reviews_collection.find(query).sort("created_at", -1).to_list(length=1000)
    total_count = len(all_reviews)

    PAGE_SIZE = 5
    total_pages = max(1, (total_count + PAGE_SIZE - 1) // PAGE_SIZE)
    page = min(page, total_pages)
    start = (page - 1) * PAGE_SIZE
    reviews = all_reviews[start : start + PAGE_SIZE]

    if not all_reviews:
        reviews_text = f"⭐ *Reviews for {product['name']}*\n\n"
        reviews_text += "No reviews yet. Be the first to review this product!"
    else:
        avg_rating = sum(r.get("rating", 0) for r in all_reviews) / len(all_reviews)
        reviews_text = f"📊 *Rating* ⭐ {avg_rating:.2f}/5.0\n\n"
        reviews_text += f"*Reviews for {product['name']}* ({total_count} total)\n\n"

        for review in reviews:
            rating = review.get("rating", 0)
            comment = review.get("comment", "")
            stars = "★" * rating + "☆" * (5 - rating)
            reviews_text += f"{stars}\n"
            if comment:
                reviews_text += f"{comment}\n"
            reviews_text += "\n"

    keyboard_buttons = []

    star_counts = {}
    for r in all_reviews:
        s = r.get("rating", 0)
        star_counts[s] = star_counts.get(s, 0) + 1

    filter_row = []
    filter_row.append(InlineKeyboardButton(
        text=f"All{'*' if star_filter is None else ''}",
        callback_data=_view_reviews_callback(product_id, None, 1)
    ))
    for s in [5, 4, 3, 2, 1]:
        cnt = star_counts.get(s, 0)
        filter_row.append(InlineKeyboardButton(
            text=f"{s} ★ ({cnt})",
            callback_data=_view_reviews_callback(product_id, s, 1)
        ))
    keyboard_buttons.append(filter_row)

    if total_pages > 1:
        page_row = []
        for p in range(1, min(total_pages + 1, 7)):
            label = f"{p}{'*' if p == page else ''}"
            if p == 6 and total_pages > 6:
                label = "6»"
            page_row.append(InlineKeyboardButton(
                text=label,
                callback_data=_view_reviews_callback(product_id, star_filter, p)
            ))
        keyboard_buttons.append(page_row)

    keyboard_buttons.append([InlineKeyboardButton(text="⬅️ Back to product", callback_data=f"product:{product_id}")])
    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)

    try:
        await callback.message.edit_text(reviews_text, parse_mode="Markdown", reply_markup=keyboard)
    except:
        await callback.message.answer(reviews_text, parse_mode="Markdown", reply_markup=keyboard)


# ---------------------------------------------------------------------------
# Order rating handlers (purchasers only, one review per order)
# ---------------------------------------------------------------------------

async def _save_order_review(order_id: str, user_id: str, bot_id: str, rating: int, comment: str = "") -> bool:
    """Save a review for an order. Returns True on success."""
    from datetime import datetime
    db = get_database()
    orders_collection = db.orders
    reviews_collection = db.reviews

    order = await orders_collection.find_one({"_id": order_id})
    if not order:
        return False

    product_ids = []
    for item in order.get("items", []):
        pid = item.get("product_id")
        if pid:
            product_ids.append(str(pid))

    review_doc = {
        "order_id": order_id,
        "user_id": user_id,
        "bot_id": bot_id,
        "rating": rating,
        "comment": comment or "",
        "product_ids": product_ids,
        "created_at": datetime.utcnow(),
    }
    await reviews_collection.insert_one(review_doc)
    return True


@router.callback_query(F.data.startswith("rate_order:"))
async def handle_rate_order(callback: CallbackQuery):
    """Show star selection for order rating (purchasers only)"""
    await safe_answer_callback(callback)

    order_id = callback.data.split(":")[1]
    user_id = str(callback.from_user.id)

    db = get_database()
    orders_collection = db.orders
    reviews_collection = db.reviews

    order = await orders_collection.find_one({"_id": order_id})
    if not order:
        await callback.message.answer("❌ Order not found.")
        return

    if str(order.get("userId")) != user_id:
        await callback.message.answer("❌ You can only rate your own orders.")
        return

    if order.get("paymentStatus", "").lower() != "paid":
        await callback.message.answer("❌ You can only rate orders that have been paid.")
        return

    existing = await reviews_collection.find_one({"order_id": order_id})
    if existing:
        await callback.message.answer("✅ You have already rated this order. Thank you!")
        return

    text = "⭐ *Rate your order*\n\nHow would you rate your experience? Select a rating:"
    keyboard_buttons = [
        [
            InlineKeyboardButton(text="1 ★", callback_data=f"rate_order_confirm:{order_id}:1"),
            InlineKeyboardButton(text="2 ★", callback_data=f"rate_order_confirm:{order_id}:2"),
            InlineKeyboardButton(text="3 ★", callback_data=f"rate_order_confirm:{order_id}:3"),
            InlineKeyboardButton(text="4 ★", callback_data=f"rate_order_confirm:{order_id}:4"),
            InlineKeyboardButton(text="5 ★", callback_data=f"rate_order_confirm:{order_id}:5"),
        ],
        [InlineKeyboardButton(text="⬅️ Cancel", callback_data=f"back_pay:{order_id}")],
    ]
    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)

    try:
        await callback.message.edit_text(text, parse_mode="Markdown", reply_markup=keyboard)
    except:
        await callback.message.answer(text, parse_mode="Markdown", reply_markup=keyboard)


@router.callback_query(F.data.startswith("rate_order_confirm:"))
async def handle_rate_order_confirm(callback: CallbackQuery):
    """User selected a star rating - show optional comment or skip"""
    await safe_answer_callback(callback)

    parts = callback.data.split(":")
    order_id = parts[1]
    rating = int(parts[2])
    user_id = str(callback.from_user.id)

    bot_config = await get_bot_config()
    bot_id = str(bot_config["_id"]) if bot_config else ""

    text = f"⭐ *Rating: {rating}/5*\n\nAdd a comment? (optional)"
    keyboard_buttons = [
        [InlineKeyboardButton(text="Skip", callback_data=f"rate_order_skip:{order_id}:{rating}")],
        [InlineKeyboardButton(text="Add comment", callback_data=f"rate_order_comment:{order_id}:{rating}")],
        [InlineKeyboardButton(text="⬅️ Cancel", callback_data=f"back_pay:{order_id}")],
    ]
    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)

    try:
        await callback.message.edit_text(text, parse_mode="Markdown", reply_markup=keyboard)
    except:
        await callback.message.answer(text, parse_mode="Markdown", reply_markup=keyboard)


@router.callback_query(F.data.startswith("rate_order_skip:"))
async def handle_rate_order_skip(callback: CallbackQuery):
    """Save review without comment and return to order view"""
    await safe_answer_callback(callback)

    parts = callback.data.split(":")
    order_id = parts[1]
    rating = int(parts[2])
    user_id = str(callback.from_user.id)

    bot_config = await get_bot_config()
    bot_id = str(bot_config["_id"]) if bot_config else ""

    success = await _save_order_review(order_id, user_id, bot_id, rating, "")
    if success:
        await callback.message.answer("✅ Thank you for your review!")
        await show_payment_invoice(order_id, callback)
    else:
        await callback.message.answer("❌ Could not save review. Please try again.")


@router.callback_query(F.data.startswith("rate_order_comment:"))
async def handle_rate_order_comment(callback: CallbackQuery, state: FSMContext):
    """Start FSM for optional comment input"""
    await safe_answer_callback(callback)

    parts = callback.data.split(":")
    order_id = parts[1]
    rating = int(parts[2])

    await state.update_data(rate_order_id=order_id, rate_rating=rating)
    await state.set_state(ReviewCommentStates.waiting_for_comment)

    await callback.message.answer(
        "📝 Type your comment (or /cancel to skip):"
    )


@router.message(ReviewCommentStates.waiting_for_comment)
async def handle_review_comment_input(message: Message, state: FSMContext):
    """Process review comment from user"""
    if message.text and message.text.strip().lower() in ["/cancel", "cancel"]:
        await state.clear()
        await message.answer("❌ Comment cancelled.")
        return

    data = await state.get_data()
    order_id = data.get("rate_order_id")
    rating = data.get("rate_rating")
    await state.clear()

    if not order_id or rating is None:
        await message.answer("❌ Session expired. Please try rating again from your order.")
        return

    user_id = str(message.from_user.id)
    bot_config = await get_bot_config()
    bot_id = str(bot_config["_id"]) if bot_config else ""
    comment = (message.text or "").strip()[:500]

    success = await _save_order_review(order_id, user_id, bot_id, rating, comment)
    if success:
        await message.answer("✅ Thank you for your review!")
    else:
        await message.answer("❌ Could not save review. Please try again.")


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
    
    # Get product - handle both ObjectId and string IDs
    from bson import ObjectId
    product = None
    
    # First try as ObjectId (if it's a valid ObjectId string)
    try:
        if len(product_id) == 24:  # ObjectId hex string length
            product = await products_collection.find_one({"_id": ObjectId(product_id)})
    except Exception as e:
        pass
    
    # If not found, try as string
    if not product:
        product = await products_collection.find_one({"_id": product_id})
    
    # If still not found, try searching by string representation
    if not product:
        all_products = await products_collection.find({}).to_list(length=100)
        for p in all_products:
            if str(p.get('_id')) == product_id:
                product = p
                break
    
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
        try:
            await callback.message.edit_text("🛒 Your cart is empty.", reply_markup=keyboard)
        except Exception:
            await callback.message.answer("🛒 Your cart is empty.", reply_markup=keyboard)
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
        [InlineKeyboardButton(text="💳 Checkout", callback_data="checkout")],
        [InlineKeyboardButton(text="🗑️ Clear Cart", callback_data="clear_cart")],
        [InlineKeyboardButton(text="⬅️ Continue Shopping", callback_data="shop")],
        [InlineKeyboardButton(text="📋 Back to Menu", callback_data="menu")]
    ]
    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)
    
    try:
        await callback.message.edit_text(cart_text, parse_mode="Markdown", reply_markup=keyboard)
    except:
        await callback.message.answer(cart_text, parse_mode="Markdown", reply_markup=keyboard)


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
    
    await callback.message.answer("🗑️ Cart cleared!")


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
        from bson import ObjectId
        product = None
        product_id = item["product_id"]
        
        try:
            if len(product_id) == 24:
                product = await products_collection.find_one({"_id": ObjectId(product_id)})
        except:
            pass
        
        if not product:
            product = await products_collection.find_one({"_id": product_id})
        
        if not product:
            all_products = await products_collection.find({}).to_list(length=100)
            for p in all_products:
                if str(p.get('_id')) == product_id:
                    product = p
                    break
        
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
        from bson import ObjectId
        product = None
        product_id = combined_item["product_id"]
        
        try:
            if len(product_id) == 24:
                product = await products_collection.find_one({"_id": ObjectId(product_id)})
        except:
            pass
        
        if not product:
            product = await products_collection.find_one({"_id": product_id})
        
        if not product:
            all_products = await products_collection.find({}).to_list(length=100)
            for p in all_products:
                if str(p.get('_id')) == product_id:
                    product = p
                    break
        
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
        # Fall back to SHKeeper if CryptAPI not configured
        from services.shkeeper import FALLBACK_CRYPTO_LIST
        # Filter to only show BTC and LTC
        allowed_currencies = ["BTC", "LTC"]
        filtered_currencies = [c for c in FALLBACK_CRYPTO_LIST if c.get("code", "").upper() in allowed_currencies]
        
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
    
    # If using CryptAPI, we're done (no need to fetch from API)
    if cryptapi_wallet:
        return
    
    # If using SHKeeper, try to get list in background and update if different
    if shkeeper_api_key and shkeeper_api_url:
        from services.shkeeper import get_available_cryptocurrencies
        import asyncio
        loop = asyncio.get_event_loop()
        try:
            crypto_result = await loop.run_in_executor(
                None,
                lambda: get_available_cryptocurrencies()
            )
        except Exception as e:
            print(f"Error fetching cryptocurrencies: {e}")
            # Keep showing fallback list if SHKeeper fails
            return
        
        # If SHKeeper returned successfully and has different options, update the message
        if crypto_result.get("success") and not crypto_result.get("fallback"):
            # SHKeeper returned real data, update the options
            keyboard_buttons = []
            crypto_list = crypto_result.get("crypto_list", [])
            if crypto_list:
                print(f"Found {len(crypto_list)} cryptocurrencies from SHKeeper, updating payment options")
                for crypto_info in crypto_list[:10]:
                    crypto_name = crypto_info.get("name", "")
                    display_name = crypto_info.get("display_name", crypto_name)
                    if crypto_name:
                        keyboard_buttons.append([
                            InlineKeyboardButton(
                                text=display_name,
                                callback_data=f"pay_sel:{invoice_id}:{crypto_name[:10]}"
                            )
                        ])
            
            if keyboard_buttons:
                keyboard_buttons.append([
                    InlineKeyboardButton(text="❌ Cancel", callback_data=f"back:{invoice_id}")
                ])
                updated_keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)
                try:
                    await callback.message.edit_text(payment_text, parse_mode="Markdown", reply_markup=updated_keyboard)
                except:
                    pass  # If edit fails, keep showing fallback list


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


def _get_shipping_costs(bot_config: dict) -> dict:
    """Get shipping costs from bot config or use defaults."""
    methods = bot_config.get("shipping_methods") if bot_config else None
    defaults = {"STD": 0, "EXP": 5, "NXT": 10}
    if methods and isinstance(methods, list):
        out = dict(defaults)
        for m in methods:
            if isinstance(m, dict) and m.get("code"):
                cost = m.get("cost", 0)
                out[m["code"]] = float(cost) if cost is not None else 0
        return out
    return defaults


def _format_shipping_cost(cost: float, currency: str) -> str:
    """Format shipping cost for display."""
    if currency and currency.upper() == "GBP":
        return f"£{cost:.2f}"
    return f"{cost:.2f} {currency or ''}"


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
    
    # Delivery method options with cost in button text
    keyboard_buttons = [
        [InlineKeyboardButton(
            text=f"🚚 Standard Delivery - {_format_shipping_cost(costs.get('STD', 0), currency)}",
            callback_data=f"del_sel:{invoice_id}:STD"
        )],
        [InlineKeyboardButton(
            text=f"⚡ Express Delivery - {_format_shipping_cost(costs.get('EXP', 0), currency)}",
            callback_data=f"del_sel:{invoice_id}:EXP"
        )],
        [InlineKeyboardButton(
            text=f"📦 Next Day Delivery - {_format_shipping_cost(costs.get('NXT', 0), currency)}",
            callback_data=f"del_sel:{invoice_id}:NXT"
        )],
        [InlineKeyboardButton(text="❌ Cancel", callback_data=f"back:{invoice_id}")]
    ]
    
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
        "STD": "Standard",
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
    from services.commission import calculate_commission
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
    
    # Prepare currency conversion task (run in executor since it's blocking)
    async def convert_currency():
        if invoice_currency.upper() != "USD":
            loop = asyncio.get_event_loop()
            converted_usd = await loop.run_in_executor(
                None,
                lambda: convert_amount(combined_amount, invoice_currency, "USD")
            )
            return converted_usd if converted_usd else combined_amount
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
    if invoice_currency.upper() != "USD":
        print(f"[Checkout] Conversion result: {combined_amount} {invoice_currency} -> {amount_for_shkeeper} USD")
    else:
        print(f"[Checkout] Already in USD: {combined_amount} USD")
    print(f"[Checkout] === FINAL AMOUNT FOR SHKEEPER: {amount_for_shkeeper} USD ===")
    
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
        "currency": selected_currency.upper(),  # Store payment currency (BTC, LTC, etc.)
        "timestamp": datetime.utcnow(),
        "encrypted_address": invoice.get("delivery_address"),
        "delivery_method": invoice.get("delivery_method"),
        "shipping_cost": shipping_cost,
        "shipping_method_code": invoice.get("shipping_method_code"),
        "discount_code": invoice.get("discount_code"),
        "discount_amount": discount_amount,
        "items": invoice.get("items", []),  # Store all items in the order
        "secret_phrase_hash": secret_phrase_hash
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
                amount=amount_for_shkeeper,  # USD amount (already converted)
                currency=selected_currency,
                order_id=invoice_id,  # Use invoice_id as order_id
                buyer_email="",
                fiat_currency="USD",  # amount_for_shkeeper is already in USD
                fiat_amount=amount_for_shkeeper,  # USD amount
                bot_config=bot_config  # Pass bot config for webhook URL
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
        # For LTC, if amount is < 0.01 LTC but total is > $5, it's likely wrong
        # LTC is typically $50-150, so 0.01 LTC = $0.50-$1.50, which is way too small for a $12 order
        expected_min_ltc = final_total_usd / 200  # Conservative estimate (assuming LTC < $200)
        if payment_amount < expected_min_ltc and final_total_usd > 5:
            print(f"[Payment Invoice] WARNING: LTC amount {payment_amount} seems too small for {final_total_usd} USD (expected at least {expected_min_ltc} LTC), recalculating...")
            should_recalculate = True
        else:
            should_recalculate = False
    elif payment_currency_code.upper() == 'BTC':
        # For BTC, if amount is < 0.00001 BTC but total is > $5, it's likely wrong
        expected_min_btc = final_total_usd / 100000  # Conservative estimate (assuming BTC < $100k)
        # Also check if amount is too large (like 6.7 BTC for a $6 order - clearly wrong)
        expected_max_btc = final_total_usd / 50000  # Maximum reasonable BTC (BTC > $50k)
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
                # get_exchange_rate('ltc', 'usd') returns the price of 1 LTC in USD (e.g., 100)
                # So to convert USD to LTC: USD_amount / LTC_price_in_USD
                recalculated_amount = final_total_usd / crypto_rate
                print(f"[Payment Invoice] Recalculated {payment_currency_code}: {final_total_usd} USD / {crypto_rate} USD per {payment_currency_code} = {recalculated_amount} {payment_currency_code}")
                
                # Validate the recalculated amount makes sense
                # Check if amount is reasonable for the USD total
                # For BTC: 1 BTC ≈ $91k, so $6 should be ~0.00007 BTC (not 6.7 BTC!)
                if payment_currency_code.upper() == 'BTC':
                    # BTC should be very small - if > 0.01 BTC for < $1000 order, it's wrong
                    max_reasonable_btc = final_total_usd / 50000  # Conservative: BTC > $50k
                    if recalculated_amount > 0 and recalculated_amount <= max_reasonable_btc:
                        payment_amount = recalculated_amount
                        # Update invoice with correct amount
                        await invoices_collection.update_one(
                            {"_id": invoice["_id"]},
                            {"$set": {"payment_amount": recalculated_amount}}
                        )
                        print(f"[Payment Invoice] Updated invoice with correct amount: {recalculated_amount} {payment_currency_code}")
                    else:
                        print(f"[Payment Invoice] ERROR: Recalculated amount {recalculated_amount} BTC seems invalid for {final_total_usd} USD order (max reasonable: {max_reasonable_btc} BTC)")
                elif recalculated_amount > 0 and recalculated_amount < 1000:  # Sanity check for other cryptos
                    payment_amount = recalculated_amount
                    # Update invoice with correct amount
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
    if payment_currency.upper() == 'BTC':
        # Format BTC with 8 decimal places, remove trailing zeros
        formatted_amount = f"{payment_amount:.8f}".rstrip('0').rstrip('.')
    elif payment_currency.upper() in ['ETH', 'LTC', 'BCH']:
        # Format other cryptos with 8 decimal places
        formatted_amount = f"{payment_amount:.8f}".rstrip('0').rstrip('.')
    else:
        # Format fiat currencies with 2 decimal places
        formatted_amount = f"{payment_amount:.2f}"
    
    # Check order status to determine invoice status
    orders_collection = db.orders
    order_status = "Pending Payment"
    
    # Try to find associated order by invoice_id or payment_invoice_id
    order = await orders_collection.find_one({"_id": invoice_id})
    if not order:
        # Try to find by payment_invoice_id field if it exists
        order = await orders_collection.find_one({"invoiceId": invoice_id})
    
    if order:
        payment_status = order.get("paymentStatus", "pending")
        if payment_status == "paid":
            order_status = "Paid"
            # Also update invoice status to match
            await invoices_collection.update_one(
                {"_id": invoice["_id"]},
                {"$set": {"status": "Paid"}}
            )
        else:
            order_status = "Pending Payment"
    else:
        # Check invoice status field directly
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
        invoice_text += "\n"  # No time left needed if paid
    
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
        from bson import ObjectId
        product = None
        try:
            if len(item["product_id"]) == 24:
                product = await products_collection.find_one({"_id": ObjectId(item["product_id"])})
        except:
            pass
        if not product:
            product = await products_collection.find_one({"_id": item["product_id"]})
        
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
    # Change button text based on whether notes exist
    notes_button_text = "📝 Edit Notes" if invoice.get("notes") else "📝 Add Notes"
    
    keyboard_buttons = [
        [InlineKeyboardButton(text=notes_button_text, callback_data=f"notes:{invoice_id}")],
        [
            InlineKeyboardButton(text="📷 Show QR", callback_data=f"qr:{invoice_id}"),
            InlineKeyboardButton(text="🔄 Refresh", callback_data=f"refresh_pay:{invoice_id}")
        ],
    ]

    # Add "Rate this order" button when paid and not yet rated
    if order_status == "Paid" and order:
        reviews_collection = db.reviews
        existing_review = await reviews_collection.find_one({"order_id": invoice_id})
        if not existing_review:
            keyboard_buttons.append([InlineKeyboardButton(text="⭐ Rate this order", callback_data=f"rate_order:{invoice_id}")])

    keyboard_buttons.append([InlineKeyboardButton(text="⬅️ Back to Orders", callback_data=f"back_pay:{invoice_id}")])
    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)
    
    try:
        await message.edit_text(invoice_text, parse_mode="Markdown", reply_markup=keyboard)
    except:
        await message.answer(invoice_text, parse_mode="Markdown", reply_markup=keyboard)


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

    # Items list - format: "1. Product Name quantity — £price"
    from bson import ObjectId
    for idx, item in enumerate(invoice.get("items", []), 1):
        product = None
        product_id = item.get("product_id")
        try:
            if product_id and len(str(product_id)) == 24:
                product = await products_collection.find_one({"_id": ObjectId(product_id)})
        except Exception:
            pass
        if not product:
            product = await products_collection.find_one({"_id": product_id})
        if not product:
            all_products = await products_collection.find({}).to_list(length=100)
            for p in all_products:
                if str(p.get("_id")) == str(product_id):
                    product = p
                    break

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
        # Show current notes and ask if they want to edit
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
        # No notes yet - prompt to add
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
    # Try to find invoice by invoice_id (handles both old and new format)
    invoice = await invoices_collection.find_one({"invoice_id": invoice_id})
    print(f"[QR Handler] Invoice lookup result: {'Found' if invoice else 'Not found'}")
    
    # If not found, try variants (for old format IDs that might still be in callbacks)
    if not invoice:
            # Try uppercase/lowercase variants
            invoice = await invoices_collection.find_one({"invoice_id": invoice_id.upper()})
            if not invoice:
                invoice = await invoices_collection.find_one({"invoice_id": invoice_id.lower()})
            # Try with/without "inv-" prefix
            if not invoice and invoice_id.lower().startswith("inv-"):
                invoice = await invoices_collection.find_one({"invoice_id": invoice_id[4:]})
            if not invoice and not invoice_id.lower().startswith("inv-"):
                invoice = await invoices_collection.find_one({"invoice_id": f"inv-{invoice_id}"})
    
    if not invoice:
        print(f"[QR Handler] Invoice not found in database")
        await callback.message.answer("❌ Invoice not found.")
        return
    
    print(f"[QR Handler] Invoice found, extracting payment details...")
    # Use the invoice_id from the database document (should be numeric after migration)
    display_invoice_id = invoice.get("invoice_id", invoice_id)
    
    payment_address = invoice.get("payment_address")
    payment_amount = invoice.get("payment_amount", 0)
    payment_currency = invoice.get("payment_currency", "BTC")  # Display name
    payment_currency_code = invoice.get("payment_currency_code")  # Actual currency code (LTC, BTC, etc.)
    payment_uri = invoice.get("payment_uri")  # Get payment URI if stored
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
    
    # Handle negative amounts (shouldn't happen, but fix if it does)
    if payment_amount < 0:
        payment_amount = abs(payment_amount)
    
    # Fix for old orders: If payment_amount looks like USD (>= 1.0 for most cryptos), try to extract from payment_uri
    # This handles orders created before the fix
    if payment_amount and isinstance(payment_amount, (int, float)) and payment_amount >= 1.0:
        # Check if this looks like USD amount (too large for crypto)
        # Most cryptos would have amounts < 1.0 (e.g., 0.00012345 BTC)
        # If we have a payment_uri, try to extract the correct amount from it
        if payment_uri and ('amount=' in payment_uri or 'value=' in payment_uri):
            try:
                # Extract amount from URI (e.g., "bitcoin:address?amount=0.00012345" or "ethereum:address?value=0.123")
                if 'amount=' in payment_uri:
                    uri_amount_str = payment_uri.split('amount=')[1].split('&')[0].split('#')[0]
                elif 'value=' in payment_uri:
                    uri_amount_str = payment_uri.split('value=')[1].split('&')[0].split('#')[0]
                else:
                    uri_amount_str = None
                
                if uri_amount_str:
                    uri_amount = float(uri_amount_str)
                    # If URI amount is much smaller (crypto amount), use it
                    if uri_amount < payment_amount and uri_amount < 1.0:
                        print(f"[QR Handler] Fixed amount: {payment_amount} (USD?) -> {uri_amount} (crypto from URI)")
                        payment_amount = uri_amount
                    elif uri_amount == payment_amount:
                        # URI also has wrong amount, need to recalculate from invoice total
                        print(f"[QR Handler] WARNING: Both stored amount and URI have wrong value: {payment_amount}")
                        # Try to recalculate from invoice total if available
                        invoice_total = invoice.get("total", 0)
                        discount_amount = invoice.get("discount_amount", 0)
                        final_total = invoice_total - discount_amount
                        invoice_currency = invoice.get("currency", "GBP")
                        
                        print(f"[QR Handler] Invoice total: {final_total} {invoice_currency}, but payment_amount is {payment_amount}")
                        
                        # Recalculate: Convert invoice total to USD, then get current crypto rate
                        if final_total > 0:
                            from utils.currency_converter import convert_amount
                            
                            # Convert invoice total to USD
                            usd_amount = final_total
                            if invoice_currency.upper() != "USD":
                                converted_usd = convert_amount(final_total, invoice_currency, "USD")
                                if converted_usd:
                                    usd_amount = converted_usd
                                    print(f"[QR Handler] Converted {final_total} {invoice_currency} to {usd_amount} USD")
                            
                            # If payment_amount is close to usd_amount, it's likely USD stored as crypto amount
                            if abs(payment_amount - usd_amount) < 0.1:
                                print(f"[QR Handler] payment_amount ({payment_amount}) matches USD amount ({usd_amount}), fetching from SHKeeper API...")
                                
                                # Try to get the correct amount from SHKeeper API first
                                invoice_id_for_api = invoice.get("invoice_id") or invoice.get("payment_invoice_id")
                                if invoice_id_for_api:
                                    try:
                                        from services.shkeeper import get_invoice_status
                                        import asyncio
                                        
                                        # Run in executor since it's a blocking HTTP call
                                        loop = asyncio.get_event_loop()
                                        invoice_status = await loop.run_in_executor(
                                            None,
                                            get_invoice_status,
                                            str(invoice_id_for_api)
                                        )
                                        
                                        if invoice_status.get("success") and invoice_status.get("invoices"):
                                            # Get the first invoice (should only be one for this external_id)
                                            shkeeper_invoice = invoice_status["invoices"][0]
                                            
                                            # Check transactions for crypto amounts
                                            transactions = shkeeper_invoice.get("txs", [])
                                            if transactions:
                                                # Sum up all transaction amounts (they're in crypto)
                                                total_crypto = sum(float(tx.get("amount", 0)) for tx in transactions)
                                                if total_crypto > 0:
                                                    print(f"[QR Handler] Got crypto amount from SHKeeper transactions: {total_crypto}")
                                                    payment_amount = total_crypto
                                                    
                                                    # Update the invoice with the correct amount
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
                                                # No transactions yet, try to get exchange_rate from stored invoice or calculate
                                                stored_exchange_rate = invoice.get("payment_exchange_rate")
                                                if stored_exchange_rate:
                                                    try:
                                                        exchange_rate = float(stored_exchange_rate)
                                                        if exchange_rate > 0:
                                                            calculated_crypto = usd_amount / exchange_rate
                                                            print(f"[QR Handler] Calculated from stored exchange_rate: {usd_amount} USD / {exchange_rate} = {calculated_crypto}")
                                                            payment_amount = calculated_crypto
                                                            
                                                            # Update the invoice
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
                                                            # Fall through to calculation below
                                                    except (ValueError, TypeError) as e:
                                                        print(f"[QR Handler] Error parsing exchange_rate: {e}")
                                                        # Fall through to calculation below
                                                else:
                                                    print(f"[QR Handler] No transactions and no stored exchange_rate, will calculate from currency converter...")
                                                    # Fall through to calculation below
                                        else:
                                            print(f"[QR Handler] Could not get invoice from SHKeeper: {invoice_status.get('error', 'Unknown error')}")
                                            # Fall through to calculation below
                                    except Exception as api_error:
                                        print(f"[QR Handler] Error calling SHKeeper API: {api_error}")
                                        # Fall through to calculation below
                                
                                # Fallback: Calculate using currency converter if SHKeeper API didn't work
                                if abs(payment_amount - usd_amount) < 0.1:  # Still wrong, need to calculate
                                    print(f"[QR Handler] Calculating crypto amount using currency converter...")
                                    crypto_currency_code = payment_currency_code or payment_currency.upper()
                                    
                                    # Map display names to currency codes
                                    currency_code_map = {
                                        "DOGE": "DOGE",
                                        "DOGECOIN": "DOGE",
                                        "BITCOIN": "BTC",
                                        "LITECOIN": "LTC",
                                        "ETHEREUM": "ETH"
                                    }
                                    crypto_code = currency_code_map.get(crypto_currency_code.upper(), crypto_currency_code.upper())
                                    
                                    # Convert USD to crypto
                                    crypto_amount = convert_amount(usd_amount, "USD", crypto_code)
                                    if crypto_amount:
                                        print(f"[QR Handler] Recalculated: {usd_amount} USD -> {crypto_amount} {crypto_code}")
                                        payment_amount = crypto_amount
                                        
                                        # Update the invoice with the correct amount (for future use)
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
    if payment_currency.upper() == 'BTC':
        # Format BTC with 8 decimal places, remove trailing zeros
        formatted_amount = f"{payment_amount:.8f}".rstrip('0').rstrip('.')
    elif payment_currency.upper() in ['ETH', 'LTC', 'BCH']:
        # Format other cryptos with 8 decimal places
        formatted_amount = f"{payment_amount:.8f}".rstrip('0').rstrip('.')
    else:
        # Format fiat currencies with 2 decimal places
        formatted_amount = f"{payment_amount:.2f}"
    
    # Get bot username - try from config first, then from bot API
    bot_config = await get_bot_config()
    bot_username = ""
    if bot_config:
        bot_username = bot_config.get("telegram_username", "")
        if not bot_username:
            bot_username = bot_config.get("name", "")
    
    # If still no username, try to get it from the bot API
    if not bot_username:
        try:
            bot_info = await callback.bot.get_me()
            bot_username = bot_info.username or ""
        except:
            pass
    
    # Debug output
    print(f"[QR Debug] Bot username: {bot_username}, Invoice ID: {display_invoice_id}, Amount: {formatted_amount}")
    
    # Generate payment URI - always regenerate to ensure correct format
    from services.shkeeper import _generate_payment_uri
    # Use the stored currency code if available, otherwise try to normalize from display name
    currency_code = payment_currency_code if payment_currency_code else payment_currency.upper()
    
    # Map display names to currency codes if currency_code is not a valid code
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
    
    # If still not a valid code, try to extract from display name
    if currency_code not in ["BTC", "LTC", "ETH", "BNB", "AVAX", "MATIC", "XRP", "TRX", "ETH-USDT", "ETH-USDC", "BNB-USDT", "BNB-USDC"]:
        if "litecoin" in currency_code.lower() or "ltc" in currency_code.lower():
            currency_code = "LTC"
        elif "bitcoin" in currency_code.lower() or "btc" in currency_code.lower():
            currency_code = "BTC"
        elif "ethereum" in currency_code.lower() or "eth" in currency_code.lower():
            currency_code = "ETH"
    
    # Check payment provider
    payment_provider = invoice.get("payment_provider", "").lower()
    print(f"[QR Handler] Payment provider: {payment_provider}")
    
    # Validate address format
    if not payment_address or len(payment_address) < 10:
        await callback.message.answer("❌ Invalid payment address.")
        return
    
    # Only validate address format for SHKeeper (CryptAPI addresses can vary)
    if payment_provider == "shkeeper":
        from services.shkeeper import _validate_address_format
        print(f"[QR Handler] Validating address format - currency: {currency_code}, address starts with: {payment_address[:10]}")
        address_valid = _validate_address_format(currency_code, payment_address)
        print(f"[QR Handler] Address validation result: {address_valid}")
        
        # Special check for Litecoin with Bitcoin address format
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
        # For CryptAPI and other providers, skip strict validation
        print(f"[QR Handler] Skipping strict address validation for provider: {payment_provider}")
    
    print(f"[QR Handler] Generating payment URI: currency_code={currency_code}, address={payment_address}, amount={payment_amount}")
    print(f"[QR Handler] Address length: {len(payment_address)}, Address starts with: {payment_address[:10]}")
    print(f"[QR Handler] Full address: {payment_address}")
    
    # Use stored payment URI if available (from CryptAPI or other providers), otherwise generate it
    if payment_uri and isinstance(payment_uri, str) and payment_uri.startswith(("bitcoin:", "litecoin:", "ethereum:", "binancecoin:", "avalanche:", "polygon:", "ripple:", "tron:")):
        print(f"[QR Handler] Using stored payment URI from invoice")
        print(f"[QR Handler] URI: {payment_uri[:60]}...")
    else:
        print(f"[QR Handler] No stored payment URI found, generating one...")
        # Generate payment URI - try using utility function first, then fallback
        try:
            from services.shkeeper import _generate_payment_uri
            payment_uri = _generate_payment_uri(currency_code, payment_address, str(payment_amount))
            print(f"[QR Handler] Generated payment URI using utility: {payment_uri[:60]}...")
        except Exception as uri_error:
            print(f"[QR Handler] Error using utility function: {uri_error}")
            # Fallback: Generate simple URI based on currency
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
    
    # Validate the generated URI
    if not payment_uri or not payment_uri.startswith(("bitcoin:", "litecoin:", "ethereum:", "binancecoin:", "avalanche:", "polygon:", "ripple:", "tron:")):
        print(f"[QR Handler] WARNING: Generated URI doesn't match expected format: {payment_uri}")
    
    # Generate QR code with overlay - import fresh each time to ensure latest code
    import importlib
    import sys
    # Remove the module from cache to force fresh import
    if 'utils.qr_generator' in sys.modules:
        del sys.modules['utils.qr_generator']
    if 'utils' in sys.modules:
        # Also try to reload utils if it's cached
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
        # Run QR generation in executor to avoid blocking event loop
        import asyncio
        loop = asyncio.get_event_loop()
        
        # Run with timeout to prevent hanging
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
                timeout=10.0  # 10 second timeout
            )
            print(f"[QR Handler] QR code generation completed")
        except asyncio.TimeoutError:
            print(f"[QR Handler] QR code generation timed out after 10 seconds")
            raise Exception("QR code generation timed out. Please try again.")
        
        # Send QR code image
        print(f"[QR Handler] Preparing to send QR code image...")
        # Ensure the stream is at the beginning
        qr_image.seek(0)
        # Read the bytes from BytesIO
        qr_bytes = qr_image.read()
        print(f"[QR Handler] QR image bytes read: {len(qr_bytes)} bytes")
        
        # Create BufferedInputFile for aiogram
        qr_input_file = BufferedInputFile(qr_bytes, filename=f"qr_{display_invoice_id}.png")
        print(f"[QR Handler] Sending QR code image, size: {len(qr_bytes)} bytes")
        await callback.message.answer_photo(
            photo=qr_input_file,
            caption=f"QR Code for payment {display_invoice_id}\n\nScan to pay: {formatted_amount} {payment_currency}"
        )
        print(f"[QR Handler] QR code sent successfully")
    except Exception as e:
        # Log the full error with traceback
        import traceback
        error_traceback = traceback.format_exc()
        print(f"[QR Handler] ERROR generating custom QR code: {str(e)}")
        print(f"[QR Handler] Full traceback:\n{error_traceback}")
        
        # Fallback to URL if generation fails
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
        # Catch any exception that wasn't caught by inner try-except blocks
        import traceback
        error_traceback = traceback.format_exc()
        print(f"[QR Handler] ========== OUTER EXCEPTION CAUGHT ==========")
        print(f"[QR Handler] Error type: {type(outer_exception).__name__}")
        print(f"[QR Handler] Error message: {str(outer_exception)}")
        print(f"[QR Handler] Full traceback:\n{error_traceback}")
        try:
            if callback and callback.message:
                await callback.message.answer(
                    f"❌ *Error*\n\n"
                    f"An unexpected error occurred: {str(outer_exception)}\n\n"
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
    from services.commission import calculate_commission
    
    # Group items by product_id and variation_index
    grouped_items = {}
    for item in cart["items"]:
        key = (item["product_id"], item.get("variation_index"))
        if key not in grouped_items:
            grouped_items[key] = []
        grouped_items[key].append(item)
    
    orders_created = []
    for (product_id, variation_index), items in grouped_items.items():
        # Get product - handle both ObjectId and string IDs
        from bson import ObjectId
        product = None
        
        # First try as ObjectId (if it's a valid ObjectId string)
        try:
            if len(product_id) == 24:  # ObjectId hex string length
                product = await products_collection.find_one({"_id": ObjectId(product_id)})
        except Exception as e:
            pass
        
        # If not found, try as string
        if not product:
            product = await products_collection.find_one({"_id": product_id})
        
        # If still not found, try searching by string representation
        if not product:
            all_products = await products_collection.find({}).to_list(length=100)
            for p in all_products:
                if str(p.get('_id')) == product_id:
                    product = p
                    break
        
        if not product:
            continue
        
        # Combine quantities from all items with same product/variation
        total_quantity = sum(item["quantity"] for item in items)
        total_item_price = sum(item["price"] * item["quantity"] for item in items)
        
        # Convert item price if currency is different
        item_currency = product.get("currency", "BTC")
        if item_currency.upper() != selected_currency:
            converted_item = convert_amount(total_item_price, item_currency, selected_currency)
            if converted_item:
                if selected_currency == "BTC":
                    order_total = round(converted_item, 8)
                else:
                    order_total = round(converted_item, 2)
            else:
                order_total = total_item_price  # Fallback to original if conversion fails
        else:
            order_total = total_item_price
        
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
            "currency": selected_currency.upper(),  # Store payment currency (BTC, LTC, etc.)
            "timestamp": datetime.utcnow()
        }
        
        # Add encrypted address if available
        if encrypted_address:
            order["encrypted_address"] = encrypted_address
            # Store secret phrase hash to allow decryption even if user changes secret phrase later
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
    # Priority: SHKeeper > Blockonomics > CoinPayments
    from services.payment_provider import create_payment_invoice
    
    invoices_sent = 0
    
    for order_data in orders_created:
        order = order_data["order"]
        product = order_data["product"]
        
        # Get bot config for webhook URL
        bot_config = await get_bot_config()
        
        # Create payment invoice using available payment provider
        # Pass the fiat currency and amount for proper conversion
        invoice_result = create_payment_invoice(
            amount=order["amount"],
            currency=selected_currency,  # Use selected currency instead of product currency
            order_id=order["_id"],
            buyer_email="",
            fiat_currency=currency,  # Pass the product currency (GBP, USD, etc.)
            fiat_amount=order["amount"],  # Pass the fiat amount
            bot_config=bot_config  # Pass bot config for webhook URL
        )
        
        if invoice_result["success"]:
            # Update order with invoice ID
            await orders_collection.update_one(
                {"_id": order["_id"]},
                {"$set": {"invoiceId": invoice_result.get("txn_id") or invoice_result.get("invoice_id") or invoice_result.get("address")}}
            )
            # Record deposit address for HD-style tracking (one address per order)
            from database.addresses import record_deposit_address
            record_deposit_address(
                get_database(),
                str(order["_id"]),
                selected_currency,
                invoice_result["address"],
                invoice_result.get("provider"),
            )

            # Get currency display name from invoice result (for SHKeeper)
            display_currency = invoice_result.get('display_name') or invoice_result.get('currency', selected_currency)
            crypto_currency = invoice_result.get('currency', selected_currency)
            crypto_amount = invoice_result.get('amount', order["amount"])
            
            # Send invoice to user
            invoice_message = f"💳 *Payment Invoice*\n\n"
            invoice_message += f"Order ID: `{order['_id']}`\n"
            invoice_message += f"Product: {product['name']}\n"
            if order.get("quantity", 1) > 1:
                invoice_message += f"Quantity: {order['quantity']}\n"
            
            # Show amount based on provider
            if invoice_result.get('provider') == 'shkeeper':
                # SHKeeper: Show both USD and crypto amount
                invoice_message += f"Amount: ${order['amount']} USD\n"
                invoice_message += f"Pay: {crypto_amount} {display_currency}\n\n"
            else:
                # Other providers: Show crypto amount
                invoice_message += f"Amount: {crypto_amount} {display_currency}\n\n"
            
            invoice_message += f"Send {crypto_amount} {display_currency} to:\n"
            invoice_message += f"`{invoice_result['address']}`"
            
            await callback.message.answer(invoice_message, parse_mode="Markdown")
            
            # Send QR code as separate image (cleaner)
            if invoice_result.get('qrcode_url'):
                try:
                    await callback.message.answer_photo(
                        photo=invoice_result['qrcode_url'],
                        caption=f"Scan to pay: {crypto_amount} {display_currency}"
                    )
                except:
                    pass  # Silently fail if QR code can't be sent
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
    
    # Send summary
    if invoices_sent > 0:
        await callback.message.answer(
            f"✅ Checkout complete! {invoices_sent} invoice(s) generated.\n\n"
            "Please complete payment for each invoice above."
        )
    
    # Clear cart after successful checkout
    await carts_collection.update_one(
        {"_id": cart["_id"]},
        {"$set": {"items": [], "updated_at": None}}
    )


@router.message(F.text & ~F.text.startswith("/"))
async def handle_address_input(message: Message, state: FSMContext):
    """Handle address and discount code input from user during checkout"""
    bot_config = await get_bot_config()
    if not bot_config:
        # Not configured, let other handlers process
        return
    
    # Check if user is in contact mode - if so, let contact handler process it
    from handlers.contact import ContactStates
    current_state = await state.get_state()
    if current_state == ContactStates.waiting_for_message:
        # User is in contact mode, let contact handler process this message
        return
    
    # Check if this is a menu button - if so, let menu handler process it
    main_buttons = bot_config.get("main_buttons", [])
    if message.text in main_buttons:
        # This is a menu button, let menu handler process it
        return
    
    bot_id = str(bot_config["_id"])
    user_id = str(message.from_user.id)
    
    db = get_database()
    invoices_collection = db.invoices
    carts_collection = db.carts
    
    # Check if user is waiting for notes input FIRST (notes can be added at any time, including after payment)
    invoice_for_notes = await invoices_collection.find_one(
        {
            "user_id": user_id,
            "bot_id": bot_id,
            "waiting_for_notes": True
        },
        sort=[("created_at", -1)]  # Most recent first
    )
    
    if invoice_for_notes:
        print(f"[Notes Input] Found invoice waiting for notes: {invoice_for_notes.get('invoice_id')}")
        from datetime import datetime
        
        notes_text = message.text.strip()
        
        # Check for cancel command
        if notes_text.lower() in ["/cancel", "cancel"]:
            invoice_id = invoice_for_notes.get("invoice_id")
            await invoices_collection.update_one(
                {"invoice_id": invoice_id},
                {"$unset": {"waiting_for_notes": ""}}
            )
            await message.answer("❌ Notes cancelled.")
            # Go back to payment invoice (show_payment_invoice accepts Message or CallbackQuery)
            await show_payment_invoice(invoice_id, message)
            return
        
        # Validate notes (minimum length check - at least 3 characters)
        if len(notes_text) < 3:
            await message.answer(
                "❌ Notes must be at least 3 characters long. Please try again or send /cancel to skip."
            )
            return
        
        # Limit notes length (max 1000 characters to prevent abuse)
        if len(notes_text) > 1000:
            await message.answer(
                "❌ Notes are too long (maximum 1000 characters). Please shorten your notes and try again."
            )
            return
        
        # Save notes to invoice
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
        
        # Show updated payment invoice (show_payment_invoice accepts Message or CallbackQuery)
        await show_payment_invoice(invoice_id, message)
        return
    
    # Check if user is waiting for address input (address takes priority after notes)
    # CRITICAL: Find the MOST RECENT invoice that's waiting for address
    # Sort by created_at descending to get the newest one first
    invoice_for_address = await invoices_collection.find_one(
        {
        "user_id": user_id,
        "bot_id": bot_id,
            "waiting_for_address": True,
            "status": "Pending Checkout"  # Only match invoices that are still in checkout
        },
        sort=[("created_at", -1)]  # Most recent first
    )
    
    if invoice_for_address:
        print(f"[Address Input] Found invoice waiting for address: {invoice_for_address.get('invoice_id')}")
        # Handle address input for invoice-based checkout
        address = message.text.strip()
        
        # Validate address format - ensure it has at least 3 lines (basic format check)
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
    
        # Validate minimum length
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
        
        # Encrypt address
        from utils.address_encryption import encrypt_address
        from utils.secret_phrase import get_or_create_user_secret_phrase
        from datetime import datetime
        user_secret_phrase = await get_or_create_user_secret_phrase(user_id, bot_id)
        encrypted_address = encrypt_address(address, user_secret_phrase)
        
        # Update invoice with encrypted address
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
        
        # Show updated invoice
        class FakeCallback:
            def __init__(self, msg):
                self.message = msg
                self.from_user = msg.from_user
            
            async def answer(self):
                pass
        
        fake_callback = FakeCallback(message)
        fake_callback.bot = message.bot  # Add bot attribute for show_checkout_invoice
        fake_callback.data = None  # Add data attribute
        short_invoice_id = invoice_for_address.get("invoice_id", str(invoice_for_address["_id"]))
        print(f"[Address Input] Showing updated invoice {short_invoice_id} after address input")
        try:
            await show_checkout_invoice(short_invoice_id, fake_callback)
        except Exception as e:
            print(f"[Address Input] Error showing updated invoice: {e}")
            import traceback
            traceback.print_exc()
        return  # Important: return here to prevent other handlers from processing
    
    # Check if user is waiting for discount code input
    # CRITICAL: Find the MOST RECENT invoice that's waiting for discount
    # Sort by created_at descending to get the newest one first
    invoice = await invoices_collection.find_one(
        {
            "user_id": user_id,
            "bot_id": bot_id,
            "waiting_for_discount": True,
            "status": "Pending Checkout"  # Only match invoices that are still in checkout
        },
        sort=[("created_at", -1)]  # Most recent first
    )
    
    print(f"[Discount Input] User {user_id}, bot {bot_id}, text: '{message.text}', waiting_for_discount check: {invoice is not None}")
    
    # Initialize discount_applied to prevent UnboundLocalError
    discount_applied = False
    discount_amount = 0
    discount_code = None
    
    # Debug: Check all invoices for this user to see what's in the database
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
        # Handle discount code input
        discount_code = message.text.strip().upper()
        print(f"[Discount Input] Processing discount code: {discount_code}")
        
        # Make sure we don't let other handlers process this
        # by not returning early - we'll process it fully below
        
        # Validate discount code against database
        db = get_database()
        discounts_collection = db.discounts
        
        # Find active discount code
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
            # Check if discount applies to this bot
            bot_id = invoice.get("bot_id")
            if not discount.get("bot_ids") or len(discount.get("bot_ids", [])) == 0 or bot_id in discount.get("bot_ids", []):
                # Check usage limit
                if discount.get("usage_limit") is None or discount.get("used_count", 0) < discount.get("usage_limit", 0):
                    # Check minimum order amount
                    # IMPORTANT: Use the invoice's total field - it should NOT be recalculated
                    # The total was set when the invoice was created from the cart
                    total = invoice.get("total", 0)
                    min_order = discount.get("min_order_amount", 0)
                    
                    # Debug: Log the invoice total being used for discount calculation
                    print(f"[Discount] Invoice ID: {invoice.get('invoice_id')}, Invoice total: {total}, Discount type: {discount.get('discount_type')}, Discount value: {discount.get('discount_value')}")
                    
                    if total >= min_order:
                        # Calculate discount amount
                        if discount.get("discount_type") == "percentage":
                            discount_amount = total * (discount.get("discount_value", 0) / 100)
                            print(f"[Discount] Percentage discount: {total} * ({discount.get('discount_value', 0)} / 100) = {discount_amount}")
                            # Apply max discount if set
                            max_discount = discount.get("max_discount_amount")
                            if max_discount and discount_amount > max_discount:
                                discount_amount = max_discount
                        else:
                            # Fixed amount
                            discount_amount = discount.get("discount_value", 0)
                            # Don't exceed order total
                            if discount_amount > total:
                                discount_amount = total
                        
                        discount_applied = True
                        
                        # Increment usage count
                        await discounts_collection.update_one(
                            {"_id": discount["_id"]},
                            {"$inc": {"used_count": 1}}
                        )
                    else:
                        await message.answer(
                            f"❌ Minimum order amount of £{min_order:.2f} required for this discount code."
                        )
                        # Clear waiting flag and return
                        await invoices_collection.update_one(
                            {"_id": invoice["_id"]},
                            {"$set": {"waiting_for_discount": False}}
                        )
                        return
                else:
                    await message.answer(f"❌ Discount code '{discount_code}' has reached its usage limit.")
                    # Clear waiting flag and return
                    await invoices_collection.update_one(
                        {"_id": invoice["_id"]},
                        {"$set": {"waiting_for_discount": False}}
                    )
                    return
            else:
                await message.answer(f"❌ Discount code '{discount_code}' is not valid for this bot.")
                # Clear waiting flag and return
                await invoices_collection.update_one(
                    {"_id": invoice["_id"]},
                    {"$set": {"waiting_for_discount": False}}
                )
                return
        else:
            await message.answer(f"❌ Invalid or expired discount code '{discount_code}'. Please try again.")
            # Clear waiting flag and return
            await invoices_collection.update_one(
                {"_id": invoice["_id"]},
                {"$set": {"waiting_for_discount": False}}
            )
            return
    
    # Update invoice with discount (only reached if discount was successfully applied)
    if discount_applied:
        # CRITICAL: Do NOT recalculate or update the invoice total - only update discount fields
        # The invoice total should remain as it was when created from the cart
        print(f"[Discount] Updating invoice {invoice.get('invoice_id')} with discount_code={discount_code}, discount_amount={discount_amount}, invoice_total={invoice.get('total')} (NOT changing total)")
        await invoices_collection.update_one(
            {"_id": invoice["_id"]},
            {
                "$set": {
                    "discount_code": discount_code,
                    "discount_amount": discount_amount,
                    "waiting_for_discount": False,
                    "updated_at": datetime.utcnow()
                    # NOTE: We do NOT update "total" here - it should remain as originally calculated
                }
            }
        )
        
        await message.answer(f"✅ Discount code '{discount_code}' applied! You saved £{discount_amount:.2f}.")
        
        # Show updated invoice using short invoice_id
        class FakeCallback:
            def __init__(self, msg):
                self.message = msg
                self.from_user = msg.from_user
                self.bot = msg.bot  # Add bot attribute for show_checkout_invoice
                self.data = None  # Add data attribute
        
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
        # Get selected currency from cart
        selected_currency = cart.get("checkout_currency", "BTC")
    address = message.text.strip()
    
    # Validate address format - ensure it has at least 3 lines (basic format check)
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
    
    # Validate minimum length
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
    
    # Process checkout with provided address
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
    
    # Check if user is waiting for address input (new invoice-based system)
    invoice = await invoices_collection.find_one({
        "user_id": user_id,
        "bot_id": bot_id,
        "waiting_for_address": True
    })
    
    if invoice:
        address = message.text.strip()
        
        # Validate address format
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
        
        # Validate minimum length
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
        
        # Encrypt and store address
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
            
            # Show updated invoice using short invoice_id
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

