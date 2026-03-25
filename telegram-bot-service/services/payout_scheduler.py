"""Deferred payout processor - waits for blockchain confirmations before sending payouts."""
import asyncio
import logging
import os
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# How long a record can stay in "processing" before being considered stale (minutes).
PROCESSING_STALE_MINUTES = 10

# Minimum confirmations required for TRON/USDT (fast finality, but not instant).
# Set MIN_CONFIRMATIONS_TRON=0 only if you explicitly accept zero-conf risk.
MIN_CONFIRMATIONS_TRON = int(os.getenv("MIN_CONFIRMATIONS_TRON", "1"))

PAYOUT_CHECK_INTERVAL = 60  # Check every 60 seconds


async def run_payout_scheduler():
    """Background task that processes pending payouts after blockchain confirmation."""
    print("[PayoutScheduler] Started - checking for confirmed payouts every 60s")
    
    # Wait for startup
    await asyncio.sleep(10)
    
    while True:
        try:
            from database.connection import get_database
            db = get_database()
            if db is None:
                await asyncio.sleep(PAYOUT_CHECK_INTERVAL)
                continue
            
            pending_payouts = db.pending_payouts
            
            # On restart, mark stale "processing" records as failed for manual review.
            stale_cutoff = datetime.utcnow() - timedelta(minutes=PROCESSING_STALE_MINUTES)
            stale_result = await pending_payouts.update_many(
                {"status": "processing", "processing_started_at": {"$lt": stale_cutoff}},
                {"$set": {"status": "failed", "error": f"Stale processing state (>{PROCESSING_STALE_MINUTES}m) — manual review required"}}
            )
            if stale_result.modified_count:
                logger.warning("[PayoutScheduler] Marked %d stale processing records as failed", stale_result.modified_count)

            # Find payouts waiting for confirmation
            pending = []
            async for doc in pending_payouts.find({"status": "waiting_confirmation"}):
                pending.append(doc)
            
            if not pending:
                await asyncio.sleep(PAYOUT_CHECK_INTERVAL)
                continue
            
            print(f"[PayoutScheduler] Checking {len(pending)} pending payouts for confirmations")
            
            for payout in pending:
                try:
                    order_id = payout["order_id"]
                    crypto = payout.get("crypto", "LTC")
                    txid = payout.get("txid")
                    
                    if not txid:
                        print(f"[PayoutScheduler] No txid for order {order_id}, skipping")
                        continue
                    
                    # Check confirmations via SHKeeper's node
                    confirmations = await _check_confirmations(crypto, txid)
                    
                    if confirmations is None:
                        print(f"[PayoutScheduler] Could not check confirmations for {txid}")
                        # If older than 1 hour, mark as failed
                        if payout.get("created_at") and datetime.utcnow() - payout["created_at"] > timedelta(hours=1):
                            await pending_payouts.update_one(
                                {"_id": payout["_id"]},
                                {"$set": {"status": "failed", "error": "Could not verify confirmations after 1 hour"}}
                            )
                        continue
                    
                    if confirmations >= payout.get("confirmations_required", 1):
                        print(f"[PayoutScheduler] Order {order_id}: {confirmations} confirmations - executing payout")

                        # Atomically claim the record so a concurrent/restarted instance
                        # cannot double-pay the same order (MEDIUM-1 idempotency guard).
                        claim_result = await pending_payouts.find_one_and_update(
                            {"_id": payout["_id"], "status": "waiting_confirmation"},
                            {"$set": {"status": "processing", "processing_started_at": datetime.utcnow()}},
                        )
                        if claim_result is None:
                            # Another instance already claimed this record — skip.
                            print(f"[PayoutScheduler] Order {order_id}: already claimed by another instance, skipping")
                            continue

                        # Execute the payout
                        order = await db.orders.find_one({"_id": order_id})
                        if not order:
                            await pending_payouts.update_one(
                                {"_id": payout["_id"]},
                                {"$set": {"status": "failed", "error": "Order not found"}}
                            )
                            continue

                        from handlers.payments import _process_auto_payout
                        await _process_auto_payout(
                            db, order, order_id,
                            payout["crypto"],
                            payout["balance_crypto"]
                        )

                        await pending_payouts.update_one(
                            {"_id": payout["_id"]},
                            {"$set": {"status": "completed", "confirmed_at": datetime.utcnow(), "confirmations": confirmations}}
                        )
                    else:
                        print(f"[PayoutScheduler] Order {order_id}: {confirmations} confirmations (need {payout.get('confirmations_required', 1)})")
                
                except Exception as e:
                    print(f"[PayoutScheduler] Error processing payout for {payout.get('order_id')}: {e}")
                    import traceback
                    traceback.print_exc()
        
        except Exception as e:
            print(f"[PayoutScheduler] Error in main loop: {e}")
            import traceback
            traceback.print_exc()
        
        await asyncio.sleep(PAYOUT_CHECK_INTERVAL)


async def _check_confirmations(crypto: str, txid: str) -> int:
    """Check how many confirmations a transaction has via the crypto node."""
    import requests
    
    crypto_upper = crypto.upper()

    try:
        if crypto_upper == "LTC":
            rpc_url = "http://litecoind:9332/"
            rpc_user = "shkeeper"
            rpc_pass = os.getenv("LTC_RPC_PASSWORD")
            if not rpc_pass:
                raise EnvironmentError(
                    "LTC_RPC_PASSWORD env var is not set — cannot check LTC confirmations"
                )
        elif crypto_upper == "BTC":
            rpc_url = "http://bitcoind:8332/"
            rpc_user = "shkeeper"
            rpc_pass = os.getenv("BTC_RPC_PASSWORD")
            if not rpc_pass:
                raise EnvironmentError(
                    "BTC_RPC_PASSWORD env var is not set — cannot check BTC confirmations"
                )
        else:
            # TRON/USDT and other assets: we cannot query the node directly here.
            # RISK: confirmation count is assumed, not verified on-chain. For TRON this
            # is lower risk due to ~3s block time and deterministic finality, but it is
            # NOT zero risk. To harden this, integrate a TRON full-node or TronGrid API.
            # MIN_CONFIRMATIONS_TRON (env var, default 1) controls the minimum threshold
            # reported back to the caller. The caller must still check this against
            # `confirmations_required` on the payout record.
            logger.warning(
                "[PayoutScheduler] Confirmation check for %s/%s: no node query available — "
                "returning assumed confirmation count %d (MIN_CONFIRMATIONS_TRON). "
                "Set MIN_CONFIRMATIONS_TRON=0 only if zero-conf risk is explicitly accepted.",
                crypto_upper, txid, MIN_CONFIRMATIONS_TRON
            )
            return MIN_CONFIRMATIONS_TRON
        
        # Query the node for transaction details
        payload = {
            "jsonrpc": "1.0",
            "method": "gettransaction",
            "params": [txid],
        }
        
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: requests.post(
                rpc_url,
                json=payload,
                auth=(rpc_user, rpc_pass),
                timeout=10,
            )
        )
        
        if response.status_code == 200:
            data = response.json()
            if data.get("result"):
                confs = data["result"].get("confirmations", 0)
                return confs
            elif data.get("error"):
                print(f"[PayoutScheduler] RPC error for {txid}: {data['error']}")
                return None
        
        return None
    
    except Exception as e:
        print(f"[PayoutScheduler] Error checking confirmations for {crypto}/{txid}: {e}")
        return None
