from aiogram import Router, F
from aiogram.types import Message, ReplyKeyboardMarkup, KeyboardButton, InlineKeyboardMarkup, InlineKeyboardButton, ReplyKeyboardRemove, CallbackQuery
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from database.connection import get_database
from utils.secret_phrase import get_or_create_user_secret_phrase
from utils.bot_config import get_bot_config
from utils.callback_utils import safe_answer_callback

router = Router()


class SecretPhraseStates(StatesGroup):
    waiting_for_secret_phrase = State()


class VerificationStates(StatesGroup):
    showing_phrase = State()
    asking_auroneth_source = State()
    showing_warning = State()
    need_help = State()


@router.message(Command("start"))
async def cmd_start(message: Message, state: FSMContext):
    """Handle /start command with secret phrase system"""
    db = get_database()
    telegram_user_id = str(message.from_user.id)
    
    # Get bot config - always fetches fresh from MongoDB
    bot_config = await get_bot_config()
    
    if not bot_config:
        await message.answer("❌ Bot configuration not found. Please contact administrator.")
        return
    
    bot_id = bot_config["_id"]
    
    # Check if user already exists
    users_collection = db.users
    user = await users_collection.find_one({"_id": telegram_user_id})
    
    if user and user.get("secret_phrase"):
        # User already has a secret phrase
        secret_phrase = user["secret_phrase"]
        # Update last_seen timestamp
        from datetime import datetime
        await users_collection.update_one(
            {"_id": telegram_user_id},
            {"$set": {"last_seen": datetime.utcnow()}}
        )
        
        # Check if user has completed verification
        if user.get("verification_completed"):
            # User completed verification, show welcome message
            await show_welcome_message(message, bot_config, secret_phrase, user)
        else:
            # User hasn't completed verification, show phrase and start verification flow
            await show_secret_phrase_verification(message, bot_config, secret_phrase, user, state)
    else:
        # New user - ask them to enter their secret phrase
        await state.set_state(SecretPhraseStates.waiting_for_secret_phrase)
        await state.update_data(bot_id=bot_id)
        # Remove keyboard for new users too
        await message.answer(
            "🔐 *Welcome!*\n\n"
            "Please enter your secret phrase to continue.\n\n"
            "This phrase will be used to verify your identity and protect your data.",
            parse_mode="Markdown",
            reply_markup=ReplyKeyboardRemove()
        )


@router.message(SecretPhraseStates.waiting_for_secret_phrase)
async def handle_secret_phrase_input(message: Message, state: FSMContext):
    """Handle secret phrase input from new user"""
    secret_phrase = message.text.strip()
    
    # Validate secret phrase (basic validation - can be enhanced)
    if len(secret_phrase) < 3:
        await message.answer(
            "❌ Secret phrase is too short. Please enter a phrase with at least 3 characters."
        )
        return
    
    if len(secret_phrase) > 50:
        await message.answer(
            "❌ Secret phrase is too long. Please enter a phrase with no more than 50 characters."
        )
        return
    
    # Get bot_id from state
    data = await state.get_data()
    bot_id = data.get("bot_id")
    
    if not bot_id:
        await message.answer("❌ Error: Bot configuration not found. Please try /start again.")
        await state.clear()
        return
    
    # Save user with secret phrase
    db = get_database()
    users_collection = db.users
    telegram_user_id = str(message.from_user.id)
    
    from datetime import datetime
    
    user_doc = {
        "_id": telegram_user_id,
        "secret_phrase": secret_phrase,
        "first_bot_id": bot_id,
        "created_at": datetime.utcnow()
    }
    
    user_doc["last_seen"] = datetime.utcnow()
    await users_collection.update_one(
        {"_id": telegram_user_id},
        {"$set": user_doc},
        upsert=True
    )
    
    # Clear state
    await state.clear()
    
    # Get bot config and start verification flow
    bot_config = await get_bot_config()
    if bot_config:
        # Get updated user data
        updated_user = await users_collection.find_one({"_id": telegram_user_id})
        await show_secret_phrase_verification(message, bot_config, secret_phrase, updated_user or user_doc, state)
    else:
        # Remove keyboard even if bot config not found
        await message.answer("✅ Secret phrase saved! Welcome to the bot.", reply_markup=ReplyKeyboardRemove())


# Constants
AURONETH_BOT_OFFICIAL_URL = "https://auroneth.bot"


async def show_secret_phrase_verification(message: Message, bot_config: dict, secret_phrase: str, user: dict, state: FSMContext):
    """Show secret phrase and start verification flow"""
    from datetime import datetime
    
    # Get last seen timestamp
    last_seen_text = "Never"
    if user and user.get("last_seen"):
        last_seen_dt = user["last_seen"]
        if isinstance(last_seen_dt, str):
            from dateutil import parser
            last_seen_dt = parser.parse(last_seen_dt)
        last_seen_text = last_seen_dt.strftime("%b %d, %Y, %H:%M") if isinstance(last_seen_dt, datetime) else "Never"
    
    # Show secret phrase with warning
    phrase_message = f"🔐 *Your Secret Phrase*\n\n"
    phrase_message += f"`{secret_phrase}`\n\n"
    phrase_message += f"When you first started a legit Auroneth.Bot from the official website, this is the phrase you created.\n\n"
    phrase_message += f"If this is not the phrase, or if you had to set up a phrase, this may be a scam bot.\n\n"
    phrase_message += f"Last seen: {last_seen_text}"
    
    await state.set_state(VerificationStates.showing_phrase)
    await state.update_data(secret_phrase=secret_phrase)
    
    # Ask if they got the bot from Auroneth.bot
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="Yes", callback_data="verification_auroneth_yes"),
        InlineKeyboardButton(text="No", callback_data="verification_auroneth_no")
    ]])
    
    await message.answer(phrase_message, parse_mode="Markdown", reply_markup=ReplyKeyboardRemove())
    await message.answer(
        "Did you get the bot link from Auroneth.Bot?",
        reply_markup=keyboard
    )


@router.callback_query(F.data == "verification_auroneth_yes")
async def handle_auroneth_yes(callback: CallbackQuery, state: FSMContext):
    """Handle Yes response to Auroneth.bot question"""
    await safe_answer_callback(callback)
    await state.set_state(VerificationStates.showing_warning)
    await show_security_warning(callback.message, state)


@router.callback_query(F.data == "verification_auroneth_no")
async def handle_auroneth_no(callback: CallbackQuery, state: FSMContext):
    """Handle No response - redirect to Auroneth.bot"""
    await safe_answer_callback(callback)
    await callback.message.answer(
        f"⚠️ Please use the official Auroneth.Bot from the official website.\n\n"
        f"Visit: {AURONETH_BOT_OFFICIAL_URL}",
        reply_markup=ReplyKeyboardRemove()
    )
    await state.clear()


async def show_security_warning(message: Message, state: FSMContext):
    """Show security warning message"""
    warning_message = "✅ The phrase is saved. No legitimate bot will ever ask for the phrase again.\n\n"
    warning_message += "⚠️ *Security Warning*\n\n"
    warning_message += "Avoid all accounts messaging you privately. Payments are only accepted through this bot, "
    warning_message += "and the vendor can only be contacted via the contact button here. "
    warning_message += "If unsure, confirm with our community in public chat. "
    warning_message += "Do not trust or reply to anyone asking for payment or contact outside this bot."
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="I understand and agree", callback_data="verification_understand"),
        InlineKeyboardButton(text="Need more help", callback_data="verification_need_help")
    ]])
    
    await message.answer(warning_message, parse_mode="Markdown", reply_markup=keyboard)


@router.callback_query(F.data == "verification_understand")
async def handle_verification_understand(callback: CallbackQuery, state: FSMContext):
    """Handle I understand button - complete verification"""
    await safe_answer_callback(callback)
    
    db = get_database()
    users_collection = db.users
    telegram_user_id = str(callback.from_user.id)
    
    from datetime import datetime
    
    # Mark verification as completed
    await users_collection.update_one(
        {"_id": telegram_user_id},
        {"$set": {
            "verification_completed": True,
            "last_seen": datetime.utcnow()
        }}
    )
    
    # Get bot config and show welcome message
    bot_config = await get_bot_config()
    if bot_config:
        user = await users_collection.find_one({"_id": telegram_user_id})
        secret_phrase = user.get("secret_phrase") if user else ""
        await show_welcome_message(callback.message, bot_config, secret_phrase, user)
    else:
        await callback.message.answer("✅ Verification complete! Welcome to the bot.", reply_markup=ReplyKeyboardRemove())
    
    await state.clear()


@router.callback_query(F.data == "verification_need_help")
async def handle_verification_need_help(callback: CallbackQuery, state: FSMContext):
    """Handle Need more help - redirect to Auroneth.bot"""
    await safe_answer_callback(callback)
    await callback.message.answer(
        f"📞 For help and support, please visit the official Auroneth.Bot website:\n\n"
        f"{AURONETH_BOT_OFFICIAL_URL}\n\n"
        f"You can also check our community chat for assistance.",
        reply_markup=ReplyKeyboardRemove()
    )
    await state.clear()


async def show_welcome_message(message: Message, bot_config: dict, secret_phrase: str, user: dict = None):
    """Show welcome message with bot stats and information"""
    from datetime import datetime
    
    db = get_database()
    bot_name = bot_config.get("name", "Bot")
    
    # Get last seen timestamp
    last_seen_text = "Never"
    if user and user.get("last_seen"):
        last_seen_dt = user["last_seen"]
        if isinstance(last_seen_dt, str):
            from dateutil import parser
            last_seen_dt = parser.parse(last_seen_dt)
        last_seen_text = last_seen_dt.strftime("%b %d, %Y, %H:%M") if isinstance(last_seen_dt, datetime) else "Never"
    
    # Get routes from bot config
    routes = bot_config.get("routes", "Not specified")
    
    # Get currencies from orders or products
    orders_collection = db.orders
    orders = await orders_collection.find({"botId": str(bot_config["_id"])}).limit(100).to_list(length=100)
    currencies = set()
    for order in orders:
        if order.get("currency"):
            currencies.add(order.get("currency"))
    
    # If no currencies from orders, check products
    if not currencies:
        products_collection = db.products
        products = await products_collection.find({"bot_ids": str(bot_config["_id"])}).limit(100).to_list(length=100)
        for product in products:
            if product.get("currency"):
                currencies.add(product.get("currency"))
    
    currency_list = sorted(list(currencies)) if currencies else ["GBP", "EUR"]  # Default currencies
    currency_emojis = {
        "GBP": "💷",
        "EUR": "💶",
        "USD": "💵",
        "BTC": "₿"
    }
    currency_text = ", ".join([f"{c} {currency_emojis.get(c, '')}" for c in currency_list])
    
    # Get language
    language = bot_config.get("language", "English")
    
    # Calculate activity (total orders count)
    activity_count = await orders_collection.count_documents({"botId": str(bot_config["_id"])})
    
    # Rating from bot config
    rating = bot_config.get("rating", "96.81")
    rating_count = bot_config.get("rating_count", "7707")
    if rating and not rating.endswith("%"):
        rating = f"{rating}%"
    
    # Get cut-off time
    cut_off_time = bot_config.get("cut_off_time", "11:00 AM")
    
    # Get social links
    website_url = bot_config.get("website_url", "")
    instagram_url = bot_config.get("instagram_url", "")
    telegram_channel = bot_config.get("telegram_channel", "")
    telegram_group = bot_config.get("telegram_group", "")
    
    # Build welcome message
    welcome_parts = []
    
    # Stats section
    welcome_parts.append(f"Last seen : {last_seen_text} 🕖")
    welcome_parts.append(f"Routes : {routes} ⚡️")
    welcome_parts.append(f"Currency : {currency_text}")
    welcome_parts.append(f"Supported Methods : Details shown at checkout")
    welcome_parts.append(f"Language : {language}")
    welcome_parts.append("")
    welcome_parts.append(f"Activity : {activity_count} 🔥")
    welcome_parts.append(f"Rating : 🤩 {rating} ({rating_count})")
    welcome_parts.append("")
    welcome_parts.append(f"⏰ Confirm before {cut_off_time} and we'll dispatch the same day.")
    welcome_parts.append("﹎﹎﹎﹎﹎﹎﹎")
    welcome_parts.append("")
    
    # Main welcome message from config
    custom_welcome = bot_config.get("messages", {}).get("welcome", f"Welcome to {bot_name} self-service portal 🌱🌿🍃.\n\nStart with Help: /help and /userguide 📘.\n\nType /menu then open the Collections section, or just use /collections 📦.\n\nEnjoy your experience 🛍️")
    
    # Replace placeholders in welcome message
    if "{{secret_phrase}}" in custom_welcome:
        custom_welcome = custom_welcome.replace("{{secret_phrase}}", secret_phrase)
    if "{{bot_name}}" in custom_welcome:
        custom_welcome = custom_welcome.replace("{{bot_name}}", bot_name)
    
    # If no secret phrase in custom message, add warning
    if "secret phrase" not in custom_welcome.lower() and "{{secret_phrase}}" not in bot_config.get("messages", {}).get("welcome", ""):
        custom_welcome = f"⚠️ Your secret phrase: {secret_phrase}\n\nIf this is not your phrase, you may be on a scambot.\n\n{custom_welcome}"
    
    welcome_parts.append(custom_welcome)
    welcome_parts.append("")
    welcome_parts.append("﹎﹎﹎﹎﹎﹎﹎")
    welcome_parts.append("")
    
    # Social links
    if website_url:
        welcome_parts.append(f"Official Site : {website_url}")
    if instagram_url:
        welcome_parts.append(f"Follow : {instagram_url} 📸")
    if telegram_channel:
        welcome_parts.append(f"TG Channel : @{telegram_channel} 📢")
    if telegram_group:
        welcome_parts.append(f"TG Group : @{telegram_group}")
    
    welcome_parts.append("")
    welcome_parts.append(f"Peace and Love ✌️❤️")
    welcome_parts.append(f"{bot_name} ® Team")
    
    welcome_message = "\n".join(welcome_parts)
    
    # Always remove reply keyboard on /start
    reply_keyboard = ReplyKeyboardRemove()
    
    # Create inline keyboard with menu button
    inline_keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="📋 Open Menu", callback_data="menu")
    ]])
    
    # Send welcome message
    await message.answer(welcome_message, reply_markup=reply_keyboard)
    # Send menu button separately
    await message.answer("👇 Choose an option:", reply_markup=inline_keyboard)


@router.callback_query(F.data == "menu")
async def handle_menu_callback(callback: CallbackQuery):
    """Handle menu button click from welcome message - edit message to show menu directly"""
    await safe_answer_callback(callback)
    
    bot_config = await get_bot_config()
    if not bot_config:
        try:
            await callback.message.edit_text("❌ Bot configuration not found. Please contact administrator.")
        except:
            await callback.message.answer("❌ Bot configuration not found. Please contact administrator.")
        return
    
    # Get main menu buttons - filter out empty strings
    main_buttons = bot_config.get("main_buttons", [])
    main_buttons = [btn for btn in main_buttons if btn and btn.strip()] if isinstance(main_buttons, list) else []
    
    import re
    
    # Build menu text
    menu_text = "📋 *Main Menu*"
    
    # Create inline keyboard - Reviews first, then main_buttons, Orders/Wishlist/Cart and Contact/About at bottom
    inline_keyboard_buttons = []
    user_id = str(callback.from_user.id) if callback.from_user else ""
    bot_id = str(bot_config["_id"])
    from utils.bottom_menu import get_menu_stats
    order_count, cart_display = await get_menu_stats(user_id, bot_id)
    # First row: Reviews only
    inline_keyboard_buttons.append([
        InlineKeyboardButton(text="⭐ Reviews", callback_data="view_all_reviews")
    ])
    # Filter out Orders from main_buttons (we have it in bottom row with dynamic count)
    main_buttons_filtered = [b for b in main_buttons if re.sub(r'[^\w\s]', '', str(b).lower()).strip() != "orders"]
    if main_buttons_filtered and len(main_buttons_filtered) > 0:
        for i in range(0, len(main_buttons_filtered), 2):
            button_row = []
            button_text_clean = re.sub(r'[^\w\s]', '', main_buttons_filtered[i])
            callback_data_1 = re.sub(r'\s+', '_', button_text_clean.lower().strip())
            button_row.append(InlineKeyboardButton(
                text=main_buttons_filtered[i], 
                callback_data=callback_data_1
            ))
            if i + 1 < len(main_buttons_filtered):
                button_text_clean_2 = re.sub(r'[^\w\s]', '', main_buttons_filtered[i + 1])
                callback_data_2 = re.sub(r'\s+', '_', button_text_clean_2.lower().strip())
                button_row.append(InlineKeyboardButton(
                    text=main_buttons_filtered[i + 1], 
                    callback_data=callback_data_2
                ))
            inline_keyboard_buttons.append(button_row)
    # Bottom rows: Orders | Wishlist | Cart, then Contact | About
    inline_keyboard_buttons.append([
        InlineKeyboardButton(text=f"📦 Orders ({order_count})", callback_data="orders"),
        InlineKeyboardButton(text="❤️ Wishlist", callback_data="view_wishlist"),
        InlineKeyboardButton(text=f"🛒 {cart_display}", callback_data="view_cart"),
    ])
    inline_keyboard_buttons.append([
        InlineKeyboardButton(text="💬 Contact", callback_data="contact"),
        InlineKeyboardButton(text="ℹ️ About", callback_data="about"),
    ])
    
    # Edit the message to show menu directly
    if inline_keyboard_buttons:
        inline_keyboard = InlineKeyboardMarkup(inline_keyboard=inline_keyboard_buttons)
        try:
            await callback.message.edit_text(
                menu_text + "\n\n👇 Choose an option:",
                parse_mode="Markdown",
                reply_markup=inline_keyboard
            )
        except Exception as e:
            # If edit fails (e.g., message too different), send new message
            await callback.message.answer(menu_text, parse_mode="Markdown", reply_markup=ReplyKeyboardRemove())
            await callback.message.answer("👇 Choose an option:", reply_markup=inline_keyboard)
    else:
        # No active buttons configured, just show commands
        try:
            await callback.message.edit_text(menu_text, parse_mode="Markdown")
        except:
            await callback.message.answer(menu_text, parse_mode="Markdown", reply_markup=ReplyKeyboardRemove())


@router.callback_query(F.data == "about")
async def handle_about_callback(callback: CallbackQuery):
    """Handle About button - show vendor/bot info"""
    await safe_answer_callback(callback)
    
    bot_config = await get_bot_config()
    if not bot_config:
        try:
            await callback.message.answer("❌ Bot configuration not found.")
        except:
            pass
        return
    
    # Prefer custom "about" message, then bot description
    messages = bot_config.get("messages", {})
    about_text = messages.get("about", "").strip() or bot_config.get("description", "").strip()
    if not about_text:
        about_text = "ℹ️ About\n\nWelcome! This is a secure marketplace. Browse products, place orders, and contact the vendor through the Contact button."
    
    try:
        await callback.message.answer(about_text, parse_mode="Markdown")
    except Exception:
        try:
            await callback.message.answer(about_text)
        except Exception:
            await callback.message.answer("ℹ️ About\n\nWelcome! Browse products and use the Contact button for support.")


@router.message(Command("refresh"))
async def cmd_refresh(message: Message):
    """Refresh menu - removes keyboard buttons"""
    # Always remove reply keyboard on /refresh
    keyboard = ReplyKeyboardRemove()
    
    # Send message confirming keyboard removal
    await message.answer("✅ Keyboard refreshed! Reply keyboard has been removed. Use /menu to see inline buttons.", reply_markup=keyboard)


@router.message(Command("about"))
async def cmd_about(message: Message):
    """Handle /about command - show vendor/bot info"""
    bot_config = await get_bot_config()
    if not bot_config:
        await message.answer("❌ Bot configuration not found.", reply_markup=ReplyKeyboardRemove())
        return
    
    messages = bot_config.get("messages", {})
    about_text = messages.get("about", "").strip() or bot_config.get("description", "").strip()
    if not about_text:
        about_text = "ℹ️ About\n\nWelcome! This is a secure marketplace. Browse products, place orders, and contact the vendor through the Contact button."
    
    try:
        await message.answer(about_text, parse_mode="Markdown", reply_markup=ReplyKeyboardRemove())
    except Exception:
        try:
            await message.answer(about_text, reply_markup=ReplyKeyboardRemove())
        except Exception:
            await message.answer("ℹ️ About\n\nWelcome! Browse products and use the Contact button for support.", reply_markup=ReplyKeyboardRemove())


@router.message(Command("menu"))
async def cmd_menu(message: Message):
    """Show menu with all active buttons as inline buttons and available commands"""
    bot_config = await get_bot_config()
    
    if not bot_config:
        await message.answer("❌ Bot configuration not found. Please contact administrator.", reply_markup=ReplyKeyboardRemove())
        return
    
    # Get main menu buttons - filter out empty strings
    main_buttons = bot_config.get("main_buttons", [])
    main_buttons = [btn for btn in main_buttons if btn and btn.strip()] if isinstance(main_buttons, list) else []
    
    import re
    
    # Build menu text
    menu_text = "📋 *Main Menu*"
    
    # Create inline keyboard - Reviews first, then main_buttons, Orders/Wishlist/Cart and Contact/About at bottom
    inline_keyboard_buttons = []
    user_id = str(message.from_user.id) if message.from_user else ""
    bot_id = str(bot_config["_id"])
    from utils.bottom_menu import get_menu_stats
    order_count, cart_display = await get_menu_stats(user_id, bot_id)
    # First row: Reviews only
    inline_keyboard_buttons.append([
        InlineKeyboardButton(text="⭐ Reviews", callback_data="view_all_reviews")
    ])
    # Filter out Orders from main_buttons (we have it in bottom row with dynamic count)
    main_buttons_filtered = [b for b in main_buttons if re.sub(r'[^\w\s]', '', str(b).lower()).strip() != "orders"]
    if main_buttons_filtered and len(main_buttons_filtered) > 0:
        for i in range(0, len(main_buttons_filtered), 2):
            button_row = []
            button_text_clean = re.sub(r'[^\w\s]', '', main_buttons_filtered[i])
            callback_data_1 = re.sub(r'\s+', '_', button_text_clean.lower().strip())
            button_row.append(InlineKeyboardButton(
                text=main_buttons_filtered[i], 
                callback_data=callback_data_1
            ))
            if i + 1 < len(main_buttons_filtered):
                button_text_clean_2 = re.sub(r'[^\w\s]', '', main_buttons_filtered[i + 1])
                callback_data_2 = re.sub(r'\s+', '_', button_text_clean_2.lower().strip())
                button_row.append(InlineKeyboardButton(
                    text=main_buttons_filtered[i + 1], 
                    callback_data=callback_data_2
                ))
            inline_keyboard_buttons.append(button_row)
    # Bottom rows: Orders | Wishlist | Cart, then Contact | About
    inline_keyboard_buttons.append([
        InlineKeyboardButton(text=f"📦 Orders ({order_count})", callback_data="orders"),
        InlineKeyboardButton(text="❤️ Wishlist", callback_data="view_wishlist"),
        InlineKeyboardButton(text=f"🛒 {cart_display}", callback_data="view_cart"),
    ])
    inline_keyboard_buttons.append([
        InlineKeyboardButton(text="💬 Contact", callback_data="contact"),
        InlineKeyboardButton(text="ℹ️ About", callback_data="about"),
    ])
    
    # Show inline menu
    if inline_keyboard_buttons:
        inline_keyboard = InlineKeyboardMarkup(inline_keyboard=inline_keyboard_buttons)
        await message.answer(menu_text, parse_mode="Markdown", reply_markup=ReplyKeyboardRemove())
        await message.answer("👇 Choose an option:", reply_markup=inline_keyboard)
    else:
        await message.answer(menu_text, parse_mode="Markdown", reply_markup=ReplyKeyboardRemove())

