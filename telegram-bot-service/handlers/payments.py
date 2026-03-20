from aiogram import Router
from aiogram.types import Message
from aiohttp import web
from database.connection import get_database
from services.commission import calculate_commission
from datetime import datetime
import json
import os

router = Router()


async def handle_payment_webhook(request: web.Request) -> web.Response:
    """Handle Blockonomics webhook for payment confirmation"""
    import os
    
    # Verify webhook secret if configured
    webhook_secret = os.getenv("WEBHOOK_SECRET")
    if webhook_secret:
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
        except:
            # Fallback to form data
            data = await request.post()
            data_dict = dict(data)
        
        # Extract payment information from Blockonomics webhook
        # Blockonomics webhook format may vary, adjust based on their API
        txn_id = data_dict.get("txn_id") or data_dict.get("txid")
        status = data_dict.get("status") or data_dict.get("value")  # 0 = unconfirmed, 2 = confirmed
        status_text = data_dict.get("status_text", "")
        order_id = data_dict.get("order_id") or data_dict.get("custom") or data_dict.get("addr")  # Blockonomics uses addr or custom
        
        if not order_id:
            return web.Response(text="Missing order ID", status=400)
        
        # Find order
        order = await orders_collection.find_one({"_id": order_id})
        
        if not order:
            return web.Response(text="Order not found", status=404)
        
        # Check payment status (Blockonomics: status 2 = confirmed, status 0 = unconfirmed)
        # Adjust based on Blockonomics webhook format
        payment_confirmed = False
        if isinstance(status, int):
            payment_confirmed = status >= 2  # Blockonomics uses 2 for confirmed
        elif isinstance(status, str):
            payment_confirmed = status.lower() in ["confirmed", "complete", "paid"]
        elif status_text:
            payment_confirmed = status_text.lower() in ["confirmed", "complete", "paid"]
        
        if payment_confirmed:
            # Payment confirmed
            await orders_collection.update_one(
                {"_id": order_id},
                {"$set": {"paymentStatus": "paid"}}
            )
            # Mark deposit address as used (HD-style address tracking)
            from database.addresses import mark_address_used
            mark_address_used(db, str(order_id))

            # Create commission record if not exists
            existing_commission = await commissions_collection.find_one({"orderId": order_id})
            if not existing_commission:
                commission_record = {
                    "botId": order["botId"],
                    "orderId": order_id,
                    "amount": order["commission"],
                    "timestamp": datetime.utcnow()
                }
                await commissions_collection.insert_one(commission_record)
            
            # Send confirmation message to user
            try:
                from aiogram import Bot
                import os
                from dotenv import load_dotenv
                load_dotenv()
                
                # Get bot config - always fetches fresh from MongoDB
                from utils.bot_config import get_bot_config
                bot_config = await get_bot_config()
                
                # If get_bot_config doesn't match, fall back to finding by botId
                if not bot_config or str(bot_config.get("_id")) != str(order["botId"]):
                    bots_collection = db.bots
                    bot_config = await bots_collection.find_one({"_id": order["botId"]})
                
                if bot_config:
                    bot = Bot(token=bot_config["token"])
                    thank_you_message = bot_config.get("messages", {}).get("thank_you", "Thank you for your purchase!")
                    await bot.send_message(
                        chat_id=order["userId"],
                        text=thank_you_message
                    )
            except Exception as e:
                print(f"Error sending confirmation message: {e}")
        
        return web.Response(text="OK")
    
    except Exception as e:
        print(f"Webhook error: {e}")
        return web.Response(text=f"Error: {str(e)}", status=500)


async def handle_shkeeper_webhook(request: web.Request) -> web.Response:
    """Handle SHKeeper webhook for payment confirmation"""
    import os
    from services.shkeeper import verify_webhook_signature
    
    # Verify API key from header
    api_key_header = request.headers.get("X-Shkeeper-Api-Key", "")
    if not verify_webhook_signature({}, api_key_header):
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
        
        # Find order by external_id (order_id)
        order = await orders_collection.find_one({"_id": external_id})
        
        if not order:
            return web.Response(text="Order not found", status=404)
        
        # Check payment status
        # SHKeeper statuses: UNPAID, PARTIAL, PAID, OVERPAID
        payment_confirmed = False
        if status in ["PAID", "OVERPAID"]:
            payment_confirmed = True
        elif paid is True:
            payment_confirmed = True
        
        if payment_confirmed:
            # Payment confirmed
            await orders_collection.update_one(
                {"_id": external_id},
                {"$set": {
                    "paymentStatus": "paid",
                    "paymentDetails": {
                        "status": status,
                        "balance_fiat": balance_fiat,
                        "balance_crypto": balance_crypto,
                        "crypto": crypto,
                        "address": addr,
                        "transactions": transactions
                    }
                }}
            )
            # Mark deposit address as used (HD-style address tracking)
            from database.addresses import mark_address_used
            mark_address_used(db, str(external_id))

            # Create commission record if not exists
            existing_commission = await commissions_collection.find_one({"orderId": external_id})
            if not existing_commission:
                commission_record = {
                    "botId": order["botId"],
                    "orderId": external_id,
                    "amount": order["commission"],
                    "timestamp": datetime.utcnow()
                }
                await commissions_collection.insert_one(commission_record)
            
            # Send confirmation message to user
            try:
                from aiogram import Bot
                import os
                from dotenv import load_dotenv
                load_dotenv()
                
                # Get bot config - always fetches fresh from MongoDB
                from utils.bot_config import get_bot_config
                bot_config = await get_bot_config()
                
                # If get_bot_config doesn't match, fall back to finding by botId
                if not bot_config or str(bot_config.get("_id")) != str(order["botId"]):
                    bots_collection = db.bots
                    bot_config = await bots_collection.find_one({"_id": order["botId"]})
                
                if bot_config:
                    bot = Bot(token=bot_config["token"])
                    thank_you_message = bot_config.get("messages", {}).get("thank_you", "Thank you for your purchase!")
                    await bot.send_message(
                        chat_id=order["userId"],
                        text=thank_you_message
                    )
                    # Try to update the invoice message in Telegram to show "Paid"
                    try:
                        invoices_collection = db.invoices
                        invoice = await invoices_collection.find_one({"invoice_id": external_id})
                        if not invoice:
                            invoice = await invoices_collection.find_one({"payment_invoice_id": external_id})

                        if invoice and invoice.get("telegram_message_id") and invoice.get("telegram_chat_id"):
                            from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
                            display_id = invoice.get("invoice_id", external_id)
                            paid_text = (
                                f"✅ *Invoice {display_id}*\n\n"
                                f"*Status: Paid*\n"
                                f"💰 Amount: {invoice.get('payment_amount', '')} {invoice.get('payment_currency', '')}\n\n"
                                f"Thank you for your payment!"
                            )
                            paid_keyboard = InlineKeyboardMarkup(inline_keyboard=[
                                [InlineKeyboardButton(text="⬅️ Back to Orders", callback_data=f"back_pay:{display_id}")]
                            ])
                            await bot.edit_message_text(
                                text=paid_text,
                                chat_id=invoice["telegram_chat_id"],
                                message_id=invoice["telegram_message_id"],
                                parse_mode="Markdown",
                                reply_markup=paid_keyboard
                            )
                            print(f"[SHKeeper Webhook] Invoice message updated to Paid in Telegram")
                    except Exception as e:
                        print(f"[SHKeeper Webhook] Could not update invoice message: {e}")

            except Exception as e:
                print(f"Error sending confirmation message: {e}")

            # Auto-payout: send vendor their share (order amount minus platform commission)
            try:
                await _process_auto_payout(db, order, external_id, crypto, balance_crypto)
            except Exception as e:
                print(f"[SHKeeper Webhook] Auto-payout error for order {external_id}: {e}")
                import traceback
                traceback.print_exc()

        # SHKeeper expects 202 Accepted for successful webhook processing
        return web.Response(text="Accepted", status=202)

    except Exception as e:
        print(f"SHKeeper webhook error: {e}")
        return web.Response(text=f"Error: {str(e)}", status=500)


PLATFORM_COMMISSION_RATE = float(os.getenv("PLATFORM_COMMISSION_RATE", "0.10"))  # 10% default


async def _process_auto_payout(db, order: dict, order_id: str, crypto: str, balance_crypto: str):
    """
    Automatically pay out the vendor after a confirmed payment.
    Takes platform commission (default 10%) and sends the rest to vendor's wallet.
    """
    from services.shkeeper import create_payout

    bots_collection = db.bots
    bot_config = await bots_collection.find_one({"_id": order.get("botId")})

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

    commission_amount = total_crypto * PLATFORM_COMMISSION_RATE
    payout_amount = total_crypto - commission_amount

    # Round to 8 decimal places
    payout_amount = round(payout_amount, 8)
    commission_amount = round(commission_amount, 8)

    if payout_amount <= 0:
        print(f"[AutoPayout] Payout amount too small after commission: {payout_amount}")
        return

    print(f"[AutoPayout] Order {order_id}: {total_crypto} {crypto_upper}")
    print(f"[AutoPayout] Commission ({PLATFORM_COMMISSION_RATE*100}%): {commission_amount} {crypto_upper}")
    print(f"[AutoPayout] Vendor payout: {payout_amount} {crypto_upper} -> {payout_address}")

    # Send payout via SHKeeper
    result = create_payout(
        address=payout_address,
        amount=payout_amount,
        currency=crypto_upper,
    )

    if result.get("success"):
        print(f"[AutoPayout] ✅ Payout sent: {payout_amount} {crypto_upper} to {payout_address}, txid={result.get('txid')}")

        # Record payout in database
        payouts_collection = db.commission_payouts
        await payouts_collection.insert_one({
            "orderId": order_id,
            "botId": order.get("botId"),
            "vendorAddress": payout_address,
            "currency": crypto_upper,
            "totalAmount": total_crypto,
            "commissionAmount": commission_amount,
            "commissionRate": PLATFORM_COMMISSION_RATE,
            "payoutAmount": payout_amount,
            "txid": result.get("txid"),
            "status": "sent",
            "createdAt": datetime.utcnow(),
        })
    else:
        print(f"[AutoPayout] ❌ Payout failed: {result.get('error')}")

        # Record failed payout for retry/review
        payouts_collection = db.commission_payouts
        await payouts_collection.insert_one({
            "orderId": order_id,
            "botId": order.get("botId"),
            "vendorAddress": payout_address,
            "currency": crypto_upper,
            "totalAmount": total_crypto,
            "commissionAmount": commission_amount,
            "commissionRate": PLATFORM_COMMISSION_RATE,
            "payoutAmount": payout_amount,
            "txid": None,
            "status": "failed",
            "error": result.get("error"),
            "createdAt": datetime.utcnow(),
        })


async def handle_cryptapi_webhook(request: web.Request) -> web.Response:
    """Handle CryptAPI webhook for payment confirmation"""
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
            # Payment confirmed
            print(f"[CryptAPI Webhook] Updating order {order_id} to paid status")
            await orders_collection.update_one(
                {"_id": order_id},
                {"$set": {
                    "paymentStatus": "paid",
                    "paymentDetails": {
                        "status": status,
                        "value_paid": value_paid,
                        "value_coin": value_coin,
                        "provider": "cryptapi"
                    }
                }}
            )
            # Mark deposit address as used (HD-style address tracking)
            from database.addresses import mark_address_used
            mark_address_used(db, str(order_id))
            print(f"[CryptAPI Webhook] Order {order_id} marked as paid")

            # Also update invoice status if invoice exists
            invoices_collection = db.invoices
            invoice_update_result = await invoices_collection.update_one(
                {"invoice_id": order_id},
                {"$set": {"status": "Paid"}}
            )
            if invoice_update_result.modified_count > 0:
                print(f"[CryptAPI Webhook] Invoice {order_id} status updated to Paid")
            else:
                # Try to find invoice by payment_invoice_id
                invoice_found = await invoices_collection.find_one({"invoice_id": order_id})
                if not invoice_found:
                    # Try alternative invoice lookup
                    await invoices_collection.update_many(
                        {"payment_invoice_id": order_id},
                        {"$set": {"status": "Paid"}}
                    )
                    print(f"[CryptAPI Webhook] Updated invoice(s) linked to order {order_id}")
            
            # Create commission record if not exists
            existing_commission = await commissions_collection.find_one({"orderId": order_id})
            if not existing_commission:
                commission_record = {
                    "botId": order["botId"],
                    "orderId": order_id,
                    "amount": order["commission"],
                    "timestamp": datetime.utcnow()
                }
                await commissions_collection.insert_one(commission_record)
                print(f"[CryptAPI Webhook] Commission record created for order {order_id}")
            
            # Send confirmation message and update invoice message
            try:
                from aiogram import Bot
                import os
                from dotenv import load_dotenv
                load_dotenv()

                from utils.bot_config import get_bot_config
                bot_config = await get_bot_config()

                if not bot_config or str(bot_config.get("_id")) != str(order["botId"]):
                    bots_collection = db.bots
                    bot_config = await bots_collection.find_one({"_id": order["botId"]})

                if bot_config:
                    bot = Bot(token=bot_config["token"])
                    thank_you_message = bot_config.get("messages", {}).get("thank_you", "Thank you for your purchase!")
                    await bot.send_message(
                        chat_id=order["userId"],
                        text=thank_you_message
                    )
                    print(f"[CryptAPI Webhook] Confirmation message sent to user {order['userId']}")

                    # Try to update the invoice message in Telegram to show "Paid"
                    try:
                        invoice = await invoices_collection.find_one({"invoice_id": order_id})
                        if not invoice:
                            invoice = await invoices_collection.find_one({"payment_invoice_id": order_id})

                        if invoice and invoice.get("telegram_message_id") and invoice.get("telegram_chat_id"):
                            from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
                            display_id = invoice.get("invoice_id", order_id)
                            paid_text = (
                                f"✅ *Invoice {display_id}*\n\n"
                                f"*Status: Paid*\n"
                                f"💰 Amount: {invoice.get('payment_amount', '')} {invoice.get('payment_currency', '')}\n\n"
                                f"Thank you for your payment!"
                            )
                            paid_keyboard = InlineKeyboardMarkup(inline_keyboard=[
                                [InlineKeyboardButton(text="⬅️ Back to Orders", callback_data=f"back_pay:{display_id}")]
                            ])
                            await bot.edit_message_text(
                                text=paid_text,
                                chat_id=invoice["telegram_chat_id"],
                                message_id=invoice["telegram_message_id"],
                                parse_mode="Markdown",
                                reply_markup=paid_keyboard
                            )
                            print(f"[CryptAPI Webhook] Invoice message updated to Paid in Telegram")
                    except Exception as e:
                        print(f"[CryptAPI Webhook] Could not update invoice message: {e}")
            except Exception as e:
                print(f"Error sending confirmation message: {e}")
            
            return web.Response(text="OK", status=200)
        else:
            # Payment pending
            print(f"[CryptAPI Webhook] Payment still pending for order {order_id}. Status: '{status}'")
            print(f"[CryptAPI Webhook] This is normal if CryptAPI hasn't confirmed the payment yet.")
            print(f"[CryptAPI Webhook] CryptAPI will call this webhook again when payment is confirmed.")
            return web.Response(text="Payment pending", status=200)
            
    except Exception as e:
        print(f"CryptAPI webhook error: {e}")
        import traceback
        traceback.print_exc()
        return web.Response(text=f"Error: {str(e)}", status=500)


# This will be registered as a webhook endpoint in main.py
def setup_webhook(app: web.Application):
    """Setup webhook routes"""
    app.router.add_post("/payment/webhook", handle_payment_webhook)
    app.router.add_post("/payment/shkeeper-webhook", handle_shkeeper_webhook)
    app.router.add_get("/payment/cryptapi-webhook", handle_cryptapi_webhook)  # CryptAPI uses GET with query params
    app.router.add_post("/payment/cryptapi-webhook", handle_cryptapi_webhook)  # Also accept POST

