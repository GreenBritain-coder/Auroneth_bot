# Payment & Marketplace Schema (PostgreSQL)

This document describes the **improved** payment/marketplace schema used for a scalable Telegram marketplace: reliable, auditable, and ready for high volume (e.g. 100k+ users) when paired with an address pool and a blockchain watcher.

The canonical SQL is in **[../database/schema.sql](../database/schema.sql)**.

---

## System flow

```
Telegram bot
     ↓
Orders table
     ↓
Deposit address (from Addresses table)
     ↓
Blockchain watcher
     ↓
Payments table
     ↓
Vendor ledger (vendor_transactions)
     ↓
Withdrawal system
```

---

## Tables overview

| Table | Purpose |
|-------|--------|
| **users** | Buyers (telegram_id, username). |
| **vendors** | Sellers; cached balances (`balance_btc`, etc.). Ledger is source of truth. |
| **products** | Vendor listings (vendor_id, name, price, currency, stock). |
| **orders** | Main transaction record; no deposit address stored here. |
| **addresses** | Pool of deposit addresses; one assigned per order for scalability. |
| **payments** | Blockchain tx records; watcher fills this (tx_hash, confirmations, watcher_status). |
| **vendor_transactions** | Ledger: sale_credit, platform_fee, withdrawal. |
| **withdrawals** | Payout requests and results (tx_hash, status, retry_count, error_message). |

---

## Order lifecycle

1. **Order created**  
   - Insert `orders` with `status = 'waiting'`.  
   - Assign a row from `addresses` (currency, status = 'available') to this order; set `order_id`, `status = 'assigned'`.  
   - Show user the chosen `addresses.address` as deposit address.

2. **Payment detected (blockchain watcher)**  
   - Insert into `payments` (order_id, currency, tx_hash, amount, confirmations, watcher_status).  
   - When `confirmations >= confirmations_required`, set `orders.status = 'paid'` and optionally `addresses.status = 'used'`.

3. **Commission applied**  
   - Insert into `vendor_transactions`:  
     - `type = 'sale_credit'`, amount = order amount minus platform fee.  
     - `type = 'platform_fee'` if you track fee separately.  
   - Optionally update cached `vendors.balance_*` (in a transaction or via a periodic job).

4. **Vendor withdraws**  
   - Insert into `withdrawals` with `status = 'pending'`.  
   - Worker sends crypto; on success set `tx_hash`, `status = 'completed'`; on failure set `retry_count`, `error_message`, and optionally `status = 'failed'`.

---

## Key improvements in this schema

- **Addresses table** – Scalable deposit address generation; assign one address per order from a pool instead of storing deposit addresses on orders.
- **Ledger as source of truth** – `vendor_transactions` is the canonical record; `vendors.balance_*` are cached and can be recomputed from the ledger.
- **Confirmations & watcher status** – `payments.confirmations`, `confirmations_required`, and `watcher_status` avoid marking orders paid before the required confirmations.
- **Retry and failure tracking** – `withdrawals.retry_count` and `error_message` support robust payout handling and debugging.
- **No deposit_address on orders** – Deposit address comes from `addresses`; orders stay clean and the same address pool can serve many orders over time.

---

## Status values

- **orders.status**: `waiting` | `paid` | `completed` | `cancelled`
- **addresses.status**: `available` | `assigned` | `used`
- **payments.watcher_status**: `pending` | `confirmed` | `failed`
- **withdrawals.status**: `pending` | `processing` | `sent` | `completed` | `failed`
- **vendor_transactions.type**: `sale_credit` | `platform_fee` | `withdrawal`

---

## Commission example

- Order amount: 0.01 BTC  
- Platform fee: 10%  
- Vendor credit: 0.009 BTC  

Insert into `vendor_transactions`:  
- `type = 'sale_credit'`, amount = 0.009, currency = 'BTC' for the vendor.  
- Optionally `type = 'platform_fee'`, amount = 0.001, currency = 'BTC' for the platform.

---

## Relation to current stack

The live app currently uses **MongoDB** (see admin-panel `lib/models.ts` and telegram-bot-service database layer). This PostgreSQL schema is the **target design** for a dedicated payment/order store: use it when you introduce a PostgreSQL payment service or migrate order/payment/vendor balance flows to SQL. The same flow (order → address → watcher → payments → ledger → withdrawals) applies; only the storage and queries change.

---

## Current implementation: HD-style addresses & automated payouts (MongoDB)

The bot has been updated to work better for **automated payouts** and **address tracking** (HD-style: one address per order, auditable).

### Address tracking (MongoDB `addresses` collection)

- When an invoice is created (any provider: CryptAPI, Blockonomics, CoinPayments), the returned **deposit address** is stored in the `addresses` collection with `orderId`, `currency`, `status: assigned`, and `provider`.
- When a payment is confirmed (webhook), the address is marked `status: used`.
- This gives you a single place to audit which address was used for which order and avoids reuse confusion. Providers (e.g. CryptAPI, Blockonomics) already generate one address per invoice; we now record that in the DB.

### Payouts (manual)

- Commission payouts are **manual**: the admin Process action returns send instructions (amount, address). You send from your own wallet, then mark the payout as paid. No SHKeeper.

### Summary

| Feature | What was added |
|--------|-----------------|
| **HD-style addresses** | MongoDB `addresses` collection; every invoice records its deposit address; addresses marked `used` when payment is confirmed. |
| **Payouts** | Manual instructions from the payout handler; no SHKeeper. |
