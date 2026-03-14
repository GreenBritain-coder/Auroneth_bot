# Coolify Deployment Guide

This guide explains how to deploy to **Coolify** using the domain **test.greenbritain.club**.

## Domain (test.greenbritain.club)

| Service      | URL                              | Purpose              |
|-------------|-----------------------------------|----------------------|
| Front Page  | https://test.greenbritain.club     | Public bot listing   |
| Admin Panel | https://admin.test.greenbritain.club | Bot management UI |
| Bot webhook | https://bot.test.greenbritain.club   | Telegram bot API (payment callbacks, payouts) |

In Coolify, add each application and assign the corresponding domain (with SSL). For multiple bots, use e.g. `bot1.test.greenbritain.club`, `bot2.test.greenbritain.club`, or one `bot.test.greenbritain.club` if you run a single bot service.

**Env templates:** Each app has a `.env.coolify.example` in its folder (e.g. `telegram-bot-service/.env.coolify.example`) with `test.greenbritain.club` URLs—use them as a reference when setting Coolify environment variables.

## Prerequisites

- Coolify instance running
- MongoDB database (can be on same server or external)
- GitHub repository with your code

## Application Overview

You need to deploy **3 types of applications**:

1. **Front Page** - Public bot listing website (public-facing)
2. **Admin Panel** - Web UI for managing bots (authenticated users)
3. **Bot Instances** - Telegram bot services (one per bot)

## Deployment Steps

### 1. Deploy Front Page (Public Bot Listing)

**Application Name:** `front-page`

**Settings:**
- **Type:** Dockerfile or Node.js
- **Repository:** Your GitHub repo
- **Branch:** `main` (or your default branch)
- **Build Pack:** Node.js (or Dockerfile if using Dockerfile)
- **Root Directory:** `front-page`

**Environment Variables:**
```env
MONGO_URI=mongodb://your-mongo-host:27017/telegram_bot_platform
NODE_ENV=production
```

**Ports:**
- **Port:** `3001`
- **Expose Port:** `3001`

**Build Settings:**
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`

**Resources:**
- **Memory:** 256MB - 512MB
- **CPU:** 0.25 - 0.5 core

**Domain:** 
- **https://test.greenbritain.club** (public-facing website where users browse available bots)

**Purpose:**
- Shows public bot listing
- Displays only bots with `status: 'live'` and `public_listing: true`
- Featured bots appear first
- Users can click "Open Bot" to open bots in Telegram

---

### 3. Deploy Admin Panel (One Time)

**Application Name:** `admin-panel`

**Settings:**
- **Type:** Dockerfile or Node.js
- **Repository:** Your GitHub repo
- **Branch:** `main` (or your default branch)
- **Build Pack:** Node.js (or Dockerfile if using Dockerfile)
- **Dockerfile Path:** `admin-panel/Dockerfile` (if using Dockerfile)
- **Root Directory:** `admin-panel`

**Environment Variables:**
```env
MONGO_URI=mongodb://your-mongo-host:27017/telegram_bot_platform
JWT_SECRET=your-super-secret-jwt-key-change-this
NEXTAUTH_URL=https://admin.test.greenbritain.club
NODE_ENV=production
ADDRESS_ENCRYPTION_KEY=your-encryption-key-base64-encoded
PYTHON_SERVICE_URL=https://bot.test.greenbritain.club
```

**Ports:**
- **Port:** `3000`
- **Expose Port:** `3000`

**Domain:**
- **https://admin.test.greenbritain.club** (requires login; Bot Owners and Super-admins)

**Build Settings:**
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`

**Resources:**
- **Memory:** 512MB - 1GB
- **CPU:** 0.5 - 1 core

**Purpose:**
- Web UI for managing bots
- Bot Owners can edit their bot configuration
- Super-admins can manage all bots and users
- Requires login (JWT authentication)

---

### 4. Deploy Each Bot Instance (One Per Bot Owner)

For each bot you create in the admin panel, create a separate application in Coolify.

#### Bot Instance 1: `telegram-bot-service-bot1`

**Settings:**
- **Type:** Dockerfile
- **Repository:** Your GitHub repo
- **Branch:** `main`
- **Root Directory:** `telegram-bot-service`
- **Dockerfile Path:** `telegram-bot-service/Dockerfile`

**Environment Variables:**
```env
BOT_TOKEN=token_from_admin_panel_for_bot_1
MONGO_URI=mongodb://your-mongo-host:27017/telegram_bot_platform
PORT=8000
CRYPTAPI_LTC_WALLET_ADDRESS=your_litecoin_address
CRYPTAPI_BTC_WALLET_ADDRESS=your_bitcoin_address
WEBHOOK_URL=https://bot.test.greenbritain.club
# Optional: Enable specific currencies
CRYPTAPI_ENABLED_CURRENCIES=LTC,BTC
```

**Ports:**
- **Port:** `8000`
- **Expose Port:** `8000`

**Resources:**
- **Memory:** 256MB - 512MB
- **CPU:** 0.25 - 0.5 core

---

#### Bot Instance 2: `telegram-bot-service-bot2`

**Settings:**
- **Type:** Dockerfile
- **Repository:** Your GitHub repo
- **Branch:** `main`
- **Root Directory:** `telegram-bot-service`
- **Dockerfile Path:** `telegram-bot-service/Dockerfile`

**Environment Variables:**
```env
BOT_TOKEN=token_from_admin_panel_for_bot_2
MONGO_URI=mongodb://your-mongo-host:27017/telegram_bot_platform
PORT=8001
CRYPTAPI_LTC_WALLET_ADDRESS=your_litecoin_address
CRYPTAPI_BTC_WALLET_ADDRESS=your_bitcoin_address
WEBHOOK_URL=https://bot.test.greenbritain.club
CRYPTAPI_ENABLED_CURRENCIES=LTC,BTC
```

**Ports:**
- **Port:** `8001`
- **Expose Port:** `8001`

**Resources:**
- **Memory:** 256MB - 512MB
- **CPU:** 0.25 - 0.5 core

---

#### Bot Instance N: `telegram-bot-service-botN`

Repeat the same pattern with:
- Different `BOT_TOKEN` (from admin panel)
- Different `PORT` (8002, 8003, etc.)
- Same `MONGO_URI` and wallet addresses

---

## Important Notes

### 1. Port Management

Each bot instance needs a unique port. In Coolify:
- The internal port should match the `PORT` environment variable
- Coolify can expose these on different domains or use a reverse proxy
- Alternatively, use Coolify's port mapping features

### 2. MongoDB Connection

All applications (admin panel + all bot instances) share the same MongoDB database:
- Same `MONGO_URI` for all
- Each bot identifies itself by `BOT_TOKEN`
- Bot configuration is stored per-bot in the `bots` collection

### 3. Webhook URLs

For production on test.greenbritain.club:
- Set `WEBHOOK_URL=https://bot.test.greenbritain.club` (or e.g. `https://bot1.test.greenbritain.club` per bot)
- Payment callbacks (CryptAPI, Blockonomics) and payout endpoint use this base URL
- You can also set webhook URL per-bot in the admin panel (stored in database)

### 4. Environment Variables Security

In Coolify:
- Never commit `.env` files to git
- Always use Coolify's environment variables UI
- Keep `BOT_TOKEN` and `JWT_SECRET` secure
- Rotate secrets regularly

### 5. Scaling

Each bot instance:
- Can scale independently
- Low resource usage (256-512MB RAM each)
- Can handle many users per instance
- Only needs restart if environment variables change

### 6. Adding New Bots

When adding a new bot for a Bot Owner:
1. Create bot in admin panel (assign to Bot Owner)
2. Copy bot token from admin panel
3. In Coolify: Create new application
4. Use same settings as existing bot instances
5. Change only `BOT_TOKEN` and `PORT`
6. Deploy

### 7. Bot Owner Access

Bot Owners can:
- Log into admin panel
- Edit ONLY their bot configuration
- Changes save to database immediately
- Running bot instances pick up changes automatically (no restart needed)
- Cannot access other bots or super-admin features

---

## Recommended Coolify Setup

### Domain Structure (test.greenbritain.club)

```
test.greenbritain.club           → Front Page (public bot listing)
admin.test.greenbritain.club    → Admin Panel (requires login)
bot.test.greenbritain.club      → Bot service (webhook + payment callbacks)
# Optional: one subdomain per bot
bot1.test.greenbritain.club      → Bot 1 Instance
bot2.test.greenbritain.club      → Bot 2 Instance
```

In Coolify, add a new Application for each service and assign the domain; enable SSL (Let's Encrypt).

## Application Summary

| Application | Type | Port | Domain | Purpose | Auth |
|-------------|------|------|--------|---------|------|
| Front Page | Next.js | 3001 | `test.greenbritain.club` | Public bot listing | None |
| Admin Panel | Next.js | 3000 | `admin.test.greenbritain.club` | Bot management UI | Required |
| Bot Instance 1 | Python | 8000 | `bot.test.greenbritain.club` (or `bot1.…`) | Telegram bot service | None (webhook) |
| Bot Instance 2 | Python | 8001 | `bot2.test.greenbritain.club` (optional) | Telegram bot service | None (webhook) |

---

## Troubleshooting

### Bot not starting
- Check `BOT_TOKEN` matches token in admin panel
- Verify MongoDB connection
- Check logs in Coolify

### Changes not appearing
- Most changes appear immediately (read from database)
- Some changes need restart (check bot logs)
- Verify database connection

### Port conflicts
- Ensure each bot has unique `PORT` in environment variables
- Check Coolify port mappings

### Webhook not working
- Verify `WEBHOOK_URL` is publicly accessible
- Check firewall rules in Coolify
- Test webhook endpoint manually

---

## Quick Setup Checklist

- [ ] Front Page deployed and accessible (public bot listing)
- [ ] Admin Panel deployed and accessible (requires login)
- [ ] MongoDB database accessible from all applications
- [ ] Bot 1 created in admin panel
- [ ] Bot 1 instance deployed in Coolify with correct `BOT_TOKEN`
- [ ] Bot 1 is running and responding in Telegram
- [ ] Bot 1 appears on front page (if `public_listing: true`)
- [ ] Bot Owner can log into admin panel
- [ ] Bot Owner can edit their bot configuration
- [ ] Changes appear in bot immediately
- [ ] Front page updates when bots are added/modified

Repeat for each additional bot instance.

## Complete Deployment Architecture

```
Coolify Server (test.greenbritain.club)
│
├── Front Page (Next.js)
│   ├── Port: 3001
│   ├── Domain: test.greenbritain.club
│   ├── Purpose: Public bot listing
│   └── MongoDB: Reads bots with public_listing=true
│
├── Admin Panel (Next.js)
│   ├── Port: 3000
│   ├── Domain: admin.test.greenbritain.club
│   ├── Purpose: Bot management UI
│   ├── Auth: Required (JWT)
│   └── MongoDB: Full access (filtered by user role)
│
├── Bot Instance 1 (Python)
│   ├── Port: 8000
│   ├── Domain: bot.test.greenbritain.club (webhooks, payouts)
│   ├── Purpose: Telegram bot service
│   ├── BOT_TOKEN: token_for_bot_1
│   └── MongoDB: Reads bot config by token
│
├── Bot Instance 2 (Python, optional)
│   ├── Port: 8001
│   ├── BOT_TOKEN: token_for_bot_2
│   └── MongoDB: Reads bot config by token
│
└── MongoDB (shared)
    ├── bots collection (all bot configs)
    ├── products collection
    ├── orders collection
    ├── invoices collection
    └── users collection
```

All applications share the same MongoDB database, allowing:
- Front page to show live bots
- Admin panel to manage all data
- Bot instances to read their configuration
- Real-time updates across all services
