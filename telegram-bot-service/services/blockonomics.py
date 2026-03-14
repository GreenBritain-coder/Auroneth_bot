"""
Blockonomics payment integration - No KYC required
"""
import os
import requests
from typing import Dict
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("BLOCKONOMICS_API_KEY")
API_URL = "https://www.blockonomics.co/api"


def create_invoice(amount: float, currency: str, order_id: str, buyer_email: str = "") -> Dict:
    """
    Create payment invoice via Blockonomics API
    Returns invoice with payment address and QR code
    No KYC required for basic invoice generation
    """
    # Check if API key is configured
    if not API_KEY:
        return {
            "success": False,
            "error": "Blockonomics API key not configured. Please set BLOCKONOMICS_API_KEY in .env file. Get your key at https://www.blockonomics.co/merchants"
        }
    
    # Blockonomics supports BTC, LTC, ETH, USDT, etc.
    # Map currency codes
    currency_map = {
        "BTC": "btc",
        "LTC": "ltc",
        "ETH": "eth",
        "USDT": "usdt"
    }
    
    crypto_code = currency_map.get(currency.upper(), "btc")
    
    try:
        # Create new address via Blockonomics API
        headers = {
            "Authorization": f"Bearer {API_KEY}"
        }
        
        # First, try to get stores to see if any exist
        stores_response = requests.get(
            f"{API_URL}/stores",
            headers=headers,
            timeout=30
        )
        
        store_id = None
        if stores_response.status_code == 200:
            stores_data = stores_response.json()
            if stores_data and len(stores_data) > 0:
                # Use the first store
                store_id = stores_data[0].get("id")
        
        # Get a new address for this order
        # Blockonomics API requires store_id in the request
        request_data = {}
        if store_id:
            request_data["store_id"] = store_id
        
        address_response = requests.post(
            f"{API_URL}/new_address",
            headers=headers,
            json=request_data,
            timeout=30
        )
        
        if address_response.status_code != 200:
            error_data = {}
            error_text = address_response.text or ""
            try:
                if error_text:
                    error_data = address_response.json()
            except:
                pass
            
            # Extract error message from various possible formats
            error_msg = ""
            if isinstance(error_data, dict):
                if "error" in error_data:
                    if isinstance(error_data["error"], dict):
                        error_msg = error_data["error"].get("message", "")
                    else:
                        error_msg = str(error_data["error"])
                else:
                    error_msg = error_data.get("message", "")
            
            if not error_msg:
                error_msg = error_text
            
            # Check for common errors and provide helpful messages
            if "No store found" in str(error_msg) or ("store" in str(error_msg).lower() and "not found" in str(error_msg).lower()):
                return {
                    "success": False,
                    "error": "No Blockonomics store found. Please create a store at https://www.blockonomics.co/merchants/stores before generating payment addresses."
                }
            
            if "wallet" in str(error_msg).lower() or "no wallet" in str(error_msg).lower():
                return {
                    "success": False,
                    "error": "No wallet added to your Blockonomics store. Please add a BTC wallet (or other cryptocurrency wallet) to your store at https://www.blockonomics.co/merchants/stores. Click on your store → Add BTC Wallet (or other currency)."
                }
            
            # Check for gap limit error (check in multiple places)
            error_text_lower = (error_msg + " " + error_text).lower()
            error_data_str = str(error_data).lower()
            if "gap limit" in error_text_lower or "gap limit" in error_data_str or "too many addresses" in error_text_lower:
                return {
                    "success": False,
                    "error": "Gap Limit Error: Too many addresses created without payments. This happens when you create many test orders. Solutions:\n1. Wait a few hours for the limit to reset\n2. Complete a real payment to reset the counter\n3. Contact Blockonomics support to increase your limit\n\nSee: https://help.blockonomics.co/support/solutions/articles/33000215760-gap-limit-faq"
                }
            
            return {
                "success": False,
                "error": f"Failed to create address: {error_msg or address_response.text or 'Unknown error'}"
            }
        
        address_data = address_response.json()
        payment_address = address_data.get("address")
        
        if not payment_address:
            return {
                "success": False,
                "error": "Failed to get payment address from Blockonomics"
            }
        
        # Blockonomics returns the address, but we need to create proper payment URLs
        # Generate QR code and status URL based on currency
        currency_upper = currency.upper()
        
        # Create QR code URI based on currency
        if currency_upper == "BTC":
            payment_uri = f"bitcoin:{payment_address}?amount={amount}"
        elif currency_upper == "LTC":
            payment_uri = f"litecoin:{payment_address}?amount={amount}"
        elif currency_upper == "ETH":
            payment_uri = f"ethereum:{payment_address}?value={amount}"
        elif currency_upper == "USDT":
            # USDT on Ethereum network (ERC-20)
            payment_uri = f"ethereum:{payment_address}?value={amount}"
        else:
            payment_uri = f"bitcoin:{payment_address}?amount={amount}"
        
        # QR code can be generated via a QR code service
        qr_code_url = f"https://api.qrserver.com/v1/create-qr-code/?size=300x300&data={payment_uri}"
        
        # For status, users can check on Blockonomics or use a block explorer
        # Use Blockonomics merchant dashboard or blockchain explorer
        if currency_upper == "BTC":
            status_url = f"https://blockstream.info/address/{payment_address}"
        elif currency_upper == "LTC":
            status_url = f"https://blockchair.com/litecoin/address/{payment_address}"
        elif currency_upper == "ETH":
            status_url = f"https://etherscan.io/address/{payment_address}"
        elif currency_upper == "USDT":
            # USDT on Ethereum network uses Etherscan
            status_url = f"https://etherscan.io/address/{payment_address}"
        else:
            status_url = f"https://blockstream.info/address/{payment_address}"
        
        return {
            "success": True,
            "txn_id": payment_address,  # Use address as transaction ID
            "address": payment_address,
            "amount": amount,
            "currency": currency,
            "status_url": status_url,
            "qrcode_url": qr_code_url,
            "payment_uri": payment_uri  # For wallet apps (supports BTC, LTC, ETH, USDT)
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": f"Blockonomics API error: {str(e)}"
        }


def check_payment_status(address: str) -> Dict:
    """
    Check payment status for a given address
    Note: For production, you should set up webhooks or polling
    """
    if not API_KEY:
        return {
            "success": False,
            "error": "API key not configured"
        }
    
    try:
        headers = {
            "Authorization": f"Bearer {API_KEY}"
        }
        
        response = requests.get(
            f"{API_URL}/address/{address}",
            headers=headers,
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            return {
                "success": True,
                "paid": data.get("paid", "0"),
                "unconfirmed": data.get("unconfirmed", "0"),
                "total_received": data.get("received", "0")
            }
        else:
            return {
                "success": False,
                "error": f"Failed to check status: {response.text}"
            }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def send_bitcoin_payment(to_address: str, amount_btc: float, fee_rate: float = None) -> Dict:
    """
    Send Bitcoin payment to a specified address
    
    IMPORTANT: Blockonomics is non-custodial and doesn't provide a send API.
    This function uses the Blockonomics API to check your wallet balance,
    but you'll need to use your own wallet to actually send the transaction.
    
    For actual sending, you have two options:
    1. Use a Bitcoin library (like python-bitcoinlib or bitcoin) with your wallet
    2. Use a custodial service that supports programmatic withdrawals
    3. Manually process payouts from your wallet
    
    This function provides a helper that can be extended with actual wallet integration.
    
    Args:
        to_address: Bitcoin address to send to
        amount_btc: Amount in BTC to send
        fee_rate: Optional fee rate in sat/vB (if None, uses network estimate)
    
    Returns:
        Dict with success status and transaction details or error
    """
    try:
        # Validate address format (basic check)
        if not to_address or len(to_address) < 26:
            return {
                "success": False,
                "error": "Invalid Bitcoin address format"
            }
        
        # Validate amount
        if amount_btc <= 0:
            return {
                "success": False,
                "error": "Amount must be greater than 0"
            }
        
        # For now, return instructions on how to actually send
        # In production, you would integrate with:
        # - python-bitcoinlib or bitcoin library
        # - Or a custodial service API
        # - Or your own wallet's RPC interface
        
        return {
            "success": True,
            "message": "Payout request recorded. To actually send BTC:",
            "instructions": [
                "1. Use your Bitcoin wallet (Electrum, Bitcoin Core, etc.)",
                f"2. Send {amount_btc} BTC to {to_address}",
                "3. Update the payout status to 'paid' after confirmation",
                "",
                "Alternative: Integrate with a Bitcoin library or custodial service",
                "that supports programmatic sending."
            ],
            "to_address": to_address,
            "amount_btc": amount_btc,
            "status": "pending_manual_send"
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": f"Error preparing payout: {str(e)}"
        }
