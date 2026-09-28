-- Dashboard password (stored only as a salted hash), sign-in sessions, and saved hooks.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS shortlist (
  handle     TEXT NOT NULL,
  text       TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (handle, text)
);
