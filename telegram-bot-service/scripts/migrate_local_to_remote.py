#!/usr/bin/env python3
"""
Migrate data from local MongoDB to Coolify/remote MongoDB.
Usage:
  MONGO_URI_DEST="mongodb://root:PASS@host:27017/telegram_bot_platform?authSource=admin" python scripts/migrate_local_to_remote.py
"""
import asyncio
import os
import sys
from pathlib import Path

# Add parent to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from motor.motor_asyncio import AsyncIOMotorClient

SOURCE_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/telegram_bot_platform")
DEST_URI = os.getenv("MONGO_URI_DEST")

# Collections to migrate (exclude system collections)
COLLECTIONS = [
    "admins", "addresses", "bots", "categories", "commissionpayments",
    "commissionpayouts", "commissions", "contact_messages", "discounts",
    "invoices", "orders", "products", "subcategories", "users",
    "carts", "reviews", "wishlists",
]


async def migrate():
    if not DEST_URI:
        print("Error: Set MONGO_URI_DEST to your Coolify MongoDB connection string.")
        print("Example: mongodb://root:PASSWORD@host:27017/telegram_bot_platform?authSource=admin&directConnection=true")
        sys.exit(1)

    print(f"Source: {SOURCE_URI.split('@')[-1] if '@' in SOURCE_URI else SOURCE_URI}")
    print(f"Dest:   {DEST_URI.split('@')[-1] if '@' in DEST_URI else DEST_URI}")
    print()

    src_client = AsyncIOMotorClient(SOURCE_URI)
    dest_client = AsyncIOMotorClient(DEST_URI)
    src_db = src_client.get_default_database()
    dest_db = dest_client.get_default_database()

    # Discover collections that exist in source
    existing = await src_db.list_collection_names()
    to_migrate = [c for c in COLLECTIONS if c in existing]
    if not to_migrate:
        to_migrate = [c for c in existing if not c.startswith("system.")]

    total = 0
    for coll_name in to_migrate:
        coll = src_db[coll_name]
        count = await coll.count_documents({})
        if count == 0:
            continue
        docs = await coll.find({}).to_list(length=None)
        if docs:
            dest_coll = dest_db[coll_name]
            await dest_coll.delete_many({})  # Clear existing to avoid duplicates
            await dest_coll.insert_many(docs)
            total += count
            print(f"  {coll_name}: {count} documents")

    print(f"\nDone. Migrated {total} documents across {len(to_migrate)} collections.")
    src_client.close()
    dest_client.close()


if __name__ == "__main__":
    asyncio.run(migrate())
