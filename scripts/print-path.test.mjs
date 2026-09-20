import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');

assert.match(html, /id="printFrame"/);
assert.doesNotMatch(html, /printHost/);
assert.doesNotMatch(html, /body\.printing/);
assert.match(html, /\.print-frame\{position:fixed;left:0;top:0;width:1px;height:1px;opacity:0/);
assert.match(html, /@media print\{body>\*\{display:none!important\}\}/);
assert.match(html, /inset-inline-end:8px;z-index:4/);
assert.match(html, /app\.js\?v=print8/);
assert.match(html, /id="vPrintMenu"/);
assert.match(html, /id="printAll"/);
assert.match(html, /data-scope="page"/);
assert.match(html, /data-scope="all"/);

assert.match(js, /contentWindow/);
assert.match(js, /w\.print\(\)/);
assert.doesNotMatch(js, /window\.print\(/);
assert.match(js, /height:100vh;object-fit:contain/);
assert.doesNotMatch(js, /210mm/);
assert.match(js, /dataset\.scope==='all'/);
assert.match(js, /printRange\(from, to\)/);
assert.match(js, /stampDraw\(/);

console.log('ok');
