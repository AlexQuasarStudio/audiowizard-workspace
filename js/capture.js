/* Снимки и запись экрана. В браузере захват начинается с системного выбора
   источника; в настольной оболочке можно подключить нативный мост capture_app. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
  let shot = null, rec = null, picker = null;
  /* Кегль подписи на снимке — 28 pt в координатах изображения; шрифт тот же,
     что у интерфейса. Один источник для канвы и поля ввода. */
  const TEXT_PT = 28, TEXT_FONT = 'system-ui, -apple-system, Segoe UI, sans-serif';

  const appSettings = () => (typeof S !== 'undefined' ? S.settings : null);
  /* Элементы, которые маскируются на снимке и записи. Один список на все
     места: плашка предупреждения, клик по элементу и сам снимок. Порядок —
     от внешнего к вложенному: раскрывать нужно самый внешний, иначе фильтр
     остаётся на родителе и элемент продолжает выглядеть скрытым. */
  const PRIVACY_SELECTORS = [
    '#side-balance','.head__pill--balance','.chat-head','.chat-list','.chat-list__row','.chat-item',
    '.msg','.msg__bubble','.avatar','.order-card','.order-row','.order-detail','.profile-card',
    '.person-row','.person-card','.tbl-wrap','.rp-file-row','.aw-win--active .card'
  ];
  /* Самый внешний маскированный узел вокруг клика: если размыт и список, и
     строка внутри, раскрывать нужно список, иначе фильтр родителя остаётся. */
  const privacyTargetOf = node => {
    if (!node || !node.closest) return null;
    const sel = PRIVACY_SELECTORS.join(',');
    let best = node.closest(sel), cur = best;
    while (cur){
      const parent = cur.parentElement && cur.parentElement.closest(sel);
      if (!parent) break;
      best = parent; cur = parent;
    }
    return best;
  };
  /* Маска аватаров дорисовывается на холсте, а не CSS-фильтром: у круглого
     элемента filter:blur даёт рваный левый край (края фильтра обрезаются
     границей круга). Холст с blur + clip по кругу даёт ровный ореол. */
  const AVATAR_SEL = '.avatar,.msg__av,.chat-av,.person-av';
  /* Маску аватара рисуем прямо в его стилях: размытые цвета и градиент
     «стекла», с переполнением в 2 px. Медальон ШВАЦ не нужен — реверсивная
     маска давала артефакт среза слева у sticky-аватара группы. */
  const blurAvatars = () => {
    document.querySelectorAll(AVATAR_SEL).forEach(a => {
      if (!a || a.dataset.privMask || a.querySelector('[data-priv-av]')) return;
      /* Готовые маски из child-разметки (старые наложения) снимаем: фильтр
         теперь живёт на самом аватаре. */
      a.querySelectorAll('[data-priv-av]').forEach(n => n.remove());
      const r = a.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return;
      if (getComputedStyle(a).position === 'static') a.style.position = 'relative';
      if (getComputedStyle(a).overflow === 'visible') a.style.overflow = 'hidden';
      a.style.setProperty('filter', 'blur(5px)', 'important');
      a.style.setProperty('user-select', 'none', 'important');
      a.dataset.privMask = '1';
    });
  };
  const unblurAvatars = () => {
    document.querySelectorAll('[data-priv-mask]').forEach(a => {
      a.style.removeProperty('filter');
      a.style.removeProperty('user-select');
      delete a.dataset.privMask;
    });
    document.querySelectorAll('[data-priv-av]').forEach(c => c.remove());
  };
  const privacyOn = () => {
    const st = appSettings();
    if (!(st && st.capturePrivacy === false)){
      document.body.classList.add('capture-privacy');
      ensurePrivacyPill();
      blurAvatars();
    }
  };
  const privacyOff = () => {
    document.body.classList.remove('capture-privacy');
    document.querySelector('.cap-privacy-pill')?.remove();
    unblurAvatars();
  };
    const waitFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  /* Снимок берём не в момент клика, а когда интерфейс уже закрылся, а курсор
     остановился: иначе в кадр попадает закрывающееся меню и «первый» кадр. */
  const waitSettled = (min = 240) => new Promise(res => {
    const t0 = Date.now();
    const tick = () => {
      const closing = document.querySelector('.modal-mask.closing,.aw-win--closing');
      if ((!closing && Date.now() - t0 >= min) || Date.now() - t0 > 900) res();
      else setTimeout(tick, 40);
    };
    tick();
  });
  /* Ждём именно остановку курсора: любое движение (и прокрутка, и клавиши)
     откладывает кадр, снимок берётся через idle мс покоя. Потолок нужен,
     чтобы съёмка не зависла, если курсор двигают непрерывно. */
  const waitCursorIdle = (idle = 300, max = 2600) => new Promise(res => {
    let idleTimer = null, capTimer = null, done = false;
    const events = ['pointermove','pointerdown','pointerup','wheel','scroll','keydown','touchmove'];
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(idleTimer);
      clearTimeout(capTimer);
      events.forEach(t => window.removeEventListener(t, reset, true));
      res();
    };
    const reset = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, idle);
    };
    events.forEach(t => window.addEventListener(t, reset, { capture: true, passive: true }));
    capTimer = setTimeout(finish, max);
    reset();
  });

  /* Плашка «Конфиденциальные данные скрыты» — не псевдоэлемент, а кнопка:
     по нажатию объясняем правила маскирования и даём раскрыть всё. */
  const WARN_TEXT = 'На снимках и записях балансы, заказы, люди и переписки автоматически размываются. Чтобы раскрыть один элемент, нажмите на него во время съёмки. Полностью отключить маску можно в профиле — это видно в журнале.';
  function ensurePrivacyPill(){
    let pill = document.querySelector('.cap-privacy-pill');
    if (!pill){
      pill = el('button', 'cap-privacy-pill', '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4.5 6v6c0 4.6 3.2 7.9 7.5 9 4.3-1.1 7.5-4.4 7.5-9V6L12 3Z"/><path d="M9.5 12l1.8 1.8 3.4-3.6"/></svg><span>Конфиденциальные данные скрыты</span>');
      pill.type = 'button';
      pill.setAttribute('aria-label', 'Конфиденциальные данные скрыты — что это значит');
      pill.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        openModal({ title:'Конфиденциальные данные', narrow:true, modalClass:'cap-privacy-modal',
          body:`<p class="small" style="margin:0 0 8px">${WARN_TEXT}</p>
            <p class="small faint" style="margin:0">Пока действует маска, клик по размытому элементу предлагает раскрыть только его или все данные.</p>`,
          footer:'<button class="btn btn--ghost" type="button" data-cap-warn-x>Понятно</button><button class="btn btn--danger" type="button" data-cap-warn-all>Показать все данные</button>',
          onMount:(m,c)=>{
            m.querySelector('[data-cap-warn-x]').onclick=c;
            m.querySelector('[data-cap-warn-all]').onclick=()=>{ document.body.classList.remove('capture-privacy'); c(); };
          }
        });
      });
      document.body.appendChild(pill);
    }
    return pill;
  }

  function notice(text, kind = 'info') {
    if (typeof toast === 'function') toast(text, kind);
    else console.log(text);
  }

  function captureError(e) {
    privacyOff();
    notice('Не удалось захватить экран: ' + (e && e.message ? e.message : e), 'err');
  }


  /* prepare вызывается, когда поток уже получен и системное окно выбора
     источника закрылось: только тогда страница снова видит курсор, и можно
     дождаться его остановки перед кадром. */
  async function grabFrame(prepare) {
    const native = window.electronAPI || window.multitool || window.pywebview?.api;
    const nativeCap = native && (native.captureApp || native.capture_app);
    if (nativeCap) {
      const r = await nativeCap.call(native);
      if (r?.data || r?.dataUrl) return loadCanvas(r.data || r.dataUrl);
      if (r?.error) throw new Error(r.error);
    }
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('браузер не поддерживает захват экрана');
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 24, displaySurface: 'browser' }, audio: false, preferCurrentTab: true
    });
    try {
      const video = el('video'); video.muted = true; video.playsInline = true; video.srcObject = stream;
      await new Promise((res, rej) => { video.onloadedmetadata = res; video.onerror = rej; setTimeout(res, 1600); });
      await video.play();
      if (prepare) await prepare();
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


  /* Пока идёт снимок, редактор или запись — новый захват не запускаем:
     иначе два окна выбора источника и два редактора поверх друг друга. */
  let capturing = false;
  const busyBusy = () => capturing || !!shot || !!rec;
  async function startShot(mode = 'shot', onAttach = null) {
    if (busyBusy()) { notice('Захват уже идёт — завершите текущий','warn'); return; }
    capturing = true;
    try {
      privacyOn();
      await waitSettled();
      const src = await grabFrame(waitCursorIdle);
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
    } catch (e) { captureError(e); } finally { capturing = false; }
  }

  function openEditor(base, onAttach, guides={xs:[],ys:[],scale:1}) {
    if (shot) shot.root.remove();
    const root = el('div', 'cap-editor');
    root.innerHTML = `<div class="cap-editor__stage"><canvas></canvas></div><div class="cap-tools"><button data-tool="cursor" title="Курсор — нажимать элементы приложения под снимком"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 3l14 8-6 1-3 7L5 3Z" fill="currentColor"/></svg></button><button data-tool="hand" class="on" title="Рука — двигать и растягивать выделенное, не трогая приложение"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 11V6.5a1.5 1.5 0 0 1 3 0V11m0 0V5a1.5 1.5 0 0 1 3 0v6m0 0V6.5a1.5 1.5 0 0 1 3 0V14c0 4.2-2.8 7-7 7H9a5.5 5.5 0 0 1-5.5-5.5v-3a1.5 1.5 0 0 1 3 0V14"/></svg></button><button data-tool="select" title="Выделить">⬚</button><button data-tool="rect" title="Прямоугольник">▭</button><button data-tool="ellipse" title="Эллипс">◯</button><button data-tool="arrow" title="Стрелка">↗</button><button data-tool="pen" title="Маркер">✎</button><button data-tool="text" title="Текст">T</button><span class="spacer"></span><button data-color="#ff5c5c" class="on" style="color:#ff5c5c">●</button><button data-color="#ffd166" style="color:#ffd166">●</button><button data-color="#4cc9f0" style="color:#4cc9f0">●</button><button data-color="#ffffff" style="color:#fff">●</button><button data-cap-undo title="Отменить">↶</button><button data-cap-redo title="Повторить">↷</button><span class="spacer"></span><span class="cap-zoomctl" role="group" aria-label="Масштаб"><button type="button" data-cap-zoom-out title="Уменьшить" aria-label="Уменьшить">−</button><button type="button" data-cap-zoom-val title="Сбросить масштаб" aria-label="Сбросить масштаб">100%</button><button type="button" data-cap-zoom-in title="Увеличить" aria-label="Увеличить">+</button></span><button data-cap-crop title="Обрезать" aria-label="Обрезать">✂</button>${onAttach ? `<button class="btn btn--ghost btn--sm" data-cap-attach>Вложить</button>` : ''}<button data-cap-x title="Закрыть" aria-label="Закрыть">×</button><button class="cap-ready" data-cap-save title="Готово" aria-label="Готово">✓</button></div>`;
    document.body.appendChild(root);
    const canvas = $('canvas', root), ctx = canvas.getContext('2d');
    /* Масштаб снимка: кнопки − / % / +, Ctrl/⌘+колесо и перетаскивание
       холста рукой при увеличении. Снимок сохраняется в исходном размере —
       масштаб только для просмотра и точной обводки. */
    let viewZoom = 1, panX = 0, panY = 0;
    const zoomVal = $('[data-cap-zoom-val]', root);
    const applyView = () => {
      canvas.style.transformOrigin = 'center center';
      canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${viewZoom})`;
      canvas.style.cursor = viewZoom > 1 ? 'grab' : 'crosshair';
      if (zoomVal) zoomVal.textContent = Math.round(viewZoom * 100) + '%';
      root.classList.toggle('is-zoomed', viewZoom > 1);
    };
    const setZoom = (next, ax, ay) => {
      const prev = viewZoom;
      viewZoom = Math.max(1, Math.min(5, +next.toFixed(2)));
      if (viewZoom === 1){ panX = panY = 0; }
      else if (ax != null && prev !== viewZoom){
        /* Приближаем к точке курсора/центру, а не к левому верхнему углу. */
        const f = viewZoom / prev - 1;
        panX -= (ax - innerWidth / 2) * f;
        panY -= (ay - innerHeight / 2) * f;
      }
      applyView();
    };
    shot = { root, base, tool:'hand', crop: null, shapes: [], redo: [], sel:null, color:'#ff5c5c', line: 4, onAttach, canvas, guides, get viewZoom(){return viewZoom}, get pan(){return {x:panX,y:panY}} };
    const zoomIn = $('[data-cap-zoom-in]', root), zoomOut = $('[data-cap-zoom-out]', root);
    if (zoomIn) zoomIn.onclick = ()=>setZoom(viewZoom * 1.25, innerWidth/2, innerHeight/2);
    if (zoomOut) zoomOut.onclick = ()=>setZoom(viewZoom / 1.25, innerWidth/2, innerHeight/2);
    if (zoomVal) zoomVal.onclick = ()=>setZoom(1);
    canvas.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(viewZoom * (e.deltaY < 0 ? 1.12 : 1/1.12), e.clientX, e.clientY);
    }, { passive:false });
    applyView();
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
        /* Кегль в точках снимка: 28 pt — столько же, сколько в поле ввода.
           Раньше шрифт зависел от толщины линии и получался ~16 px. */
        x.font = `700 ${TEXT_PT * (sh.k || 1)}px ${TEXT_FONT}`;
        x.textBaseline = 'top';
        x.fillText(sh.text || '', sh.x, sh.y);
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
      if (shot.sel){ const bb=bbox(shot.sel); ctx.save(); const pulse = .5 + .5*Math.sin(performance.now()/320); const t0 = shot.sel.t0 || (shot.sel.t0 = performance.now()); const rise = Math.min(1, (performance.now()-t0)/180); ctx.globalAlpha = rise; ctx.strokeStyle=`rgba(76,201,240,${.72+.28*pulse})`; ctx.lineWidth=2; ctx.setLineDash([5,4]); ctx.strokeRect(bb.x,bb.y,bb.w,bb.h); ctx.setLineDash([]); [[bb.x,bb.y],[bb.x+bb.w,bb.y],[bb.x,bb.y+bb.h],[bb.x+bb.w,bb.y+bb.h]].forEach(p=>{ctx.fillStyle='#fff';ctx.fillRect(p[0]-4,p[1]-4,8,8);ctx.strokeRect(p[0]-4,p[1]-4,8,8);}); const rx=bb.x+bb.w/2, ry=bb.y-22; ctx.beginPath(); ctx.arc(rx,ry,5,0,Math.PI*2); ctx.fillStyle='#4cc9f0'; ctx.fill(); ctx.restore(); }
    };
    let drag = null;
    const snap = p => { const th=9*shot.guides.scale; let bestX=null,bestY=null,dx=th,dy=th; (shot.guides.xs||[]).forEach(v=>{if(Math.abs(p.x-v)<dx){dx=Math.abs(p.x-v);bestX=v;}}); (shot.guides.ys||[]).forEach(v=>{if(Math.abs(p.y-v)<dy){dy=Math.abs(p.y-v);bestY=v;}}); shot.snapLines=[]; if(bestX!=null)shot.snapLines.push({axis:'x',v:bestX}); if(bestY!=null)shot.snapLines.push({axis:'y',v:bestY}); return {x:bestX??p.x,y:bestY??p.y}; };
    const pt = e => { const r = canvas.getBoundingClientRect(); return { x:(e.clientX-r.left)*canvas.width/r.width, y:(e.clientY-r.top)*canvas.height/r.height }; };
    const startShape = p => ({ tool:shot.tool, x:p.x, y:p.y, w:0, h:0, color:shot.color, width:shot.line, points:[p] });
    let mode=null, last=null;
    const hit = p => [...shot.shapes].reverse().find(sh=>{const b=bbox(sh);return p.x>=b.x-6&&p.x<=b.x+b.w+6&&p.y>=b.y-6&&p.y<=b.y+b.h+6;});
    const handleAt = p => { if(!shot.sel)return null; const b=bbox(shot.sel); const hs={nw:[b.x,b.y],ne:[b.x+b.w,b.y],sw:[b.x,b.y+b.h],se:[b.x+b.w,b.y+b.h],rot:[b.x+b.w/2,b.y-22]}; return Object.keys(hs).find(k=>Math.hypot(p.x-hs[k][0],p.y-hs[k][1])<10)||null; };
    /* Пока выделение активно — пульсация обводки и мягкое появление/уход. */
    let selRaf = 0;
    const keepSelAlive = () => {
      if (selRaf) return;
      const step = () => {
        if (!shot || !shot.sel){ selRaf = 0; if (shot) draw(); return; }
        draw(); selRaf = requestAnimationFrame(step);
      };
      selRaf = requestAnimationFrame(step);
    };
    let lastC = null;
    canvas.addEventListener('pointerdown', e => {
      const raw = pt(e); const p = (mode || drag) ? raw : snap(raw);
      if (shot.tool === 'hand' && viewZoom > 1){ mode='pan'; lastC={x:e.clientX,y:e.clientY}; canvas.setPointerCapture(e.pointerId); return; }
      if (shot.tool === 'text'){ inlineText(p); return; }
      if (shot.tool === 'hand' || shot.tool === 'select'){ const h=handleAt(p); if(h){ mode=h; last=p; shot._orig=JSON.parse(JSON.stringify(shot.sel)); canvas.setPointerCapture(e.pointerId); return; } const s=hit(p);
        /* Повторный клик по уже выделенному элементу снимает выделение. */
        if (s && shot.sel === s){ shot.sel = null; shot.selFade = performance.now(); draw(); return; }
        shot.sel=s||null; if(s){mode='move';last=p;shot._orig=JSON.parse(JSON.stringify(s)); keepSelAlive(); } draw(); return; }
      drag = p; const sh = startShape(p); shot.shapes.push(sh); shot.sel=null; canvas.setPointerCapture(e.pointerId); draw();
    });
    canvas.addEventListener('pointermove', e => {
      if (mode === 'pan' && lastC){
        panX += e.clientX - lastC.x; panY += e.clientY - lastC.y;
        /* Не даём утащить кадр целиком за пределы сцены. */
        const r = canvas.getBoundingClientRect();
        const limX = Math.max(120, r.width / 2), limY = Math.max(120, r.height / 2);
        panX = Math.max(-limX, Math.min(limX, panX));
        panY = Math.max(-limY, Math.min(limY, panY));
        lastC={x:e.clientX,y:e.clientY}; applyView(); return;
      }
      const raw=pt(e); const p=(mode||drag)?raw:snap(raw);
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
    const end = () => { drag = null; mode=null; last=null; lastC=null; shot.snapLines=null; draw(); };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    root.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{ if (b.dataset.tool==='crop' && typeof syncCropBtn==='function') syncCropBtn(); shot.tool=b.dataset.tool; root.querySelectorAll('[data-tool]').forEach(x=>x.classList.toggle('on',x===b)); root.classList.toggle('is-cursor', shot.tool==='cursor'); canvas.style.cursor=shot.tool==='hand'?'grab':'crosshair'; });
    root.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{ shot.color=b.dataset.color; root.querySelectorAll('[data-color]').forEach(x=>x.classList.toggle('on',x===b)); });
    $('[data-cap-undo]',root).onclick=()=>{ if(shot.shapes.length){ shot.redo.push(shot.shapes.pop()); draw(); } };
    $('[data-cap-redo]',root).onclick=()=>{ if(shot.redo.length){ shot.shapes.push(shot.redo.pop()); draw(); } };
    const keys=e=>{ if(!e.ctrlKey&&!e.metaKey)return; if(e.key==='z'||e.key==='Z'){e.preventDefault();e.stopPropagation(); if(e.shiftKey)$('[data-cap-redo]',root).click(); else $('[data-cap-undo]',root).click();} else if(e.key==='y'||e.key==='Y'){e.preventDefault();e.stopPropagation();$('[data-cap-redo]',root).click();} };
    document.addEventListener('keydown',keys,true);
    /* Поле ввода текста совпадает по кеглю с тем, что печатается на снимке:
       пользователь видит ровно тот размер, который получится в кадре. */
    const inlineText = p => {
      const cr = canvas.getBoundingClientRect();
      const scale = cr.width / canvas.width;
      const sx = cr.left + p.x * scale, sy = cr.top + p.y * scale;
      const inp = document.createElement('input');
      inp.className = 'cap-text-input';
      inp.placeholder = 'Текст';
      Object.assign(inp.style, {
        position:'fixed', left:sx+'px', top:sy+'px', zIndex:9000,
        minWidth:'220px', background:'var(--panel)', color:shot.color,
        border:'1px solid var(--accent)', borderRadius:'6px', padding:'4px 6px',
        font:`700 ${TEXT_PT * scale}px ${TEXT_FONT}`, lineHeight:'1.2'
      });
      document.body.appendChild(inp);
      const done = () => {
        const t = inp.value.trim();
        if (t) shot.shapes.push({ tool:'text', x:p.x, y:p.y, text:t, color:shot.color, width:shot.line, k: shot.guides.scale || 1 });
        inp.remove(); draw();
      };
      inp.onblur = done;
      inp.onkeydown = e => { if (e.key === 'Enter'){ e.preventDefault(); done(); } if (e.key === 'Escape'){ inp.value=''; done(); } };
      setTimeout(()=>inp.focus(), 0);
    };
    $('[data-cap-x]',root).onclick = close;
    $('[data-cap-save]',root).onclick = ()=>{ download(compose(), 'audiowizard-shot-'+Date.now()+'.jpg'); close(); };
    const attach = $('[data-cap-attach]',root); if (attach) attach.onclick = ()=>{ onAttach(dataUrlToFile(compose(), 'screenshot.jpg')); close(); };
    /* Кроп: нажали ✂ → клики по кадру выделяют область → кнопка
       становится красной галочкой, и она обрезает. Раньше приходилось
       нажимать ту же кнопку второй раз, и это было неочевидно. */
    const cropBtn = $('[data-cap-crop]',root);
    const applyCropBtn = (() => {
      const b = document.createElement('button');
      b.dataset.capCropApply = '';
      b.title = 'Применить обрезку';
      b.setAttribute('aria-label', 'Применить обрезку');
      b.textContent = '✓';
      b.className = 'cap-crop-apply';
      b.hidden = true;
      cropBtn.after(b);
      b.onclick = () => applyCrop();
      return b;
    })();
    const syncCropBtn = () => {
      const on = shot.tool === 'crop';
      cropBtn.classList.toggle('on', on);
      applyCropBtn.hidden = !(on && shot.crop && shot.crop.w >= 4 && shot.crop.h >= 4);
    };
    cropBtn.onclick = () => {
      if (shot.tool === 'crop' && shot.crop){ applyCrop(); return; }
      shot.tool='crop'; shot.crop=null; canvas.style.cursor='crosshair'; syncCropBtn();
      toast('Обведите нужную область на кадре, затем нажмите «✓»','info');
    };
    canvas.addEventListener('pointerdown', e => {
      if (shot.tool !== 'crop') return;
      const p=pt(e); drag=p; shot.crop={x:p.x,y:p.y,w:0,h:0}; canvas.setPointerCapture(e.pointerId);
    }, true);
    canvas.addEventListener('pointermove', e => {
      if (shot.tool !== 'crop' || !drag) return; const p=pt(e); shot.crop={x:Math.min(drag.x,p.x),y:Math.min(drag.y,p.y),w:Math.abs(p.x-drag.x),h:Math.abs(p.y-drag.y)}; draw();
    }, true);
    canvas.addEventListener('pointerup', ()=>{ if(shot.tool==='crop'){ drag=null; syncCropBtn(); } }, true);
    function applyCrop(){
      const c=shot.crop; if(!c||c.w<4||c.h<4){toast('Сначала выделите область','warn');return;}
      const out=document.createElement('canvas'); out.width=Math.max(1,Math.round(c.w)); out.height=Math.max(1,Math.round(c.h)); out.getContext('2d').drawImage(shot.base,c.x,c.y,c.w,c.h,0,0,out.width,out.height);
      shot.base=out; shot.crop=null; shot.shapes=[]; canvas.width=out.width; canvas.height=out.height; draw(); toast('Кроп применён','ok'); shot.tool='hand'; setZoom(1); syncCropBtn();
    }
    function compose(){
      const out=document.createElement('canvas'); out.width=shot.base.width; out.height=shot.base.height; const x=out.getContext('2d'); x.drawImage(shot.base,0,0); shot.shapes.forEach(sh=>drawShape(x,sh));
      return out.toDataURL('image/jpeg', .86);
    }
    function close(){ document.removeEventListener('keydown',keys,true); root.remove(); shot=null; }
    canvas.width=base.width; canvas.height=base.height; draw();
  }

  function openMenu() {
    openWinModal({ title:'Снимок экрана', icon:'app', narrow:true, locked:true, backdrop:true, backdropBlur:false,
      body:`<div class="stack" style="gap:10px">
        <p class="small muted" style="margin:0">Снимок приложения с автоматической маской баланса, заказов, людей и переписок. Маску можно отключить в профиле.</p>
        <button class="btn btn--soft" data-cap="shot">Сделать снимок</button>
        <button class="btn btn--ghost" data-cap="record">Записать экран</button>
        <p class="tiny faint" style="margin:0">В браузере система один раз спросит, что захватывать. В настольной сборке используется нативный захват.</p>
      </div>`,
      footer:'<button class="btn btn--ghost" data-x>Закрыть</button>',
      onMount:(m,c)=>{ m.querySelectorAll('[data-cap]').forEach(b=>b.onclick=()=>{ const mode=b.dataset.cap; c(); if(mode==='record') setTimeout(openRecord,0); else startShot(); }); m.querySelector('[data-x]').onclick=c; }
    });
  }

  function openRecord() {
    if (capturing || shot){ notice('Сначала завершите текущий снимок','warn'); return; }
    if (rec && rec.stop){
      confirmModal({ title:'Запись уже идёт', text:'Остановить и сохранить текущую запись, затем начать новую?', okText:'Сохранить и начать новую', danger:true }).then(ok=>{ if(!ok) return; rec.stop(); setTimeout(openRecord, 700); });
      return;
    }
    openWinModal({ title:'Запись экрана', icon:'app', narrow:true, locked:true, backdrop:true, backdropBlur:false,
      body:`<div class="stack" style="gap:10px"><p class="small muted" style="margin:0">Браузер попросит выбрать вкладку или окно для записи. Конфиденциальные данные маскируются.</p><label class="check"><input type="checkbox" id="self-mic"><span class="box"></span><span>Записывать микрофон</span></label><p class="tiny faint" style="margin:0">Микрофон — единственное, на что система может попросить разрешение.</p></div>`,
      footer:'<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-start>Начать запись</button>',
      onMount:(m,c)=>{ m.querySelector('[data-x]').onclick=c; m.querySelector('[data-start]').onclick=()=>{ const mic=!!m.querySelector('#self-mic').checked; c(); startSelfRecording(mic); }; }
    });
  }

  /* Снимаем маску не только с найденного узла, но и со всех скрытых
     предков и потомков внутри него: иначе родительский фильтр продолжает
     размывать элемент, и «раскрыть только это» визуально не срабатывает. */
  const revealOnly = node => {
    if (!node) return;
    [...document.querySelectorAll(PRIVACY_SELECTORS.join(','))].forEach(el => {
      if (el === node || el.contains(node) || node.contains(el)){
        el.style.setProperty('filter','none','important');
        el.style.setProperty('user-select','auto','important');
      }
    });
  };
  function askReveal(target, openedBy){
    openModal({ title:'Раскрыть данные?', narrow:true, modalClass:'cap-privacy-modal',
      body:'<p class="small muted">На записи/снимке этот элемент скрыт. Раскрыть только его или все заблюренные данные?</p>',
      footer:'<button class="btn btn--ghost" type="button" data-cap-cancel>Оставить скрытым</button><button class="btn btn--soft" type="button" data-cap-only>Только это</button><button class="btn btn--danger" type="button" data-cap-all>Все данные</button>',
      onMount:(m,c)=>{
        const only = () => { revealOnly(target); c(); };
        m.querySelector('[data-cap-cancel]').onclick=c;
        m.querySelector('[data-cap-only]').onclick=only;
        m.querySelector('[data-cap-all]').onclick=()=>{ document.body.classList.remove('capture-privacy'); c(); };
      }
    });
  }

  async function startSelfRecording(mic){
    if (rec) { notice('Запись уже идёт','warn'); return; }
    if (capturing || shot) { notice('Сначала завершите текущий снимок','warn'); return; }
    capturing = true;
    try {
      privacyOn(); document.body.classList.add('is-recording');
      const stream = await navigator.mediaDevices.getDisplayMedia({ video:{frameRate:24,displaySurface:'browser'}, audio:false, preferCurrentTab:true });
      const video = el('video'); video.muted=true; video.playsInline=true; video.srcObject=stream;
      await new Promise((res,rej)=>{ video.onloadedmetadata=res; video.onerror=rej; setTimeout(res,1200); });
      await video.play();
      const vw=video.videoWidth||innerWidth*devicePixelRatio, vh=video.videoHeight||innerHeight*devicePixelRatio;
      const root=el('div','cap-rec-live'); root.innerHTML='<canvas class="cap-anno"></canvas><div class="cap-tools cap-rec-tools"><button data-rtool="cursor" class="on" title="Курсор — нажимать приложение"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 3l14 8-6 1-3 7L5 3Z" fill="currentColor"/></svg></button><button data-rtool="hand" title="Рука — двигать и растягивать выделенное, не трогая приложение"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 11V6.5a1.5 1.5 0 0 1 3 0V11m0 0V5a1.5 1.5 0 0 1 3 0v6m0 0V6.5a1.5 1.5 0 0 1 3 0V14c0 4.2-2.8 7-7 7H9a5.5 5.5 0 0 1-5.5-5.5v-3a1.5 1.5 0 0 1 3 0V14"/></svg></button><button data-rtool="select" title="Выделить элемент">□</button><button data-rtool="rect" title="Рамка">□</button><button data-rtool="ellipse" title="Эллипс">○</button><button data-rtool="arrow" title="Стрелка">↗</button><button data-rtool="pen" title="Маркер">✎</button><button data-rtool="text" title="Текст">T</button><span class="spacer"></span><button data-rcolor="#ff5c5c" class="on" style="color:#ff5c5c">●</button><button data-rcolor="#ffd166" style="color:#ffd166">●</button><button data-rcolor="#4cc9f0" style="color:#4cc9f0">●</button><button data-rundo title="Отменить">↶</button><button data-rredo title="Повторить">↷</button><button data-rclear title="Очистить">⌫</button></div>';
      document.body.appendChild(root);
      const anno=$('.cap-anno',root); anno.width=innerWidth*devicePixelRatio; anno.height=innerHeight*devicePixelRatio; anno.style.width=innerWidth+'px'; anno.style.height=innerHeight+'px';
      const actx=anno.getContext('2d'); let tool='cursor', shapes=[], redo=[], drawing=null, drawColor='#ff5c5c';
      /* Кадр записи ограничен 1440×900: интерфейс остаётся читаемым, а вес
         видео падает в разы — полноразмерный Retina-холст давал ~13 МБ за 20 с. */
      const k=Math.min(1,1440/vw,900/vh);
      const cw=Math.max(2,Math.round(vw*k/2)*2), chh=Math.max(2,Math.round(vh*k/2)*2);
      const canvas=document.createElement('canvas'); canvas.width=cw; canvas.height=chh; const ctx=canvas.getContext('2d');
      const out=canvas.captureStream(24); let micStream=null;
      /* Волна-капелька от клика и наезд камеры на выбранную область —
         одноместные состояния записи, живут вне разметки. */
      let ripples = [], zoom = null;
      if (mic){ try { micStream=await navigator.mediaDevices.getUserMedia({audio:true}); micStream.getAudioTracks().forEach(t=>out.addTrack(t)); } catch(e){ notice('Микрофон недоступен — запись без звука','warn'); } }
      const mp4Types=['video/mp4;codecs=avc1.42E01E','video/mp4;codecs=avc1.42001E','video/mp4;codecs=avc1','video/mp4']; const webm=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm'; const mime=mp4Types.find(t=>MediaRecorder.isTypeSupported(t))||webm; const ext=mime.includes('mp4')?'mp4':'webm'; const chunks=[]; const mr=new MediaRecorder(out,{mimeType:mime,videoBitsPerSecond:1400000,audioBitsPerSecond:64000});
      mr.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      const bar=el('div','cap-rec-bar','<b>● Запись</b><span class="cap-rec-time">00:00</span><button class="btn btn--ghost btn--sm" data-recsnap>Снимок</button><button class="btn btn--ghost btn--sm" data-rzoom>Зум</button><button class="btn btn--ghost btn--sm" data-pause>Пауза</button><button class="btn btn--ghost btn--sm" data-cancel title="Прервать запись без сохранения">Отменить</button><button class="btn btn--danger btn--sm" data-stop>Остановить</button>'); document.body.appendChild(bar);
      const drawShapes=(c,scale=1)=>{ shapes.forEach(sh=>{ c.save(); c.strokeStyle=sh.color||'#ff5c5c';c.fillStyle=c.strokeStyle;c.lineWidth=4*scale;c.lineCap='round';c.lineJoin='round'; if(sh.tool==='rect'||sh.tool==='select'){if(sh.tool==='select')c.setLineDash([7*scale,4*scale]);c.strokeRect(sh.x*scale,sh.y*scale,sh.w*scale,sh.h*scale);} else if(sh.tool==='ellipse'){c.beginPath();c.ellipse((sh.x+sh.w/2)*scale,(sh.y+sh.h/2)*scale,Math.abs(sh.w/2)*scale,Math.abs(sh.h/2)*scale,0,0,Math.PI*2);c.stroke();} else if(sh.tool==='arrow'){const ex=(sh.x+sh.w)*scale,ey=(sh.y+sh.h)*scale;c.beginPath();c.moveTo(sh.x*scale,sh.y*scale);c.lineTo(ex,ey);c.stroke();const a=Math.atan2(sh.h,sh.w),l=16*scale;c.beginPath();c.moveTo(ex,ey);c.lineTo(ex-l*Math.cos(a-.5),ey-l*Math.sin(a-.5));c.moveTo(ex,ey);c.lineTo(ex-l*Math.cos(a+.5),ey-l*Math.sin(a+.5));c.stroke();} else if(sh.tool==='pen'){c.beginPath();sh.points.forEach((p,i)=>i?c.lineTo(p.x*scale,p.y*scale):c.moveTo(p.x*scale,p.y*scale));c.stroke();} else if(sh.tool==='text'){c.font=`700 ${22*scale}px system-ui`;c.fillText(sh.text,sh.x*scale,sh.y*scale);} c.restore(); }); };
      const redraw=()=>{ actx.clearRect(0,0,anno.width,anno.height); actx.save(); actx.scale(devicePixelRatio,devicePixelRatio); drawShapes(actx,1); actx.restore(); };
      let busy=false;
      /* Кадр записи: камера (наезд) → рисунки → волны от кликов. */
      const paintRipple = (c, r, scale) => {
        const age = (performance.now() - r.t) / 520;
        if (age >= 1) return;
        const k = scale;
        c.save();
        c.globalAlpha = (1 - age) * .85;
        c.strokeStyle = '#4cc9f0';
        c.lineWidth = 3 * k;
        c.beginPath();
        c.ellipse(r.x*k, r.y*k, (10 + age * 34) * k, (10 + age * 34) * k * .62, 0, 0, Math.PI * 2);
        c.stroke();
        /* Капля: точка в месте клика, чуть темнее к краю. */
        c.globalAlpha = Math.max(0, 1 - age * .7) * .9;
        c.fillStyle = '#4cc9f0';
        c.beginPath(); c.arc(r.x*k, r.y*k, Math.max(3.5, 7 - age * 3) * k, 0, Math.PI * 2); c.fill();
        c.restore();
      };
      /* Кадр прямо из видеопотока: после возврата с зума на холсте может
         лежать старая картинка, поэтому снимок берём свежий. */
      const freshFrame = () => {
        const c = document.createElement('canvas');
        c.width = canvas.width; c.height = canvas.height;
        const g = c.getContext('2d');
        if (video && video.videoWidth) g.drawImage(video, 0, 0, c.width, c.height);
        else g.drawImage(canvas, 0, 0);
        return c;
      };
      const pump=()=>{
        if(!mr||mr.state==='inactive'||mr.state==='paused') return;
        ripples = ripples.filter(r => performance.now() - r.t < 520);
        if (zoom){
          /* Плавный наезд: к центру выбранной области, 520 мс с easing. */
          const p = Math.min(1, (performance.now() - zoom.t0) / 520);
          const e = 1 - Math.pow(1 - p, 3);
          const cx = (zoom.x + zoom.w / 2) * vw, cy = (zoom.y + zoom.h / 2) * vh;
          const z = 1 + (zoom.k - 1) * e;
          ctx.save();
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.scale(z, z);
          ctx.translate(-cx * (canvas.width / vw), -cy * (canvas.height / vh));
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          ctx.restore();
        } else {
          ctx.drawImage(video,0,0,canvas.width,canvas.height);
        }
        drawShapes(ctx,canvas.width/innerWidth);
        ripples.forEach(r => paintRipple(ctx, r, canvas.width / innerWidth));
      };
      mr.start(500); const tick=setInterval(pump,41); pump();
      /* Счётчик идёт только пока запись активна: на паузе время замирает. */
      let recAccum=0, recRun=Date.now();
      const paintRecTime=()=>{
        const elapsed=recAccum + (recRun==null ? 0 : Date.now()-recRun);
        const s=Math.floor(elapsed/1000);
        const tm=$('.cap-rec-time',bar);
        if(tm) tm.textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
      };
      paintRecTime();
      const timer=setInterval(paintRecTime,250);
      const stop=()=>{ if(!rec) return; clearInterval(tick); clearInterval(timer); mr.stop(); };
      $('[data-stop]',bar).onclick=stop;
      $('[data-rclear]',root).onclick=()=>{shapes=[];redo=[];redraw();};
      $('[data-rundo]',root).onclick=()=>{if(shapes.length){redo.push(shapes.pop());redraw();}};
      $('[data-rredo]',root).onclick=()=>{if(redo.length){shapes.push(redo.pop());redraw();}};
      root.querySelectorAll('[data-rcolor]').forEach(b=>b.onclick=()=>{drawColor=b.dataset.rcolor;root.querySelectorAll('[data-rcolor]').forEach(x=>x.classList.toggle('on',x===b));});
      root.querySelectorAll('[data-rtool]').forEach(b=>b.onclick=()=>{ tool=b.dataset.rtool; root.querySelectorAll('[data-rtool]').forEach(x=>x.classList.toggle('on',x===b)); anno.style.pointerEvents=(tool==='cursor'||tool==='hand')?'none':'auto'; });
      const pt=e=>({x:e.clientX,y:e.clientY});
      /* Клик видно на видео: короткая волна-капелька в точке нажатия,
         даже когда инструмент — «Курсор» и событие уходит в приложение. */
      window.addEventListener('pointerdown', e => {
        if (!rec) return;
        if (e.target.closest && e.target.closest('.cap-rec-bar,.cap-rec-live,.cap-tools,.cap-editor,.modal-mask')) return;
        ripples.push({ x:e.clientX, y:e.clientY, t:performance.now() });
      }, true);
      /* Наезд камеры на область: кроп-рамкой в режиме «Обрезать». */
      const applyZoom = box => {
        if (!box) return;
        zoom = { ...box, t0: performance.now(), k: Math.max(1.6, Math.min(6, innerWidth / Math.max(80, box.w))) };
        redraw();
        notice('Наезд камеры — сброс повторным нажатием «Зум»','info');
      };
      const zbtn = $('[data-rzoom]', bar);
      const startZoomPick = () => {
        if (zoom){ zoom = null; zbtn.classList.remove('on'); return; }
        let box = null, start = null;
        const pickMove = e => { if (!start) return; box = { x:Math.min(start.x,e.clientX), y:Math.min(start.y,e.clientY), w:Math.abs(e.clientX-start.x), h:Math.abs(e.clientY-start.y) }; pickDraw(); };
        const pickUp = () => {
          window.removeEventListener('pointermove', pickMove, true);
          window.removeEventListener('pointerup', pickUp, true);
          pickCv.remove();
          if (box && box.w > 40 && box.h > 40){ applyZoom(box); zbtn.classList.add('on'); }
          else notice('Область слишком мала — выделите её заново','warn');
        };
        const ov = el('div', 'cap-zoom-pick');
        const pickCv = el('canvas');
        pickCv.style.cssText = 'position:fixed;inset:0;z-index:9600;cursor:crosshair;width:100vw;height:100vh';
        ov.appendChild(pickCv);
        document.body.appendChild(pickCv);
        const pctx = pickCv.getContext('2d');
        pickCv.width = innerWidth; pickCv.height = innerHeight;
        const pickDraw = () => {
          pctx.clearRect(0,0,innerWidth,innerHeight);
          pctx.fillStyle = 'rgba(8,10,16,.35)'; pctx.fillRect(0,0,innerWidth,innerHeight);
          if (box){ pctx.clearRect(box.x, box.y, box.w, box.h); pctx.strokeStyle = '#4cc9f0'; pctx.lineWidth = 2; pctx.setLineDash([6,4]); pctx.strokeRect(box.x, box.y, box.w, box.h); }
        };
        window.addEventListener('pointerdown', e => { start = { x:e.clientX, y:e.clientY }; }, true);
        window.addEventListener('pointermove', pickMove, true);
        window.addEventListener('pointerup', pickUp, true);
        pickDraw();
      };
      anno.addEventListener('pointerdown',e=>{ if(tool==='cursor'||tool==='hand')return; const p=pt(e); if(tool==='select'){ const list=document.elementsFromPoint(e.clientX,e.clientY).filter(el=>!el.closest('.cap-rec-live,.cap-rec-bar,.cap-tools')); const t=list.find(el=>el && el!==document.documentElement && el!==document.body); if(!t)return; const r=t.getBoundingClientRect(); shapes.push({tool:'select',x:r.left,y:r.top,w:r.width,h:r.height,color:'#4cc9f0'}); redraw(); return; } if(tool==='text'){ const inp=document.createElement('input');inp.placeholder='Текст';inp.style.cssText='position:fixed;z-index:10000;left:'+p.x+'px;top:'+p.y+'px;background:var(--panel);border:1px solid var(--accent);border-radius:5px;padding:3px;color:#ff5c5c';document.body.appendChild(inp);inp.focus();const done=()=>{if(inp.value.trim()){shapes.push({tool:'text',x:p.x,y:p.y,text:inp.value.trim(),color:'#ff5c5c'});redraw();}inp.remove();};inp.onblur=done;inp.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();done();}};return;} drawing={tool,x:p.x,y:p.y,w:0,h:0,points:[p],color:drawColor}; shapes.push(drawing); });
      anno.addEventListener('pointermove',e=>{if(!drawing)return;const p=pt(e);drawing.w=p.x-drawing.x;drawing.h=p.y-drawing.y;drawing.points.push(p);redraw();});
      anno.addEventListener('pointerup',()=>{drawing=null;});
      /* Снимок во время записи: кадр записи без разметки уходит в редактор,
         а запись продолжается — панель одна на оба режима. */
      $('[data-recsnap]', bar).onclick = () => {
        /* Свежий кадр из видеопотока, а не последний отрисованный на холсте:
           иначе при возврате с зума остаётся старая картинка. */
        const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
        const cx0 = c.getContext('2d');
        const fresh = freshFrame();
        if (zoom){
          const cx = (zoom.x + zoom.w / 2) * vw, cy = (zoom.y + zoom.h / 2) * vh;
          cx0.save();
          cx0.translate(c.width / 2, c.height / 2); cx0.scale(zoom.k, zoom.k);
          cx0.translate(-cx * (c.width / vw), -cy * (c.height / vh));
          cx0.drawImage(fresh, 0, 0, c.width, c.height);
          cx0.restore();
        } else {
          cx0.drawImage(fresh, 0, 0);
        }
        const k = c.width / Math.max(1, innerWidth);
        const xs = new Set(), ys = new Set();
        [...document.querySelectorAll('body *')].forEach(n => {
          if (n.closest('.cap-editor,.cap-tools,.cap-rec-live,.cap-rec-bar,.cap-picker,.cap-zoom-pick')) return;
          const r = n.getBoundingClientRect(), cs = getComputedStyle(n);
          if (r.width < 6 || r.height < 6) return;
          if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return;
          [r.left, r.right, r.left + r.width/2].forEach(v => xs.add(Math.round(v*k)));
          [r.top, r.bottom, r.top + r.height/2].forEach(v => ys.add(Math.round(v*k)));
        });
        openEditor(c, null, { xs:[...xs], ys:[...ys], scale:k });
      };
      $('[data-rzoom]', bar).onclick = startZoomPick;
      /* cancelled = прервать без сохранения: чанки выбрасываем, файл не
         скачиваем. Ждём события stop, иначе захват завершится раньше нас. */
      let cancelled = false;
      const finalStop=()=>{ clearInterval(tick); clearInterval(timer); if(rec) rec.zoomOn = false; if(mr.state!=='inactive') mr.stop(); };
      const cancelRec=()=>{
        if (!rec) return;
        cancelled = true;
        notice('Запись отменена — файл не сохранён','info');
        finalStop();
      };
      const cleanup = ()=>{
        zoom = null; ripples = [];
        if (micStream) micStream.getTracks().forEach(t=>t.stop());
        stream.getTracks().forEach(t=>t.stop());
        privacyOff(); document.body.classList.remove('is-recording');
        if (rec && rec.reveal) document.removeEventListener('click', rec.reveal, true);
        bar.remove(); root.remove(); rec = null;
        /* Сервисный флаг загрузки снимается здесь же: раньше он оставался
           true после записи, и следующий снимок/запись отвечали «уже идёт». */
        capturing = false;
      };
      mr.onstop=()=>{
        if (!cancelled){
          const blob=new Blob(chunks,{type:mime});
          const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
          a.download='audiowizard-recording-'+Date.now()+'.'+ext;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(()=>URL.revokeObjectURL(a.href),1000);
          notice('Запись сохранена','ok');
        }
        cleanup();
      };
      /* Клик по скрытому элементу и по самой плашке открывает один и тот же
         диалог. Раскрываем самый внешний скрытый узел вокруг точки клика. */
      const reveal = e => {
        if (!document.body.classList.contains('capture-privacy')) return;
        if (e.target.closest && e.target.closest('.modal-mask,.cap-editor,.cap-rec-bar,.cap-tools,.cap-privacy-pill')) return;
        const t = privacyTargetOf(e.target);
        if (!t) return;
        e.preventDefault(); e.stopPropagation();
        askReveal(t);
      };
      document.addEventListener('click', reveal, true);
      rec={mr, reveal};
      // Keep a reliable stop that doesn't depend on the closure's rec check.
      $('[data-stop]',bar).onclick=finalStop;
      $('[data-pause]',bar).onclick=()=>{
        if(mr.state==='recording'){ mr.pause(); recAccum += Date.now()-recRun; recRun=null; paintRecTime(); $('[data-pause]',bar).textContent='Продолжить'; }
        else if(mr.state==='paused'){ recRun=Date.now(); mr.resume(); paintRecTime(); $('[data-pause]',bar).textContent='Пауза'; }
      };
      rec.stop=finalStop;
      const cancelBtn = $('[data-cancel]',bar);
      if (cancelBtn) cancelBtn.onclick = cancelRec;
    } catch(e){ privacyOff(); document.body.classList.remove('is-recording'); capturing = false; captureError(e); }
  }

  window.CaptureStudio = { open:openMenu, shot:startShot, shotToFile:(cb)=>startShot('shot',cb), record:openRecord };
})();
