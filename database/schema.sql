-- =============================================================================
-- Telegram Marketplace – PostgreSQL Schema (improved, scalable)
-- =============================================================================
-- Use this schema for a dedicated payment/order DB (e.g. PostgreSQL).
-- Ledger is source of truth; vendor balance_* columns are cached and updated
-- when orders are paid or withdrawals are processed.
-- =============================================================================

-- 1. Users – buyers
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    username VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_telegram_id ON users(telegram_id);

-- 2. Vendors – cached balances (ledger is source of truth)
CREATE TABLE vendors (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    username VARCHAR(255),
    balance_btc DECIMAL(18,8) DEFAULT 0,
    balance_ltc DECIMAL(18,8) DEFAULT 0,
    balance_xmr DECIMAL(18,8) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_vendors_telegram_id ON vendors(telegram_id);

-- 3. Products – vendor listings
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    vendor_id INT NOT NULL REFERENCES vendors(id),
    name VARCHAR(255) NOT NULL,
    price DECIMAL(18,8) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    stock INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_products_vendor_id ON products(vendor_id);

-- 4. Orders – main transaction record (no deposit_address; use addresses table)
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id),
    vendor_id INT NOT NULL REFERENCES vendors(id),
    product_id INT NOT NULL REFERENCES products(id),
    currency VARCHAR(10) NOT NULL,
    amount DECIMAL(18,8) NOT NULL,
    status VARCHAR(20) DEFAULT 'waiting', -- waiting, paid, completed, cancelled
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_vendor_id ON orders(vendor_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at);

-- 5. Addresses – scalable deposit address pool (assign one per order)
CREATE TABLE addresses (
    id SERIAL PRIMARY KEY,
    currency VARCHAR(10) NOT NULL,
    address VARCHAR(255) UNIQUE NOT NULL,
    order_id INT REFERENCES orders(id), -- nullable until assigned
    status VARCHAR(20) DEFAULT 'available', -- available, assigned, used
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_addresses_currency_status ON addresses(currency, status);
CREATE INDEX idx_addresses_order_id ON addresses(order_id);
CREATE UNIQUE INDEX idx_addresses_address ON addresses(address);

-- 6. Payments – blockchain tx tracking (watcher updates this)
CREATE TABLE payments (
    id SERIAL PRIMARY KEY,
    order_id INT NOT NULL REFERENCES orders(id),
    currency VARCHAR(10) NOT NULL,
    tx_hash VARCHAR(255) UNIQUE NOT NULL,
    amount DECIMAL(18,8) NOT NULL,
    confirmations INT DEFAULT 0,
    confirmations_required INT DEFAULT 3,
    watcher_status VARCHAR(20) DEFAULT 'pending', -- pending, confirmed, failed
    detected_at TIMESTAMP DEFAULT NOW(),
    block_height BIGINT
);

CREATE UNIQUE INDEX idx_payments_tx_hash ON payments(tx_hash);
CREATE INDEX idx_payments_order_id ON payments(order_id);
CREATE INDEX idx_payments_watcher_status ON payments(watcher_status);

-- 7. Vendor transactions – ledger (source of truth for balances)
CREATE TABLE vendor_transactions (
    id SERIAL PRIMARY KEY,
    vendor_id INT NOT NULL REFERENCES vendors(id),
    order_id INT REFERENCES orders(id),
    type VARCHAR(50) NOT NULL, -- sale_credit, platform_fee, withdrawal
    amount DECIMAL(18,8) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_vendor_transactions_vendor_id ON vendor_transactions(vendor_id);
CREATE INDEX idx_vendor_transactions_order_id ON vendor_transactions(order_id);
CREATE INDEX idx_vendor_transactions_created_at ON vendor_transactions(created_at);

-- 8. Withdrawals – payout requests and results
CREATE TABLE withdrawals (
    id SERIAL PRIMARY KEY,
    vendor_id INT NOT NULL REFERENCES vendors(id),
    currency VARCHAR(10) NOT NULL,
    amount DECIMAL(18,8) NOT NULL,
    wallet_address VARCHAR(255) NOT NULL,
    tx_hash VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending', -- pending, processing, sent, completed, failed
    retry_count INT DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_withdrawals_vendor_id ON withdrawals(vendor_id);
CREATE INDEX idx_withdrawals_status ON withdrawals(status);
