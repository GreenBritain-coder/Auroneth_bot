"""
Shared utility functions used across shop-related handler modules.
"""
from aiogram.types import CallbackQuery, BufferedInputFile, InputMediaPhoto
from database.connection import get_database
from typing import Optional


def safe_split(data: str, index: int, default: str = "") -> str:
    """Safely get a part from callback_data split by ':'.
    Prevents IndexError if data is truncated or malformed."""
    parts = data.split(":")
    return parts[index] if len(parts) > index else default


async def find_by_id(collection, doc_id: str):
    """Find a document by ID, handling both ObjectId and string formats.
    Replaces the repeated try-ObjectId/except/try-string pattern throughout the codebase."""
    from bson import ObjectId
    from bson.errors import InvalidId
    # Try as ObjectId first (most common for MongoDB)
    if doc_id and len(str(doc_id)) == 24:
        try:
            result = await collection.find_one({"_id": ObjectId(doc_id)})
            if result:
                return result
        except InvalidId:
            pass
    # Fallback to string ID
    return await collection.find_one({"_id": doc_id})


async def safe_edit_or_send(callback: CallbackQuery, text: str, reply_markup=None, parse_mode=None, photo_url: str = None):
    """
    Smart message navigation that handles both text and photo messages.

    Text screens (categories, subcategories, cart):
      - If current message is text: edit_text (instant, same message)
      - If current message is photo: delete photo, send new text

    Photo screens (product detail):
      - Pass photo_url to show product with image
      - If current message is photo: edit_media to swap image
      - If current message is text: delete text, send new photo
    """
    is_fake = getattr(callback, 'id', None) is None
    kwargs = {}
    if reply_markup:
        kwargs['reply_markup'] = reply_markup
    if parse_mode:
        kwargs['parse_mode'] = parse_mode

    if is_fake:
        # Initial entry from menu - always send new message
        if photo_url:
            try:
                await callback.message.answer_photo(photo=photo_url, caption=text, **kwargs)
            except Exception:
                await callback.message.answer(text, **kwargs)
        else:
            await callback.message.answer(text, **kwargs)
        return

    if photo_url:
        # === PHOTO SCREEN (product detail with image) ===
        try:
            # Try edit_media (works if current message is already a photo)
            media = InputMediaPhoto(media=photo_url, caption=text, parse_mode=parse_mode)
            await callback.message.edit_media(media=media, reply_markup=reply_markup)
        except Exception:
            # Current message is text or edit_media failed - delete and send photo
            try:
                await callback.message.delete()
            except Exception:
                pass
            try:
                await callback.message.answer_photo(photo=photo_url, caption=text, **kwargs)
            except Exception:
                await callback.message.answer(text, **kwargs)
    else:
        # === TEXT SCREEN (categories, subcategories, cart) ===
        try:
            # Try edit_text (works if current message is text)
            await callback.message.edit_text(text, **kwargs)
        except Exception:
            # Current message is a photo - delete it and send text
            try:
                await callback.message.delete()
            except Exception:
                pass
            await callback.message.answer(text, **kwargs)


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
