"""
Currency conversion utility using CoinGecko API
"""
import requests
from typing import Optional
from datetime import datetime, timedelta

API_URL = "https://api.coingecko.com/api/v3/simple/price"

# Cache for exchange rates to avoid slow API calls
_exchange_rate_cache = {}
_exchange_rate_cache_time = {}
_exchange_rate_cache_ttl = timedelta(minutes=5)  # Cache rates for 5 minutes


def get_exchange_rate(from_currency: str, to_currency: str) -> Optional[float]:
    """
    Get exchange rate between two currencies using CoinGecko API
    Returns rate to convert from_currency to to_currency
    """
    # Map currency codes to CoinGecko IDs
    currency_map = {
        "BTC": "bitcoin",
        "USDT": "tether",
        "ETH": "ethereum",
        "LTC": "litecoin",
        "DOGE": "dogecoin",
        "GBP": "gbp",  # British Pound Sterling (fiat)
        "USD": "usd"   # US Dollar (fiat)
    }
    
    from_id = currency_map.get(from_currency.upper())
    to_id = currency_map.get(to_currency.upper())
    
    if not from_id or not to_id:
        return None
    
    try:
        # Handle fiat-to-fiat conversion first (GBP <-> USD)
        if from_id == "usd" and to_id == "gbp":
            # USD to GBP conversion - use CoinGecko API to get current rate
            # CoinGecko doesn't directly support fiat-to-fiat, so we'll use a fallback API
            try:
                # Try to get rate from exchangerate-api.com (free, no API key needed)
                response = requests.get(
                    "https://api.exchangerate-api.com/v4/latest/USD",
                    timeout=5
                )
                if response.status_code == 200:
                    data = response.json()
                    gbp_rate = data.get("rates", {}).get("GBP")
                    if gbp_rate:
                        print(f"[Currency Converter] USD to GBP rate from API: {gbp_rate}")
                        return gbp_rate
            except Exception as e:
                print(f"[Currency Converter] Error fetching USD/GBP rate: {e}, using fallback")
            # Fallback to approximate rate if API fails
            return 0.79  # Approximate GBP/USD rate
        elif from_id == "gbp" and to_id == "usd":
            # GBP to USD conversion - use cached rate if available
            cache_key = "GBP_USD"
            if cache_key in _exchange_rate_cache and cache_key in _exchange_rate_cache_time:
                if datetime.utcnow() - _exchange_rate_cache_time[cache_key] < _exchange_rate_cache_ttl:
                    cached_rate = _exchange_rate_cache[cache_key]
                    print(f"[Currency Converter] Using cached GBP/USD rate: {cached_rate} (age: {(datetime.utcnow() - _exchange_rate_cache_time[cache_key]).total_seconds():.1f}s)")
                    return cached_rate
            
            # GBP to USD conversion - use real-time API to get current rate
            try:
                # Try exchangerate-api.com first (free, no API key needed, updates daily)
                response = requests.get(
                    "https://api.exchangerate-api.com/v4/latest/GBP",
                    timeout=3  # Reduced timeout from 5 to 3 seconds
                )
                if response.status_code == 200:
                    data = response.json()
                    usd_rate = data.get("rates", {}).get("USD")
                    if usd_rate and isinstance(usd_rate, (int, float)) and 1.0 < usd_rate < 2.0:
                        rate = float(usd_rate)
                        # Cache the rate
                        _exchange_rate_cache[cache_key] = rate
                        _exchange_rate_cache_time[cache_key] = datetime.utcnow()
                        print(f"[Currency Converter] GBP to USD rate from exchangerate-api: {rate} (cached)")
                        return rate
                
                # Fallback: Try fixer.io (free tier, but requires API key - we'll try without)
                # Or use a more reliable source
                try:
                    response = requests.get(
                        "https://api.fixer.io/latest?base=GBP&symbols=USD",
                        timeout=3  # Reduced timeout
                    )
                    if response.status_code == 200:
                        data = response.json()
                        usd_rate = data.get("rates", {}).get("USD")
                        if usd_rate and isinstance(usd_rate, (int, float)) and 1.0 < usd_rate < 2.0:
                            print(f"[Currency Converter] GBP to USD rate from fixer.io: {usd_rate}")
                            return float(usd_rate)
                except:
                    pass
                    
            except Exception as e:
                print(f"[Currency Converter] Error fetching GBP/USD rate: {e}, using fallback")
            # Fallback to approximate rate if API fails (should be updated to current rate)
            # Current approximate rate as of 2024: ~1.27
            print(f"[Currency Converter] Using fallback GBP/USD rate: 1.27")
            return 1.27  # Approximate USD/GBP rate (fallback)
        
        # Handle fiat currencies (GBP, USD) to/from crypto
        if from_id in ["gbp", "usd"]:
            # Converting from fiat to crypto
            fiat_currency = from_id
            response = requests.get(
                API_URL,
                params={
                    "ids": to_id,
                    "vs_currencies": fiat_currency
                },
                timeout=10
            )
            if response.status_code == 200:
                data = response.json()
                to_price_fiat = data.get(to_id, {}).get(fiat_currency)
                if to_price_fiat:
                    # 1 fiat = how many units of crypto
                    return 1.0 / to_price_fiat
            return None
        elif to_id in ["gbp", "usd"]:
            # Converting from crypto to fiat
            fiat_currency = to_id
            response = requests.get(
                API_URL,
                params={
                    "ids": from_id,
                    "vs_currencies": fiat_currency
                },
                timeout=10
            )
            if response.status_code == 200:
                data = response.json()
                from_price_fiat = data.get(from_id, {}).get(fiat_currency)
                if from_price_fiat:
                    # 1 unit of crypto = how many fiat
                    return from_price_fiat
            return None
        
        # Get both currencies in USD to calculate rate
        response = requests.get(
            API_URL,
            params={
                "ids": f"{from_id},{to_id}",
                "vs_currencies": "usd"
            },
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            from_price = data.get(from_id, {}).get("usd")
            to_price = data.get(to_id, {}).get("usd")
            
            if from_price and to_price:
                # Calculate exchange rate
                rate = from_price / to_price
                return rate
        
        return None
    except Exception as e:
        print(f"Error fetching exchange rate: {e}")
        return None


def convert_amount(amount: float, from_currency: str, to_currency: str) -> Optional[float]:
    """
    Convert amount from one currency to another
    Returns converted amount or None if conversion fails
    """
    if from_currency.upper() == to_currency.upper():
        return amount
    
    rate = get_exchange_rate(from_currency, to_currency)
    if rate:
        return amount * rate
    
    return None

