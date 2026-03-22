"""
Shop handlers: Wishlist and Reviews.
Catalog, product, cart, and checkout handlers have been split into separate modules.

Re-exports common functions for backward compatibility with existing imports.
"""
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from database.connection import get_database
from utils.bot_config import get_bot_config, invalidate_rating_cache
from utils.callback_utils import safe_answer_callback
from utils.shop_helpers import (
    safe_split, find_by_id, safe_edit_or_send, prepare_image_for_telegram,
    get_cart_total, get_cart_total_display, calculate_increment_amount,
)
from typing import Optional

router = Router()


class ReviewCommentStates(StatesGroup):
    waiting_for_comment = State()


# Re-export for backward compatibility (other files import from handlers.shop)
# These are now defined in their respective modules but re-exported here
def _get_reexports():
    """Lazy re-exports to avoid circular imports."""
    pass


# ---------------------------------------------------------------------------
# Wishlist handlers
# ---------------------------------------------------------------------------

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
        await safe_edit_or_send(callback, "📝 Your wishlist is empty.", reply_markup=keyboard)
        return

    wishlist_text = "📝 *Your Wishlist*\n\n"
    keyboard_buttons = []

    from bson import ObjectId
    for idx, item in enumerate(wishlist.get("items", [])):
        product_id = item.get("product_id")
        variation_index = item.get("variation_index")

        product = await find_by_id(products_collection, product_id)

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

    await safe_edit_or_send(callback, wishlist_text, parse_mode="Markdown", reply_markup=keyboard)


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


# ---------------------------------------------------------------------------
# Review helpers
# ---------------------------------------------------------------------------

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
    else:
        msg = callback_or_message

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

    product = await find_by_id(products_collection, product_id)

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
    except Exception:
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
    invalidate_rating_cache()
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

    allowed_statuses = {"paid", "confirmed", "shipped", "delivered", "completed"}
    if order.get("paymentStatus", "").lower() not in allowed_statuses:
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
    except Exception:
        await callback.message.answer(text, parse_mode="Markdown", reply_markup=keyboard)


@router.callback_query(F.data.startswith("rate_order_confirm:"))
async def handle_rate_order_confirm(callback: CallbackQuery):
    """User selected a star rating - show optional comment or skip"""
    await safe_answer_callback(callback)

    parts = callback.data.split(":")
    order_id = parts[1]
    rating = int(parts[2])

    text = f"⭐ *Rating: {rating}/5*\n\nAdd a comment? (optional)"
    keyboard_buttons = [
        [InlineKeyboardButton(text="Skip", callback_data=f"rate_order_skip:{order_id}:{rating}")],
        [InlineKeyboardButton(text="Add comment", callback_data=f"rate_order_comment:{order_id}:{rating}")],
        [InlineKeyboardButton(text="⬅️ Cancel", callback_data=f"back_pay:{order_id}")],
    ]
    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)

    try:
        await callback.message.edit_text(text, parse_mode="Markdown", reply_markup=keyboard)
    except Exception:
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
        from handlers.checkout import show_payment_invoice
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
