"""
Unified navigation module — single source of truth for building the bot's inline menu keyboard.
All handlers that need the main menu should import build_menu_keyboard from here.
"""
import re
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
from utils.bottom_menu import get_menu_stats


async def build_menu_keyboard(bot_config: dict, user_id: str, bot_id: str) -> InlineKeyboardMarkup:
    """Build the main menu inline keyboard.

    Layout (fixed across all bots):
        ⭐ Reviews
        [custom buttons, max 3 per row]
        🛍️ Shop  |  📦 Orders (X)
        ❤️ Wishlist  |  🛒 Cart (£X)
        💬 Contact  |  🔐 PGP  |  ℹ️ About

    Returns a ready-to-use InlineKeyboardMarkup.
    """
    rows = await build_menu_rows(bot_config, user_id, bot_id)
    return InlineKeyboardMarkup(inline_keyboard=rows)


async def build_menu_rows(bot_config: dict, user_id: str, bot_id: str) -> list:
    """Build the menu button rows (list of lists of InlineKeyboardButton).
    Use this when you need the raw rows instead of the full InlineKeyboardMarkup.
    """
    order_count, cart_display = await get_menu_stats(user_id, bot_id)
    vendor_pgp_key = bot_config.get("vendor_pgp_key", "")

    rows = []

    # === ROW 1: Reviews (always first) ===
    rows.append([
        InlineKeyboardButton(text="⭐ Reviews", callback_data="view_all_reviews")
    ])

    # === CUSTOM BUTTONS (vendor-defined, between Reviews and Shop, max 3 per row) ===
    FIXED_SYSTEM_ACTIONS = {"shop", "orders", "view_wishlist", "view_cart", "contact", "pgp", "about", "view_all_reviews"}
    custom_buttons = bot_config.get("custom_buttons", [])
    custom = [
        b for b in custom_buttons
        if b.get("enabled", True) and b.get("action") not in FIXED_SYSTEM_ACTIONS
    ]
    # Legacy main_buttons fallback
    if not custom:
        main_buttons = bot_config.get("main_buttons", [])
        main_buttons = [btn for btn in main_buttons if btn and btn.strip()] if isinstance(main_buttons, list) else []
        system_names = {"shop", "orders", "wishlist", "cart", "contact", "about", "reviews", "pgp"}
        for btn_text in main_buttons:
            normalized = re.sub(r'[^\w\s]', '', str(btn_text).lower()).strip()
            if normalized not in system_names:
                custom.append({"label": btn_text, "type": "text", "enabled": True, "order": len(custom)})

    custom.sort(key=lambda b: b.get("order", 0))
    for i in range(0, len(custom), 3):
        button_row = []
        for btn in custom[i:i+3]:
            label = btn.get("label", "")
            if btn.get("type") == "url" and btn.get("url"):
                button_row.append(InlineKeyboardButton(text=label, url=btn["url"]))
            else:
                cb_data = re.sub(r'\s+', '_', re.sub(r'[^\w\s]', '', label).lower().strip())
                button_row.append(InlineKeyboardButton(text=label, callback_data=cb_data))
        if button_row:
            rows.append(button_row)

    # === FIXED SYSTEM ROWS (identical across all bots) ===

    rows.append([
        InlineKeyboardButton(text="🛍️ Shop", callback_data="shop"),
        InlineKeyboardButton(text=f"📦 Orders ({order_count})", callback_data="orders"),
    ])

    rows.append([
        InlineKeyboardButton(text="❤️ Wishlist", callback_data="view_wishlist"),
        InlineKeyboardButton(text=f"🛒 {cart_display}", callback_data="view_cart"),
    ])

    bottom = [InlineKeyboardButton(text="💬 Contact", callback_data="contact")]
    if vendor_pgp_key:
        bottom.append(InlineKeyboardButton(text="🔐 PGP", callback_data="pgp"))
    bottom.append(InlineKeyboardButton(text="ℹ️ About", callback_data="about"))
    rows.append(bottom)

    return rows
