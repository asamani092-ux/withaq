-- وثاق — المخطط الأول
CREATE TABLE IF NOT EXISTS users (
  phone       TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  org         TEXT NOT NULL,
  logo_key    TEXT,              -- مفتاح الشعار في R2 (نسخة المستخدم وحده)
  logo_pos    TEXT,              -- JSON: {x,y,w} نسب من أبعاد الصفحة
  created_at  INTEGER NOT NULL,
  last_login  INTEGER
);

CREATE TABLE IF NOT EXISTS admins (
  phone      TEXT PRIMARY KEY,
  added_by   TEXT,
  added_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  phone      TEXT NOT NULL REFERENCES users(phone) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(phone);
CREATE INDEX IF NOT EXISTS idx_sessions_exp   ON sessions(expires_at);

-- المسارات يديرها المدير؛ الملف نفسه في R2 والسجل هنا بيانات وصفية فقط
CREATE TABLE IF NOT EXISTS tracks (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  daily      TEXT NOT NULL,
  r2_key     TEXT NOT NULL,
  pages      INTEGER,
  hidden     INTEGER NOT NULL DEFAULT 0,
  sort       INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key,value) VALUES ('print_allowed','0');

-- المدير الأساسي
INSERT OR IGNORE INTO admins (phone, added_by, added_at)
VALUES ('0555143246','seed', strftime('%s','now')*1000);

-- المسارات الأربعة (ارفع الملفات إلى R2 بهذه المفاتيح: npm run seed:r2)
INSERT OR IGNORE INTO tracks (id,name,daily,r2_key,pages,sort,updated_at) VALUES
 ('masar-5','مسار خمسة أسطر','٥ أسطر يوميًا','tracks/masar-5.pdf',126,1,strftime('%s','now')*1000),
 ('masar-7','مسار سبعة أسطر','٧ أسطر يوميًا','tracks/masar-7.pdf',122,2,strftime('%s','now')*1000),
 ('masar-10','مسار عشرة أسطر','١٠ أسطر يوميًا','tracks/masar-10.pdf',122,3,strftime('%s','now')*1000),
 ('masar-wajh-1','مسار وجه واحد','وجه يوميًا','tracks/masar-wajh-1.pdf',122,4,strftime('%s','now')*1000);
