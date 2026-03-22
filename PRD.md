# Auroneth Platform -- Product Requirements Document

**Last updated:** March 22, 2026

---

## 1. Overview

Auroneth is a multi-vendor Telegram bot marketplace platform. It enables vendors to run self-service shops via individual Telegram bots, backed by a shared admin panel and an optional public web shop. The platform handles product catalog management, crypto payment processing, order lifecycle management, customer communication, and automated vendor payouts -- all with a focus on privacy and security.

Each vendor gets their own Telegram bot instance, deployed as an isolated container, while sharing a common MongoDB database, admin dashboard, and payment infrastructure.

---

## 2. Architecture

### 2.1 Services

| Service | Tech Stack | Port | Description |
|---|---|---|---|
| `telegram-bot-service` | Python 3.12, aiogram 3, aiohttp | 8000 | Telegram bot (one container per vendor) |
| `admin-panel` | Next.js 14, TypeScript, Tailwind CSS | 3000 | Admin dashboard for vendor/platform management |
| `front-page` | Next.js 14, TypeScript, Tailwind CSS | 3000 | Public landing page + web shop |

### 2.2 Infrastructure

- **Database:** MongoDB (single shared instance) with Motor (async) driver in Python and Mongoose in Node.js
- **Payments (primary):** SHKeeper -- self-hosted cryptocurrency payment processor supporting BTC, LTC, USDT, ETH, DOGE, XMR, TRX, BNB
- **Payments (fallback):** CryptAPI -- no-KYC payment gateway generating temporary forwarding addresses
- **Deployment:** Coolify (self-hosted PaaS) on a dedicated server at `111.90.140.72`
- **DNS:** Cloudflare (zone: `auroneth.info`), proxied A records
- **Containers:** Each service has its own Dockerfile; no docker-compose (Coolify manages orchestration)
- **Git:** GitHub (`GreenBritain-coder/Auroneth_bot`), `main` branch

### 2.3 Communication Between Services

- The `front-page` web shop communicates with `telegram-bot-service` via a **Web Bridge API** (`/api/web/{bot_id}/...`), authenticated with an `X-Bridge-Key` header. This keeps SHKeeper credentials isolated within the Python service.
- The `admin-panel` communicates directly with MongoDB and also calls Coolify/Cloudflare APIs for vendor deployment.

---

## 3. Features -- Telegram Bot Service

### 3.1 Onboarding & Security

- **Secret phrase system:** New users must set a secret phrase on first `/start`. Returning users see their phrase displayed to verify they are on the legitimate bot (anti-scam protection).
- **Verification flow:** Three-step verification -- phrase display, source confirmation ("Did you get the bot link from Auroneth.Bot?"), and security warning acknowledgment.
- **User profile capture:** Telegram username, first/last name, avatar URL, last-seen timestamp are stored and updated on each visit.

### 3.2 Main Menu (Inline Keyboard)

Fixed layout across all bots:

1. **Reviews** -- aggregated star ratings from all orders
2. **Custom buttons** -- vendor-defined buttons (text messages or URL links), max 3 per row
3. **Shop** | **Orders (count)**
4. **Wishlist** | **Cart (total)**
5. **Contact** | **PGP** (if configured) | **About**

### 3.3 Shop / Catalog

- **Category browsing:** Products organized into Categories and Subcategories, sorted by configurable order
- **Product detail view:** Shows name, description, image (base64 or URL), price, currency, unit (pcs/grams/kg/ml), stock, variations, review count
- **Product variations:** Each variation has a name, price modifier (added to base price), and optional stock tracking
- **Quantity selection:** Increment/decrement buttons with configurable step amounts; direct numeric input supported
- **Product images:** Sent as Telegram photos with caption; graceful fallback to text if image fails

### 3.4 Cart

- Per-user, per-bot cart stored in MongoDB
- Add items with quantity and variation selection
- View cart with line totals and grand total
- Update quantities or remove items
- Stock validation before adding to cart

### 3.5 Checkout

- **Invoice creation:** Short human-readable invoice IDs (e.g., `A1B2C3`)
- **Discount code entry:** Validates against active discount codes (percentage or fixed, with min order, max discount, usage limits, date validity)
- **Payment method selection:** Lists available cryptocurrencies from SHKeeper (with fallback list if API unavailable)
- **Delivery address:** Free-text entry, encrypted at rest with AES-256 (Fernet) using `ADDRESS_ENCRYPTION_KEY`
- **Delivery method:** Configurable shipping methods per bot (Standard, Express, Next Day) with associated costs
- **Order notes:** Optional text field
- **Payment invoice:** Generates crypto payment address via SHKeeper `create_invoice` or CryptAPI `create_address`, displays QR code, amount in crypto, payment deadline (2-hour expiry)
- **Commission calculation:** Platform commission rate (default 10%) applied at checkout, stored with order

### 3.6 Orders

- **Status-grouped view:** Orders displayed in groups -- Active (paid/confirmed/shipped/delivered/disputed), Pending (payment), Completed, Closed (expired/cancelled/refunded)
- **Order detail with timeline:** Full status history with timestamps and actor
- **Buyer actions:**
  - Confirm receipt (delivered -> completed)
  - Open dispute with reason (delivered -> disputed)
  - Rate order (1-5 stars with optional comment)
  - Quick reorder from past purchases
- **Order status notifications:** Telegram messages sent to buyer on every status change

### 3.7 Reviews & Ratings

- **Per-order reviews:** One review per order; star rating (1-5) with optional text comment (max 500 chars)
- **Product reviews:** Reviews linked to all products in the order via `product_ids`
- **All-reviews view:** Paginated (5 per page), filterable by star count
- **Dynamic rating:** Average rating calculated from reviews, cached with TTL; displayed on welcome screen and menu

### 3.8 Wishlist

- Per-user, per-bot wishlist
- Add/remove products with specific variations
- View wishlist with prices and quick navigation to product detail

### 3.9 Contact / Messaging

- **Threaded conversation view:** Last 4 messages (user + vendor) merged chronologically with timestamps
- **Message status:** Single checkmark (sent) / double checkmark (read by vendor)
- **PGP key:** Vendor's public PGP key downloadable as `.txt` file or viewable in-bot
- **FSM-based input:** Contact state machine ensures messages are routed correctly
- **Secret phrase on first contact:** Shown only when user has no prior messages

### 3.10 Custom Buttons

- Vendor-defined menu buttons with custom text responses or URL links
- Legacy `main_buttons` array supported for backward compatibility
- Messages loaded from bot config `messages` dict, keyed by normalized button label

### 3.11 Commands

| Command | Description |
|---|---|
| `/start` | Onboarding / verification / welcome |
| `/menu` | Show main inline menu |
| `/shop` | Browse product catalog |
| `/orders` | View order history |
| `/wishlist` | View wishlist |
| `/reviews` | View all customer reviews |
| `/about` | Show vendor info |
| `/contact` | Open contact interface |
| `/discounts` | Show active discount codes |
| `/refresh` | Remove reply keyboard |

### 3.12 Background Services

- **Order Scheduler** (runs every 5 minutes):
  - Expire unpaid orders past payment deadline
  - Auto-deliver shipped orders after configurable days (default: 7)
  - Auto-complete delivered orders after configurable days (default: 3)
- **Payout Scheduler** (runs every 60 seconds):
  - Check blockchain confirmations for pending payouts via RPC (BTC/LTC nodes)
  - Execute vendor payouts via SHKeeper after 1 confirmation
  - TRON-based tokens (USDT/TRX) assumed confirmed immediately

---

## 4. Features -- Admin Panel

### 4.1 Authentication & Roles

Three roles with escalating privileges:

| Role | Capabilities |
|---|---|
| `demo` | Read-only access; all write operations return 403 via `demoWriteBlocked()` guard |
| `bot-owner` | Full CRUD for own bots, products, categories, orders, discounts, contacts, users |
| `super-admin` | All bot-owner capabilities + deploy vendor, manage admin users, create new bots |

- JWT-based authentication via `admin_token` cookie
- Middleware protects all `/admin/*` routes; super-admin-only routes: `/admin/users-manage`, `/admin/deploy-vendor`, `/admin/bots/new`

### 4.2 Navigation

Primary nav: **Bots** | **Products** | **Orders** | **Earnings**

"More" dropdown: **Categories** | **Discounts** | **Contacts** | **Users**

Super-admin extras: **Deploy** | **Manage Users**

Demo mode shows a persistent amber banner: "Demo Mode -- You are viewing a demo account. Changes will not be saved."

### 4.3 Bot Management (`/admin/bots`)

- List all bots as cards with status indicator (live/offline)
- Toggle bot status (live/offline)
- Delete bot
- **Bot detail page** (`/admin/bots/[id]`): Edit name, description, token, Telegram username, routes, language, cut-off time, profile picture, social links (website, Instagram, Telegram channel/group), vendor PGP key, webhook URL, payment methods, shipping methods, custom menu buttons, web shop settings (enabled, slug, description), welcome/about/custom messages

### 4.4 Product Management (`/admin/products`)

- List all products with name, price, currency, subcategory
- Create/edit product: name, base price, currency, description, image URL, unit (pcs/gr/kg/ml), increment amount, category, subcategory, bot assignment (multi-select), variations (name, price modifier, stock)
- Delete product

### 4.5 Category Management (`/admin/categories`)

- CRUD for categories with name, description, display order, bot assignment
- Subcategory management nested under each category
- CRUD for subcategories with name, description, display order, bot assignment

### 4.6 Order Management (`/admin/orders`)

- List orders with filters (by bot, by status)
- **Order detail page** (`/admin/orders/[id]`):
  - Full order information: items, amounts, commission, delivery method, shipping cost
  - Encrypted address decryption (on-demand)
  - Status timeline with history log
  - **Vendor status transitions:** Confirm Payment, Confirm Order, Mark Shipped (with tracking info), Mark Delivered, Complete, Cancel (with reason), Refund (with tx hash)
  - Source tracking (Telegram bot or web shop)

### 4.7 Earnings / Commissions (`/admin/commissions`)

- **Summary dashboard:** Total earned, pending payout, available for payout, order count
- Per-bot commission breakdown (super-admin view)
- Earnings by currency
- **Payout requests:** Bot owners can request payouts specifying amount, currency, and wallet address
- **Payout processing:** Super-admin can approve/reject/mark-paid payout requests
- Commission payment recording

### 4.8 Discount Management (`/admin/discounts`)

- CRUD for discount codes
- Fields: code, description, type (percentage/fixed), value, bot assignment, min order amount, max discount amount, usage limit, used count, validity dates, active toggle
- Created-by tracking

### 4.9 Contact Management (`/admin/contacts`)

- Conversation list with unread count, filterable by bot and unread status
- Chat view: threaded conversation showing user messages and vendor responses
- Reply functionality: send response to user via Telegram bot (stored in `contact_responses` collection)
- Message read status tracking
- Polling for new messages (every 15 seconds)

### 4.10 User Management (`/admin/users`)

- List Telegram users with ID, username, first/last name, secret phrase, first bot, verification status, last seen, created date
- View user details

### 4.11 Admin User Management (`/admin/users-manage`, super-admin only)

- CRUD for admin accounts
- Set role (super-admin, bot-owner, demo)
- Password management

### 4.12 Deploy Vendor (`/admin/deploy-vendor`, super-admin only)

- Web UI: Enter bot token and vendor name
- Automated 7-step deployment pipeline (see Section 10)
- Step-by-step progress display with status indicators
- Deployment summary with all created resources

### 4.13 Initial Setup (`/setup`)

- First-run setup page to create the initial super-admin account
- Only accessible when no admin accounts exist

---

## 5. Features -- Web Shop (Front Page)

### 5.1 Landing Page (`/`)

- Public listing of all live bots with `public_listing: true`
- Bot cards showing: name, description, profile picture, categories (emoji), payment methods, cut-off time, rating, sales count, featured badge
- Sorting: random (default), sales, reviews, rating, oldest
- Direct link to Telegram bot or web shop (if enabled)

### 5.2 Web Shop (`/shop/[slug]`)

- Per-vendor web shop accessible via URL slug (e.g., `/shop/my-shop`)
- Session-based shopping (anonymous; `shop_session_id` cookie, 24-hour TTL)
- **Product browsing:** Category/subcategory navigation, product grid with images, prices, units
- **Product detail** (`/shop/[slug]/product/[productId]`): Full product info with reviews
- **Cart** (`/shop/[slug]/cart`): Add/remove/update quantities, discount code application
- **Checkout** (`/shop/[slug]/checkout`):
  - Multi-step flow: Address entry -> Payment & shipping method selection -> Payment
  - Delivery address form (name, street, city, postcode, country)
  - Shipping method selection with costs
  - Payment method selection (crypto currencies)
  - Payment display: crypto address, amount, QR code, expiry countdown
  - Rate conversion: GBP -> USD -> crypto with locked rates and expiry
- **Order tracking** (`/shop/[slug]/order/[token]`): View order status with token-based access

### 5.3 Web Shop API Routes

| Endpoint | Method | Description |
|---|---|---|
| `/api/shop/[slug]` | GET | Shop config (name, slug, description, counts) |
| `/api/shop/[slug]/categories` | GET | Categories with subcategories |
| `/api/shop/[slug]/products` | GET | Product listing (paginated, filterable) |
| `/api/shop/[slug]/products/[productId]/reviews` | GET | Product reviews |
| `/api/shop/[slug]/cart` | GET/POST/PATCH/DELETE | Cart operations |
| `/api/shop/[slug]/cart/discount` | POST | Apply discount code |
| `/api/shop/[slug]/payment-methods` | GET | Available crypto currencies |
| `/api/shop/[slug]/shipping-methods` | GET | Shipping options with costs |
| `/api/shop/[slug]/checkout` | POST | Create order and payment invoice |
| `/api/shop/[slug]/order/[token]` | GET | Order details by token |
| `/api/shop/[slug]/order/[token]/status` | GET | Order status polling |
| `/api/shop/[slug]/order/pending` | GET | Check for pending orders in session |
| `/api/shop/[slug]/review` | POST | Submit review |
| `/api/shop/telegram-link` | GET | Get Telegram bot link for a shop |

---

## 6. Data Models

### 6.1 MongoDB Collections

| Collection | Primary Key | Description |
|---|---|---|
| `bots` | ObjectId | Bot configuration (token, name, messages, buttons, payment methods, shipping, web shop settings) |
| `categories` | ObjectId | Product categories with bot assignment and display order |
| `subcategories` | ObjectId | Subcategories linked to parent category |
| `products` | ObjectId | Products with base price, variations, unit, images, multi-bot assignment |
| `carts` | ObjectId | Per-user, per-bot shopping carts |
| `orders` | String (invoice ID) | Orders with full lifecycle tracking, status history, items, commission |
| `invoices` | UUID (+ short invoice_id) | Checkout invoices with payment details, discount, shipping, address |
| `users` | String (Telegram user ID) | Telegram users with secret phrase, verification status, profile data |
| `reviews` | ObjectId | Star ratings (1-5) with optional comment, linked to orders and products |
| `wishlists` | ObjectId | Per-user, per-bot wishlists |
| `contact_messages` | UUID | User-to-vendor messages |
| `contact_responses` | UUID | Vendor-to-user responses |
| `admins` | ObjectId | Admin accounts with role (super-admin/bot-owner/demo) |
| `discounts` | ObjectId | Discount codes with type, value, limits, validity dates |
| `commissions` | ObjectId | Commission records per order |
| `commission_payouts` | ObjectId | Payout requests from bot owners |
| `commission_payments` | ObjectId | Commission payment tracking |
| `addresses` | ObjectId | Deposit address tracking (one address per order, status: available/assigned/used) |
| `pending_payouts` | ObjectId | Deferred payout queue (waiting for blockchain confirmations) |
| `stage_transitions` | ObjectId | Order status transition log for customer targeting analytics |

### 6.2 Key Relationships

- `products.bot_ids[]` -> `bots._id` (many-to-many)
- `products.subcategory_id` -> `subcategories._id`
- `products.category_id` -> `categories._id` (when no subcategory)
- `categories.bot_ids[]` -> `bots._id` (many-to-many)
- `subcategories.category_id` -> `categories._id`
- `orders.botId` -> `bots._id`
- `orders.userId` -> `users._id` (Telegram user ID)
- `reviews.order_id` -> `orders._id`
- `reviews.product_ids[]` -> `products._id`
- `invoices.invoice_id` == `orders._id` (shared short ID)

### 6.3 Indexes

- `products`: indexed for shop performance queries
- `categories`: indexed for bot-filtered queries
- `subcategories`: indexed for category-filtered queries
- `reviews`: unique on `order_id` (sparse), indexed on `product_ids`, `product_id`, `bot_id`
- `addresses`: unique on `address`, indexed on `orderId` and `(currency, status)`

---

## 7. Payment Flow

### 7.1 End-to-End Flow

1. **Checkout:** User selects payment method (crypto currency) from available options
2. **Rate locking:** Fiat amount converted to crypto at current exchange rate (GBP -> USD -> crypto); rate locked for 2 hours
3. **Invoice creation:**
   - **SHKeeper (primary):** `POST /api/v1/{crypto}/payment_request` with fiat amount, callback URL, and order ID as `external_id`
   - **CryptAPI (fallback):** `GET /{coin}/create/?callback={webhook}&address={wallet}` generates a temporary forwarding address
4. **Payment display:** Crypto address + amount + QR code shown to user with countdown timer
5. **Webhook callback:**
   - SHKeeper: `POST /payment/shkeeper-webhook` with `X-Shkeeper-Api-Key` header; status `PAID` or `OVERPAID` triggers confirmation
   - CryptAPI: `GET|POST /payment/cryptapi-webhook?order_id=...`; `pending=0` triggers confirmation
   - Blockonomics: `POST /payment/webhook` (legacy)
6. **Order transition:** Atomic status change via order state machine (`pending` -> `paid`)
7. **Invoice update:** Telegram message edited in-place to show "Paid" status
8. **Deferred payout:** Pending payout record created; payout scheduler waits for 1 blockchain confirmation
9. **Auto payout:** After confirmation, platform commission deducted (default 10%), remainder sent to vendor's wallet address via SHKeeper `POST /api/v1/{crypto}/payout`

### 7.2 Supported Cryptocurrencies

BTC (Bitcoin), LTC (Litecoin), ETH (Ethereum), USDT (Tether/TRC20), USDC, DOGE (Dogecoin), XMR (Monero), BNB (Binance Coin), TRX (Tron)

Payment methods are configurable per bot. SHKeeper response is cached for 10 minutes with fallback list if API is unavailable.

### 7.3 Commission Model

- Platform commission rate: configurable via `PLATFORM_COMMISSION_RATE` env var (default: 10%)
- Commission calculated at checkout time and stored with the order
- After payment confirmation and 1 blockchain confirmation:
  - Commission amount retained by platform
  - Remainder auto-paid out to vendor's configured wallet address (per-currency: `payout_ltc_address`, `payout_btc_address`, `payout_usdt_address`)

---

## 8. Multi-Vendor Architecture

### 8.1 Vendor Provisioning

Each vendor gets:
- A unique Telegram bot (via BotFather token)
- A dedicated Coolify application container running `telegram-bot-service`
- A subdomain: `bot{N}.auroneth.info`
- A bot record in MongoDB with all configuration
- Shared access to the same MongoDB database

### 8.2 Vendor Isolation

- Each bot container has its own `BOT_TOKEN` environment variable
- Bot config is loaded from MongoDB by matching the token at startup (`bots.token == BOT_TOKEN`)
- Products, categories, and discounts use `bot_ids[]` arrays for multi-tenant filtering
- Orders, carts, wishlists, and contacts are scoped by `botId`
- Users are global (shared across bots) -- identified by Telegram user ID

### 8.3 Deploy Vendor Pipeline (7 steps)

1. **Auto-detect vendor number:** Scan Coolify applications for highest `telegram-bot-service-vendorN`, increment
2. **Create MongoDB bot record:** Insert bot config with token, name, default buttons and messages
3. **Create Coolify application:** Public git repo, Dockerfile build pack, base directory `/telegram-bot-service`, port 8000
4. **Set environment variables:** 12 env vars including MONGO_URI, BOT_TOKEN, WEBHOOK_URL, SHKeeper/CryptAPI credentials, encryption key, commission rate
5. **Deploy application:** Trigger Coolify build (2-5 minutes)
6. **Create Cloudflare DNS:** Proxied A record `bot{N}.auroneth.info` -> server IP
7. **Set Telegram webhook:** Register `https://bot{N}.auroneth.info/webhook` with Telegram API

Available via both CLI (`scripts/deploy-vendor.sh`) and admin panel UI (`/admin/deploy-vendor`).

---

## 9. Security

### 9.1 Authentication

- **Admin panel:** JWT tokens stored in `admin_token` httpOnly cookie; bcrypt password hashing
- **Web shop:** Anonymous session via `shop_session_id` httpOnly cookie (UUID, 24-hour TTL)
- **Telegram bot:** User identity via Telegram user ID (inherently authenticated by Telegram)
- **Web Bridge:** `X-Bridge-Key` header for server-to-server communication

### 9.2 Data Protection

- **Delivery addresses:** Encrypted at rest with AES-256 (Fernet) using `ADDRESS_ENCRYPTION_KEY`; decrypted on-demand in admin panel
- **Secret phrases:** Stored in plaintext in MongoDB (user-created, used for anti-scam verification rather than authentication)
- **SHKeeper credentials:** Isolated in Python service; never exposed to frontend

### 9.3 Anti-Scam

- Secret phrase verification on every `/start` -- if the phrase doesn't match what the user set, they may be on a scam bot
- Security warning about not trusting private messages or out-of-bot payment requests
- Official website redirect for users who didn't find the bot through Auroneth.Bot

### 9.4 Demo Mode

- `demo` role blocks all write operations across 22+ API handlers via `demoWriteBlocked()` guard
- Demo banner displayed in admin panel UI
- Demo bot seeded with sample data (products, categories, orders, discounts)

### 9.5 Payment Security

- SHKeeper webhooks verified via `X-Shkeeper-Api-Key` header
- Blockonomics webhooks verified via `WEBHOOK_SECRET` query parameter
- Atomic order state transitions prevent race conditions (compare-and-swap on `paymentStatus`)
- Deferred payouts: vendor payout only after 1 blockchain confirmation (prevents double-spend on 0-conf)
- Idempotent webhook processing: already-paid orders return 200/202 without reprocessing

---

## 10. Deployment

### 10.1 Service Deployment

All services are deployed via **Coolify** (self-hosted PaaS):

| Service | Build | Base Directory | Port |
|---|---|---|---|
| telegram-bot-service (per vendor) | Dockerfile (Python 3.12-slim) | `/telegram-bot-service` | 8000 |
| admin-panel | Dockerfile (Node 20-alpine, Next.js standalone) | `/admin-panel` | 3000 |
| front-page | Dockerfile (Node 20-alpine, Next.js standalone) | `/front-page` | 3000 |

### 10.2 DNS Configuration

- Domain: `auroneth.info` managed via Cloudflare
- `admin.auroneth.info` -> Admin panel
- `auroneth.info` / `www.auroneth.info` -> Front page / web shop
- `bot.auroneth.info` -> Vendor 1 (Auroneth original)
- `bot{N}.auroneth.info` -> Vendor N
- `shkeeper.auroneth.info` -> SHKeeper payment processor
- All records proxied through Cloudflare

### 10.3 Environment Variables (per bot service)

| Variable | Description |
|---|---|
| `BOT_TOKEN` | Telegram bot token from BotFather |
| `WEBHOOK_URL` | HTTPS URL for payment callbacks |
| `MONGO_URI` | MongoDB connection string |
| `SHKEEPER_API_URL` | SHKeeper server URL |
| `SHKEEPER_API_KEY` | SHKeeper authentication key |
| `CRYPTAPI_BTC_WALLET_ADDRESS` | BTC forwarding wallet (CryptAPI fallback) |
| `CRYPTAPI_LTC_WALLET_ADDRESS` | LTC forwarding wallet (CryptAPI fallback) |
| `CRYPTAPI_ENABLED_CURRENCIES` | Enabled CryptAPI currencies |
| `ADDRESS_ENCRYPTION_KEY` | AES-256 key for address encryption |
| `PLATFORM_COMMISSION_RATE` | Commission rate (default: 0.10 = 10%) |
| `PORT` | HTTP port (default: 8000) |
| `BRIDGE_API_KEY` | Key for web bridge API authentication |

---

## 11. Current Vendors

| Vendor | Domain | Bot | Notes |
|---|---|---|---|
| Vendor 1 | `bot.auroneth.info` | Auroneth | Original vendor |
| Vendor 2 | `bot2.auroneth.info` | GreenBritain | Second vendor |
| Vendor 3 | `bot3.auroneth.info` | Strainz | Third vendor |
| Vendor 4 | `bot4.auroneth.info` | Auroneth Demo | Demo account |

---

## 12. Order State Machine

### Valid Transitions

```
pending   -> paid, expired, cancelled
paid      -> confirmed, cancelled, refunded
confirmed -> shipped, cancelled, refunded
shipped   -> delivered, refunded
delivered -> completed, disputed
disputed  -> refunded, completed
cancelled -> refunded
```

Terminal states (no outgoing transitions): `expired`, `completed`, `refunded`

### Automatic Transitions

- `pending` -> `expired`: When `payment_deadline` passes (checked every 5 min)
- `shipped` -> `delivered`: After `auto_deliver_days` (default 7, per-bot configurable)
- `delivered` -> `completed`: After `auto_complete_days` (default 3, per-bot configurable)

---

## 13. Implementation Log

### March 22, 2026

- Deploy vendor automation (CLI script + superadmin UI)
- Cloudflare DNS auto-creation in deploy flow
- Demo account system with write-blocking across 22 API handlers
- Demo bot seeded with 10 products, 3 categories, 5 orders, 2 discounts
- Admin UX redesign: nav dropdown grouping, bots page card grid
- Contact chat limited to last 4 messages
- MongoDB indexes on products/categories/subcategories for shop performance
- Shop category switching UX improvement
- Strainz bot token migration after ban
- GreenBritain bot joined_today_boost fix
- Influencer tools menu reorder
- Vendor env var normalization
- Multiple Coolify API endpoint fixes
