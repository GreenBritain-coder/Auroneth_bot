# Auroneth Bot Platform — Product Requirements Document

**Version:** 1.0
**Date:** 2026-03-20
**Author:** Platform Team
**Status:** Active

---

## Table of Contents

1. [Vision & Mission](#1-vision--mission)
2. [Current State Assessment](#2-current-state-assessment)
3. [Customer Engagement & Retention Improvements](#3-customer-engagement--retention-improvements)
4. [UX Improvements](#4-ux-improvements)
5. [Vendor-Side Improvements](#5-vendor-side-improvements)
6. [Platform Growth Features](#6-platform-growth-features)
7. [Technical Improvements](#7-technical-improvements)
8. [In-Bot Analytics & Tracking](#8-in-bot-analytics--tracking)
9. [Prioritized Roadmap](#9-prioritized-roadmap)

---

## 1. Vision & Mission

### Vision

Become the **biggest self-service bot platform on Telegram** -- the Shopify of Telegram bots. Any vendor, regardless of technical ability, can launch a fully-functional shop bot in minutes. Customers get a seamless, secure buying experience without ever leaving Telegram.

### Mission

- **Zero-friction vendor onboarding:** A vendor provides a BotFather token, configures products in a web admin panel, and their shop is live.
- **Buyer trust & safety:** Secret-phrase anti-phishing system, encrypted addresses, PGP key distribution, and verified marketplace listings protect every transaction.
- **Sustainable economics:** A 10% platform commission on paid orders funds development, infrastructure, and growth. Vendors keep 90% automatically.
- **Scale without compromise:** The architecture must support thousands of concurrent bots, each with independent products, categories, and customer bases, served from a single shared infrastructure.

### Success Metrics

| Metric | Current | 6-Month Target | 12-Month Target |
|---|---|---|---|
| Active vendor bots | Early stage | 50 | 500 |
| Monthly orders processed | -- | 5,000 | 100,000 |
| Customer retention (30-day) | Unmeasured | 25% | 40% |
| Avg checkout completion rate | Unmeasured | 50% | 70% |
| Platform uptime | -- | 99.5% | 99.9% |

---

## 2. Current State Assessment

### 2.1 Architecture Overview

The platform consists of three services sharing a single MongoDB database:

```
┌─────────────────────────┐    ┌─────────────────────────┐    ┌─────────────────────────┐
│  telegram-bot-service   │    │      admin-panel         │    │       front-page         │
│  (Python / aiogram 3)   │    │   (Next.js / TypeScript) │    │   (Next.js / TypeScript) │
│                         │    │                          │    │                          │
│  9 handler modules      │    │  11 admin pages          │    │  Public marketplace      │
│  6 service modules      │    │  17+ API routes          │    │  Bot directory with      │
│  8 utility modules      │    │  7 Mongoose models       │    │  search & sort           │
│  aiohttp webhook server │    │  JWT auth + middleware    │    │                          │
└───────────┬─────────────┘    └───────────┬──────────────┘    └───────────┬──────────────┘
            │                              │                               │
            └──────────────────────────────┼───────────────────────────────┘
                                           │
                                    ┌──────┴──────┐
                                    │   MongoDB   │
                                    │  13 collections │
                                    └─────────────┘
```

### 2.2 Service Breakdown

#### telegram-bot-service (Python/aiogram 3)

| File | Purpose |
|---|---|
| `main.py` | Bot initialization, dispatcher setup, polling/webhook modes, LoggingMiddleware |
| `handlers/start.py` | `/start` command, secret phrase verification flow, welcome message with stats |
| `handlers/shop.py` | Full shop navigation: categories > subcategories > products > variations > cart > checkout (2600+ lines) |
| `handlers/menu.py` | Reply keyboard button handlers, dynamic command routing from `main_buttons` config |
| `handlers/menu_inline.py` | Catch-all inline callback router for custom menu buttons, discounts display |
| `handlers/orders.py` | Order list display, order detail view, order cancellation |
| `handlers/products.py` | Direct buy handler (`buy:` callback), legacy product purchase flow |
| `handlers/payments.py` | Blockonomics/CryptAPI/SHKeeper webhook handlers, payment confirmation, commission recording |
| `handlers/payouts.py` | Payout endpoint (`/api/payout/send`), manual Blockonomics send instructions |
| `handlers/contact.py` | Async vendor messaging: conversation history, PGP key display, FSM-based chat |
| `services/payment_provider.py` | Provider selection: SHKeeper > CryptAPI > Blockonomics > CoinPayments |
| `services/shkeeper.py` | SHKeeper self-hosted payment gateway integration |
| `services/cryptapi.py` | CryptAPI integration with per-currency wallet addresses |
| `services/blockonomics.py` | Blockonomics BTC payment integration |
| `services/coinpayments.py` | CoinPayments integration |
| `services/commission.py` | 10% commission calculation (`PLATFORM_COMMISSION_RATE` env var) |
| `utils/address_encryption.py` | AES-256 Fernet encryption for delivery addresses (system key + user secret phrase) |
| `utils/bot_config.py` | MongoDB bot config lookup with 30-second TTL cache, auto-registration |
| `utils/currency_converter.py` | CoinGecko + exchangerate-api.com for real-time fiat/crypto conversion |
| `utils/qr_generator.py` | Payment QR code image generation with PIL overlay text |
| `utils/invoice_id.py` | 8-digit numeric invoice ID generation with uniqueness check |
| `utils/secret_phrase.py` | Auto-generated 5-char secret phrases for anti-phishing |
| `utils/bottom_menu.py` | Dynamic menu stats (order count, cart total) for inline keyboard |
| `utils/callback_utils.py` | Safe callback answer helper |
| `database/connection.py` | Motor async MongoDB connection with reviews index creation |
| `database/addresses.py` | Deposit address pool: record and mark-as-used per order |
| `database/models.py` | Type hint stubs (not enforced) |

#### admin-panel (Next.js / TypeScript)

**Pages (11):**

| Page | Route | Function |
|---|---|---|
| Bots list | `/admin/bots` | View/manage all bots |
| Bot create | `/admin/bots/new` | Create new bot with token, buttons, messages |
| Bot edit | `/admin/bots/[id]` | Edit bot config, profile picture, PGP key, shipping methods |
| Categories | `/admin/categories` | Category CRUD with bot assignment |
| Category edit | `/admin/categories/[id]` | Edit category, manage subcategories |
| Subcategories | `/admin/categories/[id]/subcategories` | Subcategory list under category |
| Products | `/admin/products` | Product CRUD with variations, units, images |
| Discounts | `/admin/discounts` | Discount code CRUD (percentage/fixed, usage limits, date range) |
| Orders | `/admin/orders` | Order list with payment status, address decryption |
| Commissions | `/admin/commissions` | Commission tracking, payout requests, payment recording |
| Contacts | `/admin/contacts` | Customer message inbox |
| Users | `/admin/users` | Bot user list with secret phrases |
| Manage Users | `/admin/users-manage` | Super-admin only: admin account CRUD |

**API Routes (17+):** RESTful CRUD for all entities plus auth, setup, migration import, address decryption, payout processing.

**Auth:** JWT tokens (7-day expiry) stored in `admin_token` cookie, middleware-enforced. Two roles: `super-admin` and `bot-owner`.

**Models (defined in `admin-panel/lib/models.ts`):**
Bot, Category, Subcategory, Product, Cart, Order, Commission, Address, CommissionPayout, CommissionPayment, User, ContactMessage, Admin, Discount.

#### front-page (Next.js)

Public marketplace directory at `front-page/app/page.tsx`:
- Fetches all bots with `public_listing: true` and `status: "live"`
- Search by name, description, username, category
- Sort by: random, sales, reviews, rating, oldest
- Displays: profile picture, name, categories, sales count, rating, payment methods, cut-off time
- Featured bots get gradient cards with glow effects
- Links to `t.me/{username}` for each bot

### 2.3 Database Collections (MongoDB)

| Collection | Key Fields | Purpose |
|---|---|---|
| `bots` | token, name, main_buttons, messages, payment_methods, shipping_methods, vendor_pgp_key, webhook_url | Bot configuration |
| `users` | _id (telegram_id), secret_phrase, verification_completed, last_seen | Customer accounts |
| `categories` | name, bot_ids, order | Shop categories |
| `subcategories` | name, category_id, bot_ids, order | Shop subcategories |
| `products` | name, base_price, currency, variations, unit, subcategory_id, bot_ids, image_url | Product catalog |
| `orders` | botId, userId, productId, amount, commission, paymentStatus, encrypted_address, currency | Transaction records |
| `invoices` | invoice_id, bot_id, user_id, items, total, discount_code, payment_method, delivery_address, delivery_method, status | Checkout state machine |
| `carts` | user_id, bot_id, items (product_id, variation_index, quantity, price) | Shopping carts |
| `wishlists` | user_id, bot_id, product_id | Wishlist items |
| `reviews` | order_id, product_ids, bot_id, rating, comment | Customer reviews |
| `contact_messages` | botId, userId, message, timestamp, read | Vendor-customer messaging |
| `commissions` | botId, orderId, amount | Platform commission records |
| `discounts` | code, discount_type, discount_value, bot_ids, usage_limit, valid_from, valid_until | Discount codes |
| `addresses` | currency, address, orderId, status, provider | Deposit address pool |
| `admin_users` | username, password_hash, role | Admin panel accounts |
| `commissionpayouts` | userId, amount, currency, status, walletAddress | Payout requests |
| `commissionpayments` | botId, amount, paidBy | Payout execution records |

### 2.4 Existing Features (22)

1. **Multi-bot support** -- Single deployment serves multiple bots via token-based config lookup (`utils/bot_config.py`)
2. **Secret phrase verification** -- Anti-phishing system: users create phrases, verify on each `/start` (`handlers/start.py`)
3. **Category/subcategory shop navigation** -- Hierarchical browsing: categories > subcategories > products (`handlers/shop.py`)
4. **Cart system** -- Add items with quantities and variations, view cart, modify/remove items (`handlers/shop.py`)
5. **Full checkout flow** -- Multi-step invoice: discount code > payment method > delivery address > delivery method > confirm (`handlers/shop.py`)
6. **4 payment providers** -- SHKeeper (self-hosted), CryptAPI, Blockonomics, CoinPayments with priority fallback (`services/payment_provider.py`)
7. **Order management** -- Order listing, detail view, status tracking (`handlers/orders.py`)
8. **10% platform commission** -- Auto-calculated on every order, recorded separately (`services/commission.py`)
9. **Commission payout system** -- Request, approve, process payouts via admin panel
10. **Wishlist** -- Add/remove products, view wishlist in-bot (`handlers/shop.py`)
11. **Reviews/ratings** -- Star ratings with optional comments, all-reviews view with star filtering (`handlers/shop.py`)
12. **Async vendor messaging** -- In-bot contact with conversation history, PGP key sharing (`handlers/contact.py`)
13. **PGP key distribution** -- Vendor PGP public keys viewable/downloadable in-bot (`handlers/contact.py`)
14. **Discount codes** -- Percentage or fixed-amount discounts with date ranges, usage limits, min order amounts (`admin-panel/lib/models.ts`)
15. **Product variations with stock** -- Named variants with price modifiers and optional stock tracking (`admin-panel/lib/models.ts`)
16. **Unit-based quantities** -- Products measured in pieces, grams, kilograms, or milliliters (`admin-panel/lib/models.ts`)
17. **QR code generation** -- Payment QR codes with bot username and invoice ID overlay (`utils/qr_generator.py`)
18. **Currency conversion** -- Real-time fiat/crypto rates via CoinGecko and exchangerate-api.com (`utils/currency_converter.py`)
19. **Delivery address encryption** -- AES-256 encryption using system key + user secret phrase (`utils/address_encryption.py`)
20. **Admin roles** -- Super-admin and bot-owner with middleware-enforced route protection (`admin-panel/middleware.ts`)
21. **Public marketplace** -- Searchable/sortable directory with featured bot highlighting (`front-page/app/page.tsx`)
22. **Configurable bot menus** -- Vendor-defined main buttons, inline buttons, custom messages per button (`admin-panel/lib/models.ts`)

### 2.5 Current Limitations & Technical Debt

1. **`handlers/shop.py` is 2600+ lines** -- Monolithic handler covering categories, products, cart, wishlist, reviews, and the entire checkout flow. Needs decomposition into separate modules.
2. **No product search** -- Customers can only discover products through category browsing. No text search capability exists.
3. **FSM storage is in-memory** -- `MemoryStorage()` in `main.py` means all FSM state (contact chat, address input, quantity input) is lost on restart. Not suitable for multi-instance deployment.
4. **No analytics or event tracking** -- Zero instrumentation. No visibility into user behavior, funnel drop-offs, or conversion rates.
5. **No automated notifications** -- No push notifications for order updates, restocks, price drops, or abandoned carts.
6. **Single-language only** -- All bot text is hardcoded in English. No i18n framework.
7. **No order status tracking beyond payment** -- Orders have only `pending/paid/failed` states. No shipping, in-transit, or delivered states.
8. **No customer profiles in-bot** -- Users cannot view their purchase history, total spend, or account details inside the bot.
9. **No vendor analytics** -- Admin panel shows raw order lists but no sales metrics, conversion funnels, or trend charts.
10. **No referral or loyalty system** -- No mechanism to reward repeat customers or incentivize referrals.
11. **Polling mode only for local dev** -- Webhook mode code is commented out in `main.py`. Production deployment requires uncommenting and configuring.
12. **No rate limiting** -- Neither the bot handlers nor the admin API routes have rate limiting.
13. **No automated testing** -- Zero test files beyond manual scripts in `telegram-bot-service/scripts/`.
14. **No monitoring or alerting** -- No health checks, error aggregation, or uptime monitoring.
15. **Database has no backup strategy** -- No documented or automated MongoDB backup process.
16. **Bot config cache is process-local** -- 30-second TTL cache in `utils/bot_config.py` does not work across multiple instances.
17. **`database/models.py` is unused** -- The Python service uses raw dicts; type definitions are stub-only.
18. **No product image optimization** -- Images are passed as raw URLs or base64 blobs with no CDN, resizing, or caching.
19. **Duplicate code in menu handlers** -- `handlers/start.py`, `handlers/menu.py`, and `handlers/menu_inline.py` all rebuild the same inline keyboard.
20. **FakeCallback pattern** -- `handlers/menu.py` creates fake callback objects to reuse shop handlers, indicating the need for shared rendering functions decoupled from Telegram callback mechanics.
21. **No order confirmation workflow** -- Vendors cannot mark orders as shipped/completed from admin panel (only address decryption and payment confirmation exist).

---

## 3. Customer Engagement & Retention Improvements

### 3.1 In-Bot Order Tracking

**Current state:** Orders have three states: `pending`, `paid`, `failed`. After payment, the customer receives a one-time confirmation message. No further updates.

**Proposed changes:**

#### 3.1.1 Extended Order Status Model

Add new statuses to the order lifecycle:

```
pending -> paid -> confirmed -> processing -> shipped -> in_transit -> delivered -> completed
                                                                         |
                                                                    disputed -> resolved
```

**Implementation:**
- Extend `paymentStatus` field in `admin-panel/lib/models.ts` (`IOrder` interface) to include: `confirmed`, `processing`, `shipped`, `in_transit`, `delivered`, `completed`, `disputed`, `resolved`.
- Add `status_history` array field to orders: `[{ status, timestamp, note? }]` for full audit trail.
- Add vendor-facing status update buttons on the orders page in admin panel (`admin-panel/app/admin/orders/page.tsx`).
- Add tracking number field (`tracking_number?: string`) and carrier field (`carrier?: string`) to orders.

#### 3.1.2 Automated Status Notifications

When a vendor updates order status via admin panel:
- Bot sends a Telegram message to the customer with the new status.
- Include order details, tracking number (if provided), and estimated delivery.
- Implement via a new API endpoint that the admin panel calls, which triggers a Telegram `sendMessage` using the bot token from the order's `botId`.

**New file:** `telegram-bot-service/services/notifications.py`
```python
async def send_order_status_update(order_id: str, new_status: str, note: str = None):
    # Look up order -> get userId (telegram_id) and botId -> get bot token
    # Send formatted status update message via Bot(token).send_message()
```

**New admin API route:** `admin-panel/app/api/orders/[id]/status/route.ts`

#### 3.1.3 In-Bot Order Status Check

Add `/track` command and "Track Order" button in order detail view:
- Shows current status with visual progress indicator (emoji-based timeline)
- Shows tracking number and carrier if available
- Shows estimated delivery date if provided by vendor

### 3.2 Loyalty & Rewards System

**Current state:** No repeat purchase incentives exist.

**Proposed implementation:**

#### 3.2.1 Points System

- New MongoDB collection: `loyalty_points`
  - `user_id`, `bot_id`, `points_balance`, `lifetime_points`, `tier`
- New collection: `points_transactions`
  - `user_id`, `bot_id`, `order_id`, `points_earned`, `points_spent`, `type` (earn/redeem/bonus/expiry), `timestamp`

**Rules (configurable per-bot in bot config):**
- Base earn rate: 1 point per currency unit spent (e.g., 1 point per GBP)
- Bonus multipliers configurable (e.g., 2x points weekends)
- Redemption rate: configurable (e.g., 100 points = 1 GBP discount)
- Points expiry: configurable (e.g., 180 days of inactivity)

#### 3.2.2 Tier System

| Tier | Requirement | Perks |
|---|---|---|
| Bronze | 0 points | Base earn rate |
| Silver | 500 lifetime points | 1.5x earn rate, early access to sales |
| Gold | 2000 lifetime points | 2x earn rate, free standard shipping |
| Platinum | 5000 lifetime points | 3x earn rate, free express shipping, priority support |

**Bot commands:** `/points` (check balance and tier), `/redeem` (apply points at checkout)

#### 3.2.3 Vendor Configuration

Add to bot config in admin panel (`admin-panel/app/admin/bots/[id]/page.tsx`):
- Toggle loyalty system on/off
- Set earn rate, redemption rate, tier thresholds
- Set expiry policy
- View loyalty analytics (points issued, redeemed, expired)

### 3.3 Push Notifications

**Current state:** No proactive messaging. Bot only responds to user-initiated interactions.

**Proposed notification types:**

| Notification | Trigger | Message Content | Opt-in Default |
|---|---|---|---|
| Restock alert | Product stock changes from 0 to >0 | "Item X is back in stock!" | Wishlisted items only |
| Price drop | Product price decreases | "Price dropped on X: was Y, now Z" | Wishlisted items only |
| New product | New product added to bot | "New arrival: X" | Opt-in |
| Order shipped | Vendor updates order status | "Your order #INV has shipped" | Always on |
| Flash sale | Vendor creates time-limited discount | "Flash sale: X% off for next Y hours" | Opt-in |

**Implementation:**
- New collection: `notification_preferences` -- `user_id`, `bot_id`, `preferences` (map of notification type to boolean)
- New collection: `notification_queue` -- `user_id`, `bot_id`, `type`, `payload`, `status` (pending/sent/failed), `scheduled_at`, `sent_at`
- Background worker (asyncio task in `main.py`) that processes the queue and sends messages via Telegram API
- Rate limiting: max 1 notification per type per user per hour, max 5 total per user per day
- `/notifications` command to manage preferences

**New file:** `telegram-bot-service/services/notification_worker.py`

### 3.4 Wishlist Notifications

**Current state:** Wishlists exist (`wishlists` collection) but are passive. Users must manually check.

**Proposed changes:**
- When a product's stock goes from 0 to >0, query `wishlists` collection for that product's `product_id`.
- Send "back in stock" message to each user who has it wishlisted.
- When a wishlisted product's price drops, notify users.
- Add "Notify me" toggle on product detail view (currently wishlist is just add/remove).
- Implementation: Hook into the admin panel product update API (`admin-panel/app/api/products/[id]/route.ts`). When stock or price changes, enqueue notifications.

### 3.5 Personalized Recommendations

**Current state:** No recommendations. Products are shown in static category order.

**Proposed implementation:**

#### 3.5.1 Simple Recommendation Engine

Phase 1 (rule-based):
- "Frequently bought together" -- based on co-occurrence in orders (same user, same bot, same session/day)
- "Customers who bought X also bought Y" -- collaborative filtering on order history
- "Popular in your category" -- top-selling products in categories the user has purchased from

Phase 2 (ML-based, longer term):
- Embedding-based similarity on product descriptions
- Purchase sequence prediction

#### 3.5.2 Placement

- After checkout confirmation: "You might also like..."
- In product detail view: "Frequently bought together" section
- New `/recommended` command
- Add "For You" section in shop navigation (between categories list and cart)

**New collection:** `recommendations` -- precomputed, refreshed daily via cron job

### 3.6 Customer Profiles

**Current state:** Users have minimal data: `_id` (telegram_id), `secret_phrase`, `first_bot_id`, `created_at`, `verification_completed`, `last_seen`.

**Proposed `/profile` command and "My Account" menu button:**

Display:
- Account creation date
- Total orders placed
- Total amount spent
- Loyalty tier and points balance
- Favorite categories (most purchased)
- Recent orders (last 5, with status)
- Saved delivery addresses (encrypted, user can delete)
- Notification preferences

**Implementation:**
- Aggregate from `orders`, `loyalty_points`, `wishlists` collections
- Add `/profile` command handler in a new file: `telegram-bot-service/handlers/profile.py`
- Add "My Account" to the default menu inline buttons in `handlers/start.py`

### 3.7 Re-Engagement Flows

**Current state:** No automated re-engagement. No abandoned cart detection.

#### 3.7.1 Abandoned Cart Reminders

- Detect: Cart has items AND no order placed within 24 hours (check `carts.updated_at` vs `orders.timestamp`)
- Send reminder: "You left X items in your cart! Complete your order before stock runs out."
- Max 2 reminders: 24h and 72h after cart creation
- Include a deep link that opens the bot and shows the cart

**Implementation:** Background task in `notification_worker.py` that runs every hour, queries carts with `updated_at` older than 24h where no matching order exists.

#### 3.7.2 Win-Back Messages

- Detect: User has `last_seen` older than 14 days AND has made at least 1 purchase
- Send: "We miss you! Here's what's new..." with new product highlights
- Max 1 win-back per 30 days per user
- Vendor can customize the message template in admin panel

#### 3.7.3 Post-Purchase Follow-Up

- 3 days after delivery: "How was your experience? Leave a review!"
- 7 days after delivery: "Need to reorder? Quick reorder is one tap away."
- Only send if user hasn't already reviewed the order

---

## 4. UX Improvements

### 4.1 Navigation Flow Improvements

**Current state:** The inline keyboard menu is the primary navigation. Navigating back from deeply nested views (product > variation > cart > checkout) requires multiple taps. The menu keyboard is rebuilt from scratch in three different handler files.

**Proposed changes:**

#### 4.1.1 Unified Navigation Module

- **New file:** `telegram-bot-service/utils/navigation.py`
- Extract all keyboard-building logic from `handlers/start.py` (lines 402-485), `handlers/menu.py` (lines 584-631), and `handlers/menu_inline.py` (lines 60-106) into a single shared function.
- Single source of truth: `build_main_menu_keyboard(user_id, bot_id, bot_config)` returns the `InlineKeyboardMarkup`.

#### 4.1.2 Breadcrumb Navigation

Show current location in navigation text:
- "Shop > Cannabis > Edibles" instead of just "Select a product"
- Breadcrumb parts are tappable (callback data for each level)
- Implement as a helper function that takes the current navigation stack and returns formatted text

#### 4.1.3 Back Button Consistency

Every screen should have a "Back" button that returns to the previous level:
- Product detail > Back to subcategory
- Subcategory > Back to category
- Category > Back to shop
- Shop > Back to menu
- Current implementation is inconsistent: some screens use "Back to Menu", others use "Back to Shop"

### 4.2 Onboarding Experience

**Current state:** New users see a secret phrase input prompt, then the verification flow, then the welcome message. There is no guided tour of features.

**Proposed onboarding flow:**

1. Secret phrase creation (existing)
2. Verification flow (existing)
3. **NEW: Welcome tour** (3-4 inline keyboard "slides"):
   - Slide 1: "Browse products by category in the Shop"
   - Slide 2: "Add items to your cart and checkout with crypto"
   - Slide 3: "Track your orders and contact the vendor anytime"
   - Slide 4: "Save favorites to your wishlist for later"
   - "Got it, take me to the menu" button
4. Skip option: "Skip tour" button on every slide
5. Tour state stored in user document: `onboarding_completed: boolean`

**Implementation:** Add to `handlers/start.py` after `show_welcome_message()`, or as a new `handlers/onboarding.py`.

### 4.3 Product Search

**Current state:** No search functionality. Customers must browse categories.

**Proposed implementation:**

#### 4.3.1 In-Bot Search Command

- `/search <query>` command and "Search" button in main menu
- Full-text search against product `name` and `description` fields
- Results shown as inline keyboard buttons (product name + price), max 10 results
- "Show more" pagination if >10 results

**Implementation:**
- Create MongoDB text index on `products.name` and `products.description`
- New handler: `telegram-bot-service/handlers/search.py`
- FSM state for multi-page search results

#### 4.3.2 Inline Query Support (Future)

- Enable Telegram inline mode: user types `@botname query` in any chat
- Returns search results as inline articles
- Tapping a result opens the bot to that product's detail page

### 4.4 Quick Reorder

**Current state:** To reorder, a customer must navigate to the product, select variation, set quantity, add to cart, and checkout. No shortcut exists.

**Proposed changes:**
- In order detail view, add "Reorder" button
- Tapping "Reorder" adds the same items (product, variation, quantity) to the cart
- Then shows the cart with a "Checkout" button
- `/reorder` command shows last 5 orders with "Reorder" buttons

**Implementation:**
- Add callback handler `reorder:{order_id}` in `handlers/orders.py`
- Copy order items to cart collection, then redirect to cart view

### 4.5 Product Discovery

**Current state:** Products are listed under categories/subcategories in the order defined by the vendor. No algorithmic curation.

**Proposed sections in shop:**

| Section | Logic | Placement |
|---|---|---|
| Featured | Vendor-flagged products (new `featured` boolean field) | Top of shop, before categories |
| Trending | Top-selling in last 7 days (by order count) | New button in shop menu |
| New Arrivals | Products created in last 14 days (by `_id` timestamp or new `created_at` field) | New button in shop menu |
| On Sale | Products with active discount codes | New button in shop menu |

**Implementation:**
- Add `featured: boolean` and `created_at: Date` fields to product model
- New callback handlers: `trending`, `new_arrivals`, `on_sale` in `handlers/shop.py`
- Aggregate queries against `orders` (for trending) and `products` (for new arrivals)

### 4.6 Streamlined Checkout

**Current state:** Checkout is a multi-step flow in `handlers/shop.py` (lines 1871-2660): create invoice > apply discount > select payment method > enter delivery address > select delivery method > confirm. Each step edits the same message.

**Proposed improvements:**

#### 4.6.1 Saved Payment Preferences

- Remember user's last payment method per bot
- New collection field: `user_preferences` -- `user_id`, `bot_id`, `preferred_payment_method`, `preferred_delivery_method`
- Auto-select on checkout, with "Change" button

#### 4.6.2 Saved Addresses

- After first order, offer to save the delivery address (encrypted)
- On subsequent checkouts, show "Use saved address" button
- New collection: `saved_addresses` -- `user_id`, `bot_id`, `encrypted_address`, `label` (e.g., "Home", "Work"), `created_at`
- Max 3 saved addresses per user per bot

#### 4.6.3 One-Tap Reorder

- Combine quick reorder (4.4) with saved preferences to enable true one-tap checkout:
  1. User taps "Reorder" on a past order
  2. Cart is pre-filled
  3. Payment method, address, and delivery method are pre-selected from saved preferences
  4. User sees summary and taps "Confirm" -- single tap to complete

### 4.7 Rich Media Support

**Current state:** Products can have a single `image_url`. Images are sent via `answer_photo()` or `edit_media()`. No galleries, no videos.

**Proposed changes:**

#### 4.7.1 Product Image Gallery

- Change `image_url: string` to `images: string[]` (array of URLs) in product model
- In product detail view, show first image with "1/N" indicator
- Navigation buttons: "< Prev" and "Next >" using `edit_media()` to swap images
- Admin panel product form: multiple image upload with drag-to-reorder

#### 4.7.2 Video Support

- Add `video_url?: string` field to product model
- Show video in product detail via `answer_video()` or `answer_animation()` for GIFs
- Admin panel: video upload or URL input

### 4.8 Multi-Language Support

**Current state:** All bot strings are hardcoded in English throughout handler files. The bot config has a `language` field but it's display-only (shown in welcome message).

**Proposed implementation:**

#### 4.8.1 i18n Framework

- **New file:** `telegram-bot-service/utils/i18n.py`
- Translation files: `telegram-bot-service/locales/{lang_code}.json` (e.g., `en.json`, `es.json`, `de.json`, `fr.json`)
- Each translation file maps keys to strings: `"shop.select_category": "Select a Category"`
- Helper function: `t(key, lang_code, **kwargs)` returns translated string with variable interpolation
- Language stored per-bot in bot config (`language` field already exists)
- Future: per-user language preference

#### 4.8.2 Priority Languages

Phase 1: English (default), Spanish, German, French
Phase 2: Portuguese, Russian, Arabic, Chinese

---

## 5. Vendor-Side Improvements

### 5.1 Analytics Dashboard

**Current state:** The admin panel shows raw lists of orders, products, and commissions. No charts, metrics, or insights.

**Proposed analytics page:** `admin-panel/app/admin/analytics/page.tsx`

#### 5.1.1 Key Metrics Cards

- Total revenue (all time, last 30d, last 7d)
- Total orders (all time, last 30d, last 7d)
- Average order value
- Conversion rate (orders / unique users)
- Active customers (ordered in last 30d)
- Cart abandonment rate

#### 5.1.2 Charts

- Revenue over time (line chart, daily/weekly/monthly)
- Orders over time (bar chart)
- Top products by revenue (horizontal bar)
- Top products by quantity sold
- Payment method distribution (pie chart)
- Customer acquisition over time (new users per day)

#### 5.1.3 Implementation

- New API routes: `admin-panel/app/api/analytics/route.ts` with aggregation pipeline queries
- Chart library: recharts (already compatible with Next.js)
- Date range selector: last 7d, 30d, 90d, all time

### 5.2 Inventory Management Alerts

**Current state:** Product variations have an optional `stock` field. No alerts when stock is low or depleted.

**Proposed changes:**

#### 5.2.1 Low Stock Alerts

- Add `low_stock_threshold` field to product model (default: 5)
- When stock drops below threshold on order payment, enqueue alert
- Alert shown in admin panel as a banner/badge on Products page
- Optional: send Telegram message to vendor (requires vendor's telegram_id in bot config)

#### 5.2.2 Out-of-Stock Handling

- When stock reaches 0, automatically hide product from shop (or show as "Out of Stock" with wishlist option)
- Admin panel indicator: red badge on products with 0 stock
- Batch restock: allow vendor to update stock for multiple variations at once

### 5.3 Customer Insights

**Current state:** The Users page shows telegram IDs, secret phrases, creation dates. No behavioral data.

**Proposed "Customer Insights" section in admin panel:**

- Customer list with: order count, total spend, last order date, loyalty tier
- Individual customer view: order history, contact messages, wishlist items
- Segments: new customers (first order in last 30d), repeat customers (2+ orders), inactive (no order in 90d), high-value (top 10% by spend)
- Export to CSV

**Implementation:** New page `admin-panel/app/admin/customers/page.tsx` with aggregation queries joining users, orders, and loyalty data.

### 5.4 Promotional Tools

**Current state:** Discount codes exist with percentage/fixed types, date ranges, and usage limits. No flash sales, bundles, or automated promotions.

**Proposed additions:**

#### 5.4.1 Flash Sales

- Time-limited discount that appears as a countdown in the bot
- New collection: `flash_sales` -- `bot_id`, `product_ids`, `discount_percentage`, `starts_at`, `ends_at`, `active`
- Bot shows countdown timer in product detail when flash sale is active
- Push notification when flash sale starts

#### 5.4.2 Product Bundles

- Group multiple products at a discounted bundle price
- New collection: `bundles` -- `bot_id`, `name`, `product_ids`, `bundle_price`, `active`
- Shown in shop under a "Bundles" section
- Add to cart as a single bundle item

#### 5.4.3 Automated Discount Rules

- First-order discount (auto-applied for new customers)
- Minimum spend discount (e.g., 10% off orders over 50 GBP)
- Configure in admin panel without creating manual codes

### 5.5 Automated Responses / FAQ Bot

**Current state:** Vendor messaging is fully manual. Vendor reads messages in admin panel contacts page and there is no response mechanism from admin to customer.

**Proposed changes:**

#### 5.5.1 Vendor Reply from Admin Panel

- Add reply functionality to contacts page (`admin-panel/app/admin/contacts/page.tsx`)
- Vendor types reply in admin panel, it's sent to user via Telegram bot
- Reply stored in `contact_messages` with `sender: "vendor"` field
- Shown in conversation history in bot

#### 5.5.2 Auto-Responses

- Configurable keyword-based auto-replies in bot config
- New field in bot config: `auto_responses: Array<{ keywords: string[], response: string }>`
- When customer message matches keywords, auto-reply is sent immediately
- Still saved to contact_messages so vendor can see the conversation

#### 5.5.3 FAQ System

- Vendor defines FAQ entries in admin panel: `question`, `answer`
- New `/faq` command shows list of questions as inline buttons
- Tapping a question shows the answer
- "Didn't find your answer? Contact vendor" button

### 5.6 Multi-Vendor Marketplace Features

**Current state:** The platform supports multiple bots but each bot is independent. No cross-bot features.

**Proposed changes (Phase 3):**
- Vendor discovery in front-page with category filtering (partially exists)
- Customer can browse multiple vendor bots from a single "hub" bot
- Cross-vendor search (search products across all bots from the hub)
- Shared customer accounts (user's secret phrase works across all bots -- already partially implemented via `first_bot_id`)
- Vendor comparison: side-by-side pricing for similar products

---

## 6. Platform Growth Features

### 6.1 Referral System

#### 6.1.1 Customer Referral

- Each customer gets a unique referral link: `t.me/{botname}?start=ref_{user_id}`
- When a referred user makes their first purchase, both referrer and referee earn bonus points/discount
- Referral tracking: new collection `referrals` -- `referrer_id`, `referee_id`, `bot_id`, `status`, `reward_issued`, `timestamp`
- Configurable rewards per-bot: points, percentage discount on next order, or fixed amount credit

#### 6.1.2 Vendor Referral

- Existing vendors can refer new vendors to the platform
- Referrer earns reduced commission rate (e.g., 8% instead of 10%) for 3 months
- Track via admin panel

### 6.2 Vendor Onboarding Wizard

**Current state:** Creating a bot requires: going to admin panel > creating a bot with token > creating categories > creating subcategories > creating products > configuring messages. Many steps, not guided.

**Proposed wizard flow (admin panel):**

1. **Step 1: Bot Setup** -- Enter BotFather token, bot name. System validates token via Telegram API.
2. **Step 2: Choose Template** -- Select from pre-built templates (see 6.3). Pre-populates categories, button layout, and welcome message.
3. **Step 3: Add Products** -- Guided product creation form. "Add another" flow.
4. **Step 4: Payment Setup** -- Choose payment provider, enter credentials. Test transaction button.
5. **Step 5: Customize** -- Upload profile picture, set description, configure shipping methods.
6. **Step 6: Go Live** -- Review summary, toggle `status: live`, get bot link.

**Implementation:** New multi-step page `admin-panel/app/admin/bots/wizard/page.tsx`

### 6.3 Template System

Pre-built bot configurations:

| Template | Categories | Buttons | Messages |
|---|---|---|---|
| General Store | General, Accessories | Shop, Orders, Contact, About | Generic welcome |
| Food & Drink | Meals, Drinks, Snacks | Menu, My Orders, Contact | Restaurant-style |
| Digital Products | Software, E-books, Courses | Browse, Downloads, Support | Digital delivery |
| Custom | Empty | Empty | Empty |

**Implementation:**
- JSON template files: `admin-panel/templates/{template_name}.json`
- Template selector component in onboarding wizard
- "Apply template" API that populates categories, products (placeholders), and bot config

### 6.4 API for Third-Party Integrations

**Current state:** No public API. Admin panel API routes are internal.

**Proposed public API:**

#### 6.4.1 Vendor API (authenticated per-bot)

- `GET /api/v1/products` -- List products
- `POST /api/v1/products` -- Create product
- `PUT /api/v1/products/:id` -- Update product (including stock)
- `GET /api/v1/orders` -- List orders with filters
- `PUT /api/v1/orders/:id/status` -- Update order status
- `GET /api/v1/analytics/summary` -- Sales summary

**Auth:** API key per bot (new field: `api_key` in bot config), passed via `X-API-Key` header.

#### 6.4.2 Webhook Events (outbound)

- `order.created`, `order.paid`, `order.shipped`, `order.completed`
- `product.stock_low`, `product.out_of_stock`
- Vendor configures webhook URL in admin panel
- Events POSTed as JSON with HMAC signature

**New collection:** `webhook_subscriptions` -- `bot_id`, `url`, `events[]`, `secret`, `active`

### 6.5 Bot Marketplace / Directory Improvements

**Current state:** `front-page/app/page.tsx` shows a flat list of bots with search and sort.

**Proposed improvements:**
- Category pages: `/category/cannabis`, `/category/stimulants` etc.
- Vendor profile pages: `/vendor/{username}` with full product catalog, reviews, stats
- SEO optimization: meta tags, Open Graph, structured data
- Customer reviews aggregated and shown on vendor profile
- "Report" button for flagging suspicious vendors
- Featured vendor rotation (weekly/monthly)

### 6.6 Rating & Reputation System

**Current state:** Bot config has static `rating` and `rating_count` fields (manually set strings). Reviews collection exists but ratings are per-order, not aggregated.

**Proposed changes:**

#### 6.6.1 Dynamic Rating Calculation

- Compute vendor rating from actual reviews: `AVG(reviews.rating) WHERE bot_id = X`
- Update bot's `rating` and `rating_count` fields on each new review (or via scheduled aggregation)
- Display calculated rating in front-page marketplace and in-bot welcome message
- Remove manual rating fields from bot config

#### 6.6.2 Vendor Reputation Score

Composite score based on:
- Average review rating (40% weight)
- Order completion rate (20%)
- Response time to messages (20%)
- Account age and activity (10%)
- Dispute resolution rate (10%)

Display as a badge: Excellent / Good / Average / Below Average

---

## 7. Technical Improvements

### 7.1 Performance Optimization

#### 7.1.1 Shop Handler Decomposition

**Current:** `handlers/shop.py` is 2600+ lines covering 7 distinct feature areas.

**Proposed split:**

| New File | Handlers Moved |
|---|---|
| `handlers/shop_categories.py` | `handle_shop_start`, `handle_category`, `handle_subcategory` |
| `handlers/shop_products.py` | `handle_product`, `handle_product_variation`, product detail rendering |
| `handlers/shop_cart.py` | `handle_add_to_cart`, `handle_view_cart`, `handle_cart_*` |
| `handlers/shop_checkout.py` | `handle_checkout`, `handle_checkout_*` (all checkout steps) |
| `handlers/shop_wishlist.py` | `handle_view_wishlist`, `handle_add_wishlist`, `handle_remove_wishlist` |
| `handlers/shop_reviews.py` | `_render_all_reviews`, `handle_review_*`, `ReviewCommentStates` |
| `handlers/shop_common.py` | `safe_edit_or_send`, `find_by_id`, `safe_split`, `prepare_image_for_telegram`, `get_cart_total_display` |

#### 7.1.2 Database Query Optimization

- Add compound indexes:
  - `orders`: `{ userId: 1, botId: 1, timestamp: -1 }`
  - `carts`: `{ user_id: 1, bot_id: 1 }`
  - `wishlists`: `{ user_id: 1, bot_id: 1 }`
  - `products`: `{ bot_ids: 1, subcategory_id: 1 }`
  - `invoices`: `{ user_id: 1, bot_id: 1, status: 1 }`
- Add text index on `products`: `{ name: "text", description: "text" }` for search
- Refactor `handlers/orders.py` to remove the triple-query pattern (lines 88-100) and use a single `$or` query

#### 7.1.3 Caching Strategy

- Replace process-local bot config cache (`utils/bot_config.py`) with Redis
- Cache product listings (invalidate on product update via admin panel)
- Cache category trees per-bot (invalidate on category change)
- Add `ETag` / `Last-Modified` headers to admin API responses

### 7.2 Scalability Considerations

#### 7.2.1 Multi-Instance Bot Deployment

**Current:** Single Python process, polling mode, MemoryStorage FSM.

**Required for scale:**
1. Switch to webhook mode (code exists but is commented out in `main.py`)
2. Replace `MemoryStorage` with `RedisStorage` (aiogram 3 supports this natively)
3. Replace process-local bot config cache with Redis
4. One process per bot token, or a dispatcher that routes webhooks to the correct bot handler
5. Container orchestration: each bot as a separate container, or a shared "bot runner" service with dynamic token loading

#### 7.2.2 Database Scaling

- MongoDB replica set for read scaling and failover
- Separate read replicas for analytics queries (to avoid impacting transactional performance)
- Consider PostgreSQL for financial data (schema.sql already exists in `database/schema.sql`) for ACID guarantees on payments and commissions
- Sharding strategy: shard by `botId` when collection sizes exceed single-node capacity

#### 7.2.3 Horizontal Scaling Plan

```
Phase 1 (current): Single instance, polling mode
Phase 2: Webhook mode, Redis FSM, 2 bot service replicas behind load balancer
Phase 3: Auto-scaling bot service (k8s HPA), Redis cluster, MongoDB replica set
Phase 4: Multi-region deployment, CDN for front-page and images
```

### 7.3 Security Hardening

#### 7.3.1 Critical Fixes

1. **Change default JWT secret** -- `admin-panel/lib/auth.ts` uses `'local-testing-secret-key-change-in-production'` as fallback. Make this a hard failure in production.
2. **Rate limiting on admin API** -- Add rate limiting middleware to all `/api/*` routes (e.g., 100 req/min for authenticated, 10 req/min for login)
3. **Rate limiting on bot handlers** -- Throttle per-user: max 30 messages/min to prevent abuse
4. **Input validation** -- Add Zod schema validation to all admin API route handlers (currently raw `request.json()`)
5. **CSRF protection** -- Admin panel form submissions should include CSRF tokens
6. **Secure cookie flags** -- Set `HttpOnly`, `Secure`, `SameSite=Strict` on `admin_token` cookie

#### 7.3.2 Encryption Improvements

- `utils/address_encryption.py` uses hardcoded salt (`b'address_encryption_salt'`). Generate random salt per encryption, store alongside ciphertext.
- Add key rotation mechanism: support decrypting with old key while encrypting with new key
- Audit: log all address decryption events with admin user ID and timestamp

#### 7.3.3 Payment Security

- Webhook signature verification for all payment providers (currently only partial in `handlers/payments.py`)
- Idempotency: ensure double-webhook delivery doesn't create duplicate commissions (partially implemented with `$ne` check)
- Amount verification: compare webhook-reported amount against order amount before marking paid

### 7.4 Monitoring & Alerting

**Current state:** Only console `print()` statements for logging. No structured logging, metrics, or alerts.

**Proposed stack:**

#### 7.4.1 Structured Logging

- Replace all `print()` with Python `logging` module with JSON formatter
- Log levels: DEBUG (callback data), INFO (order created, payment received), WARNING (provider fallback), ERROR (exceptions)
- Include `bot_id`, `user_id`, `order_id` in log context for traceability

#### 7.4.2 Metrics

- Prometheus metrics endpoint (`/metrics`) on the aiohttp server
- Key metrics:
  - `orders_total` (counter, by bot_id, status)
  - `payments_total` (counter, by provider, status)
  - `active_users_gauge` (gauge, by bot_id)
  - `handler_duration_seconds` (histogram, by handler name)
  - `webhook_latency_seconds` (histogram, by provider)

#### 7.4.3 Alerting

- PagerDuty or Slack integration for:
  - Payment webhook failures (>5 in 10 minutes)
  - MongoDB connection failures
  - Bot process crashes
  - High error rate (>1% of requests)
  - Disk/memory thresholds

#### 7.4.4 Health Check

- Add `/health` endpoint to bot service (check MongoDB connection, bot token validity)
- Add `/health` to admin panel API (check MongoDB, JWT secret configured)
- Front-page already has `/api/health` route

### 7.5 Backup & Disaster Recovery

#### 7.5.1 MongoDB Backups

- Automated daily `mongodump` to encrypted S3 bucket
- Retention: daily for 30 days, weekly for 6 months, monthly for 2 years
- Point-in-time recovery via MongoDB oplog (requires replica set)
- Monthly backup restoration test

#### 7.5.2 Disaster Recovery Plan

- RPO (Recovery Point Objective): 1 hour (oplog-based)
- RTO (Recovery Time Objective): 4 hours
- Runbook documenting restoration steps
- Encrypted backup of all `.env` files and secrets in a separate vault (e.g., Hashicorp Vault or AWS Secrets Manager)

#### 7.5.3 Data Export

- Admin panel button: "Export all data" (JSON format)
- Per-collection export (already exists as a script: `telegram-bot-service/scripts/export_mongo_to_json.py`)
- GDPR compliance: user data deletion endpoint (`/api/users/:id/delete` with cascade to orders, carts, wishlists, reviews, contact_messages)

---

## 8. In-Bot Analytics & Tracking

### 8.1 Event Tracking

**Current state:** Zero instrumentation beyond console logging.

**Proposed event schema:**

New collection: `events`

```json
{
  "event_type": "product_view",
  "bot_id": "...",
  "user_id": "...",
  "session_id": "...",
  "timestamp": "2026-03-20T14:30:00Z",
  "properties": {
    "product_id": "...",
    "category_id": "...",
    "source": "search|category|recommendation"
  }
}
```

#### 8.1.1 Events to Track

| Event | Trigger Point | Key Properties |
|---|---|---|
| `bot_start` | `handlers/start.py` -- `cmd_start()` | first_time, referral_source |
| `menu_open` | `handlers/start.py` -- `handle_menu_callback()` | -- |
| `shop_open` | `handlers/shop.py` -- `handle_shop_start()` | -- |
| `category_view` | `handlers/shop.py` -- `handle_category()` | category_id, category_name |
| `subcategory_view` | `handlers/shop.py` -- `handle_subcategory()` | subcategory_id, category_id |
| `product_view` | `handlers/shop.py` -- product detail handler | product_id, category_id, source |
| `add_to_cart` | `handlers/shop.py` -- `handle_add_to_cart()` | product_id, variation_index, quantity, price |
| `remove_from_cart` | `handlers/shop.py` -- cart item removal | product_id, quantity |
| `cart_view` | `handlers/shop.py` -- `handle_view_cart()` | item_count, cart_total |
| `checkout_start` | `handlers/shop.py` -- `handle_checkout()` | invoice_id, item_count, total |
| `checkout_discount` | `handlers/shop.py` -- `handle_checkout_discount()` | discount_code, discount_amount |
| `checkout_payment_select` | `handlers/shop.py` -- `handle_checkout_payment_select()` | payment_method |
| `checkout_address` | `handlers/shop.py` -- `handle_checkout_address()` | address_provided (boolean) |
| `checkout_delivery` | `handlers/shop.py` -- `handle_checkout_delivery_select()` | delivery_method |
| `checkout_confirm` | `handlers/shop.py` -- confirm handler | invoice_id, total, payment_method |
| `checkout_abandon` | Detected by worker (no confirm within 1h) | invoice_id, last_step |
| `payment_completed` | `handlers/payments.py` -- webhook handler | order_id, provider, amount |
| `wishlist_add` | `handlers/shop.py` -- wishlist handler | product_id |
| `wishlist_remove` | `handlers/shop.py` -- wishlist handler | product_id |
| `review_submit` | `handlers/shop.py` -- review handler | order_id, rating, has_comment |
| `contact_message` | `handlers/contact.py` -- `handle_contact_message()` | message_length |
| `search_query` | `handlers/search.py` (new) | query, results_count |

#### 8.1.2 Implementation

- **New file:** `telegram-bot-service/services/analytics.py`
- Async event tracking function: `track_event(event_type, bot_id, user_id, properties=None)`
- Non-blocking: use `asyncio.create_task()` to avoid slowing handlers
- Batch inserts: buffer events and flush every 5 seconds or 100 events
- TTL index on events: auto-delete after 90 days (raw events) but aggregate summaries are kept permanently

### 8.2 Funnel Analysis

Using the events from 8.1, build funnel reports in the analytics dashboard:

#### 8.2.1 Purchase Funnel

```
shop_open -> category_view -> product_view -> add_to_cart -> checkout_start -> checkout_confirm -> payment_completed
```

For each step, calculate:
- Total users reaching this step
- Drop-off rate from previous step
- Conversion rate (step / shop_open)

#### 8.2.2 Checkout Funnel (Detailed)

```
checkout_start -> checkout_discount -> checkout_payment_select -> checkout_address -> checkout_delivery -> checkout_confirm
```

Identify which checkout step has the highest abandonment.

#### 8.2.3 Implementation

- Aggregation pipeline queries on `events` collection, grouped by `session_id`
- Pre-computed daily summaries stored in `funnel_summaries` collection
- Display in admin analytics page as a visual funnel chart

### 8.3 Session Tracking

**Current state:** No concept of user sessions.

**Proposed implementation:**

- Session starts on `bot_start` or first interaction after 30 minutes of inactivity
- Session ID: UUID generated per session, stored in FSM state data
- Session stored in `sessions` collection: `session_id`, `user_id`, `bot_id`, `started_at`, `last_activity_at`, `events_count`, `outcome` (purchase/browse/bounce)
- Session timeout: 30 minutes of inactivity

### 8.4 Customer Journey Mapping

Using sessions and events, build journey visualization:

- **Journey map:** Sequence of events per session, aggregated across all users
- **Common paths:** Most frequent event sequences (e.g., "80% of purchasers follow: shop > category > product > cart > checkout")
- **Drop-off analysis:** Where users leave and don't come back
- **Time analysis:** Average time between events (e.g., "users spend 45 seconds on product pages")

**Display:** Admin panel journey visualization page with Sankey diagram showing flow between pages/actions.

---

## 9. Prioritized Roadmap

### Phase 1: Quick Wins (Weeks 1-6)

High impact, low-to-medium effort. Mostly leveraging existing infrastructure.

| # | Feature | Effort | Impact | Files Affected |
|---|---|---|---|---|
| 1.1 | **Shop handler decomposition** (7.1.1) | M | High (unblocks all bot changes) | `handlers/shop.py` -> 7 new files |
| 1.2 | **Unified navigation module** (4.1.1) | S | Medium | New `utils/navigation.py`, refactor 3 handlers |
| 1.3 | **Product search** (4.3.1) | M | High | New `handlers/search.py`, MongoDB text index |
| 1.4 | **Extended order status** (3.1.1) | M | High | `admin-panel/lib/models.ts`, `handlers/orders.py`, new admin API |
| 1.5 | **Vendor reply from admin panel** (5.5.1) | M | High | `admin-panel/app/admin/contacts/page.tsx`, new API route |
| 1.6 | **Quick reorder** (4.4) | S | Medium | `handlers/orders.py`, cart logic |
| 1.7 | **Database indexes** (7.1.2) | S | High (performance) | MongoDB index creation script |
| 1.8 | **Structured logging** (7.4.1) | S | Medium | All Python files (replace print) |
| 1.9 | **Security: JWT secret enforcement** (7.3.1 #1) | S | Critical | `admin-panel/lib/auth.ts` |
| 1.10 | **Security: Rate limiting** (7.3.1 #2-3) | S | High | `admin-panel/middleware.ts`, new bot middleware |
| 1.11 | **Health check endpoints** (7.4.4) | S | Medium | `main.py`, admin panel API |
| 1.12 | **Dynamic vendor rating** (6.6.1) | S | Medium | Aggregation query, bot config update |

**S** = Small (1-3 days), **M** = Medium (3-7 days)

### Phase 2: Medium Effort (Weeks 7-16)

Features requiring new infrastructure or significant new code.

| # | Feature | Effort | Impact | Dependencies |
|---|---|---|---|---|
| 2.1 | **Event tracking system** (8.1) | L | High (enables analytics) | Phase 1.1 |
| 2.2 | **Analytics dashboard** (5.1) | L | High | Phase 2.1 |
| 2.3 | **Push notifications framework** (3.3) | L | High | Redis queue, background worker |
| 2.4 | **Abandoned cart reminders** (3.7.1) | M | High | Phase 2.3 |
| 2.5 | **Wishlist notifications** (3.4) | M | Medium | Phase 2.3 |
| 2.6 | **Saved addresses & payment prefs** (4.6.1-4.6.2) | M | Medium | New collection |
| 2.7 | **Customer profiles** (3.6) | M | Medium | New `handlers/profile.py` |
| 2.8 | **Vendor onboarding wizard** (6.2) | L | High (growth) | Template system |
| 2.9 | **Template system** (6.3) | M | Medium | JSON templates |
| 2.10 | **Product image gallery** (4.7.1) | M | Medium | Model change, handler update |
| 2.11 | **FAQ system** (5.5.3) | M | Medium | New bot config fields |
| 2.12 | **Inventory alerts** (5.2) | M | Medium | Admin panel + notifications |
| 2.13 | **Redis FSM storage** (7.2.1 #2) | M | High (reliability) | Redis deployment |
| 2.14 | **Webhook mode deployment** (7.2.1 #1) | M | High (scalability) | Uncomment `main.py` webhook code |
| 2.15 | **MongoDB backup automation** (7.5.1) | M | Critical | Cron job + S3 |
| 2.16 | **Prometheus metrics** (7.4.2) | M | Medium | New `/metrics` endpoint |
| 2.17 | **Flash sales** (5.4.1) | M | Medium | New collection, handler, admin UI |

**L** = Large (1-3 weeks)

### Phase 3: Major Features (Weeks 17-30)

Strategic features for platform scale and differentiation.

| # | Feature | Effort | Impact | Dependencies |
|---|---|---|---|---|
| 3.1 | **Loyalty & rewards system** (3.2) | XL | High (retention) | Phase 2.1, 2.3 |
| 3.2 | **Referral system** (6.1) | L | High (growth) | Phase 3.1 |
| 3.3 | **Multi-language support** (4.8) | XL | High (market expansion) | i18n framework, translation files |
| 3.4 | **Personalized recommendations** (3.5) | L | Medium | Phase 2.1, aggregation jobs |
| 3.5 | **Funnel analysis & journey mapping** (8.2-8.4) | L | Medium | Phase 2.1, 2.2 |
| 3.6 | **Public API for vendors** (6.4) | L | Medium (ecosystem) | API key auth, rate limiting |
| 3.7 | **Vendor reputation score** (6.6.2) | M | Medium | Phase 2.1 |
| 3.8 | **Product bundles** (5.4.2) | M | Medium | New collection, handler |
| 3.9 | **Post-purchase flows** (3.7.3) | M | Medium | Phase 2.3, 2.4 |
| 3.10 | **Win-back messages** (3.7.2) | M | Medium | Phase 2.3 |
| 3.11 | **Marketplace improvements** (6.5) | L | Medium (SEO, discovery) | Front-page refactor |
| 3.12 | **Customer insights page** (5.3) | L | Medium | Phase 2.1, 2.2 |
| 3.13 | **Inline query support** (4.3.2) | M | Low | Bot API inline mode |
| 3.14 | **Auto-scaling infrastructure** (7.2.3) | XL | High (scale) | k8s, Redis cluster, replica set |
| 3.15 | **Onboarding tour** (4.2) | S | Medium | `handlers/onboarding.py` |

**XL** = Extra Large (3-6 weeks)

### Milestone Summary

| Milestone | Target Date | Key Deliverables |
|---|---|---|
| **M1: Foundation** | Week 6 | Decomposed handlers, search, extended orders, vendor replies, security fixes |
| **M2: Intelligence** | Week 12 | Event tracking, analytics dashboard, notification framework, abandoned cart |
| **M3: Growth** | Week 16 | Onboarding wizard, templates, saved checkout, Redis FSM, webhooks |
| **M4: Retention** | Week 24 | Loyalty system, referrals, recommendations, multi-language |
| **M5: Scale** | Week 30 | Public API, auto-scaling, full funnel analytics, marketplace v2 |

---

## Appendix A: File Reference Map

```
Auroneth.bot/
├── telegram-bot-service/
│   ├── main.py                          # Entry point, dispatcher, middleware
│   ├── handlers/
│   │   ├── start.py                     # /start, verification, welcome, /menu, /about
│   │   ├── shop.py                      # Categories, products, cart, checkout, wishlist, reviews (TO DECOMPOSE)
│   │   ├── menu.py                      # Reply keyboard handlers, command routing
│   │   ├── menu_inline.py              # Catch-all inline callback handler
│   │   ├── orders.py                    # Order listing and detail
│   │   ├── products.py                  # Direct buy handler (legacy)
│   │   ├── payments.py                  # Payment webhook handlers
│   │   ├── payouts.py                   # Payout processing endpoint
│   │   └── contact.py                   # Vendor messaging, PGP keys
│   ├── services/
│   │   ├── payment_provider.py          # Provider selection logic
│   │   ├── shkeeper.py                  # SHKeeper integration
│   │   ├── cryptapi.py                  # CryptAPI integration
│   │   ├── blockonomics.py              # Blockonomics integration
│   │   ├── coinpayments.py              # CoinPayments integration
│   │   └── commission.py                # Commission calculation
│   ├── utils/
│   │   ├── bot_config.py                # Bot config cache and lookup
│   │   ├── address_encryption.py        # AES-256 address encryption
│   │   ├── currency_converter.py        # Fiat/crypto exchange rates
│   │   ├── qr_generator.py             # Payment QR code generation
│   │   ├── invoice_id.py               # Short invoice ID generation
│   │   ├── secret_phrase.py            # Secret phrase generation
│   │   ├── bottom_menu.py             # Menu stats helper
│   │   └── callback_utils.py          # Safe callback answer
│   ├── database/
│   │   ├── connection.py               # MongoDB connection (Motor)
│   │   ├── addresses.py                # Deposit address pool
│   │   └── models.py                   # Type hint stubs
│   └── scripts/                         # Admin/migration scripts
├── admin-panel/
│   ├── app/
│   │   ├── admin/                       # 11 admin pages
│   │   ├── api/                         # 17+ API routes
│   │   ├── login/page.tsx              # Login page
│   │   └── setup/page.tsx              # Initial setup page
│   ├── lib/
│   │   ├── models.ts                    # Mongoose models (7 models)
│   │   ├── db.ts                        # MongoDB connection
│   │   ├── auth.ts                      # JWT auth helpers
│   │   ├── categories.ts               # Category helpers
│   │   ├── address_decryption.ts       # Address decryption
│   │   └── processPayout.ts            # Payout processing
│   └── middleware.ts                    # Auth middleware
├── front-page/
│   ├── app/
│   │   ├── page.tsx                     # Marketplace directory
│   │   └── api/bots/route.ts           # Bot listing API
│   └── lib/
│       ├── db.ts                        # MongoDB connection
│       └── models.ts                    # Bot model (read-only)
└── database/
    └── schema.sql                       # PostgreSQL schema (future use)
```

## Appendix B: New Collections Required

| Collection | Phase | Purpose |
|---|---|---|
| `events` | Phase 2 | User behavior event tracking |
| `sessions` | Phase 2 | Session tracking |
| `notification_queue` | Phase 2 | Async notification delivery |
| `notification_preferences` | Phase 2 | Per-user notification opt-in/out |
| `saved_addresses` | Phase 2 | Encrypted saved delivery addresses |
| `user_preferences` | Phase 2 | Payment/delivery preferences |
| `loyalty_points` | Phase 3 | Points balance and tier |
| `points_transactions` | Phase 3 | Points earn/redeem ledger |
| `referrals` | Phase 3 | Referral tracking |
| `recommendations` | Phase 3 | Pre-computed product recommendations |
| `flash_sales` | Phase 2 | Time-limited promotions |
| `bundles` | Phase 3 | Product bundles |
| `funnel_summaries` | Phase 3 | Pre-aggregated funnel data |
| `webhook_subscriptions` | Phase 3 | Vendor outbound webhook config |
| `auto_responses` | Phase 2 | Keyword-based auto-replies |
| `faqs` | Phase 2 | Vendor FAQ entries |

---

*This document should be treated as a living specification. Update it as features are implemented, priorities shift, or new requirements emerge.*
