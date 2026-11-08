/* ============================================================
   Audiowizard Workspace — оболочка, роутер, роли, PWA
   ============================================================ */
'use strict';

const APP = (() => {

  /* ---------- Роутер ---------- */
  let route = { name:'dash', param:null };
  /* Скелетон НЕ показывается автоматически — только по требованию в тяжёлых/асинхронных
     операциях (showSkeleton). Длительность по умолчанию — для двойного клика по меню */
  const SKELETON_MS = 460;

  /* Эталон NAV для сброса порядка меню */
  const NAV_DEFAULT = [
    { sec:'Рабочее', items:[
      { route:'dash', title:'Дашборд', icon:'home', roles:['admin','top_manager','manager','executor','client'] },
      { route:'orders', title:'Заказы', icon:'orders', roles:['admin','top_manager','manager','executor','client'] },
      { route:'clients', title:'Клиенты', icon:'clients', roles:['admin','top_manager','manager'] },
      { route:'executors', title:'Исполнители', icon:'executors', roles:['admin','top_manager','manager'] },
      { route:'projects', title:'Проекты и папки', icon:'projects', roles:['admin','top_manager','manager','client'] }
    ]},
    { sec:'ИИ-сервисы', items:[
      { route:'ai-transcribe', title:'ИИ-стенограммы', icon:'mic', roles:['admin','top_manager','manager','executor','client'] },
      { route:'ai-texts', title:'ИИ-копирайтинг', icon:'edit', roles:['admin','top_manager','manager','executor','client'] },
      { route:'ai-translate', title:'ИИ-переводы', icon:'globe', roles:['admin','top_manager','manager','executor','client'] }
    ]},
    { sec:'Общение', items:[
      { route:'chats', title:'Чаты', icon:'chats', roles:['admin','top_manager','manager','executor','client'] },
      { route:'tickets', title:'Тикеты', icon:'tickets', roles:['admin','top_manager','manager'] },
      { route:'ideas', title:'Идеи', icon:'bulb', roles:['admin','top_manager','manager','executor','client'] },
      { route:'kanban', title:'Канбан', icon:'kanban', roles:['admin','top_manager','manager','executor'] }
    ]},
    { sec:'Инструменты', items:[
      { route:'tools', title:'Импорт / экспорт', icon:'import', roles:['admin','top_manager','manager'] },
      { route:'niches', title:'Ниши и специализации', icon:'palette', roles:['admin','top_manager','manager'] },
      { route:'audit', title:'Журнал аудита', icon:'terminal', roles:['admin','top_manager','manager'] },
      { route:'settings', title:'Настройки', icon:'settings', roles:['admin','top_manager','manager','executor','client'] }
    ]}
  ];

  let NAV = JSON.parse(JSON.stringify(NAV_DEFAULT));
  window.NAV = NAV; /* доступно для windows.js */
  window.NAV_DEFAULT = NAV_DEFAULT;

  function navFor(user){
    if (!user) return [];
    const hidden = (isProd() && S.settings.hiddenRoutes) || [];
    const custom = prefsFor().navCustomOrder;
    if (custom){
      /* Полностью кастомный порядок (перетаскивание) хранит СНИМОК ролей на момент
         настройки. Берём роли из NAV_DEFAULT по маршруту, иначе после расширения
         прав менеджеры продолжали видеть старое «только admin». */
      const rolesByRoute = new Map();
      NAV_DEFAULT.forEach(s => s.items.forEach(i => rolesByRoute.set(i.route, i.roles)));
      return custom.map(s => ({ sec:s.sec, items:(s.items||[])
        .map(i => ({ ...i, roles: rolesByRoute.get(i.route) || i.roles }))
        .filter(i => i.roles.includes(user.role) && !hidden.includes(i.route)) }))
        .filter(s => s.items && s.items.length);
    }
    return NAV.map(s => ({ sec:s.sec, items:s.items.filter(i=>i.roles.includes(user.role) && !hidden.includes(i.route)) })).filter(s=>s.items.length);
  }

  function go(name, param=null){
    /* мобильный drawer: закрыть при переходе */
    { const sd = document.querySelector('.side'); if (sd && sd.classList.contains('open')){ sd.classList.remove('open'); document.querySelector('.side-scrim')?.remove(); } }
    /* память скролла: позиция запоминается на раздел и восстанавливается */
    const scrollMem = window.__scrollMem || (window.__scrollMem = {});
    if (route.name) scrollMem[route.name] = window.scrollY;
    if (typeof AI !== 'undefined' && AI.stopPlayback) AI.stopPlayback();
    if (user()){
      const allowed = navFor(user()).some(s=>s.items.some(i=>i.route===name)) || name.startsWith('err');
      if (!allowed){ toast('Раздел недоступен для вашей роли','warn'); name = 'dash'; }
    }
    /* прод: раздел скрыт админом → дашборд */
    if (isProd() && (S.settings.hiddenRoutes||[]).includes(name) && name !== 'dash'){ toast('Раздел скрыт администратором в продакшене','warn'); name = 'dash'; }
    /* Предыдущий маршрут — для отката при двойном клике по меню */
    if (route.name && route.name !== name) window.__prevRoute = { name: route.name, param: route.param };
    route = { name, param };
    location.hash = '#/' + name + (param ? '/'+param : '');
    render();
    const dr = $('#app .side'); if (dr && dr.classList.contains('open')){ dr.classList.remove('open'); const sc = $('.side-scrim'); if (sc){ sc.classList.add('closing'); setTimeout(()=>sc.remove(), 320); } }
  }

  function parseHash(){
    const h = (location.hash||'').replace(/^#\/?/,'');
    if (!h) return null;
    const [name, param] = h.split('/');
    return { name: name||'dash', param: param||null };
  }

  /* ---------- Рендер оболочки ---------- */
  function user(){ return me(); }

  /* Настройки интерфейса — у каждого аккаунта свои: zen-режим, позиция
     плавающего аватара, свёрнутость меню и черновики не переходят между
     пользователями. До входа используем общий fallback. */
  function prefsFor(u2){
    u2 = u2 || user();
    if (!u2) return S.draftPrefs || (S.draftPrefs = {});
    if (!u2.prefs) u2.prefs = {};
    return u2.prefs;
  }

  function unreadTotal(){
    const u = user(); if (!u) return 0;
    let n = noDemo(S.notifs).filter(x=>!x.owner_id || (u && x.owner_id===u.id)).filter(x=>!(x.read||{})[u.id]).length;
    chatForUser(u).forEach(c=>{ const ui = chatUnreadUI(c, u.id); n += ui.count || 0; });
    if (isStaff(u.role)) n += noDemo(S.tickets).filter(t=>t.status==='new' && (t.created_at > (u.ticketsReadAt||0))).length;
    return n;
  }

  function renderShell(content){
    const u = user();
    const isMobile = window.matchMedia('(max-width:960px)').matches;
    document.body.classList.toggle('side-collapsed', !!prefsFor().sideCollapsed && !isMobile);
    document.body.classList.toggle('no-anim', !!(S.settings && S.settings.noAnim));
    const collapsed = document.body.classList.contains('side-collapsed');
    const nav = navFor(u);
    const unread = unreadTotal();

    const navScrollMem = document.querySelector('.side__nav')?.scrollTop || 0;
    /* #bg-doodles создаётся ОДИН раз в boot() и живёт вне #app: иначе каждый
       рендер (переход, перезагрузка) пересоздавал слой и дудлы «проявлялись
       на ходу» заново. */
    $('#app').innerHTML = `
      ${collapsed ? '' : ''}
      <div class="shell ${collapsed?'shell--collapsed':''}">
        <aside class="side" id="side">
          <div class="side__brand">
            <span class="side__brand-logo" id="brand-click" title="О программе" role="button" tabindex="0">${icon('logo-full')}</span>
            <span class="side__brand-name">${__t('nav.brand','Audiowizard')}<small>workspace</small></span>
            <button class="iconbtn side__close" id="side-close" aria-label="Закрыть меню" title="Закрыть">${icon('x')}</button>
            <button class="iconbtn side__burger" id="burger" aria-label="Меню" title="Свернуть/развернуть меню">${icon('menu')}</button>
          </div>
          <nav class="side__nav" data-tour="nav">
            ${nav.map(sec=>`<div class="side__sec ${prefsFor().closedSecs && prefsFor().closedSecs.includes(sec.sec)?'closed':''}" data-sec-title="${esc(sec.sec)}">${esc(sec.sec)}<svg class="ico ico-sm sec-arrow"><use href="#i-chev-d"/></svg></div><div class="side__sec-items" data-sec-items="${esc(sec.sec)}">${sec.items.map(it=>`
              ${(() => {
                /* Единый индикатор: точка окна и точка непрочитанных — одна и та же.
                   Раньше это были две разные точки в разных углах, и при закрытии
                   окна «точка» визуально телепортировалась наверх. */
                const isChats = it.route === 'chats';
                const isTickets = it.route === 'tickets' && isStaff(u.role);
                const cnt = isChats ? unreadChats(u) : isTickets ? noDemo(S.tickets).filter(t => t.status === 'new').length : 0;
                return `<a class="side__link ${route.name===it.route?'on':''}${cnt?' has-unread':''}" href="#/${it.route}" title="${esc(it.title)}" draggable="false" data-tour="${it.route==='orders'?'orders-link':''}" data-route="${esc(it.route)}" data-sec="${esc(sec.sec)}">
                ${icon(it.icon)}<span class="lbl">${it.title}</span><span class="win-dot"></span>
                ${cnt?`<span class="side__link__cnt">${cnt}</span>`:''}
              </a>`;
              })()}`).join('')}</div>`).join('')}
          </nav>
          <div class="side__foot">
            <button class="side__balance" id="side-balance" type="button" title="История баланса">
              <span class="side__balance-ico">${icon('card','ico-sm')}</span>
              <span class="side__balance-meta"><span>Баланс платформы</span><b>${fmtMoney(S.settings.demoEnabled === false ? 0 : (S.settings.balance || 0))}</b></span>
              <span class="side__balance-chev">${icon('chev-r','ico-sm')}</span>
            </button>
            <div class="side__user" id="side-user" data-tour="user">
              ${avatarHTML(u)}
              <span class="side__user-meta"><b>${esc(u.full_name)}</b><span>${ROLE_LABEL[u.role]}</span></span>
              <span class="side__user-arrow">${icon('chev-r','ico-sm')}</span>
            </div>
          </div>
        </aside>
        <header class="head">
          <div class="head__mtools" id="mobile-tools">
            <button class="iconbtn head__burger" id="mobile-menu" aria-label="Меню" title="Меню">${icon('menu')}</button>
            <button class="iconbtn head__msearch" id="m-search" aria-label="Поиск" title="Поиск">${icon('search')}</button>
          </div>
          <div class="head__search" data-tour="search" id="open-search">
            <div class="fake-input">${icon('search')}<input id="head-search-input" placeholder="Глобальный поиск…" autocomplete="off" spellcheck="false"><span class="kbd" id="head-search-hint">${fmtKeys(S.keys && S.keys.search)}</span></div>
          </div>
          <div class="head__right">
                        <div class="head__ops" id="head-actions">
              <button class="iconbtn head-actions__main" id="btn-new" title="Новый заказ (${fmtKeys(S.keys && S.keys.newOrder)})" aria-label="Новый заказ">${icon('cart')}</button>
              <button class="iconbtn head-actions__arrow" id="btn-actions-arrow" title="Выбрать действие" aria-label="Выбрать действие" aria-haspopup="true">${icon('chev-d','ico-sm')}</button>
            </div>
            <div class="head__pill head__pill--balance">
              <span class="head-balance" id="net-pill" title="Баланс платформы">${icon('card','ico-sm')}<b>${fmtMoney(S.settings.demoEnabled === false ? 0 : (S.settings.balance || 0))}</b></span>

              <span class="sep" aria-hidden="true"></span>
              <button class="iconbtn" id="btn-bell" data-tour="bell" aria-label="Уведомления"><span class="bell-ico">${icon('bell')}${unread?`<span class="bell-cnt">${unread>99?'99+':unread}</span>`:''}</span></button>
            </div>
          </div>
        </header>
        <div class="m-search-back" id="m-search-back" hidden></div>
        <main class="main view" id="main"></main>
        <footer class="foot">
          <a href="#/docs" data-doc="Пользовательское соглашение">Пользовательское соглашение</a>
          <a href="#/docs" data-doc="Политика конфиденциальности">Политика конфиденциальности</a>
          <a href="#/docs" data-doc="Правила сервиса">Правила сервиса</a>
          <a href="#/docs" data-doc="Справка и FAQ">Справка и FAQ</a>
          <span class="foot__ver">
            ${!((S.product||{}).beta === false) ? '<span class="beta-badge">Beta</span>' : ''}
            <span>v${esc((S.product||{}).version || '0.1-prototype')}</span>
            <button class="btn btn--ghost btn--sm" id="btn-update-check">${icon('refresh')} Обновления</button>
          </span>
        </footer>
      </div>`;

    { const nv = document.querySelector('.side__nav'); if (nv && navScrollMem) nv.scrollTop = navScrollMem; }
    { document.removeEventListener('scroll', window.__toTopHandler);
      window.__toTopHandler = () => { const tt = document.querySelector('.to-top'); if (tt) tt.classList.toggle('show', window.scrollY >= 500); };
      document.addEventListener('scroll', window.__toTopHandler, { passive: true });
      window.__toTopHandler();
    }
    /* Плашки и поиск прилипают к странице: едут вверх вместе со скроллом
       (после запаса 60px), плавно догоняя цель; при скролле вверх возвращаются. */
    { document.removeEventListener('scroll', window.__pillsHandler);
      window.__pTarget = 0;  /* целевое растворение 0..1 (0 = полностью видно) */
      window.__pOff = 0;     /* текущее плавное значение */
      window.__pRaf = 0;
      window.__pillsFrozen = false;
      window.__pMaxScroll = 0; /* самая глубокая позиция, с которой начался подъём */
      window.__pTurnAcc = 0;  /* накопленный прогресс проявления при подъёме (0..1) */
      if (window.__pillPrevY === undefined) window.__pillPrevY = window.scrollY;
      const ACC = 40;        /* первые 40px скролла плашки не трогают */
      const FADE = 80;       /* дистанция полного растворения при скролле ВНИЗ */
      const REVEAL = 120;    /* резерв: дистанция подъёма (не используется в позиционной модели) */
      const FADE_MS = 160;   /* плавность следования (экспоненциальное сглаживание) */
      /* В zen меню выезжает за 0.3s — плашки растворяются тем же темпом, чтобы
         движение было согласованным. В обычном режиме реакция быстрее. */
      const fadeMs = () => document.body.classList.contains('zen-toggling') ? 300 : FADE_MS;
      /* Слева на телефоне — такая же стеклянная плашка (меню + поиск):
         растворяется по той же логике, что и правые. На десктопе она скрыта
         (display:none), поэтому в работу списка фактически не попадает. */
      const pillEls = () => [document.querySelector('.head__right'), document.querySelector('#open-search'),
        document.querySelector('.head__mtools')].filter(Boolean);
      let pillLastT = 0;
      const pillTick = ts => {
        window.__pRaf = 0;
        const list = pillEls();
        if (!list.length) return;
        /* Сглаживание по ВРЕМЕНИ (а не по кадрам): при просадке FPS
           растворение всё равно доходит до цели за те же ~160мс. */
        const now = ts || performance.now();
        const dt = pillLastT ? Math.min(64, now - pillLastT) : 16.7;
        pillLastT = now;
        const k = Math.min(1, dt / fadeMs());
        window.__pOff += (window.__pTarget - window.__pOff) * k;
        if (Math.abs(window.__pTarget - window.__pOff) < 0.012) window.__pOff = window.__pTarget;
        /* Рисуем от ТЕКУЩЕГО значения __pOff, а не от цели __pTarget: иначе при
           сбросе (наведение/хоткей) плашки проявлялись МГНОВЕННО до конца —
           цель уже 0, а интерполяция __pOff ещё плавно шла к ней. */
        /* Пока открыт мобильный поиск, плашки не растворяются: поле поиска
           должно оставаться видимым на любом скролле. */
        const p = document.body.classList.contains('m-search-open') ? 0 : Math.min(1, Math.max(0, window.__pOff));
        list.forEach(el => {
          /* Растворение, а не уезд: плашки гаснут (opacity) с мягким
             размытием по мере скролла и так же проявляются обратно. */
          const fullyOut = p > 0.9;
          el.style.transform = '';
          el.style.opacity = p <= 0.001 ? '' : String(Math.max(0, 1 - p));
          el.style.filter = p <= 0.001 ? '' : `blur(${(p * 2).toFixed(2)}px)`;
          /* Клики недоступны только когда плашка почти растворилась;
             до этого наведение проявляет её полностью. */
          el.style.pointerEvents = p > 0.6 ? 'none' : '';
          el.dataset.pillHidden = fullyOut ? '1' : '';
          document.body.classList.toggle('pills-hide', fullyOut);
          document.body.classList.toggle('pills-move', false);
        });
        if (Math.abs(window.__pTarget - window.__pOff) > 0.005) window.__pRaf = requestAnimationFrame(pillTick);
        else pillLastT = 0;
      };
      const paint = t => {
        window.__pTarget = Math.min(1, Math.max(0, t));
        if (!window.__pRaf) window.__pRaf = requestAnimationFrame(pillTick);
      };
      const reveal = () => paint(0);
      window.__pillsReveal = reveal;
      const pillContainsActive = () => {
        const a = document.activeElement;
        if (!a || a === document.body) return false;
        return !!(a.closest && (a.closest('.head__search') || a.closest('.head__right') || a.closest('.head')));
      };
      /* Скролл: ПОЗИЦИОННОЕ растворение — симметрично в обе стороны.
         Вниз — плашки гаснут по мере удаления от верха; вверх — постепенно
         проявляются (чем ближе к верху, тем полнее). Никаких «прыжков». */
      /* Гибрид: вниз — позиционное растворение от верха (ACC..ACC+FADE);
         вверх — плавное проявление от самой глубокой точки (дистанция REVEAL).
         Плашки не «залипают» погашенными до самого верха и не прыгают
         при подъёме; у верха (y <= ACC) всегда полностью видимы. */
      /* Растворение плашек по ТЗ пользователя:
   - скролл ВНИЗ в любой позиции — плавный раствор;
   - скролл ВВЕРХ в любом месте — плавное проявление (никакой «защёлки»);
   - наведение на не до конца исчезнувшие / хоткей — плавно проявляются
     полностью, эффект СБРАСЫВАЕТСЯ: следующий скролл вниз отсчитывается
     с нуля (`__pillsAcc` = 0);
   - после полного раствора плашки неинтерактивны (pointer-events:none). */
      window.__pillsAcc = 0; /* накопленное растворение 0..1 (после сброса = 0) */
      const PILL_STEP = 1 / FADE; /* растворение на 1px скролла */
      window.__pillsHandler = () => {
        const y = window.scrollY;
        if (document.body.classList.contains('m-search-open')){ window.__pillsAcc = 0; paint(0); return; }
        const prev = (window.__pillPrevY == null) ? y : window.__pillPrevY;
        window.__pillPrevY = y;
        /* Настоящий скролл всегда «размораживает» плашки: если пользователь
           начал листать, плашки должны снова следовать за скроллом (гаснуть
           вниз, проявляться вверх) — даже если фокус/последний клик оставил
           __pillsFrozen = true (иначе плашка «залипала» после клика по ней). */
        if (window.__pillsFrozen && Math.abs(y - prev) > 0.5){
          window.__pillsFrozen = false;
        }
        if (window.__pillsFrozen) return;
        if (y <= ACC){ window.__pillsAcc = 0; paint(0); return; }
        const dy = y - prev;
        if (dy > 0) window.__pillsAcc = Math.min(1, window.__pillsAcc + dy * PILL_STEP);
        else if (dy < 0) window.__pillsAcc = Math.max(0, window.__pillsAcc + dy * PILL_STEP);
        paint(window.__pillsAcc);
      };
      /* Сброс эффекта: плавное полное проявление + следующий скролл вниз
         пойдёт с нуля (вызывается по наведению и по хоткею поиска). */
      const pillsReset = () => {
        window.__pillsAcc = 0;
        paint(0);
      };
      window.__pillsReset = pillsReset;
      /* Взаимодействие с плашками (наведение/клик/фокус) — окончательное проявление.
         Пока курсор или фокус на шапке, растворение заморожено; после ухода —
         снова следует за скроллом. document-слушатели навешиваем один раз. */
      if (!window.__pillsBound){
        window.__pillsBound = true;
        const isPill = el => !!(el && el.closest && el.closest('.head__search, .head__right, .head__mtools'));
        document.addEventListener('pointerover', e => {
          if (!isPill(e.target)) return;
          window.__pillHover = true;
          window.__pillsFrozen = true;
          /* Наведение на ещё не до конца исчезнувшие плашки: плавное полное
             проявление + СБРОС эффекта (следующий скролл вниз отсчитывается
             от нового положения). */
          pillsReset();
        }, true);
        document.addEventListener('pointerout', e => {
          if (!isPill(e.target)) return;
          const to = e.relatedTarget;
          if (to && to.closest && to.closest('.head__search, .head__right, .head__mtools')) return;
          window.__pillHover = false;
          setTimeout(() => {
            if (!window.__pillHover && !window.__pillContainsActive()){
              window.__pillsFrozen = false;
              window.__pillsHandler && window.__pillsHandler();
            }
          }, 0);
        }, true);
        document.addEventListener('pointerdown', e => {
          const pEl = e.target.closest && e.target.closest('.head__search, .head__right, .head__mtools, .head');
          if (!pEl) return;
          /* Невидимая плашка (полностью растворена) — не интерактивна:
             клик по ней (или по шапке, где она живёт) не должен её «будить».
             Приходит событие на .head-обёртке, поэтому проверяем по плашкам
             ВНУТРИ неё, а не по самой обёртке (обёртка всегда прозрачна). */
          const inner = pEl.matches('.head__search, .head__right, .head__mtools') ? pEl : pEl.querySelector('.head__search, .head__right, .head__mtools');
          const anyHidden = inner && parseFloat(getComputedStyle(inner).opacity) <= 0.15;
          if (anyHidden) return;
          window.__pillsFrozen = true;
        }, true);
        document.addEventListener('pointerup', () => {
          setTimeout(() => {
            if (!window.__pillHover && !window.__pillContainsActive()){
              window.__pillsFrozen = false;
              window.__pillsHandler && window.__pillsHandler();
            }
          }, 0);
        }, true);
        document.addEventListener('focusin', () => {
          if (!window.__pillContainsActive || !window.__pillContainsActive()) return;
          window.__pillsFrozen = true;
        }, true);
        document.addEventListener('focusout', () => {
          setTimeout(() => {
            if (!window.__pillHover && !window.__pillContainsActive()){
              window.__pillsFrozen = false;
              window.__pillsHandler && window.__pillsHandler();
            }
          }, 60);
        }, true);
      }
      window.__pillContainsActive = pillContainsActive;
      document.addEventListener('scroll', window.__pillsHandler, { passive: true });
      window.__pillsHandler();
    }
    const prevRouteName = window.__lastRouteName; window.__lastRouteName = route.name;
    $('#main').replaceChildren(content);
    /* Кнопка «Наверх» для длинных страниц */
    { document.querySelector('.to-top')?.remove();
      const tt = document.createElement('button');
      tt.className = 'to-top';
      tt.title = 'Наверх'; tt.setAttribute('aria-label', 'Наверх');
      tt.innerHTML = icon('chev-d');
      tt.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
      document.body.appendChild(tt);
    }
    { const mem = window.__scrollMem || {};
      requestAnimationFrame(() => {
        window.scrollTo(0, mem[route.name] || 0);
        /* После восстановления позиции плашки не должны никуда уезжать:
           накопление начинается с нуля и сработает только на новом скролле. */
        if (window.__pillsAcc !== undefined) window.__pillsAcc = 0;
        if (window.__pillsTarget !== undefined) window.__pillsTarget = 0;
        const pr = document.querySelector('.head__right');
        if (pr) pr.style.transform = '';
      });
    }
    /* Плавный вход вида при смене страницы.
   Скелетоны по умолчанию НЕ показываем: контент рендерится локально и мгновенно.
   Красивая заглушка доступна по требованию — showSkeleton(el, ms). */
    {
      const mainEl = $('#main');
      mainEl.classList.remove('view-in'); void mainEl.offsetWidth; mainEl.classList.add('view-in');
    }
    if (prefsFor().zen) applyZen(true, { skipFullscreen:true });
    const closeSideDrawer = ()=>{
      const side = $('#side');
      if (side) side.classList.remove('open');
      const sc = document.querySelector('.side-scrim');
      if (sc && !sc.classList.contains('closing')){
        sc.classList.remove('show');
        sc.classList.add('closing');
        setTimeout(()=>sc.remove(), 320);
      }
    };
    const openSideDrawer = ()=>{
      const side = $('#side');
      if (!side) return;
      /* Повторное нажатие на кнопку меню закрывает drawer, а не игнорируется */
      if (side.classList.contains('open')){ closeSideDrawer(); return; }
      side.classList.add('open');
      const sc = document.createElement('div'); sc.className = 'side-scrim';
      sc.onclick = ()=>closeSideDrawer();
      /* Scrim кладём внутрь .shell: у оболочки свой stacking context (z-index:1),
         и body-оверлей оказывался выше всей панели, перекрывая кнопку закрытия. */
      const host = document.querySelector('.shell') || document.body;
      host.appendChild(sc);
      requestAnimationFrame(()=>sc.classList.add('show'));
    };
    { const sc = $('#side-close'); if (sc) sc.onclick = e=>{ e.stopPropagation(); closeSideDrawer(); }; }
    /* Esc и возврат к десктопной ширине закрывают drawer */
    if (!window.__sideDrawerKeys){
      window.__sideDrawerKeys = true;
      document.addEventListener('keydown', e=>{
        if (e.key === 'Escape' && document.querySelector('.side.open')) closeSideDrawer();
      });
      const mq = window.matchMedia('(max-width:960px)');
      const onMq = ()=>{ if (!mq.matches) closeSideDrawer(); };
      if (mq.addEventListener) mq.addEventListener('change', onMq);
      else if (mq.addListener) mq.addListener(onMq);
    }
    $('#burger').onclick = ()=>{
      if (window.matchMedia('(max-width:960px)').matches){
        openSideDrawer();
      } else {
        const on = !document.body.classList.contains('side-collapsed');
        document.body.classList.toggle('side-collapsed', on);
        document.querySelector('.shell').classList.toggle('shell--collapsed', on);
        prefsFor().sideCollapsed = on;
        saveState();
        /* без render(): класс сам переводит рельс, CSS-анимация ширины не обрывается */
      }
    };
    { const mm = $('#mobile-menu'); if (mm) mm.onclick = ()=>{ if (window.matchMedia('(max-width:960px)').matches) openSideDrawer(); }; }
    $('#side-user').onclick = e=>userMenu(e.currentTarget);
    document.querySelectorAll('.foot a[data-doc]').forEach(a=>{
      a.onclick = ()=>{ window.__openDocTitle = a.dataset.doc; };
    });
    /* Логотип открывает то же окно «О приложении», что и пункт настроек */
    $('#brand-click').onclick = ()=>openAboutWin();
    $('#brand-click').onkeydown = e=>{ if (e.key==='Enter') openAboutWin(); };
    const sc2 = $('#side-collapse');
    sc2 && (sc2.onclick = e=>{ e.stopPropagation(); document.body.classList.toggle('side-collapsed'); document.querySelector('.shell').classList.toggle('shell--collapsed', document.body.classList.contains('side-collapsed')); prefsFor().sideCollapsed = document.body.classList.contains('side-collapsed'); saveState(); });
    { const sw = $('#open-search'), si = $('#head-search-input');
      if (sw && si){
        /* Поиск свёрнут в иконку и распахивается по клику (как раньше) */
        sw.onclick = ()=>{ sw.classList.add('is-open'); requestAnimationFrame(()=> si.focus()); };
        si.addEventListener('blur', ()=>{ if (!si.value.trim()) setTimeout(()=> sw.classList.remove('is-open'), 140); });
        si.addEventListener('keydown', e=>{ if (e.key === 'Escape'){ si.value = ''; si.blur(); sw.classList.remove('is-open'); } });
      } }
    /* Мобильный поиск: иконка в шапке распахивает поле во всю ширину
       поверх страницы, фон под ним размывается. */
    { const mb = $('#m-search'), mback = $('#m-search-back'), sw = $('#open-search'), si = $('#head-search-input');
      const closeM = ()=>{
        if (!document.body.classList.contains('m-search-open')) return;
        document.body.classList.remove('m-search-open');
        if (mback) mback.hidden = true;
        if (sw) sw.classList.remove('is-open');
        if (si) si.blur();
        window.__pillsFrozen = false;
        if (typeof closeHeaderSearch === 'function') closeHeaderSearch();
      };
      window.__closeMobileSearch = closeM;
      if (mb && sw && si) mb.onclick = ()=>{
        if (typeof closeSideDrawer === 'function') closeSideDrawer();
        /* Пока открыт поиск, поле должно быть видно ВСЕГДА: гасим эффект
           «плашки растворились при скролле» и замораживаем его до закрытия. */
        if (window.__pillsReset) window.__pillsReset();
        window.__pillsFrozen = true;
        document.body.classList.remove('pills-hide', 'm-head-fit');
        if (sw){ sw.style.opacity = ''; sw.style.filter = ''; sw.style.pointerEvents = ''; delete sw.dataset.pillHidden; }
        document.body.classList.add('m-search-open');
        if (mback) mback.hidden = false;
        sw.classList.add('is-open');
        /* Фокус сразу в обработчике клика: на iOS клавиатура открывается
           только при синхронном focus() — по таймеру вызов игнорируется. */
        try { si.focus({ preventScroll:true }); } catch(e){ si.focus(); }
        requestAnimationFrame(()=>{ if (document.body.classList.contains('m-search-open') && document.activeElement !== si) si.focus({ preventScroll:true }); });
      };
      if (mback) mback.onmousedown = e=>{ e.preventDefault(); closeM(); };
      /* При прокрутке вниз иконка поиска «заезжает» в кнопку меню: группа
         сжимается до одной кнопки. Возвращается, как только тянут вверх или
         страница вернулась к началу. Пока открыт поиск — не трогаем: поле
         должно быть на месте. */
      if (!window.__mHeadScroll){
        window.__mHeadScroll = true;
        let lastY = window.scrollY || 0, queued = false;
        const syncHead = ()=>{
          const y = window.scrollY || 0;
          const mobile = !window.matchMedia || window.matchMedia('(max-width:960px)').matches;
          const open = document.body.classList.contains('m-search-open');
          const fit = mobile && !open && (y > 32 ? y > lastY + 1 : false);
          const back = mobile && !open && (y <= 32 || y < lastY - 1);
          if (fit) document.body.classList.add('m-head-fit');
          else if (back) document.body.classList.remove('m-head-fit');
          if (!mobile || open) document.body.classList.remove('m-head-fit');
          lastY = y;
        };
        window.addEventListener('scroll', ()=>{
          if (queued) return;
          queued = true;
          requestAnimationFrame(()=>{ queued = false; syncHead(); });
        }, { passive:true });
        window.addEventListener('resize', syncHead);
        /* Открыли поиск — сразу возвращаем иконке место */
        const origClose = window.__closeMobileSearch;
        window.__closeMobileSearch = ()=>{ origClose && origClose(); syncHead(); };
        document.addEventListener('click', e=>{ if (e.target.closest('#m-search')) document.body.classList.remove('m-head-fit'); }, true);
      }
      if (!window.__mSearchBound){
        window.__mSearchBound = true;
        /* capture: обработчик поля в ui.js останавливает всплытие Escape */
        document.addEventListener('keydown', e=>{ if (e.key === 'Escape' && window.__closeMobileSearch) window.__closeMobileSearch(); }, true);
        window.addEventListener('hashchange', ()=>{ if (window.__closeMobileSearch) window.__closeMobileSearch(); });
        document.addEventListener('click', e=>{
          if (!document.body.classList.contains('m-search-open')) return;
          if (e.target.closest('.head-search-dd .palette__item')) setTimeout(()=>{ if (window.__closeMobileSearch) window.__closeMobileSearch(); }, 0);
        }, true);
      }
    }
    bindHeaderSearch();
    $('#btn-bell').onclick = ()=>toggleNotifPanel();
    { const sb = $('#side-balance'); if (sb) sb.onclick = ()=>{ closeSideDrawer(); showBalanceHistory(); }; }
    const netPill = $('#net-pill');
    if (netPill) netPill.onclick = ()=>{
      /* Повторный клик по балансу закрывает уже открытую плашку */
      const open = document.querySelector('.bal-panel');
      if (open){
        if (typeof open.__close === 'function') open.__close();
        else { open.classList.add('closing'); setTimeout(()=>open.remove(), 168); }
        return;
      }
      showBalanceHistory();
    };
    /* Быстрые действия: горячая кнопка (иконка = текущее действие) + стрелка-селектор.
       Клик по иконке запускает выбранное действие; список меняет выбор и иконку. */
    /* Быстрые действия есть у всех ролей, но набор свой. */
    const quickActions = (QUICK_BY_ROLE[u.role] || ['chats'])
      .map(id => id === '-' ? '-' : QA[id]).filter(Boolean);
    let quickSel = (quickActions.find(a => a !== '-') || {}).id;
    try { const qs = sessionStorage.getItem('aw_quick'); if (qs && quickActions.some(a=>a.id===qs)) quickSel = qs; } catch(e){}
    const quickSelAction = () => quickActions.find(a=>a.id===quickSel) || quickActions[0];
    window.runQuickSel = () => quickSelAction().run();
    const bnw = $('#btn-new');
    const setQuickIcon = () => {
      if (!bnw) return;
      const a = quickSelAction();
      bnw.innerHTML = icon(a.icon);
      /* Подсказка — только для действия «Новый заказ», актуальная из настроек */
      const hk = (a.id === 'order' && S.keys && S.keys.newOrder) ? ' (' + fmtKeys(S.keys.newOrder) + ')' : '';
      bnw.title = a.label + hk;
      bnw.setAttribute('aria-label', a.label);
    };
    if (bnw){
      setQuickIcon();
      bnw.onclick = e=>{ e.stopPropagation(); runQuickSel(); };
    }
    const baa = $('#btn-actions-arrow');
    if (baa){
      baa.onclick = e=>{
        e.stopPropagation();
        showDropdown(baa, quickActions.map(a=>{
          if (a === '-') return '-';
          return {
            label:a.label, icon:a.icon,
            onClick:()=>{
              /* Выбираем действие как горячее (меняет иконку) И сразу выполняем его */
              quickSel = a.id;
              try { sessionStorage.setItem('aw_quick', a.id); } catch(err){}
              setQuickIcon();
              a.run();
            }
          };
        }), { alignRight:true });
        /* Плашка СПИСКА быстрых действий: правый край совпадает с правым
           краем плашки иконок, сверху — лёгкий отступ. */
        const ddq = document.querySelector('.dd');
        const pillq = document.querySelector('.head__pill--balance');
        if (ddq && pillq && !ddq.classList.contains('emoji-panel')){
          const pr = pillq.getBoundingClientRect();
          const w = ddq.offsetWidth, h = ddq.offsetHeight;
          ddq.style.left = Math.max(10, Math.min(pr.right - w, window.innerWidth - w - 10)) + 'px';
          ddq.style.top = Math.min(pr.bottom + 4, window.innerHeight - h - 10) + 'px';
        }
      };
    }
    $('#btn-update-check').onclick = ()=>checkUpdates(true);
    
    /* Драг меню теперь в js/navdrag.js (NavDrag) */

    /* Клик по пункту меню: одинарный — мгновенный переход; двойной (второй клик
       во время skeleton-load, ~0.5с) — открыть раздел в отдельном окне
       (всегда НОВОЕ окно, даже если уже есть). */
    $$('a.side__link', document).forEach(a=>a.addEventListener('click', e=>{
      e.preventDefault();
      const rt = a.getAttribute('href').slice(2);
      const now = Date.now();
      /* Двойной клик по тому же пункту — ВСЕГДА новое окно раздела,
         даже если окна этого раздела уже есть. */
      if (window.__navDbl && window.__navDbl.route === rt && (now - window.__navDbl.t) < SKELETON_MS){
        const from = window.__navDbl.from;   /* сохранить ДО обнуления */
        window.__navDbl = null;
        clearTimeout(window.__navDblTimer);
        try { Windows.spawn(rt); } catch(err){}
        if (from && from !== rt && from !== route.name){ go(from); }
        return;
      }
      window.__navDbl = { route: rt, t: now, from: route.name };
      clearTimeout(window.__navDblTimer);
      window.__navDblTimer = setTimeout(() => { window.__navDbl = null; }, SKELETON_MS + 60);
      /* У пункта есть СВЁРНУТЫЕ окна — первый клик разворачивает их.
         Если все окна уже развёрнуты — переходим в раздел. */
      if (window.Windows && Windows.hasWindow && Windows.hasWindow(rt)
          && Windows.hasMinimized && Windows.hasMinimized()){
        try { Windows.restoreAll(); } catch(err){}
        return;
      }
      go(rt);
    }));
    $$('.side__sec[data-sec-title]', document).forEach(sec=>{
      sec.addEventListener('click', ()=>{
        sec.classList.toggle('closed');
        const items = document.querySelector(`.side__sec-items[data-sec-items="${sec.dataset.secTitle}"]`);
        if (items){ items.style.overflow = 'hidden';
          /* Схлопывание должно идти от фактической высоты: после раскрытия
             maxHeight стоял 'none', а none → 0px не анимируется — раздел
             закрывался рывком. Фиксируем высоту, затем ведём к нулю. */
          if (sec.classList.contains('closed')){
            items.style.maxHeight = items.scrollHeight + 'px';
            void items.offsetHeight;
            items.style.maxHeight = '0px';
          } else {
            items.style.maxHeight = items.scrollHeight + 'px';
            setTimeout(()=>{ items.style.maxHeight = 'none'; }, 320);
          }
        }
        prefsFor().closedSecs = prefsFor().closedSecs || [];
        const title = sec.dataset.secTitle;
        if (sec.classList.contains('closed')){ if (!prefsFor().closedSecs.includes(title)) prefsFor().closedSecs.push(title); }
        else prefsFor().closedSecs = prefsFor().closedSecs.filter(x => x !== title);
        saveState();
      });
    });
    /* Восстановить индикаторы-точки окон на ссылках после перерисовки меню */
    if (window.Windows && Windows && Windows.refreshAllIndicators) Windows.refreshAllIndicators();
  }

  function unreadChats(u){
    return chatForUser(u).reduce((a,c)=>{ const ui = chatUnreadUI(c, u.id); return a + (ui.count||0); },0);
  }

  /* Эффективный режим темы: если system — фактический по ОС */
  function effMode(u){
    if ((u.mode||'system') !== 'system') return u.mode;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  /* Быстрые действия — единый список для обычного режима и zen */
const QA = {
  order:      { id:'order',      label:'Новый заказ',           icon:'cart',      run:()=>CRM.openOrderForm() },
  calc:       { id:'calc',       label:'Калькулятор услуг',     icon:'calc',      run:()=>CRM.openCalculator() },
  client:     { id:'client',     label:'Добавить клиента',      icon:'user-plus', run:()=>CRM.openPersonForm('client', null) },
  executor:   { id:'executor',   label:'Добавить исполнителя',  icon:'user-plus', run:()=>CRM.openPersonForm('executor', null) },
  chats:      { id:'chats',      label:'Новый чат',             icon:'chats',     run:()=>{ try { Windows.spawn('chats'); } catch(err){ go('chats'); } } },
  transcribe: { id:'transcribe', label:'ИИ-стенограммы',        icon:'mic',       run:()=>go('ai-transcribe') },
  texts:      { id:'texts',      label:'ИИ-копирайтинг',        icon:'edit',      run:()=>go('ai-texts') },
  translate:  { id:'translate',  label:'ИИ-переводы',           icon:'globe',     run:()=>go('ai-translate') },
  myorders:   { id:'myorders',   label:'Мои заказы',            icon:'orders',    run:()=>go('orders') },
  ticket:     { id:'ticket',     label:'Обращение в поддержку', icon:'tickets',   run:()=>CRM.openTicket() },
  report:     { id:'report',     label:'Сообщить о проблеме',   icon:'alert',     run:()=>reportProblem() },
  invite:     { id:'invite',     label:'Пригласить в приложение', icon:'user-plus', run:()=>{ if (window.openInvites) window.openInvites(); else toast('Приглашения — в разделе «Люди»','info'); } },
  kanban:     { id:'kanban',     label:'Канбан задач',          icon:'kanban',    run:()=>go('kanban') },
  team:       { id:'team',       label:'Исполнители',           icon:'executor',  run:()=>go('executors') }
};
const QUICK_BY_ROLE = {
  admin:       ['order','calc','client','executor','-','chats','transcribe','texts','translate','-','invite','report'],
  top_manager: ['order','calc','client','executor','-','chats','transcribe','texts','translate','-','invite','report'],
  manager:     ['order','calc','client','-','chats','texts','kanban','-','invite','report'],
  client:      ['order','-','chats','ticket','report'],
  executor:    ['myorders','-','chats','transcribe','translate','ticket','invite']
};

  function userMenu(anchor){
    const u = user();
    const isZen = document.body.classList.contains('zen');
    /* В zen — те же быстрые действия, что в обычном режиме, и всегда сверху */
    const quickNow = (QUICK_BY_ROLE[u.role] || ['chats'])
      .map(id => id === '-' ? '-' : QA[id]).filter(Boolean);
    const items = [
      { label:u.full_name, header:true },
      { label:'Профиль', icon:'clients', onClick:()=>go('settings','profile') },
      { label:'Настройки', icon:'settings', hint:'Ctrl+,', onClick:()=>go('settings') },
      { label:'Тема: '+(MODE_LABEL[effMode(u)]), icon:'palette', hint:'Ctrl+Shift+Y', keepOpen:true, onClick:(it)=>{ cycleTheme(true); it.label = 'Тема: '+(MODE_LABEL[effMode(user())]); } },
      { label:'Акцент: '+(ACCENT_LABEL[u.accent||'violet']), icon:'sparkle', keepOpen:true, onClick:(it)=>{ const list = ACCENT_LIST; u.accent = list[(list.indexOf(u.accent||'violet')+1)%list.length]; saveState(); applyTheme(u.mode,u.accent); it.label = 'Акцент: '+ACCENT_LABEL[u.accent]; toast('Акцент: '+ACCENT_LABEL[u.accent],'info'); } },
      ...(document.body.classList.contains('zen') ? [{ label:'Показать меню', icon:'shrink', onClick:()=>toggleZen() }]:[]),
      ...(!document.body.classList.contains('zen') ? [{ label:'Полноэкранный режим', icon:'expand', hint:'скрыть меню и топбар', onClick:()=>toggleZen() }]:[]),
      '-',
      /* «Быстрые действия» — раскрывающийся пункт (как раньше): при наведении
         показывает подменю, клик закрепляет. В подменю — быстрые действия +
         пункты меню (разделы). Только в zen (плашка по аватару); в обычном
         режиме подменю не нужно — быстрые действия есть в верхней плашке. */
      ...(isZen ? [{ label:'Быстрые действия', icon:'chev-r', hint:'', submenu:true, keepOpen:true }, '-'] : []),
      { label:'Выйти', icon:'exit', danger:true, onClick:()=>logout() }
    ];
    const dd = showDropdown(anchor, items);
    if (!dd) return;
    /* Подменю быстрых действий: наведение — показать, клик — закрепить/открепить */
    const qBtn = dd.querySelector('[data-i="'+items.indexOf(items.find(it=>it.label==='Быстрые действия'))+'"]');
    if (qBtn){
      let subDD = null, pinned = false, hoverTimer = null, subItems = null;
      /* Подменю гаснет так же плавно, как и появляется (в zen это заметно:
         раньше плашка исчезала рывком). */
      const removeSub = () => {
        if (!subDD) return;
        const el = subDD; subDD = null;
        el.classList.add('closing');
        el.style.pointerEvents = 'none';
        setTimeout(()=>el.remove(), 170);
      };
      const buildSub = () => {
        if (subDD) { subDD.remove(); subDD = null; }
        /* Быстрые действия (те же, что в плашке иконок) + пункты меню (разделы) */
        const acts = [
          ...quickNow.map(a => a === '-' ? { sep:true } : ({ label:a.label, icon:a.icon, onClick:()=>{ removeSub(); closeDropdown(); a.run(); } })),
          ...(quickNow.some(a => a !== '-') ? [{ header:true, label:'Разделы' }] : []),
          ...navFor(u).flatMap(sec => sec.items.map(it => ({ label:it.title, icon:it.icon, onClick:()=>{ removeSub(); closeDropdown(); go(it.route); } })))
        ];
        subItems = acts.filter(a => !a.header && !a.sep);
        subDD = document.createElement('div');
        subDD.className = 'dd';
        subDD.style.maxHeight = '70vh';
        subDD.style.overflowY = 'auto';
        subDD.innerHTML = acts.map(it => {
          if (it.header) return `<div class="dd__label">${esc(it.label)}</div>`;
          if (it.sep) return '<div class="dd__sep"></div>';
          return `<button class="dd__item" data-i>${it.icon?icon(it.icon):''}<span style="flex:1">${esc(it.label)}</span></button>`;
        }).join('');
        document.body.appendChild(subDD);
        const r = qBtn.getBoundingClientRect();
        let left = r.right + 6, top = r.top;
        if (left + subDD.offsetWidth > window.innerWidth - 10) left = r.left - subDD.offsetWidth - 6;
        subDD.style.left = left+'px';
        subDD.style.top = Math.max(10, Math.min(top, window.innerHeight - subDD.offsetHeight - 10))+'px';
        subDD.addEventListener('click', e => {
          const b = e.target.closest('[data-i]');
          if (!b) return;
          const idx = [...subDD.querySelectorAll('[data-i]')].indexOf(b);
          if (idx >= 0 && subItems[idx]) subItems[idx].onClick();
        });
        subDD.addEventListener('mouseenter', () => { clearTimeout(hoverTimer); });
        subDD.addEventListener('mouseleave', () => { if (!pinned) hoverTimer = setTimeout(removeSub, 250); });
      };
      qBtn.addEventListener('mouseenter', () => { clearTimeout(hoverTimer); if (!pinned) buildSub(); });
      qBtn.addEventListener('mouseleave', () => { if (!pinned) hoverTimer = setTimeout(removeSub, 250); });
      qBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (pinned){ pinned = false; removeSub(); return; }
        pinned = true; clearTimeout(hoverTimer);
        if (!subDD) buildSub();
      });
      const closeAll = (e) => {
        if (pinned && subDD && !subDD.contains(e.target) && e.target !== qBtn && !qBtn.contains(e.target) && e.target !== dd && !dd.contains(e.target)) {
          pinned = false; removeSub(); closeDropdown();
        }
      };
      document.addEventListener('pointerdown', closeAll);
    }
  }

  /* ---------- О программе (модалка по клику на логотип) ---------- */
  /* Состояние серверов в «О приложении» (только staff). Прототип: значения
     условные; в проде — реальные метрики кластера и очереди синхронизации. */
  function serverStateHtml(){
    const p = S.product || {};
    const cur = { name:'msk-1 (текущий)', region:'Москва', status:'онлайн', ping:12, cpu:34, ram:58, disk:41, online:24, uptime:'17д 4ч', db:'PostgreSQL 16', sync:'синхронизирован', last:'12 сек назад' };
    const others = [
      { name:'msk-2', region:'Москва', status:'онлайн', ping:18, cpu:47, ram:61, disk:52, online:19 },
      { name:'spb-1', region:'Санкт-Петербург', status:'онлайн', ping:27, cpu:22, ram:39, disk:33, online:11 },
      { name:'fra-1', region:'Франкфурт', status:'замедлен', ping:86, cpu:73, ram:81, disk:64, online:7 }
    ];
    const dot = s => s==='онлайн' ? 'var(--green)' : 'var(--yellow)';
    const bar = (label, v, color) => `<div style="display:flex;align-items:center;gap:8px"><span class="small faint" style="width:56px;flex:none">${label}</span><span style="flex:1;height:6px;border-radius:99px;background:var(--border);overflow:hidden"><span style="display:block;height:100%;width:${Math.max(0,Math.min(100,v))}%;background:${color};border-radius:99px"></span></span><b class="small" style="width:34px;text-align:right">${v}%</b></div>`;
    return `<div class="card card-pad" style="background:var(--bg-2)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <b class="small" style="letter-spacing:.05em;text-transform:uppercase;font-size:10.5px;color:var(--muted)">Серверы и синхронизация</b>
        <span class="small faint" style="margin-left:auto">кластер · ${others.length+1}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span class="dot" style="width:8px;height:8px;border-radius:50%;display:inline-block;background:${dot(cur.status)};flex:none"></span>
        <b class="small">${esc(cur.name)}</b>
        <span class="small faint">${esc(cur.region)} · ${esc(cur.status)} · ${cur.ping} мс</span>
      </div>
      <div class="stack" style="gap:6px;margin-bottom:8px">
        ${bar('CPU', cur.cpu, 'var(--accent)')}
        ${bar('RAM', cur.ram, 'var(--yellow)')}
        ${bar('Диск', cur.disk, 'var(--green)')}
      </div>
      <div class="small faint" style="line-height:1.6">Онлайн: <b>${cur.online}</b> · аптайм ${esc(cur.uptime)} · БД ${esc(cur.db)}<br>Синхронизация: <b style="color:var(--green)">${esc(cur.sync)}</b>, последняя ${esc(cur.last)}<br>Версия ${esc(p.version||'0.1-prototype')} · сборка ${esc(String(p.build||''))}</div>
      <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px">
        <div class="small faint" style="margin-bottom:4px">Другие серверы</div>
        ${others.map(o=>`<div style="display:flex;align-items:center;gap:8px;padding:2px 0"><span class="dot" style="width:8px;height:8px;border-radius:50%;display:inline-block;background:${dot(o.status)};flex:none"></span><b class="small" style="min-width:58px">${esc(o.name)}</b><span class="small faint">${esc(o.region)} · ${o.ping} мс · CPU ${o.cpu}% · онлайн ${o.online}</span></div>`).join('')}
      </div>
      <div class="small faint" style="margin-top:8px">Прототип: значения условные. В проде — реальные метрики кластера, репликации и очереди синхронизации.</div>
    </div>`;
  }

  function aboutWindowHTML(opts){
      const o = opts || {};
      const logoBtn = !!o.logoButton;
      /* Компактная модалка (по клику на лого): только шапка и серверы.
         История версий, модели развертывания и лишние кнопки остаются
         в полном разделе настроек. */
      const modal = !!o.modal;
      const models = modal ? '' : `<div class="card card-pad"><h3 style="margin-bottom:12px">Модели развертывания</h3>
        <div class="cols-2 grid">
          <div class="card card-pad" style="background:var(--bg-2)"><div class="row">${icon('cloud')}<b>On-Demand (SaaS)</b><span class="badge c-green">активна</span></div>
            <p class="small muted" style="margin-top:8px">Облачная модель: только браузер и интернет. AI-сервисы по подписке.</p></div>
          <div class="card card-pad" style="background:var(--bg-2)"><div class="row">${icon('server')}<b>On-Premise</b><span class="badge c-gray">в разработке</span></div>
            <p class="small muted" style="margin-top:8px">Локальное развертывание в контуре клиента: Docker, лицензия, защищённый репозиторий обновлений.</p></div>
        </div></div>`;
      /* Патчноуты: один и тот же отфильтрованный список для истории в настройках
         и для «последнего обновления» в компактной модалке. Свежие — сверху. */
      const changelogList = () => S.changelog
        .filter(v => !isProd() ? true : (v.id==='v0' || v.id==='cur' || !v.demo))
        .slice()
        .sort((a,b)=> (b.created_at||0)-(a.created_at||0));
      const noteHtml = v => `<div class="ver-item"><span class="ver-badge">v${esc(v.version)}</span>
          <span><b class="small">${esc(v.title)}</b>${v.content?`<p class="small muted" style="margin-top:3px">${esc(v.content).replace(/\n/g,'<br>')}</p>`:''}<span class="faint" style="font-size:11px">${fmtDate(v.created_at)}</span></span></div>`;
      const history = modal ? '' : `<div class="card card-pad"><h3 style="margin-bottom:6px">История обновлений</h3>
        ${changelogList().map(noteHtml).join('')}</div>`;
      /* Модалка по клику на лого: полной истории там не место, но последняя
         запись патчноутов должна быть видна — она и была раньше. */
      const latestNote = (()=>{
        if (!modal) return '';
        const list = changelogList();
        /* «Прототип» — это ПЕРВАЯ версия, а не последнее обновление: берём
           самую свежую настоящую запись, v0 — только если других нет
           (например, в прод-режиме демо-записи скрыты). */
        const v = list.find(x => x.id !== 'v0') || list[0];
        if (!v) return '';
        return `<div class="card card-pad"><h3 style="margin-bottom:6px">Последнее обновление</h3>${noteHtml(v)}</div>`;
      })();
      const issue = modal ? '' : `<div class="card card-pad" style="border-color:color-mix(in srgb,var(--accent) 30%,transparent)"><h3 style="margin-bottom:6px">Сообщить о проблеме</h3>
        <p class="small muted" style="margin-bottom:10px">Что-то работает не так или есть идея? Напишите парой строк — мы получим сообщение.</p>
        <div class="field"><input class="input" id="ab-issue" placeholder="Коротко: что случилось или что улучшить"></div>
        <div class="field" style="margin-top:8px"><textarea class="input" id="ab-issue-detail" rows="2" placeholder="Подробности (необязательно)"></textarea></div>
        <div class="row" style="gap:8px;margin-top:8px"><button class="btn btn--primary btn--sm" id="ab-issue-send">${icon('send')} Отправить</button><span class="small faint" id="ab-issue-msg"></span></div></div>`;
      return `<div class="card card-pad row" style="gap:16px">
        ${logoBtn
          ? `<button type="button" class="about-section__logo" id="ab-open" title="Открыть «О приложении»" aria-label="Открыть «О приложении»"><span class="side__brand-logo logo-mark--lg">${icon('logo-full')}</span></button>`
          : `<span class="side__brand-logo logo-mark--lg">${icon('logo-full')}</span>`}
        <div><b style="font-size:16px">Audiowizard Workspace</b><div class="small muted">Версия ${esc((S.product||{}).version || '0.1-prototype')} · сборка ${(S.product||{}).build || 216} ${((S.product||{}).beta !== false)?'<span class="beta-badge">Beta</span>':''}</div></div>
        ${modal ? '' : `<span class="spacer"></span><button class="btn btn--soft btn--sm" id="ab-tour">${icon('bulb')} Пройти тур</button><button class="btn btn--soft btn--sm" id="ab-check">${icon('refresh')} Проверить обновления</button>`}</div>
      ${latestNote}
      ${isStaff((me() || {}).role) ? serverStateHtml() : ''}
      ${models}${history}${issue}`;
    }

  /* Раздел настроек — тот же состав, что и в окне «О приложении»:
     серверы, модели развертывания, история обновлений и обращение.
     Логотип в шапке — кнопка: открывает модалку с размытым фоном. */
  function aboutSectionHTML(){
    return `<div class="stack about-body">${aboutWindowHTML({ logoButton:true })}</div>`;
  }

  /* «О приложении» — окно поверх интерфейса: открывается и из настроек,
     и кликом по лого. */
  let aboutWin = null;
  function openAboutWin(){
    if (aboutWin && aboutWin.el && aboutWin.el.isConnected) return;
    /* Обычная модалка с затемнением и размытием фона (как было раньше),
       а не плавающее окно оконного менеджера. */
    aboutWin = openModal({
      title:'О приложении', wide:true,
      body:`<div class="stack about-body" id="about-win">${aboutWindowHTML({ modal:true })}</div>`,
      onMount:(el)=>{ bindAboutWindow(el, me() || {}); },
      onClose:()=>{ aboutWin = null; }
    });
  }

  /* Привязка полей окна «О приложении» (тур, проверка обновлений, обращение).
     Вынесена из settingsView: окно открывается и кнопкой в меню, и по лого. */
  function bindAboutWindow(el, u2){
    if (!el) return;
    const uu = u2 || me() || {};
    const t = $('#ab-tour', el), c = $('#ab-check', el), snd = $('#ab-issue-send', el);
    if (t) t.onclick = ()=>{ uu.tour_completed=false; saveState(); startTour(0); };
    if (c) c.onclick = ()=>checkUpdates(true);
    if (snd) snd.onclick = ()=>{
      const subj = ($('#ab-issue', el).value || '').trim();
      if (!subj){ toast('Опишите проблему в одном предложении','warn'); return; }
      const detail = ($('#ab-issue-detail', el).value || '').trim();
      S.tickets.unshift({ id:uid(), user_id:uu.id, subject:subj, message:detail||subj, order_id:null, status:'new', created_at:Date.now(), resolved_at:null });
      logAudit('Обращение из «О приложении»: '+subj, 'Тикет');
      saveState(); $('#ab-issue', el).value = ''; $('#ab-issue-detail', el).value = '';
      $('#ab-issue-msg', el).textContent = 'Отправлено, спасибо!';
      toast('Сообщение отправлено — мы получили его','ok');
    };
  }

  /* ---------- Уведомления ---------- */
  function toggleNotifPanel(){
    const ex = $('.notif-panel');
    if (ex){
      /* Плавное закрытие вместо мгновенного remove() */
      ex.classList.add('closing');
      setTimeout(()=>ex.remove(), 180);
      return;
    }
    const u = user();
    const panel = document.createElement('div');
    panel.className = 'notif-panel';
    /* Группировка уведомлений по пунктам: Все / Новые / категории */
    const nfAll = noDemo(S.notifs).filter(x=>!x.owner_id || (u && x.owner_id===u.id));
    const nfCat = n => {
      const ic = String(n.icon||'').replace('i-','');
      return ic==='orders' ? 'orders' : ic==='chats' ? 'chats' : ic==='tickets' ? 'tickets' : 'system';
    };
    const nfCats = [['all','Все'],['new','Новые'],['orders','Заказы'],['chats','Чаты'],['tickets','Тикеты'],['system','Система']]
      .filter(([k])=> k==='all' || k==='new' || nfAll.some(n=>nfCat(n)===k));
    let nfTab = 'all';
    const nfMatch = n => nfTab==='all' ? true : nfTab==='new' ? !(n.read||{})[u.id] : nfCat(n)===nfTab;
    const nfListHtml = () => {
      const list = nfAll.filter(nfMatch).slice(0, 30);
      return list.map(n=>`
          <div class="notif-item ${(n.read||{})[u.id]?'':'unread'}" data-nf="${n.id}">
            <span class="notif-ico">${icon(String(n.icon||'bell').replace('i-',''),'ico-sm')}</span>
            <span style="min-width:0"><span class="t">${esc(n.title)}</span>${n.bc
              ? `<div class="nf-bc">${esc(n.text)}</div><span class="small faint">${timeAgo(n.t)} · нажмите, чтобы развернуть</span>`
              : `<span class="d">${esc(n.text)} · ${timeAgo(n.t)}</span>`}</span>
          </div>`).join('') || '<div class="empty">'+icon('bell')+'<span>Пока пусто</span></div>';
    };
    panel.innerHTML = `
      <div class="notif-panel__h">${icon('bell')} Уведомления <span class="spacer"></span>
        <button class="btn btn--ghost btn--sm" id="nf-readall">Прочитать все</button></div>
      <div class="notif-tabs">${nfCats.map(([k,label])=>{
        const cnt = k==='all' ? nfAll.length : k==='new' ? nfAll.filter(n=>!(n.read||{})[u.id]).length : nfAll.filter(n=>nfCat(n)===k).length;
        return `<button type="button" class="chip ${k===nfTab?'on':''}" data-nf-tab="${k}">${label}${cnt?` <span class="faint">${cnt}</span>`:''}</button>`;
      }).join('')}</div>
      <div class="notif-list">${nfListHtml()}</div>
      <div style="padding:10px 14px;border-top:1px solid var(--border)"><button class="btn btn--ghost btn--sm btn--block" id="nf-open-tickets">${icon('tickets')} ${isStaff(u.role)?'Все тикеты':'Сообщить о проблеме'}</button></div>`;
    document.body.appendChild(panel);
    panel.addEventListener('click', e=>{
      if (e.target.id==='nf-readall'){ S.notifs.forEach(n=>{ (n.read=n.read||{})[u.id]=true; }); chatForUser(u).forEach(c=>{ (c.unread=c.unread||{})[u.id]=Date.now(); }); u.ticketsReadAt = Date.now(); saveState(); panel.remove(); render(); return; }
      const tabBtn = e.target.closest('[data-nf-tab]');
      if (tabBtn){
        nfTab = tabBtn.dataset.nfTab;
        panel.querySelectorAll('[data-nf-tab]').forEach(b=>b.classList.toggle('on', b===tabBtn));
        const listEl = panel.querySelector('.notif-list');
        if (listEl) listEl.innerHTML = nfListHtml();
        return;
      }
      if (e.target.id==='nf-open-tickets'){ panel.remove(); isStaff(u.role)?go('tickets'):CRM.openTicket(); return; }
      const it = e.target.closest('[data-nf]');
      if (it){
        const n = S.notifs.find(x=>x.id===it.dataset.nf);
        (n.read = n.read||{})[u.id] = true;
        saveState();
        if (n.bc){
          it.classList.toggle('bc-open');
          const bx = it.querySelector('.nf-bc');
          if (bx) bx.style.maxHeight = it.classList.contains('bc-open') ? '220px' : '';
          return;
        }
        /* Маршрутизация клика по типу/иконке уведомления */
        const ic = String(n.icon||'').replace('i-','');
        const t = String(n.title||'');
        if (t.startsWith('Доступна версия')) checkUpdates(true);
        else if (ic === 'tickets' || /тикет|заявк/i.test(t)) go('tickets');
        else if (ic === 'orders' || /AW-/.test(t)) go('orders');
        else if (ic === 'chats' || ic === 'chat') go('chats');
        else if (ic === 'clients') go('clients');
        else if (ic === 'executors' || /исполнител/i.test(t)) go('executors');
        panel.remove(); render();
      }
    });
    let closed = false;
    const closePanel = (delay=180) => {
      if (closed) return; closed = true;
      panel.classList.add('closing');
      setTimeout(()=>{ panel.remove(); document.removeEventListener('mousedown', h); }, delay);
    };
    window.__closeNotifPanel = closePanel;
    function h(e){ if (!panel.contains(e.target) && !(e.target.closest && e.target.closest('#btn-bell'))) closePanel(); }
    setTimeout(()=>document.addEventListener('mousedown', h), 50);
  }

  /* ---------- Баланс: история списаний и начислений ---------- */
  function showBalanceHistory(){
    const u = user();
    const ops = [];
    /* 1) Аудит: финансовые действия */
    noDemo(S.audit || []).forEach(a => {
      const txt = a.action || '';
      if (/начислен|начисление|платёж|платеж|оплат|списани|баланс/i.test(txt)){
        ops.push({ t:a.t, kind: /списани|платёж|платеж|оплат/.test(txt) ? 'out' : 'in', text: txt, user:a.user });
      }
    });
    /* 2) История заказов: финансовые события */
    noDemo(S.orders || []).forEach(o => {
      (o.history || []).forEach(h => {
        const txt = h.txt || '';
        if (/начислен|заработок|оплата|платёж|платеж|списани|аннулирован/i.test(txt)){
          ops.push({ t:h.t, kind: /списани|аннулирован|платёж|платеж|оплат/.test(txt) ? 'out' : 'in', text: (o.order_id ? o.order_id + ': ' : '') + txt, user:u.full_name });
        }
      });
    });
    ops.sort((a,b)=>b.t-a.t);
    const top = ops.slice(0, 20);
    const total = S.settings.balance || 0;
    /* Плашка-панель (как уведомления): открывается под балансом,
       закрывается по клику мимо или по Esc. */
    const oldPanel = document.querySelector('.bal-panel');
    if (oldPanel) oldPanel.remove();
    const panel = document.createElement('div');
    panel.className = 'bal-panel';
    panel.innerHTML = `
      <div class="bal-head">${icon('card')} История баланса <span class="spacer"></span>
        <button class="iconbtn bal-close" aria-label="Закрыть">${icon('x','ico-sm')}</button></div>
      <div class="bal-list">${top.length
        ? top.map(op => `<div class="bal-item ${op.kind}"><span class="bal-ico">${icon(op.kind==='out'?'minus':'plus','ico-sm')}</span>
            <span class="bal-main"><span class="t">${esc(op.text)}</span><span class="d">${esc(op.user||'')} · ${fmtDT(op.t)}</span></span></div>`).join('')
        : `<div class="empty">${icon('card')}<span>Операций пока нет</span></div>`}</div>
      <div class="bal-foot"><span>Баланс платформы</span><b>${fmtMoney(total)}</b></div>`;
    document.body.appendChild(panel);
    /* Позиция задаётся в CSS — та же, что у панели уведомлений
       (top от --head-h, right 14px), чтобы плашки стояли ровно друг под другом. */
    panel.querySelector('.bal-close').onclick = () => {
      panel.classList.add('closing');
      setTimeout(()=>panel.remove(), 168);
    };
    let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      panel.classList.add('closing');
      setTimeout(()=>panel.remove(), 168);
      document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k);
    };
    /* Даём внешнему коду (кнопке баланса) штатно закрыть плашку — со снятием слушателей */
    panel.__close = close;
    const h = e => { if (!panel.contains(e.target) && !(e.target.closest && e.target.closest('#net-pill'))) close(); };
    const k = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
  }

  /* Обновить точку онлайн/аватар пользователя в левом меню без перезагрузки */
  function updateSideAvatar(){
    const wrap = document.querySelector('#side-user');
    const box = wrap && wrap.querySelector('.avatar');
    const uu = user();
    if (wrap && box && uu && typeof avatarHTML === 'function'){
      const tmp = document.createElement('div');
      tmp.innerHTML = avatarHTML(uu);
      const nn = tmp.firstElementChild;
      if (nn) wrap.replaceChild(nn, box);
    }
  }
  /* ---------- Авторизация ---------- */
  const EYE_SLASH = '<svg class="input-eye__slash" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.9 1.9 14.1 14.1"/></svg>';
  /* ---------- «Печатает…» (как в ТГ) ----------
     Состояние живёт в localStorage (общее для вкладок) с TTL 5 секунд:
     пока человек набирает, отметка обновляется; перестал — истекает сама. */
  const TYPING_TTL = 5000;
  let __typingMap = {};
  function typingRead(){
    try {
      const raw = localStorage.getItem('aw_typing');
      __typingMap = raw ? (JSON.parse(raw) || {}) : {};
    } catch(e){ __typingMap = {}; }
    const now = Date.now();
    Object.keys(__typingMap).forEach(cid=>{
      const map = __typingMap[cid] || {};
      Object.keys(map).forEach(uid=>{ if (now - map[uid] > TYPING_TTL) delete map[uid]; });
      if (!Object.keys(map).length) delete __typingMap[cid];
    });
    return __typingMap;
  }
  function typingWrite(){
    try { localStorage.setItem('aw_typing', JSON.stringify(__typingMap)); } catch(e){}
    if (typeof window.__typingChanged === 'function') window.__typingChanged();
  }
  function typingSet(chatId, userId){
    if (!chatId || !userId) return;
    typingRead();
    __typingMap[chatId] = __typingMap[chatId] || {};
    __typingMap[chatId][userId] = Date.now();
    typingWrite();
  }
  function typingClear(chatId, userId){
    typingRead();
    if (__typingMap[chatId] && __typingMap[chatId][userId]){
      delete __typingMap[chatId][userId];
      if (!Object.keys(__typingMap[chatId]).length) delete __typingMap[chatId];
      typingWrite();
    }
  }
  function typingWho(chatId, exceptId){
    const map = typingRead()[chatId] || {};
    const now = Date.now();
    return Object.keys(map)
      .filter(uid => uid !== exceptId && now - map[uid] <= TYPING_TTL)
      .map(uid => userById(uid))
      .filter(Boolean);
  }
  function typingShortName(full){
    const parts = String(full||'').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'Кто-то';
    /* Юрлица: «ИП Иванов», «ООО «Медиа-Лайн»» — берём два первых слова */
    if (parts.length > 1 && /^(ИП|ООО|АО|ЗАО|ПАО|НКО|ФГУП|МУП)$/i.test(parts[0])) return parts.slice(0,2).join(' ');
    return parts[0];
  }
  function typingLabel(list){
    if (!list || !list.length) return '';
    const names = list.map(x => typingShortName(x.full_name));
    if (names.length === 1) return names[0] + ' печатает';
    if (names.length === 2) return names[0] + ' и ' + names[1] + ' печатают';
    return 'Несколько человек печатают';
  }

  /* ---------- Регистрация по приглашению ---------- */
  function parseToken(){
    const m = (location.hash||'').match(/join\?.*token=([A-Za-z0-9]+)/);
    return m ? m[1] : null;
  }
  /* Реферальный код из ссылки: #/join?ref=CODE */
  function parseRef(){
    const m = (location.hash||'').match(/[?&]ref=([^&\s]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  /* Демо-вход: ровно ОДИН аккаунт на роль (клиенты тоже), с учётом скрытых ролей */
  function demoChipsFor(tab){
    const order = (tab === 'client') ? ['client','executor'] : ['admin','top_manager','manager','executor'];
    const hidden = (S.settings && S.settings.demoHiddenRoles) || [];
    return order.filter(r => !hidden.includes(r))
      .map(r => noDemo(S.users).find(u => u.role === r))
      .filter(Boolean);
  }
  function renderJoin(inv){
    if (!inv) inv = { token:'', role:'client', limit:0, used:0, revoked:true };
    const st = inviteStatus(inv);
    const stMsg = {
      used:    'Эта ссылка-приглашение уже использована (лимит исчерпан).',
      expired: 'Срок действия ссылки истёк. Попросите новое приглашение.',
      revoked: 'Ссылка отозвана. Попросите новое приглашение.'
    }[st];
    if (st !== 'active'){
      $('#app').innerHTML = `
        <div class="auth">
          <div class="auth__aurora"></div>
          ${S.settings && S.settings.appBg !== 'none' ? `<div class="auth__doodles" aria-hidden="true"></div>` : ''}
          <div class="auth__card">
            <div class="auth__logo">${icon('logo-full')}</div>
            <h1 class="auth__title">Приглашение недоступно</h1>
            <p class="small muted" style="text-align:center">${stMsg}</p>
            <button class="btn btn--primary btn--block" style="margin-top:14px" onclick="location.hash=''">${icon('exit')} Ко входу</button>
          </div>
        </div>`;
      return;
    }
    const inviter = inv.referrerId ? userById(inv.referrerId) : (inv.createdBy ? userById(inv.createdBy) : null);
    $('#app').innerHTML = `
      <div class="auth">
        <div class="auth__aurora"></div>
        ${S.settings && S.settings.appBg !== 'none' ? `<div class="auth__doodles" aria-hidden="true"></div>` : ''}
        <div class="auth__card auth__card--join">
          <div class="auth__logo">${icon('logo-full')}</div>
          <h1 class="auth__title">Вас пригласили в Audiowizard</h1>
          <p class="auth__sub">${inviter? `Пригласил(а): <b>${esc(inviter.full_name)}</b> · `:''}Роль: <b>${ROLE_LABEL[inv.role]||inv.role}</b>${inv.email? ' · '+esc(inv.email):''}</p>
          <div id="login-error"></div>
          <form id="join-form">
            <div class="field"><label>Имя и фамилия</label>
              <div class="input-wrap">${icon('clients')}<input class="input" id="jf-name" autocomplete="name" placeholder="Иван Петров" style="padding-left:36px"></div></div>
            <div class="field" style="margin-top:10px"><label>Логин</label>
              <div class="input-wrap">${icon('key')}<input class="input" id="jf-login" autocomplete="username" placeholder="ivan" style="padding-left:36px"></div></div>
            <div class="field" style="margin-top:10px"><label>Email</label>
              <div class="input-wrap">${icon('mail')}<input class="input" id="jf-email" type="email" autocomplete="email" placeholder="ivan@mail.ru" value="${esc(inv.email||'')}" style="padding-left:36px"></div></div>
            <div class="field" style="margin-top:10px"><label>Пароль</label>
              <div class="input-wrap has-eye">${icon('lock')}<input class="input" id="jf-pw" type="password" autocomplete="new-password" placeholder="минимум 6 символов" style="padding-left:36px">
                <button type="button" class="input-eye" id="jf-eye" aria-label="Показать пароль">${icon('eye','ico-sm')}</button></div></div>
            <button class="btn btn--primary btn--block" type="submit" style="margin-top:16px">${icon('user-plus')} Создать аккаунт</button>
          </form>
          <p class="small faint" style="text-align:center;margin-top:12px"><a href="#" id="join-cancel">Отмена — ко входу</a></p>
        </div>
      </div>`;
    const eye = $('#jf-eye'); let shown=false;
    eye.onclick = ()=>{ shown=!shown; $('#jf-pw').type = shown?'text':'password'; };
    $('#join-cancel').onclick = e=>{ e.preventDefault(); location.hash=''; };
    $('#join-form').onsubmit = e=>{
      e.preventDefault();
      const name = $('#jf-name').value.trim();
      const login = norm($('#jf-login').value);
      const email = norm($('#jf-email').value);
      const pw = $('#jf-pw').value;
      if (!name || !login || !email || !pw){ $('#login-error').innerHTML = `<div class="auth-error">${icon('info')} Заполните все поля</div>`; return; }
      if (pw.length < 6){ $('#login-error').innerHTML = `<div class="auth-error">${icon('info')} Пароль — минимум 6 символов</div>`; return; }
      if (S.users.some(x=>norm(x.username)===login)){ $('#login-error').innerHTML = `<div class="auth-error">${icon('x-c','ico-sm')} Логин уже занят</div>`; return; }
      if (S.users.some(x=>norm(x.email)===email)){ $('#login-error').innerHTML = `<div class="auth-error">${icon('x-c','ico-sm')} Email уже используется</div>`; return; }
      /* Повторная проверка токена: мог быть использован между открытием и отправкой */
      if (!inviteValid(inv)){ renderJoin(inv); return; }
      const nu = { id:uid(), username:login, email, pw, role:inv.role, full_name:name,
        phone:'', about:'', mode:'system', accent:'violet', is_online:true, avatar:'',
        consent_marketing:false, tour_completed:false, created_at:Date.now(),
        ext:{ status:'active', workStatus:'work' } };
      S.users.push(nu);
      /* Приглашение по токену → тоже считается рефералом пригласившего */
      if (inv.token){ consumeInvite(inv.token, nu.id); }
      const refOwnerId = inv.referrerId || inv.createdBy || null;
      if (refOwnerId && refOwnerId !== nu.id){
        try { addReferral(nu.id, refOwnerId, inv.token ? 'invite' : 'link'); } catch(e){}
      }
      logAudit('Регистрация по приглашению: '+name+' ('+ROLE_LABEL[inv.role]+')','Авторизация');
      saveState();
      /* Найдём создателя приглашения и уведомим его */
      const creator = inv.createdBy ? userById(inv.createdBy) : null;
      if (creator && typeof pushNotifTo==='function') pushNotifTo(creator, 'Приглашение принято', name+' зарегистрировался(лась) как '+ROLE_LABEL[inv.role], 'i-user-plus');
      doLogin(nu.id);
    };
  }

  function renderLogin(tab='staff'){
    $('#app').innerHTML = `
      <div class="auth">
        <div class="auth__aurora"></div>
        ${S.settings && S.settings.appBg !== 'none' ? `<div class="auth__doodles" aria-hidden="true"></div>` : ''}
        <div class="auth__card">
          <div class="auth__logo">${icon('logo-full')}</div>
          <h1 class="auth__title">Audiowizard Workspace</h1>
          <p class="auth__sub">Единая платформа для работы с контентом</p>
          <div class="tabs" style="margin-bottom:16px">
            <button class="tab ${tab==='staff'?'on':''}" data-tab="staff">${icon('lock','ico-sm')} Сотрудник</button>
            <button class="tab ${tab==='client'?'on':''}" data-tab="client">${icon('clients','ico-sm')} Клиентский портал</button>
          </div>
          <div id="login-error"></div>
          <form id="login-form">
            <div class="field"><label>Логин или Email</label>
              <div class="input-wrap">${icon('clients')}<input class="input" id="lg" autocomplete="username" placeholder="логин или email" value="${esc(S.rememberedLogin||'')}" style="padding-left:36px"></div></div>
            <div class="field" style="margin-top:12px"><label>Пароль</label>
              <div class="input-wrap has-eye">${icon('key')}<input class="input" id="pw" type="password" autocomplete="current-password" placeholder="••••••••" style="padding-left:36px">
                <button type="button" class="input-eye" id="eye" aria-label="Показать пароль">${icon('eye','ico-sm')}${EYE_SLASH}</button></div></div>
            <div class="auth__foot-row">
              <label class="check"><input type="checkbox" id="remember" ${S.rememberedLogin?'checked':''}><span class="box"><svg><use href="#i-check-c"/></svg></span><span class="small muted">Запомнить меня</span></label>
              <a href="#" id="forgot">Забыли пароль?</a>
            </div>
            <button class="btn btn--primary btn--block" type="submit" style="margin-top:16px">${icon('exit')} Войти</button>
          </form>
          <div class="auth__demo" id="demo-block" style="display:${S.settings.demoEnabled!==false?'':'none'}">
            <div class="auth__demo-label"><span>Демо-вход</span><span class="badge c-gray">включён админом</span></div>
            <div id="demo-chips">
              ${demoChipsFor(tab).map(u=>`<button type="button" class="demo-chip" data-demo="${u.id}" title="${esc(u.full_name)} · ${esc(u.email)}">${avatarHTML(u,'avatar--sm')} ${esc(u.full_name.split(' ')[0])} · ${ROLE_LABEL[u.role]}</button>`).join('')}
            </div>
          </div>
          <p class="small faint" style="text-align:center;margin-top:16px">Входя, вы принимаете <a href="#/docs">Условия сервиса</a> и <a href="#/docs">Политику конфиденциальности</a></p>
        </div>
      </div>`;

    $$('.tab', $('#app')).forEach(t=>t.onclick=()=>{
      // плавное переключение вкладки: fade-slide контента демо-чипов, без перерисовки карточки
      document.querySelectorAll('.auth__card .tab').forEach(x=>x.classList.toggle('on', x===t));
      const isClient = t.dataset.tab === 'client';
      /* Одинаковое число чипов на обеих вкладках — карточка не меняет высоту */
      const chips = demoChipsFor(isClient ? 'client' : 'staff');
      const block = document.querySelector('#demo-chips');
      if (!block || S.settings.demoEnabled === false) return;
      block.style.transition = 'opacity 0.18s var(--ease), transform 0.18s var(--ease)';
      block.style.opacity = '0'; block.style.transform = 'translateY(6px)';
      setTimeout(()=>{
        const uniq = []; const seen = new Set();
        chips.forEach(u => { if (!seen.has(u.id)) { seen.add(u.id); uniq.push(u); } });
        block.innerHTML = uniq.map(u=>`<button type="button" class="demo-chip" data-demo="${u.id}" title="${esc(u.full_name)} · ${esc(u.email)}">${avatarHTML(u,'avatar--sm')} ${esc(u.full_name.split(' ')[0])} · ${ROLE_LABEL[u.role]}</button>`).join('');
        block.querySelectorAll('.demo-chip').forEach(c=>c.onclick=()=>doLogin(c.dataset.demo, true));
        block.style.opacity = '1'; block.style.transform = 'none';
        document.querySelector('#login-error').innerHTML = '';
      }, 190);
    });
    $$('.demo-chip', $('#app')).forEach(c=>c.onclick=()=>doLogin(c.dataset.demo, true));
    {
      const block = document.querySelector('#demo-chips');
      const demo = document.querySelector('.auth__demo');
      if (block && demo) demo.classList.toggle('no-chips', !block.children.length);
    }
    /* Если карточка входа целиком уместилась — она не должна скроллиться:
       автоскролл оставляем только когда контент реально не влезает. */
    {
      const fitCard = () => {
        const card = document.querySelector('.auth__card');
        if (!card) return;
        card.classList.toggle('auth__card--fit', card.scrollHeight <= card.clientHeight + 1);
      };
      fitCard();
      window.addEventListener('resize', fitCard, { passive: true });
    }
    $('#forgot').onclick = e=>{ e.preventDefault(); toast('Ссылка для восстановления отправлена на почту (демо)','info'); };
    let shown = false;
    const paintEye = () => {
      /* Только переключаем класс: узел штриха остаётся нетронутым, поэтому
         transition stroke-dashoffset плавно прочерчивает линию в обе стороны.
         (i-eye-off в спрайте идентичен i-eye — крестик и есть этот штрих.) */
      const btn = $('#eye');
      btn.classList.toggle('is-off', shown);
      btn.setAttribute('aria-label', shown ? 'Скрыть пароль' : 'Показать пароль');
    };
    paintEye();
    $('#eye').onclick = ()=>{ shown = !shown; $('#pw').type = shown ? 'text' : 'password'; paintEye(); };
    $('#login-form').onsubmit = e=>{
      e.preventDefault();
      const lg = norm($('#lg').value), pw = $('#pw').value;
      const u2 = S.users.find(x=>(norm(x.username)===lg||norm(x.email)===lg) && x.pw===pw);
      if (!u2){ $('#login-error').innerHTML = `<div class="auth-error">${icon('x-c','ico-sm')} Неверный логин или пароль</div>`; return; }
      if (u2.role==='client' && tab==='staff' || ['admin','top_manager','manager'].includes(u2.role) && tab==='client'){
        $('#login-error').innerHTML = `<div class="auth-error">${icon('info')} Это ${ROLE_LABEL[u2.role].toLowerCase()} — выберите соответствующую вкладку входа</div>`; return;
      }
      if (u2.ext && u2.ext.status === 'blacklisted'){
        $('#login-error').innerHTML = `<div class="auth-error">${icon('x-c','ico-sm')} Аккаунт заблокирован администратором (чёрный список)</div>`; return;
      }
      if ($('#remember').checked) S.rememberedLogin = u2.username; else S.rememberedLogin = null;
      doLogin(u2.id);
    };
  }

  function doLogin(uidv, demo=false){
    if (demo && S.settings.demoEnabled === false){ toast('Демо-вход отключён администратором', 'warn'); return; }
    const u2 = userById(uidv);
    if (!u2) return;
    /* Чёрный список: вход запрещён в любом виде (форма, демо, восстановление сессии) */
    if ((u2.ext && u2.ext.status === 'blacklisted')){
      toast('Аккаунт заблокирован — доступ запрещён (ЧС)', 'err');
      S.currentUserId = null; S.rememberedLogin = null;
      try { sessionStorage.removeItem('aw_uid'); } catch(e){}
      saveState();
      render();
      return;
    }
    S.currentUserId = uidv;
    try { sessionStorage.setItem('aw_uid', uidv); } catch(e){}
    /* Сетевой статус при входе уважает рабочий: «Не работаю» = офлайн,
       «Работаю»/по умолчанию = онлайн. */
    u2.is_online = u2.ext && u2.ext.workStatus === 'not_working' ? false : true;
    logAudit(demo ? `Демо-вход: ${u2.full_name}` : `Вход: ${u2.full_name}`, 'Авторизация');
    saveState();
    applyTheme(u2.mode, u2.accent);
    /* Полноэкранный режим запоминается между входами: если был включён,
       возвращаемся в него В ЖЕСТЕ входа (клик — это user gesture для requestFullscreen).
       render() затем просто применит класс zen, не запрашивая fullscreen дважды. */
    if (prefsFor(u2).zen){
      try { if (typeof requestFs === 'function') requestFs(); } catch(e){}
    }
    toast(`Добро пожаловать, ${u2.full_name.split(' ')[0]}!`, 'ok');
    go('dash');
    setTimeout(()=>{
      if (!u2.tour_completed) offerOnboarding();
      else checkProfileCompleteness();
    }, 400);
  }

  /* ---------- Звук новых сообщений ---------- */
  let __msgAudioCtx = null;
  /* Ненавязчивый двухнотный «тик» (WebAudio, без внешних файлов) */
  function playMsgSound(){
    try{
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      __msgAudioCtx = __msgAudioCtx || new AC();
      const ctx = __msgAudioCtx;
      if (ctx.state === 'suspended'){ ctx.resume(); }
      const t0 = ctx.currentTime;
      const note = (freq, start, dur, vol) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t0 + start);
        gain.gain.linearRampToValueAtTime(vol, t0 + start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0006, t0 + start + dur);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(t0 + start); osc.stop(t0 + start + dur + 0.03);
      };
      note(880, 0, 0.09, 0.2);
      note(1245, 0.07, 0.11, 0.15);
    }catch(e){}
  }
  /* Звук включён для чата? (по умолчанию — да, отключается в шапке) */
  function chatSoundOn(ch){
    if (!ch) return false;
    if (ch.soundOff) return false;
    if (S.settings && S.settings.soundEnabled === false) return false;
    return true;
  }

  /* Сообщить о проблеме: форма → тикет */
  function reportProblem(){
    openWinModal({ narrow:true, title:'Сообщить о проблеме',
      body:`<div class="stack" style="gap:12px">
        <div class="field"><label>Что случилось</label><input class="input" id="rp-subject" placeholder="Коротко: что сломалось"></div>
        <div class="field"><label>Подробности</label><textarea class="input" id="rp-msg" rows="4" placeholder="Шаги, ожидание и факт — что хотели и что получилось"></textarea></div>
        <div class="field">
          <label>Скриншот или файл</label>
          <label class="file-btn" for="rp-file">${icon('clip')} <span>Выбрать файл</span></label>
          <input class="input" type="file" id="rp-file" accept="image/*,.pdf,.zip,.doc,.docx,.xls,.xlsx,.txt" multiple hidden>
          <div id="rp-files" class="stack" style="gap:4px;margin-top:6px"></div>
          <p class="small faint">Файлы добавляются в тикет локально (до ~4 МБ каждый).</p>
        </div>
        <p class="small faint">Обращение попадёт к администратору как тикет.</p>
      </div>`,
      footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-send>Отправить</button>`,
      onMount:(m2,c2)=>{
        const files = [];
        const fList = m2.querySelector('#rp-files');
        const fInp = m2.querySelector('#rp-file');
        if (fInp) fInp.addEventListener('change', ()=>{
          [...(fInp.files||[])].forEach(f=>{
            if (f.size > 4*1024*1024){ toast('Файл слишком большой (лимит 4 МБ)','warn'); return; }
            const fr = new FileReader();
            fr.onload = ()=>{
              const item = { name: f.name, type: f.type, size: f.size, dataUrl: String(fr.result) };
              files.push(item);
              const row = document.createElement('div');
              row.className = 'rp-file-row';
              const preview = /^image\//.test(f.type) ? `<img src="${item.dataUrl}" alt="" style="max-width:56px;max-height:42px;border-radius:6px;object-fit:cover">` : '';
              row.innerHTML = preview + `<span class="small" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span><button type="button" class="iconbtn" title="Убрать">${icon('x','ico-sm')}</button>`;
              row.querySelector('button').onclick = ()=>{ row.remove(); files.splice(files.indexOf(item),1); };
              fList.appendChild(row);
            };
            fr.readAsDataURL(f);
          });
          fInp.value = '';
        });
        m2.querySelector('[data-send]').onclick = ()=>{
          const sub = m2.querySelector('#rp-subject').value.trim();
          const msg = m2.querySelector('#rp-msg').value.trim();
          if (!sub){ toast('Опишите проблему в заголовке','warn'); return; }
          S.tickets.unshift({ id:uid(), user_id:user().id, subject:sub, message:msg||sub, order_id:null, status:'new', created_at:Date.now(), resolved_at:null, attachments: files.length ? files : undefined });
          logAudit('Обращение отправлено: '+sub + (files.length ? ' (+'+files.length+' файл(ов))' : ''), 'Тикет'); saveState(); c2();
          toast('Спасибо! Обращение отправлено администратору','ok');
        };
      } });
  }

  /* Полноэкранный режим: меню и топбар скрыты, выход — плавающая кнопка или Esc */
let zenAvatar = null;
  let zenDrag = null;
  let zenDragInit = false;
  let zenSuppressClick = false; /* подавляет клик сразу после перетаскивания */

  /* ---------- Полноэкранный режим браузера (синхронизирован с zen) ---------- */
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  /* Keyboard Lock (Chromium): в полном экране забираем Esc у браузера — иначе
     он выходит из фуллскрина сам, и Esc «съедается» до того, как приложение
     закроет глобальный поиск. С блокировкой Esc приходит в наш обработчик,
     а выход из режима — только по нашему решению. В браузерах без поддержки
     (Safari/Firefox) всё работает как раньше — мягкий фолбэк. */
  function lockEsc(){
    try{
      if (navigator.keyboard && navigator.keyboard.lock){
        const p = navigator.keyboard.lock(['Escape']);
        if (p && p.catch) p.catch(()=>{});
        return true;
      }
    }catch(e){}
    return false;
  }
  function unlockEsc(){
    try{ if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock(); }catch(e){}
  }
  function requestFs(){
    try{
      const el = document.documentElement;
      const fn = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!fn) return;
      const r = fn.call(el);
      if (r && r.then){
        /* Блокировку просим только после успешного входа: до фуллскрина
           браузер её отклоняет. */
        r.then(()=> lockEsc()).catch(()=>{});
      } else {
        setTimeout(lockEsc, 60);
      }
    }catch(e){}
  }
  function exitFs(){
    unlockEsc();
    try{
      const fn = document.exitFullscreen || document.webkitExitFullscreen;
      if (fn && fsEl()){ const r = fn.call(document); if (r && r.catch) r.catch(()=>{}); }
    }catch(e){}
  }

  /* Открытый «слой» поверх приложения: палитра глобального поиска, выпадашки,
     модалка. Esc сначала гасит такой слой и только потом трогает режим.
     Класс .closing тоже считается — запрос из браузера может прийти раньше,
     чем оверлей доиграет анимацию закрытия. */
  function overlayOpen(){
    return !!document.querySelector('.palette-mask, .head-search-dd, .dd, .modal-mask');
  }

  function applyZen(on, opts = {}){
    /* На время смены режима гасим переходы шапки и чатовых плашек:
       иначе они «телепортируются» к поиску, пока .head меняет left. */
    document.body.classList.add('zen-toggling');
    clearTimeout(window.__zenToggleT);
    window.__zenToggleT = setTimeout(()=>document.body.classList.remove('zen-toggling'), 380);
    document.body.classList.toggle('zen', on);
    try { window.__syncChatPads && window.__syncChatPads(); } catch(e){}
    if (on){
      /* Геометрия поля ввода стабилизируется после анимации zen — привязываем
         аватар к полю ещё раз, иначе он «отрывается» при входе и скролле. */
      [420, 800].forEach(d => setTimeout(() => {
        try { window.__syncChatPads && window.__syncChatPads(); } catch(e){}
      }, d));
    }
    /* Режим меняет геометрию ленты (паддинги/высоту) — пересчитываем
       естественные позиции дат, иначе «залипшей» считалась не та дата. */
    requestAnimationFrame(() => { try { window.__cacheDaySepTops && window.__cacheDaySepTops(); } catch(e){} });
    /* Включаем/выключаем настоящий полноэкранный режим браузера.
       При восстановлении состояния на старте (без жеста пользователя)
       запрос пропускаем — браузер всё равно его отклонит. */
    if (!opts.skipFullscreen){ on ? requestFs() : exitFs(); }
    /* Анимация перехода — на CSS: шапка с плашками плавно гаснет и появляется
       (opacity .3s), парящее меню слева выезжает за левый край и въезжает
       обратно (transform .3s, правило body.zen .side). Скролл-растворение
       плашек на время режима замораживаем, чтобы оно не конфликтовало
       с фейдом шапки. */
    window.__pillsFrozen = on;
    if (!on){
      /* Выход: возвращаем плашкам управление скроллом. Видимость определяет
         позиция скролла (у верха — видны, глубже — растворены), а не
         принудительный reveal — иначе после выхода из фуллскрина плашки
         «выскакивали» даже на прокрученной странице. */
      if (typeof window.__pillsHandler === 'function') window.__pillsHandler();
    } else if (window.__pTarget !== undefined){
      /* Вход: уводим плашки в растворение синхронно с фейдом шапки */
      window.__pTarget = 1;
    }
    if (zenAvatar){ zenAvatar.remove(); zenAvatar = null; }
    if (on){
      /* Перед входом в полноэкранный режим запоминаем высоту чатов:
         при выходе вернём ровно её, чтобы плашки не «растягивались вниз»
         (повторный пересчёт fitChats даёт другие пиксели из-за осевшего
         лейаута/скроллбара). */
      const vw = document.querySelector('.view--chats');
      window.__preZenChatsH = vw ? vw.style.getPropertyValue('--chats-h') : '';
      window.__preZenWin = { w: window.innerWidth, h: window.innerHeight };
      if (!zenDragInit){ initZenDrag(); zenDragInit = true; }
    }
    if (!on){
      /* Выход: возвращаем запомненную высоту чатов 1:1. */
      if (window.__preZenChatsH){
        const vw = document.querySelector('.view--chats');
        if (vw) vw.style.setProperty('--chats-h', window.__preZenChatsH);
      }
      window.__preZenChatsH = '';
      /* Если размер окна не менялся — оставляем ровно ту высоту, что была до
         zen (пересчёт давал +6px, и низ «уезжал» вниз). Пересчитываем только
         когда окно действительно изменилось. */
      const win0 = window.__preZenWin;
      window.__preZenWin = null;
      /* Выход из фуллскрина: плашки сверху с поиском плавно проявляются
         (раньше они оставались растворёнными — отрисовка шла по scrollY). */
      try { if (typeof window.__pillsReset === 'function') window.__pillsReset(); } catch(e){}
      [80, 260].forEach(ms => setTimeout(() => {
        try {
          const sameSize = win0 && win0.w === window.innerWidth && win0.h === window.innerHeight;
          if (!sameSize && window.__fitChatsHandler) window.__fitChatsHandler();
          try { window.__syncChatPads && window.__syncChatPads(); } catch(e){}
        } catch(e){}
      }, ms));
      return;
    }
    const ex = document.createElement('button');
    ex.className = 'zen-avatar';
    ex.title = 'Меню';
    ex.setAttribute('aria-label', 'Меню');
ex.innerHTML = avatarHTML(user(), '');
    ex.onclick = e => { e.stopPropagation(); if (zenSuppressClick) return; userMenu(ex); };
    ex.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const r = ex.getBoundingClientRect();
      const dragTimer = setTimeout(() => {
        zenDrag = { sx:e.clientX, sy:e.clientY, ox:r.left, oy:r.top, moved:false };
        ex.style.transition = 'none';
        ex.classList.add('zen-avatar--drag');
        document.body.classList.add('zen-dragging');
        showDropZones();
      }, 150);
      const onUpEarly = () => { clearTimeout(dragTimer); document.removeEventListener('mouseup', onUpEarly); };
      document.addEventListener('mouseup', onUpEarly);
    });
    zenAvatar = ex;
    document.body.appendChild(ex);
    snapToCorner(prefsFor().zenAvatarPos || 'br', false);
  }

  function snapToCorner(corner, animate){
    if (!zenAvatar) return;
    const aw = 42, gap = 12;
    /* Плавающий аватар в полноэкранном режиме всегда стоит в одном из
       четырёх углов экрана. Позиция «низ по центру» (bc) больше не
       используется: визуально это и было «аватар посередине». */
    const c = (corner === 'tl' || corner === 'tr' || corner === 'bl' || corner === 'br') ? corner : 'br';
    const left = (c === 'tl' || c === 'bl') ? gap : window.innerWidth - aw - gap;
    const top = (c === 'tl' || c === 'tr') ? gap : window.innerHeight - aw - gap;
    zenAvatar.style.left = left + 'px';
    zenAvatar.style.top = top + 'px';
    /* Иначе вместе с CSS bottom:12px кнопка растягивается по высоте
       (top+bottom без height) и аватар уезжает/перекрывает поле ввода. */
    zenAvatar.style.bottom = 'auto';
    zenAvatar.style.right = 'auto';
    zenAvatar.style.transform = '';
    if (animate){
      zenAvatar.style.transition = 'left .32s var(--ease), top .32s var(--ease), opacity .25s var(--ease), transform .25s var(--ease)';
    } else {
      zenAvatar.style.transition = 'none';
    }
    zenAvatar.style.opacity = '.35';
    zenAvatar.style.cursor = 'grab';
    zenAvatar.dataset.pos = c;
    document.body.classList.toggle('zen-corner-br', c === 'br');
    if (animate) setTimeout(() => { if (zenAvatar) zenAvatar.style.transition = ''; }, 380);
  }

  function initZenDrag(){
    document.addEventListener('mousemove', e => {
      if (!zenDrag || !zenAvatar) return;
      const dx = e.clientX - zenDrag.sx, dy = e.clientY - zenDrag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) zenDrag.moved = true;
      if (zenDrag.moved){
        let left = zenDrag.ox + dx, top = zenDrag.oy + dy;
        left = Math.max(8, Math.min(left, window.innerWidth - 52));
        top = Math.max(8, Math.min(top, window.innerHeight - 52));
        zenAvatar.style.left = left + 'px'; zenAvatar.style.top = top + 'px';
        zenAvatar.style.right = 'auto'; zenAvatar.style.bottom = 'auto';
        const corner = (left + 21) < window.innerWidth/2 ? ((top + 21) < window.innerHeight/2 ? 'tl' : 'bl') : ((top + 21) < window.innerHeight/2 ? 'tr' : 'br');
        highlightDropZone(corner);
      }
    });
    /* Завершение перетаскивания: возвращаем аватар в ближайший угол.
       Вызывается и по mouseup, и по blur/visibilitychange/pointercancel —
       иначе отпущенная вне окна мышь оставляла аватар посреди экрана. */
    function endZenDrag(){
      if (!zenDrag || !zenAvatar) return;
      const wasMoved = zenDrag.moved;
      zenDrag = null;
      zenAvatar.classList.remove('zen-avatar--drag');
      document.body.classList.remove('zen-dragging');
      try { hideDropZones(); } catch(e){}
      if (wasMoved){
        zenSuppressClick = true;
        setTimeout(() => { zenSuppressClick = false; }, 100);
        const left = parseFloat(zenAvatar.style.left), top = parseFloat(zenAvatar.style.top);
        const cx = (isNaN(left) ? 12 : left) + 21, cy = (isNaN(top) ? 12 : top) + 21;
        const corner = cx < window.innerWidth/2 ? (cy < window.innerHeight/2 ? 'tl' : 'bl') : (cy < window.innerHeight/2 ? 'tr' : 'br');
        prefsFor().zenAvatarPos = corner; saveState();
        snapToCorner(corner, true);
      } else {
        snapToCorner(prefsFor().zenAvatarPos || 'br', false);
      }
    }
    document.addEventListener('mouseup', endZenDrag);
    window.addEventListener('blur', endZenDrag);
    document.addEventListener('mouseleave', endZenDrag);
    document.addEventListener('visibilitychange', () => { if (document.hidden) endZenDrag(); });
    document.addEventListener('pointercancel', endZenDrag);
  }

  /* При изменении размеров окна или входе/выходе из полноэкранного режима
     позиция zen-аватара пересчитывается — иначе он «зависает» не в углу. */
  if (!window.__zenResizeBound){
    window.__zenResizeBound = true;
    const re = () => { if (zenAvatar && !zenDrag) snapToCorner(prefsFor().zenAvatarPos || 'br', false); };
    window.addEventListener('resize', re, { passive: true });
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, re));
  }
  function showDropZones(){
    hideDropZones();
    ['bl','br','tr','tl'].forEach(c => {
      const dz = document.createElement('div');
      dz.className = 'zen-dropzone';
      dz.dataset.corner = c;
      const pos = {
        bl:'left:12px;bottom:12px;width:80px;height:80px;border-radius:16px',
        br:'right:12px;bottom:12px;width:80px;height:80px;border-radius:16px',
        tl:'left:12px;top:12px;width:80px;height:80px;border-radius:16px',
        tr:'right:12px;top:12px;width:80px;height:80px;border-radius:16px'
      };
      dz.style.cssText = pos[c] + ';position:fixed;z-index:2098;pointer-events:none;border:2px dashed var(--border-2);background:var(--bg-2);opacity:.4;transition:opacity .25s var(--ease),background .25s var(--ease),border-color .25s var(--ease)';
      document.body.appendChild(dz);
    });
  }
  function hideDropZones(){
    document.querySelectorAll('.zen-dropzone').forEach(el => el.remove());
  }
  function highlightDropZone(corner){
    document.querySelectorAll('.zen-dropzone').forEach(el => {
      const on = el.dataset.corner === corner;
      el.style.opacity = on ? '1' : '.4';
      el.style.background = on ? 'var(--accent-soft)' : 'var(--bg-2)';
      el.style.borderColor = on ? 'var(--accent)' : 'var(--border-2)';
      el.style.borderStyle = on ? 'solid' : 'dashed';
    });
  }
  function toggleZen(){
    const on = !document.body.classList.contains('zen');
    prefsFor().zen = on; saveState();
    applyZen(on);
    toast(on ? 'Полноэкранный режим: Esc — выход' : 'Обычный режим', 'info');
  }
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !document.body.classList.contains('zen')) return;
    /* Открытый поиск/дропдаун закрывается первым, zen не трогаем */
    if (overlayOpen()){ window.__escLayerAt = Date.now(); return; }
    toggleZen();
  });

  /* Esc в настоящем полном экране браузер забирает себе: событие keydown мы
     получаем, но выйти из фуллскрина силой нельзя. Поэтому при уходе из него
     смотрим, открыт ли слой поверх (глобальный поиск и т.п.): если да — слой
     закрывается, zen остаётся, а полный экран возвращаем на следующем жесте.
     Совсем без слоя Esc действительно выключает и фуллскрин, и zen. */
  let fsRestoreArmed = false;
  function armFsRestore(){
    if (fsRestoreArmed) return;
    fsRestoreArmed = true;
    const back = (ev)=>{
      if (ev && ev.type === 'keydown' && ev.key === 'Escape') return;
      /* Клик по аватару/меню — это выход из zen, возвращать фуллскрин незачем */
      if (ev && ev.type === 'pointerdown' && ev.target && ev.target.closest && ev.target.closest('.zen-avatar, .dd, .modal-mask')) return;
      setTimeout(()=>{
        disarm();
        if (!document.body.classList.contains('zen') || !prefsFor().zen || fsEl()) return;
        requestFs();
      }, 0);
    };
    const disarm = ()=>{
      document.removeEventListener('pointerdown', back, true);
      document.removeEventListener('keydown', back, true);
      fsRestoreArmed = false;
    };
    document.addEventListener('pointerdown', back, true);
    document.addEventListener('keydown', back, true);
  }

  const onFsChange = ()=>{
    if (fsEl()){
      /* В фуллскрине и zen — держим Esc у себя (если браузер поддерживает) */
      if (document.body.classList.contains('zen')) lockEsc();
      return;
    }
    if (!document.body.classList.contains('zen')) return;
    /* После выхода из фуллскрина innerHeight/лейаут обновляются не мгновенно:
       считаем высоту чатов отложенно, иначе страница «растягивалась» вниз. */
    setTimeout(() => { try { if (window.__fitChatsHandler) window.__fitChatsHandler(); } catch(e){} }, 120);
    setTimeout(() => { try { if (window.__fitChatsHandler) window.__fitChatsHandler(); } catch(e){} }, 320);
    if (overlayOpen() || (Date.now() - (window.__escLayerAt || 0)) < 450){ armFsRestore(); return; }
    prefsFor().zen = false; saveState();
    applyZen(false, { skipFullscreen:true });
    toast('Обычный режим', 'info');
  };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  function logout(){
    const u2 = user();
    if (u2) u2.is_online = false;
    logAudit(`Выход: ${u2.full_name}`, 'Авторизация');
    S.currentUserId = null;
    /* Опасное состояние: окна не должны переживать выход — иначе после
       входа другим пользователем на экране остаются чужие окна. */
    try { if (window.Windows && typeof Windows.closeAll === 'function') Windows.closeAll(); } catch(e){}
    /* Окна не должны всплывать следующему пользователю: чистим сохранённое
       состояние окон (в closeWindow оно пишется асинхронно через 180мс). */
    try { localStorage.removeItem('aw_wins_state'); } catch(e){}
    try { sessionStorage.removeItem('aw_wins'); } catch(e){}
    /* Полноэкранный режим не должен переживать выход: снимаем класс zen
       и убираем плавающий аватар (иначе на экране входа остаётся
       некликабельный аватар в углу). */
    document.body.classList.remove('zen');
    exitFs();
    if (zenAvatar){ zenAvatar.remove(); zenAvatar = null; }
    if (window.__zenDropZones){ window.__zenDropZones.forEach && window.__zenDropZones(); }
    document.querySelectorAll('.zen-avatar,.zen-dd,.dz,.drop-zone').forEach(el => el.remove());
    try { sessionStorage.removeItem('aw_uid'); } catch(e){}
    /* Секция настроек не должна переживать выход: иначе после входа менее
       привилегированным пользователем откроется закешированная админская
       вкладка (критический баг безопасности). */
    settingsSection = '';
    saveState();
    location.hash = '';
    render();
  }

  function checkProfileCompleteness(){
    const u2 = user();
    if (!u2.about || !u2.phone){
      openWinModal({ narrow:true, title:'Заполните профиль',
        body:`<p class="small muted">Обязательные поля профиля не заполнены. Рекомендуем добавить «О себе» и проверить контакты — это видят коллеги и заказчики.</p>`,
        footer:`<button class="btn btn--ghost" data-x>Позже</button><button class="btn btn--primary" data-go>Заполнить</button>`,
        onMount:(m2,c2)=>{ m2.querySelector('[data-x]').onclick=c2; m2.querySelector('[data-go]').onclick=()=>{ c2(); go('settings','profile'); }; } });
    }
  }

  /* ---------- Тур ---------- */
  const TOUR = [
    { sel:'[data-tour="nav"]', t:'Навигация по ролям', d:'Меню подстраивается под вашу роль: дашборд, заказы, чаты, идеи и инструменты.' },
    { sel:'[data-tour="search"]', t:'Глобальный поиск', d:'Ctrl+K — палетка команд: заказы, клиенты, действия и переходы. Задержка поиска < 200 мс.' },
    { sel:'[data-tour="bell"]', t:'Центр уведомлений', d:'Изменения заказов, патчноуты и тикеты — всё в одном месте.' },
    { sel:'[data-tour="orders-link"]', t:'Заказы', d:'Цветовые статусы строк, живые фильтры, контекстное меню по правому клику и групповые операции.' },
    { sel:'[data-tour="user"]', t:'Профиль и темы', d:'Аватар, настройки, пять тем оформления и выход. Настройки сохраняются в профиле.' }
  ];
  function offerOnboarding(){
    const u2 = user();
    openWinModal({
      narrow:true, title:'Добро пожаловать!',
      body:`<p class="small muted">Настроим профиль за три шага: расскажите о себе, поставьте аватар и выберите оформление.</p>
        <div class="stack" style="gap:12px;margin-top:14px">
          <div class="field"><label>Как к вам обращаться</label><input class="input" id="ob-name" value="${esc(u2.full_name)}"></div>
          <div class="field"><label>О себе</label><textarea class="input" id="ob-about" placeholder="Пара слов для коллег" rows="2">${esc(u2.about||'')}</textarea></div>
          <div class="row" style="gap:14px;align-items:center">
            <div style="position:relative;width:64px;height:64px">
              <span id="ob-avatar-preview" class="avatar avatar--lg" style="width:64px;height:64px">${initials(u2.full_name)}</span>
              <input type="file" id="ob-avatar-file" accept="image/*" hidden>
            </div>
            <button class="btn btn--ghost btn--sm" id="ob-avatar">${icon('edit')} Загрузить аватар</button>
          </div>
<div class="field"><label>Оформление</label>
            <div class="seg" id="ob-mode">${MODE_LIST.map(m=>`<button data-m="${m}" class="${(u2.mode||'system')===m?'on':''}">${MODE_LABEL[m]}</button>`).join('')}</div>
            <div class="chips" id="ob-accent" style="margin-top:8px">${ACCENT_LIST.map(a=>`<span class="chip ${(u2.accent||'violet')===a?'on':''}" data-a="${a}">${ACCENT_LABEL[a]}</span>`).join('')}</div>
          </div>
          <div class="field"><label>Фон приложения</label>
            <div class="seg" id="ob-appbg" style="flex-wrap:wrap">
              ${[['doodle','Дудлы'],['none','Без фона']]
                .map(([v,label])=>`<button data-bg="${v}" class="${(S.settings.appBg!=='none'?'doodle':'none')===v?'on':''}">${label}</button>`).join('')}
            </div>
            <div class="tiny faint" style="margin-top:6px">Мягкий рукописный узор за интерфейсом — можно сменить позже в настройках.</div>
          </div>
        </div>`,
      footer:`<button class="btn btn--ghost" data-skip>Пропустить</button><button class="btn btn--primary" data-go>Сохранить и начать тур</button>`,
      onMount:(m2,c2)=>{
        let avatarData = null;
        m2.querySelector('#ob-avatar').onclick = ()=>m2.querySelector('#ob-avatar-file').click();
        m2.querySelector('#ob-avatar-file').onchange = e=>{
          const f = e.target.files[0]; if (!f) return;
          openAvatarCropper(f, webp => {
            avatarData = webp;
            const pv = m2.querySelector('#ob-avatar-preview');
            pv.style.backgroundImage = `url('${avatarData}')`;
            pv.textContent = '';
          });
        };
        m2.querySelectorAll('#ob-mode button').forEach(b=>b.onclick=()=>{
          m2.querySelectorAll('#ob-mode button').forEach(x=>x.classList.remove('on')); b.classList.add('on');
          u2.mode = b.dataset.m; applyTheme(u2.mode, u2.accent);
        });
        m2.querySelectorAll('#ob-accent .chip').forEach(ch=>ch.onclick=()=>{
          m2.querySelectorAll('#ob-accent .chip').forEach(x=>x.classList.remove('on')); ch.classList.add('on');
          u2.accent = ch.dataset.a; applyTheme(u2.mode, u2.accent);
        });
        m2.querySelectorAll('#ob-appbg [data-bg]').forEach(btn=>btn.onclick=()=>{
          const v = btn.dataset.bg;
          S.settings.appBg = v;
          S.settings.appBgDoodles = (v === 'doodle');
          applyAppBg();
          m2.querySelectorAll('#ob-appbg [data-bg]').forEach(b=>b.classList.toggle('on', b.dataset.bg===v));
        });
        m2.querySelector('[data-skip]').onclick = ()=>{ u2.tour_completed = true; saveState(); c2(); toast('Профиль сохранён. Тур можно запустить позже из профиля', 'info'); };
        m2.querySelector('[data-go]').onclick = ()=>{
          const name = m2.querySelector('#ob-name').value.trim();
          if (name) u2.full_name = name;
          u2.about = m2.querySelector('#ob-about').value.trim();
          if (avatarData) u2.avatar = avatarData;
          u2.tour_completed = true;
          logAudit('Онбординг: профиль настроен', 'Профиль');
          saveState(); c2(); startTour(0); toast('Профиль готов — добро пожаловать!', 'ok');
        };
      } });
  }
  function startTour(i){
    if (i >= TOUR.length){ user().tour_completed = true; saveState(); toast('Тур завершён — отличная работа!','ok'); return; }
    const step = TOUR[i];
    const el = $(step.sel);
    if (!el){ startTour(i+1); return; }
    const r = el.getBoundingClientRect();
    const spot = document.createElement('div'); spot.className = 'tour-spot';
    Object.assign(spot.style, { left:r.left-6+'px', top:r.top-6+'px', width:r.width+12+'px', height:r.height+12+'px' });
    const card = document.createElement('div'); card.className = 'tour-card';
    const top = r.bottom + 14 + 200 > innerHeight ? Math.max(14, r.top - 216) : r.bottom + 14;
    const left = Math.min(Math.max(14, r.left), innerWidth - 346);
    Object.assign(card.style, { top: top+'px', left: left+'px' });
    card.innerHTML = `
      <div class="row row--between"><b>${step.t}</b><span class="badge c-gray">${i+1} / ${TOUR.length}</span></div>
      <p class="small muted" style="margin:8px 0 14px">${step.d}</p>
      <div class="row row--between">
        <button class="btn btn--ghost btn--sm" data-skip>Пропустить</button>
        <button class="btn btn--primary btn--sm" data-next>${i===TOUR.length-1?'Готово':'Далее'} ${icon('arrow-r','ico-sm')}</button>
      </div>`;
    document.body.appendChild(spot); document.body.appendChild(card);
    card.querySelector('[data-skip]').onclick = ()=>{ spot.remove(); card.remove(); user().tour_completed = true; saveState(); };
    card.querySelector('[data-next]').onclick = ()=>{ spot.remove(); card.remove(); startTour(i+1); };
  }

  /* ---------- Cookie banner ---------- */
  function showMaintBanner(){
    const m = S.settings.maintenance || {};
    if (!m.active) return;
    if (document.querySelector('.maint-banner')) return;
    const el = document.createElement('div');
    el.className = 'maint-banner';
    el.innerHTML = `${icon('alert')}<div><b>Технические работы</b> ${m.message?'· '+esc(m.message):''}${m.start?'<br><span class="small muted">С '+fmtDT(m.start)+(m.end?' до '+fmtDT(m.end):'')+'</span>':''}</div>`;
    document.body.appendChild(el);
  }
  function maybeCookieBanner(){
    if (S.cookiesAccepted) return;
    const el = document.createElement('div');
    el.className = 'cookie-bar';
    el.innerHTML = `${icon('cookie')}
      <div><b class="small">Мы используем кеш и cookies</b>
      <p class="small muted" style="margin:4px 0 10px">Локальное хранение черновиков, темы и сессии. Данные не покидают ваш браузер.</p>
      <div class="row"><button class="btn btn--primary btn--sm" data-ok>Хорошо</button><button class="btn btn--ghost btn--sm" data-detail>Подробнее</button></div></div>`;
    document.body.appendChild(el);
    el.querySelector('[data-ok]').onclick = ()=>{ S.cookiesAccepted = true; saveState(); el.remove(); };
    el.querySelector('[data-detail]').onclick = ()=>go('docs');
  }

  /* ==================== ВИТРИНЫ ==================== */

  /* ---------- Дашборд ---------- */
  function dashView(root){
    const u = user();
    const orders = ordersFor(u).filter(o=>o.status!=='archived');
    const done = orders.filter(o=>o.status==='done');
    const revenue = done.reduce((a,o)=>a+o.total,0);
    const active = orders.filter(o=>['waiting','work'].includes(o.status)).length;
    const onlineExecs = noDemo(S.users).filter(x=>x.role==='executor'&&x.is_online&&x.ext.status==='active').length;
    const avg = done.length ? Math.round(revenue/done.length) : 0;
    const hello = new Date().getHours();
    const greet = hello<5?'Доброй ночи':hello<12?'Доброе утро':hello<18?'Добрый день':'Добрый вечер';
    /* Местное время (с учётом часового пояса пользователя) */
    const nowTxt = new Date().toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
    const weekday = new Date().toLocaleDateString('ru-RU', { weekday:'long' });

    /* серия за 14 дней */
    const series = Array.from({length:14},(_,i)=>{
      const d0 = new Date(); d0.setHours(0,0,0,0); d0.setDate(d0.getDate()-13+i);
      const t0 = d0.getTime(), t1 = t0 + DAY;
      return noDemo(S.orders).filter(o=>o.status==='done'&&o.history.some(h=>h.t>=t0&&h.t<t1&&h.txt.includes('Выполнено'))).reduce((a,o)=>a+o.total,0);
    });
    const maxV = Math.max(...series, 1);
    const W=520,H=120;
    const pts = series.map((v,i)=>`${(i/(13))*(W-8)+4},${H-8-(v/maxV)*(H-24)}`).join(' ');
    const area = `4,${H-8} ${pts} ${(W-8)},${H-8}`;

    /* статусы donut */
    const stCounts = {}; orders.forEach(o=>stCounts[o.status]=(stCounts[o.status]||0)+1);
    const donutColors = { draft:'var(--gray)', waiting:'var(--tint-wait)', work:'var(--yellow)', done:'var(--green)', revision:'var(--orange)', problem:'var(--red)' };
    let acc = 0; const C = 2*Math.PI*40;
    /* Видимые сегменты + невидимые «ободки» той же дуги: тонкое кольцо
       шириной 14px плохо ловит курсор, а 26px — попадание без промахов. */
    const donutSegs = [], donutHits = [];
    Object.entries(stCounts).forEach(([st,n])=>{
      const frac = n/orders.length;
      const dash = `${(frac*C).toFixed(1)} ${C}`;
      const off = `${(-acc*C).toFixed(1)}`;
      donutSegs.push(`<circle class="donut-seg" data-st="${st}" data-n="${n}" r="40" cx="60" cy="60" fill="none" stroke="${donutColors[st]||'var(--gray)'}" stroke-width="14" stroke-dasharray="${dash}" stroke-dashoffset="${off}" transform="rotate(-90 60 60)"/>`);
      donutHits.push(`<circle class="donut-hit" data-st="${st}" data-n="${n}" r="40" cx="60" cy="60" fill="none" stroke="transparent" stroke-width="26" stroke-dasharray="${dash}" stroke-dashoffset="${off}" transform="rotate(-90 60 60)"/>`);
      acc += frac;
    });
    const donut = donutSegs.join('') + donutHits.join('');

    const topExecs = noDemo(S.users.filter(x=>x.role==='executor'&&x.ext.status==='active')).sort((a,b)=>b.ext.earned-a.ext.earned).slice(0,4);
    const topClients = noDemo(S.users.filter(x=>x.role==='client')).map(c=>({c, sum:noDemo(S.orders).filter(o=>(o.client_ids?.includes(c.id)||o.client_id===c.id)&&o.status!=='archived').reduce((a,o)=>a+o.total,0)})).sort((a,b)=>b.sum-a.sum).slice(0,4);
    const recent = orders.slice().sort((a,b)=>b.created_at-a.created_at).slice(0,5);

    const isAdmin = u.role==='admin';
    const isExec = u.role==='executor', isClient = u.role==='client';

    root.innerHTML = `
      <div class="dash-hero" data-tour="hero">
        <div style="flex:1;position:relative;z-index:1">
          <h2>${__t('dash.greeting', greet)}, ${esc(u.full_name.split(' ')[0])}!</h2>
          <p class="muted small">${__t('dash.subtitle', isExec?'Ваши заказы и заработок':isClient?'Ваши заказы и проекты':isAdmin?'Рабочая панель':'Ваши заказы, клиенты и команда')} · ${fmtDate(Date.now())} · <span class="dash-clock">${__t('dash.clock', nowTxt)}</span></p>
        </div>
        <div class="chart-wrap chart-wrap--hero" style="position:relative;z-index:1">
          <svg class="spark" width="220" height="70" viewBox="0 0 220 70">
            <polyline class="line" points="${Array.from({length:14},(_,i)=>`${i/13*212+4},${58-(series[i]/maxV)*44}`).join(' ')}"/>
            ${series.map((v,i)=>v>0?`<circle cx="${i/13*212+4}" cy="${58-(v/maxV)*44}" r="2.6" fill="var(--accent)"/>`:'').join('')}
            <line class="spark-guide" x1="0" x2="0" y1="6" y2="64"/>
            <circle class="spark-dot" cx="0" cy="0" r="3.6"/>
            <g class="spark-hits">${series.map((_,i)=>`<rect x="${(i*220/14).toFixed(1)}" y="0" width="${(220/14).toFixed(1)}" height="70"/>`).join('')}</g>
          </svg>
          <div class="chart-tip" id="hero-tip"></div>
        </div>
      </div>
      <div class="card" style="margin-top:12px"><div class="card-h"><h3>Последние заказы</h3><a href="#/orders" class="small">Все заказы →</a></div>
        <div class="tbl-wrap" style="border:0;border-radius:0">
          <table class="tbl"><tbody>
          ${recent.map(o=>`<tr class="${STATUS_META[o.status].row}"><td><span class="order-id">${o.order_id}</span></td>
            <td>${esc((clientById(o.client_id)||{}).full_name||'')}</td><td>${nicheChip(o.nish_id)}</td>
            <td>${statusChip(o.status)}</td><td class="pay-cell">${fmtMoney(o.total)}</td>
            <td class="small faint">${fmtDate(o.created_at)}</td></tr>`).join('')}
          </tbody></table></div></div>
      <div class="cols-2 grid" style="margin-top:12px">
        <div class="card"><div class="card-h"><h3>Статусы заказов</h3><a href="#/orders" class="small">Все заказы →</a></div>
          <div class="card-b row" style="gap:22px">
            <svg width="120" height="120" viewBox="0 0 120 120" id="donut">${donut}<text x="60" y="56" text-anchor="middle" fill="var(--text)" font-size="22" font-weight="700" id="donut-c">${orders.length}</text><text x="60" y="74" text-anchor="middle" fill="var(--muted)" font-size="10" id="donut-l">заказов</text></svg>
            <div class="donut-legend" style="flex:1">
              ${Object.entries(stCounts).map(([st,n])=>`<div class="row" data-st="${st}"><span class="dot" style="background:${donutColors[st]||'var(--gray)'}"></span>${STATUS_META[st].label}<b>${n}</b></div>`).join('')}
            </div>
          </div></div>
        <div class="card"><div class="card-h"><h3>Выручка по дням</h3><span class="row" style="gap:10px;align-items:center"><span class="small faint">14 дней</span><button type="button" class="small rev-link" data-rev-detail>Подробнее</button></span></div>
          <div class="card-b">
            <div class="chart-wrap" id="rev-chart">
              <svg class="spark" width="100%" height="130" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
                <polygon class="area" points="${area}"/>
                <polyline class="line" points="${pts}"/>
                <line class="grid-l" x1="4" y1="${H-8}" x2="${W-8}" y2="${H-8}"/>
                <line class="spark-guide" x1="0" x2="0" y1="6" y2="${H-4}"/>
                <circle class="spark-dot" cx="0" cy="0" r="3.4"/>
                <g class="spark-hits">${series.map((_,i)=>`<rect x="${(i*W/14).toFixed(1)}" y="0" width="${(W/14).toFixed(1)}" height="${H}"/>`).join('')}</g>
              </svg>
              <div class="chart-tip" id="rev-tip"></div>
            </div>
            <div class="row small faint" style="justify-content:space-between"><span>13 дн назад</span><span>пик: ${fmtMoney(maxV)}</span><span>сегодня</span></div>
          </div></div>
      </div>
            <div class="cols-4 grid" style="margin-top:12px">
        <div class="metric"><div class="metric__label">${icon(isAdmin?'card':'chart','ico-sm')} ${isAdmin?'Чистая выручка':'Выручка (выполнено)'}</div>
          <div class="metric__value">${fmtMoney(revenue)}</div>
          <div class="metric__delta"><span class="delta-up">▲ 12%</span> за 14 дней</div>
          <button type="button" class="metric__more" data-rev-detail>Детализация →</button>
          <span class="metric__ico c-green">${icon('card')}</span></div>
        <div class="metric"><div class="metric__label">${icon('orders','ico-sm')} Активные заказы</div>
          <div class="metric__value">${active}</div>
          <div class="metric__delta">${orders.filter(o=>o.status==='problem').length?`<span class="delta-down">● ${orders.filter(o=>o.status==='problem').length} проблемных</span>`:'без проблем'} </div>
          <span class="metric__ico c-blue">${icon('orders')}</span></div>
        <div class="metric"><div class="metric__label">${icon('executors','ico-sm')} Исполнители онлайн</div>
          <div class="metric__value">${onlineExecs}</div>
          <div class="metric__delta">из ${noDemo(S.users.filter(x=>x.role==='executor'&&x.ext.status==='active')).length} активных</div>
          <span class="metric__ico c-violet">${icon('executors')}</span></div>
        <div class="metric"><div class="metric__label">${icon('calc','ico-sm')} Средний чек</div>
          <div class="metric__value">${fmtMoney(avg)}</div>
          <div class="metric__delta">${done.length} выполненных заказов</div>
          <span class="metric__ico c-yellow">${icon('calc')}</span></div>
      </div>

      ${isExec?``:`
      <div class="cols-2 grid" style="margin-top:12px">
        <div class="card"><div class="card-h"><h3>ТОП исполнителей</h3><a href="#/executors" class="small">Все →</a></div>
          <div class="card-b stack" style="gap:2px">
            ${topExecs.map((e2,i)=>`<div class="list-row"><span class="rank rank--${i+1}">${i+1}</span>${avatarHTML(e2)}<span style="flex:1;min-width:0"><b class="small">${esc(e2.full_name)}</b><div class="cell-sub">${esc(e2.ext.specializations[0]||'')}</div></span><b class="small">${fmtMoney(e2.ext.earned)}</b></div>`).join('')}
          </div></div>
        <div class="card"><div class="card-h"><h3>ТОП клиентов</h3><a href="#/clients" class="small">Все →</a></div>
          <div class="card-b stack" style="gap:2px">
            ${topClients.map(({c,sum},i)=>`<div class="list-row"><span class="rank rank--${i+1}">${i+1}</span>${avatarHTML(c)}<span style="flex:1;min-width:0"><b class="small">${esc(c.full_name)}</b><div class="cell-sub">${c.ordersCount||noDemo(S.orders.filter(o=>o.client_id===c.id)).length} заказов</div></span><b class="small">${fmtMoney(sum)}</b></div>`).join('')}
          </div></div>
      </div>`}
      ${isAdmin?`
      <div class="card" style="margin-top:12px"><div class="card-h"><h3>${icon('chart')} Использование функций платформы</h3><span class="badge c-gray">согласие на статистику</span></div>
        <div class="card-b stack" style="gap:10px">
          ${noDemo(S.featureUsage).map(f=>`<div class="bar-row"><span class="small">${esc(f.name)}</span><span class="progress"><span style="width:${f.share*2.6}%"></span></span><b>${f.share}%</b></div>`).join('')}
        </div></div>`:`
      <div class="card" style="margin-top:12px"><div class="card-h"><h3>Активность команды</h3><span class="badge c-gray">14 дней</span></div>
        <div class="card-b stack" style="gap:10px">
            ${noDemo(S.featureUsage).slice(0,4).map(f=>`<div class="bar-row"><span class="small">${esc(f.name)}</span><span class="progress"><span style="width:${f.share*2.6}%"></span></span><b>${f.share}%</b></div>`).join('')}
        </div></div>`}
      `;

    $$('[data-oid]', root).forEach(el=>el.onclick=()=>CRM.openOrderDetail(el.dataset.oid));
    $$('[data-rev-detail]', root).forEach(el=>el.onclick=e=>{ e.preventDefault(); openRevenueDetail(); });
    /* Графики реагируют на курсор: направляющая, точка и подсказка по дню */
    const sparkLabels = Array.from({length:14},(_,i)=>{
      const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-13+i);
      return d.toLocaleDateString('ru-RU',{ day:'numeric', month:'short' });
    });
    const bindSparkHover = (svg, tip, posX, posY) => {
      if (!svg || !tip) return;
      const guide = svg.querySelector('.spark-guide');
      const dot = svg.querySelector('.spark-dot');
      const hits = [...svg.querySelectorAll('.spark-hits rect')];
      const wrap = tip.parentElement;
      const show = i => {
        const v = series[i] || 0;
        if (guide){ guide.setAttribute('x1', posX(i)); guide.setAttribute('x2', posX(i)); }
        if (dot){ dot.setAttribute('cx', posX(i)); dot.setAttribute('cy', posY(v)); }
        svg.classList.add('is-hover');
        const r = (hits[i] || svg).getBoundingClientRect();
        const wr = wrap.getBoundingClientRect();
        const left = Math.min(Math.max(r.left + r.width/2 - wr.left, 48), Math.max(48, wr.width - 48));
        tip.style.left = left + 'px';
        tip.innerHTML = `<b>${sparkLabels[i]}</b><span>${fmtMoney(v)}</span>`;
        tip.classList.add('on');
      };
      const hide = ()=>{ svg.classList.remove('is-hover'); tip.classList.remove('on'); };
      hits.forEach((r, i)=>{
        r.addEventListener('mouseenter', ()=>show(i));
        r.addEventListener('mousemove', ()=>show(i));
      });
      svg.addEventListener('mouseleave', hide);
    };
    bindSparkHover(root.querySelector('.chart-wrap--hero svg'), root.querySelector('#hero-tip'),
      i => i/13*212+4, v => 58-(v/maxV)*44);
    bindSparkHover(root.querySelector('#rev-chart svg'), root.querySelector('#rev-tip'),
      i => (i/13)*(W-8)+4, v => H-8-(v/maxV)*(H-24));
    /* Donut: сегмент под курсором показывается в центре и подсвечивает легенду */
    const donutSvg = root.querySelector('#donut');
    if (donutSvg){
      const cEl = donutSvg.querySelector('#donut-c');
      const lEl = donutSvg.querySelector('#donut-l');
      const totalN = orders.length;
      const legendRows = root.querySelectorAll('.donut-legend .row');
      const reset = ()=>{
        if (cEl) cEl.textContent = totalN;
        if (lEl) lEl.textContent = 'заказов';
        legendRows.forEach(r => r.classList.remove('on'));
      };
      donutSvg.querySelectorAll('.donut-hit').forEach(hit=>{
        const st = hit.dataset.st;
        const vis = donutSvg.querySelector(`.donut-seg[data-st="${st}"]`);
        hit.addEventListener('mouseenter', ()=>{
          if (vis) vis.classList.add('is-on');
          if (cEl) cEl.textContent = hit.dataset.n;
          if (lEl) lEl.textContent = (STATUS_META[st] || {}).label || '';
          legendRows.forEach(r => r.classList.toggle('on', r.dataset.st === st));
        });
        hit.addEventListener('mouseleave', ()=>{
          if (vis) vis.classList.remove('is-on');
          reset();
        });
      });
    }
    /* Живые часы: обновляем ровно на границе каждой минуты (полная синхронизация с системными часами).
       Ищем часы в живом DOM, а не в захваченном root (render создаёт новые элементы). */
    clearTimeout(window.__dashClockTimer);
    const clockTick = () => {
      const el = document.querySelector('.dash-clock');
      if (el && document.body.contains(el)){
        el.textContent = new Date().toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
      }
      const now = new Date();
      const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 20;
      window.__dashClockTimer = setTimeout(clockTick, msToNextMinute);
    };
    clockTick();
  }

  /* ---------- Детализация выручки: любые периоды + разбивка по заказам ---------- */
  let revRange = null;
  const REV_PRESETS = [
    { id:'7',   label:'7 дней',   days:7 },
    { id:'30',  label:'30 дней',  days:30 },
    { id:'90',  label:'90 дней',  days:90 },
    { id:'365', label:'Год',      days:365 },
    { id:'all', label:'Всё время', days:0 }
  ];
  /* Дата выполнения заказа: первая запись истории «Выполнено» */
  function revDoneAt(o){
    const h = (o.history || []).find(x => String((x && x.txt) || '').includes('Выполнено'));
    return (h && h.t) ? h.t : (o.updated_at || o.created_at);
  }
  function revDayStart(ts){ const d = new Date(ts); d.setHours(0,0,0,0); return d.getTime(); }
  function revISO(ts){ const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
  function revFromISO(s){
    const p = String(s || '').split('-').map(Number);
    if (p.length !== 3 || !p[0] || !p[1] || !p[2]) return null;
    return new Date(p[0], p[1]-1, p[2]).getTime();
  }
  function revRangeFor(preset, firstAt){
    const today = revDayStart(Date.now());
    if (preset === 'all') return { preset:'all', from: revDayStart(firstAt || today), to: today + DAY };
    const days = (REV_PRESETS.find(p => p.id === preset) || { days:30 }).days;
    return { preset, from: today - (days-1)*DAY, to: today + DAY };
  }
  function revClientName(o){
    const c = clientById(o.client_id) || ((o.client_ids || []).map(id => userById(id)).filter(Boolean)[0]);
    return c ? c.full_name : '';
  }
  function revExecNames(o){
    return (o.executors || []).map(e => userById(e.uid)).filter(Boolean).map(x => {
      const parts = String(x.full_name || '').split(' ');
      return parts[0] + (parts[1] ? ' ' + parts[1][0] + '.' : '');
    });
  }
  const revPlural = n => (n%10===1 && n%100!==11) ? 'заказ'
    : ((n%10>=2 && n%10<=4 && !(n%100>=12 && n%100<=14)) ? 'заказа' : 'заказов');
  /* Выгрузка детализации в CSV: «;» + BOM — открывается в Excel без плясок */
  function revExportCsv(rows, total, from, to){
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const num = v => (Math.round((v || 0) * 100) / 100).toFixed(2).replace('.', ',');
    const lines = [['Заказ','Клиент','Ниша','Исполнители','Дата выполнения','Сумма','Доля, %'].map(q).join(';')];
    rows.forEach(x => {
      const o = x.o;
      const share = total ? (o.total / total * 100) : 0;
      lines.push([o.order_id || '', revClientName(o), nicheName(o.nish_id), revExecNames(o).join(', '),
        revISO(x.at), num(o.total), share.toFixed(1).replace('.', ',')].map(q).join(';'));
    });
    lines.push(['Итого', rows.length + ' ' + revPlural(rows.length), '', '', '', num(total), '100,0'].map(q).join(';'));
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type:'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vyruchka_' + revISO(from) + '_' + revISO(to - DAY) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
    toast('Детализация выгружена в CSV', 'ok');
  }
  function drawRevenueDetail(box, u, base, firstAt){
    const from = revRange.from, to = revRange.to;
    const rows = base.filter(x => x.at >= from && x.at < to).sort((a,b) => b.at - a.at);
    const total = rows.reduce((a,x) => a + (x.o.total || 0), 0);
    const allTotal = base.reduce((a,x) => a + (x.o.total || 0), 0);
    const avg = rows.length ? total / rows.length : 0;
    const top = rows.reduce((a,x) => (!a || (x.o.total||0) > (a.o.total||0)) ? x : a, null);
    const days = Math.max(1, Math.round((revDayStart(to - 1) - revDayStart(from)) / DAY) + 1);

    const presetHtml = REV_PRESETS.map(p =>
      `<button type="button" class="btn btn--sm ${revRange.preset === p.id ? 'btn--primary' : 'btn--ghost'}" data-rp="${p.id}">${p.label}</button>`).join('');

    box.innerHTML = `
      <div class="rev-toolbar">
        <div class="rev-presets">${presetHtml}</div>
        <div class="rev-range">
          <label>с <input type="date" id="rev-from" value="${revISO(from)}" aria-label="Начало периода"></label>
          <label>по <input type="date" id="rev-to" value="${revISO(to - DAY)}" aria-label="Конец периода"></label>
          <button type="button" class="btn btn--ghost btn--sm" data-rev-apply>Применить</button>
        </div>
      </div>
      <div class="rev-period small muted">${fmtDate(from)} — ${fmtDate(to - DAY)} · ${days} ${days===1?'день':(days<5?'дня':'дней')} · только выполненные заказы</div>
      <div class="rev-cards">
        <div class="rev-card"><span class="small muted">Выручка</span><b>${fmtMoney(total)}</b></div>
        <div class="rev-card"><span class="small muted">Заказов</span><b>${rows.length}</b></div>
        <div class="rev-card"><span class="small muted">Средний чек</span><b>${rows.length ? fmtMoney(Math.round(avg)) : '—'}</b></div>
        <div class="rev-card"><span class="small muted">Крупнейший заказ</span><b>${top ? fmtMoney(top.o.total || 0) : '—'}</b></div>
        <div class="rev-card"><span class="small muted">Доля от всей выручки</span><b>${allTotal ? (total/allTotal*100).toFixed(1).replace('.', ',') + '%' : '—'}</b></div>
      </div>
      ${rows.length ? `
      <div class="row row--between rev-actions">
        <b class="small">Заказы периода</b>
        <button type="button" class="btn btn--ghost btn--sm" data-rev-csv>${icon('clip','ico-sm')} Экспорт CSV</button>
      </div>
      <div class="tbl-wrap rev-tbl"><table class="tbl">
        <thead><tr><th>Заказ</th><th>Клиент</th><th>Ниша</th><th>Исполнители</th><th>Выполнен</th><th class="pay-cell">Сумма</th><th class="pay-cell">Доля</th></tr></thead>
        <tbody>${rows.map(x => {
          const o = x.o;
          const share = total ? (o.total / total * 100) : 0;
          return `<tr>
            <td><span class="order-id">${esc(o.order_id || '')}</span></td>
            <td>${esc(revClientName(o))}</td>
            <td>${nicheChip(o.nish_id)}</td>
            <td class="small">${esc(revExecNames(o).join(', ') || '—')}</td>
            <td class="small faint">${fmtDate(x.at)}</td>
            <td class="pay-cell">${fmtMoney(o.total || 0)}</td>
            <td class="pay-cell small">${share.toFixed(1).replace('.', ',')}%</td>
          </tr>`;
        }).join('')}</tbody>
        <tfoot><tr><td colspan="5"><b>Итого: ${rows.length} ${revPlural(rows.length)}</b></td>
          <td class="pay-cell"><b>${fmtMoney(total)}</b></td><td class="pay-cell"><b>100,0%</b></td></tr></tfoot>
      </table></div>` : `<div class="empty" style="padding:26px 0">${icon('chart')}<span>За этот период выполненных заказов нет</span></div>`}
    `;

    box.querySelectorAll('[data-rp]').forEach(b => b.onclick = () => {
      revRange = revRangeFor(b.dataset.rp, firstAt);
      drawRevenueDetail(box, u, base, firstAt);
    });
    const apply = box.querySelector('[data-rev-apply]');
    if (apply) apply.onclick = () => {
      const f = revFromISO(box.querySelector('#rev-from').value);
      const t2 = revFromISO(box.querySelector('#rev-to').value);
      if (f == null || t2 == null){ toast('Укажите обе даты периода', 'warn'); return; }
      if (f > t2){ toast('Дата начала позже даты окончания', 'warn'); return; }
      revRange = { preset:'custom', from:f, to: t2 + DAY };
      drawRevenueDetail(box, u, base, firstAt);
    };
    const csvBtn = box.querySelector('[data-rev-csv]');
    if (csvBtn) csvBtn.onclick = () => revExportCsv(rows, total, from, to);
  }
  function openRevenueDetail(){
    const u = user();
    const base = ordersFor(u).filter(o => o.status === 'done').map(o => ({ o, at: revDoneAt(o) }));
    const firstAt = base.length ? Math.min(...base.map(x => x.at)) : Date.now();
    if (!revRange) revRange = revRangeFor('30', firstAt);
    openWinModal({
      title:'Детализация выручки', icon:'chart', wide:true,
      body:'<div id="rev-detail"></div>',
      onMount:(host) => {
        const box = host.querySelector('#rev-detail');
        if (box) drawRevenueDetail(box, u, base, firstAt);
      }
    });
  }

  /* ---------- Чаты ---------- */
  /* Тултип-статус пользователя для аватаров: «В сети» или «Был(а) … назад».
     Точного времени последнего визита в данных нет — для офлайна считаем по
     последнему сообщению автора в чате (если оно есть) или «давно». */
  function userOnlineTitle(uid, chatMsgs){
    const p = userById(uid);
    if (!p) return '';
    if (p.is_online) return 'В сети';
    const byU = chatMsgs.filter(m => m.user_id === uid);
    const last = byU.length ? byU[byU.length - 1].created_at : null;
    if (!last) return 'Был(а) давно';
    const diff = Date.now() - last;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'Был(а) только что';
    if (min < 60) return `Был(а) ${min} мин назад`;
    const h = Math.floor(min / 60);
    if (h < 24) return `Был(а) ${h} ч назад`;
    const d = Math.floor(h / 24);
    return `Был(а) ${d} дн назад`;
  }
  let curChat = null;
  /* Для плавного появления: какие сообщения уже были отрисованы в этом чате.
     Новые (которых не было) получают .msg--in, история — нет. */
  let chatRenderedChatId = null;
  let chatRenderedIds = new Set();
  /* Запомненный скролл ленты по каждому чату: при переключении вкладок меню
     и чатов положение списка сообщений сохраняется, а при первом открытии
     чата по умолчанию показываем самое последнее сообщение (низ ленты). */
  let chatScrollMap = {};
  /* Плавное исчезновение: сначала схлопываем узлы в текущем DOM, потом удаляем данные */
  function animateMsgsOut(ids, done){
    const box = document.querySelector('#chat-msgs');
    const list = (ids || []).filter(Boolean);
    const nodes = list.map(id => box && box.querySelector(`[data-msg="${id}"]`)).filter(Boolean);
    if (!nodes.length){ done(); return; }
    nodes.forEach(el => {
      el.style.maxHeight = el.offsetHeight + 'px';
      el.style.overflow = 'hidden';
    });
    void box.offsetHeight;
    requestAnimationFrame(()=> nodes.forEach(el => el.classList.add('msg--out')));
    setTimeout(done, 220);
  }
  /* Личное сообщение: найти или создать ЛС с пользователем и открыть его */
  function openDirectChat(otherId){
    const uu = user();
    const other = userById(otherId);
    if (!uu) return;
    /* ЛС с самим собой = «Избранное» (как в ТГ) */
    if (otherId === uu.id){
      let f = noDemo(S.chats).find(c=>c.type==='direct' && c.isSelf && (c.member_ids||[]).includes(uu.id) && c.is_active !== false);
      if (!f){
        f = { id:uid(), type:'direct', isSelf:true, name:'Избранное', member_ids:[uu.id],
          created_at:Date.now(), is_active:true };
        S.chats.push(f);
        saveState();
      }
      curChat = f.id;
      chatSel.set.clear(); chatSel.mode = false;
      if (typeof go === 'function') go('chats'); else location.hash = '#/chats';
      return;
    }
    if (!other) return;
    /* Клиент общается с исполнителем ТОЛЬКО через менеджера/чат заказа —
       прямое ЛС клиент↔исполнитель недоступно. Исполнитель менеджеру
       написать может (исполнитель ≠ клиент). */
    if (uu.role === 'client' && other.role === 'executor'){
      if (typeof toast === 'function') toast('Связь с исполнителем — через менеджера (чат по заказу)', 'warn');
      return;
    }
    let d = noDemo(S.chats).find(c=>c.type==='direct'
      && (c.member_ids||[]).includes(uu.id) && (c.member_ids||[]).includes(otherId)
      && c.is_active !== false);
    if (!d){
      d = { id:uid(), type:'direct', name: other.full_name, member_ids:[uu.id, otherId],
        created_at:Date.now(), is_active:true };
      S.chats.push(d);
      saveState();
    }
    curChat = d.id;
    chatSel.set.clear(); chatSel.mode = false;
    if (typeof go === 'function') go('chats');
    else { location.hash = '#/chats'; }
  }
  window.openDirectChat = openDirectChat;
  /* Открыть конкретный чат (для глобального поиска): переход на чаты,
     открытие чата и подсветка сообщения через __pendingChatOpen */
  window.__pendingChatOpen = null;
  window.openChatAt = (chatId, msgId) => {
    window.__pendingChatOpen = { id: chatId, msgId: msgId || null };
    if (typeof go === 'function') go('chats');
    else location.hash = '#/chats';
  };
  /* Ответ на сообщение (сохраняется между перерисовками чата) */
  let chatReplyTo = null;
  /* Окно, в течение которого плашка считается «только что открытой»: чат
     перерисовывается повторно (фокус, прокрутка), и класс анимации не должен
     теряться между рендерами. */
  const chatBarAnimUntil = { reply:0, edit:0 };
  let chatEditMsg = null;  /* редактируемое сообщение (как в ТГ) */
  let chatSel = { set: new Set(), mode:false };  /* групповое выделение сообщений (как в ТГ) */
  /* Esc полностью снимает выделение сообщений */
  document.addEventListener('keydown', e=>{
    if (e.key !== 'Escape') return;
    if (!chatSel.mode && !chatSel.set.size) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const bar = document.querySelector('.chat-sel');
    const done = ()=>{
      chatSel.set.clear(); chatSel.mode = false;
      document.querySelectorAll('.msg--sel').forEach(el=>el.classList.remove('msg--sel'));
      document.querySelectorAll('.chat-sel').forEach(el=>el.remove());
    };
    if (bar && !bar.classList.contains('closing')){
      bar.classList.add('closing');
      setTimeout(done, 150);
    } else if (!bar) done();
  }, true);

  /* ---------- Реакции: плавная смена аватары ↔ цифра ---------- */
  function reactAvHtml(x, em){
    return `<span class="react-av" style="${x.avatar?`background-image:url('${x.avatar}')`:`${avatarGrad(x.full_name)}`}" title="${esc(x.full_name)} : ${em}">${x.avatar?'':initials(x.full_name)}</span>`;
  }
  function reactionFaceHtml(ids, em){
    if (ids.length > 3) return `<span class="react-n">${ids.length}</span>`;
    return `<span class="react-avs">${ids.slice(0,3).map(id2=>{const x=userById(id2); return x?reactAvHtml(x, em):'';}).join('')}</span>`;
  }
  /* Точечное обновление пилюли без перерисовки ленты: аватары и цифра сменяют
     друг друга кроссфейдом, ширина меняется плавно; цифра внутри режима —
     сразу, без анимации. */
  /* Плавная смена высоты пузыря при реакциях: новая плашка добавляет строку,
     и пузырь раньше «прыгал». Запоминаем высоту до перерисовки и анимируем
     к новой — без скачка. */
  function bubbleHeightOf(mid){
    const el = document.querySelector('.msg[data-msg="' + mid + '"] .msg__bubble');
    return el ? el.offsetHeight : 0;
  }
  /* После снятия последней реакции у короткого сообщения время должно
     вернуться в строку текста, как при обычном рендере. Точечно, без
     перерисовки ленты: иначе элементы справа остаются в отдельной строке. */
  function restoreInlineTime(mid){
    const msg = document.querySelector('.msg[data-msg="' + mid + '"]');
    if (!msg) return;
    if (msg.querySelector('.msg__file, .msg__artifact, .poll')) return;
    const foot = msg.querySelector('.msg__foot');
    const time = foot && foot.querySelector('.time');
    const txt = msg.querySelector('.txt');
    if (!foot || !time || !txt) return;
    time.classList.add('time--in');
    txt.appendChild(time);
    foot.remove();
  }
  function animateBubbleHeight(mid, prevH){
    if (!prevH) return;
    /* Вызывается сразу после renderChat, в том же такте: старую высоту
       ставим до отрисовки кадра, поэтому пузырь не «прыгает» вниз-вверх. */
    const el = document.querySelector('.msg[data-msg="' + mid + '"] .msg__bubble');
    if (!el) return;
    const nextH = el.offsetHeight;
    if (!nextH || Math.abs(nextH - prevH) < 1) return;
    el.style.height = prevH + 'px';
    el.style.overflow = 'hidden';
    el.getBoundingClientRect();
    el.style.transition = 'height .18s var(--ease)';
    el.style.height = nextH + 'px';
    setTimeout(() => { el.style.height = ''; el.style.transition = ''; el.style.overflow = ''; }, 230);
  }
  function patchReactionPill(pill, ids, em){
    if (!pill) return;
    const face = pill.querySelector('.react-face');
    if (!face) return;
    /* Частые клики: убираем «призраков» и незавершённые анимации прошлого
       патча — иначе они копятся (до десятков) и лицо реакции раздувается. */
    face.querySelectorAll('.react-av--ghost, .react-face__ghost').forEach(g=>g.remove());
    face.style.width = '';
    try { face.getAnimations().forEach(a=>a.cancel()); } catch(e){}
    const seq = (face.__patchSeq = (face.__patchSeq || 0) + 1);
    const toNum = ids.length > 3;
    const wasNum = face.classList.contains('react-face--num');
    if (toNum && wasNum){
      const n = face.querySelector('.react-n');
      if (n) n.textContent = ids.length;
      return;
    }
    if (!toNum && !wasNum){
      /* Аватары → аватары: новые «попают», снятые плавно уходят со своих мест */
      const oldAvs = [...face.querySelectorAll('.react-av')];
      const faceRect = face.getBoundingClientRect();
      const oldW = Math.round(faceRect.width);
      const ghosts = oldAvs.map(a=>{
        const r = a.getBoundingClientRect();
        const c = a.cloneNode(true);
        c.classList.add('react-av--ghost');
        c.style.cssText = `left:${Math.round(r.left-faceRect.left)}px;top:${Math.round(r.top-faceRect.top)}px;width:${Math.round(r.width)}px;height:${Math.round(r.height)}px;position:absolute;animation:reactAvOut .2s var(--ease) forwards`;
        return { el:c, title:a.getAttribute('title') };
      });
      const newTitles = new Set(ids.slice(0,3).map(id2=>{const x=userById(id2); return x ? `${x.full_name} : ${em}` : '';}).filter(Boolean));
      const hadTitles = new Set(oldAvs.map(a=>a.getAttribute('title')));
      face.innerHTML = reactionFaceHtml(ids, em);
      face.querySelectorAll('.react-av').forEach(a=>{
        if (!hadTitles.has(a.getAttribute('title'))){
          a.style.animationDelay = '';
          a.classList.remove('react-face__enter'); void a.offsetWidth; a.classList.add('react-face__enter');
        }
      });
      ghosts.filter(g=>!newTitles.has(g.title)).forEach(g=>face.appendChild(g.el));
      if (ghosts.some(g=>!newTitles.has(g.title))){
        face.style.width = 'auto';
        const newW = Math.round(face.getBoundingClientRect().width);
        face.style.width = oldW + 'px';
        try {
          const anim = face.animate([{ width: oldW + 'px' }, { width: newW + 'px' }],
            { duration: 200, easing: 'cubic-bezier(.2,.7,.2,1)' });
          anim.onfinish = ()=>{ face.style.width = ''; };
        } catch(e){}
        setTimeout(()=>{ if (face.__patchSeq !== seq) return; face.style.width = ''; face.querySelectorAll('.react-av--ghost').forEach(g=>g.remove()); }, 380);
      }
      return;
    }
    /* Смена режима: лицо гаснет, меняет содержимое и проявляется заново.
       Старая копия не накладывается — текст прежних аватаров не просвечивает. */
    const oldW = Math.round(face.getBoundingClientRect().width);
    face.innerHTML = reactionFaceHtml(ids, em);
    face.classList.toggle('react-face--num', toNum);
    face.style.width = 'auto';
    const newW = Math.round(face.getBoundingClientRect().width);
    face.style.width = oldW + 'px';
    const first = face.firstElementChild;
    if (first){
      if (first.classList.contains('react-avs')){
        [...first.querySelectorAll('.react-av')].forEach((a,i)=>{
          a.style.animationDelay = (i*35) + 'ms';
          a.classList.add('react-face__enter');
        });
      } else {
        first.classList.add('react-face__enter');
      }
    }
    const done = ()=>{ if (face.__patchSeq !== seq) return; face.style.width = ''; face.style.opacity = ''; };
    try {
      face.animate([
        { opacity: 1, width: oldW + 'px', offset: 0 },
        { opacity: 0, width: oldW + 'px', offset: .35 },
        { opacity: 0, width: newW + 'px', offset: .6 },
        { opacity: 1, width: newW + 'px', offset: 1 }
      ], { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)' }).onfinish = done;
    } catch(e){}
    setTimeout(done, 420);
  }
  function chatsView(root){
    root.classList.add('view--chats');
    /* Высота лейаута считается от реального положения футера (или низа экрана),
       поэтому снизу остаётся органичный отступ, а сообщения прокручиваются
       внутри контейнера и не растягивают страницу. */
    /* Мобильный режим: список и чат — по очереди, как в ТГ (не оба разом).
       Пока чат не выбран — список; при входе в чат — плашка чата с «назад». */
    const isMobileChats = () => window.matchMedia('(max-width: 960px)').matches;
    const mobilePane = (showList) => {
      const lay = root.querySelector('.chats-layout');
      const list = root.querySelector('.chat-list');
      const back = root.querySelector('#chat-back');
      if (!lay) return;
      if (!isMobileChats()){
        lay.classList.remove('chats-layout--withlist');
        if (list) list.classList.remove('open');
        if (back) back.style.display = 'none';
        return;
      }
      lay.classList.toggle('chats-layout--withlist', showList);
      if (list) list.classList.toggle('open', showList);
      if (back) back.style.display = showList ? 'none' : 'flex';
    };
    window.__chatsMobilePane = mobilePane;
    const fitChats = () => {
      if (!document.body.contains(root) || document.body.classList.contains('zen')) return;
      const host = root.getBoundingClientRect();
      const foot = document.querySelector('.foot');
      /* Доступная высота = экран минус верх вида минус футер минус органичный
         отступ снизу. Так страница не прокручивается ни на десктопе, ни на мобильном. */
      const footH = foot ? foot.offsetHeight : 0;
      const ph = root.querySelector('.page-head');
      const phH = ph ? ph.offsetHeight + (parseFloat(getComputedStyle(ph).marginBottom) || 0) : 0;
      const avail = Math.round(window.innerHeight - host.top - phH - footH - 24);
      root.style.setProperty('--chats-h', Math.max(280, avail) + 'px');
    };
    /* Отступы ленты от шапки и поля ввода — одинаковые сверху и снизу.
       Иначе первые сообщения/дата прячутся под шапкой. */
    const syncChatPads = () => {
      const cm = root.querySelector('.chat-main');
      if (!cm) return;
      const head = cm.querySelector('.chat-head');
      const input = cm.querySelector('.chat-input');
      const zen = document.body.classList.contains('zen');
      const headH = head ? head.offsetHeight : 0;
      const inH = input ? input.offsetHeight : 0;
      /* Раскладка ещё не готова: высоты 0. Не сбрасываем паддинги в 8px —
         иначе при входе в чат лента сначала прыгает вверх, потом вниз. */
      if (!headH || !inH) return;
      const gap = 8;
      const msgs0 = root.querySelector('.chat-msgs');
      const mr = msgs0 ? msgs0.getBoundingClientRect() : null;
      const hr = head ? head.getBoundingClientRect() : null;
      const ir = input ? input.getBoundingClientRect() : null;
      const top = (mr && hr) ? (hr.bottom - mr.top + gap) : (zen ? 10 + headH + gap : headH + gap);
      const bottom = (mr && ir) ? (mr.bottom - ir.top + gap) : (inH + gap);
      cm.style.setProperty('--chat-pad-top', Math.round(top) + 'px');
      cm.style.setProperty('--chat-pad-bottom', Math.round(bottom) + 'px');
      /* Фейды в zen должны лежать у кромок ЭКРАНА, а не контейнера: сохраняем
         смещения ленты от верха/низа экрана для маски. */
      const msgs = root.querySelector('.chat-msgs');
      if (msgs){
        if (zen){
          const r = msgs.getBoundingClientRect();
          msgs.style.setProperty('--zen-top-off', Math.round(r.top) + 'px');
          msgs.style.setProperty('--zen-bottom-gap', Math.round(window.innerHeight - r.bottom) + 'px');
        } else {
          msgs.style.removeProperty('--zen-top-off');
          msgs.style.removeProperty('--zen-bottom-gap');
        }
      }
      /* В zen аватар привязан к полю ввода — пересчитать позицию, если
         раскладка/высота поля изменились (иначе он отрывается от поля). */
      try { if (zen) snapToCorner(prefsFor().zenAvatarPos || 'br', false); } catch(e){}
      /* Пады только что сдвинули сообщения — пересчитать «естественные»
         позиции дат. Кэш, снятый ДО syncChatPads, устаревает (на перезагрузке
         пады ещё дефолтные) — и дата в чате перестаёт закрепляться. */
      try { window.__cacheDaySepTops && window.__cacheDaySepTops(); } catch(e){}
    };
    window.__syncChatPads = syncChatPads;
    root.__syncChatPads = syncChatPads;
    root.__fitChats = fitChats;
    /* Мини-чат в углу (Jivo-стиль): плавающая панель с последними сообщениями */
    const widgetEl = () => document.getElementById('chat-widget');
    const closeWidget = () => { const w = widgetEl(); if (w) w.remove(); };
    const renderWidget = () => {
      let w = widgetEl();
      if (!w){ w = document.createElement('div'); w.id = 'chat-widget'; w.className = 'chat-widget'; document.body.appendChild(w); }
      const c = S.chats.find(x => x.id === curChat);
      const last = S.messages.filter(m => m.chat_id === curChat).slice(-4);
      w.innerHTML = `<div class="chat-widget__head"><b>${esc(c ? c.name : 'Чат')}</b><span class="spacer"></span>
          <button class="iconbtn" data-w-open title="Открыть чат">${icon('expand','ico-sm')}</button>
          <button class="iconbtn" data-w-close title="Свернуть">${icon('x','ico-sm')}</button></div>
        <div class="chat-widget__body">${last.length
          ? last.map(m => `<div class="cw-msg"><b>${esc(((userById(m.user_id)||{}).full_name||'').split(' ')[0])}</b>: ${esc((m.text||'').slice(0,70))}</div>`).join('')
          : '<div class="small faint">Сообщений пока нет</div>'}</div>`;
      w.querySelector('[data-w-close]').onclick = minimizeWidget;
      w.querySelector('[data-w-open]').onclick = () => { closeWidget(); const t = $('#chat-t', root); if (t) t.focus(); };
      return w;
    };
    /* Свернуть чат-виджет в компактную кнопку у края экрана (как Jivo):
       окно не «телепортируется», виджет плавно сворачивается в булб в углу. */
    const minimizeWidget = () => {
      const w = widgetEl();
      if (!w) return;
      w.classList.add('chat-widget--closing');
      setTimeout(() => {
        if (!widgetEl()) return;
        const c = S.chats.find(x => x.id === curChat);
        w.className = 'chat-widget chat-widget--dock';
        w.innerHTML = `<button class="chat-widget__bubble" title="Развернуть чат (${esc(c ? c.name : '')})">${icon('chats')}</button>`;
        w.querySelector('.chat-widget__bubble').onclick = () => { w.remove(); renderWidget(); };
      }, 160);
    };
    window.__chatWidget = { render: renderWidget, close: closeWidget, minimize: minimizeWidget };
  /* Дата в чате: глобальное делегирование — перерисовка ленты не рвёт обработчик */
  document.addEventListener('click', (e)=>{
    const sep = e.target && e.target.closest && e.target.closest('.day-sep[data-ds]');
    const nbAll = sep ? sep.closest('.chat-msgs') : null;
    /* Клик НЕ по дате — закрыл плашку дат (или просто клик мимо): снимаем
       «закрепление», чтобы дата снова могла рассеиваться по таймеру. */
    if (!sep){
      document.querySelectorAll('.chat-msgs').forEach(b => { b.__daySepPinned = null; });
    }
    if (!sep) return;
    const nb = sep.closest('.chat-msgs') || document.querySelector('.chat-msgs');
    if (!nb) return;
    const targetTop = (mid)=>{
      /* Цель — сама плашка этой даты: встаёт на sticky-позицию, под ней
         сразу первое сообщение дня, и дата не переключается на соседнюю. */
      const sepEl = nb.querySelector('.day-sep[data-ds="' + mid + '"]');
      if (!sepEl) return null;
      const off = parseFloat(getComputedStyle(nb).paddingTop) || 0;
      /* У sticky-даты и rect, и offsetTop смещены к верху. Берём естественную
         позицию из кэша, иначе — снимаем sticky на один замер. */
      let nat = sepEl.__natTop;
      if (nat == null){
        const stick = sepEl.classList.contains('on-scroll');
        if (stick) sepEl.classList.remove('on-scroll');
        nat = nb.scrollTop + sepEl.getBoundingClientRect().top - nb.getBoundingClientRect().top;
        if (stick) sepEl.classList.add('on-scroll');
      }
      const raw = nat - off;
      const max = nb.scrollHeight - nb.clientHeight;
      const top = Math.max(0, Math.min(max, raw));
      return { top, moved: Math.abs(nb.scrollTop - top) > 4 };
    };
    const canScroll = (nb.scrollHeight - nb.clientHeight) > 4;
    const r0 = targetTop(sep.dataset.ds);
    if (!r0) return;
    const nowT = Date.now();
    const prev = nb.__daySepClick;
    if (prev && (nowT - prev.t) < 120) return; /* тот же клик пришёл вторым обработчиком */
    const second = prev && prev.ds === sep.dataset.ds && (nowT - prev.t) < 4000;
    nb.__daySepClick = { ds: sep.dataset.ds, t: nowT };
    if (!second){
      if (canScroll) nb.scrollTo({ top: r0.top, behavior: 'smooth' });
      return; /* первый клик — только скролл */
    }
    if (canScroll && r0.moved){
      nb.scrollTo({ top: r0.top, behavior: 'smooth' });
      return; /* с момента первого клика прокрутили — снова скроллим */
    }
    nb.__daySepClick = null;
    {
      const seps = [...nb.querySelectorAll('.day-sep[data-ds]')];
      if (seps.length){
        nb.__daySepPinned = sep.dataset.ds; /* плашка дат открыта — дата не рассеивается */
        sep.classList.remove('dim'); /* клик по дате — фиксируем её, не даём рассеяться */
        showDropdown(sep, seps.map(sp=>({
          label: sp.textContent.trim(),
          icon: 'calendar',
          onClick: ()=>{ const rr = targetTop(sp.dataset.ds); if (rr) nb.scrollTo({ top: rr.top, behavior: 'smooth' }); }
        })), { x: e.clientX, y: e.clientY });
      }
    }
  });
    /* Фон чата убран: чат использует единый дудл-фон приложения (подложка не нужна) */
    function applyChatBg(cm){
      if (!cm) return;
      cm.classList.remove('chat-bg--doodle','chat-bg--wave','chat-bg--none');
      cm.style.backgroundImage = 'none';
      cm.style.backgroundSize = '';
      cm.style.backgroundPosition = '';
    }
    const u = user();
    const allChats = chatForUser(u);
    /* Архив чатов (как в ТГ): скрытые чаты лежат в списке архива у пользователя */
    let archMode = false;
    const chats = () => allChats.filter(c => isArchived(c, u) === archMode);
    let curList = chats();
    curChat = curList.find(c=>c.id===curChat) ? curChat : curList[0]?.id;
    let emojiOpen = false;

    const renderList = ()=>{
      $$('.chat-item', root).forEach(el=>el.classList.toggle('on', el.dataset.ch===curChat));
    };

    /* ---------- Отрисовка «печатает…» (шапка + превью списка) ---------- */
    const typingHtml = (label)=>`<span class="typing-label"><span class="typing-text">${esc(label)}</span><span class="typing-dots"><i></i><i></i><i></i></span></span>`;
    const refreshTyping = ()=>{
      if (!document.body.contains(root)) return;
      /* Шапка активного чата */
      const sub = root.querySelector('#chat-head-sub');
      if (sub && curChat){
        const active = S.chats.find(x=>x.id===curChat);
        const who = typingWho(curChat, u.id);
        if (who.length){
          sub.dataset.base = sub.dataset.base || sub.textContent;
          sub.innerHTML = typingHtml(typingLabel(who));
          sub.classList.add('is-typing');
        } else if (sub.classList.contains('is-typing')){
          sub.textContent = sub.dataset.base != null ? sub.dataset.base : (active ? (active.description||'') : '');
          sub.classList.remove('is-typing');
        }
      }
      /* Превью в списке чатов */
      $$('.chat-item', root).forEach(el=>{
        const cid = el.dataset.ch;
        const pEl = el.querySelector('.p');
        if (!pEl) return;
        const who = typingWho(cid, u.id);
        if (who.length){
          if (pEl.dataset.base == null) pEl.dataset.base = pEl.textContent;
          pEl.textContent = typingLabel(who) + '…';
          pEl.classList.add('is-typing');
        } else if (pEl.classList.contains('is-typing')){
          pEl.textContent = pEl.dataset.base != null ? pEl.dataset.base : '';
          pEl.classList.remove('is-typing');
        }
      });
    };
    window.__typingChanged = refreshTyping;
    if (window.__typingTimer) clearInterval(window.__typingTimer);
    window.__typingTimer = setInterval(refreshTyping, 1000);
    if (!window.__typingStorage){
      window.__typingStorage = e => { if (e.key === 'aw_typing') refreshTyping(); };
      window.addEventListener('storage', window.__typingStorage);
    }

    /* Живое обновление превью в списке чатов (как в ТГ): черновик
       показывается меткой «Черновик:», после отправки/очистки превью
       пересоздаётся из последнего сообщения. Base не кэшируем — строим
       заново, чтобы не висло устаревшее превью после отправки. */
    const chatItemPreviewHtml = c => {
      const last = S.messages.filter(m=>m.chat_id===c.id).slice(-1)[0];
      const draft = chatDraftText(c).replace(/\s+/g,' ').trim();
      if (draft) return '<span class="chat-draft-prep">Черновик:</span> ' + esc(draft);
      if (!last) return esc(c.description||'');
      const author = userById(last.user_id);
      const text = String(last.text||'').replace(/\s+/g,' ').trim();
      if (last.user_id === u.id) return 'Вы: ' + esc(text);
      /* ЛС: имя собеседника очевидно (оно в заголовке) — показываем только текст, как в ТГ.
         В групповых чатах — имя автора перед текстом, чтобы было видно, кто написал. */
      if (c.type === 'direct') return esc(text);
      return esc((author ? author.full_name : '—') + ': ' + text);
    };
    const refreshDraftPreview = ()=>{
      if (!document.body.contains(root)) return;
      $$('.chat-item', root).forEach(el=>{
        const cid = el.dataset.ch;
        const pEl = el.querySelector('.p');
        if (!pEl || pEl.classList.contains('is-typing')) return;
        const c = S.chats.find(x=>x.id===cid);
        if (!c) return;
        pEl.innerHTML = chatItemPreviewHtml(c);
      });
    };
    window.__refreshDraftPreview = refreshDraftPreview;

    /* Аккуратная пересборка списка чатов (без мигалок): обновляем кэш allChats,
         пересоздаём содержимое .chat-list__scroll, сохраняя его скролл, и
         заново вешаем клики. Скролл контейнера и позиция чтения не сбиваются. */
    const rerenderChatList = ()=>{
      const sc = root.querySelector('.chat-list__scroll');
      if (!sc) return;
      const st = sc.scrollTop;
      allChats.length = 0; allChats.push(...chatForUser(u));
      curList = chats();
      if (!curList.some(c=>c.id===curChat)) curChat = curList[0]?.id || null;
      sc.innerHTML = groupChats(chats()).map(x=>{
        if (x.chat) return chatItemHtml(x.chat);
        return `<div class="chat-sec" data-sec="${x.key}">${esc(x.label)}</div>`;
      }).join('');
      bindChatItems();
      sc.scrollTop = st;
      renderList();
    };

    /* Переключение чата с лёгкой анимацией: новый чат плавно въезжает
       (лёгкий сдвиг + fade), как при смене диалога в ТГ. */
    const switchChat = (id, dir)=>{
      /* Пустое ЛС удаляется при выходе из чата (как в ТГ): если из личного
         сообщения так и не отправили ни одного сообщения, чат исчезает
         из списка. Проверяем на уходе со старого чата. */
      try {
        const pruned = typeof pruneEmptyDirects === 'function' ? pruneEmptyDirects() : 0;
        if (pruned){
          saveState();
          /* Сразу аккуратно убираем удалённый чат из DOM-списка — не ждём
             перезагрузки и не мигаем. */
          rerenderChatList();
        }
      } catch(e){}
      curChat = id;
      chatSel.set.clear(); chatSel.mode = false;
      /* Выбор чата в узком окне выходит из списка к ленте. Фильтры «Все/Архив»
         вызывают renderChat, но список при этом скрывать не должны. */
      { const hostWin = root.closest('.aw-win'); if (hostWin) hostWin.classList.remove('aw-win--chat-list'); }
      try { mobilePane(false); } catch(e){}
      chatReplyTo = null; chatEditMsg = null;
      const main = root.querySelector('.chat-main');
      if (!main) return;
      /* В полноэкранном режиме панель чата тоже перерисовываем: раньше здесь
         был ранний return, из-за него клик по списку в zen менял подсветку,
         но сам чат оставался прежним. */
      clearTimeout(main.__switchTimer);
      main.classList.remove('chat-switch--left','chat-switch--right');
      /* Принудительный reflow, чтобы класс снялся до добавления нового */
      void main.offsetWidth;
      main.classList.add(dir === 'right' ? 'chat-switch--right' : 'chat-switch--left');
      renderChat();
      try { mobilePane(false); } catch(e){}
      main.__switchTimer = setTimeout(()=>{
        const m2 = root.querySelector('.chat-main');
        if (m2) m2.classList.remove('chat-switch--left','chat-switch--right');
      }, 340);
    };

    /* Упоминания @username / @все в тексте сообщения — кликабельны.
       Русское написание — основное (не нужно переключать клавиатуру),
       латинское @all поддерживаем для старых сообщений и привычки.
       Держим на уровне chatsView: вызывается и из renderChat, и из обработчиков
       (раскрытие длинного сообщения), где const из renderChat недоступна. */
    /* Групповые упоминания по ролям: @админы, @менеджеры, @исполнители, @клиенты.
       Слова — строчными; латиница/падежи не поддерживаем, чтобы не ловить лишнее. */
    const ROLE_TAGS = [
      { role:'admin',       words:['администраторы','админы','админ'], label:'админы',        hint:'администраторы' },
      { role:'top_manager', words:['топ-менеджеры','топы'],           label:'топ-менеджеры', hint:'топ-менеджеры' },
      { role:'manager',     words:['менеджеры','менеджер'],           label:'менеджеры',     hint:'менеджеры' },
      { role:'executor',    words:['исполнители','исполнитель'],      label:'исполнители',   hint:'исполнители' },
      { role:'client',      words:['клиенты','клиент'],               label:'клиенты',       hint:'клиенты' }
    ];
    /* Теги специализаций исполнителей: @стенографирование, @копирайтинг… */
    const specWord = name => String(name || '').toLowerCase().replace(/[^а-яёa-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
    const SPEC_TAGS = (() => {
      const map = new Map();
      noDemo(S.users).filter(x => x.role === 'executor').forEach(x => {
        ((x.ext && x.ext.specializations) || []).forEach(n => {
          const w = specWord(n);
          if (w && !map.has(w)) map.set(w, { word: w, label: n });
        });
      });
      return [...map.values()];
    })();
    const roleTagByWord = w => ROLE_TAGS.find(r => r.words.includes(String(w || '').toLowerCase())) || null;
    const roleWordsRe = () => new RegExp('@(' + ROLE_TAGS.flatMap(r => r.words).join('|') + ')(?![а-яёa-z])', 'gi');

    const renderMentions = txt => {
      let h = esc(txt);
      h = h.replace(/@(все|all)(?![а-яёa-z])/gi, '<span class="msg-mention msg-mention--all" data-mention="all" role="button">@все</span>');
      /* Роли — до общего правила: кириллица в \w не входит, но порядок важен */
      h = h.replace(roleWordsRe(), (mm, w) => {
        const rt = roleTagByWord(w);
        return `<span class="msg-mention msg-mention--role" data-mention-role="${rt ? rt.role : ''}" role="button">@${esc(w)}</span>`;
      });
      /* Специализации — до общего правила (дефис в слове) */
      SPEC_TAGS.forEach(t => {
        const re = new RegExp('@' + t.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![а-яёa-z0-9-])', 'gi');
        h = h.replace(re, mm => `<span class="msg-mention msg-mention--role" data-mention-spec="${esc(t.word)}" role="button">${mm}</span>`);
      });
      h = h.replace(/@([\w.-]+)/g, (m2, un) => `<span class="msg-mention" data-mention="${esc(un)}" role="button">@${esc(un)}</span>`);
      return h.replace(/\n/g, '<br>');
    };

    /* ---------- Голосовые: волна и плеер как в ТГ ---------- */
    const VOICE_BARS = 44;
    /* Псевдо-волна до декодирования: детерминированная по id, чтобы лента не «прыгала» */
    const voiceBarsHtml = (seed) => {
      let h = 0; const str = String(seed || 'v');
      for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
      const rnd = () => { h = (h * 1664525 + 1013904223) >>> 0; return h / 4294967296; };
      let out = '';
      for (let i = 0; i < VOICE_BARS; i++){
        const shape = 0.45 + 0.25 * Math.sin((i / VOICE_BARS) * Math.PI * 2.4);
        const v = Math.max(0.16, Math.min(1, shape * 0.5 + rnd() * 0.6));
        out += '<i style="height:' + Math.round(v * 100) + '%"></i>';
      }
      return out;
    };
    const voiceHtml = (m) => {
      const src = (m.file && m.file.dataUrl) ? m.file.dataUrl : '';
      const dur = (m.file && m.file.duration) ? m.file.duration : 0;
      return '<div class="vn" data-voice="' + esc(m.id || '') + '" data-dur="' + dur + '">' +
        '<button type="button" class="vn__play" data-vn-play aria-label="Воспроизвести">' + icon('play','ico-sm') + '</button>' +
        '<div class="vn__main">' +
          '<div class="vn__wave" data-vn-wave>' + voiceBarsHtml(m.id) + '</div>' +
          '<div class="vn__row"><span class="vn__time" data-vn-time>' + fmtDur(dur) + '</span>' +
          '<button type="button" class="vn__speed" data-vn-speed title="Скорость воспроизведения">1×</button></div>' +
        '</div>' +
        '<audio preload="metadata" data-vn-audio src="' + esc(src) + '"></audio>' +
      '</div>';
    };
    /* Настоящие пики: декодируем аудио и кэшируем по src */
    const decodeVoicePeaks = async (src, n) => {
      try {
        const ACtx = window.AudioContext || window.webkitAudioContext;
        if (!ACtx) return null;
        const ctx = window.__voicePeakCtx || (window.__voicePeakCtx = new ACtx());
        const res = await fetch(src);
        const buf = await res.arrayBuffer();
        const audio = await ctx.decodeAudioData(buf);
        const ch = audio.getChannelData(0);
        const total = ch.length || 1;
        const step = Math.max(1, Math.floor(total / n));
        const out = [];
        for (let i = 0; i < n; i++){
          let max = 0;
          const start = i * step;
          const stride = Math.max(1, Math.floor(step / 120));
          for (let j = 0; j < step; j += stride){
            const v = Math.abs(ch[start + j] || 0);
            if (v > max) max = v;
          }
          out.push(max);
        }
        const mx = Math.max.apply(null, out.concat([0.0001]));
        return out.map(p => Math.max(0.14, Math.min(1, p / mx)));
      } catch(e){ return null; }
    };
    const applyVoicePeaks = (bars, peaks) => {
      if (!bars || !peaks || !peaks.length) return;
      bars.forEach((b, i) => {
        const v = peaks[Math.min(peaks.length - 1, Math.floor(i * peaks.length / bars.length))];
        if (v) b.style.height = Math.round(v * 100) + '%';
      });
    };
    const bindVoicePlayers = (root) => {
      const wraps = root.querySelectorAll('[data-voice]');
      wraps.forEach(wrap => {
        if (wrap.__vnBound) return;
        wrap.__vnBound = true;
        const audio = wrap.querySelector('[data-vn-audio]');
        const playBtn = wrap.querySelector('[data-vn-play]');
        const wave = wrap.querySelector('[data-vn-wave]');
        const timeEl = wrap.querySelector('[data-vn-time]');
        const speedBtn = wrap.querySelector('[data-vn-speed]');
        if (!audio || !playBtn || !wave) return;
        /* Показ ФАКТИЧЕСКОЙ длительности ДО воспроизведения: если в данных
           duration нет (0:00) — дозагружаем из метаданных аудио и подставляем
           в строку времени, пока пользователь не начал слушать. */
        let durShown = false;
        const showTotalDur = () => {
          if (durShown || !timeEl) return;
          const d = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
          if (d > 0){
            timeEl.textContent = fmtDur(d);
            durShown = true;
          }
        };
        const bars = [...wave.querySelectorAll('i')];
        const paint = () => {
          const d = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
          const p = d ? Math.min(1, Math.max(0, audio.currentTime / d)) : 0;
          const cnt = Math.round(p * bars.length);
          bars.forEach((b, i) => b.classList.toggle('on', i < cnt));
          wrap.style.setProperty('--vn-p', (p * 100).toFixed(2) + '%');
          if (timeEl){
            /* До воспроизведения — полная длительность; во время — текущая позиция */
            const cur = audio.currentTime || 0;
            if (!audio.paused || cur > 0.05) timeEl.textContent = fmtDur(cur);
            else showTotalDur();
            wrap.classList.toggle('vn--playing', !audio.paused);
          }
          if (d && wrap.dataset.dur !== String(d)) wrap.dataset.dur = String(d);
        };
        const setIcon = playing => { playBtn.innerHTML = icon(playing ? 'pause' : 'play', 'ico-sm'); playBtn.setAttribute('aria-label', playing ? 'Пауза' : 'Воспроизвести'); };
        playBtn.onclick = (e) => {
          e.stopPropagation();
          if (audio.paused){
            /* Одновременно играет только одно голосовое (как в ТГ) */
            document.querySelectorAll('[data-vn-audio]').forEach(a2 => { if (a2 !== audio) { try { a2.pause(); } catch(err){} } });
            audio.play().catch(()=> toast('Не удалось воспроизвести аудио', 'err'));
          } else audio.pause();
        };
        audio.addEventListener('play', ()=> setIcon(true));
        audio.addEventListener('pause', ()=>{ setIcon(false); paint(); });
        audio.addEventListener('ended', ()=>{ try { audio.currentTime = 0; } catch(err){} setIcon(false); paint(); });
        audio.addEventListener('timeupdate', paint);
        audio.addEventListener('loadedmetadata', paint);
        wave.addEventListener('click', (e) => {
          const r = wave.getBoundingClientRect();
          const d = audio.duration;
          if (!isFinite(d) || d <= 0) return;
          const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
          try { audio.currentTime = frac * d; } catch(err){}
          paint();
        });
        if (speedBtn){
          const speeds = [1, 1.5, 2];
          speedBtn.onclick = (e) => {
            e.stopPropagation();
            const cur = audio.playbackRate || 1;
            const next = speeds[(speeds.indexOf(cur) + 1) % speeds.length];
            audio.playbackRate = next;
            speedBtn.textContent = next === 1 ? '1×' : String(next).replace('.', ',') + '×';
            speedBtn.classList.toggle('vn__speed--fast', next !== 1);
          };
        }
        paint();
        const src = audio.getAttribute('src');
        if (src){
          const key = src.length > 160 ? src.slice(-160) : src;
          const cache = window.__voicePeaks || (window.__voicePeaks = new Map());
          if (cache.has(key)) applyVoicePeaks(bars, cache.get(key));
          else decodeVoicePeaks(src, bars.length).then(peaks => {
            if (!peaks) return;
            cache.set(key, peaks);
            applyVoicePeaks(bars, peaks);
          });
        }
      });
    };

    /* Участники чата для упоминаний: прямые member_ids/участники или те, кто писал */
    const chatMembers = (ch) => {
      if (ch.type==='corporate' || ch.type==='company') return noDemo(S.users).map(x=>x.id);
      if (ch.member_ids && ch.member_ids.length) return ch.member_ids;
      if (ch.participants && ch.participants.length) return ch.participants;
      if (ch.client_id) return [ch.client_id];
      return [...new Set(S.messages.filter(mm=>mm.chat_id===ch.id && mm.user_id).map(mm=>mm.user_id))];
    };
    /* Уведомление адресату упоминания или ответа на его сообщение — даже при
       выключенных уведомлениях чата. Ответ на своё сообщение = такой же пинг:
       в колокольчике, в списке чатов (метка «@») и в счётчике непрочитанных.
       Отметку непрочитанного ставим строго ДО сообщения (created_at − 1):
       если поставить «сейчас», только что пришедший ответ окажется раньше
       отметки и пинг не появится в списке. */
    const notifyMentioned = (uidv, whoName, chatName, msgText, opts) => {
      const tu = userById(uidv);
      if (!tu) return;
      const o = opts || {};
      const at = Number(o.at) || Date.now();
      const isReply = o.kind === 'reply';
      pushNotifTo(tu, (isReply ? 'Ответ на ваше сообщение в «' : 'Вас упомянули в «') + chatName + '»',
        whoName + ': ' + String(msgText||'').slice(0,90), 'i-chats');
      /* Непрочитанное в самом чате для адресата — даже если чат замьючен */
      const ch = (o.chat_id && S.chats.find(x=>x.id===o.chat_id)) || S.chats.find(x=>x.id===curChat);
      if (ch){
        ch.unread = ch.unread || {};
        const prev = Number(ch.unread[uidv]) || 0;
        const mark = Math.max(0, at - 1);
        ch.unread[uidv] = prev > 0 ? Math.min(prev, mark) : mark;
      }
      try { saveState(); } catch(e){}
    };

    /* «Закреплённая» сверху дата — последняя из тех, чей верх в документе
       уже ушёл выше верхнего края полосы (offsetTop <= scrollTop): она
       стоит у верха при прокрутке. Остальные даты лежат ниже края (в потоке)
       и гаснут. */
    /* Естественные позиции дат относительно содержимого ленты. Снимаются один
       раз при рендере (пока ни одна не залипла) — иначе проверка «дошла ли до
       верха» опиралась на уже смещённый sticky-прямоугольник и дата мигала. */
    const cacheDaySepTops = (box) => {
      if (!box) return false;
      /* Снимаем sticky-класс на время замера: у залипшей даты rect смещён
         к верхнему краю, и «естественная» позиция получилась бы неверной. */
      const pinned = box.querySelector('.day-sep.on-scroll');
      if (pinned) pinned.classList.remove('on-scroll');
      const seps = Array.from(box.querySelectorAll('.day-sep'));
      if (!seps.length) return false;
      /* Раскладка ещё не готова (перезагрузка, анимация окна): rect у дат
         нулевой. Такой кэш (всё по нулям) ломал закрепление даты — ждём
         следующий вызов после раскладки. */
      if (!seps.some(d => d.getBoundingClientRect().height > 0)) return false;
      const contentTop = box.getBoundingClientRect().top - box.scrollTop;
      seps.forEach(d => {
        d.__natTop = d.getBoundingClientRect().top - contentTop;
      });
      return true;
    };
    window.__cacheDaySepTops = () => {
      try { const b = $('#chat-msgs', root); if (b && cacheDaySepTops(b)) updateDaySep(b); } catch(e){}
    };
    const updateDaySep = (box) => {
      try {
        const seps = Array.from(box.querySelectorAll('.day-sep'));
        let pinned = null;
        /* Перед замером снимаем sticky-класс: у залипшей даты offsetTop уже
           смещён к верху, и дата «подтверждала» бы своё залипание сама.
           После расчёта класс вернём — в том же кадре, без мигания. */
        seps.forEach(d => d.classList.remove('on-scroll'));
        /* Залипает ПОСЛЕДНЯЯ дата, чей верх уже достиг/прошёл верхнюю грань
           полосы (relTop < 8), но следующая за ней ещё не дошла (иначе
           записались бы две подряд). В начале ленты ни одна не дошла —
           липнет первая (она и есть «текущий день» сверху). */
        const boxTop = box.getBoundingClientRect().top;
        /* Порог = реальный top залипания: в zen дата встаёт под плашкой названия
           чата (вплотную, ~6px от верха контента ленты), в обычном режиме —
           у верха полосы (8px). Фиксированные 8px в zen «отклеивали» уже
           прилипшую дату, и она мигала/накладывалась. */
        /* «Естественная» позиция даты = padding-top ленты + offsetTop.
           offsetTop не зависит от sticky-смещения и скролла, поэтому закрепление
           работает сразу после перезагрузки (кэш rect-ов там ещё не готов). */
        const padTop = parseFloat(getComputedStyle(box).paddingTop) || 0;
        const off = padTop; /* порог = верх контента под шапкой */
        const passed = d => ((d.offsetTop || 0) - box.scrollTop) <= off + 1;
        for (const d of seps) {
          if (passed(d)) pinned = d;
        }
        seps.forEach(d => d.classList.toggle('on-scroll', d === pinned));
        /* Пока идёт скролл — залипшая дата яркая; после остановки через
           ~2с бездействия плавно рассеивается (.dim), при возобновлении
           скролла снова проявляется. Даты в потоке не трогаем. */
        const idle = box.__daySepIdleTimer;
        if (idle) clearTimeout(idle);
        seps.forEach(d=>{ if (d !== pinned) return; d.classList.remove('dim'); });
        /* Если дата перестала быть залипшей (ушла вверх), следов dim не
           остаётся — снимаем со всех, кроме той, что сейчас липнет. */
        seps.forEach(d=>{ if (d !== pinned) d.classList.remove('dim'); });
        box.__daySepIdleTimer = setTimeout(()=>{
          try {
            if (!box.isConnected) return;
            /* Плашка дат открыта по клику — дату не рассеиваем, чтобы по ней
               можно было кликнуть повторно, пока список открыт. */
            if (box.__daySepPinned) return;
            const p = box.querySelector('.day-sep.on-scroll');
            if (p) p.classList.add('dim');
          } catch(e){}
        }, 2000);
      } catch(e){}
    };
    let lastRenderedChat = null;
    const renderChat = ()=>{
      const c = S.chats.find(x=>x.id===curChat);
      if (!c) return;
      /* Запомнить скролл ПРЕДЫДУЩЕГО чата (если переключаемся) — он сохранится
         и восстановится при возврате. */
      if (chatRenderedChatId && chatRenderedChatId !== c.id){
        const curBox = document.querySelector('#chat-msgs');
        if (curBox) chatScrollMap[chatRenderedChatId] = { scrollTop: curBox.scrollTop, scrollHeight: curBox.scrollHeight };
      }
      const msgs = noDemo(S.messages.filter(m=>m.chat_id===c.id)).sort((a,b)=>a.created_at-b.created_at);
      /* Снимок «что уже было на экране»: новые сообщения анимируем появлением,
         при первом открытии чата (prevRenderIds === null) — не анимируем вовсе. */
      const prevRenderIds = (chatRenderedChatId === c.id) ? chatRenderedIds : null;
      chatRenderedChatId = c.id;
      chatRenderedIds = new Set(msgs.map(m=>m.id));

      /* Отметки прочтения: сообщения, видимые мной (не мои), помечаются прочитанными.
         Делаем один проход и сохраняем, только если что-то изменилось. */
      {
        let dirty = false;
        msgs.forEach(mm=>{
          if (mm.user_id !== u.id){
            if (!mm.readBy) mm.readBy = [];
            else if (!Array.isArray(mm.readBy)) mm.readBy = [];
            if (!mm.readBy.includes(u.id)){ mm.readBy.push(u.id); dirty = true; }
          }
        });
        if (dirty) { try { saveState(); } catch(e){} }
      }
      /* Системные строки-действия, как в Telegram: «X закрепил сообщение» */
      const pushChatAction = (txt)=>{ S.messages.push({ id:uid(), chat_id:c.id, user_id:null, type:'system', text:txt, created_at:Date.now() }); saveState(); };
      const canModerate = isStaff(u.role);
      /* «Не работаю» = невидимка: статус в чатах не показываем */
      const ghost = !!(u.ext && u.ext.workStatus === 'not_working');

      let lastDay = '';
      /* Порог «короткого времени» для группировки (как в ТГ): сообщения одного
         автора идут в одну группу, только если между ними < 8 минут. */
      const GROUP_MS = 8 * 60 * 1000;
      /* Группы сообщений одного автора подряд: у группы один аватар, снизу.
         Аватар sticky — при скролле прилипает к низу области сообщений. */
      const blocks = msgs.map((m, mi) => {
        const day = new Date(m.created_at).toDateString();
        if (m.type === 'system'){
          return { userId:null, own:false, sys:true, daySep:'', html:`<div class="msg-system" data-msg="${m.id}"><span>${esc(m.text)}</span></div>` };
        }
        /* Кнопка-дата: клик скроллит к первому сообщению этого дня */
        const daySep = day !== lastDay ? `<div class="day-sep" data-ds="${m.id}"><span role="button" tabindex="0" title="К первому сообщению этого дня">${new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long'}).format(m.created_at)}</span></div>` : '';
        lastDay = day;
        const own = m.user_id === u.id;
        const author = userById(m.user_id);
        let whoColor = '';
        if (!own && author){
          const AV_COLORS = ['#7a95c4','#c4907a','#8fb0a0','#c4a57a','#9a8fc0','#b08fb0','#7ab0b0','#c0a08a'];
          let hue = 0; const n = (author.full_name||'').trim();
          for (let i = 0; i < n.length; i++) hue = (hue * 31 + n.charCodeAt(i)) >>> 0;
          whoColor = AV_COLORS[hue % AV_COLORS.length];
        }
        const repSrc = m.reply_to ? S.messages.find(x=>x.id===m.reply_to) : null;
        const repAuthor = repSrc ? userById(repSrc.user_id) : null;
        const quoteHtml = repSrc ? `<div class="msg__quote" data-quote="${repSrc.id}"><b>${esc(repAuthor?repAuthor.full_name:'—')}</b><span>${esc((m.reply_text || repSrc.text || '').slice(0,90))}</span></div>` : '';
        const fwdAuthor = m.forwarded_from ? userById(m.forwarded_from.user_id) : null;
        const fwdHtml = m.forwarded_from ? `<div class="msg__fwd">${icon('send','ico-sm')} Переслано${fwdAuthor?' от '+esc(fwdAuthor.full_name):''}</div>` : '';
        /* Ответы на это сообщение: стрелка со счётчиком, как в ТГ */
        const repliesN = msgs.reduce((acc,x)=>acc + (x.reply_to === m.id ? 1 : 0), 0);
        const repliesBtn = repliesN ? `<button class="msg__replies" data-replies="${m.id}" title="Посмотреть ответы">${icon('chev-r','ico-sm')}<span>${repliesN}</span></button>` : '';
        /* Язычок — только у последнего сообщения группы (правило 8 минут) */
        const nxm = msgs[mi + 1];
        const isTail = !(nxm && nxm.type !== 'system' && nxm.user_id === m.user_id
          && new Date(nxm.created_at).toDateString() === day
          && (nxm.created_at - m.created_at) < GROUP_MS);
        const reactions = m.reactions ? Object.entries(m.reactions).filter(([,us])=>us.length).map(([em,us])=>{
          return `<button class="react-pill ${us.includes(u.id)?'on':''}" data-react="${m.id}|${em}" title="Реакция ${em}">${em}<span class="react-face${us.length>3?' react-face--num':''}">${reactionFaceHtml(us, em)}</span></button>`;
        }).join('') : '';
        /* Опрос ищем по poll_id самого сообщения: раньше брался первый опрос чата,
           и все опросы в переписке показывали варианты самого первого. */
        const msgPoll = m.poll_id ? S.polls.find(pp=>pp.id===m.poll_id) : null;
        const pollHtml = msgPoll ? pollHTML(msgPoll, u) : '';
        /* Карточки-артефакты: контакт и заказ (как в ТГ) */
        const isArtifact = (m.type === 'contact' || m.type === 'order' || m.type === 'voice');
        const artifactHtml = m.type === 'contact'
          ? (()=>{ const p2 = userById(m.contact_id); return `<button type="button" class="msg__artifact" data-contact="${esc(m.contact_id||'')}"><span class="avatar avatar--sm avatar--grad" style="${avatarGrad(p2?p2.full_name:'—')}">${initials(p2?p2.full_name:'—')}</span><span class="msg__artifact-txt"><b>${esc(p2?p2.full_name:'—')}</b><span class="small muted">${esc(p2?(ROLE_LABEL[p2.role]||''):'')}</span></span></button>`; })()
          : m.type === 'order'
          ? (()=>{ const o = S.orders.find(x=>x.order_id===m.order_ref) || S.orders.find(x=>x.id===m.order_ref); return `<button type="button" class="msg__artifact" data-order-ref="${esc(m.order_ref||'')}"><span class="msg__artifact-ico">${icon('orders')}</span><span class="msg__artifact-txt"><b>${esc(m.order_ref||'—')}</b><span class="small muted">${esc((clientById(o&&o.client_id)||{}).full_name||'')}${o?' · '+fmtMoney(o.total):''}</span></span></button>`; })()
          : '';
        /* Длинные сообщения обрезаем (как в WhatsApp): превью + «Показать ещё» */
        const LONG_CUT = 340;
        const isLong = (m.text||'').length > LONG_CUT;
        let txtRender;
        if (isLong){
          txtRender = `<span class="txt-c">${esc(m.text.slice(0, LONG_CUT))}…</span>` +
            `<button type="button" class="msg__more" data-mid="${m.id}" title="Раскрыть сообщение">Показать ещё (${m.text.length - LONG_CUT})</button>`;
        } else {
          txtRender = renderMentions(m.text);
        }
        /* Вложения: фото, файл, голосовое */
        const fileHtml = m.file ? (m.type === 'image'
          ? `<img class="msg__img" src="${esc(m.file.dataUrl||'')}" alt="${esc(m.file.name||'изображение')}" loading="lazy">`
          : m.type === 'voice'
            ? voiceHtml(m)
            : `<a class="msg__file" href="${esc(m.file.dataUrl||'')}" download="${esc(m.file.name||'файл')}">${icon('clip','ico-sm')}<span>${esc(m.file.name||'файл')}</span></a>`) : '';
        /* Время с галочками, счётчиком ответов и пометкой «изменено».
           Без реакций и вложений его можно пустить прямо в строку с текстом
           (float справа): короткое сообщение остаётся одной строкой, длинное
           получает время у правого края последней строки. Отдельная нижняя
           строка нужна только реакциям — они и меняют высоту пузыря. */
        const timeInner = `${repliesBtn}${m.edited?`<span class="msg__edited" title="${esc('Изменено ' + fmtDT(m.editedAt||m.created_at))}">изменено</span>`:''}${fmtTime(m.created_at)}${own?`<span class="ticks" title="${(m.readBy||[]).length?('Прочитано'):'Доставлено, ещё не прочитано'}"><span class="ticks__ic ${(m.readBy||[]).length>0?'on':''}">${(m.readBy||[]).length>0?icon('checks','ico-sm'):icon('check','ico-sm')}</span></span>`:''}`;
        const inlineTime = !reactions && !fileHtml && !artifactHtml && !pollHtml;
        const timeHtml = `<span class="time${inlineTime?' time--in':''}">${timeInner}</span>`;
        return {
          userId: m.user_id, own, daySep, created_at: m.created_at,
          html: `<div class="msg ${own?'msg--own':''}${isTail ? ' msg--tail' : ''}${chatSel.set.has(m.id) ? ' msg--sel' : ''}" data-msg="${m.id}">
            <button type="button" class="msg-quick" data-quick="${m.id}" title="Поставить 👍" aria-label="Поставить 👍">👍</button>
            <div class="msg__bubble">
              ${own?'':`<div class="who" data-av-uid="${esc(m.user_id||'')}" title="Открыть профиль" style="cursor:pointer;${whoColor?`color:${whoColor};`:''}"><span class="who__name">${esc(author.full_name)}</span>${isStaff(author.role)?`<span class="role-mark role-mark--${author.role}" title="${esc(ROLE_LABEL[author.role])}">${icon('shield','ico-sm')}</span>`:''}${c.owner_id===m.user_id?'<span class="chat-role-tag chat-role-tag--owner">владелец</span>':''}${canModerate&&ghost?' <span class="ghost-mode-note">'+icon('eye-off','ico-sm')+' невидимка</span>':''}</div>`}
              ${fwdHtml}
              ${quoteHtml}
              <div class="txt">${m.pinned?`<span class="msg__pin-ico" title="Закреплено">${icon('pin','ico-sm')}</span>`:''}${m.type==='poll'?`<span class="msg__poll-ico">${icon('poll','ico-sm')}</span>`:''}${isArtifact ? '' : txtRender}${inlineTime?timeHtml:''}</div>
              ${fileHtml}
              ${artifactHtml}
              ${pollHtml}
              ${inlineTime?'':`<div class="msg__foot">${reactions?`<div class="msg__reactions">${reactions}</div>`:''}${timeHtml}</div>`}
            </div>
          </div>`
        };
      });
      /* Порог "короткого времени" для группировки (логика ТГ): сообщения
         одного автора идут в одну группу, только если между ними < 8 минут.
         За пределами порога — новая группа (обособленно, с отступом). */
      const groups = [];
      blocks.forEach(b => {
        const last = groups[groups.length - 1];
        const same = last && !b.daySep && !b.sys && !last.sys
          && last.userId === b.userId && last.own === b.own
          && (b.created_at - (last.lastT || 0)) < GROUP_MS;
        if (same){ last.items.push(b.html); last.lastT = b.created_at; }
        else groups.push({ userId: b.userId, own: b.own, sys: b.sys, daySep: b.daySep, items: [b.html], lastT: b.created_at });
      });
      const msgsHtml = groups.map(g => {
        const author = userById(g.userId);
        let av = g.own ? '' : avatarHTML(author, 'avatar--sm');
        /* Тултип статуса и якорь профиля на аватаре автора */
        if (!g.own) av = av.replace('<span class="avatar',
          `<span data-av-uid="${esc(g.userId)}" title="${esc(userOnlineTitle(g.userId, msgs))}" class="avatar`);
        if (g.sys) return `${g.daySep || ''}${g.items.join('')}`;
        return `${g.daySep || ''}<div class="msg-group ${g.own?'msg-group--own':''}">${av}<div class="msg-group__col">${g.items.join('')}</div></div>`;
      }).join('');

const cm = root.querySelector('.chat-main');
      /* Скролл ленты чата: запоминаем его при каждом рендере (переключение
         вкладок меню / чатов) и восстанавливаем позже. При первом открытии
         чата без истории скролла — по умолчанию в самый низ (последнее сообщение). */
      const mem = chatScrollMap[c.id];
      let savedScroll = mem ? mem.scrollTop : 0, savedScrollHeight = mem ? mem.scrollHeight : 0;
      /* Плашки ответа/редактирования: запоминаем, была ли плашка на экране до
         перерисовки, чтобы анимировать только первое появление и плавное
         исчезновение, а не каждый рендер. */
      const sameChatBefore = lastRenderedChat === c.id;
      const oldReplyBar = sameChatBefore ? root.querySelector('.chat-main #chat-reply') : null;
      const oldEditBar = sameChatBefore ? root.querySelector('.chat-main #chat-edit') : null;
      const replyBarSrc = (chatReplyTo && chatReplyTo.chat_id === c.id) ? chatReplyTo : null;
      const editBarSrc = (chatEditMsg && chatEditMsg.chat_id === c.id) ? chatEditMsg : null;
      const replyBarIn = !!replyBarSrc && (!oldReplyBar || Date.now() < chatBarAnimUntil.reply);
      const editBarIn = !!editBarSrc && (!oldEditBar || Date.now() < chatBarAnimUntil.edit);
      if (replyBarSrc && !oldReplyBar) chatBarAnimUntil.reply = Date.now() + 420;
      if (editBarSrc && !oldEditBar) chatBarAnimUntil.edit = Date.now() + 420;
      const replySrc = (chatReplyTo && chatReplyTo.chat_id === c.id) ? chatReplyTo : null;
      const replyAuthor = replySrc ? userById(replySrc.user_id) : null;
      const replyPrev = replySrc ? `<div class="chat-reply${replyBarIn ? ' chat-reply--in' : ''}" id="chat-reply">
          <span class="chat-reply__bar"></span>
          <div class="chat-reply__txt"><b>${esc(replyAuthor?replyAuthor.full_name:'—')}</b><span class="${replySrc.replyText?'chat-reply__quote':''}">${esc((replySrc.replyText || replySrc.text || '').slice(0,110))}</span></div>
          <button class="iconbtn" id="chat-reply-x" title="Отменить ответ">${icon('x')}</button>
        </div>` : '';
      const editSrc = (chatEditMsg && chatEditMsg.chat_id === c.id) ? chatEditMsg : null;
      const selPrev = (chatSel.mode && c.id === curChat) ? `<div class="chat-sel" id="chat-sel">
          <b>Выбрано: <span id="chat-sel-n">${chatSel.set.size}</span></b>
          <span class="spacer"></span>
          <button class="btn btn--ghost btn--sm" id="chat-sel-fwd">${icon('send','ico-sm')} Переслать</button>
          <button class="btn btn--ghost btn--sm btn--danger" id="chat-sel-del">${icon('trash','ico-sm')} Удалить</button>
          <button class="iconbtn" id="chat-sel-x" title="Снять выделение">${icon('x','ico-sm')}</button>
        </div>` : '';
      const editPrev = editSrc ? `<div class="chat-edit${editBarIn ? ' chat-reply--in' : ''}" id="chat-edit" title="Нажмите, чтобы перейти к сообщению">
          <span class="chat-reply__bar chat-edit__bar"></span>
          <div class="chat-reply__txt"><b>Редактирование</b><span>${esc((editSrc.text||'').slice(0,110))}</span></div>
          <button class="iconbtn" id="chat-edit-x" title="Отменить редактирование">${icon('x')}</button>
        </div>` : '';
      /* Сохраняем фокус и позицию курсора ДО пересоздания DOM: после отправки
         сообщения (renderChat пересоздаёт #chat-t) поле ввода не должно
         терять фокус — курсор продолжает стоять в текстовой области. */
      const prevFocus = document.activeElement;
      const prevFocusWasInput = !!(prevFocus && (prevFocus.id==='chat-t' || prevFocus.tagName==='TEXTAREA'));
      const prevSel = prevFocusWasInput && prevFocus.setSelectionRange
        ? [prevFocus.selectionStart, prevFocus.selectionEnd] : null;
      root.querySelector('.chat-main').innerHTML = `
        <div class="chat-head">
          <button class="iconbtn" id="chat-back" style="display:none">${icon('chev-l')}</button>
          <span class="chat-head__av chat-head__av--lv">${avatarHTML({ full_name:c.name, avatar:c.avatar, is_online:true }, '')}</span>
          <div class="chat-head__meta"><b>${esc(c.name)}</b><span id="chat-head-sub">${esc(c.description||'')}</span></div>
          <span class="spacer"></span>
          ${ghost?'<span class="ghost-mode-note">'+icon('eye-off','ico-sm')+' режим невидимки</span>':''}
          <button class="iconbtn sound-toggle ${c.soundOff?'is-off':''}" id="chat-sound" title="${c.soundOff?'Включить звук новых сообщений':'Выключить звук новых сообщений'}" aria-label="Звук новых сообщений">${icon('bell')}${EYE_SLASH}</button>
          <button class="iconbtn" id="chat-more">${icon('more')}</button>
        </div>
<div class="pinned-msg-bar" id="chat-pinned" hidden></div>
        <div class="chat-msgs" id="chat-msgs">${msgsHtml || '<div class="empty">'+icon('chats')+'<span>Сообщений ещё нет — напишите первым</span></div>'}</div>
        ${replyPrev}
        ${editPrev}
        ${selPrev}
        <div class="chat-input">
          <input type="file" id="chat-file" hidden accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip">
          <button class="iconbtn" id="btn-attach" title="Прикрепить файл">${icon('clip')}</button>
          <textarea id="chat-t" rows="1" placeholder="Сообщение…">${editSrc?esc(editSrc.text||''):''}</textarea>
          <button class="iconbtn" id="btn-emoji" title="Стикеры и эмодзи">${icon('sticker')}</button>
          <button class="btn btn--primary btn--icon chat-send-toggle" id="btn-send" aria-label="Отправить" title="Отправить">
            <span class="chat-send-ic" id="send-ic-mic" title="Голосовое сообщение">${icon('mic')}</span>
            <span class="chat-send-ic chat-send-ic--plane" id="send-ic-plane" title="Отправить">${icon('send')}</span>
          </button>
        </div>`;
      /* Закрытую плашку не выдёргиваем мгновенно: возвращаем её новым слоем и
         гасим тем же движением, что и появление. */
      (() => {
        const cm2 = root.querySelector('.chat-main');
        if (!cm2) return;
        [['#chat-reply', oldReplyBar], ['#chat-edit', oldEditBar]].forEach(([sel, old]) => {
          if (!old || cm2.querySelector(sel)) return;
          old.removeAttribute('id');
          old.classList.remove('chat-reply--in');
          old.classList.add('chat-reply--ghost');
          cm2.appendChild(old);
          requestAnimationFrame(() => old.classList.add('chat-reply--out'));
          setTimeout(() => old.remove(), 280);
        });
      })();
      const box = $('#chat-msgs', root);
      const hideUntilReady = box && lastRenderedChat !== c.id;
      if (box) lastRenderedChat = c.id;
      if (hideUntilReady) box.style.visibility = 'hidden';
      if (box){
        /* Уже виденный чат/переключение вкладки: восстанавливаем запомненный скролл.
           Совсем новый чат (без истории скролла) — показываем низ (последнее сообщение).
           Применяем после раскладки (rAF), чтобы scrollHeight был уже актуален. */
        const isNewChat = !(mem && mem.scrollHeight > 0);
        const scrollToBottom = () => {
          if (!box.isConnected || box.scrollHeight <= 0) return;
          box.scrollTop = box.scrollHeight;
          chatScrollMap[c.id] = { scrollTop: box.scrollTop, scrollHeight: box.scrollHeight };
        };
        /* Целевая позиция ленты: низ, если читали у низа, иначе — сохранённая. */
        const initialTarget = () => {
          if (mem && mem.scrollHeight > 0){
            const ch = box.clientHeight || 0;
            return (savedScroll + ch >= mem.scrollHeight - 60) ? box.scrollHeight : savedScroll;
          }
          return box.scrollHeight; /* первый показ — в самый низ */
        };
        /* СРАЗУ, в том же кадре, до первой отрисовки. Раньше позиция ставилась
           только в двойном rAF — первый кадр показывал НАЧАЛО ленты, и при
           переключении чатов было лёгкое мерцание «верха». Чтение clientHeight/
           scrollHeight форсирует раскладку, поэтому позиция уже верна к paint. */
        if (box.scrollHeight > 0){
          box.scrollTop = initialTarget();
          chatScrollMap[c.id] = { scrollTop: box.scrollTop, scrollHeight: box.scrollHeight };
        }
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!box.isConnected || box.scrollHeight <= 0) return;
          /* После перезагрузки шапка чата может быть ещё не измерена — верхний
             паддинг встал бы 8px вместо 63px, и дата не закреплялась. */
          try { syncChatPads(); } catch(e){}
          box.scrollTop = initialTarget();
          chatScrollMap[c.id] = { scrollTop: box.scrollTop, scrollHeight: box.scrollHeight };
          if (hideUntilReady) box.style.visibility = '';
          /* Раскладка готова — снимаем корректные «естественные» позиции дат. */
          try { if (cacheDaySepTops(box)) updateDaySep(box); } catch(e){}
          /* Ещё раз после анимации окна и подгрузки шрифтов: размеры шапки
             стабилизируются позже первого кадра. */
          [120, 480].forEach(delay => setTimeout(() => {
            requestAnimationFrame(() => {
              if (!box.isConnected) return;
              try { syncChatPads(); } catch(e){}
            });
          }, delay));
          /* Новый чат: лента продолжает расти (контент догружается, окно только
             открылось и ещё анимируется, syncChatPads ставит нижний паддинг позже).
             Одиночной установки scrollTop не хватает — последнее сообщение
             остаётся под плашкой ввода после открытия чата после reload.
             Дожимаем до низа ещё раз ПОСЛЕ стабилизации раскладки: сразу (90мс)
             и после анимации появления окна (420мс). */
          if (isNewChat){
            [90, 420].forEach(delay => setTimeout(() => {
              requestAnimationFrame(() => {
                if (!box.isConnected) return;
                if (box.scrollTop + box.clientHeight >= box.scrollHeight - 40) scrollToBottom();
              });
            }, delay));
          }
        }));
        if (hideUntilReady) setTimeout(()=>{ try { if (box.isConnected) box.style.visibility = ''; } catch(e){} }, 450);
        cacheDaySepTops(box);
        box.addEventListener('scroll', () => {
          chatScrollMap[c.id] = { scrollTop: box.scrollTop, scrollHeight: box.scrollHeight };
        }, { passive:true });
      }
      /* Новые сообщения (которых не было в прошлом рендере этого чата) въезжают
         плавно; остальная лента остаётся неподвижной. */
      if (box && prevRenderIds){
        box.querySelectorAll('[data-msg]').forEach(el => {
          if (!prevRenderIds.has(el.dataset.msg)) el.classList.add('msg--in');
        });
      }
      try { bindVoicePlayers(root); } catch(e){}
      /* Свайп-ответ (мобильный жест, как в ТГ): чужое сообщение — вправо,
         своё — влево. Срабатывает при горизонтальном сдвиге > 60px. */
      if (box){
        let sx = 0, sy = 0, cur = null, tracking = false;
        box.addEventListener('pointerdown', e=>{
          if (e.pointerType !== 'touch') return;
          const el = e.target.closest('.msg');
          if (!el) return;
          sx = e.clientX; sy = e.clientY; cur = el; tracking = true;
        });
        box.addEventListener('pointermove', e=>{
          if (!tracking || !cur) return;
          const dx = e.clientX - sx, dy = e.clientY - sy;
          if (Math.abs(dx) < 8) return;
          if (Math.abs(dy) > Math.abs(dx)){ tracking = false; cur.style.transform = ''; return; }
          cur.style.transform = 'translateX(' + Math.max(-90, Math.min(90, dx * 0.6)) + 'px)';
        });
        box.addEventListener('pointerup', e=>{
          if (!tracking || !cur){ tracking = false; return; }
          const dx = e.clientX - sx, dy = e.clientY - sy;
          const mm = S.messages.find(x=>x.id === cur.dataset.msg);
          const own = mm && mm.user_id === u.id;
          cur.style.transform = '';
          tracking = false;
          if (mm && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && (own ? dx < 0 : dx > 0)){
            chatReplyTo = mm; delete chatReplyTo.replyText; renderChat();
            const tt = $('#chat-t', root); if (tt) tt.focus();
          }
          cur = null;
        });
        box.addEventListener('pointercancel', ()=>{ tracking = false; if (cur) cur.style.transform = ''; cur = null; });
      }
      /* Панель «Закреплено» в шапке чата (как в ТГ) */
      const pinnedMsg = msgs.find(mm => mm.pinned);
      const pbar = $('#chat-pinned', root);
      if (pbar){
        if (pinnedMsg){
          const pa = userById(pinnedMsg.user_id);
          pbar.hidden = false;
          pbar.innerHTML = `<span class="pinned-msg-bar__ico">${icon('pin','ico-sm')}</span>
            <span class="pinned-msg-bar__body"><b>${esc(pa?pa.full_name:'')}</b><span>${esc((pinnedMsg.text||'').slice(0,80))}</span></span>
            <button class="iconbtn" id="chat-pinned-x" aria-label="Открепить">${icon('x','ico-sm')}</button>`;
          if (window.__pinnedShownId !== pinnedMsg.id){
            window.__pinnedShownId = pinnedMsg.id;
            pbar.classList.add('pin-in');
            setTimeout(()=>{ try { pbar.classList.remove('pin-in'); } catch(e){} }, 220);
          }
          const px = pbar.querySelector('#chat-pinned-x');
          if (px) px.onclick = ()=>{
            pinnedMsg.pinned = false; saveState();
            pbar.classList.add('closing');
            setTimeout(()=>{ try { renderChat(); } catch(e){} }, 160);
          };
          /* Клик по плашке — список ВСЕХ закреплённых, как в ТГ */
          pbar.style.cursor = 'pointer';
          pbar.onclick = (ev)=>{
            if (ev.target.closest('#chat-pinned-x')) return;
            if (typeof showDropdown !== 'function') return;
            const all = msgs.filter(mm => mm.pinned);
            if (!all.length) return;
            showDropdown(pbar, all.map(mm => {
              const aa = userById(mm.user_id);
              return { label: (aa ? aa.full_name + ': ' : '') + String(mm.text || '').slice(0, 60), icon:'pin', onClick:()=>{
                  const t = box && box.querySelector('.msg[data-msg="' + mm.id + '"]');
                  if (t){
                    t.scrollIntoView({ block:'center', behavior:'smooth' });
                    t.classList.add('msg--flash');
                    setTimeout(()=>t.classList.remove('msg--flash'), 1300);
                  }
                } };
            }), {});
          };
        } else {
          pbar.hidden = true; pbar.innerHTML = '';
        }
      }
      /* Клик по дате: если дата ещё НЕ залипла — плавный скролл к первому
         сообщению этого дня (и она залипнет у верха). Если дата уже
         залипла (стоит у верха) — повторный клик открывает список ВСЕХ
         дат чата, где есть сообщения, и можно перейти к любой (как в ТГ).
         DOM перечитываем на момент клика: чат пересоздаётся рендерами. */
      if (box){
        /* Даты берём из самих плашек: msgs может быть уже отфильтрован,
           и список оказывался пустым. */
        const allDayLabels = [...box.querySelectorAll('.day-sep[data-ds]')].map(sep => ({
          key: sep.textContent.trim(),
          firstId: sep.dataset.ds
        }));
        const dayLabel = key => key;
        const scrollToMsg = (mid)=>{
          const b2 = $('#chat-msgs', root);
          const t = b2 && b2.querySelector('.msg[data-msg="' + mid + '"]');
          if (!t || !b2 || !b2.scrollTo) return { moved:false };
          const top = Math.max(0, t.offsetTop - 34); /* запас под sticky-дату */
          const moved = Math.abs(b2.scrollTop - top) > 4;
          b2.scrollTo({ top, behavior: 'smooth' });
          return { moved };
        };
      }
      /* Сообщения идут от верхней плашки вниз: прижатие к низу при малом
         числе сообщений убрано (создавало пустоту под плашкой). */
      if (box) box.style.paddingTop = '';
      try { syncChatPads(); } catch(e){}
      try { if (widgetEl()) { renderWidget(); widgetEl().classList.add('pulse'); } } catch(e){}
      /* Применить сохранённый фон чата к контейнеру */
      applyChatBg(root.querySelector('.chat-main'));
      /* Кнопка «Вниз»: создаём ВСЕГДА (если в чате есть что прокручивать) и
         только прячем/показываем по факту прокрутки. Раньше она создавалась
         лишь когда при открытии пользователь был не у низа — и не появлялась,
         если он уходил вверх уже после открытия. */
      const oldDown = root.querySelector('.chat-msgs-down');
      if (oldDown) oldDown.remove();
      const downBtn = document.createElement('button');
      downBtn.className = 'chat-msgs-down';
      downBtn.innerHTML = icon('chev-d');
      downBtn.title = 'Вниз';
      downBtn.onclick = () => { const b = $('#chat-msgs', root); if (b) b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }); };
      downBtn.classList.add('is-hidden');
      /* Счётчик новых входящих (как в ТГ): растёт, пока пользователь не у низа */
      let newCount = 0;
      const newCountEl = document.createElement('span');
      newCountEl.className = 'chat-msgs-down__cnt';
      newCountEl.hidden = true;
      downBtn.appendChild(newCountEl);
      const bumpNew = ()=>{
        const b = $('#chat-msgs', root);
        const atBottom = !b || (b.scrollHeight - b.scrollTop - b.clientHeight) < 60;
        if (atBottom){ newCount = 0; newCountEl.hidden = true; return; }
        newCount++;
        newCountEl.textContent = newCount;
        newCountEl.hidden = false;
        /* Пинг: лёгкая пульсация бейджа */
        newCountEl.classList.remove('ping');
        void newCountEl.offsetWidth;
        newCountEl.classList.add('ping');
      };
      const resetNew = ()=>{
        newCount = 0; newCountEl.hidden = true;
      };
      downBtn.appendChild(newCountEl);
      downBtn.onclick = () => {
        const b = $('#chat-msgs', root);
        if (b) b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' });
        resetNew();
      };
      downBtn.__bump = bumpNew;
      root.querySelector('.chat-main').appendChild(downBtn);
      /* Плавное появление/скрытие: класс .is-hidden вместо атрибута hidden.
         При показе сначала снимаем скрытие в начале кадра, чтобы браузер
         зафиксировал состояние opacity:0 и запустил transition. */
      let __downVisible = false, __downTimer = null;
      const setDownVisible = (show)=>{
        if (!!show === __downVisible) return;
        __downVisible = !!show;
        clearTimeout(__downTimer);
        if (!show){ downBtn.classList.add('is-hidden'); return; }
        downBtn.classList.add('is-hidden');
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          if (!downBtn.isConnected || !__downVisible) return;
          downBtn.classList.remove('is-hidden');
        }));
      };
      downBtn.__setVisible = setDownVisible;
      const syncDown = () => {
        const b = $('#chat-msgs', root);
        if (!b || !downBtn.isConnected) return;
        setDownVisible((b.scrollHeight - b.scrollTop - b.clientHeight) >= 60);
        if ((b.scrollHeight - b.scrollTop - b.clientHeight) < 60) resetNew();
      };
      syncDown();
      /* Пересчитываем и при изменении размеров (zen, окна, ресайз) */
      if (window.__chatDownResize) window.removeEventListener('resize', window.__chatDownResize);
      window.__chatDownResize = syncDown;
      window.addEventListener('resize', () => { syncDown(); if (window.__cacheDaySepTops) window.__cacheDaySepTops(); });
      /* Память прокрутки чата (по ID чата) */
      box && box.addEventListener('scroll', () => {
        try { sessionStorage.setItem('chatScroll_' + c.id, String(box.scrollTop)); } catch(e){}
        const dd = root.querySelector('.chat-msgs-down');
        if (dd && typeof dd.__setVisible === 'function') dd.__setVisible(box.scrollHeight - box.scrollTop - box.clientHeight >= 60);
        else if (dd) dd.hidden = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
        /* Растворение у верхнего края: пока полоса прокручена (верхний край
           ушёл), класс fade-top даёт градиентную маску — сообщение тает,
           уходя под верхнюю плашку. (В zen плашка парит над полосой.) */
        box.classList.toggle('fade-top', box.scrollTop > 2);
        /* Плашки дат: дата в потоке видна, только пока «закреплена» сверху
           (стоит ровно у верхнего края полосы при прокрутке). Отлипла — гаснет. */
        updateDaySep(box);
      }, { passive:true });
      /* При открытии чата сразу гасим даты потока (видна лишь закреплённая). */
      setTimeout(() => { try { updateDaySep(box); } catch(e){} }, 0);
      (c.unread = c.unread||{})[u.id] = Date.now(); saveState();
      /* Открыли чат — пинг прочитан: сразу гасим «@» и счётчик в списке,
         не дожидаясь полной перерисовки страницы. */
      {
        const li = root.querySelector('.chat-item[data-ch="' + c.id + '"]');
        if (li) li.querySelectorAll('.chat-item__at, .chat-item__unread').forEach(n => n.remove());
      }

      /* Панель выражений (как у ТГ): вкладки «Смайлы» и «Опрос» */
      const EMOJI_SET = ['😀','😂','😍','👍','👏','🙌','🔥','❤️','😮','😢','🎉','☕','✅','⚠️','💡','🤝','🎧','📝','⏰','🚀','💯','🤔','😅','🫡'];
      /* Полный набор для реакций: не только 5-6 заготовленных, любые смайлы */
      const ALL_EMOJI = ['😀','😂','😍','👍','👏','🙌','🔥','❤️','😮','😢','🎉','☕','✅','⚠️','💡','🤝','🎧','📝','⏰','🚀','💯','🤔','😅','🫡','🥳','😎','🤗','😇','🙈','🙉','🎶','📢','💪','👀','✨','⭐️','🌸','🍀','🌈','⚡','🎯','📌','🧩','🎲','🏆','🍕','🍩','🎬','🎤','🎹','🎸','📚','☀️','🌙','⛅','❄️','🍽️','🛠️','💰','📈','🧠','🎓','👋'];
      const closeEmoji = () => { closeDropdown(); emojiOpen = false; };
      $('#btn-emoji', root).onclick = e=>{
        emojiOpen = !emojiOpen;
        if (!emojiOpen) return;
        const dd = showDropdown(e.currentTarget, [], {});
        if (!dd) return;
        dd.className = 'dd emoji-panel';
        /* Жёсткий потолок высоты: при добавлении вариантов опроса панель
           растёт, а её край уезжал за нижнюю границу экрана */
        dd.style.maxHeight = 'min(560px, calc(100dvh - 24px))';
        const renderTabs = (tab) => {
          dd.innerHTML =
            `<div class="emoji-tabs"><button data-tab="emoji" class="${tab==='emoji'?'on':''}">${icon('smile','ico-sm')} Смайлы</button><button data-tab="poll" class="${tab==='poll'?'on':''}">${icon('poll','ico-sm')} Опрос</button><button data-tab="art" class="${tab==='art'?'on':''}">${icon('clip','ico-sm')} Артефакты</button></div>
             <div class="emoji-body">${tab==='emoji'
               ? `<div class="emoji-pop">${EMOJI_SET.map(em=>`<button type="button" data-em="${em}">${em}</button>`).join('')}</div>`
               : tab==='poll' ? `<div class="poll-quick">
                    <div class="field"><label>Вопрос</label><input class="input" id="pq-q" placeholder="О чём спросим?"></div>
                    <div id="pq-opts">
                      ${[1,2].map(n=>`<div class="field pq-opt"><label>Вариант ${n}</label><input class="input" placeholder="Вариант ${n}"></div>`).join('')}
                    </div>
                    <div class="row" style="margin-top:2px">
                      <label class="check"><input type="checkbox" id="pq-anon"><span class="box"><svg><use href="#i-check-c"/></svg></span><span class="small">Анонимное голосование</span></label>
                      <label class="check"><input type="checkbox" id="pq-multi"><span class="box"><svg><use href="#i-check-c"/></svg></span><span class="small">Несколько ответов</span></label>
                    </div>
                    <div class="row"><button class="btn btn--ghost btn--sm" id="pq-add">${icon('plus','ico-sm')} Добавить вариант</button><span class="spacer"></span><button class="btn btn--primary btn--sm" id="pq-go">${icon('poll','ico-sm')} Создать</button></div>
                  </div>` : `<div class="art-quick">
                    <p class="small faint" style="margin:0 0 8px">Поделиться карточкой</p>
                    <div class="row" style="gap:8px;flex-wrap:wrap">
                      <button class="btn btn--ghost btn--sm" data-art="contact">Контакт</button>
                      <button class="btn btn--ghost btn--sm" data-art="order">Заказ</button>
                    </div>
                    <p class="small faint" style="margin:10px 0 0">Фото и файлы — через скрепку.</p>
                  </div>`}</div>`;
          if (tab==='emoji'){
            dd.querySelectorAll('[data-em]').forEach(b=>b.onclick = ()=>{
              const t = $('#chat-t', root); t.value += b.dataset.em; t.focus(); closeEmoji();
            });
          } else if (tab==='poll'){
            const optsBox = dd.querySelector('#pq-opts');
            const renumber = ()=> [...optsBox.querySelectorAll('.pq-opt')].forEach((row,i)=>{
              row.querySelector('label').textContent = 'Вариант ' + (i+1);
              row.querySelector('input').placeholder = 'Вариант ' + (i+1);
            });
            const addOpt = ()=>{
              const n = optsBox.querySelectorAll('.pq-opt').length;
              if (n >= 10){ toast('Максимум 10 вариантов','warn'); return; }
              const row = document.createElement('div');
              row.className = 'field pq-opt';
              row.innerHTML = `<label>Вариант ${n+1}</label><input class="input" placeholder="Вариант ${n+1}">`;
              optsBox.appendChild(row);
              renumber();
              positionDD(); /* панель выросла — пересчитаем позицию, чтобы не уехала за экран */
              row.querySelector('input').focus();
              row.querySelector('input').addEventListener('keydown', ev=>{ if (ev.key==='Enter'){ ev.preventDefault(); go(); } });
            };
            const go = () => {
              const q = dd.querySelector('#pq-q').value.trim();
              const opts = [...optsBox.querySelectorAll('input')].map(i=>i.value.trim()).filter(Boolean);
              if (!q || opts.length < 2){ toast('Заполните вопрос и минимум два варианта','warn'); return; }
              const p = { id:uid(), chat_id:c.id, user_id:u.id, question:q, options:opts, votes:{},
                anonymous: !!(dd.querySelector('#pq-anon') && dd.querySelector('#pq-anon').checked),
                maxVotes: (dd.querySelector('#pq-multi') && dd.querySelector('#pq-multi').checked) ? 0 : 1,
                created_at:Date.now() };
              S.polls.push(p);
              S.messages.push({ id:uid(), chat_id:c.id, user_id:u.id, text:`Опрос: ${q}`, type:'poll', poll_id:p.id, created_at:Date.now(), reactions:{} });
              saveState(); renderChat(); closeEmoji(); toast('Опрос создан','ok');
            };
            dd.querySelector('#pq-go').onclick = go;
            dd.querySelector('#pq-add').onclick = addOpt;
            [dd.querySelector('#pq-q'), ...optsBox.querySelectorAll('input')].forEach(el=>el && el.addEventListener('keydown', ev=>{ if (ev.key==='Enter'){ ev.preventDefault(); go(); } }));
          }
        };
        const anchorBtn = e.currentTarget;
        /* Позиция панели пересчитывается заново при каждом переключении вкладки:
           вкладка «Опрос» выше, и без пересчёта панель уезжала за пределы экрана. */
        const positionDD = () => {
          const r = anchorBtn.getBoundingClientRect();
          const ddW = dd.offsetWidth, ddH = dd.offsetHeight;
          const x = Math.max(10, Math.min(r.left, window.innerWidth - ddW - 10));
          let y = (r.bottom + 6 + ddH > window.innerHeight) ? (r.top - ddH - 6) : (r.bottom + 6);
          y = Math.max(10, Math.min(y, Math.max(10, window.innerHeight - ddH - 10)));
          dd.style.left = x + 'px';
          dd.style.top = y + 'px';
        };
        renderTabs('emoji');
        dd.addEventListener('click', ev=>{
          const tb = ev.target.closest('[data-tab]');
          if (tb){ renderTabs(tb.dataset.tab); positionDD(); ev.stopPropagation(); }
        });
        dd.addEventListener('click', ev=>{
          const art = ev.target.closest('[data-art]');
          if (!art) return;
          closeEmoji();
          if (art.dataset.art === 'contact') pickPerson(); else pickOrder();
        });
        positionDD();
      };
      /* Опрос создаётся во вкладке «Опрос» панели стикеров/эмодзи */
      $('#btn-send', root).onclick = sendMsg;

      /* Вложения: фото и файлы (dataURL, хранится локально) */
      const fileInp = $('#chat-file', root);
      /* Вложения-артефакты (как в ТГ): контакт и заказ отдельными карточками */
      const sendArtifact = (type, data, label)=>{
        S.messages.push({ id:uid(), chat_id:c.id, user_id:u.id, text:label, type, ...data,
          created_at:Date.now(), reactions:{} });
        saveState(); renderChat();
      };
      const pickPerson = ()=>{
        const list = noDemo(S.users).filter(x=>x.id!==u.id).slice(0,60);
        const body = `<div class="stack" style="gap:2px;max-height:56vh;overflow:auto">${list.map(x=>`<button type="button" class="list-row art-pick" data-pick="${esc(x.id)}"><span class="avatar avatar--sm avatar--grad" style="${avatarGrad(x.full_name)}">${initials(x.full_name)}</span><span style="flex:1;min-width:0"><b class="small">${esc(x.full_name)}</b><div class="cell-sub">${esc(ROLE_LABEL[x.role]||'')}</div></span></button>`).join('')}</div>`;
        openWinModal({ title:'Отправить контакт', narrow:true, body, onMount:(host, close)=>{
          host.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{
            const p2 = userById(b.dataset.pick);
            close && close();
            sendArtifact('contact', { contact_id:b.dataset.pick }, 'Контакт: ' + (p2?p2.full_name:''));
            toast('Контакт отправлен','ok');
          });
        }});
      };
      const pickOrder = ()=>{
        const list = ordersFor(u).filter(o=>o.status!=='archived').slice(0,60);
        const body = `<div class="stack" style="gap:2px;max-height:56vh;overflow:auto">${list.map(o=>`<button type="button" class="list-row art-pick" data-pick="${esc(o.order_id)}"><span class="msg__artifact-ico">${icon('orders')}</span><span style="flex:1;min-width:0"><b class="small">${esc(o.order_id)}</b><div class="cell-sub">${esc((clientById(o.client_id)||{}).full_name||'')} · ${fmtMoney(o.total)}</div></span></button>`).join('')}</div>`;
        openWinModal({ title:'Отправить заказ', narrow:true, body, onMount:(host, close)=>{
          host.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{
            close && close();
            sendArtifact('order', { order_ref:b.dataset.pick }, 'Заказ ' + b.dataset.pick);
            toast('Заказ отправлен','ok');
          });
        }});
      };
      const inviteToChat = ()=>{
        const members = new Set(chatMembers(c));
        const list = noDemo(S.users).filter(x=>!members.has(x.id));
        if (!list.length){ toast('Все уже в чате','info'); return; }
        const body = `<div class="stack" style="gap:2px;max-height:56vh;overflow:auto">${list.map(x=>`<button type="button" class="list-row art-pick" data-inv="${esc(x.id)}"><span class="avatar avatar--sm avatar--grad" style="${avatarGrad(x.full_name)}">${initials(x.full_name)}</span><span style="flex:1;min-width:0"><b class="small">${esc(x.full_name)}</b><div class="cell-sub">${esc(ROLE_LABEL[x.role]||'')}</div></span></button>`).join('')}</div>`;
        openWinModal({ title:'Пригласить в чат', narrow:true, body, onMount:(host, close)=>{
          host.querySelectorAll('[data-inv]').forEach(b=>b.onclick=()=>{
            const id2 = b.dataset.inv;
            c.member_ids = c.member_ids || [];
            if (!c.member_ids.includes(id2)) c.member_ids.push(id2);
            c.participants = c.participants || [];
            if (!c.participants.includes(id2)) c.participants.push(id2);
            const p2 = userById(id2);
            pushChatAction(`${u.full_name} добавил(а) ${p2?p2.full_name:'участника'} в чат`);
            saveState(); close && close(); renderChat();
            toast('Участник добавлен','ok');
          });
        }});
      };
      window.__inviteToChat = inviteToChat;
      const sendAttachment = (file)=>{
        if (!file) return;
        if (file.size > 1.6 * 1024 * 1024){ toast('Файл больше 1,6 МБ — не поместится в локальное хранилище', 'warn'); return; }
        const isImg = /^image\//.test(file.type);
        const rd = new FileReader();
        rd.onload = ()=>{
          S.messages.push({ id:uid(), chat_id:c.id, user_id:u.id, text:isImg ? 'Фото' : 'Файл: ' + file.name,
            type:isImg ? 'image' : 'file', file:{ name:file.name, type:file.type, dataUrl:rd.result },
            created_at:Date.now(), reactions:{} });
          saveState(); renderChat();
          toast(isImg ? 'Фото отправлено' : 'Файл отправлен', 'ok');
        };
        rd.readAsDataURL(file);
      };
      if (fileInp){
        const at = $('#btn-attach', root);
        if (at) at.onclick = e => showDropdown(e.currentTarget, [
          { label:'Фото или файл', icon:'clip', onClick:()=>fileInp.click() },
          { label:'Контакт', icon:'clients', onClick:pickPerson },
          { label:'Заказ', icon:'orders', onClick:pickOrder }
        ]);
        fileInp.onchange = ()=>{ const f = fileInp.files && fileInp.files[0]; if (f) sendAttachment(f); fileInp.value=''; };
      }

      /* Голосовые сообщения: нажатие — запись, повторное — отправка */
      let recorder = null, chunks = [], recCancel = false, recTimer = null, recStream = null;
      /* Микрофон встроен в кнопку-переключатель (как в ТГ): при пустом поле
         кнопка становится микрофоном, при вводе — самолётиком. */
      const voiceBtn = $('#btn-send', root);
      const setVoiceBtnRec = (on)=>{
        if (!voiceBtn) return;
        voiceBtn.classList.toggle('rec-on', on);
        /* Иконки не переключаем через display: плавный морф микрофон↔самолётик
           делает CSS-кроссфейд по классу chat-send-has-text. */
      };
      const rmVoiceBar = ()=>{
        const vb = root.querySelector('.voicebar');
        if (vb && !vb.classList.contains('closing')){
          vb.classList.add('closing');
          setTimeout(()=>{ try { vb.remove(); } catch(e){} }, 240);
        }
        if (recTimer){ clearInterval(recTimer); recTimer = null; }
        setVoiceBtnRec(false);
      };
      const finishVoice = (cancel)=>{
        if (!recorder) return;
        recCancel = cancel;
        try { if (recorder.state !== 'inactive') recorder.stop(); } catch(e){}
      };
      if (voiceBtn) voiceBtn.onclick = async ()=>{
        /* Во время записи клик = отправить; пауза/отмена — в панели записи */
        if (recorder){
          if (recorder.state === 'recording' || recorder.state === 'paused'){ finishVoice(false); trimTimer(); return; }
          return;
        }
        /* Есть текст — кнопка отправляет сообщение (самолётик), запись только при пустом поле */
        {
          const tt = $('#chat-t', root);
          if (tt && tt.value.trim().length){ sendMsg(); return; }
        }
        try{
          recStream = await navigator.mediaDevices.getUserMedia({ audio:true });
          recorder = new MediaRecorder(recStream); chunks = []; recCancel = false;
          recorder.ondataavailable = ev=>{ if (ev.data && ev.data.size) chunks.push(ev.data); };
          recorder.onstop = ()=>{
            const st = recStream; recStream = null;
            if (st) st.getTracks().forEach(t=>t.stop());
            const wasCancel = recCancel;
            const rec = recorder; recorder = null;
            rmVoiceBar();
            if (wasCancel || !chunks.length) return; /* отменено — не отправляем */
            /* MIME берём у самого рекордера: Chrome пишет audio/webm, Safari —
               audio/mp4. Жёсткий webm ломал воспроизведение в Safari. */
            const mime = (rec && rec.mimeType) || 'audio/webm';
            const ext = /mp4|m4a/.test(mime) ? 'm4a' : (/ogg/.test(mime) ? 'ogg' : 'webm');
            const blob = new Blob(chunks, { type: mime });
            const rd = new FileReader();
            rd.onload = ()=>{
              if (!document.body.contains(root)) return;
              /* Фактическая длительность записи (а не 0:00): берём по таймеру
                 панели; округляем до секунд, минимум 1. */
              const recSec = Math.max(1, Math.round((Date.now()-t0)/1000));
              S.messages.push({ id:uid(), chat_id:c.id, user_id:u.id, text:'Голосовое сообщение', type:'voice',
                file:{ name:'voice.'+ext, type:mime, dataUrl:rd.result, duration: recSec }, created_at:Date.now(), reactions:{} });
              saveState(); renderChat();
              toast('Голосовое отправлено','ok');
            };
            rd.readAsDataURL(blob);
          };
          recorder.start();
          setVoiceBtnRec(true);
          /* Панель записи: таймер, пауза, отмена */
          let vb = document.createElement('div');
          vb.className = 'voicebar';
          const t0 = Date.now();
          const tick = ()=>{
            const s = Math.floor((Date.now()-t0)/1000);
            const m = Math.floor(s/60), sec = s%60;
            const el = vb.querySelector('.voicebar__time');
            if (el) el.textContent = (m<10?'0':'')+m+':'+(sec<10?'0':'')+sec;
          };
          vb.innerHTML = `<span class="voicebar__rec"></span><span class="voicebar__time">00:00</span>
            <button class="iconbtn" id="vb-pause" title="Пауза">${icon('pause')}</button>
            <button class="iconbtn" id="vb-cancel" title="Отменить запись">${icon('x')}</button>`;
          root.querySelector('.chat-main').appendChild(vb);
          recTimer = setInterval(tick, 500); tick();
          vb.querySelector('#vb-cancel').onclick = () => finishVoice(true);
          const pb = vb.querySelector('#vb-pause');
          pb.onclick = () => {
            if (!recorder) return;
            if (recorder.state === 'recording'){
              try { recorder.pause(); } catch(e){}
              pb.innerHTML = icon('play'); pb.title = 'Продолжить';
              vb.classList.add('paused');
            } else if (recorder.state === 'paused'){
              try { recorder.resume(); } catch(e){}
              pb.innerHTML = icon('pause'); pb.title = 'Пауза';
              vb.classList.remove('paused');
            }
          };
          toast('Идёт запись — Esc отменит, микрофон отправит','info');
        }catch(err){
          toast('Микрофон недоступен: ' + (err && err.message || 'нет доступа'), 'err');
        }
      };
      const trimTimer = ()=>{
        /* подтяжка таймера — ничего не делаем, таймер живёт в панели */
      };
      /* Esc при записи голосового — отмена, Enter — отправка (как с текстом).
       Обработчик висит на root (всплывает после обработчика textarea),
       поэтому перехват работает и когда фокус в поле ввода. */
      const voiceEsc = e => {
        if (e.key === 'Enter' && recorder){
          e.preventDefault(); e.stopPropagation();
          finishVoice(false);
          return;
        }
        if (e.key === 'Escape' && recorder){
          e.preventDefault(); e.stopPropagation();
          finishVoice(true);
        }
      };
      root.addEventListener('keydown', voiceEsc);
      const replyX = $('#chat-reply-x', root);
      if (replyX) replyX.onclick = ()=>{ chatReplyTo = null; renderChat(); };
      const editX = $('#chat-edit-x', root);
      if (editX) editX.onclick = ()=>{ chatEditMsg = null; renderChat(); };
      const editBar = $('#chat-edit', root);
      if (editBar && editSrc){
        editBar.style.cursor = 'pointer';
        editBar.addEventListener('click', e=>{
          if (e.target.closest('#chat-edit-x')) return;
          const boxEl = $('#chat-msgs', root);
          const mEl = boxEl && boxEl.querySelector('.msg[data-msg="'+editSrc.id+'"]');
          if (mEl){ mEl.scrollIntoView({ block:'center', behavior:'smooth' }); mEl.classList.add('msg--flash'); setTimeout(()=>mEl.classList.remove('msg--flash'), 1600); }
        });
      }
      const bindSelPanel = ()=>{
        const selPanel = root.querySelector('#chat-sel');
        if (!selPanel) return;
        $('#chat-sel-x', root).onclick = ()=>{
        const bar = root.querySelector('.chat-sel');
        const done = ()=>{
          chatSel.mode = false; chatSel.set.clear();
          root.querySelectorAll('.msg--sel').forEach(el=>el.classList.remove('msg--sel'));
          if (bar) bar.remove();
        };
        if (bar){ bar.classList.add('closing'); setTimeout(done, 150); } else done();
      };
        $('#chat-sel-del', root).onclick = async ()=>{
          const n1 = chatSel.set.size;
          const plural = (n2)=>{ if (n2%10===1 && n2%100!==11) return 'сообщение'; if (n2%10>=2 && n2%10<=4 && !(n2%100>=12 && n2%100<=14)) return 'сообщения'; return 'сообщений'; };
          const ok = await confirmModal({ title:`Удалить ${n1} ${plural(n1)}?`, okText:'Удалить', danger:true, text:'Действие нельзя отменить.' });
          if (!ok) return;
          const ids = [...chatSel.set];
          const cnt = ids.length;
          chatSel.set.clear(); chatSel.mode = false;
          animateMsgsOut(ids, ()=>{
            S.messages = S.messages.filter(x=>!ids.includes(x.id));
            logAudit(`Удалено сообщений: ${cnt} в «${c.name}»`,'Чат');
            pushChatAction(`${u.full_name} удалил(а) ${cnt} ${plural(cnt)}`);
            saveState(); renderChat();
          });
        };
        $('#chat-sel-fwd', root).onclick = ()=>{
          const list = [...chatSel.set].map(id=>S.messages.find(x=>x.id===id)).filter(Boolean);
          if (!list.length) return;
          openForwardList(list);
          chatSel.set.clear(); chatSel.mode = false;
          const bar = root.querySelector('.chat-sel');
          if (bar) bar.remove();
          root.querySelectorAll('.msg--sel').forEach(el=>el.classList.remove('msg--sel'));
        };
      };
      bindSelPanel();
      /* Плашка выделения создаётся без полного рендера чата (иначе лента мерцает) */
      const showSelBar = ()=>{
        if (!chatSel.mode) return null;
        let bar = root.querySelector('.chat-sel');
        if (!bar){
          bar = document.createElement('div');
          bar.className = 'chat-sel';
          bar.id = 'chat-sel';
          bar.innerHTML = `<b>Выбрано: <span id="chat-sel-n">${chatSel.set.size}</span></b>
            <span class="spacer"></span>
            <button class="btn btn--ghost btn--sm" id="chat-sel-fwd">${icon('send','ico-sm')} Переслать</button>
            <button class="btn btn--ghost btn--sm btn--danger" id="chat-sel-del">${icon('trash','ico-sm')} Удалить</button>
            <button class="iconbtn" id="chat-sel-x" title="Снять выделение">${icon('x','ico-sm')}</button>`;
          const input = root.querySelector('.chat-input');
          if (input) input.before(bar); else root.querySelector('.chat-main').appendChild(bar);
          bindSelPanel();
        }
        const cnt = bar.querySelector('#chat-sel-n');
        if (cnt) cnt.textContent = chatSel.set.size;
        return bar;
      };
      const chatTa = $('#chat-t', root);
      /* Восстановление фокуса: если пользователь печатал (фокус был в поле),
         после пересоздания DOM возвращаем курсор в текстовую область —
         отправка (кнопка/Enter) не должна выбрасывать из режима набора. */
      if (prevFocusWasInput && chatTa){
        try{
          chatTa.focus();
          if (prevSel && chatTa.setSelectionRange) chatTa.setSelectionRange(prevSel[0], prevSel[1]);
        }catch(e){}
      }
      /* Упоминания: дропдаун участников при вводе @ (как в ТГ) */
      let mentionDD = null, mentionClosing = false;
      const closeMentionDD = ()=>{
        if (mentionDD && !mentionClosing){
          mentionClosing = true;
          mentionDD.classList.add('chat-mention-dd--closing');
          setTimeout(()=>{ if (mentionDD){ mentionDD.remove(); mentionDD = null; } mentionClosing = false; }, 150);
        } else if (mentionDD){ /* уже в процессе закрытия — ничего */ }
      };
      /* null (а не ''), иначе первый же «@» не открывал список: пустой
         запрос совпадал с начальным значением и openMentionDD не вызывался. */
      let mentionQuery = null;
      const openMentionDD = ()=>{
        if (mentionDD){ mentionDD.remove(); mentionDD = null; mentionClosing = false; }
        const uidv = user().id;
        const ids = [...new Set(chatMembers(c).filter(id2=>id2 && id2!==uidv))];
        const q = mentionQuery.trim().toLowerCase();
        let people = ids.map(id2=>userById(id2)).filter(Boolean);
        /* Динамическая фильтрация: показываем только тех, кто подходит под введённое */
        if (q){
          people = people.filter(x=>
            (x.full_name||'').toLowerCase().includes(q) ||
            (x.username||'').toLowerCase().includes(q));
        }
        const showAll = !q || 'all'.includes(q) || 'всем участникам'.includes(q);
        const rows = [
          ...(showAll ? [`<button class="dd__item" data-mention="all"><span style="flex:1">@все — всем участникам</span></button>`] : []),
          ...(() => {
            const tags = SPEC_TAGS.filter(t => !q || t.label.toLowerCase().includes(q) || t.word.includes(q));
            if (!tags.length) return [];
            return [`<button class="dd__item" data-spec-toggle><span style="flex:1">Специальные теги (${tags.length})</span><span class="muted">▾</span></button>`,
              `<div class="dd__specs" data-spec-box hidden>${tags.map(t => `<button class="dd__item" data-mention-spec="${esc(t.word)}"><span style="flex:1">@${esc(t.word)} — ${esc(t.label)}</span></button>`).join('')}</div>`];
          })(),
          ...ROLE_TAGS.filter(r => !q || r.words.some(w => w.includes(q))).map(r =>
            `<button class="dd__item" data-mention-role="${r.role}" data-mention-word="${r.label}"><span style="flex:1">@${r.label} — все ${r.hint}</span></button>`),
          ...people.map(x=>`<button class="dd__item" data-mention="${esc(x.username||x.full_name)}"><span style="flex:1">@${esc(x.username||x.full_name)}</span></button>`)
        ].join('');
        if (!rows){ mentionQuery=''; return; }
        mentionDD = document.createElement('div');
        mentionDD.className = 'dd chat-mention-dd';
        mentionDD.innerHTML = rows;
        document.body.appendChild(mentionDD);
        /* Плашка всегда НАД полем ввода (как в ТГ), слева по полю */
        const r = chatTa.getBoundingClientRect();
        mentionDD.style.left = r.left + 'px';
        mentionDD.style.top = Math.max(8, r.top - mentionDD.offsetHeight - 8) + 'px';
        mentionDD.addEventListener('click', ev=>{
          const tg = ev.target.closest('[data-spec-toggle]');
          if (tg){
            const bx = mentionDD.querySelector('[data-spec-box]');
            if (bx){
              const open2 = !bx.hidden;
              bx.hidden = open2;
              tg.classList.toggle('on', !open2);
              tg.querySelector('.muted') && (tg.querySelector('.muted').textContent = open2 ? '▾' : '▴');
            }
            ev.stopPropagation(); return;
          }
          const sp = ev.target.closest('[data-mention-spec]');
          if (sp){
            const cur2 = chatTa.value; const at2 = cur2.lastIndexOf('@');
            chatTa.value = (at2 >= 0 ? cur2.slice(0, at2) : cur2) + '@' + sp.dataset.mentionSpec + ' ';
            chatTa.focus(); closeMentionDD(); return;
          }
          const b = ev.target.closest('[data-mention],[data-mention-role]');
          if (!b) return;
          const tok = b.dataset.mentionRole ? '@' + (b.dataset.mentionWord || b.dataset.mentionRole) + ' '
            : (b.dataset.mention === 'all' ? '@все ' : '@' + b.dataset.mention + ' ');
          const cur = chatTa.value;
          const at = cur.lastIndexOf('@');
          chatTa.value = (at >= 0 ? cur.slice(0, at) : cur) + tok;
          chatTa.focus();
          closeMentionDD();
        });
      };
      let __typingThrottle = 0;
      const pingTyping = ()=>{
        const has = chatTa.value.trim().length > 0;
        if (!has){ typingClear(c.id, u.id); return; }
        const now = Date.now();
        if (now - __typingThrottle > 1200){ __typingThrottle = now; typingSet(c.id, u.id); }
      };
      chatTa.addEventListener('keydown', ()=>{ try { pingTyping(); } catch(e){} });
      chatTa.addEventListener('input', ()=>{
        try { pingTyping(); } catch(e){}
        const val = chatTa.value;
        const at = val.lastIndexOf('@');
        const after = at >= 0 ? val.slice(at+1) : '';
        const q = after.replace(/\s+/g,' ');
        if (at >= 0 && !/\s/.test(after) && after.length <= 24){
          if (q !== mentionQuery){ mentionQuery = q; openMentionDD(); }
        } else { mentionQuery=''; closeMentionDD(); }
        void draftSave();
        try { refreshDraftPreview(); } catch(e){}
        /* Как в ТГ: пустое поле — микрофон, начали вводить — самолётик.
           Смена плавная (CSS fade/scale на .chat-send-ic). */
        const sendBtn = root.querySelector('#btn-send');
        if (sendBtn){
          const hasText = val.trim().length > 0;
          sendBtn.classList.toggle('chat-send-has-text', hasText);
          sendBtn.title = hasText ? 'Отправить' : 'Голосовое сообщение';
        }
      });
      chatTa.addEventListener('keydown', e=>{
        if (mentionDD && (e.key==='ArrowDown'||e.key==='ArrowUp')){
          e.preventDefault();
          const items = [...mentionDD.querySelectorAll('[data-mention]')];
          let i = items.findIndex(x=>x.classList.contains('on'));
          i = e.key==='ArrowDown' ? (i+1)%items.length : (i-1+items.length)%items.length;
          items.forEach(x=>x.classList.remove('on')); items[i].classList.add('on'); items[i].scrollIntoView({block:'nearest'});
          return;
        }
        if (mentionDD && e.key==='Enter'){
          const it = mentionDD.querySelector('[data-mention].on') || mentionDD.querySelector('[data-mention]');
          if (it && !e.shiftKey){ e.preventDefault(); it.click(); return; }
        }
        if (mentionDD && e.key==='Escape'){ closeMentionDD(); return; }
        /* Esc в режиме редактирования — отмена (как в ТГ), без отправки */
        if (e.key==='Escape' && chatEditMsg && chatEditMsg.chat_id === c.id){
          e.preventDefault();
          chatEditMsg = null;
          const ta = $('#chat-t', root);
          if (ta) ta.value = '';
          draftSave();
          renderChat();
          return;
        }
        if (e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendMsg(); }
      });
      /* Черновик сообщения (как в ТГ): сохраняется в sessionStorage на чат
         и восстанавливается после перезагрузки страницы */
      const draftKey = 'chatDraft_' + c.id;
      const draftSave = ()=>{
        try { sessionStorage.setItem(draftKey, chatTa.value); } catch(e){}
      };
      const draftLoad = ()=>{
        try { return sessionStorage.getItem(draftKey) || ''; } catch(e){ return ''; }
      };
      if (!editSrc && !chatTa.value) chatTa.value = draftLoad();
      /* Черновик после жёсткой перезагрузки: сразу показываем самолётик, а не микрофон */
      {
        const sb = root.querySelector('#btn-send');
        if (sb && chatTa.value.trim().length){
          sb.classList.add('chat-send-has-text');
          sb.title = 'Отправить';
        }
      }
      chatTa.addEventListener('input', ()=>{
        try { draftSave(); } catch(e){}
      });
      chatTa.addEventListener('blur', ()=>{ try { draftSave(); } catch(e){} });

      function sendMsg(){
        const t = $('#chat-t', root);
        const text = t.value.trim();
        /* Как в ТГ: если поле пустое — кнопка-самолёт является микрофоном.
           Клик по ней в этом состоянии запускает запись голосового. */
        if (!text){
          const vb = voiceBtn;
          if (vb) vb.click();
          return;
        }
        if (/\+?7[\s(-]?\d{3}[\s)-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/.test(text) && c.type!=='corporate'){
          toast('Автомодерация: похоже на персональные данные. Сообщение отправлено без телефона.', 'warn');
        }
        const clean = text.replace(/\+?7[\s(-]?\d{3}[\s)-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g, '[скрыт модерацией]');
        if (chatEditMsg && chatEditMsg.chat_id === c.id){
          /* Редактирование (как в ТГ): обновляем текст, новое сообщение не создаём */
          const em = S.messages.find(x=>x.id===chatEditMsg.id);
          const replyTarget = (chatReplyTo && chatReplyTo.chat_id === c.id) ? chatReplyTo.id : null;
          if (em){
            em.text = clean;
            em.edited = true; em.editedAt = Date.now();
            /* Кто редактировал — не показываем (как в ТГ): только пометка
               «изменено» у самого сообщения, без системной строки в ленте. */
          }
          chatReplyTo = null; chatEditMsg = null;
          saveState();
          renderChat();
          return;
        }
        const replyTarget = (chatReplyTo && chatReplyTo.chat_id === c.id) ? chatReplyTo.id : null;
        const replyTextFrag = (chatReplyTo && chatReplyTo.chat_id === c.id && chatReplyTo.replyText) ? chatReplyTo.replyText : null;
        const members = chatForUser(u).find(x=>x.id===c.id)
          ? (c.client_id ? [c.client_id] : (S.messages.filter(mm=>mm.chat_id===c.id&&mm.user_id!==c.id).map(mm=>mm.user_id)))
          : [];
        const deliverTo = [...new Set(members.filter(mid=>mid && mid!==u.id && userById(mid)))].slice(0,50);
        /* Упоминания @имя / @все (и старое @all): оповещаем упомянутых (даже при замьюченном чате) */
        const mentionIds = [];
        {
          const ta = $('#chat-t', root);
          if (ta) closeMentionDD && closeMentionDD();
          const mU = [...new Set((clean.match(/@([\w.-]+)/g)||[]).map(x=>x.slice(1).toLowerCase()))];
          const allTag = /@(все|all)(?![а-яёa-z])/i.test(clean);
          if (allTag){
            const ids = [...new Set(chatMembers(c).filter(id2=>id2 && id2!==u.id))];
            ids.forEach(id2=>{ if (userById(id2)) mentionIds.push(id2); });
          } else {
            mU.forEach(un=>{
              const tu = S.users.find(x=>x.id!==u.id && (x.username||'').toLowerCase()===un || (x.full_name||'').toLowerCase()===un);
              if (tu && !mentionIds.includes(tu.id)) mentionIds.push(tu.id);
            });
          }
        }
        /* @специализация — оповещаем исполнителей с этой специализацией */
        {
          SPEC_TAGS.forEach(t => {
            const re2 = new RegExp('@' + t.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![а-яёa-z0-9-])', 'i');
            if (!re2.test(clean)) return;
            noDemo(S.users).forEach(u2 => {
              if (u2 && u2.role === 'executor' && ((u2.ext && u2.ext.specializations) || []).includes(t.label) && u2.id !== u.id && !mentionIds.includes(u2.id)) mentionIds.push(u2.id);
            });
          });
        }
        /* @роль — оповещаем всех участников чата с этой ролью */
        {
          ROLE_TAGS.forEach(r => {
            if (!new RegExp('@(' + r.words.join('|') + ')(?![а-яёa-z])', 'i').test(clean)) return;
            noDemo(S.users).forEach(u2 => {
              if (u2 && u2.role === r.role && u2.id !== u.id && !mentionIds.includes(u2.id)) mentionIds.push(u2.id);
            });
          });
        }
        const msgObj = { id:uid(), chat_id:c.id, user_id:u.id, text:clean, type:'text', created_at:Date.now(), reactions:{}, reply_to:replyTarget || undefined, reply_text: replyTextFrag || undefined, deliveredTo: deliverTo };
        /* Ответ на сообщение = пинг его автора (как ответ в ТГ), а не только упоминание */
        let replyAuthorId = null;
        if (replyTarget){
          const src = S.messages.find(x=>x.id===replyTarget);
          if (src && src.user_id && src.user_id !== u.id){
            replyAuthorId = src.user_id;
            if (!mentionIds.includes(src.user_id)) mentionIds.push(src.user_id);
          }
        }
        if (mentionIds.length) msgObj.mentions = mentionIds;
        S.messages.push(msgObj);
        /* Уведомления упомянутым и автору исходника: в колокольчик + непрочитанное чата,
           независимо от мьюта. Автору ответа — отдельный текст уведомления. */
        if (mentionIds.length){
          mentionIds.forEach(uid2=>{
            const tu2 = userById(uid2);
            if (tu2 && uid2 !== u.id) notifyMentioned(uid2, u.full_name, c.name || 'чат', clean, {
              kind: uid2 === replyAuthorId ? 'reply' : 'mention',
              at: msgObj.created_at,
              chat_id: c.id
            });
          });
        }
        chatReplyTo = null;
        try { typingClear(c.id, u.id); } catch(e){}
        try { sessionStorage.removeItem('chatDraft_' + c.id); } catch(e){}

        saveState();
        t.value = '';
        /* До рендера фиксируем «читаем у низа»: иначе поздний rAF в renderChat
           восстановит старую позицию и сообщение уедет за экран. */
        {
          const pre = $('#chat-msgs', root);
          if (pre) chatScrollMap[c.id] = { scrollTop: pre.scrollHeight, scrollHeight: pre.scrollHeight };
        }
        renderChat();
        try { refreshDraftPreview(); } catch(e){}
        /* Своё сообщение ВСЕГДА прижимает чат к низу (как в ТГ), даже если
           читали выше — отправка сбрасывает позицию чтения в самый конец. */
        {
          const nb = $('#chat-msgs', root);
          if (nb) nb.scrollTop = nb.scrollHeight;
        }
        /* ответ коллеги для живости демо */
        if (Math.random() < 0.7){
          const others = S.users.filter(x=>x.id!==u.id && (isStaff(x.role)||x.role==='executor'||x.role==='client') && chatForUser(x).some(ch=>ch.id===c.id));
          const who = others[Math.floor(Math.random()*others.length)];
          const replies = ['Принято 👍','Смотрю сейчас','Сделаю к вечеру','Спасибо, взял в работу!','Хорошо, уточню у клиента','Отлично, продолжаем 🚀'];
          setTimeout(()=>{
            if (!document.body.contains(root)) return;
            /* Как в ТГ: сначала «печатает…», затем приходит сообщение */
            try { typingSet(c.id, who.id); } catch(e){}
            if (curChat===c.id && typeof refreshTyping === 'function') refreshTyping();
            setTimeout(()=>{
              if (!document.body.contains(root)) return;
              try { typingClear(c.id, who.id); } catch(e){}
              S.messages.push({ id:uid(), chat_id:c.id, user_id:who.id, text:replies[Math.floor(Math.random()*replies.length)], type:'text', created_at:Date.now(), reactions:{} });
              saveState();
              if (curChat===c.id){ renderChat(); const db = root.querySelector('.chat-msgs-down'); if (db && typeof db.__bump==='function') db.__bump(); }
              if (curChat===c.id && chatSoundOn(c)) playMsgSound();
            }, 1100 + Math.random()*900);
          }, 700 + Math.random()*900);
        }
      }

      const backBtn = root.querySelector('#chat-back');
      if (backBtn) backBtn.onclick = () => {
        const hostWin = root.closest('.aw-win');
        if (hostWin && hostWin.classList.contains('aw-win--narrow-chats')){
          /* Плавно: лента гаснет и уезжает влево, затем выезжает список. */
          if (hostWin.classList.contains('aw-win--chat-list')) return;
          hostWin.classList.add('aw-win--pane-out');
          clearTimeout(hostWin.__paneTimer);
          hostWin.__paneTimer = setTimeout(() => {
            hostWin.classList.remove('aw-win--pane-out');
            hostWin.classList.add('aw-win--chat-list');
          }, 160);
          return;
        }
        try { mobilePane(true); } catch(e){}
      };
      const soundBtn = $('#chat-sound', root);
      if (soundBtn){
        soundBtn.onclick = ()=>{
          c.soundOff = !c.soundOff;
          saveState();
          soundBtn.classList.toggle('is-off', !!c.soundOff);
          soundBtn.title = c.soundOff ? 'Включить звук новых сообщений' : 'Выключить звук новых сообщений';
          toast(c.soundOff ? 'Звук новых сообщений выключен' : 'Звук новых сообщений включён','info');
          /* Проба звука при включении — чтобы сразу было понятно, как звучит */
          if (!c.soundOff) playMsgSound();
        };
      }
      $('#chat-more', root).onclick = e=>showDropdown(e.currentTarget, [
        { label: c.pinned ? 'Открепить чат' : 'Закрепить чат', icon:'pin', onClick:()=>{
            const was = !!c.pinned;
            c.pinned = !was; saveState();
            pushChatAction(`${u.full_name} ${c.pinned?'закрепил(а)':'открепил(а)'} чат`);
            toast(c.pinned ? 'Чат закреплён' : 'Чат откреплён', 'ok');
            /* Та же анимация, что и из контекстного меню списка */
            window.__chatPinAnim = was ? 'unpin-anim' : 'pin-anim';
            APP.render();
          } },
        { label:'Отметить как непрочитанное', icon:'bell', onClick:()=>{
            const lastM = S.messages.filter(x=>x.chat_id===c.id).sort((a,b)=>b.created_at-a.created_at)[0];
            c.unread = c.unread || {};
            c.unread[u.id] = lastM ? lastM.created_at - 1 : Date.now() - 1;
            saveState();
            if (curChat === c.id) curChat = null; /* иначе отметка чтения тут же сбросится */
            APP.render();
            toast('Чат отмечен как непрочитанный','ok');
          } },
        ...(c.type!=='direct' && canModerate ? [{ label:'Пригласить в чат', icon:'plus', onClick:()=>{ try { inviteToChat(); } catch(e){} } }] : []),
        { label:'Уведомления чата: вкл', icon:'bell', onClick:()=>{ toast('Уведомления чата включены','info'); } },
        { label:'Не беспокоить 1 час', icon:'clock', onClick:()=>{ toast('Чат в режиме «Не беспокой до '+fmtTime(Date.now()+3600000),'info'); } },
        /* Порядок пунктов: архив — самый последний, сразу под удалением и без
           разделителя: это «отложить» после «удалить», а не часть настроек. */
        ...(canModerate ? ['-', { label:'Удалить чат (90 дней на восстановление)', icon:'trash', danger:true, onClick:()=>confirmModal({ title:'Удалить чат?', text:'Чат будет отключён. Восстановление возможно в течение 90 дней из бекапа.', okText:'Удалить', danger:true }).then(ok=>{ if(ok){ c.is_active=false; logAudit(`Чат удалён: ${c.name}`,'Чат'); saveState(); toast('Чат удалён. Восстановление доступно 90 дней','ok'); APP.render(); } }) }] : ['-']),
        { label: isArchived(c, u) ? 'Вернуть из архива' : 'В архив', icon:'archive', onClick:()=>{
            const arch = isArchived(c, u);
            setArchived(c, u, !arch);
            toast(arch ? 'Чат возвращён из архива' : 'Чат скрыт в архив','ok');
            if (!arch && curChat === c.id) curChat = null;
            APP.render();
          } }
      ]);

      /* Карточка чата (как в ТГ): клик по аватару в шапке — название, описание,
         участники; название/описание редактируют staff (админы/менеджеры). */
      const openChatInfo = ()=>{
        const canEdit = canModerate;
        const membersIds = [...new Set(chatMembers(c))];
        const membersList = membersIds.map(id2=>userById(id2)).filter(Boolean);
        const typeLabel = ({corporate:'Рабочий чат', order:'Чат заказа', group:'Группа', direct:'Личное сообщение', company:'Компания', manager:'Управленческий чат'})[c.type] || 'Чат';
        const body = `
          <div class="chat-info-head">
            ${avatarHTML({ full_name:c.name, avatar:c.avatar },'avatar--md')}
            <div>
              <b style="font-size:16px">${esc(c.name)}</b>
              <div class="small faint">${typeLabel} · участников: ${membersList.length}${c.owner_id?' · владелец: '+esc((userById(c.owner_id)||{}).full_name||'—'):''}</div>
              ${canEdit?`<label class="btn btn--ghost btn--sm" style="margin-top:6px;cursor:pointer">
                ${icon('image','ico-sm')} Сменить аватар
                <input type="file" id="ci-avatar" accept="image/*" hidden>
              </label>`:''}
            </div>
          </div>
          <div class="field" style="margin-top:12px"><label>Название</label>
            ${canEdit?`<input class="input" id="ci-name" value="${esc(c.name)}">`:`<div class="ci-static">${esc(c.name)||'—'}</div>`}
          </div>
          <div class="field"><label>Описание</label>
            ${canEdit?`<textarea class="input" id="ci-desc" rows="2">${esc(c.description||'')}</textarea>`:`<div class="ci-static">${esc(c.description||'—')}</div>`}
          </div>
          <div class="field"><label>Участники (${membersList.length})</label>
            <input class="input" id="ci-members-q" placeholder="Поиск по участникам" autocomplete="off" style="margin-bottom:8px">
            <div class="chat-info-members" id="ci-members-list">${membersList.map(x=>`
              <div class="chat-info-member" data-member="${esc(x.id)}" title="Открыть профиль">
                <span class="chat-info-member__av" data-mem-av="${esc(x.id)}" title="Открыть профиль">${avatarHTML(x,'avatar--sm')}</span>
                <div class="chat-info-member__meta"><b class="chat-info-member__nick" data-mem-dm="${esc(x.id)}" title="Написать (ЛС)">${esc(x.full_name)}</b><span class="small faint">${esc(ROLE_LABEL[x.role]||x.role)}</span></div>
                ${c.owner_id===x.id?'<span class="chat-role-tag chat-role-tag--owner">владелец</span>':''}
                ${canModerate && c.owner_id!==x.id ? `<button class="btn btn--ghost btn--sm" data-chat-admin="${esc(x.id)}" title="${(c.admins||[]).includes(x.id)?'Снять админа чата':'Сделать админом чата'}">${(c.admins||[]).includes(x.id)?'− админ':'+ админ'}</button>`:''}
              </div>`).join('') || '<div class="small faint">Участников нет</div>'}
            </div>
          </div>`;
        openWinModal({ narrow:true, title:'О чате', icon:'chats',
          body,
          footer: canEdit ? `<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-save>Сохранить</button>` : '',
          onMount:(m2,c2)=>{
            /* Клик по участнику — карточка профиля (там же «Написать») */
            /* Поиск по участникам: фильтруем по имени, нику и роли */
            const qEl = m2.querySelector('#ci-members-q');
            const listEl = m2.querySelector('#ci-members-list');
            if (qEl && listEl){
              const emptyMsg = document.createElement('div');
              emptyMsg.className = 'small faint';
              emptyMsg.textContent = 'Никого не найдено';
              emptyMsg.hidden = true;
              listEl.appendChild(emptyMsg);
              qEl.addEventListener('input', ()=>{
                const q = qEl.value.trim().toLowerCase();
                let shown = 0;
                listEl.querySelectorAll('.chat-info-member').forEach(row=>{
                  const hit = !q || row.textContent.toLowerCase().includes(q);
                  row.hidden = !hit;
                  if (hit) shown++;
                });
                emptyMsg.hidden = shown > 0;
              });
            }
            m2.querySelectorAll('.chat-info-member[data-member]').forEach(row=>{
              row.onclick = (ev)=>{
                if (ev.target.closest('[data-chat-admin]')) return;
                const av = ev.target.closest('[data-mem-av]');
                const dm = ev.target.closest('[data-mem-dm]');
                const uid2 = row.dataset.member;
                if (dm){ /* ник → ЛС, как в Telegram: сначала закрыть окно */
                  ev.stopPropagation();
                  c2();
                  setTimeout(()=>{
                    try {
                      if (typeof window.openDirectChat === 'function') window.openDirectChat(uid2);
                      else if (typeof CRM !== 'undefined' && CRM.openPersonCard) CRM.openPersonCard(uid2);
                    } catch(e){}
                  }, 180);
                  return;
                }
                /* Клик по строке или аватару — карточка профиля.
                   CRM — const в crm.js (лексический глобал), а НЕ свойство window:
                   проверять нужно typeof CRM, иначе окно профиля не открывалось. */
                try { if (typeof CRM !== 'undefined' && typeof CRM.openPersonCard === 'function') CRM.openPersonCard(uid2); } catch(e){}
              };
            });
            m2.querySelectorAll('[data-chat-admin]').forEach(btn=>btn.onclick = ()=>{
              const id2 = btn.dataset.chatAdmin;
              c.admins = c.admins || [];
              const i = c.admins.indexOf(id2);
              if (i >= 0) c.admins.splice(i,1); else c.admins.push(id2);
              saveState();
              logAudit((i>=0?'Снят админ чата: ':'Назначен админ чата: ') + ((userById(id2)||{}).full_name||id2) + ' — «' + c.name + '»', 'Чат');
              toast(i>=0?'Админ чата снят':'Назначен админ чата','ok');
              c2(); openChatInfo();
            });
            /* Смена аватара чата: выбор файла → dataURL → c.avatar, сохранение */
            const avInp = m2.querySelector('#ci-avatar');
            if (avInp){
              avInp.addEventListener('change', ()=>{
                const f = avInp.files && avInp.files[0];
                if (!f) return;
                if (!f.type.startsWith('image/')){ toast('Нужен файл изображения','err'); return; }
                /* Тот же кроппер, что и для личных аватаров */
                openAvatarCropper(f, webp => {
                  c.avatar = webp;
                  saveState();
                  logAudit(`Аватар чата обновлён: ${c.name}`, 'Чат');
                  toast('Аватар чата обновлён','ok');
                  /* Моментальное обновление шапки и списка */
                  try { renderChat(); } catch(e){}
                  try { APP.render(); } catch(e){}
                  c2(); openChatInfo();
                });
              });
            }
            if (canEdit){
              m2.querySelector('[data-x]').onclick = c2;
              m2.querySelector('[data-save]').onclick = ()=>{
                const nm = (m2.querySelector('#ci-name').value||'').trim();
                const ds = (m2.querySelector('#ci-desc').value||'').trim();
                if (!nm){ toast('Название не может быть пустым','warn'); return; }
                c.name = nm; c.description = ds; saveState();
                logAudit('Обновлена информация о чате «'+nm+'»','Чат');
                c2(); renderChat(); toast('Информация сохранена','ok');
              };
            }
          } });
      };
      /* В ЛС шапка ведёт в профиль собеседника, в группах — в «О чате» */
      const openHeadTarget = ()=>{
        if (c.type === 'direct'){
          const otherId = (c.member_ids||[]).find(id2=>id2 && id2!==u.id);
          if (otherId){
            try {
              if (typeof CRM !== 'undefined' && CRM.openPersonCard){ CRM.openPersonCard(otherId); return; }
            } catch(e){}
          }
        }
        openChatInfo();
      };
      const headAv = root.querySelector('.chat-head .avatar');
      if (headAv){
        headAv.style.cursor = 'pointer';
        headAv.title = c.type==='direct' ? 'Профиль' : 'Информация о чате';
        headAv.addEventListener('click', e=>{ e.stopPropagation(); openHeadTarget(); });
      }
      const headMeta = root.querySelector('.chat-head__meta');
      if (headMeta){
        headMeta.style.cursor = 'pointer';
        headMeta.title = c.type==='direct' ? 'Профиль' : 'Информация о чате и участники';
        headMeta.addEventListener('click', e=>{ e.stopPropagation(); openHeadTarget(); });
      }

      box.addEventListener('click', e=>{
        /* Только левая кнопка мыши: правый клик (контекстное меню) не должен
           ставить реакции и открывать меню реакций. */
        if (e.button !== 0) return;
        /* Клик по цитате ответа — скролл к исходному сообщению с подсветкой */
        const qEl = e.target.closest('.msg__quote');
        if (qEl){
          const target = box.querySelector(`.msg[data-msg="${qEl.dataset.quote}"]`);
          if (target){
            target.scrollIntoView({ block:'center', behavior:'smooth' });
            target.classList.add('msg--flash');
            setTimeout(()=>target.classList.remove('msg--flash'), 1300);
          }
          return;
        }
        /* Раскрытие длинного сообщения: подставляем полный текст плавно */
        const moreBtn = e.target.closest('.msg__more');
        if (moreBtn){
          const mid = moreBtn.dataset.mid;
          const src = S.messages.find(x=>x.id===mid);
          const cEl = moreBtn.closest('.msg') && moreBtn.closest('.msg').querySelector('.txt-c');
          if (src && cEl){
            cEl.style.transition = 'opacity .25s var(--ease)';
            cEl.style.opacity = '0';
            moreBtn.style.transition = 'opacity .2s var(--ease)';
            setTimeout(()=>{
              cEl.innerHTML = renderMentions(src.text);
              cEl.style.opacity = '1';
              moreBtn.style.opacity = '0';
              setTimeout(()=>moreBtn.remove(), 180);
            }, 220);
          }
          return;
        }
        const repBtn = e.target.closest('[data-replies]');
        if (repBtn){
          const src = repBtn.dataset.replies;
          const first = S.messages.filter(x=>x.chat_id===c.id && x.reply_to===src).sort((a,b)=>a.created_at-b.created_at)[0];
          if (first){
            const t = box.querySelector('.msg[data-msg="' + first.id + '"]');
            if (t){ t.scrollIntoView({ block:'center', behavior:'smooth' }); t.classList.add('msg--flash'); setTimeout(()=>t.classList.remove('msg--flash'), 1300); }
          }
          return;
        }
        const qk = e.target.closest('[data-quick]');
        if (qk){ applyLike(qk.closest('.msg')); return; }
        const rBtn = e.target.closest('[data-react]');
        if (rBtn){
          const [mid, em] = rBtn.dataset.react.split('|');
          const prevH = bubbleHeightOf(mid);
          const m = S.messages.find(x=>x.id===mid);
          m.reactions = m.reactions||{};
          m.reactions[em] = m.reactions[em]||[];
          const i = m.reactions[em].indexOf(u.id);
          /* Как в ТГ: повторное нажатие на реакцию снимает её */
          if (i >= 0) m.reactions[em].splice(i,1);
          else m.reactions[em].push(u.id);
          if (!m.reactions[em].length) delete m.reactions[em];
          saveState();
          /* Точечно: аватары ↔ цифра плавно, без перерисовки ленты */
          const ids = m.reactions[em] || [];
          if (!ids.length){
            rBtn.classList.add('react-fade');
            /* Без renderChat: перерисовка ленты сдвигала скролл и все
               сообщения дёргались. Убираем только пилюлю и её строку. */
            setTimeout(()=>{
              const row = rBtn.closest('.msg__reactions');
              rBtn.remove();
              if (row && !row.querySelector('.react-pill')) row.remove();
              restoreInlineTime(mid);
              animateBubbleHeight(mid, prevH);
            }, 190);
          } else {
            patchReactionPill(rBtn, ids, em);
            rBtn.classList.toggle('on', ids.includes(u.id));
          }
          return;
        }
        /* Групповое выделение: клик по сообщению в режиме выделения */
        if (chatSel.mode){
          const msgEl = e.target.closest('.msg');
          if (msgEl && !e.target.closest('.react-pill') && !e.target.closest('.msg__more') && !e.target.closest('.msg__replies') && !e.target.closest('.poll__opt') && !e.target.closest('.msg__audio')){
            const mid = msgEl.dataset.msg;
            chatSel.set.has(mid) ? chatSel.set.delete(mid) : chatSel.set.add(mid);
            msgEl.classList.toggle('msg--sel');
            const cnt = document.querySelector('#chat-sel-n');
            if (cnt) cnt.textContent = chatSel.set.size;
            return;
          }
        }
        /* Левый клик по сообщению ничего не открывает: меню — только по правой
           кнопке. Реакции остаются на клик по пилюле выше. */
      });

      /* Правая кнопка по сообщению: реакции смайликом, ответ, пересылка, копирование, удаление */
      box.addEventListener('contextmenu', e=>{
        /* Правый клик по опросу: отмена своего голоса. Проверяем раньше
           сообщения — опрос вложен в .msg, иначе меню сообщения перехватит. */
        const pollEl = e.target.closest('.poll[data-poll]');
        if (pollEl){
          const poll = S.polls.find(x=>x.id===pollEl.dataset.poll);
          if (poll){
            e.preventDefault(); e.stopPropagation();
            const mine = poll.options.filter(o=>(poll.votes[o]||[]).includes(u.id));
            const isAuthor = u.id === poll.user_id || u.role === 'admin';
            const whoItems = ()=>{
              /* «Кто проголосовал»: список по вариантам */
              if (poll.anonymous){ toast('Опрос анонимный — результаты видны, авторы — нет','info'); return; }
              const rows = poll.options.map(o=>{
                const us = (poll.votes[o]||[]).map(id=>{ const x=userById(id); return x?x.full_name:'—'; });
                return `<div class="row row--between" style="padding:7px 0;border-bottom:1px solid var(--border)"><span class="small">${esc(o)}</span><span class="small muted">${us.length?esc(us.join(', ')):'—'}</span></div>`;
              }).join('') || '<p class="small faint">Пока никто не голосовал</p>';
              openWinModal({ narrow:true, title:'Кто проголосовал',
                body:`<div class="stack" style="gap:2px">${rows}</div>` });
            };
            const items = [
              { label:'Кто проголосовал', icon:'clients', onClick:whoItems },
              ...(mine.length ? [{ label:'Отменить голос', icon:'x', onClick:()=>{
                  poll.options.forEach(o=>{
                    const arr = poll.votes[o] || [];
                    const i = arr.indexOf(u.id);
                    if (i >= 0) arr.splice(i,1);
                  });
                  saveState(); toast('Голос отменён','ok');
                  /* Плавно: снимаем заливку/проценты, рендер — после перехода */
                  const pv = document.querySelector('.poll[data-poll="'+poll.id+'"]');
                  if (pv){
                    const total = Object.values(poll.votes).reduce((a,v)=>a+v.length,0);
                    pv.querySelectorAll('[data-vote]').forEach(v=>{
                      const o = v.dataset.vote.slice(v.dataset.vote.indexOf('|')+1);
                      const arr = poll.votes[o] || [];
                      v.classList.toggle('voted', arr.includes(u.id));
                      const pct = total ? Math.round(arr.length/total*100) : 0;
                      const f = v.querySelector('.fill'); if (f) f.style.transform = 'scaleX(' + (pct/100) + ')';
                      const b = v.querySelector('b'); if (b) b.textContent = arr.length + ' · ' + pct + '%';
                    });
                    setTimeout(()=>{ try { renderChat(); } catch(e){} }, 320);
                  } else {
                    renderChat();
                  }
                } }] : []),
              ...(isAuthor ? [{ label:'Настройки опроса', icon:'settings', onClick:()=>{
                  const subMenuAnchors = [
                    { label: poll.anonymous ? 'Открытое голосование' : 'Анонимное голосование', icon:'eye-off',
                      keepOpen:true, onClick:(it)=>{ poll.anonymous = !poll.anonymous; saveState(); renderChat(); it.label = poll.anonymous?'Открытое голосование':'Анонимное голосование'; } },
                    { label:'Число ответов: 1', icon:'poll', checked: poll.maxVotes===1,
                      keepOpen:true, onClick:(it)=>{ poll.maxVotes=1; saveState(); renderChat(); } },
                    { label:'Число ответов: несколько', icon:'poll', checked: !poll.maxVotes,
                      keepOpen:true, onClick:(it)=>{ poll.maxVotes=0; saveState(); renderChat(); } },
                    { label:'Число ответов: до 3', icon:'poll', checked: poll.maxVotes===3,
                      keepOpen:true, onClick:(it)=>{ poll.maxVotes=3; saveState(); renderChat(); } }
                  ];
                  showDropdown(pollEl, subMenuAnchors, { x:e.clientX, y:e.clientY, force:true });
                } }] : [])
            ];
            showDropdown(pollEl, items, { x:e.clientX, y:e.clientY });
            return;
          }
        }
        const el = e.target.closest('.msg');
        if (!el) return;
        e.preventDefault(); e.stopPropagation();
        const m = S.messages.find(x=>x.id===el.dataset.msg);
        if (!m) return;
        const toggleReaction = (em)=>{
          const prevH = bubbleHeightOf(m.id);
          m.reactions = m.reactions || {};
          m.reactions[em] = m.reactions[em] || [];
          const idx = m.reactions[em].indexOf(u.id);
          idx>=0 ? m.reactions[em].splice(idx,1) : m.reactions[em].push(u.id);
          if (!m.reactions[em].length) delete m.reactions[em];
          saveState();
          /* Точечно: аватары ↔ цифра плавно, без перерисовки ленты */
          const pill = box.querySelector('.react-pill[data-react="' + m.id + '|' + em + '"]');
          const ids = m.reactions[em] || [];
          if (!ids.length){
            if (pill){ pill.classList.add('react-fade'); setTimeout(()=>{ renderChat(); animateBubbleHeight(m.id, prevH); }, 190); }
            else { renderChat(); animateBubbleHeight(m.id, prevH); }
            return;
          }
          if (pill){
            patchReactionPill(pill, ids, em);
            pill.classList.toggle('on', ids.includes(u.id));
          } else {
            renderChat();
            animateBubbleHeight(m.id, prevH);
            requestAnimationFrame(()=>{
              const np = root.querySelector('.react-pill[data-react="' + m.id + '|' + em + '"]')
                || document.querySelector('.react-pill[data-react="' + m.id + '|' + em + '"]');
              if (np) np.classList.add('react-pill--in');
            });
          }
        };
        const repliesToThis = S.messages.filter(x=>x.chat_id===c.id && x.reply_to===m.id).sort((a,b)=>a.created_at-b.created_at);
        /* Выделенный фрагмент текста в этом сообщении (для цитаты, как в ТГ):
           читаем ПРЯМО СЕЙЧАС — клик по пункту меню сбросит выделение. */
        let selFrag = '';
        try {
          const s = String(window.getSelection ? window.getSelection() : '');
          const inside = e.target.closest('.msg__bubble');
          if (s.trim() && inside) selFrag = s.trim().slice(0, 300);
        } catch(err){}
        const items = [
          ...(m.user_id!==u.id ? [{ label:'Ответить лично', icon:'chats', onClick:()=>{
              if (m.user_id) openDirectChat(m.user_id);
            } }] : []),
          ...(selFrag ? [{ label:'Цитировать фрагмент', icon:'copy', onClick:()=>{
              chatReplyTo = m; chatReplyTo.replyText = selFrag;
              renderChat(); const t = $('#chat-t', root); if (t) { t.focus(); }
              toast('Фрагмент будет процитирован в ответе','info');
            } }] : []),
          { label:'Выделить', icon:'check-c', onClick:()=>{
              if (!chatSel.mode){ chatSel.set.clear(); chatSel.mode = true; }
              chatSel.set.add(m.id);
              const el = document.querySelector('.msg[data-msg="'+m.id+'"]');
              if (el) el.classList.add('msg--sel');
              showSelBar();
              toast('Выделяйте сообщения кликом — и пересылайте или удаляйте','info');
            } },
          { label:'Ответить', icon:'chev-l', onClick:()=>{
              chatReplyTo = m;
              if (selFrag && selFrag.length) chatReplyTo.replyText = selFrag;
              else delete chatReplyTo.replyText;
              renderChat(); const t = $('#chat-t', root); if (t) t.focus();
            } },
          ...(m.user_id===u.id ? [{ label:'Редактировать', icon:'edit', onClick:()=>{
              chatEditMsg = m; chatReplyTo = null; renderChat();
              const t = $('#chat-t', root); if (t){ t.focus(); t.setSelectionRange(t.value.length, t.value.length); }
            } }] : []),
          ...(repliesToThis.length ? [{ label:`Посмотреть ответы (${repliesToThis.length})`, icon:'chev-r', onClick:()=>{
              const t = box.querySelector('.msg[data-msg="' + repliesToThis[0].id + '"]');
              if (t){ t.scrollIntoView({ block:'center', behavior:'smooth' }); t.classList.add('msg--flash'); setTimeout(()=>t.classList.remove('msg--flash'), 1300); }
            } }] : []),
          { label:'Переслать…', icon:'send', onClick:()=>openForwardMenu(m) },
          { label: m.pinned ? 'Открепить сообщение' : 'Закрепить сообщение', icon:'pin', onClick:()=>{
              const wasPinned = !!m.pinned;
              m.pinned = !m.pinned; saveState();
              pushChatAction(`${u.full_name} ${m.pinned?'закрепил(а)':'открепил(а)'} сообщение`);
              toast(m.pinned ? 'Сообщение закреплено' : 'Сообщение откреплено', 'ok');
              if (wasPinned){
                const pb = document.querySelector('.pinned-msg-bar');
                if (pb){
                  pb.classList.add('closing');
                  setTimeout(()=>{ try { renderChat(); } catch(e){} }, 160);
                  return;
                }
              }
              renderChat();
            } },
          { label:'Копировать текст', icon:'copy', onClick:()=>{
              try { navigator.clipboard.writeText(m.text||''); toast('Текст скопирован','ok'); }
              catch(err){ toast('Не удалось скопировать','err'); }
            } },
          '-',
          { label:'Данные о сообщении', icon:'info', onClick:()=>{
              const fmt2 = ts => new Date(ts).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
              const names = ids => (ids||[]).filter(Boolean).map(id=>{ const x=userById(id); return x?x.full_name:'—'; });
              const own = m.user_id === u.id;
              const del = names(m.deliveredTo);
              const read = names(m.readBy);
              const rows = [];
              rows.push(`<p class="small faint">${own?'Отправлено':'Получено'} · ${fmt2(m.created_at)}</p>`);
              if (own){
                if (del.length) rows.push(`<div class="dd__info-row"><b>Доставлено (${del.length})</b></div><div class="dd__info-names">${esc(del.slice(0,15).join(', '))}${del.length>15?' и ещё '+(del.length-15):''}</div>`);
                /* Кто НЕ прочитал: получатели минус прочитавшие */
                const recipients = (m.deliveredTo||[]).filter(id2=>!((m.readBy||[]).includes(id2)));
                const notRead = names(recipients);
                rows.push(read.length
                  ? `<div class="dd__info-row"><b>Прочитано (${read.length})</b> · ${icon('checks','ico-sm')}</div><div class="dd__info-names">${esc(read.slice(0,15).join(', '))}${read.length>15?' и ещё '+(read.length-15):''}</div>`
                  : `<div class="dd__info-row"><b>Прочитано</b></div><div class="dd__info-names">ещё никем</div>`);
                if (notRead.length) rows.push(`<div class="dd__info-row"><b>Не прочитали (${notRead.length})</b></div><div class="dd__info-names">${esc(notRead.slice(0,15).join(', '))}${notRead.length>15?' и ещё '+(notRead.length-15):''}</div>`);
              } else {
                if (read.length) rows.push(`<div class="dd__info-row"><b>Прочитано (${read.length})</b></div><div class="dd__info-names">${esc(read.slice(0,15).join(', '))}${read.length>15?' и ещё '+(read.length-15):''}</div>`);
              }
              const ract = m.reactions ? Object.entries(m.reactions).filter(([,us])=>us.length) : [];
              if (ract.length){
                rows.push('<div class="dd__info-row" style="margin-top:6px"><b>Реакции</b></div>');
                ract.forEach(([em,us])=>{
                  const nm = us.map(id2=>{ const x=userById(id2); return x?x.full_name:'—'; });
                  rows.push(`<div class="dd__info-names" style="margin-bottom:4px">${em} · ${us.length} — ${esc(nm.slice(0,10).join(', '))}${nm.length>10?' и ещё '+(nm.length-10):''}</div>`);
                });
              } else {
                rows.push('<div class="dd__info-names">Реакций пока нет</div>');
              }
              openWinModal({ narrow:true, title:'Данные о сообщении',
                body:`<div class="dd__info" style="gap:3px">${rows.join('')}</div>` });
            } }
        ];
        if (m.user_id===u.id || canModerate) items.push('-', { label:'Удалить сообщение', icon:'trash', danger:true, onClick:()=>{
          animateMsgsOut([m.id], ()=>{
            S.messages = S.messages.filter(x=>x.id!==m.id);
            logAudit(`Сообщение удалено в «${c.name}»`,'Чат'); saveState(); renderChat();
          });
        }});
        const dd = showDropdown(el, items, { x:e.clientX, y:e.clientY, emojis: EMOJI_SET, onEmoji: toggleReaction });
        /* Данные о сообщении (как в WhatsApp): время, доставлено, прочитано */
        if (dd){
          const fmt2 = ts => new Date(ts).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
          const names = ids => (ids||[]).filter(Boolean).map(id=>{ const x=userById(id); return x?x.full_name:'—'; });
          const del = names(m.deliveredTo), read = names(m.readBy);
          const own = m.user_id === u.id;
          const rows = [];
          rows.push(`<span class="dd__info-time">${own?'Отправлено':'Получено'} · ${fmt2(m.created_at)}</span>`);
          if (own){
            if (del.length) rows.push(`<span class="dd__info-row"><b>Доставлено (${del.length})</b></span><span class="dd__info-names">${esc(del.slice(0,12).join(', '))}${del.length>12?' и ещё '+(del.length-12):''}</span>`);
            if (read.length) rows.push(`<span class="dd__info-row"><b>Прочитано (${read.length})</b> · ${icon('checks','ico-sm')}</span><span class="dd__info-names">${esc(read.slice(0,12).join(', '))}${read.length>12?' и ещё '+(read.length-12):''}</span>`);
            else rows.push(`<span class="dd__info-row"><b>Прочитано</b></span><span class="dd__info-names">ещё никем</span>`);
          } else {
            if (read.length) rows.push(`<span class="dd__info-row"><b>Прочитано (${read.length})</b></span><span class="dd__info-names">${esc(read.slice(0,12).join(', '))}${read.length>12?' и ещё '+(read.length-12):''}</span>`);
          }
          /* Реакции в данных о сообщении (как в ТГ) */
          {
            const ract = m.reactions ? Object.entries(m.reactions).filter(([,us])=>us.length) : [];
            if (ract.length){
              rows.push('<span class="dd__info-row"><b>Реакции</b> · ' + icon('smile','ico-sm') + '</span>');
              ract.forEach(([em,us])=>{
                const nm = us.map(id2=>{ const x=userById(id2); return x?x.full_name:'—'; });
                rows.push(`<span class="dd__info-names">${em} · ${us.length} — ${esc(nm.slice(0,8).join(', '))}${nm.length>8?' и ещё '+(nm.length-8):''}</span>`);
              });
            }
          }
          dd.insertAdjacentHTML('afterbegin', `<div class="dd__info">${rows.join('')}</div>`);
        }
      });
       /* Двойной клик по сообщению: поставить/убрать реакцию 👍 с анимацией */
    const rerenderKeepScroll = ()=>{
      const sc = box ? box.scrollTop : 0;
      const wasBottom = box ? (box.scrollHeight - box.scrollTop - box.clientHeight) < 90 : false;
      renderChat();
      const nb = $('#chat-msgs', root);
      if (nb){ nb.scrollTop = wasBottom ? nb.scrollHeight : sc; }
    };
    /* Быстрый лайк 👍: двойной клик/тап или кнопка при наведении */
    let suppressLikeUntil = 0;
    const applyLike = (el2)=>{
      if (!el2) return;
      const mm = S.messages.find(x=>x.id===el2.dataset.msg);
      if (!mm) return;
      const prevH = bubbleHeightOf(mm.id);
      mm.reactions = mm.reactions || {};
      const arr = mm.reactions['👍'] = mm.reactions['👍'] || [];
      const i = arr.indexOf(u.id);
      if (i >= 0) arr.splice(i,1); else arr.push(u.id);
      if (!arr.length) delete mm.reactions['👍'];
      saveState();
      try { if (navigator.vibrate) navigator.vibrate(12); } catch(err){}
      const pill = el2.querySelector('.react-pill[data-react="' + mm.id + '|👍"]');
      if (arr.length && pill){
        patchReactionPill(pill, arr, '👍');
        pill.classList.toggle('on', arr.includes(u.id));
      } else if (!arr.length && pill){
        pill.classList.add('react-fade');
        el2.classList.add('msg--reacting');
        setTimeout(()=>{
          const row = pill.closest('.msg__reactions');
          pill.remove();
          if (row && !row.querySelector('.react-pill')) row.remove();
          restoreInlineTime(mm.id);
          animateBubbleHeight(mm.id, prevH);
        }, 190);
      } else if (arr.length){
        el2.classList.add('msg--reacting');
        rerenderKeepScroll();
        animateBubbleHeight(mm.id, prevH);
        const np = root.querySelector('.msg[data-msg="' + mm.id + '"] .react-pill[data-react="' + mm.id + '|👍"]')
          || document.querySelector('.msg[data-msg="' + mm.id + '"] .react-pill[data-react="' + mm.id + '|👍"]');
        if (np) np.classList.add('react-pill--in');
      } else {
        rerenderKeepScroll();
      }
      setTimeout(()=>el2.classList.remove('msg--reacting'), 1300);
    };
    box.addEventListener('dblclick', e=>{
      if (chatSel.mode || Date.now() < suppressLikeUntil) return;
      const el2 = e.target.closest('.msg');
      if (!el2) return;
      if (e.target.closest('.react-pill') || e.target.closest('.msg__more') || e.target.closest('.msg__replies')
          || e.target.closest('.poll__opt') || e.target.closest('a') || e.target.closest('.msg__audio')) return;
      applyLike(el2);
    });
    /* Мобильный: двойной тап по сообщению ставит 👍 (с вибрацией) */
    let lastTapT = 0, lastTapEl = null;
    box.addEventListener('touchend', e=>{
      if (chatSel.mode) return;
      const el2 = e.target.closest('.msg');
      if (!el2) return;
      if (e.target.closest('.react-pill, .msg__more, .msg__replies, .poll__opt, a, .msg__audio, .msg-quick')) return;
      const now = Date.now();
      if (now - lastTapT < 320 && lastTapEl === el2){
        applyLike(el2);
        suppressLikeUntil = Date.now() + 700;
        lastTapT = 0; lastTapEl = null;
      } else { lastTapT = now; lastTapEl = el2; }
    }, { passive: true });
    };

    /* Пересылка: выбор ОДНОГО ИЛИ НЕСКОЛЬКИХ чатов-получателей */
    const openForwardMenu = (m)=>{
      const targets = noDemo(S.chats).filter(t=>t.id!==m.chat_id && t.is_active!==false);
      if (!targets.length){ toast('Нет других чатов для пересылки','info'); return; }
      openWinModal({ narrow:true, title:'Переслать сообщение',
        body:`<div class="fwd-list">${targets.map(t=>`
            <label class="fwd-item"><input type="checkbox" value="${t.id}">
              <span class="fwd-item__name">${esc(t.name)}</span>
            </label>`).join('')}</div>
          <p class="small faint" style="margin:8px 2px 0">Можно выбрать несколько чатов</p>`,
        footer:`<button class="btn btn--ghost" data-x>Отмена</button>
                <button class="btn btn--primary" data-go>Переслать</button>`,
        onMount:(mm, close)=>{
          mm.querySelector('[data-x]').onclick = close;
          mm.querySelector('[data-go]').onclick = ()=>{
            const ids = [...mm.querySelectorAll('.fwd-item input:checked')].map(i=>i.value);
            if (!ids.length){ toast('Выберите хотя бы один чат','err'); return; }
            ids.forEach(id=>{ const t = S.chats.find(x=>x.id===id); if (t) forwardTo(m, t, true); });
            saveState();
            const n = ids.length, w = (n%10===1 && n%100!==11) ? 'чат' : ((n%10>=2 && n%10<=4) && !(n%100>=12 && n%100<=14) ? 'чата' : 'чатов');
            toast(`Переслано в ${n} ${w}`,'ok');
            close();
            if (ids.includes(curChat)) renderChat();
          };
        } });
    };
    /* Пересылка нескольких выделенных сообщений */
    const openForwardList = (msgs)=>{
      const fromChat = msgs[0] && msgs[0].chat_id;
      const targets = noDemo(S.chats).filter(t=>t.id!==fromChat && t.is_active!==false);
      if (!targets.length){ toast('Нет других чатов для пересылки','info'); return; }
      openWinModal({ narrow:true, title:`Переслать сообщений: ${msgs.length}`,
        body:`<div class="fwd-list">${targets.map(t=>`
            <label class="fwd-item"><input type="checkbox" value="${t.id}">
              <span class="fwd-item__name">${esc(t.name)}</span>
            </label>`).join('')}</div>
          <p class="small faint" style="margin:8px 2px 0">Можно выбрать несколько чатов</p>`,
        footer:`<button class="btn btn--ghost" data-x>Отмена</button>
                <button class="btn btn--primary" data-go>Переслать</button>`,
        onMount:(mm, close)=>{
          mm.querySelector('[data-x]').onclick = close;
          mm.querySelector('[data-go]').onclick = ()=>{
            const ids = [...mm.querySelectorAll('.fwd-item input:checked')].map(i=>i.value);
            if (!ids.length){ toast('Выберите хотя бы один чат','err'); return; }
            ids.forEach(id=>{ const t = S.chats.find(x=>x.id===id); if (!t) return;
              msgs.forEach(m=>{
                S.messages.push({ id:uid(), chat_id:t.id, user_id:u.id, text:m.text||'', type:'text',
                  created_at:Date.now(), reactions:{}, file:m.file?{...m.file}:undefined,
                  forwarded_from:{ user_id:m.user_id, chat_id:m.chat_id } });
              });
            });
            saveState();
            const n = ids.length, w = (n%10===1 && n%100!==11) ? 'чат' : ((n%10>=2 && n%10<=4) && !(n%100>=12 && n%100<=14) ? 'чата' : 'чатов');
            toast(`Переслано в ${n} ${w} (${msgs.length} сообщ.)`,'ok');
            close();
            if (ids.includes(curChat)) renderChat();
          };
        } });
    };
    const forwardTo = (m, target, silent)=>{
      S.messages.push({ id:uid(), chat_id:target.id, user_id:u.id, text:m.text||'', type:'text',
        created_at:Date.now(), reactions:{}, forwarded_from:{ user_id:m.user_id, chat_id:m.chat_id } });
      if (!silent) saveState();
      if (!silent) toast(`Переслано в «${target.name}»`,'ok');
      if (!silent && curChat===target.id) renderChat();
    };

    const pollHTML = (p, u2)=>{
      const totalVotes = Object.values(p.votes).reduce((a,v)=>a+v.length,0);
      const pBadges = `<span class="poll__badges">${p.anonymous?`<span class="poll__badge">${icon('eye-off','ico-sm')} анонимно</span>`:`<span class="poll__badge">${icon('clients','ico-sm')} открыто</span>`}<span class="poll__badge">${p.maxVotes===1?'один ответ':(p.maxVotes>1?`до ${p.maxVotes} ответов`:'несколько ответов')}</span></span>`;
      return `<div class="poll" data-poll="${p.id}"><b class="small">${esc(p.question)}</b>${pBadges}
        ${p.options.map(o=>{
          const n = (p.votes[o]||[]).length;
          const pct = totalVotes?Math.round(n/totalVotes*100):0;
          const voted = (p.votes[o]||[]).includes(u2.id);
          return `<div class="poll__opt ${voted?'voted':''}" data-vote="${p.id}|${esc(o)}"><span class="fill" style="transform:scaleX(${pct/100})"></span><span>${esc(o)}<span class="poll__check">${icon('check-c','ico-sm')}</span><b>${n} · ${pct}%</b></span></div>`;
        }).join('')}</div>`;
    };
    /* Голосование в опросах + клик по аватару → профиль пользователя */
    root.addEventListener('click', e=>{
      const vote = e.target.closest('[data-vote]');
      if (vote){
        const [pid, opt] = vote.dataset.vote.split('|');
        const poll = S.polls.find(x=>x.id===pid);
        if (poll && !poll.votes[opt]?.includes(u.id)){
          const maxV = poll.maxVotes || 0;
          if (maxV > 0){
            const my = poll.options.filter(o=>(poll.votes[o]||[]).includes(u.id)).length;
            if (my >= maxV){
              toast(`Можно выбрать не более ${maxV} ${maxV===1?'ответа':'ответов'}`, 'warn');
              return;
            }
          }
          poll.votes[opt] = poll.votes[opt] || [];
          poll.votes[opt].push(u.id);
          saveState();
          /* Плавное отражение голоса: подсветка без резкой перерисовки */
          vote.classList.add('voted','voted-now');
          const fill = vote.querySelector('.fill');
          if (fill){
            const tot = Object.values(poll.votes).reduce((a,v)=>a+v.length,0);
            const pct = tot ? Math.round((poll.votes[opt]||[]).length / tot * 100) : 0;
            fill.style.transform = 'scaleX(' + (pct/100) + ')';
          }
          setTimeout(()=>{ try { renderChat(); } catch(e){} }, 460);
        }
        return;
      }
      /* Режим выделения сообщений: клики ВНУТРИ сообщения (ник, аватар,
         упоминания, артефакты) не открывают ЛС/карточки — переключение
         выделения уже обработал box-обработчик (он глубже и срабатывает
         раньше при всплытии). Голосование в опросах остаётся доступным. */
      if (chatSel && chatSel.mode && e.target.closest('.msg') && !e.target.closest('[data-vote]')) return;
      const roleTag = e.target.closest('[data-mention-role]');
      if (roleTag){
        const rt = ROLE_TAGS.find(x => x.role === roleTag.dataset.mentionRole);
        /* Обработчик живёт вне renderChat — чат берём по curChat, а не по `c` */
        const chRole = S.chats.find(x => x.id === curChat);
        if (rt && chRole){
          /* Тег читается как «все менеджеры» — показываем всех с этой ролью
             на платформе (демо-персоны исключаем), а не только участников чата. */
          const ids = noDemo(S.users).filter(x => x && x.role === rt.role).map(x => x.id);
          const rows = ids.length
            ? ids.map(id2 => { const x = userById(id2); return `<div class="row" style="gap:9px;padding:6px 0">${avatarHTML(x,'avatar--sm')}<span style="flex:1;min-width:0"><b class="small">${esc(x.full_name)}</b><div class="cell-sub">${esc(ROLE_LABEL[x.role]||'')}</div></span></div>`; }).join('')
            : `<p class="small faint">В чате нет участников с ролью «${esc(ROLE_LABEL[rt.role]||rt.role)}»</p>`;
          openWinModal({ narrow:true, title:'Упоминание роли: @' + rt.label, body:`<div class="stack" style="gap:2px">${rows}</div>` });
        }
        return;
      }
      const mnt = e.target.closest('[data-mention]');
      if (mnt){
        const un = mnt.dataset.mention;
        const tu = S.users.find(x=>x.username===un || x.full_name===un);
        if (tu) openDirectChat(tu.id);
        return;
      }
      /* Карточки-артефакты: контакт открывает ЛС, заказ — карточку заказа */
      const artC = e.target.closest('[data-contact]');
      if (artC){
        const pu = userById(artC.dataset.contact);
        if (pu) openDirectChat(pu.id);
        return;
      }
      const artO = e.target.closest('[data-order-ref]');
      if (artO){
        const ref = artO.dataset.orderRef;
        const o2 = S.orders.find(x=>x.order_id===ref) || S.orders.find(x=>x.id===ref);
        if (!o2){ toast('Заказ не найден','err'); return; }
        /* Доступ только участникам процесса: клиент(ы), исполнители,
           менеджер заказа, админ/топ-менеджер. Чужие — не перейдут по ссылке. */
        const me2 = user();
        const allowed = ['admin','top_manager'].includes(me2.role)
          || o2.client_id === me2.id
          || (o2.client_ids||[]).includes(me2.id)
          || (o2.executors||[]).some(x => x.uid === me2.id)
          || o2.manager_id === me2.id;
        if (!allowed){ toast('Нет доступа: вы не участник этого заказа','err'); return; }
        if (window.CRM && CRM.openOrderDetail) CRM.openOrderDetail(o2.id);
        return;
      }
      const av = e.target.closest('[data-av-uid]');
      if (av){
        /* В режиме выделения клик по АВАТАРУ ГРУППЫ (он вне .msg, box-обработчик
           его не тоглит) выделяет все сообщения группы — вся группа считается
           частью выделения, ЛС не открывается. */
        if (chatSel && chatSel.mode){
          const grp = e.target.closest('.msg-group');
          if (grp){
            grp.querySelectorAll('.msg[data-msg]').forEach(mEl => {
              const mid = mEl.dataset.msg;
              chatSel.set.has(mid) ? chatSel.set.delete(mid) : chatSel.set.add(mid);
              mEl.classList.toggle('msg--sel');
            });
            const cntN = document.querySelector('#chat-sel-n');
            if (cntN) cntN.textContent = chatSel.set.size;
            return;
          }
        }
        const pu = userById(av.dataset.avUid);
        if (pu) openDirectChat(pu.id);
      }
    });

    const chatKey = c => {
      if (c.pinned) return 'pin';
      if (c.type==='direct') return 'direct';
      if (c.type==='group') return 'group';
      if (c.type==='order') return 'order';
      return 'other';
    };
    const CHAT_SECS = [
      { key:'pin',    label:'Закреплённые' },
      { key:'direct', label:'Личные сообщения' },
      { key:'group',  label:'Группы' },
      { key:'order',  label:'Заказы' },
      { key:'other',  label:'Рабочие чаты' }
    ];
    const groupChats = list => {
      const byKey = {};
      list.forEach(c=>{ (byKey[chatKey(c)] = byKey[chatKey(c)] || []).push(c); });
      const secs = [];
      CHAT_SECS.forEach(sec=>{
        const arr = byKey[sec.key] || [];
        if (!arr.length) return;
        arr.sort((a,b)=>((b.pinned?1:0)-(a.pinned?1:0)) || (lastMsgAt(b)-lastMsgAt(a)));
        secs.push({ key:sec.key, label:sec.label });
        arr.forEach(c=>secs.push({ key:sec.key, chat:c }));
      });
      return secs;
    };
    const lastMsgAt = c => {
      const last = S.messages.filter(m=>m.chat_id===c.id).slice(-1)[0];
      return last ? last.created_at : (c.created_at||0);
    };
    /* Черновик сообщения для чата (как в ТГ): показываем в превью
       вместо последнего сообщения, если текст ещё не отправлен. */
    const chatDraftText = c => {
      try { return sessionStorage.getItem('chatDraft_' + c.id) || ''; } catch(e){ return ''; }
    };
    /* Список чатов в левой колонке: обычные секции или пустое состояние архива
       (заголовок, пояснение, кнопка назад), как в ТГ. */
    const archListInner = (isArch, list) => {
      const items = groupChats(list).map(x=>{
        if (x.chat) return chatItemHtml(x.chat);
        return `<div class="chat-sec" data-sec="${x.key}">${esc(x.label)}</div>`;
      }).join('');
      if (items) return items;
      if (!isArch) return `<div class="empty">${icon('chats')}<span>Чатов пока нет</span></div>`;
      return `<div class="chat-empty-arch">
        <span class="chat-empty-arch__ico">${icon('archive')}</span>
        <b>В архиве пока пусто</b>
        <p>Сюда попадают чаты, которые вы убрали из списка. Вернуть чат можно в любой момент.</p>
        <button type="button" class="btn btn--ghost btn--sm" id="chat-empty-arch-back">${icon('chats','ico-sm')} Ко всем чатам</button>
      </div>`;
    };
    const chatItemHtml = c => {
      const last = S.messages.filter(m=>m.chat_id===c.id).slice(-1)[0];
      const un = chatUnreadUI(c, u.id);
      return `<div class="chat-item ${c.id===curChat?'on':''} ${c.pinned?'is-pinned':''}" data-ch="${c.id}">
        ${avatarHTML({ full_name:c.name, avatar:c.avatar, is_online:c.type==='corporate' },'avatar--sm')}
        <div class="chat-item__meta">
          <div class="t"><b>${c.pinned?`<span class="chat-item__pin" title="Закреплён">${icon('pin','ico-sm')}</span>`:''}${esc(c.name)}</b><time>${last?fmtTime(last.created_at):''}</time></div>
          <div class="p">${chatItemPreviewHtml(c)}</div>
        </div>
        ${c.soundOff?`<span class="chat-item__mute" title="Уведомления выключены">${icon('bell','ico-sm')}<svg class="chat-item__mute-slash" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.9 1.9 14.1 14.1"/></svg></span>`:''}
        ${un.mentioned?`<span class="chat-item__at" title="${un.replyToMe?'Ответ на ваше сообщение':'Вас упомянули'}">${icon('at-sign','ico-sm')}</span>`:''}
        ${un.count?`<span class="chat-item__unread">${un.count}</span>`:(un.dot?`<span class="chat-item__unread chat-item__unread--dot" title="Непрочитанный"></span>`:'')}
      </div>`;
    };

    root.innerHTML = `
      <div class="page-head" style="margin-bottom:12px"><div><h2>Чаты</h2><div class="sub">Корпоративные, заказные, групповые и чаты компаний</div></div>
        <div class="page-actions">
          <button class="iconbtn qa-iconbtn" id="btn-chat-search" title="Поиск по сообщениям">${icon('search')}</button>
          <button class="iconbtn qa-iconbtn" id="btn-new-chat" title="Новый чат">${icon('user-plus')}</button>
          <button class="iconbtn qa-iconbtn" id="btn-new-group" title="Новая группа">${icon('users')}</button>
          <button class="btn btn--primary" id="btn-broadcast" style="display:none">${icon('send')} <span class="bc-full">Массовое сообщение</span><span class="bc-short">Рассылка</span></button>
        </div></div>
      <div class="chat-search-panel" id="chat-search-panel" hidden>
        <div class="chat-search-row">
          ${icon('search','ico-lg')}
          <input id="chat-search-input" class="input" placeholder="Поиск по сообщениям…" autocomplete="off">
          <button class="iconbtn" id="chat-search-clear" title="Очистить">${icon('x')}</button>
        </div>
        <div class="chat-search-results" id="chat-search-results"></div>
      </div>
      <div class="chats-layout">
        <div class="chat-list">
          <div class="chat-filter-row">
            <button class="chip ${archMode?'':'on'}" id="chat-f-all">${icon('chats','ico-sm')} Все</button>
            <button class="chip ${archMode?'on':''}" id="chat-f-arch">${icon('archive','ico-sm')} Архив</button>
          </div>
          <div class="chat-list__scroll">
          ${archListInner(archMode, chats())}
        </div></div>
        <div class="chat-main" id="chat-main"></div>
      </div>`;

    /* Анимация закрепления: класс ставится на контейнер, который создаётся
       только что, иначе предыдущий узел удаляется вместе с анимацией. */
    if (window.__chatPinAnim){
      const host0 = root.querySelector('.chat-list__scroll');
      if (host0){ host0.classList.add(window.__chatPinAnim); window.__chatPinAnim = null; }
    }

    fitChats();
    requestAnimationFrame(fitChats);
    if (window.__fitChatsHandler) window.removeEventListener('resize', window.__fitChatsHandler);
    window.__fitChatsHandler = fitChats;
    window.addEventListener('resize', fitChats);
    window.addEventListener('resize', () => {
      const lay = root.querySelector('.chats-layout');
      const wasList = !!(lay && lay.classList.contains('chats-layout--withlist'));
      try { mobilePane(isMobileChats() ? wasList : false); } catch(e){}
    });

    const bindArchFilter = ()=>{
      const fAll = $('#chat-f-all', root), fArch = $('#chat-f-arch', root);
      if (!fAll || !fArch) return;
      const apply = ()=>{
        fAll.classList.toggle('on', !archMode);
        fArch.classList.toggle('on', archMode);
        curList = chats();
        if (!curList.some(c=>c.id===curChat) || archMode) curChat = curList[0]?.id || null;
        /* Характерная анимация смены «Все»/«Архив» (как листание в ТГ):
           1) старый список плавно уезжает в сторону переключения (по x) и тает;
           2) в момент максимума контент подменяется;
           3) новый список въезжает с противоположной стороны. */
        const sc = root.querySelector('.chat-list__scroll');
        if (sc){
          const dir = archMode ? -1 : 1; /* в «Архив» — влево, обратно — вправо */
          window.__archAnimBusy = true;
          sc.style.transition = 'none';
          sc.style.transform = 'translateX(0)';
          sc.style.opacity = '1';
          void sc.offsetWidth;
          sc.style.transition = 'opacity .14s var(--ease), transform .16s var(--ease)';
          sc.style.transform = 'translateX(' + (dir * 26) + 'px)';
          sc.style.opacity = '0';
          clearTimeout(window.__archAnimT);
          window.__archAnimT = setTimeout(()=>{
            if (!sc.isConnected) return;
            sc.innerHTML = archListInner(archMode, chats());
            bindChatItems();
            renderChat();
            sc.style.transition = 'none';
            sc.style.transform = 'translateX(' + (-dir * 26) + 'px)';
            sc.style.opacity = '0';
            void sc.offsetWidth;
            sc.style.transition = 'opacity .16s var(--ease), transform .18s var(--ease)';
            sc.style.transform = 'translateX(0)';
            sc.style.opacity = '1';
            setTimeout(()=>{
              if (sc.isConnected){ sc.style.transition = ''; sc.style.transform = ''; sc.style.opacity = ''; }
              window.__archAnimBusy = false;
            }, 200);
          }, 170);
          return;
        }
        sc.innerHTML = archListInner(archMode, chats());
        bindChatItems();
        renderChat();
      };
      fAll.onclick = ()=>{ archMode = false; apply(); };
      fArch.onclick = ()=>{ archMode = true; apply(); };
    };
    bindArchFilter();
    window.__archUi = { chats, archMode: ()=>archMode };
    const bc = $('#btn-broadcast', root);
    bc.style.display = isStaff(user().role) ? '' : 'none';
    bc.onclick = ()=>{
      const ROLES = ['admin','top_manager','manager','executor','client'];
      const sel = new Set(['client']);
      openWinModal({ narrow:true, title:'Массовое сообщение',
        body:`<div class="field"><label>Заголовок</label><input class="input" id="bc-h" placeholder="Например: Новые тарифы"></div>
          <div class="field" style="margin-top:10px"><label>Текст уведомления</label><textarea class="input" id="bc-t" rows="4" placeholder="Подробности — текст покажем целиком по клику"></textarea></div>
          <div class="field" style="margin-top:10px"><label>Кому отправить</label>
            <div class="stack" style="gap:2px">${ROLES.map(r=>`<label class="check" style="display:flex;align-items:center;gap:8px"><input type="checkbox" data-bc-role="${r}" ${r==='client'?'checked':''}><span class="box"><svg><use href="#i-check-c"/></svg></span><span class="small">${esc(ROLE_LABEL[r]||r)}</span></label>`).join('')}</div>
          </div>
          <p class="small faint" id="bc-count" style="margin-top:8px"></p>`,
        footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-send>Отправить</button>`,
        onMount:(m2,c2)=>{
          const targets = ()=> noDemo(S.users).filter(x => sel.has(x.role) && x.id !== user().id);
          const upd = ()=>{ const el = m2.querySelector('#bc-count'); if (el) el.textContent = 'Получателей: ' + targets().length + ' (системное уведомление каждому)'; };
          upd();
          m2.querySelectorAll('[data-bc-role]').forEach(cb=>cb.onchange=()=>{
            if (cb.checked) sel.add(cb.dataset.bcRole); else sel.delete(cb.dataset.bcRole);
            upd();
          });
          m2.querySelector('[data-x]').onclick=c2;
          m2.querySelector('[data-send]').onclick=()=>{
            const text = (m2.querySelector('#bc-t').value||'').trim();
            const title = (m2.querySelector('#bc-h').value||'').trim() || 'Массовое сообщение';
            if (!text){ toast('Введите текст','err'); return; }
            const list = targets();
            if (!list.length){ toast('Нет получателей с выбранными ролями','warn'); return; }
            list.forEach(t=>{
              S.notifs.unshift({ id:uid(), icon:'i-bell', title, text, t:Date.now(), read:{}, owner_id:t.id, bc:true });
            });
            saveState();
            logAudit('Массовое сообщение: ' + list.length + ' получателей (' + [...sel].map(r=>ROLE_LABEL[r]||r).join(', ') + ')', 'Рассылка');
            toast('Отправлено ' + list.length + ' получателям','ok');
            c2();
          };
        } });
    };

    /* ---- Поиск по сообщениям (как в ТГ: оверлей под шапкой) ---- */
    const searchPanel = $('#chat-search-panel', root);
    const searchInput = $('#chat-search-input', root);
    const searchRes = $('#chat-search-results', root);
    let searchTimer = null;
    const highlightIn = (txt, q) => {
      if (!txt || !q) return esc(txt||'');
      const i = txt.toLowerCase().indexOf(q.toLowerCase());
      if (i < 0) return esc(txt);
      return esc(txt.slice(0,i)) + '<mark>' + esc(txt.slice(i, i+q.length)) + '</mark>' + esc(txt.slice(i+q.length));
    };
    const runSearch = () => {
      const q = (searchInput.value||'').trim().toLowerCase();
      searchRes.innerHTML = '';
      if (q.length < 2){ searchRes.innerHTML = '<div class="chat-search-empty">Введите минимум 2 символа</div>'; return; }
      /* Сначала чаты, найденные по НАЗВАНИЮ (как в ТГ — отдельный блок сверху) */
      const byName = chatForUser(u).filter(c=>
        (c.name||'').toLowerCase().includes(q) || (c.description||'').toLowerCase().includes(q));
      const found = [];
      chatForUser(u).forEach(c=>{
        noDemo(S.messages).forEach(m=>{
          if (m.chat_id !== c.id) return;
          if (!m.text) return;
          if (!m.text.toLowerCase().includes(q)) return;
          found.push({ chat:c, m });
        });
      });
      if (!byName.length && !found.length){
        searchRes.innerHTML = '<div class="chat-search-empty">Ничего не найдено по запросу «'+esc(q)+'»</div>'; return;
      }
      const shown = found.slice(0, 40);
      const nameHits = byName.slice(0, 8).map(c=>`
        <div class="chat-search-hit chat-search-hit--name" data-chat-id="${c.id}">
          ${avatarHTML({ full_name:c.name, avatar:c.avatar },'avatar--xs')}
          <div class="chat-search-hit__body">
            <div class="t"><b>${highlightIn(c.name, q)}</b><span class="who" style="color:var(--accent)">${icon('chats','ico-sm')}</span></div>
            <div class="p">${esc(c.description||'')}</div>
          </div>
        </div>`).join('');
      const msgHits = shown.map(f=>{
        const author = userById(f.m.user_id);
        const t = new Date(f.m.created_at);
        return `<div class="chat-search-hit" data-msg-id="${f.m.id}" data-chat-id="${f.chat.id}">
          ${avatarHTML({ full_name:f.chat.name },'avatar--xs')}
          <div class="chat-search-hit__body">
            <div class="t"><b>${esc(f.chat.name)}</b><span class="who">${author?'<span style="color:var(--faint)">'+esc(author.full_name)+'</span>':''}</span><time>${fmtTime(t)}</time></div>
            <div class="p">${highlightIn(f.m.text, q)}</div>
          </div>
        </div>`;
      }).join('');
      searchRes.innerHTML = (nameHits ? `<div class="chat-search-cat">Чаты</div>${nameHits}` : '')
        + (msgHits ? `<div class="chat-search-cat">Сообщения</div>${msgHits}` : '')
        + (found.length > shown.length ? `<div class="chat-search-more">И ещё ${found.length - shown.length} сообщений…</div>` : '');
    };
    searchInput.addEventListener('input', ()=>{ clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 160); });
    $('#chat-search-clear', root).onclick = ()=>{ searchInput.value=''; runSearch(); };
    $('#btn-chat-search', root).onclick = ()=>{
      const showing = !searchPanel.classList.contains('closing') && !searchPanel.classList.contains('open');
      if (showing){
        /* Открытие: убрать hidden, включить анимацию вниз */
        searchPanel.hidden = false;
        requestAnimationFrame(()=>{
          searchPanel.classList.remove('closing');
          searchPanel.classList.add('open');
        });
        searchInput.focus(); runSearch();
      } else {
        /* Закрытие: запустить обратную анимацию, убрать из DOM по завершении */
        searchPanel.classList.remove('open');
        searchPanel.classList.add('closing');
        setTimeout(()=>{ searchPanel.classList.remove('closing'); searchPanel.hidden = true; }, 190);
      }
    };
    let searchFlashTimer = null;
    searchRes.addEventListener('click', e=>{
      const hit = e.target.closest('.chat-search-hit');
      if (!hit) return;
      searchPanel.classList.remove('open');
      searchPanel.classList.add('closing');
      setTimeout(()=>{ searchPanel.classList.remove('closing'); searchPanel.hidden = true; }, 190);
      switchChat(hit.dataset.chatId, 'right');
      renderList();
      const msgId = hit.dataset.msgId;
      if (msgId){
        clearTimeout(searchFlashTimer);
        const tryFlash = ()=>{
          const box = root.querySelector('#chat-msgs');
          const el = box && box.querySelector('.msg[data-msg="'+msgId+'"]');
          if (el){
            el.scrollIntoView({ block:'center' });
            el.classList.add('msg--flash');
            searchFlashTimer = setTimeout(()=>el.classList.remove('msg--flash'), 2600);
          } else if (Date.now() < performance.now()+0){}
        };
        /* Сообщение может появиться после перерисовки; пробуем с задержкой */
        setTimeout(tryFlash, 120);
        setTimeout(tryFlash, 400);
      }
    });

    /* ---- Новый чат: поиск людей по всей платформе (написать можно всем) ---- */
    const openNewChat = ()=>{
      const people = noDemo(S.users).filter(x=>x.id !== u.id);
      openWinModal({ narrow:true, title:'Новый чат',
        body:`<div class="field"><input class="input" id="nc-q" placeholder="Имя, роль…" autocomplete="off"></div>
          <div class="pick-list" id="nc-list">${people.map(p=>`
            <div class="pick-item" data-id="${p.id}" role="button" tabindex="0">
              ${avatarHTML(p,'avatar--xs')}
              <div class="pick-item__meta"><b>${esc(p.full_name)}</b><span class="small faint">${esc(ROLE_LABEL[p.role]||p.role)}</span></div>
              <span class="pick-item__go" title="Написать">${icon('chev-r','ico-sm')}</span>
            </div>`).join('')}</div>`,
        onMount:(m2,c2)=>{
          const box = m2.querySelector('#nc-list');
          const q = m2.querySelector('#nc-q');
          const render = ()=>{
            const v = (q.value||'').trim().toLowerCase();
            box.querySelectorAll('.pick-item').forEach(it=>{
              it.style.display = (!v || it.textContent.toLowerCase().includes(v)) ? '' : 'none';
            });
          };
          q.addEventListener('input', render);
          box.addEventListener('click', e=>{
            const it = e.target.closest('.pick-item');
            if (!it) return;
            c2();
            openDirectChat(it.dataset.id);
          });
          q.focus();
        } });
    };
    $('#btn-new-chat', root).onclick = openNewChat;

    /* ---- Новая группа (как в ТГ) ---- */
    const openNewGroup = ()=>{
      const people = noDemo(S.users).filter(x=>x.id !== u.id);
      openWinModal({ narrow:true, title:'Новая группа',
        body:`<div class="field"><label>Название</label><input class="input" id="ng-name" placeholder="Название группы" autocomplete="off"></div>
          <div class="field"><label>Участники (${people.length} на платформе)</label><input class="input" id="ng-q" placeholder="Поиск участников…" autocomplete="off"></div>
          <div class="pick-list pick-list--check" id="ng-list">${people.map(p=>`
            <label class="pick-item pick-item--check" data-id="${p.id}">
              ${avatarHTML(p,'avatar--xs')}
              <div class="pick-item__meta"><b>${esc(p.full_name)}</b><span class="small faint">${esc(ROLE_LABEL[p.role]||p.role)}</span></div>
              <span class="check"><input type="checkbox" data-mem="${p.id}"><span class="box">${icon('check-c')}</span></span>
            </label>`).join('')}</div>`,
        footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-go>Создать группу</button>`,
        onMount:(m2,c2)=>{
          const list = m2.querySelector('#ng-list');
          const q = m2.querySelector('#ng-q');
          const nm = m2.querySelector('#ng-name');
          q.addEventListener('input', ()=>{
            const v = q.value.trim().toLowerCase();
            list.querySelectorAll('.pick-item').forEach(it=>{ it.style.display = (!v || it.textContent.toLowerCase().includes(v)) ? '' : 'none'; });
          });
          m2.querySelector('[data-x]').onclick = c2;
          m2.querySelector('[data-go]').onclick = ()=>{
            const name = (nm.value||'').trim();
            const ids = [...list.querySelectorAll('input[type=checkbox]:checked')].map(i=>i.dataset.mem);
            if (!ids.length){ toast('Выберите хотя бы одного участника','warn'); return; }
            const g = { id:uid(), type:'group', name: name || 'Группа (' + ids.slice(0,2).map(id2=>{const x=userById(id2);return x?x.full_name.split(' ')[0]:'—';}).join(', ') + ')',
              description:'Групповой чат · участников: ' + (ids.length+1),
              member_ids:[u.id, ...ids], participants:[u.id, ...ids], created_at:Date.now(), is_active:true, unread:{} };
            S.chats.push(g);
            saveState();
            logAudit('Создана группа «'+ g.name +'»','Чаты');
            curChat = g.id;
            c2();
            APP.render();
            if (window.__lastRouteName === 'chats' && document.querySelector('.chat-main')){
              const main = document.querySelector('.chat-main');
              main.classList.remove('chat-switch--left','chat-switch--right');
              void main.offsetWidth;
              main.classList.add('chat-switch--left');
              setTimeout(()=>{ const m2=document.querySelector('.chat-main'); if (m2) m2.classList.remove('chat-switch--left','chat-switch--right'); }, 340);
            }
            toast('Группа создана','ok');
          };
          nm.focus();
        } });
    };
    $('#btn-new-group', root).onclick = openNewGroup;

    const bindChatItems = ()=>{
      /* Кнопка «Ко всем чатам» в пустом архиве — возврат к списку всех чатов */
      const archBack = $('#chat-empty-arch-back', root);
      if (archBack){
        archBack.onclick = ()=>{ archMode = false; bindArchFilter && bindArchFilter(); const fa = $('#chat-f-all', root); if (fa) fa.click(); };
      }
      $$('.chat-item', root).forEach(el=>{
        el.onclick = ()=>{
          const prev = curChat;
          const ids = [...document.querySelectorAll('.chat-item')];
          const iPrev = ids.findIndex(x=>x.dataset.ch===prev);
          const iNext = ids.findIndex(x=>x.dataset.ch===el.dataset.ch);
          switchChat(el.dataset.ch, iNext >= iPrev && iPrev !== -1 ? 'right' : 'left');
          renderList();
        };
        el.addEventListener('contextmenu', e=>{
          const ch = S.chats.find(x=>x.id===el.dataset.ch);
          if (!ch) return;
          e.preventDefault(); e.stopPropagation();
          /* Прочитанность по видимому бейджу — всегда совпадает с тем, что видит пользователь */
          const isUnreadChat = !!el.querySelector('.chat-item__unread');
          const sys = isSystemChat(ch);
          const archived = isArchived(ch, u);
          const menu = [
            { label: isUnreadChat ? 'Отметить как прочитанное' : 'Отметить как непрочитанное', icon: isUnreadChat ? 'check-c' : 'bell', onClick:()=>{
                const lastM = S.messages.filter(x=>x.chat_id===ch.id).sort((a,b)=>b.created_at-a.created_at)[0];
                ch.unread = ch.unread || {};
                if (isUnreadChat){
                  ch.unread[u.id] = Date.now();
                  toast('Чат отмечен как прочитанный','ok');
                } else {
                  ch.unread[u.id] = lastM ? lastM.created_at - 1 : Date.now() - 1;
                  if (curChat === ch.id) curChat = null;
                  toast('Чат отмечен как непрочитанный','ok');
                }
                saveState();
                APP.render();
              } },
            { label: ch.pinned ? 'Открепить чат' : 'Закрепить чат', icon:'pin', onClick:()=>{
                const was = ch.pinned;
                ch.pinned = !was; saveState();
                toast(ch.pinned ? 'Чат закреплён' : 'Чат откреплён', 'ok');
                window.__chatPinAnim = was ? 'unpin-anim' : 'pin-anim';
                APP.render();
              } },
            { label: ch.soundOff ? 'Включить уведомления' : 'Выключить уведомления', icon: ch.soundOff ? 'bell' : 'eye-off', onClick:()=>{
                ch.soundOff = !ch.soundOff; saveState();
                toast(ch.soundOff ? 'Уведомления чата выключены' : 'Уведомления чата включены', 'ok');
                APP.render();
              } },
            ...(!sys ? [
              '-',
              { label: archived ? 'Вернуть из архива' : 'В архив', icon:'archive', onClick:()=>{
                  setArchived(ch, u, !archived);
                  toast(archived ? 'Чат возвращён из архива' : 'Чат скрыт в архив','ok');
                  if (!archived && curChat === ch.id) curChat = null;
                  APP.render();
                } },
              { label:'Удалить из списка', icon:'trash', danger:true, onClick:()=>{
                  confirmModal({ title:'Удалить чат из списка?', text:'Чат будет удалён из вашего списка чатов. Это действие необратимо для вас.', okText:'Удалить', danger:true }).then(ok=>{
                    if (ok){
                      const arr = archiveIds(u);
                      if (!arr.includes(ch.id)){
                        /* удаляем: скрываем навсегда через отдельный список удалённых */
                        u.ext = u.ext || {};
                        u.ext.chatRemoved = u.ext.chatRemoved || [];
                        if (!u.ext.chatRemoved.includes(ch.id)) u.ext.chatRemoved.push(ch.id);
                      }
                      if (curChat === ch.id) curChat = null;
                      saveState();
                      APP.render();
                      toast('Чат удалён из списка','ok');
                    }
                  });
                } }
            ] : [])
          ];
          showDropdown(el, menu, { x:e.clientX, y:e.clientY });
        });
      });
    };
    bindChatItems();
    try {
      const pend = window.__pendingChatOpen;
      mobilePane(!(pend && pend.id));
    } catch(e){}
    renderChat();
    /* Открытие чата из глобального поиска: __pendingChatOpen ставится
       функцией openChatAt перед переходом на раздел. */
    if (window.__pendingChatOpen){
      const pc = window.__pendingChatOpen;
      window.__pendingChatOpen = null;
      if (pc.id && S.chats.some(x=>x.id===pc.id)){
        curChat = pc.id;
        chatSel.set.clear(); chatSel.mode = false;
        renderList();
        renderChat();
        if (pc.msgId){
          let tries = 0;
          const flash = ()=>{
            const box = root.querySelector('#chat-msgs');
            const el = box && box.querySelector('.msg[data-msg="'+pc.msgId+'"]');
            if (el){ el.scrollIntoView({ block:'center' }); el.classList.add('msg--flash'); setTimeout(()=>el.classList.remove('msg--flash'), 2600); }
            else if (tries++ < 5) setTimeout(flash, 120);
          };
          setTimeout(flash, 150);
        }
      }
    }
    /* В полноэкранном режиме убираем наложение: заголовок «Чаты» и кнопку рассылки */
    if (document.body.classList.contains('zen')){
      root.classList.add('zen-chats');
    }
  }

  /* ---------- Тикеты ---------- */
  function ticketsView(root){
    const u = user();
    root.innerHTML = `
      <div class="page-head"><div><h2>Тикеты</h2><div class="sub">${noDemo(S.tickets).length} всего · новых: ${noDemo(S.tickets).filter(t=>t.status==='new').length} · в работе: ${noDemo(S.tickets).filter(t=>t.status==='in_progress').length} · решено: ${noDemo(S.tickets).filter(t=>t.status==='resolved').length}</div></div>
          ${u.role==='admin'?`<div class="page-actions"><button class="btn btn--ghost btn--sm" id="tk-exp">${icon('export')} Экспорт CSV</button></div>`:''}</div>
      ${noDemo(S.tickets).map(t=>{
        const author = userById(t.user_id)||{};
        return `<div class="ticket-row" data-t="${t.id}">
          <span class="badge ${({new:'c-red',in_progress:'c-yellow',resolved:'c-green'})[t.status]}"><span class="dot"></span>${({new:'Новое',in_progress:'В работе',resolved:'Решено'})[t.status]}</span>
          <span style="flex:1;min-width:0"><b class="small">#${t.id.slice(0,4).toUpperCase()} · ${esc(t.subject)}</b>
          <div class="cell-sub">${esc(author.full_name||'')}${t.order_id?` · заказ ${esc(t.order_id)}`:''} · ${timeAgo(t.created_at)}</div></span>
          <button class="btn btn--ghost btn--sm" data-next="${t.id}">${t.status==='new'?'Взять в работу':t.status==='in_progress'?'Решить':'Архив'}</button>
        </div>`;
      }).join('') || `<div class="empty">${icon('tickets')}<span>Тикетов нет</span></div>`}`;
    const tkExp = root.querySelector('#tk-exp');
    if (tkExp) tkExp.onclick = ()=>{
      const rows = [['№','Статус','Тема','Сообщение','Автор','Заказ','Создан']];
      noDemo(S.tickets).forEach(t=>{ const a = userById(t.user_id)||{}; rows.push([t.id.slice(0,4).toUpperCase(), {new:'Новое', in_progress:'В работе', resolved:'Решено'}[t.status]||t.status, t.subject, String(t.message||'').replace(/\s+/g,' '), a.full_name||'', t.order_id? (S.orders.find(o=>o.id===t.order_id)||{}).order_id||t.order_id : '', fmtDT(t.created_at)]); });
      const csv = rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\n');
      const aEl = document.createElement('a');
      aEl.href = URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv'})); aEl.download = 'tickets.csv'; aEl.click();
      setTimeout(()=>URL.revokeObjectURL(aEl.href), 4000);
      logAudit('Экспорт тикетов CSV', 'Тикеты'); saveState();
    };
    $$('[data-next]', root).forEach(b=>b.onclick = ()=>{
      const t = S.tickets.find(x=>x.id===b.dataset.next);
      t.status = t.status==='new'?'in_progress':t.status==='in_progress'?'resolved':'resolved';
      if (t.status==='resolved') t.resolved_at = Date.now();
      logAudit(`Тикет: ${t.subject} → ${t.status}`, 'Тикет');
      saveState(); toast('Статус тикета обновлён','ok'); APP.render();
    });
    const openTicket = (t)=>{
      if (!t) return;
      openWinModal({ title:`Тикет · ${t.subject}`, narrow:true, route:'tickets',
        body:`<p class="small" style="color:var(--text-2)">${nl2br(t.message)}</p><p class="small faint" style="margin-top:10px">От: ${esc((userById(t.user_id)||{}).full_name)} ${t.order_id?'· заказ '+t.order_id:''} · ${fmtDT(t.created_at)}</p>`,
        footer:`<button class="btn btn--primary" data-x>Закрыть</button>`,
        onMount:(m2,c2)=>m2.querySelector('[data-x]').onclick=c2 });
    };
    $$('.ticket-row', root).forEach(r=>{
      const open = e=>{ if (e.target.closest('button')) return; openTicket(S.tickets.find(x=>x.id===r.dataset.t)); };
      r.onclick = open;
      /* Двойной клик по строке — та же модалка (единое правило) */
      r.addEventListener('dblclick', open);
    });
  }

  /* ---------- Идеи ---------- */
  function ideasView(root){
    const u = user();
    const visGroup = isStaff(u.role) ? 'all' : u.role;
    let filter = 'all';
    const render = ()=>{
      const list = noDemo(S.ideas).filter(i=>{
        if (i.status==='deleted') return false;
        if (isStaff(u.role)) return true;
        if (i.status==='hidden') return false;
        return ['all', visGroup].includes(i.visibility);
      }).sort((a,b)=>b.likes-a.likes);
      const shown = filter==='all' ? list : list.filter(i=>i.visibility===filter || (isStaff(u.role)&&filter==='all'));
      root.innerHTML = `
        <div class="page-head"><div><h2>Идеи улучшений</h2><div class="sub">${noDemo(S.ideas).length} всего · активных: ${noDemo(S.ideas).filter(i=>i.status!=='hidden').length} · скрытых: ${noDemo(S.ideas).filter(i=>i.status==='hidden').length}</div></div>
          <div class="page-actions">${u.role==='admin'?`<button class="btn btn--ghost btn--sm" id="idea-exp">${icon('export')} Экспорт CSV</button>`:''}<button class="btn btn--primary" id="idea-new">${icon('bulb')} Предложить идею</button></div></div>
        <div class="filters">${['all','executors','clients'].map(f=>`<span class="chip ${filter===f?'on':''}" data-f="${f}">${({all:'Все',executors:'От исполнителей',clients:'От клиентов'})[f]}</span>`).join('')}</div>
        <div class="cols-2 grid">
          ${shown.map(i=>{
            const author = userById(i.user_id)||{};
            const liked = (i.likedBy||[]).includes(u.id);
            const top = i === list[0] && i.likes >= 5;
            return `<div class="idea-card ${top?'idea-card--top':''} ${i.status==='hidden'?'bl':''}" data-idea="${i.id}" style="${i.status==='hidden'?'opacity:.55':''}">
              ${top?`<span class="badge c-accent idea-top-badge">🔥 топ идея</span>`:''}
              <div class="row" style="gap:10px">${avatarHTML(author,'avatar--sm')}<b class="small" style="flex:1;min-width:0">${esc(i.title)}</b>${i.rewarded?'<span class="badge c-green">награждена</span>':''}</div>
              <p class="small" style="color:var(--text-2)">${esc(i.description)}</p>
              <div class="row" style="margin-top:2px">
                <button class="idea-like ${liked?'on':''}" data-like="${i.id}">${icon('heart')} ${i.likes}</button>
                <span class="small faint">${esc(author.full_name)} · ${timeAgo(i.created_at)}</span>
                <span class="spacer"></span>
                ${isStaff(u.role)?`<button class="iconbtn" data-mod="${i.id}" style="width:30px;height:30px">${icon('more')}</button>`:''}
              </div>
            </div>`;
          }).join('') || `<div class="empty" style="grid-column:1/-1">${icon('bulb')}<span>Идей пока нет</span></div>`}
        </div>`;
      $$('.idea-card[data-idea]', root).forEach(card=>{
        card.addEventListener('dblclick', ev=>{
          if (ev.target.closest('button,a,input,textarea,select')) return;
          const it = S.ideas.find(x=>x.id === card.dataset.idea);
          if (!it) return;
          const a2 = userById(it.user_id) || {};
          openWinModal({ narrow:true, title:'Идея', route:'ideas',
            body:`<div class="stack" style="gap:10px"><b>${esc(it.title)}</b><p class="small" style="white-space:pre-wrap;color:var(--text-2)">${esc(it.description||'')}</p><p class="small faint">${esc(a2.full_name||'')} · ${fmtDT(it.created_at)} · голосов: ${it.likes||0} · ${({all:'Все',executors:'Исполнители',clients:'Клиенты'})[it.visibility]||it.visibility}</p></div>`,
            footer:`<button class="btn btn--primary" data-x>Закрыть</button>`,
            onMount:(m2,c2)=>m2.querySelector('[data-x]').onclick=c2 });
        });
      });
      $('#idea-new', root).onclick = ()=>openWinModal({ narrow:true, title:'Новая идея',
        body:`<div class="stack" style="gap:12px"><div class="field"><label>Заголовок</label><input class="input" id="i-t" placeholder="Коротко о главном"></div>
          <div class="field"><label>Описание</label><textarea class="input" id="i-d" placeholder="Что улучшить и как это поможет"></textarea></div></div>`,
        footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-send>Опубликовать</button>`,
        onMount:(m2,c2)=>{ m2.querySelector('[data-x]').onclick=c2;
          m2.querySelector('[data-send]').onclick=()=>{
            const t = m2.querySelector('#i-t').value.trim(); if (!t){ toast('Добавьте заголовок','err'); return; }
            S.ideas.unshift({ id:uid(), user_id:u.id, title:t, description:m2.querySelector('#i-d').value, likes:0, likedBy:[], visibility:isStaff(u.role)?'all':u.role, status:'active', rewarded:false, created_at:Date.now() });
            logAudit('Новая идея: '+t, 'Идеи'); saveState(); toast('Идея опубликована — спасибо!','ok'); c2(); APP.render();
          }; } });
    const ideaExp = root.querySelector('#idea-exp'); ideaExp && (ideaExp.onclick = ()=>{
      const rows = [['Заголовок','Описание','Автор','Голоса','Видимость','Статус','Дата']];
      [...noDemo(S.ideas)].filter(i=>i.status!=='deleted').sort((a,b)=>b.likes-a.likes).forEach(i=>{
        const a = userById(i.user_id)||{};
        rows.push([i.title, String(i.description||'').replace(/\s+/g,' '), a.full_name||'', i.likes, {all:'Все', executors:'Исполнители', clients:'Клиенты'}[i.visibility]||i.visibility, i.status==='hidden'?'Скрыта':'Активна', fmtDT(i.created_at)]);
      });
      const csv = rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\n');
      const aEl = document.createElement('a');
      aEl.href = URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv'})); aEl.download = 'ideas.csv'; aEl.click();
      setTimeout(()=>URL.revokeObjectURL(aEl.href), 4000);
      logAudit('Экспорт идей CSV', 'Идеи'); saveState();
    });
      $$('[data-like]', root).forEach(b=>b.onclick = ()=>{
        const i = S.ideas.find(x=>x.id===b.dataset.like);
        i.likedBy = i.likedBy||[];
        const p = i.likedBy.indexOf(u.id);
        if (p>=0){ i.likedBy.splice(p,1); i.likes--; } else { i.likedBy.push(u.id); i.likes++; }
        saveState(); render();
      });
      $$('[data-f]', root).forEach(ch=>ch.onclick=()=>{ filter=ch.dataset.f; render(); });
      $$('[data-mod]', root).forEach(b=>b.onclick = e=>showDropdown(e.currentTarget, [
        { label:'Скрыть', icon:'eye-off', onClick:()=>{ const i=S.ideas.find(x=>x.id===b.dataset.mod); i.status = i.status==='hidden'?'active':'hidden'; saveState(); render(); } },
        { label:'Удалить', icon:'trash', danger:true, onClick:()=>{ S.ideas = S.ideas.filter(x=>x.id!==b.dataset.mod); saveState(); render(); } }
      ]));
    };
    render();
  }

  /* ---------- Ниши (админ) ---------- */
  function nichesView(root){
    const render = ()=>{
      root.innerHTML = `
        <div class="page-head"><div><h2>Ниши и специализации</h2><div class="sub">Основа расширения платформы на любые услуги</div></div>
          <button class="btn btn--primary" id="niche-add">${icon('plus')} Новая ниша</button></div>
        <div class="cols-3 grid">
          ${S.niches.map(n=>`<div class="card"><div class="card-h"><h3>${esc(n.name)}</h3>
            <div class="row" style="gap:4px"><button class="iconbtn" style="width:30px;height:30px" data-del="${n.id}">${icon('trash')}</button></div></div>
            <div class="card-b stack" style="gap:6px">
              <p class="small faint">${esc(n.description||'')}</p>
              ${S.specializations.filter(s=>s.nish_id===n.id).map(s=>`<div class="row row--between list-row" style="padding:6px 8px"><span class="small">${esc(s.name)}</span><button class="iconbtn" style="width:26px;height:26px" data-delspec="${s.id}">${icon('x','ico-sm')}</button></div>`).join('')}
              <button class="btn btn--ghost btn--sm btn--block" data-addspec="${n.id}">${icon('plus')} Специализация</button>
            </div></div>`).join('')}
        </div>`;
      $('#niche-add', root).onclick = ()=>{
        openWinModal({ narrow:true, title:'Новая ниша',
          body:`<div class="field"><label>Название *</label><input class="input" id="niche-name"></div>`,
          footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-n-save>Добавить</button>`,
          onMount:(m2,close)=>{
            m2.querySelector('[data-x]').onclick = close;
            m2.querySelector('[data-n-save]').onclick = ()=>{
              const name = m2.querySelector('#niche-name').value.trim();
              if (!name){ toast('Введите название','warn'); return; }
              S.niches.push({ id:uid(), name, description:'' });
              logAudit(`Создана ниша: ${name}`,'Ниши'); saveState(); close(); render(); toast('Ниша добавлена','ok');
            };
          } });
      };
      $$('[data-addspec]', root).forEach(b=>b.onclick = ()=>{
        openWinModal({ narrow:true, title:'Новая специализация',
          body:`<div class="field"><label>Название *</label><input class="input" id="sp-name" placeholder="Например: Субтитры"></div>`,
          footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-sp-save>Добавить</button>`,
          onMount:(m2,close)=>{
            m2.querySelector('[data-x]').onclick = close;
            m2.querySelector('[data-sp-save]').onclick = ()=>{
              const name = m2.querySelector('#sp-name').value.trim();
              if (!name){ toast('Введите название','warn'); return; }
              S.specializations.push({ id:uid(), nish_id:b.dataset.addspec, name });
              logAudit(`Создана специализация: ${name}`,'Ниши'); saveState(); close(); render(); toast('Специализация добавлена','ok');
            };
          } });
      });
      $$('[data-delspec]', root).forEach(b=>b.onclick = ()=>{ S.specializations = S.specializations.filter(s=>s.id!==b.dataset.delspec); saveState(); render(); });
      $$('[data-del]', root).forEach(b=>b.onclick = async ()=>{
        const n = S.niches.find(x=>x.id===b.dataset.del);
        const ok = await confirmModal({ title:`Удалить нишу «${n.name}»?`, danger:true, okText:'Удалить', text:`Все связанные специализации (${S.specializations.filter(s=>s.nish_id===n.id).length}) будут удалены каскадом.` });
        if (ok){ S.specializations = S.specializations.filter(s=>s.nish_id!==n.id); S.niches = S.niches.filter(x=>x.id!==n.id); saveState(); render(); toast('Ниша удалена','ok'); }
      });
    };
    render();
  }

  /* ---------- Аудит (админ) ---------- */
  function auditView(root){
    let fUser = '', fQ = '';
    const render = ()=>{
      const list = noDemo(S.audit).filter(a=>{
        if (fUser && a.user!==fUser) return false;
        if (fQ && !norm(a.action+a.entity).includes(norm(fQ))) return false;
        return true;
      });
      const users = Array.from(new Set(noDemo(S.audit).map(a=>a.user)));
      root.innerHTML = `
        <div class="page-head"><div><h2>Журнал аудита</h2><div class="sub">IP, действия и сущности · автоматический анализ аномалий</div></div>
          <button class="btn btn--ghost" id="al-exp">${icon('export')} Экспорт CSV</button></div>
        <div class="filters">
          <div class="input-wrap">${icon('search')}<input class="input" id="al-q" placeholder="Команда или действие…" value="${esc(fQ)}"></div>
          <select class="input" id="al-user"><option value="">Все пользователи</option>${users.map(us=>`<option ${fUser===us?'selected':''}>${esc(us)}</option>`).join('')}</select>
        </div>
        <div class="tbl-wrap card"><table class="tbl">
          <thead><tr><th>Время</th><th>Пользователь</th><th>Действие</th><th>Сущность</th><th>IP</th></tr></thead>
          <tbody>${list.slice(0,60).map(a=>`<tr>
            <td class="small faint" style="white-space:nowrap">${fmtDT(a.t)}</td>
            <td class="small">${esc(a.user)}</td>
            <td class="small">${esc(a.action)}</td>
            <td><span class="badge badge--outline">${esc(a.entity)}</span></td>
            <td class="small mono">${esc(a.ip)}</td></tr>`).join('')}</tbody></table></div>
        <p class="small faint" style="margin-top:8px">${icon('shield','ico-sm')} Аномалии (частые смены IP, массовые действия, нехарактерное время) создают алерт администратору автоматически.</p>`;
      const q = $('#al-q', root);
      q.oninput = ()=>liveSearch(()=>{ fQ=q.value; render(); });
      $('#al-user', root).onchange = e=>{ fUser=e.target.value; render(); };
      $('#al-exp', root).onclick = ()=>{
        const csv = 'Время;Пользователь;Действие;Сущность;IP\n'+S.audit.map(a=>[fmtDT(a.t),a.user,a.action,a.entity,a.ip].join(';')).join('\n');
        const aEl = document.createElement('a');
        aEl.href = URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv'})); aEl.download='audit-log.csv'; aEl.click();
      };
    };
    render();
  }

  /* ---------- Настройки ---------- */
  let settingsSection = '';
  /* Телефон: настройки — список разделов, выбранный открывается экраном с «Назад» */
  const isMobileSettings = () => !!(window.matchMedia && window.matchMedia('(max-width: 860px)').matches);

  /* ---------- Выплаты и платёжные провайдеры ---------- */
  function scStateBadge(st){
    const map = { approved:['badge--ok','Подтверждён'], pending:['badge--warn','Ждёт подтверждения'], rejected:['badge--err','Отклонён'], none:['badge--outline','Не привязан'] };
    const [cls,label] = map[st] || map.none;
    return `<span class="badge ${cls}">${label}</span>`;
  }
  function payoutProvider(){ return Object.assign({ key:'smartcat', name:'Smartcat', commission:5, enabled:true }, ((S.settings.integrations||{}).payout||{})); }
  function payoutsHTML(){
    const u = me();
    const staff = ['admin','top_manager','manager'].includes(u.role);
    const p = Finance.payoutCfg();
    const cfg = Finance.cfg();
    const prov = payoutProvider();
    const provName = esc(prov.name || 'Smartcat');
    const pend = Finance.pending();
    const skip = Finance.skipInfo();
    const nextCutTs = Finance.nextCut();
    const fmtCut = ts => new Date(ts).toLocaleString('ru-RU', { day:'numeric', month:'long', hour:'2-digit', minute:'2-digit', timeZone:'Europe/Moscow' }) + ' МСК';
    const myId = u.id;
    const rows = Object.entries(pend.byUser).map(([uid, amount]) => {
      const usr = userById(uid) || { full_name:uid };
      const sc = Finance.scOf(uid);
      return `<div class="row row--between" style="padding:6px 0;border-bottom:1px solid var(--border)">
        <span class="small"><b>${esc(usr.full_name)}</b> · ${esc(usr.role==='executor'?'исполнитель':usr.role==='manager'||usr.role==='top_manager'?'менеджер':'админ')}
          <span class="faint">${sc.status==='approved'?'· '+provName+' '+esc(sc.login||'—'):'· '+provName+' не привязан'}</span></span>
        <b class="small" style="white-space:nowrap">${fmtMoney(amount)}</b>
      </div>`;
    }).join('') || '<p class="small faint">В текущем периоде долгов нет.</p>';
    const allOrders = Finance.payoutOrders();
    const exclSet = new Set(Finance.excludedIds());
    const list = allOrders.map(o => {
      const d = Finance.debts(o);
      const names = Object.keys(d.byUser).map(uid => (userById(uid)||{}).full_name).filter(Boolean).join(', ');
      const off = exclSet.has(o.order_id);
      return `<div class="row row--between" style="padding:5px 0;gap:8px;${off?'opacity:.55':''}">
        <span class="small" style="min-width:0">${esc(o.order_id)} · ${esc(names)}${off?' · <span class="faint">не в выплате</span>':''}</span>
        <span class="row" style="gap:8px;flex:none"><b class="small" style="white-space:nowrap">${fmtMoney(d.total)}</b>
          <button class="btn btn--sm ${off?'btn--soft':'btn--ghost'}" data-po-exc="${esc(o.order_id)}" data-back="${off?1:0}">${off?'Вернуть':'Убрать'}</button></span>
      </div>`;
    }).join('') || '<p class="small faint">Нет выполненных заказов с неоплаченными долями.</p>';

    const scRows = (S.users||[]).filter(x => x.ext && ['executor','manager','top_manager'].includes(x.role) && (staff || x.id===myId)).map(x => {
      const sc = Finance.scOf(x.id);
      return `<div class="row row--between" data-sc-row="${esc(x.full_name+' '+(sc.login||''))}" style="padding:6px 0;border-bottom:1px solid var(--border);gap:8px">
        <span class="small" style="min-width:0">${esc(x.full_name)} ${scStateBadge(sc.status)}<br><span class="faint">${esc(sc.login||'логин не указан')}</span></span>
        <span class="row" style="gap:6px;flex:none">
          ${staff && sc.status==='pending'?`<button class="btn btn--sm btn--primary" data-sc-ok="${x.id}">Подтвердить</button><button class="btn btn--sm btn--ghost" data-sc-no="${x.id}">Отклонить</button>`:''}
          ${staff && sc.status!=='approved'?`<button class="btn btn--sm btn--soft" data-sc-req="${x.id}">${sc.login?'Запросить заново':'Прикрепить'}</button>`:''}
          ${x.id===myId && sc.status!=='approved'?`<button class="btn btn--sm btn--soft" data-sc-req="${x.id}">Привязать свой аккаунт</button>`:''}
        </span>
      </div>`;
    }).join('');

    const myDebt = (() => {
      const mine = [];
      (S.orders||[]).forEach(o => { const d = Finance.debts(o); if (d.byUser[myId]) mine.push({o, amount:d.byUser[myId]}); });
      return mine.reduce((a,x)=>a+x.amount,0);
    })();

    return `
    <div class="card card-pad">
      <h3 style="margin-bottom:6px">Выплаты</h3>
      <p class="small faint">По умолчанию — 1-го и 15-го числа в 15:00 МСК. В выплату попадают <b>все выполненные заказы с неоплаченными долями</b> — в том числе завершённые вне текущего периода. Любой заказ можно убрать из выплаты вручную и вернуть обратно.</p>
      <div class="row row--between" style="margin-top:10px;gap:10px;flex-wrap:wrap">
        <span class="badge ${p.enabled?'badge--ok':'badge--outline'}">${p.enabled?'Расписание включено':'Расписание выключено'}</span>
        <span class="badge badge--outline">${esc(Finance.fmtPeriod(pend.period))}</span>
      </div>
      <p class="small" style="margin-top:8px">Ближайшая выплата по расписанию: <b>${fmtCut(nextCutTs)}</b>${skip?` · <span class="badge badge--warn">разово отменена</span>`:''}</p>
    </div>

    ${staff?`<div class="card card-pad">
      <h3 style="margin-bottom:10px">Расписание</h3>
      <div class="cols-2 grid" style="gap:12px">
        <div class="field"><label>Дни месяца</label><input class="input" id="po-days" value="${p.days.join(', ')}" placeholder="1, 15"></div>
        <div class="field"><label>Время (МСК)</label><input class="input" id="po-time" type="time" value="${esc(p.time)}"></div>
        <div class="field"><label>Маржа админа, %</label><input class="input" id="po-admin" type="number" min="0" max="100" step="1" value="${cfg.adminMargin}"></div>
        <div class="field"><label>Доля менеджера, %</label><input class="input" id="po-mgr" type="number" min="0" max="100" step="1" value="${cfg.managerFee}"></div>
        <div class="field"><label>Мин. сумма заказа, ₽</label><input class="input" id="po-min-total" type="number" min="0" step="50" value="${cfg.minOrderTotal}"></div>
        <div class="field"><label>Мин. оплата исполнителя, ₽</label><input class="input" id="po-min-exec" type="number" min="0" step="10" value="${cfg.minExecutorPay}"></div>
        <div class="field"><label>Автоматически</label><label class="row small" style="gap:8px;padding-top:9px"><input type="checkbox" id="po-auto" ${p.auto?'checked':''}> по расписанию</label>
          <label class="row small" style="gap:8px"><input type="checkbox" id="po-on" ${p.enabled?'checked':''}> выплаты включены</label></div>
      </div>
      <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn btn--primary btn--sm" id="po-save">Сохранить расписание</button>
        <button class="btn btn--soft btn--sm" id="po-run">Выплатить сейчас</button>
        ${p.enabled&&p.auto?`<button class="btn btn--ghost btn--sm" id="po-skip">${skip?'Вернуть выплату':'Отменить разово'}</button>`:''}
        <button class="btn btn--ghost btn--sm" id="po-export">Экспорт для ${provName}</button>
      </div>
    </div>`:''}

    <div class="card card-pad">
      <h3 style="margin-bottom:8px">К выплате ${staff?'сейчас':''}</h3>
      <div class="row row--between" style="margin-bottom:8px"><span class="small faint">Итого</span><b>${fmtMoney(pend.total)}</b></div>
      <div class="row row--between" style="margin-bottom:10px"><span class="small faint">Сборы провайдера (ориентир) / на руки</span><b class="small">${fmtMoney(pend.commission)} / ${fmtMoney(pend.net)}</b></div>
      ${staff?rows:''}
      ${staff?`<h4 class="small" style="margin:12px 0 4px">Заказы к выплате${pend.excluded?' · убрано вручную: '+pend.excluded:''}</h4>${list}`:''}
      ${!staff?`<p class="small">Ваш долг по выполненным заказам: <b>${fmtMoney(myDebt)}</b></p><p class="small faint">Выплата приходит на привязанный аккаунт ${provName} или вне системы — по договорённости с менеджером. ${provName} не берёт комиссию с заработка: удерживаются только транзакционные сборы банка/платёжной системы — их размер зависит от страны и способа выплаты, проверяйте на <a href="https://help.smartcat.com/understanding-freelancer-fees-in-smartcat" target="_blank" rel="noopener">официальной странице</a>.</p>`:''}
    </div>

    <div class="card card-pad">
      <h3 style="margin-bottom:8px">${provName}</h3>
      <p class="small faint">Аккаунт прикрепляет админ или менеджер, либо исполнитель сам — с подтверждением менеджера или админа.</p>
      <input class="input" id="sc-q" placeholder="Поиск по имени или логину" style="margin:8px 0">
      <div class="sc-list" id="sc-list">${scRows}</div>
      <button class="btn btn--ghost btn--sm" id="sc-more" style="margin-top:8px">Показать ещё</button>
    </div>`;
  }
  function bindPayouts(el){
    const p = Finance.payoutCfg();
    el.querySelectorAll('[data-po-exc]').forEach(b => b.onclick = ()=>{
      const id = b.dataset.poExc, back = b.dataset.back === '1';
      Finance.setExcluded(id, !back);
      toast(back ? `${id} возвращён в выплату` : `${id} убран из выплаты`, 'info');
      APP.render();
    });
    const save = el.querySelector('#po-save');
    if (save) save.onclick = ()=>{
      const days = String((el.querySelector('#po-days')||{}).value||'').split(/[^0-9]+/).map(Number).filter(d=>d>=1&&d<=28);
      const time = ((el.querySelector('#po-time')||{}).value||'15:00').trim() || '15:00';
      /* cfg в этом обработчике нет: комиссия — ориентир провайдера, здесь не сохраняется */
      const adm = Math.max(0, Math.min(100, Number((el.querySelector('#po-admin')||{}).value)||0));
      const mgr = Math.max(0, Math.min(100, Number((el.querySelector('#po-mgr')||{}).value)||0));
      const minTotal = Math.max(0, Math.round(Number((el.querySelector('#po-min-total')||{}).value) || 0));
      const minExec = Math.max(0, Math.round(Number((el.querySelector('#po-min-exec')||{}).value) || 0));
      S.settings.finance = Object.assign({}, S.settings.finance, { adminMargin:adm, managerFee:mgr, minOrderTotal:minTotal, minExecutorPay:minExec });
      S.settings.payout = Object.assign({}, p, {
        enabled: !!((el.querySelector('#po-on')||{}).checked),
        auto: !!((el.querySelector('#po-auto')||{}).checked),
        days: days.length?days:p.days, time
      });
      saveState(); toast('Расписание выплат сохранено','ok');
      try { logAudit('Настройка выплат: дни '+S.settings.payout.days.join(',')+' в '+time+' МСК','Оплата'); } catch(e){}
      APP.render();
    };
    const skipBtn = el.querySelector('#po-skip');
    if (skipBtn) skipBtn.onclick = ()=>{
      const on = !Finance.skipInfo();
      const s = Finance.skipNextPayout(on);
      const when = s ? new Date(s.at).toLocaleString('ru-RU', { day:'numeric', month:'long', hour:'2-digit', minute:'2-digit', timeZone:'Europe/Moscow' }) + ' МСК' : '';
      toast(on ? `Выплата ${when} отменена разово` : 'Разовая отмена снята — выплата снова в расписании', 'info');
      try { logAudit(on ? 'Разовая отмена выплаты по расписанию' : 'Разовая отмена выплаты снята', 'Оплата'); } catch(e){}
      APP.render();
    };
    const run = el.querySelector('#po-run');
    if (run) run.onclick = async ()=>{
      const pend = Finance.pending();
      if (!pend.orders.length){ toast('В этом периоде нет неоплаченных выполненных заказов','info'); return; }
      const ok = await confirmModal({
        title:'Выплатить сейчас?', okText:'Выплатить '+fmtMoney(pend.total),
        text:`Будет закрыто ${pend.orders.length} заказов. Исполнителям и менеджерам — ${fmtMoney(pend.total)}, комиссия ${provName} ${cfgCom()}% (индивидуальна): ${fmtMoney(pend.commission)}. На руки — ${fmtMoney(pend.net)}.`,
        checkbox:'Проверил суммы и получателей'
      });
      if (!ok) return;
      const r = Finance.runPayout({ manual:true });
      if (r.ok){ toast(`Выплата ${fmtMoney(r.total)} проведена`,'ok'); APP.render(); }
      else toast(r.why,'warn');
    };
    function cfgCom(){ return Finance.cfg().commission; }
    const exp = el.querySelector('#po-export');
    if (exp) exp.onclick = ()=>{
      const pend = Finance.pending();
      const uids = Object.keys(pend.byUser);
      if (!uids.length){ toast('Нет данных для экспорта','info'); return; }
      const payloads = uids.map(uid => Finance.smartcatPayload(uid, pend.orders.filter(o => Finance.debts(o).byUser[uid])));
      const data = { schema:'smartcat.payout.batch.v1', generatedAt:new Date().toISOString(), period:{ from:new Date(pend.period.from).toISOString(), to:new Date(pend.period.to).toISOString() }, payouts: payloads, totals:{ amount:pend.total, commission:pend.commission, net:pend.net } };
      const a=document.createElement('a');
      a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
      a.download='smartcat-payout-'+new Date().toISOString().slice(0,10)+'.json'; a.click();
    };
    /* Список аккаунтов: постранично, чтобы не рендерить сотни строк сразу */
    const scPage = 8; let scShown = scPage;
    const scRowsAll = ()=> [...el.querySelectorAll('#sc-list [data-sc-row]')];
    const scApply = ()=>{
      const q = (el.querySelector('#sc-q')?.value || '').trim().toLowerCase();
      let visible = 0;
      scRowsAll().forEach(r=>{
        const match = !q || r.dataset.scRow.toLowerCase().includes(q);
        if (!match){ r.hidden = true; return; }
        visible++;
        r.hidden = visible > scShown;
      });
      const more = el.querySelector('#sc-more');
      if (more){ const total = scRowsAll().filter(r=>!q || r.dataset.scRow.toLowerCase().includes(q)).length; more.hidden = total <= scShown; }
    };
    const scq = el.querySelector('#sc-q');
    if (scq) scq.oninput = ()=>{ scShown = scPage; scApply(); };
    const scMore = el.querySelector('#sc-more');
    if (scMore) scMore.onclick = ()=>{ scShown += scPage; scApply(); };
    scApply();
    el.querySelectorAll('[data-sc-ok]').forEach(b=>b.onclick=()=>{ Finance.approveSmartcat(b.dataset.scOk); toast('Аккаунт подтверждён','ok'); APP.render(); });
    el.querySelectorAll('[data-sc-no]').forEach(b=>b.onclick=()=>{ Finance.rejectSmartcat(b.dataset.scNo); toast('Запрос отклонён','warn'); APP.render(); });
    el.querySelectorAll('[data-sc-req]').forEach(b=>b.onclick=()=>{
      const uid=b.dataset.scReq; const usr=userById(uid); if(!usr) return;
      const cur=Finance.scOf(uid);
      const pname = payoutProvider().name || 'платёжный сервис';
      openWinModal({ title:'Привязка аккаунта', narrow:true, icon:'card',
        body:`<p class="small">Логин в ${esc(pname)} для <b>${esc(usr.full_name)}</b>. Запрос уйдёт на подтверждение.</p>
          <div class="field" style="margin-top:10px"><label>Логин</label><input class="input" id="sc-login" value="${esc(cur.login||'')}" autocomplete="off"></div>`,
        footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-send>Отправить запрос</button>`,
        onMount:(mm,cl)=>{
          mm.querySelector('[data-x]').onclick = cl;
          const inp = mm.querySelector('#sc-login'); if (inp) setTimeout(()=>inp.focus(), 60);
          mm.querySelector('[data-send]').onclick = ()=>{
            const login=(inp.value||'').trim();
            if(!login){ toast('Укажите логин','warn'); inp.focus(); return; }
            Finance.requestSmartcat(uid, login);
            toast('Запрос на привязку отправлен на подтверждение','ok');
            cl(); APP.render();
          };
        } });
    });
  }
  function settingsView(root, section){
    const u = user();
    /* Раздел пришёл из маршрута (#/settings/profile) или это вход в настройки */
    const fromRoute = !!section;
    section = section || settingsSection || 'profile';
    const sections = [
      ['profile','Профиль','clients'], ['look','Внешний вид','palette'], ['notify','Уведомления и рассылки','bell'],
      ['reminders','Напоминания','clock'],
      ['security','Безопасность','shield'], ['keys','Горячие клавиши','terminal'],
      ['docs','Справка и документы','file'],
      ...(['admin','top_manager','manager','executor'].includes(u.role)?[['payouts','Выплаты и оплата','card']]:[]),
      ...(u.role==='admin'?[['calc','Калькулятор и услуги','calc']]:[]),
      ...(u.role==='admin'?[['tech','Технические работы','alert']]:[]),
      ...(u.role==='admin'?[['product','Демо-режим и версии','flag'],['data','Данные и бекапы','db']]:[]),
      /* «О приложении» — всегда последний пункт, у всех ролей */
      ['about','О приложении','info']
    ];
    /* Защита: если запрошенная секция недоступна текущей роли (её нет в
       списке), принудительно показываем профиль. Закрывает утечку, когда
       админская вкладка «пережила» выход и вход менее привилегированным
       пользователем. */
    if (!sections.some(s=>s[0]===section)) section = 'profile';
    if (settingsSection !== section) settingsSection = section;
    /* Роли для доступа к документам — все роли системы (клиенты и исполнители тоже) */
    const ALL_DOC_ROLES = [
      { id:'admin',       label:'Админ' },
      { id:'top_manager', label:'Топ-менеджер' },
      { id:'manager',     label:'Менеджер' },
      { id:'executor',    label:'Исполнитель' },
      { id:'client',      label:'Клиент' }
    ];
    const docRolesLabel = d => (!d.roles || !d.roles.length)
      ? 'Все'
      : ALL_DOC_ROLES.filter(r => d.roles.includes(r.id)).map(r => r.label).join(', ');
    const renderSec = ()=>{
      const el = root.querySelector('#set-body');
      if (section==='profile') el.innerHTML = profileHTML(u);
      if (section==='look') el.innerHTML = lookHTML(u);
      if (section==='notify') el.innerHTML = notifyHTML(u);
      if (section==='reminders') el.innerHTML = todosHTML(u) + remindersHTML(u);
      if (section==='security') el.innerHTML = securityHTML(u);
      if (section==='keys') el.innerHTML = keysHTML();
      if (section==='docs') el.innerHTML = docsHTML();
      if (section==='about') el.innerHTML = aboutSectionHTML();
      if (section==='calc') el.innerHTML = calcHTML();
      if (section==='data') el.innerHTML = dataHTML();
      if (section==='product') el.innerHTML = productHTML();
      if (section==='tech') el.innerHTML = techHTML();
      if (section==='payouts') el.innerHTML = payoutsHTML();
      /* Плавное появление секции — ДО биндинга, чтобы анимация всегда играла */
      el.classList.remove('set-sec-in'); void el.offsetWidth; el.classList.add('set-sec-in');
      if (section==='calc') bindCalc(el); else if (section==='product') bindProduct(el); else if (section==='tech') bindTech(el);
      else if (section==='payouts') bindPayouts(el);
      else bindSection(section, el);
    };
    root.innerHTML = `
      <div class="page-head"><div><h2>${__t('settings.title','Настройки')}</h2><div class="sub">${__t('settings.subtitle','Профиль, внешний вид, безопасность и документы')}</div></div></div>
      <div class="settings-grid${isMobileSettings() && fromRoute ? ' set-detail' : ''}">
        <div class="settings-nav card card-pad" style="padding:8px">
          ${sections.map(([id,label,ic])=>`<button class="side__link ${section===id?'on':''}" data-sec="${id}" style="width:100%">${icon(ic)}<span>${label}</span></button>`).join('')}
        </div>
        <div class="set-main">
          <button class="btn btn--ghost btn--sm set-back" type="button" data-set-back ${isMobileSettings() && fromRoute ? '' : 'hidden'}>${icon('chev-r','ico-sm')} Настройки</button>
          <div id="set-body" class="stack"></div>
        </div>
      </div>`;
    /* Телефон: список разделов ↔ экран раздела, с плавным переходом */
    const mobileState = (detail, animate)=>{
      const grid = root.querySelector('.settings-grid');
      if (!grid) return;
      grid.classList.toggle('set-detail', !!detail);
      const back = root.querySelector('[data-set-back]');
      if (back) back.hidden = !detail;
      if (animate){
        const target = detail ? root.querySelector('.set-main') : root.querySelector('.settings-nav');
        if (target){ target.classList.remove('set-in'); void target.offsetWidth; target.classList.add('set-in'); }
      }
    };
    const backBtn = root.querySelector('[data-set-back]');
    /* Телефон: при «Назад» список разделов встаёт туда, где его оставили.
       scrollIntoView уводил его на самый верх — под липкую шапку, и бургер
       закрывал первый пункт. */
    let navScroll = 0;
    if (backBtn) backBtn.onclick = ()=>{
      mobileState(false, true);
      const nav = root.querySelector('.settings-nav');
      if (!nav || !isMobileSettings()) return;
      const headEl = document.querySelector('.head');
      const headH = headEl ? Math.round(headEl.getBoundingClientRect().height) : 60;
      /* Ниже этого порога прокручивать нельзя: список окажется под шапкой */
      const floor = Math.max(0, Math.round(nav.getBoundingClientRect().top + window.scrollY - headH - 10));
      const y = Math.max(floor, navScroll);
      try { window.scrollTo({ top: y, behavior:'smooth' }); }
      catch(e){ window.scrollTo(0, y); }
    };
    $$('[data-sec]', root).forEach(b=>b.onclick=()=>{
      section=b.dataset.sec; settingsSection=section; $$('[data-sec]',root).forEach(x=>x.classList.toggle('on', x===b)); renderSec();
      if (isMobileSettings()){ navScroll = window.scrollY; mobileState(true, true); }
    });
    renderSec();

    function profileHTML(u2){
      return `<div class="card card-pad"><h3 style="margin-bottom:14px">Профиль</h3>
        <div class="row" style="gap:16px;margin-bottom:16px">
          <span class="avatar avatar--lg" id="pf-avatar-preview" title="Нажмите для просмотра" style="${u2.avatar?`background-image:url('${u2.avatar}')`:''}${u2.avatar?'':'display:inline-flex'}">${u2.avatar?'':initials(u2.full_name)}<span class="dot dot--online"></span></span>
          <div><button class="btn btn--ghost btn--sm" id="pf-avatar">${icon('edit')} Загрузить аватар</button>
          <input type="file" id="pf-avatar-file" accept="image/*" hidden>
          ${u2.avatar?`<button class="btn btn--ghost btn--sm" id="pf-avatar-clear" style="margin-left:6px">${icon('trash')} Убрать</button>`:''}
          <p class="small faint" style="margin-top:6px">Загрузите своё фото — коллеги и заказчики увидят того, с кем работают</p></div>
        </div>
        <div class="cols-2 grid" style="gap:12px">
          <div class="field"><label>ФИО / Название</label><input class="input" id="pf-name" value="${esc(u2.full_name)}"></div>
          <div class="field"><label>Логин</label><input class="input" id="pf-login" value="${esc(u2.username)}" autocomplete="off" spellcheck="false"></div>
          <div class="field"><label>Email</label><input class="input" id="pf-email" value="${esc(u2.email)}"></div>
          <div class="field"><label>Телефон</label><input class="input" id="pf-phone" value="${esc(u2.phone)}"></div>
        </div>
        <div class="field" style="margin-top:12px"><label>О себе</label><textarea class="input" id="pf-about">${esc(u2.about||'')}</textarea></div>
        <div class="row row--between" style="margin-top:12px"><b class="small">Рабочий статус</b>
          <div class="seg" id="pf-ws"><button data-w="working" class="${u2.ext&&u2.ext.workStatus==='not_working'?'':'on'}">Работаю</button><button data-w="not_working" class="${u2.ext&&u2.ext.workStatus==='not_working'?'on':''}">Не работаю</button></div></div>
        <div class="row row--between" style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
          <div><b class="small">Черновики заказов</b>
            <div class="small faint">Незаполненная форма заказа сохраняется локально и предлагается при следующем открытии.</div></div>
          <label class="check" title="Автосохранять черновик"><input type="checkbox" id="draft-auto" ${prefsFor().autoDraft!==false?'checked':''}><span class="box"><svg><use href="#i-check-c"/></svg></span></label>
        </div>
        <div class="row row--between" style="margin-top:10px;padding-left:2px">
          <div class="small muted" style="flex:1;min-width:0">Спрашивать «Сохранить черновик?» при закрытии формы</div>
          <label class="check" title="Показывать вопрос при закрытии"><input type="checkbox" id="draft-ask" ${prefsFor().noAskDraft?'':'checked'}><span class="box"><svg><use href="#i-check-c"/></svg></span></label>
        </div>
        <div class="row" style="margin-top:10px;gap:8px" id="draft-actions" hidden>
          <span class="small faint" id="draft-last" style="align-self:center"></span>
          <button class="btn btn--ghost btn--sm" id="draft-clear">${icon('trash','ico-sm')} Очистить черновик</button>
        </div>
        <p class="small faint" style="margin-top:14px">${icon('check-c','ico-sm')} Все изменения сохраняются автоматически.</p></div>`;
    }
    function lookHTML(u2){
      const mode = u2.mode || 'system';
      const accent = u2.accent || 'red';
      return `<div class="card card-pad"><h3 style="margin-bottom:6px">Тема</h3>
        <p class="small muted" style="margin-bottom:10px">Системная следует настройкам ОС. Тёмная — по умолчанию.</p>
        <div class="seg" id="lk-mode">${MODE_LIST.map(m=>`<button data-m="${m}" class="${mode===m?'on':''}">${MODE_LABEL[m]}</button>`).join('')}</div>
        <h3 style="margin:18px 0 6px">Цвет акцента</h3>
        <p class="small muted" style="margin-bottom:10px">Отдельно от темы: одинаково работает в тёмной и светлой.</p>
        <div class="grid" style="grid-template-columns:repeat(2,1fr)">
          ${ACCENT_LIST.map(a=>`<div class="theme-card accent-card ${accent===a?'on':''}" data-accent="${a}">
            <div class="theme-card__preview accent-preview" data-acc="${a}"><span class="ap-dot"></span><span class="ap-dot ap-dot2"></span></div>
            <div class="theme-card__name">${ACCENT_LABEL[a]} ${accent===a?icon('check-c','ico-sm'):''}</div>
          </div>`).join('')}
        </div>
        ${accent==='custom'?`<div class="row" style="gap:10px;margin-top:8px"><input type="color" id="lk-custom-color" value="${S.settings.customAccentColor||'#8f78b0'}" style="width:40px;height:40px;border-radius:10px;border:1px solid var(--border-2);padding:0;cursor:pointer;background:none"><button class="btn btn--ghost btn--sm" id="lk-custom-apply">${icon('check-c')} Применить</button></div>`:''}
        <h3 style="margin:18px 0 6px">Фон приложения</h3>
        <p class="small muted" style="margin-bottom:10px">Мягкий рукописный дудл-фон за интерфейсом.</p>
        <div class="seg" id="lk-appbg" style="flex-wrap:wrap">
          ${[['none','Без фона'],['doodle','Дудлы']]
            .map(([v,label])=>`<button data-bg="${v}" class="${(S.settings.appBg!=='none'?'doodle':'none')===v?'on':''}">${label}</button>`).join('')}
        </div>
        <div class="row row--between" style="margin-top:14px"><span><b style="font-size:14px">Отключить анимации</b><br><span class="muted" style="font-size:13px">Убирает плавные переходы и переливы.</span></span>
          <label class="switch"><input type="checkbox" id="lk-noanim" ${S.settings.noAnim?'checked':''}><span class="tr"></span></label></div>
      </div>`;
    }
    function calcHTML(){
      const rows = nid => (S.calcServices[nid]||[]).map(s=>`<tr data-sid="${s.id}">
          <td><input class="input" data-f="name" value="${esc(s.name)}" style="padding:6px 10px"></td>
          <td><input class="input" data-f="price" type="number" min="0" value="${s.price}" style="padding:6px 10px;width:100px"></td>
          <td><input class="input" data-f="unit" value="${esc(s.unit||'')}" style="padding:6px 10px"></td>
          <td><input class="input" data-f="margin" type="number" min="0" max="90" value="${s.margin||0}" style="padding:6px 10px;width:76px"></td>
          <td style="width:40px"><button class="iconbtn" data-del="${s.id}" title="Удалить услугу">${icon('trash')}</button></td>
        </tr>`).join('');
      return `<div class="card card-pad" style="margin-bottom:12px"><h3 style="margin-bottom:6px">Гонорары менеджеров</h3>
        <p class="small muted" style="margin-bottom:10px">Потолок гонорара — процент от суммы заказа, выше которого менеджер не поднимет свой гонорар. Меняет только администратор.</p>
        <div class="cols-2 grid" style="gap:13px">
          <div class="field"><label>Менеджер, % от суммы</label><input class="input" id="fee-manager" type="number" min="0" max="100" value="${(S.settings.feeCeilings||{}).manager ?? 25}"></div>
          <div class="field"><label>Топ-менеджер, % от суммы</label><input class="input" id="fee-top" type="number" min="0" max="100" value="${(S.settings.feeCeilings||{}).top_manager ?? 25}"></div>
        </div>
        <button class="btn btn--primary btn--sm" id="fee-save" style="margin-top:10px">Сохранить потолки</button>
      </div><div class="card card-pad"><h3 style="margin-bottom:6px">Услуги калькулятора</h3>
        <p class="small muted" style="margin-bottom:12px">Перечень услуг, стоимость и маржа платформы — по нишам. Настраивается администратором — владельцем платформы. Калькулятор принимает ввод с клавиатуры.</p>
        ${S.niches.map(n=>`<div class="card card-pad" style="background:var(--bg-2);margin-top:10px">
          <div class="row row--between"><b class="small">${esc(n.name)}</b>
            <button class="btn btn--ghost btn--sm" data-add="${n.id}">${icon('plus')} Услуга</button></div>
          <div class="tbl-wrap" style="margin-top:8px;border:0"><table class="tbl" style="min-width:0">
            <thead><tr><th>Услуга</th><th>Цена, ₽</th><th>Единица</th><th>Маржа, %<input class="input" data-margin-all="${n.id}" type="number" min="0" max="90" placeholder="все" style="width:58px;padding:3px 6px;font-size:11px;margin-left:6px" title="Выставить маржу всем услугам группы"></th><th></th></tr></thead>
            <tbody data-niche="${n.id}">${rows(n.id)}</tbody>
          </table></div>
        </div>`).join('')}
        <button class="btn btn--primary" id="calc-save" style="margin-top:14px">${icon('check-c')} Сохранить услуги</button>
      </div>`;
    }
    const REP_LABEL = { none:'Разовое', daily:'Ежедневно', weekly:'Еженедельно', monthly:'Ежемесячно' };
    function todosHTML(u2){
      /* Умный планировщик: ToDo список, отсортированный от наиболее важного
         к наименее важному (приоритет 1 = критично … 5 = не срочно).
         Хранится в S.todos (per-user); заготовки-варианты — для всех ролей. */
      const mine = (S.todos||[]).filter(t=>t.owner_id===u2.id);
      const byPrio = (a,b)=> (a.done?1:0)-(b.done?1:0) || (a.prio||5)-(b.prio||5) || ((b.created_at||0)-(a.created_at||0));
      const sorted = [...mine].sort(byPrio);
      const openCount = sorted.filter(t=>!t.done).length;
      const PRESETS = [
        'Позвонить клиенту', 'Проверить статус заказов', 'Согласовать счёт',
        'Поставить задачу исполнителю', 'Ответить на тикеты', 'Проверить дедлайны',
        'Обновить документы', 'Подготовить отчёт', 'Разобрать почту'
      ];
      const PRIO_LABEL = { 1:'Критично', 2:'Важно', 3:'Обычно', 4:'Не срочно', 5:'Когда-нибудь' };
      return `<div class="card card-pad">
        <h3 style="margin-bottom:10px">Умный планировщик (ToDo)</h3>
        <p class="small muted" style="margin:0 0 12px">Задачи сортируются от важного к наименее важному. Варианты для быстрого старта — ниже.</p>
        <div class="row" style="gap:8px;margin-bottom:8px">
          <div class="field" style="flex:1;min-width:0"><input class="input" id="td-text" placeholder="Что нужно сделать?"></div>
          <div class="field" style="flex:none;max-width:180px">
            <select class="input" id="td-prio">
              ${[1,2,3,4,5].map(p=>`<option value="${p}">${p} — ${PRIO_LABEL[p]}</option>`).join('')}
            </select>
          </div>
          <div style="align-self:flex-end"><button class="btn btn--primary btn--sm" id="td-add">${icon('plus','ico-sm')} Добавить</button></div>
        </div>
        <div class="chips" style="gap:6px;margin-bottom:12px">
          ${PRESETS.map(p=>`<span class="chip" data-td-preset="${esc(p)}" style="cursor:pointer">${esc(p)}</span>`).join('')}
        </div>
        ${sorted.length ? `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 8px">
          <label class="check" style="gap:6px;flex:none"><input type="checkbox" id="td-sel-all" ${openCount?'':'disabled'} aria-label="Выбрать все задачи"><span class="box"><svg><use href="#i-check-c"/></svg></span><span class="small">Выбрать все</span></label>
          <span class="spacer"></span>
          <span class="small faint" id="td-sel-cnt"></span>
          <button class="btn btn--ghost btn--sm" type="button" id="td-close-sel" disabled>Закрыть выбранные</button>
          <button class="btn btn--soft btn--sm" type="button" id="td-close-all" ${openCount?'':'disabled'}>Закрыть все</button>
        </div>
        <div class="stack" style="gap:8px">${sorted.map(t=>{
          const lbl = PRIO_LABEL[t.prio] || ('Приоритет '+t.prio);
          return `<div class="row row--between" style="padding:10px 12px;border:1px solid var(--border);border-radius:12px;${t.done?'opacity:.55':''}">
            <span class="small" style="display:flex;gap:8px;align-items:center;min-width:0">
              <label class="check" style="gap:0;flex:none;margin:0" title="Выбрать задачу">
                <input type="checkbox" data-td-check value="${esc(t.id)}" ${t.done?'disabled':''} aria-label="Выбрать задачу">
                <span class="box"><svg><use href="#i-check-c"/></svg></span>
              </label>
              ${t.done?'<span class="badge c-green">готово</span>':`<span class="badge ${t.prio===1?'c-red':(t.prio===2?'c-orange':'c-gray')}" title="Приоритет ${t.prio} из 5">${esc(lbl)}</span>`}
              <b>${esc(t.text)}</b>
            </span>
            <span style="display:flex;gap:6px;align-items:center">
              ${t.done?'':`<button class="btn btn--ghost btn--sm" data-td-done="${t.id}">Готово</button>`}
              <button class="iconbtn" data-td-del="${t.id}" title="Удалить">${icon('trash','ico-sm')}</button>
            </span>
          </div>`; }).join('')}</div>`
        : '<p class="small faint">Пока пусто — добавьте первую задачу или выберите вариант ниже</p>'}
        <div class="row row--between" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);gap:10px;flex-wrap:wrap">
          <div style="flex:1;min-width:190px"><b class="small">Обмен с ИИ-помощниками</b>
            <div class="small faint">Экспорт — Markdown с приоритетами и заданием для ассистента. Импорт принимает текст, Markdown или JSON, в том числе ответ ИИ.</div></div>
          <div class="row" style="gap:6px">
            <button class="btn btn--ghost btn--sm" type="button" data-td-exp>${icon('export')} Экспорт</button>
            <button class="btn btn--ghost btn--sm" type="button" data-td-imp>${icon('import')} Импорт</button>
          </div>
        </div>
      </div>`;
    }

    /* ---- ToDo для ИИ: выгрузка в Markdown и разбор ответа ---- */
    const TODO_PRIO = { 1:'Критично', 2:'Важно', 3:'Обычно', 4:'Не срочно', 5:'Когда-нибудь' };
    const todoNorm = s => String(s||'').replace(/\s+/g,' ').trim().toLowerCase();

    function todoExportText(u2){
      const mine = (S.todos||[]).filter(t=>t.owner_id===u2.id);
      const open = mine.filter(t=>!t.done), done = mine.filter(t=>t.done);
      const when = new Date().toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
      const role = (typeof ROLE_LABEL!=='undefined' && ROLE_LABEL[u2.role]) || u2.role;
      const lines = [
        `# ToDo — ${u2.full_name}`,
        '',
        `_Выгружено ${when} · Audiowizard Workspace · роль: ${role}_`,
        '',
        `Открыто: ${open.length} · выполнено: ${done.length} · всего: ${mine.length}`,
        '',
        '## Задание для ИИ-помощника',
        'Ты — помощник по планированию рабочего дня. Ниже мой список задач с приоритетами.',
        '',
        '1. Предложи порядок выполнения на сегодня — от критичного к незначительному.',
        '2. Сгруппируй похожие задачи и оцени время на каждую.',
        '3. Отметь, что стоит делегировать или отложить.',
        '',
        'Ответ — короткий план без пересказа списка.',
        '',
        '## Задачи'
      ];
      const byPrio = (a,b) => ((a.prio||3)-(b.prio||3)) || ((b.created_at||0)-(a.created_at||0));
      const rest = [...open].sort(byPrio);
      if (!rest.length) lines.push('', 'Открытых задач нет.');
      for (let p=1; p<=5; p++){
        const list = rest.filter(t => (t.prio||3) === p);
        if (!list.length) continue;
        lines.push('', `### ${p} — ${TODO_PRIO[p]}`);
        list.forEach(t => lines.push(`- [ ] (P${p}) ${String(t.text||'').trim()}`));
      }
      if (done.length){
        lines.push('', '### Выполнено');
        [...done].sort((a,b)=>((b.created_at||0)-(a.created_at||0))).forEach(t => lines.push(`- [x] (P${t.prio||3}) ${String(t.text||'').trim()}`));
      }
      lines.push('', '## Правила',
        '- (P1) — критично, (P5) — когда-нибудь.',
        '- Строка «[x]» — уже сделана, повторно её не предлагай.',
        '- Этот же список можно вернуть в приложение через «Импорт» в настройках.');
      return lines.join('\n');
    }

    /* Разбор импорта: JSON или текст/Markdown. Понимает наш собственный
       формат, списки «- [ ] (P2) …», «P2 …», «!2 …» и нумерованные строки. */
    function todoParseImport(text){
      const raw = String(text||'');
      const items = [], seen = new Set();
      const add = (value, prio, isDone) => {
        const t = String(value||'')
          .replace(/^[-–—•*]\s*/, '')
          .replace(/\s+/g,' ')
          .replace(/[\s.;,]+$/,'')
          .trim();
        if (t.length < 2 || t.length > 200) return;
        if (!/[0-9a-zа-яё]/i.test(t)) return;
        const key = todoNorm(t);
        if (seen.has(key)) return;
        seen.add(key);
        items.push({ text:t, prio:Math.min(5, Math.max(1, parseInt(prio,10)||3)), done:!!isDone });
      };
      let j = null;
      try { j = JSON.parse(raw.trim()); } catch(e){ j = null; }
      if (j){
        const arr = Array.isArray(j) ? j : (Array.isArray(j.todos) ? j.todos : (Array.isArray(j.tasks) ? j.tasks : null));
        if (arr){
          arr.forEach(x => {
            if (typeof x === 'string') add(x, 3, false);
            else if (x && typeof x === 'object') add(x.text || x.title || x.task, x.prio || x.priority || 3, x.done || x.completed);
          });
          if (items.length) return items;
        }
      }
      let lines = raw.split(/\r?\n/);
      /* Если есть раздел «Задачи» — берём только его: инструкции для
         ассистента и служебную шапку в список не тащим. */
      const start = lines.findIndex(l => /^#{1,6}\s*задач/i.test(l.trim()));
      if (start >= 0) lines = lines.slice(start + 1);
      lines.forEach(line => {
        let s = line.trim();
        if (!s) return;
        if (/^#{1,6}\s/.test(s)) return;
        if (/^[-*_]{3,}$/.test(s)) return;
        if (/^[>_|]/.test(s)) return;
        let isDone = false;
        const cb = s.match(/^(?:[-*•]\s*)?\[( |x|X)\]\s*(.*)$/);
        if (cb){ isDone = cb[1].toLowerCase() === 'x'; s = cb[2]; }
        s = s.replace(/^[-–—•*]\s*/, '').replace(/^\d+[.)]\s*/, '');
        let prio = 3;
        const pm = s.match(/^\(?\s*[Pp]\s*([1-5])\s*\)?[.:)\s—-]*(.*)$/) || s.match(/^!\s*([1-5])[.:)\s—-]+(.*)$/);
        if (pm){ prio = +pm[1]; s = pm[2] || ''; }
        add(s, prio, isDone);
      });
      return items;
    }

    function remindersHTML(u2){
      const mine = (S.reminders||[]).filter(r=>r.owner_id===u2.id)
        .sort((x,y)=>(x.done?1:0)-(y.done?1:0) || x.at-y.at);
      const fmt = ts => new Date(ts).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
      return `<div class="card card-pad">
        <h3 style="margin-bottom:10px">Мои напоминания</h3>
        <p class="small muted" style="margin:0 0 12px">С уведомлением — придёт в колокольчик. Тихое — просто появится в этом списке, никого не дёргая. Повторяющиеся напоминания сами сдвигаются на следующий срок; «Готово» — останавливает цепочку.</p>
        <div class="cols-2 grid" style="gap:12px">
          <div class="field"><label>Текст</label><input class="input" id="rm-text" placeholder="Например: позвонить клиенту"></div>
          <div class="field"><label>Когда</label><input class="input" type="datetime-local" id="rm-at"></div>
        </div>
        <div class="row row--between" style="margin-top:10px">
          <div class="field" style="flex:1;max-width:230px"><label>Повтор</label>
            <select class="input" id="rm-repeat">
              <option value="none">Не повторять</option>
              <option value="daily">Ежедневно</option>
              <option value="weekly">Еженедельно</option>
              <option value="monthly">Ежемесячно</option>
            </select>
          </div>
          <div style="align-self:flex-end"><button class="btn btn--primary btn--sm" id="rm-add">${icon('plus','ico-sm')} Добавить</button></div>
        </div>
        <div class="row" style="margin-top:8px">
          <label class="check" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="rm-notify" checked><span class="box"><svg><use href="#i-check-c"/></svg></span><span class="small">Уведомить в колокольчик</span></label>
        </div>
        <hr class="divider">
        <div class="stack" style="gap:8px">
          ${mine.length ? mine.map(r=>{
            const rep = r.repeat || 'none';
            const whenStr = r.done ? 'выполнено' : (r.at <= Date.now() ? 'наступило' : 'след. ' + fmt(r.at));
            return `<div class="row row--between" style="padding:10px 12px;border:1px solid var(--border);border-radius:12px;${r.done?'opacity:.55':''}">
            <span class="small"><b>${esc(r.text)}</b><br><span class="faint">${REP_LABEL[rep] || rep} · ${whenStr}${r.notify?' · с уведомлением':' · тихо'}</span></span>
            <span style="display:flex;gap:6px;align-items:center">
              ${(r.done?'':`<button class="btn btn--ghost btn--sm" data-rm-done="${r.id}">Готово</button>`)}
              ${(!r.done && rep!=='none')?`<button class="btn btn--ghost btn--sm" data-rm-skip="${r.id}" title="Пропустить ближайший срок">Пропустить</button>`:''}
              <button class="iconbtn" data-rm-del="${r.id}" title="Удалить">${icon('trash','ico-sm')}</button>
            </span>
          </div>`; }).join('') : '<p class="small faint">Пока пусто</p>'}
        </div>
      </div>`;
    }

    function notifyHTML(u2){
      const chats = chatForUser(u2);
      return `<div class="card card-pad"><h3 style="margin-bottom:12px">Push-уведомления</h3>
        <div class="stack" style="gap:10px">
          ${[['Заказы: изменения статусов',true],['Чаты: все новые сообщения',true],['Уведомления о версиях и патчноутах',true],['Тикеты и идеи (для менеджеров)',isStaff(u2.role)]]
            .map(([label,on])=>`<label class="check"><input type="checkbox" checked="${on?'':undefined}"><span class="box"><svg><use href="#i-check-c"/></svg></span><span class="small">${label}</span></label>`).join('')}
        </div></div>
        <div class="card card-pad"><h3 style="margin-bottom:12px">Чаты: тонкая настройка</h3>
          <div class="stack" style="gap:10px">
            ${chats.map(c=>`<div class="row row--between"><span class="small">${esc(c.name)}</span><label class="switch"><input type="checkbox" checked data-chat-mute="${c.id}"><span class="tr"></span></label></div>`).join('')}
          </div></div>
        <div class="card card-pad"><h3 style="margin-bottom:8px">Рассылки</h3>
          <p class="small muted" style="margin-bottom:10px">Системные уведомления (статус заказа, сообщения) не зависят от этой настройки.</p>
          <div class="row row--between"><span class="small">Информационные и маркетинговые рассылки</span>
            <label class="switch"><input type="checkbox" id="nf-marketing" ${u2.consent_marketing?'checked':''}><span class="tr"></span></label></div>
          <button class="btn btn--danger btn--sm" id="nf-unsub-all" style="margin-top:12px">Отписаться от всех рассылок</button>
        </div>`;
    }
    function securityHTML(u2){
      /* Реальные сессии из журнала аудита (в проде демо-записи отфильтрованы) */
      const realAudit = noDemo(S.audit || []);
      const sess = realAudit.slice(0, 3);
      const suspicious = realAudit.filter(a => a.entity === 'Безопасность').slice(0, 2);
      return `<div class="card card-pad"><h3 style="margin-bottom:6px">Активные сессии</h3>
        <p class="small muted" style="margin-bottom:8px">Устройства, браузеры и IP-адреса ваших сессий.</p>
        ${(sess.length ? sess : [[{ dev:'MacBook Pro · Chrome · текущая' , ip:'—' }]]).map(s=>{
          const devTxt = s.user ? `${s.user} · ${s.action}` : s.dev;
          const ipTxt = s.ip || '—';
          return `<div class="session-row">${icon('device')}<span style="flex:1"><b class="small">${esc(String(devTxt).slice(0,64))}</b><div class="cell-sub">IP ${esc(ipTxt)} · вход ${fmtTime(s.t || Date.now())}</div></span></div>`;
        }).join('')}
        <button class="btn btn--danger btn--sm" id="sec-revoke" style="margin-top:12px">${icon('exit')} Выйти на всех устройствах</button></div>
      <div class="card card-pad"><h3 style="margin-bottom:10px">Двухфакторная аутентификация</h3>
        <div class="row row--between"><span class="small">SMS-код на номер ${esc(u2.phone)}</span><button class="btn btn--soft btn--sm" id="sec-2fa">Включить</button></div>
        <p class="small faint" style="margin-top:8px">Код никому не сообщается. Сотрудники поддержки никогда не запрашивают его.</p></div>
      ${u2.role==='admin' && suspicious.length ? `<div class="card card-pad"><h3 style="margin-bottom:10px">Подозрительная активность</h3>
        <div class="log-box">${suspicious.map(a=>`<div class="err">${esc(a.user||'Система')} — ${esc(String(a.action).slice(0,80))} (${fmtDate(a.t)})</div>`).join('')}</div></div>`:''}`;
    }
    function keysHTML(){
      const defs = [
        ['Поиск / палетка команд','search'],
        ['Новый заказ','newOrder'],
        ['Настройки','settings'],
        ['Переключить тему','theme'],
        ['Полноэкранный режим','zen']
      ];
      const fmt = c => String(c||'').split('+').map((p,i)=> i===0 ? p.toUpperCase() : (p===''?'':p.toUpperCase())).map(x=>x===' '?'SPACE':x).join(' + ');
      return `<div class="card card-pad"><h3 style="margin-bottom:12px">Горячие клавиши</h3>
        ${defs.map(([label,id])=>`<div class="session-row" data-kbind="${id}">${icon('terminal')}<span style="flex:1" class="small">${label}</span>
          <button class="btn btn--ghost btn--sm kbd" data-key="${id}" title="Клик — переназначить">${fmt(S.keys && S.keys[id])}</button>
          <button class="iconbtn" data-kreset="${id}" title="Сбросить">${icon('refresh')}</button></div>`).join('')}
        <p class="small faint" style="margin-top:12px">Кликните по комбинации и нажмите новую. Запись идёт в вашем браузере.</p>
        <p class="small faint" style="margin-top:6px">Ctrl и Cmd на macOS считаются одним модификатором.</p>
        <button class="btn btn--ghost btn--sm" data-kreset-all style="margin-top:10px">${icon('refresh')} Вернуть все по умолчанию</button></div>`;
    }
    /* ---------- Согласование правок документов ----------
       Правки не-админов не применяются сразу: создаётся заявка, админ видит
       конкретный дифф (что было / что станет) и одобряет или отклоняет. */
    function docRequests(){
      S.docRequests = S.docRequests || [];
      return S.docRequests;
    }
    function notifyAdmins(title, text){
      S.notifs.unshift({ id:uid(), icon:'i-file', title, text, t:Date.now(), read:{} });
    }
    function docDiffHtml(oldText, newText){
      const a = String(oldText||'').split('\n').map(s=>s.trim()).filter(Boolean);
      const b = String(newText||'').split('\n').map(s=>s.trim()).filter(Boolean);
      const setA = new Set(a), setB = new Set(b);
      const rows = [];
      a.forEach(l => { if (!setB.has(l)) rows.push(`<div class="diff-row diff-del">− ${esc(l)}</div>`); });
      b.forEach(l => { if (!setA.has(l)) rows.push(`<div class="diff-row diff-add">+ ${esc(l)}</div>`); });
      return rows.length ? rows.join('') : '<div class="small faint">Изменений в тексте нет</div>';
    }

    /* Роли для доступа к документам — все роли системы (клиенты и исполнители тоже) */
    function docsHTML(){
      let docs = S.settings.documents || [
        { title:'Пользовательское соглашение', body:'Договор между пользователем и сервисом Audiowizard: предмет, права и обязанности сторон, порядок оказания услуг обработки контента, ответственность и порядок разрешения споров. Актуальная редакция от 01.08.2026.' },
        { title:'Политика конфиденциальности', body:'Мы обрабатываем персональные данные (ФИО, контакты, реквизиты) в целях исполнения заказов. Данные хранятся с шифрованием AES-256, не передаются третьим лицам, кроме случаев, предусмотренных законодательством РФ. Вы можете запросить удаление данных в любой момент.' },
        { title:'Правила сервиса', body:'Квоты и ограничения: чаевые не более 100% стоимости заказа и 10 000 ₽ разово; файлы удаляются автоматически через 90 дней; рейтинги исполнителей изменяются через голосование менеджеров; материалы заказов принадлежат заказчику (ст. 146, 183 УК РФ).' },
        { title:'Справка и FAQ', body:'Как создать заказ: раздел «Заказы» → «Новый заказ» → заполните карточку. Как загрузить файл: перетащите его в форму заказа. Как сменить тему: аватар → «Тема».' }
      ];
      if (!S.settings.documents) S.settings.documents = docs;
      docs = S.settings.documents;
      /* Доступ к документам: d.roles — кто видит. Нет поля — видят все.
         Админ видит всё и настраивает доступ; остальные — только разрешённое. */
      const meRole = user().role;
      const canSeeDoc = d => meRole === 'admin' || !d.roles || !d.roles.length || d.roles.includes(meRole);
      const openTitle = window.__openDocTitle || null;
      window.__openDocTitle = null;
      if (openTitle) setTimeout(() => {
        try {
          const el = [...document.querySelectorAll('.doc-acc')].find(x => {
            const t = x.querySelector('.doc-t');
            return t && t.textContent.trim() === openTitle;
          });
          if (el){ el.classList.add('open'); el.scrollIntoView({ block:'center', behavior:'smooth' }); }
        } catch(e){}
      }, 140);
      const roleLabel = d => docRolesLabel(d);
      const visibleDocs = docs.map((d,i)=>({ d, i })).filter(x => canSeeDoc(x.d));
      /* Рендер тела документа: вложения-токены [[m:N]] заменяются на
         изображения/видео, приложенные к документу. */
      const renderDocBody = (d)=>{
        const exc = d.media && d.media.length ? d.media : [];
        const escBody = esc(d.body || '');
        return escBody.replace(/\[\[m:(\d+)\]\]/g, (_, idx)=>{
          const m = exc[+idx];
          if (!m) return '';
          return m.type.startsWith('video/')
            ? `<video controls playsinline src="${m.src}" style="max-width:100%;border-radius:12px;margin:8px 0"></video>`
            : `<img src="${m.src}" alt="" style="max-width:100%;border-radius:12px;margin:8px 0">`;
        }).replace(/\n/g,'<br>');
      };
      return `<div class="stack">
        ${visibleDocs.map(({d,i})=>`<div class="doc-acc${openTitle && d.title===openTitle ? ' open' : ''}"><div class="summary" role="button" tabindex="0">${icon('file')} <span class="doc-t">${esc(d.title)}</span>${icon('chev-d','ico-sm')}</div><div class="doc-body">${renderDocBody(d)}</div>
          ${['admin','top_manager','manager'].includes(meRole)?`<div class="doc-edit"><button class="btn btn--ghost btn--sm" data-edit-doc="${i}">${icon('edit')} Редактировать</button>
            <button class="btn btn--ghost btn--sm doc-del" data-del-doc="${i}" title="Удалить документ">${icon('trash')} Удалить</button>
            ${meRole==='admin'?`<button type="button" class="doc-access" data-doc-access="${i}" aria-expanded="false">
                <span>Доступ: <b>${(d.roles&&d.roles.length)?esc(roleLabel(d)):'все'}</b></span>
                <svg class="doc-access__chev"><use href="#i-chev-d"/></svg>
              </button>
              <span class="doc-roles" data-doc-roles-box="${i}">
                  ${ALL_DOC_ROLES.map(r=>`<label class="check" style="display:inline-flex;align-items:center;gap:4px"><input type="checkbox" data-doc-role="${r.id}" data-doc-idx="${i}" ${(d.roles||[]).includes(r.id)?'checked':''}><span class="box"><svg><use href="#i-check-c"/></svg></span><span class="small">${esc(r.label)}</span></label>`).join('')}
                  <span class="small faint">(ничего — видят все)</span>
                </span>`:''}</div>`:''}
        </div>`).join('')}
        ${['admin','top_manager','manager'].includes(user().role)?`<button class="btn btn--ghost btn--sm" id="doc-add" style="margin-top:8px">${icon('plus')} Добавить документ</button>`:''}
        ${(() => {
          const reqs = docRequests();
          const pending = reqs.filter(r => r.status === 'pending');
          if (user().role === 'admin' && pending.length){
            return `<div class="card card-pad doc-reqs">
              <h3 style="margin-bottom:10px">Заявки на изменение документов <span class="badge c-yellow">${pending.length}</span></h3>
              ${pending.map(r => `<div class="doc-req">
                <div class="doc-req__head"><b>${esc(r.docTitle)}</b>
                  <span class="small faint">${esc(r.authorName)} · ${fmtDT(r.created_at)}</span></div>
                ${r.kind === 'create' ? '<div class="small muted" style="margin-bottom:6px">Предлагается новый документ</div>' : r.kind === 'delete' ? '<div class="small muted" style="margin-bottom:6px">Предлагается УДАЛИТЬ документ</div>' : ''}
                ${r.title !== r.prevTitle ? `<div class="small" style="margin-bottom:6px">Название: <span class="diff-del">${esc(r.prevTitle)}</span> → <span class="diff-add">${esc(r.title)}</span></div>` : ''}
                ${r.kind === 'delete' ? `<div class="doc-diff"><div class="diff-row diff-del">− ${esc(r.docTitle)}</div></div>` : r.kind === 'create' ? `<div class="doc-diff"><div class="diff-row diff-add">+ ${esc(r.title)}</div><div class="diff-row diff-add">+ ${esc(r.body||'')}</div></div>` : `<div class="doc-diff">${docDiffHtml(r.prevBody, r.body)}</div>`}
                <div class="row" style="gap:8px;margin-top:10px">
                  <button class="btn btn--primary btn--sm" data-doc-approve="${r.id}">${icon('check-c','ico-sm')} Одобрить</button>
                  <button class="btn btn--ghost btn--sm" data-doc-reject="${r.id}">${icon('x-c','ico-sm')} Отклонить</button>
                </div>
              </div>`).join('')}
            </div>`;
          }
          const mine = pending.filter(r => r.authorId === user().id);
          if (mine.length){
            return `<div class="docs-note" style="border-color:var(--yellow)">${icon('clock','ico-sm')} На согласовании у администратора: ${mine.map(r => esc(r.docTitle)).join(', ')}</div>`;
          }
          return '';
        })()}
        <p class="docs-note">${icon('info','ico-sm')} Актуальные версии документов также доступны в футере сайта и отправляются в центр уведомлений при обновлении.</p></div>`;
    }
    function productHTML(){
      const notes = (S.product && S.product.notes) || [];
      return `<div class="card card-pad" style="border-color:var(--accent);border-width:1.5px"><h3 style="margin-bottom:10px">Демо-режим и версии</h3>
        <div class="row row--between" style="margin-bottom:12px"><span class="small">Показывать бейдж «Beta» в футере и шапке</span>
          <label class="switch"><input type="checkbox" id="pr-beta" ${S.product&&S.product.beta?'checked':''}><span class="tr"></span></label></div>
        <div class="cols-2 grid" style="gap:12px">
          <div class="field"><label>Версия</label><input class="input" id="pr-version" value="${esc(S.product&&S.product.version || '0.1-prototype')}"></div>
          <div class="field"><label>Сборка</label><input class="input" id="pr-build" value="${(S.product&&S.product.build) || 216}"></div>
        </div>
        <div class="row row--between" style="margin:12px 0;padding:10px 12px;background:var(--accent-soft);border-radius:12px"><span class="small"><b>Демо-вход и демо-данные</b><br><span class="muted">Включайте для показа демо-входа и демо-данных, выключайте для чистого запуска — данные при этом не удаляются</span></span>
          <label class="switch"><input type="checkbox" id="pr-demo" ${(S.settings.demoEnabled!==false)?'checked':''}><span class="tr"></span></label></div>
        <div class="field" style="margin-top:12px"><label>Демо-роли на экране входа</label>
          <p class="small faint" style="margin:0 0 8px">Снимите галочку, чтобы скрыть роль из демо-входа.</p>
          <div class="stack" style="gap:6px">
            ${[['admin','Администратор'],['top_manager','ТОП-менеджеры'],['manager','Менеджеры'],['client','Клиенты'],['executor','Исполнители']].map(([role,label])=>
              `<label class="check">
                <input type="checkbox" data-demo-role="${role}" ${(S.settings.demoHiddenRoles||[]).includes(role)?'':'checked'}>
                <span class="box"><svg><use href="#i-check-c"/></svg></span>
                <span class="small">${label}</span>
              </label>`).join('')}
          </div></div>
        <div class="field" style="margin-top:12px"><label>Разделы меню</label>
          <p class="small faint" style="margin:0 0 8px">Клик по разделу меняет состояние: скрыт → Beta → прод. Beta — значок в заголовке, прод — виден в продакшене, скрыт — нет в меню (кроме админа).</p>
          <div class="stack" style="gap:8px">
            ${NAV.map(sec=>{ const its = sec.items.filter(it=>it.route!=='settings');
              if (!its.length) return '';
              return `<div class="bstate-sec"><div class="small" style="font-weight:700;margin:2px 0 6px">${esc(sec.sec)}</div>
                <div class="row" style="gap:8px;flex-wrap:wrap">
                ${its.map(it=>{
                  const st = isBetaRoute(it.route) ? 'beta' : ((S.settings.hiddenRoutes||[]).includes(it.route) ? '' : 'prod');
                  const icons = { '': '', beta: '<svg><use href="#i-check"/></svg>', prod: '<svg><use href="#i-check-c"/></svg>' };
                  return `<button type="button" class="bstate ${st?('bstate--'+st):''}" data-pr-state="${esc(it.route)}" data-state="${st}" title="Клик: скрыт → Beta → прод"><span class="bstate__box">${icons[st]}</span><span class="small">${esc(it.title)}</span></button>`;
                }).join('')}
                </div></div>`;
            }).join('')}
          </div></div>
        <div class="field" style="margin-top:12px"><label>Патчноуты (по одной на строку)</label>
          <textarea class="input" id="pr-notes" rows="4">${esc(notes.join('\n'))}</textarea></div>
        <button class="btn btn--primary" id="pr-save" style="margin-top:12px">${icon('check-c')} Сохранить</button>
        <p class="small faint" style="margin-top:8px">Управляет админ — владелец платформы. Изменения видны всем после следующего входа.</p>
      </div>`;
    }
    function techHTML(){
      const m = S.settings.maintenance || {};
      return `<div class="card card-pad" style="border-color:var(--accent);border-width:1.5px"><h3 style="margin-bottom:10px">Технические работы</h3>
        <div class="row row--between" style="margin-bottom:12px"><span class="small">Режим обслуживания</span>
          <label class="switch"><input type="checkbox" id="tc-on" ${m.active?'checked':''}><span class="tr"></span></label></div>
        <div class="field" style="margin-top:10px"><label>Сообщение</label><input class="input" id="tc-msg" value="${esc(m.message||'')}" placeholder="Проводятся технические работы…"></div>
        <div class="cols-2 grid" style="gap:12px;margin-top:10px">
          <div class="field"><label>Начало</label><input class="input" id="tc-start" type="datetime-local" value="${m.start||''}"></div>
          <div class="field"><label>Окончание</label><input class="input" id="tc-end" type="datetime-local" value="${m.end||''}"></div>
        </div>
        <p class="small faint" style="margin-top:8px">При включённом режиме пользователи увидят баннер с указанными сроками.</p>
        <button class="btn btn--primary" id="tc-save" style="margin-top:10px">${icon('check-c')} Сохранить</button></div>`;
    }
    function bindTech(el){
      const saveM = () => {
        S.settings.maintenance = S.settings.maintenance || {};
        S.settings.maintenance.active = el.querySelector('#tc-on').checked;
        S.settings.maintenance.message = el.querySelector('#tc-msg').value.trim();
        S.settings.maintenance.start = el.querySelector('#tc-start').value;
        S.settings.maintenance.end = el.querySelector('#tc-end').value;
        saveState(); toast('Техработы сохранены','ok');
        const b = document.querySelector('.maint-banner');
        if (b) b.remove();
        if (S.settings.maintenance.active) showMaintBanner();
      };
      el.querySelector('#tc-on').onchange = saveM;
      el.querySelector('#tc-save').onclick = saveM;
    }
    function dataHTML(){
      return `<div class="card card-pad"><h3 style="margin-bottom:6px">Бекапы</h3>
        <p class="small muted" style="margin-bottom:10px">Автоматические ежедневные и ручные копии. Бекапы невозможно удалить никому.</p>
        <button class="btn btn--primary btn--sm" id="dt-backup">${icon('db')} Создать бекап</button>
        <div class="stack" style="margin-top:12px">
          ${S.backups.map(b=>`<div class="session-row">${icon('db')}<span style="flex:1"><b class="small">${esc(b.name)}</b><div class="cell-sub">${b.type==='auto'?'автоматический':'ручной'} · ${fmtDT(b.t)}</div></span><span class="badge c-green">целостность ок</span></div>`).join('')||'<p class="small faint">Бекапов пока нет</p>'}
        </div></div>
      <div class="card card-pad" style="border-color:var(--red)"><h3 style="margin-bottom:6px;color:var(--red)">Сброс демо-данных</h3>
        <p class="small muted">Перед сбросом автоматически создаётся полный бекап. Все данные вернутся к исходному состоянию.</p>
        <button class="btn btn--danger btn--sm" id="dt-reset" style="margin-top:12px">${icon('trash')} Сбросить данные</button></div>
      <div class="card card-pad" style="margin-top:14px"><h3 style="margin-bottom:6px">Меню</h3>
        <p class="small muted" style="margin-bottom:10px">Сбросить порядок и видимость разделов и пунктов меню к заводским настройкам.</p>
        <button class="btn btn--ghost btn--sm" id="dt-menu-reset">${icon('refresh')} Сбросить меню</button></div>`;
    }

    function bindCalc(el){
      if (el.dataset.calcBound){ return; }
      el.dataset.calcBound = '1';
      const feeSave = el.querySelector('#fee-save');
      if (feeSave) feeSave.onclick = ()=>{
        const m = Math.max(0, Math.min(100, +el.querySelector('#fee-manager').value || 0));
        const t = Math.max(0, Math.min(100, +el.querySelector('#fee-top').value || 0));
        S.settings.feeCeilings = { manager:m, top_manager:t };
        saveState();
        logAudit('Потолки гонораров: менеджер ' + m + '%, топ-менеджер ' + t + '%', 'Настройки');
        toast('Потолки гонораров сохранены', 'ok');
      };
      /* Маржа по группе: одно значение на всю нишу, без правки строк */
      el.querySelectorAll('[data-margin-all]').forEach(inp=>{
        const applyAll = ()=>{
          if (inp.value === '') return;
          const v = Math.min(90, Math.max(0, +inp.value || 0));
          const tb = el.querySelector('tbody[data-niche="' + inp.dataset.marginAll + '"]');
          if (!tb) return;
          tb.querySelectorAll('[data-f="margin"]').forEach(f => { f.value = v; });
        };
        inp.addEventListener('change', applyAll);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); applyAll(); } });
      });
      const save = ()=>{
        el.querySelectorAll('tbody[data-niche]').forEach(tb=>{
          const nid = tb.dataset.niche;
          const list = [];
          tb.querySelectorAll('tr[data-sid]').forEach(tr=>{
            const g = f => tr.querySelector(`[data-f="${f}"]`).value.trim();
            const name = g('name');
            if (!name) return;
            list.push({ id: tr.dataset.sid, name, price: +g('price')||0, unit: g('unit'), margin: Math.min(90, Math.max(0, +g('margin')||0)) });
          });
          S.calcServices[nid] = list;
        });
        logAudit('Услуги калькулятора обновлены', 'Настройки');
        saveState();
        toast('Услуги калькулятора сохранены', 'ok');
      };
      const addRow = nid => {
        const tb = el.querySelector(`tbody[data-niche="${nid}"]`);
        const id = 'cs' + uid();
        const tr = document.createElement('tr');
        tr.dataset.sid = id;
        tr.className = 'calc-new-row';
        tr.innerHTML = `
          <td><input class="input" data-f="name" placeholder="Название услуги" style="padding:6px 10px"></td>
          <td><input class="input" data-f="price" type="number" min="0" value="0" style="padding:6px 10px;width:100px"></td>
          <td><input class="input" data-f="unit" placeholder="за час / за трек" style="padding:6px 10px"></td>
          <td><input class="input" data-f="margin" type="number" min="0" max="90" value="20" style="padding:6px 10px;width:76px"></td>
          <td style="width:40px"><button class="iconbtn" data-del="${id}" title="Удалить">${icon('trash')}</button></td>`;
        tb.appendChild(tr);
      };
      el.addEventListener('click', e=>{
        const del = e.target.closest('[data-del]');
        if (del){ del.closest('tr').remove(); toast('Строка удалена — не забудьте сохранить','info'); return; }
        const add = e.target.closest('[data-add]');
        if (add) addRow(add.dataset.add);
        if (e.target.closest('#calc-save')) save();
      });
    }
    function bindProduct(el){
      /* Beta/прод разделов: три состояния — скрыт (пусто) → Beta (галочка)
         → прод (двойная галочка) → снова скрыт. Прод пишем в hiddenRoutes
         (скрытые в продакшене), Beta — в betaRoutes. */
      el.querySelectorAll('[data-pr-state]').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const route = btn.dataset.prState;
          const cur = btn.dataset.state;
          const next = cur === '' ? 'beta' : cur === 'beta' ? 'prod' : '';
          const beta = new Set(S.settings.betaRoutes||[]);
          const hidden = new Set(S.settings.hiddenRoutes||[]);
          beta.delete(route); hidden.delete(route);
          if (next === 'beta') beta.add(route);
          else if (next === '') hidden.add(route);
          S.settings.betaRoutes = [...beta];
          S.settings.hiddenRoutes = [...hidden];
          btn.dataset.state = next;
          btn.classList.remove('bstate--beta','bstate--prod');
          if (next) btn.classList.add('bstate--'+next);
          const box = btn.querySelector('.bstate__box');
          if (box) box.innerHTML = next==='beta' ? '<svg><use href="#i-check"/></svg>' : next==='prod' ? '<svg><use href="#i-check-c"/></svg>' : '';
          saveState();
          logAudit('Раздел: ' + route + ' → ' + ({beta:'Beta',prod:'прод','':''}[next] || 'скрыт'),'Настройки');
          toast({beta:'Раздел помечен как Beta',prod:'Раздел виден в продакшене','':''}[next] || 'Раздел скрыт','ok');
          /* Точечное обновление: НЕ перерисовываем всё приложение, иначе
             меню и настройки сбрасываются. Кнопка уже обновлена выше. */
        });
      });
      el.querySelector('#pr-beta').addEventListener('change', e=>{
        S.product = S.product || {};
        S.product.beta = e.target.checked;
        saveState(); toast('Бейдж Beta: ' + (e.target.checked ? 'показывается' : 'скрыт'), 'ok');
        APP.render();
      });
      el.querySelectorAll('[data-demo-role]').forEach(cb=>cb.addEventListener('change', ()=>{
        S.settings = S.settings || {};
        S.settings.demoHiddenRoles = S.settings.demoHiddenRoles || [];
        const role = cb.dataset.demoRole;
        const i = S.settings.demoHiddenRoles.indexOf(role);
        if (cb.checked && i >= 0) S.settings.demoHiddenRoles.splice(i,1);
        if (!cb.checked && i < 0) S.settings.demoHiddenRoles.push(role);
        saveState();
        toast(cb.checked ? 'Роль снова видна на входе' : 'Роль скрыта из демо-входа', 'info');
      }));
      el.querySelector('#pr-demo').addEventListener('change', e=>{
        S.settings = S.settings || {};
        S.settings.demoEnabled = e.target.checked;
        saveState(); toast('Демо-вход: ' + (e.target.checked ? 'включён' : 'отключён полностью'), 'ok');
        APP.render();
      });
      el.querySelector('#pr-save').onclick = ()=>{
        S.product = S.product || {};
        S.product.version = el.querySelector('#pr-version').value.trim() || '0.1-prototype';
        S.product.build = +el.querySelector('#pr-build').value || S.product.build || 1;
        S.product.notes = el.querySelector('#pr-notes').value.split('\n').map(s=>s.trim()).filter(Boolean);
        /* Синхронизация version.json — файл отражает настройки продукта */
        try{
          const vj = { version: S.product.version, build: S.product.build, released: new Date().toISOString(), critical: false, notes: S.product.notes };
          fetch('version.json', { method:'PUT', body: JSON.stringify(vj, null, 2) }).catch(()=>{});
        }catch(e){}
        syncChangelogProduct();
        logAudit('Продукт: версия/патчноуты обновлены', 'Настройки');
        saveState(); toast('Продукт обновлён', 'ok'); APP.render();
      };
    }
    function bindSection(sec, el){
      if (sec==='keys'){
        /* Переназначение: клик по комбинации → поймать нажатие → сохранить */
        let listenStopped = false;
        $$('[data-key]', el).forEach(btn => {
          btn.onclick = e => {
            e.stopPropagation();
            if (listenStopped && btn.__listening){ btn.__listening = false; btn.classList.remove('recording'); return; }
            btn.__listening = true;
            btn.classList.add('recording');
            btn.textContent = 'Нажмите комбинацию…';
            const id = btn.dataset.key;
            const capture = ev => {
              ev.preventDefault(); ev.stopPropagation();
              /* Esc — отмена переназначения */
              if (ev.key === 'Escape'){
                document.removeEventListener('keydown', capture, true);
                btn.__listening = false;
                btn.classList.remove('recording');
                btn.textContent = (S.keys && S.keys[id] || DEFAULT_KEYS[id] || '').split('+').map(p=>p==='space'?'SPACE':p.toUpperCase()).join(' + ');
                return;
              }
              const mods = [];
              if (ev.ctrlKey || ev.metaKey) mods.push('ctrl');
              if (ev.shiftKey) mods.push('shift');
              if (ev.altKey) mods.push('alt');
              let k = ev.key.toLowerCase();
              if (k === ' ') k = 'space';
              if (ev.altKey && k.startsWith('altgraph')) k = k.replace('altgraph', '');
              if (!/^[a-z0-9,.+=\-\[\]\\;'\/]$/.test(k) && k !== ' ' && k !== 'space') return; // одиночные клавиши
              const combo = [...mods, k].join('+');
              if (!mods.length){ toast('Нужны модификаторы (Ctrl/Shift/Alt)','warn'); return; }
              document.removeEventListener('keydown', capture, true);
              btn.__listening = false;
              btn.classList.remove('recording');
              S.keys = S.keys || {};
              S.keys[id] = combo;
              saveState();
              btn.textContent = combo.split('+').map(p=>p==='space'?'SPACE':p.toUpperCase()).join(' + ');
              /* Живая подсказка у поля поиска */
              const hint = document.getElementById('head-search-hint');
              if (hint && id === 'search') hint.textContent = fmtKeys(combo);
              toast('Горячая клавиша обновлена','ok');
            };
            document.addEventListener('keydown', capture, true);
          };
        });
        $$('[data-kreset]', el).forEach(btn => {
          btn.onclick = e => {
            e.stopPropagation();
            const id = btn.dataset.kreset;
            S.keys = S.keys || {};
            S.keys[id] = DEFAULT_KEYS[id];
            saveState();
            renderSec();
            const hint = document.getElementById('head-search-hint');
            if (hint && id === 'search') hint.textContent = fmtKeys(DEFAULT_KEYS[id]);
            toast('Сброшено к значению по умолчанию','ok');
          };
        });
        const btnAll = el.querySelector('[data-kreset-all]');
        if (btnAll) btnAll.onclick = () => {
          S.keys = { ...DEFAULT_KEYS };
          saveState(); renderSec();
          const hint = document.getElementById('head-search-hint');
          if (hint) hint.textContent = fmtKeys(DEFAULT_KEYS.search);
          toast('Все горячие клавиши сброшены','ok');
        };
        return;
      }
      if (sec==='profile'){
        $('#pf-avatar', el).onclick = ()=>$('#pf-avatar-file', el).click();
        $('#pf-avatar-file', el).onchange = e=>{
          const f = e.target.files[0]; if (!f) return;
          openAvatarCropper(f, webp => {
            u.avatar = webp;
            saveState(); toast('Аватар сохранён','ok'); renderSec(); APP.render();
          });
        };
        const pfClear = $('#pf-avatar-clear', el);
        if (pfClear) pfClear.onclick = ()=>{
          u.avatar = '';
          saveState(); toast('Аватар убран','ok'); renderSec(); APP.render();
        };
        $('#pf-avatar-preview', el).onclick = ()=>{
          if (!u.avatar) return;
          openWinModal({ title:u.full_name, narrow:true,
            body:`<div style="text-align:center"><img src="${u.avatar}" style="max-width:100%;border-radius:20px;max-height:50vh;box-shadow:var(--sh-2)"></div>`,
            footer:'<button class="btn btn--primary" data-x>Закрыть</button>',
            onMount:(m2,c2)=>{ m2.querySelector('[data-x]').onclick=c2; }
          });
        };
        /* Автосохранение: каждое изменение поля/переключателя применяется сразу,
           кнопка «Сохранить» не нужна. */
        const pfCommit = (what, extra) => {
          logAudit('Профиль: '+what, 'Профиль');
          saveState();
          if (extra) extra();
        };
        const pfInputs = [['#pf-name','full_name'],['#pf-email','email'],['#pf-phone','phone'],['#pf-about','about']];
        pfInputs.forEach(([sel,key])=>{
          const inp = $(sel, el);
          if (!inp) return;
          inp.addEventListener('input', ()=>{
            const v = inp.value.trim();
            if (key==='full_name') u.full_name = v || u.full_name;
            else if (key==='email') u.email = v || u.email;
            else if (key==='phone') u.phone = v || u.phone;
            else if (key==='about') u.about = v;
            pfCommit(key, ()=>APP && APP.render && requestAnimationFrame(APP.render));
            toast('Профиль сохранён','ok');
          });
        });
        /* Логин меняем аккуратно: только a-z, 0-9, точка, дефис, подчёркивание;
           проверяем занятость и не даём сохранить пустое/короткое. */
        const pfLogin = $('#pf-login', el);
        if (pfLogin){
          pfLogin.addEventListener('change', ()=>{
            const val = pfLogin.value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
            if (val.length < 3){ toast('Логин: минимум 3 символа (a-z, 0-9, . _ -)','err'); pfLogin.value = u.username || ''; return; }
            if (val === (u.username || '')){ pfLogin.value = val; return; }
            if (S.users.some(x => x.id !== u.id && norm(x.username) === val)){ toast('Этот логин уже занят','err'); pfLogin.value = u.username || ''; return; }
            u.username = val;
            pfLogin.value = val;
            pfCommit('логин «'+val+'»', ()=>APP && APP.render && requestAnimationFrame(APP.render));
            toast('Логин изменён','ok');
          });
        }
        /* Черновики заказов: автосохранение, вопрос при закрытии, очистка */
        const draftAuto = $('#draft-auto', el);
        if (draftAuto){
          draftAuto.addEventListener('change', ()=>{
            prefsFor().autoDraft = draftAuto.checked;
            if (!draftAuto.checked){ try { if (window.DraftsDB) DraftsDB.del('order-form'); else if (DraftsDB) DraftsDB.del('order-form'); } catch(e){ } }
            logAudit('Черновики заказов: '+(draftAuto.checked?'вкл':'выкл'), 'Настройки');
            saveState(); renderDraftStatus();
            toast(draftAuto.checked ? 'Черновики включены' : 'Черновики выключены, сохранённый удалён', 'ok');
          });
        }
        const draftAsk = $('#draft-ask', el);
        if (draftAsk){
          draftAsk.addEventListener('change', ()=>{
            prefsFor().noAskDraft = !draftAsk.checked;
            logAudit('Вопрос о черновике: '+(draftAsk.checked?'вкл':'выкл'), 'Настройки');
            saveState();
            toast(draftAsk.checked ? 'Вопрос при закрытии включён' : 'Вопрос отключён — черновик сохраняется всегда', 'ok');
          });
        }
        const draftClear = $('#draft-clear', el);
        if (draftClear) draftClear.onclick = ()=>{ try { if (window.DraftsDB) DraftsDB.del('order-form'); else if (DraftsDB) DraftsDB.del('order-form'); } catch(e){} renderDraftStatus(); toast('Черновик очищен','ok'); };
        const renderDraftStatus = ()=>{
          const actions = $('#draft-actions', el);
          const last = $('#draft-last', el);
          if (!actions) return;
          DraftsDB && DraftsDB.get('order-form').then(d=>{
            if (d && d.val){
              actions.hidden = false;
              if (last) last.textContent = 'Черновик от ' + fmtDT(d.t);
            } else {
              actions.hidden = true;
            }
          }).catch(()=>{ actions.hidden = true; });
        };
        window.__renderDraftStatus = renderDraftStatus;
        renderDraftStatus();
        $$('#pf-ws button', el).forEach(b=>b.onclick=()=>{
          u.ext = u.ext || {};
          u.ext.workStatus=b.dataset.w;
          /* Рабочий статус управляет сетевым: «Не работаю» = офлайн,
             «Работаю» = онлайн. Раньше пользователь оставался «в сети». */
          u.is_online = (b.dataset.w === 'working');
          logAudit(`Рабочий статус: ${u.full_name} → ${b.dataset.w==='working'?'Работаю':'Не работаю'}`, 'Профиль');
          saveState(); renderSec(); updateSideAvatar();
        });
      }
      if (sec==='look'){
        const markSel = () => {
          el.querySelectorAll('#lk-mode button').forEach(b=>b.classList.toggle('on', b.dataset.m === (u.mode||'system')));
          el.querySelectorAll('[data-accent]').forEach(c=>c.classList.toggle('on', c.dataset.accent === (u.accent||'violet')));
        };
        el.querySelectorAll('#lk-mode button').forEach(b=>b.onclick = ()=>{
          u.mode = b.dataset.m; saveState(); applyTheme(u.mode, u.accent);
          logAudit(`Тема: ${MODE_LABEL[u.mode]}`, 'Настройки');
          toast(`Тема: ${MODE_LABEL[u.mode]}`, 'ok');
          markSel(); refreshBgThemes(); /* перерисовываем фоны под новый режим */
        });
        el.querySelectorAll('[data-accent]').forEach(c=>c.onclick = ()=>{
          u.accent = c.dataset.accent; saveState(); applyTheme(u.mode, u.accent);
          logAudit(`Акцент: ${ACCENT_LABEL[u.accent||'violet']}`, 'Настройки');
          toast(`Акцент: ${ACCENT_LABEL[u.accent||'violet']}`, 'ok');
          markSel(); refreshBgThemes();
        });
        const customApply = el.querySelector('#lk-custom-apply');
        if (customApply) customApply.onclick = () => {
          const hex = el.querySelector('#lk-custom-color').value;
          if (!/^#[0-9a-fA-F]{6}$/.test(hex)) { toast('Некорректный цвет','warn'); return; }
          S.settings.customAccentColor = hex;
          u.accent = 'custom'; saveState(); applyTheme(u.mode, u.accent);
          logAudit('Акцент: свой цвет '+hex, 'Настройки');
          toast('Свой цвет применён','ok'); markSel(); refreshBgThemes();
        };
        const noAnim = el.querySelector('#lk-noanim');
        if (noAnim) noAnim.onchange = e=>{
          S.settings.noAnim = e.target.checked;
          document.body.classList.toggle('no-anim', e.target.checked);
          logAudit('Анимации: '+(e.target.checked?'отключены':'включены'), 'Настройки');
          saveState(); toast(e.target.checked?'Анимации отключены':'Анимации включены','ok');
        };
        const appBgSel = el.querySelector('#lk-appbg');
        if (appBgSel) appBgSel.querySelectorAll('[data-bg]').forEach(btn=>btn.onclick = ()=>{
          const v = btn.dataset.bg;
          S.settings.appBg = v;
          S.settings.appBgDoodles = (v === 'doodle');
          logAudit(`Фон приложения: ${({none:'без фона', doodle:'дудлы'})[v]||v}`, 'Настройки');
          saveState(); applyAppBg();
          /* Без APP.render(): полная перерисовка давала вспышку на заставке/входе.
             Слой узора на экране входа добавляем/убираем на месте. */
          try {
            const auth = document.querySelector('.auth');
            const layer = document.querySelector('.auth__doodles');
            if (auth && v === 'none' && layer) layer.remove();
            if (auth && v !== 'none' && !layer) auth.insertAdjacentHTML('afterbegin', '<div class="auth__doodles" aria-hidden="true"></div>');
          } catch(e){}
          appBgSel.querySelectorAll('[data-bg]').forEach(b=>b.classList.toggle('on', b.dataset.bg===v));
          toast(`Фон приложения: ${({none:'выключен', doodle:'дудлы'})[v]||v}`,'ok');
        });
      }
      if (sec==='reminders'){
        /* --- Умный планировщик (ToDo) --- */
        const tdAdd = el.querySelector('#td-add');
        if (tdAdd) tdAdd.onclick = ()=>{
          const t = el.querySelector('#td-text').value.trim();
          if (!t){ toast('Введите задачу','warn'); return; }
          const prio = +el.querySelector('#td-prio').value || 3;
          S.todos = S.todos || [];
          S.todos.push({ id:uid(), owner_id:u.id, text:t, prio, done:false, created_at:Date.now() });
          saveState(); toast('Задача добавлена','ok'); renderSec();
        };
        const tdText = el.querySelector('#td-text');
        if (tdText) tdText.addEventListener('keydown', e=>{ if (e.key==='Enter') tdAdd && tdAdd.click(); });
        el.querySelectorAll('[data-td-preset]').forEach(ch=>ch.onclick=()=>{
          const inp = el.querySelector('#td-text');
          if (inp) inp.value = ch.dataset.tdPreset;
          if (tdAdd) tdAdd.click();
        });
        el.querySelectorAll('[data-td-done]').forEach(b=>b.onclick=()=>{
          const t = (S.todos||[]).find(x=>x.id===b.dataset.tdDone);
          if (t){ t.done = true; saveState(); renderSec(); toast('Задача выполнена','ok'); }
        });
        el.querySelectorAll('[data-td-del]').forEach(b=>b.onclick=()=>{
          S.todos = (S.todos||[]).filter(x=>x.id!==b.dataset.tdDel);
          saveState(); renderSec();
        });
        /* Массовое закрытие: выбранная группа задач или все открытые разом */
        const tdBulkChecks = ()=>Array.from(el.querySelectorAll('[data-td-check]')).filter(c=>!c.disabled);
        const tdSelAll = el.querySelector('#td-sel-all');
        const tdSelCnt = el.querySelector('#td-sel-cnt');
        const tdCloseSel = el.querySelector('#td-close-sel');
        const tdCloseAll = el.querySelector('#td-close-all');
        const syncTdBulk = ()=>{
          const checks = tdBulkChecks();
          const n = checks.filter(c=>c.checked).length;
          if (tdSelCnt) tdSelCnt.textContent = n ? `Выбрано: ${n}` : '';
          if (tdCloseSel) tdCloseSel.disabled = !n;
          if (tdSelAll){
            tdSelAll.checked = checks.length > 0 && n === checks.length;
            tdSelAll.indeterminate = n > 0 && n < checks.length;
          }
        };
        tdBulkChecks().forEach(c=>c.onchange = syncTdBulk);
        if (tdSelAll) tdSelAll.onchange = ()=>{
          tdBulkChecks().forEach(c=>c.checked = tdSelAll.checked);
          syncTdBulk();
        };
        if (tdCloseSel) tdCloseSel.onclick = ()=>{
          const ids = new Set(tdBulkChecks().filter(c=>c.checked).map(c=>c.value));
          if (!ids.size) return;
          (S.todos||[]).forEach(t=>{ if (t.owner_id===u.id && ids.has(t.id)) t.done = true; });
          saveState(); toast(`Закрыто задач: ${ids.size}`,'ok'); renderSec();
        };
        if (tdCloseAll) tdCloseAll.onclick = ()=>{
          const open = (S.todos||[]).filter(t=>t.owner_id===u.id && !t.done);
          if (!open.length) return;
          open.forEach(t=>{ t.done = true; });
          saveState(); toast(`Закрыто задач: ${open.length}`,'ok'); renderSec();
        };
        syncTdBulk();
        /* ToDo → ИИ: показываем готовый Markdown, копируем или скачиваем */
        const tdExp = el.querySelector('[data-td-exp]');
        if (tdExp) tdExp.onclick = ()=>{
          const text = todoExportText(u);
          const iso = new Date().toISOString().slice(0,10);
          const fileName = `todo-${u.username || 'me'}-${iso}.md`;
          openWinModal({
            title:'Экспорт ToDo для ИИ', icon:'export', narrow:true,
            body:`<div class="stack" style="gap:10px">
              <p class="small muted" style="margin:0">Шапка, приоритеты и задание для ассистента. Скопируйте в чат или скачайте файл — вернуть список можно через «Импорт».</p>
              <textarea class="input" id="td-exp-text" rows="11" readonly spellcheck="false" style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.5"></textarea>
            </div>`,
            footer:`<button class="btn btn--ghost" data-x>Закрыть</button><button class="btn btn--ghost" id="td-exp-copy">${icon('copy')} Скопировать</button><button class="btn btn--primary" id="td-exp-dl">${icon('export')} Скачать .md</button>`,
            onMount:(host)=>{
              const ta = host.querySelector('#td-exp-text');
              if (ta) ta.value = text;
              const copyBtn = host.querySelector('#td-exp-copy');
              if (copyBtn) copyBtn.onclick = ()=>{
                const ok = ()=> toast('ToDo скопирован для ИИ','ok');
                if (navigator.clipboard && navigator.clipboard.writeText){
                  navigator.clipboard.writeText(text).then(ok, ()=>{
                    if (ta){ ta.select(); try { document.execCommand('copy'); } catch(e){} ok(); }
                  });
                } else if (ta){
                  ta.select(); try { document.execCommand('copy'); } catch(e){} ok();
                }
              };
              const dl = host.querySelector('#td-exp-dl');
              if (dl) dl.onclick = ()=>{
                const blob = new Blob([text], { type:'text/markdown;charset=utf-8' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob); a.download = fileName;
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
                logAudit('Экспорт ToDo для ИИ','Планировщик');
                toast('Файл ToDo скачан','ok');
              };
            }
          });
        };
        /* ИИ → ToDo: вставка текста или файл, повторы не добавляются */
        const tdImp = el.querySelector('[data-td-imp]');
        if (tdImp) tdImp.onclick = ()=>{
          openWinModal({
            title:'Импорт ToDo', icon:'import', narrow:true,
            body:`<div class="stack" style="gap:10px">
              <p class="small muted" style="margin:0">Вставьте список задач — текст, Markdown или JSON. Подойдёт и ответ ИИ, и файл экспорта. Повторы не добавляются.</p>
              <textarea class="input" id="td-imp-text" rows="9" spellcheck="false" placeholder="- [ ] (P2) Позвонить клиенту"></textarea>
              <div class="row row--between" style="gap:8px;flex-wrap:wrap">
                <label class="btn btn--ghost btn--sm" style="cursor:pointer">${icon('file','ico-sm')} Выбрать файл<input type="file" id="td-imp-file" accept=".md,.markdown,.txt,.json" hidden></label>
                <span class="small faint" id="td-imp-cnt">Задач не найдено</span>
              </div>
            </div>`,
            footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" id="td-imp-go" disabled>Добавить</button>`,
            onMount:(host, close)=>{
              const ta = host.querySelector('#td-imp-text');
              const go = host.querySelector('#td-imp-go');
              const cnt = host.querySelector('#td-imp-cnt');
              const existing = new Set((S.todos||[]).filter(t=>t.owner_id===u.id).map(t=>todoNorm(t.text)));
              let parsed = [];
              const fresh = ()=> parsed.filter(x=>!existing.has(todoNorm(x.text)));
              const refresh = ()=>{
                parsed = todoParseImport(ta ? ta.value : '');
                const list = fresh();
                if (go) go.disabled = !list.length;
                if (cnt){
                  const dup = parsed.length - list.length;
                  cnt.textContent = !parsed.length ? 'Задач не найдено'
                    : `Найдено: ${parsed.length}${dup ? ` · уже есть: ${dup}` : ''}`;
                }
              };
              if (ta) ta.addEventListener('input', refresh);
              refresh();
              const file = host.querySelector('#td-imp-file');
              if (file) file.onchange = ()=>{
                const f = file.files && file.files[0];
                if (!f) return;
                const rd = new FileReader();
                rd.onload = ()=>{ if (ta){ ta.value = String(rd.result || ''); refresh(); toast('Файл прочитан','ok'); } };
                rd.onerror = ()=> toast('Не удалось прочитать файл','err');
                rd.readAsText(f, 'utf-8');
              };
              if (go) go.onclick = ()=>{
                const list = fresh();
                if (!list.length) return;
                S.todos = S.todos || [];
                list.forEach(x=>{
                  S.todos.push({ id:uid(), owner_id:u.id, text:x.text, prio:x.prio, done:x.done, created_at:Date.now() });
                  existing.add(todoNorm(x.text));
                });
                const added = list.length, skipped = parsed.length - added;
                saveState();
                logAudit(`Импорт ToDo: добавлено ${added}${skipped ? `, пропущено ${skipped}` : ''}`,'Планировщик');
                close && close();
                renderSec();
                toast(`Добавлено задач: ${added}${skipped ? ` · пропущено: ${skipped}` : ''}`,'ok');
              };
            }
          });
        };
        /* --- Напоминания --- */
        const add = el.querySelector('#rm-add');
        if (add) add.onclick = ()=>{
          const t = el.querySelector('#rm-text').value.trim();
          const atVal = el.querySelector('#rm-at').value;
          if (!t || !atVal){ toast('Заполните текст и время','warn'); return; }
          const at = new Date(atVal).getTime();
          if (!isFinite(at)){ toast('Некорректное время','err'); return; }
          S.reminders = S.reminders || [];
          const repSel = el.querySelector('#rm-repeat');
          S.reminders.push({ id:uid(), owner_id:u.id, text:t, at, repeat: repSel ? repSel.value : 'none',
            notify: el.querySelector('#rm-notify').checked, done:false, fired:false, created_at:Date.now() });
          saveState(); toast('Напоминание добавлено','ok'); renderSec();
        };
        el.querySelectorAll('[data-rm-done]').forEach(b=>b.onclick=()=>{
          const r = (S.reminders||[]).find(x=>x.id===b.dataset.rmDone);
          if (r){ r.done = true; saveState(); renderSec(); toast('Отмечено выполненным','ok'); }
        });
        el.querySelectorAll('[data-rm-del]').forEach(b=>b.onclick=()=>{
          S.reminders = (S.reminders||[]).filter(x=>x.id!==b.dataset.rmDel);
          saveState(); renderSec();
        });
        el.querySelectorAll('[data-rm-skip]').forEach(b=>b.onclick=()=>{
          const r = (S.reminders||[]).find(x=>x.id===b.dataset.rmSkip);
          if (r && r.repeat && r.repeat !== 'none'){
            const nx = nextRepeatAt(r.at, r.repeat);
            if (nx){ r.at = nx; r.fired = false; saveState(); toast('Срок пропущен, следующий: '+new Date(nx).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}),'ok'); renderSec(); }
          }
        });
      }
      if (sec==='notify'){
        $('#nf-marketing', el).onchange = e=>{ u.consent_marketing = e.target.checked; logAudit(`Рассылки: ${e.target.checked?'включены':'отключены'}`,'Рассылки'); saveState(); toast(e.target.checked?'Подписка подтверждена':'Рассылки отключены','ok'); };
        $('#nf-unsub-all', el).onclick = async ()=>{
          const ok = await confirmModal({ title:'Отписаться от всех рассылок?', okText:'Отписаться', danger:true, text:'Маркетинговые письма и push прекратятся. Системные уведомления продолжат работать.' });
          if (ok){ u.consent_marketing = false; logAudit('Отписка от всех рассылок','Рассылки'); saveState(); toast('Вы отписаны от всех рассылок','ok'); APP.render(); }
        };
        $$('[data-chat-mute]', el).forEach(sw=>sw.onchange=()=>toast(sw.checked?'Уведомления чата включены':'Чат в режиме «Не беспокоить»','info'));
      }
      if (sec==='security'){
        $('#sec-revoke', el).onclick = async ()=>{
          const ok = await confirmModal({ title:'Завершить все сессии?', okText:'Завершить', danger:true, text:'Все токены будут аннулированы, кроме текущей сессии.' });
          if (ok){ logAudit('Все сессии завершены','Безопасность'); toast('Другие сессии завершены','ok'); }
        };
        $('#sec-2fa', el).onclick = ()=>wipModal('Двухфакторная аутентификация');
      }
      if (sec==='about'){
        bindAboutWindow(el, u);
        const ab = $('#ab-open', el);
        if (ab) ab.onclick = ()=>openAboutWin();
      }
      if (sec==='docs'){
        /* Аккордеон документов: клик по шапке переключает класс .open.
           Обратная анимация (сворачивание) идёт через CSS transition по
           max-height — плавно в обе стороны. */
        el.querySelectorAll('.doc-acc').forEach(acc => {
          const sum = acc.querySelector('.summary');
          if (!sum) return;
          const toggle = () => {
            acc.classList.toggle('open');
          };
          sum.addEventListener('click', toggle);
          sum.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
          });
        });
                /* Раскрывающийся доступ: чекбоксы с плавной анимацией */
        el.querySelectorAll('[data-doc-access]').forEach(btn=>{
          btn.onclick = ()=>{
            const box = el.querySelector('[data-doc-roles-box="' + btn.dataset.docAccess + '"]');
            if (!box) return;
            const open = box.classList.toggle('open');
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
          };
        });
        el.querySelectorAll('[data-doc-role]').forEach(cb => cb.onchange = ()=>{
          const i = +cb.dataset.docIdx;
          const doc = S.settings.documents[i];
          if (!doc) return;
          const acc = cb.closest('.doc-acc');
          const checked = acc ? [...acc.querySelectorAll('[data-doc-role]')].filter(x=>x.checked).map(x=>x.dataset.docRole) : [];
          doc.roles = checked;
          saveState();
          /* Подпись на кнопке «Доступ: …» — всегда актуальная: вместо «все»
             показываем выбранные роли/вариант, когда они есть. */
          try {
            const btn = acc && acc.querySelector('.doc-access');
            if (btn){
              const lb = btn.querySelector('b');
              if (lb) lb.textContent = checked.length ? docRolesLabel(doc) : 'все';
            }
          } catch(e){}
          logAudit('Доступ к документу «' + doc.title + '»: ' + (checked.length ? docRolesLabel(doc) : 'все'), 'Документы');
          toast('Доступ обновлён','ok');
        });
        el.querySelectorAll('[data-edit-doc]').forEach(btn=>btn.onclick = ()=>{
          const i = +btn.dataset.editDoc;
          const doc = S.settings.documents[i];
          if (!doc) return;
          openWinModal({ narrow:true, title:'Редактировать документ', route:'docs',
            body:`<div class="stack" style="gap:12px">
              <div class="field"><label>Название</label><input class="input" id="dc-title" value="${esc(doc.title)}"></div>
              <div class="field"><label>Содержание</label><textarea class="input" id="dc-body" rows="6">${esc(doc.body)}</textarea></div>
              <div id="dc-media"></div>
              <div class="field"><label>Вложение (скриншот или видео)</label>
                <label class="file-btn" for="dc-file">${icon('clip')} <span>Прикрепить</span></label>
                <input type="file" id="dc-file" accept="image/*,video/*" hidden>
                <p class="small faint" style="margin-top:5px">Медиа подставляется в текст по токену: вставьте <span class="mono">[[m:0]]</span>, <span class="mono">[[m:1]]</span>… где нужно.</p>
              </div>
            </div>`,
            footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-save>Сохранить</button>`,
            onMount:(m2,c2)=>{
              const media = (doc.media||[]).slice();
              const mediaBox = m2.querySelector('#dc-media');
              const fInp = m2.querySelector('#dc-file');
              const drawMedia = ()=>{
                mediaBox.innerHTML = media.length ? `<div class="stack" style="gap:6px">${media.map((m,j)=>`
                  <div class="rp-file-row" style="gap:8px">${m.type.startsWith('video/')
                    ? `<video src="${m.src}" muted style="max-height:46px;max-width:64px;border-radius:6px">`
                    : `<img src="${m.src}" style="max-height:46px;max-width:64px;border-radius:6px;object-fit:cover">`}
                    <span class="mono small">[[m:${j}]]</span><span class="small faint">${esc(m.name)}</span>
                    <span class="spacer"></span><button class="iconbtn" title="Убрать">${icon('x','ico-sm')}</button>
                  </div>`).join('')}</div>` : '<span class="small faint">Нет вложений</span>';
                mediaBox.querySelectorAll('button').forEach((b,j)=>b.onclick=()=>{ media.splice(j,1); drawMedia(); });
              };
              drawMedia();
              if (fInp) fInp.addEventListener('change', ()=>{
                [...(fInp.files||[])].forEach(f=>{
                  if (f.size > 6*1024*1024){ toast('Медиа слишком большое (>6 МБ)','warn'); return; }
                  const fr = new FileReader();
                  fr.onload = ()=>{ media.push({ name:f.name, type:f.type, src:String(fr.result) }); drawMedia(); };
                  fr.readAsDataURL(f);
                });
                fInp.value = '';
              });
              m2.querySelector('[data-x]').onclick=c2; m2.querySelector('[data-save]').onclick=()=>{
              const newTitle = m2.querySelector('#dc-title').value.trim() || doc.title;
              const newBody = m2.querySelector('#dc-body').value;
              const pay = { title:newTitle, body:newBody, media: media.length ? media : undefined };
              if (user().role === 'admin'){
                S.settings.documents[i].title = pay.title;
                S.settings.documents[i].body = pay.body;
                S.settings.documents[i].media = pay.media;
                logAudit('Документ обновлён: '+newTitle, 'Документы');
                saveState(); c2(); renderSec(); toast('Документ сохранён','ok');
                return;
              }
              /* Не-админ: правка уходит на согласование, документ не меняется */
              docRequests().unshift({
                id:uid(), kind:'edit', docIndex:i, docTitle:doc.title,
                title:newTitle, body:newBody, prevTitle:doc.title, prevBody:doc.body,
                authorId:user().id, authorName:user().full_name,
                created_at:Date.now(), status:'pending'
              });
              notifyAdmins(`Заявка на правку документа «${doc.title}»`,
                `${user().full_name} предлагает изменения — требуется согласование администратора`);
              logAudit(`Заявка на правку документа: ${doc.title}`, 'Документы');
              saveState(); c2(); renderSec();
              toast('Правка отправлена администратору на согласование','ok');
            }; }
          });
        });
        /* Удаление документа: админ удаляет сразу, остальные — через заявку */
        el.querySelectorAll('[data-del-doc]').forEach(btn=>btn.onclick = async ()=>{
          const i = +btn.dataset.delDoc;
          const doc = S.settings.documents[i];
          if (!doc) return;
          if (user().role === 'admin'){
            const ok = await confirmModal({ title:`Удалить документ «${doc.title}»?`, danger:true, okText:'Удалить',
              text:'Документ исчезнет из справки. Отменить действие нельзя.' });
            if (!ok) return;
            S.settings.documents.splice(i,1);
            logAudit('Документ удалён: '+doc.title, 'Документы');
            saveState(); renderSec(); toast('Документ удалён','ok');
            return;
          }
          /* Менеджер: заявка на удаление — решает администратор */
          docRequests().unshift({
            id:uid(), kind:'delete', docIndex:i, docTitle:doc.title,
            title:doc.title, body:'', prevTitle:doc.title, prevBody:doc.body,
            authorId:user().id, authorName:user().full_name,
            created_at:Date.now(), status:'pending'
          });
          notifyAdmins(`Заявка на удаление документа «${doc.title}»`,
            `${user().full_name} предлагает удалить документ — требуется согласование администратора`);
          logAudit(`Заявка на удаление документа: ${doc.title}`, 'Документы');
          saveState(); renderSec();
          toast('Заявка на удаление отправлена администратору','ok');
        });
        /* Одобрение / отклонение заявок (только админ видит кнопки) */
        el.querySelectorAll('[data-doc-approve]').forEach(btn=>btn.onclick = ()=>{
          const r = docRequests().find(x => x.id === btn.dataset.docApprove);
          if (!r || r.status !== 'pending') return;
          if (r.kind === 'delete'){
            const idx = S.settings.documents.findIndex(d => d.title === r.docTitle);
            if (idx >= 0) S.settings.documents.splice(idx,1);
          } else if (r.kind === 'create') S.settings.documents.push({ title:r.title, body:r.body });
          else {
            const target = S.settings.documents[r.docIndex];
            if (target){ target.title = r.title; target.body = r.body; }
          }
          r.status = 'approved'; r.decidedAt = Date.now(); r.decidedBy = user().full_name;
          logAudit(`Правка документа одобрена: ${r.title}`, 'Документы');
          saveState(); renderSec(); toast('Правка применена к документу','ok');
        });
        el.querySelectorAll('[data-doc-reject]').forEach(btn=>btn.onclick = ()=>{
          const r = docRequests().find(x => x.id === btn.dataset.docReject);
          if (!r || r.status !== 'pending') return;
          r.status = 'rejected'; r.decidedAt = Date.now(); r.decidedBy = user().full_name;
          logAudit(`Правка документа отклонена: ${r.title}`, 'Документы');
          saveState(); renderSec(); toast('Заявка отклонена','ok');
        });
        const docAdd = el.querySelector('#doc-add');
        if (docAdd) docAdd.onclick = ()=>{
          openWinModal({ narrow:true, title:'Новый документ', route:'docs',
            body:`<div class="stack" style="gap:12px">
              <div class="field"><label>Название</label><input class="input" id="dc-title" placeholder="Название документа"></div>
              <div class="field"><label>Содержание</label><textarea class="input" id="dc-body" rows="6" placeholder="Текст…"></textarea></div>
              <div id="dc-media"></div>
              <div class="field"><label>Вложение (скриншот или видео)</label>
                <label class="file-btn" for="dc-file">${icon('clip')} <span>Прикрепить</span></label>
                <input type="file" id="dc-file" accept="image/*,video/*" hidden>
                <p class="small faint" style="margin-top:5px">Медиа подставляется в текст по токену: вставьте <span class="mono">[[m:0]]</span>, <span class="mono">[[m:1]]</span>… где нужно.</p>
              </div>
              <div class="field"><label>Доступ</label>
                <div class="stack" style="gap:4px">${ALL_DOC_ROLES.map(r=>`<label class="check" style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" class="dc-role" value="${r.id}"><span class="box"><svg><use href="#i-check-c"/></svg></span><span class="small">${esc(r.label)}</span></label>`).join('')}</div>
                <p class="small faint" style="margin-top:6px">Ничего не выбрано — документ увидят все роли.</p>
              </div>
            </div>`,
            footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-save>Добавить</button>`,
            onMount:(m2,c2)=>{
              const media = [];
              const mediaBox = m2.querySelector('#dc-media');
              const fInp = m2.querySelector('#dc-file');
              const drawMedia = ()=>{
                mediaBox.innerHTML = media.length ? `<div class="stack" style="gap:6px">${media.map((m,j)=>`
                  <div class="rp-file-row" style="gap:8px">${m.type.startsWith('video/')
                    ? `<video src="${m.src}" muted style="max-height:46px;max-width:64px;border-radius:6px">`
                    : `<img src="${m.src}" style="max-height:46px;max-width:64px;border-radius:6px;object-fit:cover">`}
                    <span class="mono small">[[m:${j}]]</span><span class="small faint">${esc(m.name)}</span>
                    <span class="spacer"></span><button class="iconbtn" title="Убрать">${icon('x','ico-sm')}</button>
                  </div>`).join('')}</div>` : '<span class="small faint">Нет вложений</span>';
                mediaBox.querySelectorAll('button').forEach((b,j)=>b.onclick=()=>{ media.splice(j,1); drawMedia(); });
              };
              drawMedia();
              if (fInp) fInp.addEventListener('change', ()=>{
                [...(fInp.files||[])].forEach(f=>{
                  if (f.size > 6*1024*1024){ toast('Медиа слишком большое (>6 МБ)','warn'); return; }
                  const fr = new FileReader();
                  fr.onload = ()=>{ media.push({ name:f.name, type:f.type, src:String(fr.result) }); drawMedia(); };
                  fr.readAsDataURL(f);
                });
                fInp.value = '';
              });
              m2.querySelector('[data-x]').onclick=c2; m2.querySelector('[data-save]').onclick=()=>{
              const t = m2.querySelector('#dc-title').value.trim();
              const body = m2.querySelector('#dc-body').value;
              const roles = [...m2.querySelectorAll('.dc-role')].filter(x=>x.checked).map(x=>x.value);
              if (!t){ toast('Введите название','warn'); return; }
              if (user().role === 'admin'){
                S.settings.documents.push({ title:t, body, media: media.length ? media : undefined, roles: roles.length ? roles : undefined });
                logAudit('Документ добавлен: '+t + (roles.length ? ' (доступ: '+roles.join(', ')+')' : ' (все)'), 'Документы');
                saveState(); c2(); renderSec(); toast('Документ добавлен','ok');
                return;
              }
              docRequests().unshift({
                id:uid(), kind:'create', docTitle:t,
                title:t, body, roles: roles.length ? roles : undefined, prevTitle:'', prevBody:'',
                authorId:user().id, authorName:user().full_name,
                created_at:Date.now(), status:'pending'
              });
              notifyAdmins(`Заявка на новый документ «${t}»`,
                `${user().full_name} предлагает добавить документ — требуется согласование администратора`);
              logAudit(`Заявка на новый документ: ${t}`, 'Документы');
              saveState(); c2(); renderSec();
              toast('Документ отправлен администратору на согласование','ok');
            }; }
          });
        };
      }
      if (sec==='data'){
        const mres = el.querySelector('#dt-menu-reset');
        if (mres) mres.onclick = () => {
          NAV = JSON.parse(JSON.stringify(NAV_DEFAULT));
          window.NAV = NAV;
          delete prefsFor().navCustom; delete prefsFor().navCustomOrder;
          saveState(); toast('Меню сброшено к заводским настройкам','ok'); APP.render();
        };
        $('#dt-backup', el).onclick = ()=>{
          S.backups.unshift({ name:`aw-backup-${new Date().toISOString().slice(0,16).replace(/[T:]/g,'-')}.sql.gz`, type:'manual', t:Date.now() });
          logAudit('Создан ручной бекап','Бекап'); saveState(); toast('Бекап создан','ok'); renderSec();
        };
        $('#dt-reset', el).onclick = async ()=>{
          const ok = await confirmModal({ title:'Сбросить демо-данные?', okText:'Сбросить', danger:true, text:'Будет создан полный бекап, затем данные вернутся к исходным.' });
          if (ok){
            S.backups.unshift({ name:`pre-reset-${Date.now()}.sql.gz`, type:'auto', t:Date.now() });
            saveState();
            localStorage.removeItem(LS_KEY);
            S = seedState(); saveState();
            toast('Данные сброшены, бекап сохранён','ok');
            setTimeout(()=>location.reload(), 600);
          }
        };
      }
    }
  }

  /* ---------- Страницы ошибок ---------- */
  function errView(root, code){
    const texts = {
      '404': ['Страница не найдена','Такой страницы нет — возможно, её перенесли или ссылка устарела.'],
      '403': ['Доступ запрещён','У вашей роли нет прав на этот раздел. Обратитесь к администратору.'],
      '500': ['Что-то сломалось, но мы уже чиним','Критическая ошибка зафиксирована: инцидент #ERR-4821. Менеджеры получили уведомление.'],
      'ddos': ['Проверка активности','Обнаружена чрезмерная частота запросов. Подтвердите, что вы человек — проверка завершится автоматически.']
    };
    const [t, d] = texts[code] || texts['404'];
    root.innerHTML = `<div class="err-page">
      <div class="err-code">${code==='ddos'?'DDoS':esc(code)}</div>
      <h2>${t}</h2><p>${d}</p>
      ${code==='ddos'?`<div class="progress" style="max-width:260px;margin-top:10px"><span id="ddos-bar" style="width:0%"></span></div><span class="small faint" id="ddos-cnt">3</span>`:''}
      <div class="row" style="margin-top:16px">
        <button class="btn btn--primary" onclick="location.hash='#/dash'">${icon('home')} На главную</button>
        ${code==='404'?`<button class="btn btn--ghost" onclick="APP.openPalette&&openPalette()">${icon('search')} Поиск</button>`:''}
      </div></div>`;
    if (code==='ddos'){
      let n = 3;
      const bar = $('#ddos-bar', root), cnt = $('#ddos-cnt', root);
      const iv = setInterval(()=>{
        n -= 0.1; bar.style.width = ((3-n)/3*100)+'%';
        if (n<=0){ clearInterval(iv); cnt.textContent = 'проверка пройдена ✓'; setTimeout(()=>go('dash'), 700); }
        else cnt.textContent = Math.ceil(n);
      }, 100);
    }
  }

  /* ---------- Документы (для футера) ---------- */
  function docsView(root){ settingsView(root, 'docs'); }

  /* ---------- PWA: регистрация, обновления, офлайн ---------- */
  let swReg = null;
  /* Запрет правого клика мыши глобально — разрешён только в зонах собственных контекстных меню */
document.addEventListener('contextmenu', e => {
  if (e.target.closest('.side__nav')) return; /* меню: своё контекстное меню (в любом состоянии) */
  if (e.target.closest('[data-ctx="order"]') || e.target.closest('.kanban') || e.target.closest('.tbl-wrap')) return;
  e.preventDefault();
  return false;
});
function initPWA(){
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').then(reg=>{
      swReg = reg;
      reg.addEventListener('updatefound', ()=>{
        const nw = reg.installing;
        nw && nw.addEventListener('statechange', ()=>{ if (nw.state==='installed' && navigator.serviceWorker.controller) notifyUpdate(); });
      });
    }).catch(()=>{ /* file:// — SW недоступен, приложение работает локально */ });
  }
  function notifyUpdate(){
    toast('Новая версия загружена. Установить сейчас?', 'info', 'Доступно обновление', {
      action: {
        label:'Обновить',
        onClick:()=>{
          try { swReg && swReg.waiting && swReg.waiting.postMessage({type:'SKIP_WAITING'}); } catch(e){}
          setTimeout(()=>location.reload(), 300);
        }
      }
    });
  }
  async function checkUpdates(manual){
    if (!location.protocol.startsWith('http')){ if (manual) toast('Проверка обновлений доступна при запуске по http(s); при локальном файле приложение всегда актуально', 'info'); return; }
    try{
      const res = await fetch('version.json', { cache:'no-store' });
      const data = await res.json();
      /* Источник истины — S.product (настраивается админом); version.json отражает его.
         Если файл впереди (развёртывание новой версии) — предлагаем обновление. */
      const appV = (S.product && S.product.version) || '0.1-prototype';
      const serverV = data.version || appV;
      if (manual) toast(`Приложение актуально: ${serverV}`, 'info', 'Проверка обновлений');
      const known = localStorage.getItem('aw_seen_ver');
      if (known && known !== serverV) notifyUpdate();
      localStorage.setItem('aw_seen_ver', serverV);
    }catch(e){ if (manual) toast('Не удалось проверить обновления (нет сервера в демо-режиме)','warn'); }
  }

  /* ---------- Обновление сборки ----------
     Вкладка может остаться открытой со старым кодом (SPA + service worker),
     поэтому сверяем именно номер сборки: version.json читаем в обход кеша.
     Без этого после выкладки новой сборки пользователь видел прежнее поведение
     и справедливо считал, что ничего не исправлено. */
  async function checkBuild(){
    if (!location.protocol.startsWith('http')) return;
    try{
      const res = await fetch('version.json?_=' + Date.now(), { cache:'no-store' });
      const d = await res.json();
      const srv = Number(d && d.build || 0);
      const cur = Number(window.__BUILD_NUM__ || 0);
      if (!srv || !cur || srv <= cur) return;
      if (window.__buildNotified === srv) return;
      window.__buildNotified = srv;
      toast(`Открыта сборка ${cur}, на сервере уже ${srv}. Обновите страницу, чтобы увидеть изменения.`,
        'info', 'Доступно обновление', { action:{ label:'Обновить', onClick: hardReload } });
    }catch(e){}
  }
  async function hardReload(){
    try{
      if ('serviceWorker' in navigator){
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if (window.caches){
        const ks = await caches.keys();
        await Promise.all(ks.filter(k => k.startsWith('aw-')).map(k => caches.delete(k)));
      }
    }catch(e){}
    location.reload();
  }
  window.__checkBuild = checkBuild;

  /* ---------- Горячие клавиши ---------- */
  /* "ctrl+shift+f" → "Ctrl Shift F" (для подсказок) */
  function fmtKeys(combo){
    if (!combo) return '';
    return String(combo).split('+').filter(Boolean).map(p => p === 'space' ? 'SPACE' : p.toUpperCase()).join(' ');
  }
  /* Совпадение события с комбинацией вида "ctrl+shift+f".
     Ctrl и Meta (Cmd) считаются эквивалентными модификаторами. */
  function keyMatch(e, combo){
    if (!combo) return false;
    const parts = String(combo).toLowerCase().split('+').filter(Boolean);
    const key = parts.pop();
    const needC = parts.includes('ctrl'), needS = parts.includes('shift'),
          needA = parts.includes('alt'), needM = parts.includes('meta');
    /* Ctrl ⇄ Cmd: либо совпадает явно, либо любая из них при запросе ctrl */
    const hasPrimary = e.ctrlKey || e.metaKey;
    const wantPrimary = needC || needM;
    if (wantPrimary !== hasPrimary) return false;
    if (needS !== e.shiftKey) return false;
    if (needA !== e.altKey) return false;
    if (!needC && !needM && (e.ctrlKey || e.metaKey)) return false;
    let k = e.key.toLowerCase();
    if (k === ' ') k = 'space';
    return k === key;
  }
  const KEY_ACTIONS = {
    search: () => { if (user()){
      /* По ТЗ: вызов поиска по хоткею плавно проявляет плашки даже после
         полного раствора и сбрасывает эффект (точка отсчёта — новая позиция). */
      try { if (typeof window.__pillsReset === 'function') window.__pillsReset(); } catch(e){}
      /* В полноэкранном режиме (шапка скрыта) — палетка команд с размытым фоном. */
      if (document.body.classList.contains('zen')){ openPalette(); return; }
      const i = document.getElementById('head-search-input');
      /* Фокус после кадра, чтобы плашки успели плавно проявиться */
      setTimeout(() => { const el = document.getElementById('head-search-input'); if (el) el.focus(); }, 40);
      if (i) i.focus();
    } },
    newOrder: () => { if (user() && ['admin','top_manager','manager','client'].includes(user().role)){ if (window.runQuickSel) window.runQuickSel(); else CRM.openOrderForm(); } },
    settings: () => { if (user()) go('settings'); },
    theme: () => { if (user()) cycleTheme(); },
    zen: () => { if (user()) toggleZen(); }
  };
  function initKeys(){
    document.addEventListener('keydown', e=>{
      if (e.key==='Escape'){ closeDropdown(); closePalette(); return; }
      /* Резервный шорткат «/»: на macOS Cmd+K часто перехватывает браузер
         (поиск в адресной строке), поэтому нужен путь без модификаторов. */
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey){
        const t = e.target;
        const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
        if (!typing && user()){ e.preventDefault(); KEY_ACTIONS.search(); return; }
      }
      for (const id of Object.keys(KEY_ACTIONS)){
        if (keyMatch(e, S.keys && S.keys[id])){
          e.preventDefault();
          KEY_ACTIONS[id]();
          return;
        }
      }
    });
  }
  function cycleTheme(silent){
    const u = user(); if (!u) return;
    /* Тёмная ↔ светлая. Если новая тема совпадает с системной —
       неявно возвращаем режим «системная» (следует за ОС). */
    const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    const cur = (u.mode || 'system') === 'system' ? sys : u.mode;
    const next = cur === 'dark' ? 'light' : 'dark';
    u.mode = (next === sys) ? 'system' : next;
    saveState(); applyTheme(u.mode, u.accent);
    if (!silent) toast(`Тема: ${MODE_LABEL[effMode(u)]}`, 'info');
    if (!silent) render();
  }

  /* Пересоздать фоны после смены темы/акцента */
  function refreshBgThemes(){
    /* Обновляем градиент-перелив на существующем слое, НЕ пересоздавая его:
       innerHTML='' убирал узор на кадр и давал мигание при смене акцента. */
    try { applyAppBg(); } catch(e){}
    document.querySelectorAll('.chat-main').forEach(cm => {
      try { applyChatBg(cm); } catch(e){}
    });
  }
  /* Фон приложения: оригинальный SVG-паттерн Telegram (pattern-20), нейтральный серый
   с «переливом» сверху вниз (градиент в самом SVG); согласуется с акцентом темы. */
  function applyAppBg(){
    document.body.className = document.body.className.replace(/app-bg--\S+/g, '').trim();
    document.body.style.backgroundImage = '';
    document.body.style.backgroundSize = '';
    document.body.style.backgroundPosition = '';
    document.body.style.backgroundBlendMode = '';
    document.body.style.backgroundColor = '';
    document.body.classList.add('app-bg--none');
    const cur = (S.settings && S.settings.appBg !== 'none') ? 'doodle' : 'none';
    const layer = document.getElementById('bg-doodles');
    if (cur === 'none'){
      const gone = layer && layer.querySelector('.dd--full');
      if (gone){
        /* плавно гасим, чтобы переключение было видно, и убираем только после */
        gone.style.opacity = '0';
        setTimeout(()=>{ if (!(S.settings && S.settings.appBg !== 'none')) layer.innerHTML = ''; }, 320);
      } else if (layer) layer.innerHTML = '';
      return;
    }
    document.body.classList.remove('app-bg--none');
    document.body.classList.add('app-bg--doodle');
    if (!layer) return;
    const a = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8f78b0';
    /* Сырой паттерн кэшируем один раз; при смене темы пересобираем только цвета.
       ОДИН тонкий слой линий. Перелив задаётся ГРАДИЕНТОМ В САМОМ stroke (url(#g)) —
       переливаются линии, а не фон: пустоты между ними остаются нейтральными. */
    const t = document.documentElement.dataset.theme || '';
    const isLight = t.includes('light');
    const mk = (a, b, c, d, e) => {
      const idx = t.includes('red') ? 0 : t.includes('green') ? 1 : t.includes('blue') ? 2 : t.includes('mono') ? 3 : 4;
      return { c1: a[idx], c2: b[idx], c3: c[idx], c4: d[idx], c5: e[idx] };
    };
    /* Палитра: верх-лево тёплый, середина голубая, низ-право холодная бирюза. */
    /* Светлая тема: те же переходы, но приглушённо-тёмные стопы — иначе
       пастель на светлом фоне даёт нулевой контраст (линии сливались с фоном). */
    const P = isLight ? mk(
      //        red              green            blue             mono             violet
      ['#f2d9d3', '#e0efdf', '#dfe8f6', '#ececec', '#e9def5'],   // c1 верх: мягкий тон акцента
      ['#d9b0a4', '#b8d4bd', '#b6c9e6', '#cbcbcb', '#cdb6e8'],   // c2: плотнее — верх читается
      ['#c07b70', '#7fb08c', '#7f97c4', '#9a948c', '#9a7fc4'],   // c3: середина
      ['#3f8c80', '#a85590', '#b07a35', '#8d8175', '#8d9f3f'],   // c4: уходим в антагонист
      ['#2e7d74', '#8f3a72', '#9a6530', '#6b6157', '#6f8a2a']    // c5 низ-право: антагонист, средний тон
    ) : mk(
      //        red              green            blue             mono             violet
      ['#3a2027', '#1e3329', '#1b2a3f', '#2b2b2b', '#2e2344'],   // c1 верх: приглушённый акцент
      ['#a35a6e', '#4fa37f', '#4f7fbf', '#7d7d7d', '#8a6cc7'],   // c2: светлее — верх не тонет в фоне
      ['#a83f52', '#37916f', '#3f6fb0', '#7a7268', '#6d55a0'],   // c3: середина
      ['#17b3a6', '#c93fa8', '#e0872b', '#d8cbb8', '#9ac23a'],   // c4: уходим в антагонист
      ['#00e8d8', '#ff4fd0', '#ffab2e', '#fff3e0', '#d4f24a']    // c5 низ-право: антагонист, максимум
    );
    const C1 = P.c1, C2 = P.c2, C3 = P.c3, C4 = P.c4, C5 = P.c5;
    /* Перелив: два мягких цветовых пятна (тёплое сверху-слева, холодное снизу-справа)
       поверх диагонального градиента — цвет «гуляет» по кадру, а не просто темнеет. */
    /* Тёмная тема: затухание сверху не нужно — светлый текст на тёмном фоне
       держит контраст и без него, поэтому узор идёт ровно от верха.
       Светлая тема: мягкий верх остаётся, иначе тёмные линии спорят с текстом. */
    const grad = isLight
      ? `radial-gradient(120% 85% at 2% 0%, ${C2} 0%, transparent 30%),` +
        `radial-gradient(145% 125% at 100% 100%, ${C5} 10%, transparent 62%),` +
        `linear-gradient(125deg, ${C1} 0%, ${C2} 26%, ${C3} 52%, ${C4} 78%, ${C5} 100%)`
      : `radial-gradient(145% 125% at 100% 100%, ${C5} 10%, transparent 62%),` +
        `linear-gradient(125deg, ${C2} 0%, ${C3} 44%, ${C4} 74%, ${C5} 100%)`;
    /* версия в URL обязательна: иначе браузер отдаёт старую маску из кэша
       и любые правки узора не видны */
    const bgVer = window.__BUILD_NUM__ || '';
    const maskUrl = 'url("bg/pattern-ai.svg' + (bgVer ? '?v=' + bgVer : '') + '")';
    const cacheKey = cur + '|' + t + '|bg11';
    /* Единая отрисовка: маску ставим ВСЕГДА. После перерисовки разметки
       (#bg-doodles пересоздаётся при навигации) слой терял маску и узор «отваливался». */
    const paint = (bg, mask) => {
      let el = null;
      for (const ch of layer.children){ if (/dd--full/.test(ch.className)) { el = ch; break; } }
      let fresh = false;
      if (!el){
        layer.innerHTML = '';
        el = document.createElement('span');
        el.className = 'dd--full';
        layer.appendChild(el);
        fresh = true;
      }
      el.style.backgroundImage = bg;
      el.style.backgroundSize = '100% 100%';
      /* Ровный узор по всему экрану: затухание к центру нужно только заставке. */
      el.style.webkitMaskImage = mask;
      el.style.maskImage = mask;
      /* Фиксированный тайл (холст 1600×3200 → 1:2): масштаб не зависит от высоты экрана */
      el.style.webkitMaskSize = '440px 880px';
      el.style.maskSize = '440px 880px';
      el.style.webkitMaskRepeat = 'repeat';
      el.style.maskRepeat = 'repeat';
      el.style.webkitMaskPosition = 'top left';
      el.style.maskPosition = 'top left';
      if (fresh){ el.style.opacity = '0'; requestAnimationFrame(()=>{ el.style.opacity = ''; }); }
      /* маска по АЛЬФЕ, а не по яркости: иначе светлота линий зависит от цвета SVG
         и в светлой теме узор почти исчезает */
      el.style.maskMode = 'alpha';
      el.style.webkitMaskMode = 'alpha';
      layer.querySelectorAll('.dd--alt, .dd--glow').forEach(x => x.remove());
      document.body.style.setProperty('--dd-svg', mask);
      document.body.style.setProperty('--dd-mask', mask);
      /* Тот же градиент отдаём окнам: они переиспользуют холст, не перерисовывая его. */
      document.body.style.setProperty('--dd-grad', bg);
    };
    if (applyAppBg._bgCache && applyAppBg._bgCache.key === cacheKey){
      paint(applyAppBg._bgCache.bg, applyAppBg._bgCache.mask);
      return;
    }
    applyAppBg._bgCache = { key: cacheKey, bg: grad, mask: maskUrl };
    paint(grad, maskUrl);
  }
  /* Красивая заглушка-скелетон ПО ТРЕБОВАНИЮ (для тяжёлых/асинхронных мест).
     Показывает прозрачный слой с плашками поверх скрытого контента; по истечении
     времени (или по вызову cancel) снимает её. Контент скрывается visibility,
     поэтому сквозь заглушку видны настоящие дудлы фона. */
  function showSkeleton(mainEl, ms = SKELETON_MS){
    const m = mainEl || document.getElementById('main');
    if (!m) return { cancel:()=>{} };
    const sk = document.createElement('div'); sk.className = 'view-sk';
    sk.innerHTML = '<i style="width:36%"></i><i></i><i></i><i></i><i></i><i></i>';
    m.classList.add('view-sk--on');
    m.appendChild(sk);
    let done = false;
    const cancel = () => {
      if (done) return; done = true;
      clearTimeout(timer);
      sk.remove(); m.classList.remove('view-sk--on');
    };
    const timer = setTimeout(cancel, ms);
    return { cancel, el: sk };
  }
  window.showSkeleton = showSkeleton; /* доступно из любого кода (окна, асинхронные операции) */

  const NAV_VIEWS = {
    dash: r => dashView(r), orders: r => CRM.ordersView(r), clients: r => CRM.peopleView(r, 'client'),
    executors: r => CRM.peopleView(r, 'executor'), projects: r => CRM.projectsView(r), chats: r => chatsView(r),
    tickets: r => ticketsView(r), ideas: r => ideasView(r), kanban: r => CRM.kanbanView(r), tools: r => CRM.toolsView(r),
    'ai-transcribe': r => AI.transcribeView(r), 'ai-texts': r => AI.textsView(r), 'ai-translate': r => AI.translateView(r),
    niches: r => nichesView(r), audit: r => auditView(r), settings: r => settingsView(r, route.param), docs: r => docsView(r)
  };
  window.NAV_VIEWS = NAV_VIEWS; /* доступно для windows.js */
  /* Маршруты вне меню (футер/служебные), доступные ролям напрямую. */
  const EXTRA_ROUTES = { docs: ['admin','top_manager','manager','executor','client'] };

  /* Доступ по роли: маршрут должен быть разрешён в NAV (или в EXTRA_ROUTES).
     Раньше «Ниши и специализации» и «Журнал аудита» были скрыты из меню,
     но открывались по прямой ссылке #/audit и #/niches. */
  function canOpenRoute(name, role){
    if (name === 'err') return true;
    if (NAV_DEFAULT.some(s => s.items.some(i => i.route === name && i.roles.includes(role)))) return true;
    return !!(EXTRA_ROUTES[name] && EXTRA_ROUTES[name].includes(role));
  }

  let __autoTickAt = 0;
  function payoutAutoTick(){
    const t = Date.now();
    if (t - __autoTickAt < 60000) return;
    __autoTickAt = t;
    try { Finance.autoTick(t); } catch(e){}
  }

  function render(){
    const u = user();
    if (u) payoutAutoTick();
    if (!u){
      const tok = parseToken();
      if (tok){
        renderJoin(inviteById(tok) || { token:tok, role:'client', limit:0, used:0, revoked:true });
        return;
      }
      const rc = parseRef();
      if (rc){
        const referrer = userByRefCode(rc);
        if (referrer) renderJoin({ refCode: rc, referrerId: referrer.id, role: refConfig().role || 'client', limit:0, used:0 });
        else renderJoin({ token:'', role:'client', limit:0, used:0, revoked:true });
        return;
      }
      renderLogin(); return;
    }
    const main = document.createElement('div');
    const name = route.name;
    const viewFn = NAV_VIEWS[name];
    if (!canOpenRoute(name, u.role)) errView(main, '403');
    else if (viewFn) viewFn(main);
    else if (name==='err') errView(main, route.param||'404');
    else errView(main, '404');
    /* Beta-режим: значок рядом с названием раздела */
    try {
      if (isBetaRoute(name)){
        const h2 = main.querySelector('.page-head h2');
        if (h2 && !h2.querySelector('.beta-badge')){
          h2.insertAdjacentHTML('beforeend', ' <span class="beta-badge">Beta</span>');
        }
      }
    } catch(e){}
    renderShell(main);
    /* Слой дудлов живёт вне #app — заполняем его один раз на рендер */
    applyAppBg();
  }

  /* ---------- Старт ---------- */
  /* История обновлений: свежая запись отражает актуальную версию приложения */
  function syncChangelogProduct(){
    const p = S.product || {};
    if (!p.version) return;
    S.changelog = S.changelog || [];
    /* Демо-записи старых бета-версий приводим к версии прототипа */
    S.changelog.forEach(v => { if (v.demo && /^0\.9\./.test(v.version)) v.version = '0.1-prototype'; });
    /* Системная запись «Прототип» (v0) — всегда на месте, независимо от демо/удалений */
    if (!S.changelog.some(v => v.id === 'v0')){
      S.changelog.push({ id:'v0', version:'0.1-prototype', title:'Прототип Audiowizard Workspace',
        content:'Первая версия приложения', created_at: Date.now()-3600000*24*20, is_published:true });
    }
    const cur = S.changelog[0];
    /* Если текущая версия продукта = версия записи-прототипа (v0) — не дублируем:
       патчноут про прототип остаётся единственной записью. */
    const isProtoCurrent = p.version === '0.1-prototype';
    if (isProtoCurrent){
      S.changelog = S.changelog.filter(v => v.id !== 'cur');
      return;
    }
    if (cur && cur.version === p.version && cur.title === (p.notes && p.notes.length ? p.notes[0] : '')) return;
    S.changelog.unshift({
      id:'cur', version: p.version, title: (p.notes && p.notes.length ? p.notes[0] : 'Текущая версия'),
      content: (p.notes || []).join('\n') || 'Актуальная сборка приложения.',
      created_at: Date.now(), is_published:true
    });
  }
  const BUILD_NUM = (() => { const m = (typeof VER !== 'undefined' ? VER : '').match(/(\d+)$/); return m ? +m[1] : (window.__BUILD_NUM__ || 1); })();
  /* ---------- «Думающие» клиенты: напоминания и удаление по сроку ---------- */
  function thinkingOwner(c){
    const mid = c.ext && c.ext.managerId;
    const m = mid ? S.users.find(x=>x.id===mid) : null;
    return m || S.users.find(x=>x.role==='admin') || null;
  }
  /* Колокольчик в плашке: живое обновление счётчика и «звон» при новом
     уведомлении текущего пользователя — без перерисовки всего шелла. */
  function refreshBellCount(){
    try{
      const ico = document.querySelector('#btn-bell .bell-ico');
      if (!ico) return;
      const n = (typeof unreadTotal === 'function') ? unreadTotal() : 0;
      let cnt = ico.querySelector('.bell-cnt');
      if (n <= 0){ if (cnt) cnt.remove(); return; }
      if (!cnt){ cnt = document.createElement('span'); cnt.className = 'bell-cnt'; ico.appendChild(cnt); }
      cnt.textContent = n > 99 ? '99+' : String(n);
    }catch(e){}
  }
  function ringBell(){
    try{
      const ico = document.querySelector('#btn-bell .bell-ico');
      if (!ico) return;
      ico.classList.remove('bell-ring');
      void ico.offsetWidth;
      ico.classList.add('bell-ring');
      clearTimeout(ico.__ringT);
      ico.__ringT = setTimeout(()=>{ ico.classList.remove('bell-ring'); }, 900);
    }catch(e){}
  }
  function pushNotifTo(owner, title, text, iconName){
    S.notifs = S.notifs || [];
    S.notifs.unshift({ id:uid(), icon:iconName||'i-clients', title, text, t:Date.now(), read:{}, owner_id: owner?owner.id:null });
    const meU = (typeof me === 'function') ? me() : null;
    if (!owner || (meU && owner.id === meU.id)){
      /* В реальном времени: обновляем счётчик, «звоним» колокольчиком,
         показываем тост и плавно возвращаем верхние плашки, если их
         растворил скролл. */
      refreshBellCount();
      ringBell();
      try{
        if (text && title) toast(text, 'info', title);
        else toast(title || text || 'Новое уведомление', 'info');
      }catch(e){}
      try{ if (typeof window.__pillsReset === 'function') window.__pillsReset(); }catch(e){}
    }
    try{ saveState(); }catch(e){}
  }
  /* Публичный хелпер: другие модули (CRM, чаты) шлют уведомления с живым
     отображением — тост, «звон» колокольчика и возврат плашек. */
  window.pushNotifTo = pushNotifTo;
  function runThinkingSweep(){
    const now = Date.now(), DAY = 86400000;
    let changed = false;
    const list = (S.users||[]).filter(x=>x.role==='client' && x.ext && x.ext.thinking && x.ext.thinking.deleteAt);
    list.forEach(c=>{
      const th = c.ext.thinking;
      const owner = thinkingOwner(c);
      if (now >= th.deleteAt){
        const nm = c.full_name;
        /* Данные клиента стираются: профиль, привязки заказов, авторство сообщений */
        S.users = S.users.filter(x=>x.id!==c.id);
        (S.orders||[]).forEach(o=>{ if (o.client_id===c.id) o.client_id=''; });
        (S.messages||[]).forEach(m2=>{ if (m2.user_id===c.id) m2.user_id=null; });
        (S.chats||[]).forEach(ch=>{ if (ch.client_id===c.id && ch.type==='client') ch.is_active=false; });
        try { if (S.currentUserId===c.id){ S.currentUserId=null; sessionStorage.removeItem('aw_uid'); } } catch(e){}
        pushNotifTo(owner, 'Данные клиента удалены', `«${nm}» — срок «думает» истёк`, 'i-trash');
        logAudit(`Данные клиента «${nm}» удалены по истечении срока`, 'Клиенты');
        changed = true;
        return;
      }
      const before = th.remindBefore!=null ? th.remindBefore : 3;
      const remindAt = th.deleteAt - before*DAY;
      const dayPassed = !th.lastRemind || (now - th.lastRemind) > DAY;
      if (now >= remindAt && dayPassed){
        const left = Math.max(0, Math.ceil((th.deleteAt - now)/DAY));
        pushNotifTo(owner, 'Клиент «думает»: скоро удаление', `«${c.full_name}» — через ${left} дн. Проверьте, нужен ли клиент`, 'i-clock');
        th.lastRemind = now;
        changed = true;
      }
    });
    if (changed) saveState();
  }

  /* Следующий срок повторного напоминания */
  function nextRepeatAt(at, repeat){
    const d = new Date(at);
    if (repeat === 'daily') return d.getTime() + 86400000;
    if (repeat === 'weekly') return d.getTime() + 7*86400000;
    if (repeat === 'monthly'){
      const day = d.getDate(), h = d.getHours(), mi = d.getMinutes(), se = d.getSeconds(), ms = d.getMilliseconds();
      const m = new Date(d.getFullYear(), d.getMonth()+1, 1, h, mi, se, ms);
      const last = new Date(m.getFullYear(), m.getMonth()+1, 0).getDate();
      m.setDate(Math.min(day, last));
      return m.getTime();
    }
    return null;
  }

  function runReminderSweep(){
    const now = Date.now();
    let changed = false;
    S.reminders = S.reminders || [];
    S.reminders.forEach(r=>{
      if (r.done || r.at > now) return;
      if (r.notify){
        const owner = S.users.find(x=>x.id===r.owner_id) || null;
        pushNotifTo(owner, 'Напоминание', r.text, 'i-clock');
      }
      r.lastFiredAt = Date.now();
      const rep = r.repeat || 'none';
      if (rep === 'none'){
        r.fired = true;
      } else {
        /* Сдвигаем на следующий срок (пропускаем периоды, которые прошли офлайн) */
        let t2 = nextRepeatAt(r.at, rep), guard = 0;
        while (t2 !== null && t2 <= now && guard++ < 400) t2 = nextRepeatAt(t2, rep);
        r.at = t2 !== null ? t2 : r.at + 86400000;
        r.fired = false;
      }
      changed = true;
    });
    if (changed) saveState();
  }

  function boot(){
    try {
      loadState();
      /* Согласование номера сборки: настройки показывают фактическую сборку приложения */
      S.product = S.product || {};
      if (S.product.build !== BUILD_NUM){ S.product.build = BUILD_NUM; try { saveState(); } catch(e){} }
      syncChangelogProduct();
      try {
        const su = sessionStorage.getItem('aw_uid');
        if (su){
          const surv = userById(su);
          /* Пользователь из чёрного списка не входит даже по сохранённой сессии */
          if (surv && surv.ext && surv.ext.status === 'blacklisted'){
            sessionStorage.removeItem('aw_uid');
            S.currentUserId = null; S.rememberedLogin = null;
          } else if (surv){
            S.currentUserId = su;
          }
        }
      } catch(e){}
      applyTheme(user()?.mode || 'system', user()?.accent || 'violet');
      initKeys();
      initPWA();
      const h = parseHash();
      if (h) route = h;
      if (!user() && !route.name.startsWith('err') && !parseToken() && !parseRef()) route = { name:'login' };
      try { runThinkingSweep(); } catch(e){ console.error(e); }
      try { runReminderSweep(); } catch(e){ console.error(e); }
      render();
      showMaintBanner();
    maybeCookieBanner();
    checkUpdates(false);
    /* Новая сборка могла появиться, пока вкладка была открыта */
    setTimeout(()=>{ try { checkBuild(); } catch(e){} }, 2200);
    document.addEventListener('visibilitychange', ()=>{ if (!document.hidden) { try { checkBuild(); } catch(e){} } });
    /* Восстановление открытых окон после перезагрузки (только для залогиненного пользователя) */
    if (user() && window.Windows && typeof Windows.restoreSavedWins === 'function'){
      try { setTimeout(() => Windows.restoreSavedWins(), 150); } catch(e){}
    }
    /* URL-действия из ярлыков PWA */
    const q = new URLSearchParams(location.search);
    if (q.get('action')==='new-order' && user() && isStaff(user().role)){ setTimeout(()=>CRM.openOrderForm(), 80); }
    if (q.get('action')==='search' && user()) setTimeout(openPalette, 300);
    window.addEventListener('hashchange', ()=>{
      const h2 = parseHash();
      if (h2 && (h2.name!==route.name || h2.param!==route.param)){ route = h2; render(); }
    });
    /* Пересоздание дудл-фонов при смене темы/акцента приложения */
    try {
      const themeObs = new MutationObserver(() => {
        clearTimeout(themeObs._t);
        themeObs._t = setTimeout(() => { try { refreshBgThemes(); } catch(e){} }, 40);
      });
      themeObs.observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
    } catch(e){}
    } catch(bootErr){
      /* Показываем фатальную ошибку загрузки на сплэше вместо вечного ожидания */
      console.error('Boot failed:', bootErr);
      const sp = $('#splash');
      if (sp){
        sp.classList.remove('gone');
        sp.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:24px;max-width:520px;text-align:center">
          <b style="color:var(--red)">Ошибка загрузки приложения</b>
          <span class="small muted" style="word-break:break-all">${esc(bootErr && bootErr.message || bootErr)}</span>
          <button class="btn btn--primary" onclick="location.reload(true)">Перезагрузить</button>
        </div>`;
      }
    }
  }

  function ensureBgLayer(){
    if (!document.getElementById('bg-doodles')){
      const el = document.createElement('div');
      el.id = 'bg-doodles';
      el.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(el, document.body.firstChild);
    }
    return document.getElementById('bg-doodles');
  }
  document.addEventListener('DOMContentLoaded', () => { try { ensureBgLayer(); } catch(e){} boot(); });
  /* Сначала гарантированно убираем заставку, потом всё остальное:
     если что-то ниже упадёт, экран не останется в вечной загрузке. */
  setTimeout(()=>{ const sp = $('#splash'); sp && sp.classList.add('gone'); setTimeout(()=>sp && sp.remove(), 600); }, 1400);
  try {
    /* Дудлы на заставке включены по умолчанию (рисуются CSS сразу, без «дорисовки»),
       выключаем только если фон в настройках отключён. */
    const sp = $('#splash');
    let bgOn = true;
    const raw = localStorage.getItem('aw_state_v1');
    if (raw){ const st = JSON.parse(raw); bgOn = !(st && st.settings && st.settings.appBg === 'none'); }
    if (sp && !bgOn) sp.classList.add('no-doodles');
  } catch(e){}

  /* Экспортируем хелперы персистентности для NavDrag */
  window.APP = {
    _persistNav: () => {
      prefsFor().navCustom = true;
      prefsFor().navCustomOrder = JSON.parse(JSON.stringify(NAV.map(s => ({ sec:s.sec, items:s.items.map(it => ({ route:it.route, title:it.title, icon:it.icon, roles:it.roles })) }))));
      saveState(); render();
    },
    _navCtx: e => {
      e.preventDefault();
      const link = e.target.closest('.side__link');
      const sec = e.target.closest('.side__sec[data-sec-title]');
      const items = [];
      if (link){
        items.push({ label:'Перейти в раздел', icon:'chev-r', onClick:()=>{ window.__navDbl = null; go(link.dataset.route); } });
        items.push({ label:'Открыть в окне', icon:'app', onClick:()=>{ window.__navDbl = null; try { Windows.spawn(link.dataset.route); } catch(err){} } });
      }
      /* Свернуть / закрыть все окна — только если они открыты (одна группа, без разделителя) */
      if (window.Windows && Windows.hasOpenWins && Windows.hasOpenWins()){
        if (Windows.hasMinimized && Windows.hasMinimized()){
          items.push({ label:'Развернуть все окна', icon:'chev-u', onClick:()=>{ try { Windows.restoreAll(); } catch(err){} } });
        }
        if (Windows.hasExpanded && Windows.hasExpanded()){
          items.push({ label:'Свернуть все окна', icon:'chev-d', onClick:()=>{ try { Windows.minimizeAll(); } catch(err){} } });
        }
        items.push({ label:'Закрыть все окна', icon:'x', onClick:()=>{ try { Windows.closeAll(); } catch(err){} } });
      }
      items.push('-');
      items.push({ label:'Сбросить меню по умолчанию', icon:'archive', onClick:()=>{ NAV = JSON.parse(JSON.stringify(NAV_DEFAULT)); window.NAV = NAV; delete prefsFor().navCustom; delete prefsFor().navCustomOrder; saveState(); toast('Меню сброшено','ok'); render(); } });
      showDropdown(e.target, items, { x:e.clientX, y:e.clientY });
    }
  };
  return { go, render, navFor, cycleTheme, checkUpdates, openPalette, toggleZen };
})();
