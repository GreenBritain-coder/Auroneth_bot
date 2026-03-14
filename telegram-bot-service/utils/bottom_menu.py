"""
Helpers for menu stats (order count, cart total) used in inline menu.
"""
from database.connection import get_database
from handlers.shop import get_cart_total_display


async def get_menu_stats(user_id: str, bot_id: str) -> tuple[int, str]:
    """Return (order_count, cart_display) for inline menu buttons."""
    db = get_database()
    orders_collection = db.orders
    try:
        order_count = await orders_collection.count_documents({
            "userId": user_id,
            "botId": bot_id
        })
    except Exception:
        from bson import ObjectId
        try:
            order_count = await orders_collection.count_documents({
                "userId": user_id,
                "botId": ObjectId(bot_id)
            })
        except Exception:
            order_count = 0
    cart_display = await get_cart_total_display(user_id, bot_id)
    return order_count, cart_display


async def build_bottom_menu_keyboard(user_id: str, bot_id: str):
    """Legacy: build reply keyboard. No longer used - stats are in inline menu."""
    from aiogram.types import ReplyKeyboardMarkup, KeyboardButton
    order_count, cart_display = await get_menu_stats(user_id, bot_id)
    keyboard = ReplyKeyboardMarkup(
        keyboard=[
            [
                KeyboardButton(text=f"📦 Orders ({order_count})"),
                KeyboardButton(text="❤️ Wishlist"),
                KeyboardButton(text=f"🛒 {cart_display}"),
            ]
        ],
        resize_keyboard=True,
        is_persistent=True,
    )
    return keyboard
