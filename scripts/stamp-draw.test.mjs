import { STAMP_AR, stampDraw } from '../web/stamp-draw.js';
import assert from 'node:assert/strict';

const pageW = 1000, pageH = 1414.285714;
const p = { x: 0.06, y: 0.02, w: 0.16 };
const boxW = pageW * p.w;
const boxH = boxW * STAMP_AR;
const boxX = pageW - boxW - pageW * p.x;
const boxY = pageH * p.y;
const oldPrint = (imgW, imgH) => {
  const lw = pageW * p.w, lh = lw * (imgH / imgW);
  return { x: pageW - lw - pageW * p.x, y: pageH * p.y, w: lw, h: lh };
};

function inBox(r){
  assert.ok(r.x + 1e-9 >= boxX);
  assert.ok(r.y + 1e-9 >= boxY);
  assert.ok(r.x + r.w <= boxX + boxW + 1e-9);
  assert.ok(r.y + r.h <= boxY + boxH + 1e-9);
}

{
  const r = stampDraw(pageW, pageH, p, 100, 100);
  assert.equal(STAMP_AR, 0.55);
  assert.ok(Math.abs(r.w - boxH) < 1e-9);
  assert.ok(Math.abs(r.h - boxH) < 1e-9);
  assert.ok(Math.abs(r.x - (boxX + (boxW - r.w) / 2)) < 1e-9);
  assert.ok(Math.abs(r.y - boxY) < 1e-9);
  inBox(r);
  const old = oldPrint(100, 100);
  assert.ok(old.h > boxH, 'الصيغة القديمة تتجاوز صندوق الشاشة للشعار المربع');
  assert.ok(r.h < old.h);
}

{
  const r = stampDraw(pageW, pageH, p, 200, 50);
  assert.ok(Math.abs(r.w - boxW) < 1e-9);
  assert.ok(Math.abs(r.h - boxW * 0.25) < 1e-9);
  assert.ok(Math.abs(r.x - boxX) < 1e-9);
  assert.ok(Math.abs(r.y - (boxY + (boxH - r.h) / 2)) < 1e-9);
  inBox(r);
}

{
  const r = stampDraw(pageW, pageH, p, 40, 200);
  assert.ok(Math.abs(r.h - boxH) < 1e-9);
  assert.ok(Math.abs(r.w - boxH / 5) < 1e-9);
  inBox(r);
}

{
  const peekW = 804, peekH = 1137;
  const r = stampDraw(peekW, peekH, p, 100, 100);
  const old = { w: peekW * p.w, h: peekW * p.w };
  assert.ok(Math.abs(r.h - peekW * p.w * STAMP_AR) < 1e-6);
  assert.ok(r.h < old.h);
  assert.ok(r.h / old.h < 0.56);
}

console.log('ok');
