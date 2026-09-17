/* هندسة الشعار المشتركة بين العارض والطباعة.
   صندوق الشاشة: العرض نسبة من الصفحة، الارتفاع STAMP_AR من العرض، والصورة تُحتوى وتتوسّط داخله.
   الزمن: ثابت. المكان: ثابت. */

export const STAMP_AR = 0.55;

export function stampDraw(pageW, pageH, p, imgW, imgH){
  const boxW = pageW * p.w;
  const boxH = boxW * STAMP_AR;
  const boxX = pageW - boxW - pageW * p.x;
  const boxY = pageH * p.y;
  const ar = imgW > 0 ? imgH / imgW : STAMP_AR;
  let w, h;
  if(ar > STAMP_AR){ h = boxH; w = boxH / ar; }
  else { w = boxW; h = boxW * ar; }
  return { x: boxX + (boxW - w) / 2, y: boxY + (boxH - h) / 2, w, h };
}
