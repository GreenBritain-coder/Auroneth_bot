# Telegram Bot Platform MVP - Setup Guide

## Overview

This project consists of three separate repositories:
1. **telegram-bot-service** - Python/aiogram bot service
2. **admin-panel** - Next.js admin dashboard
3. **front-page** - Next.js public bot listing page

All three services connect to the same MongoDB database.

## Prerequisites

- MongoDB (local or cloud instance)
- Node.js 20+ (for admin-panel and front-page)
- Python 3.11+ (for telegram-bot-service)
- Docker and Coolify (for deployment)
- CoinPayments account (for crypto payments)

## Initial Setup

### 1. MongoDB Setup

Create a MongoDB database (local or cloud):
```
mongodb://localhost:27017/telegram_bot_platform
```

Or use MongoDB Atlas:
```
mongodb+srv://username:password@cluster.mongodb.net/telegram_bot_platform
```

### 2. Admin Panel Setup

```bash
cd admin-panel
npm install
cp .env.example .env
# Edit .env with your MongoDB URI and JWT_SECRET
```

Create initial admin user:
```bash
npm run create-admin <username> <password>
```

Run development server:
```bash
npm run dev
```

Admin panel will be available at `http://localhost:3000`

### 3. Telegram Bot Service Setup

```bash
cd telegram-bot-service
pip install -r requirements.txt
cp .env.example .env
# Edit .env with:
# - BOT_TOKEN (from @BotFather)
# - MONGO_URI
# - PAYMENT_API_KEY and PAYMENT_API_SECRET (from CoinPayments)
# - WEBHOOK_URL (for production)
```

Run the bot:
```bash
python main.py
```

### 4. Front Page Setup

```bash
cd front-page
npm install
cp .env.example .env
# Edit .env with your MongoDB URI
npm run dev
```

Front page will be available at `http://localhost:3000`

## CoinPayments Configuration

1. Register at CoinPayments.net
2. Get API Key and API Secret
3. Configure webhook URL in CoinPayments dashboard:
   - Point to: `https://your-domain.com/webhook/payment/webhook`
4. Add API credentials to telegram-bot-service `.env`

## Deployment with Coolify

### 1. MongoDB Service

Deploy MongoDB container or connect to managed MongoDB instance.

### 2. Telegram Bot Service

1. Create new service in Coolify
2. Connect to repository: `telegram-bot-service`
3. Set environment variables from `.env.example`
4. Deploy

### 3. Admin Panel

1. Create new service in Coolify
2. Connect to repository: `admin-panel`
3. Set environment variables:
   - `MONGO_URI`
   - `JWT_SECRET` (generate a secure random string)
   - `NEXTAUTH_URL` (your admin panel URL)
4. Build and deploy

### 4. Front Page

1. Create new service in Coolify
2. Connect to repository: `front-page`
3. Set environment variables:
   - `MONGO_URI`
4. Build and deploy

## First Steps After Deployment

1. **Create Admin User**
   - SSH into admin-panel container or run locally:
   ```bash
   npm run create-admin admin yourpassword
   ```

2. **Create Your First Bot**
   - Log into admin panel
   - Go to Bots → Add New Bot
   - Enter bot token from @BotFather
   - Configure main buttons, messages, etc.

3. **Create Products**
   - Go to Products → Add New Product
   - Set price in BTC or LTC
   - Assign to bots

4. **Configure Inline Buttons**
   - Edit bot
   - Configure inline buttons for each product (e.g., "Buy", "More Info")

5. **Test Bot**
   - Start your bot on Telegram
   - User should see secret phrase on /start
   - Test product purchase flow

## Testing Checklist

- [ ] Secret phrase appears on /start for new users
- [ ] Same secret phrase appears when user starts different bots
- [ ] Main menu buttons work dynamically
- [ ] Products display with inline buttons
- [ ] Payment invoice generation works
- [ ] Webhook confirms payment and updates order
- [ ] Commission is calculated and recorded
- [ ] Admin panel CRUD operations work
- [ ] Front page shows only public bots
- [ ] "Open Bot" links work correctly

## Troubleshooting

### Bot not responding
- Check BOT_TOKEN is correct
- Verify MongoDB connection
- Check bot logs for errors

### Payment webhook not working
- Verify WEBHOOK_URL is accessible
- Check CoinPayments webhook configuration
- Verify webhook signature verification

### Admin panel login fails
- Ensure admin user exists (run create-admin script)
- Check JWT_SECRET is set
- Verify MongoDB connection

### Front page shows no bots
- Check bots have `status: "live"` and `public_listing: true`
- Verify MongoDB connection
- Check API route logs

## Support

For issues or questions, check the logs in each service and verify all environment variables are set correctly.

