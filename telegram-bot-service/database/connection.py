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
    client = AsyncIOMotorClient(MONGO_URI)
    db = client.get_database()
    print("Connected to MongoDB")


async def close_mongo_connection():
    """Close MongoDB connection"""
    global client
    if client:
        client.close()
        print("Disconnected from MongoDB")


def get_database():
    """Get database instance"""
    return db

