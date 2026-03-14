"""
Script to check user status and reset user account for testing
"""
import asyncio
import os
from dotenv import load_dotenv
from database.connection import connect_to_mongo, close_mongo_connection, get_database
from pathlib import Path

# Load .env file
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)


async def check_user_status(telegram_user_id: str):
    """Check if user exists and show their status"""
    await connect_to_mongo()
    db = get_database()
    users_collection = db.users
    
    user = await users_collection.find_one({"_id": telegram_user_id})
    
    if user:
        print(f"\n[USER FOUND]")
        print(f"User ID: {user.get('_id')}")
        print(f"Secret Phrase: {user.get('secret_phrase', 'NOT SET')}")
        print(f"First Bot ID: {user.get('first_bot_id')}")
        print(f"Created At: {user.get('created_at')}")
        return True
    else:
        print(f"\n[USER NOT FOUND]")
        print(f"User ID: {telegram_user_id} does not exist in database")
        print("This user will be prompted to enter a secret phrase when they use /start")
        return False


async def delete_user(telegram_user_id: str):
    """Delete user from database (for testing)"""
    await connect_to_mongo()
    db = get_database()
    users_collection = db.users
    
    result = await users_collection.delete_one({"_id": telegram_user_id})
    
    if result.deleted_count > 0:
        print(f"\n[SUCCESS] User {telegram_user_id} deleted from database")
        print("Next time they use /start, they will be prompted to enter a secret phrase")
    else:
        print(f"\n[NOT FOUND] User {telegram_user_id} was not found in database")


async def list_all_users():
    """List all users in the database"""
    await connect_to_mongo()
    db = get_database()
    users_collection = db.users
    
    users = await users_collection.find({}).to_list(length=100)
    
    if users:
        print(f"\n[FOUND {len(users)} USER(S)]")
        for user in users:
            print(f"\n  User ID: {user.get('_id')}")
            print(f"  Secret Phrase: {user.get('secret_phrase', 'NOT SET')}")
            print(f"  Created At: {user.get('created_at')}")
    else:
        print("\n[NO USERS FOUND] Database is empty")


async def main():
    print("=" * 60)
    print("USER STATUS CHECKER")
    print("=" * 60)
    
    # Get user ID from command line
    import sys
    if len(sys.argv) > 1:
        user_id = sys.argv[1]
        delete_flag = len(sys.argv) > 2 and sys.argv[2] == "--delete"
    else:
        print("\nUsage:")
        print("  py -3.12 check_user_status.py <user_id>          - Check user status")
        print("  py -3.12 check_user_status.py <user_id> --delete  - Delete user (for testing)")
        print("  py -3.12 check_user_status.py --list              - List all users")
        print("\nTo get your Telegram User ID:")
        print("  1. Start a chat with @userinfobot on Telegram")
        print("  2. It will show your User ID (a number like 123456789)")
        print("  3. Use that ID with this script")
        user_id = None
        delete_flag = False
    
    if len(sys.argv) > 1 and sys.argv[1] == "--list":
        await list_all_users()
    elif user_id:
        await check_user_status(user_id)
        
        if delete_flag:
            await delete_user(user_id)
        else:
            print("\nTip: To delete this user and test as new user, run:")
            print(f"  py -3.12 check_user_status.py {user_id} --delete")
    else:
        await list_all_users()
    
    await close_mongo_connection()


if __name__ == "__main__":
    asyncio.run(main())

