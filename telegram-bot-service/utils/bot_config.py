"""
Utility functions for fetching bot configuration from MongoDB.
Uses a TTL cache (30 seconds) to avoid hitting the database on every request.
"""
import os
import time
from dotenv import load_dotenv
from database.connection import get_database


# Cache bot token to avoid loading .env repeatedly
_cached_bot_token = None

# TTL cache for bot config (30 seconds)
_config_cache = {"config": None, "expires": 0}
_CACHE_TTL = 30  # seconds


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
    Get current bot configuration from MongoDB with TTL caching.
    Caches for 30 seconds to avoid hitting DB on every handler call.
    """
    global _config_cache
    now = time.time()
    if _config_cache["config"] is not None and now < _config_cache["expires"]:
        return _config_cache["config"]

    bot_token = get_bot_token()
    if not bot_token:
        return None

    db = get_database()
    if db is None:
        return None

    bots_collection = db.bots
    bot_config = await bots_collection.find_one({"token": bot_token})
    _config_cache["config"] = bot_config
    _config_cache["expires"] = now + _CACHE_TTL
    return bot_config


def invalidate_bot_config_cache():
    """Force refresh on next get_bot_config() call."""
    global _config_cache
    _config_cache = {"config": None, "expires": 0}


async def get_bot_config_cached():
    """Alias for get_bot_config() (now cached by default)."""
    return await get_bot_config()


# TTL cache for dynamic vendor rating (60 seconds)
_rating_cache = {"data": None, "expires": 0}
_RATING_CACHE_TTL = 60  # seconds


async def get_dynamic_rating(bot_id: str):
    """
    Calculate vendor rating dynamically from the reviews collection.
    Returns dict with 'avg_rating' (float, 1-5 scale), 'rating_pct' (str, percentage),
    'count' (int), or None if no reviews exist.
    Cached for 60 seconds to avoid DB hits on every message.
    """
    global _rating_cache
    now = time.time()
    cache_key = str(bot_id)

    # Check cache
    if (_rating_cache["data"] is not None
            and _rating_cache.get("bot_id") == cache_key
            and now < _rating_cache["expires"]):
        return _rating_cache["data"]

    db = get_database()
    if db is None:
        return None

    reviews_collection = db.reviews
    review_docs = await reviews_collection.find({"bot_id": cache_key}).to_list(length=10000)

    # Also try ObjectId form if no results and ID looks like one
    if not review_docs and len(cache_key) == 24:
        try:
            from bson import ObjectId
            review_docs = await reviews_collection.find(
                {"bot_id": ObjectId(cache_key)}
            ).to_list(length=10000)
        except Exception:
            pass

    if not review_docs:
        result = None
    else:
        total = sum(r.get("rating", 0) for r in review_docs)
        count = len(review_docs)
        avg = total / count
        pct = f"{(avg / 5 * 100):.2f}%"
        result = {"avg_rating": avg, "rating_pct": pct, "count": count}

    _rating_cache = {"data": result, "bot_id": cache_key, "expires": now + _RATING_CACHE_TTL}
    return result


def invalidate_rating_cache():
    """Force refresh on next get_dynamic_rating() call."""
    global _rating_cache
    _rating_cache = {"data": None, "expires": 0}


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

