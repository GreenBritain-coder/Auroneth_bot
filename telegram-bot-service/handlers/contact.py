import re

from aiogram import Router, F
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton, ReplyKeyboardRemove, CallbackQuery, BufferedInputFile
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from database.connection import get_database
from utils.bot_config import get_bot_config
from utils.callback_utils import safe_answer_callback
from datetime import datetime
import uuid

router = Router()


class ContactStates(StatesGroup):
    waiting_for_message = State()


@router.message(Command("contact"))
async def handle_contact_command(message: Message, state: FSMContext):
    """Handle /contact command"""
    await handle_contact_start(message, state)


@router.callback_query(F.data == "contact")
async def handle_contact_callback(callback: CallbackQuery, state: FSMContext):
    """Handle contact button callback"""
    print(f"[CONTACT CALLBACK] Button clicked - user: {callback.from_user.id if callback.from_user else 'None'}", flush=True)
    
    try:
        # Handle case where callback.message might be None (old messages)
        if not callback.message:
            await safe_answer_callback(callback, "❌ Message not found. Please use /contact command or /start first.", show_alert=True)
            return
        
        await safe_answer_callback(callback)
        
        # Use callback.from_user instead of callback.message.from_user
        # callback.from_user is always the user who clicked the button
        # Ensure we have a user
        if not callback.from_user:
            await callback.message.answer("❌ Could not identify user.", reply_markup=ReplyKeyboardRemove())
            return
        
        # Verify user exists in database before proceeding (try both string and int _id for compatibility)
        db = get_database()
        if db is None:
            print("[CONTACT CALLBACK] ERROR: Database not connected", flush=True)
            await callback.message.answer("❌ Database not ready. Please try again in a moment.", reply_markup=ReplyKeyboardRemove())
            return
        users_collection = db.users
        telegram_user_id = str(callback.from_user.id)
        
        user = await users_collection.find_one({"_id": telegram_user_id})
        if not user:
            user = await users_collection.find_one({"_id": callback.from_user.id})
        if not user:
            print(f"[CONTACT CALLBACK] User not found: {telegram_user_id}")
            await callback.message.answer("❌ Please use /start first to set up your account.", reply_markup=ReplyKeyboardRemove())
            return
        
        print(f"[CONTACT CALLBACK] User found, proceeding with handle_contact_start")
        # Proceed with contact handler using callback's message
        await handle_contact_start(callback.message, state, user_id=telegram_user_id)
    except Exception as e:
        print(f"[CONTACT CALLBACK] Error: {e}")
        import traceback
        traceback.print_exc()
        try:
            await callback.message.answer("❌ Error opening contact. Try /contact or /start first.", reply_markup=ReplyKeyboardRemove())
        except Exception:
            await safe_answer_callback(callback, "❌ Error opening contact.", show_alert=True)


def _escape_html(text: str) -> str:
    """Escape HTML special chars for Telegram HTML parse_mode"""
    if not text:
        return ""
    import html
    return html.escape(str(text))


async def handle_contact_start(message: Message, state: FSMContext, user_id: str = None):
    """Handle contact button/command - show contact interface"""
    
    db = get_database()
    if db is None:
        await message.answer("❌ Database not ready. Please try again in a moment.", reply_markup=ReplyKeyboardRemove())
        return
    users_collection = db.users
    # Use provided user_id if available, otherwise use message.from_user.id
    telegram_user_id = user_id if user_id else str(message.from_user.id)
    
    # Get user data
    user = await users_collection.find_one({"_id": telegram_user_id})
    if not user:
        await message.answer("❌ Please use /start first to set up your account.", reply_markup=ReplyKeyboardRemove())
        return
    
    # Get bot config
    bot_config = await get_bot_config()
    if not bot_config:
        await message.answer("❌ Bot configuration not found.", reply_markup=ReplyKeyboardRemove())
        return
    
    secret_phrase = user.get("secret_phrase", "Not set")
    
    # Get last seen timestamp
    last_seen_text = "Never"
    if user.get("last_seen"):
        last_seen_dt = user["last_seen"]
        if isinstance(last_seen_dt, str):
            from dateutil import parser
            last_seen_dt = parser.parse(last_seen_dt)
        last_seen_text = last_seen_dt.strftime("%b %d, %Y, %H:%M") if isinstance(last_seen_dt, datetime) else "Never"
    
    # Fetch conversation history
    contact_messages_collection = db.contact_messages
    bot_id = str(bot_config["_id"])
    
    # Get recent messages for this user and bot
    recent_messages = await contact_messages_collection.find({
        "botId": bot_id,
        "userId": telegram_user_id
    }).sort("timestamp", -1).limit(20).to_list(length=20)
    
    # Build contact interface message (use HTML - escape user content)
    secret_phrase_escaped = _escape_html(str(secret_phrase))
    last_seen_escaped = _escape_html(str(last_seen_text))
    contact_message = "💬 <b>Contact Vendor</b>\n\n"
    contact_message += "Send messages to the chat. Be sure to check your secret phrase.\n\n"
    contact_message += f"<b>Phrase:</b> <code>{secret_phrase_escaped}</code>\n"
    contact_message += f"<b>Last seen:</b> {last_seen_escaped}\n\n"
    contact_message += "This is not a live chat. The seller will reply as soon as he reads your messages.\n\n"
    
    # Show conversation history if available
    if recent_messages:
        contact_message += "📜 <b>Conversation History:</b>\n\n"
        # Reverse to show oldest first
        for msg in reversed(recent_messages):
            msg_date = msg.get("timestamp")
            if isinstance(msg_date, str):
                from dateutil import parser
                msg_date = parser.parse(msg_date)
            date_str = msg_date.strftime("%Y-%m-%d %H:%M") if isinstance(msg_date, datetime) else str(msg_date)
            msg_text = _escape_html(str(msg.get('message', '')))
            contact_message += f"<b>[{_escape_html(date_str)}]</b>\n{msg_text}\n\n"
        contact_message += "───\n\n"
    
    contact_message += "Type your message below:"
    
    # Create keyboard with PGP key, close, and back to menu buttons
    keyboard_buttons = []
    
    # Add PGP key button if available
    vendor_pgp_key = bot_config.get("vendor_pgp_key", "")
    if vendor_pgp_key:
        keyboard_buttons.append([InlineKeyboardButton(text="🔐 Vendor PGP Key", callback_data="contact_pgp_key")])
    
    keyboard_buttons.append([
        InlineKeyboardButton(text="❌ Close Chat", callback_data="contact_close"),
        InlineKeyboardButton(text="📋 Back to Menu", callback_data="menu")
    ])
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)
    
    try:
        await message.answer(contact_message, parse_mode="HTML", reply_markup=keyboard)
    except Exception as send_err:
        print(f"[CONTACT] HTML send failed: {send_err}", flush=True)
        contact_message_plain = contact_message.replace('<b>', '').replace('</b>', '').replace('<code>', '').replace('</code>', '')
        await message.answer(contact_message_plain, reply_markup=keyboard)
    
    # Set state to wait for message
    await state.set_state(ContactStates.waiting_for_message)
    await state.update_data(bot_id=str(bot_config["_id"]))
    print(f"[CONTACT] State set - user_id: {telegram_user_id}, bot_id: {str(bot_config['_id'])}")


@router.callback_query(F.data == "pgp")
async def handle_pgp_download(callback: CallbackQuery):
    """Send vendor PGP key as downloadable .txt file"""
    await safe_answer_callback(callback)
    bot_config = await get_bot_config()
    if not bot_config:
        await callback.message.answer("❌ Bot configuration not found.")
        return
    vendor_pgp_key = bot_config.get("vendor_pgp_key", "")
    if not vendor_pgp_key:
        await callback.message.answer("❌ Vendor PGP key not configured.")
        return
    bot_name = bot_config.get("name", "Bot")
    safe_name = re.sub(r'[^\w\-]', '_', bot_name).strip('_') or "bot"
    filename = f"{safe_name}_auroneth.txt"
    file_bytes = vendor_pgp_key.encode("utf-8")
    input_file = BufferedInputFile(file_bytes, filename=filename)
    await callback.message.answer_document(input_file, caption="Public PGP key")


@router.callback_query(F.data == "contact_pgp_key")
async def handle_show_pgp_key(callback: CallbackQuery):
    """Show vendor PGP key"""
    await safe_answer_callback(callback)
    
    bot_config = await get_bot_config()
    if not bot_config:
        await callback.message.answer("❌ Bot configuration not found.")
        return
    
    vendor_pgp_key = bot_config.get("vendor_pgp_key", "")
    if not vendor_pgp_key:
        await callback.message.answer("❌ Vendor PGP key not configured.")
        return
    
    # Send PGP key as a text document
    pgp_message = "🔐 *Vendor PGP Key*\n\n"
    pgp_message += "```\n"
    pgp_message += vendor_pgp_key
    pgp_message += "\n```"
    
    await callback.message.answer(pgp_message, parse_mode="Markdown")


@router.callback_query(F.data == "contact_close")
async def handle_close_contact(callback: CallbackQuery, state: FSMContext):
    """Close contact chat"""
    print(f"[CONTACT CLOSE] Close button clicked - user: {callback.from_user.id if callback.from_user else 'None'}")
    await safe_answer_callback(callback)
    
    if callback.message:
        await callback.message.answer("✅ Contact chat closed.", reply_markup=ReplyKeyboardRemove())
    else:
        # If message is None, send via bot directly
        from aiogram import Bot
        from utils.bot_config import get_bot_config
        bot_config = await get_bot_config()
        if bot_config and callback.from_user:
            bot = Bot(token=bot_config["token"])
            await bot.send_message(
                chat_id=callback.from_user.id,
                text="✅ Contact chat closed.",
                reply_markup=ReplyKeyboardRemove()
            )
    
    await state.clear()
    print(f"[CONTACT CLOSE] State cleared for user: {callback.from_user.id if callback.from_user else 'None'}")


@router.message(ContactStates.waiting_for_message)
async def handle_contact_message(message: Message, state: FSMContext):
    """Handle contact message from user"""
    print(f"[CONTACT MESSAGE] Handler triggered - text: {message.text[:50] if message.text else 'None'}")
    
    # If user sends /start, /menu, or /contact - close contact chat and run that command
    if message.text and message.text.startswith("/"):
        cmd = message.text.split()[0].lower() if message.text else ""
        if cmd in ("/start", "/menu", "/contact"):
            print(f"[CONTACT MESSAGE] User sent {cmd} - closing contact and running command")
            await state.clear()
            if cmd == "/start":
                from handlers.start import cmd_start
                await cmd_start(message, state)
            elif cmd == "/menu":
                from handlers.start import cmd_menu
                await cmd_menu(message)
            elif cmd == "/contact":
                await handle_contact_start(message, state)
            return
        # Other commands - clear state and tell user to use /menu
        await state.clear()
        await message.answer("✅ Contact chat closed. Use /menu to see options.", reply_markup=ReplyKeyboardRemove())
        return
    
    db = get_database()
    contact_messages_collection = db.contact_messages
    users_collection = db.users
    telegram_user_id = str(message.from_user.id)
    
    # Get bot_id from state
    data = await state.get_data()
    bot_id = data.get("bot_id")
    
    print(f"[CONTACT MESSAGE] State data - bot_id: {bot_id}, user_id: {telegram_user_id}")
    
    if not bot_id:
        print(f"[CONTACT MESSAGE] ERROR: bot_id not found in state")
        await message.answer("❌ Error: Bot configuration not found. Please try /contact again.")
        await state.clear()
        return
    
    # Get user to verify they exist
    user = await users_collection.find_one({"_id": telegram_user_id})
    if not user:
        await message.answer("❌ Please use /start first to set up your account.")
        await state.clear()
        return
    
    # Get message text
    message_text = message.text or message.caption or ""
    if not message_text.strip():
        await message.answer("❌ Please send a text message.")
        return
    
    # Create contact message document
    message_id = str(uuid.uuid4())
    contact_message_doc = {
        "_id": message_id,
        "botId": bot_id,
        "userId": telegram_user_id,
        "message": message_text,
        "timestamp": datetime.utcnow(),
        "read": False
    }
    
    # Save to database
    print(f"[CONTACT MESSAGE] Saving message to database: {contact_message_doc}")
    result = await contact_messages_collection.insert_one(contact_message_doc)
    print(f"[CONTACT MESSAGE] Message saved with _id: {result.inserted_id}")
    
    # Confirm to user
    await message.answer(
        "✅ Your message has been sent to the vendor. They will reply as soon as they read it.\n\n"
        "You can continue sending messages, or close the chat using the button below.",
        reply_markup=ReplyKeyboardRemove()
    )
    
    # Show close button
    keyboard = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="❌ Close Chat", callback_data="contact_close")
    ]])
    await message.answer("👇", reply_markup=keyboard)

