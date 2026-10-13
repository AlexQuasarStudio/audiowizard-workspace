/* ============================================================
   Audiowizard Workspace — многооконность (десктоп)
   Окна-вьюпорты: drag, снап, ресайз, max/min, точка в меню, миниатюра.
   Один пункт меню может иметь НЕСКОЛЬКО окон — реестр route → массив.
   Миниатюры показываются только для СВЁРНУТЫХ окон и содержат
   точный снимок окна на момент сворачивания (скролл, введённые данные).
   ============================================================ */
'use strict';

const Windows = (() => {
  let layer = null;
  let winZ = 3010; // глобальный счётчик z-index
  let active = null; // { kind:'drag'|'resize', win, sx, sy, ox, oy, ow, oh, moved, dir }

  // Реестр открытых окон: route → [ { win, minimized, html, scrollTop, hiddenPos } ]
  const registry = new Map();

  const winsFor = route => (registry.get(route) || []).filter(r => !r.win._closing);
  const allWins = () => Array.from(registry.values()).flat().filter(r => !r.win._closing);

  function ensureLayer(){
    if (!layer){
      layer = document.createElement('div');
      layer.id = 'windows-layer';
      document.body.appendChild(layer);
    }
    return layer;
  }

  /* ---------- Индикатор-точка на ссылке меню ---------- */
  function navLink(route){
    return document.querySelector('a.side__link[data-route="' + route + '"]');
  }
  function refreshMenuIndicator(route, open){
    const link = navLink(route);
    if (!link) return;
    link.classList.toggle('has-win', !!open);
    if (open){
      link.classList.remove('win-dot--pop');
      void link.offsetWidth;
      link.classList.add('win-dot--pop');
    }
  }
  function refreshAllIndicators(){
    document.querySelectorAll('a.side__link.has-win').forEach(l => l.classList.remove('has-win', 'win-dot--pop'));
    registry.forEach((arr, route) => {
      if (winsFor(route).length){
        const link = navLink(route);
        if (link) link.classList.add('has-win');
      }
    });
  }

  /* ---------- Снимок окна для миниатюры ---------- */
  function materializeInputs(root){
    /* «Материализуем» введённые значения в HTML-атрибуты, чтобы innerHTML стал точным снимком */
    root.querySelectorAll('input,textarea,select').forEach(el => {
      if (el.type === 'checkbox' || el.type === 'radio'){
        if (el.checked) el.setAttribute('checked', '');
        else el.removeAttribute('checked');
      } else if (el.tagName === 'SELECT'){
        Array.from(el.options).forEach(o => { if (o.selected) o.setAttribute('selected',''); else o.removeAttribute('selected'); });
      } else {
        el.setAttribute('value', el.value);
      }
    });
  }
  function captureSnapshot(win){
    const body = win.querySelector('.aw-win__body');
    if (!body) return { html: '', scrollTop: 0 };
    materializeInputs(body);
    return { html: body.innerHTML, scrollTop: body.scrollTop };
  }

  /* ---------- Миниатюры + призрак (только свёрнутые окна) ----------
     1) Наведение на пункт меню → компактная миниатюра у меню (с рамкой, крестиком);
     2) Наведение на миниатюру → полноразмерный призрак окна в его реальном положении;
     3) Клик по миниатюре/призраку → разворот окна с анимацией. */
  let prevRoute = null, prevShowTimer = null, prevHideTimer = null, prevGhostTimer = null;
  function clearPrevTimers(){
    clearTimeout(prevShowTimer); clearTimeout(prevHideTimer); clearTimeout(prevGhostTimer);
    prevShowTimer = prevHideTimer = prevGhostTimer = null;
  }
  function destroyPreview(){
    clearPrevTimers();
    document.querySelectorAll('.aw-win-preview, .aw-win-ghost').forEach(p => p.remove());
    prevRoute = null;
  }
  function scheduleHidePreview(){ clearTimeout(prevHideTimer); prevHideTimer = setTimeout(destroyPreview, 220); }

  /* Компактная миниатюра-панель у пункта меню */
  function showPreview(route){
    const link = navLink(route);
    if (!link || !document.body.contains(link)) return;
    document.querySelectorAll('.aw-win-preview, .aw-win-ghost').forEach(p => p.remove());
    prevRoute = route;
    const mins = winsFor(route).filter(r => r.minimized);
    if (!mins.length) return;
    const PW = 150, PH = 84, GAP = 8, CAP = 6;
    const n = Math.min(mins.length, CAP);
    const W = n * PW + (n - 1) * GAP + 12;
    const H = PH + 30;
    const r = link.getBoundingClientRect();
    let left = r.right + 12, top = r.top - 4;
    if (left + W > window.innerWidth) left = Math.max(8, window.innerWidth - W - 8);
    if (left < 8) left = 8;
    top = Math.max(8, Math.min(top, window.innerHeight - H - 8));
    const panel = document.createElement('div');
    panel.className = 'aw-win-preview';
    panel.setAttribute('data-route-prev', route);
    panel.style.cssText = 'left:' + left + 'px;top:' + top + 'px;';
    mins.slice(0, CAP).forEach((rec, i) => {
      const card = document.createElement('div');
      card.className = 'aw-win-prev';
      card.style.width = PW + 'px';
      card.setAttribute('data-idx', i);
      const title = rec.win._title || route;
      card.innerHTML =
        '<div class="aw-win-prev__head"><span class="aw-win-prev__t">' + icon(rec.win._iconName || 'app','ico-sm') + '<b>' + esc(title) + '</b></span>' +
        '<button class="iconbtn aw-win-prev__x" title="Закрыть окно">' + icon('x','ico-sm') + '</button></div>' +
        '<div class="aw-win-prev__body" style="height:' + PH + 'px">' + (rec.html || '') + '</div>';
      const pbody = card.querySelector('.aw-win-prev__body');
      if (rec.scrollTop) pbody.scrollTop = rec.scrollTop;
      /* Наведение на миниатюру → призрак окна в его реальном положении */
      card.addEventListener('mouseenter', () => showGhost(route, rec));
      card.addEventListener('mouseleave', () => hideGhost());
      /* Клик по карточке (кроме крестика) → разворот */
      card.addEventListener('click', e => {
        if (e.target.closest('.aw-win-prev__x')) return;
        const rr = panel.getAttribute('data-route-prev');
        destroyPreview();
        const rec2 = winsFor(rr)[+card.dataset.idx];
        if (rec2) unminimizeWin(rr, rec2.win);
      });
      /* Крестик — закрыть именно это окно */
      card.querySelector('.aw-win-prev__x').addEventListener('click', e => {
        e.stopPropagation();
        const rr = panel.getAttribute('data-route-prev');
        const rec2 = winsFor(rr)[+card.dataset.idx];
        if (rec2) closeWindow(rr, rec2.win);
        if (!winsFor(rr).some(x => x.minimized)) destroyPreview();
        else showPreview(rr);
      });
      panel.appendChild(card);
    });
    if (mins.length > CAP){
      const more = document.createElement('div');
      more.className = 'aw-win-prev aw-win-prev--more';
      more.textContent = '+' + (mins.length - CAP);
      panel.appendChild(more);
    }
    document.body.appendChild(panel);
  }

  /* Полноразмерный призрак окна в его сохранённом положении */
  function showGhost(route, rec){
    clearTimeout(prevGhostTimer);
    prevGhostTimer = setTimeout(() => {
      prevGhostTimer = null;
      document.querySelectorAll('.aw-win-ghost').forEach(g => g.remove());
      if (!rec.html) return;
      const rect = rec.hiddenPos;
      if (!rect) return;
      const ghost = document.createElement('div');
      ghost.className = 'aw-win-ghost';
      ghost.setAttribute('data-route-prev', route);
      ghost.style.cssText =
        'left:' + rect.left + ';top:' + rect.top + ';width:' + (rect.width||'560px') + ';height:' + (rect.height||'440px') + ';';
      ghost.innerHTML = '<div class="aw-win-ghost__body" data-ghost-body style="height:100%">' + rec.html + '</div>';
      const gb = ghost.querySelector('[data-ghost-body]');
      if (rec.scrollTop) gb.scrollTop = rec.scrollTop;
      ghost.addEventListener('click', () => {
        const rr = ghost.getAttribute('data-route-prev');
        destroyPreview();
        const rec2 = winsFor(rr).find(x => x.win === rec.win);
        if (rec2) unminimizeWin(rr, rec2.win);
      });
      document.body.appendChild(ghost);
    }, 90);
  }
  function hideGhost(){
    clearTimeout(prevGhostTimer);
    document.querySelectorAll('.aw-win-ghost').forEach(g => g.remove());
  }

  /* Разворачивание из миниатюры: та же анимация, что при сворачивании, но в обратную сторону */
  function unminimizeWin(route, win){
    const rec = winsFor(route).find(x => x.win === win);
    if (!rec) return;
    win.style.display = 'flex';
    win.style.opacity = '0.001'; /* стартуем невидимым */
    /* Стартовая точка — пункт меню (как «туда» летело при сворачивании) */
    const link = navLink(route);
    const lr = link ? link.getBoundingClientRect() : null;
    if (lr && lr.width > 0){
      win.style.left = (lr.left + lr.width/2 - 17) + 'px';
      win.style.top = (lr.top + lr.height/2 - 13) + 'px';
      win.style.width = '34px'; win.style.height = '26px';
      win.style.minWidth = '0'; win.style.minHeight = '0';
    }
    void win.offsetWidth; /* фиксируем стартовое состояние */
    win.classList.add('aw-win--animating');
    /* Конечное положение — сохранённая позиция окна (тот же размер, не меняем) */
    if (rec.hiddenPos){
      applyRect(win, rec.hiddenPos);
      delete rec.hiddenPos;
    }
    win.style.opacity = '';
    win.style.minWidth = ''; win.style.minHeight = '';
    setTimeout(() => win.classList.remove('aw-win--animating'), 320);
    rec.minimized = false;
    focusWin(win);
    window.dispatchEvent(new CustomEvent('win-restored', { detail: { route } }));
  }

  function restoreWindow(route, win){
    /* win не задан → восстановить последнее свёрнутое, либо сфокусировать верхнее открытое */
    const arr = winsFor(route);
    if (!arr.length) return;
    let rec;
    if (win){
      rec = arr.find(x => x.win === win) || arr[arr.length - 1];
    } else {
      rec = arr.filter(x => x.minimized).pop() || arr[arr.length - 1];
    }
    if (!rec) return;
    const w = rec.win;
    if (rec.hiddenPos){ applyRect(w, rec.hiddenPos); w.style.display = 'flex'; w.style.opacity = ''; delete rec.hiddenPos; }
    else w.style.display = 'flex';
    rec.minimized = false;
    focusWin(w);
    const ev = new CustomEvent('win-restored', { detail: { route } });
    window.dispatchEvent(ev);
  }

  function applyRect(win, rect){
    if (!rect) return;
    ['left','top','width','height'].forEach(k => { if (rect[k] != null) win.style[k] = rect[k]; });
    win.style.minWidth = ''; win.style.minHeight = '';
    win.style.right = ''; win.style.bottom = '';
  }

  function focusWin(win){
    win.style.zIndex = ++winZ;
    ensureLayer().querySelectorAll('.aw-win--active').forEach(w => w.classList.remove('aw-win--active'));
    win.classList.add('aw-win--active');
  }

  function hasWindow(route){
    return winsFor(route).length > 0;
  }

  /* ---------- Плавный разворот на весь экран ---------- */
  function toggleMax(win, btn){
    const prev = win._prevRect;
    const anim = () => { win.classList.add('aw-win--animating'); setTimeout(() => win.classList.remove('aw-win--animating'), 320); };
    if (prev){
      win.style.left = prev.left; win.style.top = prev.top;
      win.style.width = prev.width; win.style.height = prev.height;
      win.style.right = ''; win.style.bottom = '';
      win.style.minWidth = ''; win.style.minHeight = '';
      win._prevRect = null;
      btn.innerHTML = icon('expand','ico-sm');
      btn.title = 'На весь экран';
    } else {
      win._prevRect = { left: win.style.left, top: win.style.top, width: win.style.width, height: win.style.height };
      win.style.left = '0'; win.style.top = '0';
      win.style.width = '100vw'; win.style.height = '100vh';
      win.style.right = ''; win.style.bottom = '';
      win.style.minWidth = '0'; win.style.minHeight = '0';
      btn.innerHTML = icon('shrink','ico-sm');
      btn.title = 'Восстановить';
    }
    anim();
    focusWin(win);
  }

  /* ---------- Минимизация ---------- */
  function minimizeWin(win, route){
    if (win._closing) return;
    const r0 = win.getBoundingClientRect();
    const prevRect = {
      left: win.style.left || r0.left + 'px', top: win.style.top || r0.top + 'px',
      width: win.style.width || r0.width + 'px', height: win.style.height || r0.height + 'px'
    };
    win.classList.add('aw-win--animating');
    void win.offsetWidth; /* фиксируем стартовые размеры до смены стилей */
    const rec = winsFor(route).find(x => x.win === win);
    if (rec) Object.assign(rec, captureSnapshot(win)); /* снимок для миниатюры */
    const link = navLink(route);
    const lr = link ? link.getBoundingClientRect() : null;
    const menuVisible = lr && lr.width > 0 && lr.height > 0;
    let tx, ty, tw, th;
    if (menuVisible){
      tx = lr.left + lr.width / 2; ty = lr.top + lr.height / 2; tw = 34; th = 26;
    } else {
      tx = window.innerWidth - 60; ty = window.innerHeight - 60; tw = 24; th = 20;
    }
    win.style.left = tx - tw / 2 + 'px';
    win.style.top = ty - th / 2 + 'px';
    win.style.width = tw + 'px';
    win.style.height = th + 'px';
    win.style.minWidth = '0'; win.style.minHeight = '0';
    win.style.opacity = '0';
    setTimeout(() => {
      if (win._closing) return;
      win.classList.remove('aw-win--animating');
      win.style.display = 'none';
      win.style.opacity = '';
      win.style.left = prevRect.left; win.style.top = prevRect.top;
      win.style.width = prevRect.width; win.style.height = prevRect.height;
      win.style.minWidth = ''; win.style.minHeight = '';
    }, 300);
    if (rec){
      rec.minimized = true;
      /* Точная позиция/размер окна (до анимации) — для призрака и возврата */
      rec.hiddenPos = { left: prevRect.left, top: prevRect.top, width: prevRect.width, height: prevRect.height };
    }
    refreshMenuIndicator(route, hasWindow(route));
  }

  /* ---------- Создание окна (всегда НОВОЕ, даже если есть окна того же маршрута) ---------- */
  function spawn(route, param){
    const V = window.NAV_VIEWS;
    const NAV_SRC = window.NAV || [];
    if (!V || !V[route] || !me()) return null;
    let title = route;
    let iconName = 'app';
    if (NAV_SRC.length){
      for (const sec of NAV_SRC){
        const it = sec.items.find(i => i.route === route);
        if (it){ title = it.title; iconName = it.icon || 'app'; break; }
      }
    }
    const layer = ensureLayer();
    const win = document.createElement('div');
    win.className = 'aw-win';
    win._iconName = iconName;
    win._title = title;

    const head = document.createElement('div');
    head.className = 'aw-win__head';
    head.innerHTML = '<span class="aw-win__title">' + icon(iconName,'ico-sm') + ' ' + esc(title) + '</span><span class="spacer"></span>' +
      '<button class="iconbtn aw-win__min" title="Свернуть">&minus;</button>' +
      '<button class="iconbtn aw-win__max" title="На весь экран">' + icon('expand','ico-sm') + '</button>' +
      '<button class="iconbtn aw-win__close" title="Закрыть">' + icon('x','ico-sm') + '</button>';
    const body = document.createElement('div');
    body.className = 'aw-win__body';
    win.appendChild(head);
    win.appendChild(body);
    layer.appendChild(win);

    const rec = { win, minimized: false };
    const arr = registry.get(route) || [];
    arr.push(rec);
    registry.set(route, arr);
    refreshMenuIndicator(route, true);

    win.addEventListener('pointerdown', () => focusWin(win));

    try { V[route](body); }
    catch(e){ body.innerHTML = '<div class="empty">' + icon('alert') + '<span>Ошибка: ' + esc(e && e.message || e) + '</span></div>'; }

    /* Позиционирование: сдвигаем новое окно, если по маршруту уже есть окна */
    const total = allWins().length;
    const W_DEF = 'min(560px, calc(100vw - 80px))', H_DEF = 'min(440px, calc(100vh - 90px))';
    const sideW = (document.querySelector('.side') || { getBoundingClientRect: () => ({ right: 0 }) }).getBoundingClientRect().right;
    if (param && typeof param.x === 'number' && typeof param.y === 'number'){
      win.style.width = W_DEF; win.style.height = H_DEF;
      const wDef = 560;
      const minLeft = (param.forceRight ? sideW + 16 : 8);
      let x = param.forceRight ? (sideW + 16) : (param.x - wDef/2);
      x = Math.max(minLeft, Math.min(x, window.innerWidth - Math.min(560, 0.6*window.innerWidth) - 8));
      let y = Math.max(8, Math.min(param.y - 20, window.innerHeight - Math.min(440, 0.7*window.innerHeight) - 8));
      win.style.left = x + 'px'; win.style.top = y + 'px';
    } else {
      const offsetX = Math.max(sideW + 24, window.innerWidth - 560 - (total % 5) * 28 - 16);
      const offsetY = 40 + (total % 5) * 26;
      win.style.left = offsetX + 'px';
      win.style.top = Math.min(offsetY, Math.max(30, window.innerHeight - 470)) + 'px';
      win.style.width = W_DEF; win.style.height = H_DEF;
    }

    /* --- Ресайз по контуру --- */
    const EDGE = 8, CORNER = 18;
    const hitResize = e => {
      const r = win.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const wB = r.width, hB = r.height;
      const nearL = x <= CORNER, nearR = x >= wB - CORNER, nearT = y <= CORNER, nearB = y >= hB - CORNER;
      if (nearL && nearT) return 'nw';
      if (nearR && nearT) return 'ne';
      if (nearL && nearB) return 'sw';
      if (nearR && nearB) return 'se';
      if (nearL && x <= EDGE) return 'w';
      if (nearR && x >= wB - EDGE) return 'e';
      if (nearT && y <= EDGE) return 'n';
      if (nearB && y >= hB - EDGE) return 's';
      return null;
    };
    win.addEventListener('mousemove', e => {
      if (win._resizing) return;
      const dir = hitResize(e);
      win.style.cursor = dir ? ({ nw:'nwse-resize', se:'nwse-resize', ne:'nesw-resize', sw:'nesw-resize', n:'ns-resize', s:'ns-resize', e:'ew-resize', w:'ew-resize' })[dir] : '';
      win._resizeDir = dir;
    });
    win.addEventListener('mouseleave', () => { if (!win._resizing) { win.style.cursor = ''; win._resizeDir = null; } });
    win.addEventListener('mousedown', e => {
      const dir = win._resizeDir;
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation();
      const r = win.getBoundingClientRect();
      active = { kind:'resize', win:win, dir, sx:e.clientX, sy:e.clientY, ox:r.left, oy:r.top, ow:r.width, oh:r.height, moved:false };
      win._resizing = true;
      document.body.classList.add('win-dragging');
      focusWin(win);
    });

    /* --- Кнопки: min / max / close --- */
    const minBtn = win.querySelector('.aw-win__min');
    if (minBtn) minBtn.onclick = () => minimizeWin(win, route);
    const maxBtn = win.querySelector('.aw-win__max');
    if (maxBtn) maxBtn.onclick = () => toggleMax(win, maxBtn);

    function closeWindow(){
      if (win._closing) return;
      win._closing = true;
      win.classList.add('aw-win--closing');
      setTimeout(() => {
        win.remove();
        const arr2 = registry.get(route);
        if (arr2){
          const i = arr2.indexOf(rec);
          if (i >= 0) arr2.splice(i, 1);
          if (!arr2.length) registry.delete(route);
        }
        refreshMenuIndicator(route, hasWindow(route));
      }, 180);
    }
    win.querySelector('.aw-win__close').onclick = closeWindow;
    win._close = closeWindow;
    win._el = win; win._route = route;

    /* --- Drag за заголовок (общий слой) --- */
    head.addEventListener('mousedown', e => {
      if (e.target.closest('.aw-win__close') || e.target.closest('.aw-win__max')) return;
      if (e.target.closest('.aw-win__min')) return;
      e.preventDefault();
      const r = win.getBoundingClientRect();
      active = { kind:'drag', win:win, sx:e.clientX, sy:e.clientY, ox:r.left, oy:r.top, moved:false };
      win.classList.add('aw-win--dragging');
      document.body.classList.add('win-dragging');
      focusWin(win);
    });
    return win;
  }

  /* Публичное закрытие конкретного окна (для крестика миниатюры) */
  function closeWindow(route, win){
    if (win._close) win._close();
  }

  /* ---------- Делегирование: превью по наведению на пункт с точкой ---------- */
  document.addEventListener('mouseover', e => {
    if (e.target.closest('.aw-win-preview') || e.target.closest('.aw-win-ghost')){ clearTimeout(prevHideTimer); prevHideTimer = null; return; }
    const link = e.target.closest('a.side__link.has-win');
    if (!link || !link.dataset.route) return;
    const route = link.dataset.route;
    if (prevRoute === route && document.querySelector('.aw-win-preview')) return;
    clearTimeout(prevShowTimer);
    prevShowTimer = setTimeout(() => {
      prevShowTimer = null;
      const lt = document.querySelector('a.side__link[data-route="' + route + '"]');
      if (lt && lt.isConnected && winsFor(route).some(r => r.minimized)) showPreview(route);
    }, 180);
  });
  document.addEventListener('mouseout', e => {
    const fromLink = e.target.closest('a.side__link');
    const fromPrev = e.target.closest('.aw-win-preview');
    const fromGhost = e.target.closest('.aw-win-ghost');
    if (!fromLink && !fromPrev && !fromGhost) return;
    const to = e.relatedTarget;
    if (to && to.closest && (to.closest('.aw-win-preview') || to.closest('.aw-win-ghost') || to.closest('a.side__link'))) return;
    hideGhost();
    scheduleHidePreview();
  });
  document.addEventListener('click', e => {
    if (e.target.closest('.aw-win-preview') || e.target.closest('.aw-win-ghost')) return;
    destroyPreview();
  });

  /* ---------- Общие слушатели драга/ресайза ---------- */
  document.addEventListener('mousemove', e => {
    if (!active) return;
    const dx = e.clientX - active.sx, dy = e.clientY - active.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) active.moved = true;
    if (!active.moved) return;
    const win = active.win;
    if (active.kind === 'drag'){
      let x = active.ox + dx, y = active.oy + dy;
      const w = win.offsetWidth, h = win.offsetHeight;
      x = Math.max(-w + 100, Math.min(x, window.innerWidth - 100));
      y = Math.max(0, Math.min(y, window.innerHeight - 40));
      win.style.left = x + 'px';
      win.style.top = y + 'px';
      let snap = null;
      if (x < 26) snap = 'left';
      else if (x + w > window.innerWidth - 26) snap = 'right';
      else if (y < 0) snap = 'top';
      let g = document.querySelector('.aw-snap-guide');
      if (snap){
        if (!g){ g = document.createElement('div'); g.className = 'aw-snap-guide'; document.body.appendChild(g); }
        g.style.cssText = (snap === 'left' ? 'left:0;top:0;width:50vw;height:100vh' : snap === 'right' ? 'right:0;top:0;width:50vw;height:100vh' : 'left:0;top:0;width:100vw;height:100vh') + ';display:block';
      } else if (g){ g.style.display = 'none'; }
    } else if (active.kind === 'resize'){
      const d = active.dir;
      let L = active.ox, T = active.oy, W = active.ow, H = active.oh;
      if (d.includes('e')) W = Math.max(300, active.ow + dx);
      if (d.includes('s')) H = Math.max(200, active.oh + dy);
      if (d.includes('w')){ const nl = Math.min(active.ox + dx, active.ox + active.ow - 300); W = active.ow + (active.ox - nl); L = nl; }
      if (d.includes('n')){ const nt = Math.min(active.oy + dy, active.oy + active.oh - 200); H = active.oh + (active.oy - nt); T = nt; }
      win.style.left = L + 'px'; win.style.top = T + 'px';
      win.style.width = W + 'px'; win.style.height = H + 'px';
      win.style.minWidth = '0'; win.style.minHeight = '0';
    }
  });
  document.addEventListener('mouseup', () => {
    if (active && active.moved && active.kind === 'drag'){
      const win = active.win;
      const r = win.getBoundingClientRect();
      const w = win.offsetWidth, h = win.offsetHeight;
      const x = r.left, y = r.top;
      const applySnap = (left, top, width, height) => {
        win.style.left = left; win.style.top = top;
        win.style.width = width; win.style.height = height;
        win.style.minWidth = '0'; win.style.minHeight = '0';
      };
      if (x < 30) applySnap('0','0','50vw','100vh');
      else if (x + w > window.innerWidth - 30) applySnap('auto','0','50vw','100vh');
      else if (y < 0) applySnap('0','0','100vw','100vh');
      const g = document.querySelector('.aw-snap-guide');
      if (g) g.style.display = 'none';
      try {
        const store = JSON.parse(sessionStorage.getItem('aw_wins') || '{"wins":[]}');
        const arr = store.wins.filter(x => x.route !== win._route);
        arr.push({ route: win._route, left: win.style.left || '36px', top: win.style.top || '36px', width: win.style.width, height: win.style.height, z: win.style.zIndex || 3010 });
        sessionStorage.setItem('aw_wins', JSON.stringify({ wins: arr.slice(-8) }));
      } catch(e2){}
    }
    if (active){
      if (active.kind === 'resize' && active.win) active.win._resizing = false;
      active.win.classList.remove('aw-win--dragging');
      document.body.classList.remove('win-dragging');
      active = null;
    }
  });

  function hasOpenWins(){
    return allWins().length > 0;
  }

  function closeAll(){
    const count = allWins().length;
    Array.from(registry.keys()).forEach(route => {
      winsFor(route).forEach(rec => { if (!rec.win._closing) rec.win._close && rec.win._close(); });
      registry.delete(route);
      refreshMenuIndicator(route, false);
    });
    toast('Все окна закрыты', 'ok');
    return count;
  }

  return { spawn, refreshAllIndicators, hasWindow, hasOpenWins, minimizeWin, restoreWindow, closeAll, closeWindow, showPreview };
})();

/* Браузер: const верхнего уровня не создаёт window.Windows — вешаем явно */
window.Windows = Windows;