# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Running the Project

**Docker (recommended — all services):**
```bash
docker-compose up -d
```

**Locally (each service in its own terminal):**
```bash
# Telegram bot
cd telegram-bot-service
pip install -r requirements.txt
python main.py

# Admin panel (Next.js)
cd admin-panel
npm install
npm run dev   # http://localhost:3000

# Front page (Next.js)
cd front-page
npm install
npm run dev   # http://localhost:3001
```

**Test scripts (run directly):**
```bash
python telegram-bot-service/test_env.py
python telegram-bot-service/test_webhook.py
python telegram-bot-service/test_decrypt.py
```

---

## Architecture Overview

Three independently deployed services share a single MongoDB database (`telegram_bot_platform`).

### `telegram-bot-service/` — Python 3.12 / aiogram 3
Main Telegram bot. Uses `motor` for async MongoDB access. Key subdirectories:
- `handlers/` — aiogram routers: `start`, `menu`, `catalog`, `product`, `cart`, `checkout`, `payments`, `orders`, `payouts`, `contact`, `shop`
- `services/` — business logic: `shkeeper.py`, `commission.py`, `order_state_machine.py`, `order_scheduler.py`, `payout_scheduler.py`, payment provider adapters (`blockonomics`, `coinpayments`, `cryptapi`)
- `database/` — `connection.py` (motor client), `models.py` (collection helpers), `addresses.py` (crypto address pool)
- `utils/` — shared helpers: `address_encryption.py`, `currency_converter.py`, `qr_generator.py`, `navigation.py`, `shop_helpers.py`
- `api/web_bridge.py` — lightweight HTTP bridge for admin→bot communication

### `admin-panel/` — Next.js 14 / TypeScript
Vendor and super-admin web UI at `admin.auroneth.info`. App Router (`app/`). Key routes:
- `app/login/` — JWT-based auth
- `app/admin/` — super-admin dashboard (vendors, commissions, payouts)
- `app/setup/` — onboarding flow
- `app/api/` — REST API routes consumed by the UI
- `lib/` — shared DB client, auth helpers, API utilities
- `middleware.ts` — JWT verification on protected routes

### `front-page/` — Next.js 14 / TypeScript
Public marketing site at `auroneth.info`. App Router (`app/`). Key routes:
- `app/page.tsx` — landing page
- `app/shop/` — public shop listing

---

## Key Files

| File | Purpose |
|------|---------|
| `telegram-bot-service/main.py` | Bot entry point — registers routers, starts polling/webhook |
| `telegram-bot-service/services/shkeeper.py` | SHKeeper payment integration |
| `telegram-bot-service/services/commission.py` | Platform commission calculation |
| `telegram-bot-service/services/order_state_machine.py` | Order lifecycle (pending → paid → fulfilled) |
| `telegram-bot-service/database/connection.py` | Motor async MongoDB client |
| `telegram-bot-service/database/models.py` | Collection accessors |
| `admin-panel/middleware.ts` | JWT auth guard |
| `database/schema.sql` | Reference schema (not used at runtime — MongoDB is primary) |
| `scripts/sync_products_from_store.py` | Sync products from vendor store |
| `scripts/deploy-vendor.sh` | Vendor deployment helper |

---

## Database Access (mongosh)

MongoDB container on the Coolify server: `thj2moj8ktvpq0cr7wupi88q`
Database name: `telegram_bot_platform`

Connection string is in `.env` as `MONGO_URI`. For direct access:
```bash
mongosh "$MONGO_URI" --quiet --eval "<your query>"
```

### Key Collections

| Collection | Purpose |
|-----------|---------|
| `vendors` | Vendor accounts and config |
| `products` | Product catalog (per vendor) |
| `orders` | Order records and state |
| `payments` | Payment invoices and status |
| `users` | Telegram user profiles (`last_seen` tracked in LoggingMiddleware) |
| `addresses` | Crypto address pool (encrypted) |
| `payouts` | Vendor payout records |
| `commissions` | Platform commission ledger |

### Example Queries
```javascript
// Count vendors
db.vendors.countDocuments()

// Recent orders
db.orders.find().sort({created_at: -1}).limit(10)

// Pending payments
db.payments.find({status: "pending"}).count()

// Active users (last 7 days)
db.users.countDocuments({last_seen: {$gte: new Date(Date.now() - 7*24*60*60*1000)}})
```

---

## Environment Variables

All secrets come from `.env` locally or Coolify UI in production. Key vars:

| Variable | Purpose |
|----------|---------|
| `BOT_TOKEN` | Telegram bot token |
| `MONGO_URI` | MongoDB connection string |
| `SHKEEPER_API_URL` | SHKeeper instance URL (https://shkeeper.greenbritain.club) |
| `SHKEEPER_API_KEY` | SHKeeper API key |
| `JWT_SECRET` | Admin panel JWT signing key |
| `COMMISSION_RATE` | Platform commission percentage |
| `ADDRESS_ENCRYPTION_KEY` | Fernet key for crypto address encryption |
| `WEBHOOK_URL` | Telegram webhook endpoint (production) |

---

## Deployment

Deployed via **Coolify** on `111.90.140.72`. Three containers, one per service.

```bash
git push origin main   # Coolify auto-deploys all services
```

Each service has its own `Dockerfile`. No deploy script needed.

**SHKeeper admin:** https://shkeeper.greenbritain.club
**Domains:** `auroneth.info` (front page), `admin.auroneth.info` (admin panel)

---

## Conventions

- **Never refer to the admin by name** in generated UI strings — use "Admin" or "You".
- **Crypto addresses are always encrypted at rest** using Fernet (`ADDRESS_ENCRYPTION_KEY`). Never store plaintext addresses in MongoDB.
- The `database/schema.sql` is a reference document only — the application uses MongoDB, not SQL.
- One-off operational scripts live in `scripts/` and `telegram-bot-service/scripts/` — run directly with `python <script>.py`.
- For payment provider changes, update `services/payment_provider.py` (abstract interface) before touching individual adapters.

---

## Changelog

At the end of each working session, offer to write a changelog summary to `changelog.json` (same format as GreenBotRemover — `"category": "summary"`, `"hash": "summary-YYYY-MM-DD"`).
