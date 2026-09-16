/**
 * وثاق — Cloudflare Worker
 * D1: بيانات المستخدمين والجلسات والمسارات.  R2: ملفات PDF وشعارات المستخدمين.
 * قاعدة حاكمة: ملف المسار مصدر للقراءة فقط؛ شعار المستخدم كائن منفصل لا يُدمج في المصدر أبدًا.
 */

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;            // الواجهة الثابتة (web/)
  SESSION_DAYS?: string;
}

const DAY = 86_400_000;
const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });
const err = (message: string, status = 400) => json({ error: message }, status);

const normPhone = (v: unknown) => String(v ?? '').replace(/\D/g, '').replace(/^966/, '0').slice(0, 10);
const validPhone = (p: string) => /^05\d{8}$/.test(p);
const now = () => Date.now();

const clientIp = (req: Request) =>
  (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || '')
    .split(',')[0].trim() || 'unknown';

/* أحداث تُضاف ولا تُستبدل. زمن العد: لوغاريتمي+خطي مع أحداث النافذة. */
async function allowRate(env: Env, bucket: string, limit: number, windowMs: number): Promise<boolean> {
  const t = now();
  await env.DB.prepare('DELETE FROM rate_events WHERE created_at < ?').bind(t - windowMs * 2).run();
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM rate_events WHERE bucket = ? AND created_at >= ?'
  ).bind(bucket, t - windowMs).first<{ c: number }>();
  if ((row?.c ?? 0) >= limit) return false;
  await env.DB.prepare('INSERT INTO rate_events (bucket, created_at) VALUES (?, ?)').bind(bucket, t).run();
  return true;
}
const tooMany = (message = 'تجاوزت حد المحاولات، انتظر قليلًا') =>
  json({ error: message }, 429, { 'retry-after': '60' });

/* ---------- الجلسة ---------- */
type Session = { phone: string; name: string; org: string; isAdmin: boolean };

async function readSession(req: Request, env: Env): Promise<Session | null> {
  const token = (req.headers.get('cookie') || '')
    .split(';').map(s => s.trim()).find(s => s.startsWith('withaq_s='))?.slice(9);
  if (!token) return null;

  const row = await env.DB.prepare(
    `SELECT u.phone, u.name, u.org, s.expires_at
       FROM sessions s JOIN users u ON u.phone = s.phone
      WHERE s.token = ?`
  ).bind(token).first<{ phone: string; name: string; org: string; expires_at: number }>();

  if (!row) return null;
  if (row.expires_at < now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }
  const admin = await env.DB.prepare('SELECT 1 FROM admins WHERE phone = ?').bind(row.phone).first();
  return { phone: row.phone, name: row.name, org: row.org, isAdmin: !!admin };
}

async function issueSession(env: Env, phone: string) {
  const token = crypto.randomUUID() + '.' + crypto.randomUUID();
  const days = Number(env.SESSION_DAYS ?? 30);
  await env.DB.prepare(
    'INSERT INTO sessions (token, phone, created_at, expires_at) VALUES (?,?,?,?)'
  ).bind(token, phone, now(), now() + days * DAY).run();
  const cookie = `withaq_s=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${days * 86400}`;
  return cookie;
}

/* ---------- المسارات ---------- */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;

    if (!p.startsWith('/api/')) return env.ASSETS.fetch(req);

    try {
      /* تسجيل */
      if (p === '/api/register' && req.method === 'POST') {
        const b = await req.json<any>();
        const phone = normPhone(b.phone);
        const name = String(b.name ?? '').trim();
        const org = String(b.org ?? '').trim();
        const ip = clientIp(req);
        if (!(await allowRate(env, `reg-ip:${ip}`, 10, 15 * 60 * 1000))) return tooMany();
        if (!(await allowRate(env, `reg:${ip}:${phone}`, 5, 15 * 60 * 1000))) return tooMany();
        if (!validPhone(phone)) return err('رقم غير صحيح — يبدأ بـ 05 ويتكون من 10 أرقام');
        if (name.length < 3) return err('اكتب اسمك كاملًا');
        if (org.length < 2) return err('اكتب اسم الجهة');

        const exists = await env.DB.prepare('SELECT 1 FROM users WHERE phone = ?').bind(phone).first();
        if (exists) return err('هذا الرقم مسجّل — سجّل دخولك مباشرة', 409);

        await env.DB.prepare(
          'INSERT INTO users (phone,name,org,created_at,last_login) VALUES (?,?,?,?,?)'
        ).bind(phone, name, org, now(), now()).run();

        const cookie = await issueSession(env, phone);
        const isAdmin = !!(await env.DB.prepare('SELECT 1 FROM admins WHERE phone=?').bind(phone).first());
        return json({ user: { phone, name, org, isAdmin, logo: null, pos: null } }, 200, { 'set-cookie': cookie });
      }

      /* دخول */
      if (p === '/api/login' && req.method === 'POST') {
        const b = await req.json<any>();
        const phone = normPhone(b.phone);
        const ip = clientIp(req);
        if (!(await allowRate(env, `login-ip:${ip}`, 20, 15 * 60 * 1000))) return tooMany();
        if (!(await allowRate(env, `login:${ip}:${phone}`, 8, 15 * 60 * 1000))) return tooMany();
        if (!validPhone(phone)) return err('رقم غير صحيح');
        const u = await env.DB.prepare('SELECT phone,name,org,logo_key,logo_pos FROM users WHERE phone=?')
          .bind(phone).first<any>();
        if (!u) {
          const isAdminPhone = !!(await env.DB.prepare('SELECT 1 FROM admins WHERE phone=?').bind(phone).first());
          return json({ error: 'لا يوجد حساب بهذا الرقم', needsRegister: true, isAdminPhone }, 404);
        }
        await env.DB.prepare('UPDATE users SET last_login=? WHERE phone=?').bind(now(), phone).run();
        const cookie = await issueSession(env, phone);
        const isAdmin = !!(await env.DB.prepare('SELECT 1 FROM admins WHERE phone=?').bind(phone).first());
        return json({
          user: { phone, name: u.name, org: u.org, isAdmin, logo: u.logo_key ? `/api/my-logo` : null, pos: u.logo_pos ? JSON.parse(u.logo_pos) : null }
        }, 200, { 'set-cookie': cookie });
      }

      if (p === '/api/logout' && req.method === 'POST') {
        const token = (req.headers.get('cookie') || '').split(';').map(s => s.trim())
          .find(s => s.startsWith('withaq_s='))?.slice(9);
        if (token) await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(token).run();
        return json({ ok: true }, 200, { 'set-cookie': 'withaq_s=; Path=/; Max-Age=0' });
      }

      /* من أنا */
      if (p === '/api/me' && req.method === 'GET') {
        const s = await readSession(req, env);
        if (!s) return json({ user: null });
        const u = await env.DB.prepare('SELECT logo_key,logo_pos FROM users WHERE phone=?').bind(s.phone).first<any>();
        return json({ user: { ...s, logo: u?.logo_key ? '/api/my-logo' : null, pos: u?.logo_pos ? JSON.parse(u.logo_pos) : null } });
      }

      /* إعدادات عامة */
      if (p === '/api/settings' && req.method === 'GET') {
        const r = await env.DB.prepare("SELECT value FROM settings WHERE key='print_allowed'").first<any>();
        return json({ printAllowed: r?.value === '1' });
      }
      if (p === '/api/settings' && req.method === 'POST') {
        const s = await readSession(req, env);
        if (!s?.isAdmin) return err('صلاحية مدير مطلوبة', 403);
        const b = await req.json<any>();
        await env.DB.prepare("UPDATE settings SET value=? WHERE key='print_allowed'")
          .bind(b.printAllowed ? '1' : '0').run();
        return json({ printAllowed: !!b.printAllowed });
      }

      /* المسارات */
      if (p === '/api/tracks' && req.method === 'GET') {
        const s = await readSession(req, env);
        const all = url.searchParams.get('all') === '1';
        if (all && !s?.isAdmin) return err('صلاحية مدير مطلوبة', 403);
        const rows = await env.DB.prepare(
          all
            ? 'SELECT id,name,daily,pages,hidden,sort FROM tracks ORDER BY sort'
            : 'SELECT id,name,daily,pages,hidden FROM tracks WHERE hidden=0 ORDER BY sort'
        ).all<any>();
        return json({ tracks: rows.results, signedIn: !!s });
      }

      /* ملف المسار — للجلسات المسجّلة فقط */
      const fileMatch = p.match(/^\/api\/file\/([a-z0-9-]+)$/i);
      if (fileMatch && req.method === 'GET') {
        const s = await readSession(req, env);
        if (!s) return err('يلزم تسجيل الدخول', 401);
        if (!(await allowRate(env, `file:${clientIp(req)}:${s.phone}`, 40, 5 * 60 * 1000)))
          return tooMany('تجاوزت حد التحميل، انتظر قليلًا');
        const t = await env.DB.prepare('SELECT r2_key FROM tracks WHERE id=? AND hidden=0').bind(fileMatch[1]).first<any>();
        if (!t) return err('المسار غير موجود', 404);
        const obj = await env.BUCKET.get(t.r2_key);
        if (!obj) return err('الملف غير مرفوع إلى التخزين', 404);
        return new Response(obj.body, {
          headers: {
            'content-type': 'application/pdf',
            'cache-control': 'private, max-age=600',
            'content-disposition': 'inline'
          }
        });
      }

      /* المعاينة العامة — ورقتان فقط، صور مُولّدة مسبقًا في R2 تحت preview/ */
      const peekMatch = p.match(/^\/api\/peek\/([a-z0-9-]+)\/(front|back)$/i);
      if (peekMatch && req.method === 'GET') {
        const obj = await env.BUCKET.get(`preview/${peekMatch[1]}-${peekMatch[2]}.jpg`);
        if (!obj) return err('لا توجد معاينة', 404);
        return new Response(obj.body, {
          headers: {
            'content-type': 'image/jpeg',
            'cache-control': 'public, max-age=120',
            ...(obj.httpEtag ? { etag: obj.httpEtag } : {})
          }
        });
      }

      /* شعار المستخدم — نسخته وحده */
      if (p === '/api/my-logo' && req.method === 'GET') {
        const s = await readSession(req, env);
        if (!s) return err('يلزم تسجيل الدخول', 401);
        const u = await env.DB.prepare('SELECT logo_key FROM users WHERE phone=?').bind(s.phone).first<any>();
        if (!u?.logo_key) return err('لا يوجد شعار', 404);
        const obj = await env.BUCKET.get(u.logo_key);
        if (!obj) return err('لا يوجد شعار', 404);
        return new Response(obj.body, {
          headers: { 'content-type': obj.httpMetadata?.contentType || 'image/png', 'cache-control': 'private, max-age=60' }
        });
      }
      if (p === '/api/my-logo' && req.method === 'PUT') {
        const s = await readSession(req, env);
        if (!s) return err('يلزم تسجيل الدخول', 401);
        const raw = (req.headers.get('content-type') || 'image/png').split(';')[0].trim().toLowerCase();
        const type = raw === 'image/jpg' ? 'image/jpeg' : raw;
        if (!/^image\/(png|jpeg|svg\+xml)$/.test(type)) return err('صيغة غير مدعومة');
        const buf = await req.arrayBuffer();
        if (buf.byteLength > 900 * 1024) return err('حجم الشعار يتجاوز 900 كيلوبايت');
        const key = `logos/${s.phone}`;
        await env.BUCKET.put(key, buf, { httpMetadata: { contentType: type } });
        await env.DB.prepare('UPDATE users SET logo_key=? WHERE phone=?').bind(key, s.phone).run();
        return json({ ok: true });
      }
      if (p === '/api/my-logo' && req.method === 'DELETE') {
        const s = await readSession(req, env);
        if (!s) return err('يلزم تسجيل الدخول', 401);
        await env.BUCKET.delete(`logos/${s.phone}`);
        await env.DB.prepare('UPDATE users SET logo_key=NULL, logo_pos=NULL WHERE phone=?').bind(s.phone).run();
        return json({ ok: true });
      }
      /* موضع الشعار */
      if (p === '/api/my-logo-pos' && req.method === 'POST') {
        const s = await readSession(req, env);
        if (!s) return err('يلزم تسجيل الدخول', 401);
        const b = await req.json<any>();
        const pos = { x: Number(b.x), y: Number(b.y), w: Number(b.w) };
        if (![pos.x, pos.y, pos.w].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) return err('قيم غير صحيحة');
        await env.DB.prepare('UPDATE users SET logo_pos=? WHERE phone=?').bind(JSON.stringify(pos), s.phone).run();
        return json({ ok: true });
      }

      /* ---------- لوحة المدير ---------- */
      const admin = async () => {
        const s = await readSession(req, env);
        return s?.isAdmin ? s : null;
      };

      if (p === '/api/admins' && req.method === 'GET') {
        if (!(await admin())) return err('صلاحية مدير مطلوبة', 403);
        const r = await env.DB.prepare('SELECT phone, added_at FROM admins ORDER BY added_at').all<any>();
        return json({ admins: r.results });
      }
      if (p === '/api/admins' && req.method === 'POST') {
        const s = await admin(); if (!s) return err('صلاحية مدير مطلوبة', 403);
        const phone = normPhone((await req.json<any>()).phone);
        if (!validPhone(phone)) return err('رقم غير صحيح');
        await env.DB.prepare('INSERT OR IGNORE INTO admins (phone, added_by, added_at) VALUES (?,?,?)')
          .bind(phone, s.phone, now()).run();
        return json({ ok: true });
      }
      if (p.startsWith('/api/admins/') && req.method === 'DELETE') {
        const s = await admin(); if (!s) return err('صلاحية مدير مطلوبة', 403);
        const phone = normPhone(p.split('/').pop());
        const count = await env.DB.prepare('SELECT COUNT(*) c FROM admins').first<any>();
        if (count.c <= 1) return err('لا يمكن حذف آخر مدير');
        await env.DB.prepare('DELETE FROM admins WHERE phone=?').bind(phone).run();
        return json({ ok: true });
      }

      if (p === '/api/users' && req.method === 'GET') {
        if (!(await admin())) return err('صلاحية مدير مطلوبة', 403);
        const r = await env.DB.prepare(
          'SELECT phone,name,org,created_at,last_login FROM users ORDER BY created_at DESC LIMIT 5000'
        ).all<any>();
        return json({ users: r.results });
      }

      /* استبدال/إضافة ملف مسار — يظهر لكل المستخدمين فورًا، وشعار كل مستخدم يبقى */
      const upMatch = p.match(/^\/api\/tracks\/([a-z0-9-]+)\/file$/i);
      if (upMatch && req.method === 'PUT') {
        if (!(await admin())) return err('صلاحية مدير مطلوبة', 403);
        if ((req.headers.get('content-type') || '') !== 'application/pdf') return err('يجب أن يكون الملف PDF');
        const id = upMatch[1];
        const key = `tracks/${id}.pdf`;
        await env.BUCKET.put(key, req.body, { httpMetadata: { contentType: 'application/pdf' } });
        await env.DB.prepare(
          `INSERT INTO tracks (id,name,daily,r2_key,sort,updated_at) VALUES (?,?,?,?,999,?)
           ON CONFLICT(id) DO UPDATE SET r2_key=excluded.r2_key, updated_at=excluded.updated_at`
        ).bind(id, id, '—', key, now()).run();
        return json({ ok: true });
      }

      /* معاينة الوجه/الظهر — يولّدها المتصفح بعد الرفع؛ العامل يخزّن فقط */
      const prevMatch = p.match(/^\/api\/tracks\/([a-z0-9-]+)\/preview\/(front|back)$/i);
      if (prevMatch && req.method === 'PUT') {
        if (!(await admin())) return err('صلاحية مدير مطلوبة', 403);
        const type = (req.headers.get('content-type') || '').split(';')[0].trim();
        if (type !== 'image/jpeg' && type !== 'image/jpg') return err('يجب أن تكون الصورة JPEG');
        const id = prevMatch[1];
        const side = prevMatch[2].toLowerCase();
        const t = await env.DB.prepare('SELECT id FROM tracks WHERE id=?').bind(id).first();
        if (!t) return err('المسار غير موجود', 404);
        const buf = await req.arrayBuffer();
        if (buf.byteLength < 32) return err('الصورة فارغة');
        if (buf.byteLength > 1_500_000) return err('حجم صورة المعاينة يتجاوز الحد');
        await env.BUCKET.put(`preview/${id}-${side}.jpg`, buf, { httpMetadata: { contentType: 'image/jpeg' } });
        return json({ ok: true });
      }

      if (p.match(/^\/api\/tracks\/[a-z0-9-]+$/i) && req.method === 'PATCH') {
        if (!(await admin())) return err('صلاحية مدير مطلوبة', 403);
        const id = p.split('/').pop()!;
        const b = await req.json<any>();
        const pages = b.pages === undefined || b.pages === null ? null : Number(b.pages);
        if (pages !== null && (!Number.isInteger(pages) || pages < 1 || pages > 5000)) return err('عدد الصفحات غير صحيح');
        await env.DB.prepare(
          'UPDATE tracks SET name=COALESCE(?,name), daily=COALESCE(?,daily), hidden=COALESCE(?,hidden), sort=COALESCE(?,sort), pages=COALESCE(?,pages), updated_at=? WHERE id=?'
        ).bind(b.name ?? null, b.daily ?? null, b.hidden === undefined ? null : (b.hidden ? 1 : 0), b.sort ?? null, pages, now(), id).run();
        return json({ ok: true });
      }

      return err('المسار غير موجود', 404);
    } catch (e: any) {
      return err('خطأ في الخادم: ' + (e?.message ?? String(e)), 500);
    }
  }
};
