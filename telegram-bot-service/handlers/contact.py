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


async def _build_conversation_view(db, bot_id: str, telegram_user_id: str) -> str:
    """Query both contact_messages and contact_responses, merge by timestamp,
    return the last 10 as a threaded conversation string (HTML)."""
    contact_messages_collection = db.contact_messages
    contact_responses_collection = db.contact_responses

    # Fetch user messages
    user_msgs = await contact_messages_collection.find({
        "botId": bot_id,
        "userId": telegram_user_id
    }).sort("timestamp", -1).limit(4).to_list(length=4)

    # Fetch vendor responses
    vendor_msgs = await contact_responses_collection.find({
        "botId": bot_id,
        "userId": telegram_user_id
    }).sort("timestamp", -1).limit(4).to_list(length=4)

    # Tag each message with its sender
    merged = []
    for msg in user_msgs:
        merged.append({
            "sender": "user",
            "text": msg.get("message", ""),
            "timestamp": msg.get("timestamp"),
            "read": msg.get("read", False),
        })
    for msg in vendor_msgs:
        merged.append({
            "sender": "vendor",
            "text": msg.get("message", msg.get("response", "")),
            "timestamp": msg.get("timestamp"),
            "read": True,
        })

    # Sort by timestamp ascending and take last 10
    def _ts(item):
        ts = item["timestamp"]
        if isinstance(ts, str):
            from dateutil import parser as dp
            try:
                return dp.parse(ts)
            except Exception:
                return datetime.min
        return ts if isinstance(ts, datetime) else datetime.min

    merged.sort(key=_ts)
    merged = merged[-4:]

    if not merged:
        return ""

    lines = []
    for item in merged:
        ts = item["timestamp"]
        if isinstance(ts, str):
            from dateutil import parser as dp
            try:
                ts = dp.parse(ts)
            except Exception:
                ts = None
        time_str = ts.strftime("%H:%M") if isinstance(ts, datetime) else "??:??"

        text_escaped = _escape_html(str(item["text"]))
        if item["sender"] == "user":
            # Status indicators: checkmark for sent, double for read
            status = " \u2713\u2713" if item["read"] else " \u2713"
            lines.append(f"<b>You ({time_str}):</b>{status}\n{text_escaped}")
        else:
            lines.append(f"<b>Vendor ({time_str}):</b>\n{text_escaped}")

    return "\n\n".join(lines)


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

    bot_id = str(bot_config["_id"])

    # Check if user has previous messages (for conditional secret phrase display)
    contact_messages_collection = db.contact_messages
    previous_msg_count = await contact_messages_collection.count_documents({
        "botId": bot_id,
        "userId": telegram_user_id
    })

    # Build contact interface message (use HTML - escape user content)
    contact_message = "💬 <b>Contact Vendor</b>\n\n"
    contact_message += "Send messages to the chat."

    # Only show secret phrase on first contact (no previous messages)
    if previous_msg_count == 0:
        secret_phrase = user.get("secret_phrase", "Not set")
        secret_phrase_escaped = _escape_html(str(secret_phrase))
        contact_message += " Be sure to check your secret phrase.\n\n"
        contact_message += f"<b>Phrase:</b> <code>{secret_phrase_escaped}</code>\n\n"
    else:
        contact_message += "\n\n"

    contact_message += "This is not a live chat. The seller will reply as soon as he reads your messages.\n\n"

    # Build unified conversation view
    conversation_view = await _build_conversation_view(db, bot_id, telegram_user_id)
    if conversation_view:
        contact_message += "📜 <b>Conversation:</b>\n\n"
        contact_message += conversation_view
        contact_message += "\n\n───\n\n"

    contact_message += "Type your message below:"

    # Create compact keyboard layout:
    # Row 1: PGP Key (if available) | Close Chat
    # Row 2: Menu
    keyboard_buttons = []

    vendor_pgp_key = bot_config.get("vendor_pgp_key", "")
    if vendor_pgp_key:
        keyboard_buttons.append([
            InlineKeyboardButton(text="🔐 PGP Key", callback_data="contact_pgp_key"),
            InlineKeyboardButton(text="❌ Close Chat", callback_data="contact_close"),
        ])
    else:
        keyboard_buttons.append([
            InlineKeyboardButton(text="❌ Close Chat", callback_data="contact_close"),
        ])

    keyboard_buttons.append([
        InlineKeyboardButton(text="📋 Menu", callback_data="menu"),
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
    await state.update_data(bot_id=bot_id)
    print(f"[CONTACT] State set - user_id: {telegram_user_id}, bot_id: {bot_id}")


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
    
    # Re-render the full conversation view so user sees their new message in context
    bot_config = await get_bot_config()
    conversation_view = await _build_conversation_view(db, bot_id, telegram_user_id)

    reply_text = "💬 <b>Contact Vendor</b>\n\n"
    if conversation_view:
        reply_text += conversation_view
        reply_text += "\n\n───\n\n"
    reply_text += "Type your message below:"

    # Compact keyboard
    keyboard_buttons = []
    vendor_pgp_key = bot_config.get("vendor_pgp_key", "") if bot_config else ""
    if vendor_pgp_key:
        keyboard_buttons.append([
            InlineKeyboardButton(text="🔐 PGP Key", callback_data="contact_pgp_key"),
            InlineKeyboardButton(text="❌ Close Chat", callback_data="contact_close"),
        ])
    else:
        keyboard_buttons.append([
            InlineKeyboardButton(text="❌ Close Chat", callback_data="contact_close"),
        ])
    keyboard_buttons.append([
        InlineKeyboardButton(text="📋 Menu", callback_data="menu"),
    ])
    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)

    try:
        await message.answer(reply_text, parse_mode="HTML", reply_markup=keyboard)
    except Exception:
        reply_plain = reply_text.replace('<b>', '').replace('</b>', '').replace('<code>', '').replace('</code>', '')
        await message.answer(reply_plain, reply_markup=keyboard)

