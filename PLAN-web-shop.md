# Web Shop Frontend — Implementation Plan

## Overview

Add an anonymous web storefront to each Telegram bot. Customers can browse products, add to cart, checkout with SHKeeper crypto payments, and track orders — all without an account. Orders sync back to the Telegram bot so vendors manage everything in one place. Web customers are encouraged to join the Telegram bot for updates.

**Key Principles:**
- Anonymous by default (session-based, no login required)
- Orders created on web are identical to Telegram orders in MongoDB
- SHKeeper webhook already handles payment confirmation — we reuse it
- Bot owners toggle web shop on/off from admin panel
- Each bot gets a unique shop URL: `/{bot_username}` or `/{bot_id}`

---

## Phase 0: Documentation & Architecture Discovery ✅

### Findings

**Existing Stack:**
- `front-page/` — Next.js 14, Tailwind, Mongoose, dark theme. Currently a bot directory only. No shop pages.
- `telegram-bot-service/` — Python/Aiogram bot with full checkout flow, SHKeeper/CryptAPI payments, MongoDB collections for products, carts, invoices, orders.
- `admin-panel/` — Next.js admin dashboard with product/order/bot CRUD.
- All services share the same MongoDB database.

**Shared Collections We'll Read/Write:**
| Collection | Web Shop Usage |
|---|---|
| `bots` | Read config, payment methods, shipping, shop toggle |
| `products` | Read product catalog |
| `categories` / `subcategories` | Read for navigation |
| `carts` | Create/update web carts (new `source: "web"` field) |
| `invoices` | Create invoices (same schema as Telegram) |
| `orders` | Create orders (same schema as Telegram) |
| `discounts` | Validate discount codes |
| `reviews` | Display product reviews |

**Payment Flow (reused as-is):**
1. Web creates invoice + order with `invoice_id` as `order._id`
2. Web calls SHKeeper `create_invoice()` via new API route
3. SHKeeper sends webhook to `POST /payment/shkeeper-webhook` (already exists)
4. Webhook confirms payment, updates order, triggers auto-payout
5. Web polls order status or uses SSE for live updates

**Anti-Patterns to Avoid:**
- Do NOT duplicate payment logic — call the same `create_payment_invoice()` from `services/payment_provider.py`
- Do NOT create a separate user auth system — use anonymous sessions (cookie/localStorage)
- Do NOT build a separate order management UI — orders appear in the existing Telegram bot + admin panel
- Do NOT use Telegram bot token from the frontend — all sensitive ops go through API routes

---

## Phase 1: Bot Config & Data Layer

**Goal:** Add web shop toggle to bot config, extend models, create shared API routes.

### Tasks

1. **Add `web_shop_enabled` field to bot config**
   - File: `front-page/lib/models.ts` — add to Bot schema
   - File: `admin-panel/lib/models.ts` — add to Bot schema
   - Also add: `web_shop_slug` (custom URL slug, defaults to bot username)
   - Also add: `web_shop_welcome_message` (optional banner text)

2. **Add admin panel toggle**
   - File: `admin-panel/app/bots/[id]/page.tsx` (or equivalent bot edit page)
   - Add checkbox: "Enable Web Shop" + slug input field
   - Save to `bots` collection

3. **Create Product & Category models in front-page**
   - File: `front-page/lib/models.ts` — add Product, Category, Subcategory, Review schemas
   - Match exact field names from `admin-panel/lib/models.ts`

4. **Create core API routes in front-page**
   - `GET /api/shop/[botSlug]` — fetch bot config (if web_shop_enabled)
   - `GET /api/shop/[botSlug]/products` — list products with categories
   - `GET /api/shop/[botSlug]/products/[productId]` — product detail + reviews
   - `GET /api/shop/[botSlug]/categories` — category tree

### Verification
- `GET /api/shop/testbot/products` returns products from MongoDB
- Bot without `web_shop_enabled: true` returns 404

---

## Phase 2: Shop Frontend — Browse & Cart

**Goal:** Build the product browsing and cart UI. No checkout yet.

### Tasks

1. **Create shop layout & landing page**
   - File: `front-page/app/shop/[botSlug]/layout.tsx` — shop chrome (header, nav, cart icon)
   - File: `front-page/app/shop/[botSlug]/page.tsx` — product grid with category filters
   - Reuse dark theme from existing `page.tsx`
   - Show bot name, welcome message, category sidebar/tabs
   - Product cards: image, name, price, "Add to Cart" button

2. **Product detail page**
   - File: `front-page/app/shop/[botSlug]/product/[productId]/page.tsx`
   - Show: image, full description, variations (dropdown), quantity selector, price
   - Reviews section at bottom
   - "Add to Cart" button

3. **Client-side cart (localStorage)**
   - File: `front-page/lib/cart.ts` — cart context/hook using localStorage
   - Cart state: `{ botSlug, items: [{ productId, variationIndex, quantity, price, unit }] }`
   - Cart icon in header shows item count badge
   - Cart drawer/page: item list, quantities, subtotal, "Proceed to Checkout"

4. **Cart API route (server-side persist)**
   - `POST /api/shop/[botSlug]/cart` — save cart to `carts` collection
   - Use anonymous session ID (UUID stored in cookie) as `user_id` with `web_` prefix
   - Field: `source: "web"` to distinguish from Telegram carts

### Verification
- Can browse products by category on `/shop/testbot`
- Can add items to cart, cart persists across page refreshes
- Cart syncs to MongoDB `carts` collection

---

## Phase 3: Checkout & Payment

**Goal:** Full anonymous checkout flow with SHKeeper crypto payment.

### Tasks

1. **Checkout page**
   - File: `front-page/app/shop/[botSlug]/checkout/page.tsx`
   - Steps (same as Telegram flow):
     1. Review cart items + totals
     2. Enter discount code (optional) — validate via API
     3. Select payment method (BTC/LTC/USDT — from bot config `payment_methods`)
     4. Enter delivery address (encrypted before storage)
     5. Select delivery method (from bot config `shipping_methods`)
     6. Confirm order → show payment details

2. **Checkout API routes**
   - `POST /api/shop/[botSlug]/checkout/create-invoice` — create invoice in `invoices` collection
     - Same schema as Telegram invoices
     - Add field: `source: "web"`, `web_session_id: "{uuid}"`
     - Returns `invoice_id`
   - `POST /api/shop/[botSlug]/checkout/validate-discount` — check discount code
   - `POST /api/shop/[botSlug]/checkout/confirm` — create order + request SHKeeper payment
     - **CRITICAL:** This route calls `create_payment_invoice()` logic
     - Since payment_provider.py is Python, we need a bridge:
       - **Option A (recommended):** Add API endpoint to the Telegram bot service: `POST /api/create-payment` that accepts `{ amount, currency, order_id, fiat_currency, bot_id }` and returns payment details
       - **Option B:** Rewrite SHKeeper API call in TypeScript (duplication, avoid)
   - `GET /api/shop/[botSlug]/order/[invoiceId]/status` — poll order status

3. **Add payment bridge to Telegram bot service**
   - File: `telegram-bot-service/handlers/payments.py` — add route
   - `POST /api/create-payment` — accepts JSON, calls `create_payment_invoice()`, returns result
   - Secured with internal API key (env: `INTERNAL_API_KEY`)
   - This keeps all payment logic in Python, no duplication

4. **Payment page**
   - File: `front-page/app/shop/[botSlug]/pay/[invoiceId]/page.tsx`
   - Display: crypto address, QR code, exact amount, 3-hour countdown
   - Poll `/api/shop/[botSlug]/order/[invoiceId]/status` every 10 seconds
   - On payment confirmed → redirect to order confirmation page

5. **Address encryption in TypeScript**
   - File: `front-page/lib/encryption.ts`
   - Use same Fernet encryption as admin-panel (`admin-panel/lib/address_decryption.ts`)
   - Encrypt delivery address before storing in invoice

### Verification
- Full checkout flow: cart → discount → payment method → address → delivery → confirm
- SHKeeper receives payment request with correct amount
- Payment webhook confirms order (same webhook, no changes needed)
- Order appears in admin panel and Telegram bot `/orders`

---

## Phase 4: Order Tracking & Telegram Link

**Goal:** Let web customers track orders and funnel them to Telegram.

### Tasks

1. **Order confirmation page**
   - File: `front-page/app/shop/[botSlug]/order/[invoiceId]/page.tsx`
   - Show: order status, items, payment details, delivery info
   - Secret phrase displayed (for order verification)
   - **Telegram CTA:** "Join @{bot_username} on Telegram to get live order updates, dispute resolution, and exclusive deals!"
   - Deep link: `https://t.me/{bot_username}?start=order_{invoiceId}`

2. **Order lookup page (anonymous)**
   - File: `front-page/app/shop/[botSlug]/orders/page.tsx`
   - Input: invoice ID or secret phrase → look up order
   - No account needed — anyone with the invoice ID can view status
   - Show order status timeline

3. **Telegram bot: handle web order deep link**
   - File: `telegram-bot-service/handlers/start.py`
   - Handle `/start order_{invoiceId}` — show order details in Telegram
   - If user not in system, create user record and link to web order
   - Update order with Telegram `userId` for future notifications

4. **Web order notifications via Telegram**
   - When a web order's status changes (paid → shipped → delivered):
   - If the order has a linked Telegram `userId`, send notification via bot
   - File: `telegram-bot-service/services/order_state_machine.py` — already handles transitions, just needs to check for web orders

5. **Add `source` field to order display**
   - In admin panel order list, show "🌐 Web" or "📱 Telegram" badge
   - File: `admin-panel` order pages — add source indicator

### Verification
- Web customer can track order by invoice ID
- Deep link to Telegram bot works and links order to Telegram user
- Order status changes trigger Telegram notifications for linked users
- Admin panel shows order source

---

## Phase 5: Bot Directory Integration & Polish

**Goal:** Integrate web shops into the existing bot directory, add shop links.

### Tasks

1. **Update bot directory (front-page main page)**
   - File: `front-page/app/page.tsx`
   - For bots with `web_shop_enabled: true`, add "🛒 Visit Shop" button alongside "Open Bot"
   - Link to `/shop/{botSlug}`

2. **Shop SEO & meta tags**
   - File: `front-page/app/shop/[botSlug]/layout.tsx`
   - Dynamic meta tags: bot name, description, OG image
   - Each shop is crawlable/shareable

3. **Mobile responsiveness pass**
   - Ensure all shop pages work well on mobile
   - Cart drawer instead of full page on mobile
   - Touch-friendly quantity selectors

4. **Rate limiting & abuse prevention**
   - API routes: rate limit by IP (simple in-memory or Redis)
   - Cart creation: limit carts per session
   - Order creation: limit orders per IP per hour

5. **Environment configuration**
   - Add to `front-page/.env.coolify.example`:
     ```
     INTERNAL_API_URL=http://telegram-bot-service:8000
     INTERNAL_API_KEY=shared_secret_key
     ADDRESS_ENCRYPTION_KEY=same_key_as_bot_service
     ```

### Verification
- Bot directory shows "Visit Shop" for enabled bots
- Shop pages render correctly on mobile
- Cannot spam-create orders
- Full end-to-end: browse → cart → checkout → pay → track → join Telegram

---

## Architecture Diagram

```
┌──────────────────────────┐     ┌──────────────────────────┐
│   Web Shop (Next.js)     │     │  Telegram Bot (Aiogram)  │
│   front-page/            │     │  telegram-bot-service/    │
│                          │     │                          │
│  /shop/{slug}            │     │  /start, /orders, etc.   │
│  /shop/{slug}/checkout   │     │  handlers/checkout.py    │
│  /shop/{slug}/pay/{id}   │     │  handlers/orders.py      │
│  /shop/{slug}/order/{id} │     │                          │
│                          │     │  POST /api/create-payment │
│  API Routes:             │────▶│  (bridge endpoint)       │
│  /api/shop/*/checkout/*  │     │                          │
└──────────┬───────────────┘     └──────────┬───────────────┘
           │                                │
           │     ┌──────────────────┐       │
           │     │    MongoDB       │       │
           └────▶│                  │◀──────┘
                 │  bots            │
                 │  products        │    ┌──────────────────┐
                 │  carts           │    │   SHKeeper       │
                 │  invoices        │    │                  │
                 │  orders          │◀───│  POST /payment/  │
                 │  reviews         │    │  shkeeper-webhook│
                 └──────────────────┘    └──────────────────┘
```

---

## Execution Order

| Phase | Est. Size | Dependencies |
|-------|-----------|--------------|
| Phase 1 | ~10 files | None |
| Phase 2 | ~8 files | Phase 1 |
| Phase 3 | ~10 files | Phase 2 (heaviest phase) |
| Phase 4 | ~6 files | Phase 3 |
| Phase 5 | ~5 files | Phase 4 |

Each phase is independently deployable and testable.
