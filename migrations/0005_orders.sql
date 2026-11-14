-- Task 7: order state machine columns. `body` holds {lines, unmet}; `expires_at` is the approval deadline; `request_hash` the idempotent body.

ALTER TABLE orders ADD COLUMN reason TEXT;
ALTER TABLE orders ADD COLUMN gross_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN decision TEXT;
ALTER TABLE orders ADD COLUMN agent_reason TEXT;
ALTER TABLE orders ADD COLUMN mandate_version INTEGER;
ALTER TABLE orders ADD COLUMN approver TEXT;
ALTER TABLE orders ADD COLUMN lines_hash TEXT;
ALTER TABLE orders ADD COLUMN approval_token TEXT;
ALTER TABLE orders ADD COLUMN reply TEXT;
CREATE UNIQUE INDEX idx_orders_token ON orders(approval_token) WHERE approval_token IS NOT NULL;
CREATE INDEX idx_orders_day ON orders(buyer_id, delivery_date, state);
