# Telegram Bot Service

Python/aiogram Telegram bot service for the Telegram Bot Platform MVP.

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Copy `.env.example` to `.env` and fill in your values:
```bash
cp .env.example .env
```

3. Run the bot:
```bash
python main.py
```

## Features

- Dynamic main menu buttons from MongoDB
- Dynamic inline buttons per product
- Secret phrase system for user verification
- Crypto payment integration (CoinPayments)
- Commission calculation and tracking
- Webhook support for payment confirmations
- Real-time configuration updates (no bot restart needed)
- `/refresh` and `/menu` commands to update keyboard buttons for existing users

## Deployment

Deploy using Docker/Coolify. The service will run on port 8000 by default.

