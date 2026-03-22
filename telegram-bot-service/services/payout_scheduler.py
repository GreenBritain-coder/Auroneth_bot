"""Deferred payout processor - waits for blockchain confirmations before sending payouts."""
import asyncio
import os
from datetime import datetime, timedelta

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
            rpc_pass = os.getenv("LTC_PASSWORD", "shkeeperltc2026")
        elif crypto_upper == "BTC":
            rpc_url = "http://bitcoind:8332/"
            rpc_user = "shkeeper"
            rpc_pass = "shkeeper"
        else:
            # USDT/TRX etc - check via SHKeeper API instead
            return 1  # Assume confirmed for non-BTC/LTC (TRON has fast finality)
        
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
