"""
Script to delete all orders from the database
WARNING: This will permanently delete all orders!
"""
import asyncio
import sys
import os
from pathlib import Path
from dotenv import load_dotenv

# Add parent directory to path to import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load .env file
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

from database.connection import connect_to_mongo, close_mongo_connection, get_database


async def delete_all_orders():
    """Delete all orders from the database"""
    await connect_to_mongo()
    db = get_database()
    if db is None:
        print("❌ Failed to connect to database")
        return
    
    orders_collection = db.orders
    
    # Count orders before deletion
    count = await orders_collection.count_documents({})
    print(f"Found {count} orders in the database")
    
    if count == 0:
        print("✅ No orders to delete")
        return
    
    # Confirm deletion
    print(f"\n⚠️  WARNING: This will delete ALL {count} orders!")
    response = input("Type 'DELETE ALL' to confirm: ")
    
    if response != "DELETE ALL":
        print("❌ Deletion cancelled")
        return
    
    # Delete all orders
    result = await orders_collection.delete_many({})
    print(f"✅ Successfully deleted {result.deleted_count} orders")
    
    # Verify deletion
    remaining = await orders_collection.count_documents({})
    if remaining == 0:
        print("✅ All orders have been deleted")
    else:
        print(f"⚠️  Warning: {remaining} orders still remain in database")
    
    await close_mongo_connection()


if __name__ == "__main__":
    print("=" * 50)
    print("DELETE ALL ORDERS SCRIPT")
    print("=" * 50)
    print()
    
    asyncio.run(delete_all_orders())
    
    print("\n" + "=" * 50)
    print("Script completed")
    print("=" * 50)

