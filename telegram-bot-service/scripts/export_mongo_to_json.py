#!/usr/bin/env python3
"""
Export local MongoDB to JSON file for migration.
Usage: python scripts/export_mongo_to_json.py [--output mongo_export.json]
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from bson import ObjectId
from datetime import datetime

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from motor.motor_asyncio import AsyncIOMotorClient

SOURCE_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/telegram_bot_platform")
COLLECTIONS = [
    "admins", "addresses", "bots", "categories", "commissionpayments",
    "commissionpayouts", "commissions", "contact_messages", "discounts",
    "invoices", "orders", "products", "subcategories", "users",
    "carts", "reviews", "wishlists",
]


def serialize_value(v):
    if isinstance(v, ObjectId):
        return str(v)
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, dict):
        return {k: serialize_value(x) for k, x in v.items()}
    if isinstance(v, list):
        return [serialize_value(x) for x in v]
    return v


async def export_data():
    out_file = "mongo_export.json"
    if "--output" in sys.argv:
        i = sys.argv.index("--output")
        if i + 1 < len(sys.argv):
            out_file = sys.argv[i + 1]

    client = AsyncIOMotorClient(SOURCE_URI)
    db = client.get_default_database()
    existing = await db.list_collection_names()
    to_export = [c for c in COLLECTIONS if c in existing]
    if not to_export:
        to_export = [c for c in existing if not c.startswith("system.")]

    result = {}
    for coll_name in to_export:
        coll = db[coll_name]
        docs = await coll.find({}).to_list(length=None)
        serialized = []
        for d in docs:
            s = {k: serialize_value(v) for k, v in d.items()}
            serialized.append(s)
        result[coll_name] = serialized
        print(f"  {coll_name}: {len(serialized)} docs", file=sys.stderr)

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    print(f"Exported to {out_file}", file=sys.stderr)
    client.close()
    return out_file


if __name__ == "__main__":
    asyncio.run(export_data())
