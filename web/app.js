/* وثاق — واجهة متصلة بـ Cloudflare Worker.
   لا أسرار ولا أرقام مديرين هنا: الصلاحية تأتي من /api/me.
   الملف الكامل لا يُطلب إلا بجلسة مسجّلة (/api/file/:id)، والزائر يرى صور معاينة فقط. */

const PEEK = ['back','front']; // ورقة الظهر ثم الوجه

/* ---------- طبقة الخادم ---------- */
async function call(path, {method='GET', body, raw, type}={}) {
  const opt={method, credentials:'same-origin', headers:{}};
  if(raw){ opt.body=raw; opt.headers['content-type']=type; }
  else if(body!==undefined){ opt.body=JSON.stringify(body); opt.headers['content-type']='application/json'; }
  const res=await fetch(path,opt);
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw Object.assign(new Error(data.error||'تعذّر الاتصال بالخادم'),{status:res.status,data});
  return data;
}
const api={
  me:       ()      => call('/api/me').then(d=>d.user),
  register: (b)     => call('/api/register',{method:'POST',body:b}).then(d=>d.user),
  login:    (phone) => call('/api/login',{method:'POST',body:{phone}}).then(d=>d.user),
  logout:   ()      => call('/api/logout',{method:'POST'}),
  tracks:   ()      => call('/api/tracks').then(d=>d.tracks),
  settings: ()      => call('/api/settings'),
  setPrint: (v)     => call('/api/settings',{method:'POST',body:{printAllowed:v}}),
  putLogo:  (f)     => call('/api/my-logo',{method:'PUT',raw:f,type:f.type}),
  delLogo:  ()      => call('/api/my-logo',{method:'DELETE'}),
  savePos:  (p)     => call('/api/my-logo-pos',{method:'POST',body:p}),
  admins:   ()      => call('/api/admins').then(d=>d.admins),
  addAdmin: (phone) => call('/api/admins',{method:'POST',body:{phone}}),
  delAdmin: (phone) => call('/api/admins/'+phone,{method:'DELETE'}),
  users:    ()      => call('/api/users').then(d=>d.users),
  adminTracks:()    => call('/api/tracks?all=1').then(d=>d.tracks),
  patchTrack:(id,b) => call('/api/tracks/'+id,{method:'PATCH',body:b}),
  putTrackFile:(id,f)=> call('/api/tracks/'+id+'/file',{method:'PUT',raw:f,type:'application/pdf'}),
  putPreview:(id,side,blob)=> call('/api/tracks/'+id+'/preview/'+side,{method:'PUT',raw:blob,type:'image/jpeg'})
};

/* ---------- أدوات ---------- */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let tT; const toast=m=>{const t=$('#toast');t.textContent=m;t.style.display='block';clearTimeout(tT);tT=setTimeout(()=>t.style.display='none',2800)};
const normPhone=v=>String(v||'').replace(/\D/g,'').replace(/^966/,'0').slice(0,10);
const validPhone=p=>/^05\d{8}$/.test(p);
let logoVer=0, peekVer=0;
const logoUrl=()=>me?.logo?'/api/my-logo?v='+logoVer:null;

let pdfjs=null;
async function lib(){
  if(pdfjs) return pdfjs;
  pdfjs=await import('./assets/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc='./assets/pdf.worker.min.mjs';
  return pdfjs;
}
const docs={};
async function openPdf(id){
  if(docs[id]) return docs[id];
  const L=await lib();
  docs[id]=await L.getDocument('/api/file/'+id).promise;
  return docs[id];
}
/* ورقة الوجه تُكتشف بمحتواها لا برقمها: مسار+الحلقة، ووجه الحزب /1 مقابل ظهره /2 إن وُجدا. */
const fcache={};
async function isFront(doc,n,id){
  const k=id+':'+n; if(k in fcache) return fcache[k];
  const tc=await doc.getPage(n).then(p=>p.getTextContent());
  const txt=tc.items.map(i=>i.str).join(' ');
  const compact=txt.replace(/\s+/g,'');
  const header=(/مســـار|مســار|مسار/.test(txt)||compact.includes('مسار')) && (txt.includes('الحلقة')||compact.includes('الحلقة'));
  const wajh=/\d{1,3}\s*\/\s*1\b/.test(txt) || /\d{1,3}\/1(?!\d)/.test(compact);
  const zahr=/\d{1,3}\s*\/\s*2\b/.test(txt) || /\d{1,3}\/2(?!\d)/.test(compact);
  if(zahr && !wajh) return fcache[k]=false;
  if(header && wajh) return fcache[k]=true;
  return fcache[k]=header && !zahr;
}

/* توليد معاينة الوجه والظهر من الملف المرفوع — لا كتابة داخل المصدر. زمن أسوأ: خطي مع عدد الصفحات حتى إيجاد الورقتين، وذاكرة صفحة واحدة. */
async function uploadPreviews(id, buf){
  const L=await lib();
  Object.keys(fcache).forEach(k=>{ if(k.startsWith(id+':')) delete fcache[k]; });
  delete docs[id];
  const doc=await L.getDocument({data:new Uint8Array(buf)}).promise;
  try{
    await api.patchTrack(id,{pages:doc.numPages});
    let front=0, back=0;
    for(let n=1;n<=doc.numPages;n++){
      const f=await isFront(doc,n,id);
      if(f && !front) front=n;
      else if(!f && !back) back=n;
      if(front && back) break;
    }
    if(!back) back=1;
    if(!front) front=Math.min(2, doc.numPages);
    const blobFor=async n=>{
      const page=await doc.getPage(n);
      const base=page.getViewport({scale:1});
      const vp=page.getViewport({scale:Math.min(820/base.width, 1.35)});
      const c=document.createElement('canvas');
      c.width=vp.width; c.height=vp.height;
      await page.render({canvasContext:c.getContext('2d',{alpha:false}), viewport:vp}).promise;
      const blob=await new Promise((ok,no)=>c.toBlob(b=>b?ok(b):no(new Error('تعذّر توليد الصورة')), 'image/jpeg', .84));
      c.width=c.height=0;
      return blob;
    };
    await api.putPreview(id,'back', await blobFor(back));
    await api.putPreview(id,'front', await blobFor(front));
    peekVer++;
  }finally{
    await doc.destroy();
  }
}

/* ---------- الحالة ---------- */
let me=null, TRACKS=[], settings={printAllowed:false};

async function boot(){
  [me,TRACKS,settings]=await Promise.all([
    api.me().catch(()=>null),
    api.tracks().catch(()=>[]),
    api.settings().catch(()=>({printAllowed:false}))
  ]);
  if(!TRACKS.length) toast('تعذّر تحميل المسارات من الخادم');
  paintChrome();
}
function paintChrome(){
  const on=!!me;
  $('#who').classList.toggle('hidden',!on);
  $('#btnLogout').classList.toggle('hidden',!on);
  $('#btnSettings').classList.toggle('hidden',!on);
  $('#btnLogin').classList.toggle('hidden',on);
  $('#btnAdmin').classList.toggle('hidden',!me?.isAdmin);
  $('#scGuest').classList.toggle('on',!on);
  $('#scUser').classList.toggle('on',on);
  if(on){
    $('#whoName').textContent=me.name;
    $('#whoAv').textContent=me.name.trim().charAt(0);
    $('#hello').textContent=`أهلًا بك، ${me.name}`;
    $('#userNote').textContent=(me.isAdmin?'لديك صلاحية مدير · ':'')+
      (settings.printAllowed?'الطباعة مفتوحة':'الطباعة مقفلة حاليًا — العرض فقط');
    renderTracks($('#userTracks'),false);
    paintLogo();
  }else renderTracks($('#guestTracks'),true);
}
function renderTracks(host,guest){
  host.innerHTML=TRACKS.map(t=>`
    <button class="track" data-id="${t.id}">
      <span class="thumb"><img src="/api/peek/${t.id}/front?v=${peekVer}" alt="" loading="lazy" onerror="this.remove()"><span class="badge">${t.daily}</span></span>
      <span class="body"><h3>${t.name}</h3>
        <span class="meta">${t.pages??'—'} صفحة · ثلاثة مستويات</span>
        <span class="go">${guest?'معاينة ورقتين':'تصفّح وطباعة'}</span></span>
    </button>`).join('');
  host.querySelectorAll('.track').forEach(b=>b.onclick=()=>{
    const t=TRACKS.find(x=>x.id===b.dataset.id);
    guest?openPeek(t):openViewer(t);
  });
}

/* ---------- معاينة الزائر ---------- */
function openPeek(t){
  V.track=t; V.mode='peek'; V.doc=null; V.holders=[];
  $('#viewer').classList.add('on');
  $('#vTitle').innerHTML=`${t.name} <small>معاينة ورقتين</small>`;
  $('#vLogo').classList.add('hidden');
  $('#printAll').classList.add('hidden');
  $('#vPrint').disabled=false;
  $('#vCount').textContent=PEEK.length; $('#vPage').max=PEEK.length; $('#vPage').value=1;
  $('#vStage').innerHTML=PEEK.map((side,i)=>`
    <div class="pg-box" style="width:min(820px,100%)">
      <img src="/api/peek/${t.id}/${side}?v=${peekVer}" alt="" style="width:100%;display:block;border-radius:4px">
      <span class="side">${side==='front'?'وجه':'ظهر'}</span>
      <span class="num">${i+1} / ${PEEK.length}</span>
    </div>`).join('')+
    `<p style="color:#64798a;font-size:14.5px">ورقتان من ${t.pages??'—'} — سجّل لفتح الملف كاملًا وإضافة شعارك.</p>`;
}

/* ---------- العارض الكامل ---------- */
const V={doc:null,track:null,mode:'full',cur:1,zoom:1,scale:1,holders:[],obs:null,editing:false};
async function openViewer(track){
  V.track=track; V.mode='full'; V.zoom=1; V.cur=1; V.editing=false;
  $('#viewer').classList.add('on');
  $('#vTitle').textContent=track.name;
  $('#vStage').innerHTML='<p style="color:#64798a">جارٍ الفتح…</p>';
  try{ V.doc=await openPdf(track.id); }
  catch(e){ $('#vStage').innerHTML='<p style="color:#a33;text-align:center;max-width:44ch">تعذّر فتح الملف. تأكد أنك مسجّل الدخول وأن الملف مرفوع إلى التخزين.</p>'; return; }
  $('#vCount').textContent=V.doc.numPages; $('#vPage').max=V.doc.numPages;
  $('#vLogo').classList.remove('hidden');
  $('#printAll').classList.remove('hidden');
  $('#vPrint').disabled=!(settings.printAllowed||me?.isAdmin);
  await layout(); goTo(1);
}
$('#vClose').onclick=()=>{ $('#viewer').classList.remove('on'); V.obs?.disconnect(); $('#vStage').innerHTML=''; V.doc=null; V.holders=[]; };

async function layout(){
  V.obs?.disconnect(); V.holders=[]; const stage=$('#vStage'); stage.innerHTML='';
  const vp=(await V.doc.getPage(1)).getViewport({scale:1});
  const availW=Math.min(stage.clientWidth-28,980)*V.zoom;
  const availH=(stage.clientHeight-60)*V.zoom;
  V.scale=Math.min(availW/vp.width, availH/vp.height);
  const w=Math.round(vp.width*V.scale), h=Math.round(vp.height*V.scale);
  V.obs=new IntersectionObserver(es=>es.forEach(e=>{ if(e.isIntersecting) renderPage(+e.target.dataset.n); }),{root:stage,rootMargin:'600px'});
  for(let n=1;n<=V.doc.numPages;n++){
    const d=document.createElement('div');
    d.className='pg-box'; d.dataset.n=n; d.style.width=w+'px'; d.style.height=h+'px';
    d.innerHTML=`<span class="num">${n} / ${V.doc.numPages}</span>`;
    stage.appendChild(d); V.holders.push(d); V.obs.observe(d);
  }
}
async function renderPage(n){
  const box=V.holders[n-1]; if(!box||box.dataset.done) return; box.dataset.done='1';
  const page=await V.doc.getPage(n);
  const dpr=Math.min(window.devicePixelRatio||1,2);
  const vp=page.getViewport({scale:V.scale*dpr});
  const c=document.createElement('canvas'); c.width=vp.width; c.height=vp.height;
  c.style.width=Math.round(vp.width/dpr)+'px'; c.style.height=Math.round(vp.height/dpr)+'px';
  await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
  box.prepend(c);
  const front=await isFront(V.doc,n,V.track.id);
  box.insertAdjacentHTML('beforeend',`<span class="side">${front?'وجه':'ظهر'}</span>`);
  if(front&&me?.logo) mountStamp(box);
}

/* ---------- الشعار ---------- */
const DEF={x:.06,y:.02,w:.16};
const pos=()=>me?.pos||DEF;
function mountStamp(box){
  const el=document.createElement('div');
  el.className='stamp'+(V.editing?' edit':'');
  el.innerHTML=`<img src="${logoUrl()}" alt=""><span class="hdl"></span>`;
  place(el,box,pos()); box.appendChild(el); bindDrag(el,box);
}
function place(el,box,p){
  const W=box.clientWidth,H=box.clientHeight,w=W*p.w;
  el.style.width=w+'px'; el.style.height=(w*.55)+'px';
  el.style.right=(W*p.x)+'px'; el.style.top=(H*p.y)+'px';
}
function bindDrag(el,box){
  let st=null,mode=null;
  const down=e=>{
    if(!V.editing) return; e.preventDefault();
    mode=e.target.classList.contains('hdl')?'size':'move';
    const pt=e.touches?e.touches[0]:e;
    st={x:pt.clientX,y:pt.clientY,p:{...pos()},W:box.clientWidth,H:box.clientHeight};
  };
  const move=e=>{
    if(!st) return;
    const pt=e.touches?e.touches[0]:e, dx=pt.clientX-st.x, dy=pt.clientY-st.y;
    const p={...st.p};
    if(mode==='move'){ p.x=Math.min(.8,Math.max(0,st.p.x-dx/st.W)); p.y=Math.min(.85,Math.max(0,st.p.y+dy/st.H)); }
    else p.w=Math.min(.45,Math.max(.05,st.p.w-dx/st.W));
    me.pos=p; $$('.stamp').forEach(s=>place(s,s.parentElement,p));
  };
  const up=async()=>{ if(!st)return; st=null; try{ await api.savePos(me.pos); }catch(e){ toast('تعذّر حفظ موضع الشعار'); } };
  el.addEventListener('mousedown',down); el.addEventListener('touchstart',down,{passive:false});
  window.addEventListener('mousemove',move); window.addEventListener('touchmove',move,{passive:false});
  window.addEventListener('mouseup',up); window.addEventListener('touchend',up);
}
$('#vLogo').onclick=()=>{
  if(!me?.logo){ toast('ارفع شعارك أولًا'); return; }
  V.editing=!V.editing;
  $$('.stamp').forEach(s=>s.classList.toggle('edit',V.editing));
  $('#vLogo').textContent=V.editing?'تم الضبط':'ضبط الشعار';
  toast(V.editing?'اسحب الشعار، والمقبض لتغيير الحجم':'حُفظ موضع شعارك');
};

/* ---------- تنقّل ---------- */
function goTo(n){
  if(!V.holders.length) return;
  n=Math.max(1,Math.min(V.holders.length,n)); V.cur=n; $('#vPage').value=n;
  $('#vStage').scrollTo({top:V.holders[n-1].offsetTop-18});
}
$('#vPrev').onclick=()=>goTo(V.cur-1);
$('#vNext').onclick=()=>goTo(V.cur+1);
$('#vPage').onchange=e=>goTo(+e.target.value);
$('#vZoomIn').onclick=async()=>{if(!V.doc)return;V.zoom=Math.min(2.2,V.zoom+.2);await layout();goTo(V.cur)};
$('#vZoomOut').onclick=async()=>{if(!V.doc)return;V.zoom=Math.max(.6,V.zoom-.2);await layout();goTo(V.cur)};
$('#vStage').addEventListener('scroll',()=>{
  if(!V.holders.length) return;
  const top=$('#vStage').scrollTop+70;
  for(let i=0;i<V.holders.length;i++){
    if(V.holders[i].offsetTop+V.holders[i].offsetHeight>top){V.cur=i+1;$('#vPage').value=i+1;break}
  }
});
document.addEventListener('keydown',e=>{
  if(!$('#viewer').classList.contains('on')) return;
  if(e.key==='Escape') $('#vClose').click();
  if(e.key==='ArrowLeft') goTo(V.cur+1);
  if(e.key==='ArrowRight') goTo(V.cur-1);
});
$('#vStage').addEventListener('contextmenu',e=>e.preventDefault());

/* ---------- الطباعة ---------- */
const pm=$('#vPrintMenu');
$('#vPrint').onclick=()=>{ if(!$('#vPrint').disabled) pm.classList.toggle('open'); };
document.addEventListener('click',e=>{ if(!pm.contains(e.target)) pm.classList.remove('open'); });
pm.querySelectorAll('.list button').forEach(b=>b.onclick=async()=>{
  pm.classList.remove('open');
  if(V.mode==='peek'){ printPeek(); return; }
  let from=V.cur,to=V.cur;
  if(b.dataset.scope==='all'){from=1;to=V.doc.numPages}
  if(b.dataset.scope==='range'){
    const v=prompt(`نطاق الصفحات من 1 إلى ${V.doc.numPages} (مثال: 3-12):`); if(!v)return;
    const m=v.match(/(\d+)\s*-\s*(\d+)/); if(!m){toast('صيغة غير صحيحة');return}
    from=+m[1]; to=+m[2];
  }
  await printRange(from,to);
});
function printWindow(title,count){
  const w=window.open('','_blank');
  if(!w){ toast('المتصفح منع نافذة الطباعة'); return null; }
  w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${title}</title>
    <style>@page{size:A4 portrait;margin:0}body{margin:0;font-family:sans-serif}
    .s{padding:16px;color:#072c49;font-size:15px}img{display:block;width:100%;page-break-after:always}</style>
    </head><body><p class="s">جارٍ تجهيز ${count} صفحة…</p></body></html>`);
  w.document.close(); return w;
}
function printPeek(){
  const w=printWindow(V.track.name,PEEK.length); if(!w) return;
  PEEK.forEach(side=>{
    const img=w.document.createElement('img');
    img.src=location.origin+`/api/peek/${V.track.id}/${side}?v=${peekVer}`;
    w.document.body.appendChild(img);
  });
  setTimeout(()=>{w.document.querySelector('.s')?.remove();w.focus();w.print()},900);
}
const loadImg=src=>new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=no;i.src=src});
async function printRange(from,to){
  from=Math.max(1,from); to=Math.min(V.doc.numPages,to);
  if(to<from){ toast('النطاق غير صحيح'); return; }
  const w=printWindow(V.track.name,to-from+1); if(!w) return;
  const logo=me?.logo?await loadImg(logoUrl()):null;
  const p=pos();
  for(let n=from;n<=to;n++){
    const page=await V.doc.getPage(n), vp=page.getViewport({scale:2});
    const c=document.createElement('canvas'); c.width=vp.width; c.height=vp.height;
    const ctx=c.getContext('2d');
    await page.render({canvasContext:ctx,viewport:vp}).promise;
    if(logo && await isFront(V.doc,n,V.track.id)){
      const lw=vp.width*p.w, lh=lw*(logo.height/logo.width);
      ctx.drawImage(logo, vp.width-lw-vp.width*p.x, vp.height*p.y, lw, lh);
    }
    const img=w.document.createElement('img');
    img.src=c.toDataURL('image/jpeg',.92);
    w.document.body.appendChild(img);
    const s=w.document.querySelector('.s'); if(s) s.textContent=`جارٍ التجهيز… ${n-from+1} من ${to-from+1}`;
  }
  w.document.querySelector('.s')?.remove();
  setTimeout(()=>{w.focus();w.print()},700);
}

/* ---------- دخول وتسجيل ---------- */
let mode='login';
function openAuth(m,phone){
  mode=m;
  $('#authTitle').textContent=m==='login'?'تسجيل الدخول':'حساب جديد';
  $('#authSub').textContent=m==='login'?'أدخل رقم جوالك.':'مرة واحدة، ثم تدخل برقم جوالك.';
  $('#fName').classList.toggle('hidden',m==='login');
  $('#fOrg').classList.toggle('hidden',m==='login');
  $('#authSwitch').innerHTML=m==='login'
    ?'ليس لديك حساب؟ <button data-go="register">أنشئ حسابًا</button>'
    :'لديك حساب؟ <button data-go="login">سجّل دخولك</button>';
  $('#authSwitch').querySelector('button').onclick=e=>openAuth(e.target.dataset.go);
  if(phone) $('#iPhone').value=phone;
  $('#authSheet').classList.add('on');
  setTimeout(()=>$('#iPhone').focus(),60);
}
$('#iPhone').oninput=e=>e.target.value=normPhone(e.target.value);
$('#newAdmin').oninput=e=>e.target.value=normPhone(e.target.value);
const bad=(id,msg)=>{const f=$(id);f.classList.add('err');const h=f.querySelector('.hint');if(h)h.textContent=msg;setTimeout(()=>f.classList.remove('err'),2800)};
$('#goLogin').onclick=$('#btnLogin').onclick=()=>openAuth('login');
$('#goRegister').onclick=()=>openAuth('register');
$$('[data-close-auth]').forEach(b=>b.onclick=()=>$('#authSheet').classList.remove('on'));
$('#authSheet').onclick=e=>{ if(e.target.id==='authSheet') $('#authSheet').classList.remove('on'); };

$('#authGo').onclick=async()=>{
  const phone=normPhone($('#iPhone').value);
  if(!validPhone(phone)){ bad('#fPhone','رقم غير صحيح — يبدأ بـ 05 ويتكون من 10 أرقام'); return; }
  const btn=$('#authGo'); btn.disabled=true;
  try{
    if(mode==='register'){
      const name=$('#iName').value.trim(), org=$('#iOrg').value.trim();
      if(name.length<3){ bad('#fName','اكتب اسمك كاملًا'); return; }
      if(org.length<2){ bad('#fOrg','اكتب اسم الجهة'); return; }
      me=await api.register({name,phone,org});
    }else me=await api.login(phone);
    settings=await api.settings();
    $('#authSheet').classList.remove('on');
    paintChrome();
    toast(`أهلًا بك، ${me.name}`);
  }catch(e){
    if(e.data?.needsRegister){
      toast(e.data.isAdminPhone?'رقم مدير — أكمل بياناتك مرة واحدة':'لا يوجد حساب بهذا الرقم — أنشئ حسابًا');
      openAuth('register',phone);
    }else toast(e.message);
  }finally{ btn.disabled=false; }
};
$('#btnLogout').onclick=async()=>{ await api.logout().catch(()=>{}); me=null; paintChrome(); toast('خرجت من حسابك'); };

/* ---------- شعارك ---------- */
$('#btnSettings').onclick=()=>$('#logoSheet').classList.add('on');
$$('[data-close-logo]').forEach(b=>b.onclick=()=>$('#logoSheet').classList.remove('on'));
$('#logoSheet').onclick=e=>{ if(e.target.id==='logoSheet') $('#logoSheet').classList.remove('on'); };
$('#logoPick').onclick=()=>$('#logoInput').click();
$('#logoInput').onchange=async e=>{
  const f=e.target.files[0]; if(!f) return;
  if(f.size>900*1024){ toast('اختر صورة أقل من 900 كيلوبايت'); return; }
  try{ await api.putLogo(f); me.logo='/api/my-logo'; logoVer++; paintLogo(); toast('حُفظ شعارك — يظهر على أوراق الوجه'); }
  catch(err){ toast(err.message); }
};
$('#logoReset').onclick=async()=>{
  try{ await api.delLogo(); me.logo=null; me.pos=null; $$('.stamp').forEach(s=>s.remove()); paintLogo(); toast('عادت نسختك إلى الملف الأصلي'); }
  catch(err){ toast(err.message); }
};
function paintLogo(){
  $('#logoBox').innerHTML=me?.logo?`<img src="${logoUrl()}" alt="شعارك">`:'<span class="ph">لم يُرفع شعار بعد</span>';
}

/* ---------- لوحة المدير ---------- */
$('#btnAdmin').onclick=async()=>{ $('#adminSheet').classList.add('on'); await paintAdmin(); };
$$('[data-close-admin]').forEach(b=>b.onclick=()=>$('#adminSheet').classList.remove('on'));
$('#adminSheet').onclick=e=>{ if(e.target.id==='adminSheet') $('#adminSheet').classList.remove('on'); };
$('#printToggle').onclick=async()=>{
  try{ settings=await api.setPrint(!settings.printAllowed); await paintAdmin(); paintChrome(); }
  catch(e){ toast(e.message); }
};
$('#addAdmin').onclick=async()=>{
  const p=normPhone($('#newAdmin').value);
  if(!validPhone(p)){ toast('رقم غير صحيح'); return; }
  try{ await api.addAdmin(p); $('#newAdmin').value=''; await paintAdmin(); toast('أُضيف مدير'); }
  catch(e){ toast(e.message); }
};
$('#exportUsers').onclick=async()=>{
  try{
    const us=await api.users();
    const rows=[['الاسم','الجوال','الجهة','تاريخ التسجيل'],
      ...us.map(u=>[u.name,u.phone,u.org,new Date(u.created_at).toLocaleDateString('ar-SA')])];
    const csv='\uFEFF'+rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download='withaq-users.csv'; a.click();
  }catch(e){ toast(e.message); }
};
const attr=s=>String(s??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
let adminTracks=[];
async function syncPublicTracks(){
  TRACKS=await api.tracks().catch(()=>TRACKS);
  if(me) renderTracks($('#userTracks'),false);
  else renderTracks($('#guestTracks'),true);
}
function paintAdminTracks(){
  const host=$('#tracksAdmin');
  if(!host) return;
  if(!adminTracks.length){
    host.innerHTML='<p style="color:var(--muted);margin:0">لا مسارات بعد</p>';
    return;
  }
  host.innerHTML=adminTracks.map((t,i)=>`
    <div class="track-admin" data-id="${attr(t.id)}">
      <div class="ta-top">
        <b>${attr(t.name)}</b>
        <span class="ta-id">${attr(t.id)} · ${t.pages??'—'} صفحة</span>
        <span class="flag${t.hidden?' off':''}"><b></b><span>${t.hidden?'مخفي':'ظاهر'}</span></span>
      </div>
      <div class="field"><label>الاسم</label>
        <div class="ctrl"><input class="ta-name" value="${attr(t.name)}"></div></div>
      <div class="field"><label>الوصف اليومي</label>
        <div class="ctrl"><input class="ta-daily" value="${attr(t.daily)}"></div></div>
      <div class="ta-actions">
        <button class="btn btn-a ta-save" style="padding:8px 16px">حفظ</button>
        <button class="btn btn-line ta-hide" style="padding:8px 16px">${t.hidden?'إظهار':'إخفاء'}</button>
        <button class="btn btn-line ta-up" style="padding:8px 16px" ${i===0?'disabled':''}>أعلى</button>
        <button class="btn btn-line ta-down" style="padding:8px 16px" ${i===adminTracks.length-1?'disabled':''}>أسفل</button>
        <button class="btn btn-line ta-replace" style="padding:8px 16px">استبدال الملف</button>
        <input type="file" accept="application/pdf" class="ta-file" hidden>
      </div>
    </div>`).join('');
  host.querySelectorAll('.track-admin').forEach(row=>{
    const id=row.dataset.id;
    const busy=on=>{
      row.querySelectorAll('button').forEach(b=>{
        if(on){ b.dataset.prevDis=b.disabled?'1':'0'; b.disabled=true; }
        else b.disabled=b.dataset.prevDis==='1';
      });
    };
    row.querySelector('.ta-save').onclick=async()=>{
      const name=row.querySelector('.ta-name').value.trim();
      const daily=row.querySelector('.ta-daily').value.trim();
      if(name.length<1){ toast('اكتب اسم المسار'); return; }
      if(daily.length<1){ toast('اكتب الوصف اليومي'); return; }
      busy(true);
      try{ await api.patchTrack(id,{name,daily}); await paintAdmin(); await syncPublicTracks(); toast('حُفظ المسار'); }
      catch(e){ toast(e.message); busy(false); }
    };
    row.querySelector('.ta-hide').onclick=async()=>{
      const t=adminTracks.find(x=>x.id===id); if(!t) return;
      busy(true);
      try{ await api.patchTrack(id,{hidden:!t.hidden}); await paintAdmin(); await syncPublicTracks(); toast(t.hidden?'ظهر المسار':'أُخفي المسار'); }
      catch(e){ toast(e.message); busy(false); }
    };
    row.querySelector('.ta-up').onclick=()=>reorderAdminTracks(id,-1);
    row.querySelector('.ta-down').onclick=()=>reorderAdminTracks(id,1);
    const file=row.querySelector('.ta-file');
    row.querySelector('.ta-replace').onclick=()=>file.click();
    file.onchange=async()=>{
      const f=file.files[0]; file.value='';
      if(!f) return;
      if(f.type && f.type!=='application/pdf'){ toast('يجب أن يكون الملف PDF'); return; }
      if(!confirm('سيظهر الملف الجديد لجميع المستخدمين فورًا، ويبقى شعار كل مستخدم على نسخته دون أن يُكتب داخل الملف. أتؤكد الاستبدال؟')) return;
      busy(true);
      const buf=await f.arrayBuffer();
      try{
        await api.putTrackFile(id, new Blob([buf],{type:'application/pdf'}));
        try{ await uploadPreviews(id,buf); toast('استُبدل الملف وحُدّثت المعاينة'); }
        catch(e){ toast('استُبدل الملف وتعذّر توليد المعاينة: '+e.message); }
        await paintAdmin();
        await syncPublicTracks();
      }
      catch(e){ toast(e.message); busy(false); }
    };
  });
}
async function reorderAdminTracks(id,dir){
  const i=adminTracks.findIndex(t=>t.id===id);
  const j=i+dir;
  if(i<0||j<0||j>=adminTracks.length) return;
  const next=adminTracks.slice();
  const [item]=next.splice(i,1);
  next.splice(j,0,item);
  try{
    for(let k=0;k<next.length;k++) await api.patchTrack(next[k].id,{sort:k+1});
    await paintAdmin();
    await syncPublicTracks();
  }catch(e){ toast(e.message); }
}
async function paintAdmin(){
  if(!me?.isAdmin) return;
  const f=$('#printFlag');
  f.classList.toggle('off',!settings.printAllowed);
  f.lastElementChild.textContent=settings.printAllowed?'مفتوحة':'مقفلة';
  $('#printState').textContent=settings.printAllowed
    ?'المستخدمون يطبعون صفحة أو نطاقًا أو الملف كاملًا.'
    :'العرض فقط — زر الطباعة معطّل عند المستخدمين (المدير يطبع دائمًا، والمعاينة العامة تُطبع).';
  try{
    const [admins,users,tracks]=await Promise.all([api.admins(),api.users(),api.adminTracks()]);
    adminTracks=tracks;
    paintAdminTracks();
    $('#adminList').innerHTML=admins.map(a=>`
      <div class="rowx" style="justify-content:space-between;border-bottom:1px solid var(--line);padding:7px 0">
        <span>${a.phone}</span>
        <button class="btn btn-line" data-del="${a.phone}" style="padding:5px 14px">حذف</button>
      </div>`).join('');
    $('#adminList').querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{
      try{ await api.delAdmin(b.dataset.del); await paintAdmin(); }catch(e){ toast(e.message); }
    });
    $('#usersCount').textContent=`(${users.length})`;
    $('#usersTable').innerHTML='<tr><th>الاسم</th><th>الجوال</th><th>الجهة</th></tr>'+
      (users.length?users.map(u=>`<tr><td>${u.name}</td><td>${u.phone}</td><td>${u.org}</td></tr>`).join('')
                   :'<tr><td colspan="3" style="color:var(--muted)">لا مسجَّلين بعد</td></tr>');
  }catch(e){ toast(e.message); }
}

let rt; window.addEventListener('resize',()=>{
  if(!V.doc||!$('#viewer').classList.contains('on')) return;
  clearTimeout(rt); rt=setTimeout(async()=>{ await layout(); goTo(V.cur); },250);
});

boot();
