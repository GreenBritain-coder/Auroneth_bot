"""
Web Bridge API - Server-to-server endpoints called by Next.js frontend.
Handles SHKeeper payment operations so that SHKeeper credentials
never leave the Python service.
"""
import os
import hashlib
import secrets
from aiohttp import web
from bson import ObjectId
from datetime import datetime, timedelta
from database.connection import get_database
from services.shkeeper import (
    get_available_cryptocurrencies,
    create_invoice,
    verify_webhook_signature,
    API_KEY as SHKEEPER_API_KEY,
)
from services.order_state_machine import transition_order

BRIDGE_API_KEY = os.getenv("BRIDGE_API_KEY", "")


def bridge_auth_middleware(handler):
    """Validate X-Bridge-Key header on all bridge requests."""

    async def wrapper(request: web.Request) -> web.Response:
        if not BRIDGE_API_KEY:
            print("[WebBridge] WARNING: BRIDGE_API_KEY not configured")
            return web.json_response(
                {"error": "Bridge not configured"}, status=503
            )
        key = request.headers.get("X-Bridge-Key", "")
        if key != BRIDGE_API_KEY:
            return web.json_response({"error": "Unauthorized"}, status=401)
        return await handler(request)

    return wrapper


@bridge_auth_middleware
async def get_payment_methods(request: web.Request) -> web.Response:
    """
    GET /api/web/{bot_id}/payment-methods
    Returns available crypto wallets from SHKeeper, filtered by bot config.
    """
    bot_id = request.match_info["bot_id"]
    db = get_database()

    try:
        bot_oid = ObjectId(bot_id)
    except Exception:
        return web.json_response({"error": "Invalid bot_id"}, status=400)

    bot = await db.bots.find_one({"_id": bot_oid})
    if not bot:
        return web.json_response({"error": "Bot not found"}, status=404)

    # Get available cryptos from SHKeeper (uses caching internally)
    import asyncio

    result = await asyncio.get_event_loop().run_in_executor(
        None, get_available_cryptocurrencies
    )

    if not result.get("success"):
        return web.json_response(
            {"error": result.get("error", "Failed to fetch payment methods")},
            status=502,
        )

    # SHKeeper returns crypto list in different formats
    crypto_list = result.get("crypto_list", []) or result.get("crypto", [])

    # Build normalized methods list
    # Map SHKeeper codes to display names
    display_names = {
        "BTC": ("Bitcoin", "btc"),
        "LTC": ("Litecoin", "ltc"),
        "ETH": ("Ethereum", "eth"),
        "DOGE": ("Dogecoin", "doge"),
        "USDT": ("Tether (TRC20)", "usdt"),
        "USDC": ("USD Coin", "usdc"),
        "XMR": ("Monero", "xmr"),
        "BNB": ("Binance Coin", "bnb"),
        "TRX": ("Tron", "trx"),
    }

    # Bot's configured payment methods (if any)
    bot_methods = bot.get("payment_methods", [])

    methods = []
    seen = set()
    for crypto in crypto_list:
        code = crypto.get("code") or crypto.get("name", "")
        code_upper = code.upper() if isinstance(code, str) else str(code).upper()

        # Filter by bot's configured methods if the bot has any
        if bot_methods and code_upper not in [m.upper() for m in bot_methods]:
            continue

        if code_upper in seen:
            continue
        seen.add(code_upper)

        name, icon = display_names.get(code_upper, (code_upper, code_upper.lower()))
        methods.append({"currency": code_upper, "name": name, "icon": icon})

    return web.json_response({"methods": methods})


@bridge_auth_middleware
async def create_web_invoice(request: web.Request) -> web.Response:
    """
    POST /api/web/{bot_id}/create-invoice
    Creates a SHKeeper invoice for a web order with per-order address_salt encryption.
    """
    bot_id = request.match_info["bot_id"]
    db = get_database()

    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    order_id = data.get("order_id")
    fiat_amount = data.get("fiat_amount")
    crypto_currency = data.get("crypto_currency")
    address_salt = data.get("address_salt", "")
    callback_url = data.get("callback_url", "")

    if not all([order_id, fiat_amount, crypto_currency]):
        return web.json_response(
            {"error": "Missing required fields: order_id, fiat_amount, crypto_currency"},
            status=400,
        )

    try:
        bot_oid = ObjectId(bot_id)
    except Exception:
        return web.json_response({"error": "Invalid bot_id"}, status=400)

    bot = await db.bots.find_one({"_id": bot_oid})
    if not bot:
        return web.json_response({"error": "Bot not found"}, status=404)

    # Derive per-order encryption key: SHA256(SYSTEM_KEY + address_salt)
    system_key = os.getenv("SYSTEM_KEY", "")
    if system_key and address_salt:
        encryption_key = hashlib.sha256(
            (system_key + address_salt).encode()
        ).hexdigest()
        print(f"[WebBridge] Derived encryption key for order {order_id}")
    else:
        encryption_key = None
        print(f"[WebBridge] WARNING: No SYSTEM_KEY or address_salt for order {order_id}")

    # Create invoice via SHKeeper (synchronous call run in executor)
    import asyncio

    result = await asyncio.get_event_loop().run_in_executor(
        None,
        lambda: create_invoice(
            amount=float(fiat_amount),
            currency=crypto_currency,
            order_id=str(order_id),
            fiat_currency="USD",
        ),
    )

    if not result.get("success"):
        print(f"[WebBridge] SHKeeper invoice creation failed: {result.get('error')}")
        return web.json_response(
            {"error": result.get("error", "Failed to create invoice")},
            status=502,
        )

    # Extract payment details from SHKeeper response
    payment_address = result.get("wallet") or result.get("address", "")
    crypto_amount = result.get("amount") or result.get("crypto_amount", "0")
    invoice_id = result.get("id") or result.get("invoice_id", "")
    exchange_rate = result.get("exchange_rate", "0")

    # Create invoice document in MongoDB
    invoice_doc = {
        "invoice_id": str(invoice_id) if invoice_id else str(order_id),
        "payment_invoice_id": str(order_id),
        "bot_id": bot_id,
        "order_id": str(order_id),
        "source": "web",
        "status": "pending",
        "payment_address": payment_address,
        "payment_amount": str(crypto_amount),
        "payment_currency": crypto_currency,
        "fiat_amount": float(fiat_amount),
        "fiat_currency": "USD",
        "exchange_rate": str(exchange_rate),
        "address_salt": address_salt,
        "created_at": datetime.utcnow(),
    }

    await db.invoices.insert_one(invoice_doc)

    # Calculate expiry (15 min from now)
    expires_at = datetime.utcnow() + timedelta(minutes=15)

    return web.json_response(
        {
            "payment_address": payment_address,
            "crypto_amount": str(crypto_amount),
            "invoice_id": str(invoice_id) if invoice_id else str(order_id),
            "exchange_rate": str(exchange_rate),
            "expires_at": expires_at.isoformat() + "Z",
        }
    )


async def handle_web_payment_webhook(request: web.Request) -> web.Response:
    """
    POST /api/web/webhook/payment
    Handles SHKeeper payment webhooks for web orders.
    No bridge auth - uses SHKeeper API key validation instead.
    """
    # Verify SHKeeper API key from header
    api_key_header = request.headers.get("X-Shkeeper-Api-Key", "")
    if not verify_webhook_signature({}, api_key_header):
        return web.Response(text="Unauthorized: Invalid API key", status=401)

    db = get_database()

    try:
        data = await request.json()
    except Exception:
        return web.Response(text="Invalid JSON", status=400)

    external_id = data.get("external_id")
    status = data.get("status")
    paid = data.get("paid", False)
    balance_fiat = data.get("balance_fiat", "0")
    balance_crypto = data.get("balance_crypto", "0")
    crypto = data.get("crypto", "")
    addr = data.get("addr", "")
    transactions = data.get("transactions", [])

    if not external_id:
        return web.Response(text="Missing external_id", status=400)

    print(f"[WebBridge Webhook] Received payment callback for {external_id}, status={status}, paid={paid}")

    # Check payment status
    payment_confirmed = status in ("PAID", "OVERPAID") or paid is True
    if not payment_confirmed:
        return web.Response(text="Payment not confirmed", status=202)

    # Validate received amount against order's expected total before marking paid
    orders_collection = db.orders
    order_doc = await orders_collection.find_one({"_id": external_id})
    if order_doc:
        expected_total = float(order_doc.get("amount", 0) or 0)
        received_fiat = float(balance_fiat or 0)
        tolerance = max(0.01, expected_total * 0.01)  # 1% or £0.01 minimum
        if expected_total > 0 and received_fiat < (expected_total - tolerance):
            print(
                f"[WebBridge Webhook] Underpayment detected: received {received_fiat}, "
                f"expected {expected_total} for order {external_id}"
            )
            return web.Response(text="OK", status=200)

    # Transition order via state machine
    result = await transition_order(
        db,
        external_id,
        "paid",
        "system",
        note="Payment confirmed via SHKeeper webhook (web order)",
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
        print(f"[WebBridge Webhook] Order {external_id} transition failed: {result['error']}")
        return web.Response(text="Already processed", status=202)

    order = result["order"]

    # Mark deposit address as used
    try:
        import asyncio
        from database.addresses import mark_address_used

        await asyncio.get_event_loop().run_in_executor(
            None, mark_address_used, db, str(external_id)
        )
    except Exception as e:
        print(f"[WebBridge Webhook] Error marking address used: {e}")

    # Create commission record
    existing_commission = await db.commissions.find_one({"orderId": external_id})
    if not existing_commission:
        await db.commissions.insert_one(
            {
                "botId": order.get("botId"),
                "orderId": external_id,
                "amount": order.get("commission", 0),
                "timestamp": datetime.utcnow(),
            }
        )

    # Schedule deferred auto-payout (same as Telegram flow)
    try:
        existing_payout = await db.pending_payouts.find_one({"order_id": external_id})
        if not existing_payout:
            await db.pending_payouts.insert_one(
                {
                    "order_id": external_id,
                    "crypto": crypto,
                    "balance_crypto": balance_crypto,
                    "bot_id": order.get("botId"),
                    "status": "waiting_confirmation",
                    "created_at": datetime.utcnow(),
                    "confirmations_required": 1,
                    "txid": transactions[0].get("txid") if transactions else None,
                }
            )
            print(f"[WebBridge Webhook] Deferred payout scheduled for web order {external_id}")
    except Exception as e:
        print(f"[WebBridge Webhook] Error scheduling payout: {e}")

    # Update invoice status
    await db.invoices.update_one(
        {"order_id": str(external_id)},
        {"$set": {"status": "paid", "paid_at": datetime.utcnow()}},
    )

    return web.Response(text="Accepted", status=202)


def setup_web_bridge_routes(app: web.Application):
    """Register all web bridge API routes."""
    app.router.add_get(
        "/api/web/{bot_id}/payment-methods", get_payment_methods
    )
    app.router.add_post(
        "/api/web/{bot_id}/create-invoice", create_web_invoice
    )
    app.router.add_post(
        "/api/web/webhook/payment", handle_web_payment_webhook
    )
