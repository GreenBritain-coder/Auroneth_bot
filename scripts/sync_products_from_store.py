#!/usr/bin/env python3
"""
Sync products from store.greenbritain.bot into the Auroneth bot MongoDB.

Usage:
    python scripts/sync_products_from_store.py --bot-id <BOT_ID> [--mongo-uri <URI>] [--dry-run]

Each product from the store is upserted by its source_id (the store's numeric ID),
so re-running is safe and won't duplicate entries.
"""
import argparse
import json
import sys
import urllib.request
from datetime import datetime, timezone

STORE_URL = "https://store.greenbritain.bot/get_store_data"


def fetch_store_data():
    with urllib.request.urlopen(STORE_URL, timeout=15) as resp:
        return json.loads(resp.read().decode())


def build_products(item_data, bot_id):
    """Convert store format → Auroneth product documents."""
    products = []
    for category, items in item_data.items():
        for source_id, item in items.items():
            # Convert prices dict {"7g": 69.99, "14g": 129.0} → variations list
            variations = []
            for size_label, price in sorted(item["prices"].items(),
                                             key=lambda kv: float(''.join(c for c in kv[0] if c.isdigit() or c == '.')  or '0')):
                variations.append({"name": size_label, "price": price})

            products.append({
                "source_id": source_id,          # store's numeric ID — used for upsert key
                "name": item["name"],
                "description": item.get("description", ""),
                "image_url": item.get("image_url", "").strip(),
                "category": category,
                "unit": item.get("unit", "g"),
                "variations": variations,
                "bot_ids": [bot_id],
                "active": True,
                "currency": "GBP",
                "updated_at": datetime.now(timezone.utc),
            })
    return products


def sync(bot_id, mongo_uri, dry_run=False):
    print(f"Fetching products from {STORE_URL}...")
    data = fetch_store_data()
    item_data = data.get("item_data", {})
    products = build_products(item_data, bot_id)
    print(f"Found {len(products)} products across {len(item_data)} categories.")

    if dry_run:
        for p in products:
            print(f"  [{p['category']}] {p['name']} — {len(p['variations'])} variations")
        print("Dry run complete, nothing written.")
        return

    try:
        from pymongo import MongoClient, UpdateOne
    except ImportError:
        print("ERROR: pymongo not installed. Run: pip install pymongo")
        sys.exit(1)

    client = MongoClient(mongo_uri)
    db = client.get_default_database()
    col = db["products"]

    ops = []
    for p in products:
        key = {"source_id": p["source_id"], "bot_ids": bot_id}
        ops.append(UpdateOne(
            {"source_id": p["source_id"], "bot_ids": bot_id},
            {"$set": p, "$setOnInsert": {"created_at": datetime.now(timezone.utc)}},
            upsert=True,
        ))

    result = col.bulk_write(ops, ordered=False)
    print(f"Done. Inserted: {result.upserted_count}  Updated: {result.modified_count}")
    client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sync products from store.greenbritain.bot")
    parser.add_argument("--bot-id", required=True, help="Auroneth bot _id to assign products to")
    parser.add_argument("--mongo-uri", default="mongodb://localhost:27017/telegram_bot_platform",
                        help="MongoDB URI (default: localhost)")
    parser.add_argument("--dry-run", action="store_true", help="Print products without writing")
    args = parser.parse_args()

    sync(args.bot_id, args.mongo_uri, args.dry_run)
