"""
Deposit address tracking (HD-style: one address per order).
Records each payment address so we have an auditable pool and can mark addresses as used.
"""
from typing import Any
from datetime import datetime


def record_deposit_address(
    db: Any,
    order_id: str,
    currency: str,
    address: str,
    provider: str = None,
) -> None:
    """
    Record a deposit address assigned to an order.
    Call this after successfully creating an invoice (provider returned address).
    """
    if db is None or not address or not order_id:
        return
    collection = db.addresses
    doc = {
        "currency": currency.upper() if currency else "BTC",
        "address": address.strip(),
        "orderId": str(order_id),
        "status": "assigned",
        "provider": provider or None,
        "createdAt": datetime.utcnow(),
    }
    try:
        collection.insert_one(doc)
    except Exception as e:
        # Duplicate address is possible if provider reuses; log and skip
        print(f"[Addresses] Could not record address for order {order_id}: {e}")


def mark_address_used(db: Any, order_id: str) -> None:
    """
    Mark the address assigned to this order as 'used' after payment is confirmed.
    Call from payment webhook when order is marked paid.
    """
    if db is None or not order_id:
        return
    try:
        db.addresses.update_many(
            {"orderId": str(order_id), "status": "assigned"},
            {"$set": {"status": "used"}},
        )
    except Exception as e:
        print(f"[Addresses] Could not mark address used for order {order_id}: {e}")
