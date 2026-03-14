"""List all bots and their webhook URLs"""
import asyncio
import sys
import os
from bson import ObjectId

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
load_dotenv(env_path)


async def list_bots():
    """List all bots"""
    mongodb_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/telegram_bot_platform")
    db_name = mongodb_uri.split('/')[-1].split('?')[0] if '/' in mongodb_uri else 'telegram_bot_platform'
    
    client = AsyncIOMotorClient(mongodb_uri)
    db = client[db_name]
    bots_collection = db.bots
    
    bots = await bots_collection.find({}).to_list(None)
    
    print(f"\n{'='*60}")
    print(f"BOTS IN DATABASE")
    print(f"{'='*60}\n")
    
    if not bots:
        print("No bots found")
    else:
        for bot in bots:
            print(f"Bot ID: {bot.get('_id')}")
            print(f"  Type: {type(bot.get('_id'))}")
            print(f"  Username: {bot.get('username', 'N/A')}")
            print(f"  Webhook URL: {bot.get('webhook_url', 'NOT SET')}")
            print()
    
    client.close()


if __name__ == "__main__":
    asyncio.run(list_bots())
