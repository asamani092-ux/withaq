import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const man = JSON.parse(readFileSync(new URL('../web/manifest.webmanifest', import.meta.url), 'utf8'));

assert.match(html, /rel="icon"[^>]+favicon\.ico/);
assert.match(html, /rel="icon"[^>]+assets\/favicon-32\.png/);
assert.match(html, /rel="apple-touch-icon"[^>]+assets\/apple-touch-icon\.png/);
assert.match(html, /rel="manifest"[^>]+manifest\.webmanifest/);
assert.match(html, /apple-mobile-web-app-title" content="وثاق"/);
assert.equal(man.short_name, 'وثاق');
assert.equal(man.display, 'standalone');
assert.ok(man.icons.some(i => i.sizes === '192x192'));
assert.ok(man.icons.some(i => i.purpose === 'maskable'));

for (const f of [
  'web/favicon.ico',
  'web/assets/favicon-32.png',
  'web/assets/apple-touch-icon.png',
  'web/assets/app-icon-192.png',
  'web/assets/app-icon-512.png',
  'web/assets/app-icon-512-maskable.png'
]) assert.ok(existsSync(new URL('../'+f, import.meta.url)), f);

console.log('ok');
