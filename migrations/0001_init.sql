-- Lazydoor schema. JSON columns hold TEXT; timestamps are ISO-8601 strings with +02:00.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE products (
  id                TEXT PRIMARY KEY,
  category          TEXT NOT NULL,
  subtype           TEXT,
  tag_source        TEXT,
  names             TEXT NOT NULL,
  sales_unit        TEXT,
  base_unit         TEXT,
  units_per_sales   REAL,
  lot_step          REAL,
  temp_class        TEXT,
  claims            TEXT,
  allergens         TEXT,
  labels            TEXT,
  brand             TEXT,
  brand_norm        TEXT,
  sales_unit_gtin   TEXT,
  origin            TEXT,
  reliability       REAL,
  carbon            TEXT,
  substitutes       TEXT,
  variable_weight   INTEGER NOT NULL DEFAULT 0,
  name_content      TEXT,
  search_text       TEXT
);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_gtin ON products(sales_unit_gtin);
CREATE INDEX idx_products_brand_norm ON products(brand_norm);

CREATE TABLE category_names (
  category TEXT PRIMARY KEY,
  names    TEXT NOT NULL
);

CREATE TABLE valio_replies (
  recording  TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('availability', 'price')),
  product_id TEXT NOT NULL,
  body       TEXT NOT NULL,
  time_now   TEXT,
  PRIMARY KEY (recording, kind, product_id)
);

CREATE TABLE api_keys (
  key_hash TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  label    TEXT
);

CREATE TABLE buyer_keys (
  buyer_id   TEXT PRIMARY KEY,
  public_key TEXT NOT NULL
);

CREATE TABLE approver_keys (
  key_hash TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  approver TEXT NOT NULL
);

CREATE TABLE mandates (
  buyer_id  TEXT PRIMARY KEY,
  payload   TEXT NOT NULL,
  signature TEXT NOT NULL
);

CREATE TABLE drafts (
  id         TEXT PRIMARY KEY,
  buyer_id   TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE quotes (
  id         TEXT PRIMARY KEY,
  buyer_id   TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE baskets (
  id         TEXT PRIMARY KEY,
  buyer_id   TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE orders (
  id              TEXT PRIMARY KEY,
  buyer_id        TEXT NOT NULL,
  quote_id        TEXT,
  basket_id       TEXT,
  idempotency_key TEXT,
  request_hash    TEXT,
  state           TEXT NOT NULL,
  net_cents       INTEGER NOT NULL DEFAULT 0,
  delivery_date   TEXT,
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  expires_at      TEXT
);
CREATE UNIQUE INDEX idx_orders_idem ON orders(buyer_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE order_lines (
  order_id      TEXT NOT NULL REFERENCES orders(id),
  buyer_id      TEXT NOT NULL,
  product_id    TEXT NOT NULL,
  delivery_date TEXT NOT NULL,
  sales_units   REAL NOT NULL,
  state         TEXT NOT NULL
);
CREATE INDEX idx_order_lines_product_date ON order_lines(product_id, delivery_date);
CREATE INDEX idx_order_lines_order ON order_lines(order_id);

CREATE TABLE events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT,
  buyer_id TEXT,
  kind     TEXT NOT NULL,
  body     TEXT NOT NULL,
  at       TEXT NOT NULL
);
CREATE INDEX idx_events_order ON events(order_id);
