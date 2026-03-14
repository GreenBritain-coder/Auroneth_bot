import random
import string
from database.connection import get_database


async def generate_unique_secret_phrase() -> str:
    """Generate a unique secret phrase (5 repeated characters)"""
    db = get_database()
    users_collection = db.users
    
    while True:
        # Generate 5 repeated characters (e.g., "Hhhhh", "Kkkkk")
        letter = random.choice(string.ascii_uppercase)
        phrase = letter + letter.lower() * 4  # e.g., "Hhhhh"
        
        # Check if phrase already exists
        existing = await users_collection.find_one({"secret_phrase": phrase})
        if not existing:
            return phrase


async def get_or_create_user_secret_phrase(telegram_user_id: str, bot_id: str) -> str:
    """Get existing secret phrase or create new one for user"""
    db = get_database()
    users_collection = db.users
    
    # Check if user exists
    user = await users_collection.find_one({"_id": telegram_user_id})
    
    if user:
        return user["secret_phrase"]
    else:
        # Create new user with secret phrase
        secret_phrase = await generate_unique_secret_phrase()
        from datetime import datetime
        
        new_user = {
            "_id": telegram_user_id,
            "secret_phrase": secret_phrase,
            "first_bot_id": bot_id,
            "created_at": datetime.utcnow()
        }
        
        await users_collection.insert_one(new_user)
        return secret_phrase

