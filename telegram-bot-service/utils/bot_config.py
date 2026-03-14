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

