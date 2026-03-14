"""
CryptAPI payment integration - No KYC, simple API
CryptAPI generates temporary addresses that forward payments to your wallet
"""
import os
import requests
from typing import Dict, Tuple
from dotenv import load_dotenv
from utils.currency_converter import get_exchange_rate

load_dotenv()

# CryptAPI requires your wallet address (where funds will be forwarded)
# Support currency-specific addresses (e.g., CRYPTAPI_BTC_WALLET_ADDRESS, CRYPTAPI_LTC_WALLET_ADDRESS)
# Fallback to CRYPTAPI_WALLET_ADDRESS if currency-specific address not set
CRYPTAPI_WALLET_ADDRESS = os.getenv("CRYPTAPI_WALLET_ADDRESS")  # Default/fallback wallet address
CRYPTAPI_API_BASE = "https://api.cryptapi.io"
WEBHOOK_URL = os.getenv("WEBHOOK_URL", "")

# Cache for bot config (will be set dynamically)
_bot_config_cache = None

# Cache for minimum amounts (fetched from CryptAPI info endpoint)
_minimum_amounts_cache = None

def get_webhook_url():
    """
    Get webhook URL from bot config (database) first, then fallback to environment variable.
    This allows webhook URL to be configured per-bot via admin panel.
    """
    global _bot_config_cache
    # Try to get from bot config cache (set by create_invoice)
    if _bot_config_cache and _bot_config_cache.get("webhook_url"):
        return _bot_config_cache.get("webhook_url")
    # Fallback to environment variable
    return WEBHOOK_URL

def get_minimum_amounts():
    """
    Fetch minimum transaction amounts from CryptAPI info endpoint.
    Returns dict like {'ltc': 0.002, 'btc': 0.00001, ...}
    """
    global _minimum_amounts_cache
    
    # Return cached if available (cache for 1 hour)
    if _minimum_amounts_cache:
        return _minimum_amounts_cache
    
    try:
        info_url = f"{CRYPTAPI_API_BASE}/info"
        session = get_session()
        response = session.get(info_url, timeout=5)
        
        if response.status_code == 200:
            data = response.json()
            minimums = {}
            
            # Parse minimum amounts from info endpoint
            # Format may vary, but typically includes minimum_transaction amounts
            if 'coins' in data:
                for coin_code, coin_data in data['coins'].items():
                    if 'minimum_transaction' in coin_data:
                        try:
                            minimums[coin_code.lower()] = float(coin_data['minimum_transaction'])
                        except (ValueError, TypeError):
                            pass
            
            # If coins format not found, try alternative format
            if not minimums and 'minimum_transaction' in data:
                for coin_code, min_amount in data['minimum_transaction'].items():
                    try:
                        minimums[coin_code.lower()] = float(min_amount)
                    except (ValueError, TypeError):
                        pass
            
            # Fallback to known minimums if API doesn't return them
            if not minimums:
                minimums = {
                    'ltc': 0.002,  # 0.002 LTC minimum (from CryptAPI docs)
                    'btc': 0.00001,  # Approximate BTC minimum
                    'eth': 0.001,  # Approximate ETH minimum
                    'doge': 1.0,  # Approximate DOGE minimum
                }
            
            _minimum_amounts_cache = minimums
            return minimums
    except Exception as e:
        print(f"[CryptAPI] Warning: Could not fetch minimum amounts from info endpoint: {e}")
    
    # Fallback to known minimums
    fallback_minimums = {
        'ltc': 0.002,  # 0.002 LTC minimum (confirmed from CryptAPI docs)
        'btc': 0.00001,
        'eth': 0.001,
        'doge': 1.0,
        'bch': 0.0001,
        'trx': 1.0,
        'xrp': 0.1,
        'xmr': 0.001,
        'bnb': 0.001,
        'usdt': 1.0,
        'usdc': 1.0,
    }
    return fallback_minimums

def check_minimum_amount(amount_crypto: float, currency: str) -> Tuple[bool, str]:
    """
    Check if crypto amount meets CryptAPI minimum requirements.
    
    Returns:
        (is_valid, error_message)
    """
    minimums = get_minimum_amounts()
    currency_lower = currency.lower()
    
    min_amount = minimums.get(currency_lower)
    
    if min_amount and amount_crypto < min_amount:
        return False, f"Amount {amount_crypto} {currency.upper()} is below CryptAPI minimum of {min_amount} {currency.upper()}. Transactions below this minimum are ignored and funds will be lost."
    
    return True, ""

# CryptAPI supported cryptocurrencies (all available)
CRYPTAPI_ALL_CURRENCIES = [
    {"code": "BTC", "name": "Bitcoin"},
    {"code": "LTC", "name": "Litecoin"},
    {"code": "DOGE", "name": "Dogecoin"},
    {"code": "ETH", "name": "Ethereum"},
    {"code": "USDT", "name": "Tether (USDT)"},
    {"code": "USDC", "name": "USD Coin (USDC)"},
    {"code": "BCH", "name": "Bitcoin Cash"},
    {"code": "TRX", "name": "Tron"},
    {"code": "XRP", "name": "Ripple"},
    {"code": "XMR", "name": "Monero"},
    {"code": "BNB", "name": "Binance Coin"}
]

# Get enabled currencies from environment variable (comma-separated list)
# If not set, defaults to LTC and BTC if addresses are configured
_enabled_currencies_env = os.getenv("CRYPTAPI_ENABLED_CURRENCIES", "")
if not _enabled_currencies_env:
    # Auto-detect enabled currencies based on configured wallet addresses
    _auto_enabled = []
    if os.getenv("CRYPTAPI_LTC_WALLET_ADDRESS") or (CRYPTAPI_WALLET_ADDRESS and CRYPTAPI_WALLET_ADDRESS.startswith(("L", "M", "ltc1", "lt1"))):
        _auto_enabled.append("LTC")
    if os.getenv("CRYPTAPI_BTC_WALLET_ADDRESS") or (CRYPTAPI_WALLET_ADDRESS and CRYPTAPI_WALLET_ADDRESS.startswith(("1", "3", "bc1q", "bc1p"))):
        _auto_enabled.append("BTC")
    _enabled_currencies_env = ",".join(_auto_enabled) if _auto_enabled else "LTC"  # Default to LTC if nothing detected

_enabled_currencies_list = [c.strip().upper() for c in _enabled_currencies_env.split(",") if c.strip()]

# Filter to only enabled currencies
CRYPTAPI_SUPPORTED_CURRENCIES = [
    crypto for crypto in CRYPTAPI_ALL_CURRENCIES 
    if crypto["code"].upper() in _enabled_currencies_list
]

# Create a persistent session for connection pooling and faster requests
_session = None

def get_session():
    """Get or create a persistent requests session for connection pooling"""
    global _session
    if _session is None:
        _session = requests.Session()
        # Configure session for faster connections
        adapter = requests.adapters.HTTPAdapter(
            pool_connections=10,
            pool_maxsize=10,
            max_retries=1  # Only retry once on failure
        )
        _session.mount('http://', adapter)
        _session.mount('https://', adapter)
    return _session


def create_invoice(amount: float, currency: str, order_id: str, buyer_email: str = "", fiat_currency: str = "USD", fiat_amount: float = None, bot_config: dict = None) -> Dict:
    """
    Create payment invoice via CryptAPI
    CryptAPI generates temporary addresses that forward to your wallet
    
    Args:
        amount: Amount in USD (fiat currency)
        currency: Cryptocurrency code (e.g., "BTC", "LTC", "ETH", "USDT")
        order_id: Unique order/invoice ID
        buyer_email: Optional buyer email (not used by CryptAPI but kept for compatibility)
    
    Returns:
        Dict with success status, payment address, QR code, etc.
    """
    # Get currency-specific wallet address or fallback to default
    currency_upper = currency.upper()
    currency_env_key = f"CRYPTAPI_{currency_upper}_WALLET_ADDRESS"
    wallet_address = os.getenv(currency_env_key) or CRYPTAPI_WALLET_ADDRESS
    
    # Check if wallet address is configured
    if not wallet_address:
        return {
            "success": False,
            "error": f"CryptAPI wallet address not configured for {currency_upper}. "
                     f"Please set {currency_env_key} or CRYPTAPI_WALLET_ADDRESS in .env file. "
                     f"Example: {currency_env_key}=your_{currency_upper.lower()}_wallet_address"
        }
    
    # Cache bot config for get_webhook_url() function
    global _bot_config_cache
    _bot_config_cache = bot_config
    
    # Check if webhook URL is configured
    # Priority: 1) Bot config (from database), 2) Environment variable, 3) Auto-detect localhost
    webhook_url = None
    
    # Try bot config first (but skip if empty/null/localhost)
    if bot_config and bot_config.get("webhook_url"):
        bot_webhook = bot_config.get("webhook_url", "").strip()
        # Only use bot config webhook if it's a valid non-localhost URL
        if bot_webhook and not bot_webhook.startswith(("http://localhost", "http://127.0.0.1")):
            # Remove /webhook suffix if present (Telegram webhook path, not needed for payment callbacks)
            if bot_webhook.endswith("/webhook"):
                bot_webhook = bot_webhook[:-8]  # Remove "/webhook" (8 characters)
            webhook_url = bot_webhook
            print(f"[CryptAPI] Using webhook URL from bot config: {webhook_url}")
    
    # Fall back to environment variable if bot config didn't provide a valid URL
    # Read fresh from environment to pick up .env changes without restart
    if not webhook_url:
        webhook_url = os.getenv("WEBHOOK_URL", "").strip()
        # Remove /webhook suffix if present
        if webhook_url and webhook_url.endswith("/webhook"):
            webhook_url = webhook_url[:-8]  # Remove "/webhook"
        if webhook_url:
            print(f"[CryptAPI] Using webhook URL from environment: {webhook_url}")
    
    # Trim whitespace if present (final check)
    if webhook_url:
        webhook_url = webhook_url.strip().rstrip("/")
        if not webhook_url:
            webhook_url = None
    if not webhook_url:
        # Try to get PORT from environment to build localhost webhook URL
        port = os.getenv("PORT", "8000")
        webhook_url = f"http://localhost:{port}"
        print(f"[CryptAPI] WARNING: WEBHOOK_URL not configured. Using localhost URL: {webhook_url}")
        print(f"[CryptAPI] NOTE: Localhost webhooks won't work for automatic payment callbacks.")
        print(f"[CryptAPI] For local testing with callbacks, use ngrok: https://ngrok.com/")
        print(f"[CryptAPI] Example: 'ngrok http {port}' then set WEBHOOK_URL=https://your-ngrok-url.ngrok.io")
        print(f"[CryptAPI] Payments will still work, but you'll need to manually check/confirm them.")
    elif webhook_url.startswith("http://localhost") or webhook_url.startswith("http://127.0.0.1"):
        print(f"[CryptAPI] WARNING: Using localhost webhook URL: {webhook_url}")
        print(f"[CryptAPI] NOTE: Localhost webhooks won't work for callbacks. CryptAPI cannot reach localhost.")
        print(f"[CryptAPI] For local testing with callbacks, use ngrok: https://ngrok.com/")
        port = os.getenv("PORT", "8000")
        print(f"[CryptAPI] Example: 'ngrok http {port}' then set WEBHOOK_URL=https://your-ngrok-url.ngrok.io")
    
    # Map currency codes to CryptAPI format (lowercase)
    currency_map = {
        "BTC": "btc",
        "LTC": "ltc",
        "DOGE": "doge",
        "ETH": "eth",
        "USDT": "usdt",  # USDT-ERC20
        "USDC": "usdc",  # USDC-ERC20
        "BCH": "bch",
        "TRX": "trx",
        "XRP": "xrp",
        "XMR": "xmr",
        "BNB": "bnb"
    }
    
    crypto_code = currency_map.get(currency.upper())
    if not crypto_code:
        return {
            "success": False,
            "error": f"Unsupported currency: {currency}. CryptAPI supports: {', '.join(currency_map.keys())}"
        }
    
    # Validate wallet address format matches the currency being used
    # CryptAPI requires the address format to be valid for the specific cryptocurrency
    wallet_address = wallet_address.strip()
    
    address_valid = False
    if currency_upper == "BTC":
        # Bitcoin addresses: 1..., 3..., bc1q..., or bc1p...
        address_valid = wallet_address.startswith(("1", "3", "bc1q", "bc1p"))
    elif currency_upper == "LTC":
        # Litecoin addresses: L..., M..., ltc1..., or lt1...
        address_valid = wallet_address.startswith(("L", "M", "ltc1", "lt1"))
    elif currency_upper == "DOGE":
        # Dogecoin addresses: D...
        address_valid = wallet_address.startswith("D")
    elif currency_upper in ["ETH", "USDT", "USDC"]:
        # Ethereum addresses: 0x... (42 chars)
        address_valid = wallet_address.startswith("0x") and len(wallet_address) == 42
    elif currency_upper == "BCH":
        # Bitcoin Cash addresses: 1..., 3..., bitcoincash:..., or q...
        address_valid = wallet_address.startswith(("1", "3", "bitcoincash:", "q"))
    elif currency_upper == "TRX":
        # Tron addresses: T... (34 chars)
        address_valid = wallet_address.startswith("T") and len(wallet_address) == 34
    elif currency_upper == "XRP":
        # XRP addresses: r... or x...
        address_valid = wallet_address.startswith(("r", "x"))
    elif currency_upper == "XMR":
        # Monero addresses: 4... or 8... (95 chars)
        address_valid = (wallet_address.startswith(("4", "8")) and len(wallet_address) == 95)
    elif currency_upper == "BNB":
        # BNB addresses: 0x... (same as Ethereum)
        address_valid = wallet_address.startswith("0x") and len(wallet_address) == 42
    else:
        # Unknown currency - accept any format (CryptAPI will validate)
        address_valid = True
    
    if not address_valid:
        # Detect what currency the address actually is
        detected_currency = None
        if wallet_address.startswith(("L", "M", "ltc1", "lt1")):
            detected_currency = "LTC (Litecoin)"
        elif wallet_address.startswith(("1", "3", "bc1q", "bc1p")):
            detected_currency = "BTC (Bitcoin)"
        elif wallet_address.startswith("D"):
            detected_currency = "DOGE (Dogecoin)"
        elif wallet_address.startswith("0x") and len(wallet_address) == 42:
            detected_currency = "ETH/USDT/USDC (Ethereum)"
        
        # Provide helpful error message with format requirements
        format_info = {
            "BTC": "Bitcoin addresses must start with: 1, 3, bc1q, or bc1p",
            "LTC": "Litecoin addresses must start with: L, M, ltc1, or lt1",
            "DOGE": "Dogecoin addresses must start with: D",
            "ETH": "Ethereum addresses must start with: 0x (42 characters)",
            "USDT": "USDT (ERC-20) addresses must start with: 0x (42 characters)",
            "USDC": "USDC (ERC-20) addresses must start with: 0x (42 characters)",
            "BCH": "Bitcoin Cash addresses must start with: 1, 3, bitcoincash:, or q",
            "TRX": "Tron addresses must start with: T (34 characters)",
            "XRP": "XRP addresses must start with: r or x",
            "XMR": "Monero addresses must start with: 4 or 8 (95 characters)",
            "BNB": "BNB addresses must start with: 0x (42 characters)"
        }
        
        format_requirement = format_info.get(currency_upper, "Valid address format for this currency")
        
        # Check enabled currencies to suggest alternatives
        enabled_codes = [c["code"].upper() for c in CRYPTAPI_SUPPORTED_CURRENCIES]
        enabled_list = ", ".join(enabled_codes) if enabled_codes else "None"
        
        error_msg = f"Wallet address format does not match {currency_upper} requirements.\n\n"
        error_msg += f"Your address: `{wallet_address[:30]}...`\n"
        if detected_currency:
            error_msg += f"Detected format: {detected_currency}\n"
        error_msg += f"Required for {currency_upper}: {format_requirement}\n\n"
        
        # If address matches a different currency and that currency is enabled, suggest it
        if detected_currency and "LTC" in detected_currency and currency_upper != "LTC":
            if "LTC" in enabled_codes:
                error_msg += f"💡 **Solution:** Your wallet address is a Litecoin address. "
                error_msg += f"Please select **Litecoin (LTC)** as your payment method instead of {currency_upper}.\n\n"
        
        error_msg += f"Enabled currencies: {enabled_list}\n"
        error_msg += f"Please select a payment method that matches your wallet address, or set CRYPTAPI_WALLET_ADDRESS to a valid {currency_upper} address."
        
        return {
            "success": False,
            "error": error_msg
        }
    
    try:
        # IMPORTANT: Use CryptAPI's conversion endpoint for accurate conversion rates
        # CryptAPI fetches rates every 5 minutes from CoinMarketCap, ensuring accuracy
        fiat_currency = fiat_currency.upper() if fiat_currency else "GBP"
        
        # Use CryptAPI conversion endpoint to get accurate crypto amount
        # Endpoint: https://api.cryptapi.io/convert/?value=5.00&from=GBP&to=LTC
        convert_url = f"{CRYPTAPI_API_BASE}/convert"
        convert_params = {
            "value": str(amount),
            "from": fiat_currency,
            "to": currency.upper()
        }
        
        print(f"[CryptAPI] Converting {amount} {fiat_currency} to {currency.upper()} using CryptAPI conversion endpoint")
        print(f"[CryptAPI] Conversion URL: {convert_url}")
        print(f"[CryptAPI] Conversion params: {convert_params}")
        
        # Calculate USD amount for reference (convert fiat to USD if needed)
        if fiat_currency == "GBP":
            fiat_to_usd_rate = 1.27  # Approximate GBP/USD rate
            amount_usd = amount * fiat_to_usd_rate
        elif fiat_currency == "USD":
            amount_usd = amount
        else:
            # For other currencies, use approximate USD rate or keep as-is
            amount_usd = amount
        
        # Call conversion endpoint with shorter timeout for faster invoice generation
        # Use aggressive timeout: 1.5s connect, 2s read (total 3.5s max)
        # If conversion is slow, we'll use fallback rates immediately to keep invoice generation fast
        amount_crypto = None
        exchange_rate = None
        
        session = get_session()
        try:
            convert_response = session.get(convert_url, params=convert_params, timeout=(1.5, 2))
            
            if convert_response.status_code == 200:
                convert_data = convert_response.json()
                if convert_data.get("status") == "success":
                    # Extract the converted crypto amount
                    amount_crypto = convert_data.get("value_coin")
                    exchange_rate = convert_data.get("exchange_rate")
                    
                    if amount_crypto:
                        try:
                            amount_crypto = float(amount_crypto)
                            print(f"[CryptAPI] Conversion successful: {amount} {fiat_currency} = {amount_crypto} {currency.upper()}")
                            print(f"[CryptAPI] Exchange rate: {exchange_rate}")
                        except (ValueError, TypeError):
                            amount_crypto = None
                            print(f"[CryptAPI] Warning: Could not parse value_coin from conversion response")
                else:
                    error_msg = convert_data.get("error", "Unknown conversion error")
                    print(f"[CryptAPI] Conversion endpoint error: {error_msg}")
            else:
                print(f"[CryptAPI] Conversion endpoint returned status {convert_response.status_code}, using fallback rates")
        except requests.exceptions.Timeout:
            print(f"[CryptAPI] Conversion endpoint timeout (BTC/LTC may be slower), using fallback rates for faster invoice generation")
        except requests.exceptions.RequestException as e:
            print(f"[CryptAPI] Conversion endpoint error: {e}, using fallback rates for faster invoice generation")
        
        # Fallback: If conversion failed, use approximate rates (but log warning)
        if amount_crypto is None or amount_crypto <= 0:
            print(f"[CryptAPI] WARNING: Using fallback conversion rates - amounts may not be accurate!")
            print(f"[CryptAPI] Please check network connection or CryptAPI service status")
            
            # Approximate crypto prices (fallback only - updated to more realistic values)
            crypto_prices_usd = {
                "BTC": 91339,
                "LTC": 60,  # Updated fallback (was 150, now more realistic ~£50-60)
                "ETH": 3500,
                "DOGE": 0.15,
                "USDT": 1.0,
                "USDC": 1.0,
                "BCH": 400,
                "TRX": 0.12,
                "XRP": 0.5,
                "XMR": 140,
                "BNB": 600
            }
            crypto_price_usd = crypto_prices_usd.get(currency.upper(), 91339)
            amount_crypto = float(amount_usd) / float(crypto_price_usd)
            exchange_rate = crypto_price_usd
        
        # Format crypto amount to reasonable precision
        if currency.upper() == "BTC":
            amount_crypto = round(amount_crypto, 8)
        elif currency.upper() in ["ETH", "LTC"]:
            amount_crypto = round(amount_crypto, 8)  # Increased precision for LTC
        else:
            amount_crypto = round(amount_crypto, 6)
        
        print(f"[CryptAPI] Final amount: {amount_crypto} {currency.upper()}")
        
        # IMPORTANT: Check minimum transaction amount before creating invoice
        is_valid, error_msg = check_minimum_amount(amount_crypto, currency)
        if not is_valid:
            minimums = get_minimum_amounts()
            min_amount_raw = minimums.get(currency.lower())
            
            # Ensure min_amount is a float
            try:
                min_amount = float(min_amount_raw) if min_amount_raw is not None else None
            except (ValueError, TypeError):
                min_amount = None
            
            # Calculate minimum fiat amount needed
            if exchange_rate and min_amount is not None:
                try:
                    min_fiat_usd = min_amount * float(exchange_rate)
                    min_fiat = min_fiat_usd / fiat_to_usd_rate if fiat_currency == "GBP" else min_fiat_usd
                    error_msg += f"\n\nFor {currency.upper()}, you need to send at least {min_amount} {currency.upper()} (approximately {min_fiat:.2f} {fiat_currency})."
                except (TypeError, ValueError) as e:
                    print(f"[CryptAPI] Warning: Could not calculate minimum fiat amount: {e}")
                    error_msg += f"\n\nFor {currency.upper()}, please check CryptAPI's minimum transaction amount."
            
            return {
                "success": False,
                "error": error_msg,
                "minimum_amount": min_amount,
                "minimum_currency": currency.upper()
            }
        
        # Build callback URL with order_id as parameter (URL encode it)
        # If webhook_url is None or empty, use empty string (CryptAPI will still create address, but no callbacks)
        from urllib.parse import quote
        if webhook_url and webhook_url.strip():
            callback_url = f"{webhook_url.strip().rstrip('/')}/payment/cryptapi-webhook?order_id={quote(str(order_id))}"
        else:
            callback_url = ""  # Empty callback - address will be created but no automatic payment confirmation
            print(f"[CryptAPI] WARNING: Creating payment address WITHOUT callback URL. Payments will work but won't auto-confirm.")
        
        # CryptAPI create address endpoint
        # Documentation: https://docs.cryptapi.io/api/tickercreate
        # Note: CryptAPI docs show /create/ but /create also works
        api_url = f"{CRYPTAPI_API_BASE}/{crypto_code}/create"
        
        # Set confirmation requirements based on currency
        # LTC: faster block time (~2.5 min) = 1 confirmation is fast enough
        # BTC: slower block time (~10 min) = can use 0 confirmations for faster response, but 1 is safer
        # For faster BTC, set CRYPTAPI_BTC_CONFIRMATIONS=0 in .env (will callback on pending), but less secure
        if currency.upper() == "BTC":
            # Bitcoin: 1 confirmation = ~10 minutes. For faster response, use 0 (pending), but less secure
            confirmations_required = os.getenv("CRYPTAPI_BTC_CONFIRMATIONS", "1")
            pending_mode = "1" if confirmations_required == "0" else "0"  # pending=1 means accept 0 confirmations
        elif currency.upper() == "LTC":
            # Litecoin: 1 confirmation = ~2.5 minutes, fast enough
            confirmations_required = "1"
            pending_mode = "0"  # Only confirmed payments
        else:
            # Other currencies: use 1 confirmation by default
            confirmations_required = "1"
            pending_mode = "0"
        
        params = {
            "address": wallet_address,  # Use the stripped/validated wallet address
            "pending": pending_mode,  # "1" = accept pending (0 confirmations), "0" = only confirmed
            "confirmations": confirmations_required,  # Number of confirmations required
            # Note: CryptAPI doesn't require amount parameter - it forwards any amount received
            # But we calculate it for display purposes in the QR code
        }
        
        # Only add callback if webhook URL is configured (optional parameter)
        if callback_url:
            params["callback"] = callback_url  # Optional: The callback URL (CryptAPI uses "callback" not "callback_url")
        
        print(f"[CryptAPI] Using {confirmations_required} confirmations for {currency.upper()} (pending={pending_mode})")
        
        print(f"[CryptAPI] Creating payment address for {amount_crypto} {currency} (${amount_usd} USD)")
        print(f"[CryptAPI] API URL: {api_url}")
        print(f"[CryptAPI] Wallet address: {wallet_address} (format validated for {currency_upper})")
        print(f"[CryptAPI] Callback URL: {callback_url}")
        
        # Use persistent session for connection pooling and faster requests
        session = get_session()
        # Set aggressive timeouts: connect in 1.5s, read in 2.5s total (4s max)
        # Reduced timeout for faster invoice generation (BTC/LTC create endpoint can be slow)
        # If timeout, will return error but fallback can be handled
        import time
        start_time = time.time()
        response = session.get(api_url, params=params, timeout=(1.5, 2.5))
        elapsed = time.time() - start_time
        print(f"[CryptAPI] Create endpoint API call completed in {elapsed:.2f} seconds")
        
        if response.status_code != 200:
            error_text = response.text or "Unknown error"
            error_msg = error_text
            try:
                error_data = response.json()
                error_msg = error_data.get("error") or error_data.get("message") or error_text
            except:
                pass
            
            # Provide more helpful error message for address validation errors
            error_lower = error_msg.lower()
            if "address" in error_lower or "valid" in error_lower:
                return {
                    "success": False,
                    "error": f"CryptAPI address validation error: {error_msg}\n\n"
                             f"Wallet address: {wallet_address[:30]}...\n"
                             f"Currency: {currency_upper}\n\n"
                             f"Please ensure your CRYPTAPI_WALLET_ADDRESS in .env is a valid {currency_upper} address. "
                             f"For {currency_upper}, addresses should match the required format."
                }
            
            return {
                "success": False,
                "error": f"CryptAPI error: {error_msg}"
            }
        
        data = response.json()
        
        # Check for errors in response
        if "error" in data:
            error_msg = data["error"]
            # Provide more helpful error message for address validation errors
            error_lower = str(error_msg).lower()
            if "address" in error_lower or "valid" in error_lower:
                return {
                    "success": False,
                    "error": f"CryptAPI address validation error: {error_msg}\n\n"
                             f"Wallet address: {wallet_address[:30]}...\n"
                             f"Currency: {currency_upper}\n\n"
                             f"Please ensure your CRYPTAPI_WALLET_ADDRESS in .env is a valid {currency_upper} address."
                }
            
            return {
                "success": False,
                "error": f"CryptAPI error: {error_msg}"
            }
        
        # Extract payment address from response
        payment_address = data.get("address_in")  # CryptAPI returns "address_in" for the payment address
        if not payment_address:
            return {
                "success": False,
                "error": "CryptAPI did not return a payment address"
            }
        
        # Generate QR code URL (CryptAPI provides this if available)
        qr_code_url = data.get("qr_code") or data.get("qr") or data.get("qr_code_url") or None
        
        # Generate payment URI for QR code (we'll generate QR on-demand when user clicks "Show QR" to speed up)
        if currency.upper() == "BTC":
            payment_uri = f"bitcoin:{payment_address}?amount={amount_crypto}"
        elif currency.upper() == "LTC":
            payment_uri = f"litecoin:{payment_address}?amount={amount_crypto}"
        elif currency.upper() in ["ETH", "USDT", "USDC"]:
            payment_uri = f"ethereum:{payment_address}?value={amount_crypto}"
        else:
            payment_uri = f"bitcoin:{payment_address}?amount={amount_crypto}"  # Fallback
        
        # Skip local QR code generation during invoice creation to save time
        # QR code will be generated on-demand when user clicks "Show QR" button
        # This reduces invoice creation time from ~20s to ~2-4s
        if False and not qr_code_url:
            try:
                # Create Bitcoin payment URI: bitcoin:address?amount=amount
                bitcoin_uri = f"bitcoin:{payment_address}?amount={amount_crypto}"
                
                # Import QR generator and create QR code
                import qrcode
                import io
                import base64
                
                qr = qrcode.QRCode(version=1, box_size=10, border=4)
                qr.add_data(bitcoin_uri)
                qr.make(fit=True)
                qr_img = qr.make_image(fill_color="black", back_color="white")
                
                # Convert to base64 data URL for inline display
                img_bytes = io.BytesIO()
                qr_img.save(img_bytes, format='PNG')
                img_bytes.seek(0)
                img_base64 = base64.b64encode(img_bytes.read()).decode()
                qr_code_url = f"data:image/png;base64,{img_base64}"
                
                print(f"[CryptAPI] Generated local QR code for {payment_address}")
            except Exception as e:
                print(f"[CryptAPI] Warning: Could not generate QR code: {e}")
                import traceback
                traceback.print_exc()
        
        print(f"[CryptAPI] Payment address created: {payment_address}")
        print(f"[CryptAPI] Final amount: {amount_crypto} {currency} (${amount_usd} USD from {amount} {fiat_currency})")
        
        return {
            "success": True,
            "address": payment_address,
            "amount": amount_crypto,  # This is the crypto amount that will be displayed
            "amount_usd": amount_usd,  # USD amount for reference
            "currency": currency,
            "exchange_rate": exchange_rate,  # Exchange rate from CryptAPI conversion endpoint
            "qrcode_url": qr_code_url,  # May be None - will generate on-demand
            "payment_uri": payment_uri,  # Payment URI for QR generation
            "invoice_id": order_id,
            "provider": "cryptapi"
        }
        
    except requests.exceptions.Timeout:
        return {
            "success": False,
            "error": "CryptAPI timeout: Please try again later."
        }
    except requests.exceptions.ConnectionError:
        return {
            "success": False,
            "error": "CryptAPI connection error: Unable to connect to CryptAPI service."
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"CryptAPI error: {str(e)}"
        }
