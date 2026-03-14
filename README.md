# Telegram Bot Platform MVP

A complete Telegram bot platform with secret phrase verification, crypto payments, admin panel, and public bot listing.

## Architecture

Three separate repositories:

1. **telegram-bot-service** - Python/aiogram bot service
2. **admin-panel** - Next.js admin dashboard  
3. **front-page** - Next.js public bot listing

All services connect to a shared MongoDB database.

## Quick Start

See [SETUP.md](./SETUP.md) for detailed setup instructions.

### Prerequisites

- MongoDB (local or cloud)
- Node.js 20+
- Python 3.12
- CoinPayments account (for crypto payments)

### Basic Setup

1. **MongoDB**: Set up MongoDB and get connection string

2. **Admin Panel (Backend)**: 
   ```bash
   cd admin-panel
   npm install
   cp .env.example .env
   # Edit .env with MongoDB URI and JWT_SECRET
   npm run create-admin admin password
   npm run dev
   ```
   Runs on: http://localhost:3000

3. **Telegram Bot Service**:
   ```bash
   cd telegram-bot-service
   pip install -r requirements.txt
   cp .env.example .env
   # Edit .env with BOT_TOKEN, MONGO_URI, CoinPayments credentials
   py -3.12 main.py
   ```
   Runs on: http://localhost:8000 (webhook server)

4. **Front Page (Frontend)**:
   ```bash
   cd front-page
   npm install
   cp .env.example .env
   # Edit .env with MongoDB URI
   npm run dev
   ```
   Runs on: http://localhost:3002

## Starting Services

After initial setup, start each service in separate terminals:

### Start Admin Panel (Backend)
```bash
cd admin-panel
npm run dev
```

### Start Telegram Bot Service
```bash
cd telegram-bot-service
py -3.12 main.py
```

### Start Front Page (Frontend)
```bash
cd front-page
npm run dev
```

**Note:** All services need to be running simultaneously for full functionality:
- Admin Panel: Manage bots, products, and orders
- Bot Service: Handle Telegram bot interactions and payments
- Front Page: Display public bot listing

## Features

### Secret Phrase System
- Users see the same secret phrase across all bots
- Phrase is generated on first `/start` command
- Helps users identify scambots

### Dynamic Bot Configuration
- Main menu buttons configured via admin panel
- Inline buttons per product
- Custom messages (welcome, thank you, etc.)
- Real-time updates (no bot restart needed)
- Configuration fetched fresh from MongoDB on every request
- Users can run `/refresh` or `/menu` to update their keyboard buttons

### Crypto Payments
- BTC and LTC support via Blockonomics (no KYC required) or CoinPayments
- Automatic invoice generation with QR codes
- Webhook-based payment confirmation
- Commission tracking

### Admin Panel
- Bot management (CRUD)
- Product management
- Order tracking
- Commission summary
- User and secret phrase management

### Public Front Page
- Lists all live bots with public_listing enabled
- "Open Bot" buttons
- Responsive design

## Configuration

### Inline Buttons Configuration

Inline buttons are configured per product in the bot's `inline_buttons` field. The structure is:

```json
{
  "inline_buttons": {
    "product_id_1": [
      {"text": "Buy", "action": "buy"},
      {"text": "More Info", "action": "info"}
    ],
    "product_id_2": [
      {"text": "Purchase", "action": "buy"},
      {"text": "Details", "action": "info"}
    ]
  }
}
```

To configure inline buttons:

1. Go to Admin Panel → Bots → Edit Bot
2. Use the API or database to update `inline_buttons` field
3. Format: `{ "productId": [{"text": "Button Text", "action": "action_name"}] }`

Actions:
- `buy` - Triggers purchase flow
- `info` - Shows product details

### Bot Username for Front Page

The front page generates bot links based on bot name. To use actual bot usernames:

1. Add `username` field to Bot model (optional enhancement)
2. Or manually update bot links in front-page code
3. Or store bot username when creating bot in admin panel

## Deployment (Coolify – test.greenbritain.club)

Deploy to **Coolify** using the domain **test.greenbritain.club**:

| Service     | URL |
|------------|-----|
| Front Page | https://test.greenbritain.club |
| Admin Panel | https://admin.test.greenbritain.club |
| Bot (webhook) | https://bot.test.greenbritain.club |

See **[COOLIFY_DEPLOYMENT.md](./COOLIFY_DEPLOYMENT.md)** for step-by-step Coolify setup, env vars, and domain assignment.

---

All services include Dockerfiles optimized for Coolify deployment.

### Environment Variables

**telegram-bot-service:**
- `BOT_TOKEN` - Telegram bot token from @BotFather
- `MONGO_URI` - MongoDB connection string
- `BLOCKONOMICS_API_KEY` - Blockonomics API key (no KYC) OR
- `PAYMENT_API_KEY` - CoinPayments API key (requires KYC)
- `PAYMENT_API_SECRET` - CoinPayments API secret (if using CoinPayments)
- `WEBHOOK_URL` - Webhook URL for payment confirmations (e.g. for CryptAPI/Blockonomics callbacks)
- `COMMISSION_RATE` - Commission rate (default: 0.02 = 2%)

Deposit addresses from any provider are stored in the **addresses** collection (one per order) for auditing. Commission payouts are manual: the admin “Process” action returns send instructions; you send from your own wallet and then mark the payout as paid.

**admin-panel:**
- `MONGO_URI` - MongoDB connection string
- `JWT_SECRET` - Secret for JWT token generation
- `NEXTAUTH_URL` - Admin panel URL

**front-page:**
- `MONGO_URI` - MongoDB connection string

## Testing

See [SETUP.md](./SETUP.md) for testing checklist.

Key test scenarios:
1. Secret phrase appears on `/start`
2. Same phrase on multiple bots
3. Dynamic button updates
4. Payment flow end-to-end
5. Commission calculation
6. Admin panel CRUD operations

## Project Structure

```
.
├── database/              # Reference SQL schema (PostgreSQL marketplace)
│   └── schema.sql         # Users, vendors, products, orders, addresses, payments, ledger, withdrawals
├── docs/
│   └── PAYMENT_SCHEMA.md  # Payment flow and schema notes
├── telegram-bot-service/
│   ├── handlers/          # Bot command handlers
│   ├── database/          # MongoDB connection & models
│   ├── services/          # CoinPayments, commission
│   ├── utils/             # Secret phrase generation
│   └── main.py            # Entry point
├── admin-panel/
│   ├── app/               # Next.js pages & API routes
│   ├── lib/               # Database, auth utilities
│   └── scripts/           # Admin user creation
└── front-page/
    ├── app/               # Public pages & API
    └── lib/               # Database utilities
```

For the **improved payment/marketplace schema** (address pool, ledger, confirmations, withdrawals), see [database/schema.sql](database/schema.sql) and [docs/PAYMENT_SCHEMA.md](docs/PAYMENT_SCHEMA.md).

## License

MIT

