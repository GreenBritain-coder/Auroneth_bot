# PRD: Auroneth Web Shop

**Version:** 1.0
**Date:** 2026-03-22
**Status:** Draft
**Author:** Bob (via Claude)

---

## Table of Contents

1. [Overview & Goals](#1-overview--goals)
2. [User Stories](#2-user-stories)
3. [System Architecture](#3-system-architecture)
4. [Data Models](#4-data-models)
5. [Page Inventory](#5-page-inventory)
6. [API Inventory](#6-api-inventory)
7. [Payment Flow](#7-payment-flow)
8. [Security Requirements](#8-security-requirements)
9. [Edge Cases & Error Handling](#9-edge-cases--error-handling)
10. [Implementation Phases](#10-implementation-phases)
11. [Appendix](#11-appendix)

---

## 1. Overview & Goals

### 1.1 What Is Auroneth?

Auroneth is a multi-tenant Telegram bot marketplace. Vendors deploy Telegram bots that sell products with cryptocurrency payments via SHKeeper and CryptAPI. Each vendor has their own bot, product catalog, and payment configuration. All vendors share the same MongoDB instance (`telegram_bot_platform`) and infrastructure deployed via Coolify on `111.90.140.72`.

### 1.2 What Is the Web Shop?

The Web Shop feature adds anonymous, browser-based storefronts to existing vendor bots. When a vendor enables `web_shop_enabled` on their bot, customers can browse products, add to cart, pay with crypto, and track orders entirely in a web browser -- no Telegram account required.

Each web shop lives at `/shop/{bot_slug}` under the existing `front-page` Next.js app.

### 1.3 Goals

| # | Goal | Success Metric |
|---|------|----------------|
| G1 | Expand customer reach beyond Telegram | >0 web orders within 30 days of launch per enabled shop |
| G2 | Maintain full anonymity -- no accounts, no PII | Zero PII fields in web order records |
| G3 | Reuse existing payment and order infrastructure | Web orders use identical order state machine and invoice schema |
| G4 | Keep SHKeeper credentials isolated from the frontend | Zero SHKeeper API keys in Next.js environment or client bundles |
| G5 | Ship incrementally without breaking Telegram bot flow | All 5 phases independently deployable; Telegram flow unaffected |

### 1.4 Non-Goals

- User accounts or login for web customers.
- Fiat payment gateways (Stripe, PayPal, etc.).
- Vendor-facing web shop customization UI (future work; vendors use admin panel).
- Multi-language support (English only for v1).
- Mobile native app.

---

## 2. User Stories

### 2.1 Customer (Web Buyer)

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| C1 | As a customer, I want to browse a vendor's products without Telegram so I can shop from any browser. | Product grid loads at `/shop/{slug}` with categories, images, prices in GBP. |
| C2 | As a customer, I want to filter products by category and subcategory. | Category sidebar/dropdown filters the product grid without full page reload. |
| C3 | As a customer, I want to add products to a cart that persists across page navigation. | Server-side cart tied to httpOnly session cookie; survives refresh and navigation. |
| C4 | As a customer, I want to see real-time cart totals including any commission. | Cart page shows line items, subtotal, 10% commission (labeled "service fee"), and total in GBP. Commission is server-calculated, never exposed as a separate editable field. |
| C5 | As a customer, I want to check out with crypto without creating an account. | Checkout page shows supported coins (queried dynamically from SHKeeper), amount in crypto, and a payment address + QR code. |
| C6 | As a customer, I want to apply a discount code at checkout. | Discount code field validates against `discounts` collection; adjusted total shown before payment address generation. |
| C7 | As a customer, I want to track my order via a unique URL. | After checkout, customer receives a URL `/shop/{slug}/order/{token}` showing order status, payment confirmation, and shipping updates. |
| C8 | As a customer, I want to see product reviews from other buyers. | Product detail page shows reviews from `reviews` collection. |

### 2.2 Vendor (Bot Owner)

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| V1 | As a vendor, I want to enable/disable my web shop with a toggle. | `web_shop_enabled` field on bot config; toggle in admin panel. |
| V2 | As a vendor, I want web orders to appear alongside Telegram orders. | Orders collection includes `source: "web"` field; admin panel filters by source. |
| V3 | As a vendor, I want the same payment providers for web and Telegram. | Web checkout queries the same SHKeeper/CryptAPI config as the Telegram bot. |

### 2.3 Platform Admin

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| A1 | As an admin, I want to see web vs Telegram order volume. | Admin dashboard shows order count/revenue split by `source` field. |
| A2 | As an admin, I want rate limiting on anonymous web endpoints. | IP-based rate limits on all `/api/shop/*` routes; captcha gate before checkout. |

---

## 3. System Architecture

### 3.1 High-Level Diagram

```
+---------------+       +----------------------------------+
|   Browser     |------>|  Next.js front-page (port 3002)  |
|  (Customer)   |<------|  /shop/{slug}/*                  |
+---------------+       |  /api/shop/*                     |
                        +----------+-----------------------+
                                   | Bridge API (HTTP)
                                   v
                        +----------------------------------+
                        |  Python bot service (port 8000)   |
                        |  /api/web/*  (new bridge routes)  |
                        +------+------------------+--------+
                               |                  |
                               v                  v
                        +------------+    +------------+
                        |  SHKeeper  |    |  MongoDB   |
                        |  (crypto)  |    |  (shared)  |
                        +------------+    +------+-----+
                                                 |
                        +------------------------+
                        v
                 +----------------------------------+
                 |  Admin Panel (Next.js)            |
                 |  Product/Order/Bot CRUD           |
                 +----------------------------------+
```

### 3.2 Service Responsibilities

| Service | Directory | Role in Web Shop |
|---------|-----------|-----------------|
| **front-page** | `front-page/` | Product browsing, cart management, checkout UI, order tracking pages. All shop pages are server-rendered (Next.js App Router). Cart stored server-side in MongoDB. |
| **Python bot service** | `telegram-bot-service/` | Bridge API for payment creation, webhook handling, order state machine transitions. Holds SHKeeper API credentials. |
| **Admin panel** | `admin-panel/` | Vendor manages products, views orders (now with `source` filter), toggles `web_shop_enabled`. |
| **SHKeeper** | External | Crypto address generation, blockchain monitoring, payment callbacks. |
| **MongoDB** | `telegram_bot_platform` | Shared data layer. Web shop reads/writes the same collections as Telegram. |

### 3.3 Key Design Decisions

1. **No direct SHKeeper calls from Next.js.** All payment-related requests route through the Python bot service bridge API. This keeps SHKeeper API keys out of the Next.js process entirely (Security requirement S4).

2. **Server-side carts.** Carts are stored in MongoDB with a `session_id` field (UUID from httpOnly cookie). No localStorage. Prices are validated against current product data on every cart read (Improvement #1).

3. **Reuse order state machine.** Web orders enter the same `pending -> paid -> confirmed -> shipped -> delivered -> completed` pipeline. The `source` field distinguishes web from Telegram.

4. **No Telegram deep links for web.** Order tracking uses `/shop/{slug}/order/{token}` with a UUID v4 token. Deep links are not used because they require the Telegram app and trigger mandatory secret phrase verification (Bug #5).

---

## 4. Data Models

### 4.1 Bot Config Additions

**Collection:** `bots`
**File:** `telegram-bot-service/models/bot.py` and `front-page/models/Bot.ts`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `web_shop_enabled` | Boolean | `false` | Enables `/shop/{slug}` storefront |
| `web_shop_slug` | String | (auto from bot name) | URL-safe slug, unique index |
| `web_shop_description` | String | `""` | Shop description for SEO meta and hero section |
| `web_shop_banner_url` | String | `null` | Optional banner image URL |

**Index:** `{ web_shop_slug: 1 }` unique, sparse (only indexed when not null).

### 4.2 Cart Schema (Web Sessions)

**Collection:** `carts`
**File:** `front-page/models/Cart.ts` (new) and `telegram-bot-service/models/cart.py` (extend)

```
{
  _id: ObjectId,
  bot_id: ObjectId,              // which shop
  session_id: String,            // UUID from httpOnly cookie (web)
  user_id: Number | null,        // Telegram user ID (Telegram carts) or null (web)
  items: [
    {
      product_id: ObjectId,
      quantity: Number,
      price_snapshot: Number,    // GBP price at time of add (for stale detection)
      added_at: Date
    }
  ],
  created_at: Date,
  updated_at: Date,
  expires_at: Date               // TTL index, 24h for web sessions
}
```

**Bug #6 fix:** The existing cart schema only supports `user_id` (Telegram integer). Adding `session_id` as an alternative identifier, with a compound index `{ bot_id: 1, session_id: 1 }` for web lookups and `{ bot_id: 1, user_id: 1 }` for Telegram lookups.

**Bug #7 fix:** `user_id` field type changes from strict integer to `Number | null`. Web orders set `user_id: null` and use `session_id` + `web_session_id` for identification. All existing queries filtering by `user_id` must handle null values gracefully.

**Index:** `{ expires_at: 1 }` TTL index (MongoDB auto-deletes expired documents).

### 4.3 Order Schema Additions

**Collection:** `orders`
**File:** `telegram-bot-service/models/order.py`

| Field | Type | Description |
|-------|------|-------------|
| `source` | String, enum `["telegram", "web"]` | Origin of the order |
| `web_session_id` | String (UUID) or `null` | Web session that created this order |
| `order_token` | String (UUID v4) | Unique token for web order tracking URL |
| `address_salt` | String | Random 32-byte hex string for per-order address encryption |
| `display_amount` | Number | Original amount in GBP |
| `fiat_amount` | Number | Converted amount in USD (sent to SHKeeper) |
| `exchange_rate_gbp_usd` | Number | GBP to USD rate locked at checkout time |
| `exchange_rate_usd_crypto` | Number | USD to crypto rate locked at checkout time |
| `crypto_currency` | String | e.g., `"BTC"`, `"LTC"`, `"USDT"` |
| `crypto_amount` | Number | Final crypto amount customer must pay |
| `idempotency_key` | String (UUID) | Client-generated key to prevent duplicate orders |
| `items_snapshot` | Array | Denormalized product data at time of purchase (Improvement #7) |
| `rate_locked_at` | Date | Timestamp when exchange rates were locked |
| `rate_lock_expires_at` | Date | Timestamp when rate lock expires (15 min window) |

**Index:** `{ order_token: 1 }` unique.
**Index:** `{ idempotency_key: 1 }` unique, sparse.
**Index:** `{ web_session_id: 1, bot_id: 1 }` for session-based order lookups.

### 4.4 Invoice Schema Additions

**Collection:** `invoices`

Invoices remain largely unchanged. Add:

| Field | Type | Description |
|-------|------|-------------|
| `source` | String, enum `["telegram", "web"]` | Origin |
| `order_token` | String | Back-reference to order for web tracking |

### 4.5 Product Price Normalization

**Bug #4 fix:** Products have dual price fields (`base_price` and legacy `price`). The API layer must normalize:

```javascript
// front-page/lib/product-utils.ts
export function getProductPrice(product: Product): number {
  return product.base_price ?? product.price ?? 0;
}
```

All web shop API responses must return a single `price` field using this normalization. The underlying documents are not migrated (backward compat with Telegram bot), but the API contract is clean.

---

## 5. Page Inventory

### 5.1 Shop Landing -- `/shop/{slug}`

| Attribute | Detail |
|-----------|--------|
| **URL** | `/shop/{slug}` |
| **Purpose** | Vendor storefront landing page with product grid |
| **Server Component** | Yes (SSR for SEO) |
| **File** | `front-page/app/shop/[slug]/page.tsx` |

**Layout:**
- Hero section: bot name, description, banner image (from `bots` collection).
- Category sidebar (desktop) / dropdown (mobile): from `categories` + `subcategories` filtered by `bot_id`.
- Product grid: cards with image, name, price (GBP), "Add to Cart" button.
- Pagination: cursor-based, 24 products per page.

**API Dependencies:**
- `GET /api/shop/{slug}` -- bot config + metadata
- `GET /api/shop/{slug}/products?category={id}&page={cursor}` -- paginated products
- `GET /api/shop/{slug}/categories` -- category tree

**Interactions:**
- Click category: filters product grid (client-side fetch, URL query param update).
- Click product card: navigates to `/shop/{slug}/product/{productId}`.
- Click "Add to Cart": `POST /api/shop/{slug}/cart` with `{ product_id, quantity: 1 }`.
- Cart icon in header shows item count (read from session cookie server-side, hydrated client-side).

### 5.2 Product Detail -- `/shop/{slug}/product/{productId}`

| Attribute | Detail |
|-----------|--------|
| **URL** | `/shop/{slug}/product/{productId}` |
| **Purpose** | Full product details, images, reviews, add to cart |
| **Server Component** | Yes (SSR for SEO) |
| **File** | `front-page/app/shop/[slug]/product/[productId]/page.tsx` |

**Layout:**
- Product images (gallery if multiple).
- Name, description, price in GBP.
- Stock indicator ("In Stock" / "Low Stock" / "Out of Stock").
- Quantity selector + "Add to Cart" button.
- Reviews section: list of reviews from `reviews` collection, average rating.
- Related products: same category, max 4 cards.

**API Dependencies:**
- `GET /api/shop/{slug}/products/{productId}` -- single product with full details
- `GET /api/shop/{slug}/products/{productId}/reviews` -- paginated reviews
- `POST /api/shop/{slug}/cart` -- add to cart

**Interactions:**
- Quantity selector: 1-10, constrained by available stock.
- "Add to Cart": POST to cart API, toast notification on success.
- If product is out of stock, "Add to Cart" button is disabled.

### 5.3 Cart -- `/shop/{slug}/cart`

| Attribute | Detail |
|-----------|--------|
| **URL** | `/shop/{slug}/cart` |
| **Purpose** | View and manage cart contents, proceed to checkout |
| **Server Component** | Hybrid (SSR initial load, client interactivity) |
| **File** | `front-page/app/shop/[slug]/cart/page.tsx` |

**Layout:**
- Line items: product image thumbnail, name, unit price, quantity selector, line total, remove button.
- Stale price warning: if `price_snapshot` differs from current product price, show banner: "Some prices have changed since you added items. Cart has been updated."
- Discount code input field + "Apply" button.
- Subtotal (GBP).
- Service fee (10% of subtotal, labeled "Service Fee" -- never "Commission").
- Discount (if applied, shown as negative line).
- Total (GBP).
- "Proceed to Checkout" button.

**API Dependencies:**
- `GET /api/shop/{slug}/cart` -- current cart with validated prices
- `PATCH /api/shop/{slug}/cart` -- update item quantity
- `DELETE /api/shop/{slug}/cart/{itemId}` -- remove item
- `POST /api/shop/{slug}/cart/discount` -- validate and apply discount code

**Interactions:**
- Quantity change: PATCH request, re-renders totals.
- Remove item: DELETE request, re-renders cart.
- "Proceed to Checkout": navigates to `/shop/{slug}/checkout`. Blocked if cart is empty or any product is out of stock.

**Bug #3 fix:** The 10% commission is calculated server-side in the cart API response. The client never computes it. The field is labeled "Service Fee" to the customer. The commission value is included in the `fiat_amount` sent to SHKeeper.

### 5.4 Checkout -- `/shop/{slug}/checkout`

| Attribute | Detail |
|-----------|--------|
| **URL** | `/shop/{slug}/checkout` |
| **Purpose** | Select crypto, generate payment address, complete purchase |
| **Server Component** | Hybrid |
| **File** | `front-page/app/shop/[slug]/checkout/page.tsx` |

**Layout:**
- Order summary (read-only): items, subtotal, service fee, discount, total in GBP.
- Crypto selector: buttons/tabs for each available cryptocurrency (queried dynamically from SHKeeper via bridge API).
- After selecting crypto:
  - Equivalent amount in selected crypto.
  - Conversion chain displayed: "GBP {gbp} -> USD {usd} -> {amount} {COIN}".
  - Exchange rate lock timer: "Rate locked for 15:00" countdown.
  - Payment address (text, copyable).
  - QR code encoding `{coin}:{address}?amount={amount}`.
  - "I've sent the payment" button (optional -- payment detection is automatic).
- Captcha gate: displayed before generating payment address (Security requirement S5).

**API Dependencies:**
- `GET /api/shop/{slug}/cart` -- cart validation (redirect to cart if empty/stale)
- `GET /api/shop/{slug}/payment-methods` -- available cryptocurrencies (bridge to Python)
- `POST /api/shop/{slug}/checkout` -- create order + generate payment (bridge to Python)
- `GET /api/shop/{slug}/order/{token}/status` -- poll for payment confirmation

**Interactions:**
- Page load: validate cart, fetch payment methods.
- Select crypto: UI updates to show that coin selected, no API call yet.
- "Pay with {COIN}" button: POST to checkout API with `{ crypto_currency, idempotency_key }`.
  - Server: creates order in MongoDB (`status: pending`), calls Python bridge to create SHKeeper invoice, returns `{ order_token, payment_address, crypto_amount, expires_at }`.
  - Client: displays payment details, starts polling `/order/{token}/status` every 10 seconds.
- On payment detected: redirect to `/shop/{slug}/order/{token}`.
- On rate lock expiry: show "Rate expired" message, offer to refresh rate.

**Bug #2 fix:** Payment methods are NOT read from static bot config. The checkout page calls `GET /api/shop/{slug}/payment-methods` which proxies to the Python bridge, which queries SHKeeper's `/api/v1/crypto` endpoint to get currently available wallets.

**Bug #10 fix:** Exchange rate is locked at the moment the customer clicks "Pay with {COIN}". The rate, locked timestamp, and 15-minute expiry are stored on the order. If the customer doesn't pay within 15 minutes, the order expires and they must re-initiate checkout.

### 5.5 Order Tracking -- `/shop/{slug}/order/{token}`

| Attribute | Detail |
|-----------|--------|
| **URL** | `/shop/{slug}/order/{token}` |
| **Purpose** | Post-purchase order status page |
| **Server Component** | Yes (SSR initial, client polling) |
| **File** | `front-page/app/shop/[slug]/order/[token]/page.tsx` |

**Layout:**
- Order status badge (Pending Payment / Paid / Confirmed / Shipped / Delivered / Completed / Expired / Cancelled).
- Status timeline: visual step indicator showing progression.
- Order details: items, quantities, prices at time of purchase (from `items_snapshot`).
- Payment details: crypto amount, coin, transaction confirmations (if applicable).
- Shipping information (if vendor added tracking).
- If pending: payment address + QR code + countdown timer.
- Bookmark prompt: "Save this URL to check your order status later."

**API Dependencies:**
- `GET /api/shop/{slug}/order/{token}` -- full order details
- `GET /api/shop/{slug}/order/{token}/status` -- lightweight status poll

**Interactions:**
- If `status === "pending"`: show payment details, poll every 10s.
- If `status === "paid"`: show "Payment received, waiting for confirmations."
- Auto-refresh on status change.

**Bug #5 fix:** This page replaces Telegram deep links entirely for web orders. No `/start` command, no secret phrase verification.

### 5.6 Shop Not Found / Disabled -- `/shop/{slug}` (error state)

| Attribute | Detail |
|-----------|--------|
| **File** | `front-page/app/shop/[slug]/not-found.tsx` |

**Shown when:**
- `slug` doesn't match any bot.
- Bot exists but `web_shop_enabled === false`.

**Layout:** "This shop is not available" message with link back to bot directory.

---

## 6. API Inventory

All web shop API routes live under `/api/shop/` in the Next.js `front-page` app.
File location: `front-page/app/api/shop/[slug]/`

### 6.1 Shop Config

```
GET /api/shop/{slug}
```

| Attribute | Detail |
|-----------|--------|
| **Auth** | None (public) |
| **Rate Limit** | 60 req/min per IP |
| **Source File** | `front-page/app/api/shop/[slug]/route.ts` |

**Response 200:**
```json
{
  "shop": {
    "name": "Vendor Store",
    "slug": "vendor-store",
    "description": "...",
    "banner_url": "https://...",
    "categories_count": 5,
    "products_count": 42
  }
}
```

**Response 404:** `{ "error": "Shop not found or disabled" }`

**Logic:**
1. Query `bots` where `web_shop_slug === slug && web_shop_enabled === true`.
2. Return sanitized config (no API keys, no internal fields).

### 6.2 Categories

```
GET /api/shop/{slug}/categories
```

| Attribute | Detail |
|-----------|--------|
| **Auth** | None |
| **Rate Limit** | 60 req/min per IP |
| **Source File** | `front-page/app/api/shop/[slug]/categories/route.ts` |

**Response 200:**
```json
{
  "categories": [
    {
      "_id": "...",
      "name": "Electronics",
      "subcategories": [
        { "_id": "...", "name": "Phones" }
      ]
    }
  ]
}
```

### 6.3 Products (List)

```
GET /api/shop/{slug}/products?category={id}&subcategory={id}&cursor={lastId}&limit=24
```

| Attribute | Detail |
|-----------|--------|
| **Auth** | None |
| **Rate Limit** | 60 req/min per IP |
| **Source File** | `front-page/app/api/shop/[slug]/products/route.ts` |

**Response 200:**
```json
{
  "products": [
    {
      "_id": "...",
      "name": "Product Name",
      "price": 29.99,
      "currency": "GBP",
      "image_url": "...",
      "stock": 15,
      "in_stock": true
    }
  ],
  "next_cursor": "64f..."
}
```

**Bug #4 fix:** The `price` field in the response is normalized from `base_price ?? price`. The raw dual fields are never exposed.

### 6.4 Product Detail

```
GET /api/shop/{slug}/products/{productId}
```

| Attribute | Detail |
|-----------|--------|
| **Auth** | None |
| **Rate Limit** | 60 req/min per IP |
| **Source File** | `front-page/app/api/shop/[slug]/products/[productId]/route.ts` |

**Response 200:**
```json
{
  "product": {
    "_id": "...",
    "name": "...",
    "description": "...",
    "price": 29.99,
    "currency": "GBP",
    "images": ["..."],
    "stock": 15,
    "in_stock": true,
    "category": { "_id": "...", "name": "..." },
    "subcategory": { "_id": "...", "name": "..." }
  }
}
```

### 6.5 Product Reviews

```
GET /api/shop/{slug}/products/{productId}/reviews?cursor={lastId}&limit=10
```

| Attribute | Detail |
|-----------|--------|
| **Auth** | None |
| **Rate Limit** | 30 req/min per IP |
| **Source File** | `front-page/app/api/shop/[slug]/products/[productId]/reviews/route.ts` |

**Response 200:**
```json
{
  "reviews": [
    {
      "rating": 5,
      "text": "Great product!",
      "created_at": "2026-03-20T..."
    }
  ],
  "average_rating": 4.5,
  "total_reviews": 23,
  "next_cursor": "64f..."
}
```

**Note:** Reviewer identifiers are stripped. No usernames, no Telegram IDs.

### 6.6 Cart -- Get

```
GET /api/shop/{slug}/cart
```

| Attribute | Detail |
|-----------|--------|
| **Auth** | Session cookie (httpOnly) |
| **Rate Limit** | 30 req/min per IP |
| **Source File** | `front-page/app/api/shop/[slug]/cart/route.ts` |

**Response 200:**
```json
{
  "cart": {
    "items": [
      {
        "product_id": "...",
        "name": "...",
        "price": 29.99,
        "price_changed": false,
        "quantity": 2,
        "line_total": 59.98,
        "in_stock": true
      }
    ],
    "subtotal": 59.98,
    "service_fee": 6.00,
    "discount": 0,
    "total": 65.98,
    "currency": "GBP",
    "item_count": 2,
    "has_stale_prices": false,
    "has_out_of_stock": false
  }
}
```

**Logic:**
1. Read `session_id` from httpOnly cookie.
2. Fetch cart from MongoDB by `{ bot_id, session_id }`.
3. For each item, look up current product price and stock.
4. If `price_snapshot !== current_price`, set `price_changed: true` and update snapshot.
5. Calculate `service_fee` as `Math.ceil(subtotal * 0.10 * 100) / 100` (round up to nearest penny).
6. Return validated cart.

### 6.7 Cart -- Add Item

```
POST /api/shop/{slug}/cart
```

| Attribute | Detail |
|-----------|--------|
| **Auth** | Session cookie |
| **Rate Limit** | 20 req/min per IP |
| **Source File** | `front-page/app/api/shop/[slug]/cart/route.ts` |

**Request:**
```json
{
  "product_id": "...",
  "quantity": 1
}
```

**Response 200:** Updated cart (same schema as GET).

**Logic:**
1. Validate `product_id` exists, belongs to this bot, is in stock.
2. Server looks up current price (Security requirement S3 -- client never sends price).
3. Upsert item in cart: if product already in cart, increment quantity.
4. Enforce max quantity per item (10) and max cart items (50).
5. Set `price_snapshot` to current price, `added_at` to now.

### 6.8 Cart -- Update Quantity

```
PATCH /api/shop/{slug}/cart
```

**Request:**
```json
{
  "product_id": "...",
  "quantity": 3
}
```

**Response 200:** Updated cart.

**Logic:** If `quantity === 0`, remove item. Otherwise update. Validate stock.

### 6.9 Cart -- Remove Item

```
DELETE /api/shop/{slug}/cart/{productId}
```

**Response 200:** Updated cart.

### 6.10 Cart -- Apply Discount

```
POST /api/shop/{slug}/cart/discount
```

**Request:**
```json
{
  "code": "SAVE10"
}
```

**Response 200:** Updated cart with discount applied.
**Response 400:** `{ "error": "Invalid or expired discount code" }`

**Logic:**
1. Query `discounts` collection for matching code, valid date range, usage limit.
2. Apply to cart: percentage or fixed amount.
3. Store `discount_code` and `discount_amount` on cart document.

### 6.11 Payment Methods

```
GET /api/shop/{slug}/payment-methods
```

| Attribute | Detail |
|-----------|--------|
| **Auth** | None |
| **Rate Limit** | 20 req/min per IP |
| **Source File** | `front-page/app/api/shop/[slug]/payment-methods/route.ts` |

**Response 200:**
```json
{
  "methods": [
    { "currency": "BTC", "name": "Bitcoin", "icon": "btc" },
    { "currency": "LTC", "name": "Litecoin", "icon": "ltc" },
    { "currency": "USDT", "name": "Tether (TRC20)", "icon": "usdt" }
  ]
}
```

**Logic:**
1. Read bot's payment config from `bots` collection to get SHKeeper wallet IDs.
2. Call Python bridge: `GET http://bot-service:8000/api/web/{bot_id}/payment-methods`.
3. Python bridge calls SHKeeper `GET /api/v1/crypto` to get available wallets.
4. Return intersection of bot's configured coins and SHKeeper's available wallets.

### 6.12 Checkout -- Create Order

```
POST /api/shop/{slug}/checkout
```

| Attribute | Detail |
|-----------|--------|
| **Auth** | Session cookie |
| **Rate Limit** | 5 req/min per IP |
| **CSRF** | Required (S7) |
| **Captcha** | Required (S5) |
| **Source File** | `front-page/app/api/shop/[slug]/checkout/route.ts` |

**Request:**
```json
{
  "crypto_currency": "BTC",
  "idempotency_key": "uuid-v4-client-generated",
  "captcha_token": "..."
}
```

**Response 200:**
```json
{
  "order_token": "uuid-v4",
  "status": "pending",
  "payment": {
    "address": "bc1q...",
    "amount": "0.00123456",
    "currency": "BTC",
    "qr_data": "bitcoin:bc1q...?amount=0.00123456",
    "expires_at": "2026-03-22T12:30:00Z"
  },
  "conversion": {
    "display_amount": 65.98,
    "display_currency": "GBP",
    "fiat_amount": 83.42,
    "fiat_currency": "USD",
    "rate_gbp_usd": 1.2642,
    "rate_usd_crypto": 67543.21,
    "locked_at": "2026-03-22T12:15:00Z",
    "expires_at": "2026-03-22T12:30:00Z"
  },
  "tracking_url": "/shop/vendor-store/order/uuid-v4"
}
```

**Response 409:** `{ "error": "Order already created", "order_token": "..." }` (idempotency hit)

**Logic (step by step):**

1. Validate captcha token.
2. Check idempotency: query `orders` by `{ idempotency_key }`. If exists, return existing order.
3. Validate session cart: fetch cart, verify all items in stock, re-validate prices.
4. **Stock reservation:** For each item, atomic `db.products.findOneAndUpdate({ _id, stock: { $gte: qty } }, { $inc: { stock: -qty } })`. If any fails, rollback all decrements and return 409.
5. Calculate totals server-side:
   - `subtotal` = sum of (current_price * quantity).
   - `service_fee` = ceil(subtotal * 0.10, 2).
   - `discount` = applied discount amount.
   - `display_amount` = subtotal + service_fee - discount (GBP).
6. Fetch exchange rate GBP to USD (from configured rate source).
7. `fiat_amount` = display_amount * gbp_usd_rate (USD).
8. Generate `order_token` (UUID v4), `address_salt` (32 random hex bytes).
9. Create order document in MongoDB with `status: "pending"`, all amounts, snapshots.
10. **Async payment creation:** Call Python bridge `POST http://bot-service:8000/api/web/{bot_id}/create-invoice` with `{ order_id, fiat_amount, crypto_currency, address_salt }`.
11. Python bridge calls SHKeeper to generate payment address.
12. Update order with payment address, crypto amount, expiry.
13. Clear the session cart.
14. Return response.

**If SHKeeper is down (steps 10-12 fail):**
- Order is still created in MongoDB with `status: "pending_payment_setup"`.
- Response includes `order_token` but no payment address.
- Background retry picks up orders in `pending_payment_setup` state.
- Frontend polls `/order/{token}/status` and shows "Setting up payment..." until address is ready.

### 6.13 Order Status (Lightweight Poll)

```
GET /api/shop/{slug}/order/{token}/status
```

| Attribute | Detail |
|-----------|--------|
| **Auth** | None (token is secret) |
| **Rate Limit** | 30 req/min per IP |
| **Source File** | `front-page/app/api/shop/[slug]/order/[token]/status/route.ts` |

**Response 200:**
```json
{
  "status": "pending",
  "payment_received": false,
  "confirmations": 0,
  "updated_at": "2026-03-22T12:16:00Z"
}
```

### 6.14 Order Detail

```
GET /api/shop/{slug}/order/{token}
```

| Attribute | Detail |
|-----------|--------|
| **Auth** | None (token is secret) |
| **Rate Limit** | 20 req/min per IP |
| **Source File** | `front-page/app/api/shop/[slug]/order/[token]/route.ts` |

**Response 200:** Full order details including `items_snapshot`, payment info, status timeline, shipping info.

### 6.15 Session Init

```
POST /api/shop/session
```

| Attribute | Detail |
|-----------|--------|
| **Auth** | None |
| **Rate Limit** | 10 req/min per IP |
| **Source File** | `front-page/app/api/shop/session/route.ts` |

**Logic:** If no session cookie exists, generate UUID v4, set as httpOnly/Secure/SameSite=Strict cookie with 24h expiry. Called automatically by Next.js middleware on first shop page visit.

---

### 6.16 Python Bridge API Endpoints

These endpoints live in the Python bot service and are called only by the Next.js backend (server-to-server). They are NOT exposed to browsers.

**File:** `telegram-bot-service/api/web_bridge.py` (new file)

#### Bridge: Payment Methods

```
GET http://bot-service:8000/api/web/{bot_id}/payment-methods
```

**Auth:** Internal API key (env `BRIDGE_API_KEY`, validated via `X-Bridge-Key` header).

**Logic:**
1. Load bot config from MongoDB.
2. Call SHKeeper `GET /api/v1/crypto` with bot's SHKeeper API key.
3. Return available wallets.

#### Bridge: Create Invoice

```
POST http://bot-service:8000/api/web/{bot_id}/create-invoice
```

**Auth:** `X-Bridge-Key` header.

**Request:**
```json
{
  "order_id": "...",
  "fiat_amount": 83.42,
  "crypto_currency": "BTC",
  "address_salt": "a1b2c3...",
  "callback_url": "http://bot-service:8000/api/web/webhook/payment"
}
```

**Response 200:**
```json
{
  "payment_address": "bc1q...",
  "crypto_amount": "0.00123456",
  "invoice_id": "...",
  "expires_at": "2026-03-22T12:30:00Z"
}
```

**Logic:**
1. Call SHKeeper `POST /api/v1/wallet/{crypto}/invoice` to generate payment address.
2. Encrypt address using `SHA256(SYSTEM_KEY + address_salt)` as encryption key (Security S1).
3. Create invoice document in MongoDB.
4. Return payment details.

**Bug #1 fix:** Address encryption no longer uses per-user secret phrase. Instead, each order has a unique `address_salt` (random 32 hex bytes), and the encryption key is derived as `SHA256(SYSTEM_KEY + address_salt)` where `SYSTEM_KEY` is an environment variable on the Python service. Web users never need to know or manage a secret phrase.

#### Bridge: Payment Webhook

```
POST http://bot-service:8000/api/web/webhook/payment
```

**Auth:** HMAC validation from SHKeeper (Security S6).

**Logic:**
1. Validate HMAC signature using SHKeeper API key.
2. Check idempotency: if this webhook `transaction_id` was already processed, return 200 (no-op).
3. Update invoice status.
4. Update order status: `pending -> paid`.
5. If order was already expired, handle partial payment scenario (see Edge Cases).

**Bug #9 fix:** Webhook endpoint listens on the Python service's actual `PORT` env var. The route is registered explicitly in the FastAPI/Flask app, not relying on port forwarding that may mismatch.

---

## 7. Payment Flow

### 7.1 End-to-End Sequence

```
Step  Actor              Action
----  -----              ------
 1    Customer           Browses /shop/{slug}, adds items to cart
 2    Next.js            Stores cart in MongoDB with session_id
 3    Customer           Clicks "Proceed to Checkout"
 4    Next.js            GET /api/shop/{slug}/payment-methods
 5    Next.js            -> Python bridge GET /api/web/{bot_id}/payment-methods
 6    Python             -> SHKeeper GET /api/v1/crypto
 7    SHKeeper           Returns available wallets
 8    Python             Returns filtered methods to Next.js
 9    Next.js            Returns methods to browser
10    Customer           Selects BTC, solves captcha, clicks "Pay with BTC"
11    Browser            POST /api/shop/{slug}/checkout
                         { crypto_currency: "BTC", idempotency_key: "...", captcha_token: "..." }
12    Next.js            Validates captcha, checks idempotency
13    Next.js            Validates cart, checks stock
14    Next.js            Atomic stock decrement for each item
15    Next.js            Calculates totals: subtotal + 10% fee - discount = GBP total
16    Next.js            Fetches GBP->USD rate, calculates fiat_amount in USD
17    Next.js            Generates order_token (UUID v4), address_salt (random)
18    Next.js            Creates order in MongoDB (status: "pending")
19    Next.js            -> Python bridge POST /api/web/{bot_id}/create-invoice
20    Python             Derives encryption key: SHA256(SYSTEM_KEY + address_salt)
21    Python             -> SHKeeper POST /api/v1/wallet/BTC/invoice { amount: fiat_amount_usd }
22    SHKeeper           Generates payment address, starts monitoring blockchain
23    Python             Creates invoice in MongoDB, returns address + crypto_amount
24    Next.js            Updates order with payment details
25    Next.js            Clears session cart
26    Next.js            Returns order_token, payment address, QR, tracking URL to browser
27    Customer           Sends BTC to displayed address
28    SHKeeper           Detects incoming transaction on blockchain
29    SHKeeper           -> POST /api/web/webhook/payment (to Python)
30    Python             Validates HMAC, checks idempotency
31    Python             Updates invoice: paid
32    Python             Updates order: pending -> paid
33    Browser            Polling GET /order/{token}/status detects status change
34    Browser            Shows "Payment received!"
35    Vendor             (Via admin panel or Telegram) Ships order, updates status
36    Customer           Checks /shop/{slug}/order/{token} for shipping updates
```

### 7.2 Fiat Conversion Chain

All prices are displayed to the customer in GBP. SHKeeper expects USD. Crypto amounts are derived from USD.

```
GBP (display_amount)
  x exchange_rate_gbp_usd
  = USD (fiat_amount)      <-- sent to SHKeeper
  / exchange_rate_usd_crypto
  = CRYPTO (crypto_amount) <-- shown to customer, SHKeeper generates address for this amount
```

**All three values and both rates are stored on the order document.** This ensures auditability regardless of future rate changes.

**Rate source:** The GBP to USD rate is fetched from a reliable API (e.g., exchangerate-api.com or Open Exchange Rates) at checkout time. The USD to crypto rate comes from SHKeeper's response (it uses its own rate source when generating invoices).

### 7.3 Rate Lock Window

- Lock duration: **15 minutes** from order creation.
- Stored as `rate_locked_at` and `rate_lock_expires_at` on the order.
- If the customer does not pay within 15 minutes:
  - Order transitions to `expired`.
  - Stock is restored (atomic increment).
  - Customer can re-initiate checkout (new order, new rates, new address).

---

## 8. Security Requirements

### S1: Per-Order Address Encryption

**Problem (Bug #1):** The Telegram bot uses a per-user "secret phrase" to derive encryption keys for payment addresses. Web users have no secret phrase.

**Solution:** Each web order generates a random 32-byte hex `address_salt`. The encryption key is:

```
key = SHA256(SYSTEM_KEY + address_salt)
```

Where `SYSTEM_KEY` is an environment variable on the Python bot service only. The `address_salt` is stored on the order document. This provides:
- Unique key per order (no key reuse).
- No customer input required.
- SYSTEM_KEY never leaves the Python service.

### S2: Session Cookie Security

Session tokens are set as cookies with:
- `httpOnly: true` -- no JavaScript access.
- `Secure: true` -- HTTPS only.
- `SameSite: Strict` -- no cross-site requests.
- `Max-Age: 86400` -- 24-hour expiry.
- `Path: /shop` -- scoped to shop routes only.

Implementation in Next.js middleware:
```typescript
// front-page/middleware.ts
response.cookies.set('shop_session', sessionId, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 86400,
  path: '/shop'
});
```

### S3: Server-Side Price Authority

The checkout API accepts only:
- `product_id` and `quantity` (for cart operations).
- `crypto_currency` and `idempotency_key` (for checkout).

Prices are ALWAYS looked up server-side from the `products` collection. The client never sends prices. This prevents price manipulation attacks.

### S4: SHKeeper API Key Isolation

- SHKeeper API keys exist ONLY in the Python bot service environment.
- Next.js calls the Python bridge API using an internal `BRIDGE_API_KEY`.
- The `BRIDGE_API_KEY` is a separate secret, not the SHKeeper key.
- Next.js `.env` and client bundles contain zero SHKeeper credentials.

### S5: Rate Limiting & Captcha

| Endpoint Group | Rate Limit | Captcha |
|----------------|-----------|---------|
| Product browsing (GET) | 60 req/min/IP | No |
| Cart operations | 20-30 req/min/IP | No |
| Checkout | 5 req/min/IP | Yes |
| Order status | 30 req/min/IP | No |
| Session init | 10 req/min/IP | No |

Rate limiting implementation: use `next-rate-limit` or custom middleware with Redis/in-memory store in `front-page/middleware.ts`.

Captcha: hCaptcha (privacy-focused, no Google dependency). Validate server-side before processing checkout.

### S6: Webhook Validation

SHKeeper payment webhooks to the Python bridge must be validated:
1. **HMAC signature:** Verify `X-SHKeeper-Signature` header using the SHKeeper API key.
2. **Idempotency:** Store `transaction_id` in a `processed_webhooks` set/collection. Skip duplicates.
3. **Source IP whitelist:** Optional -- restrict webhook endpoint to SHKeeper server IPs.

### S7: CSRF Protection (Bug #8)

All state-changing endpoints (`POST`, `PATCH`, `DELETE`) require a CSRF token:
- Token generated on session init, stored server-side.
- Sent in `X-CSRF-Token` header on all mutating requests.
- Validated in Next.js middleware.

### S8: Input Validation

All API inputs validated with Zod schemas:
- `product_id`: valid MongoDB ObjectId string.
- `quantity`: integer, 1-10.
- `crypto_currency`: enum of supported coins.
- `idempotency_key`: UUID v4 format.
- `discount code`: alphanumeric, max 32 chars.

---

## 9. Edge Cases & Error Handling

### EC1: SHKeeper Downtime During Checkout

**Scenario:** Customer clicks "Pay with BTC" but SHKeeper is unreachable.

**Handling:**
1. Order is created in MongoDB with `status: "pending_payment_setup"`.
2. Stock is reserved (decremented).
3. Response to client: `{ order_token, status: "pending_payment_setup", retry_after: 30 }`.
4. Frontend shows: "Setting up your payment. This may take a moment..."
5. Background job in Python service retries SHKeeper invoice creation every 30 seconds, up to 5 attempts.
6. If all retries fail after 5 minutes: order transitions to `failed`, stock is restored, customer is prompted to try again.
7. Frontend polls `/order/{token}/status` and transitions UI when payment details become available.

### EC2: Exchange Rate Changes Mid-Checkout

**Scenario:** Customer is on checkout page, rate changes significantly before they click "Pay".

**Handling:**
- Rates are NOT fetched until the customer clicks "Pay with {COIN}".
- At that moment, rates are locked and stored on the order.
- The 15-minute lock window begins.
- If the lock expires, the order expires and customer must re-initiate (getting fresh rates).
- Rate displayed on checkout page before clicking "Pay" is indicative only (shown with disclaimer: "Final rate locked when you confirm payment").

### EC3: Duplicate Browser Tab Checkout

**Scenario:** Customer opens checkout in two tabs and clicks "Pay" in both.

**Handling:**
- The `idempotency_key` is generated client-side (stored in sessionStorage) and sent with the checkout POST.
- Second request with same `idempotency_key` returns 409 with the existing order's `order_token`.
- Frontend redirects to the existing order tracking page.
- Stock is only decremented once.

### EC4: Product Deleted / Price Changed After Adding to Cart

**Scenario:** Vendor changes product price or deletes product while customer has it in cart.

**Handling:**
- Every `GET /api/shop/{slug}/cart` call validates items against current product data.
- If price changed: `price_changed: true` flag set, `price_snapshot` updated to current price, banner shown.
- If product deleted or out of stock: item flagged as `unavailable: true`, "Proceed to Checkout" blocked until removed.
- At checkout time: final validation. If any item is invalid, checkout fails with specific error.

### EC5: Partial Payment

**Scenario:** Customer sends less crypto than required.

**Handling:**
- SHKeeper detects partial payment and sends webhook with partial amount.
- Order remains in `pending` status.
- Python bridge updates order with `partial_payment: true` and `amount_received`.
- Order tracking page shows: "Partial payment received ({amount}/{total}). Please send the remaining {remainder}."
- If remaining amount arrives before expiry, order transitions to `paid`.
- If order expires with partial payment: vendor handles manually via admin panel (refund or complete).

### EC6: Payment After Order Expiry

**Scenario:** Customer sends payment after the 15-minute window.

**Handling:**
- SHKeeper still detects the payment and sends webhook.
- Python bridge checks order status. If `expired`:
  - Log the late payment with full details.
  - Mark order as `expired_with_payment`.
  - Vendor is notified via Telegram bot and admin panel.
  - Vendor manually resolves: honor the order at old rate, or initiate refund.
- No automatic processing of late payments (rate may have changed significantly).

### EC7: Multiple Concurrent Customers, Limited Stock

**Scenario:** 3 customers try to buy the last 2 units simultaneously.

**Handling:**
- Stock decrement is atomic: `findOneAndUpdate({ _id, stock: { $gte: qty } }, { $inc: { stock: -qty } })`.
- First two succeed, third gets `{ error: "Insufficient stock", available: 0 }`.
- If a succeeding customer's order expires (no payment), stock is restored atomically.
- Cart page shows real-time stock (fetched on each cart GET).

### EC8: Bot Container Redeployment During Active Orders

**Scenario:** Coolify redeploys the Python bot service while orders are pending.

**Handling:**
- Orders are in MongoDB (persistent), not in-memory.
- SHKeeper webhooks will retry on failure (HTTP 5xx triggers SHKeeper retry logic).
- On Python service startup: query for orders in `pending_payment_setup` state and retry SHKeeper invoice creation.
- On startup: query for any webhook events received during downtime (SHKeeper logs).
- Graceful shutdown: finish processing in-flight webhook before container stops.

### EC9: Web Shop Enabled But No Payment Providers Configured

**Scenario:** Vendor enables `web_shop_enabled` but has no SHKeeper wallets configured.

**Handling:**
- `GET /api/shop/{slug}/payment-methods` returns empty array.
- Checkout page shows: "This shop is not accepting payments at the moment. Please try again later."
- "Proceed to Checkout" button on cart page is disabled.
- Admin panel shows warning on bot config: "Web shop is enabled but no payment methods are configured."

### EC10: Session Cookie Expiry Mid-Checkout

**Scenario:** Customer's 24-hour session expires while on checkout page.

**Handling:**
- Checkout POST fails with 401 (no valid session).
- Frontend detects 401, re-initializes session (POST `/api/shop/session`).
- Cart is lost (linked to old session). Customer is redirected to empty cart with message: "Your session expired. Please add items again."
- Mitigation: if an order was already created (pre-payment), the `order_token` is still valid and accessible directly.

---

## 10. Implementation Phases

### Phase 1: Bot Config & Data Layer

**Duration:** 3-5 days
**Dependencies:** None
**Goal:** Enable vendors to toggle web shops; expose product/category data via API.

**Tasks:**

| # | Task | File(s) | Details |
|---|------|---------|---------|
| 1.1 | Add `web_shop_enabled`, `web_shop_slug`, `web_shop_description`, `web_shop_banner_url` to bot schema | `telegram-bot-service/models/bot.py`, `front-page/models/Bot.ts`, `admin-panel/models/Bot.ts` | Migration: set `web_shop_enabled: false` on all existing bots. |
| 1.2 | Add web shop toggle to admin panel | `admin-panel/app/bots/[id]/page.tsx` | Toggle switch, slug auto-generation from bot name, slug uniqueness validation. |
| 1.3 | Create product API routes | `front-page/app/api/shop/[slug]/products/route.ts`, `front-page/app/api/shop/[slug]/products/[productId]/route.ts` | Normalize price field (Bug #4). Include stock, images, category. |
| 1.4 | Create category API route | `front-page/app/api/shop/[slug]/categories/route.ts` | Return tree of categories to subcategories for a given bot. |
| 1.5 | Create shop config API route | `front-page/app/api/shop/[slug]/route.ts` | Return public bot info. 404 if disabled. |
| 1.6 | Create price normalization utility | `front-page/lib/product-utils.ts` | `getProductPrice()` function handling `base_price` vs `price` (Bug #4). |
| 1.7 | Add MongoDB indexes | Migration script | `{ web_shop_slug: 1 }` unique sparse on `bots`. |

**Verification Criteria:**
- `GET /api/shop/{slug}` returns bot info for enabled shop, 404 for disabled.
- `GET /api/shop/{slug}/products` returns paginated products with normalized prices.
- `GET /api/shop/{slug}/categories` returns correct category tree.
- Admin panel toggle updates `web_shop_enabled` in database.
- All existing Telegram bot functionality unaffected.

---

### Phase 2: Shop Frontend & Server-Side Cart

**Duration:** 5-7 days
**Dependencies:** Phase 1 complete
**Goal:** Browsable storefront with functional server-side cart.

**Tasks:**

| # | Task | File(s) | Details |
|---|------|---------|---------|
| 2.1 | Session middleware | `front-page/middleware.ts` | Auto-create session cookie on `/shop/*` routes. httpOnly, Secure, SameSite=Strict. |
| 2.2 | Cart model & schema | `front-page/models/Cart.ts` | With `session_id`, `items`, `expires_at`. TTL index. (Bug #6 fix) |
| 2.3 | Cart API routes | `front-page/app/api/shop/[slug]/cart/route.ts` | GET, POST, PATCH, DELETE. Server-side price validation. |
| 2.4 | Cart discount route | `front-page/app/api/shop/[slug]/cart/discount/route.ts` | Validate discount codes against `discounts` collection. |
| 2.5 | Shop landing page | `front-page/app/shop/[slug]/page.tsx` | SSR product grid, category filter, hero section. Dark theme consistent with existing front-page. |
| 2.6 | Product detail page | `front-page/app/shop/[slug]/product/[productId]/page.tsx` | Full product view, reviews, add-to-cart. |
| 2.7 | Cart page | `front-page/app/shop/[slug]/cart/page.tsx` | Line items, quantity controls, service fee display, discount input. |
| 2.8 | Shop layout | `front-page/app/shop/[slug]/layout.tsx` | Shared header with cart icon + item count, footer. |
| 2.9 | Reviews API route | `front-page/app/api/shop/[slug]/products/[productId]/reviews/route.ts` | Paginated reviews, stripped of user identifiers. |
| 2.10 | Shop not-found page | `front-page/app/shop/[slug]/not-found.tsx` | Friendly error for invalid/disabled shops. |

**Verification Criteria:**
- `/shop/{slug}` renders product grid with categories.
- Products display normalized GBP prices.
- Adding to cart creates server-side cart document with session_id.
- Cart persists across page navigation and browser refresh.
- Cart validates prices against current product prices on every GET.
- Service fee (10%) calculated server-side, displayed as "Service Fee".
- Session cookie is httpOnly, Secure, SameSite=Strict.
- Cart auto-expires after 24 hours (TTL index).

---

### Phase 3: Checkout & Payment Integration

**Duration:** 7-10 days
**Dependencies:** Phase 2 complete
**Goal:** Full checkout flow with SHKeeper crypto payments via Python bridge.

**Tasks:**

| # | Task | File(s) | Details |
|---|------|---------|---------|
| 3.1 | Python bridge API setup | `telegram-bot-service/api/web_bridge.py` | FastAPI router with `BRIDGE_API_KEY` auth middleware. |
| 3.2 | Bridge: payment methods endpoint | `telegram-bot-service/api/web_bridge.py` | `GET /api/web/{bot_id}/payment-methods` via SHKeeper query (Bug #2 fix). |
| 3.3 | Bridge: create invoice endpoint | `telegram-bot-service/api/web_bridge.py` | `POST /api/web/{bot_id}/create-invoice` via SHKeeper invoice + encryption (Bug #1 fix). |
| 3.4 | Bridge: payment webhook endpoint | `telegram-bot-service/api/web_bridge.py` | `POST /api/web/webhook/payment` with HMAC validation (Bug #9 fix). |
| 3.5 | Next.js payment methods route | `front-page/app/api/shop/[slug]/payment-methods/route.ts` | Proxy to Python bridge. |
| 3.6 | Next.js checkout route | `front-page/app/api/shop/[slug]/checkout/route.ts` | Full checkout logic: validation, stock decrement, order creation, bridge call. |
| 3.7 | Checkout page UI | `front-page/app/shop/[slug]/checkout/page.tsx` | Crypto selector, payment display, QR code, countdown timer, captcha. |
| 3.8 | Order model updates | `telegram-bot-service/models/order.py` | Add `source`, `web_session_id`, `order_token`, `address_salt`, conversion fields. (Bug #7 compatible) |
| 3.9 | Idempotency implementation | Checkout route | Check `idempotency_key` before processing. |
| 3.10 | Stock reservation logic | Checkout route | Atomic decrement with rollback on failure. |
| 3.11 | Exchange rate service | `front-page/lib/exchange-rates.ts` | GBP to USD rate fetching with caching (5-min TTL). |
| 3.12 | hCaptcha integration | `front-page/components/Captcha.tsx`, checkout route | Client-side widget + server-side verification. |
| 3.13 | CSRF middleware | `front-page/middleware.ts` | Token generation and validation for POST/PATCH/DELETE. (Bug #8 fix) |
| 3.14 | Commission calculation | Checkout route | 10% service fee calculated server-side, included in `fiat_amount`. (Bug #3 fix) |
| 3.15 | Order expiry background job | `telegram-bot-service/tasks/order_expiry.py` | Periodic task: expire orders past `rate_lock_expires_at`, restore stock. |

**Verification Criteria:**
- Payment methods dynamically queried from SHKeeper (not static config).
- Checkout creates order in MongoDB with all required fields.
- SHKeeper invoice created via Python bridge (API key never in Next.js).
- Payment address displayed with QR code.
- Duplicate checkout with same idempotency_key returns existing order (no double charge).
- Stock atomically decremented; concurrent checkout handles contention.
- SHKeeper webhook updates order status to "paid".
- 10% commission included in payment amount.
- Expired orders restore stock.
- Captcha required before checkout.
- CSRF token validated on all state-changing endpoints.
- Address encryption uses per-order salt (not shared key).

---

### Phase 4: Order Tracking

**Duration:** 3-5 days
**Dependencies:** Phase 3 complete
**Goal:** Web-based order tracking without Telegram dependency.

**Tasks:**

| # | Task | File(s) | Details |
|---|------|---------|---------|
| 4.1 | Order status API route | `front-page/app/api/shop/[slug]/order/[token]/status/route.ts` | Lightweight poll endpoint. |
| 4.2 | Order detail API route | `front-page/app/api/shop/[slug]/order/[token]/route.ts` | Full order details with items_snapshot. |
| 4.3 | Order tracking page | `front-page/app/shop/[slug]/order/[token]/page.tsx` | Status timeline, payment details, shipping info. |
| 4.4 | Client-side polling | `front-page/components/OrderStatusPoller.tsx` | Poll every 10s when status is `pending` or `paid`. Stop on terminal states. |
| 4.5 | Order token index | Migration script | `{ order_token: 1 }` unique index on `orders`. |
| 4.6 | Admin panel source filter | `admin-panel/app/orders/page.tsx` | Filter orders by `source: "web" | "telegram"`. |

**Verification Criteria:**
- `/shop/{slug}/order/{token}` displays correct order status.
- Status updates in near-real-time via polling.
- No Telegram deep links used for web orders.
- Order token is UUID v4, not guessable.
- Admin panel shows web vs Telegram order source.

---

### Phase 5: Integration, SEO, Hardening

**Duration:** 5-7 days
**Dependencies:** Phase 4 complete
**Goal:** Bot directory integration, search engine optimization, mobile responsiveness, production hardening.

**Tasks:**

| # | Task | File(s) | Details |
|---|------|---------|---------|
| 5.1 | Bot directory integration | `front-page/app/page.tsx` (or existing directory page) | "Visit Web Shop" button on bots with `web_shop_enabled`. |
| 5.2 | SEO metadata | `front-page/app/shop/[slug]/layout.tsx`, all page files | Dynamic `<title>`, `<meta description>`, Open Graph tags per shop/product. |
| 5.3 | Sitemap generation | `front-page/app/sitemap.ts` | Dynamic sitemap including all enabled shops and their products. |
| 5.4 | robots.txt update | `front-page/public/robots.txt` | Allow crawling of `/shop/*` pages. |
| 5.5 | Mobile responsiveness | All shop page/component files | Test and fix layouts on 320px-768px viewports. |
| 5.6 | Rate limiting implementation | `front-page/middleware.ts` | IP-based limits per endpoint group (see Security S5 table). |
| 5.7 | Error boundary | `front-page/app/shop/[slug]/error.tsx` | Graceful error handling for all shop pages. |
| 5.8 | Loading states | `front-page/app/shop/[slug]/loading.tsx` | Skeleton loaders for shop pages. |
| 5.9 | Performance optimization | Various | Image optimization (Next.js `<Image>`), ISR for product pages, edge caching headers. |
| 5.10 | Monitoring & logging | `front-page/lib/logger.ts`, `telegram-bot-service/utils/logger.py` | Structured logging for web shop events, error tracking. |
| 5.11 | End-to-end testing | `front-page/__tests__/shop/` | Test: browse -> cart -> checkout -> payment -> tracking. |

**Verification Criteria:**
- Bot directory shows "Visit Web Shop" for enabled bots.
- Google can crawl and index shop pages.
- All pages render correctly on mobile.
- Rate limits enforce correctly (429 responses on excess).
- Errors display user-friendly messages, not stack traces.
- End-to-end test passes for full purchase flow.

---

## 11. Appendix

### 11.1 Enum Dictionary

| Enum | Values | Used In |
|------|--------|---------|
| `OrderSource` | `"telegram"`, `"web"` | `orders.source`, `invoices.source` |
| `OrderStatus` | `"pending"`, `"pending_payment_setup"`, `"paid"`, `"confirmed"`, `"shipped"`, `"delivered"`, `"completed"`, `"disputed"`, `"refunded"`, `"expired"`, `"expired_with_payment"`, `"cancelled"`, `"failed"` | `orders.status` |
| `CryptoCurrency` | `"BTC"`, `"LTC"`, `"USDT"`, `"DOGE"` (extensible via SHKeeper) | `orders.crypto_currency` |
| `CartItemStatus` | `"available"`, `"price_changed"`, `"out_of_stock"`, `"removed"` | Cart validation response |

### 11.2 Fiat Conversion Chain Detail

```
+------------------------------------------------------------------+
|                    FIAT CONVERSION CHAIN                          |
|                                                                  |
|  STEP 1: Product prices (stored in GBP)                          |
|  ----------------------------------------                        |
|  Item 1: 29.99 GBP x 2 = 59.98 GBP                             |
|  Item 2: 15.00 GBP x 1 = 15.00 GBP                             |
|  -----------------------                                         |
|  Subtotal:              74.98 GBP                                |
|  Service Fee (10%):      7.50 GBP                                |
|  Discount (SAVE10):     -7.50 GBP                                |
|  -----------------------                                         |
|  display_amount:        74.98 GBP                                |
|                                                                  |
|  STEP 2: GBP -> USD conversion                                  |
|  ---------------------------------                               |
|  exchange_rate_gbp_usd: 1.2642 (locked at checkout)             |
|  fiat_amount: 74.98 x 1.2642 = 94.79 USD                       |
|                                                                  |
|  STEP 3: USD -> Crypto (via SHKeeper)                            |
|  ----------------------------------------                        |
|  SHKeeper receives: 94.79 USD                                    |
|  exchange_rate_usd_crypto: 67,543.21 (BTC/USD from SHKeeper)    |
|  crypto_amount: 94.79 / 67543.21 = 0.00140340 BTC               |
|                                                                  |
|  All stored on order:                                            |
|  { display_amount: 74.98, fiat_amount: 94.79,                   |
|    exchange_rate_gbp_usd: 1.2642,                                |
|    exchange_rate_usd_crypto: 67543.21,                           |
|    crypto_amount: 0.00140340, crypto_currency: "BTC" }           |
+------------------------------------------------------------------+
```

### 11.3 Environment Variables

**Next.js front-page** (`front-page/.env`):

| Variable | Description |
|----------|-------------|
| `BRIDGE_API_KEY` | Internal key for authenticating calls to Python bridge |
| `BRIDGE_API_URL` | Python bot service URL (e.g., `http://bot-service:8000`) |
| `EXCHANGE_RATE_API_KEY` | API key for GBP to USD rate provider |
| `HCAPTCHA_SECRET_KEY` | Server-side hCaptcha verification key |
| `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` | Client-side hCaptcha site key |
| `MONGODB_URI` | MongoDB connection string (existing) |

**Python bot service** (`telegram-bot-service/.env`):

| Variable | Description |
|----------|-------------|
| `BRIDGE_API_KEY` | Must match the key in Next.js env |
| `SYSTEM_KEY` | Master key for per-order address encryption (S1) |
| `SHKEEPER_API_KEY` | SHKeeper API key (existing, never shared with Next.js) |
| `SHKEEPER_URL` | SHKeeper server URL (existing) |

### 11.4 MongoDB Indexes Summary

| Collection | Index | Type | Purpose |
|------------|-------|------|---------|
| `bots` | `{ web_shop_slug: 1 }` | Unique, sparse | Shop URL lookup |
| `carts` | `{ bot_id: 1, session_id: 1 }` | Compound | Web cart lookup |
| `carts` | `{ expires_at: 1 }` | TTL | Auto-delete expired carts |
| `orders` | `{ order_token: 1 }` | Unique | Web order tracking |
| `orders` | `{ idempotency_key: 1 }` | Unique, sparse | Duplicate prevention |
| `orders` | `{ web_session_id: 1, bot_id: 1 }` | Compound | Session order history |
| `orders` | `{ status: 1, rate_lock_expires_at: 1 }` | Compound | Expiry job query |

### 11.5 Bug Tracker Cross-Reference

| Bug # | Description | Fix Location | Phase |
|-------|-------------|-------------|-------|
| 1 | Address encryption per-user secret phrase | Python bridge `create-invoice` (S1) | Phase 3 |
| 2 | Static payment method config | Bridge `payment-methods` endpoint | Phase 3 |
| 3 | Missing 10% commission | Checkout route server-side calc | Phase 3 |
| 4 | Dual price fields | `front-page/lib/product-utils.ts` | Phase 1 |
| 5 | Deep link secret phrase verification | Web order tracking page (no deep links) | Phase 4 |
| 6 | Cart lacks session support | Cart model `session_id` field | Phase 2 |
| 7 | userId expects Telegram int | Order schema `web_session_id` + nullable `userId` | Phase 3 |
| 8 | No CSRF/rate limiting | Next.js middleware | Phase 3 (CSRF), Phase 5 (rate limit) |
| 9 | Webhook port mismatch | Python bridge explicit route registration | Phase 3 |
| 10 | Exchange rate drift | Rate lock window (15 min) + stored rates | Phase 3 |

---

## Changelog

| Date | Version | Change |
|------|---------|--------|
| 2026-03-22 | 1.0 | Initial PRD created |
