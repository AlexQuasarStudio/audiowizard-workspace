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

  /* Источники драга — ТОЛЬКО боковое меню. Внутри страницы настроек есть свои
     кнопки навигации с тем же классом .side__link (js/app.js:4986), их таскать
     нельзя: сужаем до прямых контейнеров бокового меню, чтобы подменю настроек
     не срывалось в драг. */
  const itemsSel = '.side__nav > .side__sec, .side__nav .side__sec-items > .side__link';
  const guideSel = '.aw-win-guide';

  // Снимок видимого порядка пунктов меню (для восстановления при отмене)
  const snapshot = () => Array.from(document.querySelectorAll('.side__nav > *'));

  /* Полный снимок меню до перестановки — для отката из тоста */
  const orderSnapshot = () => {
    try { return JSON.parse(JSON.stringify(window.NAV || [])); } catch(e){ return null; }
  };
  function restoreOrder(before){
    const V = window.NAV || [];
    if (!Array.isArray(before) || !before.length || !V.length) return false;
    V.splice(0, V.length, ...before);
    return true;
  }

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
    /* Перетаскиваемая плашка по ширине равна контейнеру меню-источника
       (а не гид-зоне): иначе гост растягивается на 560px и выглядит чужим. */
    /* Гость строго равен фактической ширине перетаскиваемого пункта в его
       текущем (развёрнутом/свёрнутом) состоянии — а не ширине плейсхолдера,
       которая может отличаться (свёрнутая колонка, отступы). */
    el.style.width = Math.round(r.width) + 'px';
    const guide = document.createElement('div');
    guide.className = 'aw-win-guide';
    guide.hidden = true;
    document.body.appendChild(guide);
    drag = { el, placeholder: ph, guide, _parent: parent, _order: orderSnapshot() };
    const nav = document.querySelector('.side__nav');
    if (nav) nav.classList.add('menu-drag-active');
    document.body.classList.add('menu-dragging');
    if (downPos) position(downPos.x, downPos.y);
  }

  function showGuide(x, y){
    const g = drag.guide;
    if (!g) return;
    const left = navRight() + 16;
    const avail = Math.max(0, window.innerWidth - left - 12);
    /* Гост-обводка показывает реальный размер окна (см. Windows.W_DEF/H_DEF
       в js/windows.js: 560×440), а не больше. Уменьшаем только когда место
       справа от меню не вмещает габарит. */
    const wUse = Math.min(560, avail), hUse = Math.min(440, window.innerHeight - 20);
    let gx = Math.max(left, x - wUse/2);
    gx = Math.min(gx, window.innerWidth - wUse - 12);
    let gy = Math.max(10, y - 24);
    gy = Math.min(gy, window.innerHeight - hUse - 10);
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
    const nav = document.querySelector('.side__nav');
    if (!nav) return null;
    const under = document.elementFromPoint(cx, cy);
    if (!under) return null;
    /* Цель  дропа — только навигация слева (.side__nav). Пункты с тем же классом
       .side__link вне меню (например, боковое подменю настроек) не являются
       целями и не должны подсвечиваться при драге. */
    if (!nav.contains(under)) return null;
    const link = under.closest('.side__link');
    if (link && link !== drag.el && nav.contains(link)) return link;
    const sec = under.closest('.side__sec');
    if (sec && sec !== drag.el && nav.contains(sec)) return sec;
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
    const sEl = el.classList.contains('side__sec');
    const target = dropTargetAt(cx, cy);
    /* Запоминаем подсвеченную цель: при отпускании она важнее повторного
       elementFromPoint — иначе дроп в зазор у края подсвеченной цели
       сбрасывался и пункт «возвращался на место». */
    drag._hover = target || null;
    if (target){
      const tLink = target.classList.contains('side__link');
      /* Пункт можно нести в любой раздел: подсвечиваем и ссылки, и разделы.
         Раздел-источник — только ссылки не принимает (цель-раздел допустима). */
      if (sEl && !tLink){ target.classList.add('menu-drop-hover-sec'); }
      if (!sEl && tLink){ target.classList.add('menu-drop-hover'); }
      if (!sEl && !tLink){ /* пункт держим над разделом — показываем как цель вставки */ target.classList.add('menu-drop-hover-sec'); }
    }
    /* Ghost окна (зона справа) — только для пунктов: разделы во вьюпорт не переносятся */
    if (!sEl && !target && cx >= navRight()){
      showGuide(cx, cy);
    } else {
      hideGuide();
    }
  }

  function finish(cx, cy){
    if (!drag) return;
    const src = drag.el;
    const under = document.elementFromPoint(cx, cy);
    const navNow = document.querySelector('.side__nav');
    let target = null;
    if (under && (!navNow || navNow.contains(under))){
      const link = under.closest('.side__link');
      const sec = under.closest('.side__sec');
      target = (link && link !== src) ? link : (sec && sec !== src ? sec : null);
    }
    /* Подсвеченная цель — приоритет: пользователь видел её и отпустил там. */
    if (!target && drag._hover && drag._hover.isConnected && (!navNow || navNow.contains(drag._hover))){
      target = drag._hover;
    }
    /* Валидация: пункт принимается любой ссылкой (в т.ч. из другого раздела)
       и любым разделом (вставка в конец раздела); раздел — только разделом. */
    if (target){
      const tLink = target.classList.contains('side__link');
      const sSec = src.classList.contains('side__sec');
      if (sSec && tLink) target = null;
    }
    let moved = false;
    let reordered = false; /* порядок меню реально изменился (а не создано окно) */
    const V = window.NAV || [];
    const beforeJson = JSON.stringify(V);
    const persist = (el) => { window.APP && window.APP._persistNav && window.APP._persistNav(el); };

    if (target){
      // Перестановка в модели → _persistNav() перерисует меню в новом порядке
      if (src.classList.contains('side__sec')){
        const from = V.findIndex(x => x.sec === src.dataset.secTitle);
        const to = V.findIndex(x => x.sec === target.dataset.secTitle);
        if (from >= 0 && to >= 0 && from !== to){ const [s] = V.splice(from, 1); V.splice(to, 0, s); moved = true; reordered = true; }
      } else if (src.classList.contains('side__link')){
        /* Переносим пункт в любой раздел: вынимаем из своего, вставляем в целевой */
        const fromSec = V.find(x => x.sec === src.dataset.sec);
        let item = null;
        if (fromSec){
          const fromIdx = fromSec.items.findIndex(x => x.route === src.dataset.route);
          if (fromIdx >= 0){ const r = fromSec.items.splice(fromIdx, 1); item = r[0]; }
        }
        if (item){
          if (target.classList.contains('side__link')){
            const toSec = V.find(x => x.sec === target.dataset.sec);
            const toIdx = toSec ? toSec.items.findIndex(x => x.route === target.dataset.route) : -1;
            if (toSec && toIdx >= 0){
              /* «Куда указал»: вставляем ДО или ПОСЛЕ цели по половине курсора.
                 Курсор выше середины цели — пункт ставится перед ней, ниже — после. */
              const tr = target.getBoundingClientRect();
              const before = cy < (tr.top + tr.height / 2);
              toSec.items.splice(before ? toIdx : toIdx + 1, 0, item);
              moved = true; reordered = true;
            }
          } else {
            /* бросок на раздел → в конец раздела */
            const toSec = V.find(x => x.sec === target.dataset.secTitle);
            if (toSec){ toSec.items.push(item); moved = true; reordered = true; }
          }
          if (!moved && fromSec) fromSec.items.push(item);
        }
      }
    } else if (cx >= navRight() && src.classList.contains('side__link')){
      // Дроп справа от меню → окно слева от правого края меню
      try { Windows.spawn(src.dataset.route, { x: cx, y: cy, forceRight: true }); } catch(e){}
      moved = true;
    }
    /* Перестановка, которая вернула тот же порядок (например, дроп в свою же
       позицию), — не событие: без тоста и без перерисовки. */
    if (moved && reordered && JSON.stringify(V) === beforeJson){ cancel(); return; }
    if (moved){
      /* Узел не удаляем: _persistNav вернёт его в меню и переставит без
         перерисовки контента вьюпорта. Placeholder больше не нужен. */
      if (drag.placeholder && drag.placeholder.isConnected) drag.placeholder.remove();
      if (drag.guide) drag.guide.remove();
      const nav = document.querySelector('.side__nav');
      if (nav) nav.classList.remove('menu-drag-active');
      const beforeOrder = drag._order;
      persist(src);
      drag = null; downTarget = null; downPos = null;
      document.body.classList.remove('menu-dragging');
      if (reordered && beforeOrder){
        toast('Порядок меню обновлён', 'ok', '', { action: { label:'Отменить', icon:'x-c', onClick: () => {
          if (restoreOrder(beforeOrder)) { persist(); toast('Порядок восстановлен', 'ok'); }
        } } });
      }
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
    if (drag){
      finish(e.clientX, e.clientY);
      /* Сброс сразу после завершения жеста: клик, которым ПОДТВЕРЖДАЛСЯ дроп,
         подавляется синхронно, а последующие клики (например, «Отменить» в тосте)
         проходят в обычном режиме. */
      setTimeout(() => { suppressClick = false; }, 0);
    }
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