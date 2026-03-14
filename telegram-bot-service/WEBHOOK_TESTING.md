# Testing Webhooks Locally

Webhooks require a publicly accessible URL, but you can test them locally using tunneling tools.

## Option 1: Using ngrok (Recommended)

### Setup:

1. **Install ngrok:**
   - Download from: https://ngrok.com/download
   - Or use: `choco install ngrok` (Windows) or `brew install ngrok` (Mac)

2. **Start your bot server:**
   ```bash
   cd telegram-bot-service
   py -3.12 main.py
   ```
   The bot should start on port 8000 (or the PORT specified in .env)

3. **Start ngrok tunnel:**
   ```bash
   ngrok http 8000
   ```
   This will give you a public URL like: `https://abc123.ngrok.io`

4. **Configure webhook URL:**
   - Copy the HTTPS URL from ngrok (e.g., `https://abc123.ngrok.io`)
   - Add to your `.env` file:
     ```
     WEBHOOK_URL=https://abc123.ngrok.io
     WEBHOOK_SECRET=your_secure_secret_here
     PORT=8000
     ```
   - Restart your bot

5. **Test the webhook:**
   - Your webhook endpoint will be: `https://abc123.ngrok.io/payment/webhook?secret=your_secure_secret_here`
   - Configure this URL in your payment provider (Blockonomics dashboard)

### Testing with curl:

```bash
# Test webhook endpoint (replace with your ngrok URL and secret)
curl -X POST https://abc123.ngrok.io/payment/webhook?secret=your_secret \
  -H "Content-Type: application/json" \
  -d '{
    "txn_id": "test123",
    "status": 2,
    "order_id": "test-order-id"
  }'
```

## Option 2: Using localtunnel

### Setup:

1. **Install localtunnel:**
   ```bash
   npm install -g localtunnel
   ```

2. **Start your bot server:**
   ```bash
   cd telegram-bot-service
   py -3.12 main.py
   ```

3. **Start localtunnel:**
   ```bash
   lt --port 8000
   ```
   This will give you a public URL like: `https://random-name.loca.lt`

4. **Configure webhook URL:**
   - Use the provided URL in your `.env` file
   - Note: localtunnel URLs change each time unless you use `--subdomain`

## Option 3: Manual Testing Script

Create a test script to simulate webhook calls:

```python
# test_webhook.py
import requests
import json

WEBHOOK_URL = "http://localhost:8000/payment/webhook"
SECRET = "your_secret_here"  # From .env WEBHOOK_SECRET

# Test webhook payload
payload = {
    "txn_id": "test_transaction_123",
    "status": 2,  # 2 = confirmed
    "order_id": "your_order_id_here",  # Replace with actual order ID from database
    "status_text": "confirmed"
}

url = f"{WEBHOOK_URL}?secret={SECRET}"

response = requests.post(
    url,
    json=payload,
    headers={"Content-Type": "application/json"}
)

print(f"Status Code: {response.status_code}")
print(f"Response: {response.text}")
```

Run it:
```bash
cd telegram-bot-service
py -3.12 test_webhook.py
```

## Important Notes:

1. **ngrok free tier:**
   - URLs change on each restart (unless you have a paid plan)
   - You'll need to update your `.env` file each time

2. **Webhook secret:**
   - Always use a secret for security
   - Generate one: `python -c "import secrets; print(secrets.token_urlsafe(32))"`

3. **Port configuration:**
   - Make sure `PORT` in `.env` matches the port ngrok/localtunnel is forwarding to
   - Default is 8000

4. **Testing Blockonomics:**
   - Blockonomics will send actual payment notifications
   - Make sure your test order ID exists in the database
   - Check the bot logs for webhook processing

5. **Telegram webhook:**
   - If using `WEBHOOK_URL`, Telegram will also send updates via webhook
   - The endpoint is at `/webhook` (not `/payment/webhook`)
   - Telegram doesn't use the secret parameter

## Troubleshooting:

- **"Connection refused":** Make sure your bot server is running
- **"Unauthorized: Invalid secret":** Check that `WEBHOOK_SECRET` in `.env` matches the secret in your URL
- **"Order not found":** Make sure the `order_id` in your test payload exists in the database
- **ngrok not working:** Check if port 8000 is already in use, try a different port

