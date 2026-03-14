"""
Payout handler for processing commission payouts.
Returns manual send instructions (e.g. Blockonomics-style); no SHKeeper.
"""
from aiohttp import web
import json

from services.blockonomics import send_bitcoin_payment


async def handle_send_payout(request: web.Request) -> web.Response:
    """
    Handle payout request from admin panel.
    Returns instructions for manual send (Blockonomics non-custodial; no programmatic send).
    """
    try:
        data = await request.json()
        to_address = data.get("to_address")
        amount_btc = data.get("amount_btc")

        if not to_address or amount_btc is None:
            return web.Response(
                text=json.dumps({"success": False, "error": "Missing required fields: to_address, amount_btc"}),
                status=400,
                content_type="application/json",
            )

        amount = float(amount_btc)
        if amount <= 0:
            return web.Response(
                text=json.dumps({"success": False, "error": "Amount must be greater than 0"}),
                status=400,
                content_type="application/json",
            )

        result = send_bitcoin_payment(to_address, amount)
        if result.get("success"):
            return web.Response(
                text=json.dumps({
                    "success": True,
                    "message": result.get("message", "Manual processing required."),
                    "to_address": to_address,
                    "amount_btc": amount,
                    "instructions": result.get("instructions", []),
                }),
                status=200,
                content_type="application/json",
            )
        return web.Response(
            text=json.dumps(result),
            status=500,
            content_type="application/json",
        )
    except Exception as e:
        return web.Response(
            text=json.dumps({"success": False, "error": str(e)}),
            status=500,
            content_type="application/json",
        )


def setup_payout_routes(app: web.Application):
    """Setup payout routes"""
    app.router.add_post("/api/payout/send", handle_send_payout)



