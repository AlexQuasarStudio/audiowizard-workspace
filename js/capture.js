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


  async function selfCanvas() {
    try {
      if (window.html2canvas) {
        try { return await window.html2canvas(document.body, {
          backgroundColor: null, scale: 1, useCORS: true, logging: false, foreignObjectRendering: true,
          width: innerWidth, height: innerHeight,
          windowWidth: innerWidth, windowHeight: innerHeight,
          scrollX: 0, scrollY: 0,
          ignoreElements: node => !!(node.matches && node.matches('.cap-editor,.cap-tools,.cap-rec-bar,.cap-picker,.cap-rec-live,.cookie-bar,.dd,.tour-card,.tour-spot')),
          onclone: doc => {
            doc.querySelectorAll('.cap-editor,.cap-tools,.cap-rec-bar,.cap-picker,.cap-rec-live,.cookie-bar,.dd,.tour-card,.tour-spot').forEach(n=>n.remove());
            if (!(typeof S !== 'undefined' && S.settings && S.settings.capturePrivacy === false)) doc.body.classList.add('capture-privacy');
            const cv=document.createElement('canvas'), cx=cv.getContext('2d');
            const norm=v=>{ if(!v||!/color\(/i.test(v)) return v; try{ cx.fillStyle='#000'; cx.fillStyle=v; return cx.fillStyle; }catch(e){ return v; } };
            const props=['color','background-color','border-top-color','border-right-color','border-bottom-color','border-left-color','outline-color','text-decoration-color','caret-color','column-rule-color'];
            doc.querySelectorAll('*').forEach(el=>{
              const cs=doc.defaultView.getComputedStyle(el);
              props.forEach(p=>{ const v=cs.getPropertyValue(p); if(/color\(/i.test(v)) el.style.setProperty(p,norm(v),'important'); });
              if(/color\(/i.test(cs.backgroundImage)) el.style.setProperty('background-image','none','important');
              if(/color\(/i.test(cs.boxShadow)) el.style.setProperty('box-shadow','none','important');
            });
          }
        }); } catch(e) { console.warn('html2canvas', e); }
      }
      const css = [];
      for (const sh of document.styleSheets) {
        try { css.push([...sh.cssRules].map(r=>r.cssText).join('\n')); }
        catch (e) { if (sh.href) { try { css.push(await (await fetch(sh.href)).text()); } catch (e2) {} } }
      }
      const clone = document.documentElement.cloneNode(true);
      clone.querySelectorAll('script,link[rel="stylesheet"],.cap-editor,.cap-tools,.cap-rec-bar,.cap-picker,.cookie-bar,.dd,.tour-card,.tour-spot,.cap-rec-live,.cap-rec-bar,.cap-rec-help').forEach(n=>n.remove());
      let style = clone.querySelector('style[data-cap-css]');
      if (!style){ style=document.createElement('style'); style.dataset.capCss='1'; clone.querySelector('head').appendChild(style); }
      let cssText = css.join('\n');
      const urls = [...new Set([...cssText.matchAll(/url\((['\"]?)([^)'\"]+)\1\)/g)].map(m=>m[2]).filter(u=>u && !/^(data:|#|blob:)/.test(u)))];
      const map = {};
      await Promise.all(urls.map(async u=>{ try { const abs=new URL(u, location.href); const b=await (await fetch(abs)).blob(); map[u]=await new Promise(res=>{const r=new FileReader();r.onload=()=>res(r.result);r.readAsDataURL(b);}); } catch(e){} }));
      cssText = cssText.replace(/url\((['\"]?)([^)'\"]+)\1\)/g, (m,q,u)=>map[u]?`url(${q}${map[u]}${q})`:m);
      style.textContent += '\n'+cssText+'\nbody.capture-privacy::after{display:none!important}';
      clone.style.width = innerWidth + 'px'; clone.style.height = innerHeight + 'px'; clone.style.overflow='hidden';
      const imgs = [...clone.querySelectorAll('img')];
      await Promise.all(imgs.map(async img=>{
        const src=img.getAttribute('src'); if(!src || /^data:/.test(src)) return;
        try { const b=await (await fetch(src)).blob(); img.src=await new Promise(res=>{const r=new FileReader();r.onload=()=>res(r.result);r.readAsDataURL(b);}); } catch(e){}
      }));
      const xml = new XMLSerializer().serializeToString(clone);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${innerWidth}" height="${innerHeight}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`;
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      const img = await loadImage(url);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const c=document.createElement('canvas'); c.width=Math.round(innerWidth*dpr); c.height=Math.round(innerHeight*dpr);
      c.getContext('2d').drawImage(img,0,0,c.width,c.height); return c;
    } catch(e){ return null; }
  }
  function loadImage(src){ return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src;}); }

  async function grabFrame() {
    const native = window.electronAPI || window.multitool || window.pywebview?.api;
    const nativeCap = native && (native.captureApp || native.capture_app);
    if (nativeCap) {
      const r = await nativeCap.call(native);
      if (r?.data || r?.dataUrl) return loadCanvas(r.data || r.dataUrl);
      if (r?.error) throw new Error(r.error);
    }
    const own = await selfCanvas();
    if (own) return own;
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


  async function startShot(mode = 'shot', onAttach = null) {
    try {
      privacyOn();
      await waitFrame();
      const src = await grabFrame();
      privacyOff();
      const k = src.width / Math.max(1, innerWidth);
      const xs = new Set(), ys = new Set();
      [...document.querySelectorAll('body *')].forEach(el=>{
        if (el.closest('.cap-editor,.cap-tools,.cap-rec-live,.cap-rec-bar,.cap-picker')) return;
        const r=el.getBoundingClientRect(), cs=getComputedStyle(el);
        if (r.width<6 || r.height<6 || r.bottom<0 || r.right<0 || r.top>innerHeight || r.left>innerWidth) return;
        if (cs.visibility==='hidden' || cs.display==='none' || +cs.opacity===0) return;
        [r.left,r.right,r.left+r.width/2].forEach(v=>xs.add(Math.round(v*k)));
        [r.top,r.bottom,r.top+r.height/2].forEach(v=>ys.add(Math.round(v*k)));
      });
      openEditor(src, onAttach, {xs:[...xs], ys:[...ys], scale:k});
    } catch (e) { captureError(e); }
  }

  function openEditor(base, onAttach, guides={xs:[],ys:[],scale:1}) {
    if (shot) shot.root.remove();
    const root = el('div', 'cap-editor');
    root.innerHTML = `<div class="cap-editor__bar"><b>Снимок экрана</b><span class="cap-editor__hint">Рисуйте поверх снимка</span><span class="spacer"></span><button class="btn btn--ghost btn--sm" data-cap-crop>Кроп</button><button class="btn btn--primary btn--sm" data-cap-save>Скачать</button>${onAttach ? '<button class="btn btn--soft btn--sm" data-cap-attach>Вложить</button>' : ''}<button class="iconbtn" data-cap-x title="Закрыть">×</button></div><div class="cap-editor__stage"><canvas></canvas></div><div class="cap-tools"><button data-tool="cursor" title="Курсор — взаимодействие с приложением"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 3l14 8-6 1-3 7L5 3Z" fill="currentColor"/></svg></button><button data-tool="hand" class="on" title="Рука">✋</button><button data-tool="select" title="Выделить">⬚</button><button data-tool="rect" title="Прямоугольник">▭</button><button data-tool="ellipse" title="Эллипс">◯</button><button data-tool="arrow" title="Стрелка">↗</button><button data-tool="pen" title="Маркер">✎</button><button data-tool="text" title="Текст">T</button><span class="spacer"></span><button data-color="#ff5c5c" class="on" style="color:#ff5c5c">●</button><button data-color="#ffd166" style="color:#ffd166">●</button><button data-color="#4cc9f0" style="color:#4cc9f0">●</button><button data-color="#ffffff" style="color:#fff">●</button><button data-cap-undo title="Отменить">↶</button><button data-cap-redo title="Повторить">↷</button></div>`;
    document.body.appendChild(root);
    const canvas = $('canvas', root), ctx = canvas.getContext('2d');
    shot = { root, base, tool:'hand', crop: null, shapes: [], redo: [], sel:null, color:'#ff5c5c', line: 4, onAttach, canvas, guides };
    const bbox = sh => {
      if (sh.tool === 'pen' && sh.points && sh.points.length){ const xs=sh.points.map(p=>p.x), ys=sh.points.map(p=>p.y); return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)}; }
      return { x:sh.x||0, y:sh.y||0, w:sh.w||0, h:sh.h||0 };
    };
    const drawShape = (x, sh) => {
      if (!sh) return;
      const bb = bbox(sh), cx = bb.x+bb.w/2, cy = bb.y+bb.h/2;
      x.save(); x.translate(cx,cy); x.rotate(sh.rot||0); x.translate(-cx,-cy); x.strokeStyle = sh.color || '#ff5c5c'; x.fillStyle = x.strokeStyle; x.lineWidth = sh.width || 4; x.lineCap='round'; x.lineJoin='round';
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
      if (shot.snapLines){ ctx.save(); ctx.strokeStyle='#ff4fa3'; ctx.lineWidth=1.5; ctx.setLineDash([6,4]); shot.snapLines.forEach(l=>{ctx.beginPath(); if(l.axis==='x'){ctx.moveTo(l.v,0);ctx.lineTo(l.v,canvas.height);} else {ctx.moveTo(0,l.v);ctx.lineTo(canvas.width,l.v);} ctx.stroke();}); ctx.restore(); }
      if (shot.sel){ const bb=bbox(shot.sel); ctx.save(); ctx.strokeStyle='#4cc9f0'; ctx.lineWidth=2; ctx.setLineDash([5,4]); ctx.strokeRect(bb.x,bb.y,bb.w,bb.h); ctx.setLineDash([]); [[bb.x,bb.y],[bb.x+bb.w,bb.y],[bb.x,bb.y+bb.h],[bb.x+bb.w,bb.y+bb.h]].forEach(p=>{ctx.fillStyle='#fff';ctx.fillRect(p[0]-4,p[1]-4,8,8);ctx.strokeRect(p[0]-4,p[1]-4,8,8);}); const rx=bb.x+bb.w/2, ry=bb.y-22; ctx.beginPath(); ctx.arc(rx,ry,5,0,Math.PI*2); ctx.fillStyle='#4cc9f0'; ctx.fill(); ctx.restore(); }
    };
    let drag = null;
    const snap = p => { const th=9*shot.guides.scale; let bestX=null,bestY=null,dx=th,dy=th; (shot.guides.xs||[]).forEach(v=>{if(Math.abs(p.x-v)<dx){dx=Math.abs(p.x-v);bestX=v;}}); (shot.guides.ys||[]).forEach(v=>{if(Math.abs(p.y-v)<dy){dy=Math.abs(p.y-v);bestY=v;}}); shot.snapLines=[]; if(bestX!=null)shot.snapLines.push({axis:'x',v:bestX}); if(bestY!=null)shot.snapLines.push({axis:'y',v:bestY}); return {x:bestX??p.x,y:bestY??p.y}; };
    const pt = e => { const r = canvas.getBoundingClientRect(); return { x:(e.clientX-r.left)*canvas.width/r.width, y:(e.clientY-r.top)*canvas.height/r.height }; };
    const startShape = p => ({ tool:shot.tool, x:p.x, y:p.y, w:0, h:0, color:shot.color, width:shot.line, points:[p] });
    let mode=null, last=null;
    const hit = p => [...shot.shapes].reverse().find(sh=>{const b=bbox(sh);return p.x>=b.x-6&&p.x<=b.x+b.w+6&&p.y>=b.y-6&&p.y<=b.y+b.h+6;});
    const handleAt = p => { if(!shot.sel)return null; const b=bbox(shot.sel); const hs={nw:[b.x,b.y],ne:[b.x+b.w,b.y],sw:[b.x,b.y+b.h],se:[b.x+b.w,b.y+b.h],rot:[b.x+b.w/2,b.y-22]}; return Object.keys(hs).find(k=>Math.hypot(p.x-hs[k][0],p.y-hs[k][1])<10)||null; };
    canvas.addEventListener('pointerdown', e => {
      const p = snap(pt(e));
      if (shot.tool === 'text'){ inlineText(p); return; }
      if (shot.tool === 'hand' || shot.tool === 'select'){ const h=handleAt(p); if(h){ mode=h; last=p; shot._orig=JSON.parse(JSON.stringify(shot.sel)); canvas.setPointerCapture(e.pointerId); return; } const s=hit(p); shot.sel=s||null; if(s){mode='move';last=p;shot._orig=JSON.parse(JSON.stringify(s));} draw(); return; }
      drag = p; const sh = startShape(p); shot.shapes.push(sh); shot.sel=null; canvas.setPointerCapture(e.pointerId); draw();
    });
    canvas.addEventListener('pointermove', e => {
      const p=snap(pt(e));
      if (mode && shot.sel){ const s=shot.sel,o=shot._orig; if(mode==='move'){ s.x=o.x+(p.x-last.x); s.y=o.y+(p.y-last.y); if(s.points) s.points=s.points.map(q=>({x:q.x+(p.x-last.x),y:q.y+(p.y-last.y)})); }
        else if(mode==='rot'){ const b=bbox(s); s.rot=Math.atan2(p.y-(b.y+b.h/2),p.x-(b.x+b.w/2))+Math.PI/2; }
        else { const b=bbox(o); if(mode==='se'){s.w=p.x-b.x;s.h=p.y-b.y;} if(mode==='nw'){s.x=p.x;s.y=p.y;s.w=b.x+b.w-p.x;s.h=b.y+b.h-p.y;} if(mode==='ne'){s.y=p.y;s.w=p.x-b.x;s.h=b.y+b.h-p.y;} if(mode==='sw'){s.x=p.x;s.w=b.x+b.w-p.x;s.h=p.y-b.y;} }
        draw(); return;
      }
      if (!drag) return; const sh=shot.shapes[shot.shapes.length-1]; if(!sh)return;
      if (sh.tool==='pen'){ sh.points.push(p); }
      else { sh.w=p.x-drag.x; sh.h=p.y-drag.y; }
      draw();
    });
    const end = () => { drag = null; mode=null; last=null; shot.snapLines=null; draw(); };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    root.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{ shot.tool=b.dataset.tool; root.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('on',x===b)); root.classList.toggle('is-cursor', shot.tool==='cursor'); canvas.style.cursor=shot.tool==='hand'?'grab':'crosshair'; });
    root.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{ shot.color=b.dataset.color; root.querySelectorAll('[data-color]').forEach(x=>x.classList.toggle('on',x===b)); });
    $('[data-cap-undo]',root).onclick=()=>{ if(shot.shapes.length){ shot.redo.push(shot.shapes.pop()); draw(); } };
    $('[data-cap-redo]',root).onclick=()=>{ if(shot.redo.length){ shot.shapes.push(shot.redo.pop()); draw(); } };
    const keys=e=>{ if(!e.ctrlKey&&!e.metaKey)return; if(e.key==='z'||e.key==='Z'){e.preventDefault();e.stopPropagation(); if(e.shiftKey)$('[data-cap-redo]',root).click(); else $('[data-cap-undo]',root).click();} else if(e.key==='y'||e.key==='Y'){e.preventDefault();e.stopPropagation();$('[data-cap-redo]',root).click();} };
    document.addEventListener('keydown',keys,true);
    const inlineText = p => { const inp=document.createElement('input'); inp.className='cap-text-input'; inp.placeholder='Текст'; const cr=canvas.getBoundingClientRect(); const sx=cr.left+p.x/canvas.width*cr.width, sy=cr.top+p.y/canvas.height*cr.height; Object.assign(inp.style,{position:'fixed',left:sx+'px',top:sy+'px',zIndex:9000,background:'var(--panel)',color:shot.color,border:'1px solid var(--accent)',borderRadius:'6px',padding:'3px 6px',font:'700 14px system-ui'}); document.body.appendChild(inp); const done=()=>{const t=inp.value.trim();if(t){shot.shapes.push({tool:'text',x:p.x,y:p.y,text:t,color:shot.color,width:shot.line});}inp.remove();draw();}; inp.onblur=done; inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();done();}if(e.key==='Escape'){inp.value='';done();}}; setTimeout(()=>inp.focus(),0); };
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
    function close(){ document.removeEventListener('keydown',keys,true); root.remove(); shot=null; }
    canvas.width=base.width; canvas.height=base.height; draw();
  }

  function openMenu() {
    openWinModal({ title:'Снимок экрана', icon:'app', narrow:true, locked:true, backdrop:true,
      body:`<div class="stack" style="gap:10px">
        <p class="small muted" style="margin:0">Снимок приложения с автоматической маской баланса, заказов, людей и переписок. Маску можно отключить в профиле.</p>
        <button class="btn btn--soft" data-cap="shot">Сделать снимок</button>
        <button class="btn btn--ghost" data-cap="record">Записать экран</button>
        <p class="tiny faint" style="margin:0">В браузере система один раз спросит, что захватывать. В настольной сборке используется нативный захват.</p>
      </div>`,
      footer:'<button class="btn btn--ghost" data-x>Закрыть</button>',
      onMount:(m,c)=>{ m.querySelectorAll('[data-cap]').forEach(b=>b.onclick=()=>{ const mode=b.dataset.cap; c(); setTimeout(()=>mode==='record'?openRecord():startShot(),120); }); m.querySelector('[data-x]').onclick=c; }
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

  function openRecord() {
    openWinModal({ title:'Запись экрана', icon:'app', narrow:true, locked:true, backdrop:true,
      body:`<div class="stack" style="gap:10px"><p class="small muted" style="margin:0">Приложение записывает собственный интерфейс без выбора источника браузером. Конфиденциальные данные маскируются.</p><label class="check"><input type="checkbox" id="self-mic"><span class="box"></span><span>Записывать микрофон</span></label><p class="tiny faint" style="margin:0">Микрофон — единственное, на что система может попросить разрешение.</p></div>`,
      footer:'<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-start>Начать запись</button>',
      onMount:(m,c)=>{ m.querySelector('[data-x]').onclick=c; m.querySelector('[data-start]').onclick=()=>{ const mic=!!m.querySelector('#self-mic').checked; c(); setTimeout(()=>startSelfRecording(mic),120); }; }
    });
  }
  async function startSelfRecording(mic){
    try {
      privacyOn(); document.body.classList.add('is-recording');
      const root=el('div','cap-rec-live'); root.innerHTML='<canvas class="cap-anno"></canvas><div class="cap-tools cap-rec-tools"><button data-rtool="cursor" class="on" title="Курсор"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 3l14 8-6 1-3 7L5 3Z" fill="currentColor"/></svg></button><button data-rtool="pen" title="Маркер">✎</button><button data-rtool="arrow" title="Стрелка">↗</button><button data-rtool="rect" title="Рамка">▭</button><button data-rtool="text" title="Текст">T</button><span class="spacer"></span><button data-rclear title="Очистить">⌫</button></div>';
      document.body.appendChild(root);
      const anno=$('.cap-anno',root); anno.width=innerWidth*devicePixelRatio; anno.height=innerHeight*devicePixelRatio; anno.style.width=innerWidth+'px'; anno.style.height=innerHeight+'px';
      const actx=anno.getContext('2d'); let tool='cursor', shapes=[], drawing=null;
      const canvas=document.createElement('canvas'); canvas.width=Math.round(innerWidth*devicePixelRatio); canvas.height=Math.round(innerHeight*devicePixelRatio); const ctx=canvas.getContext('2d');
      const out=canvas.captureStream(24); let micStream=null;
      if (mic){ try { micStream=await navigator.mediaDevices.getUserMedia({audio:true}); micStream.getAudioTracks().forEach(t=>out.addTrack(t)); } catch(e){ notice('Микрофон недоступен — запись без звука','warn'); } }
      const mp4Types=['video/mp4;codecs=avc1.42E01E','video/mp4;codecs=avc1.42001E','video/mp4;codecs=avc1','video/mp4']; const webm=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm'; const mime=mp4Types.find(t=>MediaRecorder.isTypeSupported(t))||webm; const ext=mime.includes('mp4')?'mp4':'webm'; const chunks=[]; const mr=new MediaRecorder(out,{mimeType:mime,videoBitsPerSecond:4000000,audioBitsPerSecond:128000});
      mr.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      const bar=el('div','cap-rec-bar','<b>● Запись</b><span class="cap-rec-time">00:00</span><button class="btn btn--danger btn--sm" data-stop>Остановить</button>'); document.body.appendChild(bar);
      const drawShapes=(c,scale=1)=>{ shapes.forEach(sh=>{ c.save(); c.strokeStyle=sh.color;c.fillStyle=sh.color;c.lineWidth=4*scale;c.lineCap='round';c.lineJoin='round'; if(sh.tool==='rect'){c.strokeRect(sh.x*scale,sh.y*scale,sh.w*scale,sh.h*scale);} else if(sh.tool==='arrow'){const ex=(sh.x+sh.w)*scale,ey=(sh.y+sh.h)*scale;c.beginPath();c.moveTo(sh.x*scale,sh.y*scale);c.lineTo(ex,ey);c.stroke();const a=Math.atan2(sh.h,sh.w),l=16*scale;c.beginPath();c.moveTo(ex,ey);c.lineTo(ex-l*Math.cos(a-.5),ey-l*Math.sin(a-.5));c.moveTo(ex,ey);c.lineTo(ex-l*Math.cos(a+.5),ey-l*Math.sin(a+.5));c.stroke();} else if(sh.tool==='pen'){c.beginPath();sh.points.forEach((p,i)=>i?c.lineTo(p.x*scale,p.y*scale):c.moveTo(p.x*scale,p.y*scale));c.stroke();} else if(sh.tool==='text'){c.font=`700 ${22*scale}px system-ui`;c.fillText(sh.text,sh.x*scale,sh.y*scale);} c.restore(); }); };
      const redraw=()=>{ actx.clearRect(0,0,anno.width,anno.height); actx.save(); actx.scale(devicePixelRatio,devicePixelRatio); drawShapes(actx,1); actx.restore(); };
      let busy=false;
      const pump=async()=>{ if(busy||!mr||mr.state==='inactive')return; busy=true; try{ const shot=await selfCanvas(); if(shot){ ctx.drawImage(shot,0,0,canvas.width,canvas.height); drawShapes(ctx,canvas.width/innerWidth); } }finally{busy=false;} };
      mr.start(500); const tick=setInterval(pump,140); pump();
      const t0=Date.now(); const timer=setInterval(()=>{const s=Math.floor((Date.now()-t0)/1000); const tm=$('.cap-rec-time',bar); if(tm)tm.textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');},500);
      const stop=()=>{ if(!rec) return; clearInterval(tick); clearInterval(timer); mr.stop(); };
      $('[data-stop]',bar).onclick=stop;
      $('[data-rclear]',root).onclick=()=>{shapes=[];redraw();};
      root.querySelectorAll('[data-rtool]').forEach(b=>b.onclick=()=>{ tool=b.dataset.rtool; root.querySelectorAll('[data-rtool]').forEach(x=>x.classList.toggle('on',x===b)); anno.style.pointerEvents=tool==='cursor'?'none':'auto'; });
      const pt=e=>({x:e.clientX,y:e.clientY});
      anno.addEventListener('pointerdown',e=>{ if(tool==='cursor')return; const p=pt(e); if(tool==='text'){ const inp=document.createElement('input');inp.placeholder='Текст';inp.style.cssText='position:fixed;z-index:10000;left:'+p.x+'px;top:'+p.y+'px;background:var(--panel);border:1px solid var(--accent);border-radius:5px;padding:3px;color:#ff5c5c';document.body.appendChild(inp);inp.focus();const done=()=>{if(inp.value.trim()){shapes.push({tool:'text',x:p.x,y:p.y,text:inp.value.trim(),color:'#ff5c5c'});redraw();}inp.remove();};inp.onblur=done;inp.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();done();}};return;} drawing={tool,x:p.x,y:p.y,w:0,h:0,points:[p],color:'#ff5c5c'}; shapes.push(drawing); });
      anno.addEventListener('pointermove',e=>{if(!drawing)return;const p=pt(e);drawing.w=p.x-drawing.x;drawing.h=p.y-drawing.y;drawing.points.push(p);redraw();});
      anno.addEventListener('pointerup',()=>{drawing=null;});
      const finalStop=()=>{ clearInterval(tick); clearInterval(timer); if(mr.state!=='inactive') mr.stop(); };
      mr.onstop=()=>{ const blob=new Blob(chunks,{type:mime}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='audiowizard-recording-'+Date.now()+'.'+ext; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); if(micStream)micStream.getTracks().forEach(t=>t.stop()); if(!mr){} privacyOff(); document.body.classList.remove('is-recording'); bar.remove(); root.remove(); rec=null; notice('Запись сохранена','ok'); };
      rec={mr};
      // Keep a reliable stop that doesn't depend on the closure's rec check.
      $('[data-stop]',bar).onclick=finalStop;
      rec.stop=finalStop;
    } catch(e){ privacyOff(); document.body.classList.remove('is-recording'); captureError(e); }
  }

  window.CaptureStudio = { open:openMenu, shot:startShot, shotToFile:(cb)=>startShot('shot',cb), record:openRecord, _self:selfCanvas };
})();
