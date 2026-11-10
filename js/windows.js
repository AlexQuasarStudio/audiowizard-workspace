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

  /* Сколько длится закрытие окна (180 мс) + гашение точки в меню (200 мс).
     Пока идёт этот интервал, раздел перерисовывать нельзя: render() заменяет
     меню и обрывает анимацию точки. */
  const CLOSE_FADE_MS = 380;
  const closingUntil = new Map();

  const winsFor = route => (registry.get(route) || []).filter(r => !r.win._closing);
  const allWins = () => Array.from(registry.values()).flat().filter(r => !r.win._closing);

  /* ---------- Окна переживают перезагрузку: сохранение в localStorage ---------- */
  const WS_KEY = 'aw_wins_state';
  /* Снимок тела окна: innerHTML не хранит введённые значения, поэтому
     переносим их в атрибуты/текст — после перезагрузки форма выглядит так же. */
  function serializeBody(win){
    const body = win.querySelector('.aw-win__body');
    if (!body) return '';
    const clone = body.cloneNode(true);
    clone.querySelectorAll('input,textarea,select').forEach(el => {
      if (el.tagName === 'SELECT'){
        [...el.options].forEach(o => {
          if (o.value === el.value) o.setAttribute('selected', '');
          else o.removeAttribute('selected');
        });
      } else if (el.type === 'checkbox' || el.type === 'radio'){
        if (el.checked) el.setAttribute('checked', '');
        else el.removeAttribute('checked');
      } else if (el.tagName === 'TEXTAREA'){
        el.textContent = el.value;
      } else {
        el.setAttribute('value', el.value);
      }
    });
    return clone.innerHTML;
  }
  function persistWins(){
    const arr = allWins().map(r => {
      const s = r.win.style;
      if (!r.win._route) return null;
      /* Свёрнутое окно в этот момент сжато в 34×26 у пункта меню — сохраняем
         его реальную геометрию из hiddenPos, иначе после перезагрузки оно
         «вспоминает» размер иконки. */
      const hp = (r.minimized && r.hiddenPos) ? r.hiddenPos : null;
      return { route: r.win._route,
        left: (hp ? hp.left : s.left) || '',
        top: (hp ? hp.top : s.top) || '',
        width: (hp ? hp.width : s.width) || '',
        height: (hp ? hp.height : s.height) || '',
        minimized: !!r.minimized,
        corner: r.win.__cornerPos || null,
        cornerPrev: r.win.__cornerPrev || null,
        cornerMin: r.win.classList.contains('aw-win--corner-min'),
        max: r.win._prevRect ? { left: r.win._prevRect.left, top: r.win._prevRect.top, width: r.win._prevRect.width, height: r.win._prevRect.height } : null,
        custom: r.win._modal ? { title: r.win._title || '', icon: r.win._iconName || 'app', html: serializeBody(r.win),
          footer: (r.win.querySelector('.aw-win__foot') || {}).innerHTML || '', key: r.win._persistKey || '' } : null };
    }).filter(Boolean);
    try { localStorage.setItem(WS_KEY, JSON.stringify(arr.slice(-12))); } catch(e){}
  }
  window.__persistWins = persistWins;
  function restoreSavedWins(){
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(WS_KEY) || '[]'); } catch(e){}
    if (!Array.isArray(arr)) return;
    arr.forEach(s => {
      if (!s || !s.route) return;
      /* Модальные окна восстанавливаем из снимка: заголовок, тело, футер и
         введённые значения. Для известных окон (калькулятор) вызываем
         живой restorer, чтобы обработчики снова работали. */
      if (s.custom && s.custom.html){
        const restorer = s.custom.key && window.__modalRestorers && window.__modalRestorers[s.custom.key];
        if (restorer){
          try { restorer(); } catch(e){}
          return;
        }
        try {
          const win = spawnCustom({ title:s.custom.title, icon:s.custom.icon, html:s.custom.html, route:s.route, _restore:true });
          if (!win) return;
          if (s.custom.footer){
            const f = document.createElement('div');
            f.className = 'aw-win__foot';
            f.innerHTML = s.custom.footer;
            f.querySelectorAll('[data-x]').forEach(x => x.addEventListener('click', () => win._close && win._close()));
            win.appendChild(f);
          }
          if (s.left) win.style.left = s.left;
          if (s.top) win.style.top = s.top;
          if (s.width) win.style.width = s.width;
          if (s.height) win.style.height = s.height;
          win._modal = true;
          win._persistKey = s.custom.key || '';
          if (s.minimized){
            win.style.display = 'none';
            const rec = winsFor(s.route).find(x => x.win === win);
            if (rec) rec.minimized = true;
          }
          return;
        } catch(e){}
      }
      if (!window.NAV_VIEWS || !window.NAV_VIEWS[s.route]) return;
      try {
        const win = spawn(s.route, null, { _restore:true });
        if (win){
          /* Применяем каждое поле отдельно: у окна может быть размер без
             позиции (left пустой), и тогда размер не должен теряться. */
          if (s.left) win.style.left = s.left;
          if (s.top) win.style.top = s.top;
          if (s.width) win.style.width = s.width;
          if (s.height) win.style.height = s.height;
          if (s.right) win.style.right = s.right;
          if (s.corner){ win.__cornerPos = s.corner; win.classList.add('aw-win--corner'); }
          if (s.cornerMin){
            win.classList.add('aw-win--corner-min');
            const mb2 = win.querySelector('.aw-win__min');
            if (mb2) mb2.title = 'Развернуть окно раздела';
          }
          if (s.cornerPrev) win.__cornerPrev = s.cornerPrev;
          if (s.max){
            win._prevRect = { left: s.max.left, top: s.max.top, width: s.max.width, height: s.max.height };
            setMaxState(win, true);
          }
        }
        /* Свёрнутое окно остаётся свёрнутым после обновления: прячем его
           сразу и помечаем минимизированным (миниатюра через меню-точку). */
        if (s.minimized){
          win.style.display = 'none';
          const rec = winsFor(s.route).find(x => x.win === win);
          if (rec){
            rec.minimized = true;
            if (s.left) rec.hiddenPos = { left: s.left, top: s.top, width: s.width, height: s.height };
            Object.assign(rec, captureSnapshot(win));
          }
        }
      } catch(e){}
    });
    /* Пометки minimized проставились уже ПОСЛЕ persistWins() внутри spawn —
       фиксируем их снова, иначе localStorage останется со старым minimized:false
       и следующая перезагрузка покажет свёрнутое окно снова. */
    persistWins();
  }

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
    if (open) link.classList.remove('win-dot--pop'); /* без пульсации при открытии окна */
  }
  /* Отмечаем маршрут закрывающегося окна. closeAll() сразу чистит реестр,
     поэтому ориентироваться только на registry нельзя. */
  function markClosing(route){
    closingUntil.set(route, Date.now() + CLOSE_FADE_MS);
    setTimeout(() => {
      const until = closingUntil.get(route) || 0;
      if (until <= Date.now()) closingUntil.delete(route);
    }, CLOSE_FADE_MS + 20);
  }
  /* Окно этого маршрута ещё закрывается, точка в меню ещё гаснет. */
  function isClosing(route){
    const until = closingUntil.get(route) || 0;
    if (until <= Date.now()){ closingUntil.delete(route); return false; }
    return true;
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
    if (!body) return { html: '', scrollTop: 0, w: 900, h: 600 };
    materializeInputs(body);
    /* Размер окна фиксируем в момент снимка: у свёрнутого окна offsetWidth = 0,
       и миниатюра получала безумный масштаб. */
    const w = Math.round(win.offsetWidth || parseFloat(win.style.width) || 900);
    const h = Math.round(win.offsetHeight || parseFloat(win.style.height) || 600);
    return { html: body.innerHTML, scrollTop: body.scrollTop, w, h };
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
  function destroyPreview(immediate){
    clearPrevTimers();
    document.querySelectorAll('.aw-win-preview').forEach(p => {
      /* Мгновенное remove() выглядело как резкое пропадание миниатюры:
         гасим панель анимацией (popOut), затем убираем из DOM. */
      if (immediate || p.__out){ p.remove(); return; }
      p.__out = true;
      p.classList.add('aw-win-preview--closing');
      setTimeout(() => { if (p.isConnected) p.remove(); }, 180);
    });
    document.querySelectorAll('.aw-win-ghost').forEach(g => removeGhost(g));
    prevRoute = null;
  }
  function scheduleHidePreview(){ clearTimeout(prevHideTimer); prevHideTimer = setTimeout(destroyPreview, 220); }

  /* Компактная миниатюра-панель у пункта меню (вертикальный ряд) */
  function showPreview(route){
    const link = navLink(route);
    if (!link || !document.body.contains(link)) return;
    document.querySelectorAll('.aw-win-preview, .aw-win-ghost').forEach(p => p.remove());
    prevRoute = route;
    const mins = winsFor(route).filter(r => r.minimized);
    if (!mins.length) return;
    const PW = 150, PH = 74, GAP = 8, CAP = 6;
    const n = Math.min(mins.length, CAP);
    const r = link.getBoundingClientRect();
    /* Вертикальный ряд: карточки вниз от пункта меню */
    const W = PW + 12;
    const H = n * (PH + 26) + (n - 1) * GAP + 8;
    let left = r.right + 10, top = r.top;
    if (left + W > window.innerWidth) left = Math.max(8, window.innerWidth - W - 8);
    if (left < 8) left = 8;
    top = Math.max(8, Math.min(top, window.innerHeight - H - 8));
    const panel = document.createElement('div');
    panel.className = 'aw-win-preview aw-win-preview--vertical';
    panel.setAttribute('data-route-prev', route);
    panel.style.cssText = 'left:' + left + 'px;top:' + top + 'px;';
    mins.slice(0, CAP).forEach((rec, i) => {
      const card = document.createElement('div');
      card.className = 'aw-win-prev';
      card.style.width = PW + 'px';
      card.setAttribute('data-idx', i);
      const title = rec.win._title || route;
      /* Миниатюра — точный слепок окна: его содержимое в натуральную величину,
         ужатое масштабом целиком (contain), без «увеличенного фрагмента». */
      const cw = Math.max(1, rec.w || (rec.win ? rec.win.offsetWidth : 0) || 900);
      const ch = Math.max(1, rec.h || (rec.win ? rec.win.offsetHeight : 0) || 600);
      /* Заполняем миниатюру целиком: масштаб по большей стороне (cover),
         лишнее аккуратно обрезается рамкой карточки. */
      const k = Math.max(PW / cw, PH / ch);
      card.innerHTML =
        '<div class="aw-win-prev__head"><span class="aw-win-prev__t">' + icon(rec.win._iconName || 'app','ico-sm') + '<b>' + esc(title) + '</b></span>' +
        '<button class="iconbtn aw-win-prev__x" title="Закрыть окно">' + icon('x','ico-sm') + '</button></div>' +
        '<div class="aw-win-prev__body" style="height:' + PH + 'px">' +
          '<div class="aw-win-prev__scale" style="position:absolute;left:0;top:0;width:' + cw + 'px;height:' + ch + 'px;transform-origin:0 0;transform:scale(' + k.toFixed(4) + ')">' + (rec.html || '') + '</div>' +
        '</div>';
      const pbody = card.querySelector('.aw-win-prev__body');
      /* Скролл применяем после раскладки контента: иначе сразу после
         innerHTML scrollTop ещё 0 (высота не рассчитана). */
      if (rec.scrollTop){
        requestAnimationFrame(() => requestAnimationFrame(() => { if (pbody.isConnected) pbody.scrollTop = rec.scrollTop; }));
      }
      /* Наведение на миниатюру → призрак окна в его реальном положении */
      card.addEventListener('mouseenter', () => showGhost(route, rec));
      card.addEventListener('mouseleave', () => hideGhost());
      /* Клик по карточке (кроме крестика) → разворот */
      card.addEventListener('click', e => {
        if (e.target.closest('.aw-win-prev__x')) return;
        /* Поиск по индексу в полном списке windows был багом при нескольких
           окнах (data-idx считался среди только свёрнутых): используем
           замкнутый rec — это ровно то окно, чью миниатюру нажали. */
        const rr = panel.getAttribute('data-route-prev');
        destroyPreview();
        unminimizeWin(rr, rec.win);
      });
      /* Крестик — закрыть именно это окно */
      card.querySelector('.aw-win-prev__x').addEventListener('click', e => {
        e.stopPropagation();
        const rr = panel.getAttribute('data-route-prev');
        /* Карточка гаснет плавно, панель перестраиваем после анимации */
        card.classList.add('aw-win-prev--closing');
        closeWindow(rr, rec.win);
        setTimeout(() => {
          if (!winsFor(rr).some(x => x.minimized)) destroyPreview();
          else showPreview(rr);
        }, 165);
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

  /* Плавное исчезновение призрака окна: fade, как ghostIn, но в обратную сторону */
  function removeGhost(el){
    if (!el) return;
    if (el.__ghostRemoving) return;
    el.__ghostRemoving = true;
    el.classList.add('aw-win-ghost--out');
    setTimeout(() => { if (el.isConnected) el.remove(); }, 150);
  }

  /* Полноразмерный призрак окна в его сохранённом положении */
  function showGhost(route, rec){
    clearTimeout(prevGhostTimer);
    prevGhostTimer = setTimeout(() => {
      prevGhostTimer = null;
      document.querySelectorAll('.aw-win-ghost').forEach(g => removeGhost(g));
      if (!rec.html) return;
      const rect = rec.hiddenPos;
      if (!rect) return;
      const ghost = document.createElement('div');
      ghost.className = 'aw-win-ghost';
      ghost.setAttribute('data-route-prev', route);
      ghost.style.cssText =
        'left:' + rect.left + ';top:' + rect.top + ';width:' + (rect.width||'560px') + ';height:' + (rect.height||'440px') + ';';
      ghost.innerHTML = '<div class="aw-win-ghost__body" data-ghost-body style="height:100%"><div class="aw-win-ghost__pad">' + rec.html + '</div></div>';
      const gb = ghost.querySelector('[data-ghost-body]');
      if (rec.scrollTop){
        requestAnimationFrame(() => requestAnimationFrame(() => { if (gb.isConnected) gb.scrollTop = rec.scrollTop; }));
      }
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
    document.querySelectorAll('.aw-win-ghost').forEach(g => removeGhost(g));
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
    persistWins();
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
    persistWins();
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

  /* Иконка разворота меняется классом: expand и shrink лежат стопкой,
     поэтому переход идёт плавно, без мгновенной подмены разметки. */
  function setMaxState(win, maxed){
    win.classList.toggle('aw-win--maxed', !!maxed);
    const mb = win.querySelector('.aw-win__max');
    if (mb) mb.title = maxed ? 'Восстановить' : 'На весь экран';
  }

  /* ---------- Плавный разворот на весь экран ---------- */
  function toggleMax(win, btn){
    const prev = win._prevRect;
    win.__inSplit = null; /* максимум/восстановление — окно вне сплита */
    const anim = () => { win.classList.add('aw-win--animating'); setTimeout(() => win.classList.remove('aw-win--animating'), 320); };
    if (prev){
      win.style.left = prev.left; win.style.top = prev.top;
      win.style.width = prev.width; win.style.height = prev.height;
      win.style.right = ''; win.style.bottom = '';
      win.style.minWidth = ''; win.style.minHeight = '';
      win._prevRect = null;
      setMaxState(win, false);
    } else {
      win._prevRect = { left: win.style.left, top: win.style.top, width: win.style.width, height: win.style.height };
      win.style.left = '0'; win.style.top = '0';
      win.style.width = '100vw'; win.style.height = '100vh';
      win.style.right = ''; win.style.bottom = '';
      win.style.minWidth = '0'; win.style.minHeight = '0';
      setMaxState(win, true);
    }
    anim();
    focusWin(win);
    try { persistWins(); } catch(e){}
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
    persistWins(); /* сохраняем свёрнутость — после обновления окно остаётся свёрнутым */
    refreshMenuIndicator(route, hasWindow(route));
  }

  /* ---------- Создание окна (всегда НОВОЕ, даже если есть окна того же маршрута) ---------- */
  const MAX_WINS = 12; /* лимит окон: неактивные не держат blur, 12 тянет */
  function spawn(route, param, custom){
    const V = window.NAV_VIEWS;
    const NAV_SRC = window.NAV || [];
    const customHtml = custom && typeof custom.html === 'string' ? custom.html : '';
    if (!me()) return null;
    if (!customHtml && (!V || !V[route])) return null;
    /* Ограничение числа окон: превышение — предупреждаем и не открываем */
    if (allWins().length >= MAX_WINS){
      if (typeof toast === 'function') toast(`Открыто максимум окон (${MAX_WINS}). Закройте одно, чтобы открыть новое`, 'warn');
      return null;
    }
    let title = route;
    let iconName = 'app';
    if (NAV_SRC.length){
      for (const sec of NAV_SRC){
        const it = sec.items.find(i => i.route === route);
        if (it){ title = it.title; iconName = it.icon || 'app'; break; }
      }
    }
    if (custom && custom.title) title = custom.title;
    /* Иконка: явная (не дефолтная 'app') — из custom; иначе из NAV по route;
       если и там нет — остаётся 'app'. Так окна виджетов сохраняют иконку
       своего раздела вместо «прямоугольника». */
    if (custom && custom.icon && custom.icon !== 'app'){
      iconName = custom.icon;
    } else if (!customHtml && route){
      for (const sec of NAV_SRC){
        const it = sec.items.find(i => i.route === route);
        if (it && it.icon){ iconName = it.icon; break; }
      }
    }
    const layer = ensureLayer();
    const win = document.createElement('div');
    win.className = 'aw-win';
    win._iconName = iconName;
    win._title = title;

    const head = document.createElement('div');
    head.className = 'aw-win__head';
    head.innerHTML = '<span class="aw-win__title aw-win__title--sw" role="button" title="Сменить раздел">' + icon(iconName,'ico-sm') + ' <b>' + esc(title) + '</b>' + icon('chev-d','ico-sm') + '</span><span class="spacer"></span>' +
      '<button class="iconbtn aw-win__min" title="Свернуть окно раздела"><span class="win-min-ico win-min-ico--dash">&minus;</span><span class="win-min-ico win-min-ico--down">' + icon('chev-d','ico-sm') + '</span><span class="win-min-ico win-min-ico--up">' + icon('chev-u','ico-sm') + '</span></button>' +
      '<button class="iconbtn aw-win__max" title="Развернуть окно раздела"><span class="win-max-ico win-max-ico--expand">' + icon('expand','ico-sm') + '</span><span class="win-max-ico win-max-ico--shrink">' + icon('shrink','ico-sm') + '</span></button>' +
      '<button class="iconbtn aw-win__close" title="Закрыть окно раздела — приложение останется">' + icon('x','ico-sm') + '</button>';
    const body = document.createElement('div');
    body.className = 'aw-win__body';
    win.appendChild(head);
    win.appendChild(body);
    /* Невидимые углы-хендлы ресайза: из-за border-radius сами углы окна
       не ловят события (виден фон под скруглением), и ресайз работал
       только вдоль сплит-стыков по краям. Уголки перехватывают дир. */
    ['nw','ne','sw','se'].forEach(dir => {
      const c = document.createElement('div');
      c.className = 'aw-win__corner';
      c.dataset.dir = dir;
      win.appendChild(c);
    });
    layer.appendChild(win);

    /* Адаптация окна чатов под размер окна: при узкой ширине список чатов
       скрывается, остаётся только лента (класс ставится при спавне и ресайзе). */
    const applyChatNarrow = () => {
      if (route === 'chats' || win.querySelector('.chats-layout')){
        win.classList.toggle('aw-win--narrow-chats', win.offsetWidth < 520);
        /* В широком окне режим списка не нужен — показываем чат. */
        if (win.offsetWidth >= 520){
          win.classList.remove('aw-win--chat-list', 'aw-win--pane-out');
        }
      }
      /* После смены ширины шапка чата может переноситься и становиться выше —
         пересчитываем отступ ленты, иначе первое сообщение уходит под шапку. */
      requestAnimationFrame(() => {
        const v = win.querySelector('.view--chats');
        try { v && v.__syncChatPads && v.__syncChatPads(); } catch(e){}
      });
    };
    win._chatNarrow = applyChatNarrow;
    if (typeof ResizeObserver === 'function'){
      const ro = new ResizeObserver(() => applyChatNarrow());
      ro.observe(win);
      win._chatNarrowRO = ro;
    } else {
      window.addEventListener('resize', applyChatNarrow);
    }
    requestAnimationFrame(applyChatNarrow);

    const rec = { win, minimized: false };
    const arr = registry.get(route) || [];
    arr.push(rec);
    registry.set(route, arr);
    refreshMenuIndicator(route, true);

    win.addEventListener('pointerdown', () => focusWin(win));

    if (customHtml) body.innerHTML = customHtml;
    else {
      try { V[route](body); }
      catch(e){ body.innerHTML = '<div class="empty">' + icon('alert') + '<span>Ошибка: ' + esc(e && e.message || e) + '</span></div>'; }
    }

    /* Позиционирование: сдвигаем новое окно, если по маршруту уже есть окна */
    const total = allWins().length;
    const W_DEF = 'min(560px, calc(100vw - 80px))', H_DEF = 'min(440px, calc(100vh - 90px))';
    const sideW = (document.querySelector('.side') || { getBoundingClientRect: () => ({ right: 0 }) }).getBoundingClientRect().right;
    const snapRect = (param && param.snap) ? snapRectFor(param.snap) : null;
    if (snapRect){
      /* Дроп пункта меню в подсказку сплита: окно сразу занимает половину */
      win.style.left = snapRect.left + 'px'; win.style.top = snapRect.top + 'px';
      win.style.width = snapRect.width + 'px'; win.style.height = snapRect.height + 'px';
    } else if (param && typeof param.x === 'number' && typeof param.y === 'number'){
      win.style.width = W_DEF; win.style.height = H_DEF;
      const wDef = 560;
      const minLeft = (param.forceRight ? sideW + 16 : 8);
      /* Дроп во вьюпорт: окно встаёт по месту курсора (центрируется по x),
         но не левее правого края меню. Раньше forceRight прижимал окно всегда
         к краю меню — «окна появлялись слева», куда бы ни бросили. */
      let x = (param.forceRight ? Math.max(sideW + 16, param.x - wDef/2) : (param.x - wDef/2));
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
    /* Уголки: постоянный курсор и запуск ресайза по своему направлению */
    const CURSORS = { nw:'nwse-resize', se:'nwse-resize', ne:'nesw-resize', sw:'nesw-resize' };
    win.querySelectorAll('.aw-win__corner').forEach(c => {
      const dir = c.dataset.dir;
      c.addEventListener('mousemove', e => { e.stopPropagation(); win.style.cursor = CURSORS[dir]; win._resizeDir = dir; });
      c.addEventListener('mousedown', e => {
        if (active) return;
        e.preventDefault(); e.stopPropagation();
        const r = win.getBoundingClientRect();
        active = { kind:'resize', win, dir, sx:e.clientX, sy:e.clientY, ox:r.left, oy:r.top, ow:r.width, oh:r.height, moved:false };
        win._resizing = true;
        document.body.classList.add('win-dragging');
        focusWin(win);
      });
    });
    win.addEventListener('mouseleave', () => { if (!win._resizing) { win.style.cursor = ''; win._resizeDir = null; } });
    win.addEventListener('mousedown', e => {
      if (active) return;
      /* Во время активного ресайза/драга — не начинать новый; чистый нейтральный
         клик по соседу не должен отменять уже идущий ресайз стыка */
      if (active) return;
      const dir = win._resizeDir;
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation();
      /* Pointer capture: ресайз не теряет события при выходе курсора на соседнее окно */
      if (win.setPointerCapture && e.pointerId) try { win.setPointerCapture(e.pointerId); } catch(err){}
      const r = win.getBoundingClientRect();
      active = { kind:'resize', win:win, dir, sx:e.clientX, sy:e.clientY, ox:r.left, oy:r.top, ow:r.width, oh:r.height, moved:false };
      win._resizing = true;
      document.body.classList.add('win-dragging');
      focusWin(win);
      /* Старт ресайза: фиксируем исходные стыки. Сосед «прилипает» только если
         он примыкает именно к той стороне, которую тянут (зазор ≤ 8px).
         ВАЖНО: зазор считаем раздельно для каждой стороны (__origGapE/W):
         раньше брался min() по обоим краям, поэтому окно, стоящее вплотную
         с ПРОТИВОПОЛОЖНОЙ стороны (не в сплите), тоже «прилипало». */
      const _r0 = win.getBoundingClientRect();
      /* Зазор фиксируем только между окнами, реально стоящими в сплите */
      if (win.__inSplit) allWins().forEach(rec => {
        const o = rec.win;
        if (o === win || !o.__inSplit) return;
        const or = o.getBoundingClientRect();
        const vertOverlap = (or.top <= _r0.bottom - 10) && (or.bottom >= _r0.top + 10);
        const horOverlap = (or.left <= _r0.right - 10) && (_r0.left <= or.right - 10);
        if (dir.includes('e')){
          if (!vertOverlap) return;
          const gapE = or.left - _r0.right;             /* сосед справа */
          if (or.left >= _r0.left && gapE >= -2 && gapE <= 8) o.__origGapE = Math.max(0, gapE);
        } else if (dir.includes('w')){
          if (!vertOverlap) return;
          const gapW = _r0.left - or.right;             /* сосед слева */
          if (or.right <= _r0.right && gapW >= -2 && gapW <= 8) o.__origGapW = Math.max(0, gapW);
        } else if (dir.includes('n')){
          /* сосед ВЫШЕ: его низ к нашим верху */
          if (!horOverlap) return;
          const gapN = or.bottom - _r0.top;
          if (or.top <= _r0.top && gapN >= -2 && gapN <= 8) o.__origGapN = Math.max(0, gapN);
        } else if (dir.includes('s')){
          /* сосед НИЖЕ: его верх к нашему низу */
          if (!horOverlap) return;
          const gapS = _r0.bottom - or.top;
          if (or.top >= _r0.top && gapS >= -2 && gapS <= 8) o.__origGapS = Math.max(0, gapS);
        }
      });
    });

    /* --- Кнопки: min / max / close --- */
    const minBtn = win.querySelector('.aw-win__min');
    if (minBtn) minBtn.onclick = () => {
      if (win.classList.contains('aw-win--corner')){ toggleCornerCollapse(win); return; }
      minimizeWin(win, win._route || route);
    };
    const maxBtn = win.querySelector('.aw-win__max');
    if (maxBtn) maxBtn.onclick = () => toggleMax(win, maxBtn);

    /* Правая кнопка по шапке окна — контекстное меню со сплитом и позицией */
    /* Правая кнопка по шапке окна — контекстное меню со сплитом и позицией.
       Геометрия считается в ПИКСЕЛЯХ (left/top/width/height) и никогда не
       переключает left↔auto/right: CSS не умеет анимировать auto, и окно
       «телепортировалось» при переносе из левого сплита в правый и обратно. */
    const splitWin = (pos) => {
      /* Перенос из уголка через меню: сначала честно выходим из уголка,
         иначе иконки шапки живут в старом режиме. */
      clearCornerState(win);
      if (pos === 'max'){ toggleMax(win, maxBtn); return; }
      const vw = window.innerWidth, vh = window.innerHeight;
      const halfW = Math.round(vw / 2), halfH = Math.round(vh / 2);
      let L, T, W, H;
      if (pos === 'center'){
        W = Math.min(600, Math.round(vw * 0.7));
        H = Math.min(540, Math.round(vh * 0.75));
        L = Math.round((vw - W) / 2); T = Math.round((vh - H) / 2);
      } else if (pos === 'left'){ L = 0; T = 0; W = halfW; H = vh; }
      else if (pos === 'right'){ L = halfW; T = 0; W = vw - halfW; H = vh; }
      else if (pos === 'tl'){ L = 0; T = 0; W = halfW; H = halfH; }
      else if (pos === 'tr'){ L = halfW; T = 0; W = vw - halfW; H = halfH; }
      else if (pos === 'bl'){ L = 0; T = halfH; W = halfW; H = vh - halfH; }
      else if (pos === 'br'){ L = halfW; T = halfH; W = vw - halfW; H = vh - halfH; }
      else return;
      /* Всё в px + переход — движение имитирует быстрый драг на всём пути. */
      win.classList.add('aw-win--animating');
      win.style.left = L + 'px';
      win.style.top = T + 'px';
      win.style.width = W + 'px';
      win.style.height = H + 'px';
      win.style.right = '';
      win.style.bottom = '';
      win.style.transform = '';
      win.style.minWidth = '0';
      win.style.minHeight = '0';
      /* Сплит — явное состояние: только окна, поставленные в сплит через меню,
         образуют стык и совместный ресайз. Обычные окна, случайно оказавшиеся
         рядом, в сплит не попадают. Центр — снимает сплит. */
      win.__inSplit = (pos === 'center') ? null : pos;
      setTimeout(() => { win.classList.remove('aw-win--animating'); syncSplitClasses(); }, 320);
      focusWin(win);
      syncSplitClasses();
    };
    head.addEventListener('contextmenu', e => {
      /* Если заголовок только что перетаскивали (ЛКМ), показ контекстного
         меню по ПКМ сразу после драга подавляем — иначе меню выскакивает
         поверх окна в момент отпускания. */
      if (win.__lastDragEnd && Date.now() - win.__lastDragEnd < 500) { e.preventDefault(); return; }
      e.preventDefault();
      if (typeof contextMenu !== 'function') return;
      const menuItems = [
        { label:'Слева (½ экрана)', icon:'split-left', onClick:()=>splitWin('left') },
        { label:'Справа (½ экрана)', icon:'split-right', onClick:()=>splitWin('right') },
        { label:'Сверху', icon:'split-quarter', onClick:()=>splitWin('tl') },
        '-',
        { label:'По центру', icon:'center', onClick:()=>splitWin('center') },
        { label:'На весь экран', icon:'expand', onClick:()=>splitWin('max') },
      ];
      if (isChatWin(win)){
        menuItems.push('-', win.classList.contains('aw-win--corner')
          ? { label:'Выйти из уголка', icon:'shrink', onClick:()=>exitCorner(win) }
          : { label:'В уголок', icon:'corner', onClick:()=>enterCorner(win, win.__cornerPos || 'br') });
      }
      /* Анкор — сама шапка: плашка у нижнего уголка раскрывается над ней,
         а не над точкой клика, и не наезжает на текст шапки. */
      contextMenu(e.clientX, e.clientY, menuItems, head);
    });

    /* Переключение раздела прямо в шапке окна: содержимое меняется,
       запись переезжает в реестр нового раздела (точка в меню следует за ним). */
    const switchBtn = win.querySelector('.aw-win__title--sw');
    if (switchBtn){
      switchBtn.onclick = (ev) => {
        if (win.classList.contains('aw-win--corner')) return;
        if (typeof showDropdown !== 'function') return;
        const items = [];
        /* Разделители — на границах секций, как в боковом меню. */
        let sectionCount = 0;
        for (const sec of NAV_SRC){
          const secItems = sec.items
            .filter(it => V && V[it.route])
            .map(it => ({ label: it.title, icon: it.icon || 'app', onClick: () => switchTo(it.route) }));
          if (!secItems.length) continue;
          if (sectionCount++) items.push('-');
          items.push(...secItems);
        }
        if (!items.length) return;
        showDropdown(switchBtn, items, { x: ev.clientX, y: ev.clientY });
      };
    }
    function switchTo(newRoute, newParam){
      const cur = win._route || route;
      if (!newRoute || newRoute === cur || !V || !V[newRoute]) return;
      const oldArr = registry.get(cur);
      if (oldArr){
        const i = oldArr.indexOf(rec);
        if (i >= 0) oldArr.splice(i, 1);
        if (!oldArr.length) registry.delete(cur);
      }
      const newArr = registry.get(newRoute) || [];
      newArr.push(rec);
      registry.set(newRoute, newArr);
      win._route = newRoute;
      let t2 = newRoute, i2 = 'app';
      for (const sec of NAV_SRC){
        const it = sec.items.find(x => x.route === newRoute);
        if (it){ t2 = it.title; i2 = it.icon || 'app'; break; }
      }
      win._title = t2; win._iconName = i2;
      const tEl = head.querySelector('.aw-win__title');
      if (tEl){
        tEl.classList.remove('aw-win__title--swap'); void tEl.offsetWidth;
        tEl.classList.add('aw-win__title--swap');
        setTimeout(()=>{ tEl.classList.remove('aw-win__title--swap'); if (tEl.isConnected) tEl.innerHTML = icon(i2,'ico-sm') + ' <b>' + esc(t2) + '</b>' + icon('chev-d','ico-sm'); }, 150);
      }
      /* Плавная смена содержимого: старое гаснет, новое выезжает */
      body.classList.remove('aw-win__body--swap-in'); void body.offsetWidth;
      body.classList.add('aw-win__body--swap-out');
      setTimeout(()=>{
        body.innerHTML = '';
        try { V[newRoute](body, newParam); } catch(e){ body.innerHTML = '<div class="empty">' + icon('alert') + '<span>Ошибка: ' + esc(e && e.message || e) + '</span></div>'; }
        body.classList.remove('aw-win__body--swap-out');
        body.classList.add('aw-win__body--swap-in');
        setTimeout(()=>body.classList.remove('aw-win__body--swap-in'), 260);
      }, 140);
      refreshMenuIndicator(cur, hasWindow(cur));
      refreshMenuIndicator(newRoute, true);
      try { persistWins(); } catch(e){}
    }
    /* Навигация изнутри этого окна (кнопки «перейти в раздел») должна
       менять содержимое окна, а не страницу под ним. */
    win._switchTo = switchTo;
 
    function closeWindow(){
      if (win._closing) return;
      const rt = win._route || route;
      win._closing = true;
      markClosing(rt);
      win.classList.add('aw-win--closing');
      setTimeout(() => {
        win.remove();
        const arr2 = registry.get(rt);
        if (arr2){
          const i = arr2.indexOf(rec);
          if (i >= 0) arr2.splice(i, 1);
          if (!arr2.length) registry.delete(rt);
        }
        refreshMenuIndicator(rt, hasWindow(rt));
        persistWins();
      }, 180);
    }
    win.querySelector('.aw-win__close').onclick = closeWindow;
    win._close = closeWindow;
    if (custom && typeof custom.onMount === 'function') setTimeout(() => { try { custom.onMount(win, closeWindow); } catch(e){ console.error(e); } }, 0);
    win._el = win; win._route = route;
    if (!(custom && custom.onMount)) persistWins();

    /* --- Drag за заголовок (общий слой) --- */
    head.addEventListener('mousedown', e => {
      if (e.button !== 0) return; /* ПКМ — только контекстное меню, не drag */
      if (e.target.closest('.aw-win__close') || e.target.closest('.aw-win__max')) return;
      if (e.target.closest('.aw-win__min')) return;
      e.preventDefault();
      const r = win.getBoundingClientRect();
      win.__inSplit = null; /* перетащили окно — оно больше не в сплите */
      win.__cornerDetached = false;
      /* Геометрия ДО драга: если окно уронят в уголок, вернём его сюда. */
      win.__dragStartRect = { left: win.style.left || (r.left + 'px'), top: win.style.top || (r.top + 'px'),
        width: win.style.width || (r.width + 'px'), height: win.style.height || (r.height + 'px') };
      active = { kind:'drag', win:win, sx:e.clientX, sy:e.clientY, ox:r.left, oy:r.top, ow:r.width, oh:r.height, moved:false,
        noToggle: !!(e.target.closest && e.target.closest('.aw-win__title--sw')),
        neighbors: snapshotNeighbors(win) };
      win.classList.add('aw-win--dragging');
      document.body.classList.add('win-dragging');
      focusWin(win);
    });
    /* Двойной клик по заголовку — разворот на весь экран / восстановление.
       Подавляем, если только что был именно драг (второй «клик» после дропа). */
    head.addEventListener('dblclick', e => {
      if (e.target.closest('.aw-win__close') || e.target.closest('.aw-win__max') || e.target.closest('.aw-win__min')) return;
      /* При активном зуме двойной тап не разворачивает окно: иначе геометрия
         окна и масштаб страницы конфликтуют и рендер дёргается. */
      if (window.visualViewport && window.visualViewport.scale > 1.01) return;
      if (Date.now() - (win.__lastDragEnd || 0) < 400) return;
      e.preventDefault();
      if (win.classList.contains('aw-win--corner')){ exitCorner(win); return; }
      const maxBtn = win.querySelector('.aw-win__max');
      if (maxBtn) toggleMax(win, maxBtn);
    });
    /* Новое окно (и виджет) становится активным сразу: без focusWin z-index
       остаётся 'auto' и окно уходит ПОД ранее открытые (баг «виджет под окнами»). */
    focusWin(win);
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
  /* Единый справочник геометрии снапа: прямоугольник, в который встанет окно
     при «прилипании» к зоне. Используется и для подсветки-гида, и для
     финальной установки на mouseup — чтобы гид и результат всегда совпадали
     (раньше в гиде для 'right' строилась левая половина, а для угловых зон
     tl/tr/bl/br окно ставилось на весь экран — «выделение правой половины
     терялось»). */
  function snapRectFor(snapDir){
    const vw = window.innerWidth, vh = window.innerHeight;
    const qw = Math.round(vw / 2), qh = Math.round(vh / 2);
    const full = snapDir === 'all';
    switch (snapDir){
      case 'left':  return { left:0,      top:0,      width:qw,     height:vh };
      case 'right': return { left:qw,     top:0,      width:vw-qw,  height:vh };
      case 'top':   return { left:0,      top:0,      width:vw,     height:qh };
      case 'bottom':return { left:0,      top:qh,     width:vw,     height:vh-qh };
      case 'tl':    return { left:0,      top:0,      width:qw,     height:qh };
      case 'tr':    return { left:qw,     top:0,      width:vw-qw,  height:qh };
      case 'bl':    return { left:0,      top:qh,     width:qw,     height:vh-qh };
      case 'br':    return { left:qw,     top:qh,     width:vw-qw,  height:vh-qh };
      case 'all':   return { left:0,      top:0,      width:vw,     height:vh };
      default:      return null;
    }
  }
  /* ---------- Уголок окна чата (эксклюзивный режим) ---------- */
  const CORNER_W = 360, CORNER_H = 520, CORNER_GAP = 16;
  function isChatWin(win){ return !!(win && (win._route === 'chats' || win.querySelector('.chats-layout'))); }
  function cornerRectFor(pos){
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(CORNER_W, vw - CORNER_GAP * 2);
    const h = Math.min(CORNER_H, vh - CORNER_GAP * 2);
    return {
      left: pos.includes('r') ? vw - w - CORNER_GAP : CORNER_GAP,
      top: pos.includes('b') ? vh - h - CORNER_GAP : CORNER_GAP,
      width: w, height: h
    };
  }
  function enterCorner(win, pos){
    if (!win) return;
    const p = ['tl','tr','bl','br'].includes(pos) ? pos : 'br';
    if (!win.__cornerPrev){
      win.__cornerPrev = win.__dragStartRect || { left: win.style.left, top: win.style.top, width: win.style.width, height: win.style.height };
    }
    win.__dragStartRect = null;
    /* Развёрнутое окно сначала возвращаем в обычный размер. */
    if (win._prevRect){
      const mb = win.querySelector('.aw-win__max');
      if (mb) toggleMax(win, mb);
    }
    const rc = cornerRectFor(p);
    win.__inSplit = null;
    win.style.left = rc.left + 'px';
    win.style.top = rc.top + 'px';
    win.style.width = rc.width + 'px';
    win.style.height = rc.height + 'px';
    win.style.right = ''; win.style.bottom = '';
    win.style.minWidth = '0'; win.style.minHeight = '0';
    win.__cornerPos = p;
    win.classList.remove('aw-win--corner-min');
    win.__cornerHeight = null;
    win.__cornerTop = null;
    win.__cornerDetached = false;
    win.classList.add('aw-win--corner', 'aw-win--animating');
    /* Перенос из угла в угол не разворачивает свёрнутый чат: ставим геометрию
       свёрнутого уголка сразу, без анимации из полной высоты. */
    if (win.__cornerWasMin){
      win.__cornerWasMin = false;
      const head = win.querySelector('.aw-win__head');
      const hh = head ? Math.round(head.offsetHeight) : 53;
      win.__cornerHeight = rc.height;
      win.__cornerTop = rc.top;
      win.classList.add('aw-win--corner-min');
      win.style.height = hh + 'px';
      if (p.includes('b')) win.style.top = (rc.top + rc.height - hh) + 'px';
      const minBtn = win.querySelector('.aw-win__min');
      if (minBtn) minBtn.title = 'Развернуть окно раздела';
    }
    setTimeout(() => win.classList.remove('aw-win--animating'), 320);
    focusWin(win);
    syncSplitClasses();
    try { win._chatNarrow && win._chatNarrow(); } catch(e){}
    try { persistWins(); } catch(e){}
  }
  function toggleCornerCollapse(win){
    if (!win || !win.classList.contains('aw-win--corner')) return;
    const head = win.querySelector('.aw-win__head');
    const hh = head ? Math.round(head.offsetHeight) : 53;
    win.classList.add('aw-win--animating');
    const minBtn = win.querySelector('.aw-win__min');
    const pos = win.__cornerPos || 'br';
    const bottomAnchor = pos.includes('b');
    const curTop = parseFloat(win.style.top) || win.getBoundingClientRect().top;
    if (win.classList.contains('aw-win--corner-min')){
      win.classList.remove('aw-win--corner-min');
      const ch = win.__cornerHeight || cornerRectFor(pos).height;
      win.style.height = ch + 'px';
      /* Шапка возвращается на место: для нижних углов — от нижней кромки. */
      if (bottomAnchor) win.style.top = (win.__cornerTop != null ? win.__cornerTop : curTop - (ch - hh)) + 'px';
      win.__cornerTop = null;
      win.__cornerHeight = null;
      if (minBtn) minBtn.title = 'Свернуть окно раздела';
    } else {
      win.__cornerHeight = win.offsetHeight;
      win.__cornerTop = curTop;
      win.classList.add('aw-win--corner-min');
      win.style.height = hh + 'px';
      win.style.minHeight = '0';
      /* Сворачиваемся К НИЖНЕМУ КРАЮ: шапка остаётся у нижней границы окна. */
      if (bottomAnchor) win.style.top = (curTop + win.__cornerHeight - hh) + 'px';
      if (minBtn) minBtn.title = 'Развернуть окно раздела';
    }
    setTimeout(() => win.classList.remove('aw-win--animating'), 340);
    try { persistWins(); } catch(e){}
  }
  /* Уголок привязан к краям экрана. При входе в полноэкранный режим и выходе
     из него innerHeight меняется, а окно оставалось на прежних пикселях —
     визуально оно «отклеивалось» от нижнего края. Пересчитываем позицию по
     тому же углу, сохраняя размер, который пользователь задал вручную. */
  function spotCorner(win, instant){
    if (!win || !win.classList.contains('aw-win--corner')) return;
    if (active || win.__expandUntil) return;
    const pos = win.__cornerPos || 'br';
    const rc = cornerRectFor(pos);
    const head = win.querySelector('.aw-win__head');
    const headH = head ? Math.round(head.offsetHeight) : 53;
    const collapsed = win.classList.contains('aw-win--corner-min');
    const w = Math.min(Math.round(win.offsetWidth) || rc.width, rc.width);
    const fullH = Math.min(Math.round(win.offsetHeight) || rc.height, rc.height);
    const h = collapsed ? headH : fullH;
    const left = pos.includes('r') ? rc.left + rc.width - w : rc.left;
    const top  = pos.includes('b') ? rc.top + rc.height - h : rc.top;
    const curL = parseFloat(win.style.left), curT = parseFloat(win.style.top);
    const curW = parseFloat(win.style.width), curH = parseFloat(win.style.height);
    const same = Math.abs((curL || 0) - left) < 1 && Math.abs((curT || 0) - top) < 1
      && (collapsed || (Math.abs((curW || 0) - w) < 1 && Math.abs((curH || 0) - fullH) < 1));
    if (same) return;
    if (!instant){
      win.classList.add('aw-win--animating');
      setTimeout(() => win.classList.remove('aw-win--animating'), 320);
    }
    win.style.left = Math.round(left) + 'px';
    win.style.top = Math.round(top) + 'px';
    if (collapsed){
      /* Свёрнутый уголок: запоминаем геометрию развёрнутого состояния,
         чтобы по клику он раскрылся ровно до нижнего края. */
      win.__cornerTop = rc.top;
      win.__cornerHeight = rc.height;
    } else {
      win.style.width = w + 'px';
      win.style.height = fullH + 'px';
      win.style.minWidth = '0'; win.style.minHeight = '0';
    }
  }
  let __cornerRAF = null;
  let __cornerSaveT = null;
  /* Сохранение геометрии — не чаще одного раза после серии ресайзов.
     Раньше persistWins() вызывался на каждом кадре изменения окна браузера,
     сериализовал все окна и введённые формы и давал заметные подвисания. */
  function saveWinsSoon(){
    clearTimeout(__cornerSaveT);
    __cornerSaveT = setTimeout(() => {
      __cornerSaveT = null;
      try { persistWins(); } catch(e){}
    }, 260);
  }
  function reflowCorners(instant){
    const els = document.querySelectorAll('#windows-layer .aw-win--corner');
    if (!els.length) return;
    const lay = document.getElementById('windows-layer');
    if (instant && lay){
      /* На время подгонки под новый размер окна браузера отключаем переходы:
         иначе каждый resize-кадр заново запускал анимацию left/top/width/height
         у всех уголков — окна «плыли» и мерцали. */
      lay.classList.add('wins-reflowing');
    }
    els.forEach(w => spotCorner(w, instant));
    if (instant && lay){
      /* Фиксируем новую геометрию без transition и сразу снимаем блокировку. */
      void lay.offsetWidth;
      lay.classList.remove('wins-reflowing');
      saveWinsSoon();
    } else {
      try { persistWins(); } catch(e){}
    }
  }
  function scheduleCorners(){
    if (__cornerRAF) cancelAnimationFrame(__cornerRAF);
    __cornerRAF = requestAnimationFrame(() => { __cornerRAF = null; reflowCorners(true); });
  }
  window.addEventListener('resize', scheduleCorners, { passive:true });
  ['fullscreenchange','webkitfullscreenchange'].forEach(ev => {
    document.addEventListener(ev, () => {
      /* Браузер меняет размеры после события полного экрана — ловим кадр,
         затем ещё раз, когда переход закончится. */
      scheduleCorners();
      setTimeout(scheduleCorners, 120);
      setTimeout(scheduleCorners, 380);
    });
  });
  /* Снять состояние уголка без возврата старой геометрии: используется,
     когда окно переносят через контекстное меню (сплит/центр/максимум).
     Иначе класс aw-win--corner оставался и правые иконки шапки продолжали
     считать окно уголком: максимум скрыт, «свернуть» сворачивал уголок. */
  function clearCornerState(win){
    if (!win) return;
    win.classList.remove('aw-win--corner', 'aw-win--corner-min');
    win.__cornerPos = null;
    win.__cornerPrev = null;
    win.__cornerHeight = null;
    win.__cornerTop = null;
    win.__cornerWasMin = false;
    win.__cornerDetached = false;
    const mb = win.querySelector('.aw-win__min');
    if (mb) mb.title = 'Свернуть окно раздела';
  }
  function exitCorner(win){
    if (!win || !win.classList.contains('aw-win--corner')) return;
    win.__cornerWasMin = false;
    win.classList.remove('aw-win--corner', 'aw-win--corner-min');
    const mb0 = win.querySelector('.aw-win__min');
    if (mb0) mb0.title = 'Свернуть окно раздела';
    win.__cornerHeight = null;
    win.__cornerTop = null;
    const p = win.__cornerPrev;
    if (p){
      win.style.left = p.left || '';
      win.style.top = p.top || '';
      win.style.width = p.width || '';
      win.style.height = p.height || '';
    }
    win.__cornerPrev = null;
    win.__cornerPos = null;
    win.classList.add('aw-win--animating');
    setTimeout(() => win.classList.remove('aw-win--animating'), 320);
    try { win._chatNarrow && win._chatNarrow(); } catch(e){}
    try { persistWins(); } catch(e){}
  }
  document.addEventListener('mousemove', e => {
    if (!active) return;
    const dx = e.clientX - active.sx, dy = e.clientY - active.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) active.moved = true;
    if (!active.moved) return;
    const win = active.win;
    if (active.kind === 'drag'){
      /* Из уголка выходим только при РЕАЛЬНОМ движении: одиночный клик по
         шапке должен сворачивать/разворачивать, а не откреплять окно. */
      if (win.classList.contains('aw-win--corner') && !win.__cornerDetached){
        win.__cornerDetached = true;
        /* Запомним, из какого уголка вытащили: подсветку этого же уголка не
           показываем, пока окно не отъедет, иначе оно липнет обратно */
        win.__cornerGuard = win.__cornerPos || null;
        win.classList.remove('aw-win--corner');
        /* Свёрнутый уголок остаётся свёрнутым и после переноса в другой угол:
           на время драга окно разворачиваем, а состояние запоминаем. */
        win.__cornerWasMin = win.classList.contains('aw-win--corner-min');
        if (win.classList.contains('aw-win--corner-min')){
          win.classList.remove('aw-win--corner-min');
          const mb1 = win.querySelector('.aw-win__min');
          if (mb1) mb1.title = 'Свернуть окно раздела';
          const ch = win.__cornerHeight || 520;
          const hh2 = win.offsetHeight;
          const curTop = parseFloat(win.style.top) || win.getBoundingClientRect().top;
          win.classList.add('aw-win--animating');
          if ((win.__cornerPos || '').includes('b')) win.style.top = (curTop - (ch - hh2)) + 'px';
          win.style.height = ch + 'px';
          win.__cornerHeight = null;
          win.__cornerTop = null;
          win.__expandTarget = { left: parseFloat(win.style.left) || win.getBoundingClientRect().left, top: win.style.top ? parseFloat(win.style.top) : win.getBoundingClientRect().top };
          win.__expandUntil = Date.now() + 260;
          setTimeout(() => { win.classList.remove('aw-win--animating'); win.__expandUntil = 0; win.__expandTarget = null; }, 260);
        }
        win.__cornerPrev = null;
        win.__cornerPos = null;
        const rr0 = win.getBoundingClientRect();
        active.ow = win.offsetWidth; active.oh = win.offsetHeight;
        active.sx = e.clientX; active.sy = e.clientY;
        active.ox = win.__expandTarget ? win.__expandTarget.left : rr0.left;
        active.oy = win.__expandTarget ? win.__expandTarget.top : rr0.top;
        win.__dragStartRect = { left: win.style.left || (rr0.left + 'px'), top: win.style.top || (rr0.top + 'px'),
          width: win.style.width || (rr0.width + 'px'), height: win.style.height || (rr0.height + 'px') };
        return;
      }
      if (win.__expandUntil){
        /* Идёт плавный разворот из уголка: игнорируем движение, но отсчёт
           держим на конечной раскрытой позиции — без прыжка к курсору. */
        const t = win.__expandTarget;
        active.sx = e.clientX; active.sy = e.clientY;
        if (t){ active.ox = t.left; active.oy = t.top; }
        win.__lastSnap = null;
        return;
      }
      let x = active.ox + dx, y = active.oy + dy;
      /* Размер окна зафиксирован на старте драга: offsetWidth/Height
         на каждом mousemove заставляли браузер пересчитывать layout. */
      const w = active.ow || win.offsetWidth, h = active.oh || win.offsetHeight;
      x = Math.max(-w + 100, Math.min(x, window.innerWidth - 100));
      y = Math.max(0, Math.min(y, window.innerHeight - 40));
      win.style.left = x + 'px';
      win.style.top = y + 'px';
      let snap = null, cornerDrop = null;
      /* Эксклюзивно для окон чатов: у самого угла экрана — «режим уголка».
         Считаем не только по курсору, но и по самому окну: окно тащат за
         шапку, и курсор физически не доходит до края экрана, пока угол окна
         уже стоит в углу. Иначе подсветка не появлялась никогда. */
      if (isChatWin(win)){
        const vw = window.innerWidth, vh = window.innerHeight;
        const cands = [
          { p:'tl', d: Math.min(Math.hypot(x, y), Math.hypot(e.clientX, e.clientY)) },
          { p:'tr', d: Math.min(Math.hypot(x + w - vw, y), Math.hypot(vw - e.clientX, e.clientY)) },
          { p:'bl', d: Math.min(Math.hypot(x, y + h - vh), Math.hypot(e.clientX, vh - e.clientY)) },
          { p:'br', d: Math.min(Math.hypot(x + w - vw, y + h - vh), Math.hypot(vw - e.clientX, vh - e.clientY)) }
        ];
        const best = cands.reduce((a, b) => (b.d < a.d ? b : a));
        if (best.d <= 120) cornerDrop = best.p;
        /* Окно только что вытащили из этого уголка — не ловим его снова,
           пока оно не отъедет от угла хотя бы на полторы зоны */
        if (win.__cornerGuard){
          if (cornerDrop === win.__cornerGuard && best.d < 170) cornerDrop = null;
          else if (cornerDrop !== win.__cornerGuard || best.d >= 170) win.__cornerGuard = null;
        }
      }
      /* Живой вертикальный магнит: окно прилипает к соседу сверху/снизу ещё
         во время драга, без ожидания отпускания. */
      if (!cornerDrop){
        const magY = liveVerticalMagnet(win, x, y, w, h, active.neighbors);
        if (magY !== null){ y = magY; win.style.top = y + 'px'; }
      }
      /* Предпросмотр стыка: тень гаснет сразу, как только окна прижались. */
      previewSplitDuringDrag(win, active.neighbors, { left:x, top:y, right:x + w, bottom:y + h });
      if (!cornerDrop){
        if (x < 26) snap = (y < 26 ? 'tl' : 'left');        /* левая половина */
        else if (x + w > window.innerWidth - 26) snap = (y < 26 ? 'tr' : 'right'); /* правая */
        else if (y < 26) snap = 'top';                     /* верхняя половина на всю ширину */
        else if (y + h > window.innerHeight - 26) snap = 'bottom'; /* нижняя половина */
      }
      win.__cornerDrop = cornerDrop;
      let g = document.querySelector('.aw-snap-guide');
      if (cornerDrop){
        const gm = cornerRectFor(cornerDrop);
        if (!g){ g = document.createElement('div'); g.className = 'aw-snap-guide'; document.body.appendChild(g); }
        g.classList.add('aw-snap-guide--corner');
        g.style.cssText = `left:${gm.left}px;top:${gm.top}px;width:${gm.width}px;height:${gm.height}px;display:block`;
      } else if (snap){
        if (g) g.classList.remove('aw-snap-guide--corner');
        if (!g){ g = document.createElement('div'); g.className = 'aw-snap-guide'; document.body.appendChild(g); }
        /* Прямоугольник-подсветка под целевое «прилипание»: берём из единого
           справочника snapRectFor — правые зоны показывают правую половину,
           угловые — четверти (для 'left' и 'right' раньше строилась одна и та
           же карта left:0 — при драге вправо подсветка ложилась на левую
           сторону, «выделение правой половины терялось»). */
        const gm = snapRectFor(snap) || { left:0, top:0, width:1600, height:1000 };
        g.style.cssText = `left:${gm.left}px;top:${gm.top}px;width:${gm.width}px;height:${gm.height}px;display:block`;
      } else if (g){ g.style.display = 'none'; g.classList.remove('aw-snap-guide--corner'); }
      win.__lastSnap = cornerDrop ? null : snap; /* магнит к краю: применим на mouseup */
    } else if (active.kind === 'resize'){
      /* Ресайз развёрнутого окна — это уже не полный экран: иконка плавно
         возвращается к «На весь экран», а не остаётся «Восстановить». */
      if (win._prevRect){
        win._prevRect = null;
        setMaxState(win, false);
      }
      const d = active.dir;
      let L = active.ox, T = active.oy, W = active.ow, H = active.oh;
      if (d.includes('e')) W = Math.max(300, active.ow + dx);
      if (d.includes('s')) H = Math.max(200, active.oh + dy);
      if (d.includes('w')){ const nl = Math.min(active.ox + dx, active.ox + active.ow - 300); W = active.ow + (active.ox - nl); L = nl; }
      if (d.includes('n')){ const nt = Math.min(active.oy + dy, active.oy + active.oh - 200); H = active.oh + (active.oy - nt); T = nt; }
      win.style.left = L + 'px'; win.style.top = T + 'px';
      win.style.width = W + 'px'; win.style.height = H + 'px';
      win.style.minWidth = '0'; win.style.minHeight = '0';
      /* Синхронный ресайз смежного окна (сплит-стык):
         если рядом есть другое окно, примыкающее к нашей изменяемой стороне —
         двигаем его вместе. Горизонтальные стыки (e/w) и вертикальные (n/s)
         обрабатываются одинаково. */
      if (d.includes('w') || d.includes('e') || d.includes('n') || d.includes('s')){
        syncSplit(win, { left:L, top:T, width:W, height:H }, d);
      }
    }
  });
  /* Синхронный ресайз стыка: сосед слева/справа движется вместе с нами.
   Ищем соседа по краю, лежащему внутри нашего нового rect (устойчиво к быстрому движению).
   Исходные края соседа фиксируются при первом контакте (__origLeft/__origRight).
   Минимальная ширина обоих окон при сплите — MIN_WIN_W (нельзя схлопнуть соседа). */
  const MIN_WIN_W = 300;
  /* Минимальная высота окна при вертикальном сплите (стыки n/s) */
  const MIN_WIN_H = 200;
  /* Геометрия окна по ЦЕЛЕВЫМ left/top/width/height, а не по rect.
     Во время перехода (.aw-win--animating) rect ещё показывает стартовую
     позицию: после снапа к половине экрана syncSplitClasses видел старый
     прямоугольник, не находил стык и снимал класс сплита — тень оставалась.
     Слой окон fixed/inset:0, поэтому style-координаты совпадают с rect. */
  function winGeom(el){
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:0, height:0 };
    const L = parseFloat(el.style.left), T = parseFloat(el.style.top);
    const W = parseFloat(el.style.width), H = parseFloat(el.style.height);
    if (Number.isFinite(L) && Number.isFinite(T) && Number.isFinite(W) && Number.isFinite(H) && W > 0 && H > 0){
      return { left:L, top:T, right:L + W, bottom:T + H, width:W, height:H };
    }
    return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height };
  }
  /* Тень между состыкованными окнами недопустима: класс aw-win--split
     (box-shadow:none) вешаем на ОБА окна, а не только на активное.
     Соседство считаем по фактическим DOM-окнам слоя: это надёжнее реестра
     (реестр хранит записи по маршрутам, и после смены раздела окно могло
     выпасть из выборки — из-за чего сплит «терял» класс и снова показывал тень). */
  function syncSplitClasses(){
    const els = Array.from(document.querySelectorAll('#windows-layer .aw-win'));
    els.forEach(el => {
      const r = winGeom(el);
      /* Класс сплита — только у окон, реально поставленных в сплит */
      if (!el.__inSplit || !r.width || !r.height){ el.classList.remove('aw-win--split'); return; }
      const adj = els.some(other => {
        if (other === el || !other.__inSplit) return false;
        const o2 = winGeom(other);
        if (!o2.width || !o2.height) return false;
        /* Соседство по горизонтали (сплит слева/справа) и по вертикали
           (окна друг над другом). Вертикальный стык раньше не учитывался —
           из-за этого между верхним и нижним окном оставалась тень. */
        const vertOv = (r.top <= o2.bottom - 10) && (o2.top <= r.bottom - 10);
        const horOv  = (r.left <= o2.right - 10) && (o2.left <= r.right - 10);
        const horAdj = vertOv && (Math.abs(o2.left - r.right) <= 12 || Math.abs(o2.right - r.left) <= 12);
        const verAdj = horOv  && (Math.abs(o2.top - r.bottom) <= 12 || Math.abs(o2.bottom - r.top) <= 12);
        return horAdj || verAdj;
      });
      el.classList.toggle('aw-win--split', adj);
    });
  }
  /* Соседи фиксируются на старте драга: прямоугольники и видимость
     (кто реально сверху) не меняются, пока тащат одно окно. Раньше
     liveVerticalMagnet на каждый mousemove делал elementFromPoint и
     getBoundingClientRect по всем окнам — это и давало просадки. */
  function snapshotNeighbors(win){
    const out = [];
    allWins().forEach(rec => {
      const el = rec.win;
      if (el === win) return;
      const o = winGeom(el);
      if (!o.width || !o.height) return;
      try {
        const cx = Math.max(1, Math.min(window.innerWidth - 1, Math.round(o.left + o.width / 2)));
        const cy = Math.max(1, Math.min(window.innerHeight - 1, Math.round(o.top + o.height / 2)));
        const hit = document.elementFromPoint(cx, cy);
        const hitWin = hit && hit.closest ? hit.closest('.aw-win') : null;
        if (hitWin && hitWin !== el) return;
      } catch(e){}
      out.push({ el, left:o.left, top:o.top, right:o.right, bottom:o.bottom, width:o.width, height:o.height });
    });
    return out;
  }
  /* Живой вертикальный магнит: если dragged-окно почти прижалось верхом к
     нижнему краю соседа (или низом к его верху), притягиваем его встык ещё
     во время движения — в полноширинном вертикальном сплите это сразу
     показывает, что окна встанут друг над другом. */
  function liveVerticalMagnet(win, x, y, w, h, neighbors){
    let bestY = null, bestD = 27;
    (neighbors || snapshotNeighbors(win)).forEach(o => {
      if (!o || !o.el || o.el === win) return;
      /* Пересечение по горизонтали не меньше 40px: окна не липнут издалека */
      if (!((x <= o.right - 40) && (o.left <= x + w - 40))) return;
      const dTop = Math.abs(o.bottom - y);            /* верхом к низу соседа */
      const dBot = Math.abs(o.top - (y + h));         /* низом к верху соседа */
      if (dTop < bestD){ bestD = dTop; bestY = Math.round(o.bottom); }
      if (dBot < bestD){ bestD = dBot; bestY = Math.round(o.top - h); }
    });
    return bestY;
  }

  /* Стык во время драга: как только окно прижалось к соседу, оба получают
     класс сплита — тень плавно гаснет сразу, ещё до отпускания кнопки.
     На дропе состояние пересчитывает syncSplitClasses. */
  function previewSplitDuringDrag(win, neighbors, rect){
    if (!win) return;
    const r = rect || winGeom(win);
    const near = [];
    (neighbors || snapshotNeighbors(win)).forEach(o => {
      if (!o || !o.el || o.el === win) return;
      const vertOv = (r.top <= o.bottom - 10) && (o.top <= r.bottom - 10);
      const horOv  = (r.left <= o.right - 10) && (o.left <= r.right - 10);
      const horAdj = vertOv && (Math.abs(o.left - r.right) <= 12 || Math.abs(o.right - r.left) <= 12);
      const verAdj = horOv  && (Math.abs(o.top - r.bottom) <= 12 || Math.abs(o.bottom - r.top) <= 12);
      if (horAdj || verAdj) near.push(o.el);
    });
    (win.__splitPeek || []).forEach(el => {
      if (el !== win && near.indexOf(el) < 0 && !el.__inSplit) el.classList.remove('aw-win--split');
    });
    win.__splitPeek = near;
    if (near.length){
      win.classList.add('aw-win--split');
      near.forEach(el => el.classList.add('aw-win--split'));
    } else if (!win.__inSplit){
      win.classList.remove('aw-win--split');
    }
  }

  function syncSplit(win, rc, d){
    /* Стык — только для окон в сплите: обычные окна совместно не ресайзятся */
    if (!win.__inSplit) return;
    const right = rc.left + (rc.width || 0);
    const bottom = rc.top + (rc.height || 0);
    const verticalOverlap = r => (r.top <= bottom - 10) && (r.bottom >= rc.top + 10);
    const horizontalOverlap = r => (r.left <= right - 10) && (r.right >= rc.left + 10);
    let best = null, bestDist = Infinity;
    /* Защёлка соседа на время ресайза стыка: без неё при движении другой
       окно становилось «ближе» и стык внезапно подменял соседа. */
    const latched = win.__splitPartner;
    if (latched && latched.isConnected && latched.__inSplit && latched !== win){
      const lr = latched.getBoundingClientRect();
      const near = (d.includes('e') && Math.abs(lr.left - right) <= 60)
        || (d.includes('w') && Math.abs(lr.right - rc.left) <= 60)
        || (d.includes('n') && Math.abs(lr.bottom - rc.top) <= 60)
        || (d.includes('s') && Math.abs(lr.top - bottom) <= 60);
      if (near){ win.__splitPartner = latched; best = latched; }
    }
    if (!best) allWins().forEach(r => {

      const o = r.win;
      if (o === win || !o.__inSplit) return;
      const or = o.getBoundingClientRect();
      let dist;
      if (d.includes('e')){
        if (!verticalOverlap(or)) return;
        dist = Math.abs(or.left - right);
        if (o.__origGapE == null) return;
        if (o.__origGapE <= 8 && dist < bestDist){ best = o; bestDist = dist; }
      } else if (d.includes('w')){
        if (!verticalOverlap(or)) return;
        dist = Math.abs(or.right - rc.left);
        if (o.__origGapW == null) return;
        if (o.__origGapW <= 8 && dist < bestDist){ best = o; bestDist = dist; }
      } else if (d.includes('n')){
        /* сосед ВЫШЕ: его нижний край стыкуется с нашим верхом */
        if (!horizontalOverlap(or)) return;
        dist = Math.abs(or.bottom - rc.top);
        if (o.__origGapN == null) return;
        if (o.__origGapN <= 8 && dist < bestDist){ best = o; bestDist = dist; }
      } else if (d.includes('s')){
        /* сосед НИЖЕ: его верх стыкуется с нашим низом */
        if (!horizontalOverlap(or)) return;
        dist = Math.abs(or.top - bottom);
        if (o.__origGapS == null) return;
        if (o.__origGapS <= 8 && dist < bestDist){ best = o; bestDist = dist; }
      }
    });
    if (!best){
      win.__splitPartner = null;
      win.classList.remove('aw-win--split');
      return;
    }
    win.__splitPartner = best;
    win.classList.add('aw-win--split');
    best.classList.add('aw-win--split');
    const br = best.getBoundingClientRect();
    if (d.includes('e')){
      /* правый сосед: левый край стыкуется с нашим правым краем.
         Предел: сосед не должен сжаться меньше MIN_WIN_W → активное окно тоже стоп. */
      if (best.__origRight == null) best.__origRight = br.right;
      const maxRight = best.__origRight - MIN_WIN_W;
      const effRight = Math.min(right, maxRight);
      if (effRight < right){
        /* сдвигаем активное окно назад, чтобы не разорвать стык */
        const dw = right - effRight;
        win.style.left = (rc.left - dw) + 'px';
        win.style.width = Math.max(MIN_WIN_W, rc.width - dw) + 'px';
      }
      best.style.left = effRight + 'px';
      best.style.right = '';
      best.style.width = (best.__origRight - effRight) + 'px';
    } else if (d.includes('w')){
      /* левый сосед: правый край стыкуется с нашим левым краем.
         Предел: левый сосед не может быть уже MIN_WIN_W. */
      if (best.__origLeft == null) best.__origLeft = br.left;
      const minLeft = best.__origLeft + MIN_WIN_W;
      const effLeft = Math.max(rc.left, minLeft);
      if (effLeft > rc.left){
        const dw = effLeft - rc.left;
        win.style.left = (rc.left + dw) + 'px';
        win.style.width = Math.max(MIN_WIN_W, rc.width - dw) + 'px';
      }
      best.style.left = best.__origLeft + 'px';
      best.style.right = '';
      best.style.width = (effLeft - best.__origLeft) + 'px';
    } else if (d.includes('n')){
      /* сосед ВЫШЕ: его низ прижимается к нашему новому верху (rc.top).
         Предел: сосед не должен сжаться меньше MIN_WIN_H → если мы упираемся,
         сдвигаем активное окно обратно, чтобы не разорвать стык. */
      if (best.__origTop == null) best.__origTop = br.top;
      if (best.__origBottom == null) best.__origBottom = br.bottom;
      const minEffTop = best.__origTop + MIN_WIN_H;
      const effTop = Math.max(rc.top, minEffTop);
      if (effTop > rc.top){
        const dh = effTop - rc.top;
        win.style.top = (rc.top + dh) + 'px';
        win.style.height = Math.max(MIN_WIN_H, rc.height - dh) + 'px';
      }
      best.style.top = best.__origTop + 'px';
      best.style.bottom = '';
      best.style.height = (effTop - best.__origTop) + 'px';
    } else if (d.includes('s')){
      /* сосед НИЖЕ: его верх прижимается к нашему новому низу (rc.bottom).
         Предел: сосед не должен сжаться меньше MIN_WIN_H → активное окно
         не растягивается дальше, чем позволяет высота соседа. */
      if (best.__origTop == null) best.__origTop = br.top;
      if (best.__origBottom == null) best.__origBottom = br.bottom;
      const bottom = rc.top + rc.height;
      const maxEffBottom = best.__origBottom - MIN_WIN_H;
      const effBottom = Math.min(bottom, maxEffBottom);
      if (effBottom < bottom){
        const dh = bottom - effBottom;
        win.style.height = Math.max(MIN_WIN_H, rc.height - dh) + 'px';
      }
      best.style.top = effBottom + 'px';
      best.style.bottom = '';
      best.style.height = (best.__origBottom - effBottom) + 'px';
    }
    best.style.minWidth = '0'; best.style.minHeight = '0';
    /* Классы сплита обновляем ПОСЛЕ сдвига соседа: иначе на промежуточном кадре
       win уже сдвинулся, а best ещё на старом месте — syncSplitClasses видел
       зазор >12px, снимал aw-win--split, и тень мигала при каждом движении. */
    syncSplitClasses();
  }
  /* Магнитное прилипание на дропе: окно, унесённое почти встык к краю соседа
     или экрана, прилипает вплотную (с анимацией). Ресайз при этом остаётся
     независимым — это не «сплит», а лишь выравнивание на дропе.
     neighborsOnly — только стык с соседним окном. Такой стык приоритетнее
     прилипания к половине экрана: иначе в вертикальном сплите у левого края
     окно уезжало в левую половину, не доходя до стыка. */
  function applyDropMagnet(win, opts = {}){
    if (!win) return false;
    const rr = win.getBoundingClientRect();
    const th = 14, vert = o => (rr.top <= o.bottom - 10) && (o.top <= rr.bottom - 10);
    const others = allWins().filter(rc => rc.win !== win).map(rc => ({ winEl: rc.win, rc: rc.win.getBoundingClientRect() }));
    const left = rr.left, right = rr.right, top = rr.top, bottom = rr.bottom;
    let nl = null, nr = null, nt = null;
    let br = null, bd = th + 1, brWin = null;
    others.forEach(o => { if (vert(o.rc)){ const d = Math.abs(o.rc.left - right); if (d < bd){ bd = d; br = o.rc.left; brWin = o.winEl; } } });
    if (br !== null) nr = br;
    let bl = null, ld = th + 1, blWin = null;
    others.forEach(o => { if (vert(o.rc)){ const d = Math.abs(o.rc.right - left); if (d < ld){ ld = d; bl = o.rc.right; blWin = o.winEl; } } });
    if (bl !== null) nl = bl;
    /* Вертикальный магнит: прилипание к ВЕРХНЕМУ/НИЖНЕМУ краю соседнего окна
       (перекрытие по горизонтали ≥10px, зазор по вертикали ≤14px). */
    const hor = o => (left <= o.rc.right - 10) && (o.rc.left <= right - 10);
    let bm = null, bmD = th + 1, bmWin = null;   /* сосед ВЫШЕ (прилипаем к его низу) */
    others.forEach(o => { if (hor(o)){ const d = Math.abs(o.rc.bottom - top); if (d < bmD){ bmD = d; bm = o; bmWin = o.winEl; } } });
    let tm = null, tmD = th + 1, tmWin = null;   /* сосед НИЖЕ (прилипаем к его верху) */
    others.forEach(o => { if (hor(o)){ const d = Math.abs(o.rc.top - bottom); if (d < tmD){ tmD = d; tm = o; tmWin = o.winEl; } } });
    const vNeighbor = bmWin !== null ? bmWin : (tmWin !== null ? tmWin : null);
    const vNeighborTop = bmWin !== null;
    const vNeighborBottom = tmWin !== null;
    const sideNeighbor = brWin !== null ? brWin : (blWin !== null ? blWin : null);
    const hasNeighbor = !!(vNeighbor || sideNeighbor);
    if (opts.neighborsOnly && !hasNeighbor) return false;
    /* Прилипание к КРАЮ ЭКРАНА (нет соседа встык) — лишь магнит к краю,
       НЕ связка: флаг сплита не ставим. */
    if (nr == null && right < window.innerWidth && window.innerWidth - right < th) nr = window.innerWidth;
    if (nl == null && left > 0 && left < th) nl = 0;
    if (top < th) nt = 0;
    const bottomScreen = (bottom > window.innerHeight - th) && (window.innerHeight - bottom < th);
    if (nl === null && nr === null && nt === null && !vNeighbor && !bottomScreen) return false;
    const L = nl !== null ? nl : left, R = nr !== null ? nr : right;
    let T = nt !== null ? nt : rr.top;
    if (vNeighborTop && bm){ T = bm.rc.bottom; }
    else if (vNeighborBottom && tm){ T = tm.rc.top - rr.height; }
    else if (bottomScreen){ T = window.innerHeight - rr.height; }
    win.classList.add('aw-win--animating');
    win.style.left = L + 'px';
    win.style.right = '';
    win.style.top = T + 'px';
    win.style.bottom = '';
    win.style.width = Math.max(200, R - L) + 'px';
    win.style.height = rr.height + 'px';
    win.style.minWidth = '0'; win.style.minHeight = '0';
    setTimeout(() => win.classList.remove('aw-win--animating'), 320);
    /* Прилипание встык к соседу = связка: помечаем оба окна «в сплите»,
       чтобы стык можно было тянуть совместно. */
    if (hasNeighbor){
      win.__inSplit = win.__inSplit || 'magnet';
      if (vNeighbor) vNeighbor.__inSplit = vNeighbor.__inSplit || 'magnet';
      if (sideNeighbor) sideNeighbor.__inSplit = sideNeighbor.__inSplit || 'magnet';
    }
    return true;
  }

  document.addEventListener('mouseup', () => {
    if (active && active.moved && active.kind === 'drag'){
      const win = active.win;
      const r = win.getBoundingClientRect();
      const w = win.offsetWidth, h = win.offsetHeight;
      const x = r.left, y = r.top;
      /* Магнит к краю/половине экрана при драге (как Aero Snap):
         унесённое вплотную к краю окно прилипает к половине экрана. */
      const snapDir = win.__lastSnap || null;
      let snapped = false;
      /* Стык с соседним окном проверяем ДО прилипания к половине экрана:
         в вертикальном сплите у края экрана окно должно лечь к стыку, а не
         уехать в половину. */
      let magnetDone = false;
      /* Раньше окно в сплите не могло примагнититься к НОВОМУ соседу —
         «перемагничивание» требовало выйти из сплита. Теперь стык ищется
         всегда: syncSplitClasses пересчитает пары по факту близости. */
      if (!win.__cornerDrop && !snapped){
        magnetDone = applyDropMagnet(win, { neighborsOnly:true });
        if (magnetDone) snapped = true;
      }
      if (win.__cornerDrop){
        snapped = true;
        const cd = win.__cornerDrop;
        win.__cornerDrop = null;
        enterCorner(win, cd);
      } else if (!magnetDone && snapDir){
        snapped = true;
        /* Пиксельная геометрия (left/top/width/height), без auto —
           иначе окно «телепортируется» вместо плавного прилипания.
           Берём из единого справочника snapRectFor: правые зоны — правая
           половина, угловые — четверти (раньше tl/tr/bl/br ставили окно на
           весь экран: tl → фуллскрин, tr → окно уезжало за правый край). */
        const sr0 = snapRectFor(snapDir) || { left:0, top:0, width:window.innerWidth, height:window.innerHeight };
        const L = sr0.left, T = sr0.top, W = sr0.width, H = sr0.height;
        win.style.left = L + 'px';
        win.style.right = '';
        win.style.top = T + 'px';
        win.style.bottom = '';
        win.style.width = W + 'px';
        win.style.height = H + 'px';
        win.style.minWidth = '0'; win.style.minHeight = '0';
        win.classList.add('aw-win--animating');
        setTimeout(() => { win.classList.remove('aw-win--animating'); syncSplitClasses(); }, 320);
        /* Снап к половине экрана = потенциальный стык: если рядом (вплотную, зазор ≤ 8)
           уже стоит другое окно — связываем оба, чтобы стык ресайзился совместно
           и тень на стыке гасла. Стык бывает и боковой (окна слева/справа),
           и вертикальный (одно над другим на всю ширину) — раньше проверялся
           только боковой, из-за чего в вертикальном сплите тень оставалась. */
        const sr = { left: L, top: T, right: L + W, bottom: T + H };
        allWins().forEach(rec => {
          if (rec.win === win) return;
          const or = winGeom(rec.win);
          const ovV = (sr.top <= or.bottom - 10) && (or.top <= sr.bottom - 10);
          const ovH = (sr.left <= or.right - 10) && (or.left <= sr.right - 10);
          const sideAdj = ovV && (Math.abs(or.left - sr.right) <= 8 || Math.abs(or.right - sr.left) <= 8);
          const vertAdj = ovH && (Math.abs(or.top - sr.bottom) <= 8 || Math.abs(or.bottom - sr.top) <= 8);
          if (sideAdj || vertAdj){
            win.__inSplit = win.__inSplit || 'snap';
            rec.win.__inSplit = rec.win.__inSplit || 'snap';
          }
        });
        syncSplitClasses();
      }
      /* Бросили не в уголок — прежняя свёрнутость больше не действует */
      if (!win.classList.contains('aw-win--corner')) win.__cornerWasMin = false;
      const g = document.querySelector('.aw-snap-guide');
      if (g){ g.style.display = 'none'; g.classList.remove('aw-snap-guide--corner'); }
      if (!win.__inSplit && !snapped && !magnetDone) applyDropMagnet(win, { neighborsOnly:false });
      try {
        const store = JSON.parse(sessionStorage.getItem('aw_wins') || '{"wins":[]}');
        const arr = store.wins.filter(x => x.route !== win._route);
        arr.push({ route: win._route, left: win.style.left || '36px', top: win.style.top || '36px', width: win.style.width, height: win.style.height, z: win.style.zIndex || 3010 });
        sessionStorage.setItem('aw_wins', JSON.stringify({ wins: arr.slice(-12) }));
      } catch(e2){}
    }
    if (active){
      /* Клик (без перемещения) по шапке уголка — свернуть/развернуть. */
      if (active.kind === 'drag' && !active.moved && !active.noToggle
          && active.win && active.win.classList.contains('aw-win--corner')){
        toggleCornerCollapse(active.win);
      }
      if (active.kind === 'resize' && active.win){
        active.win._resizing = false;
        /* Догон синхронного ресайза стыка на финальном кадре (если mousemove не успел) */
        if (active.moved && active.dir && (active.dir.includes('w') || active.dir.includes('e'))){
          const w = active.win;
          const r = w.getBoundingClientRect();
          syncSplit(w, { left:r.left, top:r.top, width:r.width, height:r.height }, active.dir);
        }
        /* Сброс исходных краёв соседей: следующий ресайз стартует с чистого состояния.
           Здесь именно active.win: в ветке ресайза локальной переменной win нет,
           из-за чего mouseup падал и active не сбрасывался (ресайз «залипал»). */
        active.win.__splitPartner = null;
        allWins().forEach(rec => { rec.win.__splitPartner = null; rec.win.__origLeft = null; rec.win.__origRight = null; rec.win.__origGap = null; rec.win.__origGapE = null; rec.win.__origGapW = null; rec.win.__origGapN = null; rec.win.__origGapS = null; rec.win.__origTop = null; rec.win.__origBottom = null; });
      }
      if (active.kind === 'drag' && active.moved) active.win.__lastDragEnd = Date.now();
      if (active.kind === 'drag'){ active.win.__dragStartRect = null; active.win.__cornerDetached = false; }
      active.win.__lastSnap = null; /* сброс магнита после дропа */
      active.win.__splitPeek = null; /* предпросмотр стыка больше не нужен */
      active.win.classList.remove('aw-win--dragging');
      document.body.classList.remove('win-dragging');
      persistWins();
      /* Тень стыка: оставляем класс только если окно реально примыкает к соседу
         (иначе тень снова ляжет поверх соседнего окна) */
      syncSplitClasses();
      /* После ресайза окна чатов — пересчитать адаптивный класс (узкое окно) */
      try { active.win._chatNarrow && active.win._chatNarrow(); } catch(e){}
      active = null;
    }
  });

  function hasOpenWins(){
    return allWins().length > 0;
  }

  function hasMinimized(){
    return allWins().some(r => r.minimized);
  }

  function hasExpanded(){
    return allWins().some(r => !r.minimized);
  }

  function restoreAll(){
    let count = 0;
    Array.from(registry.keys()).forEach(route => {
      winsFor(route).forEach(rec => {
        if (rec.minimized){ unminimizeWin(route, rec.win); count++; }
      });
    });
    if (count) toast(`Развёрнуто окон: ${count}`, 'ok');
    return count;
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

  function minimizeAll(){
    const count = allWins().length;
    Array.from(registry.keys()).forEach(route => {
      winsFor(route).forEach(rec => { if (!rec.win._closing) minimizeWin(rec.win, route); });
    });
    toast(count ? `Свёрнуто окон: ${count}` : 'Нет открытых окон', 'info');
    return count;
  }

  /* Операции только для окон одного пункта меню: контекстное меню раздела
     не должно сворачивать/закрывать окна других разделов. */
  function minimizeRoute(route){
    const list = winsFor(route).filter(r => !r.minimized && !r.win._closing);
    list.forEach(r => minimizeWin(r.win, route));
    if (list.length) toast(`Свёрнуто окон раздела: ${list.length}`, 'ok');
    return list.length;
  }
  function hasMinimizedRoute(route){
    return winsFor(route).some(r => r.minimized);
  }
  function restoreRoute(route){
    const list = winsFor(route).filter(r => r.minimized && !r.win._closing);
    list.forEach(r => unminimizeWin(route, r.win));
    if (list.length) toast(`Развёрнуто окон раздела: ${list.length}`, 'ok');
    return list.length;
  }
  function closeRoute(route){
    const list = winsFor(route).slice();
    list.forEach(r => { if (!r.win._closing) closeWindow(route, r.win); });
    if (list.length) toast(`Закрыто окон раздела: ${list.length}`, 'ok');
    return list.length;
  }

  let customSeq = 0;
  function spawnCustom(opts){
    const route = (opts && opts.route) || ('__w' + (++customSeq));
    const win = spawn(route, (opts && opts.param) || null, opts || {});
    if (!win) return null;
    if (opts && opts.width) win.style.width = typeof opts.width === 'number' ? opts.width + 'px' : opts.width;
    if (opts && opts.height) win.style.height = typeof opts.height === 'number' ? opts.height + 'px' : opts.height;
    /* Виджеты (произвольные окна) по умолчанию появляются по центру экрана,
       если не заданы явные координаты. */
    if (!(opts && opts.param && typeof opts.param.x === 'number')){
      /* offsetWidth/offsetHeight игнорируют popIn (translateY + scale):
         по rect окно в момент анимации выглядит меньше и ниже, поэтому
         центрирование выходило смещённым на несколько пикселей. */
      win.style.left = Math.max(8, Math.round((window.innerWidth - win.offsetWidth) / 2)) + 'px';
      win.style.top = Math.max(8, Math.round((window.innerHeight - win.offsetHeight) / 2)) + 'px';
    }
    return win;
  }

  return { spawn, spawnCustom, refreshAllIndicators, hasWindow, isClosing, hasOpenWins, hasMinimized, hasExpanded, restoreAll, minimizeWin, restoreWindow, closeAll, minimizeAll, minimizeRoute, restoreRoute, hasMinimizedRoute, closeRoute, closeWindow, showPreview, restoreSavedWins };
})();

/* Браузер: const верхнего уровня не создаёт window.Windows — вешаем явно */
window.Windows = Windows;