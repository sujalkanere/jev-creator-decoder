-- Saved decodes, one row per creator handle.
CREATE TABLE IF NOT EXISTS decodes (
  handle   TEXT PRIMARY KEY,
  title    TEXT,
  count    INTEGER NOT NULL DEFAULT 0,
  payload  TEXT NOT NULL,
  saved_at TEXT NOT NULL
);
