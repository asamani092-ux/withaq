-- حد المعدّل: أحداث تراكمية، لا تُستبدل. يُحصى العدد داخل النافذة الزمنية.
CREATE TABLE IF NOT EXISTS rate_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_bucket_created ON rate_events(bucket, created_at);
