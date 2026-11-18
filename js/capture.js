/* Снимки и запись экрана. В браузере захват начинается с системного выбора
   источника; в настольной оболочке можно подключить нативный мост capture_app. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  let shot = null, rec = null, picker = null;

  const appSettings = () => (typeof S !== 'undefined' ? S.settings : null);
  const privacyOn = () => { const st = appSettings(); if (!(st && st.capturePrivacy === false)) document.body.classList.add('capture-privacy'); };
  const privacyOff = () => document.body.classList.remove('capture-privacy');
    const waitFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  function notice(text, kind = 'info') {
    if (typeof toast === 'function') toast(text, kind);
    else console.log(text);
  }

  function captureError(e) {
    privacyOff();
    notice('Не удалось захватить экран: ' + (e && e.message ? e.message : e), 'err');
  }

  async function grabFrame() {
    const native = window.electronAPI || window.multitool || window.pywebview?.api;
    const nativeCap = native && (native.captureApp || native.capture_app);
    if (nativeCap) {
      const r = await nativeCap.call(native);
      if (r?.data || r?.dataUrl) return loadCanvas(r.data || r.dataUrl);
      if (r?.error) throw new Error(r.error);
    }
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('браузер не поддерживает захват экрана');
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30, displaySurface: 'browser' }, audio: false, preferCurrentTab: true
    });
    try {
      const video = el('video'); video.muted = true; video.playsInline = true; video.srcObject = stream;
      await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = rej; setTimeout(res, 1600); });
      await video.play();
      const c = document.createElement('canvas');
      c.width = video.videoWidth || innerWidth * devicePixelRatio;
      c.height = video.videoHeight || innerHeight * devicePixelRatio;
      c.getContext('2d').drawImage(video, 0, 0);
      return c;
    } finally { stream.getTracks().forEach(t => t.stop()); }
  }

  function loadCanvas(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); res(c); };
      img.onerror = rej; img.src = src;
    });
  }

  function download(dataUrl, name) {
    const a = document.createElement('a'); a.href = dataUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }

  function dataUrlToFile(dataUrl, name = 'screenshot.png') {
    const [meta, b64] = dataUrl.split(',');
    const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'image/png';
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], name, { type: mime });
  }

  function pickElement() {
    return new Promise(resolve => {
      const layer = el('div', 'cap-picker', '<div class="cap-picker__hint">Наведите на элемент приложения и нажмите, чтобы сделать снимок</div>');
      const box = el('div', 'cap-picker__box');
      layer.appendChild(box); document.body.appendChild(layer);
      let current = null;
      const move = e => {
        const t = document.elementFromPoint(e.clientX, e.clientY);
        if (!t || t === layer || t.closest('.cap-picker')) return;
        current = t; const r = t.getBoundingClientRect();
        Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      };
      const click = e => {
        e.preventDefault(); e.stopPropagation();
        const r = current && current.getBoundingClientRect();
        cleanup(); resolve(r ? { x:r.left, y:r.top, width:r.width, height:r.height } : null);
      };
      const esc = e => { if (e.key === 'Escape') { cleanup(); resolve(null); } };
      const cleanup = () => { layer.remove(); document.removeEventListener('keydown', esc, true); };
      layer.addEventListener('pointermove', move);
      layer.addEventListener('pointerdown', click);
      document.addEventListener('keydown', esc, true);
    });
  }

  async function startShot(mode = 'shot', onAttach = null) {
    try {
      privacyOn();
      let rect = null;
      if (mode === 'element') { rect = await pickElement(); if (!rect) { privacyOff(); return; } }
      await waitFrame();
      const src = await grabFrame();
      privacyOff();
      let out = src;
      if (rect) {
        const dpr = Math.max(1, Math.min(src.width / innerWidth, src.height / innerHeight));
        const x = Math.max(0, Math.round(rect.x * dpr)), y = Math.max(0, Math.round(rect.y * dpr));
        const w = Math.max(1, Math.min(src.width - x, Math.round(rect.width * dpr)));
        const h = Math.max(1, Math.min(src.height - y, Math.round(rect.height * dpr)));
        out = document.createElement('canvas'); out.width = w; out.height = h;
        out.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h);
      }
      openEditor(out, onAttach);
    } catch (e) { captureError(e); }
  }

  function openEditor(base, onAttach) {
    if (shot) shot.root.remove();
    const root = el('div', 'cap-editor');
    root.innerHTML = `<div class="cap-editor__bar"><b>Снимок экрана</b><span class="cap-editor__hint">Рисуйте поверх снимка</span><span class="spacer"></span><button class="btn btn--ghost btn--sm" data-cap-crop>Кроп</button><button class="btn btn--primary btn--sm" data-cap-save>Скачать</button>${onAttach ? '<button class="btn btn--soft btn--sm" data-cap-attach>Вложить</button>' : ''}<button class="iconbtn" data-cap-x title="Закрыть">×</button></div><div class="cap-editor__stage"><canvas></canvas></div><div class="cap-tools"><button data-tool="hand" class="on" title="Рука">✋</button><button data-tool="select" title="Выделить">⬚</button><button data-tool="rect" title="Прямоугольник">▭</button><button data-tool="ellipse" title="Эллипс">◯</button><button data-tool="arrow" title="Стрелка">↗</button><button data-tool="pen" title="Маркер">✎</button><button data-tool="text" title="Текст">T</button><span class="spacer"></span><button data-color="#ff5c5c" class="on" style="color:#ff5c5c">●</button><button data-color="#ffd166" style="color:#ffd166">●</button><button data-color="#4cc9f0" style="color:#4cc9f0">●</button><button data-color="#ffffff" style="color:#fff">●</button><button data-cap-undo title="Отменить">↶</button></div>`;
    document.body.appendChild(root);
    const canvas = $('canvas', root), ctx = canvas.getContext('2d');
    shot = { root, base, tool:'hand', crop: null, shapes: [], color:'#ff5c5c', line: 4, onAttach, canvas };
    const drawShape = (x, sh) => {
      if (!sh) return;
      x.save(); x.strokeStyle = sh.color || '#ff5c5c'; x.fillStyle = x.strokeStyle; x.lineWidth = sh.width || 4; x.lineCap='round'; x.lineJoin='round';
      if (sh.tool === 'rect' || sh.tool === 'select'){
        if (sh.tool === 'select') x.setLineDash([7,4]);
        x.strokeRect(sh.x, sh.y, sh.w, sh.h);
      } else if (sh.tool === 'ellipse'){
        x.beginPath(); x.ellipse(sh.x+sh.w/2, sh.y+sh.h/2, Math.abs(sh.w)/2, Math.abs(sh.h)/2, 0, 0, Math.PI*2); x.stroke();
      } else if (sh.tool === 'arrow'){
        const ex=sh.x+sh.w, ey=sh.y+sh.h; x.beginPath(); x.moveTo(sh.x,sh.y); x.lineTo(ex,ey); x.stroke();
        const a=Math.atan2(ey-sh.y,ex-sh.x), l=14+sh.width*3;
        x.beginPath(); x.moveTo(ex,ey); x.lineTo(ex-l*Math.cos(a-.5),ey-l*Math.sin(a-.5)); x.moveTo(ex,ey); x.lineTo(ex-l*Math.cos(a+.5),ey-l*Math.sin(a+.5)); x.stroke();
      } else if (sh.tool === 'pen'){
        if (!sh.points.length) return; x.beginPath(); x.moveTo(sh.points[0].x, sh.points[0].y);
        sh.points.slice(1).forEach(p=>x.lineTo(p.x,p.y)); x.stroke();
      } else if (sh.tool === 'text'){
        x.font = `700 ${Math.max(16, sh.width*4)}px system-ui, sans-serif`; x.fillText(sh.text || '', sh.x, sh.y);
      }
      x.restore();
    };
    const draw = () => {
      ctx.drawImage(shot.base, 0, 0);
      if (shot.crop) {
        const c = shot.crop; ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.42)'; ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.clearRect(c.x,c.y,c.w,c.h); ctx.drawImage(shot.base,c.x,c.y,c.w,c.h,c.x,c.y,c.w,c.h);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([7,4]); ctx.strokeRect(c.x,c.y,c.w,c.h); ctx.restore();
      }
      shot.shapes.forEach(sh=>drawShape(ctx,sh));
    };
    let drag = null;
    const pt = e => { const r = canvas.getBoundingClientRect(); return { x:(e.clientX-r.left)*canvas.width/r.width, y:(e.clientY-r.top)*canvas.height/r.height }; };
    const startShape = p => ({ tool:shot.tool, x:p.x, y:p.y, w:0, h:0, color:shot.color, width:shot.line, points:[p] });
    canvas.addEventListener('pointerdown', e => {
      const p = pt(e);
      if (shot.tool === 'text'){ const text=prompt('Текст на снимке'); if(text){ shot.shapes.push({tool:'text',x:p.x,y:p.y,text,color:shot.color,width:shot.line}); draw(); } return; }
      if (shot.tool === 'hand') return;
      drag = p; const sh = startShape(p); shot.shapes.push(sh); canvas.setPointerCapture(e.pointerId); draw();
    });
    canvas.addEventListener('pointermove', e => {
      if (!drag) return; const p=pt(e); const sh=shot.shapes[shot.shapes.length-1]; if(!sh)return;
      if (sh.tool==='pen'){ sh.points.push(p); }
      else { sh.w=p.x-drag.x; sh.h=p.y-drag.y; if(sh.tool==='text'||sh.tool==='arrow'||sh.tool==='rect'||sh.tool==='ellipse'||sh.tool==='select'){ sh.w=p.x-drag.x; sh.h=p.y-drag.y; } }
      draw();
    });
    const end = () => { drag = null; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    root.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{ shot.tool=b.dataset.tool; root.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('on',x===b)); canvas.style.cursor=b.dataset.tool==='hand'?'grab':'crosshair'; });
    root.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{ shot.color=b.dataset.color; root.querySelectorAll('[data-color]').forEach(x=>x.classList.toggle('on',x===b)); });
    $('[data-cap-undo]',root).onclick=()=>{ shot.shapes.pop(); draw(); };
    $('[data-cap-x]',root).onclick = close;
    $('[data-cap-save]',root).onclick = ()=>{ download(compose(), 'audiowizard-shot-'+Date.now()+'.jpg'); close(); };
    const attach = $('[data-cap-attach]',root); if (attach) attach.onclick = ()=>{ onAttach(dataUrlToFile(compose(), 'screenshot.jpg')); close(); };
    const cropBtn = $('[data-cap-crop]',root);
    cropBtn.onclick = () => {
      if (shot.tool === 'crop' && shot.crop){ applyCrop(); return; }
      shot.tool='crop'; shot.crop=null; canvas.style.cursor='crosshair';
      toast('Выделите область для кропа и нажмите «Кроп» ещё раз','info');
    };
    canvas.addEventListener('pointerdown', e => {
      if (shot.tool !== 'crop') return;
      const p=pt(e); drag=p; shot.crop={x:p.x,y:p.y,w:0,h:0}; canvas.setPointerCapture(e.pointerId);
    }, true);
    canvas.addEventListener('pointermove', e => {
      if (shot.tool !== 'crop' || !drag) return; const p=pt(e); shot.crop={x:Math.min(drag.x,p.x),y:Math.min(drag.y,p.y),w:Math.abs(p.x-drag.x),h:Math.abs(p.y-drag.y)}; draw();
    }, true);
    canvas.addEventListener('pointerup', ()=>{ if(shot.tool==='crop') drag=null; }, true);
    function applyCrop(){
      const c=shot.crop; if(!c||c.w<4||c.h<4){toast('Сначала выделите область','warn');return;}
      const out=document.createElement('canvas'); out.width=Math.max(1,Math.round(c.w)); out.height=Math.max(1,Math.round(c.h)); out.getContext('2d').drawImage(shot.base,c.x,c.y,c.w,c.h,0,0,out.width,out.height);
      shot.base=out; shot.crop=null; shot.shapes=[]; canvas.width=out.width; canvas.height=out.height; draw(); toast('Кроп применён','ok'); shot.tool='hand';
    }
    function compose(){
      const out=document.createElement('canvas'); out.width=shot.base.width; out.height=shot.base.height; const x=out.getContext('2d'); x.drawImage(shot.base,0,0); shot.shapes.forEach(sh=>drawShape(x,sh));
      return out.toDataURL('image/jpeg', .86);
    }
    function close(){ root.remove(); shot=null; }
    canvas.width=base.width; canvas.height=base.height; draw();
  }

  function openMenu() {
    openWinModal({ title:'Снимок экрана', icon:'app', narrow:true, locked:true, backdrop:true,
      body:`<div class="stack" style="gap:10px">
        <p class="small muted" style="margin:0">Снимок приложения с автоматической маской баланса, заказов, людей и переписок. Маску можно отключить в профиле.</p>
        <button class="btn btn--soft" data-cap="shot">Сделать снимок</button>
        <button class="btn btn--ghost" data-cap="element">Выделить элемент</button>
        <button class="btn btn--ghost" data-cap="record">Записать экран</button>
        <p class="tiny faint" style="margin:0">В браузере система один раз спросит, что захватывать. В настольной сборке используется нативный захват.</p>
      </div>`,
      footer:'<button class="btn btn--ghost" data-x>Закрыть</button>',
      onMount:(m,c)=>{ m.querySelectorAll('[data-cap]').forEach(b=>b.onclick=()=>{ const mode=b.dataset.cap; c(); setTimeout(()=>mode==='record'?openRecord():startShot(mode),120); }); m.querySelector('[data-x]').onclick=c; }
    });
  }

  function openRecordSetup(stream) {
    const root = el('div','cap-editor cap-rec-setup');
    root.innerHTML = `<div class="cap-editor__bar"><b>Запись экрана</b><span class="cap-editor__hint">Выделите область кропа</span><span class="spacer"></span><label class="check"><input type="checkbox" id="cap-mic"><span class="box"></span> Микрофон</label><button class="btn btn--primary btn--sm" data-cap-start>Начать</button><button class="iconbtn" data-cap-x>×</button></div><div class="cap-editor__stage"><video autoplay muted playsinline></video><div class="cap-cropbox"></div></div>`;
    document.body.appendChild(root);
    const video=$('video',root), box=$('.cap-cropbox',root);
    video.srcObject=stream; video.play().catch(()=>{});
    let crop={x:0,y:0,w:0,h:0}, drag=null;
    const pt=e=>{const r=video.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
    const setBox=()=>{const r=video.getBoundingClientRect();Object.assign(box.style,{left:(crop.x/r.width*video.videoWidth)+'px'});};
    const draw=()=>{const r=video.getBoundingClientRect();const sx=r.width/video.videoWidth,sy=r.height/video.videoHeight;Object.assign(box.style,{left:crop.x*sx+'px',top:crop.y*sy+'px',width:crop.w*sx+'px',height:crop.h*sy+'px'});};
    video.addEventListener('pointerdown',e=>{const p=pt(e);drag=p;crop={x:p.x,y:p.y,w:0,h:0};});
    video.addEventListener('pointermove',e=>{if(!drag)return;const p=pt(e);crop={x:Math.min(drag.x,p.x),y:Math.min(drag.y,p.y),w:Math.abs(p.x-drag.x),h:Math.abs(p.y-drag.y)};draw();});
    video.addEventListener('pointerup',()=>drag=null);
    $('[data-cap-x]',root).onclick=()=>{stream.getTracks().forEach(t=>t.stop());root.remove();privacyOff();};
    $('[data-cap-start]',root).onclick=async()=>{
      const mic=$('#cap-mic',root).checked;
      const rect=video.getBoundingClientRect();
      const kx=rect.width?(video.videoWidth||rect.width)/rect.width:1, ky=rect.height?(video.videoHeight||rect.height)/rect.height:1;
      const scaled={x:crop.x*kx,y:crop.y*ky,w:crop.w*kx,h:crop.h*ky};
      root.remove(); await startRecording(stream, video, scaled, mic);
    };
  }

  async function openRecord() {
    try {
      privacyOn();
      let stream = null;
      const native = window.electronAPI || window.multitool;
      if (native && native.captureScreenStream) stream = await native.captureScreenStream();
      if (!stream) stream = await navigator.mediaDevices.getDisplayMedia({ video:{frameRate:30,displaySurface:'browser'}, audio:false, preferCurrentTab:true });
      openRecordSetup(stream);
    } catch(e){ captureError(e); }
  }

  async function startRecording(stream, video, crop, mic) {
    try {
      const vw=video.videoWidth||innerWidth, vh=video.videoHeight||innerHeight;
      const rw=crop.w>4?crop.w:vw, rh=crop.h>4?crop.h:vh;
      const sx=crop.w>4?crop.x:0, sy=crop.h>4?crop.y:0;
      if (!video.isConnected){ video.style.cssText='position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none'; document.body.appendChild(video); }
      const canvas=document.createElement('canvas'); canvas.width=Math.max(2,Math.round(rw)); canvas.height=Math.max(2,Math.round(rh));
      const ctx=canvas.getContext('2d');
      const draw=()=>{ ctx.drawImage(video,sx,sy,rw,rh,0,0,canvas.width,canvas.height); if(rec) rec.raf=requestAnimationFrame(draw); };
      const out=canvas.captureStream(30);
      if (mic){
        try { const ms=await navigator.mediaDevices.getUserMedia({audio:true}); ms.getAudioTracks().forEach(t=>out.addTrack(t)); } catch(e){ notice('Микрофон недоступен — запись без звука','warn'); }
      }
      const chunks=[]; const mr=new MediaRecorder(out,{mimeType:MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm', videoBitsPerSecond: 2200000, audioBitsPerSecond: 128000});
      mr.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      mr.onstop=()=>{ const blob=new Blob(chunks,{type:'video/webm'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='audiowizard-recording-'+Date.now()+'.webm'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); privacyOff(); stream.getTracks().forEach(t=>t.stop()); video.remove(); slot.remove(); rec=null; notice('Запись сохранена','ok'); };
      rec={stream,mr,raf:0};
      const bar=el('div','cap-rec-bar','<b>● Запись</b><span class="cap-rec-time">00:00</span><button class="btn btn--danger btn--sm" data-stop>Остановить</button>');
      document.body.appendChild(bar); const slot=bar;
      $('[data-stop]',bar).onclick=()=>{ cancelAnimationFrame(rec.raf); rec.mr.stop(); };
      const t0=Date.now(); setInterval(()=>{ if(!rec)return; const s=Math.floor((Date.now()-t0)/1000); const tm=$('.cap-rec-time',bar); if(tm) tm.textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0'); },500);
      draw(); mr.start(500); privacyOn();
    } catch(e){ captureError(e); }
  }

  window.CaptureStudio = { open:openMenu, shot:startShot, shotToFile:(cb)=>startShot('shot',cb), element:()=>startShot('element'), record:openRecord };
})();
