from bson import ObjectId
"""
Order state machine - centralized state transition logic.
All order status changes MUST go through this module.

States: pending, paid, confirmed, shipped, delivered, completed, expired, cancelled, disputed, refunded
"""

from datetime import datetime
from typing import Optional
from pymongo import ReturnDocument

VALID_TRANSITIONS = {
    "pending":   ["paid", "expired", "cancelled"],
    "paid":      ["confirmed", "cancelled", "refunded"],
    "confirmed": ["shipped", "cancelled", "refunded"],
    "shipped":   ["delivered", "refunded"],
    "delivered": ["completed", "disputed"],
    "disputed":  ["refunded", "completed"],
    "cancelled": ["refunded"],
    # Terminal states with no outgoing transitions:
    # expired, completed, refunded
}

INVOICE_STATUS_MAP = {
    "pending": "Pending Payment",
    "paid": "Paid",
    "confirmed": "Confirmed",
    "shipped": "Shipped",
    "delivered": "Delivered",
    "completed": "Completed",
    "disputed": "Disputed",
    "expired": "Expired",
    "cancelled": "Cancelled",
    "refunded": "Refunded",
}

BUYER_MESSAGES = {
    "paid": "Your payment for Order #{order_id} has been confirmed! The vendor will review your order shortly.",
    "confirmed": "Great news! Order #{order_id} has been confirmed by the vendor and is being prepared.",
    "shipped": "Order #{order_id} has been shipped!{tracking}",
    "delivered": "Order #{order_id} has been marked as delivered. Please confirm receipt within {days} days or open a dispute if there's an issue.",
    "completed": "Order #{order_id} is now complete. Thank you for your purchase!",
    "disputed": "Dispute opened for Order #{order_id}. The vendor has been notified.",
    "expired": "Order #{order_id} has expired. The payment deadline passed. You can place a new order anytime.",
    "cancelled": "Order #{order_id} has been cancelled.{reason}",
    "refunded": "A refund for Order #{order_id} has been issued.{txid}",
}

STATUS_EMOJI = {
    "pending": "\\u23f3",     # hourglass
    "paid": "\\U0001f4b0",   # money bag
    "confirmed": "\\u2705",   # check mark
    "shipped": "\\U0001f69a", # truck
    "delivered": "\\U0001f4e6", # package
    "completed": "\\u2705",   # check mark
    "disputed": "\\u26a0\\ufe0f", # warning
    "expired": "\\U0001f6ab", # no entry
    "cancelled": "\\U0001f6ab", # no entry
    "refunded": "\\U0001f4b8", # money with wings
}


async def transition_order(
    db,
    order_id: str,
    new_status: str,
    changed_by: str,
    note: Optional[str] = None,
    tracking_info: Optional[str] = None,
    cancellation_reason: Optional[str] = None,
    dispute_reason: Optional[str] = None,
    refund_txid: Optional[str] = None,
    extra_update: Optional[dict] = None,
    skip_notification: bool = False,
) -> dict:
    """
    Transition an order to a new status.

    Args:
        db: MongoDB database instance
        order_id: The order _id (string)
        new_status: Target status
        changed_by: "system", "vendor", or "buyer:{userId}"
        note: Optional note for the status history entry
        tracking_info: Optional tracking text (for shipped)
        cancellation_reason: Optional reason (for cancelled)
        dispute_reason: Optional reason (for disputed)
        refund_txid: Optional blockchain tx hash (for refunded)
        extra_update: Optional dict of additional fields to $set
        skip_notification: If True, don't send buyer notification (useful when webhook already sends one)

    Returns:
        {"success": bool, "error": str | None, "order": dict | None}
    """
    orders_collection = db.orders
    invoices_collection = db.invoices

    order = await orders_collection.find_one({"_id": order_id})
    if not order:
        return {"success": False, "error": "Order not found", "order": None}

    current_status = order.get("paymentStatus", "pending")

    # Validate transition
    allowed = VALID_TRANSITIONS.get(current_status, [])
    if new_status not in allowed:
        return {
            "success": False,
            "error": f"Cannot transition from '{current_status}' to '{new_status}'. Allowed: {allowed}",
            "order": None,
        }

    # Build $set update
    now = datetime.utcnow()
    update_set = {
        "paymentStatus": new_status,
        f"{new_status}_at": now,
    }

    if tracking_info is not None:
        update_set["tracking_info"] = tracking_info
    if cancellation_reason is not None:
        update_set["cancellation_reason"] = cancellation_reason
        update_set["cancelled_by"] = changed_by
    if dispute_reason is not None:
        update_set["dispute_reason"] = dispute_reason
    if refund_txid is not None:
        update_set["refund_txid"] = refund_txid
    if extra_update:
        update_set.update(extra_update)

    # Build status history entry
    history_entry = {
        "from_status": current_status,
        "to_status": new_status,
        "changed_by": changed_by,
        "changed_at": now,
        "note": note,
    }

    # Atomic update: only succeed if current status hasn't changed
    result = await orders_collection.find_one_and_update(
        {"_id": order_id, "paymentStatus": current_status},
        {
            "$set": update_set,
            "$push": {"status_history": history_entry},
        },
        return_document=ReturnDocument.AFTER,
    )

    if not result:
        return {"success": False, "error": "Concurrent update conflict - status may have changed", "order": None}

    # Update invoice status
    invoice_status = INVOICE_STATUS_MAP.get(new_status, new_status.title())
    await invoices_collection.update_one(
        {"invoice_id": order_id},
        {"$set": {"status": invoice_status, "updated_at": now}},
    )

    # Send buyer notification
    if not skip_notification:
        await _notify_buyer(db, result, new_status, tracking_info, cancellation_reason, refund_txid)

    # Log stage transition for customer targeting analytics
    await _log_stage_transition(db, result, current_status, new_status, changed_by)

    print(f"[OrderStateMachine] Order {order_id}: {current_status} -> {new_status} (by {changed_by})")
    return {"success": True, "order": result, "error": None}


async def _log_stage_transition(db, order, from_status, to_status, trigger):
    """Log order status transitions for customer targeting analytics.

    Each entry records who transitioned, what changed, and when - enabling
    queries like 'who moved from pending to paid this week' for the
    5-segment customer targeting plan.
    """
    try:
        await db.stage_transitions.insert_one({
            "bot_id": order.get("botId"),
            "user_id": order.get("userId"),
            "order_id": str(order["_id"]),
            "from_stage": from_status,
            "to_stage": to_status,
            "trigger": trigger,
            "timestamp": datetime.utcnow(),
        })
    except Exception as e:
        # Non-critical: don't break the order flow if analytics logging fails
        print(f"[OrderStateMachine] Failed to log stage transition: {e}")


async def _notify_buyer(db, order, new_status, tracking_info=None, cancellation_reason=None, refund_txid=None):
    """Send Telegram notification to buyer about status change."""
    try:
        from aiogram import Bot

        bots_collection = db.bots
        bot_id = order.get("botId")
        bot_config = await bots_collection.find_one({"_id": ObjectId(bot_id) if isinstance(bot_id, str) else bot_id})
        if not bot_config:
            print(f"[OrderStateMachine] No bot config for botId={bot_id}, skipping notification")
            return

        order_id = str(order["_id"])
        message_template = BUYER_MESSAGES.get(new_status, "")
        if not message_template:
            return

        # Get auto_complete_days for delivered message
        auto_complete_days = bot_config.get("auto_complete_days", 3)

        message = message_template.format(
            order_id=order_id,
            tracking=f"\nTracking: {tracking_info}" if tracking_info else "",
            reason=f"\nReason: {cancellation_reason}" if cancellation_reason else "",
            txid=f"\nTransaction: {refund_txid}" if refund_txid else "",
            days=auto_complete_days,
        )

        bot = Bot(token=bot_config["token"])
        try:
            await bot.send_message(chat_id=order.get("userId"), text=message)
            print(f"[OrderStateMachine] Notified buyer {order.get('userId')} about {new_status}")
        finally:
            await bot.session.close()
    except Exception as e:
        print(f"[OrderStateMachine] Failed to notify buyer: {e}")


def get_allowed_transitions(current_status: str) -> list:
    """Return list of statuses that current_status can transition to."""
    return VALID_TRANSITIONS.get(current_status, [])


def is_terminal_status(status: str) -> bool:
    """Check if a status is terminal (no outgoing transitions)."""
    return status not in VALID_TRANSITIONS or len(VALID_TRANSITIONS.get(status, [])) == 0
