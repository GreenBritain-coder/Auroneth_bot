# Coolify Deployment Guide

This guide explains how to deploy to **Coolify** using the domain **test.greenbritain.club**.

---

## Quick instructions (Coolify UI)

**Repo:** `https://github.com/GreenBritain-coder/Auroneth_bot`  
**Domains:** `test.greenbritain.club` | `admin.test.greenbritain.club` | `bot.test.greenbritain.club`

### Before you start

- Have **MongoDB** running (same server or external). Note the connection string (e.g. `mongodb://user:pass@host:27017/telegram_bot_platform`).
- Create **one bot** in Telegram via @BotFather and copy the token (you’ll add it to the bot service later).
- Decide a **JWT secret** for the admin panel (long random string) and an **address encryption key** (base64). Generate encryption key: `telegram-bot-service/scripts/generate_encryption_key.py` or any base64-encoded 32-byte value.

### Deployment finished but fixes didn't work?

→ See **"New changes not showing after deploy"** below. Use **Force Deploy (without cache)** on front-page, admin-panel, and telegram-bot-service, then hard refresh your browser.

---

### 404 "Page not found"?

- **If you only deployed the front-page:**  
  - **https://test.greenbritain.club** should show the public bot listing. If you see 404 there, check in Coolify that the domain `test.greenbritain.club` is assigned to the **front-page** application and that the deployment is running (not Exited).
  - **https://admin.test.greenbritain.club** and **https://bot.test.greenbritain.club** will 404 until you deploy the **admin-panel** and **telegram-bot-service** apps and assign those domains to them.
- **If the main domain (test.greenbritain.club) still 404s:** In Coolify → your front-page app → **Configuration** → **Domains**: ensure `test.greenbritain.club` is added and saved, then redeploy. Check **Deployments** / **Logs** to confirm the container started and is listening on port 3000.

### "Decryption failed: The encryption key does not match"

This happens when `ADDRESS_ENCRYPTION_KEY` differs between **telegram-bot-service** (encrypts) and **admin-panel** (decrypts). They must be **identical**.

**Fix in Coolify:**
1. Pick one key (e.g. your local key from `telegram-bot-service/.env`).
2. Set it in **both** apps:
   - **admin-panel** → Configuration → Environment Variables → `ADDRESS_ENCRYPTION_KEY`
   - **telegram-bot-service** → Configuration → Environment Variables → `ADDRESS_ENCRYPTION_KEY`
3. Use the **exact same value** in both (including any trailing `=`).
4. **Redeploy** both apps after changing env vars.

Example (use your actual key):
```
ADDRESS_ENCRYPTION_KEY=pPELJJX8LjZwWK-FVmIyb8j4sLlh5BvCr3Yf9WaA088=
```

**Note:** Orders encrypted with the old key cannot be decrypted after you change keys.

---

### "No available server" (proxy error)

This message comes from **Coolify’s reverse proxy**, not from the app. It means the proxy has a route for your domain but **no running container** to send traffic to.

1. **Check container status** — Coolify → your app (e.g. front-page) → **Deployments** or **Logs**. If the container is **Exited** or **Restarting**, the proxy will show "no available server".
2. **Fix an Exited container** — Open **Logs** to see why it stopped (e.g. missing `MONGO_URI`, crash on startup). In **Configuration** → **Environment Variables**, set at least `MONGO_URI` (and `NODE_ENV=production` if needed). Save, then click **Deploy** to redeploy.
3. **Check port** — The front-page Dockerfile exposes **3000**. In the app’s Coolify configuration, **Ports Exposes** (or Port) must be **3000** so the proxy forwards correctly.
4. **Redeploy** — After changing env or port, click **Deploy** and wait until the new container is **Running**, then reload the site.

### Deployment failed (exit code 255, RuntimeException)

**If the build fails with "Command execution failed (exit code 255)" or "RuntimeException" in ExecuteRemoteCommand:**

1. **NODE_ENV at build time** — Coolify injects `NODE_ENV=production` as a build arg. That can skip devDependencies (TypeScript, etc.) and break the Next.js build. The admin-panel Dockerfile now forces `NODE_ENV=development` during install/build. If it still fails, in Coolify → admin-panel → **Configuration** → **Environment Variables** → set `NODE_ENV` to **Runtime only** (uncheck "Available at Buildtime").

2. **Build timeout** — Next.js builds can take 3–5+ minutes. If Coolify or your server has a short timeout, the build may be killed. Try deploying again; transient timeouts often succeed on retry.

3. **Memory** — Next.js build needs ~1–2GB RAM. If the deployment server is low on memory, the build can be killed. Check server resources.

4. **Retry** — Click **Redeploy**. Many deployment failures are transient (network, timeout).

---

### New changes not showing after deploy (e.g. dynamic sales/rating, Orders table scroll, UI fixes)

**If you pushed fixes to GitHub and redeployed but the live site still shows the old version:**

1. **Force deploy without cache** — For **each** app (front-page, admin-panel):
   - Coolify → app → **Deploy** → **Advanced** → **"Force Deploy (without cache)"**
   - Or: **Configuration** → **Advanced** → enable **"Disabled Build Cache"** → Deploy
   - This runs `docker build --no-cache` so cached layers are not reused.

2. **Redeploy all three apps** — The fixes affect multiple services:
   - **front-page** (test.greenbritain.club): dynamic SALES and RATING
   - **admin-panel** (admin.test.greenbritain.club): Orders table horizontal scroll
   - **telegram-bot-service** (bot.test.greenbritain.club): Contact button, bottom menu

3. **Verify the correct branch** — In **Source** settings, ensure each app pulls from `main` (or your deployment branch).

4. **Check deployment logs** — After deploy, open **Deployments** → latest run → **Logs**. Confirm it cloned the latest commit from GitHub (check the commit hash matches your push).

5. **Hard refresh the browser** — After a successful deploy, press `Ctrl+Shift+R` (or `Cmd+Shift+R` on Mac) or use an incognito/private window to bypass cache.

**If SALES still shows 0+ and RATING shows N/A after force deploy:**
- Ensure **front-page** has `MONGO_URI` set to the same MongoDB as admin-panel and bot service.
- For RATING: set **rating** and **rating_count** in Admin Panel → Bots → Edit Bot (e.g. "96.81" and "7707").

---

### 1. Front Page (test.greenbritain.club)

1. In Coolify: **Project** → **+ Add Resource** → **Application**.
2. **Name:** `front-page`.
3. **Source:** GitHub → connect repo `GreenBritain-coder/Auroneth_bot`, branch `main`.
4. **Build:**
   - **Build Pack:** Dockerfile.
   - **Base Directory:** `front-page`. **Dockerfile Path:** `Dockerfile` (relative to base).
   - If your Coolify expects “root directory” for the app: set **Base Directory** to `front-page` so the build context is that folder.
5. **Ports:** Expose port **3000** (Dockerfile exposes 3000).
6. **Environment Variables:** Add:
   - `MONGO_URI` = your MongoDB connection string  
   - `NODE_ENV` = `production`
7. **Domains:** Add domain `test.greenbritain.club`, enable **SSL** (Let’s Encrypt).
8. **Deploy.**

---

### 2. Admin Panel (admin.test.greenbritain.club)

1. **+ Add Resource** → **Application**.
2. **Name:** `admin-panel`.
3. **Source:** Same repo, branch `main`.
4. **Build:**
   - **Build Pack:** Dockerfile.
   - **Base Directory:** `admin-panel` (build context must be this folder).
   - **Dockerfile Path:** `Dockerfile` (relative to base).
5. **Ports:** Expose **3000**.
6. **Environment Variables:**
   - `MONGO_URI` = your MongoDB connection string  
   - `JWT_SECRET` = your long random secret  
   - `NEXTAUTH_URL` = `https://admin.test.greenbritain.club`  
   - `NODE_ENV` = `production`  
   - `ADDRESS_ENCRYPTION_KEY` = your base64 encryption key (same as bot service)  
   - `PYTHON_SERVICE_URL` = `https://bot.test.greenbritain.club`  
   - Optional: `AUTO_APPROVE_PAYOUTS` = `true`, `AUTO_PROCESS_PAYOUTS` = `true`
7. **Domains:** `admin.test.greenbritain.club` + SSL.
8. **Deploy.**

**Create admin user (first time):** Open Coolify → admin-panel deployment → **Terminal**, then run (the container has the script and uses the same `MONGO_URI` as the app):

```bash
node scripts/create-admin.js admin Admin123! super-admin
```

If Coolify doesn’t give you a shell, run that from your machine with `MONGO_URI` pointing to your DB so the user is created in the same MongoDB.

---

### 3. Bot service (bot.test.greenbritain.club)

1. **+ Add Resource** → **Application**.
2. **Name:** `telegram-bot-service` (or `bot`).
3. **Source:** Same repo, branch `main`.
4. **Build:**
   - **Build Pack:** Dockerfile.
   - **Base Directory:** `telegram-bot-service` (build context must be this folder).
   - **Dockerfile Path:** `Dockerfile` (relative to base).
5. **Ports:** Expose **8000**.
6. **Environment Variables:**
   - `BOT_TOKEN` = token from @BotFather  
   - `MONGO_URI` = same MongoDB connection string  
   - `PORT` = `8000`  
   - `WEBHOOK_URL` = `https://bot.test.greenbritain.club`  
   - `CRYPTAPI_BTC_WALLET_ADDRESS` = your BTC address (payments forward here)  
   - `CRYPTAPI_LTC_WALLET_ADDRESS` = your LTC address  
   - `CRYPTAPI_ENABLED_CURRENCIES` = `BTC,LTC`  
   - `ADDRESS_ENCRYPTION_KEY` = same base64 key as admin panel
7. **Domains:** `bot.test.greenbritain.club` + SSL.
8. **Deploy.**

After deploy, the bot will listen on 8000; Coolify will route `https://bot.test.greenbritain.club` to this container. Set your bot’s webhook to `https://bot.test.greenbritain.club/webhook` (or whatever path your main.py uses for Telegram).

---

### 4. Multiple bots (optional)

For a second bot, add another Application:

- Same repo, **Base Directory** `telegram-bot-service`, same Dockerfile.
- Different **name** (e.g. `telegram-bot-service-bot2`).
- **Port:** 8001 (and set `PORT=8001` in env).
- **Domain:** e.g. `bot2.test.greenbritain.club`.
- **Env:** Same as above but `BOT_TOKEN` = second bot’s token.

---

### 5. Checklist

- [ ] MongoDB reachable from all three apps (check firewall / Coolify network).
- [ ] Front page: https://test.greenbritain.club loads.
- [ ] Admin: https://admin.test.greenbritain.club loads; you can log in.
- [ ] Bot: https://bot.test.greenbritain.club is reachable (e.g. returns 404 or health); Telegram webhook set.
- [ ] In Admin, create a bot and assign the same token; ensure **Webhook URL** in bot config is `https://bot.test.greenbritain.club` (no trailing slash unless your app expects it).
- [ ] CryptAPI/Blockonomics webhook URL (if used) points to `https://bot.test.greenbritain.club` and the path your app uses for callbacks.

---

### 6. Migrate local data to Coolify MongoDB

If you have data in your local MongoDB (`mongodb://localhost:27017/telegram_bot_platform`) and want to move it to the Coolify database, use `mongodump` and `mongorestore`.

**Prerequisites:** Install [MongoDB Database Tools](https://www.mongodb.com/docs/database-tools/installation/installation/) (includes `mongodump` and `mongorestore`).

**Step 1 – Dump from local**

```bash
mongodump --uri="mongodb://localhost:27017/telegram_bot_platform" --out=./mongo-backup
```

This creates a `./mongo-backup/telegram_bot_platform` folder with all collections (bots, categories, subcategories, products, orders, invoices, users, admins, etc.).

**Step 2 – Restore to Coolify MongoDB**

Replace `YOUR_PASSWORD` and `YOUR_HOST` with your Coolify MongoDB credentials and host (e.g. `thj2moj8ktvpq0cr7wupi88q` or your server IP):

```bash
mongorestore --uri="mongodb://root:YOUR_PASSWORD@YOUR_HOST:27017/telegram_bot_platform?authSource=admin&directConnection=true" ./mongo-backup/telegram_bot_platform
```

**Network access:** The Coolify MongoDB must accept connections from your machine. If it’s on the same server as Coolify:

- Use the server’s IP or hostname.
- Ensure port 27017 is open in the firewall (or use an SSH tunnel).

**SSH tunnel (if MongoDB is not directly reachable):**

```bash
# In one terminal, create tunnel (replace USER, SERVER, LOCAL_PORT)
ssh -L 27018:localhost:27017 USER@YOUR_SERVER

# In another terminal, restore via localhost
mongorestore --uri="mongodb://root:YOUR_PASSWORD@localhost:27018/telegram_bot_platform?authSource=admin" ./mongo-backup/telegram_bot_platform
```

**Alternative: Export + Import API (when MongoDB port is not reachable)**

If you cannot reach MongoDB directly (firewall, internal Docker hostname), use the export/import flow:

1. **Export locally:**
   ```bash
   cd telegram-bot-service
   python scripts/export_mongo_to_json.py --output mongo_export.json
   ```

2. **Redeploy admin-panel** in Coolify (to get the `/api/migrate-import` endpoint).

3. **Import via API** (replace `YOUR_JWT_SECRET` with your Coolify admin panel `JWT_SECRET`):
   ```powershell
   cd telegram-bot-service
   Invoke-RestMethod -Uri "https://admin.test.greenbritain.club/api/migrate-import" -Method POST -Headers @{"x-migrate-secret"="YOUR_JWT_SECRET"; "Content-Type"="application/json"} -Body (Get-Content mongo_export.json -Raw -Encoding UTF8)
   ```

**Important:** All three apps (front-page, admin-panel, telegram-bot-service) must use the **exact same** `MONGO_URI` in Coolify. If the front-page or admin panel use a different database, they will show different data.

**After migration:**

- Your migrated admin user can log in at `https://admin.test.greenbritain.club` with the same username/password.
- Bots, products, categories, orders, etc. will be available in the admin panel and to the bot service.
- If the Coolify DB already had data, `mongorestore` will merge/overwrite by default; use `--drop` to replace the database entirely (destructive):

  ```bash
  mongorestore --uri="..." --drop ./mongo-backup/telegram_bot_platform
  ```

---

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
