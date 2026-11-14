-- Task 3: the event log carries the draft and quote an event belongs to (docs/events.md).

ALTER TABLE events ADD COLUMN draft_id TEXT;
ALTER TABLE events ADD COLUMN quote_id TEXT;
CREATE INDEX idx_events_buyer ON events(buyer_id, id);
