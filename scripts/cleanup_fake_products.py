#!/usr/bin/env python3
"""Delete products not present in the live store.greenbritain.bot catalog."""
import json
import os
import sys
import urllib.request

STORE_URL = "https://store.greenbritain.bot/get_store_data"

def main():
    print(f"Fetching real products from {STORE_URL}...")
    with urllib.request.urlopen(STORE_URL, timeout=15) as r:
        data = json.loads(r.read())

    real_names = set()
    for cat, items in data["item_data"].items():
        for sid, item in items.items():
            real_names.add(item["name"].strip())
    print(f"Real store products: {len(real_names)}")

    try:
        from pymongo import MongoClient
    except ImportError:
        print("ERROR: pip install pymongo")
        sys.exit(1)

    uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/telegram_bot_platform")
    c = MongoClient(uri)
    db = c.get_default_database()

    all_prods = list(db.products.find({}, {"name": 1, "_id": 1}))
    to_delete = [p for p in all_prods if p["name"].strip() not in real_names]
    to_keep   = [p for p in all_prods if p["name"].strip() in real_names]

    print(f"Keep: {len(to_keep)}  |  Delete: {len(to_delete)}")
    print("--- Products to delete ---")
    for p in to_delete:
        print(f"  x {p['name']}")

    if not to_delete:
        print("Nothing to delete.")
        return

    ids = [p["_id"] for p in to_delete]
    result = db.products.delete_many({"_id": {"$in": ids}})
    print(f"\nDeleted: {result.deleted_count} products.")
    c.close()

if __name__ == "__main__":
    main()
