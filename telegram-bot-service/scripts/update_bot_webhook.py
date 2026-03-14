"""
Update bot webhook URL in database to use Cloudflare tunnel
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
load_dotenv(env_path)


async def update_bot_webhook(bot_id: str, webhook_url: str):
    """Update bot webhook URL in database"""
    from bson import ObjectId
    
    mongodb_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/telegram_bot_platform")
    db_name = mongodb_uri.split('/')[-1].split('?')[0] if '/' in mongodb_uri else 'telegram_bot_platform'
    
    client = AsyncIOMotorClient(mongodb_uri)
    db = client[db_name]
    bots_collection = db.bots
    
    print(f"[INFO] Updating bot {bot_id} webhook URL to: {webhook_url}")
    
    # Try as ObjectId first, then as string
    try:
        bot_id_obj = ObjectId(bot_id)
        query = {"_id": bot_id_obj}
    except:
        query = {"_id": bot_id}
    
    # Check current value first
    bot = await bots_collection.find_one(query)
    if bot:
        print(f"[INFO] Current webhook_url: {bot.get('webhook_url', 'NOT SET')}")
    
    # Update the bot
    result = await bots_collection.update_one(
        query,
        {"$set": {"webhook_url": webhook_url}}
    )
    
    if result.modified_count > 0:
        print(f"[SUCCESS] Bot webhook URL updated successfully!")
        # Verify
        bot = await bots_collection.find_one({"_id": bot_id})
        print(f"[VERIFY] Current webhook_url: {bot.get('webhook_url')}")
    else:
        print(f"[WARNING] No changes made. Bot might not exist or webhook_url is already set to this value.")
    
    client.close()


async def main():
    if len(sys.argv) < 2:
        print("Usage: python scripts/update_bot_webhook.py <webhook_url> [bot_id]")
        print("Example: python scripts/update_bot_webhook.py https://fold-boss-examinations-des.trycloudflare.com")
        print("\nOr specify bot ID:")
        print("Example: python scripts/update_bot_webhook.py https://fold-boss-examinations-des.trycloudflare.com 690993fbc4b6b1a831aab750")
        sys.exit(1)
    
    webhook_url = sys.argv[1].strip().rstrip('/')
    bot_id = sys.argv[2] if len(sys.argv) > 2 else None
    
    mongodb_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/telegram_bot_platform")
    db_name = mongodb_uri.split('/')[-1].split('?')[0] if '/' in mongodb_uri else 'telegram_bot_platform'
    
    client = AsyncIOMotorClient(mongodb_uri)
    db = client[db_name]
    bots_collection = db.bots
    
    if bot_id:
        await update_bot_webhook(bot_id, webhook_url)
    else:
        # Find all bots and update
        bots = await bots_collection.find({}).to_list(None)
        if not bots:
            print("[ERROR] No bots found in database")
            client.close()
            return
        
        if len(bots) == 1:
            bot_id = str(bots[0]["_id"])
            await update_bot_webhook(bot_id, webhook_url)
        else:
            print(f"[INFO] Found {len(bots)} bots. Please specify bot_id:")
            for bot in bots:
                print(f"  - {bot.get('_id')}: {bot.get('username', 'N/A')} (webhook: {bot.get('webhook_url', 'not set')})")
    
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
