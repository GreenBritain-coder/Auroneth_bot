# Local Testing Guide

This guide will help you test all three services locally on your machine.

## Prerequisites

1. **MongoDB** - Install locally or use MongoDB Atlas (free cloud tier)
   - Local: Download from https://www.mongodb.com/try/download/community
   - Cloud: Sign up at https://www.mongodb.com/cloud/atlas (free tier available)

2. **Node.js 20+** - For admin-panel and front-page
   - Download: https://nodejs.org/

3. **Python 3.11+** - For telegram-bot-service
   - Download: https://www.python.org/downloads/

4. **Telegram Bot Token** - Get from @BotFather on Telegram
   - Message @BotFather on Telegram
   - Send `/newbot` and follow instructions
   - Save the token (format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

5. **CoinPayments Account** (optional for testing payments)
   - Sign up at https://www.coinpayments.net/
   - Get API key and secret (or use test mode)

## Step-by-Step Local Testing

### Step 1: Start MongoDB

**If using local MongoDB:**
```bash
# On macOS/Linux
mongod

# On Windows
# Start MongoDB service from Services or run:
"C:\Program Files\MongoDB\Server\7.0\bin\mongod.exe"
```

**If using MongoDB Atlas:**
- Create a cluster and get connection string
- Format: `mongodb+srv://username:password@cluster.mongodb.net/telegram_bot_platform`

### Step 2: Set Up Admin Panel

Open a terminal:

```bash
cd admin-panel
npm install
```

Create `.env` file:
```bash
cp .env.example .env
```

Edit `.env`:
```env
MONGO_URI=mongodb://localhost:27017/telegram_bot_platform
# OR for MongoDB Atlas:
# MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/telegram_bot_platform
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
NEXTAUTH_URL=http://localhost:3000
NODE_ENV=development
```

Create admin user:
```bash
npm run create-admin admin admin123
```

Start admin panel:
```bash
npm run dev
```

Admin panel will be at: **http://localhost:3000**

Login with:
- Username: `admin`
- Password: `admin123`

### Step 3: Set Up Front Page

Open a **new terminal**:

```bash
cd front-page
npm install
```

Create `.env` file:
```bash
cp .env.example .env
```

Edit `.env`:
```env
MONGO_URI=mongodb://localhost:27017/telegram_bot_platform
# OR same as admin-panel if using Atlas
NODE_ENV=development
```

Start front page:
```bash
npm run dev
```

Front page will be at: **http://localhost:3001** (or next available port)

### Step 4: Set Up Telegram Bot Service

Open a **new terminal**:

```bash
cd telegram-bot-service

# Create virtual environment (recommended)
python -m venv venv

# Activate virtual environment
# On macOS/Linux:
source venv/bin/activate
# On Windows:
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

Create `.env` file:
```bash
# On macOS/Linux
cp .env.example .env

# On Windows
copy .env.example .env
```

Edit `.env`:
```env
BOT_TOKEN=your_bot_token_from_botfather
MONGO_URI=mongodb://localhost:27017/telegram_bot_platform
# OR same MongoDB URI as above

# CoinPayments (optional for testing)
PAYMENT_API_KEY=your_coinpayments_api_key
PAYMENT_API_SECRET=your_coinpayments_api_secret
WEBHOOK_URL=http://localhost:8000
WEBHOOK_SECRET=your_webhook_secret
COMMISSION_RATE=0.02
```

Start bot (polling mode for local testing):
```bash
python main.py
```

The bot will run in polling mode (no webhook needed for local testing).

### Step 5: Test the System

#### 5.1 Create a Bot via Admin Panel

1. Go to http://localhost:3000
2. Login with admin credentials
3. Go to **Bots** → **Add New Bot**
4. Fill in:
   - **Bot Name**: My Test Bot
   - **Bot Token**: Your token from @BotFather
   - **Description**: Testing bot
   - **Main Menu Buttons**: `Shop, Support, Promotions`
   - **Welcome Message**: `Welcome! Your secret phrase: {{secret_phrase}}`
   - **Thank You Message**: `Thank you for your purchase!`
5. Click **Create Bot**

#### 5.2 Create a Product

1. Go to **Products** → **Add New Product**
2. Fill in:
   - **Product Name**: Test Product
   - **Price**: 0.001
   - **Currency**: BTC
   - **Description**: This is a test product
   - **Image URL**: (optional) Any image URL
   - **Assign to Bots**: Select your bot
3. Click **Create Product**

#### 5.3 Configure Inline Buttons (via API or Database)

For now, inline buttons need to be set manually. You can:

**Option A: Use MongoDB directly**
```javascript
// Connect to MongoDB and run:
db.bots.updateOne(
  { name: "My Test Bot" },
  { 
    $set: { 
      "inline_buttons": {
        "PRODUCT_ID_HERE": [
          { "text": "Buy", "action": "buy" },
          { "text": "More Info", "action": "info" }
        ]
      }
    }
  }
)
```

**Option B: Use API (via curl or Postman)**
```bash
# Get your bot ID from admin panel, then:
curl -X PATCH http://localhost:3000/api/bots/YOUR_BOT_ID \
  -H "Content-Type: application/json" \
  -H "Cookie: admin_token=YOUR_TOKEN" \
  -d '{
    "inline_buttons": {
      "PRODUCT_ID": [
        {"text": "Buy", "action": "buy"},
        {"text": "More Info", "action": "info"}
      ]
    }
  }'
```

#### 5.4 Test the Bot on Telegram

1. Open Telegram and search for your bot (use the username you set with @BotFather)
2. Send `/start` command
3. You should see:
   - Welcome message with secret phrase
   - Main menu buttons (Shop, Support, Promotions)
4. Click **Shop** button
5. You should see your product with inline buttons
6. Click **More Info** to see product details
7. Click **Buy** to test payment flow (if CoinPayments configured)

#### 5.5 Test Secret Phrase System

1. Note the secret phrase shown when you send `/start`
2. Create a second bot in admin panel (or use existing)
3. Send `/start` to the second bot
4. **You should see the SAME secret phrase** ✅

#### 5.6 Check Front Page

1. Go to http://localhost:3001
2. You should see:
   - Hero section
   - Your bot listed (if `public_listing: true`)
   - "Open Bot" button

#### 5.7 Check Orders (after payment)

1. Go to Admin Panel → **Orders**
2. You should see orders listed after users make purchases
3. Commission should be calculated automatically

## Testing Checklist

- [ ] MongoDB is running
- [ ] Admin panel accessible at http://localhost:3000
- [ ] Can login to admin panel
- [ ] Can create a bot
- [ ] Can create a product
- [ ] Front page accessible at http://localhost:3001
- [ ] Bot responds to `/start` command
- [ ] Secret phrase appears in welcome message
- [ ] Main menu buttons work
- [ ] Products display with inline buttons
- [ ] Same secret phrase appears on multiple bots
- [ ] Orders appear in admin panel (after purchase)
- [ ] Commission calculated correctly

## Troubleshooting

### Bot not responding
- Check bot token is correct
- Verify MongoDB connection (check bot logs)
- Ensure bot is running (`python main.py`)
- Check bot status in admin panel (should be "live")

### Admin panel login fails
- Ensure admin user exists: `npm run create-admin admin admin123`
- Check MongoDB connection
- Verify JWT_SECRET is set in `.env`

### Products not showing
- Verify product is assigned to bot in admin panel
- Check bot's `products` array includes product ID
- Verify inline_buttons are configured for product

### Front page shows no bots
- Check bot has `status: "live"` and `public_listing: true`
- Verify MongoDB connection
- Check browser console for errors

### MongoDB connection errors
- Verify MongoDB is running
- Check connection string format
- Ensure database name is correct
- For Atlas: Check IP whitelist and credentials

### Payment webhook not working (local)
- Webhooks require public URL (use ngrok for local testing)
- Or test payment flow without webhook (manual confirmation)
- For production, use proper webhook URL

## Quick Start Script (Optional)

Create a `start-all.sh` script:

```bash
#!/bin/bash

# Start MongoDB (if local)
# mongod &

# Start admin panel
cd admin-panel && npm run dev &

# Start front page
cd ../front-page && npm run dev &

# Start bot
cd ../telegram-bot-service && python main.py
```

Make it executable:
```bash
chmod +x start-all.sh
```

Run:
```bash
./start-all.sh
```

## Next Steps

Once local testing works:
1. Test payment flow with CoinPayments
2. Deploy to Coolify/VPS
3. Configure production environment variables
4. Set up proper webhook URLs
5. Test end-to-end in production

Happy testing! 🚀

