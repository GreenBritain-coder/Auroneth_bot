"""
Check database status - count orders, invoices, and show recent entries
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

# Load .env
env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
load_dotenv(env_path)


async def check_database():
    """Check database status"""
    mongodb_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/telegram_bot_platform")
    
    print(f"[INFO] Connecting to MongoDB...")
    client = AsyncIOMotorClient(mongodb_uri)
    # Extract database name from URI or use default
    # URI format: mongodb://host:port/database_name
    db_name = mongodb_uri.split('/')[-1].split('?')[0] if '/' in mongodb_uri else 'telegram_bot_platform'
    db = client[db_name]
    print(f"[INFO] Using database: {db_name}")
    
    orders_collection = db.orders
    invoices_collection = db.invoices
    
    # Count documents
    orders_count = await orders_collection.count_documents({})
    invoices_count = await invoices_collection.count_documents({})
    
    print(f"\n{'='*60}")
    print(f"DATABASE STATUS")
    print(f"{'='*60}\n")
    print(f"Orders: {orders_count}")
    print(f"Invoices: {invoices_count}")
    
    # Show recent orders
    if orders_count > 0:
        print(f"\nRECENT ORDERS (last 5):")
        recent_orders = await orders_collection.find().sort("timestamp", -1).limit(5).to_list(5)
        for order in recent_orders:
            print(f"  ID: {order.get('_id')}")
            print(f"    Status: {order.get('paymentStatus')}")
            print(f"    Amount: {order.get('amount')} {order.get('currency')}")
            print(f"    User: {order.get('userId')}")
            print(f"    Created: {order.get('timestamp')}")
            print()
    
    # Show recent invoices
    if invoices_count > 0:
        print(f"\nRECENT INVOICES (last 5):")
        recent_invoices = await invoices_collection.find().sort("created_at", -1).limit(5).to_list(5)
        for invoice in recent_invoices:
            print(f"  Invoice ID: {invoice.get('invoice_id')}")
            print(f"    Status: {invoice.get('status')}")
            print(f"    Total: {invoice.get('total')} {invoice.get('currency')}")
            print(f"    Payment Address: {invoice.get('payment_address')}")
            print(f"    Payment Amount: {invoice.get('payment_amount')} {invoice.get('payment_currency_code')}")
            print(f"    User: {invoice.get('user_id')}")
            print(f"    Created: {invoice.get('created_at')}")
            print()
    
    print(f"{'='*60}\n")
    
    client.close()


if __name__ == "__main__":
    asyncio.run(check_database())
