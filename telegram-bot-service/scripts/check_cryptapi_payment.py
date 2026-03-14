"""
Check CryptAPI payment status for an order
This script queries the order and checks if the payment has been detected
"""
import asyncio
import sys
import os
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.connection import get_database
from dotenv import load_dotenv

# Load .env from telegram-bot-service directory
env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
load_dotenv(env_path)
print(f"[INFO] Loading .env from: {env_path}")
print(f"[INFO] .env exists: {os.path.exists(env_path)}")


async def check_payment_status(order_id: str):
    """Check CryptAPI payment status for an order"""
    from motor.motor_asyncio import AsyncIOMotorClient
    
    # Get MongoDB connection
    mongodb_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/telegram_bot_platform")
    if not mongodb_uri:
        print("[ERROR] MONGO_URI not found in .env file")
        return
    
    print(f"[INFO] Connecting to MongoDB...")
    client = AsyncIOMotorClient(mongodb_uri)
    # Extract database name from URI or use default
    # URI format: mongodb://host:port/database_name
    db_name = mongodb_uri.split('/')[-1].split('?')[0] if '/' in mongodb_uri else 'telegram_bot_platform'
    db = client[db_name]
    print(f"[INFO] Using database: {db_name}")
    
    orders_collection = db.orders
    invoices_collection = db.invoices
    
    print(f"\n{'='*60}")
    print(f"Checking payment status for Order ID: {order_id}")
    print(f"{'='*60}\n")
    
    # Find invoice first (it's more likely to have the order_id)
    invoice = await invoices_collection.find_one({"invoice_id": order_id})
    
    # Find order
    order = await orders_collection.find_one({"_id": order_id})
    
    if not order:
        print(f"[WARNING] Order not found: {order_id}")
        
        # Try to find recent orders
        print(f"\n[INFO] Looking for recent orders...")
        recent_orders = await orders_collection.find().sort("timestamp", -1).limit(5).to_list(5)
        if recent_orders:
            print(f"\nRecent orders found:")
            for ro in recent_orders:
                print(f"  - {ro.get('_id')} | Status: {ro.get('paymentStatus')} | User: {ro.get('userId')} | Amount: {ro.get('amount')} {ro.get('currency')}")
        
        if not invoice:
            print(f"\n[ERROR] Invoice also not found. Order/invoice {order_id} does not exist.")
            return
        else:
            print(f"\n[INFO] Invoice found, but order is missing. This is unusual.")
            print(f"[INFO] Showing invoice details only...")
    
    if not invoice:
        print(f"[WARNING] Invoice not found for order: {order_id}")
    
    # Display order info (if exists)
    if order:
        print("ORDER DETAILS:")
        print(f"  Order ID: {order['_id']}")
        print(f"  Bot ID: {order.get('botId')}")
        print(f"  User ID: {order.get('userId')}")
        print(f"  Amount: {order.get('amount')} {order.get('currency', 'N/A')}")
        print(f"  Status: {order.get('paymentStatus', 'unknown')}")
        print(f"  Created: {order.get('timestamp', 'N/A')}")
    
    if invoice:
        print(f"\nINVOICE DETAILS:")
        print(f"  Invoice ID: {invoice.get('invoice_id')}")
        print(f"  Status: {invoice.get('status')}")
        print(f"  Payment Address: {invoice.get('payment_address')}")
        print(f"  Payment Amount: {invoice.get('payment_amount')} {invoice.get('payment_currency_code', 'N/A')}")
        print(f"  Payment Provider: {invoice.get('payment_provider')}")
        print(f"  Exchange Rate: {invoice.get('payment_exchange_rate')}")
        print(f"  Deadline: {invoice.get('payment_deadline')}")
    
    if order and order.get('paymentStatus') == 'paid':
        print(f"\n[SUCCESS] Payment already confirmed!")
        payment_details = order.get('paymentDetails', {})
        if payment_details:
            print(f"  Status: {payment_details.get('status')}")
            print(f"  Value Paid: {payment_details.get('value_paid')}")
            print(f"  Value Coin: {payment_details.get('value_coin')}")
    elif order:
        print(f"\n[PENDING] Payment still pending")
        print(f"\nTROUBLESHOOTING:")
        print(f"  1. Check if payment was sent to: {invoice.get('payment_address') if invoice else 'N/A'}")
        print(f"  2. Verify exact amount was sent: {invoice.get('payment_amount') if invoice else 'N/A'} {invoice.get('payment_currency_code') if invoice else 'N/A'}")
        print(f"  3. Check blockchain confirmations (CryptAPI requires 1 confirmation for {order.get('currency', 'crypto')})")
        print(f"  4. Verify webhook URL is configured: {os.getenv('WEBHOOK_URL', 'NOT SET')}")
        print(f"  5. Check if payment amount matches exactly (exchanges may deduct fees)")
        print(f"\n  If payment was sent correctly:")
        print(f"    - CryptAPI will automatically call the webhook when payment is confirmed")
        print(f"    - DO NOT manually visit the webhook URL in your browser")
        print(f"    - Wait for blockchain confirmations (LTC: ~2.5 minutes, BTC: ~10 minutes)")
        print(f"\n  To manually confirm payment (if you're sure it's paid):")
        print(f"    python scripts/manual_confirm_payment.py {order_id}")
    elif invoice:
        print(f"\n[WARNING] Invoice exists but order is missing")
        print(f"  Invoice Status: {invoice.get('status')}")
        if invoice.get('status') == 'Paid':
            print(f"\n[INFO] Invoice shows as Paid, but order is missing from database.")
            print(f"  This could mean the order was deleted or the invoice wasn't properly linked.")
    
    print(f"\n{'='*60}\n")


async def main():
    if len(sys.argv) < 2:
        print("Usage: py -3.12 scripts/check_cryptapi_payment.py <order_id>")
        print("Example: py -3.12 scripts/check_cryptapi_payment.py 34666711")
        sys.exit(1)
    
    order_id = sys.argv[1]
    await check_payment_status(order_id)


if __name__ == "__main__":
    asyncio.run(main())
