/* ============================================================
   Audiowizard Workspace — drag-and-drop элементов меню
   Мгновенное открепление; реальный элемент следует за курсором;
   placeholder в стиле цели; окно справа от меню (guide).
   Мутация дерева только в момент дропа; порядок персистится через APP._persistNav()
   ============================================================ */
'use strict';

const NavDrag = (() => {
  let drag = null; /* { el, placeholder, guide, items: [...пары sec+el] } */
  let downTarget = null, downPos = null, suppressClick = false;

  const itemsSel = '.side__link, .side__sec[data-sec-title]';
  const guideSel = '.aw-win-guide';

  // Снимок видимого порядка пунктов меню (для восстановления при отмене)
  const snapshot = () => Array.from(document.querySelectorAll('.side__nav > *'));

  const navRight = () => {
    const side = document.querySelector('.side');
    return side ? side.getBoundingClientRect().right : 0;
  };

  // Полная очистка артефактов (классы, гайды, ховеры) без возврата элемента
  function cleanupAll(){
    document.querySelectorAll('.menu-drop-hover, .menu-drop-hover-sec').forEach(x => x.classList.remove('menu-drop-hover', 'menu-drop-hover-sec'));
    document.querySelectorAll(guideSel).forEach(g => g.remove());
    const nav = document.querySelector('.side__nav');
    if (nav) nav.classList.remove('menu-drag-active');
    document.body.classList.remove('menu-dragging');
    drag = null; downTarget = null; downPos = null;
  }

  // Отмена: вернуть элемент на его прежнее место (по снимку)
  function cancel(){
    if (!drag) return;
    const el = drag.el, ph = drag.placeholder;
    if (el){
      el.classList.remove('menu-drag-live');
      el.style.cssText = '';
      const nav = document.querySelector('.side__nav');
      // Если рендер прошёл (номера ссылок изменились) — старый el уже "гост", просто удаляем
      const navChanged = !drag._parent || !document.body.contains(drag._parent);
      if (ph && ph.isConnected){
        ph.parentNode.replaceChild(el, ph);
        el.style.position = '';
        el.style.zIndex = '';
        el.style.pointerEvents = '';
        el.style.margin = '';
        el.style.boxSizing = '';
      } else if (!navChanged){
        nav && nav.appendChild(el);
      } else {
        el.remove(); // нельзя вернуть — убрать гост
      }
    }
    cleanupAll();
  }

  function start(el){
    if (!el || !el.parentNode) return;
    const parent = el.parentNode;
    const r = el.getBoundingClientRect();
    const ph = document.createElement('div');
    ph.className = 'menu-drag-placeholder';
    /* Ширину НЕ фиксируем: плейсхолдер занимает ширину контейнера,
       как и живые ссылки-цели (в свёрнутом меню — узкая колонка, в развёрнутом — широкая) */
    ph.style.height = r.height + 'px';
    parent.insertBefore(ph, el);
    el.classList.add('menu-drag-live');
    el.setAttribute('draggable', 'false');
    document.body.appendChild(el);
    el.style.position = 'fixed';
    el.style.zIndex = '2502';
    el.style.pointerEvents = 'none';
    el.style.margin = '0';
    el.style.boxSizing = 'border-box';
    const guide = document.createElement('div');
    guide.className = 'aw-win-guide';
    guide.hidden = true;
    document.body.appendChild(guide);
    drag = { el, placeholder: ph, guide, _parent: parent };
    const nav = document.querySelector('.side__nav');
    if (nav) nav.classList.add('menu-drag-active');
    document.body.classList.add('menu-dragging');
    if (downPos) position(downPos.x, downPos.y);
  }

  function showGuide(x, y){
    const g = drag.guide;
    if (!g) return;
    const gw = 560, gh = 440;
    const W = window.innerWidth, H = window.innerHeight;
    const left = navRight() + 16;
    const avail = Math.max(0, W - left - 12);
    const wUse = Math.min(gw, avail), hUse = Math.min(gh, H - 20);
    let gx = Math.max(left, x - wUse/2);
    gx = Math.min(gx, W - wUse - 12);
    let gy = Math.max(10, y - 24);
    gy = Math.min(gy, H - hUse - 10);
    g.style.left = gx + 'px';
    g.style.top = gy + 'px';
    g.style.width = wUse + 'px';
    g.style.height = hUse + 'px';
    g.hidden = false;
  }

  function hideGuide(){
    if (drag && drag.guide) drag.guide.hidden = true;
    document.querySelectorAll(guideSel).forEach(g => g.hidden = true);
  }

  function dropTargetAt(cx, cy){
    const under = document.elementFromPoint(cx, cy);
    if (!under) return null;
    const link = under.closest('.side__link');
    if (link && link !== drag.el) return link;
    const sec = under.closest('.side__sec');
    if (sec && sec !== drag.el) return sec;
    return null;
  }

  function position(cx, cy){
    if (!drag || !drag.el) return;
    const el = drag.el;
    const ew = el.offsetWidth || 160, eh = el.offsetHeight || 34;
    el.style.left = Math.max(4, Math.min(cx - ew/2, window.innerWidth - ew - 4)) + 'px';
    el.style.top = Math.max(4, Math.min(cy - Math.round(eh/2) - 4, window.innerHeight - eh - 4)) + 'px';
    // подсветка цели
    document.querySelectorAll('.menu-drop-hover, .menu-drop-hover-sec').forEach(x => x.classList.remove('menu-drop-hover', 'menu-drop-hover-sec'));
    const target = dropTargetAt(cx, cy);
    if (target){
      const tLink = target.classList.contains('side__link');
      const sLink = el.classList.contains('side__link');
      if (tLink === sLink) target.classList.add(tLink ? 'menu-drop-hover' : 'menu-drop-hover-sec');
    }
    if (!target && cx >= navRight()){
      showGuide(cx, cy);
    } else {
      hideGuide();
    }
  }

  function finish(cx, cy){
    if (!drag) return;
    const src = drag.el;
    const under = document.elementFromPoint(cx, cy);
    let target = null;
    if (under){
      const link = under.closest('.side__link');
      const sec = under.closest('.side__sec');
      target = (link && link !== src) ? link : (sec && sec !== src ? sec : null);
    }
    // Валидация типа: link можно бросить только на link своего раздела, sec — только на sec
    if (target){
      const tLink = target.classList.contains('side__link');
      const sLink = src.classList.contains('side__link');
      if (tLink !== sLink || (tLink && target.dataset.sec !== src.dataset.sec)) target = null;
    }
    let moved = false;
    const V = window.NAV || [];
    const persist = () => { window.APP && window.APP._persistNav && window.APP._persistNav(); };

    if (target){
      // Перестановка в модели → _persistNav() перерисует меню в новом порядке
      if (src.classList.contains('side__sec')){
        const from = V.findIndex(x => x.sec === src.dataset.secTitle);
        const to = V.findIndex(x => x.sec === target.dataset.secTitle);
        if (from >= 0 && to >= 0 && from !== to){ const [s] = V.splice(from, 1); V.splice(to, 0, s); moved = true; }
      } else if (src.classList.contains('side__link')){
        const secObj = V.find(x => x.sec === src.dataset.sec);
        if (secObj){
          const fromIdx = secObj.items.findIndex(x => x.route === src.dataset.route);
          const toIdx = secObj.items.findIndex(x => x.route === target.dataset.route);
          if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx){ const [m] = secObj.items.splice(fromIdx, 1); secObj.items.splice(toIdx, 0, m); moved = true; }
        }
      }
    } else if (cx >= navRight() && src.classList.contains('side__link')){
      // Дроп справа от меню → окно слева от правого края меню
      try { Windows.spawn(src.dataset.route, { x: cx, y: cy, forceRight: true }); } catch(e){}
      moved = true;
    }
    if (moved){
      // Удалить перетаскиваемый элемент и placeholder (старые ссылки умрут с render в _persistNav)
      if (src.isConnected && src.parentNode === document.body) src.remove();
      if (drag.placeholder && drag.placeholder.isConnected) drag.placeholder.remove();
      if (drag.guide) drag.guide.remove();
      const nav = document.querySelector('.side__nav');
      if (nav) nav.classList.remove('menu-drag-active');
      persist();
      drag = null; downTarget = null; downPos = null;
      document.body.classList.remove('menu-dragging');
    } else {
      cancel();
    }
  }

  // mousedown: фиксируем точку старта
  document.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    suppressClick = false;
    const el = e.target.closest(itemsSel);
    if (!el) return;
    if (!document.body.contains(el)) return;
    /* draggable="false" у ссылок уже отменяет нативный drag; НЕ блокируем mousedown целиком,
       чтобы не мешать обычным кликам (навигация, фокус). */
    downPos = { x: e.clientX, y: e.clientY };
    downTarget = el;
  });
  // mousemove: как только мышь ушла на 5px — сразу открепляем и ведём
  document.addEventListener('mousemove', e => {
    if (downTarget && downPos && !drag){
      if (Math.abs(e.clientX - downPos.x) > 5 || Math.abs(e.clientY - downPos.y) > 5){
        suppressClick = true;      // двинули — это drag, а не клик
        start(downTarget);
      }
    } else if (drag){
      position(e.clientX, e.clientY);
    }
  });
  document.addEventListener('mouseup', e => {
    if (downTarget && !drag){ downTarget = null; downPos = null; return; }
    if (drag) finish(e.clientX, e.clientY);
    else { downTarget = null; downPos = null; }
  });
  /* Подавить обычный click после фактического перетаскивания */
  document.addEventListener('click', e => {
    if (suppressClick){
      e.preventDefault(); e.stopPropagation();
      suppressClick = false;
    }
  }, true);
  document.addEventListener('contextmenu', e => {
    if (e.target.closest('.side__nav')){
      e.preventDefault();
      if (window.APP && window.APP._navCtx) window.APP._navCtx(e);
    }
  });

  return { clear: cleanupAll };
})();