# Payment Provider Setup Guide

This bot supports multiple payment providers. Choose the one that best fits your needs.

## Option 1: SHKeeper (Self-Hosted - Recommended for Control)

**Pros:**
- ✅ Self-hosted, full control over your payment processor
- ✅ No fees or intermediaries
- ✅ Supports many cryptocurrencies (BTC, ETH, USDT, USDC, BNB, etc.)
- ✅ Automatic payment confirmation via webhooks
- ✅ Open-source

**Cons:**
- ❌ Requires self-hosting SHKeeper instance
- ❌ You manage the infrastructure

**Setup:**
1. Deploy SHKeeper on your server (see [SHKEEPER_SETUP.md](./SHKEEPER_SETUP.md) for detailed installation guide)
2. Access your SHKeeper admin panel (usually at `http://your-server-ip:5000` or `https://your-domain.com`)
3. Log in with username `admin` and set your password
4. Go to `Wallets` → `Manage` → `API key`
5. Copy your API key
6. Add to your `.env` file:
   ```
   SHKEEPER_API_KEY=your_api_key_here
   SHKEEPER_API_URL=https://your-shkeeper-instance.com
   WEBHOOK_URL=https://your-bot-domain.com
   ```

**Quick Installation:**
See [SHKEEPER_SETUP.md](./SHKEEPER_SETUP.md) for complete step-by-step installation instructions using Kubernetes (k3s) and Helm.

**Note:** SHKeeper will automatically send payment callbacks to your webhook URL. Make sure `WEBHOOK_URL` is set correctly.

## Option 2: Blockonomics (Recommended - No KYC)

**Pros:**
- ✅ No KYC verification required
- ✅ Simple API with one key
- ✅ Supports BTC, LTC, ETH
- ✅ Free to use

**Setup:**
1. Go to https://www.blockonomics.co/
2. Sign up for a free account
3. **IMPORTANT:** Create a store first:
   - Go to Merchants → Stores
   - Click "Create Store"
   - Give it a name (e.g., "Telegram Bot Store")
   - Save the store
4. **CRITICAL:** Add at least one wallet to your store:
   - Click on your store name
   - Click "Add BTC Wallet" (or Add USDT Wallet, etc.)
   - Follow the instructions to add the wallet
   - This is required before generating payment addresses
5. Go to Settings → API Key
6. Generate a new API key
7. Add to your `.env` file:
   ```
   BLOCKONOMICS_API_KEY=your_api_key_here
   ```

**Note:** You must:
- Create at least one store
- Add at least one wallet (BTC, USDT, etc.) to that store
- Then the API can generate payment addresses

**Note:** Blockonomics generates payment addresses but you'll need to monitor them manually or set up webhooks for automatic payment confirmation.

## Option 3: CoinPayments (Requires KYC)

**Pros:**
- ✅ Full payment processing with webhooks
- ✅ Automatic payment confirmation
- ✅ Supports many cryptocurrencies

**Cons:**
- ❌ Requires KYC verification
- ❌ More complex setup

**Setup:**
1. Go to https://www.coinpayments.net/
2. Sign up and complete KYC verification
3. Get API Key and API Secret from Account → API Keys
4. Add to your `.env` file:
   ```
   PAYMENT_API_KEY=your_public_key
   PAYMENT_API_SECRET=your_private_key
   ```

## How It Works

The bot will automatically try payment providers in this order:
1. **SHKeeper** (if `SHKEEPER_API_KEY` is set)
2. **Blockonomics** (if `BLOCKONOMICS_API_KEY` is set)
3. **CoinPayments** (if `PAYMENT_API_KEY` and `PAYMENT_API_SECRET` are set)
4. Show an error if none are configured

## Testing Without Payment Provider

For testing purposes, you can:
1. Create orders without payment (they'll be created but invoices won't generate)
2. Manually mark orders as paid in the database
3. Use test mode if your payment provider supports it

## Webhook Configuration

For automatic payment confirmation, configure webhooks:

**SHKeeper:**
- Webhooks are automatically configured when you set `WEBHOOK_URL`
- SHKeeper will send callbacks to: `{WEBHOOK_URL}/payment/shkeeper-webhook`
- SHKeeper includes the API key in the `X-Shkeeper-Api-Key` header for verification
- Make sure your SHKeeper instance can reach your webhook URL

**Blockonomics:**
- Set up webhook URL in Blockonomics dashboard
- Point to: `https://your-domain.com/payment/webhook?secret=<your_secret>`
- Generate a secure secret and add it to your `.env` file:
  ```
  WEBHOOK_SECRET=your_secure_random_secret_here
  ```

**CoinPayments:**
- Set up IPN URL in CoinPayments dashboard  
- Point to: `https://your-domain.com/payment/webhook?secret=<your_secret>`
- Use the same `WEBHOOK_SECRET` from your `.env` file

**Security Note:**
- The webhook secret ensures only authorized requests are processed
- Generate a strong random secret (at least 32 characters)
- Keep your secret secure and never commit it to version control

