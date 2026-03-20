"""
Create performance-optimizing MongoDB indexes for all collections.

Indexes are based on actual query patterns found across the codebase.
All create_index() calls are idempotent -- safe to run on every startup.

Can be run standalone:
    python -m scripts.create_indexes

Or called from main.py on startup via ensure_indexes().
"""

import asyncio
from pymongo import IndexModel, ASCENDING, TEXT


async def ensure_indexes(db):
    """Create all application indexes. Safe to call repeatedly (idempotent)."""

    print("[Indexes] Creating performance indexes...", flush=True)

    # ── bots ──────────────────────────────────────────────────────────
    # get_bot_config: find_one({"token": bot_token})  -- every request
    # _notify_buyer / scheduler: find_one({"_id": ...})  -- covered by _id
    await db.bots.create_index("token", unique=True, name="idx_bots_token")

    # ── users ─────────────────────────────────────────────────────────
    # Users are looked up by _id (telegram_user_id string) which is the
    # default index, so no extra index needed.
    # secret_phrase uniqueness check during generation:
    await db.users.create_index("secret_phrase", name="idx_users_secret_phrase")

    # ── categories ────────────────────────────────────────────────────
    # shop: find({"bot_ids": bot_id}).sort("order", 1)
    await db.categories.create_index(
        [("bot_ids", ASCENDING), ("order", ASCENDING)],
        name="idx_categories_bot_ids_order",
    )

    # ── subcategories ─────────────────────────────────────────────────
    # shop: find({"category_id": ..., "bot_ids": ...}).sort("order", 1)
    await db.subcategories.create_index(
        [("category_id", ASCENDING), ("bot_ids", ASCENDING), ("order", ASCENDING)],
        name="idx_subcategories_cat_bot_order",
    )

    # ── products ──────────────────────────────────────────────────────
    # shop: find({"bot_ids": bot_id, "subcategory_id": ...})
    await db.products.create_index(
        [("bot_ids", ASCENDING), ("subcategory_id", ASCENDING)],
        name="idx_products_bot_subcategory",
    )
    # shop: find({"bot_ids": bot_id, "category_id": ...})
    await db.products.create_index(
        [("bot_ids", ASCENDING), ("category_id", ASCENDING)],
        name="idx_products_bot_category",
    )
    # start: find({"bot_ids": str(bot_config["_id"])})
    await db.products.create_index("bot_ids", name="idx_products_bot_ids")
    # Text index for future product search (PRD 1.3)
    await db.products.create_index(
        [("name", TEXT), ("description", TEXT)],
        name="idx_products_text_search",
        default_language="english",
    )

    # ── orders ────────────────────────────────────────────────────────
    # orders handler: find({"userId": ..., "botId": ...}).sort("timestamp", -1)
    await db.orders.create_index(
        [("userId", ASCENDING), ("botId", ASCENDING), ("timestamp", ASCENDING)],
        name="idx_orders_user_bot_timestamp",
    )
    # bottom_menu / start: count_documents({"userId": ..., "botId": ...})
    # (covered by idx_orders_user_bot_timestamp)

    # start: count_documents({"botId": ...})
    await db.orders.create_index("botId", name="idx_orders_botId")

    # scheduler: find({"paymentStatus": "shipped"})
    # scheduler: find({"paymentStatus": "delivered"})
    await db.orders.create_index("paymentStatus", name="idx_orders_paymentStatus")

    # state_machine: find_one_and_update({"_id": ..., "paymentStatus": ...})
    # (covered by _id + paymentStatus above for the filter, _id is primary)

    # orders handler: find({"invoiceId": ...})
    await db.orders.create_index("invoiceId", sparse=True, name="idx_orders_invoiceId")

    # ── invoices ──────────────────────────────────────────────────────
    # Everywhere: find_one({"invoice_id": ...})  -- extremely frequent
    await db.invoices.create_index(
        "invoice_id", unique=True, name="idx_invoices_invoice_id"
    )
    # payments: find_one({"payment_invoice_id": ...})
    await db.invoices.create_index(
        "payment_invoice_id", sparse=True, name="idx_invoices_payment_invoice_id"
    )
    # scheduler: find({"status": "Pending Payment", "payment_deadline": {"$lt": now}})
    await db.invoices.create_index(
        [("status", ASCENDING), ("payment_deadline", ASCENDING)],
        name="idx_invoices_status_deadline",
    )
    # shop: find_one({"user_id": ..., "bot_id": ..., "waiting_for_address": True})
    await db.invoices.create_index(
        [("user_id", ASCENDING), ("bot_id", ASCENDING)],
        name="idx_invoices_user_bot",
    )

    # ── carts ─────────────────────────────────────────────────────────
    # shop: find_one({"user_id": ..., "bot_id": ...})  -- every cart operation
    await db.carts.create_index(
        [("user_id", ASCENDING), ("bot_id", ASCENDING)],
        unique=True,
        name="idx_carts_user_bot",
    )

    # ── wishlists ─────────────────────────────────────────────────────
    # shop: find_one({"user_id": ..., "bot_id": ...})
    await db.wishlists.create_index(
        [("user_id", ASCENDING), ("bot_id", ASCENDING)],
        unique=True,
        name="idx_wishlists_user_bot",
    )

    # ── reviews ───────────────────────────────────────────────────────
    # Already created in connection.py; reinforce with compound indexes
    # shop: find({"bot_id": bot_id}).sort("created_at", -1)
    await db.reviews.create_index(
        [("bot_id", ASCENDING), ("created_at", ASCENDING)],
        name="idx_reviews_bot_created",
    )
    # shop: find({"bot_id": bot_id, "rating": ...})
    await db.reviews.create_index(
        [("bot_id", ASCENDING), ("rating", ASCENDING)],
        name="idx_reviews_bot_rating",
    )
    # shop: count_documents({"product_id": ...}) and {"product_ids": ...}
    await db.reviews.create_index("product_ids", name="idx_reviews_product_ids")
    # shop: find_one({"order_id": ...})  -- already unique from connection.py

    # ── contact_messages ──────────────────────────────────────────────
    # contact: find({"botId": ..., "userId": ...}).sort("timestamp", -1)
    await db.contact_messages.create_index(
        [("botId", ASCENDING), ("userId", ASCENDING), ("timestamp", ASCENDING)],
        name="idx_contact_messages_bot_user_ts",
    )
    # contact: count_documents({"botId": ..., "userId": ...})
    # (covered by above)

    # ── contact_responses ─────────────────────────────────────────────
    # contact: find({"botId": ..., "userId": ...}).sort("timestamp", -1)
    await db.contact_responses.create_index(
        [("botId", ASCENDING), ("userId", ASCENDING), ("timestamp", ASCENDING)],
        name="idx_contact_responses_bot_user_ts",
    )

    # ── commissions ───────────────────────────────────────────────────
    # payments: find_one({"orderId": ...})
    await db.commissions.create_index("orderId", unique=True, name="idx_commissions_orderId")
    # admin queries by botId
    await db.commissions.create_index("botId", name="idx_commissions_botId")

    # ── commission_payouts ────────────────────────────────────────────
    # payments: tracked per order+bot
    await db.commission_payouts.create_index("orderId", name="idx_commission_payouts_orderId")
    await db.commission_payouts.create_index("botId", name="idx_commission_payouts_botId")

    # ── discounts ─────────────────────────────────────────────────────
    # shop: find_one({"code": ..., "active": True, "valid_from": ..., "valid_until": ...})
    await db.discounts.create_index(
        [("code", ASCENDING), ("active", ASCENDING)],
        name="idx_discounts_code_active",
    )

    # ── addresses ─────────────────────────────────────────────────────
    # Already indexed in Mongoose models.ts (address unique, orderId, currency+status).
    # Reinforce from Python side:
    await db.addresses.create_index("address", unique=True, name="idx_addresses_address")
    await db.addresses.create_index("orderId", name="idx_addresses_orderId")
    await db.addresses.create_index(
        [("currency", ASCENDING), ("status", ASCENDING)],
        name="idx_addresses_currency_status",
    )

    print("[Indexes] All indexes created/verified.", flush=True)


# ── standalone runner ─────────────────────────────────────────────────
async def _main():
    from database.connection import connect_to_mongo, get_database

    await connect_to_mongo()
    db = get_database()
    await ensure_indexes(db)


if __name__ == "__main__":
    asyncio.run(_main())
