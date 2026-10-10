-- Transcripts of what is said in each Short, made by Workers AI Whisper from audio the local helper downloads.
-- Only text is stored, never audio. Cached per video so a re-run never transcribes the same Short twice.
CREATE TABLE IF NOT EXISTS transcripts (
  video_id   TEXT PRIMARY KEY,
  handle     TEXT NOT NULL,
  status     TEXT NOT NULL,      -- "ok" or "no_speech" (under ~1 word per second)
  language   TEXT,
  text       TEXT,
  opening    TEXT,               -- what is said in the first ~45 seconds
  segments   TEXT,               -- JSON [[start_s, end_s, text], ...]
  words      INTEGER,
  duration_s REAL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS transcripts_handle ON transcripts (handle);
