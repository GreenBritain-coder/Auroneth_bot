"""
Utility functions for fetching bot configuration from MongoDB.
Ensures fresh data on every request (no caching).
"""
import os
from dotenv import load_dotenv
from database.connection import get_database


# Cache bot token to avoid loading .env repeatedly
_cached_bot_token = None


def get_bot_token():
    """Get bot token from environment, with caching"""
    global _cached_bot_token
    if _cached_bot_token is None:
        import pathlib
        env_path = pathlib.Path(__file__).parent.parent / ".env"
        load_dotenv(dotenv_path=env_path)
        _cached_bot_token = os.getenv("BOT_TOKEN")
    return _cached_bot_token


async def get_bot_config():
    """
    Get current bot configuration from MongoDB.
    Always fetches fresh data (no caching) to ensure real-time updates.
    """
    bot_token = get_bot_token()
    if not bot_token:
        return None
    
    db = get_database()
    if db is None:
        return None
    
    bots_collection = db.bots
    bot_config = await bots_collection.find_one({"token": bot_token})
    return bot_config


async def get_bot_config_cached():
    """
    Get bot configuration with caching (for performance-critical paths).
    Note: Use get_bot_config() for most cases to ensure fresh data.
    """
    # For now, just return fresh data (can add caching later if needed)
    return await get_bot_config()


async def ensure_bot_registered():
    """
    If no bot exists for BOT_TOKEN, auto-create a minimal bot record.
    Allows the bot to start when admin panel uses a different database.
    """
    bot_config = await get_bot_config()
    if bot_config:
        return bot_config

    bot_token = get_bot_token()
    db = get_database()
    if not bot_token or db is None:
        return None

    bots_collection = db.bots
    from bson import ObjectId
    new_bot = {
        "_id": ObjectId(),
        "token": bot_token.strip(),
        "name": "Bot",
        "description": "",
        "main_buttons": [],
        "inline_buttons": {},
        "products": [],
        "status": "live",
        "public_listing": True,
        "payment_methods": ["BTC", "LTC"],
    }
    await bots_collection.insert_one(new_bot)
    new_bot["_id"] = str(new_bot["_id"])
    print("Auto-registered bot in database (was not found)", flush=True)
    return new_bot

