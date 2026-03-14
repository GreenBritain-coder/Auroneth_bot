import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/telegram_bot_platform")
client = None
db = None


async def connect_to_mongo():
    """Initialize MongoDB connection"""
    global client, db
    print("Connecting to MongoDB...", flush=True)
    try:
        client = AsyncIOMotorClient(MONGO_URI)
        db = client.get_database()
        print("Connected to MongoDB", flush=True)
        await _ensure_reviews_indexes()
    except Exception as e:
        print(f"MongoDB connection failed: {e}", flush=True)
        raise


async def _ensure_reviews_indexes():
    """Create indexes on reviews collection for product_ids, order_id, and bot_id."""
    try:
        reviews = db.reviews
        await reviews.create_index("order_id", unique=True, sparse=True)
        await reviews.create_index("product_ids")
        await reviews.create_index("product_id")
        await reviews.create_index("bot_id")
    except Exception as e:
        print(f"Warning: Could not create reviews indexes: {e}", flush=True)


async def close_mongo_connection():
    """Close MongoDB connection"""
    global client
    if client:
        client.close()
        print("Disconnected from MongoDB")


def get_database():
    """Get database instance"""
    return db

