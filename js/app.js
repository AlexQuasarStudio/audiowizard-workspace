/* ============================================================
   Audiowizard Workspace — оболочка, роутер, роли, PWA
   ============================================================ */
'use strict';

const APP = (() => {

  /* ---------- Офлайн-патч: очередь операций ---------- */
  function patchOffline(){
    const orig = CRM.setStatus;
    CRM.setStatus = async (...a) => {
      const r = await orig(...a);
      if (r && !navigator.onLine) queueOp({ desc:`Статус заказа изменён (офлайн)` });
      return r;
    };
  }

  /* ---------- Роутер ---------- */
  let route = { name:'dash', param:null };
  const VIEW_SKELETON = new Set(['dash','orders','kanban','clients','executors','ideas','tickets','import','chats','settings']);

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
      { route:'niches', title:'Ниши и специализации', icon:'palette', roles:['admin'] },
      { route:'audit', title:'Журнал аудита', icon:'terminal', roles:['admin'] },
      { route:'settings', title:'Настройки', icon:'settings', roles:['admin','top_manager','manager','executor','client'] }
    ]}
  ];

  let NAV = JSON.parse(JSON.stringify(NAV_DEFAULT));
  window.NAV = NAV; /* доступно для windows.js */
  window.NAV_DEFAULT = NAV_DEFAULT;

  function navFor(user){
    if (!user) return [];
    const hidden = (isProd() && S.settings.hiddenRoutes) || [];
    const custom = S.draftPrefs.navCustomOrder;
    if (custom){
      /* полностью кастомный порядок разделов и пунктов (persistenced) */
      return custom.map(s => ({ sec:s.sec, items:(s.items||[]).filter(i=>i.roles.includes(user.role) && !hidden.includes(i.route)) })).filter(s=>s.items && s.items.length);
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

  function unreadTotal(){
    const u = user(); if (!u) return 0;
    let n = noDemo(S.notifs).filter(x=>!(x.read||{})[u.id]).length;
    chatForUser(u).forEach(c=>n += unreadCount(c, u.id));
    if (isStaff(u.role)) n += noDemo(S.tickets).filter(t=>t.status==='new' && (t.created_at > (u.ticketsReadAt||0))).length;
    return n;
  }

  function renderShell(content){
    const u = user();
    const isMobile = window.matchMedia('(max-width:960px)').matches;
    document.body.classList.toggle('side-collapsed', !!S.draftPrefs.sideCollapsed && !isMobile);
    const collapsed = document.body.classList.contains('side-collapsed');
    const nav = navFor(u);
    const unread = unreadTotal();

    const navScrollMem = document.querySelector('.side__nav')?.scrollTop || 0;
    $('#app').innerHTML = `
      ${collapsed ? '' : ''}
      <div class="shell ${collapsed?'shell--collapsed':''}">
        <aside class="side" id="side">
          <div class="side__brand">
            <span class="side__brand-logo" id="brand-click" title="О программе" role="button" tabindex="0">${icon('logo-full')}</span>
            <span class="side__brand-name">${__t('nav.brand','Audiowizard')}<small>workspace</small></span>
          </div>
          <nav class="side__nav" data-tour="nav">
            ${nav.map(sec=>`<div class="side__sec ${S.draftPrefs.closedSecs && S.draftPrefs.closedSecs.includes(sec.sec)?'closed':''}" data-sec-title="${esc(sec.sec)}">${esc(sec.sec)}<svg class="ico ico-sm sec-arrow"><use href="#i-chev-d"/></svg></div><div class="side__sec-items" data-sec-items="${esc(sec.sec)}">${sec.items.map(it=>`
              <a class="side__link ${route.name===it.route?'on':''}" href="#/${it.route}" title="${esc(it.title)}" draggable="false" data-tour="${it.route==='orders'?'orders-link':''}" data-route="${esc(it.route)}" data-sec="${esc(sec.sec)}">
                ${icon(it.icon)}<span class="lbl">${it.title}</span><span class="win-dot"></span>
                ${it.route==='chats'&&unreadChats(u)?`<span class="side__link__cnt">${unreadChats(u)}</span>${collapsed?'<span class="rail-dot"></span>':''}`:''}
                ${it.route==='tickets'&&isStaff(u.role)&&noDemo(S.tickets).filter(t=>t.status==='new').length?`<span class="side__link__cnt">${noDemo(S.tickets).filter(t=>t.status==='new').length}</span>${collapsed?'<span class="rail-dot"></span>':''}`:''}
              </a>`).join('')}</div>`).join('')}
          </nav>
          <div class="side__foot">
            <div class="side__user" id="side-user" data-tour="user">
              ${avatarHTML(u)}
              <span class="side__user-meta"><b>${esc(u.full_name)}</b><span>${ROLE_LABEL[u.role]}</span></span>
              <span class="side__user-arrow">${icon('chev-r','ico-sm')}</span>
            </div>
          </div>
        </aside>
        <header class="head">
          <button class="iconbtn burger" id="burger" aria-label="Меню" title="Свернуть/развернуть меню">${icon('menu')}</button>
          <div class="head__search" data-tour="search" id="open-search">
            <div class="fake-input">${icon('search')}<span>Глобальный поиск…</span><span class="kbd">Ctrl K</span></div>
          </div>
          <div class="head__right">
            <span class="head-balance ${navigator.onLine?'':'offline'}" id="net-pill" title="Баланс платформы">${icon('card','ico-sm')}<b>${fmtMoney(S.settings.balance)}</b></span>
            ${['admin','top_manager','manager','client'].includes(u.role) ? `
            <div class="head-actions" id="head-actions">
              <button class="iconbtn head-actions__main" id="btn-new" title="Новый заказ (Ctrl+N)" aria-label="Новый заказ">${icon('plus')}</button>
              <button class="iconbtn head-actions__arrow" id="btn-actions-arrow" title="Выбрать действие" aria-label="Выбрать действие" aria-haspopup="true">${icon('chev-d','ico-sm')}</button>
            </div>` : ''}
            ${S.opQueue.length?`<span class="badge c-yellow" title="Офлайн-очередь">${icon('refresh','ico-sm')} ${S.opQueue.length}</span>`:''}
            <button class="iconbtn" id="btn-bell" data-tour="bell" aria-label="Уведомления">${icon('bell')}${unread?`<span class="bell-cnt">${unread>99?'99+':unread}</span>`:''}</button>
          </div>
        </header>
        <main class="main view" id="main"></main>
        <footer class="foot">
          <a href="#/docs">Пользовательское соглашение</a>
          <a href="#/docs">Политика конфиденциальности</a>
          <a href="#/docs">Правила сервиса</a>
          <a href="#/docs">Справка и FAQ</a>
          <span class="foot__ver">
            ${!((S.product||{}).beta === false) ? '<span class="beta-badge">Beta</span>' : ''}
            <span>v${esc((S.product||{}).version || '0.9.4-beta')}</span>
            <button class="btn btn--ghost btn--sm" id="btn-update-check">${icon('refresh')} Обновления</button>
          </span>
        </footer>
      </div>`;

    { const nv = document.querySelector('.side__nav'); if (nv && navScrollMem) nv.scrollTop = navScrollMem; }
    { document.removeEventListener('scroll', window.__toTopHandler);
      window.__toTopHandler = () => { const tt = document.querySelector('.to-top'); if (tt) tt.hidden = window.scrollY < 500; };
      document.addEventListener('scroll', window.__toTopHandler, { passive: true });
      window.__toTopHandler();
    }
    const prevRouteName = window.__lastRouteName; window.__lastRouteName = route.name;
    $('#main').replaceChildren(content);
    /* Кнопка «Наверх» для длинных страниц */
    { document.querySelector('.to-top')?.remove();
      const tt = document.createElement('button');
      tt.className = 'to-top'; tt.hidden = true;
      tt.title = 'Наверх'; tt.setAttribute('aria-label', 'Наверх');
      tt.innerHTML = icon('chev-d') ;
      tt.style.transform = 'rotate(180deg)';
      tt.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
      document.body.appendChild(tt);
    }
    { const mem = window.__scrollMem || {}; requestAnimationFrame(() => window.scrollTo(0, mem[route.name] || 0)); }
    /* Плавный вход вида + скелетон-фаза при смене страницы */
    {
      const mainEl = $('#main');
      mainEl.classList.remove('view-in'); void mainEl.offsetWidth; mainEl.classList.add('view-in');
      if (prevRouteName !== undefined && prevRouteName !== route.name && VIEW_SKELETON.has(route.name)){
        const sk = document.createElement('div'); sk.className = 'view-sk';
        sk.innerHTML = '<i style="width:36%"></i><i></i><i></i><i></i><i></i><i></i>';
        mainEl.appendChild(sk);
        setTimeout(() => sk.remove(), 460);
      }
    }
    if (S.draftPrefs.zen) applyZen(true);
    $('#burger').onclick = ()=>{
      if (window.matchMedia('(max-width:960px)').matches){
        $('#side').classList.add('open');
        const sc = document.createElement('div'); sc.className = 'side-scrim';
        const closeScrim = ()=>{ $('#side').classList.remove('open'); sc.classList.add('closing'); setTimeout(()=>sc.remove(), 320); };
        sc.onclick = closeScrim;
        document.body.appendChild(sc);
      } else {
        const on = !document.body.classList.contains('side-collapsed');
        document.body.classList.toggle('side-collapsed', on);
        document.querySelector('.shell').classList.toggle('shell--collapsed', on);
        S.draftPrefs.sideCollapsed = on;
        saveState();
        /* без render(): класс сам переводит рельс, CSS-анимация ширины не обрывается */
      }
    };
    $('#side-user').onclick = e=>userMenu(e.currentTarget);
    $('#brand-click').onclick = ()=>showAboutModal();
    $('#brand-click').onkeydown = e=>{ if (e.key==='Enter') showAboutModal(); };
    const sc2 = $('#side-collapse');
    sc2 && (sc2.onclick = e=>{ e.stopPropagation(); document.body.classList.toggle('side-collapsed'); document.querySelector('.shell').classList.toggle('shell--collapsed', document.body.classList.contains('side-collapsed')); S.draftPrefs.sideCollapsed = document.body.classList.contains('side-collapsed'); saveState(); });
    $('#open-search').onclick = ()=>openPalette();
    $('#btn-bell').onclick = ()=>toggleNotifPanel();
    /* Быстрые действия: горячая кнопка (иконка = текущее действие) + стрелка-селектор.
       Клик по иконке запускает выбранное действие; список меняет выбор и иконку. */
    const quickActions = [
      { id:'order',  label:'Новый заказ', icon:'plus', run:()=>{ if (route.name !== 'orders') go('orders'); setTimeout(()=>CRM.openOrderForm(), route.name==='orders'?60:340); } },
      { id:'transcribe', label:'ИИ-стенограммы', icon:'mic', run:()=>go('ai-transcribe') },
      { id:'texts',   label:'ИИ-копирайтинг', icon:'edit', run:()=>go('ai-texts') },
      { id:'translate', label:'ИИ-переводы', icon:'globe', run:()=>go('ai-translate') }
    ];
    let quickSel = 'order';
    try { const qs = sessionStorage.getItem('aw_quick'); if (qs && quickActions.some(a=>a.id===qs)) quickSel = qs; } catch(e){}
    const quickSelAction = () => quickActions.find(a=>a.id===quickSel) || quickActions[0];
    window.runQuickSel = () => quickSelAction().run();
    const bnw = $('#btn-new');
    const setQuickIcon = () => { if (bnw){ const a = quickSelAction(); bnw.innerHTML = icon(a.icon); bnw.title = a.label + ' (Ctrl+N)'; bnw.setAttribute('aria-label', a.label); } };
    if (bnw){
      setQuickIcon();
      bnw.onclick = e=>{ e.stopPropagation(); runQuickSel(); };
    }
    const baa = $('#btn-actions-arrow');
    if (baa){
      baa.onclick = e=>{
        e.stopPropagation();
        showDropdown(baa, quickActions.map(a=>({
          label:a.label, icon:a.icon,
          onClick:()=>{ quickSel = a.id; try { sessionStorage.setItem('aw_quick', a.id); } catch(err){} setQuickIcon(); }
        })), { alignRight:true });
      };
    }
    $('#btn-update-check').onclick = ()=>checkUpdates(true);
    
    /* Драг меню теперь в js/navdrag.js (NavDrag) */

    /* Клик по пункту меню: одинарный — мгновенный переход; двойной (второй клик
       во время skeleton-load, ~0.5с) — открыть раздел в отдельном окне.
       Окно по маршруту уже открыто → восстановить мгновенно. */
    $$('a.side__link', document).forEach(a=>a.addEventListener('click', e=>{
      e.preventDefault();
      const rt = a.getAttribute('href').slice(2);
      /* Окно открыто → восстановление мгновенно */
      if (window.Windows && Windows.hasWindow && Windows.hasWindow(rt)){
        window.__navDbl = null;
        try { Windows.restoreWindow(rt); } catch(err){}
        return;
      }
      /* Двойной клик по тому же пункту в течение skeleton (~0.5с):
         возврат на предыдущий экран + открытие окна поверх. */
      const now = Date.now();
      if (window.__navDbl && window.__navDbl.route === rt && (now - window.__navDbl.t) < 520){
        window.__navDbl = null;
        clearTimeout(window.__navDblTimer);
        /* Откат навигации: возвращаемся на предыдущий экран */
        const prev = window.__prevRoute;
        if (prev && prev.name && prev.name !== rt){
          route = { name: prev.name, param: prev.param };
          location.hash = '#/' + prev.name + (prev.param ? '/'+prev.param : '');
          render();
        }
        try { Windows.spawn(rt); } catch(err){}
        return;
      }
      window.__navDbl = { route: rt, t: now };
      /* Автоочистка маркера: если второй клик не пришёл — забываем через 600мс */
      clearTimeout(window.__navDblTimer);
      window.__navDblTimer = setTimeout(() => { window.__navDbl = null; }, 600);
      go(rt);
    }));
    $$('.side__sec[data-sec-title]', document).forEach(sec=>{
      sec.addEventListener('click', ()=>{
        sec.classList.toggle('closed');
        const items = document.querySelector(`.side__sec-items[data-sec-items="${sec.dataset.secTitle}"]`);
        if (items){ items.style.overflow = 'hidden';
          if (sec.classList.contains('closed')){ items.style.maxHeight = '0px'; } else { items.style.maxHeight = items.scrollHeight + 'px'; setTimeout(()=>{ items.style.maxHeight = 'none'; }, 320); }
        }
        S.draftPrefs.closedSecs = S.draftPrefs.closedSecs || [];
        const title = sec.dataset.secTitle;
        if (sec.classList.contains('closed')){ if (!S.draftPrefs.closedSecs.includes(title)) S.draftPrefs.closedSecs.push(title); }
        else S.draftPrefs.closedSecs = S.draftPrefs.closedSecs.filter(x => x !== title);
        saveState();
      });
    });
    /* Восстановить индикаторы-точки окон на ссылках после перерисовки меню */
    if (window.Windows && Windows && Windows.refreshAllIndicators) Windows.refreshAllIndicators();
  }

  function unreadChats(u){
    return chatForUser(u).reduce((a,c)=>a+unreadCount(c,u.id),0);
  }

  /* Эффективный режим темы: если system — фактический по ОС */
  function effMode(u){
    if ((u.mode||'system') !== 'system') return u.mode;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function userMenu(anchor){
    const u = user();
    const items = [
      { label:u.full_name, header:true },
      { label:'Профиль', icon:'clients', onClick:()=>go('settings','profile') },
      { label:'Настройки', icon:'settings', hint:'Ctrl+,', onClick:()=>go('settings') },
      { label:'Тема: '+(MODE_LABEL[effMode(u)]), icon:'palette', hint:'Ctrl+Shift+T', keepOpen:true, onClick:(it)=>{ cycleTheme(true); it.label = 'Тема: '+(MODE_LABEL[effMode(user())]); } },
      { label:'Акцент: '+(ACCENT_LABEL[u.accent||'violet']), icon:'sparkle', keepOpen:true, onClick:(it)=>{ const list = ACCENT_LIST; u.accent = list[(list.indexOf(u.accent||'violet')+1)%list.length]; saveState(); applyTheme(u.mode,u.accent); it.label = 'Акцент: '+ACCENT_LABEL[u.accent]; toast('Акцент: '+ACCENT_LABEL[u.accent],'info'); } },
      { label:'Сообщить о проблеме', icon:'alert', onClick:()=>reportProblem() },
      ...(document.body.classList.contains('zen') ? [{ label:'Показать меню', icon:'shrink', onClick:()=>toggleZen() }]:[]),
      ...(!document.body.classList.contains('zen') ? [{ label:'Полноэкранный режим', icon:'expand', hint:'скрыть меню и топбар', onClick:()=>toggleZen() }]:[]),
      '-',
      ...(document.body.classList.contains('zen') ? [{ label:'Быстрые действия', icon:'chev-r', hint:'', submenu:true, keepOpen:true }, '-'] : []),
      { label:'Выйти', icon:'exit', danger:true, onClick:()=>logout() }
    ];
    const dd = showDropdown(anchor, items);
    if (!dd) return;
    /* Подменю быстрых действий (клик-тумблер) */
    const qBtn = dd.querySelector('[data-i="'+items.indexOf(items.find(it=>it.label==='Быстрые действия'))+'"]');
    if (qBtn){
      let subDD = null, pinned = false, hoverTimer = null, subItems = null;
      const removeSub = () => { if (subDD) { subDD.remove(); subDD = null; } };
      const buildSub = () => {
        if (subDD) { subDD.remove(); subDD = null; }
        const acts = [
          { label:'Создать заказ', icon:'plus', onClick:()=>{ removeSub(); closeDropdown(); go('orders'); setTimeout(()=>CRM.openOrderForm(), 340); } },
          { label:'Калькулятор услуг', icon:'calc', onClick:()=>{ removeSub(); closeDropdown(); CRM.openCalculator(); } },
          { label:'Проверить обновления', icon:'refresh', onClick:()=>{ removeSub(); closeDropdown(); checkUpdates(true); } },
          { label:'Разделы', header:true },
          ...navFor(u).flatMap(sec => sec.items.map(it => ({ label:it.title, icon:it.icon, onClick:()=>{ removeSub(); closeDropdown(); go(it.route); } })))
        ];
        subItems = acts.filter(a => !a.header);
        subDD = document.createElement('div');
        subDD.className = 'dd';
        subDD.style.maxHeight = '70vh';
        subDD.style.overflowY = 'auto';
        subDD.innerHTML = acts.map(it => {
          if (it.header) return `<div class="dd__label">${esc(it.label)}</div>`;
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
      /* Наведение — показать, уход — скрыть (не закреплено) */
      qBtn.addEventListener('mouseenter', () => { clearTimeout(hoverTimer); if (!pinned) buildSub(); });
      qBtn.addEventListener('mouseleave', () => { if (!pinned) hoverTimer = setTimeout(removeSub, 250); });
      /* Клик — закрепить/открепить */
      qBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (pinned){ pinned = false; removeSub(); return; }
        pinned = true; clearTimeout(hoverTimer);
        if (!subDD) buildSub();
      });
      /* Клик вне обеих плашек — закрыть всё */
      const closeAll = (e) => {
        if (pinned && subDD && !subDD.contains(e.target) && e.target !== qBtn && !qBtn.contains(e.target) && e.target !== dd && !dd.contains(e.target)) {
          pinned = false; removeSub(); closeDropdown();
        }
      };
      document.addEventListener('pointerdown', closeAll);
    }
  }

  /* ---------- О программе (модалка по клику на логотип) ---------- */
  function showAboutModal(){
    const p = S.product || {};
    const beta = p.beta !== false;
    openModal({
      title:'О программе',
      body:`<div class="stack" style="gap:14px">
        <div class="row" style="gap:16px">
          <span class="side__brand-logo logo-mark--lg">${icon('logo-full')}</span>
          <div>
            <b style="font-size:17px">Audiowizard Workspace</b>
            <div class="small muted">Версия ${esc(p.version || '0.9.4-beta')} · сборка ${p.build || 216} ${beta?'· <span class="beta-badge">Beta</span>':''}</div>
          </div>
        </div>
        <div class="card card-pad" style="background:var(--bg-2)">
          <b class="small" style="display:block;text-align:center;letter-spacing:.05em;text-transform:uppercase;font-size:10.5px;color:var(--muted)">Что нового</b>
          <ul class="whats-new stack small" style="gap:7px;margin-top:10px;color:var(--text-2)">
            ${(p.notes||[]).map(n=>`<li class="wn-item"><span class="dot" style="background:var(--accent);margin-top:7px;flex:none"></span><span>${esc(n)}</span></li>`).join('')}
          </ul>
        </div>
        <p class="small faint">Внутренняя CRM и клиентский портал сервиса обработки контента. PWA-приложение: работает офлайн, устанавливается на устройства.</p>
      </div>`,
      footer:`<button class="btn btn--primary" data-x>Закрыть</button>`,
      onMount:(m2,c2)=>{ m2.querySelector('[data-x]').onclick=c2; }
    });
  }

  /* ---------- Уведомления ---------- */
  function toggleNotifPanel(){
    const ex = $('.notif-panel');
    if (ex){ ex.remove(); return; }
    const u = user();
    const panel = document.createElement('div');
    panel.className = 'notif-panel';
    panel.innerHTML = `
      <div class="notif-panel__h">${icon('bell')} Уведомления <span class="spacer"></span>
        <button class="btn btn--ghost btn--sm" id="nf-readall">Прочитать все</button></div>
      <div class="notif-list">
        ${noDemo(S.notifs).slice(0,14).map(n=>`
          <div class="notif-item ${(n.read||{})[u.id]?'':'unread'}" data-nf="${n.id}">
            <span class="notif-ico">${icon(n.icon.replace('i-',''),'ico-sm')}</span>
            <span style="min-width:0"><span class="t">${esc(n.title)}</span><span class="d">${esc(n.text)} · ${timeAgo(n.t)}</span></span>
          </div>`).join('') || '<div class="empty">'+icon('bell')+'<span>Пока пусто</span></div>'}
      </div>
      <div style="padding:10px 14px;border-top:1px solid var(--border)"><button class="btn btn--ghost btn--sm btn--block" id="nf-open-tickets">${icon('tickets')} ${isStaff(u.role)?'Все тикеты':'Сообщить о проблеме'}</button></div>`;
    document.body.appendChild(panel);
    panel.addEventListener('click', e=>{
      if (e.target.id==='nf-readall'){ S.notifs.forEach(n=>{ (n.read=n.read||{})[u.id]=true; }); chatForUser(u).forEach(c=>{ (c.unread=c.unread||{})[u.id]=Date.now(); }); u.ticketsReadAt = Date.now(); saveState(); panel.remove(); render(); return; }
      if (e.target.id==='nf-open-tickets'){ panel.remove(); isStaff(u.role)?go('tickets'):CRM.openTicket(); return; }
      const it = e.target.closest('[data-nf]');
      if (it){
        const n = S.notifs.find(x=>x.id===it.dataset.nf);
        (n.read = n.read||{})[u.id] = true;
        if (n.title.startsWith('Доступна версия')) checkUpdates(true);
        else if (/AW-/.test(n.title)) go('orders');
        saveState(); panel.remove(); render();
      }
    });
    setTimeout(()=>document.addEventListener('mousedown', function h(e){ if (!panel.contains(e.target) && e.target.id!=='btn-bell'){ panel.remove(); document.removeEventListener('mousedown', h); } }), 50);
  }

  /* ---------- Авторизация ---------- */
  function renderLogin(tab='staff'){
    $('#app').innerHTML = `
      <div class="auth">
        <div class="auth__aurora"></div>
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
                <button type="button" class="input-eye" id="eye" aria-label="Показать пароль">${icon('info','ico-sm')}</button></div></div>
            <div class="auth__foot-row">
              <label class="check"><input type="checkbox" id="remember" ${S.rememberedLogin?'checked':''}><span class="box"><svg><use href="#i-check-c"/></svg></span><span class="small muted">Запомнить меня</span></label>
              <a href="#" id="forgot">Забыли пароль?</a>
            </div>
            <button class="btn btn--primary btn--block" type="submit" style="margin-top:16px">${icon('exit')} Войти</button>
          </form>
          <div class="auth__demo" id="demo-block" style="display:${S.settings.demoEnabled!==false?'':'none'}">
            <div class="auth__demo-label"><span>Демо-вход</span><span class="badge c-gray">включён админом</span></div>
            <div id="demo-chips">
              ${(tab==='staff'
                ? S.users.filter(u=>['admin','top_manager','manager','executor'].includes(u.role)).slice(0,6)
                : S.users.filter(u=>['client','executor'].includes(u.role)))
                .map(u=>`<button type="button" class="demo-chip" data-demo="${u.id}" title="${esc(u.full_name)} · ${esc(u.email)}">${avatarHTML(u,'avatar--sm')} ${esc(u.full_name.split(' ')[0])} · ${ROLE_LABEL[u.role]}</button>`).join('')}
            </div>
          </div>
          <p class="small faint" style="text-align:center;margin-top:16px">Входя, вы принимаете <a href="#/docs">Условия сервиса</a> и <a href="#/docs">Политику конфиденциальности</a></p>
        </div>
      </div>`;

    $$('.tab', $('#app')).forEach(t=>t.onclick=()=>{
      // плавное переключение вкладки: fade-slide контента демо-чипов, без перерисовки карточки
      document.querySelectorAll('.auth__card .tab').forEach(x=>x.classList.toggle('on', x===t));
      const isClient = t.dataset.tab === 'client';
      const chips = isClient
        ? S.users.filter(u=>['client','executor'].includes(u.role)).slice(0,6)
        : S.users.filter(u=>['admin','top_manager','manager','executor'].includes(u.role)).slice(0,4);
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
    $('#forgot').onclick = e=>{ e.preventDefault(); toast('Ссылка для восстановления отправлена на почту (демо)','info'); };
    $('#eye').innerHTML = icon('eye','ico-sm');
    let shown = false;
    $('#eye').onclick = ()=>{ shown=!shown; $('#pw').type = shown?'text':'password'; $('#eye').innerHTML = icon(shown?'eye-off':'eye','ico-sm'); };
    $('#login-form').onsubmit = e=>{
      e.preventDefault();
      const lg = norm($('#lg').value), pw = $('#pw').value;
      const u2 = S.users.find(x=>(norm(x.username)===lg||norm(x.email)===lg) && x.pw===pw);
      if (!u2){ $('#login-error').innerHTML = `<div class="auth-error">${icon('x-c','ico-sm')} Неверный логин или пароль</div>`; return; }
      if (u2.role==='client' && tab==='staff' || ['admin','top_manager','manager'].includes(u2.role) && tab==='client'){
        $('#login-error').innerHTML = `<div class="auth-error">${icon('info')} Это ${ROLE_LABEL[u2.role].toLowerCase()} — выберите соответствующую вкладку входа</div>`; return;
      }
      if ($('#remember').checked) S.rememberedLogin = u2.username; else S.rememberedLogin = null;
      doLogin(u2.id);
    };
  }

  function doLogin(uidv, demo=false){
    if (demo && S.settings.demoEnabled === false){ toast('Демо-вход отключён администратором', 'warn'); return; }
    const u2 = userById(uidv);
    S.currentUserId = uidv;
    try { sessionStorage.setItem('aw_uid', uidv); } catch(e){}
    u2.is_online = true;
    logAudit(demo ? `Демо-вход: ${u2.full_name}` : `Вход: ${u2.full_name}`, 'Авторизация');
    saveState();
    applyTheme(u2.mode, u2.accent);
    toast(`Добро пожаловать, ${u2.full_name.split(' ')[0]}!`, 'ok');
    go('dash');
    setTimeout(()=>{
      if (!u2.tour_completed) offerOnboarding();
      else checkProfileCompleteness();
    }, 400);
  }

  /* Сообщить о проблеме: форма → тикет */
  function reportProblem(){
    openModal({ narrow:true, title:'Сообщить о проблеме',
      body:`<div class="stack" style="gap:12px">
        <div class="field"><label>Что случилось</label><input class="input" id="rp-subject" placeholder="Коротко: что сломалось"></div>
        <div class="field"><label>Подробности</label><textarea class="input" id="rp-msg" rows="4" placeholder="Шаги, скриншот текстом, ожидание и факт"></textarea></div>
        <p class="small faint">Обращение попадёт к администратору как тикет.</p>
      </div>`,
      footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-send>Отправить</button>`,
      onMount:(m2,c2)=>{
        m2.querySelector('[data-send]').onclick = ()=>{
          const sub = m2.querySelector('#rp-subject').value.trim();
          const msg = m2.querySelector('#rp-msg').value.trim();
          if (!sub){ toast('Опишите проблему в заголовке','warn'); return; }
          S.tickets.unshift({ id:uid(), user_id:user().id, subject:sub, message:msg||sub, order_id:null, status:'new', created_at:Date.now(), resolved_at:null });
          logAudit('Обращение отправлено: '+sub, 'Тикет'); saveState(); c2();
          toast('Спасибо! Обращение отправлено администратору','ok');
        };
      } });
  }

  /* Полноэкранный режим: меню и топбар скрыты, выход — плавающая кнопка или Esc */
let zenAvatar = null;
  let zenDrag = null;
  let zenDragInit = false;
  let zenSuppressClick = false; /* подавляет клик сразу после перетаскивания */

  function applyZen(on){
    document.body.classList.toggle('zen', on);
    if (zenAvatar){ zenAvatar.remove(); zenAvatar = null; }
    if (on && !zenDragInit){ initZenDrag(); zenDragInit = true; }
    if (!on) return;
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
    snapToCorner(S.draftPrefs.zenAvatarPos || 'bl', false);
  }

  function snapToCorner(corner, animate){
    if (!zenAvatar) return;
    const aw = 42, gap = 12;
    const left = (corner==='tl'||corner==='bl') ? gap : window.innerWidth - aw - gap;
    const top = (corner==='tl'||corner==='tr') ? gap : window.innerHeight - aw - gap;
    if (animate){
      zenAvatar.style.transition = 'left .32s var(--ease), top .32s var(--ease), opacity .25s var(--ease), transform .25s var(--ease)';
    } else {
      zenAvatar.style.transition = 'none';
    }
    zenAvatar.style.left = left + 'px';
    zenAvatar.style.top = top + 'px';
    zenAvatar.style.right = 'auto';
    zenAvatar.style.bottom = 'auto';
    zenAvatar.style.opacity = '.35';
    zenAvatar.style.cursor = 'grab';
    zenAvatar.dataset.pos = corner;
    document.body.classList.toggle('zen-corner-br', corner === 'br');
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
    document.addEventListener('mouseup', () => {
      if (!zenDrag || !zenAvatar) return;
      const wasMoved = zenDrag.moved;
      zenDrag = null;
      zenAvatar.classList.remove('zen-avatar--drag');
      document.body.classList.remove('zen-dragging');
      hideDropZones();
      if (wasMoved){
        zenSuppressClick = true;
        setTimeout(() => { zenSuppressClick = false; }, 100);
        const left = parseFloat(zenAvatar.style.left), top = parseFloat(zenAvatar.style.top);
        const cx = (isNaN(left) ? 12 : left) + 21, cy = (isNaN(top) ? 12 : top) + 21;
        const corner = cx < window.innerWidth/2 ? (cy < window.innerHeight/2 ? 'tl' : 'bl') : (cy < window.innerHeight/2 ? 'tr' : 'br');
        S.draftPrefs.zenAvatarPos = corner; saveState();
        snapToCorner(corner, true);
      } else {
        snapToCorner(S.draftPrefs.zenAvatarPos || 'bl', false);
      }
    });
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
    S.draftPrefs.zen = on; saveState();
    applyZen(on);
    toast(on ? 'Полноэкранный режим: Esc — выход' : 'Обычный режим', 'info');
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('zen')) toggleZen(); });

  function logout(){
    const u2 = user();
    if (u2) u2.is_online = false;
    logAudit(`Выход: ${u2.full_name}`, 'Авторизация');
    S.currentUserId = null;
    try { sessionStorage.removeItem('aw_uid'); } catch(e){}
    saveState();
    location.hash = '';
    render();
  }

  function checkProfileCompleteness(){
    const u2 = user();
    if (!u2.about || !u2.phone){
      openModal({ narrow:true, title:'Заполните профиль',
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
    openModal({
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
            <div class="chips" id="ob-bg">${Object.keys(BG_LABEL).filter(k=>k!=='photo').map(b=>`<span class="chip ${(S.draftPrefs.appBg||'doodle')===b?'on':''}" data-bg="${b}">${BG_LABEL[b]}</span>`).join('')}</div>
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
        m2.querySelectorAll('#ob-bg .chip').forEach(ch=>ch.onclick=()=>{
          m2.querySelectorAll('#ob-bg .chip').forEach(x=>x.classList.remove('on')); ch.classList.add('on');
          S.draftPrefs.appBg = ch.dataset.bg; saveState(); applyAppBg();
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
    const donut = Object.entries(stCounts).map(([st,n])=>{
      const frac = n/orders.length;
      const seg = `<circle r="40" cx="60" cy="60" fill="none" stroke="${donutColors[st]||'var(--gray)'}" stroke-width="14" stroke-dasharray="${(frac*C).toFixed(1)} ${C}" stroke-dashoffset="${(-acc*C).toFixed(1)}" transform="rotate(-90 60 60)"/>`;
      acc += frac; return seg;
    }).join('');

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
        <svg class="spark" width="220" height="70" viewBox="0 0 220 70" style="position:relative;z-index:1">
          <polyline class="line" points="${Array.from({length:14},(_,i)=>`${i/13*212+4},${58-(series[i]/maxV)*44}`).join(' ')}"/>
          ${series.map((v,i)=>v>0?`<circle cx="${i/13*212+4}" cy="${58-(v/maxV)*44}" r="2.6" fill="var(--accent)"/>`:'').join('')}
        </svg>
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
            <svg width="120" height="120" viewBox="0 0 120 120">${donut}<text x="60" y="56" text-anchor="middle" fill="var(--text)" font-size="22" font-weight="700">${orders.length}</text><text x="60" y="74" text-anchor="middle" fill="var(--muted)" font-size="10">заказов</text></svg>
            <div class="donut-legend" style="flex:1">
              ${Object.entries(stCounts).map(([st,n])=>`<div class="row"><span class="dot" style="background:${donutColors[st]||'var(--gray)'}"></span>${STATUS_META[st].label}<b>${n}</b></div>`).join('')}
            </div>
          </div></div>
        <div class="card"><div class="card-h"><h3>Выручка по дням</h3><span class="small faint">14 дней</span></div>
          <div class="card-b">
            <svg class="spark" width="100%" height="130" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
              <polygon class="area" points="${area}"/>
              <polyline class="line" points="${pts}"/>
              <line class="grid-l" x1="4" y1="${H-8}" x2="${W-8}" y2="${H-8}"/>
            </svg>
            <div class="row small faint" style="justify-content:space-between"><span>13 дн назад</span><span>пик: ${fmtMoney(maxV)}</span><span>сегодня</span></div>
          </div></div>
      </div>
            <div class="cols-4 grid" style="margin-top:12px">
        <div class="metric"><div class="metric__label">${icon(isAdmin?'card':'chart','ico-sm')} ${isAdmin?'Чистая выручка':'Выручка (выполнено)'}</div>
          <div class="metric__value">${fmtMoney(revenue)}</div>
          <div class="metric__delta"><span class="delta-up">▲ 12%</span> за 14 дней</div>
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

    function execBlock(){
      const mine = orders.sort((a,b)=>(a.deadline||Infinity)-(b.deadline||Infinity));
      return `<div class="card" style="margin-top:14px"><div class="card-h"><h3>Мои заказы</h3><span class="badge c-blue">ваш дедлайн сокращён на 15%</span></div>
        <div class="card-b stack" style="gap:9px">
          ${mine.slice(0,5).map(o=>{
            const exDl = o.deadline ? o.created_at + (o.deadline-o.created_at)*0.85 : null;
            return `<div class="list-row" data-oid="${o.id}" style="cursor:pointer">
              ${statusChip(o.status)}
              <span style="flex:1;min-width:0"><b class="small">${o.order_id}</b> <span class="small muted">· ${esc(nicheName(o.nish_id))}</span></span>
              <span class="deadline-cell small">${icon('clock','ico-sm')} ${exDl?fmtDT(exDl):'—'}</span>
              <b class="small">${fmtMoney((o.executors.find(e=>e.uid===u.id)||{}).amount||0)}</b>
            </div>`; }).join('') || '<span class="faint small">Пока нет заказов</span>'}
        </div></div>`;
    }
    $$('[data-oid]', root).forEach(el=>el.onclick=()=>CRM.openOrderDetail(el.dataset.oid));
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

  /* ---------- Чаты ---------- */
  let curChat = null;
  function chatsView(root){
    const u = user();
    const chats = chatForUser(u);
    curChat = chats.find(c=>c.id===curChat) ? curChat : chats[0]?.id;
    let emojiOpen = false;

    const renderList = ()=>{
      $$('.chat-item', root).forEach(el=>el.classList.toggle('on', el.dataset.ch===curChat));
    };

    const renderChat = ()=>{
      const c = S.chats.find(x=>x.id===curChat);
      if (!c) return;
      const msgs = noDemo(S.messages.filter(m=>m.chat_id===c.id)).sort((a,b)=>a.created_at-b.created_at);
      const canModerate = isStaff(u.role);
      const ghost = false; /* невидимка отключена в демо */
      const poll = S.polls.find(p=>p.chat_id===c.id);

      let lastDay = '';
      const msgsHtml = msgs.map(m=>{
        const day = new Date(m.created_at).toDateString();
        const daySep = day !== lastDay ? `<div class="day-sep">${new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long'}).format(m.created_at)}</div>` : '';
        lastDay = day;
        const own = m.user_id===u.id;
        const author = userById(m.user_id);
        const reactions = m.reactions ? Object.entries(m.reactions).filter(([,us])=>us.length).map(([em,us])=>`<button class="react-pill ${us.includes(u.id)?'on':''}" data-react="${m.id}|${em}">${em} ${us.length}</button>`).join('') : '';
        const pollHtml = poll && m.poll_id ? pollHTML(poll, u) : '';
        return `${daySep}
          <div class="msg ${own?'msg--own':''}" data-msg="${m.id}">
            ${own?'':avatarHTML(author,'avatar--sm')}
            <div class="msg__bubble">
              ${own?'':`<div class="who">${esc(author.full_name)}${canModerate&&ghost?' <span class="ghost-mode-note">'+icon('eye-off','ico-sm')+' невидимка</span>':''}</div>`}
              <div class="txt">${m.type==='poll'?`<span class="msg__poll-ico">${icon('poll','ico-sm')}</span>`:''}${nl2br(m.text)}</div>
              ${pollHtml}
              ${reactions?`<div class="msg__reactions">${reactions}</div>`:''}
              <span class="time">${fmtTime(m.created_at)}</span>
            </div>
          </div>`;
      }).join('');

const cm = root.querySelector('.chat-main');
      let savedScroll = 0, savedScrollHeight = 0;
      if (cm){
        const oldBox = cm.querySelector('#chat-msgs');
        if (oldBox){ savedScroll = oldBox.scrollTop; savedScrollHeight = oldBox.scrollHeight; }
      }
      const atBottom = savedScrollHeight && (savedScroll + (cm ? cm.querySelector('#chat-msgs')?.clientHeight || 0 : 0) >= savedScrollHeight - 60);
      root.querySelector('.chat-main').innerHTML = `
        <div class="chat-head">
          <button class="iconbtn" id="chat-back" style="display:none">${icon('chev-r')}</button>
          ${avatarHTML({ full_name:c.name, is_online:true },'avatar--sm')}
          <div class="chat-head__meta"><b>${esc(c.name)}</b><span>${esc(c.description||'')}</span></div>
          <span class="spacer"></span>
          ${ghost?'<span class="ghost-mode-note">'+icon('eye-off','ico-sm')+' режим невидимки</span>':''}
          <button class="iconbtn" id="chat-more">${icon('more')}</button>
        </div>
<div class="chat-msgs" id="chat-msgs">${msgsHtml || '<div class="empty">'+icon('chats')+'<span>Сообщений ещё нет — напишите первым</span></div>'}</div>
        <div class="chat-input">
          <button class="iconbtn" id="btn-emoji" title="Эмодзи">${icon('smile')}</button>
          <button class="iconbtn" id="btn-poll" title="Опрос">${icon('poll')}</button>
          <textarea id="chat-t" rows="1" placeholder="Сообщение…"></textarea>
          <button class="btn btn--primary btn--icon" id="btn-send" aria-label="Отправить">${icon('send')}</button>
        </div>`;
      const box = $('#chat-msgs', root);
      if (box) box.scrollTop = atBottom ? box.scrollHeight : savedScroll;
      /* Кнопка «Вниз» для чата */
      const chatDown = root.querySelector('.chat-msgs-down');
      if (chatDown) chatDown.remove();
      if (box && box.scrollHeight > box.clientHeight + 60 && !atBottom){
        const downBtn = document.createElement('button');
        downBtn.className = 'chat-msgs-down';
        downBtn.innerHTML = icon('chev-d');
        downBtn.title = 'Вниз';
        downBtn.onclick = () => { box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }); };
        root.querySelector('.chat-main').appendChild(downBtn);
      }
      /* Память прокрутки чата (по ID чата) */
      box && box.addEventListener('scroll', () => {
        try { sessionStorage.setItem('chatScroll_' + c.id, String(box.scrollTop)); } catch(e){}
        const dd = root.querySelector('.chat-msgs-down');
        if (dd) dd.hidden = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
      }, { passive:true });
      (c.unread = c.unread||{})[u.id] = Date.now(); saveState();

      $('#btn-emoji', root).onclick = e=>{
        emojiOpen = !emojiOpen;
        if (!emojiOpen) return;
        const dd = showDropdown(e.currentTarget, [], {});
        if (!dd) return;
        dd.classList.add('emoji-pop'); dd.style.padding='8px';
        dd.innerHTML = ['😀','😂','😍','👍','👏','🙌','🔥','❤️','😮','😢','🎉','☕','✅','⚠️','💡','🤝','🎧','📝','⏰','🚀','💯','🤔','😅','🫡'].map(em=>`<button data-em="${em}">${em}</button>`).join('');
        /* Пересчёт позиции после наполнения: плашка не должна вылезать за экран */
        const r = e.currentTarget.getBoundingClientRect();
        const ddW = dd.offsetWidth, ddH = dd.offsetHeight;
        let x = r.left;
        x = Math.max(10, Math.min(x, window.innerWidth - ddW - 10));
        let y;
        if (r.bottom + 6 + ddH > window.innerHeight) y = r.top - ddH - 6;
        else y = r.bottom + 6;
        y = Math.max(10, y);
        dd.style.left = x+'px'; dd.style.top = y+'px';
        dd.addEventListener('click', ev=>{
          const b = ev.target.closest('[data-em]');
          if (b){ const t = $('#chat-t', root); t.value += b.dataset.em; t.focus(); closeDropdown(); emojiOpen=false; }
          ev.stopPropagation();
        });
      };
      $('#btn-poll', root).onclick = ()=>{
        openModal({ narrow:true, title:'Опрос в чат',
          body:`<div class="stack" style="gap:12px">
            <div class="field"><label>Вопрос *</label><input class="input" id="pl-q2"></div>
            <div class="field"><label>Вариант 1 *</label><input class="input" id="pl-o1"></div>
            <div class="field"><label>Вариант 2 *</label><input class="input" id="pl-o2"></div>
          </div>`,
          footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-pl-save>Создать</button>`,
          onMount:(m2,close)=>{
            m2.querySelector('[data-x]').onclick = close;
            m2.querySelector('[data-pl-save]').onclick = ()=>{
              const q = m2.querySelector('#pl-q2').value.trim();
              const opts = [m2.querySelector('#pl-o1').value.trim(), m2.querySelector('#pl-o2').value.trim()].filter(Boolean);
              if (!q || opts.length < 2){ toast('Заполните вопрос и два варианта','warn'); return; }
              const p = { id:uid(), chat_id:c.id, user_id:u.id, question:q, options:opts, votes:{}, created_at:Date.now() };
              S.polls.push(p);
              S.messages.push({ id:uid(), chat_id:c.id, user_id:u.id, text:`Опрос: ${q}`, type:'poll', poll_id:p.id, created_at:Date.now(), reactions:{} });
              saveState(); renderChat(); close(); toast('Опрос создан','ok');
            };
          } });
      };
      $('#btn-send', root).onclick = sendMsg;
      $('#chat-t', root).addEventListener('keydown', e=>{ if (e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendMsg(); } });

      function sendMsg(){
        const t = $('#chat-t', root);
        const text = t.value.trim();
        if (!text) return;
        if (/\+?7[\s(-]?\d{3}[\s)-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/.test(text) && c.type!=='corporate'){
          toast('Автомодерация: похоже на персональные данные. Сообщение отправлено без телефона.', 'warn');
        }
        const clean = text.replace(/\+?7[\s(-]?\d{3}[\s)-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g, '[скрыт модерацией]');
        S.messages.push({ id:uid(), chat_id:c.id, user_id:u.id, text:clean, type:'text', created_at:Date.now(), reactions:{} });
        if (!navigator.onLine) queueOp({ desc:'Сообщение в чат (офлайн)' });
        saveState();
        t.value = '';
        renderChat();
        /* ответ коллеги для живости демо */
        if (Math.random() < 0.7){
          const others = S.users.filter(x=>x.id!==u.id && (isStaff(x.role)||x.role==='executor'||x.role==='client') && chatForUser(x).some(ch=>ch.id===c.id));
          const who = others[Math.floor(Math.random()*others.length)];
          const replies = ['Принято 👍','Смотрю сейчас','Сделаю к вечеру','Спасибо, взял в работу!','Хорошо, уточню у клиента','Отлично, продолжаем 🚀'];
          setTimeout(()=>{
            if (!document.body.contains(root)) return;
            S.messages.push({ id:uid(), chat_id:c.id, user_id:who.id, text:replies[Math.floor(Math.random()*replies.length)], type:'text', created_at:Date.now(), reactions:{} });
            saveState();
            if (curChat===c.id) renderChat();
          }, 1600 + Math.random()*1600);
        }
      }

      $('#chat-more', root).onclick = e=>showDropdown(e.currentTarget, [
        { label:'Уведомления чата: вкл', icon:'bell', onClick:()=>{ toast('Уведомления чата включены','info'); } },
        { label:'Не беспокоить 1 час', icon:'clock', onClick:()=>{ toast('Чат в режиме «Не беспокой до '+fmtTime(Date.now()+3600000),'info'); } },
        { label:'Фон чата', icon:'palette', keepOpen:true, onClick:(it)=>{
          const patterns = ['wave','dots','cross','none'];
          const cur = S.draftPrefs.chatBg || 'wave';
          const ci = patterns.indexOf(cur);
          const next = patterns[(ci + 1) % patterns.length];
          S.draftPrefs.chatBg = next; saveState();
          const cm = root.querySelector('.chat-main');
          if (cm){
            cm.className = 'chat-main';
            cm.style.backgroundImage = 'none';
            cm.style.backgroundSize = '';
            cm.style.backgroundPosition = '';
            if (next !== 'none'){
              const muted = 'color-mix(in srgb,var(--accent) 10%,transparent)';
              cm.style.backgroundImage = next === 'wave' ? `linear-gradient(90deg,${muted} .5px,transparent .5px),linear-gradient(0deg,${muted} .5px,transparent .5px)` :
                next === 'dots' ? `radial-gradient(circle at 25% 25%,${muted} 1px,transparent 1px),radial-gradient(circle at 75% 75%,${muted} 1px,transparent 1px)` :
                `linear-gradient(45deg,${muted} .5px,transparent .5px),linear-gradient(-45deg,${muted} .5px,transparent .5px)`;
              cm.style.backgroundSize = next === 'wave' ? '32px 32px' : next === 'dots' ? '40px 40px' : '26px 26px';
              cm.style.backgroundPosition = '0 0';
            }
          }
          it.label = 'Фон: '+({wave:'Решётка',grid:'Клетка',dots:'Точки',cross:'Крестики',none:'Без фона'})[next];
        }},
        ...(canModerate?['-',{ label:'Удалить чат (90 дней на восстановление)', icon:'trash', danger:true, onClick:()=>confirmModal({ title:'Удалить чат?', text:'Чат будет отключён. Восстановление возможно в течение 90 дней из бекапа.', okText:'Удалить', danger:true }).then(ok=>{ if(ok){ c.is_active=false; logAudit(`Чат удалён: ${c.name}`,'Чат'); saveState(); toast('Чат удалён. Восстановление доступно 90 дней','ok'); APP.render(); } }) }]:[])
      ]);

      box.addEventListener('click', e=>{
        const rBtn = e.target.closest('[data-react]');
        if (rBtn){
          const [mid, em] = rBtn.dataset.react.split('|');
          const m = S.messages.find(x=>x.id===mid);
          m.reactions = m.reactions||{};
          m.reactions[em] = m.reactions[em]||[];
          const i = m.reactions[em].indexOf(u.id);
          i>=0 ? m.reactions[em].splice(i,1) : m.reactions[em].push(u.id);
          if (!m.reactions[em].length) delete m.reactions[em];
          saveState(); renderChat(); return;
        }
        const bubble = e.target.closest('.msg');
        if (bubble && !e.target.closest('.react-pill') && !e.target.closest('.poll')){
          const m = S.messages.find(x=>x.id===bubble.dataset.msg);
          showDropdown(bubble, [
            ...['👍','😂','🔥','❤️','😮'].map(em=>({ label:`Реакция ${em}`, icon:'smile', onClick:()=>{
              m.reactions = m.reactions||{}; m.reactions[em] = m.reactions[em]||[];
              const i2 = m.reactions[em].indexOf(u.id);
              i2>=0 ? m.reactions[em].splice(i2,1) : m.reactions[em].push(u.id);
              saveState(); renderChat();
            }})),
            ...( (m.user_id===u.id||canModerate) ? ['-',{ label:'Удалить сообщение', icon:'trash', danger:true, onClick:()=>{
              S.messages = S.messages.filter(x=>x.id!==m.id);
              logAudit(`Сообщение удалено в «${c.name}»`,'Чат'); saveState(); renderChat();
            }}] : [])
          ], { x:e.clientX, y:e.clientY });
        }
      });
    };

    const pollHTML = (p, u2)=>{
      const totalVotes = Object.values(p.votes).reduce((a,v)=>a+v.length,0);
      return `<div class="poll"><b class="small">${esc(p.question)}</b>
        ${p.options.map(o=>{
          const n = (p.votes[o]||[]).length;
          const pct = totalVotes?Math.round(n/totalVotes*100):0;
          const voted = (p.votes[o]||[]).includes(u2.id);
          return `<div class="poll__opt" data-vote="${p.id}|${esc(o)}"><span class="fill" style="transform:scaleX(${pct/100})"></span><span>${esc(o)}${voted?' ✓':''}<b>${n} · ${pct}%</b></span></div>`;
        }).join('')}</div>`;
    };
    /* Голосование в опросах */
    root.addEventListener('click', e=>{
      const vote = e.target.closest('[data-vote]');
      if (vote){
        const [pid, opt] = vote.dataset.vote.split('|');
        const poll = S.polls.find(x=>x.id===pid);
        if (poll && !poll.votes[opt]?.includes(u.id)){
          poll.votes[opt] = poll.votes[opt] || [];
          poll.votes[opt].push(u.id);
          saveState(); renderChat();
        }
      }
    });

    root.innerHTML = `
      <div class="page-head" style="margin-bottom:12px"><div><h2>Чаты</h2><div class="sub">Корпоративные, заказные, групповые и чаты компаний</div></div>
        <button class="btn btn--primary" id="btn-broadcast">${icon('send')} Массовое сообщение</button></div>
      <div class="chats-layout">
        <div class="chat-list"><div class="chat-list__scroll">
          ${chats.map(c=>{
            const last = S.messages.filter(m=>m.chat_id===c.id).slice(-1)[0];
            const un = unreadCount(c, u.id);
            return `<div class="chat-item ${c.id===curChat?'on':''}" data-ch="${c.id}">
              ${avatarHTML({ full_name:c.name, is_online:c.type==='corporate' },'avatar--sm')}
              <div class="chat-item__meta">
                <div class="t"><b>${esc(c.name)}</b><time>${last?fmtTime(last.created_at):''}</time></div>
                <div class="p">${last?esc(last.text.slice(0,42)):esc(c.description||'')}</div>
              </div>
              ${un?`<span class="chat-item__unread">${un}</span>`:''}
            </div>`;
          }).join('')}
        </div></div>
        <div class="chat-main" id="chat-main"></div>
      </div>`;

    const bc = $('#btn-broadcast', root);
    bc.style.display = isStaff(user().role) ? '' : 'none';
    bc.onclick = ()=>openModal({ narrow:true, title:'Массовое сообщение клиентам',
      body:`<div class="field"><label>Текст рассылки</label><textarea class="input" id="bc-t" placeholder="Например: сообщаем о новых тарифах…"></textarea></div><p class="small faint" style="margin-top:8px">Получатели: клиенты с согласием на рассылку (${noDemo(S.users.filter(x=>x.role==='client'&&x.consent_marketing)).length})</p>`,
      footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-send>Отправить</button>`,
      onMount:(m2,c2)=>{ m2.querySelector('[data-x]').onclick=c2;
        m2.querySelector('[data-send]').onclick=()=>{
          if (!m2.querySelector('#bc-t').value.trim()){ toast('Введите текст','err'); return; }
          logAudit('Массовая рассылка клиентам','Рассылка'); saveState();
          toast('Рассылка поставлена в очередь отправки','ok'); c2();
        }; } });

    $$('.chat-item', root).forEach(el=>el.onclick = ()=>{ curChat = el.dataset.ch; renderList(); renderChat(); });
    renderChat();
    /* Кнопка переключения списка чатов в полноэкранном режиме */
    if (document.body.classList.contains('zen')){
      const rootEl = root;
      const toggle = document.createElement('button');
      toggle.className = 'chat-list-toggle';
      toggle.innerHTML = icon('menu');
      toggle.title = 'Список чатов';
      rootEl.appendChild(toggle);
      toggle.onclick = ()=>{ const lst = rootEl.querySelector('.chats-layout'); if (lst) lst.classList.toggle('list-hidden'); };
      toggle.onmouseenter = () => { const lst = rootEl.querySelector('.chats-layout'); if (lst) lst.classList.remove('list-hidden'); };
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
    $$('.ticket-row', root).forEach(r=>r.onclick = e=>{
      if (e.target.closest('button')) return;
      const t = S.tickets.find(x=>x.id===r.dataset.t);
      openModal({ title:`Тикет · ${t.subject}`, narrow:true,
        body:`<p class="small" style="color:var(--text-2)">${nl2br(t.message)}</p><p class="small faint" style="margin-top:10px">От: ${esc((userById(t.user_id)||{}).full_name)} ${t.order_id?'· заказ '+t.order_id:''} · ${fmtDT(t.created_at)}</p>`,
        footer:`<button class="btn btn--primary" data-x>Закрыть</button>`,
        onMount:(m2,c2)=>m2.querySelector('[data-x]').onclick=c2 });
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
            return `<div class="idea-card ${top?'idea-card--top':''} ${i.status==='hidden'?'bl':''}" style="${i.status==='hidden'?'opacity:.55':''}">
              ${top?`<span class="badge c-accent" style="position:absolute;top:-9px;right:12px">🔥 топ идея</span>`:''}
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
      $('#idea-new', root).onclick = ()=>openModal({ narrow:true, title:'Новая идея',
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
        openModal({ narrow:true, title:'Новая ниша',
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
        openModal({ narrow:true, title:'Новая специализация',
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
  function settingsView(root, section){
    const u = user();
    section = section || settingsSection || 'profile';
    const sections = [
      ['profile','Профиль','clients'], ['look','Внешний вид','palette'], ['notify','Уведомления и рассылки','bell'],
      ['security','Безопасность','shield'], ['keys','Горячие клавиши','terminal'],
      ['docs','Справка и документы','file'], ['about','О приложении','info'],
      ...(u.role==='admin'?[['calc','Калькулятор и услуги','calc']]:[]),
      ...(u.role==='admin'?[['tech','Технические работы','alert']]:[]),
      ...(u.role==='admin'?[['product','Демо-режим и версии','flag'],['data','Данные и бекапы','db'],['texts','Тексты интерфейса','edit']]:[])
    ];
    const renderSec = ()=>{
      const el = root.querySelector('#set-body');
      if (section==='profile') el.innerHTML = profileHTML(u);
      if (section==='look') el.innerHTML = lookHTML(u);
      if (section==='notify') el.innerHTML = notifyHTML(u);
      if (section==='security') el.innerHTML = securityHTML(u);
      if (section==='keys') el.innerHTML = keysHTML();
      if (section==='docs') el.innerHTML = docsHTML();
      if (section==='about') el.innerHTML = aboutHTML();
      if (section==='calc') el.innerHTML = calcHTML();
      if (section==='data') el.innerHTML = dataHTML();
      if (section==='product') el.innerHTML = productHTML();
      if (section==='tech') el.innerHTML = techHTML();
      if (section==='texts') el.innerHTML = textsHTML();
      if (section==='calc') bindCalc(el); else if (section==='product') bindProduct(el); else if (section==='tech') bindTech(el); else if (section==='texts') bindTexts(el); else bindSection(section, el);
      /* Плавное появление секции */
      el.classList.remove('set-sec-in'); void el.offsetWidth; el.classList.add('set-sec-in');
    };
    root.innerHTML = `
      <div class="page-head"><div><h2>${__t('settings.title','Настройки')}</h2><div class="sub">${__t('settings.subtitle','Профиль, внешний вид, безопасность и документы')}</div></div></div>
      <div class="settings-grid">
        <div class="settings-nav card card-pad" style="padding:8px">
          ${sections.map(([id,label,ic])=>`<button class="side__link ${section===id?'on':''}" data-sec="${id}" style="width:100%">${icon(ic)}<span>${label}</span></button>`).join('')}
        </div>
        <div id="set-body" class="stack"></div>
      </div>`;
    $$('[data-sec]', root).forEach(b=>b.onclick=()=>{ section=b.dataset.sec; settingsSection=section; $$('[data-sec]',root).forEach(x=>x.classList.toggle('on', x===b)); renderSec(); });
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
          <div class="field"><label>Логин</label><input class="input" value="${esc(u2.username)}" disabled></div>
          <div class="field"><label>Email</label><input class="input" id="pf-email" value="${esc(u2.email)}"></div>
          <div class="field"><label>Телефон</label><input class="input" id="pf-phone" value="${esc(u2.phone)}"></div>
        </div>
        <div class="field" style="margin-top:12px"><label>О себе</label><textarea class="input" id="pf-about">${esc(u2.about||'')}</textarea></div>
        ${u2.role==='executor'?`<div class="row row--between" style="margin-top:12px"><b class="small">Рабочий статус</b>
          <div class="seg" id="pf-ws"><button data-w="working" class="${u2.ext.workStatus==='working'?'on':''}">Работаю</button><button data-w="not_working" class="${u2.ext.workStatus!=='working'?'on':''}">Не работаю</button></div></div>`:''}
        <button class="btn btn--primary" id="pf-save" style="margin-top:16px">${icon('check-c')} Сохранить изменения</button>
        <p class="small faint" style="margin-top:8px">Все изменения личной информации модерируются менеджерами и администратором.</p></div>`;
    }
    function lookHTML(u2){
      const mode = u2.mode || 'system';
      const accent = u2.accent || 'red';
      const BG_LABEL = { doodle:'Дудлы', photo:'Моё фото', none:'Без фона' };
      const curBg = S.draftPrefs.appBg || 'doodle';
      const hasPhoto = !!S.draftPrefs.appBgPhoto;
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
        <p class="small muted" style="margin-bottom:10px">Дудлы — абстрактная «звуковая студия» под акцент темы. Или ваше фото на заднем плане.</p>
        <div class="bg-cards" id="lk-bg">
          ${Object.entries(BG_LABEL).map(([k,v])=>{
            const on = curBg===k ? 'on' : '';
            const prev = k==='doodle'
              ? `<div class="bg-card__prev bg-card__prev--doodle"><div class="bg-doodle-mini"><span></span><span></span><span></span><span></span><span></span><span></span></div></div>`
              : k==='photo'
              ? `<div class="bg-card__prev" style="background:${hasPhoto?`url('${S.draftPrefs.appBgPhoto}') center/cover no-repeat`:''}"><span class="bg-card__pic-ico">${icon('image')}</span></div>`
              : `<div class="bg-card__prev bg-card__prev--none"></div>`;
            return `<div class="bg-card ${on}" data-bg="${k}">${prev}<div class="bg-card__name">${v}</div></div>`;
          }).join('')}
        </div>
        ${hasPhoto?`<div style="margin-top:10px;display:flex;gap:8px;align-items:center"><img src="${S.draftPrefs.appBgPhoto}" style="width:70px;height:40px;object-fit:cover;border-radius:8px;border:1px solid var(--border-2)"><span class="small faint">Ваше фото · затемнение ${S.draftPrefs.appBgDark||0}%</span></div>`:''}
        <input type="file" id="lk-bg-photo" accept="image/*" hidden>
        <button class="btn btn--ghost btn--sm" id="lk-bg-photo-btn" style="margin-top:10px">${icon('image','ico-sm')} Загрузить своё фото</button>
        ${hasPhoto?`<button class="btn btn--ghost btn--sm" id="lk-bg-photo-clear" style="margin-left:6px">${icon('trash')} Убрать</button>`:''}</div>`;
    }
    function calcHTML(){
      const rows = nid => (S.calcServices[nid]||[]).map(s=>`<tr data-sid="${s.id}">
          <td><input class="input" data-f="name" value="${esc(s.name)}" style="padding:6px 10px"></td>
          <td><input class="input" data-f="price" type="number" min="0" value="${s.price}" style="padding:6px 10px;width:100px"></td>
          <td><input class="input" data-f="unit" value="${esc(s.unit||'')}" style="padding:6px 10px"></td>
          <td><input class="input" data-f="margin" type="number" min="0" max="90" value="${s.margin||0}" style="padding:6px 10px;width:76px"></td>
          <td style="width:40px"><button class="iconbtn" data-del="${s.id}" title="Удалить услугу">${icon('trash')}</button></td>
        </tr>`).join('');
      return `<div class="card card-pad"><h3 style="margin-bottom:6px">Услуги калькулятора</h3>
        <p class="small muted" style="margin-bottom:12px">Перечень услуг, стоимость и маржа платформы — по нишам. Настраивается администратором — владельцем платформы. Калькулятор принимает ввод с клавиатуры.</p>
        ${S.niches.map(n=>`<div class="card card-pad" style="background:var(--bg-2);margin-top:10px">
          <div class="row row--between"><b class="small">${esc(n.name)}</b>
            <button class="btn btn--ghost btn--sm" data-add="${n.id}">${icon('plus')} Услуга</button></div>
          <div class="tbl-wrap" style="margin-top:8px;border:0"><table class="tbl" style="min-width:0">
            <thead><tr><th>Услуга</th><th>Цена, ₽</th><th>Единица</th><th>Маржа, %</th><th></th></tr></thead>
            <tbody data-niche="${n.id}">${rows(n.id)}</tbody>
          </table></div>
        </div>`).join('')}
        <button class="btn btn--primary" id="calc-save" style="margin-top:14px">${icon('check-c')} Сохранить услуги</button>
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
      const sessions = u2.role==='admin' ? S.audit.length : 3;
      return `<div class="card card-pad"><h3 style="margin-bottom:6px">Активные сессии</h3>
        <p class="small muted" style="margin-bottom:8px">Устройства, браузеры и IP-адреса ваших сессий.</p>
        ${[['MacBook Pro · Chrome · текущая',fmtTime(Date.now()-40*60000)],['iPhone 15 · Safari',timeAgo(Date.now()-26*3600000)],['Windows 11 · Edge',timeAgo(Date.now()-3*DAY)]]
          .map(([d,t])=>`<div class="session-row">${icon('device')}<span style="flex:1"><b class="small">${d}</b><div class="cell-sub">IP ${rndIp()} · вход ${t}</div></span></div>`).join('')}
        <button class="btn btn--danger btn--sm" id="sec-revoke" style="margin-top:12px">${icon('exit')} Выйти на всех устройствах</button></div>
      <div class="card card-pad"><h3 style="margin-bottom:10px">Двухфакторная аутентификация</h3>
        <div class="row row--between"><span class="small">SMS-код на номер ${esc(u2.phone)}</span><button class="btn btn--soft btn--sm" id="sec-2fa">Включить</button></div>
        <p class="small faint" style="margin-top:8px">Код никому не сообщается. Сотрудники поддержки никогда не запрашивают его.</p></div>
      ${u2.role==='admin'?`<div class="card card-pad"><h3 style="margin-bottom:10px">Подозрительная активность</h3>
        <div class="log-box"><div class="err">203.0.113.66 — 5 неудачных попыток входа → блокировка 15 мин (${fmtDate(Date.now()-3*DAY)})</div><div class="warn">Необычное время активности: u-ex4, 03:40 (${fmtDate(Date.now()-2*DAY)})</div></div></div>`:''}`;
    }
    function keysHTML(){
      const defs = [['Поиск / палетка команд','search','Ctrl K'],['Новый заказ','new-order','Ctrl N'],['Настройки','settings','Ctrl ,'],['Переключить тему','theme','Ctrl Shift T']];
      return `<div class="card card-pad"><h3 style="margin-bottom:12px">Горячие клавиши</h3>
        ${defs.map(([label,id,keys])=>`<div class="session-row">${icon('terminal')}<span style="flex:1" class="small">${label}</span><span class="kbd" data-key="${id}">${keys}</span></div>`).join('')}
        <p class="small faint" style="margin-top:10px">Нажмите на комбинацию, чтобы переназначить (демо: только просмотр).</p></div>`;
    }
    function aboutHTML(){
      return `<div class="card card-pad row" style="gap:16px">
        <span class="side__brand-logo logo-mark--lg">${icon('logo-full')}</span>
        <div><b style="font-size:16px">Audiowizard Workspace</b><div class="small muted">Версия ${esc((S.product||{}).version || '0.9.4-beta')} · сборка ${(S.product||{}).build || 216} ${((S.product||{}).beta !== false)?'<span class="beta-badge">Beta</span>':''}</div></div>
        <span class="spacer"></span><button class="btn btn--soft btn--sm" id="ab-tour">${icon('bulb')} Пройти тур</button><button class="btn btn--soft btn--sm" id="ab-check">${icon('refresh')} Проверить обновления</button></div>
      <div class="card card-pad"><h3 style="margin-bottom:12px">Модели развертывания</h3>
        <div class="cols-2 grid">
          <div class="card card-pad" style="background:var(--bg-2)"><div class="row">${icon('cloud')}<b>On-Demand (SaaS)</b><span class="badge c-green">активна</span></div>
            <p class="small muted" style="margin-top:8px">Облачная модель: только браузер и интернет. AI-сервисы по подписке.</p></div>
          <div class="card card-pad" style="background:var(--bg-2)"><div class="row">${icon('server')}<b>On-Premise</b><span class="badge c-gray">в разработке</span></div>
            <p class="small muted" style="margin-top:8px">Локальное развертывание в контуре клиента: Docker, лицензия, защищённый репозиторий обновлений.</p></div>
        </div></div>
      <div class="card card-pad"><h3 style="margin-bottom:6px">История обновлений</h3>
        ${S.changelog.map(v=>`<div class="ver-item"><span class="ver-badge">v${esc(v.version)}</span>
          <span><b class="small">${esc(v.title)}</b><p class="small muted" style="margin-top:3px">${esc(v.content)}</p><span class="faint" style="font-size:11px">${fmtDate(v.created_at)}</span></span></div>`).join('')}</div>
      <div class="card card-pad" style="border-color:color-mix(in srgb,var(--accent) 30%,transparent)"><h3 style="margin-bottom:6px">Сообщить о проблеме</h3>
        <p class="small muted" style="margin-bottom:10px">Что-то работает не так или есть идея? Напишите парой строк — мы получим сообщение.</p>
        <div class="field"><input class="input" id="ab-issue" placeholder="Коротко: что случилось или что улучшить"></div>
        <div class="field" style="margin-top:8px"><textarea class="input" id="ab-issue-detail" rows="2" placeholder="Подробности (необязательно)"></textarea></div>
        <div class="row" style="gap:8px;margin-top:8px"><button class="btn btn--primary btn--sm" id="ab-issue-send">${icon('send')} Отправить</button><span class="small faint" id="ab-issue-msg"></span></div></div>`;
    }
    function docsHTML(){
      let docs = S.settings.documents || [
        { title:'Пользовательское соглашение', body:'Договор между пользователем и сервисом Audiowizard: предмет, права и обязанности сторон, порядок оказания услуг обработки контента, ответственность и порядок разрешения споров. Актуальная редакция от 01.08.2026.' },
        { title:'Политика конфиденциальности', body:'Мы обрабатываем персональные данные (ФИО, контакты, реквизиты) в целях исполнения заказов. Данные хранятся с шифрованием AES-256, не передаются третьим лицам, кроме случаев, предусмотренных законодательством РФ. Вы можете запросить удаление данных в любой момент.' },
        { title:'Правила сервиса', body:'Квоты и ограничения: чаевые не более 100% стоимости заказа и 10 000 ₽ разово; файлы удаляются автоматически через 90 дней; рейтинги исполнителей изменяются через голосование менеджеров; материалы заказов принадлежат заказчику (ст. 146, 183 УК РФ).' },
        { title:'Справка и FAQ', body:'Как создать заказ: раздел «Заказы» → «Новый заказ» → заполните карточку. Как загрузить файл: перетащите его в форму заказа. Как сменить тему: аватар → «Тема».' }
      ];
      if (!S.settings.documents) S.settings.documents = docs;
      docs = S.settings.documents;
      return `<div class="stack">
        ${docs.map((d,i)=>`<details class="doc-acc"><summary>${icon('file')} ${esc(d.title)} ${icon('chev-d','ico-sm')}</summary><div class="body">${esc(d.body).replace(/\n/g,'<br>')}</div>
          ${user().role==='admin'?`<div class="doc-edit"><button class="btn btn--ghost btn--sm" data-edit-doc="${i}">${icon('edit')} Редактировать</button></div>`:''}
        </details>`).join('')}
        ${user().role==='admin'?`<button class="btn btn--ghost btn--sm" id="doc-add" style="margin-top:8px">${icon('plus')} Добавить документ</button>`:''}
        <p class="small faint">Актуальные версии документов также доступны в футере сайта и отправляются в центр уведомлений при обновлении.</p></div>`;
    }
    function productHTML(){
      const notes = (S.product && S.product.notes) || [];
      return `<div class="card card-pad" style="border-color:var(--accent);border-width:1.5px"><h3 style="margin-bottom:10px">Демо-режим и версии</h3>
        <div class="row row--between" style="margin-bottom:12px"><span class="small">Показывать бейдж «Beta» в футере и шапке</span>
          <label class="switch"><input type="checkbox" id="pr-beta" ${S.product&&S.product.beta?'checked':''}><span class="tr"></span></label></div>
        <div class="cols-2 grid" style="gap:12px">
          <div class="field"><label>Версия</label><input class="input" id="pr-version" value="${esc(S.product&&S.product.version || '0.9.4-beta')}"></div>
          <div class="field"><label>Сборка</label><input class="input" id="pr-build" value="${(S.product&&S.product.build) || 216}"></div>
        </div>
        <div class="row row--between" style="margin:12px 0;padding:10px 12px;background:var(--accent-soft);border-radius:12px"><span class="small"><b>Демо-вход и демо-данные</b><br><span class="muted">Включайте для показа демо-входа и демо-данных, выключайте для чистого запуска — данные при этом не удаляются</span></span>
          <label class="switch"><input type="checkbox" id="pr-demo" ${(S.settings.demoEnabled!==false)?'checked':''}><span class="tr"></span></label></div>
        <div class="field" style="margin-top:12px"><label>Патчноуты (по одному на строку)</label>
          <textarea class="input" id="pr-notes" rows="4">${esc(notes.join('\n'))}</textarea></div>
        <hr class="divider">
        <b class="small">Разделы меню в продакшене</b>
        <p class="small muted" style="margin:6px 0 10px">Отметьте разделы, которые останутся в меню при отключённом демо-режиме. Скрытые разделы недоступны никому, кроме вас.</p>
        <div class="stack" style="gap:10px">
          ${NAV.map(sec=>{ const routes = sec.items.filter(it=>it.route!=='settings').map(it=>it.route);
            const allOn = routes.every(r => !(S.settings.hiddenRoutes||[]).includes(r));
            return `
            <div class="card card-pad" style="padding:12px">
              <div class="row row--between" style="margin-bottom:${routes.length?8:0}px">
                <label class="check" style="gap:8px"><input type="checkbox" data-hr-sec="${esc(sec.sec)}" ${routes.every(r=>(S.settings.hiddenRoutes||[]).includes(r))?'':'checked'} ${routes.length?'':'disabled'}><span class="box"><svg viewBox="0 0 24 24"><path d="m8.3 12.3 2.5 2.5 4.9-5.3"/></svg></span><b class="small">${esc(sec.sec)}</b></label>
                <span class="tiny faint">${routes.length} разделов</span>
              </div>
              <div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">
                ${sec.items.filter(it=>it.route!=='settings').map(it=>`<label class="check" style="gap:6px"><input type="checkbox" data-hr="${it.route}" ${(S.settings.hiddenRoutes||[]).includes(it.route)?'':'checked'}><span class="box"><svg viewBox="0 0 24 24"><path d="m8.3 12.3 2.5 2.5 4.9-5.3"/></svg></span><span class="small">${esc(it.title)}</span></label>`).join('')}
              </div>
            </div>`; }).join('')}
        </div>
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
    /* ---------- Админ: редактор текстов интерфейса ---------- */
    const UI_TEXT_KEYS = [
      ['dash.greeting', 'Приветствие (Доброе утро/день/вечер… — обращение)'],
      ['dash.subtitle', 'Подпись под приветствием на дашборде'],
      ['dash.clock', 'Формат времени под приветствием (локальное)'],
      ['settings.title', 'Заголовок страницы «Настройки»'],
      ['settings.subtitle', 'Подзаголовок на странице «Настройки»'],
      ['nav.brand', 'Название продукта в меню слева']
    ];
    function textsHTML(){
      const map = S.uiText || {};
      const rows = UI_TEXT_KEYS.map(([k, hint])=>`
        <div class="field" data-key="${esc(k)}" style="margin-bottom:10px">
          <label>${esc(k)} <span class="small faint">— ${esc(hint)}</span></label>
          <input class="input i18n-in" value="${esc(map[k] != null ? map[k] : '')}" placeholder="По умолчанию из кода">
        </div>`).join('');
      return `<div class="card card-pad"><h3 style="margin-bottom:4px">Тексты интерфейса</h3>
        <p class="small muted" style="margin-bottom:14px">Переопределите любые строки приложения: приветствие, подписи, подсказки. Пустое поле = текст по умолчанию. Изменения применяются сразу и видны всем пользователям.</p>
        <div id="i18n-list">${rows}</div>
        <div class="row row--between" style="margin-top:14px">
          <button class="btn btn--ghost btn--sm" id="i18n-reset">${icon('refresh')} Сбросить все</button>
          <button class="btn btn--primary btn--sm" id="i18n-apply">${icon('check-c')} Применить</button>
        </div></div>`;
    }
    function bindTexts(el){
      const apply = () => {
        $$('.i18n-in', el).forEach(inp => {
          const k = inp.closest('[data-key]').dataset.key;
          const v = inp.value.trim();
          if (v) S.uiText[k] = v; else delete S.uiText[k];
        });
        saveState();
        toast('Тексты обновлены','ok');
      };
      el.querySelector('#i18n-apply').onclick = apply;
      el.querySelector('#i18n-reset').onclick = () => {
        S.uiText = {}; saveState();
        $$('.i18n-in', el).forEach(inp => inp.value = '');
        toast('Тексты сброшены к стандарту','ok');
      };
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
      el.querySelector('#pr-beta').addEventListener('change', e=>{
        S.product = S.product || {};
        S.product.beta = e.target.checked;
        saveState(); toast('Бейдж Beta: ' + (e.target.checked ? 'показывается' : 'скрыт'), 'ok');
        APP.render();
      });
      el.querySelectorAll('[data-hr-sec]').forEach(cb=>cb.addEventListener('change', ()=>{
        const secName = cb.dataset.hrSec;
        const secObj = NAV.find(x=>x.sec===secName);
        if (!secObj) return;
        const routes = secObj.items.filter(it=>it.route!=='settings').map(it=>it.route);
        S.settings.hiddenRoutes = S.settings.hiddenRoutes || [];
        if (!cb.checked) routes.forEach(r=>{ if (!S.settings.hiddenRoutes.includes(r)) S.settings.hiddenRoutes.push(r); });
        else S.settings.hiddenRoutes = S.settings.hiddenRoutes.filter(x=>!routes.includes(x));
        saveState();
        el.querySelectorAll('[data-hr]').forEach(ch=>{ if (routes.includes(ch.dataset.hr)) ch.checked = cb.checked; });
      }));
      el.querySelectorAll('[data-hr]').forEach(cb=>cb.addEventListener('change', ()=>{
        S.settings.hiddenRoutes = S.settings.hiddenRoutes || [];
        const r = cb.dataset.hr;
        if (cb.checked) S.settings.hiddenRoutes = S.settings.hiddenRoutes.filter(x=>x!==r);
        else S.settings.hiddenRoutes.push(r);
        saveState();
        toast(cb.checked ? 'Раздел будет виден в продакшене' : 'Раздел скрыт в продакшене', 'info');
      }));
      el.querySelector('#pr-demo').addEventListener('change', e=>{
        S.settings = S.settings || {};
        S.settings.demoEnabled = e.target.checked;
        saveState(); toast('Демо-вход: ' + (e.target.checked ? 'включён' : 'отключён полностью'), 'ok');
        APP.render();
      });
      el.querySelector('#pr-save').onclick = ()=>{
        S.product = S.product || {};
        S.product.version = el.querySelector('#pr-version').value.trim();
        S.product.build = +el.querySelector('#pr-build').value || S.product.build;
        S.product.notes = el.querySelector('#pr-notes').value.split('\n').map(s=>s.trim()).filter(Boolean);
        logAudit('Продукт: версия/патчноуты обновлены', 'Настройки');
        saveState(); toast('Продукт обновлён', 'ok'); APP.render();
      };
    }
    function bindSection(sec, el){
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
          openModal({ title:u.full_name, narrow:true,
            body:`<div style="text-align:center"><img src="${u.avatar}" style="max-width:100%;border-radius:20px;max-height:50vh;box-shadow:var(--sh-2)"></div>`,
            footer:'<button class="btn btn--primary" data-x>Закрыть</button>',
            onMount:(m2,c2)=>{ m2.querySelector('[data-x]').onclick=c2; }
          });
        };
        $('#pf-save', el).onclick = ()=>{
          u.full_name = $('#pf-name', el).value.trim() || u.full_name;
          u.email = $('#pf-email', el).value.trim() || u.email;
          u.phone = $('#pf-phone', el).value.trim() || u.phone;
          u.about = $('#pf-about', el).value;
          logAudit('Профиль обновлён', 'Профиль'); saveState();
          toast('Изменения сохранены и отправлены на модерацию','ok'); APP.render();
        };
        $$('#pf-ws button', el).forEach(b=>b.onclick=()=>{ u.ext.workStatus=b.dataset.w; saveState(); renderSec(); });
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
          markSel(); /* без APP.render(): плашки/стейт страницы не сбрасываются */
        });
        el.querySelectorAll('[data-accent]').forEach(c=>c.onclick = ()=>{
          u.accent = c.dataset.accent; saveState(); applyTheme(u.mode, u.accent);
          logAudit(`Акцент: ${ACCENT_LABEL[u.accent||'violet']}`, 'Настройки');
          toast(`Акцент: ${ACCENT_LABEL[u.accent||'violet']}`, 'ok');
          markSel();
        });
        const customApply = el.querySelector('#lk-custom-apply');
        if (customApply) customApply.onclick = () => {
          const hex = el.querySelector('#lk-custom-color').value;
          if (!/^#[0-9a-fA-F]{6}$/.test(hex)) { toast('Некорректный цвет','warn'); return; }
          S.settings.customAccentColor = hex;
          u.accent = 'custom'; saveState(); applyTheme(u.mode, u.accent);
          logAudit('Акцент: свой цвет '+hex, 'Настройки');
          toast('Свой цвет применён','ok'); markSel();
        };
        $$('#lk-bg .bg-card', el).forEach(ch=>ch.onclick = ()=>{
          S.draftPrefs.appBg = ch.dataset.bg; saveState();
          applyAppBg();
          $$('#lk-bg .bg-card', el).forEach(x=>x.classList.toggle('on', x===ch));
        });
        $('#lk-bg-photo-btn', el).onclick = ()=>$('#lk-bg-photo', el).click();
        $('#lk-bg-photo', el).onchange = e=>{
          const f = e.target.files[0]; if (!f) return;
          openBgCropper(f, (dataUrl, darken) => {
            S.draftPrefs.appBg = 'photo'; S.draftPrefs.appBgPhoto = dataUrl; S.draftPrefs.appBgDark = darken;
            saveState(); applyAppBg(); renderSec(); toast('Фон сохранён','ok');
          });
        };
        $('#lk-bg-photo-clear', el).onclick = ()=>{
          delete S.draftPrefs.appBgPhoto; delete S.draftPrefs.appBgDark;
          if (S.draftPrefs.appBg === 'photo') S.draftPrefs.appBg = 'wave';
          saveState(); applyAppBg(); renderSec(); toast('Фон убран','ok');
        };
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
        $('#ab-check', el).onclick = ()=>checkUpdates(true);
        $('#ab-tour', el).onclick = ()=>{ u.tour_completed=false; saveState(); startTour(0); };
        $('#ab-issue-send', el).onclick = ()=>{
          const subj = $('#ab-issue', el).value.trim();
          if (!subj){ toast('Опишите проблему в одном предложении','warn'); return; }
          const detail = $('#ab-issue-detail', el).value.trim();
          S.tickets.unshift({ id:uid(), user_id:u.id, subject:subj, message:detail||subj, order_id:null, status:'new', created_at:Date.now(), resolved_at:null });
          logAudit('Обращение из «О приложении»: '+subj, 'Тикет');
          saveState(); $('#ab-issue', el).value = ''; $('#ab-issue-detail', el).value = '';
          $('#ab-issue-msg', el).textContent = 'Отправлено, спасибо!';
          toast('Сообщение отправлено — мы получили его','ok');
        };
      }
      if (sec==='docs'){
        el.querySelectorAll('[data-edit-doc]').forEach(btn=>btn.onclick = ()=>{
          const i = +btn.dataset.editDoc;
          const doc = S.settings.documents[i];
          if (!doc) return;
          openModal({ narrow:true, title:'Редактировать документ',
            body:`<div class="stack" style="gap:12px">
              <div class="field"><label>Название</label><input class="input" id="dc-title" value="${esc(doc.title)}"></div>
              <div class="field"><label>Содержание</label><textarea class="input" id="dc-body" rows="6">${esc(doc.body)}</textarea></div>
            </div>`,
            footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-save>Сохранить</button>`,
            onMount:(m2,c2)=>{ m2.querySelector('[data-x]').onclick=c2; m2.querySelector('[data-save]').onclick=()=>{
              S.settings.documents[i].title = m2.querySelector('#dc-title').value.trim() || doc.title;
              S.settings.documents[i].body = m2.querySelector('#dc-body').value;
              logAudit('Документ обновлён: '+S.settings.documents[i].title, 'Документы');
              saveState(); c2(); renderSec(); toast('Документ сохранён','ok');
            }; }
          });
        });
        const docAdd = el.querySelector('#doc-add');
        if (docAdd) docAdd.onclick = ()=>{
          openModal({ narrow:true, title:'Новый документ',
            body:`<div class="stack" style="gap:12px">
              <div class="field"><label>Название</label><input class="input" id="dc-title" placeholder="Название документа"></div>
              <div class="field"><label>Содержание</label><textarea class="input" id="dc-body" rows="6" placeholder="Текст…"></textarea></div>
            </div>`,
            footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-save>Добавить</button>`,
            onMount:(m2,c2)=>{ m2.querySelector('[data-x]').onclick=c2; m2.querySelector('[data-save]').onclick=()=>{
              const t = m2.querySelector('#dc-title').value.trim();
              if (!t){ toast('Введите название','warn'); return; }
              S.settings.documents.push({ title:t, body:m2.querySelector('#dc-body').value });
              logAudit('Документ добавлен: '+t, 'Документы');
              saveState(); c2(); renderSec(); toast('Документ добавлен','ok');
            }; }
          });
        };
      }
      if (sec==='data'){
        const mres = el.querySelector('#dt-menu-reset');
        if (mres) mres.onclick = () => {
          NAV = JSON.parse(JSON.stringify(NAV_DEFAULT));
          window.NAV = NAV;
          delete S.draftPrefs.navCustom; delete S.draftPrefs.navCustomOrder;
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
    window.addEventListener('online', ()=>{
      const n = flushOps();
      if (n) toast(`${n} офлайн-операций синхронизировано`, 'ok', 'Сеть восстановлена');
    });
    window.addEventListener('offline', ()=>{
      toast('Нет сети — черновики сохраняются локально, действия встанут в очередь', 'warn', 'Офлайн-режим');
    });
  }
  function notifyUpdate(){
    toast('Доступна новая версия приложения', 'info', 'Обновление');
    openModal({ narrow:true, title:'Обновление готово',
      body:`<p class="small muted">Новая версия загружена в фоне. Обновить сейчас или продолжить работу и обновиться позже?</p>`,
      footer:`<button class="btn btn--ghost" data-later>Позже</button><button class="btn btn--primary" data-now>Обновить сейчас</button>`,
      onMount:(m2,c2)=>{
        m2.querySelector('[data-later]').onclick=c2;
        m2.querySelector('[data-now]').onclick=()=>{ swReg && swReg.waiting && swReg.waiting.postMessage({type:'SKIP_WAITING'}); setTimeout(()=>location.reload(), 300); };
      } });
  }
  async function checkUpdates(manual){
    if (!location.protocol.startsWith('http')){ if (manual) toast('Проверка обновлений доступна при запуске по http(s); при локальном файле приложение всегда актуально', 'info'); return; }
    try{
      const res = await fetch('version.json', { cache:'no-store' });
      const data = await res.json();
      const appV = ((S.product||{}).version || '0.9.4-beta');
      const known = localStorage.getItem('aw_seen_ver');
      const serverV = (S.product||{}).version || data.version;
      if (manual) toast(`Версия приложения: ${appV} · Сервер: ${serverV}`, 'info', 'Проверка обновлений');
      if (known && known !== serverV) notifyUpdate();
      localStorage.setItem('aw_seen_ver', serverV);
    }catch(e){ if (manual) toast('Не удалось проверить обновления (нет сервера в демо-режиме)','warn'); }
  }

  /* ---------- Горячие клавиши ---------- */
  function initKeys(){
    document.addEventListener('keydown', e=>{
      if (e.key==='Escape'){ closeDropdown(); closePalette(); }
      if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); user() ? openPalette() : null; }
      if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='n' && user() && ['admin','top_manager','manager','client'].includes(user().role)){ e.preventDefault(); if (window.runQuickSel) window.runQuickSel(); else { if (route.name !== 'orders') go('orders'); setTimeout(()=>CRM.openOrderForm(), route.name==='orders'?60:340); } }
      if ((e.ctrlKey||e.metaKey) && e.key===','){ e.preventDefault(); user() && go('settings'); }
      if ((e.ctrlKey||e.metaKey) && e.shiftKey && e.key.toLowerCase()==='t'){ e.preventDefault(); user() && cycleTheme(); }
      if ((e.ctrlKey||e.metaKey) && e.shiftKey && e.key.toLowerCase()==='f'){ e.preventDefault(); user() && toggleZen(); }
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

  /* ---------- Роутинг видов ---------- */
  function saveThemePref(mode, accent){
  try { localStorage.setItem('aw_theme', JSON.stringify({mode:mode||'system', accent:accent||'violet'})); } catch(e){}
}
function applyAppBg(){
    const bg = S.draftPrefs.appBg || 'doodle';
    const photo = S.draftPrefs.appBgPhoto;
    const dark = S.draftPrefs.appBgDark || 0;
    document.body.className = document.body.className.replace(/app-bg--\S+/g, '').trim();
    document.body.style.backgroundImage = '';
    document.body.style.backgroundSize = '';
    document.body.style.backgroundPosition = '';
    document.body.style.backgroundBlendMode = '';
    document.body.style.backgroundColor = '';
    if (bg === 'photo' && photo){
      document.body.style.backgroundImage = `url('${photo}')`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
      if (dark > 0){ document.body.style.backgroundBlendMode = 'overlay'; document.body.style.backgroundColor = `rgba(0,0,0,${dark/100})`; }
    } else if (bg === 'doodle' || bg === 'wave' || bg === 'grid' || bg === 'dots' || bg === 'cross'){
      /* Дудлы (по умолчанию); старые сетки/точки больше не предлагаются в UI,
         но для сохранённых настроек показываем дудлы вместо них */
      const a = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8f78b0';
      const svg = doodleSVG(a);
      document.body.classList.add('app-bg--doodle');
      document.body.style.backgroundImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
      document.body.style.backgroundSize = '900px 620px';
      document.body.style.backgroundPosition = 'center top';
    } else {
      document.body.classList.add('app-bg--none');
    }
  }
  /* SVG-дудлы: волны-авдиограмма, микрофон, ноты, графики — абстрактная «студия звука» */
  function doodleSVG(accent){
    return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="620" viewBox="0 0 900 620" fill="none">
  <g opacity="0.55">
    <path d="M60 120 C 120 40, 200 200, 270 190 S 430 70, 500 180 660 300, 730 210 830 90" stroke="${accent}" stroke-width="3" stroke-linecap="round"/>
    <path d="M60 160 C 130 90, 210 240, 280 230 S 440 115, 510 220 670 340, 740 250 830 135" stroke="${accent}" stroke-width="2" opacity="0.7" stroke-linecap="round"/>
    <circle cx="150" cy="360" r="52" stroke="${accent}" stroke-width="2.5"/>
    <circle cx="150" cy="360" r="26" stroke="${accent}" stroke-width="2"/>
    <path d="M150 410 v34 M124 430 l52 0" stroke="${accent}" stroke-width="2.5" stroke-linecap="round"/>
    <rect x="330" y="300" width="9" height="90" rx="4" fill="${accent}"/>
    <rect x="352" y="270" width="9" height="150" rx="4" fill="${accent}"/>
    <rect x="374" y="320" width="9" height="50" rx="4" fill="${accent}"/>
    <rect x="396" y="240" width="9" height="210" rx="4" fill="${accent}"/>
    <rect x="418" y="295" width="9" height="100" rx="4" fill="${accent}"/>
    <rect x="440" y="330" width="9" height="30" rx="4" fill="${accent}" opacity="0.8"/>
    <path d="M620 400 l60 60 M680 460 l10 -14 M620 400 l-14 10" stroke="${accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M640 320 q30 -50 60 0" stroke="${accent}" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M680 360 q30 -50 60 0" stroke="${accent}" stroke-width="2.5" stroke-linecap="round" opacity="0.6"/>
    <path d="M120 540 h160 l30 -40 h130 l26 40" stroke="${accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M130 560 h150" stroke="${accent}" stroke-width="2" stroke-linecap="round" opacity="0.6"/>
  </g>
</svg>`;
  }
  const NAV_VIEWS = {
    dash: r => dashView(r), orders: r => CRM.ordersView(r), clients: r => CRM.peopleView(r, 'client'),
    executors: r => CRM.peopleView(r, 'executor'), projects: r => CRM.projectsView(r), chats: r => chatsView(r),
    tickets: r => ticketsView(r), ideas: r => ideasView(r), kanban: r => CRM.kanbanView(r), tools: r => CRM.toolsView(r),
    'ai-transcribe': r => AI.transcribeView(r), 'ai-texts': r => AI.textsView(r), 'ai-translate': r => AI.translateView(r),
    niches: r => nichesView(r), audit: r => auditView(r), settings: r => settingsView(r, route.param), docs: r => docsView(r)
  };
  window.NAV_VIEWS = NAV_VIEWS; /* доступно для windows.js */
  function render(){
    const u = user();
    if (!u){ renderLogin(); return; }
    applyAppBg();
    const main = document.createElement('div');
    const name = route.name;
    const viewFn = NAV_VIEWS[name];
    if (viewFn) viewFn(main);
    else if (name==='err') errView(main, route.param||'404');
    else errView(main, '404');
    renderShell(main);
  }

  /* ---------- Старт ---------- */
  function boot(){
    try {
      loadState();
      try {
        const su = sessionStorage.getItem('aw_uid');
        if (su && userById(su)) S.currentUserId = su;
      } catch(e){}
      applyTheme(user()?.mode || 'system', user()?.accent || 'violet');
      patchOffline();
      initKeys();
      initPWA();
      const h = parseHash();
      if (h) route = h;
      if (!user() && !route.name.startsWith('err')) route = { name:'login' };
      render();
      showMaintBanner();
    maybeCookieBanner();
    checkUpdates(false);
    /* URL-действия из ярлыков PWA */
    const q = new URLSearchParams(location.search);
    if (q.get('action')==='new-order' && user() && isStaff(user().role)){ go('orders'); setTimeout(()=>CRM.openOrderForm(), 80); }
    if (q.get('action')==='search' && user()) setTimeout(openPalette, 300);
    window.addEventListener('hashchange', ()=>{
      const h2 = parseHash();
      if (h2 && (h2.name!==route.name || h2.param!==route.param)){ route = h2; render(); }
    });
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

  document.addEventListener('DOMContentLoaded', boot);
  setTimeout(()=>{ const sp = $('#splash'); sp && sp.classList.add('gone'); setTimeout(()=>sp && sp.remove(), 600); }, 1400);

  /* Экспортируем хелперы персистентности для NavDrag */
  window.APP = {
    _persistNav: () => {
      S.draftPrefs.navCustom = true;
      S.draftPrefs.navCustomOrder = JSON.parse(JSON.stringify(NAV.map(s => ({ sec:s.sec, items:s.items.map(it => ({ route:it.route, title:it.title, icon:it.icon, roles:it.roles })) }))));
      saveState(); render();
    },
    _navCtx: e => {
      e.preventDefault();
      const link = e.target.closest('.side__link');
      const sec = e.target.closest('.side__sec[data-sec-title]');
      const items = [];
      if (link){
        items.push({ label:'Открыть в окне', icon:'app', onClick:()=>{ try { Windows.spawn(link.dataset.route); } catch(err){} } });
      }
      /* Закрыть все окна — только если они открыты (в одной группе с «Открыть в окне», без разделителя) */
      if (window.Windows && Windows.closeAll && Windows.hasOpenWins && Windows.hasOpenWins()){
        items.push({ label:'Закрыть все окна', icon:'x', onClick:()=>{ try { Windows.closeAll(); } catch(err){} } });
      }
      items.push('-');
      items.push({ label:'Сбросить меню по умолчанию', icon:'archive', onClick:()=>{ NAV = JSON.parse(JSON.stringify(NAV_DEFAULT)); window.NAV = NAV; delete S.draftPrefs.navCustom; delete S.draftPrefs.navCustomOrder; saveState(); toast('Меню сброшено','ok'); render(); } });
      showDropdown(e.target, items, { x:e.clientX, y:e.clientY });
    }
  };
  return { go, render, navFor, cycleTheme, checkUpdates, openPalette };
})();
