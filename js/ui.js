/* ============================================================
   Audiowizard Workspace — UI-примитивы
   ============================================================ */
'use strict';

const icon = (name, cls='') => `<svg class="ico ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const avatarHTML = (u, cls='') => {
  if (!u) return `<span class="avatar ${cls}">?</span>`;
  const st = u.role==='executor' && u.ext ? u.ext.status : 'active';
  const dot = u.is_online && st!=='blacklisted'
    ? `<span class="dot dot--online"></span>`
    : `<span class="dot dot--offline"></span>`;
  const bg = u.avatar ? ` style="background-image:url('${u.avatar}')"` : '';
  return `<span class="avatar ${cls}"${bg}>${u.avatar?'':initials(u.full_name)}${dot}</span>`;
};
const starsHTML = (n, max=3) => {
  let h = '<span class="qual-stars">';
  for (let i=1;i<=max;i++) h += `<svg class="ico ${i<=n?'ico-fill':''} ${i>n?'off':''}"><use href="#i-star"/></svg>`;
  return h+'</span>';
};
const statusChip = st => {
  const m = STATUS_META[st] || STATUS_META.draft;
  return `<span class="badge ${m.cls}"><span class="dot"></span>${m.label}</span>`;
};
const nicheChip = id => `<span class="badge badge--outline">${esc(nicheName(id))}</span>`;
const roleBadge = r => {
  const map = { admin:'c-red', top_manager:'c-violet', manager:'c-blue', executor:'c-green', client:'c-yellow' };
  return `<span class="badge ${map[r]||'c-gray'}">${ROLE_LABEL[r]||r}</span>`;
};

/* ---------- Тосты ---------- */
function toast(msg, kind='info', title=''){
  let host = $('.toasts');
  if (!host){ host = document.createElement('div'); host.className='toasts'; document.body.appendChild(host); }
  const icons = { ok:'check-c', err:'x-c', warn:'alert', info:'info' };
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.innerHTML = `${icon(icons[kind]||'info')}<div class="toast__body">${title?`<b class="toast__title">${esc(title)}</b>`:''}<span class="toast__msg">${msg}</span></div><button class="t-close" aria-label="Закрыть">${icon('x','ico-sm')}</button>`;
  host.appendChild(el);
  let timer = setTimeout(hide, 4600);
  let paused = false;
  el.addEventListener('mouseenter', ()=>{ paused = true; clearTimeout(timer); });
  el.addEventListener('mouseleave', ()=>{ if (paused){ paused = false; timer = setTimeout(hide, 1800); } });
  el.querySelector('.t-close').addEventListener('click', hide);
  function hide(){ if (el.classList.contains('out')) return; el.classList.add('out'); setTimeout(()=>el.remove(), 260); }
}

/* ---------- Аватар: ручной кроп кружком ---------- */
function openBgCropper(file, onDone){
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const S = 400;
    let scale = 1, ox = 0, oy = 0, darken = 0, drag = null;
    const base = Math.max(S / img.width, S / img.height);
    scale = base;
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal" style="max-width:${S + 48}px">
        <div class="modal__h"><h3>Фон приложения</h3><button class="modal__x" data-x>${icon('x')}</button></div>
        <div class="modal__b" style="display:flex;flex-direction:column;align-items:center;gap:12px">
          <div style="width:${S}px;height:${Math.round(S*0.56)}px;border-radius:12px;overflow:hidden;position:relative;background:var(--bg-2);cursor:grab;touch-action:none">
            <canvas id="bg-cv" width="${S}" height="${Math.round(S*0.56)}" style="width:100%;height:100%;display:block"></canvas>
          </div>
          <div class="row" style="gap:10px;width:${S}px;align-items:center">
            ${icon('zoom-out','ico-sm')}<input type="range" id="bg-zoom" min="100" max="400" value="100" style="flex:1;accent-color:var(--accent)">${icon('zoom-in','ico-sm')}
          </div>
          <div class="row" style="gap:10px;width:${S}px;align-items:center">
            <span class="small faint">${icon('sun','ico-sm')}</span><input type="range" id="bg-darken" min="0" max="80" value="0" style="flex:1;accent-color:var(--accent)"><span class="small faint">${icon('moon','ico-sm')}</span>
          </div>
          <p class="tiny faint">Перетаскивайте, масштабируйте, затемните фон по вкусу</p>
        </div>
        <div class="modal__f"><button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-ok>Сохранить</button></div>
      </div>`;
    document.body.appendChild(mask);
    const cv = mask.querySelector('#bg-cv'), ctx = cv.getContext('2d');
    const W = S, H = Math.round(S*0.56);
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (W - w)/2 + ox, (H - h)/2 + oy, w, h);
      if (darken > 0){ ctx.fillStyle = `rgba(0,0,0,${darken/100})`; ctx.fillRect(0, 0, W, H); }
    };
    draw();
    mask.querySelector('#bg-zoom').addEventListener('input', e => {
      const old = scale; scale = base * (+e.target.value / 100);
      ox = ox * (scale/old); oy = oy * (scale/old); draw();
    });
    mask.querySelector('#bg-darken').addEventListener('input', e => {
      darken = +e.target.value; draw();
    });
    cv.addEventListener('wheel', e => { e.preventDefault(); const z = document.querySelector('#bg-zoom'); z.value = Math.min(400, Math.max(100, +z.value + (e.deltaY < 0 ? 10 : -10))); z.dispatchEvent(new Event('input')); }, { passive:false });
    const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.touches ? e.touches[0].clientX : e.clientX) - r.left, y: (e.touches ? e.touches[0].clientY : e.clientY) - r.top }; };
    const down = e => { drag = pos(e); cv.style.cursor = 'grabbing'; };
    const move = e => { if (!drag) return; e.preventDefault(); const p2 = pos(e); ox += p2.x - drag.x; oy += p2.y - drag.y; drag = p2; draw(); };
    const up = () => { drag = null; cv.style.cursor = 'grab'; };
    cv.addEventListener('mousedown', down); window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    cv.addEventListener('touchstart', down, { passive:true }); cv.addEventListener('touchmove', move, { passive:false }); cv.addEventListener('touchend', up);
    const closeAll = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); mask.classList.add('closing'); setTimeout(() => mask.remove(), 200); URL.revokeObjectURL(url); };
    mask.querySelectorAll('[data-x]').forEach(x => x.onclick = closeAll);
    mask.querySelector('[data-ok]').onclick = () => {
      const out = document.createElement('canvas'); out.width = W; out.height = H;
      const octx = out.getContext('2d');
      const w = img.width * scale, h = img.height * scale;
      octx.drawImage(img, (W - w)/2 + ox, (H - h)/2 + oy, w, h);
      if (darken > 0){ octx.fillStyle = `rgba(0,0,0,${darken/100})`; octx.fillRect(0, 0, W, H); }
      out.toBlob(blob => {
        const rd = new FileReader();
        rd.onload = () => { onDone(rd.result, darken); closeAll(); };
        rd.readAsDataURL(blob);
      }, 'image/png');
    };
  };
  img.src = url;
}

function openAvatarCropper(file, onDone){
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const S = 260, OUT = 256;
    let scale = 1, ox = 0, oy = 0, drag = null;
    const base = Math.max(S / img.width, S / img.height);
    scale = base;
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML = `
      <div class="modal" style="max-width:${S + 48}px">
        <div class="modal__h"><h3>Кадрирование аватара</h3><button class="modal__x" data-x>${icon('x')}</button></div>
        <div class="modal__b" style="display:flex;flex-direction:column;align-items:center;gap:12px">
          <div id="av-stage" style="width:${S}px;height:${S}px;border-radius:50%;overflow:hidden;position:relative;background:var(--bg-2);cursor:grab;touch-action:none">
            <canvas id="av-cv" width="${S}" height="${S}" style="width:100%;height:100%;display:block"></canvas>
          </div>
          <div class="row" style="gap:10px;width:${S}px;align-items:center">
            ${icon('zoom-out','ico-sm')}<input type="range" id="av-zoom" min="100" max="400" value="100" style="flex:1;accent-color:var(--accent)">${icon('zoom-in','ico-sm')}
          </div>
          <p class="tiny faint">Перетаскивайте фото, колесо мыши — масштаб. Кружок — финальная область.</p>
        </div>
        <div class="modal__f"><button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-ok>Сохранить</button></div>
      </div>`;
    document.body.appendChild(mask);
    const cv = mask.querySelector('#av-cv'), ctx = cv.getContext('2d');
    const draw = () => {
      ctx.clearRect(0, 0, S, S);
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg-2').trim() || '#222';
      ctx.fillRect(0, 0, S, S);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (S - w)/2 + ox, (S - h)/2 + oy, w, h);
    };
    draw();
    mask.querySelector('#av-zoom').addEventListener('input', e => {
      const old = scale; scale = base * (+e.target.value / 100);
      ox = ox * (scale/old); oy = oy * (scale/old); draw();
    });
    cv.addEventListener('wheel', e => { e.preventDefault(); const z = document.querySelector('#av-zoom'); z.value = Math.min(400, Math.max(100, +z.value + (e.deltaY < 0 ? 10 : -10))); z.dispatchEvent(new Event('input')); }, { passive:false });
    const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.touches ? e.touches[0].clientX : e.clientX) - r.left, y: (e.touches ? e.touches[0].clientY : e.clientY) - r.top }; };
    const down = e => { drag = pos(e); cv.style.cursor = 'grabbing'; };
    const move = e => { if (!drag) return; e.preventDefault(); const p2 = pos(e); ox += p2.x - drag.x; oy += p2.y - drag.y; drag = p2; draw(); };
    const up = () => { drag = null; cv.style.cursor = 'grab'; };
    cv.addEventListener('mousedown', down); window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    cv.addEventListener('touchstart', down, { passive:true }); cv.addEventListener('touchmove', move, { passive:false }); cv.addEventListener('touchend', up);
    const closeAll = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); mask.classList.add('closing'); setTimeout(() => mask.remove(), 200); URL.revokeObjectURL(url); };
    mask.querySelectorAll('[data-x]').forEach(x => x.onclick = closeAll);
    mask.querySelector('[data-ok]').onclick = () => {
      const out = document.createElement('canvas'); out.width = OUT; out.height = OUT;
      const octx = out.getContext('2d');
      octx.save(); octx.beginPath(); octx.arc(OUT/2, OUT/2, OUT/2, 0, Math.PI*2); octx.clip();
      const k = OUT / S;
      const w = img.width * scale * k, h = img.height * scale * k;
      octx.drawImage(img, (OUT - w)/2 + ox*k, (OUT - h)/2 + oy*k, w, h);
      octx.restore();
      out.toBlob(blob => {
        const rd = new FileReader();
        rd.onload = () => { onDone(rd.result); closeAll(); };
        rd.readAsDataURL(blob);
      }, 'image/png');
    };
  };
  img.src = url;
}

function openModal({ title='', body='', footer='', wide=false, narrow=false, onClose=null, onMount=null }){
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal ${wide?'modal--wide':''} ${narrow?'modal--narrow':''}" role="dialog" aria-modal="true">
      <div class="modal__h">
        <h3>${title}</h3>
        <button class="iconbtn modal__x" aria-label="Закрыть">${icon('x')}</button>
      </div>
      <div class="modal__b">${body}</div>
      ${footer ? `<div class="modal__f">${footer}</div>` : ''}
    </div>`;
  $('#overlays').appendChild(mask);
  const close = () => {
    mask.classList.add('closing');
    setTimeout(() => { mask.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); }, 200);
  };
  const onKey = e => { if (e.key==='Escape') close(); };
  document.addEventListener('keydown', onKey);
  mask.addEventListener('mousedown', e => { if (e.target === mask) close(); });
  mask.querySelector('.modal__x').onclick = close;
  onMount && onMount(mask, close);
  return { el:mask, close };
}

function confirmModal({ title='Подтверждение', text='', okText='Подтвердить', danger=false, checkbox=null }){
  return new Promise(res => {
    let checked = false;
    const m = openModal({
      title, narrow:true,
      body: `<p style="color:var(--text-2);font-size:13.5px;line-height:1.6">${text}</p>
        ${checkbox ? `<label class="check" style="margin-top:14px"><input type="checkbox" id="cf-chk"><span class="box"><svg><use href="#i-check-c"/></svg></span><span style="font-size:12.5px;color:var(--muted)">${checkbox}</span></label>` : ''}`,
      footer: `<button class="btn btn--ghost" data-c>Отмена</button>
               <button class="btn ${danger?'btn--danger':'btn--primary'}" data-ok ${checkbox?'disabled':''}>${okText}</button>`,
      onClose: () => res(null)
    });
    const ok = m.el.querySelector('[data-ok]');
    if (checkbox) m.el.querySelector('#cf-chk').addEventListener('change', e => { checked = e.target.checked; ok.disabled = !checked; });
    m.el.querySelector('[data-c]').onclick = () => { res(null); m.close(); };
    ok.onclick = () => { res(checkbox ? checked : true); m.close(); };
  });
}

/* «Функция в разработке» */
function wipModal(name='Эта функция'){
  openModal({
    narrow:true,
    title:'Функция в разработке',
    body: `<div style="text-align:center;padding:10px 0 4px">
      <div style="width:74px;height:74px;border-radius:22px;background:var(--accent-soft);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;color:var(--accent)">
        ${icon('refresh','spin')}
      </div>
      <p style="font-weight:650;font-size:15px">${esc(name)} появится в ближайших версиях</p>
      <p class="muted small" style="margin-top:6px">Мы уже работаем над ней. Следите за патчноутами — уведомление придёт в центр уведомлений.</p>
      <div class="progress" style="margin:16px auto 4px;max-width:220px"><span style="width:64%"></span></div>
      <span class="small faint">готовность ≈ 64%</span>
    </div>`,
    footer:`<button class="btn btn--ghost" data-x>Закрыть</button>`
  }).el.querySelector('[data-x]').addEventListener('click', e => { const m = e.target.closest('.modal-mask'); if (m) { m.classList.add('closing'); setTimeout(() => m.remove(), 200); } });
}

/* ---------- Выпадающие меню / контекстное меню ---------- */
let openDD = null;
function showDropdown(anchor, items, opts={}){
  /* повторный клик по тому же якорю: не открывать заново (тумблер) */
  if (anchor && ddLastClose.anchor === anchor && Date.now() - ddLastClose.t < 400){ ddLastClose.t = 0; return null; }
  closeDropdown();
  const dd = document.createElement('div');
  dd.className = 'dd';
  dd.innerHTML = items.map(it => {
    if (it === '-') return '<div class="dd__sep"></div>';
    if (it.label && it.header) return `<div class="dd__label">${esc(it.label)}</div>`;
    const check = it.checked ? icon('check-c','dd__check') : '';
    return `<button class="dd__item ${it.danger?'dd__item--danger':''}" data-i="${items.indexOf(it)}">${it.icon?icon(it.icon):''}<span style="flex:1">${esc(it.label)}</span>${check}</button>`;
  }).join('');
  document.body.appendChild(dd);
  const r = (anchor && anchor.getBoundingClientRect) ? anchor.getBoundingClientRect() : { left:0, top:0, right:0, bottom:0 };
  const ddW = dd.offsetWidth, ddH = dd.offsetHeight;
  let x = opts.x ?? r.left, y = opts.y ?? r.bottom + 6;
  x = Math.max(10, Math.min(x, window.innerWidth - ddW - 10));
  y = Math.min(y, window.innerHeight - ddH - 10);
  if (opts.alignRight) x = r.right - ddW;
  dd.style.left = x+'px'; dd.style.top = y+'px';
  dd.addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const it = items[+b.dataset.i];
    if (it.keepOpen){
      it.onClick && it.onClick(it);
      const sp = b.querySelector('span');
      if (sp && it.label) sp.textContent = it.label;
      return;
    }
    closeDropdown();
    it.onClick && it.onClick();
  });
  /* Постоянные слушатели: закрывают плашку на любом клике вне (в т.ч. после keepOpen-пунктов) */
  const ddClose = e => { if (openDD && !openDD.contains(e.target)) closeDropdown(); };
  const ddEsc = e => { if (e.key === 'Escape') closeDropdown(); };
  dd.__ddClose = ddClose; dd.__ddEsc = ddEsc;
  document.addEventListener('pointerdown', ddClose);
  document.addEventListener('keydown', ddEsc);
  dd.__anchor = anchor || null;
  openDD = dd;
  return dd;
}
const ddLastClose = { t: 0, anchor: null };
function closeDropdown(){
  if (openDD){
    const dd = openDD;
    const ddClose = dd.__ddClose;
    const ddEsc = dd.__ddEsc;
    if (ddClose) document.removeEventListener('pointerdown', ddClose);
    if (ddEsc) document.removeEventListener('keydown', ddEsc);
    dd.__ddClose = null; dd.__ddEsc = null;
    dd.classList.add('closing');
    setTimeout(() => { if (openDD === dd) { dd.remove(); openDD = null; } }, 180);
    ddLastClose.t = Date.now();
    ddLastClose.anchor = dd.__anchor || null;
  }
}

function contextMenu(x, y, items){
  const fake = document.createElement('div');
  fake.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0';
  document.body.appendChild(fake);
  const dd = showDropdown(fake, items, { x, y });
  const obs = new MutationObserver(()=>{ if (!document.body.contains(dd)){ obs.disconnect(); fake.remove(); } });
  obs.observe(document.body, { childList:true });
}

/* ---------- Тема ---------- */
const mqlDark = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme(mode, accent){
  const m = mode || 'system';
  const a = accent || 'violet';
  try { localStorage.setItem('aw_theme', JSON.stringify({mode:m, accent:a})); } catch(e){}
  const resolved = m === 'system' ? (mqlDark.matches ? 'dark' : 'light') : m;
  if (document.body) document.documentElement.classList.add('theme-anim');
  setFaviconFor(resolved, a);
  /* Браузерная оболочка (адресная строка, нативные контролы) под тему */
  const THEME_TC = { dark:{ 'violet':'#0f0d13','blue':'#0c0e13','red':'#0d0e11','green':'#0c0f0d','mono':'#0e0d0c' },
                     light:{ 'violet':'#f4f2f6','blue':'#f3f4f6','red':'#f6f3ee','green':'#f4f5f0','mono':'#f6f4f1' } };
  const tc = (THEME_TC[resolved] || THEME_TC.dark)[a] || THEME_TC.dark.violet;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', tc);
  const cs = resolved === 'light' ? 'light' : 'dark';
  document.documentElement.style.colorScheme = cs;
  clearTimeout(applyTheme._t);
  applyTheme._t = setTimeout(() => document.documentElement.classList.remove('theme-anim'), 480);
  document.documentElement.dataset.theme = resolved + '-' + a;
  /* Перерисовать канвас волны стенограмм при смене темы */
  const cv = document.querySelector('#ai-wave');
  if (cv && AI && AI.__dbg){
    const st = AI.__dbg();
    if (st && st.processed){
      const pct = st.cur / (st.scale * 60 || 1);
      const evt = new CustomEvent('ai-theme-change', { detail: { progress: pct } });
      window.dispatchEvent(evt);
    }
  }
}
mqlDark.addEventListener('change', ()=>{ const u = me(); applyTheme(u ? u.mode : 'system', u ? u.accent : 'violet'); });

/* ---------- Палетка команд (Ctrl+K) ---------- */
let paletteEl = null, paletteSel = 0, paletteItems = [];
function buildPaletteItems(q){
  q = norm(q);
  const nav = [];
  const add = (group, items) => { if (items.length) nav.push({ group, items }); };
  const match = s => norm(s).includes(q);

  const navItems = APP.navFor(me()).flatMap(sec => sec.items.map(it => ({ label:it.title, icon:it.icon, hint:'Перейти', run:()=>APP.go(it.route) })));
  add('Разделы', q ? navItems.filter(i=>match(i.label)) : navItems);

  const acts = [
    { label:'Создать заказ', icon:'plus', hint:'Ctrl+N', run:()=>APP.go('orders') && CRM.openOrderForm() },
    { label:'Переключить тему', icon:'palette', hint:'Ctrl+Shift+T', run:()=>APP.cycleTheme() },
    { label:'Калькулятор услуг', icon:'calc', run:()=>CRM.openCalculator() },
    { label:'Демо: страницы ошибок', icon:'alert', run:()=>APP.go('err/404') },
    { label:'Проверить обновления', icon:'refresh', run:()=>APP.checkUpdates(true) }
  ];
  add('Действия', acts.filter(i=>!q||match(i.label)));

  if (q && isManagerLike(me()?.role)){
    const ord = noDemo(S.orders.filter(o=>norm(o.order_id).includes(q)||norm((clientById(o.client_id)||{}).full_name).includes(q))).slice(0,5)
      .map(o=>({ label:`${o.order_id} — ${(clientById(o.client_id)||{}).full_name||''}`, icon:'orders', hint:STATUS_META[o.status].label, run:()=>APP.go('orders', o.id) }));
    add('Заказы', ord);
    const ppl = noDemo(S.users.filter(u=>['client','executor'].includes(u.role) && match(u.full_name))).slice(0,4)
      .map(u=>({ label:u.full_name, icon:u.role==='client'?'clients':'executors', hint:ROLE_LABEL[u.role], run:()=>APP.go(u.role==='client'?'clients':'executors', u.id) }));
    add('Люди', ppl);
  }
  return nav;
}
function openPalette(){
  closePalette();
  paletteSel = 0;
  paletteItems = buildPaletteItems('');
  const mask = document.createElement('div');
  mask.className = 'palette-mask';
  mask.innerHTML = `
    <div class="palette" role="dialog" aria-label="Палетка команд">
      <div class="palette__input">${icon('search')}<input id="pal-q" placeholder="Поиск и команды… (заказы, клиенты, темы)" autocomplete="off"></div>
      <div class="palette__list" id="pal-list"></div>
      <div class="palette__foot"><span class="kbd">↑↓</span> навигация <span class="kbd">Enter</span> выбрать <span class="kbd">Esc</span> закрыть</div>
    </div>`;
  document.body.appendChild(mask);
  paletteEl = mask;
  renderPalette();
  const inp = mask.querySelector('#pal-q');
  inp.focus();
  inp.addEventListener('input', ()=>{ paletteSel = 0; paletteItems = buildPaletteItems(inp.value); renderPalette(); });
  inp.addEventListener('keydown', e => {
    const flat = paletteItems.flatMap(g=>g.items);
    if (e.key==='ArrowDown'){ e.preventDefault(); paletteSel = Math.min(paletteSel+1, flat.length-1); renderPalette(); scrollPal(); }
    if (e.key==='ArrowUp'){ e.preventDefault(); paletteSel = Math.max(paletteSel-1, 0); renderPalette(); scrollPal(); }
    if (e.key==='Enter'){ const it = flat[paletteSel]; if (it){ closePalette(); it.run(); } }
    if (e.key==='Escape') closePalette();
  });
  mask.addEventListener('mousedown', e => { if (e.target===mask) closePalette(); });
  function scrollPal(){ const el = $('#pal-list .palette__item.sel'); el && el.scrollIntoView({ block:'nearest' }); }
}
function renderPalette(){
  const host = $('#pal-list');
  if (!host) return;
  let idx = 0;
  host.innerHTML = paletteItems.map(g => `
    <div class="palette__group">${g.group}</div>
    ${g.items.map(it => `<div class="palette__item ${idx===paletteSel?'sel':''}" data-pi="${idx++}">${icon(it.icon||'arrow-r')}<span>${esc(it.label)}</span>${it.hint?`<span class="hint">${esc(it.hint)}</span>`:''}</div>`).join('')}
  `).join('') || `<div class="empty">${icon('search')}<span>Ничего не найдено</span></div>`;
  host.querySelectorAll('.palette__item').forEach(el=>{
    el.onclick = () => { const flat = paletteItems.flatMap(g=>g.items); const it = flat[+el.dataset.pi]; closePalette(); it && it.run(); };
    el.onmouseenter = () => { paletteSel = +el.dataset.pi; host.querySelectorAll('.palette__item').forEach((e2,i)=>e2.classList.toggle('sel', i===paletteSel)); };
  });
}
function closePalette(){ if (paletteEl) { paletteEl.classList.add('closing'); setTimeout(() => { if (paletteEl) { paletteEl.remove(); paletteEl = null; } }, 180); } }

/* ---------- Живой поиск (задержка <200 мс) ---------- */
const liveSearch = debounce(fn => fn(), 150);

/* ---------- Фавиконка: контейнер под тему, цвет волн согласован с палитрой ---------- */
const FAVICON_COLORS = {
  red: ['#d47668', '#b55a4c'], blue: ['#7a95c4', '#6a85b4'], green: ['#87ab93', '#729a7d'],
  violet: ['#b49dd6', '#9a83bc'], mono: ['#a6a0ae', '#8e8896']
};
const FAVICON_BG = { dark: ['#1d1a26', '#12101a'], light: ['#ffffff', '#efeae2'] };
function setFaviconFor(mode, accent){
  const light = mode === 'light';
  const a = accent === 'mono'
    ? (light ? ['#5a5562', '#8a8592'] : ['#c0bcc8', '#a6a0ae'])
    : (FAVICON_COLORS[accent] || FAVICON_COLORS.violet);
  const bg = light ? FAVICON_BG.light : (accent === 'mono' ? ['#161512', '#0e0d0c'] : FAVICON_BG.dark);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${bg[0]}"/><g fill="${a[0]}"><rect x="12.5" y="24.5" width="4.5" height="15" rx="2.25"/><rect x="21" y="19" width="4.5" height="26" rx="2.25"/><rect x="29.75" y="14" width="4.5" height="36" rx="2.25"/><rect x="38.5" y="21" width="4.5" height="22" rx="2.25"/><rect x="47" y="25.5" width="4.5" height="13" rx="2.25"/></g></svg>`;
  let link = document.querySelector('link[rel="icon"][data-dyn]');
  if (!link){
    link = document.createElement('link');
    link.rel = 'icon'; link.setAttribute('data-dyn', '1'); link.type = 'image/svg+xml';
    document.head.appendChild(link);
  }
  link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
}
