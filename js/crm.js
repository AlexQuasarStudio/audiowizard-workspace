/* ============================================================
   Audiowizard Workspace — CRM: заказы, люди, проекты, канбан,
   импорт/экспорт, калькулятор
   ============================================================ */
'use strict';

const CRM = (() => {

  /* ==================== ЗАКАЗЫ ==================== */
  const canStatus = (from, to, user) => {
    if (from === to) return { ok:false, why:'Статус не изменён' };
    if (to === 'waiting') return { ok:false, why:'Заказ нельзя вернуть в статус «В ожидании» — это запрещено для всех ролей, включая администратора' };
    return { ok:true };
  };

  function orderTotalAudio(o){ return o.audio || (o.files||[]).reduce((a,f)=>a+(f.duration||0),0); }

  function applyAccrual(o, sign){
    o.executors.forEach(e=>{
      const u = userById(e.uid);
      if (u && u.ext){
        u.ext.earned = Math.max(0, (u.ext.earned||0) + sign * (e.amount||0));
      }
      if (sign < 0) e.is_paid = false;
    });
    if (sign > 0 && o.status==='done' && o.executors.length && !o._accrued){
      o._accrued = true;
    }
  }

  async function setStatus(o, to, { silent=false } = {}){
    const user = me();
    const chk = canStatus(o.status, to);
    if (!chk.ok){ if (!silent) toast(chk.why, 'err'); return false; }
    if (to === 'done'){
      let ok;
      if (user.role==='executor'){
        ok = await confirmModal({
          title:'Права на материалы', danger:false, okText:'Подтверждаю и сдаю работу',
          text:'Все материалы, созданные в рамках данного заказа, являются интеллектуальной собственностью заказчика. Исполнитель не имеет права передавать, продавать или иным образом отчуждать эти материалы третьим лицам без письменного согласия заказчика. Сохранение материалов в портфолио допускается только с явного согласия заказчика (ст. 146, 183 УК РФ).',
          checkbox:'Я подтверждаю, что не буду использовать материалы заказа в своём портфолио без согласия заказчика, а также не буду передавать их третьим лицам'
        });
      } else {
        ok = await confirmModal({
          title:'Выполнить заказ?', okText:'Выполнено',
          text:`Будет начислен заработок исполнителям: ${o.executors.map(e=>`${(userById(e.uid)||{}).full_name} — ${fmtMoney(e.amount)}`).join(', ') || '—'}.`,
          checkbox:'Клиент принял работу и оплатил заказ'
        });
      }
      if (!ok) return false;
    }
    if (o.status === 'done' && to !== 'done'){
      const ok = await confirmModal({
        title:'Снять статус «Выполнено»?', okText:'Изменить статус', danger:true,
        text:'Все начисленные оплаты исполнителям будут аннулированы. Это действие нельзя отменить.'
      });
      if (!ok) return false;
      applyAccrual(o, -1);
      o._accrued = false;
    }
    o.history.push({ t:Date.now(), txt:`Статус: ${STATUS_META[o.status].label} → ${STATUS_META[to].label}` });
    o.status = to;
    if (to === 'archived') o.archived_at = Date.now();
    if (to === 'archived' || to !== 'archived' && o.status !== 'archived') {}
    if (to !== 'archived') o.archived_at = o.status==='archived' ? o.archived_at : null;
    if (to === 'done' && !o._accrued){ applyAccrual(o, +1); o.history.push({t:Date.now(), txt:'Начислен заработок исполнителям'}); }
    logAudit(`Статус заказа ${o.order_id}: ${STATUS_META[to].label}`, 'Заказ');
    notifyParticipants(o, `Заказ ${o.order_id}: ${STATUS_META[to].label}`);
    saveState();
    if (!silent) toast(`Статус заказа ${o.order_id} — «${STATUS_META[to].label}»`, 'ok');
    return true;
  }

  function notifyParticipants(o, text){
    S.notifs.unshift({ id:uid(), icon:'i-orders', title:text, text:`Заказ ${o.order_id} · ${fmtMoney(o.total)}`, t:Date.now(), read:{} });
    saveState();
  }

  async function deleteOrder(o){
    if (!['draft','waiting'].includes(o.status)){
      toast('Удалять можно только заказы в статусе «Черновик» или «В ожидании»', 'err'); return;
    }
    const ok = await confirmModal({ title:`Удалить заказ ${o.order_id}?`, text:'Заказ будет удалён безвозвратно.', okText:'Удалить', danger:true });
    if (!ok) return;
    S.orders = S.orders.filter(x=>x.id!==o.id);
    logAudit(`Удалён заказ ${o.order_id}`, 'Заказ'); saveState();
    toast(`Заказ ${o.order_id} удалён`, 'ok');
    APP.render();
  }

  function payOrder(o, executorEntry){
    if (o.status!=='done'){ toast('Оплачивать можно только выполненные заказы','warn'); return; }
    const targets = executorEntry ? [executorEntry] : o.executors.filter(e=>!e.is_paid);
    if (!targets.length){ toast('Все исполнители уже оплачены','info'); return; }
    const LIMIT = 30000;
    const over = targets.filter(e => (e.amount||0) > LIMIT && !e.approved_by_admin);
    if (over.length){
      over.forEach(e => {
        S.notifs.unshift({ id:uid(), icon:'i-card', title:`Согласование оплаты: ${(userById(e.uid)||{}).full_name}`, text:`Заказ ${o.order_id}: ${fmtMoney(e.amount)} — превышение лимита ${fmtMoney(LIMIT)}. Менеджер просит согласовать.`, t:Date.now(), read:{} });
      });
      saveState();
      toast(`Сумма превышает лимит ${fmtMoney(LIMIT)} — отправлено на согласование администратору`, 'warn');
      logAudit(`Согласование оплаты: ${o.order_id} (${over.length} исп.)`, 'Оплата');
      return;
    }
    targets.forEach(e=>e.is_paid = true);
    logAudit(`Оплата исполнителям по ${o.order_id}: ${targets.map(e=>(userById(e.uid)||{}).full_name).join(', ')}`, 'Заказ');
    toast(`Оплата проведена: ${targets.length} ${targets.length===1?'исполнитель':'исполнителя'}`, 'ok');
    saveState(); APP.render();
  }

  function generateOrderId(){
    /* Номер уникален глобально в системе: максимум существующего AW-N + 1 */
    let max = 1042;
    S.orders.forEach(o => { const m = /^AW-(\d+)$/.exec(o.order_id || ''); if (m) max = Math.max(max, +m[1]); });
    return `AW-${max + 1}`;
  }

  /* ---------- Таблица заказов ---------- */
  const ofilter = { q:'', statuses:new Set(), niche:'', project:'', manager:'', archived:false, sortKey:'start_date', sortDir:1 };

  /* ---------- Таблица заказов: skeleton + прогрессивная подгрузка ---------- */
  const O_CHUNK = 80;

  function ordersView(root){
    const u = me();
    const staff = isStaff(u.role);
    const all = ordersFor(u);
    let list = [];
    let shown = Math.min(window.__ordersShownMem || O_CHUNK, 100000);
    let tblScrollX = window.__ordersTblScrollX || 0;
    let sel = new Set();
    let io = null;
    let firstEntry = true;

    function computeList(){
      const arr = all.filter(o => {
        if (!ofilter.archived && o.status === 'archived') return false;
        if (ofilter.archived && o.status !== 'archived') return false;
        if (ofilter.manager && o.manager_id !== ofilter.manager) return false;
        if (ofilter.statuses.size && !ofilter.statuses.has(o.status)) return false;
        if (ofilter.niche && o.nish_id !== ofilter.niche) return false;
        if (ofilter.project && o.project_id !== ofilter.project) return false;
        if (ofilter.q){
          const q = norm(ofilter.q);
          const hay = `${o.order_id} ${(clientById(o.client_id)||{}).full_name} ${o.comment} ${nicheName(o.nish_id)}`;
          if (!norm(hay).includes(q)) return false;
        }
        return true;
      });
      const k = ofilter.sortKey, d = ofilter.sortDir;
      arr.sort((a,b)=>{
        let va, vb;
        if (k === 'deadline'){ va = a.deadline || Infinity; vb = b.deadline || Infinity; }
        else if (k === 'total'){ va = a.total; vb = b.total; }
        else if (k === 'client'){ va = (clientById(a.client_id)||{}).full_name || ''; vb = (clientById(b.client_id)||{}).full_name || ''; return va.localeCompare(vb) * d; }
        else { va = a.created_at; vb = b.created_at; }
        return (va > vb ? 1 : va < vb ? -1 : 0) * d;
      });
      return arr;
    }

    function rowHTML(o){
      const clList = clientsOf(o);
      const cl = clList[0] || {};
      const dl = o.deadline;
      const dlCls = !dl ? '' : (dl < Date.now() && !['done','archived'].includes(o.status) ? 'overdue' : (dl - Date.now() < DAY && o.status === 'work' ? 'today' : ''));
      const start = o.start_date || o.order_date;
      const audio = orderTotalAudio(o);
      const exs = o.executors.map(e => userById(e.uid)).filter(Boolean);
      const exShow = exs.slice(0, 3);
      const exRest = exs.length - exShow.length;
      const exTitle = exs.map(e => { const t = o.executors.find(x => x.uid === e.id); return `${e.full_name}${t && t.amount ? ' — ' + fmtMoney(t.amount) : ''}`; }).join('\n');
      const created = o.order_date || o.created_at;
      return `<tr class="${STATUS_META[o.status].row}" data-oid="${o.id}" data-ctx="order">
        <td data-l="✓">${staff||u.role==='client'?`<input type="checkbox" class="row-sel" value="${o.id}" ${sel.has(o.id)?'checked':''} aria-label="Выбрать ${o.order_id}">`:''}</td>
        <td class="o-head" data-l="">
          <span class="order-id" data-copy="${o.order_id}" title="Скопировать ID">${o.order_id}</span>
          <span class="cell-main o-ell" title="${esc(clList.map(x=>x.full_name).join(', '))}">${esc(clList.map(x=>x.full_name).join(', ')||'—')}</span>
          ${statusChip(o.status)}
          <span class="o-head-total">${fmtMoney(o.total)}</span>
          <svg class="ico ico-sm o-head-arrow"><use href="#i-chev-r"/></svg>
        </td>
        <td data-l="Заказ" class="o-main">
          <span class="order-id" data-copy="${o.order_id}" title="Скопировать ID">${o.order_id}</span>
          <div class="cell-sub o-ell">${nicheChip(o.nish_id)}${o.project_id ? ' · ' + esc((S.projects.find(p=>p.id===o.project_id)||{}).name || '') : ''}</div>
        </td>
        <td data-l="Клиент"><span class="cell-main o-ell" title="${esc(clList.map(x=>x.full_name).join(', '))}">${clList.length ? esc(clList.map(x=>x.full_name).join(', ')) : '—'}</span></td>
        <td data-l="Исполнители" class="o-ex">${exShow.length ? `<span class="ex-stack" title="${esc(exTitle)}">${exShow.map(e=>avatarHTML(e,'avatar--sm ex-av')).join('')}${exRest>0?`<span class="ex-more">+${exRest}</span>`:''}</span>` : '<span class="faint">—</span>'}</td>
        <td data-l="Статус">${statusChip(o.status)}</td>
        <td data-l="Начало" class="deadline-cell">${start?fmtDT(start):'—'}</td>
        <td data-l="Дедлайн" class="deadline-cell ${dlCls}">${dl?fmtDT(dl):'—'}</td>
        <td data-l="Итого" class="pay-cell">${fmtMoney(o.total)}</td>
        <td data-l="" class="o-act">${staff?`<button class="iconbtn row-menu" data-oid="${o.id}" title="Действия">${icon('more')}</button>`:''}</td>
      </tr>`;
    }
    const skelRow = () => `<tr>${'<td><div class="skel" style="height:13px"></div></td>'.repeat(9)}</tr>`;

    function render(useSkeleton){
      list = computeList();
      const useSkel = useSkeleton && list.length > O_CHUNK;
      root.innerHTML = `
        <div class="page-head">
          <div><h2>Заказы</h2><div class="sub" id="o-count">Всего заказов: ${noDemo(S.orders).length}</div></div>
          <div class="page-actions">
            <button class="btn btn--ghost" id="btn-tools">${icon('import')} Импорт / экспорт</button>
            ${staff?`<button class="btn btn--primary" id="btn-new-order">${icon('plus')} Новый заказ</button>`:''}
          </div>
        </div>
        <div id="o-bulk"></div>
        <div class="filters">
          <div class="input-wrap">${icon('search')}<input class="input" id="f-q" placeholder="Поиск: ID, клиент, комментарий…" value="${esc(ofilter.q)}"></div>
        <select class="input" id="f-manager" style="width:auto;min-width:150px"><option value="">Все менеджеры</option>${S.users.filter(x=>isStaff(x.role)).map(x=>`<option value="${x.id}" ${ofilter.manager===x.id?'selected':''}>${esc(x.full_name)}</option>`).join('')}</select>
          <select class="input" id="f-niche"><option value="">Все ниши</option>${S.niches.map(n=>`<option value="${n.id}" ${ofilter.niche===n.id?'selected':''}>${esc(n.name)}</option>`).join('')}</select>
          <select class="input" id="f-project"><option value="">Все проекты</option>${S.projects.map(p=>`<option value="${p.id}" ${ofilter.project===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
          <label class="chip ${ofilter.archived?'on':''}" id="f-arch" style="cursor:pointer">${icon('archive','ico-sm')} Архив</label>
        </div>
        <div class="filters" style="margin-top:-4px">
          <div class="chips" id="f-status">
            ${Object.entries(STATUS_META).filter(([st])=>st!=='archived'||ofilter.archived).map(([st,m])=>`<span class="chip ${ofilter.statuses.has(st)?'on':''}" data-st="${st}">${m.label}</span>`).join('')}
          </div>
        </div>
        <div class="tbl-wrap card o-wrap" style="border-radius:var(--r-lg)">
          <table class="tbl o-tbl">
            <thead><tr>
              <th style="width:34px">${staff||u.role==='client'?`<input type="checkbox" id="sel-all" title="Выбрать загруженные строки">`:''}</th>
              <th class="sortable" data-sort="client">Заказ</th><th data-l="Клиент">Клиент</th>
              <th>Исполнители</th>
              <th>Статус</th><th class="sortable" data-sort="start_date">Начало</th><th class="sortable" data-sort="deadline">Дедлайн</th><th class="sortable" data-sort="total">Итого</th><th></th>
            </tr></thead>
            <tbody id="otb">${useSkel ? skelRow().repeat(10) : ''}</tbody>
          </table>
        </div>
        <p class="small faint" style="margin-top:10px">Правый клик по строке — контекстное меню · двойной клик — карточка заказа</p>`;

      bindControls();
      bindTable();
      if (useSkel){
        setTimeout(()=>{ if (root.querySelector('#otb') && root.isConnected) fillRows(0); }, 200);
      } else {
        fillRows(0);
      }
      updateBulk();
      requestAnimationFrame(()=>{ const tw = root.querySelector('.tbl-wrap'); if (tw){ tw.scrollLeft = tblScrollX; tw.addEventListener('scroll', ()=>{ window.__ordersTblScrollX = tw.scrollLeft; }, { passive:true }); } });
    }

    function updateCount(){
      const el = root.querySelector('#o-count');
      if (!el) return;
      el.textContent = list.length
        ? `Всего заказов: ${noDemo(S.orders).length} · показано ${Math.min(shown, list.length)} из ${list.length}`
        : 'Заказов пока нет';
    }

    function fillRows(startIdx){
      const tb = root.querySelector('#otb');
      if (!tb) return;
      if (startIdx === 0){ tb.innerHTML = ''; if (io){ io.disconnect(); io = null; } }
      const end = Math.min(startIdx + O_CHUNK, list.length);
      tb.insertAdjacentHTML('beforeend', list.slice(startIdx, end).map(rowHTML).join(''));
      shown = end;
      window.__ordersShownMem = shown;
      const oldSent = root.querySelector('#o-sentinel');
      oldSent && oldSent.remove();
      if (end < list.length){
        tb.insertAdjacentHTML('beforeend', `<tr id="o-sentinel"><td colspan="10" style="text-align:center;color:var(--faint);padding:10px">${icon('refresh','ico-sm spin')} Подгружаем ещё заказы…</td></tr>`);
        const sent = root.querySelector('#o-sentinel');
        io = new IntersectionObserver(entries => {
          if (entries.some(e => e.isIntersecting)){ io.disconnect(); io = null; fillRows(end); }
        }, { root: root.querySelector('.tbl-wrap'), rootMargin: '140px' });
        io.observe(sent);
      }
      updateCount();
    }

    function updateBulk(){
      const host = root.querySelector('#o-bulk');
      if (!host) return;
      const n = sel.size;
      if (!n){ host.innerHTML = ''; return; }
      host.innerHTML = `<div class="card card-pad row wrap" style="padding:10px 14px;margin-bottom:12px;border-color:var(--accent)">
          <b>Выбрано: ${n}</b><span class="spacer"></span>
          <button class="btn btn--ghost btn--sm" data-bulk="status">${icon('refresh')} Статус</button>
          ${staff?'<button class="btn btn--ghost btn--sm" data-bulk="pay">'+icon('card')+' Оплатить</button>':''}
          <button class="btn btn--danger btn--sm" data-bulk="del">${icon('trash')} Удалить</button>
        </div>`;
      $$('[data-bulk]', host).forEach(b=>b.addEventListener('click', () => bulkAction(b.dataset.bulk)));
    }

    async function bulkAction(act){
      const ids = [...sel];
      if (!ids.length) return;
      if (act === 'del'){
        const targets = ids.map(id => S.orders.find(o => o.id === id)).filter(Boolean);
        const allowed = targets.every(o => ['draft','waiting'].includes(o.status));
        if (!allowed){ toast('Среди выбранных есть заказы, которые нельзя удалять (только черновик/ожидание)', 'err'); return; }
        const okd = await confirmModal({ title:`Удалить ${ids.length} заказ(ов)?`, okText:'Удалить', danger:true, text:'Действие безвозвратно.' });
        if (okd){ S.orders = S.orders.filter(o => !ids.includes(o.id)); logAudit(`Массовое удаление заказов (${ids.length})`, 'Заказы'); saveState(); toast('Заказы удалены', 'ok'); sel.clear(); render(false); }
      }
      if (act === 'pay'){
        ids.map(id => S.orders.find(o => o.id === id)).filter(o => o && o.status === 'done').forEach(o => o.executors.forEach(e => e.is_paid = true));
        logAudit(`Массовая оплата (${ids.length})`, 'Заказы'); saveState(); toast('Оплата проведена', 'ok'); sel.clear(); render(false);
      }
      if (act === 'status'){
        showDropdown(root.querySelector('#o-bulk'), Object.entries(STATUS_META).map(([st,m]) => ({ label:m.label, icon:'refresh', onClick: async () => {
          for (const id of ids){
            const o = S.orders.find(x => x.id === id);
            if (o && (canStatus(o.status, st).ok || o.status === st)) await setStatus(o, st, { silent:true });
          }
          toast('Статусы обновлены', 'ok'); saveState(); sel.clear(); render(false);
        }}), { alignRight:true }));
      }
    }

    function bindControls(){
      const fm = root.querySelector('#f-manager'); fm && (fm.onchange = e=>{ ofilter.manager = e.target.value; render(true); });
            const q = root.querySelector('#f-q');
      q && q.addEventListener('input', () => liveSearch(() => { ofilter.q = q.value; render(false); }));
      const fn = root.querySelector('#f-niche');
      fn && fn.addEventListener('change', () => { ofilter.niche = fn.value; render(false); });
      const fp = root.querySelector('#f-project');
      fp && fp.addEventListener('change', () => { ofilter.project = fp.value; render(false); });
      const fa = root.querySelector('#f-arch');
      fa && fa.addEventListener('click', () => { ofilter.archived = !ofilter.archived; ofilter.statuses.clear(); render(false); });
      $$('#f-status .chip', root).forEach(ch => ch.addEventListener('click', () => {
        const st = ch.dataset.st;
        ofilter.statuses.has(st) ? ofilter.statuses.delete(st) : ofilter.statuses.add(st);
        render(false);
      }));
      $$('th.sortable', root).forEach(th => th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (ofilter.sortKey === key) ofilter.sortDir *= -1; else { ofilter.sortKey = key; ofilter.sortDir = 1; }
        render(false);
      }));
      const sa = root.querySelector('#sel-all');
      sa && sa.addEventListener('change', () => {
        root.querySelectorAll('.row-sel').forEach(c => { c.checked = sa.checked; c.checked ? sel.add(c.value) : sel.delete(c.value); });
        updateBulk();
      });
      const nb = root.querySelector('#btn-new-order');
      nb && (nb.onclick = () => openOrderForm());
      const bt = root.querySelector('#btn-tools');
      bt && (bt.onclick = () => APP.go('tools'));
    }

    function bindTable(){
      const wrap = root.querySelector('.tbl-wrap');
      if (!wrap) return;
      wrap.addEventListener('change', e => {
        const c = e.target.closest('.row-sel');
        if (c){ c.checked ? sel.add(c.value) : sel.delete(c.value); updateBulk(); }
      });
      wrap.addEventListener('click', e => {
        const copy = e.target.closest('[data-copy]');
        if (copy){ e.stopPropagation(); navigator.clipboard && navigator.clipboard.writeText(copy.dataset.copy); toast(`ID «${copy.dataset.copy}» скопирован`, 'ok'); return; }
        const menu = e.target.closest('.row-menu');
        if (menu){ const r = menu.getBoundingClientRect(); orderContextMenu(menu.dataset.oid, r.left, r.bottom + 4); return; }
        const head = e.target.closest('td.o-head');
        if (head){
          const tr = head.closest('tr');
          if (tr.classList.contains('o-acc')){
            if (!e.target.closest('.row-sel') && !e.target.closest('[data-copy]')){
              tr.classList.toggle('open');
            }
            return;
          }
        }
      });
      wrap.addEventListener('dblclick', e => {
        const tr = e.target.closest('tr[data-ctx="order"]');
        tr && openOrderDetail(tr.dataset.oid);
      });
      if (staff) wrap.addEventListener('contextmenu', e => {
        const tr = e.target.closest('tr[data-ctx="order"]');
        if (!tr) return;
        e.preventDefault();
        orderContextMenu(tr.dataset.oid, e.clientX, e.clientY);
      });
    }

    render(firstEntry);
    firstEntry = false;
    CRM._ordersRerender = () => render(false);
  }

  function orderContextMenu(oid, x, y){
    const o = S.orders.find(v=>v.id===oid); if (!o) return;
    const staffCanDelete = ['draft','waiting'].includes(o.status);
    const items = [
      { label:'Открыть заказ', icon:'file', onClick:()=>openOrderDetail(oid) },
      { label:'Копировать ID', icon:'copy', onClick:()=>{ navigator.clipboard&&navigator.clipboard.writeText(o.order_id); toast(`ID «${o.order_id}» скопирован`,'ok'); } },
      '-',
      { label:'Изменить статус', header:true, label:STATUS_META[o.status].label },
      ...Object.entries(STATUS_META).filter(([st])=>canStatus(o.status,st).ok||st===o.status).map(([st,m])=>({
        label:m.label, icon:'refresh', danger:st==='archived', onClick:()=>setStatus(o, st)
      })),
      '-',
      ...(o.status==='done' && o.executors.some(e=>!e.is_paid) ? [{ label:'Оплатить всем', icon:'card', onClick:()=>payOrder(o) }] : []),
      ...(o.status!=='archived' ? [{ label:'В архив', icon:'archive', onClick:()=>setStatus(o,'archived') }] : [{ label:'Из архива', icon:'archive', onClick:()=>setStatus(o, o.history.some(h=>h.txt.includes('Выполнено'))?'done':'work') }]),
      { label:'Удалить', icon:'trash', danger:true, onClick:()=>staffCanDelete?deleteOrder(o):toast('Удаление доступно только для статусов «Черновик» и «В ожидании»','err') }
    ];
    contextMenu(x, y, items.filter(Boolean));
  }

  /* ---------- Форма заказа ---------- */
  async function openOrderForm(editId){
    const u = me();
    const isEdit = !!editId;
    const o = isEdit ? S.orders.find(x=>x.id===editId) : {
      id:uid(), order_id:'', client_id:'', order_date:Date.now(), deadline:null, status:'draft',
      total:0, certification_amount:0, need_cert:false, comment:'', manager_id:u.id, project_id:'',
      folder_id:'', nish_id:'', executors:[], audio:0, files:[], proposed_price:0, paid_amount:0,
      forbid_download:false, portfolio_ban:true, nda:false, history:[], created_at:Date.now()
    };
    const clients = S.users.filter(x=>x.role==='client' && x.ext.status!=='blacklisted');
    const executors = S.users.filter(x=>x.role==='executor' && x.ext.status!=='blacklisted' && x.ext.workStatus==='working');
    const form = { executors: [...o.executors], files: [...(o.files||[])], calcSum: 0 };

    const m = openModal({
      wide:true, title: isEdit ? `Заказ ${o.order_id}` : 'Новый заказ',
      body: `<div class="order-form">
        <div class="stack" style="gap:13px">
          <div class="cols-2 grid" style="gap:13px">
            <div class="field"><label>ID заказа</label>
              <div class="row"><input class="input" id="of-id" value="${esc(o.order_id)}" placeholder="AW-0000" style="font-family:var(--mono)">
              <button class="btn btn--ghost btn--icon" id="of-gen" title="Сгенерировать по правилам">${icon('refresh')}</button></div></div>
            <div class="field"><label>Клиент *</label>
              <div class="input-wrap" style="position:relative">${icon('clients')}
                <input class="input" id="of-client-search" placeholder="Начните вводить имя клиента…" autocomplete="off" style="padding-left:36px">
                <div class="client-live" id="of-client-live" hidden></div>
              </div>
              <div class="client-chips" id="of-client-chips"></div>
              <input type="hidden" id="of-client" value="">
            </div>
          </div>
          <div class="cols-2 grid" style="gap:13px">
            <div class="field"><label>Ниша *</label><select class="input" id="of-niche">
              <option value="">— выбрать —</option>${S.niches.map(n=>`<option value="${n.id}" ${o.nish_id===n.id?'selected':''}>${esc(n.name)}</option>`).join('')}</select></div>
            <div class="field"><label>Статус</label><select class="input" id="of-status">
              ${Object.entries(STATUS_META).map(([st,mt])=>`<option value="${st}" ${o.status===st?'selected':''}>${mt.label}</option>`).join('')}</select></div>
          </div>
          <div class="cols-2 grid" style="gap:13px">
            <div class="field"><label>Дата начала работ</label><input type="date" class="input" id="of-start"></div>
            <div class="field"><label>Дедлайн</label><input type="datetime-local" class="input" id="of-deadline"></div>
          </div>
          <div class="cols-2 grid" style="gap:13px">
            <div class="field"><label>Проект</label><select class="input" id="of-project"><option value="">—</option></select></div>
            <div class="field"><label>Папка</label><select class="input" id="of-folder"><option value="">—</option></select></div>
          </div>
          <div class="field"><label>Итого, ₽ *</label><input type="number" class="input" id="of-total" min="0" value="${o.total||''}" placeholder="0"></div>
          <div class="field"><label>Предоплата: <b id="of-prepay-val">50</b>%</label>
            <input type="range" id="of-prepay" min="0" max="100" step="5" value="50">
            <div class="small" id="of-prepay-hint" style="color:var(--muted)"></div></div>
          <div class="cols-2 grid" style="gap:13px">
            <div class="field"><label>Заверение, ₽</label>
              <div class="row"><input type="checkbox" id="of-need-cert" style="accent-color:var(--accent);width:16px;height:16px" ${o.need_cert?'checked':''}>
              <input type="number" class="input" id="of-cert" min="0" value="${o.certification_amount||''}" placeholder="Сумма заверения" ${o.need_cert?'':'disabled'}></div></div>
            <div class="field"><label>Предложенная цена заказчиком</label><input type="number" class="input" id="of-proposed" min="0" value="${o.proposed_price||''}" placeholder="Для текстов и переводов"></div>
          </div>
          <div class="field"><label>Комментарий</label><textarea class="input" id="of-comment" placeholder="Заметки по заказу… Служебные маркеры (например PROMO10) применяют правила импорта">${esc(o.comment)}</textarea></div>
          <div class="field"><label>Файлы и аудио</label>
            <div id="of-files">${form.files.map(f=>fileRowHTML(f)).join('')}</div>
            <div class="drop-inline" id="of-drop">${icon('clip','ico-sm')} Прикрепить файлы или перетащить сюда — длительность аудио определяется автоматически</div>
            <input type="file" id="of-file" multiple hidden>
          </div>
        </div>
        <div class="stack" style="gap:13px">
          <div class="field"><label>Исполнители</label>
            <div class="input-wrap">${icon('search')}<input class="input" id="of-ex-search" placeholder="Живой поиск исполнителя…" style="padding-left:36px"></div>
            <div class="executor-pick" id="of-exec-list">
              ${executors.map(e=>execPickItem(e, form)).join('')}
            </div>
            <div class="small faint" id="of-exec-sum"></div>
          </div>
          <div class="card card-pad" style="background:var(--bg-2)">
            <div class="row row--between"><b style="font-size:13px">${icon('calc','ico-sm')} Калькулятор услуг</b></div>
            <p class="small muted" style="margin:6px 0 10px">Выберите услуги ниши — сумма подставится в «Итого».</p>
            <div id="of-calc-svcs" class="small"></div>
            <button class="btn btn--soft btn--sm btn--block" id="of-open-calc" style="margin-top:10px">${icon('calc')} Открыть калькулятор</button>
          </div>
          <label class="check"><input type="checkbox" id="of-forbid" ${o.forbid_download?'checked':''}><span class="box"><svg><use href="#i-check-c"/></svg></span><span class="small muted">Запретить скачивание файлов (даже при NDA)</span></label>
        </div>
      </div>`,
      footer: `<button class="btn btn--ghost" data-c>Отмена</button><button class="btn btn--primary" data-save>${isEdit?'Сохранить изменения':'Создать заказ'}</button>`,
      onMount: (mask, close) => {
        const g = s => mask.querySelector(s);
        const dt = g('#of-deadline');
        if (o.deadline) dt.value = new Date(o.deadline - new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
        const stInp = g('#of-start');
        if (o.start_date) stInp.value = new Date(o.start_date - new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);

        /* Живой мультивыбор клиентов: поиск → чипы */
        let selClients = Array.isArray(o.client_ids) && o.client_ids.length ? [...o.client_ids] : (o.client_id ? [o.client_id] : []);
        const clName = id => { const c = clients.find(x=>x.id===id); return c ? c.full_name : '—'; };
        const renderChips = () => {
          g('#of-client').value = selClients[0] || '';
          g('#of-client-chips').innerHTML = selClients.map(id => `<span class="chip on" data-rc="${id}">${esc(clName(id))}${icon('x','ico-sm')}</span>`).join('') || '<span class="tiny faint">Клиент не выбран</span>';
          g('#of-client-chips').querySelectorAll('[data-rc]').forEach(ch => ch.onclick = () => { selClients = selClients.filter(x => x !== ch.dataset.rc); renderChips(); syncPf(); });
        };
        const renderLive = (q) => {
          const live = g('#of-client-live');
          const list = clients.filter(c => !q || norm(c.full_name).includes(norm(q)) || norm(c.email).includes(norm(q))).slice(0, 8);
          live.innerHTML = list.length ? list.map(c => `<button type="button" class="client-live__item ${selClients.includes(c.id)?'sel':''}" data-cl="${c.id}">${avatarHTML(c,'avatar--sm')}<span class="cell-main o-ell">${esc(c.full_name)}</span>${selClients.includes(c.id)?icon('check-c','ico-sm'):''}</button>`).join('') : '<div class="tiny faint" style="padding:8px 10px">Никого не найдено</div>';
          live.hidden = false;
          live.querySelectorAll('[data-cl]').forEach(b => b.onclick = () => {
            const id = b.dataset.cl;
            selClients = selClients.includes(id) ? selClients.filter(x => x !== id) : [...selClients, id];
            g('#of-client-search').value = ''; renderChips(); live.hidden = true; syncPf();
          });
        };
        g('#of-client-search').addEventListener('input', e => renderLive(e.target.value));
        g('#of-client-search').addEventListener('focus', e => renderLive(e.target.value));
        /* проекты и папки по первому выбранному клиенту */
        const syncPf = () => {
          const cid = selClients[0] || '';
          const ps = S.projects.filter(p=>p.client_id===cid);
          const fs = S.folders.filter(f=>f.client_id===cid);
          g('#of-project').innerHTML = '<option value="">—</option>'+ps.map(p=>`<option value="${p.id}" ${o.project_id===p.id?'selected':''}>${esc(p.name)}</option>`).join('');
          g('#of-folder').innerHTML = '<option value="">—</option>'+fs.map(f=>`<option value="${f.id}" ${o.folder_id===f.id?'selected':''}>${esc(f.name)}</option>`).join('');
        };
        renderChips(); syncPf();

        g('#of-gen').onclick = ()=>{ g('#of-id').value = generateOrderId(); };
        g('#of-need-cert').addEventListener('change', e=>{ g('#of-cert').disabled = !e.target.checked; });
        const prepayHint = ()=> {
          const v = +g('#of-prepay').value;
          g('#of-prepay-val').textContent = v;
          g('#of-prepay-hint').innerHTML = v < S.settings.minPrepay
            ? `<span style="color:var(--yellow)">⚠ Предоплата менее ${S.settings.minPrepay}% — требуется электронный договор <span class="badge c-gray">модуль в разработке</span></span>`
            : `<span style="color:var(--green)">✓ Договор не требуется (достаточно оферты)</span>`;
        };
        g('#of-prepay').addEventListener('input', prepayHint); prepayHint();

        /* исполнители: поиск + выбор */
        const listEl = g('#of-exec-list');
        function renderExecList(){
          listEl.innerHTML = executors.map(e=>execPickItem(e, form)).join('');
          $$('.executor-pick__item', listEl).forEach(el=>{
            el.addEventListener('click', e=>{
              if (e.target.closest('input')) return;
              const idv = el.dataset.uid;
              const has = form.executors.find(x=>x.uid===idv);
              if (has) form.executors = form.executors.filter(x=>x.uid!==idv);
              else form.executors.push({ uid:idv, amount:0, is_paid:false });
              renderExecList(); updExecSum();
            });
            const amt = el.querySelector('.executor-pick__amount input');
            amt && amt.addEventListener('input', ()=>{ const row = form.executors.find(x=>x.uid===el.dataset.uid); if (row) row.amount = +amt.value||0; updExecSum(); });
          });
        }
        const execSearch = debounce(()=>{
          const q = norm(g('#of-ex-search').value);
          $$('#of-exec-list .executor-pick__item', mask).forEach(el=>{
            el.style.display = norm(el.dataset.name).includes(q) ? '' : 'none';
          });
        });
        g('#of-ex-search').addEventListener('input', execSearch);
        function updExecSum(){
          const sum = form.executors.reduce((a,e)=>a+(e.amount||0),0);
          g('#of-exec-sum').textContent = form.executors.length ? `Назначено ${form.executors.length} · сумма исполнителям: ${fmtMoney(sum)}` : 'Никто не назначен';
        }
        renderExecList(); updExecSum();

        /* файлы */
        const drop = g('#of-drop'), fileInp = g('#of-file');
        drop.onclick = ()=>fileInp.click();
        drop.addEventListener('dragover', e=>{ e.preventDefault(); drop.classList.add('over'); });
        drop.addEventListener('dragleave', ()=>drop.classList.remove('over'));
        drop.addEventListener('drop', e=>{ e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
        fileInp.addEventListener('change', ()=>{ addFiles(fileInp.files); fileInp.value=''; });
        function addFiles(list){
          Array.from(list).forEach(f=>{
            const entry = { name:f.name, size:f.size, type:f.type||'application/octet-stream', duration:0 };
            if (f.type.startsWith('audio/')||/\.(mp3|m4a|wav|ogg|aac)$/i.test(f.name)){
              const url = URL.createObjectURL(f);
              const probe = new Audio();
              probe.preload = 'metadata';
              probe.src = url;
              probe.onloadedmetadata = ()=>{ entry.duration = Math.round(probe.duration||0); URL.revokeObjectURL(url); refreshFiles(); };
              probe.onerror = ()=>URL.revokeObjectURL(url);
            }
            form.files.push(entry);
          });
          refreshFiles();
        }
        function refreshFiles(){
          g('#of-files').innerHTML = form.files.map(f=>fileRowHTML(f)).join('');
          $$('#of-files .x', mask).forEach((x,i)=>x.onclick=()=>{ form.files.splice(i,1); refreshFiles(); });
          form.audio = form.files.reduce((a,f)=>a+(f.duration||0),0);
        }

        /* калькулятор: услуги ниши */
        const renderSvcs = ()=>{
          const nid = g('#of-niche').value;
          const svcs = S.calcServices[nid] || [];
          g('#of-calc-svcs').innerHTML = svcs.length
            ? svcs.map((s,i)=>`<label class="svc-row check"><input type="checkbox" data-svc="${i}"><span class="box"><svg><use href="#i-check-c"/></svg></span><span style="flex:1">${esc(s.name)}<br><span class="faint">${esc(s.unit||'')}</span></span><b>${fmtMoney(s.price)}</b></label>`).join('')
            : '<p class="faint small">Выберите нишу, чтобы увидеть услуги</p>';
          $$('#of-calc-svcs input', mask).forEach(inp=>inp.addEventListener('change', updCalc));
        };
        const updCalc = ()=>{
          const nid = g('#of-niche').value;
          const svcs = S.calcServices[nid] || [];
          let sum = 0;
          $$('#of-calc-svcs input:checked', mask).forEach(inp=>{ sum += (svcs[+inp.dataset.svc]||{}).price||0; });
          if (sum > 0){ g('#of-total').value = sum + form.calcSum; }
        };
        g('#of-niche').addEventListener('change', renderSvcs); renderSvcs();
        g('#of-open-calc').onclick = ()=>openCalculator({ onResult: v=>{ form.calcSum = v; g('#of-total').value = (+g('#of-total').value||0) + v; } });

        /* автосохранение черновика */
        let dirty = false;
        const markDirty = ()=>{ dirty = true; };
        mask.addEventListener('input', markDirty);
        const autoTimer = setInterval(()=>{
          if (!dirty || !document.body.contains(mask)) { if(!document.body.contains(mask)) clearInterval(autoTimer); return; }
          DraftsDB.put('order-form', collect());
        }, 5000);

        function collect(){
          return {
            order_id:g('#of-id').value, client_id:g('#of-client').value, client_ids:[...selClients], nish_id:g('#of-niche').value,
            status:g('#of-status').value, deadline:g('#of-deadline').value||null, start:g('#of-start').value||null, total:+g('#of-total').value||0,
            prepay:+g('#of-prepay').value, cert:g('#of-cert').value, need_cert:g('#of-need-cert').checked,
            comment:g('#of-comment').value, project_id:g('#of-project').value, folder_id:g('#of-folder').value,
            proposed:+g('#of-proposed').value||0, forbid:g('#of-forbid').checked,
            executors:form.executors, files:form.files
          };
        }

        /* закрытие — предложение черновика */
        mask.querySelector('[data-c]').onclick = async ()=>{
          if (dirty && !isEdit){
            const dontAsk = S.draftPrefs.noAskDraft;
            if (!dontAsk){
              const okSave = await confirmModal({ title:'Сохранить черновик?', text:'Вы закрываете форму с незаполненными данными.', okText:'Сохранить черновик', checkbox:'Больше не спрашивать' });
              if (okSave){ S.draftPrefs.noAskDraft = okSave === true && $('#cf-chk') && $('#cf-chk').checked || S.draftPrefs.noAskDraft; saveState(); DraftsDB.put('order-form', collect()); toast('Черновик сохранён локально','ok'); }
              else { DraftsDB.del('order-form'); }
            }
          }
          clearInterval(autoTimer); close();
        };

        mask.querySelector('[data-save]').onclick = async ()=>{
          const c = collect();
          if (!c.client_id || !c.nish_id || !c.total){ toast('Заполните клиента, нишу и сумму','err'); return; }
          if (!c.order_id){ c.order_id = generateOrderId(); }
          if (S.orders.some(x=>x.order_id===c.order_id && x.id!==o.id)){ toast('ID заказа уже существует — включён суффикс -N','warn'); c.order_id += '-N'; }
          clearInterval(autoTimer);
          /* итоговое подтверждение */
          const clList2 = clientsOf(c);
          const cl = clList2[0]||{};
          const ok = await confirmModal({
            title:'Подтвердите создание заказа',
            text:`<b>${esc(c.order_id)}</b> · ${esc(clList2.map(x=>x.full_name).join(', '))}<br>${esc(nicheName(c.nish_id))} · ${fmtMoney(c.total)}<br>Исполнители: ${c.executors.map(e=>esc((userById(e.uid)||{}).full_name)+' — '+fmtMoney(e.amount)).join(', ')||'—'}<br>Предоплата: ${c.prepay}%${c.prepay<S.settings.minPrepay?' <span class="badge c-yellow">нужен договор</span>':''}`,
            okText: isEdit?'Сохранить':'Создать заказ'
          });
          if (!ok) return;
          Object.assign(o, c, {
            deadline: c.deadline ? new Date(c.deadline).getTime() : null,
            start_date: c.start ? new Date(c.start).getTime() : (o.order_date || Date.now()),
            audio: form.files.reduce((a,f)=>a+(f.duration||0),0)
          });
          o.executors = c.executors.map(e=>({ ...e, is_paid: o.status==='done' ? o.executors.find(x=>x.uid===e.uid)?.is_paid || false : false }));
          if (!isEdit){
            o.history.push({ t:Date.now(), txt:'Заказ создан' });
            if (c.prepay < S.settings.minPrepay) o.nda = false;
            S.orders.unshift(o);
            logAudit(`Создан заказ ${o.order_id}`, 'Заказ');
          } else {
            o.history.push({ t:Date.now(), txt:'Заказ отредактирован' });
            logAudit(`Изменён заказ ${o.order_id}`, 'Заказ');
          }
          if (c.executors.length) notifyParticipants(o, 'Назначены исполнители');
          saveState();
          DraftsDB.del('order-form');
          toast(`Заказ ${o.order_id} сохранён`, 'ok');
          close(); APP.render();
        };
      }
    });

    /* восстановление офлайн-черновика */
    DraftsDB.get('order-form').then(d=>{
      if (d && d.val && !isEdit && !o.order_id){
        openModal({ narrow:true, title:'Найден черновик', body:`<p class="small muted">Локальный черновик заказа от ${fmtDT(d.t)}. Восстановить данные?</p>`,
          footer:`<button class="btn btn--ghost" data-x>Удалить</button><button class="btn btn--primary" data-r>Восстановить</button>`,
          onMount:(mm, cc)=>{
            mm.querySelector('[data-r]').onclick = ()=>{ cc(); setTimeout(()=>applyDraft(d.val), 60); };
            mm.querySelector('[data-x]').onclick = ()=>{ DraftsDB.del('order-form'); cc(); };
          } });
      }
    });
    function applyDraft(v){
      const set=(s,val)=>{ const el=$(s); if(!el) return; el.value = val; el.dispatchEvent(new Event(val&&el.tagName==='SELECT'?'change':'input',{bubbles:true})); };
      set('#of-id', v.order_id||''); set('#of-client', v.client_id||''); set('#of-niche', v.nish_id||'');
      set('#of-status', v.status||'draft'); set('#of-total', v.total||''); set('#of-prepay', v.prepay??50);
      set('#of-cert', v.cert||''); set('#of-comment', v.comment||''); set('#of-proposed', v.proposed||'');
      const nc = $('#of-need-cert'); if (nc){ nc.checked=!!v.need_cert; nc.dispatchEvent(new Event('change')); }
      const fb = $('#of-forbid'); if (fb) fb.checked = !!v.forbid;
      toast('Черновик восстановлен','ok');
    }
  }

  function fileRowHTML(f){
    const sz = f.size > 1048576 ? (f.size/1048576).toFixed(1)+' МБ' : Math.max(1,Math.round(f.size/1024))+' КБ';
    return `<div class="file-row">${icon(f.duration?'mic':'file')}<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span>
      ${f.duration?`<span class="audio-dur">${fmtDur(f.duration)}</span>`:''}<span class="faint small">${sz}</span><button class="x">${icon('x','ico-sm')}</button></div>`;
  }
  function execPickItem(e, form){
    const sel = form.executors.find(x=>x.uid===e.id);
    return `<div class="executor-pick__item ${sel?'sel':''}" data-uid="${e.id}" data-name="${esc(e.full_name+' '+e.ext.specializations.join(' '))}">
      ${avatarHTML(e,'avatar--sm')}<span style="flex:1;min-width:0"><b style="font-size:12.5px">${esc(e.full_name)}</b><br><span class="faint" style="font-size:11px">${esc(e.ext.specializations.join(', '))}</span></span>
      ${starsHTML(e.ext.qualOverall||0)}
      <span class="executor-pick__amount">${sel?`<input type="number" class="input" value="${sel.amount||''}" placeholder="₽">`:''}</span></div>`;
  }

  /* ---------- Деталь заказа ---------- */
  function openOrderDetail(oid){
    const o = S.orders.find(x=>x.id===oid); if (!o) return;
    const u = me(); const staff = isStaff(u.role);
    const cl = clientById(o.client_id)||{};
    const isOwn = u.role==='client' ? o.client_id===u.id : u.role==='executor' ? o.executors.some(e=>e.uid===u.id) : true;
    const paid = o.paid_amount||0, rest = Math.max(0, o.total-paid), pct = Math.round(paid/(o.total||1)*100);

    const paymentBlock = u.role==='executor'
      ? `<div class="card card-pad"><b class="small">Оплата</b><div class="row" style="margin-top:8px"><span class="badge ${paid>=o.total?'c-green':'c-yellow'}"><span class="dot"></span>${paid>=o.total?'Оплачено':'Не оплачено'}</span>${o.nda?'<span class="badge c-violet">NDA подписан</span>':''}</div><p class="small faint" style="margin-top:8px">Детализация платежей недоступна исполнителю</p></div>`
      : `<div class="card card-pad"><b class="small">Оплата заказа</b>
          <div class="row row--between small" style="margin:10px 0 6px"><span class="muted">Оплачено</span><b>${fmtMoney(paid)} из ${fmtMoney(o.total)}</b></div>
          <div class="progress ${pct>=100?'progress--green':''}"><span style="width:${pct}%"></span></div>
          <div class="row row--between small" style="margin-top:8px"><span class="muted">Остаток</span><b>${fmtMoney(rest)} · ${pct}%</b></div>
          ${staff&&paid<o.total?`<button class="btn btn--ghost btn--sm btn--block" data-pay-client style="margin-top:12px">${icon('card')} Отметить платёж</button>`:''}
        </div>`;

    const filesBlock = (o.files||[]).length ? o.files.map((f,i)=>{
      const locked = o.forbid_download;
      return `<div class="file-row">${icon(f.duration?'mic':'file')}
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span>
        ${f.duration?`<span class="audio-dur">${fmtDur(f.duration)}</span>`:''}
        ${o.nda?'<span class="badge c-violet" style="flex:none">NDA</span>':''}
        ${locked?`<span class="badge c-red" style="flex:none" title="Заказчик запретил скачивание">скачивание запрещено</span>`
          :`<button class="btn btn--ghost btn--sm" data-dl="${i}" style="margin-left:auto;flex:none">Скачать</button>`}</div>`;
    }).join('') : `<div class="empty">${icon('clip')}<span>Файлов нет</span></div>`;

    openModal({
      wide:true, title:`Заказ ${o.order_id}`,
      body: `
        <div class="row wrap" style="gap:7px;margin-bottom:14px">
          ${statusChip(o.status)} ${nicheChip(o.nish_id)}
          ${o.nda?'<span class="badge c-violet">NDA</span>':''}
          ${o.forbid_download?'<span class="badge c-red">Запрет скачивания</span>':''}
          ${o.certification_amount?'<span class="badge c-blue">Заверение '+fmtMoney(o.certification_amount)+'</span>':''}
          ${o.proposed_price?'<span class="badge c-yellow">Предложено клиентом: '+fmtMoney(o.proposed_price)+'</span>':''}
        </div>
        <div class="cols-2 grid" style="gap:14px">
          <div class="stack" style="gap:14px">
            <div class="card card-pad">
              <div class="row" style="gap:14px">${avatarHTML(cl)}<div><b>${esc(cl.full_name)}</b><div class="small muted">${esc(cl.phone||'')} · ${esc(cl.email||'')}</div></div></div>
              <hr>
              <div class="cols-2 grid small" style="gap:8px">
                <div><span class="faint">Дедлайн</span><br><b class="${o.deadline&&o.deadline<Date.now()&&o.status!=='done'?'accent-text':''}">${fmtDT(o.deadline)}</b></div>
                <div><span class="faint">Начало работ</span><br><b>${fmtDate(o.start_date || o.order_date)}</b></div>
                <div><span class="faint">Аудио</span><br><b>${orderTotalAudio(o)?fmtDur(orderTotalAudio(o)):'—'}</b></div>
                <div><span class="faint">Менеджер</span><br><b>${esc((userById(o.manager_id)||{}).full_name||'—')}</b></div>
                <div><span class="faint">Проект</span><br><b>${esc((S.projects.find(p=>p.id===o.project_id)||{}).name||'—')}</b></div>
                <div><span class="faint">Папка</span><br><b>${esc((S.folders.find(f=>f.id===o.folder_id)||{}).name||'—')}</b></div>
              </div>
            </div>
            <div class="card card-pad"><b class="small">Комментарий</b><p class="small" style="margin-top:6px;color:var(--text-2)">${o.comment?nl2br(o.comment):'<span class="faint">—</span>'}</p></div>
            <div class="card card-pad"><b class="small">Файлы</b><div style="margin-top:8px">${filesBlock}</div></div>
          </div>
          <div class="stack" style="gap:14px">
            ${paymentBlock}
            <div class="card card-pad"><b class="small">Исполнители</b>
              <div class="stack" style="gap:9px;margin-top:9px">
                ${o.executors.map(e=>{const ex=userById(e.uid); return ex?`<div class="row">${avatarHTML(ex,'avatar--sm')}<span style="flex:1;min-width:0"><b class="small">${esc(ex.full_name)}</b><br><span class="faint" style="font-size:11px">${esc(ex.ext.specializations.join(', '))}</span></span><b class="small">${fmtMoney(e.amount)}</b>${staff&&o.status==='done'?`<button class="btn btn--sm ${e.is_paid?'btn--ghost':'btn--soft'}" data-pay="${e.uid}">${e.is_paid?'Оплачен':'Оплатить'}</button>`:''}
                ${staff&&u.role==='admin'&&(e.amount||0)>30000&&!e.approved_by_admin&&!e.is_paid?`<button class="btn btn--sm btn--ghost" data-approve="${e.uid}" title="Согласовать превышение">${icon('check-c')} Согласовать</button>`:''}</div>`:''}).join('') || '<span class="faint small">Не назначены</span>'}
              </div>
            </div>
            <div class="card card-pad"><b class="small">История заказа</b>
              <div class="stack small" style="gap:7px;margin-top:9px">
                ${o.history.slice().reverse().map(h=>`<div class="row" style="gap:8px"><span class="dot" style="background:var(--accent);flex:none;margin-top:5px"></span><span><b>${esc(h.txt)}</b><br><span class="faint" style="font-size:11px">${fmtDT(h.t)}</span></span></div>`).join('')}
              </div>
            </div>
            <button class="btn btn--ghost btn--block" data-ticket>${icon('tickets')} Сообщить о проблеме</button>
          </div>
        </div>`,
      footer: staff ? `
        <button class="btn btn--ghost" data-arch>${o.status==='archived'?'Из архива':'В архив'}</button>
        ${['draft','waiting'].includes(o.status)?`<button class="btn btn--danger" data-del>${icon('trash')} Удалить</button>`:''}
        <span class="spacer"></span>
        <button class="btn btn--ghost" data-edit>${icon('edit')} Редактировать</button>
        <div class="seg" id="od-statuses">${Object.entries(STATUS_META).map(([st,mt])=>`<button data-st="${st}" class="${o.status===st?'on':''}" title="${canStatus(o.status,st).ok||st===o.status?mt.label:canStatus(o.status,st).why}">${mt.label}</button>`).join('')}</div>`
        : (u.role==='executor' && o.status==='work' ? `<span class="spacer"></span><button class="btn btn--primary" data-st="done">Сдать работу</button>` : ''),
      onMount: (mask, close)=>{
        mask.addEventListener('click', async e=>{
          const t = e.target.closest('[data-st],[data-pay],[data-dl],[data-pay-client],[data-ticket],[data-edit],[data-del],[data-arch]');
          if (!t) return;
          if (t.dataset.st) { await setStatus(o, t.dataset.st); close(); APP.render(); }
          if (t.dataset.approve){
            const ex = o.executors.find(x=>x.uid===t.dataset.approve);
            ex.approved_by_admin = true;
            logAudit(`Согласовано превышение оплаты: ${o.order_id} (${fmtMoney(ex.amount)})`, 'Оплата');
            saveState(); toast('Превышение согласовано — менеджер может провести оплату', 'ok');
            close(); APP.render();
          }
          if (t.dataset.pay){ payOrder(o, o.executors.find(x=>x.uid===t.dataset.pay)); close(); APP.render(); }
          if (t.dataset.payClient){
            openModal({ narrow:true, title:'Отметить платёж',
              body:`<div class="field"><label>Сумма платежа, ₽ (остаток ${fmtMoney(rest)})</label><input type="number" class="input" id="pay-v" value="${rest}" min="0" max="${o.total}"></div>`,
              footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-pay-save>Отметить</button>`,
              onMount:(m2, close2)=>{
                m2.querySelector('[data-pay-save]').onclick = ()=>{
                  const v = +m2.querySelector('#pay-v').value || 0;
                  o.paid_amount = Math.min(o.total, paid + v);
                  logAudit(`Платёж по ${o.order_id}: ${fmtMoney(v)}`,'Заказ');
                  saveState(); toast('Платёж отмечен','ok'); close2(); APP.render();
                };
              } });
          }
          if (t.dataset.dl !== undefined && t.tagName==='BUTTON'){
            showDownloadGuard(o, o.files[+t.dataset.dl]);
          }
          if (t.dataset.ticket){ close(); CRM.openTicket(o.order_id); }
          if (t.dataset.edit){ close(); openOrderForm(o.id); }
          if (t.dataset.del){ await deleteOrder(o); close(); APP.render(); }
          if (t.dataset.arch){ await setStatus(o, o.status==='archived' ? (o.history.some(h=>h.txt.includes('Выполнено'))?'done':'work') : 'archived'); close(); APP.render(); }
        });
      }
    });
  }

  function showDownloadGuard(o, f){
    openModal({
      narrow:true, title:'Конфиденциальные материалы',
      body:`<div class="stack small" style="gap:12px;color:var(--text-2)">
        <p>${icon('alert')} Данные материалы являются конфиденциальными и принадлежат заказчику. Передача их третьим лицам без предварительного письменного согласия заказчика запрещена и является нарушением законодательства РФ (ст. 183 УК РФ — незаконное получение и разглашение сведений, составляющих коммерческую тайну).</p>
        <label class="check"><input type="checkbox" id="dl-ok"><span class="box"><svg><use href="#i-check-c"/></svg></span><span>Я понимаю, что несу ответственность за разглашение данных, и обязуюсь удалить все файлы после завершения заказа</span></label>
      </div>`,
      footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-dl disabled>Скачать</button>`,
      onMount:(mask, close)=>{
        const chk = mask.querySelector('#dl-ok'), btn = mask.querySelector('[data-dl]');
        chk.addEventListener('change', ()=>btn.disabled = !chk.checked);
        mask.querySelector('[data-x]').onclick = close;
        btn.onclick = ()=>{
          logAudit(`Скачивание файла ${f.name} (заказ ${o.order_id})`, 'Файл');
          toast('Файл выгружен. Скачивание зафиксировано в журнале аудита','ok');
          close();
        };
      }
    });
  }

  function prompt2(label, val){
    const v = window.prompt(label, val);
    return v;
  }

  /* ==================== ЛЮДИ: клиенты и исполнители ==================== */
  function peopleView(root, role){
    const u = me(); const staff = isStaff(u.role);
    const list = noDemo(S.users.filter(x=>x.role===role));
    let q = '', onlyBl = false;

    const render = ()=>{
      const filtered = list.filter(p=>{
        if (onlyBl !== (p.ext.status==='blacklisted')) return false;
        if (q && !norm(`${p.full_name} ${p.username} ${p.email} ${p.phone} ${p.ext.xlsxRow||''}`).includes(norm(q))) return false;
        return true;
      });
      root.innerHTML = `
        <div class="page-head">
          <div><h2>${role==='client'?'Клиенты':'Исполнители'}</h2>
          <div class="sub">${filtered.length} записей · ${list.filter(p=>p.ext.status==='blacklisted').length} в чёрном списке</div></div>
          <div class="page-actions">
            <button class="btn btn--ghost" data-exp>${icon('export')} Экспорт</button>
            ${staff?`<button class="btn btn--primary" data-add>${icon('user-plus')} ${role==='executor'?'Добавить исполнителя':'Добавить клиента'}</button>`:''}
          </div>
        </div>
        <div class="filters">
          <div class="input-wrap">${icon('search')}<input class="input" id="pl-q" placeholder="Поиск: имя, логин, email, телефон…" value="${esc(q)}"></div>
          <label class="chip ${onlyBl?'':'on'}" id="pl-active">${icon('check-c','ico-sm')} Активные</label>
          <label class="chip ${onlyBl?'on':''}" id="pl-bl">${icon('x-c','ico-sm')} Чёрный список</label>
        </div>
        <div class="person-grid">
          ${filtered.map(p=>personCard(p, role, staff)).join('') || `<div class="empty" style="grid-column:1/-1">${icon('clients')}<span>Никого не найдено</span></div>`}
        </div>`;
      const qq = $('#pl-q', root);
      qq.addEventListener('input', ()=>liveSearch(()=>{ q=qq.value; render(); }));
      $('#pl-active', root).onclick = ()=>{ onlyBl=false; render(); };
      $('#pl-bl', root).onclick = ()=>{ onlyBl=true; render(); };
      $$('[data-add]', root).forEach(b=>b.onclick = ()=>openPersonForm(role, null));
      $$('[data-exp]', root).forEach(b=>b.onclick = ()=>exportPeople(role));
      $$('.person-card', root).forEach(c=>c.onclick = e=>{
        if (e.target.closest('button')) return;
        openPersonCard(c.dataset.uid, role);
      });
    };
    render();
  }

  function personCard(p, role, staff){
    const bl = p.ext.status==='blacklisted';
    const mt = role==='executor' ? executorMetrics(p) : clientMetrics(p);
    return `<div class="person-card ${bl?'bl':''}" data-uid="${p.id}">
      <div class="row" style="gap:12px">
        ${p.ext.xlsxRow?`<span class="x-num" title="Строка ${p.ext.xlsxRow} из таблицы">${p.ext.xlsxRow}</span>`:''}
        ${avatarHTML(p)}
        <div style="flex:1;min-width:0">
          <b class="small" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.full_name)}</b>
          <span class="small faint">${esc(p.email)}</span>
        </div>
        ${bl?'<span class="badge c-red">ЧС</span>':''}
      </div>
      ${role==='executor'?`
        <div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">${starsHTML(p.ext.qualOverall||0)}<span class="small faint">${p.ext.qualification && Object.keys(p.ext.qualification).length ? esc(Object.keys(p.ext.qualification).join(', ')) : 'нет специализаций'}</span></div>
        <div class="cols-3 grid small" style="gap:6px;margin-top:12px">
          <div class="stat-mini"><b>${mt.orders}</b><span>заказов</span></div>
          <div class="stat-mini"><b>${mt.done}</b><span>выполнено</span></div>
          <div class="stat-mini"><b>${fmtMoney(p.ext.earned)}</b><span>заработано</span></div>
        </div>
        <div class="row small" style="margin-top:10px;gap:6px;flex-wrap:wrap">
          <span class="badge ${p.ext.workStatus==='working'?'c-green':'c-gray'}">${p.ext.workStatus==='working'?'Работаю':'Не работаю'}</span>
          ${mt.overdue?`<span class="badge c-red">просрочек: ${mt.overdue}</span>`:''}
          ${mt.revision?`<span class="badge c-orange">доработок: ${mt.revision}</span>`:''}
        </div>`
      :`
        <div class="cols-2 grid small" style="gap:6px;margin-top:12px">
          <div class="stat-mini"><b>${mt.orders}</b><span>заказов</span></div>
          <div class="stat-mini"><b>${fmtMoney(mt.sum)}</b><span>на сумму</span></div>
        </div>
        ${p.ext.discountApplied?'<span class="badge c-green" style="margin-top:10px">скидка применена</span>':''}` }
    </div>`;
  }

  function openPersonCard(uidv, role){
    const p = userById(uidv); if (!p) return;
    const u = me(); const staff = isStaff(u.role);
    const mt = role==='executor' ? executorMetrics(p) : clientMetrics(p);
    const managers = S.users.filter(x=>['manager','top_manager'].includes(x.role));
    const bl = p.ext.status==='blacklisted';

    openModal({
      wide:true, title: role==='executor'?'Профиль исполнителя':'Карточка клиента',
      body:`<div class="cols-2 grid" style="gap:14px">
        <div class="stack" style="gap:14px">
          <div class="card card-pad">
            <div class="row" style="gap:14px">${avatarHTML(p,'avatar--lg')}
              <div><b style="font-size:16px">${esc(p.full_name)}</b><br>
                <span class="small muted">${esc(p.email)} · ${esc(p.phone)}</span><br>
                <span class="small faint">логин: <span class="mono">${esc(p.username)}</span> · с ${fmtDate(p.created_at)}</span></div>
              <span class="spacer"></span>
              ${bl?'<span class="badge c-red">В чёрном списке</span>':`<span class="badge c-green">Активен</span>`}
              ${staff?`<button class="btn btn--ghost btn--sm" data-pf-edit style="margin-top:8px">${icon('edit')} Редактировать</button>`:''}
            </div>
            ${p.about?`<p class="small" style="margin-top:12px;color:var(--text-2)">${esc(p.about)}</p>`:''}
            ${role==='executor'?`
              <hr>
              <div class="row row--between"><b class="small">Рабочий статус</b>
                <div class="seg"><button data-ws="working" class="${p.ext.workStatus==='working'?'on':''}">Работаю</button><button data-ws="not_working" class="${p.ext.workStatus!=='working'?'on':''}">Не работаю</button></div></div>
              <div style="margin-top:12px"><b class="small">Специализации и квалификация</b>
                <div class="stack small" style="gap:7px;margin-top:8px">
                  ${Object.entries(p.ext.qualification||{}).map(([s,q2])=>`<div class="row row--between"><span>${esc(s)}</span>${starsHTML(q2)}</div>`).join('')||'<span class="faint">—</span>'}
                </div>
                ${staff?`<button class="btn btn--ghost btn--sm" data-qual style="margin-top:10px">${icon('star')} Изменить квалификацию</button>`:''}
              </div>`:''}
            ${role==='client'?`
              <hr>
              <div class="cols-2 grid small" style="gap:8px">
                <div><span class="faint">Компания</span><br><b>${esc(p.ext.company||'—')}</b></div>
                <div><span class="faint">Роль в компании</span><br><b>${esc(p.ext.roleIn||'—')}</b></div>
                <div><span class="faint">Рассылка</span><br><b>${p.consent_marketing?'согласен':'отписан'}</b></div>
                <div><span class="faint">Скидка</span><br><b>${p.ext.discountApplied?'да':'нет'}</b></div>
              </div>
              <button class="btn btn--ghost btn--sm" data-req style="margin-top:12px">${icon('file')} Реквизиты</button>`:''}
          </div>
          <div class="card card-pad"><b class="small">Комментарии</b>
            <div class="tabs" style="margin:10px 0 10px">
              <button class="tab on" data-ct="pub">Общий ${staff?'<span class="badge c-gray">требует голосования</span>':''}</button>
              <button class="tab" data-ct="priv">Личная пометка</button>
            </div>
            <p class="small" data-cm="pub" style="color:var(--text-2)">${p.ext.comment?nl2br(p.ext.comment):'<span class="faint">Пусто</span>'}</p>
            <p class="small" data-cm="priv" style="display:none;color:var(--text-2)">${p.ext.commentPersonal?nl2br(p.ext.commentPersonal):'<span class="faint">Пусто</span>'}</p>
            ${staff?`<button class="btn btn--ghost btn--sm" data-cm-edit style="margin-top:10px">${icon('edit')} Редактировать</button>`:''}
          </div>
        </div>
        <div class="stack" style="gap:14px">
          <div class="cols-2 grid small" style="gap:8px">
            <div class="stat-mini"><b>${mt.orders}</b><span>заказов</span></div>
            ${role==='executor'?`
              <div class="stat-mini"><b>${fmtMoney(p.ext.earned)}</b><span>заработано</span></div>
              <div class="stat-mini"><b>${mt.done}</b><span>выполнено</span></div>
              <div class="stat-mini"><b>${mt.success}%</b><span>успешных</span></div>
              <div class="stat-mini"><b>${mt.revision}</b><span>доработок</span></div>
              <div class="stat-mini"><b>${mt.overdue}</b><span>просрочек</span></div>`
            :`<div class="stat-mini"><b>${fmtMoney(mt.sum)}</b><span>сумма заказов</span></div>
              <div class="stat-mini"><b>${S.orders.filter(o=>o.client_id===p.id&&o.status==='work').length}</b><span>в работе</span></div>`}
          </div>
          ${staff?`
          <div class="card card-pad"><b class="small">Управление</b>
            <div class="stack" style="gap:9px;margin-top:10px">
              <button class="btn btn--ghost btn--sm btn--block" data-transfer>${icon('user-plus')} Передать менеджеру</button>
              <button class="btn ${bl?'btn--ghost':'btn--danger'} btn--sm btn--block" data-bl>${bl?'Убрать из чёрного списка':'В чёрный список'}</button>
              <button class="btn btn--ghost btn--sm btn--block" data-fine>${icon('alert')} Штраф (демо)</button>
            </div>
          </div>`:''}
        </div>
      </div>`,
      footer:`<button class="btn btn--ghost" data-x>Закрыть</button>`,
      onMount:(mask, close)=>{
        mask.querySelector('[data-x]').onclick = close;
        const editBtn = mask.querySelector('[data-pf-edit]');
        if (editBtn) editBtn.onclick = () => { close(); openPersonForm(role, p); };
        $$('[data-ct]', mask).forEach(t=>t.onclick = ()=>{
          $$('[data-ct]', mask).forEach(x=>x.classList.remove('on')); t.classList.add('on');
          mask.querySelectorAll('[data-cm]').forEach(p2=>p2.style.display = p2.dataset.cm===t.dataset.ct?'':'none');
        });
        $$('[data-ws]', mask).forEach(b=>b.onclick = ()=>{ p.ext.workStatus = b.dataset.ws; logAudit(`Рабочий статус: ${p.full_name} → ${b.dataset.ws}`,'Исполнитель'); saveState(); close(); APP.render(); toast('Рабочий статус обновлён','ok'); });
        const qa = mask.querySelector('[data-qual]');
        qa && (qa.onclick = ()=>changeQualification(p, close));
        const tr = mask.querySelector('[data-transfer]');
        tr && (tr.onclick = ()=>{
          showDropdown(tr, managers.map(m2=>({ label:m2.full_name, icon:'user-plus', onClick:()=>{ p.ext.managerId=m2.id; logAudit(`${role==='client'?'Клиент':'Исполнитель'} ${p.full_name} передан: ${m2.full_name}`,'Передача'); saveState(); toast(`Передано: ${m2.full_name}`,'ok'); close(); APP.render(); } })));
        });
        const blb = mask.querySelector('[data-bl]');
        blb && (blb.onclick = async ()=>{
          const toBl = !bl;
          if (toBl){
            openModal({ narrow:true, title:'Добавить в чёрный список',
              body:`<div class="field"><label>Причина *</label><textarea class="input" id="bl-reason" rows="3" placeholder="Нарушение правил, срыв сроков…"></textarea></div>`,
              footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--danger" data-bl-save>В чёрный список</button>`,
              onMount:(m2, close2)=>{
                m2.querySelector('[data-bl-save]').onclick = ()=>{
                  const reason = m2.querySelector('#bl-reason').value.trim();
                  if (!reason){ toast('Укажите причину','warn'); return; }
                  p.ext.status = 'blacklisted';
                  p.ext.comment = (p.ext.comment? p.ext.comment+'\n' : '') + `[ЧС ${fmtDate(Date.now())}] ${reason}`;
                  logAudit(`Добавлен в ЧС: ${p.full_name} — ${reason}`,'Безопасность');
                  saveState(); close2(); close(); APP.render(); toast('Добавлен в чёрный список','ok');
                };
              } });
            return;
          }
          p.ext.status = toBl?'blacklisted':'active';
          logAudit(`${toBl?'Добавлен в ЧС':'Убран из ЧС'}: ${p.full_name}`,'Безопасность');
          saveState(); toast(toBl?'Добавлен в чёрный список':'Разблокирован','ok'); close(); APP.render();
        });
        const fb = mask.querySelector('[data-fine]');
        fb && (fb.onclick = ()=>wipModal('Индивидуальная система штрафов'));
        const rq = mask.querySelector('[data-req]');
        rq && (rq.onclick = ()=>showRequisites(p));
        const cme = mask.querySelector('[data-cm-edit]');
        cme && (cme.onclick = ()=>editComment(p, close));
      }
    });
  }

  function changeQualification(p, closeCard){
    const u = me();
    const bypass = ['admin','top_manager'].includes(u.role);
    openModal({
      narrow:true, title:'Квалификация исполнителя',
      body:`<div class="stack" style="gap:10px">${Object.keys(p.ext.qualification||{}).map(s=>`
        <div class="row row--between"><span class="small">${esc(s)}</span>
        <div class="seg" data-q-spec="${esc(s)}">${[1,2,3].map(v=>`<button data-v="${v}" class="${p.ext.qualification[s]===v?'on':''}">${'★'.repeat(v)||v}</button>`).join('')}</div></div>`).join('')}
        <p class="small faint">Изменение рейтинга требует одобрения всех менеджеров. Администратор и главный менеджер меняют без голосования.</p>
      </div>`,
      footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-ok>Сохранить</button>`,
      onMount:(mask, close)=>{
        $$('[data-q-spec] button', mask).forEach(b=>b.onclick=()=>{
          const seg = b.closest('.seg');
          $$('button', seg).forEach(x=>x.classList.remove('on')); b.classList.add('on');
        });
        mask.querySelector('[data-x]').onclick = close;
        mask.querySelector('[data-ok]').onclick = ()=>{
          $$('[data-q-spec]', mask).forEach(seg=>{
            const on = seg.querySelector('button.on');
            if (on) p.ext.qualification[seg.dataset.qSpec] = +on.dataset.v;
          });
          const vals = Object.values(p.ext.qualification);
          p.ext.qualOverall = vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : 0;
          logAudit(`Квалификация ${p.full_name} обновлена${bypass?' (без голосования)':''}`,'Исполнитель');
          saveState(); toast(bypass?'Квалификация обновлена':'Отправлено на голосование менеджерам','ok');
          close(); closeCard && closeCard(); APP.render();
        };
      }
    });
  }

  function editComment(p, closeCard){
    openModal({
      narrow:true, title:'Редактировать комментарий',
      body:`<div class="stack" style="gap:12px">
        <div class="field"><label>Общий комментарий</label><textarea class="input" id="cm-pub">${esc(p.ext.comment||'')}</textarea></div>
        <div class="field"><label>Личная пометка</label><textarea class="input" id="cm-priv">${esc(p.ext.commentPersonal||'')}</textarea></div>
        <p class="small faint">Общий комментарий виден всем менеджерам и вступает в силу после голосования (демо: сохраняется сразу).</p>
      </div>`,
      footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-ok>Сохранить</button>`,
      onMount:(mask, close)=>{
        mask.querySelector('[data-x]').onclick = close;
        mask.querySelector('[data-ok]').onclick = ()=>{
          p.ext.comment = mask.querySelector('#cm-pub').value;
          p.ext.commentPersonal = mask.querySelector('#cm-priv').value;
          logAudit(`Комментарий обновлён: ${p.full_name}`,'Комментарий');
          saveState(); close(); closeCard && closeCard(); APP.render();
        };
      }
    });
  }

  function showRequisites(p){
    const r = p.ext.requisites||{};
    const rows = [['ИНН',r.inn],['КПП',r.kpp],['Банк',r.bank],['Расчётный счёт',r.account],['Корр. счёт',r.corr],['БИК',r.bik],['Юр. адрес',r.address]];
    openModal({ title:'Реквизиты', narrow:true,
      body: rows.every(x=>!x[1]) ? '<p class="muted small">Реквизиты не заполнены</p>' :
        `<div class="tbl-wrap"><table class="tbl" style="min-width:0">${rows.filter(x=>x[1]).map(x=>`<tr><td class="muted" style="border:0">${x[0]}</td><td style="border:0"><b class="mono small">${esc(x[1])}</b></td></tr>`).join('')}</table></div>`,
      footer:`<button class="btn btn--primary" data-x>Закрыть</button>`,
      onMount:(m2,c2)=>{ m2.querySelector('[data-x]').onclick=c2; } });
  }

  /* ==================== ПРОЕКТЫ И ПАПКИ ==================== */
  function projectsView(root){
    const render = ()=>{
      root.innerHTML = `
        <div class="page-head"><div><h2>Проекты и папки</h2><div class="sub">Заказы группируются по проектам и папкам заказчика</div></div>
          <div class="page-actions">
            <button class="btn btn--ghost" data-newf>${icon('plus')} Папка</button>
            <button class="btn btn--primary" data-newp>${icon('plus')} Проект</button>
          </div>
        </div>
        <div class="cols-2 grid">
          <div class="card"><div class="card-h"><h3>Проекты</h3></div><div class="card-b stack" style="gap:10px">
            ${noDemo(S.projects).map(p=>{ const cl=clientById(p.client_id)||{}; const cnt=S.orders.filter(o=>o.project_id===p.id).length;
              return `<div class="list-row" data-p="${p.id}" style="cursor:pointer">
                <span class="rank" style="background:var(--blue-soft);color:var(--blue)">${icon('projects','ico-sm')}</span>
                <div style="flex:1;min-width:0"><b class="small">${esc(p.name)}</b><div class="cell-sub">${esc(cl.full_name||'')} · ${cnt} заказов</div></div>
                <span class="badge ${p.status==='active'?'c-green':'c-gray'}">${p.status==='active'?'активен':'архив'}</span></div>`; }).join('')}
          </div></div>
          <div class="card"><div class="card-h"><h3>Папки заказов</h3></div><div class="card-b stack" style="gap:10px">
            ${noDemo(S.folders).map(f=>{ const cl=clientById(f.client_id)||{}; const cnt=S.orders.filter(o=>o.folder_id===f.id).length;
              return `<div class="list-row" data-f="${f.id}">
                <span class="rank" style="background:var(--violet-soft);color:var(--violet)">${icon('archive','ico-sm')}</span>
                <div style="flex:1;min-width:0"><b class="small">${esc(f.name)}</b><div class="cell-sub">${esc(cl.full_name||'')} · ${cnt} заказов</div></div></div>`; }).join('')}
          </div></div>
        </div>`;
      $$('[data-newp]', root).forEach(b=>b.onclick=()=>wipModal('Создание проекта'));
      $$('[data-newf]', root).forEach(b=>b.onclick=()=>wipModal('Создание папки'));
      $$('[data-p]', root).forEach(el=>el.onclick = ()=>{
        const p = S.projects.find(x=>x.id===el.dataset.p);
        APP.go('orders'); setTimeout(()=>{ ofilter.project = p.id; CRM._ordersRerender && CRM._ordersRerender(); toast(`Фильтр: проект «${p.name}»`,'info'); }, 30);
      });
      $$('[data-f]', root).forEach(el=>el.onclick = ()=>toast('Просмотр папки — фильтр заказов (демо)','info'));
    };
    render();
  }

  /* ==================== ИМПОРТ / ЭКСПОРТ / ПРАВИЛА ==================== */
  const RULE_FIELDS = {
    client: [['comment','Комментарий'],['name','ФИО/Компания'],['email','E-mail'],['phone','Телефон'],['company','Компания']],
    order:  [['comment','Комментарий'],['id','ID заказа'],['status','Статус'],['total','Сумма'],['client','Клиент']]
  };
  const RULE_OPS = [['contains','содержит текст'],['not_contains','не содержит'],['equals','равно'],['starts_with','начинается с'],['regex','регулярное выражение'],['gt','больше, чем'],['lt','меньше, чем']];
  function ruleContext(kind, clientObj, orderObj, rowNo){
    const ctx = kind === 'client'
      ? { comment:(clientObj&&clientObj.ext?clientObj.ext.comment:'') || '', name:(clientObj||{}).full_name || '', email:(clientObj||{}).email || '', phone:(clientObj||{}).phone || '', company:(clientObj&&clientObj.ext?clientObj.ext.company:'') || '' }
      : { comment:(orderObj||{}).comment || '', id:(orderObj||{}).order_id || '', status:(orderObj||{}).status || '', total:String((orderObj||{}).total ?? ''), client:String((orderObj||{}).client_id ?? '') };
    if (rowNo != null) ctx.__rowNo = rowNo;
    return ctx;
  }
  function evalCondition(c, ctx){
    const val = String(ctx[c.field] ?? '');
    const needle = String(c.value ?? '');
    switch (c.op){
      case 'contains': return !!needle && norm(val).includes(norm(needle));
      case 'not_contains': return !needle || !norm(val).includes(norm(needle));
      case 'equals': return norm(val) === norm(needle);
      case 'not_empty': return norm(val).length > 0;
      case 'empty': return norm(val).length === 0;
      case 'starts_with': return norm(val).startsWith(norm(needle));
      case 'gt': return parseFloat(val) > parseFloat(needle);
      case 'lt': return parseFloat(val) < parseFloat(needle);
      case 'regex': try { return !!new RegExp(needle, 'i').test(val); } catch(e){ return false; }
      default: return false;
    }
  }
  function ruleLabel(r){
    const conds = (r.conditions||[]).map(c=>`[${(RULE_FIELDS[r.entity]||[]).find(f=>f[0]===c.field)?.[1]||c.field} ${RULE_OPS.find(o=>o[0]===c.op)?.[1]||c.op} «${c.value}»]`).join(' И ');
    const act = ({discount:'скидка', manager:'менеджер', status:'статус'})[r.action_type] || r.action_type;
    return `${conds} → ${act}${r.action_value ? ': ' + r.action_value : ''}`;
  }
  /* Человекочитаемое описание условия/действия правила для журнала импорта */
  const RULE_FIELD_LABEL = { comment:'Комментарий', name:'Имя', email:'E-mail', phone:'Телефон', company:'Компания', id:'ID заказа', status:'Статус', total:'Сумма', client:'Клиент' };
  const RULE_OP_LABEL = { contains:'содержит', not_contains:'не содержит', equals:'равно', not_equals:'не равно', gt:'больше', lt:'меньше', regex:'regex', empty:'пусто', not_empty:'не пусто', starts:'начинается с', ends:'заканчивается на' };
  function ruleCondText(r){
    const conds = (r.conditions && r.conditions.length) ? r.conditions : [{ field:'comment', op:'contains', value: r.trigger_text || '' }];
    return conds.map(c => `${RULE_FIELD_LABEL[c.field] || c.field} ${RULE_OP_LABEL[c.op] || c.op} «${c.value}»`).join(' И ');
  }
  function ruleActionText(r){
    if (r.action_type === 'discount') return 'применить скидку';
    if (r.action_type === 'manager'){ const mm = userById(r.action_value); return 'менеджер → ' + (mm ? mm.full_name : (r.action_value || '—')); }
    if (r.action_type === 'status'){ const st = STATUS_META[r.action_value]; return 'статус → «' + (st ? st.label : r.action_value) + '»'; }
    return r.action_type;
  }
  function applyRules(kind, ctx, clientObj, orderObj, cb, label){
    (S.importRules||[]).forEach(r=>{
      if (r.entity !== kind) return;
      const conds = (r.conditions && r.conditions.length) ? r.conditions : [{ field:'comment', op:'contains', value: r.trigger_text || '' }];
      if (!conds.every(c => evalCondition(c, ctx))) return;
      if (kind === 'client' && clientObj){
        if (r.action_type === 'discount') clientObj.ext.discountApplied = true;
        if (r.action_type === 'manager') clientObj.ext.managerId = r.action_value;
      }
      if (kind === 'order' && orderObj){
        if (r.action_type === 'status') orderObj.status = r.action_value;
        if (r.action_type === 'manager') orderObj.manager_id = r.action_value;
      }
      cb && cb(`Правило применено · строка ${ctx.__rowNo || '—'}: [${ruleCondText(r)}] → ${ruleActionText(r)}`);
    });
  }

  function toolsView(root){
    const u = me(); const admin = u.role==='admin';
    root.innerHTML = `
      <div class="page-head"><div><h2>Импорт и экспорт</h2><div class="sub">${S.importLogs.length} операций журнала · добавлено: ${S.importLogs.reduce((a,l)=>a+(l.added||0),0)} · пропущено: ${S.importLogs.reduce((a,l)=>a+(l.skipped||0),0)} · ошибок: ${S.importLogs.reduce((a,l)=>a+(l.errs||0),0)} · предупреждений: ${S.importLogs.reduce((a,l)=>a+(l.warns||0),0)}</div></div>${me().role==='admin'?`<div class="page-actions"><button class="btn btn--ghost btn--sm" id="il-exp">${icon('export')} Экспорт журнала</button></div>`:''}</div>
      <div class="cols-2 grid">
        <div class="card"><div class="card-h"><h3>${icon('import')} Импорт</h3><span class="badge c-blue">XLSX → CSV автоматически</span></div>
          <div class="card-b stack" style="gap:12px">
            <select class="input" id="imp-entity"><option value="auto" selected>Вся таблица</option><option value="clients">Клиенты</option><option value="executors">Исполнители</option><option value="orders">Заказы</option></select>
            <select class="input" id="imp-enc" title="Для CSV; XLSX всегда читается корректно"><option value="auto">Кодировка: авто</option><option value="utf-8">UTF-8</option><option value="windows-1251">Windows-1251</option></select>
            <div class="dropzone" id="dz">${icon('import')}<div><b>Перетащите файл сюда</b><br><span class="small">XLSX читается напрямую · CSV — автоопределение кодировки UTF-8 / Windows-1251</span></div></div>
            <input type="file" id="imp-file" accept=".csv,.xlsx,.xls" hidden>
            <div class="progress" id="imp-prog" style="display:none"><span style="width:0%"></span></div>
            <div class="row" id="log-filters" style="display:none;gap:6px">
        <span class="chip on" data-lf="all">Все</span><span class="chip" data-lf="err">Только ошибки</span><span class="chip" data-lf="warn">Предупреждения</span><span class="chip" data-lf="ok">Успешные</span><span class="chip" data-lf="rule">Правила</span>
      </div>
      <div class="log-box" id="imp-log" hidden></div>
            <button class="btn btn--ghost btn--sm" id="il-full">${icon('file')} Экспорт полного лога</button>
                        <button class="btn btn--ghost btn--sm" id="dl-tpl">${icon('file')} Скачать шаблон CSV</button>
          </div></div>
        <div class="card"><div class="card-h"><h3>${icon('export')} Экспорт</h3></div>
          <div class="card-b stack" style="gap:12px">
            <select class="input" id="exp-entity"><option value="all" selected>Вся таблица</option><option value="orders">Заказы</option><option value="clients">Клиенты</option><option value="executors">Исполнители</option></select>
            <select class="input" id="exp-niche"><option value="">Все ниши</option>${S.niches.map(n=>`<option value="${n.id}">${esc(n.name)}</option>`).join('')}</select>
            <div class="seg"><button id="exp-csv" class="on">CSV</button><button id="exp-xlsx">XLSX</button></div>
            <button class="btn btn--primary btn--block" id="exp-go">${icon('export')} Выгрузить</button>
          </div></div>
      </div>
      <div class="card" style="margin-top:14px"><div class="card-h"><h3>${icon('scroll')} Правила импорта</h3>
        <span class="small faint">условия (И), regex · применяются при импорте и вручную</span></div>
        <div class="card-b stack" style="gap:9px">
          <div id="rules-list" class="stack" style="gap:8px">
            ${S.importRules.map(r=>`<div class="card card-pad" style="padding:11px 13px;background:var(--bg-2)">
              <div class="row row--between" style="gap:8px">
                <span class="badge ${r.entity==='client'?'c-green':'c-violet'}">${r.entity==='client'?'Клиент':'Заказ'}</span>
                <span class="small" style="flex:1;min-width:0;color:var(--text-2)">${esc(ruleLabel(r))}</span>
                ${admin?`<button class="iconbtn" style="width:30px;height:30px" data-editrule="${r.id}" title="Изменить">${icon('edit')}</button>
                <button class="iconbtn" style="width:30px;height:30px" data-delrule="${r.id}" title="Удалить">${icon('trash')}</button>`:''}
              </div></div>`).join('') || '<p class="small faint">Правил пока нет</p>'}
          </div>
          ${admin?`<button class="btn btn--soft btn--sm" id="nr-add">${icon('plus')} Новое правило</button>`:''}
          <hr>
          <div class="field"><label>Проверка правил</label>
            <div class="row wrap">
              <select class="input" id="rule-entity" style="width:auto"><option value="client">Клиент</option><option value="order">Заказ</option></select>
              <input class="input" id="rule-test" placeholder="Вставьте комментарий / значение…" style="flex:1;min-width:200px">
              <button class="btn btn--ghost" id="rule-go" style="flex:none">Проверить</button>
            </div>
            <div class="log-box small" id="rule-out" hidden></div>
          </div>
        </div></div>`;

    /* импорт */
    const dz = $('#dz', root), fi = $('#imp-file', root);
    dz.onclick = ()=>fi.click();
    dz.addEventListener('dragover', e=>{ e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', ()=>dz.classList.remove('over'));
    dz.addEventListener('drop', e=>{ e.preventDefault(); dz.classList.remove('over'); startImport(e.dataTransfer.files[0]); });
    fi.addEventListener('change', ()=>startImport(fi.files[0]));
    $('#dl-tpl', root).onclick = ()=>downloadText('aw-template-clients.csv', 'ФИО/Компания;Логин;Email;Телефон;Комментарий\nООО «Пример»;primer;info@example.ru;+7 900 000-00-00;PROMO10\n');

    /* ---- импорт: XLSX в worker + CSV с детектом кодировки + все листы ---- */
    const _imp = { clients: [], executors: [] };
    const KIND_LABEL = { clients:'Клиенты', executors:'Исполнители', orders:'Заказы' };
    const STATUS_RU = { 'выполнено':'done','выполнен':'done','в работе':'work','работа':'work','в ожидании':'waiting',
      'ожидание':'waiting','черновик':'draft','доработка':'revision','в доработке':'revision','доработке':'revision',
      'проблема':'problem','архив':'archived','архивирован':'archived' };
    const KIND_PRIO = { clients:0, executors:1, orders:2 }; // порядок обработки: ссылки «номер клиента/исполнителя» должны разрешаться

    const logBuf = [];
    let logFilter = 'all';
    const applyLogFilter = () => {
      const log = $('#imp-log', root);
      if (!log) return;
      log.querySelectorAll('div[data-level]').forEach(d => {
        d.style.display = (logFilter === 'all' || d.dataset.level === logFilter) ? '' : 'none';
      });
    };
    const flushLog = () => {
      const log = $('#imp-log', root);
      if (!log || !logBuf.length) return;
      log.insertAdjacentHTML('beforeend', logBuf.map(([t,c]) => `<div data-level="${c || 'ok'}" class="${c || 'ok'}">${esc(t)}</div>`).join(''));
      log.scrollTop = log.scrollHeight;
      logBuf.length = 0;
      applyLogFilter();
    };
    const impKind = { ok:0, err:0, warn:0, rule:0, info:0 };
    const addLog = (t, c='') => { const kind = c || 'ok'; logBuf.push([t, kind]); impKind[kind] = (impKind[kind]||0)+1; flushLog(); };

    function normHeader(s){ return String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[«»"]/g,'').replace(/\s+/g,' ').trim(); }

    function detectSheetKind(rows){
      const header = (rows.find(r => r && r.some(c => (c||'').trim())) || []).map(normHeader).join(' | ');
      if (/заработано|умения|специализац/.test(header)) return { kind:'executors', confident:true };
      if (/номер клиента|номера исполнителей|дедлайн|id заказа/.test(header)) return { kind:'orders', confident:true };
      if (/фио\/компания|e-mail|номер телефона/.test(header)) return { kind:'clients', confident:true };
      if (/фио|компания/.test(header)) return { kind:'clients', confident:false };
      return { kind:'clients', confident:false };
    }

    function buildMapping(header, entity){
      const H = header.map(normHeader);
      const find = (...names) => H.findIndex(h => h && names.some(n => h.includes(n)));
      const m = {};
      if (entity === 'orders'){
        m.id = find('id заказа','заказ'); m.clientnum = find('номер клиента','клиент');
        m.execs = find('номера исполнителей','исполнител'); m.date = find('дата заказа','дата');
        m.start = find('дата начала','дата старта','старт'); m.deadline = find('дедлайн','срок'); m.status = find('статус');
        m.total = find('итого','сумма'); m.cert = find('заверение'); m.comment = find('комментарий');
        const dflt = [0,1,2,3,-1,4,5,6,7,8], keys = ['id','clientnum','execs','date','start','deadline','status','total','cert','comment'];
        keys.forEach((k,i)=>{ if (m[k] == null || m[k] < 0) m[k] = header.length >= 9 ? dflt[i] : -1; });
      } else if (entity === 'executors'){
        m.fio = find('фио','имя'); m.email = find('e-mail','email','почта'); m.phone = find('телефон','тел');
        m.spec = find('спец','умения','специализац'); m.comment = find('комментарий');
        m.earned = find('заработано'); m.orderids = find('id заказов','заказы');
        const dflt = [0,1,2,3,4,5,6], keys = ['fio','email','phone','spec','comment','earned','orderids'];
        keys.forEach((k,i)=>{ if (m[k] == null || m[k] < 0) m[k] = header.length >= 7 ? dflt[i] : -1; });
      } else {
        m.fio = find('фио/компания','фио','компания','имя'); m.email = find('e-mail','email','почта');
        m.phone = find('телефон','тел'); m.comment = find('комментарий');
        const dflt = [0,1,2,3], keys = ['fio','email','phone','comment'];
        keys.forEach((k,i)=>{ if (m[k] == null || m[k] < 0) m[k] = header.length >= 4 ? dflt[i] : -1; });
      }
      /* Все колонки-комментарии (Комментарий, Комментарий 2, Примечание, Заметки…) */
      m.comments = H.reduce((acc, h, i) => { if (h && /коммент|примеч|заметк|comment|note/i.test(h) && i !== m.comment) acc.push(i); return acc; }, []);
      return m;
    }

    function decodeText(buf, mode){
      if (mode === 'windows-1251') return { text: new TextDecoder('windows-1251').decode(buf), enc:'Windows-1251' };
      const isUtf8Bom = buf[0]===0xEF && buf[1]===0xBB && buf[2]===0xBF;
      const isUtf16 = (buf[0]===0xFF && buf[1]===0xFE) || (buf[0]===0xFE && buf[1]===0xFF);
      if (isUtf16) return { text: new TextDecoder('utf-16le').decode(buf).replace(/^\uFEFF/,''), enc:'UTF-16' };
      if (isUtf8Bom || mode === 'utf-8') return { text: new TextDecoder('utf-8').decode(buf).replace(/^\uFEFF/,''), enc:'UTF-8' };
      try { return { text: new TextDecoder('utf-8', { fatal:true }).decode(buf), enc:'UTF-8' }; }
      catch(e){ return { text: new TextDecoder('windows-1251').decode(buf), enc:'Windows-1251' }; }
    }

    function splitDelim(line, d){
      const out = []; let cur = '', q = false;
      for (const ch of line){
        if (ch === '"'){ q = !q; continue; }
        if (ch === d && !q){ out.push(cur); cur = ''; } else cur += ch;
      }
      out.push(cur);
      return out.map(s => s.trim());
    }

    function parseDateVal(v){
      const s = String(v||'').trim();
      if (/^\d{4,6}([.,]\d+)?$/.test(s)){
        const serial = parseFloat(s);
        if (serial > 20000 && serial < 80000) return Date.UTC(1899, 11, 30) + serial * 86400000;
      }
      const m = s.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
      if (m){
        const [, d, mo, y, hh = '0', mi = '0'] = m;
        const yy = +y < 100 ? 2000 + +y : +y;
        return new Date(yy, +mo - 1, +d, +hh, +mi).getTime();
      }
      return null;
    }

    function parseExecsRaw(v){
      const out = [];
      String(v||'').split(/[,;]/).forEach(tok=>{
        const m = tok.trim().replace(/^[№#\s]+/,'').match(/^(\d+)\s*(?:\s*[—–\-=:]\s*([\d.,]+))?$/);
        if (m) out.push({ num: +m[1], amount: m[2] ? parseFloat(m[2].replace(',', '.')) : 0 });
      });
      return out;
    }

    /* Разбор XLSX: сначала пробуем фоновый поток (Web Worker), иначе основной */
    const parseCache = new Map(); /* name|size → sheets */
    async function parseXlsx(file){
      const t0 = performance.now();
      const key = file.name + '|' + file.size;
      if (parseCache.has(key)){ addLog(`Файл уже разобран ранее — беру из кеша (мгновенно)`, 'rule'); return parseCache.get(key); }
      let result = null;
      if (window.Worker && location.protocol !== 'file:'){
        result = await parseInWorker(file);
        if (result) addLog(`XLSX разобран в фоновом потоке (Web Worker) за ${Math.round(performance.now() - t0)} мс`, 'ok');
      }
      if (!result){
        const wb = await AWX.read(file);
        result = { sheets: wb.sheets };
        addLog(`XLSX разобран в основном потоке за ${Math.round(performance.now() - t0)} мс`);
      }
      parseCache.set(key, result);
      return result;
    }

    async function parseInWorker(file){
      try {
        const resp = await fetch('js/xlsx.js');
        if (!resp.ok) return null;
        const src = await resp.text();
        const glue = src + '\nself.onmessage = async (e) => { try { const out = await AWX.readBytes(new Uint8Array(e.data)); postMessage({ ok:true, sheets: out.sheets }); } catch (err) { postMessage({ ok:false, error: (err && err.message) || "worker error" }); } };';
        const url = URL.createObjectURL(new Blob([glue], { type:'text/javascript' }));
        const w = new Worker(url);
        const buf = await file.arrayBuffer();
        const out = await new Promise((res, rej) => {
          w.onmessage = e => e.data.ok ? res(e.data) : rej(new Error(e.data.error || 'ошибка worker'));
          w.onerror = () => rej(new Error('ошибка запуска worker'));
          w.postMessage(buf, [buf]);
          setTimeout(() => rej(new Error('таймаут разбора XLSX')), 60000);
        });
        w.terminate(); URL.revokeObjectURL(url);
        return out;
      } catch(e){
        addLog('Фоновый поток недоступен (' + e.message + ') — разбираю в основном', 'warn');
        return null;
      }
    }

    function pickSheets(det){
      return new Promise(res => {
        openModal({
          title:'Выберите листы для импорта',
          body:`<p class="small muted" style="margin-bottom:10px">Отметьте нужные листы или импортируйте всю книгу. Тип определён по заголовкам (строка 1); нумерация строк в журнале — как в Excel, с 2.</p>
            <div class="stack" style="gap:8px" id="ps-list">
            ${det.map((d,i)=>`<label class="check ps-row" style="padding:9px 11px;border:1px solid var(--border);border-radius:11px;cursor:pointer">
              <input type="checkbox" data-si="${i}" ${d.confident ? 'checked' : ''}><span class="box"><svg><use href="#i-check-c"/></svg></span>
              <span style="flex:1;min-width:0"><b>${esc(d.name)}</b><br><span class="faint small">${d.rows.length} строк · строка 1 — заголовки</span></span>
              <span class="badge ${d.kind==='clients'?'c-green':d.kind==='executors'?'c-blue':'c-violet'}">${KIND_LABEL[d.kind]}${d.confident?'':' · ?'}</span></label>`).join('')}
            </div>`,
          footer:`<button class="btn btn--ghost" data-x>Отмена</button>
                  <span class="spacer"></span>
                  <button class="btn btn--soft" data-all>${icon('import')} Все листы</button>
                  <button class="btn btn--primary" data-go>Импортировать выбранное</button>`,
          onClose: () => res(null),
          onMount:(mask, close)=>{
            mask.querySelector('[data-x]').onclick = () => { res(null); close(); };
            mask.querySelector('[data-all]').onclick = () => { res({ all:true }); close(); };
            mask.querySelector('[data-go]').onclick = () => {
              const idx = $$('#ps-list input:checked', mask).map(i => +i.dataset.si);
              res({ sheets: idx.map(i => det[i]) }); close();
            };
          }
        });
      });
    }

    const ilFull = root.querySelector('#il-full');
    if (ilFull) ilFull.onclick = ()=>{
      const rows = [['Время операции','Файл','Раздел','Тип','Сообщение']];
      [...(S.importLogLines||[])].forEach(l=>rows.push([fmtDT(l.t), l.file||'', l.entity||'', {ok:'Успешно',err:'Ошибка',warn:'Предупреждение',rule:'Правило',info:'Инфо'}[l.kind]||l.kind, l.text||'']));
      const csv = rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\n');
      const aEl = document.createElement('a');
      aEl.href = URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv'})); aEl.download = 'import-full-log.csv'; aEl.click();
      setTimeout(()=>URL.revokeObjectURL(aEl.href), 4000);
      logAudit('Экспорт полного лога импорта', 'Импорт'); saveState();
    };
    const ilExp = root.querySelector('#il-exp');
    if (ilExp) ilExp.onclick = ()=>{
      const rows = [['Дата/время','Добавлено','Пропущено','Правил','Ошибок','Предупреждений','Успешных строк']];
      [...S.importLogs].forEach(l=>rows.push([fmtDT(l.t), l.added||0, l.skipped||0, l.ruled||0, l.errs||0, l.warns||0, l.infos||0]));
      const csv = rows.map(r=>r.join(';')).join('\n');
      const aEl = document.createElement('a');
      aEl.href = URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv'})); aEl.download = 'import-logs.csv'; aEl.click();
      setTimeout(()=>URL.revokeObjectURL(aEl.href), 4000);
      logAudit('Экспорт журнала импорта', 'Импорт'); saveState();
    };
    async function startImport(file){
      if (!file) return;
      const _t0 = performance.now();
      $('#imp-file', root).value = ''; /* сброс: повторный выбор того же файла снова сработает */
      const prog = $('#imp-prog', root);
      prog.style.display=''; $('#imp-log', root).hidden = false; $('#imp-log', root).innerHTML = '';
      Object.keys(impKind).forEach(k => impKind[k] = 0);
      const lf = $('#log-filters', root); if (lf) lf.style.display = '';
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      let entity = $('#imp-entity', root).value;
      let sheetsData;

      try {
        if (ext === 'xlsx' || ext === 'xls'){
          addLog('XLSX читаю напрямую: кириллица не зависит от кодировки', 'rule');
          const wb = await parseXlsx(file);
          sheetsData = wb.sheets.map(sh => ({ name: sh.name, rows: sh.rows, ...detectSheetKind(sh.rows) }));
        } else {
          const buf = new Uint8Array(await file.arrayBuffer());
          const mode = $('#imp-enc', root).value;
          const { text, enc } = decodeText(buf, mode);
          addLog(`Кодировка: ${enc}${mode==='auto' ? ' (определена автоматически)' : ''}`, enc==='Windows-1251' ? 'warn' : 'ok');
          const first = text.split(/\r?\n/).find(l => l.trim()) || '';
          const delim = [';', '\t', ','].sort((a,b) => first.split(b).length - first.split(a).length)[0];
          const rows = text.split(/\r?\n/).filter(l => l.trim()).map(l => splitDelim(l, delim));
          const det = entity === 'auto' ? detectSheetKind(rows) : { kind: entity, confident: true };
          sheetsData = [{ name: file.name, rows, ...det }];
        }
      } catch(err){
        addLog('Ошибка чтения: ' + err.message, 'err');
        return;
      }

      const isExcel = ext === 'xlsx' || ext === 'xls';
      let pick;
      if (!isExcel){ pick = { all:true }; }
      else {
        pick = await pickSheets(sheetsData); /* предотмечены все листы = вся книга */
        if (!pick) { addLog('Импорт отменён — листы не выбраны', 'warn'); prog.style.display='none'; return; }
      }
      const chosen = pick.all ? sheetsData.slice() : pick.sheets;
      if (!chosen.length){ addLog('Не выбран ни один лист', 'warn'); prog.style.display='none'; return; }
      chosen.sort((a,b) => (KIND_PRIO[a.kind] ?? 3) - (KIND_PRIO[b.kind] ?? 3));
      _imp.clients = []; _imp.executors = [];
      /* нумерация строк книги привязывается к сущностям: строка 1 — заголовок, данные с 2 */

      /* Очередь заданий: клиенты → исполнители → заказы; нумерация строк — как в Excel (заголовок = строка 1) */
      const jobs = [];
      chosen.forEach(sh => {
        const dataRows = sh.rows.filter(r => r.some(c => (c||'').trim()));
        if (dataRows.length < 2){ jobs.push({ empty:true, name:sh.name }); return; }
        const header = dataRows[0].map(String);
        const map = buildMapping(header, sh.kind);
        for (let i = 1; i < dataRows.length; i++) jobs.push({ kind: sh.kind, map, r: dataRows[i], rowNo: i + 1, sheet: sh.name });
        jobs.push({ summary:true, name: sh.name });
      });
      const total = jobs.length;
      let added = 0, skipped = 0, ruled = 0;
      const perSheet = {};
      addLog(`К импорту: ${total} строк данных в ${chosen.length} лист(ах) · дедупликация через Set, батчи логов`);
      const clientKeys = new Set(), execKeys = new Set();
      S.users.forEach(x => {
        const box = x.role === 'client' ? clientKeys : (x.role === 'executor' ? execKeys : null);
        if (!box) return;
        if (x.email) box.add('e:' + norm(x.email));
        if (x.phone) box.add('p:' + x.phone);
      });
      const orderIdSet = new Set(S.orders.map(o => norm(o.order_id)));
      const baseClients = S.users.filter(x => x.role === 'client');
      const baseExecs = S.users.filter(x => x.role === 'executor');
      /* «Номер клиента»/«Номер исполнителя» = номер строки книги (данные с 2) */
      const clientByNum = n => (n != null && _imp.clients[n]) ? _imp.clients[n] : baseClients[(n||2)-2] || null;
      const executorByNum = n => (n != null && _imp.executors[n]) ? _imp.executors[n] : baseExecs[(n||2)-2] || null;

      /* Прочерк (любой вид тире) = «данных нет»: превращаем в пустое значение */
      const DASH_RE = /^[\s\u00A0\-–—―−‒﹘﹣＿_]*$/;
      const get = (r, map, k) => { if (map[k] == null || map[k] < 0) return ''; const v = String(r[map[k]] || '').trim(); return DASH_RE.test(v) ? '' : v; };
      /* Все комментарии: основная колонка + любые колонки, похожие на комментарий/примечание */
      const collectComments = (r, map) => {
        const idxs = [map.comment, ...(map.comments || [])].filter((v, i, a) => v != null && v >= 0 && a.indexOf(v) === i);
        return idxs.map(ix => String(r[ix] == null ? '' : r[ix]).trim()).filter(v => v && !DASH_RE.test(v)).join('\n');
      };
      const mark = (j, key, delta) => {
        const s = perSheet[j.sheet] || (perSheet[j.sheet] = { added:0, skipped:0 });
        s[key] = (s[key] || 0) + delta;
      };

      const runJob = j => {
        if (j.empty){ logBuf.push([`[${j.sheet}] в листе нет строк данных`, 'warn']); return; }
        if (j.summary){
          const s = perSheet[j.name] || { added:0, skipped:0 };
          addLog(`[${j.name}] готово: +${s.added}, пропущено ${s.skipped}`, 'ok');
          return;
        }
        const r = j.r, rowNo = j.rowNo;
        if (j.kind === 'clients'){
          const fio = get(r,j.map,'fio'), email = get(r,j.map,'email'), phone = get(r,j.map,'phone').replace(/[^\d+]/g,''), comment = collectComments(r,j.map);
          if (!fio || (!email && !phone)){ logBuf.push([`[${j.sheet}] Строка ${rowNo}: пропущена — нет ФИО или контактов`, 'err']); mark(j,'skipped',1); skipped++; return; }
          if ((email && clientKeys.has('e:' + norm(email))) || (phone && clientKeys.has('p:' + phone))){
            logBuf.push([`[${j.sheet}] Строка ${rowNo}: дубликат (${fio}) — пропущен`, 'warn']); mark(j,'skipped',1); skipped++; return;
          }
          const nu = { id: uid(), username: norm(email).split('@')[0] || 'user' + rowNo, email: email || '', pw: 'import123', role: 'client', full_name: fio, phone, about: '', theme: 'system', is_online: false, avatar: '', consent_marketing: false, tour_completed: true, created_at: Date.now(),
            ext: { company: /^(ооо|ао|ип|зао)\b/i.test(fio) ? fio : '', roleIn: '', comment, discountApplied: false, managerId: me().id, status: 'active', requisites: {}, consentNews: false, xlsxRow: j.rowNo } };
          applyRules('client', ruleContext('client', nu, null, j.rowNo), nu, null, n => { addLog(`[${j.sheet}] ` + n, 'rule'); ruled++; });
          S.users.push(nu); _imp.clients[j.rowNo] = nu.id; if (nu.email) clientKeys.add('e:' + norm(nu.email)); if (nu.phone) clientKeys.add('p:' + nu.phone); mark(j,'added',1); added++;
          logBuf.push([`[${j.sheet}] Строка ${rowNo}: + клиент ${fio}`, 'ok']);
        } else if (j.kind === 'executors'){
          const fio = get(r,j.map,'fio'), email = get(r,j.map,'email'), phone = get(r,j.map,'phone').replace(/[^\d+]/g,''), spec = get(r,j.map,'spec'), comment = collectComments(r,j.map);
          const earned = parseFloat(String(get(r,j.map,'earned')).replace(/\s/g,'').replace(',', '.')) || 0;
          if (!fio || (!email && !phone)){ logBuf.push([`[${j.sheet}] Строка ${rowNo}: пропущена — нет ФИО или контактов`, 'err']); mark(j,'skipped',1); skipped++; return; }
          if ((email && execKeys.has('e:' + norm(email))) || (phone && execKeys.has('p:' + phone))){
            logBuf.push([`[${j.sheet}] Строка ${rowNo}: дубликат (${fio}) — пропущен`, 'warn']); mark(j,'skipped',1); skipped++; return;
          }
          const specs = spec ? spec.split(',').map(s => s.trim()).filter(Boolean) : [];
          /* Специализации из таблицы попадают в справочник (Ниши и специализации) */
          specs.forEach(sp2 => {
            const exists = S.specializations.some(x => norm(x.name) === norm(sp2));
            if (!exists) S.specializations.push({ id: uid(), nish_id: null, name: sp2, from_import: true });
          });
          const nu = { id: uid(), username: norm(email).split('@')[0] || 'user' + rowNo, email: email || '', pw: 'import123', role: 'executor', full_name: fio, phone, about: '', theme: 'system', is_online: false, avatar: '', consent_marketing: false, tour_completed: true, created_at: Date.now(),
            ext: { specializations: specs, qualification: {}, qualOverall: specs.length ? 1 : 0, earned, status: 'active', workStatus: 'working', comment, commentPersonal: '', managerId: me().id, xlsxRow: j.rowNo } };
          S.users.push(nu); _imp.executors[j.rowNo] = nu.id; if (nu.email) execKeys.add('e:' + norm(nu.email)); if (nu.phone) execKeys.add('p:' + nu.phone); mark(j,'added',1); added++;
          logBuf.push([`[${j.sheet}] Строка ${rowNo}: + исполнитель ${fio}${earned ? ' · ' + fmtMoney(earned) : ''}`, 'ok']);
        } else {
          const oid = get(r,j.map,'id') || generateOrderId();
          if (orderIdSet.has(norm(oid))){ logBuf.push([`[${j.sheet}] Строка ${rowNo}: дубликат ID ${oid} — пропущен`, 'warn']); mark(j,'skipped',1); skipped++; return; }
          orderIdSet.add(norm(oid));
          const clNum = parseInt(get(r,j.map,'clientnum'), 10);
          const cl = clientByNum(clNum);
          if (!cl){ logBuf.push([`[${j.sheet}] Строка ${rowNo}: клиент №${clNum || '?'} не найден — пропущено`, 'warn']); mark(j,'skipped',1); skipped++; return; }
          const status = STATUS_RU[norm(get(r,j.map,'status'))] || 'waiting';
          const total2 = parseFloat(String(get(r,j.map,'total')).replace(/\s/g,'').replace(',', '.')) || 0;
          const cert = parseFloat(String(get(r,j.map,'cert')).replace(/\s/g,'').replace(',', '.')) || 0;
          const dateTs = parseDateVal(get(r,j.map,'date')) || Date.now();
          const startTs = parseDateVal(get(r,j.map,'start')) || dateTs;
          const dlRaw = String(get(r,j.map,'deadline'));
          const dlTs = dlRaw ? parseDateVal(dlRaw.replace(/^до\s*/i, '')) : null;
          const execs = parseExecsRaw(get(r,j.map,'execs')).map(e => {
            const u2 = executorByNum(e.num);
            return u2 ? { uid: u2.id, amount: e.amount, is_paid: false } : null;
          }).filter(Boolean);
          const no = { id: uid(), order_id: oid, client_id: cl.id, order_date: dateTs, start_date: startTs, deadline: dlTs, executor_deadline: null, status, total: total2,
            certification_amount: cert, need_cert: cert > 0, comment: collectComments(r,j.map), manager_id: me().id, project_id: null, folder_id: null,
            nish_id: S.niches[0].id, executors: execs, audio: 0, files: [], proposed_price: 0, paid_amount: status === 'done' ? total2 : 0,
            forbid_download: false, portfolio_ban: true, nda: false, archived_at: status === 'archived' ? Date.now() : null,
            created_at: dateTs, history: [{ t: Date.now(), txt: 'Импортирован из Excel: статус «' + (get(r,j.map,'status') || STATUS_META[status].label) + '»' }] };
          applyRules('order', ruleContext('order', null, no, j.rowNo), null, no, n => { addLog(`[${j.sheet}] ` + n, 'rule'); ruled++; });
          S.orders.unshift(no); mark(j,'added',1); added++;
          const execNames = execs.map(e => { const uu = userById(e.uid); return uu ? `${uu.full_name} (${fmtMoney(e.amount)})` : ''; }).filter(Boolean).join(', ');
          logBuf.push([`[${j.sheet}] Строка ${rowNo}: + заказ ${oid} · ${STATUS_META[status].label} · ${fmtMoney(total2)}${execNames ? ' · исполнители: ' + execNames : ''}${no.comment ? ' · комментарий: ' + no.comment.slice(0, 60) : ''}`, 'ok']);
        }
      };

      const runAll = async () => {
        const t0 = performance.now();
        for (let k = 0; k < jobs.length; k++){
          runJob(jobs[k]);
          if ((k & 2047) === 2047){
            prog.firstElementChild.style.width = Math.round(k / total * 100) + '%';
            flushLog();
            await new Promise(r => setTimeout(r, 0));
          }
        }
        prog.firstElementChild.style.width = '100%';
        flushLog();
        const domErr = root.querySelectorAll('#imp-log .err').length;
        const domWarn = root.querySelectorAll('#imp-log .warn').length;
        addLog(`Итог: добавлено ${added}, пропущено ${skipped}, правил применено ${ruled} · ошибок: ${domErr}, предупреждений: ${domWarn} · листов: ${chosen.length} · за ${Math.round(performance.now() - t0)} мс`, 'ok');
        const stamp = Date.now();
        S.importLogs.unshift({ t: stamp, added, skipped, ruled, errs: domErr, warns: domWarn, infos: impKind.ok||0, file: file.name, entity: chosen.map(s=>s.kind).join('+') });
        /* ПОЛНЫЙ построчный журнал каждой операции */
        const lineRecs = [];
        logBuf.forEach(([txt, kind]) => lineRecs.push({ t: stamp, file: file.name, entity: chosen.map(s=>s.kind).join('+'), kind: kind||'ok', text: txt }));
        if (lineRecs.length){
          S.importLogLines = (S.importLogLines || []).concat(lineRecs);
          if (S.importLogLines.length > 9000) S.importLogLines = S.importLogLines.slice(-9000);
        }
        logAudit(`Импорт (${chosen.length} лист(ов)): +${added} записей (${file.name})`, 'Импорт');
        saveState();
        toast(`Импорт завершён: +${added} за ${Math.round(performance.now() - t0)} мс`, 'ok');
      };
      runAll();
    }


    /* экспорт */
    let expFmt = 'csv';
    $('#exp-csv', root).onclick = e=>{ expFmt='csv'; setSeg(e.target); };
    $('#exp-xlsx', root).onclick = e=>{ expFmt='xlsx'; setSeg(e.target); };
    function setSeg(btn){ btn.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('on')); btn.classList.add('on'); }
    const buildRows = (ent, nid) => {
      if (ent==='orders'){
        return [['ID','Клиент','Ниша','Статус','Итого','Начало','Дедлайн','Менеджер'],
          ...noDemo(S.orders.filter(o=>!nid||o.nish_id===nid)).map(o=>[o.order_id,(clientById(o.client_id)||{}).full_name||'',nicheName(o.nish_id),STATUS_META[o.status].label,o.total,o.start_date?fmtDate(o.start_date):'',o.deadline?fmtDT(o.deadline):'',(userById(o.manager_id)||{}).full_name||''])];
      }
      if (ent==='clients'){
        return [['ФИО/Компания','Логин','Email','Телефон','Комментарий','Статус','№ строки'],
          ...noDemo(S.users.filter(x=>x.role==='client')).map(x=>[x.full_name,x.username,x.email,x.phone,x.ext.comment,x.ext.status,x.ext.xlsxRow||''])];
      }
      return [['ФИО','Логин','Email','Телефон','Специализации','Заработано','Статус','№ строки'],
        ...noDemo(S.users.filter(x=>x.role==='executor')).map(x=>[x.full_name,x.username,x.email,x.phone,x.ext.specializations.join(', '),x.ext.earned,x.ext.status,x.ext.xlsxRow||''])];
    };
    const emitCsv = (ent, nid) => {
      const rows2 = buildRows(ent, nid);
      const csv = '\ufeff' + rows2.map(r=>r.map(c=>`"${String(c??'').replace(/"/g,'""')}"`).join(';')).join('\n');
      downloadText(`${ent}-export.csv`, csv, 'text/csv');
    };
    /* Единая книга XLSX с листами (тот же формат, что у импорта) */
    const emitXlsxAll = (nid) => {
      const book = { 'Клиенты': buildRows('clients', nid), 'Исполнители': buildRows('executors', nid), 'Заказы': buildRows('orders', nid) };
      const bytes = AWX.writeSheets(book);
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const aEl = document.createElement('a');
      aEl.href = URL.createObjectURL(blob); aEl.download = 'audiowizard-export.xlsx'; aEl.click();
      setTimeout(()=>URL.revokeObjectURL(aEl.href), 4000);
    };
    $('#exp-go', root).onclick = ()=>{
      const ent = $('#exp-entity', root).value, nid = $('#exp-niche', root).value;
      if (ent === 'all'){
        if (expFmt === 'xlsx'){ emitXlsxAll(nid); }
        else { emitCsv('clients', nid); setTimeout(()=>emitCsv('executors', nid), 350); setTimeout(()=>emitCsv('orders', nid), 700); }
        logAudit(`Экспорт: вся таблица (${expFmt.toUpperCase()})`, 'Экспорт');
        toast('Экспорт готов — файлы скачиваются', 'ok');
        return;
      }
      if (expFmt === 'xlsx'){ emitXlsxAll(nid); }
      else { emitCsv(ent, nid); }
      logAudit(`Экспорт: ${ent} (${expFmt.toUpperCase()})`, 'Экспорт');
      toast('Экспорт готов — файл скачивается', 'ok');
    };

    /* правила: редактор условий + regex */
    const ruleEditor = (existing) => {
      const isNew = !existing;
      const rule = existing ? JSON.parse(JSON.stringify(existing)) : { id: uid(), entity: 'client', conditions: [{ field:'comment', op:'contains', value:'' }], action_type: 'discount', action_value: '' };
      openModal({
        title: isNew ? 'Новое правило импорта' : 'Правило импорта',
        wide: true,
        body:`<div class="stack" style="gap:12px">
          <div class="row"><div class="field" style="width:180px"><label>Сущность</label>
            <select class="input" id="re-entity">${[['client','Клиент'],['order','Заказ']].map(([v,t])=>`<option value="${v}" ${rule.entity===v?'selected':''}>${t}</option>`).join('')}</select></div>
            <div class="small muted" style="align-self:end;padding-bottom:8px">Все условия объединяются через <b>И</b>; в значении можно использовать регулярные выражения.</div>
          </div>
          <div class="stack" style="gap:8px" id="re-conds"></div>
          <button class="btn btn--ghost btn--sm" id="re-addcond">${icon('plus')} Добавить условие</button>
          <hr>
          <div class="row wrap">
            <div class="field" style="width:170px"><label>Действие</label>
              <select class="input" id="re-action">${[['discount','Применить скидку'],['manager','Назначить менеджера'],['status','Установить статус']].map(([v,t])=>`<option value="${v}" ${rule.action_type===v?'selected':''}>${t}</option>`).join('')}</select></div>
            <div class="field" style="flex:1" id="re-value-wrap"></div>
          </div>
        </div>`,
        footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-save>Сохранить правило</button>`,
        onMount:(mask, close)=>{
          const g2 = s => mask.querySelector(s);
          const fieldsFor = ent => RULE_FIELDS[ent] || [];
          const condsHost = g2('#re-conds');
          const condRow = c => `<div class="row" style="gap:8px">
            <select class="input" data-cf="field" style="width:170px">${fieldsFor(rule.entity).map(([v,t])=>`<option value="${v}" ${c.field===v?'selected':''}>${t}</option>`).join('')}</select>
            <select class="input" data-cf="op" style="width:190px">${RULE_OPS.map(([v,t])=>`<option value="${v}" ${c.op===v?'selected':''}>${t}</option>`).join('')}</select>
            <input class="input mono" data-cf="value" value="${esc(c.value)}" placeholder="значение / паттерн" style="flex:1">
            <button class="iconbtn" data-cdel title="Удалить условие" style="width:32px;height:32px">${icon('x')}</button>
          </div>`;
          const renderConds = ()=>{ condsHost.innerHTML = rule.conditions.map(condRow).join(''); };
          renderConds();
          g2('#re-entity').addEventListener('change', e=>{
            rule.entity = e.target.value;
            rule.conditions = rule.conditions.map(c => ({ ...c, field: fieldsFor(rule.entity)[0][0] }));
            renderConds();
          });
          condsHost.addEventListener('click', e=>{ if (e.target.closest('[data-cdel]')) e.target.closest('.row').remove(); });
          g2('#re-addcond').onclick = ()=>{ rule.conditions.push({ field: fieldsFor(rule.entity)[0][0], op:'contains', value:'' }); renderConds(); };
          const valWrap = g2('#re-value-wrap');
          const renderVal = ()=>{
            const a = g2('#re-action').value;
            if (a === 'manager') valWrap.innerHTML = `<label>Менеджер</label><select class="input" id="re-val">${S.users.filter(x=>['manager','top_manager'].includes(x.role)).map(m2=>`<option value="${m2.id}" ${rule.action_value===m2.id?'selected':''}>${esc(m2.full_name)}</option>`).join('')}</select>`;
            else if (a === 'status') valWrap.innerHTML = `<label>Статус</label><select class="input" id="re-val">${Object.entries(STATUS_META).map(([st,m2])=>`<option value="${st}" ${rule.action_value===st?'selected':''}>${m2.label}</option>`).join('')}</select>`;
            else valWrap.innerHTML = `<label>Значение</label><input class="input" id="re-val" value="—"><input type="hidden" id="re-val2">`;
          };
          renderVal();
          g2('#re-action').addEventListener('change', renderVal);
          mask.querySelector('[data-x]').onclick = close;
          mask.querySelector('[data-save]').onclick = ()=>{
            const conds = [...condsHost.querySelectorAll('.row')].map(row=>({
              field: row.querySelector('[data-cf="field"]').value,
              op: row.querySelector('[data-cf="op"]').value,
              value: row.querySelector('[data-cf="value"]').value
            })).filter(c => c.value.trim() || c.op === 'regex');
            if (!conds.length){ toast('Добавьте хотя бы одно условие', 'err'); return; }
            const a = g2('#re-action').value;
            const valEl = g2('#re-val');
            rule.conditions = conds;
            rule.action_type = a;
            rule.action_value = a === 'discount' ? '' : (valEl ? valEl.value : '');
            if (isNew) S.importRules.push(rule);
            else Object.assign(existing, rule);
            logAudit((isNew ? 'Создано' : 'Изменено') + ' правило импорта', 'Настройки');
            saveState(); toast('Правило сохранено', 'ok'); close(); APP.render();
          };
        }
      });
    };

    if (admin){
      const addBtn = root.querySelector('#nr-add');
      addBtn && (addBtn.onclick = () => ruleEditor(null));
      root.addEventListener('click', e=>{
        const ed = e.target.closest('[data-editrule]');
        if (ed){ const r = S.importRules.find(x => x.id === ed.dataset.editrule); r && ruleEditor(r); }
        const del = e.target.closest('[data-delrule]');
        if (del){ S.importRules = S.importRules.filter(x => x.id !== del.dataset.delrule); logAudit('Удалено правило импорта', 'Настройки'); saveState(); toast('Правило удалено', 'ok'); APP.render(); }
      });
    }
    $$('#log-filters .chip', root).forEach(ch => ch.addEventListener('click', () => {
      $$('#log-filters .chip', root).forEach(x => x.classList.remove('on'));
      ch.classList.add('on');
      logFilter = ch.dataset.lf;
      applyLogFilter();
    }));

    const goBtn = root.querySelector('#rule-go');
    goBtn && (goBtn.onclick = ()=>{
      const text = root.querySelector('#rule-test').value;
      const entity = root.querySelector('#rule-entity').value;
      const out = root.querySelector('#rule-out'); out.hidden = false; out.innerHTML = '';
      let hits = 0;
      const ctx = entity === 'client'
        ? ruleContext('client', { ext: { comment: text, company: text }, full_name: text, email: text, phone: text }, null)
        : ruleContext('order', null, { comment: text, order_id: text, status: text, total: parseFloat(text) || 0 });
      applyRules(entity, ctx, entity==='client' ? { ext:{ comment:text, company:text } } : null, entity==='order' ? { comment:text, order_id:text, status:text, total:parseFloat(text)||0 } : null, n => {
        out.insertAdjacentHTML('beforeend', `<div class="rule">${esc(n)}</div>`); hits++;
      });
      if (!hits) out.innerHTML = '<div class="warn">Ни одно правило не сработало на этот текст</div>';
    });

  }

  function downloadText(name, content, mime='text/plain'){
    const blob = new Blob([content], { type:mime+';charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  }
  function exportPeople(role){
    const rows2 = [['ФИО','Email','Телефон','Статус'], ...noDemo(S.users.filter(x=>x.role===role)).map(x=>[x.full_name,x.email,x.phone,x.ext.status])];
    downloadText(`${role}s.csv`, '\ufeff'+rows2.map(r=>r.join(';')).join('\n'), 'text/csv');
    toast('CSV выгружен','ok');
  }

  /* ==================== КАЛЬКУЛЯТОР ==================== */
  function openCalculator({ onResult=null } = {}){
    const staffView = isStaff(me().role);
    const m = openModal({
      narrow:true, title:'Калькулятор услуг',
      body:`<div class="calc-display"><div class="expr" id="cx-expr">введите выражение с клавиатуры</div><div class="val" id="cx-val">0</div></div>
        <div class="field" style="margin-top:12px"><label>Выражение</label>
          <input class="input mono" id="cx-in" placeholder="например: 2.5 × 1800 + 5600" autocomplete="off" spellcheck="false">
          <div class="small faint">Поддерживаются + − × ÷ ( ) % и запятая как десятичный разделитель · Enter — в результат</div>
        </div>
        <div class="row" style="margin-top:10px"><span class="small muted" id="cx-live"></span><span class="spacer"></span>
          ${onResult?'<button class="btn btn--primary btn--sm" data-apply>Подставить в заказ</button>':''}</div>
        <div class="calc-history" id="cx-hist" style="margin-top:12px">${S.calcHistory.slice(-6).reverse().map(h=>`<div data-h="${h.result}">${esc(h.expression)} = ${h.result}</div>`).join('')}</div>
        <div class="small faint" style="margin-top:12px">Отметьте услуги — их стоимость прибавится к результату.</div>
        <div id="cx-svcs" style="margin-top:8px"></div>`,
      footer:`<button class="btn btn--ghost" data-x>Закрыть</button>${onResult?'<button class="btn btn--primary" data-apply2>Подставить</button>':''}`,
      onMount:(mask, close)=>{
        const g2 = s=>mask.querySelector(s);
        let val = 0;
        const compute = raw => {
          const js = String(raw).replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-').replace(/,/g,'.').replace(/\s+/g,'');
          if (!js) return null;
          if (!/^[-+*/().0-9\s%]*$/.test(js)) return NaN;
          try {
            const v = Function(`"use strict";return (${js.replace(/%/g,'/100*')})`)();
            return (typeof v === 'number' && isFinite(v)) ? v : NaN;
          } catch(e){ return NaN; }
        };
        const upd = ()=>{
          const raw = g2('#cx-in').value;
          const v = compute(raw);
          val = v;
          g2('#cx-val').textContent = isNaN(v) ? '—' : fmtMoney(v);
          g2('#cx-live').textContent = isNaN(v) ? (raw ? 'проверьте выражение' : '') : `= ${v}`;
          g2('#cx-expr').textContent = raw;
        };
        g2('#cx-in').addEventListener('input', upd);
        g2('#cx-in').addEventListener('keydown', e=>{
          if (e.key === 'Enter' && !isNaN(val) && val){
            S.calcHistory.push({ expression: g2('#cx-in').value, result:+val.toFixed(4) });
            S.calcHistory = S.calcHistory.slice(-20);
            g2('#cx-hist').insertAdjacentHTML('afterbegin', `<div data-h="${val}">${esc(g2('#cx-in').value)} = ${val}</div>`);
            saveState();
            if (onResult) { onResult(svcSum() + val); toast(`Подставлено: ${fmtMoney(svcSum() + val)}`, 'ok'); }
            g2('#cx-in').value = ''; upd();
          }
        });
        const svcSum = () => { let s = 0; mask.querySelectorAll('[data-sv]:checked').forEach(i=>s += +i.dataset.sv.split('|')[2]); return s; };
        g2('#cx-svcs').innerHTML = S.niches.map(n=>`
          <div class="small"><b style="margin-bottom:4px;display:block">${esc(n.name)}</b>
          ${(S.calcServices[n.id]||[]).map(s=>`<label class="svc-row check"><input type="checkbox" data-sv="${n.id}|${esc(s.name)}|${s.price}"><span class="box"><svg><use href="#i-check-c"/></svg></span><span style="flex:1">${esc(s.name)} <span class="faint">${esc(s.unit||'')}</span></span><b>${fmtMoney(s.price)}</b></label>`).join('')}</div>`).join('');
        g2('#cx-svcs').addEventListener('change', ()=>{ if (!isNaN(val)) g2('#cx-val').textContent = fmtMoney(val + svcSum()); });
        g2('#cx-hist').querySelectorAll('[data-h]').forEach(h=>h.onclick = ()=>{ g2('#cx-in').value = h.dataset.h; upd(); });
        mask.querySelector('[data-x]').onclick = close;
        const ap = mask.querySelector('[data-apply2]');
        if (ap) ap.onclick = ()=>{
          let sum = val + svcSum();
          if (!sum){ toast('Сначала введите выражение или выберите услуги','warn'); return; }
          onResult && onResult(sum);
          toast(`Подставлено: ${fmtMoney(sum)}`, 'ok');
          close();
        };
      }
    });
  }

  /* ==================== КАНБАН ==================== */
  function kanbanView(root){
    const u = me();
    const boards = S.kanbanBoards.filter(b=>b.type==='shared' || b.owner_id===u.id);
    let cur = boards[0]?.id;
    const render = ()=>{
      const b = S.kanbanBoards.find(x=>x.id===cur);
      const cards = noDemo(S.kbCards.filter(c=>c.board_id===cur));
      root.innerHTML = `
        <div class="page-head"><div><h2>Канбан-доски</h2><div class="sub">Перетаскивание карточек · связь со статусами заказов</div></div>
          <div class="page-actions"><button class="btn btn--primary" data-new>${icon('plus')} Карточка</button></div></div>
        <div class="tabs" style="margin-bottom:14px">${boards.map(x=>`<button class="tab ${x.id===cur?'on':''}" data-b="${x.id}">${esc(x.name)} <span class="badge c-gray">${x.type==='shared'?'общая':'личная'}</span></button>`).join('')}</div>
        <div class="kanban" id="kb">
          ${b.columns.map(col=>{
            const colCards = cards.filter(c=>c.column_id===col).sort((a,c)=>a.position-c.position);
            return `<div class="kb-col" data-col="${esc(col)}">
              <div class="kb-col__h">${esc(col)}<span class="cnt">${colCards.length}</span></div>
              ${colCards.map(c=>`<div class="kb-card" draggable="true" data-card="${c.id}">
                <b>${esc(c.title)}</b>
                ${c.order_id?`<span class="badge c-blue" style="margin-top:6px">${icon('orders','ico-sm')} ${esc(c.order_id)}</span>`:''}
                ${c.description?`<div class="d">${esc(c.description)}</div>`:''}
              </div>`).join('')}
            </div>`;
          }).join('')}
        </div>`;
      $$('[data-b]', root).forEach(t=>t.onclick=()=>{ cur=t.dataset.b; render(); });
      $$('[data-new]', root).forEach(b=>b.onclick=()=>{
        const cols = S.kanbanBoards.find(x=>x.id===cur)?.columns || [];
        openModal({ narrow:true, title:'Новая карточка',
          body:`<div class="stack" style="gap:12px">
            <div class="field"><label>Название *</label><input class="input" id="kc-title" placeholder="Что нужно сделать"></div>
            <div class="field"><label>Колонка</label><select class="input" id="kc-col">${cols.map(cn=>`<option>${esc(cn)}</option>`).join('')}</select></div>
            <div class="field"><label>Описание</label><textarea class="input" id="kc-desc" rows="2"></textarea></div>
          </div>`,
          footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-kc-save>Добавить</button>`,
          onMount:(m2,close)=>{
            m2.querySelector('[data-kc-save]').onclick = ()=>{
              const title = m2.querySelector('#kc-title').value.trim();
              if (!title){ toast('Введите название карточки','warn'); return; }
              S.kbCards.push({ id:uid(), board_id:cur, column_id:m2.querySelector('#kc-col').value, position:0, title, order_id:null, description:m2.querySelector('#kc-desc').value.trim() });
              logAudit('Карточка канбана: '+title, 'Канбан'); saveState(); close(); render(); toast('Карточка добавлена','ok');
            };
          } });
      });
      const kb = $('#kb', root);
      let dragged = null;
      kb.addEventListener('dragstart', e=>{
        const card = e.target.closest('.kb-card'); if (!card) return;
        dragged = card; card.classList.add('dragging');
      });
      kb.addEventListener('dragend', ()=>{ dragged && dragged.classList.remove('dragging'); $$('.kb-col', kb).forEach(c=>c.classList.remove('dropping')); $$('.kb-card', kb).forEach(c=>c.classList.remove('drag-over')); dragged=null; });
      $$('.kb-col', kb).forEach(col=>{
        col.addEventListener('dragover', e=>{ e.preventDefault(); col.classList.add('dropping'); });
        col.addEventListener('dragleave', ()=>col.classList.remove('dropping'));
        col.addEventListener('drop', e=>{
          e.preventDefault(); col.classList.remove('dropping');
          if (!dragged) return;
          const card = S.kbCards.find(c=>c.id===dragged.dataset.card);
          const toCol = col.dataset.col;
          if (card.column_id !== toCol){
            card.column_id = toCol;
            if (card.order_id){
              const o = S.orders.find(x=>x.order_id===card.order_id);
              const map = { 'Новые':'waiting','В работе':'work','На проверке':'revision','Готово':'done' };
              if (o && map[toCol] && o.status !== map[toCol]) setStatus(o, map[toCol], { silent:true });
            }
            saveState(); render();
            toast(`«${card.title}» → ${toCol}`, 'ok');
          }
        });
      });
    };
    render();
  }

  /* ==================== ТИКЕТЫ ==================== */
  function openTicket(orderRef){
    openModal({
      narrow:true, title:'Сообщить о проблеме',
      body:`<div class="stack" style="gap:12px">
        <div class="field"><label>Тема</label><input class="input" id="tk-sub" placeholder="Коротко о проблеме"></div>
        <div class="field"><label>Описание</label><textarea class="input" id="tk-msg" placeholder="Что случилось?"></textarea></div>
        ${orderRef?`<p class="small faint">Привязка к заказу: <b>${esc(orderRef)}</b></p>`:''}
      </div>`,
      footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-send>Отправить</button>`,
      onMount:(mask, close)=>{
        mask.querySelector('[data-x]').onclick = close;
        mask.querySelector('[data-send]').onclick = ()=>{
          const sub = mask.querySelector('#tk-sub').value.trim();
          if (!sub){ toast('Укажите тему','err'); return; }
          S.tickets.unshift({ id:uid(), user_id:me().id, order_id:orderRef||null, subject:sub, message:mask.querySelector('#tk-msg').value, status:'new', created_at:Date.now(), resolved_at:null });
          logAudit(`Создан тикет: ${sub}`, 'Тикет');
          saveState(); toast('Тикет создан — менеджеры увидят его в разделе «Тикеты»','ok');
          close(); APP.render();
        };
      }
    });
  }

  return { ordersView, openOrderForm, openOrderDetail, openCalculator, openTicket, orderContextMenu,
    peopleView, projectsView, toolsView, kanbanView, setStatus, payOrder, generateOrderId };
})();
