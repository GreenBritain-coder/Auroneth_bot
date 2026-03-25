from aiogram import Router
from aiogram.types import Message
from aiohttp import web
from bson import ObjectId
from database.connection import get_database
from services.commission import calculate_commission
from datetime import datetime
import asyncio
import json
import os

router = Router()


async def handle_payment_webhook(request: web.Request) -> web.Response:
    """Handle Blockonomics webhook for payment confirmation"""
    import os
    
    # Verify webhook secret — fail closed if not configured
    webhook_secret = os.getenv("WEBHOOK_SECRET")
    if not webhook_secret:
        import logging
        logging.warning("[Blockonomics Webhook] WEBHOOK_SECRET env var is not set. Rejecting all webhook requests.")
        return web.Response(text="Unauthorized: Webhook secret not configured", status=401)
    # Get secret from query parameter
    secret_param = request.query.get("secret", "")
    if secret_param != webhook_secret:
        return web.Response(text="Unauthorized: Invalid secret", status=401)
    
    db = get_database()
    orders_collection = db.orders
    commissions_collection = db.commissions
    
    try:
        # Parse webhook data (Blockonomics sends JSON)
        try:
            data_dict = await request.json()
        except (json.JSONDecodeError, ValueError) as e:
            print(f"[Blockonomics Webhook] JSON parse failed: {e}, trying form data")
            data = await request.post()
            data_dict = dict(data)

        # Extract payment information from Blockonomics webhook
        txn_id = data_dict.get("txn_id") or data_dict.get("txid")
        status = data_dict.get("status") or data_dict.get("value")
        status_text = data_dict.get("status_text", "")
        order_id = data_dict.get("order_id") or data_dict.get("custom") or data_dict.get("addr")

        if not order_id:
            return web.Response(text="Missing order ID", status=400)

        # Check payment status (Blockonomics: status 2 = confirmed, status 0 = unconfirmed)
        payment_confirmed = False
        if isinstance(status, int):
            payment_confirmed = status >= 2
        elif isinstance(status, str):
            payment_confirmed = status.lower() in ["confirmed", "complete", "paid"]
        # Don't accept status_text alone as confirmation (security: prevents forged webhooks)

        if not payment_confirmed:
            return web.Response(text="Payment not confirmed", status=200)

        # Use state machine for atomic transition
        from services.order_state_machine import transition_order
        result = await transition_order(
            db, order_id, "paid", "system",
            note="Payment confirmed via Blockonomics webhook",
        )
        if not result["success"]:
            print(f"[Blockonomics Webhook] Order {order_id} transition failed: {result['error']}")
            return web.Response(text="Already processed", status=200)

        order = result["order"]

        # Mark deposit address as used (run in executor to avoid blocking event loop)
        from database.addresses import mark_address_used
        await asyncio.get_event_loop().run_in_executor(None, mark_address_used, db, str(order_id))

        # HIGH-4: Use upsert with $setOnInsert so a duplicate webhook call is a no-op.
        # A unique filter on {orderId, type} means only one commission record can ever
        # be inserted per order, even under concurrent webhook retries.
        await commissions_collection.update_one(
            {"orderId": order_id, "type": "commission"},
            {"$setOnInsert": {
                "botId": order.get("botId"),
                "orderId": order_id,
                "type": "commission",
                "amount": order.get("commission", 0),
                "timestamp": datetime.utcnow(),
            }},
            upsert=True,
        )

        return web.Response(text="OK")

    except Exception as e:
        import logging
        logging.getLogger(__name__).exception("[Blockonomics Webhook] Unhandled error")
        # LOW-2: Do not expose internal error details to callers
        return web.Response(text="Internal server error", status=500)


async def handle_shkeeper_webhook(request: web.Request) -> web.Response:
    """Handle SHKeeper webhook for payment confirmation"""
    import os
    from services.shkeeper import verify_webhook_signature
    
    # Verify API key from header
    api_key_header = request.headers.get("X-Shkeeper-Api-Key", "")
    if not verify_webhook_signature(dict(request.headers), api_key_header):
        return web.Response(text="Unauthorized: Invalid API key", status=401)

    db = get_database()
    orders_collection = db.orders
    commissions_collection = db.commissions
    
    try:
        # Parse webhook data (SHKeeper sends JSON)
        data_dict = await request.json()
        
        # Extract payment information from SHKeeper webhook
        # SHKeeper callback format based on OpenAPI spec
        external_id = data_dict.get("external_id")
        status = data_dict.get("status")  # PAID, PARTIAL, OVERPAID
        paid = data_dict.get("paid", False)  # boolean
        balance_fiat = data_dict.get("balance_fiat", "0")
        balance_crypto = data_dict.get("balance_crypto", "0")
        crypto = data_dict.get("crypto", "")
        addr = data_dict.get("addr", "")
        transactions = data_dict.get("transactions", [])
        
        if not external_id:
            return web.Response(text="Missing external_id", status=400)
        
        # Check payment status
        # SHKeeper statuses: UNPAID, PARTIAL, PAID, OVERPAID
        payment_confirmed = False
        if status in ["PAID", "OVERPAID"]:
            payment_confirmed = True
        elif paid is True:
            payment_confirmed = True

        if not payment_confirmed:
            return web.Response(text="Payment not confirmed", status=202)

        if payment_confirmed:
            # Validate received amount against order's expected total before marking paid
            order_doc = await orders_collection.find_one({"_id": external_id})
            if order_doc:
                expected_total = float(order_doc.get("amount", 0) or 0)
                received_fiat = float(balance_fiat or 0)
                tolerance = max(0.01, expected_total * 0.01)  # 1% or £0.01 minimum
                if expected_total > 0 and received_fiat < (expected_total - tolerance):
                    print(
                        f"[SHKeeper Webhook] Underpayment detected: received {received_fiat}, "
                        f"expected {expected_total} for order {external_id}"
                    )
                    return web.Response(text="OK", status=200)

            # Use state machine for atomic transition
            from services.order_state_machine import transition_order
            result = await transition_order(
                db, external_id, "paid", "system",
                note="Payment confirmed via SHKeeper webhook",
                extra_update={
                    "paymentDetails": {
                        "status": status,
                        "balance_fiat": balance_fiat,
                        "balance_crypto": balance_crypto,
                        "crypto": crypto,
                        "address": addr,
                        "transactions": transactions,
                    }
                },
            )
            if not result["success"]:
                print(f"[SHKeeper Webhook] Order {external_id} transition failed: {result['error']}")
                return web.Response(text="Already processed", status=202)

            order = result["order"]

            # Mark deposit address as used (run in executor to avoid blocking event loop)
            from database.addresses import mark_address_used
            await asyncio.get_event_loop().run_in_executor(None, mark_address_used, db, str(external_id))

            # HIGH-4: Idempotent upsert — duplicate webhook retries are no-ops.
            await commissions_collection.update_one(
                {"orderId": external_id, "type": "commission"},
                {"$setOnInsert": {
                    "botId": order.get("botId"),
                    "orderId": external_id,
                    "type": "commission",
                    "amount": order.get("commission", 0),
                    "timestamp": datetime.utcnow(),
                }},
                upsert=True,
            )

            # Try to update the invoice message in Telegram to show "Paid"
            try:
                from aiogram import Bot
                from utils.bot_config import get_bot_config

                bot_config = await get_bot_config()
                if not bot_config or str(bot_config.get("_id")) != str(order.get("botId")):
                    bots_collection = db.bots
                    bot_config = await bots_collection.find_one({"_id": ObjectId(order.get("botId")) if isinstance(order.get("botId"), str) else order.get("botId")})

                if bot_config:
                    bot = Bot(token=bot_config["token"])
                    try:
                        invoices_collection = db.invoices
                        invoice = await invoices_collection.find_one({"invoice_id": external_id})
                        if not invoice:
                            invoice = await invoices_collection.find_one({"payment_invoice_id": external_id})

                        if invoice and invoice.get("telegram_message_id") and invoice.get("telegram_chat_id"):
                            from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
                            display_id = invoice.get("invoice_id", external_id)
                            paid_text = (
                                f"\u2705 *Invoice {display_id}*\n\n"
                                f"*Status: Paid*\n"
                                f"\U0001f4b0 Amount: {invoice.get('payment_amount', '')} {invoice.get('payment_currency', '')}\n\n"
                                f"Thank you for your payment!"
                            )
                            paid_keyboard = InlineKeyboardMarkup(inline_keyboard=[
                                [InlineKeyboardButton(text="\u2b05\ufe0f Back to Orders", callback_data=f"back_pay:{display_id}")]
                            ])
                            await bot.edit_message_text(
                                text=paid_text,
                                chat_id=invoice["telegram_chat_id"],
                                message_id=invoice["telegram_message_id"],
                                parse_mode="Markdown",
                                reply_markup=paid_keyboard,
                            )
                            print(f"[SHKeeper Webhook] Invoice message updated to Paid in Telegram")
                    except Exception as e:
                        print(f"[SHKeeper Webhook] Could not update invoice message: {e}")
                    finally:
                        await bot.session.close()
            except Exception as e:
                print(f"Error updating invoice message: {e}")

            # Schedule deferred auto-payout: wait for 1 blockchain confirmation before sending
            # This prevents double-spend attacks on 0-conf detected payments
            try:
                pending_payouts = db.pending_payouts
                existing = await pending_payouts.find_one({"order_id": external_id})
                if not existing:
                    await pending_payouts.insert_one({
                        "order_id": external_id,
                        "crypto": crypto,
                        "balance_crypto": balance_crypto,
                        "bot_id": order.get("botId"),
                        "status": "waiting_confirmation",
                        "created_at": datetime.utcnow(),
                        "confirmations_required": 1,
                        "txid": transactions[0].get("txid") if transactions else None,
                    })
                    print(f"[AutoPayout] Deferred payout for order {external_id} - waiting for 1 confirmation")
                else:
                    print(f"[AutoPayout] Payout already scheduled for order {external_id}")
            except Exception as e:
                print(f"[SHKeeper Webhook] Error scheduling deferred payout for {external_id}: {e}")
                import traceback
                traceback.print_exc()

        # SHKeeper expects 202 Accepted for successful webhook processing
        return web.Response(text="Accepted", status=202)

    except Exception as e:
        import logging
        logging.getLogger(__name__).exception("[SHKeeper Webhook] Unhandled error")
        # LOW-2: Do not expose internal error details to callers
        return web.Response(text="Internal server error", status=500)


PLATFORM_COMMISSION_RATE = float(os.getenv("PLATFORM_COMMISSION_RATE", "0.10"))  # 10% default


async def _process_auto_payout(db, order: dict, order_id: str, crypto: str, balance_crypto: str):
    """
    Automatically pay out the vendor after a confirmed payment.
    Takes platform commission (default 10%) and sends the rest to vendor's wallet.
    """
    from services.shkeeper import create_payout

    bots_collection = db.bots
    bot_config = await bots_collection.find_one({"_id": ObjectId(order.get("botId")) if isinstance(order.get("botId"), str) else order.get("botId")})

    if not bot_config:
        print(f"[AutoPayout] No bot config found for botId={order.get('botId')}, skipping payout")
        return

    # Get vendor's payout address for this currency
    crypto_upper = crypto.upper() if crypto else ""
    payout_address = None

    if crypto_upper == "LTC":
        payout_address = bot_config.get("payout_ltc_address")
    elif crypto_upper == "BTC":
        payout_address = bot_config.get("payout_btc_address")
    elif crypto_upper == "USDT":
        payout_address = bot_config.get("payout_usdt_address")

    if not payout_address:
        print(f"[AutoPayout] No payout address for {crypto_upper} in bot config '{bot_config.get('name')}', skipping")
        return

    # Calculate payout amount
    try:
        total_crypto = float(balance_crypto)
    except (ValueError, TypeError):
        print(f"[AutoPayout] Invalid balance_crypto: {balance_crypto}, skipping")
        return

    if total_crypto <= 0:
        print(f"[AutoPayout] Zero or negative amount, skipping")
        return

    # Use the commission rate stored in the order (calculated at checkout time)
    # to ensure consistency between order record and actual payout
    order_commission_rate = order.get("commission_rate", PLATFORM_COMMISSION_RATE)
    commission_amount = total_crypto * order_commission_rate
    payout_amount = total_crypto - commission_amount

    # Round to 8 decimal places
    payout_amount = round(payout_amount, 8)
    commission_amount = round(commission_amount, 8)

    if payout_amount <= 0:
        print(f"[AutoPayout] Payout amount too small after commission: {payout_amount}")
        return

    print(f"[AutoPayout] Order {order_id}: {total_crypto} {crypto_upper}")
    print(f"[AutoPayout] Commission ({order_commission_rate*100}%): {commission_amount} {crypto_upper}")
    print(f"[AutoPayout] Vendor payout: {payout_amount} {crypto_upper} -> {payout_address}")

    # Send payout via SHKeeper (run sync call in executor to avoid blocking event loop)
    result = await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: create_payout(
            currency=crypto_upper,
            amount=str(payout_amount),
            destination=payout_address,
        )
    )

    # Record payout in database
    payout_record = {
        "orderId": order_id,
        "botId": order.get("botId"),
        "vendorAddress": payout_address,
        "currency": crypto_upper,
        "totalAmount": total_crypto,
        "commissionAmount": commission_amount,
        "commissionRate": order_commission_rate,
        "payoutAmount": payout_amount,
        "createdAt": datetime.utcnow(),
    }

    payouts_collection = db.commission_payouts
    if result.get("success"):
        print(f"[AutoPayout] Payout sent: {payout_amount} {crypto_upper} to {payout_address}, txid={result.get('txid')}")
        payout_record["txid"] = result.get("txid")
        payout_record["status"] = "sent"
    else:
        print(f"[AutoPayout] Payout failed: {result.get('error')}")
        payout_record["txid"] = None
        payout_record["status"] = "failed"
        payout_record["error"] = result.get("error")

    await payouts_collection.insert_one(payout_record)


async def handle_cryptapi_webhook(request: web.Request) -> web.Response:
    """Handle CryptAPI webhook for payment confirmation"""
    import logging

    # Verify webhook secret — fail closed if not configured
    cryptapi_secret = os.getenv("CRYPTAPI_WEBHOOK_SECRET")
    if not cryptapi_secret:
        logging.warning("[CryptAPI Webhook] CRYPTAPI_WEBHOOK_SECRET env var is not set. Rejecting all webhook requests.")
        return web.Response(text="Unauthorized: Webhook secret not configured", status=401)
    # CryptAPI sends callbacks via GET/POST with query params — check secret query param or X-Webhook-Secret header
    provided_secret = request.query.get("secret") or request.headers.get("X-Webhook-Secret", "")
    if provided_secret != cryptapi_secret:
        return web.Response(text="Unauthorized: Invalid webhook secret", status=401)

    db = get_database()
    orders_collection = db.orders
    commissions_collection = db.commissions

    print(f"[CryptAPI Webhook] Received callback request")
    print(f"[CryptAPI Webhook] Method: {request.method}")
    print(f"[CryptAPI Webhook] Query params: {dict(request.query)}")
    print(f"[CryptAPI Webhook] Headers: {dict(request.headers)}")
    
    try:
        # CryptAPI can send data in multiple ways:
        # 1. Query parameters (GET request)
        # 2. POST form data
        # 3. POST JSON
        
        # Start with query parameters (most common for CryptAPI)
        data_dict = dict(request.query)
        
        # Try to get POST body data (only for POST requests)
        if request.method == 'POST':
            content_type = request.headers.get('Content-Type', '').lower()
            
            # Try JSON first
            if 'application/json' in content_type:
                try:
                    json_data = await request.json()
                    if json_data:
                        data_dict.update(json_data)
                        print(f"[CryptAPI Webhook] Received JSON data: {json_data}")
                except Exception as e:
                    print(f"[CryptAPI Webhook] Error parsing JSON: {e}")
            
            # Try form data
            elif 'application/x-www-form-urlencoded' in content_type or 'multipart/form-data' in content_type:
                try:
                    form_data = await request.post()
                    if form_data:
                        form_dict = dict(form_data)
                        if form_dict:
                            data_dict.update(form_dict)
                            print(f"[CryptAPI Webhook] Received form data: {form_dict}")
                except Exception as e:
                    print(f"[CryptAPI Webhook] Error parsing form data: {e}")
            
            # If no content type, try both (read raw body first)
            else:
                try:
                    body = await request.read()
                    if body:
                        body_str = body.decode('utf-8', errors='ignore')
                        print(f"[CryptAPI Webhook] Raw body: {body_str}")
                        # Try to parse as JSON
                        try:
                            import json
                            json_data = json.loads(body_str)
                            data_dict.update(json_data)
                            print(f"[CryptAPI Webhook] Parsed as JSON: {json_data}")
                        except:
                            # Try to parse as form data
                            from urllib.parse import parse_qs
                            form_dict = parse_qs(body_str)
                            if form_dict:
                                # Convert lists to single values
                                for key, value in form_dict.items():
                                    data_dict[key] = value[0] if len(value) == 1 else value
                                print(f"[CryptAPI Webhook] Parsed as form data: {data_dict}")
                except Exception as e:
                    print(f"[CryptAPI Webhook] Error reading body: {e}")
        
        print(f"[CryptAPI Webhook] Combined data: {data_dict}")
        
        # Extract order_id from query parameter (we passed it in callback_url)
        order_id = request.query.get("order_id")
        if not order_id:
            # Try to get from data
            order_id = data_dict.get("order_id") or data_dict.get("invoice_id")
        
        print(f"[CryptAPI Webhook] Order ID: {order_id}")
        
        if not order_id:
            print(f"[CryptAPI Webhook] ERROR: Missing order_id")
            return web.Response(text="Missing order_id", status=400)
        
        # Find order
        order = await orders_collection.find_one({"_id": order_id})
        
        if not order:
            print(f"[CryptAPI Webhook] ERROR: Order not found: {order_id}")
            return web.Response(text="Order not found", status=404)
        
        print(f"[CryptAPI Webhook] Order found: {order_id}, current status: {order.get('paymentStatus')}")

        # Idempotency: skip if already paid (prevents duplicate processing on webhook retry)
        if order.get("paymentStatus") == "paid":
            print(f"[CryptAPI Webhook] Order {order_id} already paid, skipping")
            return web.Response(text="Already processed", status=200)

        # CryptAPI webhook format (from docs):
        # - uuid: Unique payment ID
        # - pending: 1 = pending, 0 = confirmed
        # - value_coin: Amount in crypto
        # - value_paid: Amount actually paid
        # - coin: Currency code (e.g., "ltc", "btc")
        # - status: Payment status (may be in different formats)
        
        # Check multiple possible status fields
        pending = data_dict.get("pending")
        status = data_dict.get("status", "")
        uuid = data_dict.get("uuid", "")
        value_paid = data_dict.get("value_paid") or data_dict.get("value_paid_coin") or "0"
        value_coin = data_dict.get("value_coin") or data_dict.get("value") or "0"
        coin = data_dict.get("coin", "")
        
        # Normalize status
        if status:
            status = str(status).lower()
        
        print(f"[CryptAPI Webhook] Raw data: pending={pending}, status='{status}', uuid={uuid}, value_paid={value_paid}, value_coin={value_coin}, coin={coin}")
        print(f"[CryptAPI Webhook] All data keys: {list(data_dict.keys())}")
        
        # Check payment status
        # CryptAPI uses: pending=0 means confirmed, pending=1 means pending
        # OR status field might be: "pending", "confirmed", "completed", "paid"
        payment_confirmed = False
        
        if pending is not None:
            # pending=0 means confirmed
            if pending == 0 or pending == "0":
                payment_confirmed = True
                print(f"[CryptAPI Webhook] Payment confirmed via pending=0")
        elif status:
            # Check status field
            if status in ["confirmed", "completed", "paid", "success"]:
                payment_confirmed = True
                print(f"[CryptAPI Webhook] Payment confirmed via status='{status}'")
        
        if not payment_confirmed:
            print(f"[CryptAPI Webhook] Payment NOT confirmed. pending={pending}, status='{status}'")

        if payment_confirmed:
            # Validate received crypto amount against the invoice's expected amount
            expected_crypto = float(order.get("payment_amount", 0) or 0)
            received_crypto = float(value_paid or 0)
            if expected_crypto > 0 and received_crypto < (expected_crypto * 0.95):
                print(
                    f"[CryptAPI Webhook] Underpayment detected: received {received_crypto}, "
                    f"expected {expected_crypto} for order {order_id}"
                )
                return web.Response(text="OK", status=200)

            # Use state machine for atomic transition
            print(f"[CryptAPI Webhook] Updating order {order_id} to paid status")
            from services.order_state_machine import transition_order
            result = await transition_order(
                db, order_id, "paid", "system",
                note="Payment confirmed via CryptAPI webhook",
                extra_update={
                    "paymentDetails": {
                        "status": status,
                        "value_paid": value_paid,
                        "value_coin": value_coin,
                        "provider": "cryptapi",
                    }
                },
            )
            if not result["success"]:
                print(f"[CryptAPI Webhook] Order {order_id} transition failed: {result['error']}")
                return web.Response(text="Already processed", status=200)

            order = result["order"]

            # Mark deposit address as used (run in executor to avoid blocking event loop)
            from database.addresses import mark_address_used
            await asyncio.get_event_loop().run_in_executor(None, mark_address_used, db, str(order_id))
            print(f"[CryptAPI Webhook] Order {order_id} marked as paid")

            # HIGH-4: Idempotent upsert — duplicate webhook retries are no-ops.
            await commissions_collection.update_one(
                {"orderId": order_id, "type": "commission"},
                {"$setOnInsert": {
                    "botId": order.get("botId"),
                    "orderId": order_id,
                    "type": "commission",
                    "amount": order.get("commission", 0),
                    "timestamp": datetime.utcnow(),
                }},
                upsert=True,
            )
            print(f"[CryptAPI Webhook] Commission record upserted for order {order_id}")

            # Try to update the invoice message in Telegram to show "Paid"
            try:
                from aiogram import Bot
                from utils.bot_config import get_bot_config

                bot_config = await get_bot_config()
                if not bot_config or str(bot_config.get("_id")) != str(order.get("botId")):
                    bots_collection = db.bots
                    bot_config = await bots_collection.find_one({"_id": ObjectId(order.get("botId")) if isinstance(order.get("botId"), str) else order.get("botId")})

                if bot_config:
                    invoices_collection = db.invoices
                    bot = Bot(token=bot_config["token"])
                    try:
                        invoice = await invoices_collection.find_one({"invoice_id": order_id})
                        if not invoice:
                            invoice = await invoices_collection.find_one({"payment_invoice_id": order_id})

                        if invoice and invoice.get("telegram_message_id") and invoice.get("telegram_chat_id"):
                            from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
                            display_id = invoice.get("invoice_id", order_id)
                            paid_text = (
                                f"\u2705 *Invoice {display_id}*\n\n"
                                f"*Status: Paid*\n"
                                f"\U0001f4b0 Amount: {invoice.get('payment_amount', '')} {invoice.get('payment_currency', '')}\n\n"
                                f"Thank you for your payment!"
                            )
                            paid_keyboard = InlineKeyboardMarkup(inline_keyboard=[
                                [InlineKeyboardButton(text="\u2b05\ufe0f Back to Orders", callback_data=f"back_pay:{display_id}")]
                            ])
                            await bot.edit_message_text(
                                text=paid_text,
                                chat_id=invoice["telegram_chat_id"],
                                message_id=invoice["telegram_message_id"],
                                parse_mode="Markdown",
                                reply_markup=paid_keyboard,
                            )
                            print(f"[CryptAPI Webhook] Invoice message updated to Paid in Telegram")
                    except Exception as e:
                        print(f"[CryptAPI Webhook] Could not update invoice message: {e}")
                    finally:
                        await bot.session.close()
            except Exception as e:
                print(f"Error updating invoice message: {e}")

            return web.Response(text="OK", status=200)
        else:
            # Payment pending
            print(f"[CryptAPI Webhook] Payment still pending for order {order_id}. Status: '{status}'")
            print(f"[CryptAPI Webhook] This is normal if CryptAPI hasn't confirmed the payment yet.")
            print(f"[CryptAPI Webhook] CryptAPI will call this webhook again when payment is confirmed.")
            return web.Response(text="Payment pending", status=200)
            
    except Exception as e:
        import logging, traceback
        logging.getLogger(__name__).exception("[CryptAPI Webhook] Unhandled error")
        traceback.print_exc()
        # LOW-2: Do not expose internal error details to callers
        return web.Response(text="Internal server error", status=500)


# This will be registered as a webhook endpoint in main.py
def setup_webhook(app: web.Application):
    """Setup webhook routes"""
    app.router.add_post("/payment/webhook", handle_payment_webhook)
    app.router.add_post("/payment/shkeeper-webhook", handle_shkeeper_webhook)
    app.router.add_get("/payment/cryptapi-webhook", handle_cryptapi_webhook)  # CryptAPI uses GET with query params
    app.router.add_post("/payment/cryptapi-webhook", handle_cryptapi_webhook)  # Also accept POST

