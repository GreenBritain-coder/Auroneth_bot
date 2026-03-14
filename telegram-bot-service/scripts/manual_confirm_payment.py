"""
Manual payment confirmation script
Use this to manually mark an order as paid if webhook hasn't worked
"""
import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from database.connection import connect_to_mongo, close_mongo_connection
from database.connection import get_database
from datetime import datetime

async def confirm_payment(order_id: str):
    """Manually confirm a payment for an order"""
    await connect_to_mongo()
    db = get_database()
    orders_collection = db.orders
    commissions_collection = db.commissions
    
    print(f"Looking up order: {order_id}")
    
    # Find order
    order = await orders_collection.find_one({"_id": order_id})
    if not order:
        print(f"[ERROR] Order not found: {order_id}")
        return False
    
    current_status = order.get("paymentStatus")
    print(f"Current status: {current_status}")
    
    # Check and update invoice status even if order is already paid
    invoices_collection = db.invoices
    invoice = await invoices_collection.find_one({"invoice_id": order_id})
    if not invoice:
        # Try alternative lookup
        invoice = await invoices_collection.find_one({"payment_invoice_id": order_id})
    
    if invoice and invoice.get("status") != "Paid":
        await invoices_collection.update_one(
            {"_id": invoice["_id"]},
            {"$set": {"status": "Paid"}}
        )
        print(f"[OK] Updated invoice {order_id} status to Paid")
    
    if current_status == "paid":
        print(f"[OK] Order {order_id} is already marked as paid!")
        if invoice:
            print(f"[OK] Invoice status: {invoice.get('status', 'unknown')}")
        return True
    
    # Mark as paid
    print(f"Updating order {order_id} to paid status...")
    from datetime import timezone
    await orders_collection.update_one(
        {"_id": order_id},
        {"$set": {
            "paymentStatus": "paid",
            "paymentDetails": {
                "status": "confirmed",
                "provider": "cryptapi",
                "manually_confirmed": True,
                "confirmed_at": datetime.now(timezone.utc)
            }
        }}
    )
    print(f"[OK] Order {order_id} marked as paid in orders collection")
    
    # Also update invoice status
    invoices_collection = db.invoices
    invoice_update = await invoices_collection.update_one(
        {"invoice_id": order_id},
        {"$set": {"status": "Paid"}}
    )
    if invoice_update.modified_count > 0:
        print(f"[OK] Invoice {order_id} status updated to Paid")
    else:
        # Try alternative invoice lookup
        invoice_found = await invoices_collection.find_one({"invoice_id": order_id})
        if invoice_found:
            await invoices_collection.update_one(
                {"_id": invoice_found["_id"]},
                {"$set": {"status": "Paid"}}
            )
            print(f"[OK] Invoice {order_id} status updated to Paid (by _id)")
        else:
            # Try finding by payment_invoice_id
            await invoices_collection.update_many(
                {"payment_invoice_id": order_id},
                {"$set": {"status": "Paid"}}
            )
            print(f"[OK] Updated invoice(s) linked to order {order_id}")
    
    # Create commission record if not exists
    existing_commission = await commissions_collection.find_one({"orderId": order_id})
    if not existing_commission:
        commission_record = {
            "botId": order["botId"],
            "orderId": order_id,
            "amount": order.get("commission", 0),
            "timestamp": datetime.now(timezone.utc)
        }
        await commissions_collection.insert_one(commission_record)
        print(f"[OK] Commission record created")
    
    print(f"[OK] Order {order_id} fully confirmed!")
    
    await close_mongo_connection()
    return True

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python manual_confirm_payment.py <order_id>")
        print("Example: python manual_confirm_payment.py 42134312")
        sys.exit(1)
    
    order_id = sys.argv[1]
    asyncio.run(confirm_payment(order_id))
