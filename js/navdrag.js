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
    document.querySelectorAll('.menu-target-guide, .menu-drop-line').forEach(g => g.remove());
    const nav = document.querySelector('.side__nav');
    if (nav) nav.classList.remove('menu-drag-active');
    document.body.classList.remove('menu-dragging');
    drag = null; downTarget = null; downPos = null;
  }

  // Отмена: вернуть элемент на его прежнее место (по снимку)
  function cancel(){
    if (!drag) return;
    hideTargetGuide();
    hideDropLine();
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
    /* Подчищаем подсветку от предыдущего жеста, если она осталась висеть */
    document.querySelectorAll('.menu-target-guide, .menu-drop-line').forEach(x => x.remove());
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
    g.classList.add('is-on');
  }

  function hideGuide(){
    if (drag && drag.guide) drag.guide.classList.remove('is-on');
    document.querySelectorAll(guideSel).forEach(g => g.classList.remove('is-on'));
  }

  /* Элемент вьюпорта под курсором: окно целиком или карточка/панель. */
  const VIEW_TARGETS = '.aw-win, .card, .metric, .person-card, .o-card, .rev-card, .tbl-wrap, .chat-main, .settings-grid';
  function rectHas(r, cx, cy){
    return r.width > 0 && r.height > 0 && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  }
  function viewportTargetAt(cx, cy){
    if (cx < navRight()) return null;
    /* Контент во время драга инертен (pointer-events:none), поэтому
       elementFromPoint возвращает .shell. Ищем элемент по геометрии:
       сначала окна (верхнее — последнее в слое), затем карточки/панели. */
    const wins = [...document.querySelectorAll('#windows-layer .aw-win')]
      .filter(el => rectHas(el.getBoundingClientRect(), cx, cy));
    if (wins.length) return wins[wins.length - 1];
    const list = [...document.querySelectorAll(VIEW_TARGETS)]
      .filter(el => !el.classList.contains('aw-win') && rectHas(el.getBoundingClientRect(), cx, cy));
    return list[0] || null;
  }

  function ensureTargetGuide(){
    if (!drag) return null;
    if (drag.targetGuide) return drag.targetGuide;
    const g = document.createElement('div');
    g.className = 'menu-target-guide';
    g.innerHTML = '<span class="menu-target-corner"></span>';
    document.body.appendChild(g);
    drag.targetGuide = g;
    return g;
  }
  function updateTargetGuide(el, cx, cy){
    if (!el){ hideTargetGuide(); return; }
    const g = ensureTargetGuide();
    if (!g) return;
    const r = el.getBoundingClientRect();
    g.style.left = (r.left - 3) + 'px';
    g.style.top = (r.top - 3) + 'px';
    g.style.width = (r.width + 6) + 'px';
    g.style.height = (r.height + 6) + 'px';
    const isWin = el.classList.contains('aw-win');
    g.classList.toggle('has-corner', isWin);
    g.classList.add('is-on');
    const c = g.querySelector('.menu-target-corner');
    if (c){
      if (isWin){
        const size = 42;
        c.style.left = (r.width - size) + 'px';
        c.style.top = (r.height - size) + 'px';
        c.classList.toggle('is-hot', cx >= r.right - size && cy >= r.bottom - size);
      } else {
        c.classList.remove('is-hot');
      }
    }
    drag._viewTarget = el;
  }
  function hideTargetGuide(){
    const g = drag && drag.targetGuide;
    if (!g) return;
    g.classList.remove('is-on', 'has-corner');
    const c = g.querySelector('.menu-target-corner');
    if (c) c.classList.remove('is-hot');
    if (drag) drag._viewTarget = null;
  }

  /* Линия между пунктами: показывает точный зазор, куда встанет пункт. */
  function ensureDropLine(){
    if (!drag) return null;
    if (drag.dropLine) return drag.dropLine;
    const l = document.createElement('div');
    l.className = 'menu-drop-line';
    document.body.appendChild(l);
    drag.dropLine = l;
    return l;
  }
  function showDropLine(target, before){
    const l = ensureDropLine();
    if (!l) return;
    const tr = target.getBoundingClientRect();
    const nav = document.querySelector('.side__nav');
    const nr = nav ? nav.getBoundingClientRect() : tr;
    l.style.left = (nr.left + 8) + 'px';
    l.style.width = Math.max(0, nr.width - 16) + 'px';
    l.style.top = (before ? tr.top - 1 : tr.bottom - 1) + 'px';
    l.classList.add('is-on');
  }
  function hideDropLine(){
    const l = drag && drag.dropLine;
    if (l) l.classList.remove('is-on');
  }

  function dropTargetAt(cx, cy){
    const nav = document.querySelector('.side__nav');
    if (!nav) return null;
    const nr = nav.getBoundingClientRect();
    if (cx < nr.left || cx > nr.right || cy < nr.top || cy > nr.bottom) return null;
    const draggingSec = !!(drag && drag.el && drag.el.classList.contains('side__sec'));
    const sel = draggingSec ? '.side__sec' : '.side__link';
    let best = null, bestD = Infinity;
    for (const el of nav.querySelectorAll(sel)){
      if (!drag || el === drag.el) continue;
      const r = el.getBoundingClientRect();
      if (!r.height) continue;
      const d = cy < r.top ? r.top - cy : (cy > r.bottom ? cy - r.bottom : 0);
      if (d < bestD){ bestD = d; best = el; }
    }
    return bestD <= 12 ? best : null;
  }

  function position(cx, cy){
    if (!drag || !drag.el) return;
    const el = drag.el;
    const ew = el.offsetWidth || 160, eh = el.offsetHeight || 34;
    el.style.left = Math.max(4, Math.min(cx - ew/2, window.innerWidth - ew - 4)) + 'px';
    el.style.top = Math.max(4, Math.min(cy - Math.round(eh/2) - 4, window.innerHeight - eh - 4)) + 'px';
    const sEl = el.classList.contains('side__sec');
    const target = dropTargetAt(cx, cy);
    /* Линия вставки и реальный splice используют одно и то же «до/после»,
       поэтому пункт больше не уезжает на позицию выше подсветки. */
    drag._hover = target || null;
    if (target){
      const tr = target.getBoundingClientRect();
      drag._before = cy < tr.top + tr.height / 2;
      showDropLine(target, drag._before);
      hideTargetGuide();
      hideGuide();
    } else {
      drag._before = null;
      hideDropLine();
      /* Пункт над вьюпортом: подсвечиваем элемент под курсором пунктиром,
         как окно, и ведём заполненный призрак будущего окна. */
      if (!sEl && cx >= navRight()){
        updateTargetGuide(viewportTargetAt(cx, cy), cx, cy);
        showGuide(cx, cy);
      } else {
        hideTargetGuide();
        hideGuide();
      }
    }
  }

  function finish(cx, cy){
    if (!drag) return;
    hideTargetGuide();
    hideDropLine();
    const src = drag.el;
    const under = document.elementFromPoint(cx, cy);
    const navNow = document.querySelector('.side__nav');
    let target = null;
    /* Приоритет — подсвеченная цель. Пользователь отпускает там, где видел
       рамку, а elementFromPoint к моменту mouseup может попасть в соседний
       пункт (курсор на границе) и перестановка уходила «на одно выше». */
    if (drag._hover && drag._hover.isConnected && (!navNow || navNow.contains(drag._hover)) && drag._hover !== src){
      target = drag._hover;
    }
    if (!target && under && (!navNow || navNow.contains(under))){
      const link = under.closest('.side__link');
      const sec = under.closest('.side__sec');
      target = (link && link !== src) ? link : (sec && sec !== src ? sec : null);
    }
    /* Валидация: пункт принимается любой ссылкой (в т.ч. из другого раздела)
       и любым разделом (вставка в конец раздела); раздел — только разделом. */
    if (target){
      const tLink = target.classList.contains('side__link');
      const sSec = src.classList.contains('side__sec');
      /* Пункт → только пункт, раздел → только раздел. */
      if (tLink === sSec) target = null;
    }
    let moved = false;
    let reordered = false; /* порядок меню реально изменился (а не создано окно) */
    const V = window.NAV || [];
    const beforeJson = JSON.stringify(V);
    const persist = (el, ph) => { window.APP && window.APP._persistNav && window.APP._persistNav(el, ph); };

    if (target){
      // Перестановка в модели → _persistNav() перерисует меню в новом порядке
      if (src.classList.contains('side__sec')){
        const from = V.findIndex(x => x.sec === src.dataset.secTitle);
        if (from >= 0){
          const [s] = V.splice(from, 1);
          /* Индекс цели считаем ПОСЛЕ изъятия раздела: при переносе сверху
             вниз прежний индекс сдвигался на единицу, и раздел вставал не
             за целью, а на её место. Половина курсора решает «до/после». */
          const idx = V.findIndex(x => x.sec === target.dataset.secTitle);
          if (idx >= 0){
            const tr = target.getBoundingClientRect();
            const before = (drag._hover === target && drag._before != null) ? drag._before : (cy < (tr.top + tr.height / 2));
            V.splice(before ? idx : idx + 1, 0, s);
            moved = true; reordered = true;
          } else {
            V.splice(from, 0, s); /* цель пропала — вернуть раздел на место */
          }
        }
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
              const before = (drag._hover === target && drag._before != null) ? drag._before : (cy < (tr.top + tr.height / 2));
              toSec.items.splice(before ? toIdx : toIdx + 1, 0, item);
              moved = true; reordered = true;
            }
          }
          if (!moved && fromSec) fromSec.items.push(item);
        }
      }
    } else if (cx >= navRight() && src.classList.contains('side__link')){
      /* Бросок в подсказку сплита — окно сразу в нужной половине;
         иначе оставляем свободное окно по месту курсора. */
      try { Windows.spawn(src.dataset.route, { x: cx, y: cy, forceRight: true }); } catch(e){}
      moved = true;
    }
    /* Перестановка, которая вернула тот же порядок (например, дроп в свою же
       позицию), — не событие: без тоста и без перерисовки. */
    if (moved && reordered && JSON.stringify(V) === beforeJson){
      /* Цель подсвечена, но пункт уже стоял вплотную: меняемся местами,
         чтобы дроп на цель всегда давал видимый результат. */
      if (target && target.classList.contains('side__link') && !src.classList.contains('side__sec')){
        const sec = V.find(s => s.items.some(i => i.route === src.dataset.route)
                           && s.items.some(i => i.route === target.dataset.route));
        if (sec){
          const a = sec.items.findIndex(i => i.route === src.dataset.route);
          const b = sec.items.findIndex(i => i.route === target.dataset.route);
          if (a >= 0 && b >= 0 && a !== b){ [sec.items[a], sec.items[b]] = [sec.items[b], sec.items[a]]; }
        }
      }
      if (JSON.stringify(V) === beforeJson){ cancel(); return; }
    }
    if (moved){
      /* Плейсхолдер НЕ удаляем: _persistNav вернёт узел ровно на его место —
         тогда FLIP стартует из настоящей старой позиции. Если убрать
         плейсхолдер заранее, узел сначала прыгает в конец раздела, и меню
         анимируется даже при дропе справа (окно), где порядок не менялся. */
      if (drag.guide) drag.guide.remove();
      const nav = document.querySelector('.side__nav');
      if (nav) nav.classList.remove('menu-drag-active');
      const beforeOrder = drag._order;
      persist(src, drag.placeholder);
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