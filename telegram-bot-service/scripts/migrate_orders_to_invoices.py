"""
Script to migrate existing orders to use invoice IDs and link them with invoices
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


async def migrate_orders():
    """Migrate existing orders to link with invoices"""
    await connect_to_mongo()
    db = get_database()
    if db is None:
        print("❌ Failed to connect to database")
        return
    
    orders_collection = db.orders
    invoices_collection = db.invoices
    
    # Get all orders
    orders = await orders_collection.find({}).to_list(length=None)
    print(f"Found {len(orders)} orders to process")
    
    if len(orders) == 0:
        print("✅ No orders to migrate")
        await close_mongo_connection()
        return
    
    updated_count = 0
    created_invoice_count = 0
    skipped_count = 0
    
    for order in orders:
        order_id = str(order.get("_id", ""))
        print(f"\nProcessing order: {order_id}")
        
        # Check if order already has a numeric invoice_id format
        if order_id.isdigit():
            print(f"  ✓ Order already has numeric ID: {order_id}")
            # Check if invoice exists
            invoice = await invoices_collection.find_one({"invoice_id": order_id})
            if not invoice:
                # Create invoice for this order
                from datetime import datetime
                invoice = {
                    "_id": str(order.get("_id")),
                    "invoice_id": order_id,
                    "bot_id": order.get("botId"),
                    "user_id": order.get("userId"),
                    "status": "Pending Payment" if order.get("paymentStatus") == "pending" else "Completed",
                    "items": [{
                        "product_id": order.get("productId"),
                        "quantity": order.get("quantity", 1),
                        "price": order.get("amount", 0),
                        "variation_index": order.get("variation_index")
                    }],
                    "total": order.get("amount", 0),
                    "currency": "GBP",  # Default, will need to be updated from product
                    "payment_method": None,
                    "delivery_address": order.get("encrypted_address"),
                    "delivery_method": order.get("delivery_method"),
                    "discount_code": order.get("discount_code"),
                    "discount_amount": order.get("discount_amount", 0),
                    "payment_address": None,
                    "payment_amount": None,
                    "payment_currency": None,
                    "payment_invoice_id": order.get("invoiceId"),
                    "created_at": order.get("timestamp", datetime.utcnow()),
                    "updated_at": datetime.utcnow()
                }
                
                # Add payment details if order has invoiceId
                if order.get("invoiceId"):
                    invoice["payment_invoice_id"] = order.get("invoiceId")
                    invoice["status"] = "Pending Payment" if order.get("paymentStatus") == "pending" else "Completed"
                
                await invoices_collection.insert_one(invoice)
                created_invoice_count += 1
                print(f"  ✓ Created invoice for order {order_id}")
            else:
                print(f"  ✓ Invoice already exists for order {order_id}")
            updated_count += 1
            continue
        
        # For UUID orders, try to find existing invoice
        invoice = None
        
        # Try to find invoice by order_id
        invoice = await invoices_collection.find_one({"invoice_id": order_id})
        
        if not invoice:
            # Try to find by payment_invoice_id
            invoice_id_field = order.get("invoiceId")
            if invoice_id_field:
                invoice = await invoices_collection.find_one({"payment_invoice_id": invoice_id_field})
        
        if invoice:
            # Invoice found - check if it needs to be updated to numeric ID
            invoice_id = invoice.get("invoice_id")
            if invoice_id and invoice_id.isdigit():
                # Invoice already has numeric ID - good!
                print(f"  ✓ Invoice already has numeric ID: {invoice_id}")
                updated_count += 1
            else:
                # Invoice has old format ID - convert to numeric
                print(f"  → Found invoice with old format ID: {invoice_id}")
                from utils.invoice_id import generate_short_invoice_id
                
                # Generate new numeric invoice ID
                new_invoice_id = await generate_short_invoice_id(db=db)
                
                # Update invoice with new numeric ID
                await invoices_collection.update_one(
                    {"_id": invoice["_id"]},
                    {"$set": {"invoice_id": new_invoice_id}}
                )
                print(f"  ✓ Updated invoice to use numeric ID: {new_invoice_id}")
                updated_count += 1
        else:
            # No invoice found - create one with a new numeric ID
            from datetime import datetime
            from utils.invoice_id import generate_short_invoice_id
            
            # Generate new numeric invoice ID
            new_invoice_id = await generate_short_invoice_id(db=db)
            
            # Create invoice
            invoice = {
                "_id": str(order.get("_id")),
                "invoice_id": new_invoice_id,
                "bot_id": order.get("botId"),
                "user_id": order.get("userId"),
                "status": "Pending Payment" if order.get("paymentStatus") == "pending" else "Completed",
                "items": [{
                    "product_id": order.get("productId"),
                    "quantity": order.get("quantity", 1),
                    "price": order.get("amount", 0),
                    "variation_index": order.get("variation_index")
                }],
                "total": order.get("amount", 0),
                "currency": "GBP",  # Default
                "payment_method": None,
                "delivery_address": order.get("encrypted_address"),
                "delivery_method": order.get("delivery_method"),
                "discount_code": order.get("discount_code"),
                "discount_amount": order.get("discount_amount", 0),
                "payment_address": None,
                "payment_amount": None,
                "payment_currency": None,
                "payment_invoice_id": order.get("invoiceId"),
                "created_at": order.get("timestamp", datetime.utcnow()),
                "updated_at": datetime.utcnow()
            }
            
            await invoices_collection.insert_one(invoice)
            created_invoice_count += 1
            print(f"  ✓ Created invoice {new_invoice_id} for order {order_id}")
            updated_count += 1
    
    print(f"\n{'='*50}")
    print(f"Migration Summary:")
    print(f"  Total orders processed: {len(orders)}")
    print(f"  Orders updated/linked: {updated_count}")
    print(f"  Invoices created: {created_invoice_count}")
    print(f"  Orders skipped: {skipped_count}")
    print(f"{'='*50}")
    
    await close_mongo_connection()


if __name__ == "__main__":
    print("=" * 50)
    print("ORDER TO INVOICE MIGRATION SCRIPT")
    print("=" * 50)
    print()
    print("This script will:")
    print("  1. Link existing orders with invoices")
    print("  2. Create invoices for orders that don't have them")
    print("  3. Use numeric invoice IDs for new invoices")
    print()
    
    response = input("Continue? (yes/no): ")
    if response.lower() not in ["yes", "y"]:
        print("Migration cancelled")
        sys.exit(0)
    
    asyncio.run(migrate_orders())
    
    print("\n" + "=" * 50)
    print("Migration completed")
    print("=" * 50)

