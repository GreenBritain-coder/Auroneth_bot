"""
SHKeeper payment integration - Self-hosted cryptocurrency payment processor
"""
import os
import requests
from requests.exceptions import Timeout, ConnectionError as RequestsConnectionError
from typing import Dict, Optional
from dotenv import load_dotenv
from datetime import datetime, timedelta

load_dotenv()

API_KEY = os.getenv("SHKEEPER_API_KEY")
API_URL = os.getenv("SHKEEPER_API_URL", "https://demo.shkeeper.io")
WEBHOOK_URL = os.getenv("WEBHOOK_URL", "")

# Cache for cryptocurrency list to avoid slow API calls
_crypto_cache = None
_crypto_cache_time = None
_crypto_cache_ttl = timedelta(minutes=10)  # Increased to 10 minutes since crypto list rarely changes

# Fallback list of common cryptocurrencies if SHKeeper API is unavailable
# IMPORTANT: Only include currencies that are supported by SHKeeper (mapped in currency_map)
# This ensures payment invoices can be created successfully even when using fallback list
FALLBACK_CRYPTO_LIST = [
    {"code": "BTC", "name": "Bitcoin"},
    {"code": "ETH", "name": "Ethereum"},
    {"code": "LTC", "name": "Litecoin"},
    {"code": "DOGE", "name": "Dogecoin"},
    {"code": "USDT", "name": "Tether (USDT)"},  # TRC20 via tron-shkeeper
    {"code": "USDC", "name": "USD Coin (USDC)"},  # Will map to ETH-USDC
    {"code": "XMR", "name": "Monero"},
    {"code": "BNB", "name": "Binance Coin"},
    {"code": "TRX", "name": "Tron"},
    # Note: XRP removed from fallback as it may not be supported by all SHKeeper instances
]


def get_available_cryptocurrencies() -> Dict:
    """
    Get list of available cryptocurrencies from SHKeeper
    Returns list of supported crypto currencies
    Uses caching to avoid slow API calls on every request
    """
    global _crypto_cache, _crypto_cache_time
    
    # Check cache first - return cached result if still valid
    if _crypto_cache is not None and _crypto_cache_time is not None:
        if datetime.utcnow() - _crypto_cache_time < _crypto_cache_ttl:
            print(f"[SHKeeper Cache] Returning cached cryptocurrency list (age: {(datetime.utcnow() - _crypto_cache_time).total_seconds():.1f}s)")
            return _crypto_cache
    
    # Check if API URL is configured (API key not required for /api/v1/crypto per OpenAPI spec)
    if not API_URL:
        return {
            "success": False,
            "error": "SHKeeper API URL not configured"
        }
    
    # According to OpenAPI spec, /api/v1/crypto doesn't require authentication
    # But we'll send the API key anyway if configured (some instances might require it)
    # Retry logic for slow SHKeeper responses
    # Reduced retries and timeout since cache makes subsequent calls instant
    max_retries = 1  # Only 1 retry - cache will handle failures
    retry_delay = 0.5  # Reduced delay
    
    for attempt in range(max_retries):
        try:
            # This endpoint doesn't require auth per OpenAPI spec, but send API key if available
            headers = {}
            if API_KEY:
                headers["X-Shkeeper-Api-Key"] = API_KEY
            headers["Content-Type"] = "application/json"
            
            # Increased timeout to 15 seconds - SHKeeper can be slow
            # If it times out, we'll return cached data or fallback list if available
            response = requests.get(
                f"{API_URL}/api/v1/crypto",
                headers=headers,
                timeout=15  # Increased from 8 to 15 seconds to handle slow SHKeeper servers
            )
            
            print(f"SHKeeper API response status: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print(f"SHKeeper API response data keys: {list(data.keys()) if isinstance(data, dict) else 'not a dict'}")
                
                # Handle different response formats
                crypto_list = data.get("crypto_list", [])
                if not crypto_list:
                    # Try alternative field names
                    crypto_list = data.get("crypto", [])
                if not crypto_list and isinstance(data, list):
                    crypto_list = data
                
                result = {
                    "success": True,
                    "crypto_list": crypto_list if isinstance(crypto_list, list) else [],
                    "crypto": data.get("crypto", []) if isinstance(data.get("crypto"), list) else []
                }
                
                # Cache the successful result
                _crypto_cache = result
                _crypto_cache_time = datetime.utcnow()
                print(f"[SHKeeper Cache] Cached cryptocurrency list ({len(crypto_list) if isinstance(crypto_list, list) else 0} items)")
                
                return result
            else:
                error_text = response.text
                try:
                    error_data = response.json()
                    error_text = error_data.get("message", error_data.get("error", response.text))
                except:
                    pass
                
                print(f"SHKeeper API error: {response.status_code} - {error_text}")
                return {
                    "success": False,
                    "error": f"API returned status {response.status_code}: {error_text}"
                }
        except Timeout:
            print(f"SHKeeper API timeout (attempt {attempt + 1}/{max_retries})")
            # Return cached result immediately if available (even if expired) - don't retry
            if _crypto_cache is not None:
                print("[SHKeeper Cache] API timeout - returning stale cached result immediately")
                return _crypto_cache
            # Only retry if no cache available and we have retries left
            if attempt < max_retries - 1:
                print(f"[SHKeeper] No cache available, retrying in {retry_delay}s...")
                import time
                time.sleep(retry_delay)
                continue
            else:
                # All retries exhausted, return fallback list if no cache
                print("[SHKeeper] All retries exhausted, no cached data available - using fallback list")
                return {
                    "success": True,  # Return success with fallback list
                    "crypto_list": FALLBACK_CRYPTO_LIST,
                    "crypto": FALLBACK_CRYPTO_LIST,
                    "fallback": True  # Flag to indicate this is a fallback
                }
        except RequestsConnectionError as e:
            print(f"SHKeeper connection error (attempt {attempt + 1}/{max_retries}): {e}")
            # Return cached result immediately if available (even if expired) - don't retry
            if _crypto_cache is not None:
                print("[SHKeeper Cache] Connection error - returning stale cached result immediately")
                return _crypto_cache
            # Only retry if no cache available
            if attempt < max_retries - 1:
                print(f"Retrying in {retry_delay}s...")
                import time
                time.sleep(retry_delay)
                continue
            else:
                # Connection error - return fallback list if no cache
                if _crypto_cache is None:
                    print("[SHKeeper] Connection error, no cache - using fallback list")
                    return {
                        "success": True,  # Return success with fallback list
                        "crypto_list": FALLBACK_CRYPTO_LIST,
                        "crypto": FALLBACK_CRYPTO_LIST,
                        "fallback": True  # Flag to indicate this is a fallback
                    }
                return {
                    "success": False,
                    "error": f"Connection error: {str(e)}"
                }
        except Exception as e:
            print(f"SHKeeper API exception: {e}")
            return {
                "success": False,
                "error": f"Error getting cryptocurrencies: {str(e)}"
            }
    
    # Should not reach here, but just in case
    return {
        "success": False,
        "error": "Failed to get cryptocurrencies after retries"
    }


def create_invoice(amount: float, currency: str, order_id: str, buyer_email: str = "", fiat_currency: str = "USD") -> Dict:
    """
    Create payment invoice via SHKeeper API
    Returns invoice with payment address and QR code

    Args:
        amount: Amount in fiat currency
        currency: Cryptocurrency code (e.g., "BTC", "ETH", "ETH-USDT", "BNB-USDC")
        order_id: Unique order/invoice ID
        buyer_email: Optional buyer email
        fiat_currency: Fiat currency code (e.g., "USD", "GBP", "EUR")

    Returns:
        Dict with success status, payment address, QR code, etc.
    """
    # Check if API key is configured
    if not API_KEY:
        return {
            "success": False,
            "error": "SHKeeper API key not configured. Please set SHKEEPER_API_KEY in .env file. Get your key from SHKeeper UI under Wallets -> Manage -> API key"
        }
    
    # Check if webhook URL is configured
    if not WEBHOOK_URL:
        return {
            "success": False,
            "error": "WEBHOOK_URL not configured. Please set WEBHOOK_URL in .env file for payment callbacks."
        }
    
    # Map common currency codes to SHKeeper format
    # SHKeeper uses specific formats like "ETH-USDT", "BNB-USDC", etc.
    currency_map = {
        "BTC": "BTC",
        "LTC": "LTC",
        "DOGE": "DOGE",
        "XMR": "XMR",
        "XRP": "XRP",
        "ETH": "ETH",
        "USDT": "USDT",  # TRC20 USDT via tron-shkeeper
        "USDC": "USDC",  # TRC20 USDC via tron-shkeeper
        "BNB": "BNB",
        "BNB-USDT": "BNB-USDT",
        "BNB-USDC": "BNB-USDC",
        "ETH-USDT": "ETH-USDT",
        "ETH-USDC": "ETH-USDC",
        "AVAX": "AVAX",
        "AVALANCHE-USDT": "AVALANCHE-USDT",
        "AVALANCHE-USDC": "AVALANCHE-USDC",
        "MATIC": "MATIC",
        "POLYGON-USDT": "POLYGON-USDT",
        "POLYGON-USDC": "POLYGON-USDC",
        "TRX": "TRX"
    }
    
    crypto_name = currency_map.get(currency.upper(), currency.upper())
    
    try:
        # Create payment request via SHKeeper API
        headers = {
            "X-Shkeeper-Api-Key": API_KEY,
            "Content-Type": "application/json"
        }
        
        # Build callback URL for webhooks
        callback_url = f"{WEBHOOK_URL}/payment/shkeeper-webhook"
        
        # Log the exact amount being sent
        print(f"[SHKeeper create_invoice] === PAYMENT REQUEST DEBUG ===")
        print(f"[SHKeeper create_invoice] Order ID: {order_id}")
        print(f"[SHKeeper create_invoice] Amount received: {amount} {fiat_currency} (type: {type(amount)})")
        print(f"[SHKeeper create_invoice] Currency: {crypto_name}")

        # Validate amount is reasonable
        if isinstance(amount, (int, float)):
            if amount > 10000:
                print(f"[SHKeeper create_invoice] WARNING: Amount {amount} seems too large! This might be an error.")
            if amount < 0:
                print(f"[SHKeeper create_invoice] ERROR: Amount {amount} is negative!")
                return {
                    "success": False,
                    "error": f"Invalid amount: {amount} (negative value)"
                }
        
        # SHKeeper only supports USD and EUR as fiat currencies.
        # Convert other currencies (e.g., GBP) to USD before sending.
        shkeeper_fiat = fiat_currency
        shkeeper_amount = amount
        if fiat_currency.upper() not in ("USD", "EUR"):
            try:
                from utils.currency_converter import convert_amount
                usd_amount = convert_amount(amount, fiat_currency, "USD")
                if usd_amount and usd_amount > 0:
                    print(f"[SHKeeper create_invoice] Converting {amount} {fiat_currency} -> {usd_amount} USD for SHKeeper")
                    shkeeper_amount = usd_amount
                    shkeeper_fiat = "USD"
                else:
                    print(f"[SHKeeper create_invoice] WARNING: Could not convert {fiat_currency} to USD, sending as-is")
            except Exception as conv_err:
                print(f"[SHKeeper create_invoice] WARNING: Currency conversion failed: {conv_err}, sending as-is")

        payload = {
            "external_id": str(order_id),
            "fiat": shkeeper_fiat,
            "amount": str(shkeeper_amount),  # SHKeeper expects string
            "callback_url": callback_url
        }
        
        print(f"[SHKeeper create_invoice] Payload: external_id={payload['external_id']}, fiat={payload['fiat']}, amount={payload['amount']} (original: {amount} {fiat_currency})")
        print(f"[SHKeeper create_invoice] API URL: {API_URL}/api/v1/{crypto_name}/payment_request")
        
        try:
            # BTC node can be slower to respond than others
            req_timeout = 30 if crypto_name == "BTC" else 20
            response = requests.post(
                f"{API_URL}/api/v1/{crypto_name}/payment_request",
                headers=headers,
                json=payload,
                timeout=req_timeout
            )
        except Timeout:
            print(f"[SHKeeper] TIMEOUT after {req_timeout}s for {crypto_name} payment request")
            return {
                "success": False,
                "error": f"SHKeeper timeout: The {crypto_name} node took too long to respond. Please try again or use another cryptocurrency."
            }
        except RequestsConnectionError as e:
            print(f"[SHKeeper] CONNECTION ERROR for {crypto_name}: {e}")
            return {
                "success": False,
                "error": f"SHKeeper connection error: Unable to connect to {crypto_name} node. The node may be down."
            }
        except Exception as e:
            return {
                "success": False,
                "error": f"SHKeeper error: {str(e)}"
            }
        
        if response.status_code != 200:
            error_data = {}
            try:
                error_data = response.json()
            except:
                pass

            error_msg = error_data.get("message", response.text or "Unknown error")
            print(f"[SHKeeper] ERROR: {crypto_name} payment_request returned HTTP {response.status_code}: {error_msg}")
            print(f"[SHKeeper] Full error response: {error_data or response.text}")

            return {
                "success": False,
                "error": f"Failed to create SHKeeper invoice: {error_msg}"
            }
        
        try:
            data = response.json()
        except Exception as e:
            return {
                "success": False,
                "error": f"SHKeeper returned invalid JSON: {str(e)}"
            }
        
        # Debug: Log full response structure
        print(f"[SHKeeper] Full API response: {data}")
        print(f"[SHKeeper] Response status code: {response.status_code}")
        print(f"[SHKeeper] Response keys: {list(data.keys()) if isinstance(data, dict) else 'Not a dict'}")
        
        # Check response structure - SHKeeper might return different formats
        if isinstance(data, dict):
            # Try different possible status fields
            status = data.get("status") or data.get("success") or data.get("error")
            
            # If there's an error field, that's the issue
            if "error" in data and data["error"]:
                error_msg = str(data["error"])
                if isinstance(data["error"], dict):
                    error_msg = data["error"].get("message", str(data["error"]))
                return {
                    "success": False,
                    "error": f"SHKeeper error: {error_msg}"
                }
            
            # Check if status indicates failure
            if status and status not in ["success", True, "ok"]:
                error_msg = data.get('message') or data.get('error') or data.get('result') or 'Unknown error'
                # Handle if error_msg is not a string
                if not isinstance(error_msg, str):
                    error_msg = str(error_msg)
                
                # Check for specific wallet initialization errors
                traceback_str = data.get('traceback', '')
                if 'KeyError' in traceback_str and "'result'" in str(error_msg):
                    return {
                        "success": False,
                        "error": f"SHKeeper Bitcoin wallet not initialized. Please create/initialize the Bitcoin wallet in SHKeeper UI (http://111.90.140.72:5000/wallets). The Bitcoin node is online but the wallet needs to be set up."
                    }
                    
                # Check if it's a node connectivity issue
                if "timeout" in error_msg.lower() or "connection" in error_msg.lower():
                    print(f"[SHKeeper] Node connectivity issue for {crypto_name}: {error_msg}")
                    return {
                        "success": False,
                        "error": f"SHKeeper node issue: {error_msg}. The {crypto_name} node may not be responding. Please try again or use another cryptocurrency."
                    }
                return {
                    "success": False,
                    "error": f"SHKeeper returned error: {error_msg}"
                }
        else:
            return {
                "success": False,
                "error": f"SHKeeper returned unexpected response format: {type(data)}"
            }
        
        # Extract invoice data
        wallet_address = data.get("wallet")
        invoice_id = data.get("id")
        amount_from_api = data.get("amount")
        exchange_rate_str = data.get("exchange_rate", "1")
        
        # Debug: Log the full response to understand structure
        print(f"[SHKeeper] API Response keys: {list(data.keys())}")
        print(f"[SHKeeper] API Response amount field: {amount_from_api}")
        print(f"[SHKeeper] API Response exchange_rate: {exchange_rate_str}")
        print(f"[SHKeeper] USD amount we sent to SHKeeper: {amount}")
        
        # Try to get crypto amount from different possible fields
        amount_crypto = data.get("crypto_amount") or data.get("amount_crypto") or data.get("crypto")
        
        # SHKeeper amount field: when we send fiat=GBP, SHKeeper converts and returns
        # the CRYPTO amount in 'amount', with exchange_rate = crypto price in USD.
        # Validation: amount_from_api * exchange_rate ~ fiat amount converted to USD.
        # Do NOT blindly divide by exchange_rate - check first if amount is already crypto.
        
        if not amount_crypto and amount_from_api:
            try:
                exchange_rate = float(exchange_rate_str) if exchange_rate_str else 1.0
                amount_value = float(amount_from_api)
                fiat_sent = float(amount)
                
                print(f"[SHKeeper] === AMOUNT PARSING DEBUG ===")
                print(f"[SHKeeper] amount_from_api: {amount_from_api} (type: {type(amount_from_api)})")
                print(f"[SHKeeper] exchange_rate: {exchange_rate_str} (parsed: {exchange_rate})")
                print(f"[SHKeeper] crypto_name: {crypto_name}")
                print(f"[SHKeeper] fiat sent: {amount} {fiat_currency}")
                
                # Determine if amount_from_api is fiat or crypto:
                # If amount_value ~ fiat_sent (within 5%), it is fiat -> divide by rate.
                # Otherwise, it is already crypto -> use directly.
                fiat_diff = abs(amount_value - fiat_sent) / fiat_sent if fiat_sent > 0 else 999
                
                if fiat_diff < 0.05:  # amount matches fiat we sent -> it IS fiat
                    print(f"[SHKeeper] Amount {amount_value} matches fiat sent ({fiat_sent}), dividing by rate...")
                    if exchange_rate > 0 and exchange_rate != 1.0:
                        amount_crypto = amount_value / exchange_rate
                        print(f"[SHKeeper] Calculated crypto: {amount_value} / {exchange_rate} = {amount_crypto} {crypto_name}")
                    elif exchange_rate <= 0:
                        print(f"[SHKeeper] WARNING: Invalid exchange rate ({exchange_rate}), fetching from CoinGecko...")
                    elif exchange_rate == 1.0 and crypto_name in ("USDT", "USDC"):
                        amount_crypto = amount_value
                        print(f"[SHKeeper] Stablecoin {crypto_name}: 1:1 rate, amount = {amount_crypto}")
                else:
                    # amount_from_api is already the crypto amount
                    amount_crypto = amount_value
                    print(f"[SHKeeper] Amount {amount_value} differs from fiat sent ({fiat_sent}), using as crypto directly")
                    implied_usd = amount_value * exchange_rate
                    print(f"[SHKeeper] Validation: {amount_value} {crypto_name} * {exchange_rate} = ${implied_usd:.4f} USD")
            except (ValueError, TypeError) as e:
                print(f"[SHKeeper] Error parsing amount: {e}, attempting fallback calculation...")
                try:
                    # Last resort: try to calculate from exchange rate using USD we sent
                    exchange_rate = float(exchange_rate_str) if exchange_rate_str else 1.0
                    usd_amount = float(amount)  # Use the USD amount we sent, not amount_from_api
                    if exchange_rate > 1.0:
                        amount_crypto = usd_amount / exchange_rate
                        print(f"[SHKeeper] Fallback calculation: {usd_amount} USD / {exchange_rate} = {amount_crypto} {crypto_name}")
                    else:
                        # Try CoinGecko as last resort
                        from utils.currency_converter import get_exchange_rate
                        crypto_rate = get_exchange_rate(crypto_name.lower(), "usd")
                        if crypto_rate and crypto_rate > 0:
                            amount_crypto = usd_amount / crypto_rate
                            print(f"[SHKeeper] Fallback using CoinGecko: {usd_amount} USD / {crypto_rate} = {amount_crypto} {crypto_name}")
                        else:
                            amount_crypto = None
                except Exception as fallback_error:
                    print(f"[SHKeeper] Error in fallback calculation: {fallback_error}")
                    amount_crypto = None
        
        # Final fallback: if we still don't have a valid crypto amount, calculate from USD we sent
        if not amount_crypto:
            print(f"[SHKeeper] WARNING: Could not parse crypto amount, using USD amount we sent to calculate...")
            try:
                usd_amount = float(amount)  # This is the USD amount we sent to SHKeeper
                # Try to get exchange rate from CoinGecko
                from utils.currency_converter import get_exchange_rate
                crypto_rate = get_exchange_rate(crypto_name.lower(), "usd")
                if crypto_rate and crypto_rate > 0:
                    amount_crypto = usd_amount / crypto_rate
                    print(f"[SHKeeper] Final fallback: {usd_amount} USD / {crypto_rate} = {amount_crypto} {crypto_name}")
                else:
                    # Last resort: use amount_from_api (might be wrong, but better than nothing)
                    amount_crypto = amount_from_api
                    print(f"[SHKeeper] WARNING: Using amount field as-is (may be incorrect): {amount_crypto}")
            except Exception as final_error:
                print(f"[SHKeeper] ERROR: All calculation methods failed: {final_error}")
                amount_crypto = amount_from_api
                print(f"[SHKeeper] Using amount field as last resort: {amount_crypto}")
        
        print(f"[SHKeeper] === FINAL CRYPTO AMOUNT: {amount_crypto} {crypto_name} ===")
        
        # Debug: Log the address format
        print(f"[SHKeeper] Invoice created - currency: {crypto_name}, address: {wallet_address}, address_length: {len(wallet_address) if wallet_address else 0}, address_starts_with: {wallet_address[:10] if wallet_address else 'None'}")
        print(f"[SHKeeper] Final crypto amount: {amount_crypto} {crypto_name}")
        
        # Use display_name from API, or fallback to friendly name mapping
        display_name = data.get("display_name")
        if not display_name:
            # Fallback to friendly currency names
            friendly_names = {
                "BTC": "Bitcoin",
                "ETH": "Ethereum",
                "USDT": "TRC20 USDT",
                "USDC": "TRC20 USDC",
                "ETH-USDT": "ERC20 USDT",
                "ETH-USDC": "ERC20 USDC",
                "BNB": "BNB",
                "BNB-USDT": "BEP20 USDT",
                "BNB-USDC": "BEP20 USDC",
                "LTC": "Litecoin",
                "DOGE": "Dogecoin",
                "XMR": "Monero",
                "XRP": "Ripple",
                "AVAX": "Avalanche",
                "AVALANCHE-USDT": "Avalanche USDT",
                "AVALANCHE-USDC": "Avalanche USDC",
                "MATIC": "Polygon",
                "POLYGON-USDT": "Polygon USDT",
                "POLYGON-USDC": "Polygon USDC",
                "TRX": "Tron"
            }
            display_name = friendly_names.get(crypto_name, crypto_name)
        exchange_rate = exchange_rate_str
        
        if not wallet_address:
            return {
                "success": False,
                "error": "Failed to get payment address from SHKeeper"
            }
        
        # Validate address format for the currency
        address_valid = _validate_address_format(crypto_name, wallet_address)
        if not address_valid:
            error_msg = f"Invalid address format for {crypto_name}. Address '{wallet_address[:20]}...' does not match expected format."
            if crypto_name == "LTC" and wallet_address.startswith("bc1q"):
                error_msg = (
                    f"SHKeeper Error: Bitcoin address returned for Litecoin.\n\n"
                    f"**What's happening:**\n"
                    f"- SHKeeper returned a Bitcoin address (bc1q...) for Litecoin\n"
                    f"- Litecoin addresses should start with 'L', 'M', or 'ltc1'\n"
                    f"- This usually happens when the Litecoin node is still syncing\n\n"
                    f"**Why this happens:**\n"
                    f"When the Litecoin node is syncing, SHKeeper may return fallback addresses or report the wallet as 'not online'. Once the node finishes syncing, SHKeeper will generate proper Litecoin addresses.\n\n"
                    f"**How to fix:**\n"
                    f"1. Wait for the Litecoin node to finish syncing\n"
                    f"2. Check SHKeeper dashboard - LTC wallet should show as 'online' when synced\n"
                    f"3. Once synced, create a new order - it will use proper Litecoin addresses\n"
                    f"4. You can still accept payments in other cryptocurrencies while waiting"
                )
            print(f"[SHKeeper] ERROR: {error_msg}")
            return {
                "success": False,
                "error": error_msg
            }
        
        # Generate QR code URI based on cryptocurrency
        # Log before generating URI
        print(f"[SHKeeper] Generating payment URI - crypto: {crypto_name}, address: {wallet_address}, amount: {amount_crypto}")
        payment_uri = _generate_payment_uri(crypto_name, wallet_address, amount_crypto)
        print(f"[SHKeeper] Generated payment URI: {payment_uri}")
        
        # Generate QR code URL
        qr_code_url = f"https://api.qrserver.com/v1/create-qr-code/?size=300x300&data={payment_uri}"
        
        # Generate status URL (block explorer)
        status_url = _generate_status_url(crypto_name, wallet_address)
        
        return {
            "success": True,
            "txn_id": str(invoice_id),  # Use invoice ID as transaction ID
            "address": wallet_address,
            "amount": float(amount_crypto) if amount_crypto else amount,
            "currency": crypto_name,
            "display_name": display_name,
            "exchange_rate": exchange_rate,
            "status_url": status_url,
            "qrcode_url": qr_code_url,
            "payment_uri": payment_uri,
            "invoice_id": invoice_id
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": f"SHKeeper API error: {str(e)}"
        }


def _validate_address_format(crypto_name: str, address: str) -> bool:
    """Validate that address format matches expected format for the currency"""
    if not address:
        return False
    
    address_upper = address.upper()
    
    if crypto_name == "BTC":
        # Bitcoin addresses: 1..., 3..., bc1q..., or bc1p...
        return address.startswith(("1", "3", "bc1q", "bc1p"))
    elif crypto_name == "LTC":
        # Litecoin addresses: L..., M..., ltc1..., or lt1...
        # Do NOT accept bc1q (Bitcoin format) - it's invalid for Litecoin
        return address.startswith(("L", "M", "ltc1", "lt1"))
    elif crypto_name in ["ETH", "ETH-USDT", "ETH-USDC"]:
        # Ethereum addresses: 0x...
        return address.startswith("0x") and len(address) == 42
    elif crypto_name in ["BNB", "BNB-USDT", "BNB-USDC"]:
        # BNB addresses: 0x... (same as Ethereum)
        return address.startswith("0x") and len(address) == 42
    elif crypto_name in ["AVAX", "AVALANCHE-USDT", "AVALANCHE-USDC"]:
        # Avalanche addresses: X-..., P-..., or 0x...
        return address.startswith(("X-", "P-", "0x"))
    elif crypto_name in ["MATIC", "POLYGON-USDT", "POLYGON-USDC"]:
        # Polygon addresses: 0x...
        return address.startswith("0x") and len(address) == 42
    elif crypto_name == "XRP":
        # XRP addresses: r... or x...
        return address.startswith(("r", "x"))
    elif crypto_name == "TRX":
        # Tron addresses: T...
        return address.startswith("T") and len(address) == 34
    
    # Unknown currency - accept any format
    return True


def _generate_payment_uri(crypto_name: str, address: str, amount: str) -> str:
    """Generate payment URI for QR code based on cryptocurrency"""
    amount_float = float(amount) if amount else 0
    
    if crypto_name == "BTC":
        return f"bitcoin:{address}?amount={amount_float}"
    elif crypto_name == "LTC":
        return f"litecoin:{address}?amount={amount_float}"
    elif crypto_name in ["ETH", "ETH-USDT", "ETH-USDC"]:
        # Ethereum and ERC20 tokens
        return f"ethereum:{address}?value={amount_float}"
    elif crypto_name in ["BNB", "BNB-USDT", "BNB-USDC"]:
        # BNB and BEP20 tokens
        return f"binancecoin:{address}?amount={amount_float}"
    elif crypto_name in ["AVAX", "AVALANCHE-USDT", "AVALANCHE-USDC"]:
        return f"avalanche:{address}?amount={amount_float}"
    elif crypto_name in ["MATIC", "POLYGON-USDT", "POLYGON-USDC"]:
        return f"polygon:{address}?amount={amount_float}"
    elif crypto_name == "XRP":
        return f"ripple:{address}?amount={amount_float}"
    elif crypto_name == "TRX":
        return f"tron:{address}?amount={amount_float}"
    else:
        # Default to Bitcoin format
        return f"bitcoin:{address}?amount={amount_float}"


def _generate_status_url(crypto_name: str, address: str) -> str:
    """Generate block explorer URL for payment status"""
    if crypto_name == "BTC":
        return f"https://blockstream.info/address/{address}"
    elif crypto_name == "LTC":
        return f"https://blockchair.com/litecoin/address/{address}"
    elif crypto_name in ["ETH", "ETH-USDT", "ETH-USDC"]:
        return f"https://etherscan.io/address/{address}"
    elif crypto_name in ["BNB", "BNB-USDT", "BNB-USDC"]:
        return f"https://bscscan.com/address/{address}"
    elif crypto_name in ["AVAX", "AVALANCHE-USDT", "AVALANCHE-USDC"]:
        return f"https://snowtrace.io/address/{address}"
    elif crypto_name in ["MATIC", "POLYGON-USDT", "POLYGON-USDC"]:
        return f"https://polygonscan.com/address/{address}"
    elif crypto_name == "XRP":
        return f"https://xrpscan.com/address/{address}"
    elif crypto_name == "TRX":
        return f"https://tronscan.org/#/address/{address}"
    else:
        return f"https://blockstream.info/address/{address}"


def get_invoice_status(external_id: str) -> Dict:
    """
    Get invoice status by external_id
    """
    if not API_KEY:
        return {
            "success": False,
            "error": "API key not configured"
        }
    
    try:
        headers = {
            "X-Shkeeper-Api-Key": API_KEY
        }
        
        response = requests.get(
            f"{API_URL}/api/v1/invoices/{external_id}",
            headers=headers,
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            return {
                "success": True,
                "invoices": data.get("invoices", [])
            }
        else:
            return {
                "success": False,
                "error": f"Failed to get invoice status: {response.text}"
            }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def verify_webhook_signature(data: Dict, api_key: Optional[str] = None) -> bool:
    """
    Verify SHKeeper webhook signature
    SHKeeper sends the API key in the X-Shkeeper-Api-Key header
    """
    # SHKeeper doesn't use HMAC signatures, but sends API key in header
    # You can verify the API key matches your configured key
    if api_key:
        return api_key == API_KEY
    return True  # If no key provided, assume valid (SHKeeper uses API key in header)


# --- Payouts (Basic Auth: SHKeeper UI username/password) ---

PAYOUT_USER = os.getenv("SHKEEPER_PAYOUT_USER", "")
PAYOUT_PASSWORD = os.getenv("SHKEEPER_PAYOUT_PASSWORD", "")
# Fee for BTC/LTC/DOGE: sat per vByte/Byte. For XMR: 1-4 priority. For others often ignored.
PAYOUT_FEE_BTC = os.getenv("SHKEEPER_PAYOUT_FEE_SAT_VB", "10")
PAYOUT_FEE_LTC = os.getenv("SHKEEPER_PAYOUT_FEE_SAT_VB", "10")
PAYOUT_FEE_XMR = os.getenv("SHKEEPER_PAYOUT_FEE_XMR_PRIORITY", "2")


def _get_payout_session() -> Optional[requests.Session]:
    """Login to SHKeeper UI and return an authenticated session.
    SHKeeper payout endpoints use session-based auth (not Basic Auth).
    """
    if not PAYOUT_USER or not PAYOUT_PASSWORD or not API_URL:
        return None
    try:
        session = requests.Session()
        # Login with form POST (fields: name, password)
        login_resp = session.post(
            f"{API_URL}/login",
            data={"name": PAYOUT_USER, "password": PAYOUT_PASSWORD},
            allow_redirects=True,
            timeout=10,
        )
        if login_resp.status_code == 200 and "/login" not in login_resp.url:
            return session
        print(f"[SHKeeper Payout] Login failed: HTTP {login_resp.status_code}, URL: {login_resp.url}")
        return None
    except Exception as e:
        print(f"[SHKeeper Payout] Login error: {e}")
        return None


def create_payout(
    currency: str,
    amount: str,
    destination: str,
    fee: Optional[str] = None,
) -> Dict:
    """
    Create a single payout (withdrawal) via SHKeeper.
    Uses Basic Auth (SHKEEPER_PAYOUT_USER, SHKEEPER_PAYOUT_PASSWORD).
    Returns task_id on success; poll get_payout_status(crypto_name, task_id) for result.
    """
    if not API_URL or not PAYOUT_USER or not PAYOUT_PASSWORD:
        return {
            "success": False,
            "error": "SHKeeper payout not configured. Set SHKEEPER_API_URL, SHKEEPER_PAYOUT_USER, and SHKEEPER_PAYOUT_PASSWORD.",
        }
    # Map currency to SHKeeper crypto name (same as create_invoice)
    currency_map = {
        "BTC": "BTC",
        "LTC": "LTC",
        "DOGE": "DOGE",
        "XMR": "XMR",
        "XRP": "XRP",
        "ETH": "ETH",
        "USDT": "USDT",
        "USDC": "USDC",
        "BNB": "BNB",
        "BNB-USDT": "BNB-USDT",
        "BNB-USDC": "BNB-USDC",
        "ETH-USDT": "ETH-USDT",
        "ETH-USDC": "ETH-USDC",
        "AVAX": "AVAX",
        "MATIC": "MATIC",
        "TRX": "TRX",
    }
    crypto_name = currency_map.get(currency.upper(), currency.upper())
    session = _get_payout_session()
    if not session:
        return {"success": False, "error": "SHKeeper payout login failed. Check SHKEEPER_PAYOUT_USER/PASSWORD."}
    if fee is None:
        if crypto_name == "BTC":
            fee = PAYOUT_FEE_BTC
        elif crypto_name == "LTC":
            fee = PAYOUT_FEE_LTC
        elif crypto_name == "XMR":
            fee = PAYOUT_FEE_XMR
        else:
            fee = "10"  # SHKeeper may ignore for some coins
    payload = {
        "amount": str(amount),
        "destination": destination.strip(),
        "fee": str(fee),
    }
    try:
        response = session.post(
            f"{API_URL}/api/v1/{crypto_name}/payout",
            json=payload,
            timeout=30,
        )
        if response.status_code == 200:
            data = response.json()
            txid = data.get("result") or data.get("task_id")
            print(f"[SHKeeper Payout] Success: {data}")
            return {"success": True, "task_id": txid, "txid": txid}
        return {
            "success": False,
            "error": response.text or f"HTTP {response.status_code}",
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def get_payout_status(currency: str, task_id: str) -> Dict:
    """
    Get status of a payout task. Status: PENDING, FAILURE, SUCCESS.
    """
    if not API_URL or not PAYOUT_USER or not PAYOUT_PASSWORD:
        return {"success": False, "error": "SHKeeper payout not configured."}
    currency_map = {
        "BTC": "BTC", "LTC": "LTC", "DOGE": "DOGE", "XMR": "XMR",
        "ETH": "ETH", "USDT": "USDT", "USDC": "USDC",
        "BNB": "BNB", "TRX": "TRX", "XRP": "XRP", "AVAX": "AVAX", "MATIC": "MATIC",
    }
    crypto_name = currency_map.get(currency.upper(), currency.upper())
    session = _get_payout_session()
    if not session:
        return {"success": False, "error": "SHKeeper payout login failed. Check SHKEEPER_PAYOUT_USER/PASSWORD."}
    try:
        response = requests.get(
            f"{API_URL}/api/v1/{crypto_name}/task/{task_id}",
            headers=headers,
            timeout=15,
        )
        if response.status_code != 200:
            return {"success": False, "error": response.text or f"HTTP {response.status_code}"}
        data = response.json()
        status = (data.get("status") or "").upper()
        result = data.get("result") or []
        return {"success": True, "status": status, "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}

