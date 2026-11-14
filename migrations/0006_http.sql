-- Task 10: API key roles (agent | judge | admin) and the per-key per-minute counter behind the interpret rate limit.

ALTER TABLE api_keys ADD COLUMN role TEXT NOT NULL DEFAULT 'agent';

CREATE TABLE rate_limits (
  key_hash TEXT NOT NULL,
  minute   INTEGER NOT NULL,
  n        INTEGER NOT NULL,
  PRIMARY KEY (key_hash, minute)
);
