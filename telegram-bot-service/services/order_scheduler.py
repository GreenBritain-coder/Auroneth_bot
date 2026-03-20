"""
Scheduled tasks for automatic order state transitions.
Run via asyncio task started in main.py.

- Expire unpaid orders past their payment_deadline
- Auto-deliver shipped orders after configurable days (default: 7)
- Auto-complete delivered orders after configurable days (default: 3)
"""

import asyncio
from datetime import datetime, timedelta
from database.connection import get_database


async def run_order_scheduler():
    """Main scheduler loop - runs every 5 minutes."""
    print("[OrderScheduler] Started order scheduler (runs every 5 minutes)")
    # Wait 30 seconds after startup before first run to let everything initialize
    await asyncio.sleep(30)

    while True:
        try:
            await expire_pending_orders()
            await auto_deliver_shipped_orders()
            await auto_complete_delivered_orders()
        except Exception as e:
            print(f"[OrderScheduler] Error in scheduler loop: {e}")
            import traceback
            traceback.print_exc()
        await asyncio.sleep(300)  # 5 minutes


async def expire_pending_orders():
    """Transition pending orders past their payment_deadline to expired."""
    db = get_database()
    invoices_collection = db.invoices

    # Find invoices with passed deadlines that are still in pending payment state
    now = datetime.utcnow()
    expired_invoices = await invoices_collection.find({
        "status": "Pending Payment",
        "payment_deadline": {"$lt": now},
    }).to_list(length=100)

    if not expired_invoices:
        return

    from services.order_state_machine import transition_order

    count = 0
    for invoice in expired_invoices:
        order_id = invoice.get("invoice_id")
        if not order_id:
            continue

        result = await transition_order(
            db, str(order_id), "expired", "system",
            note="Payment deadline passed",
        )
        if result["success"]:
            count += 1

    if count > 0:
        print(f"[OrderScheduler] Expired {count} unpaid orders")


async def auto_deliver_shipped_orders():
    """Auto-transition shipped orders to delivered after configured days."""
    db = get_database()
    orders_collection = db.orders
    bots_collection = db.bots

    shipped_orders = await orders_collection.find({
        "paymentStatus": "shipped",
    }).to_list(length=100)

    if not shipped_orders:
        return

    from services.order_state_machine import transition_order

    now = datetime.utcnow()
    count = 0
    for order in shipped_orders:
        shipped_at = order.get("shipped_at")
        if not shipped_at:
            continue

        # Get bot-specific auto_deliver_days (default 7)
        bot = await bots_collection.find_one({"_id": order.get("botId")})
        days = (bot or {}).get("auto_deliver_days", 7)

        if now - shipped_at > timedelta(days=days):
            result = await transition_order(
                db, str(order["_id"]), "delivered", "system",
                note=f"Auto-delivered after {days} days",
            )
            if result["success"]:
                count += 1

    if count > 0:
        print(f"[OrderScheduler] Auto-delivered {count} shipped orders")


async def auto_complete_delivered_orders():
    """Auto-complete delivered orders after configured days if no dispute."""
    db = get_database()
    orders_collection = db.orders
    bots_collection = db.bots

    delivered_orders = await orders_collection.find({
        "paymentStatus": "delivered",
    }).to_list(length=100)

    if not delivered_orders:
        return

    from services.order_state_machine import transition_order

    now = datetime.utcnow()
    count = 0
    for order in delivered_orders:
        delivered_at = order.get("delivered_at")
        if not delivered_at:
            continue

        bot = await bots_collection.find_one({"_id": order.get("botId")})
        days = (bot or {}).get("auto_complete_days", 3)

        if now - delivered_at > timedelta(days=days):
            result = await transition_order(
                db, str(order["_id"]), "completed", "system",
                note=f"Auto-completed after {days} days with no dispute",
            )
            if result["success"]:
                count += 1

    if count > 0:
        print(f"[OrderScheduler] Auto-completed {count} delivered orders")
