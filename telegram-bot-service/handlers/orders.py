"""
Order management handlers - view user orders with status-grouped view,
order detail with timeline, buyer actions (confirm receipt, open dispute).
"""
from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from typing import Union
from database.connection import get_database
from utils.bot_config import get_bot_config
from utils.callback_utils import safe_answer_callback
from datetime import datetime, timedelta

router = Router()


# FSM states for dispute flow
class DisputeStates(StatesGroup):
    waiting_for_reason = State()


# Status display config
STATUS_EMOJI = {
    "pending": "\u23f3",
    "paid": "\U0001f4b0",
    "confirmed": "\u2705",
    "shipped": "\U0001f69a",
    "delivered": "\U0001f4e6",
    "completed": "\u2705",
    "disputed": "\u26a0\ufe0f",
    "expired": "\U0001f6ab",
    "cancelled": "\U0001f6ab",
    "refunded": "\U0001f4b8",
    "failed": "\U0001f6ab",
}

STATUS_LABEL = {
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
    "failed": "Failed",
}

# Group statuses for the summary view
ACTIVE_STATUSES = {"paid", "confirmed", "shipped", "delivered", "disputed"}
PENDING_STATUSES = {"pending"}
COMPLETED_STATUSES = {"completed"}
CLOSED_STATUSES = {"expired", "cancelled", "refunded", "failed"}


@router.message(Command("orders"))
async def handle_orders_command(message: Message):
    """Handle /orders command"""
    await show_user_orders(message)


@router.message(F.text == "Orders")
async def handle_orders_button(message: Message):
    """Handle Orders button from main menu"""
    await show_user_orders(message)


async def show_user_orders(message_or_callback: Union[Message, CallbackQuery]):
    """Display user's orders - status-grouped view with inline buttons."""
    bot_config = await get_bot_config()
    if not bot_config:
        if isinstance(message_or_callback, CallbackQuery):
            await message_or_callback.message.answer("\u274c Bot configuration not found.")
        else:
            await message_or_callback.answer("\u274c Bot configuration not found.")
        return

    bot_id = str(bot_config["_id"])

    if isinstance(message_or_callback, CallbackQuery):
        user = message_or_callback.from_user
        message = message_or_callback.message
    else:
        user = message_or_callback.from_user
        message = message_or_callback

    if not user:
        if isinstance(message_or_callback, CallbackQuery):
            await message_or_callback.message.answer("\u274c Could not identify user.")
        else:
            await message_or_callback.answer("\u274c Could not identify user.")
        return

    user_id = str(user.id)

    # Helper: edit or send depending on context
    async def send_message(text, **kwargs):
        if isinstance(message_or_callback, CallbackQuery):
            try:
                await message.edit_text(text, **kwargs)
            except Exception:
                try:
                    await message.delete()
                except Exception:
                    pass
                await message.answer(text, **kwargs)
        else:
            await message.answer(text, **kwargs)

    db = get_database()
    orders_collection = db.orders
    products_collection = db.products

    # Get user's orders - handle both string and ObjectId botId formats
    from bson import ObjectId
    orders = []

    # Try exact string match first
    try:
        orders = await orders_collection.find({
            "userId": user_id,
            "botId": bot_id,
        }).sort("timestamp", -1).to_list(length=50)
    except Exception:
        pass

    # Try ObjectId match if needed
    if not orders and len(bot_id) == 24:
        try:
            orders = await orders_collection.find({
                "userId": user_id,
                "botId": ObjectId(bot_id),
            }).sort("timestamp", -1).to_list(length=50)
        except Exception:
            pass

    # Fallback: fetch all and filter
    if not orders:
        try:
            all_user_orders = await orders_collection.find({
                "userId": user_id,
            }).sort("timestamp", -1).to_list(length=100)
            orders = [o for o in all_user_orders if str(o.get("botId", "")) == bot_id][:50]
        except Exception:
            pass

    if not orders:
        menu_keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="\U0001f4cb Back to Menu", callback_data="menu")]
        ])
        await send_message("\U0001f4e6 You don't have any orders yet.", reply_markup=menu_keyboard)
        return

    # Group orders by status category
    active = []
    pending = []
    completed = []
    closed = []

    for o in orders:
        status = o.get("paymentStatus", "pending")
        if status in ACTIVE_STATUSES:
            active.append(o)
        elif status in PENDING_STATUSES:
            pending.append(o)
        elif status in COMPLETED_STATUSES:
            completed.append(o)
        else:
            closed.append(o)

    # Build summary text
    text = "\U0001f4e6 *My Orders*\n\n"

    keyboard_buttons = []

    # Active Orders section
    if active:
        text += f"*Active Orders ({len(active)}):*\n"
        for o in active[:5]:
            display_id, product_name, date_str = await _order_summary_line(o, products_collection)
            emoji = STATUS_EMOJI.get(o.get("paymentStatus", ""), "\u2753")
            label = STATUS_LABEL.get(o.get("paymentStatus", ""), o.get("paymentStatus", ""))
            text += f"  {emoji} `{display_id}` - {product_name} - {label}\n"
            keyboard_buttons.append([
                InlineKeyboardButton(
                    text=f"{emoji} [{label}] Order {display_id}",
                    callback_data=f"order_detail:{str(o['_id'])}",
                )
            ])
        if len(active) > 5:
            text += f"  _...and {len(active) - 5} more_\n"
        text += "\n"

    # Pending Payment section
    if pending:
        text += f"*Pending Payment ({len(pending)}):*\n"
        for o in pending[:3]:
            display_id, product_name, date_str = await _order_summary_line(o, products_collection)
            text += f"  \u23f3 `{display_id}` - {product_name} - {date_str}\n"
            keyboard_buttons.append([
                InlineKeyboardButton(
                    text=f"\u23f3 [Pending] Order {display_id}",
                    callback_data=f"order:{str(o['_id'])}",
                )
            ])
        if len(pending) > 3:
            text += f"  _...and {len(pending) - 3} more_\n"
        text += "\n"

    # Completed section
    if completed:
        text += f"*Completed ({len(completed)}):*\n"
        for o in completed[:3]:
            display_id, product_name, date_str = await _order_summary_line(o, products_collection)
            text += f"  \u2705 `{display_id}` - {product_name} - {date_str}\n"
            keyboard_buttons.append([
                InlineKeyboardButton(
                    text=f"\u2705 [Completed] Order {display_id}",
                    callback_data=f"order_detail:{str(o['_id'])}",
                )
            ])
        if len(completed) > 3:
            text += f"  _...and {len(completed) - 3} more_\n"
        text += "\n"

    # Closed section (expired, cancelled, refunded)
    if closed:
        text += f"*Expired/Cancelled ({len(closed)}):*\n"
        for o in closed[:3]:
            display_id, product_name, date_str = await _order_summary_line(o, products_collection)
            emoji = STATUS_EMOJI.get(o.get("paymentStatus", ""), "\U0001f6ab")
            label = STATUS_LABEL.get(o.get("paymentStatus", ""), o.get("paymentStatus", ""))
            text += f"  {emoji} `{display_id}` - {product_name} - {label}\n"
            keyboard_buttons.append([
                InlineKeyboardButton(
                    text=f"{emoji} [{label}] Order {display_id}",
                    callback_data=f"order_detail:{str(o['_id'])}",
                )
            ])
        if len(closed) > 3:
            text += f"  _...and {len(closed) - 3} more_\n"
        text += "\n"

    text += f"*Total Orders:* {len(orders)}"

    # Back to menu button
    keyboard_buttons.append([
        InlineKeyboardButton(text="\u2b05\ufe0f Back to Menu", callback_data="menu")
    ])

    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)
    await send_message(text, parse_mode="Markdown", reply_markup=keyboard)


async def _order_summary_line(order, products_collection):
    """Return (display_id, product_name, date_str) for an order."""
    order_id = str(order.get("_id", ""))
    display_id = order_id[:8] if len(order_id) > 8 else order_id

    product = await get_product_info(products_collection, order.get("productId"))
    product_name = product.get("name", "Unknown") if product else "Unknown"
    # Truncate long product names
    if len(product_name) > 20:
        product_name = product_name[:18] + ".."

    order_date = order.get("timestamp", datetime.utcnow())
    if isinstance(order_date, datetime):
        delta = datetime.utcnow() - order_date
        if delta.days == 0:
            hours = delta.seconds // 3600
            if hours == 0:
                date_str = f"{delta.seconds // 60}m ago"
            else:
                date_str = f"{hours}h ago"
        elif delta.days < 7:
            date_str = f"{delta.days}d ago"
        else:
            date_str = order_date.strftime("%b %d")
    else:
        date_str = str(order_date)[:10]

    return display_id, product_name, date_str


async def get_product_info(products_collection, product_id):
    """Get product information by ID"""
    if not product_id:
        return None

    from bson import ObjectId
    product = None

    try:
        if len(str(product_id)) == 24:
            product = await products_collection.find_one({"_id": ObjectId(product_id)})
    except:
        pass

    if not product:
        product = await products_collection.find_one({"_id": product_id})

    if not product:
        all_products = await products_collection.find({}).to_list(length=100)
        for p in all_products:
            if str(p.get("_id")) == str(product_id):
                product = p
                break

    return product


# ---------- Order Detail with Timeline ----------

@router.callback_query(F.data.startswith("order_detail:"))
async def handle_order_detail_view(callback: CallbackQuery):
    """Show detailed order view with timeline and context-sensitive action buttons."""
    await safe_answer_callback(callback)

    order_id = callback.data.split(":")[1]
    db = get_database()
    orders_collection = db.orders
    products_collection = db.products

    order = await orders_collection.find_one({"_id": order_id})
    if not order:
        await callback.message.answer("\u274c Order not found.")
        return

    # Verify this order belongs to the current user
    user_id = str(callback.from_user.id)
    if str(order.get("userId")) != user_id:
        await callback.message.answer("\u274c This order does not belong to you.")
        return

    display_id = order_id[:8] if len(order_id) > 8 else order_id
    status = order.get("paymentStatus", "pending")
    emoji = STATUS_EMOJI.get(status, "\u2753")
    label = STATUS_LABEL.get(status, status)

    # Build header
    text = f"\U0001f4e6 *Order #{display_id}*\n\n"
    text += f"*Status:* {emoji} {label}\n"

    # Show relevant timestamp
    status_ts = order.get(f"{status}_at")
    if status_ts and isinstance(status_ts, datetime):
        text += f"*{label} on:* {status_ts.strftime('%Y-%m-%d %H:%M')} UTC\n"

    # Tracking info
    if order.get("tracking_info"):
        text += f"*Tracking:* {order['tracking_info']}\n"

    # Dispute/cancellation reason
    if status == "disputed" and order.get("dispute_reason"):
        text += f"*Dispute reason:* {order['dispute_reason']}\n"
    if status == "cancelled" and order.get("cancellation_reason"):
        text += f"*Cancellation reason:* {order['cancellation_reason']}\n"
    if status == "refunded" and order.get("refund_txid"):
        text += f"*Refund TX:* `{order['refund_txid']}`\n"

    text += "\n"

    # Timeline
    status_history = order.get("status_history", [])
    if status_history:
        text += "*Timeline:*\n"
        for entry in status_history:
            ts = entry.get("changed_at")
            if isinstance(ts, datetime):
                ts_str = ts.strftime("%Y-%m-%d %H:%M")
            else:
                ts_str = str(ts)[:16]
            from_s = entry.get("from_status", "?")
            to_s = entry.get("to_status", "?")
            to_emoji = STATUS_EMOJI.get(to_s, "")
            text += f"  {to_emoji} {ts_str} - {STATUS_LABEL.get(to_s, to_s)}\n"
            if entry.get("note"):
                text += f"      _{entry['note']}_\n"
    else:
        # Fallback timeline from timestamps
        text += "*Timeline:*\n"
        created = order.get("timestamp")
        if created and isinstance(created, datetime):
            text += f"  \U0001f4dd {created.strftime('%Y-%m-%d %H:%M')} - Order placed\n"
        if order.get("paid_at") and isinstance(order["paid_at"], datetime):
            text += f"  \U0001f4b0 {order['paid_at'].strftime('%Y-%m-%d %H:%M')} - Payment confirmed\n"

    text += "\n"

    # Products / items
    items = order.get("items", [])
    if items:
        text += "*Products:*\n"
        for item in items[:5]:
            product = await get_product_info(products_collection, item.get("product_id"))
            pname = product.get("name", "Unknown") if product else "Unknown"
            qty = item.get("quantity", 1)
            price = item.get("price", 0)
            text += f"  \u2022 {pname} x{qty} - {price}\n"
    else:
        product = await get_product_info(products_collection, order.get("productId"))
        if product:
            text += f"*Product:* {product.get('name', 'Unknown')} x{order.get('quantity', 1)}\n"

    # Delivery & totals
    if order.get("delivery_method"):
        shipping = order.get("shipping_cost", 0)
        text += f"*Delivery:* {order['delivery_method']}"
        if shipping:
            text += f" (+{shipping})"
        text += "\n"

    text += f"*Total:* {order.get('amount', 0)}\n"

    # Build action buttons based on status
    buttons = []

    if status == "delivered":
        buttons.append([
            InlineKeyboardButton(text="\u2705 Confirm Receipt", callback_data=f"confirm_receipt:{order_id}"),
        ])
        # Check dispute window
        bot_config = await get_bot_config()
        dispute_days = (bot_config or {}).get("dispute_window_days", 3)
        delivered_at = order.get("delivered_at")
        if delivered_at and isinstance(delivered_at, datetime):
            if (datetime.utcnow() - delivered_at).days < dispute_days:
                buttons.append([
                    InlineKeyboardButton(text="\u26a0\ufe0f Open Dispute", callback_data=f"dispute:{order_id}"),
                ])

    if status == "shipped":
        buttons.append([
            InlineKeyboardButton(text="\u2705 Confirm Receipt", callback_data=f"confirm_receipt:{order_id}"),
        ])

    # Back to orders button always
    buttons.append([
        InlineKeyboardButton(text="\u2b05\ufe0f Back to Orders", callback_data="show_orders"),
    ])

    keyboard = InlineKeyboardMarkup(inline_keyboard=buttons)

    try:
        await callback.message.edit_text(text, parse_mode="Markdown", reply_markup=keyboard)
    except Exception:
        try:
            await callback.message.delete()
        except Exception:
            pass
        await callback.message.answer(text, parse_mode="Markdown", reply_markup=keyboard)


# ---------- Legacy order: callback (for pending orders that show payment invoice) ----------

@router.callback_query(F.data.startswith("order:"))
async def handle_order_detail(callback: CallbackQuery):
    """Handle order detail button click - show payment invoice for pending orders,
    or redirect to detail view for others."""
    await safe_answer_callback(callback)

    order_id = callback.data.split(":")[1]

    # Normalize order_id
    if order_id.lower().startswith("inv-"):
        order_id = order_id[4:]

    order_id_variants = [order_id, order_id.upper(), order_id.lower()]

    db = get_database()
    invoices_collection = db.invoices
    orders_collection = db.orders

    # Find the order first to check status
    order = None
    for variant in order_id_variants:
        order = await orders_collection.find_one({"_id": variant})
        if order:
            break

    # If order is in an active/completed/closed state (not pending), show detail view
    if order and order.get("paymentStatus") not in ("pending", None):
        # Redirect to the detail view
        callback.data = f"order_detail:{str(order['_id'])}"
        await handle_order_detail_view(callback)
        return

    # For pending orders, show the payment invoice (existing behavior)
    invoice = None
    found_variant = None

    for variant in order_id_variants:
        invoice = await invoices_collection.find_one({"invoice_id": variant})
        if invoice:
            found_variant = variant
            break
        invoice = await invoices_collection.find_one({"_id": variant})
        if invoice:
            found_variant = variant
            break

    if not invoice and order:
        invoice = await invoices_collection.find_one({"invoice_id": str(order.get("_id"))})
        if invoice:
            found_variant = str(order.get("_id"))

    if invoice:
        invoice_id = invoice.get("invoice_id", found_variant or order_id)
        invoice_status = invoice.get("status", "").lower()
        has_payment_address = bool(invoice.get("payment_address"))
        is_paid = invoice_status in ["paid", "completed"]

        # Check order payment status too
        if order and order.get("paymentStatus", "").lower() == "paid":
            is_paid = True

        # Check if expired
        is_expired_or_cancelled = False
        if not is_paid:
            payment_status = order.get("paymentStatus", "pending") if order else "pending"
            if payment_status.lower() in ["failed", "cancelled", "expired"]:
                is_expired_or_cancelled = True
            else:
                payment_deadline = invoice.get("payment_deadline")
                if payment_deadline:
                    if isinstance(payment_deadline, str):
                        try:
                            from dateutil import parser
                            payment_deadline = parser.parse(payment_deadline)
                        except Exception:
                            payment_deadline = None
                    if payment_deadline and datetime.utcnow() > payment_deadline:
                        is_expired_or_cancelled = True

        if is_expired_or_cancelled:
            from handlers.shop import show_cancelled_order_invoice
            await show_cancelled_order_invoice(invoice_id, callback)
        elif has_payment_address or is_paid:
            from handlers.shop import show_payment_invoice
            await show_payment_invoice(invoice_id, callback)
        else:
            from handlers.shop import show_checkout_invoice
            await show_checkout_invoice(invoice_id, callback)
    else:
        error_msg = f"\u274c Invoice not found for order {order_id}."
        await callback.message.answer(error_msg, parse_mode="Markdown")


# ---------- Back to Orders callback ----------

@router.callback_query(F.data == "show_orders")
async def handle_show_orders(callback: CallbackQuery):
    """Return to orders list."""
    await safe_answer_callback(callback)
    await show_user_orders(callback)


# ---------- Confirm Receipt ----------

@router.callback_query(F.data.startswith("confirm_receipt:"))
async def handle_confirm_receipt(callback: CallbackQuery):
    """Buyer confirms receipt of a delivered/shipped order."""
    await safe_answer_callback(callback)

    order_id = callback.data.split(":")[1]
    user_id = str(callback.from_user.id)

    db = get_database()
    orders_collection = db.orders

    order = await orders_collection.find_one({"_id": order_id})
    if not order:
        await callback.message.answer("\u274c Order not found.")
        return

    if str(order.get("userId")) != user_id:
        await callback.message.answer("\u274c This order does not belong to you.")
        return

    if order.get("paymentStatus") not in ("delivered", "shipped"):
        await callback.message.answer(
            f"\u274c Cannot confirm receipt. Order status is '{order.get('paymentStatus')}'."
        )
        return

    # If status is shipped, we need to first transition to delivered, then to completed
    from services.order_state_machine import transition_order

    if order.get("paymentStatus") == "shipped":
        # Transition shipped -> delivered first
        result = await transition_order(
            db, order_id, "delivered", f"buyer:{user_id}",
            note="Buyer confirmed receipt (shipped -> delivered)",
            skip_notification=True,
        )
        if not result["success"]:
            await callback.message.answer(f"\u274c Error: {result['error']}")
            return

    # Transition delivered -> completed
    result = await transition_order(
        db, order_id, "completed", f"buyer:{user_id}",
        note="Buyer confirmed receipt",
    )

    if result["success"]:
        text = (
            f"\u2705 *Order #{order_id[:8] if len(order_id) > 8 else order_id} Completed*\n\n"
            f"Thank you for confirming receipt! Your order is now complete."
        )
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="\u2b05\ufe0f Back to Orders", callback_data="show_orders")]
        ])
        try:
            await callback.message.edit_text(text, parse_mode="Markdown", reply_markup=keyboard)
        except Exception:
            await callback.message.answer(text, parse_mode="Markdown", reply_markup=keyboard)
    else:
        await callback.message.answer(f"\u274c Error: {result['error']}")


# ---------- Open Dispute ----------

@router.callback_query(F.data.startswith("dispute:"))
async def handle_open_dispute(callback: CallbackQuery, state: FSMContext):
    """Buyer starts dispute flow - asks for reason."""
    await safe_answer_callback(callback)

    order_id = callback.data.split(":")[1]
    user_id = str(callback.from_user.id)

    db = get_database()
    orders_collection = db.orders

    order = await orders_collection.find_one({"_id": order_id})
    if not order:
        await callback.message.answer("\u274c Order not found.")
        return

    if str(order.get("userId")) != user_id:
        await callback.message.answer("\u274c This order does not belong to you.")
        return

    if order.get("paymentStatus") != "delivered":
        await callback.message.answer(
            f"\u274c Cannot open dispute. Order status is '{order.get('paymentStatus')}'."
        )
        return

    # Check dispute window
    bot_config = await get_bot_config()
    dispute_days = (bot_config or {}).get("dispute_window_days", 3)
    delivered_at = order.get("delivered_at")
    if delivered_at and isinstance(delivered_at, datetime):
        if (datetime.utcnow() - delivered_at).days >= dispute_days:
            await callback.message.answer(
                f"\u274c The dispute window ({dispute_days} days) has closed for this order."
            )
            return

    # Set FSM state to collect dispute reason
    await state.set_state(DisputeStates.waiting_for_reason)
    await state.update_data(dispute_order_id=order_id)

    text = (
        f"\u26a0\ufe0f *Open Dispute for Order #{order_id[:8]}*\n\n"
        f"Please describe the issue with your order.\n"
        f"Type your message below:"
    )
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="\u274c Cancel", callback_data=f"order_detail:{order_id}")]
    ])
    try:
        await callback.message.edit_text(text, parse_mode="Markdown", reply_markup=keyboard)
    except Exception:
        await callback.message.answer(text, parse_mode="Markdown", reply_markup=keyboard)


@router.message(DisputeStates.waiting_for_reason)
async def handle_dispute_reason(message: Message, state: FSMContext):
    """Handle dispute reason text from buyer."""
    data = await state.get_data()
    order_id = data.get("dispute_order_id")
    if not order_id:
        await state.clear()
        await message.answer("\u274c Dispute session expired. Please try again from your orders.")
        return

    reason = message.text
    if not reason or len(reason.strip()) < 5:
        await message.answer("Please provide a more detailed description of the issue (at least 5 characters).")
        return

    user_id = str(message.from_user.id)
    db = get_database()

    from services.order_state_machine import transition_order
    result = await transition_order(
        db, order_id, "disputed", f"buyer:{user_id}",
        dispute_reason=reason.strip(),
        note=f"Dispute opened by buyer: {reason.strip()[:100]}",
    )

    await state.clear()

    if result["success"]:
        text = (
            f"\u26a0\ufe0f *Dispute Opened for Order #{order_id[:8]}*\n\n"
            f"Your dispute has been submitted. The vendor has been notified and will review your case.\n\n"
            f"*Reason:* {reason.strip()}"
        )
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="\u2b05\ufe0f Back to Orders", callback_data="show_orders")]
        ])
        await message.answer(text, parse_mode="Markdown", reply_markup=keyboard)
    else:
        await message.answer(f"\u274c Error opening dispute: {result['error']}")
