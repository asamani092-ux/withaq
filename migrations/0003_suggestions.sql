-- المقترحات: سجلات تُضاف ولا تُستبدل. أعمدة مطلوبة فقط؛ الاسم/الجهة يُقرآن بربط users عند العرض.
CREATE TABLE IF NOT EXISTS suggestions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  phone      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suggestions_created ON suggestions(created_at);
