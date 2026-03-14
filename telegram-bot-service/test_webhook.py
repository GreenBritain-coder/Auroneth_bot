"""
Test script for webhook endpoint
Run this to manually test the payment webhook locally
"""
import requests
import json
import os
from dotenv import load_dotenv
import pathlib

# Load .env file
env_path = pathlib.Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)

# Configuration
WEBHOOK_BASE_URL = os.getenv("WEBHOOK_URL", "http://localhost:8000")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "")
PORT = os.getenv("PORT", "8000")

# Construct webhook URL
if WEBHOOK_BASE_URL.startswith("http"):
    webhook_url = f"{WEBHOOK_BASE_URL}/payment/webhook"
else:
    webhook_url = f"http://localhost:{PORT}/payment/webhook"

if WEBHOOK_SECRET:
    webhook_url += f"?secret={WEBHOOK_SECRET}"

print(f"Testing webhook at: {webhook_url}")
print(f"Secret configured: {'Yes' if WEBHOOK_SECRET else 'No (optional for testing)'}")
print()

# Test payload - using real order ID from payment invoice
test_payload = {
    "txn_id": "test_transaction_12345",
    "status": 2,  # 2 = confirmed payment in Blockonomics
    "order_id": "a2deb5ab-d8e4-4b4d-854e-11e60ffe9d57",  # Real order ID from payment invoice
    "status_text": "confirmed",
    "addr": "bc1qmxwcsynlpttpetl2g2629n3ulzpk2w5yhrgpa0"  # Payment address from invoice
}

print("Sending test webhook payload:")
print(json.dumps(test_payload, indent=2))
print()

try:
    response = requests.post(
        webhook_url,
        json=test_payload,
        headers={"Content-Type": "application/json"},
        timeout=10
    )
    
    print(f"Status Code: {response.status_code}")
    print(f"Response: {response.text}")
    
    if response.status_code == 200:
        print("\n[SUCCESS] Webhook test successful!")
    elif response.status_code == 401:
        print("\n[ERROR] Unauthorized: Check your WEBHOOK_SECRET")
    elif response.status_code == 404:
        print("\n[WARNING] Order not found: Make sure the order_id exists in your database")
    else:
        print(f"\n[WARNING] Unexpected response: {response.status_code}")
        
except requests.exceptions.ConnectionError:
    print("\n[ERROR] Connection Error: Make sure your bot server is running on port", PORT)
    print("   Start it with: py -3.12 main.py")
    print("   Note: For webhook testing, set WEBHOOK_URL in .env or the server won't start")
except Exception as e:
    print(f"\n[ERROR] Error: {e}")

