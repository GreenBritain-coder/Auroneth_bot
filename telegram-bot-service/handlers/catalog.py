"""
Catalog handlers: Category browsing, subcategory browsing, product listing within categories.
"""
from aiogram import Router, F
from aiogram.types import CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from database.connection import get_database
from utils.bot_config import get_bot_config
from utils.callback_utils import safe_answer_callback
from utils.shop_helpers import safe_edit_or_send

router = Router()


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
        await safe_edit_or_send(callback, no_categories_text)
        return

    await safe_edit_or_send(callback, shop_header, parse_mode="Markdown", reply_markup=keyboard)


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
            # Show product list as buttons with price range
            product_buttons = []
            for p in products:
                label = p["name"]
                product_buttons.append([InlineKeyboardButton(text=label, callback_data=f"product:{p['_id']}")])
            product_buttons.append([InlineKeyboardButton(text="⬅️ Back to Categories", callback_data="shop")])
            product_buttons.append([InlineKeyboardButton(text="📋 Back to Menu", callback_data="menu")])
            list_keyboard = InlineKeyboardMarkup(inline_keyboard=product_buttons)
            await safe_edit_or_send(
                callback,
                f"🛍️ *Products in {category_name}*\n\nSelect a product:",
                parse_mode="Markdown",
                reply_markup=list_keyboard
            )
            return
        back_keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="⬅️ Back to Categories", callback_data="shop")],
            [InlineKeyboardButton(text="⬅️ Back to Menu", callback_data="menu")]
        ])
        await safe_edit_or_send(
            callback,
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
    await safe_edit_or_send(callback, "📁 *Select a Subcategory*", parse_mode="Markdown", reply_markup=keyboard)


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
        await safe_edit_or_send(callback, "🛍️ No products available in this subcategory.")
        return

    # First, update the navigation message to show we're viewing products
    subcategory_collection = db.subcategories
    try:
        subcategory = await subcategory_collection.find_one({"_id": ObjectId(subcategory_id)})
    except Exception:
        subcategory = await subcategory_collection.find_one({"_id": subcategory_id})
    subcategory_name = subcategory.get("name", "Products") if subcategory else "Products"

    # Show product list as buttons with price range
    product_buttons = []
    for p in products:
        label = p["name"]
        product_buttons.append([InlineKeyboardButton(text=label, callback_data=f"product:{p['_id']}")])
    parent_category_id = (subcategory or {}).get("category_id", "")
    back_callback = f"category:{parent_category_id}" if parent_category_id else "shop"
    back_text = "⬅️ Back to Subcategories" if parent_category_id else "⬅️ Back to Categories"
    product_buttons.append([InlineKeyboardButton(text=back_text, callback_data=back_callback)])
    product_buttons.append([InlineKeyboardButton(text="📋 Back to Menu", callback_data="menu")])
    list_keyboard = InlineKeyboardMarkup(inline_keyboard=product_buttons)
    await safe_edit_or_send(
        callback,
        f"🛍️ *Products in {subcategory_name}*\n\nSelect a product:",
        parse_mode="Markdown",
        reply_markup=list_keyboard
    )
