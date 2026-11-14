-- Task 2: packaging levels and the consumer GTIN, plus a GTIN lookup over every packaging level.

ALTER TABLE products ADD COLUMN units TEXT;
ALTER TABLE products ADD COLUMN gtin TEXT;

CREATE TABLE product_gtins (
  gtin       TEXT NOT NULL,
  product_id TEXT NOT NULL,
  unit_id    TEXT NOT NULL
);
CREATE INDEX idx_product_gtins_gtin ON product_gtins(gtin);
