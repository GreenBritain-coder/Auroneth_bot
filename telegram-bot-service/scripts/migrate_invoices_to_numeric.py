"""
Script to migrate invoices with old format IDs (like INV-XXXXX) to numeric IDs
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


async def migrate_invoices():
    """Migrate invoices with old format IDs to numeric IDs"""
    await connect_to_mongo()
    db = get_database()
    if db is None:
        print("❌ Failed to connect to database")
        return
    
    invoices_collection = db.invoices
    
    # Get all invoices
    invoices = await invoices_collection.find({}).to_list(length=None)
    print(f"Found {len(invoices)} invoices to check")
    
    if len(invoices) == 0:
        print("✅ No invoices to migrate")
        await close_mongo_connection()
        return
    
    updated_count = 0
    skipped_count = 0
    
    for invoice in invoices:
        invoice_id = invoice.get("invoice_id", "")
        invoice_mongo_id = invoice.get("_id")
        
        # Check if invoice_id is in old format (starts with "INV-" or contains letters)
        if not invoice_id:
            print(f"\nProcessing invoice {invoice_mongo_id}: No invoice_id field")
            skipped_count += 1
            continue
        
        # Check if it's already numeric
        if invoice_id.isdigit():
            print(f"\nProcessing invoice {invoice_mongo_id}: Already numeric ({invoice_id})")
            skipped_count += 1
            continue
        
        # Check if it's old format (contains letters or starts with INV-)
        is_old_format = (
            invoice_id.startswith("INV-") or 
            not invoice_id.replace("-", "").isdigit() or
            any(c.isalpha() for c in invoice_id)
        )
        
        if not is_old_format:
            print(f"\nProcessing invoice {invoice_mongo_id}: Unknown format ({invoice_id})")
            skipped_count += 1
            continue
        
        print(f"\nProcessing invoice {invoice_mongo_id}: Old format ID: {invoice_id}")
        
        # Generate new numeric invoice ID
        from utils.invoice_id import generate_short_invoice_id
        new_invoice_id = await generate_short_invoice_id(db=db)
        
        # Update invoice with new numeric ID
        await invoices_collection.update_one(
            {"_id": invoice_mongo_id},
            {"$set": {"invoice_id": new_invoice_id}}
        )
        print(f"  ✓ Updated invoice to use numeric ID: {new_invoice_id}")
        updated_count += 1
    
    print(f"\n{'='*50}")
    print(f"Migration Summary:")
    print(f"  Total invoices checked: {len(invoices)}")
    print(f"  Invoices updated: {updated_count}")
    print(f"  Invoices skipped (already numeric): {skipped_count}")
    print(f"{'='*50}")
    
    await close_mongo_connection()


if __name__ == "__main__":
    print("=" * 50)
    print("INVOICE ID MIGRATION SCRIPT")
    print("=" * 50)
    print()
    print("This script will:")
    print("  1. Find all invoices with old format IDs (like INV-XXXXX)")
    print("  2. Convert them to numeric IDs")
    print()
    
    response = input("Continue? (yes/no): ")
    if response.lower() not in ["yes", "y"]:
        print("Migration cancelled")
        sys.exit(0)
    
    asyncio.run(migrate_invoices())
    
    print("\n" + "=" * 50)
    print("Migration completed")
    print("=" * 50)

