"""
Payment provider selection and invoice creation
Tries providers in order: SHKeeper > CryptAPI > Blockonomics > CoinPayments
"""
import os
from typing import Dict, Optional


def create_payment_invoice(amount: float, currency: str, order_id: str, buyer_email: str = "", fiat_currency: str = "GBP", fiat_amount: float = None, bot_config: dict = None) -> Dict:
    """
    Create payment invoice using available payment provider
    Tries providers in order: SHKeeper > CryptAPI > Blockonomics > CoinPayments
    
    Args:
        amount: Payment amount
        currency: Cryptocurrency code
        order_id: Unique order ID
        buyer_email: Optional buyer email
    
    Returns:
        Dict with success status and invoice details or error
    """
    # Try SHKeeper first (self-hosted, no fees, supports payouts)
    shkeeper_api_key = os.getenv("SHKEEPER_API_KEY")
    shkeeper_api_url = os.getenv("SHKEEPER_API_URL")
    if shkeeper_api_key and shkeeper_api_url:
        try:
            from services.shkeeper import create_invoice as shkeeper_create_invoice
            result = shkeeper_create_invoice(
                amount=amount,
                currency=currency,
                order_id=order_id,
                buyer_email=buyer_email,
            )
            if result.get("success"):
                result["provider"] = "shkeeper"
                return result
            else:
                result["provider"] = "shkeeper"
                return result
        except Exception as e:
            print(f"[PaymentProvider] SHKeeper error: {e}, falling back to CryptAPI")

    # Try CryptAPI (simple, no KYC, no node setup needed)
    # Check for currency-specific addresses first, then fallback to default
    cryptapi_wallet = os.getenv("CRYPTAPI_WALLET_ADDRESS")
    cryptapi_ltc_wallet = os.getenv("CRYPTAPI_LTC_WALLET_ADDRESS")
    cryptapi_btc_wallet = os.getenv("CRYPTAPI_BTC_WALLET_ADDRESS")
    cryptapi_configured = cryptapi_wallet or cryptapi_ltc_wallet or cryptapi_btc_wallet
    
    if cryptapi_configured:
        try:
            from services.cryptapi import create_invoice as cryptapi_create_invoice, CRYPTAPI_SUPPORTED_CURRENCIES
            # Check if currency is enabled for CryptAPI
            enabled_codes = [c["code"].upper() for c in CRYPTAPI_SUPPORTED_CURRENCIES]
            if currency.upper() not in enabled_codes:
                return {
                    "success": False,
                    "error": f"{currency.upper()} is not enabled for CryptAPI. Enabled currencies: {', '.join(enabled_codes)}. "
                             f"Set CRYPTAPI_ENABLED_CURRENCIES in .env to enable more currencies.",
                    "provider": "cryptapi"
                }
            
            result = cryptapi_create_invoice(
                amount=amount,
                currency=currency,
                order_id=order_id,
                buyer_email=buyer_email,
                fiat_currency=fiat_currency,
                fiat_amount=fiat_amount if fiat_amount else amount,
                bot_config=bot_config
            )
            if result.get("success"):
                result["provider"] = "cryptapi"
                return result
            else:
                # CryptAPI is configured but failed - don't fall back to other providers
                # Return the CryptAPI error instead
                result["provider"] = "cryptapi"
                return result
        except Exception as e:
            # If import fails or other error, return error instead of falling back
            return {
                "success": False,
                "error": f"CryptAPI error: {str(e)}",
                "provider": "cryptapi"
            }
    
    # Try Blockonomics
    blockonomics_api_key = os.getenv("BLOCKONOMICS_API_KEY")
    if blockonomics_api_key:
        try:
            from services.blockonomics import create_invoice as blockonomics_create_invoice
            result = blockonomics_create_invoice(
                amount=amount,
                currency=currency,
                order_id=order_id,
                buyer_email=buyer_email
            )
            if result.get("success"):
                result["provider"] = "blockonomics"
                return result
        except Exception as e:
            pass
    
    # Try CoinPayments last
    coinpayments_api_key = os.getenv("PAYMENT_API_KEY")
    coinpayments_api_secret = os.getenv("PAYMENT_API_SECRET")
    if coinpayments_api_key and coinpayments_api_secret:
        try:
            from services.coinpayments import create_invoice as coinpayments_create_invoice
            result = coinpayments_create_invoice(
                amount=amount,
                currency=currency,
                order_id=order_id,
                buyer_email=buyer_email
            )
            if result.get("success"):
                result["provider"] = "coinpayments"
                return result
        except Exception as e:
            pass
    
    # No provider configured or all failed
    return {
        "success": False,
        "error": "No payment provider configured. Please configure one of:\n"
                 "- CryptAPI: Set CRYPTAPI_WALLET_ADDRESS or CRYPTAPI_LTC_WALLET_ADDRESS/CRYPTAPI_BTC_WALLET_ADDRESS (recommended - no KYC, simple setup)\n"
                 "- Blockonomics: Set BLOCKONOMICS_API_KEY\n"
                 "- CoinPayments: Set PAYMENT_API_KEY and PAYMENT_API_SECRET",
        "provider": None
    }

