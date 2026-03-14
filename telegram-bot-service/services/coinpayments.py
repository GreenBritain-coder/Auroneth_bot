import os
import hmac
import hashlib
import requests
from typing import Dict, Optional
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("PAYMENT_API_KEY")
API_SECRET = os.getenv("PAYMENT_API_SECRET")
API_URL = "https://www.coinpayments.net/api.php"


def create_invoice(amount: float, currency: str, order_id: str, buyer_email: str = "") -> Dict:
    """
    Create payment invoice via CoinPayments API
    Returns invoice URL or error
    """
    # Check if API credentials are configured
    if not API_KEY or not API_SECRET:
        return {
            "success": False,
            "error": "CoinPayments API credentials not configured. Please set PAYMENT_API_KEY and PAYMENT_API_SECRET in .env file"
        }
    
    payload = {
        "version": 1,
        "cmd": "create_transaction",
        "key": API_KEY,
        "format": "json",
        "amount": amount,
        "currency1": currency,  # Currency to receive (BTC, LTC)
        "currency2": currency,  # Currency to send (same)
        "buyer_email": buyer_email,
        "item_name": f"Order {order_id}",
        "custom": order_id,  # Store order ID in custom field
        "ipn_url": os.getenv("WEBHOOK_URL", "") + "/payment/webhook"
    }
    
    # Create HMAC signature
    payload_string = "&".join([f"{k}={v}" for k, v in sorted(payload.items())])
    hmac_signature = hmac.new(
        API_SECRET.encode(),
        payload_string.encode(),
        hashlib.sha512
    ).hexdigest()
    
    headers = {
        "HMAC": hmac_signature,
        "Content-Type": "application/x-www-form-urlencoded"
    }
    
    try:
        response = requests.post(API_URL, data=payload, headers=headers, timeout=30)
        response.raise_for_status()
        result = response.json()
        
        if result.get("error") == "ok":
            return {
                "success": True,
                "txn_id": result["result"]["txn_id"],
                "address": result["result"]["address"],
                "amount": result["result"]["amount"],
                "status_url": result["result"]["status_url"],
                "qrcode_url": result["result"]["qrcode_url"]
            }
        else:
            return {
                "success": False,
                "error": result.get("error", "Unknown error")
            }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def verify_webhook_signature(data: Dict, signature: str) -> bool:
    """Verify CoinPayments webhook signature"""
    # Extract relevant fields for signature verification
    payload_string = "&".join([f"{k}={v}" for k, v in sorted(data.items()) if k != "hmac"])
    expected_signature = hmac.new(
        API_SECRET.encode(),
        payload_string.encode(),
        hashlib.sha512
    ).hexdigest()
    
    return hmac.compare_digest(expected_signature, signature)

