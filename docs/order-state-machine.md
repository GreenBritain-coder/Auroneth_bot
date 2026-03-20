# Order Tracking State Machine - Design Document

> Generated: 2026-03-20
> Status: Design Phase - Ready for Implementation

---

## Phase 1: Current State Analysis

### 1.1 Current Order Statuses

The system currently uses a flat `paymentStatus` field on the `orders` collection with three values:

| Status    | Meaning                              |
|-----------|--------------------------------------|
| `pending` | Order created, awaiting crypto payment |
| `paid`    | Payment confirmed via webhook        |
| `failed`  | Payment failed (rarely set)          |

Additionally, the `invoices` collection has a separate `status` field:

| Invoice Status       | Meaning                              |
|----------------------|--------------------------------------|
| `Pending Checkout`   | Invoice created, user filling in delivery/payment details |
| `Pending Payment`    | Checkout confirmed, payment address generated |
| `Paid`               | Payment confirmed                    |

There is also an implicit **expired** state: when `paymentStatus == "pending"` and `payment_deadline` (on the invoice) has passed. This is checked at display time in `orders.py` (lines 189-254) but never persisted.

### 1.2 Current Order Document Schema (MongoDB `orders` collection)

```python
# Created in shop.py handle_confirm_checkout() ~line 2917
order = {
    "_id": order_id,               # str - matches invoice.invoice_id (8-digit numeric)
    "botId": bot_id,               # str - ObjectId as string
    "productId": product_id,       # str - first product ID
    "userId": user_id,             # str - Telegram user ID
    "quantity": int,               # total quantity across all items
    "variation_index": int | None, # first item's variation
    "paymentStatus": "pending",    # "pending" | "paid" | "failed"
    "amount": float,               # total in invoice currency (e.g. GBP)
    "commission": float,           # platform commission amount
    "commission_rate": float,      # e.g. 0.10 for 10%
    "currency": str,               # payment crypto: "BTC", "LTC"
    "timestamp": datetime,         # order creation time
    "encrypted_address": str,      # encrypted delivery address
    "delivery_method": str,        # e.g. "Standard", "Express"
    "shipping_cost": float,        # shipping cost in invoice currency
    "shipping_method_code": str,   # e.g. "STD", "EXP", "NXT"
    "discount_code": str | None,   # applied discount code
    "discount_amount": float,      # discount amount
    "items": list,                 # [{product_id, variation_index, quantity, price}]
    "secret_phrase_hash": str,     # SHA-256 of user's secret phrase at order time
    # Set by webhook:
    "invoiceId": str,              # external payment provider ID
    "paymentDetails": dict,        # provider-specific payment details (set on paid)
}
```

### 1.3 Current Invoice Document Schema (MongoDB `invoices` collection)

```python
invoice = {
    "_id": str,                    # UUID
    "invoice_id": str,             # 8-digit numeric (matches order._id)
    "bot_id": str,
    "user_id": str,
    "cart_id": str,
    "status": str,                 # "Pending Checkout" | "Pending Payment" | "Paid"
    "items": list,                 # cart items
    "total": float,                # subtotal in fiat
    "currency": str,               # fiat currency (e.g. "GBP")
    "discount_code": str | None,
    "discount_amount": float,
    "payment_method": str | None,  # "BTC" | "LTC"
    "delivery_address": str | None,# encrypted
    "delivery_method": str | None,
    "shipping_cost": float,
    "shipping_method_code": str,
    "waiting_for_discount": bool,
    "waiting_for_address": bool,
    "notes": str | None,           # buyer notes
    # Set after checkout confirmation:
    "payment_address": str,        # crypto address to pay
    "payment_amount": float,       # amount in crypto
    "payment_currency": str,       # display name
    "payment_currency_code": str,  # "BTC" / "LTC"
    "payment_invoice_id": str,     # external provider ID
    "payment_exchange_rate": float,
    "payment_deadline": datetime,  # 3 hours after creation
    "payment_qrcode_url": str,
    "payment_uri": str,
    "payment_provider": str,       # "shkeeper" | "cryptapi"
    "telegram_message_id": int,    # for editing payment message
    "telegram_chat_id": int,
    "created_at": datetime,
    "updated_at": datetime,
}
```

### 1.4 Current Flow

```
Cart -> [checkout button] -> Invoice (Pending Checkout)
  -> User fills: payment method, address, delivery method, optional discount
  -> [Complete checkout] -> Confirmation screen
  -> [Confirm] -> Order created (paymentStatus: "pending")
               -> Invoice updated (status: "Pending Payment", payment_address set)
               -> Cart cleared
               -> Payment invoice shown to buyer
  -> [Payment webhook] -> Order updated (paymentStatus: "paid")
                        -> Invoice updated (status: "Paid")
                        -> Commission record created
                        -> Thank-you message sent to buyer
                        -> Invoice message edited to show "Paid"
                        -> Auto-payout to vendor (SHKeeper only)
```

### 1.5 How Vendors Manage Orders (Admin Panel)

The admin panel (`admin-panel/app/admin/orders/page.tsx`) shows a flat table with:
- Order ID, Bot, User ID, Amount, Commission, Status, Date, Address, Notes, Actions
- Only action: "Confirm payment" button (for pending orders) - calls `/api/orders/[id]/confirm`
- Can decrypt delivery addresses using secret phrase
- No ability to update order status beyond "paid"
- No ability to mark shipped, add tracking, etc.

---

## Phase 2: State Machine Design

### 2.1 State Diagram

```
                                    +-----------+
                                    | cancelled |
                                    +-----------+
                                         ^
                                         | (vendor)
                                         |
+----------+     +---------+     +-----------+     +---------+     +-----------+     +-----------+
| pending  | --> |  paid   | --> | confirmed | --> | shipped | --> | delivered | --> | completed |
+----------+     +---------+     +-----------+     +---------+     +-----------+     +-----------+
     |                                                                  |
     |                                                                  v
     v                                                            +-----------+
+-----------+                                                     | disputed  |
|  expired  |                                                     +-----------+
+-----------+                                                          |
                                                                       v
                                                                 +-----------+
                                                                 | refunded  |
                                                                 +-----------+
                                                                       ^
                                                                       |
                                                              (also from: paid,
                                                               confirmed, shipped,
                                                               cancelled)
```

### 2.2 State Definitions

| State       | Description                                          | Terminal? |
|-------------|------------------------------------------------------|-----------|
| `pending`   | Order created, awaiting crypto payment                | No        |
| `paid`      | Payment confirmed by webhook/manual                   | No        |
| `confirmed` | Vendor acknowledged the order, preparing to ship      | No        |
| `shipped`   | Vendor marked as shipped, optionally with tracking    | No        |
| `delivered` | Vendor marked as delivered (or auto after X days)     | No        |
| `completed` | Buyer confirmed receipt or auto-completed after timer | Yes       |
| `disputed`  | Buyer raised a dispute after delivery                 | No        |
| `expired`   | Payment deadline passed without payment               | Yes       |
| `cancelled` | Vendor cancelled the order                            | Yes*      |
| `refunded`  | Refund issued to buyer                                | Yes       |

*Cancelled orders can transition to `refunded` if payment was already received.

### 2.3 State Transitions

| # | From        | To          | Trigger     | Conditions                              |
|---|-------------|-------------|-------------|-----------------------------------------|
| 1 | `pending`   | `paid`      | system      | Payment webhook confirms payment        |
| 2 | `pending`   | `paid`      | vendor      | Manual payment confirmation in admin     |
| 3 | `pending`   | `expired`   | system      | `payment_deadline` passed (auto-cron)    |
| 4 | `pending`   | `cancelled` | vendor      | Vendor cancels before payment            |
| 5 | `paid`      | `confirmed` | vendor      | Vendor acknowledges order in admin       |
| 6 | `paid`      | `cancelled` | vendor      | Vendor cancels (must refund)             |
| 7 | `paid`      | `refunded`  | vendor      | Direct refund without cancellation       |
| 8 | `confirmed` | `shipped`   | vendor      | Vendor marks shipped, optionally adds tracking |
| 9 | `confirmed` | `cancelled` | vendor      | Vendor cancels (must refund)             |
| 10| `confirmed` | `refunded`  | vendor      | Direct refund                            |
| 11| `shipped`   | `delivered` | vendor      | Vendor marks as delivered                |
| 12| `shipped`   | `delivered` | system      | Auto after configurable days (default: 7)|
| 13| `shipped`   | `refunded`  | vendor      | Refund during shipping                   |
| 14| `delivered` | `completed` | buyer       | Buyer confirms receipt in bot            |
| 15| `delivered` | `completed` | system      | Auto after configurable days (default: 3)|
| 16| `delivered` | `disputed`  | buyer       | Buyer raises dispute within window       |
| 17| `disputed`  | `refunded`  | vendor      | Vendor accepts dispute, issues refund    |
| 18| `disputed`  | `completed` | vendor      | Vendor resolves dispute, buyer satisfied |
| 19| `cancelled` | `refunded`  | vendor      | Refund for cancelled paid order          |

### 2.4 Transition Details

#### Transition 1-2: pending -> paid
- **Who:** System (webhook) or Vendor (admin panel manual confirm)
- **DB updates:**
  - `orders.paymentStatus` = `"paid"`
  - `orders.paid_at` = `datetime.utcnow()`
  - `orders.paymentDetails` = webhook data
  - `invoices.status` = `"Paid"`
- **Buyer notification:**
  > "Your payment for Order #{order_id} has been confirmed! The vendor will review your order shortly."
- **Current code:** `payments.py` lines 60-62 (Blockonomics), 164-177 (SHKeeper), 512-523 (CryptAPI); admin `confirm/route.ts` lines 66-79

#### Transition 3: pending -> expired
- **Who:** System (scheduled task / cron)
- **DB updates:**
  - `orders.paymentStatus` = `"expired"`
  - `orders.expired_at` = `datetime.utcnow()`
  - `invoices.status` = `"Expired"`
- **Buyer notification:**
  > "Order #{order_id} has expired. The payment deadline has passed. You can place a new order anytime."
- **Current code:** Only checked at display time in `orders.py` lines 189-254. Not persisted.

#### Transition 4: pending -> cancelled
- **Who:** Vendor (admin panel)
- **DB updates:**
  - `orders.paymentStatus` = `"cancelled"`
  - `orders.cancelled_at` = `datetime.utcnow()`
  - `orders.cancelled_by` = `"vendor"`
  - `orders.cancellation_reason` = user-provided reason
  - `invoices.status` = `"Cancelled"`
- **Buyer notification:**
  > "Order #{order_id} has been cancelled by the vendor. Reason: {reason}"

#### Transition 5: paid -> confirmed
- **Who:** Vendor (admin panel)
- **DB updates:**
  - `orders.paymentStatus` = `"confirmed"`
  - `orders.confirmed_at` = `datetime.utcnow()`
  - `invoices.status` = `"Confirmed"`
- **Buyer notification:**
  > "Great news! Order #{order_id} has been confirmed by the vendor and is being prepared."

#### Transition 6-7: paid -> cancelled / refunded
- **Who:** Vendor (admin panel)
- **DB updates:**
  - `orders.paymentStatus` = `"cancelled"` or `"refunded"`
  - `orders.cancelled_at` / `orders.refunded_at` = `datetime.utcnow()`
  - `orders.refund_txid` = transaction hash (if refunded)
  - `invoices.status` = `"Cancelled"` or `"Refunded"`
- **Buyer notification (cancelled):**
  > "Order #{order_id} has been cancelled. A refund will be processed to your wallet."
- **Buyer notification (refunded):**
  > "A refund for Order #{order_id} has been sent. Transaction: {txid}"

#### Transition 8: confirmed -> shipped
- **Who:** Vendor (admin panel)
- **DB updates:**
  - `orders.paymentStatus` = `"shipped"`
  - `orders.shipped_at` = `datetime.utcnow()`
  - `orders.tracking_info` = optional tracking text
  - `invoices.status` = `"Shipped"`
- **Buyer notification:**
  > "Order #{order_id} has been shipped! {tracking_info if provided}"

#### Transition 11-12: shipped -> delivered
- **Who:** Vendor (admin panel) or System (auto after 7 days)
- **DB updates:**
  - `orders.paymentStatus` = `"delivered"`
  - `orders.delivered_at` = `datetime.utcnow()`
  - `invoices.status` = `"Delivered"`
- **Buyer notification:**
  > "Order #{order_id} has been marked as delivered. Please confirm receipt within 3 days, or it will be auto-completed. If there's an issue, you can open a dispute."

#### Transition 14-15: delivered -> completed
- **Who:** Buyer (bot button) or System (auto after 3 days)
- **DB updates:**
  - `orders.paymentStatus` = `"completed"`
  - `orders.completed_at` = `datetime.utcnow()`
  - `invoices.status` = `"Completed"`
- **Buyer notification (auto):**
  > "Order #{order_id} has been automatically completed. Thank you for your purchase!"
- **Buyer notification (manual):**
  > "Order #{order_id} marked as complete. Thank you!"

#### Transition 16: delivered -> disputed
- **Who:** Buyer (bot button, within dispute window)
- **DB updates:**
  - `orders.paymentStatus` = `"disputed"`
  - `orders.disputed_at` = `datetime.utcnow()`
  - `orders.dispute_reason` = buyer-provided reason
  - `invoices.status` = `"Disputed"`
- **Buyer notification:**
  > "Dispute opened for Order #{order_id}. The vendor has been notified and will review your case."
- **Vendor notification (push to admin/Telegram):**
  > "DISPUTE: Order #{order_id} - Buyer has raised a dispute. Reason: {reason}"

#### Transition 17-18: disputed -> refunded / completed
- **Who:** Vendor (admin panel)
- **DB updates:** Same as refunded/completed above
- **Buyer notification (refunded):**
  > "Your dispute for Order #{order_id} has been resolved. A refund has been issued. Transaction: {txid}"
- **Buyer notification (completed):**
  > "Your dispute for Order #{order_id} has been resolved and the order is now complete."

---

## Phase 3: In-Bot Tracking Interface Design

### 3.1 "My Orders" Menu (updated `orders.py`)

Replace the current flat list with a status-grouped view:

```
[ My Orders ]

Active Orders (2):
  [Shipped] Order 12345678 - Product Name - 2d ago
  [Confirmed] Order 87654321 - Product Name - 5h ago

Pending Payment (1):
  [Pending] Order 11223344 - Product Name - 1h ago

Completed (5):
  [Completed] Order 99887766 - Product Name - Jan 15
  ... and 4 more

[View All Orders]
[Back to Menu]
```

Each order is a clickable inline button leading to the detail view.

### 3.2 Order Detail View (updated `order:` callback handler)

```
Order #12345678

Status: Shipped
Shipped on: 2026-03-18 14:30

Timeline:
  * 2026-03-17 10:00 - Order placed
  * 2026-03-17 10:15 - Payment confirmed
  * 2026-03-17 12:30 - Order confirmed by vendor
  * 2026-03-18 14:30 - Shipped

Products:
  * Product A x2 - 25.00 GBP
  * Product B x1 - 10.00 GBP

Delivery: Express (+5.00 GBP)
Total: 40.00 GBP

Tracking: "Royal Mail - AB123456789GB"

[Confirm Receipt]  [Open Dispute]
[Add Notes]  [Rate Order]
[Back to Orders]
```

Buttons shown depend on state:
- `shipped` / `delivered`: Show "Confirm Receipt" and "Open Dispute"
- `paid` / `confirmed`: Show "Add Notes" only
- `completed`: Show "Rate Order" (if not rated)
- All states: Show "Back to Orders"

### 3.3 Push Notifications

On every state transition, send a proactive Telegram message to the buyer. Implementation: use `bot.send_message(chat_id=order["userId"], ...)` from the admin API or scheduled task, same pattern as current webhook confirmation in `payments.py` lines 198-251.

### 3.4 Dispute Flow (Buyer Side)

```
[Open Dispute] button on delivered order
  -> "Please describe the issue with your order:"
  -> FSM state: waiting_for_dispute_reason
  -> User types reason
  -> "Dispute opened for Order #12345678. The vendor will review your case."
  -> Order status -> disputed
```

---

## Phase 4: Implementation Plan

### 4.1 Database Schema Changes

#### 4.1.1 Order Document - New Fields

Add to `IOrder` in `admin-panel/lib/models.ts` (line 185) and the order creation in `shop.py` (line 2917):

```typescript
// Add to IOrder interface
interface IOrder extends Document {
  // ... existing fields ...
  paymentStatus: 'pending' | 'paid' | 'confirmed' | 'shipped' | 'delivered' | 'completed' | 'disputed' | 'expired' | 'cancelled' | 'refunded';

  // New timestamp fields for timeline
  paid_at?: Date;
  confirmed_at?: Date;
  shipped_at?: Date;
  delivered_at?: Date;
  completed_at?: Date;
  disputed_at?: Date;
  expired_at?: Date;
  cancelled_at?: Date;
  refunded_at?: Date;

  // New tracking/status fields
  tracking_info?: string;          // Vendor-provided tracking text
  cancelled_by?: string;           // "vendor" | "system"
  cancellation_reason?: string;
  dispute_reason?: string;
  refund_txid?: string;            // Blockchain tx hash for refund

  // Status history log
  status_history?: Array<{
    from_status: string;
    to_status: string;
    changed_by: string;            // "system" | "vendor" | "buyer:{userId}"
    changed_at: Date;
    note?: string;
  }>;
}
```

```python
# Add to OrderSchema enum in models.ts line 207
paymentStatus: {
  type: String,
  enum: ['pending', 'paid', 'confirmed', 'shipped', 'delivered',
         'completed', 'disputed', 'expired', 'cancelled', 'refunded'],
  default: 'pending'
}
```

#### 4.1.2 Invoice Document - Status Alignment

Update invoice status values to match (in `shop.py` where statuses are set):

| Order Status | Invoice Status     |
|--------------|-------------------|
| pending      | Pending Payment   |
| paid         | Paid              |
| confirmed    | Confirmed         |
| shipped      | Shipped           |
| delivered    | Delivered         |
| completed    | Completed         |
| disputed     | Disputed          |
| expired      | Expired           |
| cancelled    | Cancelled         |
| refunded     | Refunded          |

#### 4.1.3 Bot Config - New Fields

Add to `IBot` in `admin-panel/lib/models.ts` (line 4):

```typescript
// Auto-transition timers (in days)
auto_deliver_days?: number;     // Default: 7 - auto mark shipped->delivered
auto_complete_days?: number;    // Default: 3 - auto mark delivered->completed
dispute_window_days?: number;   // Default: 3 - how long buyer can dispute after delivered
```

### 4.2 New Handlers/Callbacks (Telegram Bot)

#### 4.2.1 New File: `telegram-bot-service/services/order_state_machine.py`

Core state machine logic, shared between bot handlers and webhook processing:

```python
"""
Order state machine - centralized state transition logic.
All order status changes MUST go through this module.
"""

VALID_TRANSITIONS = {
    "pending":   ["paid", "expired", "cancelled"],
    "paid":      ["confirmed", "cancelled", "refunded"],
    "confirmed": ["shipped", "cancelled", "refunded"],
    "shipped":   ["delivered", "refunded"],
    "delivered": ["completed", "disputed"],
    "disputed":  ["refunded", "completed"],
    "cancelled": ["refunded"],
    # Terminal states: expired, completed, refunded - no outgoing transitions
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

async def transition_order(
    db,
    order_id: str,
    new_status: str,
    changed_by: str,          # "system", "vendor", "buyer:{userId}"
    note: str = None,
    tracking_info: str = None,
    cancellation_reason: str = None,
    dispute_reason: str = None,
    refund_txid: str = None,
) -> dict:
    """
    Transition an order to a new status.
    Returns {"success": bool, "error": str, "order": dict}
    """
    orders_collection = db.orders
    invoices_collection = db.invoices

    order = await orders_collection.find_one({"_id": order_id})
    if not order:
        return {"success": False, "error": "Order not found"}

    current_status = order.get("paymentStatus", "pending")

    # Validate transition
    allowed = VALID_TRANSITIONS.get(current_status, [])
    if new_status not in allowed:
        return {"success": False, "error": f"Cannot transition from '{current_status}' to '{new_status}'"}

    # Build update
    from datetime import datetime
    update = {
        "paymentStatus": new_status,
        f"{new_status}_at": datetime.utcnow(),
    }

    if tracking_info:
        update["tracking_info"] = tracking_info
    if cancellation_reason:
        update["cancellation_reason"] = cancellation_reason
        update["cancelled_by"] = changed_by
    if dispute_reason:
        update["dispute_reason"] = dispute_reason
    if refund_txid:
        update["refund_txid"] = refund_txid

    # Atomic update
    result = await orders_collection.find_one_and_update(
        {"_id": order_id, "paymentStatus": current_status},
        {
            "$set": update,
            "$push": {
                "status_history": {
                    "from_status": current_status,
                    "to_status": new_status,
                    "changed_by": changed_by,
                    "changed_at": datetime.utcnow(),
                    "note": note,
                }
            }
        },
        return_document=True  # Return updated document
    )

    if not result:
        return {"success": False, "error": "Concurrent update conflict"}

    # Update invoice status
    invoice_status = INVOICE_STATUS_MAP.get(new_status, new_status.title())
    await invoices_collection.update_one(
        {"invoice_id": order_id},
        {"$set": {"status": invoice_status, "updated_at": datetime.utcnow()}}
    )

    # Send buyer notification
    await _notify_buyer(db, result, new_status, tracking_info, cancellation_reason, refund_txid)

    return {"success": True, "order": result}


async def _notify_buyer(db, order, new_status, tracking_info, cancellation_reason, refund_txid):
    """Send Telegram notification to buyer about status change."""
    try:
        from aiogram import Bot

        bots_collection = db.bots
        bot_config = await bots_collection.find_one({"_id": order.get("botId")})
        if not bot_config:
            return

        order_id = str(order["_id"])
        message_template = BUYER_MESSAGES.get(new_status, "")
        if not message_template:
            return

        message = message_template.format(
            order_id=order_id,
            tracking=f"\nTracking: {tracking_info}" if tracking_info else "",
            reason=f"\nReason: {cancellation_reason}" if cancellation_reason else "",
            txid=f"\nTransaction: {refund_txid}" if refund_txid else "",
            days=bot_config.get("auto_complete_days", 3),
        )

        bot = Bot(token=bot_config["token"])
        try:
            await bot.send_message(chat_id=order.get("userId"), text=message)
        finally:
            await bot.session.close()
    except Exception as e:
        print(f"[OrderStateMachine] Failed to notify buyer: {e}")
```

#### 4.2.2 New Callbacks in `telegram-bot-service/handlers/orders.py`

Add these callback handlers:

```python
# Buyer confirms receipt
@router.callback_query(F.data.startswith("confirm_receipt:"))
async def handle_confirm_receipt(callback: CallbackQuery):
    order_id = callback.data.split(":")[1]
    # ... validate order belongs to user, status is 'delivered' ...
    from services.order_state_machine import transition_order
    result = await transition_order(db, order_id, "completed", f"buyer:{user_id}")
    # Show success message

# Buyer opens dispute
@router.callback_query(F.data.startswith("dispute:"))
async def handle_open_dispute(callback: CallbackQuery, state: FSMContext):
    order_id = callback.data.split(":")[1]
    # ... validate order belongs to user, status is 'delivered', within dispute window ...
    await state.set_state(DisputeStates.waiting_for_reason)
    await state.update_data(dispute_order_id=order_id)
    await callback.message.answer("Please describe the issue with your order:")

# FSM handler for dispute reason text
@router.message(DisputeStates.waiting_for_reason)
async def handle_dispute_reason(message: Message, state: FSMContext):
    data = await state.get_data()
    order_id = data["dispute_order_id"]
    reason = message.text
    from services.order_state_machine import transition_order
    result = await transition_order(db, order_id, "disputed", f"buyer:{user_id}", dispute_reason=reason)
    await state.clear()
    # Show confirmation
```

#### 4.2.3 Updated Order Detail View in `orders.py`

Replace the current `handle_order_detail` function (line 329) to show timeline and context-sensitive buttons:

```python
# Build timeline from status_history
timeline_text = "*Timeline:*\n"
for entry in order.get("status_history", []):
    ts = entry["changed_at"].strftime("%Y-%m-%d %H:%M")
    timeline_text += f"  {ts} - {entry['from_status']} -> {entry['to_status']}\n"

# Build context-sensitive buttons
buttons = []
status = order.get("paymentStatus")

if status == "delivered":
    buttons.append([InlineKeyboardButton(text="Confirm Receipt", callback_data=f"confirm_receipt:{order_id}")])
    # Check dispute window
    bot_config = await get_bot_config()
    dispute_days = bot_config.get("dispute_window_days", 3)
    delivered_at = order.get("delivered_at")
    if delivered_at and (datetime.utcnow() - delivered_at).days < dispute_days:
        buttons.append([InlineKeyboardButton(text="Open Dispute", callback_data=f"dispute:{order_id}")])

if status in ["shipped", "delivered"]:
    if order.get("tracking_info"):
        # Show tracking info inline (no button needed)
        pass

if status == "paid" and not existing_review:
    buttons.append([InlineKeyboardButton(text="Rate this order", callback_data=f"rate_order:{order_id}")])
```

### 4.3 Admin Panel Changes

#### 4.3.1 New API Route: `admin-panel/app/api/orders/[id]/status/route.ts`

```typescript
// POST /api/orders/{id}/status
// Body: { status: string, note?: string, tracking_info?: string, cancellation_reason?: string, refund_txid?: string }

export async function POST(request, { params }) {
  // Auth check (same as confirm/route.ts)
  // Validate transition is allowed
  // Call MongoDB update with same logic as order_state_machine.py
  // Trigger buyer notification via bot API call
}
```

Vendor-allowed transitions from admin:
- `paid` -> `confirmed`
- `confirmed` -> `shipped` (with optional tracking_info)
- `shipped` -> `delivered`
- `paid`/`confirmed`/`shipped` -> `cancelled` (with reason)
- `cancelled`/`paid`/`confirmed`/`shipped` -> `refunded` (with refund_txid)
- `disputed` -> `refunded` or `completed`

#### 4.3.2 Updated Orders Page: `admin-panel/app/admin/orders/page.tsx`

Replace the single "Confirm payment" button with a status action dropdown:

```
| Status    | Available Actions                                    |
|-----------|------------------------------------------------------|
| pending   | [Confirm Payment] [Cancel]                           |
| paid      | [Confirm Order] [Cancel] [Refund]                    |
| confirmed | [Mark Shipped] [Cancel] [Refund]                     |
| shipped   | [Mark Delivered] [Refund]                            |
| delivered | (waiting for buyer)                                  |
| disputed  | [Resolve (Complete)] [Refund]                        |
| completed | --                                                   |
| expired   | --                                                   |
| cancelled | [Refund]                                             |
| refunded  | --                                                   |
```

Add a "Mark Shipped" modal with optional tracking info text field.
Add a "Cancel" modal with required reason text field.
Add a "Refund" modal with required transaction hash text field.

#### 4.3.3 Admin Order Detail Page (New)

Create `admin-panel/app/admin/orders/[id]/page.tsx`:
- Full order timeline with all status changes
- Decrypted address display
- All items with product details
- Action buttons for current state
- Notes/dispute reason display
- Refund transaction link

### 4.4 Notification Service

#### 4.4.1 Buyer Notifications (Telegram Push)

Already partially implemented in `payments.py` webhook handlers. Centralize into `order_state_machine.py::_notify_buyer()` as shown above. All state transitions call this function.

Pattern (from existing code in `payments.py` lines 198-251):
1. Look up bot config by `order.botId`
2. Create `Bot(token=bot_config["token"])`
3. `bot.send_message(chat_id=order["userId"], text=message)`
4. `bot.session.close()`

#### 4.4.2 Vendor Notifications

For critical events (new paid order, dispute opened), notify vendor. Two options:

**Option A: Telegram notification to vendor** (if bot owner's Telegram ID is stored)
- Add `vendor_telegram_id` field to Bot model
- Send message to vendor on: `paid`, `disputed`

**Option B: Admin panel in-app notification**
- Add `notifications` collection with unread count
- Show badge in admin panel header
- Lower priority, can be added later

Recommend starting with Option A for `disputed` status (critical) and `paid` (helpful).

### 4.5 Auto-Transitions (Scheduled Tasks)

#### 4.5.1 New File: `telegram-bot-service/services/order_scheduler.py`

```python
"""
Scheduled tasks for automatic order state transitions.
Run via asyncio task started in main.py.
"""
import asyncio
from datetime import datetime, timedelta
from database.connection import get_database

async def run_order_scheduler():
    """Main scheduler loop - runs every 5 minutes."""
    while True:
        try:
            await expire_pending_orders()
            await auto_deliver_shipped_orders()
            await auto_complete_delivered_orders()
        except Exception as e:
            print(f"[OrderScheduler] Error: {e}")
        await asyncio.sleep(300)  # 5 minutes


async def expire_pending_orders():
    """Transition pending orders past their payment_deadline to expired."""
    db = get_database()
    invoices_collection = db.invoices

    # Find invoices with passed deadlines that are still pending
    expired_invoices = await invoices_collection.find({
        "status": "Pending Payment",
        "payment_deadline": {"$lt": datetime.utcnow()}
    }).to_list(length=100)

    from services.order_state_machine import transition_order
    for invoice in expired_invoices:
        order_id = invoice.get("invoice_id")
        if order_id:
            await transition_order(db, order_id, "expired", "system",
                                   note="Payment deadline passed")


async def auto_deliver_shipped_orders():
    """Auto-transition shipped orders to delivered after configured days."""
    db = get_database()
    orders_collection = db.orders
    bots_collection = db.bots

    # Get all shipped orders
    shipped_orders = await orders_collection.find({
        "paymentStatus": "shipped"
    }).to_list(length=100)

    from services.order_state_machine import transition_order
    for order in shipped_orders:
        shipped_at = order.get("shipped_at")
        if not shipped_at:
            continue

        # Get bot-specific auto_deliver_days (default 7)
        bot = await bots_collection.find_one({"_id": order.get("botId")})
        days = (bot or {}).get("auto_deliver_days", 7)

        if datetime.utcnow() - shipped_at > timedelta(days=days):
            await transition_order(db, str(order["_id"]), "delivered", "system",
                                   note=f"Auto-delivered after {days} days")


async def auto_complete_delivered_orders():
    """Auto-complete delivered orders after configured days if no dispute."""
    db = get_database()
    orders_collection = db.orders
    bots_collection = db.bots

    delivered_orders = await orders_collection.find({
        "paymentStatus": "delivered"
    }).to_list(length=100)

    from services.order_state_machine import transition_order
    for order in delivered_orders:
        delivered_at = order.get("delivered_at")
        if not delivered_at:
            continue

        bot = await bots_collection.find_one({"_id": order.get("botId")})
        days = (bot or {}).get("auto_complete_days", 3)

        if datetime.utcnow() - delivered_at > timedelta(days=days):
            await transition_order(db, str(order["_id"]), "completed", "system",
                                   note=f"Auto-completed after {days} days")
```

#### 4.5.2 Register Scheduler in `telegram-bot-service/main.py`

Add to the `on_startup` handler (currently around line 214):

```python
from services.order_scheduler import run_order_scheduler

async def on_startup(app):
    # ... existing startup code ...
    asyncio.create_task(run_order_scheduler())
```

### 4.6 Migration Plan

#### Step 1: Schema migration (backward compatible)
- Add new enum values to `paymentStatus` in models.ts - **no data migration needed**, existing `pending`/`paid`/`failed` values remain valid
- `failed` status is grandfathered; new orders will never use it (use `expired` or `cancelled` instead)
- Add new optional fields (`paid_at`, `confirmed_at`, etc.) - old orders just won't have them

#### Step 2: Backfill timestamps for existing paid orders
```python
# One-time migration script
async def backfill_timestamps():
    db = get_database()
    orders = db.orders

    # Set paid_at = timestamp for all existing paid orders
    await orders.update_many(
        {"paymentStatus": "paid", "paid_at": {"$exists": False}},
        [{"$set": {"paid_at": "$timestamp"}}]
    )

    # Mark old pending orders past deadline as expired
    invoices = db.invoices
    old_pending = await invoices.find({
        "status": "Pending Payment",
        "payment_deadline": {"$lt": datetime.utcnow()}
    }).to_list(length=1000)

    for inv in old_pending:
        order_id = inv.get("invoice_id")
        if order_id:
            await orders.update_one(
                {"_id": order_id, "paymentStatus": "pending"},
                {"$set": {"paymentStatus": "expired", "expired_at": datetime.utcnow()}}
            )
            await invoices.update_one(
                {"_id": inv["_id"]},
                {"$set": {"status": "Expired"}}
            )
```

#### Step 3: Deploy in order
1. Deploy `order_state_machine.py` and `order_scheduler.py`
2. Update `payments.py` webhook handlers to use `transition_order()` instead of direct DB updates
3. Update admin panel models and API routes
4. Update admin panel UI
5. Update bot `orders.py` with new detail view and buyer actions
6. Run migration script
7. Start scheduler

### 4.7 Files to Create/Modify Summary

| File | Action | Description |
|------|--------|-------------|
| `telegram-bot-service/services/order_state_machine.py` | **CREATE** | Core state machine logic |
| `telegram-bot-service/services/order_scheduler.py` | **CREATE** | Auto-transition scheduled tasks |
| `telegram-bot-service/handlers/payments.py` | MODIFY | Use `transition_order()` for webhook status updates |
| `telegram-bot-service/handlers/orders.py` | MODIFY | New detail view, timeline, buyer action buttons |
| `telegram-bot-service/handlers/shop.py` | MODIFY | Initialize `status_history` on order creation (~line 2917) |
| `telegram-bot-service/main.py` | MODIFY | Register scheduler on startup |
| `admin-panel/lib/models.ts` | MODIFY | Expand `IOrder` interface and enum values |
| `admin-panel/app/api/orders/[id]/status/route.ts` | **CREATE** | New API for vendor status updates |
| `admin-panel/app/api/orders/[id]/confirm/route.ts` | MODIFY | Use shared transition logic |
| `admin-panel/app/admin/orders/page.tsx` | MODIFY | Status-aware action buttons |
| `admin-panel/app/admin/orders/[id]/page.tsx` | **CREATE** | Order detail page with timeline |
| `telegram-bot-service/scripts/migrate_order_statuses.py` | **CREATE** | One-time backfill migration |
