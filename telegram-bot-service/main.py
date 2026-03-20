import asyncio
import os
import sys

# Log immediately so Coolify shows startup
print("Starting telegram-bot-service...", flush=True)

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand
from aiogram.fsm.storage.memory import MemoryStorage
from aiohttp import web
from dotenv import load_dotenv
from database.connection import connect_to_mongo, close_mongo_connection
from utils.bot_config import get_bot_config, ensure_bot_registered
from handlers import start, menu, products, payments, shop, orders, menu_inline, payouts, contact

# Configure stdout for UTF-8 to handle emojis on Windows
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

# Load .env file - ensure we're in the right directory
import pathlib
env_path = pathlib.Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)

BOT_TOKEN = os.getenv("BOT_TOKEN")
WEBHOOK_URL = os.getenv("WEBHOOK_URL")
WEBHOOK_PATH = "/webhook"

# Validate BOT_TOKEN
if not BOT_TOKEN or BOT_TOKEN == "your_telegram_bot_token_here" or BOT_TOKEN.strip() == "":
    print("ERROR: BOT_TOKEN is not set or is using placeholder value!")
    print("Please edit .env file and set your actual bot token from @BotFather")
    print("Format: BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz")
    exit(1)

# Initialize bot and dispatcher with FSM storage
storage = MemoryStorage()
bot = Bot(
    token=BOT_TOKEN,
    default=DefaultBotProperties(parse_mode=ParseMode.HTML)
)
dp = Dispatcher(storage=storage)

# Middleware to log all incoming updates
from aiogram import BaseMiddleware
from aiogram.types import Update, Message, CallbackQuery

class LoggingMiddleware(BaseMiddleware):
    async def __call__(self, handler, event, data):
        # Log the update based on event type
        if isinstance(event, Message):
            msg = event
            user_id = msg.from_user.id if msg.from_user else "Unknown"
            username = msg.from_user.username if msg.from_user and msg.from_user.username else "No username"
            
            if msg.text:
                text_safe = msg.text[:100]  # Limit length for logging
                # Remove emojis for Windows console compatibility
                import re
                text_safe = re.sub(r'[^\w\s\.,!?\-]', '', text_safe)
                print(f"[MESSAGE] User {user_id} (@{username}): {text_safe}")
            elif msg.photo:
                print(f"[MESSAGE] User {user_id} (@{username}): Sent a photo")
            elif msg.document:
                print(f"[MESSAGE] User {user_id} (@{username}): Sent a document")
            else:
                print(f"[MESSAGE] User {user_id} (@{username}): Sent other media")
        
        elif isinstance(event, CallbackQuery):
            cb = event
            user_id = cb.from_user.id if cb.from_user else "Unknown"
            username = cb.from_user.username if cb.from_user and cb.from_user.username else "No username"
            data_safe = cb.data[:100] if cb.data else "No data"
            print(f"[CALLBACK] User {user_id} (@{username}): {data_safe}")
        
        # Continue processing
        return await handler(event, data)

# Register middleware on dispatcher (global)
dp.message.middleware(LoggingMiddleware())
dp.callback_query.middleware(LoggingMiddleware())

# Register routers (order matters - more specific handlers first)
dp.include_router(contact.router)  # Contact handler FIRST to ensure contact callback is caught before any catch-all
dp.include_router(start.router)  # Commands like /start, /menu, /refresh
dp.include_router(shop.router)  # Shop handlers including address input (before menu to catch address input)
dp.include_router(orders.router)  # Orders handler (before menu_inline to catch order callbacks)
dp.include_router(menu.router)  # Menu button handlers
dp.include_router(menu_inline.router)  # Menu inline buttons handler (catch-all, should be last)
dp.include_router(products.router)


async def on_startup(bot: Bot):
    """Initialize on startup"""
    await connect_to_mongo()

    # Create performance indexes (idempotent - safe on every startup)
    from scripts.create_indexes import ensure_indexes
    from database.connection import get_database as _get_db
    try:
        await ensure_indexes(_get_db())
    except Exception as e:
        print(f"Warning: Index creation had errors: {e}", flush=True)
    
    # Get or auto-create bot config in database
    bot_config = await ensure_bot_registered()
    if not bot_config:
        print("=" * 60)
        print("⚠️  WARNING: Bot configuration not found in database!")
        print("=" * 60)
        print(f"The BOT_TOKEN from .env file does not match any bot in the database.")
        print(f"BOT_TOKEN being used: {BOT_TOKEN[:20]}..." if BOT_TOKEN else "BOT_TOKEN is not set")
        print("\nTo fix this:")
        print("1. Check that you've created a bot in the admin panel")
        print("2. Update the .env file with the correct BOT_TOKEN for that bot")
        print("3. Make sure the token matches exactly (including any colons)")
        print("\nThe bot will still start, but features requiring bot config may not work.")
        print("=" * 60)
    
    # Set bot commands menu (replaces paperclip icon)
    try:
        if bot_config:
            main_buttons = bot_config.get("main_buttons", [])
            commands = []
            
            # Always include /menu and /start commands
            commands.append(BotCommand(command="start", description="Start the bot"))
            commands.append(BotCommand(command="menu", description="Show menu"))
            commands.append(BotCommand(command="wishlist", description="View your wishlist"))
            commands.append(BotCommand(command="reviews", description="View all customer reviews"))
            commands.append(BotCommand(command="about", description="About this vendor"))
            
            # Add main buttons as commands
            if main_buttons and isinstance(main_buttons, list):
                # Filter out empty strings
                main_buttons = [btn for btn in main_buttons if btn and btn.strip()]
                
                for button in main_buttons[:5]:  # Telegram allows max 3 rows, 2 commands per row = 6 commands (we use 3 for start/menu/wishlist, so 3 left)
                    if isinstance(button, str):
                        # Map button text to command - strip emojis and handle multiple spaces
                        import re
                        # Strip emojis and special chars, keep only alphanumeric and spaces
                        button_clean = re.sub(r'[^\w\s]', '', button)
                        button_lower = button_clean.lower().strip()
                        command = re.sub(r'\s+', '_', button_lower)
                        
                        # Skip if command is start, menu, or wishlist (already added) or if command is empty
                        if command and command not in ["start", "menu", "wishlist"]:
                            description = button  # Keep original button text with emojis for description
                            commands.append(BotCommand(command=command, description=description))
                    
                    # Debug logging (strip emojis for Windows console compatibility)
                    import re
                    main_buttons_safe = [re.sub(r'[^\w\s]', '', btn) for btn in main_buttons] if isinstance(main_buttons, list) else []
                    print(f"[STARTUP] Main buttons from config: {main_buttons_safe}")
                    print(f"[STARTUP] Commands being registered: {[cmd.command for cmd in commands]}")
            
            try:
                await bot.set_my_commands(commands)
                print(f"Bot menu commands set: {[cmd.command for cmd in commands]}")
            except Exception as e:
                print(f"Warning: Could not set bot commands: {e}")
        else:
            # Set default commands if bot config not available
            default_commands = [
                BotCommand(command="start", description="Start the bot"),
                BotCommand(command="menu", description="Show menu"),
                BotCommand(command="orders", description="View orders"),
            ]
            try:
                await bot.set_my_commands(default_commands)
                print("Bot menu commands set (default)")
            except Exception as e:
                print(f"Warning: Could not set bot commands: {e}")
    except Exception as e:
        print(f"Error setting up bot commands menu: {e}")
        import traceback
        traceback.print_exc()
        # Set minimal default commands even if config fetch fails
        try:
            default_commands = [
                BotCommand(command="start", description="Start the bot"),
                BotCommand(command="menu", description="Show menu"),
            ]
            await bot.set_my_commands(default_commands)
            print("Bot menu commands set (fallback)")
        except:
            pass
    
    # For local development: Always use polling mode for Telegram bot updates
    # Webhook URL is only used for payment callbacks (CryptAPI, etc.), not Telegram updates
    # This allows commands to work immediately without webhook issues
    
    # Clear any existing webhook to ensure polling mode works
    try:
        await bot.delete_webhook(drop_pending_updates=True)
        print("✓ Cleared any existing Telegram webhook (using polling mode)")
    except Exception as e:
        print(f"Note: Could not clear webhook (may not exist): {e}")
    
    print("Running in polling mode for Telegram bot updates (commands will work immediately)")
    print(f"Payment webhooks available at: http://localhost:8000/payment/webhook")
    if WEBHOOK_URL and WEBHOOK_URL.startswith("https://"):
        print(f"External payment webhook URL: {WEBHOOK_URL}/payment/cryptapi-webhook")


async def on_shutdown(bot: Bot):
    """Cleanup on shutdown"""
    await close_mongo_connection()
    
    # Remove webhook only if it was set (HTTPS)
    if WEBHOOK_URL and WEBHOOK_URL.startswith("https://"):
        try:
            await bot.delete_webhook()
        except:
            pass


async def webhook_handler(request: web.Request):
    """Handle webhook requests"""
    from aiogram.types import Update
    
    # Get update from request
    data = await request.json()
    update = Update(**data)
    
    # Process update
    await dp.feed_update(bot, update)
    
    return web.Response()


async def main():
    """Main entry point"""
    # Create aiohttp application
    app = web.Application()
    
    # Setup payment webhook (always available for local testing)
    payments.setup_webhook(app)
    
    # Setup payout routes
    payouts.setup_payout_routes(app)
    
    # Startup and shutdown handlers
    async def startup_handler(app):
        await on_startup(bot)
        # Start the order scheduler for auto-transitions (expire, auto-deliver, auto-complete)
        from services.order_scheduler import run_order_scheduler
        asyncio.create_task(run_order_scheduler())
    
    async def shutdown_handler(app):
        await on_shutdown(bot)
    
    app.on_startup.append(startup_handler)
    app.on_shutdown.append(shutdown_handler)
    
    # Setup bot webhook handler if WEBHOOK_URL is set and is HTTPS
    # Don't register Telegram webhook handler - we're using polling mode for local dev
    # Payment webhooks are handled separately via payments.setup_webhook()
    # if WEBHOOK_URL and WEBHOOK_URL.startswith("https://"):
    #     app.router.add_post(WEBHOOK_PATH, webhook_handler)
    
    # Always start webhook server for local testing (even in polling mode)
    port = int(os.getenv("PORT", "8000"))
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", port)
    await site.start()
    print(f"Webhook server running on port {port}")
    print(f"Payment webhook endpoint: http://localhost:{port}/payment/webhook")
    
    # Always use polling mode for Telegram updates (webhook server is only for payment callbacks)
    # This ensures commands work immediately in local development
    print("Starting polling mode for Telegram bot updates (commands will work immediately)")
    
    # Run polling in background task
    async def polling_task():
        try:
            # Get bot config (already ensured in on_startup)
            bot_config = await get_bot_config()
            if not bot_config:
                print("\n" + "=" * 60)
                print("❌ ERROR: Cannot start bot - configuration not found!")
                print("=" * 60)
                print("The BOT_TOKEN in .env does not match any bot in the database.")
                print(f"Token being used: {BOT_TOKEN[:30]}..." if BOT_TOKEN else "No token found")
                print("\nTo fix:")
                print("1. Go to Admin Panel → Bots")
                print("2. Find the bot you want to run")
                print("3. Copy its token")
                print("4. Update BOT_TOKEN in telegram-bot-service/.env file")
                print("5. Restart the bot service")
                print("=" * 60 + "\n")
                return  # Don't start polling if bot config not found
            
            print(f"✓ Bot configuration found: {bot_config.get('name', 'Unnamed')}")
            await dp.start_polling(bot)
        except Exception as e:
            print(f"Error during polling: {e}")
            import traceback
            traceback.print_exc()
        finally:
            await on_shutdown(bot)
    
    asyncio.create_task(polling_task())
    
    # Keep running
    try:
        await asyncio.Event().wait()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    asyncio.run(main())
