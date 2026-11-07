/* ============================================================
   Audiowizard Workspace — CRM: заказы, люди, проекты, канбан,
   импорт/экспорт, калькулятор
   ============================================================ */
'use strict';

const CRM = (() => {

  /* ==================== ЗАКАЗЫ ==================== */
  /* Групповое выделение персон (клиенты/исполнители): живущее на уровне модуля,
     т.к. personRow/personCard определяются вне peopleView. */
  const psel = new Set();
  /* Состояние drag-выделения таблиц/карточек. Живёт на уровне модуля, чтобы
     сбрасываться ОДНИМ постоянным обработчиком mouseup и по Esc.
     Раньше mouseup-слушатели вешались с {once:true}: после первого отпускания
     мыши они удалялись, drag-состояние больше не очищалось — и после Esc
     строки снова «сами» выделялись при движении мыши. */
  let dragSel = null, dragSelMoved = false;      /* заказы */
  let dragSelPl = null, dragSelPlMoved = false;  /* клиенты/исполнители */
  const clearDragSel = () => { dragSel = null; dragSelMoved = false; dragSelPl = null; dragSelPlMoved = false; };
  /* Постоянный сброс на отпускание мыши (без once — иначе работает один раз) */
  document.addEventListener('mouseup', clearDragSel);
  document.addEventListener('touchend', clearDragSel, { passive:true });
  document.addEventListener('dragend', clearDragSel);
  window.addEventListener('blur', clearDragSel);
  /* Esc снимает выделение во всех таблицах (если оно есть) */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const had = !!document.querySelector('.row-sel:checked');
    /* Всегда отпускаем drag-выделение, даже если галочки уже сняты */
    clearDragSel();
    if (!had) return;
    e.preventDefault(); e.stopPropagation();
    try { CRM._ordersSelClear && CRM._ordersSelClear(); } catch(err){}
    try { CRM._peopleSelClear && CRM._peopleSelClear(); } catch(err){}
  });
  /* Тарифы SaaS: «ИИ», «ИИ + человек», «Человек» */
  const TARIFFS = [
    { id:'ai',       label:'ИИ' },
    { id:'ai_human', label:'ИИ + человек' },
    { id:'human',    label:'Человек' }
  ];
  const tariffLabel = id => (TARIFFS.find(t => t.id === id) || {}).label || '';
  const tariffChip = id => id ? `<span class="badge badge--outline tariff-chip tariff-chip--${esc(id)}">${esc(tariffLabel(id))}</span>` : '';

  const canStatus = (from, to, user) => {
    if (from === to) return { ok:false, why:'Статус не изменён' };
    if (to === 'waiting'){
      return from === 'draft'
        ? { ok:true }
        : { ok:false, why:'Вернуть заказ в «В ожидании» можно только из «Черновика»' };
    }
    return { ok:true };
  };

  function orderTotalAudio(o){ return o.audio || (o.files||[]).reduce((a,f)=>a+(f.duration||0),0); }

  function applyAccrual(o, sign){
    /* Доли считает Finance: исполнители, админ (маржа) и менеджер заказа.
       Старая логика умела только исполнителей — из-за этого баланс админа
       и менеджеров не менялся. */
    if (window.Finance){ Finance.accrue(o, sign); }
    else {
      o.executors.forEach(e=>{
        const u = userById(e.uid);
        if (u && u.ext) u.ext.earned = Math.max(0, (u.ext.earned||0) + sign * (e.amount||0));
        if (sign < 0) e.is_paid = false;
      });
    }
    if (sign > 0 && o.status==='done' && o.executors.length && !o._accrued) o._accrued = true;
  }

  /* Доли заказа для предупреждения о превышении бюджета. */
  function orderSplit(o){
    return window.Finance ? Finance.split(o) : null;
  }

  /* ---------- Инлайн-редактирование по клику ----------
     Заменяет содержимое элемента на input/select, сохраняет по Enter/blur,
     отменяет по Esc. Без модальных окон: данные правятся прямо в списке. */
  let __crmInline = null;
  function inlineField(el, { value, type='text', options=null, placeholder='', wide=false, onSave }){
    if (!el) return;
    if (__crmInline){ try { __crmInline.cancel(); } catch(e){} }
    const prev = el.innerHTML;
    const inp = document.createElement(type === 'select' ? 'select' : 'input');
    inp.className = 'input inline-input' + (wide ? ' inline-input--wide' : '');
    if (type === 'select'){
      (options||[]).forEach(o=>{ const op=document.createElement('option'); op.value=o.value; op.textContent=o.label; inp.appendChild(op); });
      inp.value = value==null ? '' : String(value);
    } else {
      inp.type = type;
      inp.value = value==null ? '' : String(value);
      if (placeholder) inp.placeholder = placeholder;
    }
    const initial = inp.value;
    el.innerHTML = '';
    el.appendChild(inp);
    el.classList.add('inline-editing');
    inp.focus();
    if (inp.select) { try { inp.select(); } catch(e){} }
    let done = false;
    const finish = (save)=>{
      if (done) return; done = true;
      const val = inp.value;
      el.classList.remove('inline-editing');
      el.innerHTML = prev;
      __crmInline = null;
      if (save && onSave && val !== initial) onSave(val);
    };
    inp.addEventListener('keydown', e=>{
      if (e.key === 'Escape'){ e.preventDefault(); finish(false); }
      else if (e.key === 'Enter'){ e.preventDefault(); finish(true); }
    });
    inp.addEventListener('blur', ()=>finish(true));
    if (type === 'select') inp.addEventListener('change', ()=>finish(true));
    __crmInline = { cancel: ()=>finish(false), el };
  }
  /* Даты в инлайне вводим обычным текстом «дд.мм.гггг»: нативный input[type=date]
     сегментный, и при клике в центр фокус попадает в год — цифры дописываются
     в него, не давая нормально набрать дату. */
  function dateText(ts){
    if (!ts) return '';
    const d = new Date(ts);
    return String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + d.getFullYear();
  }
  function parseDateText(v, keepTs){
    const s = String(v||'').trim();
    if (!s) return null;
    let m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})$/);
    let y, mo, d;
    if (m){ d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
    else if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))){ y = +m[1]; mo = +m[2]; d = +m[3]; }
    else return null;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    /* Сохраняем время суток исходной даты: правка дня не должна менять 00:00 на полдень */
    if (keepTs){
      const b = new Date(keepTs);
      dt.setHours(b.getHours(), b.getMinutes(), 0, 0);
    }
    return dt.getTime();
  }

  /* Мультивыбор без модалки: поповер с поиском и чекбоксами (клиенты,
     исполнители). Живёт поверх страницы, чтобы не обрезался скроллом таблицы. */
  function inlinePicker(el, { items, selected, onSave, placeholder='Поиск…', single=false }){
    if (!el) return;
    if (__crmInline){ try { __crmInline.cancel(); } catch(e){} }
    const chosen = new Set(selected || []);
    const box = document.createElement('div');
    box.className = 'inline-pick' + (single ? ' inline-pick--single' : '');
    let picked = single ? (chosen.size ? [...chosen][0] : '') : null;
    const rows = single
      ? ((items||[]).map(it=>`<button type="button" class="inline-pick__row inline-pick__row--opt${chosen.has(it.value)?' on':''}" data-v="${esc(it.value)}"><span>${esc(it.label)}</span>${icon('check','ico-sm')}</button>`).join('')
        || '<div class="small faint" style="padding:6px 8px">Ничего нет</div>')
      : ((items||[]).map(it=>`<label class="inline-pick__row"><input type="checkbox" value="${esc(it.value)}" ${chosen.has(it.value)?'checked':''}><span>${esc(it.label)}</span></label>`).join('')
        || '<div class="small faint" style="padding:6px 8px">Ничего нет</div>');
    box.innerHTML = (single ? '' : `<input class="input inline-pick__search" placeholder="${esc(placeholder)}" autocomplete="off">`)
      + `<div class="inline-pick__list">${rows}</div>`
      + (single ? '' : `<div class="row" style="gap:6px;justify-content:flex-end;margin-top:6px">
        <button type="button" class="btn btn--ghost btn--sm" data-pick-cancel>Отмена</button>
        <button type="button" class="btn btn--primary btn--sm" data-pick-ok>Готово</button>
      </div>`);
    const r = el.getBoundingClientRect();
    const bw = single ? 240 : 300;
    const bh = Math.min(box.offsetHeight || (single ? 210 : 300), innerHeight - 16);
    box.style.top = Math.max(8, Math.min(r.bottom + 4, innerHeight - bh - 12)) + 'px';
    box.style.left = Math.max(8, Math.min(r.left, innerWidth - bw - 8)) + 'px';
    document.body.appendChild(box);
    el.classList.add('inline-editing');
    const q = box.querySelector('.inline-pick__search');
    const list = box.querySelector('.inline-pick__list');
    if (q){
      q.focus();
      q.addEventListener('input', ()=>{
        const t = q.value.trim().toLowerCase();
        list.querySelectorAll('.inline-pick__row').forEach(row=>{
          row.style.display = !t || row.textContent.toLowerCase().includes(t) ? '' : 'none';
        });
      });
    }
    let done = false;
    /* Плашка не исчезает рывком: сначала короткое затухание, потом remove */
    const drop = ()=>{
      if (box.classList.contains('pick-out')) return;
      box.classList.add('pick-out');
      setTimeout(()=>box.remove(), 150);
    };
    const finish = (save)=>{
      if (done) return; done = true;
      document.removeEventListener('mousedown', onDoc, true);
      if (save && onSave){
        const vals = single ? (picked ? [picked] : []) : [...box.querySelectorAll('.inline-pick__list input:checked')].map(i=>i.value);
        if (!single || vals.length) onSave(vals);
      }
      drop();
      el.classList.remove('inline-editing');
      __crmInline = null;
    };
    const onDoc = e=>{
      if (box.contains(e.target)) return;
      /* Повторный клик по той же ячейке — это «закрыть», а не «переоткрыть»:
         закрываем плашку и гасим следующий клик по ячейке. */
      if (el === e.target || el.contains(e.target)){
        window.__inlineToggleAt = Date.now();
        finish(false);
        return;
      }
      finish(true);
    };
    box.addEventListener('click', e=>{
      e.stopPropagation();
      if (!single) return;
      const opt = e.target.closest('.inline-pick__row--opt');
      if (!opt) return;
      picked = opt.dataset.v;
      list.querySelectorAll('.inline-pick__row--opt').forEach(b=>b.classList.toggle('on', b === opt));
      setTimeout(()=>finish(true), 90);
    });
    const okBtn = box.querySelector('[data-pick-ok]');
    const cancelBtn = box.querySelector('[data-pick-cancel]');
    if (okBtn) okBtn.addEventListener('click', e=>{ e.stopPropagation(); finish(true); });
    if (cancelBtn) cancelBtn.addEventListener('click', e=>{ e.stopPropagation(); finish(false); });
    box.addEventListener('keydown', e=>{
      if (e.key === 'Escape'){ e.preventDefault(); finish(false); }
      else if (e.key === 'Enter' && e.target.tagName !== 'INPUT'){ e.preventDefault(); finish(true); }
    });
    setTimeout(()=>{ if (!done) document.addEventListener('mousedown', onDoc, true); }, 0);
    __crmInline = { cancel: ()=>finish(false), el };
  }

  /* После сохранения инлайна не перерисовываем список сразу: иначе клик по
     соседней ячейке приходит в уже удалённый DOM и второй редактор не
     открывается. Ждём, пока закроется активный редактор, и обновляем вид. */
  function inlineRefresh(renderFn){
    let tries = 0;
    const tick = ()=>{
      if (__crmInline && tries++ < 120){ setTimeout(tick, 120); return; }
      renderFn();
    };
    setTimeout(tick, 0);
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
      /* Превышение бюджета: исполнители + менеджер + маржа админа больше суммы
         заказа. Показываем дефицит и требуем осознанное подтверждение. */
      const sp = orderSplit(o);
      if (sp && sp.over > 0){
        const proceed = await confirmModal({
          title:'Бюджет заказа превышен', danger:true, okText:'Всё равно выполнить',
          text:`Исполнителям ${fmtMoney(sp.exec)} + админу ${fmtMoney(sp.admin)} + менеджеру ${fmtMoney(sp.manager)} = ${fmtMoney(sp.exec + sp.admin + sp.manager)} при сумме заказа ${fmtMoney(sp.total)}. Не хватает ${fmtMoney(sp.over)}.`,
          checkbox:'Понимаю, что затраты превышают сумму заказа'
        });
        if (!proceed) return false;
        try {
          const adm = (S.users || []).find(x => x.role === 'admin');
          S.notifs.unshift({ id:uid(), icon:'i-card', title:'Превышение бюджета заказа',
            text:`${o.order_id}: доли ${fmtMoney(sp.exec + sp.admin + sp.manager)} при сумме ${fmtMoney(sp.total)}, дефицит ${fmtMoney(sp.over)}.`,
            t:Date.now(), read:{}, owner_id: adm ? adm.id : null });
        } catch(e){}
      }
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
    if (to === 'done' && !o._accrued){
      applyAccrual(o, +1);
      o.done_at = Date.now();
      o.history.push({t:Date.now(), txt:'Начислен заработок исполнителям, менеджеру и маржа админу'});
    }
    if (to !== 'done') o.done_at = null;
    /* Реферальная программа: процент пригласившему за выполненный заказ */
    if (to === 'done'){
      try {
        const rec = accrueReferral(o);
        if (rec && rec.amount > 0){
          const ref = userById(rec.referrerId);
          if (ref){
            S.notifs = S.notifs || [];
            S.notifs.unshift({ id:uid(), icon:'i-card', title:'Реферальное начисление',
              text:`${fmtMoney(rec.amount)} за заказ ${o.order_id} (${rec.percent}% от ${fmtMoney(rec.base)}${(rec.first && Number(refConfig().fixedBonus)) ? ' + бонус за первый заказ' : ''})`,
              t:Date.now(), read:{}, owner_id: ref.id });
            saveState();
          }
        }
      } catch(e){ console.error(e); }
    }
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

  /* Номер заказа — только латиница: кириллические двойники переводим
     в латиницу, остальные недопустимые символы убираем. */
  const CYR_ID_MAP = { 'А':'A','В':'B','С':'C','Е':'E','Н':'H','К':'K','М':'M','О':'O','Р':'P','Т':'T','Х':'X','У':'Y' };
  /* live=true — фильтр «по мере набора»: дефис в конце не срезаем, иначе
     набрать «AW-1042» невозможно (дефис исчезал сразу после ввода).
     Полная зачистка краёв — только при сохранении. */
  function sanitizeOrderId(v, live){
    const s = String(v || '')
      .toUpperCase()
      .split('')
      .map(ch => CYR_ID_MAP[ch] || ch)
      .join('')
      .replace(/[^A-Z0-9-]/g, '')
      .replace(/-{2,}/g, '-');
    return live ? s : s.replace(/^-+|-+$/g, '');
  }

  /* Проверка уникальности ID на лету: возвращает заказ-дубль или null.
     ignoreId — сам редактируемый заказ, чтобы он не считался своим дублем. */
  function orderIdTaken(v, ignoreId){
    const id = sanitizeOrderId(v);
    if (!id) return null;
    return S.orders.find(x => x.order_id === id && x.id !== ignoreId) || null;
  }

  /* Подсветка поля ID: красная рамка и подсказка, пока номер занят */
  function markOrderIdField(input, hint, ignoreId){
    if (!input) return null;
    const check = ()=>{
      const dup = orderIdTaken(input.value, ignoreId);
      input.classList.toggle('is-bad', !!dup);
      input.setAttribute('aria-invalid', dup ? 'true' : 'false');
      if (hint){
        if (dup){
          hint.textContent = `ID ${dup.order_id} уже занят — выберите другой`;
          hint.style.color = 'var(--red)';
          hint.hidden = false;
        } else {
          const def = hint.dataset.empty || '';
          hint.textContent = def;
          hint.style.color = '';
          hint.hidden = !def;
        }
      }
      return dup;
    };
    input.addEventListener('input', check);
    input.addEventListener('blur', check);
    check();
    return check;
  }

  /* ---------- Таблица заказов ---------- */
  const ofilter = { q:'', statuses:new Set(), niche:'', project:'', manager:'', archived:false, debt:false,
    dateFrom:'', dateTo:'', sortKey:'start_date', sortDir:1 };
    const iso2ru = iso => { if (!iso) return ''; const [y,m,d] = iso.split('-'); return d+'.'+m+'.'+y; };
    const ru2iso = s => {
      s = (s||'').trim(); if (!s) return '';
      let m;
      if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) return m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
      if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
      if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/))) return '20'+m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
      return null;
    };

  /* ---------- Таблица заказов: skeleton + прогрессивная подгрузка ---------- */
  const O_CHUNK = 80;

  /* Окно — самостоятельный экземпляр: его фильтры/поиск не должны
     менять состояние раздела на странице. Ключ — сам контейнер root. */
  const oFilterFor = (root)=>{
    if (root && root.closest && root.closest('.aw-win')){
      if (!root.__oFilter) root.__oFilter = { q:'', statuses:new Set(), niche:'', project:'', manager:'', archived:false, dateFrom:'', dateTo:'', sortKey:'start_date', sortDir:1 };
      return root.__oFilter;
    }
    return ofilter;
  };

  function ordersView(root){
    const ofilter = oFilterFor(root);
    const u = me();
    const staff = isStaff(u.role);
    const all = ordersFor(u);
    let list = [];
    let shown = Math.min(window.__ordersShownMem || O_CHUNK, 100000);
    let tblScrollX = window.__ordersTblScrollX || 0;
    let sel = new Set();
    let lastSelSel = null; /* последний чекбокс для Shift-диапазона */
    let io = null;
    let firstEntry = true;
    /* Базовый список для «Всего заказов»: как и строки, учитывает переключатель
       «Архив», но НЕ остальные фильтры (поиск/статус/менеджер/даты). Раньше тут
       стоял noDemo(S.orders) целиком — при выключенном «Архив» счётчик показывал
       больше, чем «из N» в строке («Всего заказов: 1536 … показано 80 из 1534»). */
    const totalBase = () => noDemo(S.orders).filter(o => ofilter.archived ? o.status === 'archived' : o.status !== 'archived');

    function computeList(){
      const arr = all.filter(o => {
        if (!ofilter.archived && o.status === 'archived') return false;
        if (ofilter.archived && o.status !== 'archived') return false;
        if (ofilter.manager && o.manager_id !== ofilter.manager) return false;
        if (ofilter.statuses.size && !ofilter.statuses.has(o.status)) return false;
        /* Долги: выполненные заказы, где не закрыты доли исполнителей/менеджеров */
        if (ofilter.debt && !(window.Finance && Finance.hasDebt(o))) return false;
        if (ofilter.niche && o.nish_id !== ofilter.niche) return false;
        if (ofilter.project && o.project_id !== ofilter.project) return false;
        /* Диапазон дат (по дате начала заказа) */
        if (ofilter.dateFrom || ofilter.dateTo){
          const d = o.start_date || o.order_date || o.created_at;
          if (!d) return false;
          if (ofilter.dateFrom && d < new Date(new Date(ofilter.dateFrom).setHours(0,0,0,0)).getTime()) return false;
          if (ofilter.dateTo && d > new Date(new Date(ofilter.dateTo).setHours(23,59,59,999)).getTime()) return false;
        }
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
        if (k === 'order_id'){ va = a.order_id || ''; vb = b.order_id || ''; return String(va).localeCompare(String(vb)) * d; }
        else if (k === 'start_date'){ va = a.start_date || a.order_date || 0; vb = b.start_date || b.order_date || 0; }
        else if (k === 'deadline'){ va = a.deadline || Infinity; vb = b.deadline || Infinity; }
        else if (k === 'total'){ va = a.total; vb = b.total; }
        else if (k === 'client'){ va = (clientById(a.client_id)||{}).full_name || ''; vb = (clientById(b.client_id)||{}).full_name || ''; return va.localeCompare(vb) * d; }
        else { va = a.created_at; vb = b.created_at; }
        return (va > vb ? 1 : va < vb ? -1 : 0) * d;
      });
      return arr;
    }

    /* Долг по заказу — маленький маркер у суммы вместо отдельной колонки.
       Показывается только там, где есть неоплаченные доли исполнителей
       или менеджера по выполненному заказу. */
    function debtMark(o){
      if (!window.Finance) return '';
      const d = Finance.debts(o);
      if (!d.total) return '';
      const parts = [];
      if (d.exec) parts.push(`исполнителям ${fmtMoney(d.exec)}`);
      if (d.manager) parts.push(`менеджеру ${fmtMoney(d.manager)}`);
      const tip = `Не оплачено ${fmtMoney(d.total)}: ${parts.join(', ')}`;
      return `<span class="o-debt" title="${esc(tip)}" aria-label="${esc(tip)}">₽</span>`;
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
          <span class="o-head-total">${fmtMoney(o.total)}</span>
          <svg class="ico ico-sm o-head-arrow"><use href="#i-chev-r"/></svg>
        </td>
        <td data-l="Заказ" class="o-main">
          <span class="order-id" data-copy="${o.order_id}" title="Скопировать ID">${o.order_id}</span>
          <div class="cell-sub o-ell"><span data-inline="niche">${nicheChip(o.nish_id)}</span>${o.project_id ? ' · <span data-inline="project">' + esc((S.projects.find(p=>p.id===o.project_id)||{}).name || '') + '</span>' : ' · <span data-inline="project" class="faint">+ проект</span>'}</div>
        </td>
        <td data-l="Клиент" data-inline="client"><span class="cell-main o-ell" title="${esc(clList.map(x=>x.full_name).join(', '))}">${clList.length ? esc(clList.map(x=>x.full_name).join(', ')) : '—'}</span></td>
        <td data-l="Исполнители" class="o-ex" data-inline="executors">${exShow.length ? `<span class="ex-stack" title="${esc(exTitle)}">${exShow.map(e=>avatarHTML(e,'avatar--sm ex-av')).join('')}${exRest>0?`<span class="ex-more">+${exRest}</span>`:''}</span>` : '<span class="faint">—</span>'}</td>
        <td data-l="Начало" class="deadline-cell" data-inline="start">${start?fmtDT(start):'—'}</td>
        <td data-l="Дедлайн" class="deadline-cell ${dlCls}" data-inline="deadline">${dl?fmtDT(dl):'—'}</td>
        <td data-l="Итого" class="pay-cell" data-inline="total">${fmtMoney(o.total)}${debtMark(o)}</td>
        <td data-l="Статус" data-inline="status">${statusChip(o.status)}</td>
        <td data-l="" class="o-act">${staff?`<button class="iconbtn row-menu" data-oid="${o.id}" title="Действия">${icon('more')}</button>`:''}</td>
      </tr>`;
    }
    function render(useSkeleton){
      const flip0 = flipSnap(root);
      /* Перерисовка root пересоздаёт поле поиска. Запоминаем фокус и каретку,
         чтобы ввод не сбрасывался по мере набора. */
      const ae = document.activeElement;
      const keep = (ae && (ae.id === 'f-q' || ae.id === 'f-from' || ae.id === 'f-to')) ? { s:ae.selectionStart, e:ae.selectionEnd, id:ae.id } : null;
      list = computeList();
      const cardsView = (S.settings.ordersView || 'table') === 'cards';
      /* Скелетон не показываем: контент рендерится из localStorage мгновенно.
         Даже при большом списке строки подставляются сразу (порциями для плавности). */
      root.innerHTML = `
        <div class="page-head">
          <div><h2>Заказы</h2><div class="sub" id="o-count">Всего заказов: ${noDemo(S.orders).filter(o => ofilter.archived ? o.status === 'archived' : o.status !== 'archived').length} · на сумму ${fmtMoney(noDemo(S.orders).filter(o => ofilter.archived ? o.status === 'archived' : o.status !== 'archived').reduce((a,o)=>a+o.total,0))}</div></div>
          <div class="page-actions">
            <div class="seg view-seg" id="o-view">
              <button data-view="table" class="${cardsView?'':'on'}" title="Таблица" aria-label="Таблица">${icon('table','ico-sm')}</button>
              <button data-view="cards" class="${cardsView?'on':''}" title="Карточки" aria-label="Карточки">${icon('cards-view','ico-sm')}</button>
            </div>
            <button class="btn btn--ghost" id="btn-tools">${icon('import')} Импорт / экспорт</button>
            ${staff?`<button class="btn btn--soft" id="btn-inline-order" title="Добавить ${cardsView?'карточку':'строку'} прямо в список">${icon('plus')} <span class="inline-add-label">${cardsView?'Карточка':'Строка'}</span></button>`:''}
            ${staff?`<button class="btn btn--primary" id="btn-new-order">${icon('plus')} Новый заказ</button>`:''}
          </div>
        </div>
        <div id="o-bulk"></div>
        <div class="inline-add" id="o-inline" hidden>
          <div class="inline-add__row">
            <input class="input" data-f="id" placeholder="ID (пусто = авто AW-N)" style="font-family:var(--mono);max-width:150px">
            <input class="input" data-f="client" placeholder="Клиент (ФИО/название)" style="min-width:170px">
            <input class="input" data-f="total" placeholder="Сумма, ₽" type="number" min="0" style="max-width:120px">
            <input class="input" data-f="start" type="date" title="Начало (по умолчанию сегодня)" style="max-width:150px" value="${new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10)}">
            <input class="input" data-f="deadline" placeholder="дд.мм.гггг" title="Дедлайн" style="max-width:150px"${window.matchMedia && window.matchMedia('(max-width:960px)').matches ? ' type="date"' : ''}>
            <button class="btn btn--primary btn--sm" type="button" data-inline-save title="Создать заказ">${icon('check-c','ico-sm')}</button>
            <button class="iconbtn" type="button" data-inline-cancel title="Отмена">${icon('x','ico-sm')}</button>
          </div>
          <div class="small faint" data-inline-hint>ID сгенерируется автоматически, если оставить поле пустым</div>
        </div>
        <p class="small faint" style="margin:0 0 8px">Правый клик по строке — контекстное меню · двойной клик — карточка заказа</p>
        <div class="filters">
          <div class="input-wrap">${icon('search')}<input class="input" id="f-q" placeholder="Поиск: ID, клиент, комментарий…" value="${esc(ofilter.q)}"></div>
        <select class="input" id="f-manager" style="width:auto;min-width:150px"><option value="">Все менеджеры</option>${S.users.filter(x=>isStaff(x.role)).map(x=>`<option value="${x.id}" ${ofilter.manager===x.id?'selected':''}>${esc(x.full_name)}</option>`).join('')}</select>
          <select class="input" id="f-niche"><option value="">Все ниши</option>${S.niches.map(n=>`<option value="${n.id}" ${ofilter.niche===n.id?'selected':''}>${esc(n.name)}</option>`).join('')}</select>
          <select class="input" id="f-project"><option value="">Все проекты</option>${S.projects.map(p=>`<option value="${p.id}" ${ofilter.project===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
          <label class="small faint" style="display:inline-flex;align-items:center;gap:6px">с
            <input class="input input--date" type="date" id="f-from" value="${ofilter.dateFrom||''}" title="Начало периода" style="width:auto;max-width:150px"> по
            <input class="input input--date" type="date" id="f-to" value="${ofilter.dateTo||''}" title="Конец периода" style="width:auto;max-width:150px"></label>
          <label class="chip ${ofilter.archived?'on':''}" id="f-arch" style="cursor:pointer">${icon('archive','ico-sm')} Архив</label>
        </div>
        <div class="filters" style="margin-top:-4px">
          <div class="chips" id="f-status">
            ${Object.entries(STATUS_META).filter(([st])=>st!=='archived'||ofilter.archived).map(([st,m])=>`<span class="chip ${ofilter.statuses.has(st)?'on':''}" data-st="${st}">${m.label}</span>`).join('')}
            <span class="chip chip--debt ${ofilter.debt?'on':''}" id="f-debt" title="Выполненные заказы с неоплаченными долями">${icon('card','ico-sm')} Долги</span>
          </div>
        </div>
        <div class="tbl-wrap o-wrap ${cardsView?'o-wrap--cards':''}" style="border-radius:var(--r-lg)">
          <div id="o-rows"></div>
          <button class="o-to-top" type="button" hidden aria-label="Наверх">${icon('chev-d')}</button>
        </div>
`;

      bindControls();
      bindTable();
      fillRows(0);
      updateBulk();
      { const otbl = root.querySelector('.o-tbl'); if (otbl && window.Cols) Cols.init(otbl, 'orders'); }
      flipPlay(root, flip0);
      if (keep){
        const q2 = root.querySelector('#'+keep.id);
        if (q2){ q2.focus(); try { if (typeof q2.setSelectionRange === 'function') q2.setSelectionRange(keep.s, keep.e); } catch(e){} }
      }
      requestAnimationFrame(()=>{ const tw = root.querySelector('.tbl-wrap'); if (tw){ tw.scrollLeft = tblScrollX; tw.addEventListener('scroll', ()=>{ window.__ordersTblScrollX = tw.scrollLeft; }, { passive:true }); } });
    }

    function updateCount(){
      const el = root.querySelector('#o-count');
      if (!el) return;
      const base = totalBase();
      el.textContent = list.length
        ? `Всего заказов: ${base.length} · на сумму ${fmtMoney(base.reduce((a,o)=>a+o.total,0))} · показано ${Math.min(shown, list.length)} из ${list.length}`
        : 'Заказов пока нет';
    }

    function fillRows(startIdx){
      const host = root.querySelector('#o-rows');
      if (!host) return;
      const cards = (S.settings.ordersView || 'table') === 'cards';
      if (startIdx === 0){
        host.innerHTML = cards
          ? '<div class="o-cards"></div>'
          : `<table class="tbl o-tbl"><thead><tr>
               <th style="width:34px">${staff||u.role==='client'?`<input type="checkbox" id="sel-all" title="Выбрать все" aria-label="Выбрать все">`:''}</th>
               <th class="sortable${ofilter.sortKey==='order_id'?' sort-on':''}${ofilter.sortKey==='order_id'&&ofilter.sortDir<0?' sort-desc':''}" data-sort="order_id">Заказ</th>
               <th class="sortable${ofilter.sortKey==='client'?' sort-on':''}${ofilter.sortKey==='client'&&ofilter.sortDir<0?' sort-desc':''}" data-sort="client">Клиент</th><th>Исполнители</th>
               <th class="sortable${ofilter.sortKey==='start_date'?' sort-on':''}${ofilter.sortKey==='start_date'&&ofilter.sortDir<0?' sort-desc':''}" data-sort="start_date">Начало</th>
               <th class="sortable${ofilter.sortKey==='deadline'?' sort-on':''}${ofilter.sortKey==='deadline'&&ofilter.sortDir<0?' sort-desc':''}" data-sort="deadline">Дедлайн</th>
               <th class="sortable${ofilter.sortKey==='total'?' sort-on':''}${ofilter.sortKey==='total'&&ofilter.sortDir<0?' sort-desc':''}" data-sort="total">Итого</th><th>Статус</th>
               <th style="width:44px"></th>
             </tr></thead><tbody></tbody></table>`;
        if (io){ io.disconnect(); io = null; }
      }
      const end = Math.min(startIdx + O_CHUNK, list.length);
      const docs = list.slice(startIdx, end).map(cards ? cardHTML : rowHTML).join('');
      const target = cards ? host.querySelector('.o-cards') : host.querySelector('tbody');
      if (target) target.insertAdjacentHTML('beforeend', docs);
      shown = end;
      window.__ordersShownMem = shown;
      const oldSent = root.querySelector('#o-sentinel');
      oldSent && oldSent.remove();
      if (end < list.length){
        host.insertAdjacentHTML('beforeend', `<div id="o-sentinel" class="faint" style="text-align:center;padding:10px">${icon('refresh','ico-sm spin')} Подгружаем ещё заказы…</div>`);
        const sent = root.querySelector('#o-sentinel');
        io = new IntersectionObserver(entries => {
          if (entries.some(e => e.isIntersecting)){ io.disconnect(); io = null; fillRows(end); }
        }, { root: root.querySelector('.tbl-wrap'), rootMargin: '140px' });
        io.observe(sent);
      }
      updateCount();
      const wrap = root.querySelector('.tbl-wrap');
      if (wrap) requestAnimationFrame(() => { wrap.scrollTop = +(localStorage.getItem('ordersScrollTop') || 0); });
    }

    function cardHTML(o){
      const clList = clientsOf(o);
      const cl = clList[0] || {};
      const dl = o.deadline;
      const dlCls = !dl ? '' : (dl < Date.now() && !['done','archived'].includes(o.status) ? 'overdue' : (dl - Date.now() < DAY && o.status === 'work' ? 'today' : ''));
      const start = o.start_date || o.order_date;
      const exs = o.executors.map(e => userById(e.uid)).filter(Boolean);
      const exShow = exs.slice(0, 3);
      const exRest = exs.length - exShow.length;
      const exTitle = exs.map(e => { const t = o.executors.find(x => x.uid === e.id); return `${e.full_name}${t && t.amount ? ' — ' + fmtMoney(t.amount) : ''}`; }).join('\n');
      const clName = cl.full_name ? esc(cl.full_name) : '<span class="faint">—</span>';
      return `<div class="o-card ${STATUS_META[o.status].row}" data-oid="${o.id}" data-ctx="order">
        <div class="o-card__top">
          ${staff||u.role==='client'?`<input type="checkbox" class="row-sel" value="${o.id}" ${sel.has(o.id)?'checked':''} aria-label="Выбрать ${o.order_id}">`:''}
          <span class="order-id" data-copy="${o.order_id}" title="Скопировать ID">${o.order_id}</span>
          <span class="spacer"></span>
          <span data-inline="status">${statusChip(o.status)}</span>
        </div>
        <div class="o-card__client" data-inline="client">${clName}</div>
        <div class="o-card__sub"><span data-inline="niche">${nicheChip(o.nish_id)}</span> <span data-inline="tariff">${o.tariff ? tariffChip(o.tariff) : '<span class="faint">+ тариф</span>'}</span>${o.project_id ? ' · <span data-inline="project">' + esc((S.projects.find(p=>p.id===o.project_id)||{}).name || '') + '</span>' : ' · <span data-inline="project" class="faint">+ проект</span>'}</div>
        <div class="o-card__meta">
          <span title="Начало" data-inline="start">${icon('clock','ico-sm')} ${start?fmtDT(start):'—'}</span>
          <span class="${dlCls}" title="Дедлайн" data-inline="deadline">${icon('calendar','ico-sm')} ${dl?fmtDT(dl):'—'}</span>
          <span title="Исполнители">${exShow.length?icon('users','ico-sm')+' '+exShow.length+(exRest?`+${exRest}`:''):''}</span>
        </div>
        <div class="o-card__foot"><b class="mono" data-inline="total">${fmtMoney(o.total)}</b>${debtMark(o)}
          <span class="o-card__audio">${orderTotalAudio(o)?icon('play','ico-sm')+' '+fmtDur(orderTotalAudio(o)):''}</span>
        </div>
      </div>`;
    }

    /* Инлайн-правка данных заказа прямо в списке: без модалки, без ухода
       со страницы. Сложные поля (клиенты, исполнители) — поповер с поиском. */
    function openOrderInline(el){
      if (!staff) return;
      const host = el.closest('[data-ctx="order"]');
      const o = S.orders.find(x => x.id === host.dataset.oid);
      /* Демо-заказы тоже правим: на них и показывают возможности приложения.
         Правки ложатся в localStorage так же, как у обычных записей. */
      if (!o) return;
      const f = el.dataset.inline;
      const done = msg => { saveState(); try { logAudit(msg, 'Заказы'); } catch(e){} inlineRefresh(() => render(false)); };
      if (f === 'client'){
        inlinePicker(el, {
          items: S.users.filter(x => x.role === 'client').map(c => ({ value:c.id, label:c.full_name })),
          selected: (o.client_ids && o.client_ids.length ? o.client_ids : [o.client_id]).filter(Boolean),
          placeholder: 'Найти клиента…',
          onSave: ids => {
            if (!ids.length){ toast('У заказа должен остаться хотя бы один клиент', 'err'); return; }
            o.client_ids = ids; o.client_id = ids[0];
            done('Клиенты заказа ' + o.order_id + ' изменены');
          }
        });
        return;
      }
      if (f === 'executors'){
        inlinePicker(el, {
          items: S.users.filter(x => x.role === 'executor').map(c => ({ value:c.id, label:c.full_name })),
          selected: (o.executors||[]).map(e => e.uid),
          placeholder: 'Найти исполнителя…',
          onSave: ids => {
            const prev = new Map((o.executors||[]).map(e => [e.uid, e]));
            o.executors = ids.map(uid => prev.get(uid) || { uid, amount:0, is_paid:false });
            done('Исполнители заказа ' + o.order_id + ' изменены');
          }
        });
        return;
      }
      if (f === 'niche'){
        inlineField(el, { type:'select', value:o.nish_id, options:[{value:'', label:'— без ниши —'}].concat(S.niches.map(n => ({ value:n.id, label:n.name }))), onSave:v => {
          if (v === o.nish_id) return;
          o.nish_id = v; done('Ниша заказа ' + o.order_id + ' изменена');
        }});
        return;
      }
      if (f === 'tariff'){
        inlineField(el, { type:'select', value:o.tariff, options:[{value:'', label:'— без тарифа —'}].concat(TARIFFS.map(t => ({ value:t.id, label:t.label }))), onSave:v => {
          if (v === (o.tariff||'')) return;
          o.tariff = v; done('Тариф заказа ' + o.order_id + ' изменён');
        }});
        return;
      }
      if (f === 'project'){
        inlineField(el, { type:'select', value:o.project_id, options:[{value:'', label:'— без проекта —'}].concat((S.projects||[]).map(p => ({ value:p.id, label:p.name }))), onSave:v => {
          if (v === (o.project_id||'')) return;
          o.project_id = v; done('Проект заказа ' + o.order_id + ' изменён');
        }});
        return;
      }
      if (f === 'status'){
        const opts = Object.keys(STATUS_META)
          .filter(k => k !== 'archived' || o.status === 'archived')
          .filter(k => k === o.status || canStatus(o.status, k).ok)
          .map(k => ({ value:k, label:STATUS_META[k].label }));
        inlinePicker(el, { items:opts, selected:[o.status], single:true, onSave:ids => {
          const v = ids[0];
          if (!v || v === o.status) return;
          Promise.resolve(setStatus(o, v)).then(ok => { if (ok) inlineRefresh(() => animateFilterChange(root, () => render(false))); });
        }});
        return;
      }
      if (f === 'total'){
        inlineField(el, { type:'number', value:o.total||0, onSave:v => {
          const n = Math.max(0, Math.round(Number(v) || 0));
          if (n === o.total) return;
          o.total = n; done('Сумма заказа ' + o.order_id + ' изменена');
        }});
        return;
      }
      if (f === 'start'){
        inlineField(el, { value:dateText(o.start_date || o.order_date), wide:true, placeholder:'дд.мм.гггг', onSave:v => {
          if (!v.trim()) return;
          const t = parseDateText(v, o.start_date || o.order_date);
          if (t == null){ toast('Дата в формате дд.мм.гггг', 'err'); return; }
          o.start_date = t; if (!o.order_date) o.order_date = t;
          done('Начало заказа ' + o.order_id + ' изменено');
        }});
        return;
      }
      if (f === 'deadline'){
        inlineField(el, { value:dateText(o.deadline), wide:true, placeholder:'дд.мм.гггг', onSave:v => {
          if (!v.trim()){ o.deadline = null; done('Дедлайн заказа ' + o.order_id + ' снят'); return; }
          const t = parseDateText(v, o.deadline);
          if (t == null){ toast('Дата в формате дд.мм.гггг', 'err'); return; }
          o.deadline = t; done('Дедлайн заказа ' + o.order_id + ' изменён');
        }});
        return;
      }
    }

    function updateBulk(){
      const host = root.querySelector('#o-bulk');
      if (!host) return;
      const n = sel.size;
      if (!n){ setBulk(host, ''); return; }
      const osum = [...sel].reduce((acc,id) => { const o = S.orders.find(x => x.id === id); return acc + (o ? o.total : 0); }, 0);
      setBulk(host, `<div class="card card-pad row wrap" style="padding:10px 14px;margin-bottom:12px;border-color:var(--accent)">
          <b>Выбрано: ${n} · на сумму ${fmtMoney(osum)}</b><span class="spacer"></span>
          <button class="btn btn--ghost btn--sm" data-bulk="status">${icon('refresh')} Статус</button>
          ${staff?'<button class="btn btn--ghost btn--sm" data-bulk="pay">'+icon('card')+' Оплатить</button>':''}
          <button class="btn btn--danger btn--sm" data-bulk="del">${icon('trash')} Удалить</button>
        </div>`);
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
      const fm = root.querySelector('#f-manager'); fm && (fm.onchange = e=>{ ofilter.manager = e.target.value; animateFilterChange(root, () => render(false)); });
            const q = root.querySelector('#f-q');
      q && q.addEventListener('input', () => liveSearch(() => refillList(root, () => {
        ofilter.q = q.value;
        /* Полный render(false) пересоздаёт всю страницу и список мигал при вводе.
           Обновляем точечно: только таблицу/карточки + счётчик + bulk-панель. */
        list = computeList();
        shown = 0;
        fillRows(0);
        updateCount();
        updateBulk();
      })));
      const fn = root.querySelector('#f-niche');
      fn && fn.addEventListener('change', () => { ofilter.niche = fn.value; animateFilterChange(root, () => render(false)); });
      const fp = root.querySelector('#f-project');
      fp && fp.addEventListener('change', () => { ofilter.project = fp.value; animateFilterChange(root, () => render(false)); });
      const ff = root.querySelector('#f-from'), ft = root.querySelector('#f-to');
      const applyDate = (el, key) => {
        /* Нативный выбор даты отдаёт ISO (ГГГГ-ММ-ДД); пустая строка — сброс */
        const iso = (el.value || '').trim();
        ofilter[key] = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : '';
        /* Пересоздавать всю страницу нельзя: поле даты теряло каретку и ввод
           начинался заново с первого сегмента. Обновляем только список. */
        list = computeList();
        shown = 0;
        animateFilterChange(root, () => refillList(root, () => { fillRows(0); updateCount(); updateBulk(); }));
      };
      ff && (ff.onchange = () => applyDate(ff, 'dateFrom'));
      ft && (ft.onchange = () => applyDate(ft, 'dateTo'));
      const fa = root.querySelector('#f-arch');
      fa && fa.addEventListener('click', () => {
        ofilter.archived = !ofilter.archived; ofilter.statuses.clear();
        fa.classList.toggle('on', ofilter.archived);
        $$('#f-status .chip', root).forEach(c => c.classList.remove('on'));
        animateFilterChange(root, () => render(false));
      });
      const fdebt = root.querySelector('#f-debt');
      fdebt && fdebt.addEventListener('click', () => {
        ofilter.debt = !ofilter.debt;
        fdebt.classList.toggle('on', ofilter.debt);
        animateFilterChange(root, () => render(false));
      });
      $$('#f-status .chip', root).forEach(ch => ch.addEventListener('click', () => {
        const st = ch.dataset.st;
        if (!st) return; /* плашка «Долги» обрабатывается выше */
        ofilter.statuses.has(st) ? ofilter.statuses.delete(st) : ofilter.statuses.add(st);
        ch.classList.toggle('on', ofilter.statuses.has(st));
        animateFilterChange(root, () => render(false));
      }));
      const vw = root.querySelector('#o-view');
      if (vw) vw.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
        S.settings.ordersView = b.dataset.view;
        saveState();
        vw.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('on', x === b));
        render(false);
        animateViewSwitch(root);
        swapInlineLabel(root, '#btn-inline-order .inline-add-label');
      }));
      /* Делегируем change: шапка с #sel-all пересоздаётся в fillRows()
         (порционная подгрузка), прямой listener прикреплялся к старому элементу */
      root.addEventListener('change', (ev) => {
        if (ev.target.id !== 'sel-all') return;
        root.querySelectorAll('.row-sel').forEach(c => { c.checked = ev.target.checked; c.checked ? sel.add(c.value) : sel.delete(c.value); });
        updateBulk();
      });
      const nb = root.querySelector('#btn-new-order');
      nb && (nb.onclick = () => openOrderForm());
      const ni = root.querySelector('#btn-inline-order');
      if (ni && root.querySelector('#o-inline')){
        const spawnOrderRow = (values)=>{
          const box = inlineSpawn(root, 'orders');
          if (!box) return null;
          if (values){
            ['id','client','total','deadline'].forEach(f=>{
              const inp = box.querySelector(`[data-f="${f}"]`);
              if (inp) inp.value = values[f] || '';
            });
            checkInlineOrderId(box);
          }
          const f = box.querySelector('[data-f="id"]');
          if (f) requestAnimationFrame(()=>f.focus());
          return box;
        };
        /* Каждое нажатие — новая строка, ничего не закрываем и не подменяем */
        ni.onclick = ()=> spawnOrderRow();

        const checkInlineOrderId = (box)=>{
          const inp = box.querySelector('[data-f="id"]');
          const hint = box.querySelector('[data-inline-hint]');
          if (!inp) return null;
          if (hint && !hint.dataset.empty) hint.dataset.empty = hint.textContent;
          const dup = orderIdTaken(inp.value);
          inp.classList.toggle('is-bad', !!dup);
          inp.setAttribute('aria-invalid', dup ? 'true' : 'false');
          if (hint){
            if (dup){
              hint.textContent = `ID ${dup.order_id} уже занят — выберите другой`;
              hint.style.color = 'var(--red)';
              hint.hidden = false;
            } else {
              const def = hint.dataset.empty || '';
              hint.textContent = def;
              hint.style.color = '';
              hint.hidden = !def;
            }
          }
          return dup;
        };

        const saveInline = (box)=>{
          if (!box) return;
          const v = f => { const i = box.querySelector(`[data-f="${f}"]`); return i ? i.value : ''; };
          const focusField = f => { const i = box.querySelector(`[data-f="${f}"]`); if (i) i.focus(); };
          const id = sanitizeOrderId(v('id'));
          const cl = (v('client')||'').trim();
          const total = parseFloat(v('total'))||0;
          const dlRaw = (v('deadline') || '').trim();
          const dlTs = dlRaw ? parseDateText(dlRaw) : null;
          if (!cl){ toast('Укажите клиента', 'warn'); focusField('client'); return; }
          if (dlRaw && dlTs == null){
            toast('Дедлайн в формате дд.мм.гггг', 'err');
            const f = box.querySelector('[data-f="deadline"]');
            if (f){ f.classList.add('is-bad'); f.focus(); }
            return;
          }
          const client = S.users.find(x => x.role==='client' && (norm(x.full_name)===norm(cl) || norm(x.email)===norm(cl)));
          if (!client){ toast('Клиент не найден. Сначала добавьте его в список (кнопка «Добавить клиента»)','warn'); return; }
          let oid = id || generateOrderId();
          if (id && orderIdTaken(id)){
            toast(`ID ${id} уже занят — выберите другой`, 'err');
            const f = box.querySelector('[data-f="id"]');
            if (f){ f.classList.add('is-bad'); f.focus(); }
            return;
          }
          const now = Date.now();
          const stRaw = (v('start') || '').trim();
          const stTs = stRaw ? new Date(stRaw + 'T00:00:00').getTime() : now;
          const no = { id: uid(), order_id: oid, client_id: client.id, order_date: now, deadline: dlTs,
            status: 'waiting', total, certification_amount: 0, need_cert:false, start_date: (stTs || now), manager_id: me().id,
            comment:'', project_id:'', folder_id:'', nish_id:'', executors:[], audio:0, files:[], proposed_price:0, paid_amount:0,
            forbid_download:false, portfolio_ban:true, nda:false, history:[{ t: now, txt:'Заказ создан (инлайн)' }], created_at: now };
          if (no.deadline && no.start_date && no.deadline < no.start_date){ toast('Дедлайн раньше даты создания — исправьте','err'); return; }
          /* Незаполненные соседние строки не теряем при перерисовке */
          const drafts = [...root.querySelectorAll('.inline-add[data-clone="1"]')]
            .filter(b => b !== box && b.isConnected)
            .map(b => ({
              id: (b.querySelector('[data-f="id"]')||{}).value || '',
              client: (b.querySelector('[data-f="client"]')||{}).value || '',
              total: (b.querySelector('[data-f="total"]')||{}).value || '',
              deadline: (b.querySelector('[data-f="deadline"]')||{}).value || ''
            }));
          S.orders.unshift(no);
          logAudit(`Создан заказ ${oid} (инлайн)`, 'Заказ');
          saveState();
          toast(`Заказ ${oid} создан`,'ok');
          /* Строка плавно схлопывается, затем список перерисовывается */
          inlineClose(box, root, ()=>{
            render(false);
            drafts.forEach(d => spawnOrderRow(d));
            const newRow = root.querySelector(`[data-oid="${no.id}"]`);
            if (newRow){
              newRow.classList.add('inline-in');
              setTimeout(()=>newRow.classList.remove('inline-in'), 400);
            }
          });
        };

        if (!root.__inlineRowsBound){ root.__inlineRowsBound = 1;
        root.addEventListener('click', e=>{
          const box = e.target.closest && e.target.closest('.inline-add');
          if (!box || box.id) return;
          if (e.target.closest('[data-inline-save]')){ saveInline(box); return; }
          if (e.target.closest('[data-inline-cancel]')){ inlineClose(box, root); }
        });
        root.addEventListener('input', e=>{
          const box = e.target.closest && e.target.closest('.inline-add');
          if (!box || box.id) return;
          const f = e.target.dataset && e.target.dataset.f;
          if (f === 'id'){
            const el = e.target;
            const clean = sanitizeOrderId(el.value, true);
            if (el.value !== clean){
              const pos = Math.min(el.selectionStart || 0, clean.length);
              el.value = clean;
              try { el.setSelectionRange(pos, pos); } catch(err){}
            }
            checkInlineOrderId(box);
          } else if (f === 'deadline'){
            e.target.classList.remove('is-bad');
          }
        });
        root.addEventListener('keydown', e=>{
          const box = e.target.closest && e.target.closest('.inline-add');
          if (!box || box.id) return;
          if (e.key === 'Enter' && e.target.tagName === 'INPUT'){ e.preventDefault(); saveInline(box); }
          if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); inlineClose(box, root); }
        });
        } /* __inlineRowsBound */
      }
      const bt = root.querySelector('#btn-tools');
      bt && (bt.onclick = () => APP.go('tools'));
    }

    function bindTable(){
      const wrap = root.querySelector('.tbl-wrap');
      if (!wrap) return;
      const memKey = 'ordersScrollTop';
      requestAnimationFrame(() => { wrap.scrollTop = +(localStorage.getItem(memKey) || 0); });
      wrap.addEventListener('scroll', ()=>{ localStorage.setItem(memKey, String(wrap.scrollTop)); }, { passive:true });
      const tt = wrap.querySelector('.o-to-top');
      if (tt){
        tt.onclick = () => wrap.scrollTo({ top: 0, behavior: 'smooth' });
        /* Порог относительный: у коротких списков максимум прокрутки меньше 300px,
           и жёсткий порог не давал кнопке появиться никогда. */
        const sync = () => {
          const room = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
          const need = Math.min(300, Math.max(60, room * 0.3));
          tt.hidden = wrap.scrollTop < need;
        };
        sync();
        wrap.addEventListener('scroll', sync, { passive:true });
      }
      wrap.addEventListener('mouseover', e => {
        if (!dragSel) return;
        const c = e.target.closest('.row-sel');
        if (!c) return;
        /* Выделяем весь диапазон от стартовой строки до текущей — как в табличных редакторах */
        const boxes = [...wrap.querySelectorAll('.row-sel')];
        const idx = boxes.indexOf(c);
        const a = Math.min(dragSel.start, idx), b2 = Math.max(dragSel.start, idx);
        boxes.slice(a, b2+1).forEach(bx => { bx.checked = true; sel.add(bx.value); });
        updateBulk();
      });
      wrap.addEventListener('change', e => {
        const c = e.target.closest('.row-sel');
        if (!c) return;
        const boxes = [...wrap.querySelectorAll('.row-sel')];
        const idx = boxes.indexOf(c);
        if (e.shiftKey && lastSelSel !== null && lastSelSel !== idx){
          const [a,b] = [Math.min(lastSelSel,idx), Math.max(lastSelSel,idx)];
          boxes.slice(a,b+1).forEach(bx => { bx.checked = c.checked; c.checked ? sel.add(bx.value) : sel.delete(bx.value); });
        } else {
          c.checked ? sel.add(c.value) : sel.delete(c.value);
        }
        lastSelSel = idx;
        updateBulk();
      });
      /* Клик по строке (не по интерактивным элементам) — выделение строки */
      /* Драг-выделение группы: зажали ЛКМ на ЛЮБОЙ части строки/карточки и
         ведём мышь — область захватывает и выделяет строчки (не только по чекбоксу). */
      wrap.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        const row = e.target.closest('[data-ctx="order"]');
        if (!row) return;
        if (e.target.closest('button,a,input,select,label,.row-menu,[data-copy],[data-inline]')) return;
        dragSelMoved = false;
        dragSel = { start: [...wrap.querySelectorAll('[data-ctx="order"]')].indexOf(row) };
      });
      wrap.addEventListener('mousemove', e => {
        if (!dragSel) return;
        const dx = e.clientX - (dragSel._x || e.clientX), dy = e.clientY - (dragSel._y || e.clientY);
        if (!dragSel._init){ dragSel._x = e.clientX; dragSel._y = e.clientY; dragSel._init = true; return; }
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragSelMoved = true;
      });
      wrap.addEventListener('mouseover', e => {
        if (!dragSel) return;
        const row = e.target.closest('[data-ctx="order"]');
        if (!row) return;
        if (!dragSelMoved) return; /* без движения — не выделяем (клик откроет карточку) */
        const rows = [...wrap.querySelectorAll('[data-ctx="order"]')];
        const idx = rows.indexOf(row);
        if (idx < 0) return;
        const a = Math.min(dragSel.start, idx), b = Math.max(dragSel.start, idx);
        rows.slice(a, b+1).forEach(r => { const cb = r.querySelector('.row-sel'); if (cb){ cb.checked = true; sel.add(cb.value); } });
        updateBulk();
      });
      wrap.addEventListener('click', e => {
        /* Сортировка по клику на заголовок (делегирование: thead создаётся
           после bindControls, прямой bind не находил элементы). */
        const sth = e.target.closest('th.sortable[data-sort]');
        if (sth){
          const key = sth.dataset.sort;
          if (ofilter.sortKey === key) ofilter.sortDir *= -1; else { ofilter.sortKey = key; ofilter.sortDir = 1; }
          render(false);
          return;
        }
        const copy = e.target.closest('[data-copy]');
        if (copy){ e.stopPropagation(); navigator.clipboard && navigator.clipboard.writeText(copy.dataset.copy); toast(`ID «${copy.dataset.copy}» скопирован`, 'ok'); return; }
        const menu = e.target.closest('.row-menu');
        if (menu){ const r = menu.getBoundingClientRect(); orderContextMenu(menu.dataset.oid, r.left, r.bottom + 4, menu); return; }
        const inl = e.target.closest('[data-inline]');
        if (inl && staff){
          if (e.target.closest('.inline-input,.inline-pick')) return;
          /* Клик, которым закрыли плашку, не должен тут же открывать её снова */
          if (window.__inlineToggleAt && Date.now() - window.__inlineToggleAt < 400){ window.__inlineToggleAt = 0; e.stopPropagation(); return; }
          e.stopPropagation();
          openOrderInline(inl);
          return;
        }
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
        /* Одиночный клик по строке/карточке заказа (не по интерактивным
           элементам) — открыть карточку заказа, как было раньше */
        const ordRow = e.target.closest('[data-ctx="order"]');
        if (ordRow && ordRow.dataset.oid){
          if (e.target.closest('button,a,input,select,label,.row-menu,.row-sel,[data-copy]')) return;
          if (dragSelMoved) return; /* был drag-выделение, а не клик */
          openOrderDetail(ordRow.dataset.oid);
        }
      });
      wrap.addEventListener('dblclick', e => {
        /* Двойной клик по строке ИЛИ карточке заказа — всегда модалка */
        const row = e.target.closest('[data-ctx="order"]');
        if (!row) return;
        if (e.target.closest('button,a,input,select,label,.row-menu,.row-sel,[data-copy]')) return;
        openOrderDetail(row.dataset.oid);
      });
      /* ПКМ по заказу — своё меню приложения и для строк таблицы (tr),
         и для карточек (.o-card): раньше селектор ловил только tr,
         и на карточках открывалось нативное меню браузера. */
      wrap.addEventListener('contextmenu', e => {
        const row = e.target.closest('[data-ctx="order"]');
        if (!row || !row.dataset.oid) return;
        e.preventDefault();
        if (staff) orderContextMenu(row.dataset.oid, e.clientX, e.clientY);
      });
    }

    render(firstEntry);
    firstEntry = false;
    CRM._ordersRerender = () => render(false);
    /* Esc: снять всё выделение в таблице заказов */
    CRM._ordersSelClear = () => {
      sel.clear();
      try { lastSelSel = null; } catch(e){}
      root.querySelectorAll('.row-sel').forEach(cb => { cb.checked = false; });
      updateBulk();
    };
  }

  function personContextMenu(uid, role, x, y, anchor){
    const p = userById(uid); if (!p) return;
    const u = me(); const staff = isStaff(u.role);
    const bl = p.ext.status === 'blacklisted';
    const items = [
      { label:'Открыть профиль', icon:'file', onClick:()=>openPersonCard(uid, role) },
      ...(u.id !== p.id ? [{ label:'Написать лично', icon:'chats', onClick:()=>{ if (typeof window.openDirectChat==='function') window.openDirectChat(p.id); } }] : []),
      { label:'Копировать ID', icon:'copy', onClick:()=>{ navigator.clipboard&&navigator.clipboard.writeText(p.id); toast('ID скопирован','ok'); } },
    ];
    if (staff){
      items.push('-');
      items.push({ label: bl ? 'Убрать из ЧС' : 'Добавить в ЧС', icon:'x-c', danger:!bl, onClick:()=>{
        p.ext.status = bl ? 'active' : 'blacklisted';
        logAudit(`${bl?'Убран из ЧС':'Добавлен в ЧС'}: ${p.full_name}`,'Безопасность');
        saveState(); toast(bl?'Разблокирован':'Добавлен в ЧС','ok'); APP.render();
      }});
      items.push({ label:'Редактировать', icon:'edit', onClick:()=>openPersonForm(role, p) });
    }
    contextMenu(x, y, items.filter(Boolean), anchor);
  }

  function orderContextMenu(oid, x, y, anchor){
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
    contextMenu(x, y, items.filter(Boolean), anchor);
  }

  /* ---------- Форма заказа ---------- */
  async function openOrderForm(editId, prefill=0){
    const u = me();
    const isEdit = !!editId;
    const o = isEdit ? S.orders.find(x=>x.id===editId) : {
      id:uid(), order_id:'', client_id:'', order_date:Date.now(), deadline:null, status:'draft',
      total:0, certification_amount:0, need_cert:false, comment:'', manager_id:u.id, project_id:'',
      folder_id:'', nish_id:'', executors:[], audio:0, files:[], proposed_price:0, paid_amount:0,
      forbid_download:false, portfolio_ban:true, nda:false, history:[], created_at:Date.now(),
      /* Дата начала работ по умолчанию — сегодня (для нового заказа) */
      start_date: Date.now()
    };
    const clients = S.users.filter(x=>x.role==='client' && x.ext.status!=='blacklisted');
    const executors = S.users.filter(x=>x.role==='executor' && x.ext.status!=='blacklisted' && x.ext.workStatus==='working');
    const form = { executors: [...o.executors], files: [...(o.files||[])], calcSum: 0 };

    const m = openWinModal({
      wide:true, title: isEdit ? `Заказ ${o.order_id}` : 'Новый заказ', route:'orders',
      body: `<div class="order-form">
        <div class="stack" style="gap:13px">
          <div class="cols-2 grid" style="gap:13px">
            <div class="field"><label>ID заказа</label>
              <div class="row"><input class="input" id="of-id" value="${esc(o.order_id)}" placeholder="AW-0000" style="font-family:var(--mono)">
              <button class="btn btn--ghost btn--icon" id="of-gen" title="Сгенерировать по правилам">${icon('refresh')}</button></div>
              <div class="small" id="of-id-hint" hidden></div></div>
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
          <div class="field"><label>Тариф</label><select class="input" id="of-tariff">
            <option value="">— не указан —</option>
            ${TARIFFS.map(t=>`<option value="${t.id}" ${o.tariff===t.id?'selected':''}>${esc(t.label)}</option>`).join('')}</select></div>
          <div class="cols-2 grid" style="gap:13px">
            <div class="field"><label>Дата начала работ</label><input type="date" class="input" id="of-start"></div>
            <div class="field"><label>Дедлайн</label><input type="datetime-local" class="input" id="of-deadline"></div>
          </div>
          <div class="cols-2 grid" style="gap:13px">
            <div class="field"><label>Проект</label><select class="input" id="of-project"><option value="">—</option></select></div>
            <div class="field"><label>Папка</label><select class="input" id="of-folder"><option value="">—</option></select></div>
          </div>
          <div class="field"><label>Итого, ₽ *</label><input type="number" class="input" id="of-total" min="0" value="${prefill ? prefill : (o.total||'')}" placeholder="0"></div>
          <div class="field"><label>Предоплата: <b id="of-prepay-val">50</b>%</label>
            <div class="seg prepay-seg" id="of-prepay-seg">
              <button type="button" data-prepay="50" class="">50%</button>
              <button type="button" data-prepay="100" class="">100%</button>
              <button type="button" data-prepay="custom" class="">Своё…</button>
            </div>
            <input type="number" class="input" id="of-prepay-custom" min="0" max="100" placeholder="% предоплаты" style="display:none;margin-top:6px">
            <input type="hidden" id="of-prepay" value="50">
            <div class="small" id="of-prepay-hint" style="color:var(--muted)"></div></div>
          <div class="cols-2 grid" style="gap:13px">
            <div class="field"><label>Заверение, ₽</label>
              <div class="row">
              <label class="check" style="margin-top:4px" title="Заверить у нотариуса"><input type="checkbox" id="of-need-cert" ${o.need_cert?'checked':''}><span class="box"><svg><use href="#i-check-c"/></svg></span></label>
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
        /* ID заказа: только латиница, цифры и дефис; всегда капсом.
           Неуникальный номер подсвечиваем сразу при вводе. */
        const checkFormId = markOrderIdField(g('#of-id'), g('#of-id-hint'), isEdit ? o.id : null);
        g('#of-id').addEventListener('input', e=>{
          const el = e.target;
          const clean = sanitizeOrderId(el.value, true);
          if (el.value !== clean){
            const pos = Math.min(el.selectionStart || 0, clean.length);
            el.value = clean;
            try { el.setSelectionRange(pos, pos); } catch(err){}
          }
          if (checkFormId) checkFormId();
        });
        g('#of-gen').addEventListener('click', ()=>{ setTimeout(()=>checkFormId && checkFormId(), 0); });
        g('#of-need-cert').addEventListener('change', e=>{ g('#of-cert').disabled = !e.target.checked; });
        const prepayHint = ()=> {
          const v = +g('#of-prepay').value;
          g('#of-prepay-val').textContent = v;
          g('#of-prepay-hint').innerHTML = v < S.settings.minPrepay
            ? `<span style="color:var(--yellow)">⚠ Предоплата менее ${S.settings.minPrepay}% — требуется электронный договор <span class="badge c-gray">модуль в разработке</span></span>`
            : `<span style="color:var(--green)">✓ Договор не требуется (достаточно оферты)</span>`;
        };
        const syncPrepay = ()=>{
          const v = +g('#of-prepay').value;
          const custom = g('#of-prepay-custom');
          const seg = g('#of-prepay-seg');
          seg.querySelectorAll('[data-prepay]').forEach(b=>{
            const isCustom = b.dataset.prepay === 'custom';
            const on = isCustom ? false : (+b.dataset.prepay === v);
            b.classList.toggle('on', on);
            if (isCustom) b.classList.toggle('on', v !== 50 && v !== 100);
          });
          custom.style.display = (v !== 50 && v !== 100) ? '' : 'none';
          if (v !== 50 && v !== 100) custom.value = v;
          prepayHint();
        };
        g('#of-prepay-seg').addEventListener('click', e=>{
          const b = e.target.closest('[data-prepay]');
          if (!b) return;
          const custom = g('#of-prepay-custom');
          if (b.dataset.prepay === 'custom'){
            /* Клик по «Своё…»: открыть поле и подсветить кнопку, НЕ схлопывать.
               syncPrepay() после этого не вызываем — он по значению #of-prepay
               скрыл бы поле снова. */
            const cur = +custom.value;
            if (cur > 0 && cur <= 100) g('#of-prepay').value = cur;
            custom.style.display = ''; custom.focus();
            const segEl = g('#of-prepay-seg');
            segEl.querySelectorAll('[data-prepay]').forEach(x=>{
              x.classList.toggle('on', x === b);
            });
            g('#of-prepay-val').textContent = g('#of-prepay').value;
          } else {
            g('#of-prepay').value = b.dataset.prepay;
            syncPrepay();
          }
        });
        g('#of-prepay-custom').addEventListener('input', ()=>{
          const raw = +g('#of-prepay-custom').value || 0;
          /* Значение >100 не «схлопывает» режим «Своё…»: пользователь видит свой
             ввод и предупреждение, а в расчёт идёт 100 (максимум предоплаты).
             Раньше min(100,…) сразу писал в #of-prepay число 100, syncPrepay
             переводил плашку на «100%» и скрывал поле — кнопка «Своё…» после
             этого «не кликалась» (клик открывал поле снова с 100). */
          const v = Math.max(0, Math.min(100, raw));
          g('#of-prepay').value = v;
          const custom = g('#of-prepay-custom');
          const seg = g('#of-prepay-seg');
          seg.querySelectorAll('[data-prepay]').forEach(b=>{
            b.classList.toggle('on', b.dataset.prepay === 'custom');
          });
          custom.style.display = '';
          g('#of-prepay-val').textContent = v;
          g('#of-prepay-hint').innerHTML = raw > 100
            ? `<span style="color:var(--yellow)">⚠ Предоплата не может быть больше 100% — в расчёт пойдёт 100%</span>`
            : (v < S.settings.minPrepay
              ? `<span style="color:var(--yellow)">⚠ Предоплата менее ${S.settings.minPrepay}% — требуется электронный договор <span class="badge c-gray">модуль в разработке</span></span>`
              : `<span style="color:var(--green)">✓ Договор не требуется (достаточно оферты)</span>`);
        });
        syncPrepay();

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
              else { form.executors.push({ uid:idv, amount:0, is_paid:false }); splitShares(); }
              renderExecList(); updExecSum();
            });
            const amt = el.querySelector('.ex-amount');
            amt && amt.addEventListener('input', ()=>{ const row = form.executors.find(x=>x.uid===el.dataset.uid); if (row) row.amount = +amt.value||0; updExecSum(); });
            const share = el.querySelector('.ex-share');
            share && share.addEventListener('input', ()=>{ const row = form.executors.find(x=>x.uid===el.dataset.uid); if (row) row.share = Math.min(100, Math.max(0, +share.value||0)); updExecSum(); });
          });
        }
        /* Объёмы работ: «поровну» делит 100% между всеми, пользователь может
           править проценты, сумма автоматически пересчитывается от «Итого» */
        const splitShares = ()=>{
          const n = form.executors.length;
          if (!n) return;
          const base = Math.floor(100/n);
          let left = 100;
          form.executors.forEach((row,i)=>{
            row.share = i === n-1 ? left : base;
            left -= base;
          });
        };
        const fld = g('#of-total');
        const updExecSum = ()=>{
          const total = +fld.value || 0;
          const sum = form.executors.reduce((a,e)=>a+(e.amount||0),0);
          const hasShares = form.executors.some(e=>e.share!=null);
          /* Авторасчёт от объёма: если «Итого» есть и проценты заданы */
          if (hasShares && total > 0 && !form.executors.some(e=>(e.amount||0)>0)){
            form.executors.forEach(e=>{ e.amount = Math.round(total * (e.share||0) / 100); });
          }
          const parts = form.executors.map(e=>{
            const sh = e.share!=null ? e.share : (total ? Math.round((e.amount||0)/total*100) : 0);
            return `${(userById(e.uid)||{}).full_name.split(' ')[0]}${(e.amount||0)?': '+fmtMoney(e.amount):''}${sh?` (${sh}%)`:''}`;
          }).join(' · ');
          g('#of-exec-sum').innerHTML = form.executors.length
            ? `<div>Назначено ${form.executors.length} · сумма: <b>${fmtMoney(sum)}</b></div><div class="tiny faint">${esc(parts)}</div>`
            : 'Никто не назначен';
        };
        if (fld) fld.addEventListener('input', ()=>{ updExecSum(); });
        const execSearch = debounce(()=>{
          const q = norm(g('#of-ex-search').value);
          $$('#of-exec-list .executor-pick__item', mask).forEach(el=>{
            el.style.display = norm(el.dataset.name).includes(q) ? '' : 'none';
          });
        });
        g('#of-ex-search').addEventListener('input', execSearch);
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
          /* Автосохранение по таймеру уважает настройку «Черновики заказов» */
          if (S.draftPrefs.autoDraft === false) return;
          DraftsDB.put('order-form', collect());
        }, 5000);

        function collect(){
          return {
            order_id:sanitizeOrderId(g('#of-id').value), client_id:g('#of-client').value, client_ids:[...selClients], nish_id:g('#of-niche').value, tariff:g('#of-tariff').value,
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
            const autoDraft = S.draftPrefs.autoDraft !== false;
            const dontAsk = S.draftPrefs.noAskDraft;
            if (autoDraft && !dontAsk){
              /* Спросить один раз: «Сохранить черновик?» (+ чекбокс «не спрашивать») */
              const okSave = await confirmModal({ title:'Сохранить черновик?', text:'Вы закрываете форму с незаполненными данными.', okText:'Сохранить черновик', checkbox:'Больше не спрашивать' });
              if (okSave){
                S.draftPrefs.noAskDraft = !!(okSave === true && $('#cf-chk') && $('#cf-chk').checked) || S.draftPrefs.noAskDraft;
                saveState();
                DraftsDB.put('order-form', collect());
                toast('Черновик сохранён локально','ok');
              } else {
                DraftsDB.del('order-form');
              }
            } else if (autoDraft && dontAsk){
              /* «Не спрашивать»: черновик ВСЕГДА сохраняется — данные не теряются */
              DraftsDB.put('order-form', collect());
              toast('Черновик сохранён локально','ok');
            }
          }
          clearInterval(autoTimer); close();
        };

        mask.querySelector('[data-save]').onclick = async ()=>{
          const c = collect();
          if (!c.client_id || !c.nish_id || !c.total){ toast('Заполните клиента, нишу и сумму','err'); return; }
          if (!c.order_id){ c.order_id = generateOrderId(); }
          if (S.orders.some(x=>x.order_id===c.order_id && x.id!==o.id)){
            toast(`ID ${c.order_id} уже занят — выберите другой`, 'err');
            const f = g('#of-id');
            if (f){ f.classList.add('is-bad'); f.focus(); }
            const hint = g('#of-id-hint');
            if (hint){ hint.textContent = `ID ${c.order_id} уже занят — выберите другой`; hint.style.color = 'var(--red)'; hint.hidden = false; }
            return;
          }
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

    /* восстановление офлайн-черновика (уважает настройку «Черновики заказов») */
    DraftsDB.get('order-form').then(d=>{
      if (S.draftPrefs.autoDraft === false){ if (d && d.val) try { DraftsDB.del('order-form'); } catch(e){} return; }
      if (d && d.val && !isEdit && !o.order_id){
        openWinModal({ narrow:true, title:'Найден черновик', route:'orders', body:`<p class="small muted">Локальный черновик заказа от ${fmtDT(d.t)}. Восстановить данные?</p>`,
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
      ${avatarHTML(e,'avatar--sm')}<span style="flex:1;min-width:0"><b style="font-size:12.5px">${esc(e.full_name)}</b><br><span class="faint executor-pick__spec" style="font-size:11px">${esc(e.ext.specializations.join(', '))}</span></span>
      ${starsHTML(e.ext.qualOverall||0)}
      <span class="executor-pick__amount">${sel?`<input type="number" class="ex-amount input" value="${sel.amount||''}" placeholder="₽">`:''}</span>
      ${sel?`<span class="executor-pick__share"><input type="number" class="ex-share input" min="0" max="100" value="${sel.share!=null?sel.share:''}" placeholder="%"> <span class="tiny faint">%</span></span>`:''}</div>`;
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

    /* Гонорар менеджера: процент от суммы, потолок задаёт админ */
    const feeCeil = S.settings.feeCeilings || {};
    const feePct = +(o.manager_fee || 0);
    const feeCap = u.role==='admin' ? 100 : u.role==='top_manager' ? (feeCeil.top_manager ?? 25) : (feeCeil.manager ?? 25);
    const feeBlock = staff ? `<div class="card card-pad"><div class="row row--between"><b class="small">Гонорар менеджера</b>
        <span class="badge c-gray">потолок ${feeCap}%</span></div>
        <div class="row row--between small" style="margin-top:8px"><span class="muted">Ставка</span><b>${feePct ? feePct + '%' : 'не задан'}</b></div>
        <div class="row row--between small"><span class="muted">Сумма</span><b>${feePct ? fmtMoney(Math.round((o.total||0)*feePct/100)) : '—'}</b></div>
        <button class="btn btn--ghost btn--sm" data-fee-edit style="margin-top:10px">Изменить гонорар</button></div>` : '';

    openWinModal({
      wide:true, title:`Заказ ${o.order_id}`, route:'orders',
      body: `
        <div class="row wrap" style="gap:7px;margin-bottom:14px">
          ${statusChip(o.status)} ${nicheChip(o.nish_id)} ${o.tariff ? tariffChip(o.tariff) : ''}
          ${o.nda?'<span class="badge c-violet">NDA</span>':''}
          ${o.forbid_download?'<span class="badge c-red">Запрет скачивания</span>':''}
          ${o.certification_amount?'<span class="badge c-blue">Заверение '+fmtMoney(o.certification_amount)+'</span>':''}
          ${o.proposed_price?'<span class="badge c-yellow">Предложено клиентом: '+fmtMoney(o.proposed_price)+'</span>':''}
        </div>
        ${feeBlock}
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
                ${o.executors.map(e=>{const ex=userById(e.uid); return ex?`<div class="row">${avatarHTML(ex,'avatar--sm')}<span style="flex:1;min-width:0"><b class="small">${esc(ex.full_name)}</b><br><span class="faint" style="font-size:11px">${esc(ex.ext.specializations.join(', '))}</span></span><b class="small" style="flex:none;white-space:nowrap">${fmtMoney(e.amount)}</b>${staff&&o.status==='done'?`<button class="btn btn--sm ${e.is_paid?'btn--ghost':'btn--soft'}" data-pay="${e.uid}" style="flex:none;white-space:nowrap">${e.is_paid?'Оплачен':'Оплатить'}</button>`:''}
                ${staff&&u.role==='admin'&&(e.amount||0)>30000&&!e.approved_by_admin&&!e.is_paid?`<button class="btn btn--sm btn--ghost" data-approve="${e.uid}" title="Согласовать превышение">${icon('check-c')} Согласовать</button>`:''}</div>`:''}).join('') || '<span class="faint small">Не назначены</span>'}
              </div>
            </div>
            <div class="card card-pad"><b class="small">История заказа</b>
              <div class="stack small" style="gap:7px;margin-top:9px">
                ${o.history.slice().reverse().map(h=>`<div class="row" style="gap:8px"><span class="dot" style="background:var(--accent);flex:none;margin-top:5px"></span><span><b>${esc(h.txt)}</b><br><span class="faint" style="font-size:11px">${fmtDT(h.t)}</span></span></div>`).join('')}
              </div>
            </div>
            <button class="btn btn--primary btn--block" data-order-chat>${icon('chats')} Чат по заказу</button>
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
          const t = e.target.closest('[data-st],[data-pay],[data-dl],[data-pay-client],[data-ticket],[data-edit],[data-del],[data-arch],[data-fee-edit]');
          if (!t) return;
          if (t.dataset.st) { await setStatus(o, t.dataset.st); close(); APP.render(); }
          if ('feeEdit' in t.dataset){
            const ceil = u.role==='admin' ? 100 : u.role==='top_manager' ? (feeCeil.top_manager ?? 10) : (feeCeil.manager ?? 15);
            openWinModal({ narrow:true, title:'Гонорар менеджера',
              body:`<div class="field"><label>Ставка, % от суммы (потолок ${ceil}%)</label><input type="number" class="input" id="fee-v" min="0" max="${ceil}" value="${o.manager_fee||0}"></div>
                <p class="small faint" style="margin-top:8px">Сумма: <b id="fee-sum">${fmtMoney(Math.round((o.total||0)*(o.manager_fee||0)/100))}</b></p>`,
              footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-fee-save>Сохранить</button>`,
              onMount:(m2, close2)=>{
                const inp = m2.querySelector('#fee-v');
                const sumEl = m2.querySelector('#fee-sum');
                inp.oninput = ()=>{ sumEl.textContent = fmtMoney(Math.round((o.total||0)*(+inp.value||0)/100)); };
                const x = m2.querySelector('[data-x]'); if (x) x.onclick = ()=>close2();
                m2.querySelector('[data-fee-save]').onclick = ()=>{
                  let v = Math.max(0, +inp.value || 0);
                  if (v > ceil){ v = ceil; toast('Ставка ограничена потолком ' + ceil + '%', 'warn'); }
                  o.manager_fee = v;
                  logAudit('Гонорар по ' + o.order_id + ': ' + v + '%', 'Заказы');
                  saveState();
                  close2 && close2(); close();
                  openOrderDetail(o.id);
                  toast('Гонорар сохранён','ok');
                };
              }});
            return;
          }
          if (t.dataset.approve){
            const ex = o.executors.find(x=>x.uid===t.dataset.approve);
            ex.approved_by_admin = true;
            logAudit(`Согласовано превышение оплаты: ${o.order_id} (${fmtMoney(ex.amount)})`, 'Оплата');
            saveState(); toast('Превышение согласовано — менеджер может провести оплату', 'ok');
            close(); APP.render();
          }
          if ('pay' in t.dataset){ payOrder(o, o.executors.find(x=>x.uid===t.dataset.pay)); close(); APP.render(); }
          if ('payClient' in t.dataset){
            openWinModal({ narrow:true, title:'Отметить платёж',
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
          if ('ticket' in t.dataset){ close(); CRM.openTicket(o.order_id); }
          if ('orderChat' in t.dataset){ close(); ensureOrderChat(o); }
          if ('edit' in t.dataset){ close(); openOrderForm(o.id); }
          if ('del' in t.dataset){ await deleteOrder(o); close(); APP.render(); }
          if ('arch' in t.dataset){ await setStatus(o, o.status==='archived' ? (o.history.some(h=>h.txt.includes('Выполнено'))?'done':'work') : 'archived'); close(); APP.render(); }
        });
      }
    });
  }

  /* Чат по заказу: у каждого заказа есть общий чат с его менеджером, куда
     менеджер может приглашать исполнителей. Создаётся по первому открытию
     (если ещё не создан). */
  function ensureOrderChat(o){
    if (!o) return;
    let ch = noDemo(S.chats).find(c => c.type==='order' && c.order_id === o.id && c.is_active !== false);
    if (!ch){
      const cid = (o.client_ids && o.client_ids[0]) || o.client_id || null;
      const parts = [o.manager_id, cid, ...(o.executors||[]).map(e=>e.uid)].filter(Boolean);
      const uniq = [...new Set(parts)];
      ch = { id: uid(), type:'order', name:'Заказ ' + (o.order_id || '—'),
        description:'Менеджер, заказчик и исполнители заказа',
        order_id:o.id, client_id: cid, member_ids: uniq, participants: uniq,
        created_at: Date.now(), is_active:true, unread:{} };
      S.chats.push(ch);
      saveState();
    }
    if (typeof window.openChatAt === 'function') window.openChatAt(ch.id);
    else if (typeof go === 'function') go('chats');
    else { location.hash = '#/chats'; }
  }

  function showDownloadGuard(o, f){
    openWinModal({
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


  /* ==================== ЛЮДИ: клиенты и исполнители ==================== */
  /* Простая анимация смены вида таблица/карточки: fade+slide нового контейнера. */
  function animateViewSwitch(root){
    const host = root.querySelector('#o-rows') || root.querySelector('.person-grid, .tbl-wrap');
    if (!host) return;
    host.classList.remove('view-anim');
    void host.offsetWidth;
    host.classList.add('view-anim');
  }

  /* Контейнер списка, который по смыслу переживает перерисовку:
     у заказов — обёртка таблицы/карточек, у людей — сетка карточек или таблица. */
  function listHost(root){
    return root.querySelector('.o-wrap') || root.querySelector('.person-grid') ||
           root.querySelector('.pl-wrap') || root.querySelector('.tbl-wrap') || root.querySelector('#o-rows');
  }

  /* Инлайн-добавление показываем прямо в списке: первой строкой таблицы
     или карточкой в сетке карточек — чтобы новая запись появлялась там,
     где ей место, а не отдельной плашкой над фильтрами. */
  function inlineOpen(box, root, kind){
    if (!box) return;
    const wrap = root.querySelector(kind === 'orders' ? '.o-wrap' : '.pl-wrap');
    /* Клоны — самостоятельные строки: у каждой своя tr, домой ничего не возвращаем */
    if (box.dataset.clone !== '1' && !box.__home) box.__home = { parent: box.parentNode, next: box.nextSibling };
    box.hidden = false;
    box.style.cssText = '';
    box.classList.remove('closing','inline-add--row','inline-add--card','inline-add--in');
    void box.offsetWidth;
    box.classList.add('inline-add--in');
    setTimeout(()=>box.classList.remove('inline-add--in'), 280);
    if (!wrap){ box.classList.add('inline-show'); return; }
    const grid = wrap.querySelector('.o-cards, .person-grid');
    if (grid){
      box.classList.add('inline-add--card');
      grid.prepend(box);
      return;
    }
    const table = wrap.querySelector('table.tbl');
    if (table){
      /* Новая строка собирается по разметке обычной строки: те же ячейки,
         а поля раскладываем по своим колонкам (ID — «Заказ», клиент,
         дедлайн, итого, кнопки — в последнюю). */
      const cols = (table.tHead && table.tHead.rows[0]) ? table.tHead.rows[0].cells.length : 1;
      const tr = document.createElement('tr');
      tr.className = 'inl-tr inline-add inline-add--row';
      tr.dataset.clone = '1';
      for (let i = 0; i < cols; i++) tr.appendChild(document.createElement('td'));
      const cellAt = i => tr.cells[Math.max(0, Math.min(i, cols - 1))];
      const put = (i, sel) => { const el = box.querySelector(sel); if (el) cellAt(i).appendChild(el); };
      if (kind === 'orders'){
        put(1, '[data-f="id"]');
        put(3, '[data-f="client"]');
        put(5, '[data-f="start"]');
        put(6, '[data-f="deadline"]');
        put(7, '[data-f="total"]');
      } else {
        /* Люди: имя — в колонку «ФИО», контакты — в соседнюю */
        put(2, '[data-f="name"]');
        put(3, '[data-f="email"]');
        put(3, '[data-f="phone"]');
        put(4, '[data-f="spec"]');
      }
      const lastCell = cellAt(cols - 1);
      ['[data-inline-save]','[data-inline-cancel]'].forEach(sel => { const el = box.querySelector(sel); if (el) lastCell.appendChild(el); });
      /* Подсказка нужна проверке дублей ID — держим её в ячейке, но скрытой */
      const hint = box.querySelector('[data-inline-hint]');
      if (hint){ hint.hidden = true; cellAt(kind === 'orders' ? 1 : 3).appendChild(hint); }
      const tbody = table.tBodies[0] || table.appendChild(document.createElement('tbody'));
      tbody.insertBefore(tr, tbody.firstChild);
      box.remove();
      tr.classList.add('inline-add--in');
      setTimeout(()=>tr.classList.remove('inline-add--in'), 280);
      return tr;
    }
    return box;
  }

  /* Новая пустая строка/карточка на каждое нажатие: форма-шаблон #o-inline
     или #pl-inline никогда не перемещается, из неё делается клон. */
  function inlineSpawn(root, kind){
    const tpl = root.querySelector(kind === 'orders' ? '#o-inline' : '#pl-inline');
    if (!tpl) return null;
    const box = tpl.cloneNode(true);
    box.removeAttribute('id');
    box.dataset.clone = '1';
    box.hidden = true;
    tpl.parentNode.insertBefore(box, tpl.nextSibling);
    return inlineOpen(box, root, kind) || box;
  }

  /* Закрытие: сначала плавно схлопываем строку, потом убираем её из списка
     и возвращаем плашку на исходное место в разметке. */
  function inlineClose(box, root, cb){
    if (!box || box.hidden){ cb && cb(); return; }
    const tr = box.closest('tr.inl-tr');
    const h = box.offsetHeight;
    box.style.overflow = 'hidden';
    box.classList.add('closing');
    if (tr) tr.classList.add('closing');
    /* Схлопываем анимацией: высота плашки едет к нулю, строка следует за ней.
       CSS-transition у таблицы срабатывал нестабильно, поэтому ведём явно. */
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (box.animate && !reduce){
      try {
        box.animate(
          [{ height: h + 'px', opacity: 1, paddingTop: getComputedStyle(box).paddingTop, paddingBottom: getComputedStyle(box).paddingBottom },
           { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px' }],
          { duration: 180, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'forwards' }
        );
      } catch(e){}
    }
    box.style.height = '0px';
    box.style.opacity = '0';
    setTimeout(()=>{
      box.classList.remove('closing','inline-add--row','inline-add--card','inline-add--in');
      box.style.cssText = '';
      if (box.dataset.clone === '1'){
        box.remove();
      } else {
        if (box.__home && box.__home.parent && box.__home.parent.isConnected) box.__home.parent.insertBefore(box, box.__home.next);
        box.hidden = true;
      }
      if (tr && tr.isConnected){
        const prev = tr.previousElementSibling;
        tr.remove();
        /* Последовательное удаление: после Esc курсор встаёт в предыдущую
           новую строку (если она есть) — можно удалять подряд. */
        if (prev && prev.classList && prev.classList.contains('inline-add')){
          const f = prev.querySelector('.inline-add input, .inline-add select');
          if (f){ try { f.focus(); } catch(e){} }
        }
      }
      cb && cb();
    }, 210);
  }

  /* Смена содержимого по плашкам-фильтрам («Выполнено», «В работе»,
     «Активные», «Чёрный список»): список перерисовывается сразу (клик
     отзывается мгновенно) и мягко «оседает» на место — сдвиг на пару
     пикселей вместо паузы и мигания в пустоту. */
  /* Подпись кнопки добавления («Строка» ↔ «Карточка») мягко сменяется
     при переключении таблицы и карточек. */
  function swapInlineLabel(root, sel){
    const lb = root.querySelector(sel);
    if (!lb) return;
    lb.classList.remove('label-swap');
    void lb.offsetWidth;
    lb.classList.add('label-swap');
    setTimeout(()=>lb.classList.remove('label-swap'), 320);
  }

  /* FLIP для списков. Перерисовка пересобирает таблицу целиком, поэтому
     исчезнувшая строка не «схлопывается», а просто выпадает: всё, что ниже,
     прыгает на её высоту. Запоминаем позиции строк ДО отрисовки и даём
     оставшимся съехать на новые места. */
  const FLIP_SEL = '.o-wrap tbody > tr[data-oid], .o-wrap .o-cards > [data-oid], ' +
                   '.pl-wrap tbody > tr[data-uid], .pl-wrap .person-grid > [data-uid]';

  function flipSnap(root){
    const m = new Map();
    if (!root) return m;
    root.querySelectorAll(FLIP_SEL).forEach(el => {
      const k = el.dataset.oid || el.dataset.uid;
      if (k && !m.has(k)) m.set(k, el.getBoundingClientRect().top);
    });
    return m;
  }

  function flipPlay(root, before){
    if (!root || !before || !before.size) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const after = new Map();
    root.querySelectorAll(FLIP_SEL).forEach(el => {
      const k = el.dataset.oid || el.dataset.uid;
      if (k) after.set(k, el);
    });
    /* Ради исчезнувших строк анимация и нужна: нет их — нет и движения. */
    let gone = false;
    before.forEach((_, k) => { if (!after.has(k)) gone = true; });
    if (!gone) return;
    const moves = [];
    let far = 0;
    after.forEach((el, k) => {
      const y0 = before.get(k);
      if (y0 == null) return;
      const dy = Math.round(y0 - el.getBoundingClientRect().top);
      if (Math.abs(dy) < 2) return;
      moves.push([el, dy]);
      if (Math.abs(dy) > Math.abs(far)) far = dy;
    });
    /* Совсем другой список (фильтр сменил почти всё) — строки через пол-
       таблицы не гоняем: там уместнее общий мягкий сдвиг хоста. */
    if (Math.abs(far) > 320) return;
    root.__flipMoved = true;
    if (!moves.length) return;
    const dur = Math.round(Math.min(280, 150 + Math.abs(far) * 0.5));
    moves.forEach(([el, dy]) => { el.style.transition = 'none'; el.style.transform = 'translateY(' + dy + 'px)'; });
    void root.offsetWidth;
    moves.forEach(([el]) => { el.style.transition = 'transform ' + dur + 'ms var(--ease)'; el.style.transform = 'translateY(0px)'; });
    setTimeout(() => moves.forEach(([el]) => { el.style.transition = ''; el.style.transform = ''; }), dur + 120);
  }

  /* Плашка массовых действий: раскрывается по высоте при первом выбранном
     элементе и так же плавно уходит, когда выделение снято. Раньше она
     вставлялась и стиралась одним innerHTML — список прыгал на её высоту. */
  function setBulk(host, html){
    if (!host) return;
    const open = host.dataset.open === '1';
    if (html){
      host.innerHTML = html;
      /* Уже раскрыта: меняем только содержимое (счётчик), высота по контенту,
         анимация появления не перезапускается. */
      if (open){ host.style.height = ''; return; }
      host.dataset.open = '1';
      host.classList.remove('bulk-out');
      host.style.height = 'auto';
      const h = host.offsetHeight;
      host.style.height = '0px';
      void host.offsetHeight;
      host.classList.add('bulk-in');
      host.style.height = h + 'px';
      /* Класс снимаем после проявления: иначе каждое новое выделение
         перезапускало бы анимацию появления плашки. */
      clearTimeout(host.__bulkT);
      host.__bulkT = setTimeout(() => { host.style.height = ''; host.classList.remove('bulk-in'); host.__bulkT = null; }, 260);
      return;
    }
    if (!open) return;
    clearTimeout(host.__bulkT);
    host.dataset.open = '0';
    host.classList.remove('bulk-in');
    host.style.height = host.offsetHeight + 'px';
    void host.offsetHeight;
    host.classList.add('bulk-out');
    host.style.height = '0px';
    host.__bulkT = setTimeout(() => {
      host.innerHTML = '';
      host.classList.remove('bulk-out');
      host.style.height = '';
      host.__bulkT = null;
    }, 240);
  }

  /* Точечная перерисовка списка (поиск, даты) идёт мимо render():
     снимаем позиции строк до и доигрываем после. */
  function refillList(root, fn){
    const snap = flipSnap(root);
    fn();
    flipPlay(root, snap);
  }

  function animateFilterChange(root, renderFn){
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.__flipMoved = false;
    renderFn();
    if (reduce) return;
    /* Строки уже съехали FLIP-анимацией — общий сдвиг хоста поверх неё
       читается как дрожь, поэтому second-эффект не включаем. */
    if (root.__flipMoved) return;
    const h = listHost(root);
    if (!h) return;
    h.classList.remove('list-swap');
    void h.offsetWidth;
    h.classList.add('list-swap');
  }

  function peopleView(root, role){
    const u = me(); const staff = isStaff(u.role);
    /* Миграция к стабильным номерам: записи без ext.num получают следующий
       монотонный номер (по порядку в списке). Повторный вход не дублирует
       счётчик: номера уже стоят у записей, так что nextPersonNum вызывается
       только для тех, у кого его нет. */
    noDemo(S.users.filter(x=>x.role===role)).forEach(p => {
      if (p && p.ext && p.ext.num == null) p.ext.num = nextPersonNum();
    });
    const list = noDemo(S.users.filter(x=>x.role===role));
    const P_CHUNK = 60;
    let q = '', onlyBl = false;
    let psort = { key:'name', dir:1 };
    let io = null;

    /* Высота списка = «до конца экрана», как у заказов: контейнер доходит
       до самого низа окна. Фиксированный calc(100dvh - …) не подходил: на
       разных экранах/видах (карточки/таблица) шапка разной высоты, и список
       не доходил до низа. Считаем от фактического верха обёртки до низа окна. */
    const fitPeople = () => {
      if (!document.body.contains(root)) return;
      const wrapEl = root.querySelector('.pl-wrap');
      if (!wrapEl) return;
      const top = wrapEl.getBoundingClientRect().top;
      const avail = Math.round(window.innerHeight - top);
      if (avail > 0) wrapEl.style.height = Math.max(240, avail) + 'px';
    };
    if (window.__fitPeopleHandler) window.removeEventListener('resize', window.__fitPeopleHandler);
    window.__fitPeopleHandler = fitPeople;
    window.addEventListener('resize', fitPeople);

    const filteredAll = ()=>{
      const arr = list.filter(p=>{
        if (onlyBl !== (p.ext.status==='blacklisted')) return false;
        if (q && !norm(`${p.full_name} ${p.username} ${p.email} ${p.phone} ${p.ext.xlsxRow||''}`).includes(norm(q))) return false;
        return true;
      });
      const k = psort.key, d = psort.dir;
      const meta = p => role==='executor' ? executorMetrics(p) : clientMetrics(p);
      arr.sort((a,b)=>{
        let va, vb;
        if (k === 'orders'){ va = meta(a).orders; vb = meta(b).orders; }
        else if (k === 'sum'){ va = meta(a).sum || 0; vb = meta(b).sum || 0; }
        else if (k === 'earned'){ va = a.ext.earned || 0; vb = b.ext.earned || 0; }
        else if (k === 'created'){ va = a.created_at || 0; vb = b.created_at || 0; }
        else { return String(a.full_name||'').localeCompare(String(b.full_name||'')) * d; }
        return (va > vb ? 1 : va < vb ? -1 : 0) * d;
      });
      return arr;
    };

    const render = ()=>{
      const flip0 = flipSnap(root);
      const ae2 = document.activeElement;
      const keep2 = (ae2 && ae2.id === 'pl-q') ? { s:ae2.selectionStart, e:ae2.selectionEnd } : null;
      const cardsView = (S.settings.peopleView || 'cards') === 'cards';
      const filtered = filteredAll();
      root.innerHTML = `
        <div class="page-head">
          <div><h2>${role==='client'?'Клиенты':'Исполнители'}</h2>
          <div class="sub" id="pl-count">${filtered.length} записей · ${list.filter(p=>p.ext.status==='blacklisted').length} в чёрном списке · на сумму ${fmtMoney(list.reduce((a,p)=>a+(role==='executor'?executorMetrics(p).sum:clientMetrics(p).sum),0))}</div></div>
          <div class="page-actions">
            <div class="seg view-seg" id="pl-view">
              <button data-view="table" class="${cardsView?'':'on'}" title="Таблицей">${icon('table','ico-sm')}</button>
              <button data-view="cards" class="${cardsView?'on':''}" title="Карточками">${icon('cards-view','ico-sm')}</button>
            </div>
            <button class="btn btn--ghost" data-exp>${icon('export')} Экспорт</button>
            <button class="btn btn--ghost" data-inv>${icon('user-plus')} Приглашения</button>
            ${staff?`<button class="btn btn--soft" data-inline-add title="Добавить ${cardsView?'карточку':'строку'} прямо в список">${icon('plus')} <span class="inline-add-label">${cardsView?'Карточка':'Строка'}</span></button>`:''}
            ${staff?`<button class="btn btn--primary" data-add>${icon('user-plus')} ${role==='executor'?'Добавить исполнителя':'Добавить клиента'}</button>`:''}
          </div>
        </div>
        <div id="pl-bulk"></div>
        <div class="inline-add" id="pl-inline" hidden>
          <div class="inline-add__row">
            <input class="input" data-f="name" placeholder="${role==='executor'?'ФИО исполнителя *':'ФИО / Компания *'}" style="min-width:180px">
            <input class="input" data-f="email" placeholder="Email" style="min-width:160px">
            <input class="input" data-f="phone" placeholder="Телефон" style="min-width:130px">
            ${role==='executor'?`<input class="input" data-f="spec" placeholder="Специализации через запятую" style="min-width:190px">`:''}
            <button class="btn btn--primary btn--sm" type="button" data-inline-save title="Добавить">${icon('check-c','ico-sm')}</button>
            <button class="iconbtn" type="button" data-inline-cancel title="Отмена">${icon('x','ico-sm')}</button>
          </div>
          <div class="small faint" data-inline-hint>Нужно имя и хотя бы один контакт; номер присвоится автоматически</div>
        </div>
        <div class="filters">
          <div class="input-wrap">${icon('search')}<input class="input" id="pl-q" placeholder="Поиск: имя, логин, email, телефон…" value="${esc(q)}"></div>
          <label class="chip ${onlyBl?'':'on'}" id="pl-active">${icon('check-c','ico-sm')} Активные</label>
          <label class="chip ${onlyBl?'on':''}" id="pl-bl">${icon('x-c','ico-sm')} Чёрный список</label>
          <select class="input" id="pl-sort" style="width:auto;min-width:150px" title="Сортировка">
            <option value="name" ${psort.key==='name'?'selected':''}>По имени</option>
            <option value="orders" ${psort.key==='orders'?'selected':''}>По числу заказов</option>
            ${role==='executor'
              ? `<option value="earned" ${psort.key==='earned'?'selected':''}>По заработку</option>`
              : `<option value="sum" ${psort.key==='sum'?'selected':''}>По сумме заказов</option>`}
            <option value="created" ${psort.key==='created'?'selected':''}>По дате добавления</option>
          </select>
        </div>
        ${cardsView
          ? `<div class="tbl-wrap pl-wrap pl-wrap--cards" style="margin-top:2px"><div class="person-grid" id="pl-rows"></div></div>`
          : `<div class="tbl-wrap pl-wrap" style="margin-top:2px"><table class="tbl">${personHead(role, psort)}<tbody id="pl-rows"></tbody></table></div>`}`;
      bindPeople();
      fillPeople(0);
      { const ptbl = root.querySelector('.pl-wrap table.tbl'); if (ptbl && window.Cols) Cols.init(ptbl, 'people-' + role); }
      flipPlay(root, flip0);
      /* Пересчёт «до конца экрана» после отрисовки (высота шапки/футера
         зависит от вида и экрана) — и в следующем кадре, когда вёрстка осядет. */
      requestAnimationFrame(fitPeople);
      if (keep2){
        const q3 = root.querySelector('#pl-q');
        if (q3){ q3.focus(); try { q3.setSelectionRange(keep2.s, keep2.e); } catch(e){} }
      }
    };

    function updateCount(shown){
      const el = root.querySelector('#pl-count');
      if (!el) return;
      const all = filteredAll().length;
      el.textContent = all
        ? `${all} записей · ${list.filter(p=>p.ext.status==='blacklisted').length} в чёрном списке · на сумму ${fmtMoney(list.reduce((a,p)=>a+(role==='executor'?executorMetrics(p).sum:clientMetrics(p).sum),0))} · показано ${Math.min(shown, all)} из ${all}`
        : 'Никого не найдено';
    }

    function fillPeople(startIdx){
      const host = root.querySelector('#pl-rows');
      if (!host) return;
      const cardsView = (S.settings.peopleView || 'cards') === 'cards';
      const filtered = filteredAll();
      if (startIdx === 0){
        host.innerHTML = '';
        if (io){ io.disconnect(); io = null; }
        if (!filtered.length){
          host.innerHTML = cardsView
            ? `<div class="empty" style="grid-column:1/-1">${icon('clients')}<span>Никого не найдено</span></div>`
            : `<tr><td colspan="6" class="faint" style="text-align:center;padding:14px">Никого не найдено</td></tr>`;
          updateCount(0);
          return;
        }
      }
      const end = Math.min(startIdx + P_CHUNK, filtered.length);
      const docs = filtered.slice(startIdx, end).map((p,i) => cardsView ? personCard(p, role, staff, startIdx + i + 1) : personRow(p, role, staff, startIdx + i + 2)).join('');
      host.insertAdjacentHTML('beforeend', docs);
      const oldSent = root.querySelector('#pl-sentinel');
      oldSent && oldSent.remove();
      if (end < filtered.length){
        host.insertAdjacentHTML('beforeend', cardsView ? `<div id="pl-sentinel" class="faint" style="grid-column:1/-1;text-align:center;padding:10px">${icon('refresh','ico-sm spin')} Подгружаем…</div>` : `<tr id="pl-sentinel"><td colspan="6" class="faint" style="text-align:center;padding:10px">${icon('refresh','ico-sm spin')} Подгружаем…</td></tr>`);
        const sent = root.querySelector('#pl-sentinel');
        io = new IntersectionObserver(entries => {
          if (entries.some(e => e.isIntersecting)){ io.disconnect(); io = null; fillPeople(end); }
        }, { root: root.querySelector('.tbl-wrap'), rootMargin: '140px' });
        io.observe(sent);
      }
      updateCount(end);
    }

    function bindPeople(){
      const pv = $('#pl-view', root);
      if (pv) pv.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
        S.settings.peopleView = b.dataset.view; saveState();
        pv.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('on', x === b));
        render();
        animateViewSwitch(root);
        swapInlineLabel(root, '[data-inline-add] .inline-add-label');
      }));
      const qq = $('#pl-q', root);
      qq.addEventListener('input', ()=>liveSearch(()=>{ q=qq.value; render(); }));
      const ps = $('#pl-sort', root);
      ps && (ps.onchange = () => { psort.key = ps.value; psort.dir = 1; render(); });
      $('#pl-active', root).onclick = ()=>{
        onlyBl=false;
        $('#pl-active', root).classList.add('on'); $('#pl-bl', root).classList.remove('on');
        animateFilterChange(root, () => render());
      };
      $('#pl-bl', root).onclick = ()=>{
        onlyBl=true;
        $('#pl-bl', root).classList.add('on'); $('#pl-active', root).classList.remove('on');
        animateFilterChange(root, () => render());
      };
      $$('[data-add]', root).forEach(b=>b.onclick = ()=>openPersonForm(role, null));
      const plTemplate = root.querySelector('#pl-inline');
      if (plTemplate){
        const spawnPersonRow = (values)=>{
          const box = inlineSpawn(root, 'people');
          if (!box) return null;
          if (values){
            ['name','email','phone'].forEach(f=>{
              const inp = box.querySelector(`[data-f="${f}"]`);
              if (inp) inp.value = values[f] || '';
            });
          }
          const f = box.querySelector('[data-f="name"]');
          if (f) requestAnimationFrame(()=>f.focus());
          return box;
        };
        /* Каждое нажатие — новая строка, а не переключение уже открытой */
        $$('[data-inline-add]', root).forEach(b=>b.onclick = ()=> spawnPersonRow());

        const savePerson = (box)=>{
          if (!box) return;
          const v = f => { const i = box.querySelector(`[data-f="${f}"]`); return i ? i.value : ''; };
          const name = (v('name')||'').trim();
          const email = (v('email')||'').trim();
          const phone = (v('phone')||'').trim();
          const specRaw = (v('spec')||'').trim();
          const specs = specRaw ? specRaw.split(/[,;]+/).map(x=>x.trim()).filter(Boolean) : [];
          if (!name){ toast('Укажите имя', 'warn'); const i = box.querySelector('[data-f="name"]'); if (i) i.focus(); return; }
          if (!email && !phone){ toast('Нужен email или телефон', 'warn'); const i = box.querySelector('[data-f="email"]'); if (i) i.focus(); return; }
          const normE = norm(email);
          if (S.users.some(x=>x.role===role && ((x.email && norm(x.email)===normE) || (x.phone && x.phone===phone)))){ toast('Такой контакт уже существует','err'); return; }
          const drafts = [...root.querySelectorAll('.inline-add[data-clone="1"]')]
            .filter(b => b !== box && b.isConnected)
            .map(b => ({
              name: (b.querySelector('[data-f="name"]')||{}).value || '',
              email: (b.querySelector('[data-f="email"]')||{}).value || '',
              phone: (b.querySelector('[data-f="phone"]')||{}).value || '',
              spec: (b.querySelector('[data-f="spec"]')||{}).value || ''
            }));
          const nu = { id: uid(), username: normE.split('@')[0] || 'user'+Date.now(), email, pw:'inline123', role,
            full_name: name, phone, about:'', theme:'system', is_online:false, avatar:'', consent_marketing:false, tour_completed:false, created_at: Date.now(),
            ext: { specializations: specs, qualification:{}, qualOverall:0, earned:0, status:'active', workStatus:'working', comment:'',
              managerId: me().id, xlsxRow: null, num: nextPersonNum() } };
          S.users.push(nu);
          /* list — копия S.users на входе в раздел; синхронизируем, иначе
             новая персона не попадёт в рендер и класс появления не навесится */
          list.push(nu);
          logAudit(`${role==='executor'?'Исполнитель':'Клиент'} ${name} добавлен (инлайн)`, 'Люди');
          saveState();
          toast(`${name} добавлен`,'ok');
          inlineClose(box, root, ()=>{
            render();
            drafts.forEach(d => spawnPersonRow(d));
            const newPerson = root.querySelector(`[data-uid="${nu.id}"]`);
            if (newPerson){
              newPerson.classList.add('inline-in');
              setTimeout(()=>newPerson.classList.remove('inline-in'), 400);
            }
          });
        };

        if (!root.__inlinePeopleBound){ root.__inlinePeopleBound = 1;
        root.addEventListener('click', e=>{
          const box = e.target.closest && e.target.closest('.inline-add');
          if (!box || box.id) return;
          if (e.target.closest('[data-inline-save]')){ savePerson(box); return; }
          if (e.target.closest('[data-inline-cancel]')){ inlineClose(box, root); }
        });
        root.addEventListener('keydown', e=>{
          const box = e.target.closest && e.target.closest('.inline-add');
          if (!box || box.id) return;
          if (e.key === 'Enter' && e.target.tagName === 'INPUT'){ e.preventDefault(); savePerson(box); }
          if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); inlineClose(box, root); }
        });
        } /* __inlinePeopleBound */
      }
      $$('[data-inv]', root).forEach(b=>b.onclick = ()=>openInvites());
      $$('[data-exp]', root).forEach(b=>b.onclick = ()=>exportPeople(role));
      $$('th[data-psort]', root).forEach(th => th.addEventListener('click', () => {
        const key = th.dataset.psort;
        if (psort.key === key) psort.dir *= -1; else { psort.key = key; psort.dir = 1; }
        render();
      }));
      const sa = root.querySelector('#pl-sel-all');
      if (sa) sa.addEventListener('change', () => {
        root.querySelectorAll('.row-sel').forEach(c => { c.checked = sa.checked; c.checked ? psel.add(c.value) : psel.delete(c.value); });
        updatePeopleBulk();
      });
const wrap = root.querySelector('.pl-wrap');
      if (wrap){
        let lastSelPl = null;
        const applyRange = (boxes, a, b, checked) => {
          boxes.slice(a, b+1).forEach(bx => { bx.checked = checked; checked ? psel.add(bx.value) : psel.delete(bx.value); });
        };
        wrap.addEventListener('change', e => {
          const c = e.target.closest('.row-sel');
          if (!c) return;
          const boxes = [...wrap.querySelectorAll('.row-sel')];
          const idx = boxes.indexOf(c);
          if (e.shiftKey && lastSelPl !== null && lastSelPl !== idx){
            applyRange(boxes, Math.min(lastSelPl,idx), Math.max(lastSelPl,idx), c.checked);
          } else {
            c.checked ? psel.add(c.value) : psel.delete(c.value);
          }
          lastSelPl = idx;
updatePeopleBulk();
        });
        wrap.addEventListener('mousedown', e => {
          if (e.button !== 0) return;
          /* Старт drag-выделения от ЛЮБОЙ части строки/карточки человека,
             но не от интерактивных элементов. */
          const row = e.target.closest('.person-card') || e.target.closest('tr[data-uid]');
          if (!row) return;
          if (e.target.closest('button,a,input,select,label,[data-copy],[data-inline]')) return;
          dragSelPlMoved = false;
          dragSelPl = { start: [...wrap.querySelectorAll('.person-card, tr[data-uid]')].indexOf(row) };
        });
        wrap.addEventListener('mouseover', e => {
          if (!dragSelPl) return;
          const row = e.target.closest('.person-card') || e.target.closest('tr[data-uid]');
          if (!row || !dragSelPlMoved) return;
          const rows = [...wrap.querySelectorAll('.person-card, tr[data-uid]')];
          const idx = rows.indexOf(row);
          if (idx < 0) return;
          const a = Math.min(dragSelPl.start, idx), b = Math.max(dragSelPl.start, idx);
          rows.slice(a, b+1).forEach(r => { const cb = r.querySelector('.row-sel'); if (cb){ cb.checked = true; psel.add(cb.value); } });
          updatePeopleBulk();
        });
        wrap.addEventListener('mousemove', e => {
          if (!dragSelPl) return;
          if (!dragSelPl._init){ dragSelPl._x = e.clientX; dragSelPl._y = e.clientY; dragSelPl._init = true; return; }
          if (Math.abs(e.clientX - dragSelPl._x) > 3 || Math.abs(e.clientY - dragSelPl._y) > 3) dragSelPlMoved = true;
        });
        wrap.addEventListener('click', e => {
          const c = e.target.closest('.row-sel');
          if (!c) return;
          e.stopPropagation(); /* не открывать карточку персоны по клику в чекбокс */
        });
      }
      $$('[data-pbulk]', root).forEach(b=>b.addEventListener('click', () => peopleBulkAction(b.dataset.pbulk)));
    }

    function updatePeopleBulk(){
      const host = root.querySelector('#pl-bulk');
      if (!host) return;
      const n = psel.size;
      if (!n){ setBulk(host, ''); return; }
      const sum = [...psel].reduce((acc,id) => {
        const p = list.find(x => x.id === id);
        if (!p) return acc;
        const mt = role==='executor' ? executorMetrics(p) : clientMetrics(p);
        return acc + (mt.sum || 0);
      }, 0);
      setBulk(host, `<div class="card card-pad row wrap" style="padding:10px 14px;margin-bottom:12px;border-color:var(--accent)">
          <b>Выбрано: ${n} · на сумму ${fmtMoney(sum)}</b><span class="spacer"></span>
          <button class="btn btn--ghost btn--sm" data-pbulk="status">${icon('refresh')} Статус</button>
          <button class="btn btn--ghost btn--sm" data-pbulk="manager">${icon('user-plus')} Менеджер</button>
          ${role==='executor'?`<button class="btn btn--ghost btn--sm" data-pbulk="work">${icon('refresh')} Рабочий статус</button>`:''}
          <button class="btn btn--danger btn--sm" data-pbulk="del">${icon('trash')} Удалить</button>
        </div>`);
      $$('[data-pbulk]', host).forEach(b=>b.addEventListener('click', () => peopleBulkAction(b.dataset.pbulk)));
    }

    function peopleBulkAction(act){
      const ids = [...psel];
      if (!ids.length) return;
      const people = ids.map(id => list.find(x => x.id === id)).filter(Boolean);
      if (act === 'del'){
        confirmModal({ title:`Удалить ${people.length} ${role==='executor'?'исполнителя(ей)':'клиента(ов)'}?`, okText:'Удалить', danger:true, text:'Записи будут удалены. Заказы не удаляются.' }).then(ok => {
          if (!ok) return;
          S.users = S.users.filter(x => !ids.includes(x.id));
          logAudit(`Массовое удаление ${role==='executor'?'исполнителей':'клиентов'} (${people.length})`, 'Люди');
          saveState(); psel.clear(); render(); toast('Удалено','ok');
        });
        return;
      }
      if (act === 'status'){
        const opts = [
          { label:'Активен', icon:'check-c', onClick:()=>{ people.forEach(p=>p.ext.status='active'); applyPsel('Статусы обновлены'); } },
          { label:'Чёрный список', icon:'x-c', danger:true, onClick:()=>{ people.forEach(p=>p.ext.status='blacklisted'); applyPsel('Добавлены в ЧС'); } }
        ];
        showDropdown(root.querySelector('#pl-bulk'), opts);
        return;
      }
      if (act === 'manager'){
        const managers = S.users.filter(x=>['manager','top_manager'].includes(x.role));
        showDropdown(root.querySelector('#pl-bulk'), managers.map(m=>({ label:`→ ${m.full_name}`, icon:'user-plus', onClick:()=>{ people.forEach(p=>p.ext.managerId=m.id); logAudit(`Массовый перевод (${people.length}) → ${m.full_name}`,'Люди'); applyPsel('Менеджер обновлён'); } })));
        return;
      }
      if (act === 'work' && role==='executor'){
        showDropdown(root.querySelector('#pl-bulk'), [
          { label:'Работаю', icon:'check-c', onClick:()=>{ people.forEach(p=>{ p.ext.workStatus='working'; p.is_online=true; }); applyPsel('Статус: работают'); } },
          { label:'Не работаю', icon:'x-c', onClick:()=>{ people.forEach(p=>{ p.ext.workStatus='not_working'; p.is_online=false; }); applyPsel('Статус: не работают'); } }
        ]);
      }
    }

    function applyPsel(msg){
      logAudit(msg, 'Люди');
      saveState(); psel.clear(); render(); toast(msg,'ok');
    }

    /* Esc: снять всё выделение в таблице людей */
    CRM._peopleSelClear = () => {
      psel.clear();
      root.querySelectorAll('.row-sel').forEach(cb => { cb.checked = false; });
      const bulk = root.querySelector('#pl-bulk');
      if (bulk) bulk.innerHTML = '';
    };
    /* Инлайн-правка человека: имя, email, специализации, рабочий статус —
       прямо в карточке/строке, без открытия профиля. */
    function openPersonInline(el){
      if (!staff) return;
      const host = el.closest('[data-uid]');
      const p = S.users.find(x => x.id === host.dataset.uid);
      if (!p) return;
      p.ext = p.ext || {};
      const f = el.dataset.inline;
      const done = msg => { saveState(); try { logAudit(msg, 'Люди'); } catch(e){} inlineRefresh(() => render()); };
      if (f === 'name'){
        inlineField(el, { value:p.full_name, onSave:v => {
          const t = v.trim(); if (!t){ toast('Имя не может быть пустым', 'err'); return; }
          if (t === p.full_name) return;
          p.full_name = t; done('Имя «' + t + '» изменено');
        }});
        return;
      }
      if (f === 'email'){
        inlineField(el, { type:'email', value:p.email, onSave:v => {
          const t = v.trim(); if (t === (p.email||'')) return;
          p.email = t; done('Email «' + p.full_name + '» изменён');
        }});
        return;
      }
      if (f === 'specs'){
        const cur = (p.ext.specializations && p.ext.specializations.length) ? p.ext.specializations : Object.keys(p.ext.qualification || {});
        inlineField(el, { value:cur.join(', '), placeholder:'Специализации через запятую', onSave:v => {
          const arr = [...new Set(v.split(',').map(x => x.trim()).filter(Boolean))];
          const oldQ = p.ext.qualification || {};
          const q = {};
          arr.forEach(sp => { q[sp] = oldQ[sp] || 3; });
          p.ext.specializations = arr; p.ext.qualification = q;
          done('Специализации «' + p.full_name + '» обновлены');
        }});
        return;
      }
      if (f === 'workStatus'){
        if (p.ext.status === 'blacklisted') return;
        inlineField(el, { type:'select', value:p.ext.workStatus || 'working', options:[{value:'working', label:'Работаю'},{value:'not_working', label:'Не работаю'}], onSave:v => {
          if (v === (p.ext.workStatus || 'working')) return;
          p.ext.workStatus = v; done('Статус «' + p.full_name + '» изменён');
        }});
        return;
      }
    }

    root.addEventListener('click', e => {
      if (dragSelPlMoved) return; /* был drag-выделение группы, а не клик */
      const rmenu = e.target.closest('.row-menu');
      if (rmenu){
        e.stopPropagation();
        const r = rmenu.getBoundingClientRect();
        personContextMenu(rmenu.dataset.uid, role, r.left, r.bottom + 4, rmenu);
        return;
      }
      const inl = e.target.closest('[data-inline]');
      if (inl && staff){
        if (e.target.closest('.inline-input,.inline-pick')) return;
        e.stopPropagation();
        openPersonInline(inl);
        return;
      }
      const card = e.target.closest('.person-card');
      if (card){ if (e.target.closest('button')) return; openPersonCard(card.dataset.uid, role); return; }
      const row = e.target.closest('tr[data-uid]');
      if (row) openPersonCard(row.dataset.uid, role);
    });
    /* Двойной клик по строке/карточке человека — та же модалка профиля */
    root.addEventListener('dblclick', e => {
      if (e.target.closest('button,a,input,select,label')) return;
      const card = e.target.closest('.person-card');
      const row = e.target.closest('tr[data-uid]');
      const uid2 = card ? card.dataset.uid : (row ? row.dataset.uid : null);
      if (uid2) openPersonCard(uid2, role);
    });
    /* Правая кнопка по строке/карточке клиента или исполнителя — собственное
       контекстное меню (не глобальное браузерное). */
    root.addEventListener('contextmenu', e => {
      const card = e.target.closest('.person-card');
      const row = e.target.closest('tr[data-uid]');
      const uid = card ? card.dataset.uid : (row ? row.dataset.uid : null);
      if (!uid) return;
      e.preventDefault();
      personContextMenu(uid, role, e.clientX, e.clientY);
    });

    render();
  }

    function personHead(role, psort){
      const thSel = `<th style="width:34px"><input type="checkbox" id="pl-sel-all" title="Выбрать все" aria-label="Выбрать все"></th>`;
      const thNum = `<th class="pl-num-h" style="width:34px;text-align:left;color:var(--faint)">№</th>`;
      const th = (key, label) => `<th class="sortable${psort.key===key?' sort-on':''}${psort.key===key&&psort.dir<0?' sort-desc':''}" data-psort="${key}">${label}</th>`;
      return role==='executor'
        ? `<thead><tr>${thSel}${thNum}${th('name','Исполнитель')}<th>Специализации</th>${th('orders','Заказы')}<th>Выполнено</th>${th('earned','Заработано')}<th>Статус</th><th class="pl-act"></th></tr></thead>`
        : `<thead><tr>${thSel}${thNum}${th('name','Клиент')}<th>Контакт</th>${th('orders','Заказы')}${th('sum','Сумма')}<th>Статус</th><th class="pl-act"></th></tr></thead>`;
    }
    /* «…» в конце строки — те же действия, что по правому клику (как в заказах) */
    function rowMenuCell(p, staff){
      return `<td class="pl-act">${staff?`<button class="iconbtn row-menu" data-uid="${p.id}" title="Действия">${icon('more')}</button>`:''}</td>`;
    }
    function personRow(p, role, staff, num){
    const bl = p.ext.status==='blacklisted';
    /* «Написать лично»: открываем ЛС с этим пользователем (функция из app.js) */
    const dmBtn = ()=>{
      if (u.id !== p.id && typeof window.openDirectChat === 'function' && userById(p.id)){
        window.openDirectChat(p.id);
      }
    };
      const mt = role==='executor' ? executorMetrics(p) : clientMetrics(p);
      return `<tr class="${bl?'c-row--bl':''}" data-uid="${p.id}">
        <td><input type="checkbox" class="row-sel" value="${p.id}" ${psel.has(p.id)?'checked':''} aria-label="Выбрать ${esc(p.full_name)}"></td>
        <td class="pl-num" title="${p.ext&&p.ext.num?'№ '+p.ext.num:(p.ext.xlsxRow?'Строка '+p.ext.xlsxRow+' из таблицы':'№ '+num)}">${personDisplayNum(p, num)}</td>
        <td><span class="row row--start" style="gap:10px">${avatarHTML(p)}<span style="min-width:0"><b class="small" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" data-inline="name">${esc(p.full_name)}</b><span class="small faint">${esc(p.username||'')}</span></span></span></td>
        ${role==='executor'
          ? `<td class="small muted" data-inline="specs">${p.ext.qualification && Object.keys(p.ext.qualification).length ? esc(Object.keys(p.ext.qualification).join(', ')) : '—'}</td>
             <td class="mono">${mt.orders}</td><td class="mono">${mt.done}</td><td class="mono">${fmtMoney(p.ext.earned)}</td>
             <td><span data-inline="workStatus">${bl?'<span class="badge c-red">ЧС</span>':'<span class="badge '+(p.ext.workStatus==='working'?'c-green':'c-gray')+'">'+(p.ext.workStatus==='working'?'Работаю':'Не работаю')+'</span>'}</span></td>
             ${rowMenuCell(p, staff)}`
          : `<td class="small muted" data-inline="email">${esc(p.email)}</td>
             <td class="mono">${mt.orders}</td><td class="mono">${fmtMoney(mt.sum)}</td>
             <td>${bl?'<span class="badge c-red">ЧС</span>':mt.overdue?'<span class="badge c-orange">просрочки</span>':'<span class="badge c-green">активен</span>'}</td>
             ${rowMenuCell(p, staff)}`}
      </tr>`;
    }

  function personCard(p, role, staff, num){
    const bl = p.ext.status==='blacklisted';
    const mt = role==='executor' ? executorMetrics(p) : clientMetrics(p);
    return `<div class="person-card ${bl?'bl':''} ${psel.has(p.id)?'sel':''}" data-uid="${p.id}">
      <div class="row" style="gap:12px">
        <input type="checkbox" class="row-sel" value="${p.id}" ${psel.has(p.id)?'checked':''} aria-label="Выбрать ${esc(p.full_name)}">
        <span class="x-num" title="${p.ext&&p.ext.num?'№ '+p.ext.num:(p.ext.xlsxRow?'Строка '+p.ext.xlsxRow+' из таблицы':'№ '+num)}">${personDisplayNum(p, num)}</span>
        ${avatarHTML(p)}
        <div style="flex:1;min-width:0">
          <b class="small" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" data-inline="name">${esc(p.full_name)}</b>
          <span class="small faint" data-inline="email">${esc(p.email)}</span>
        </div>
        ${bl?'<span class="badge c-red">ЧС</span>':''}
      </div>
      ${role==='executor'?`
        <div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">${starsHTML(p.ext.qualOverall||0)}<span class="small faint" data-inline="specs">${p.ext.qualification && Object.keys(p.ext.qualification).length ? esc(Object.keys(p.ext.qualification).join(', ')) : 'нет специализаций'}</span></div>
        <div class="cols-3 grid small" style="gap:6px;margin-top:12px">
          <div class="stat-mini"><b>${mt.orders}</b><span>заказов</span></div>
          <div class="stat-mini"><b>${mt.done}</b><span>выполнено</span></div>
          <div class="stat-mini"><b>${fmtMoney(p.ext.earned)}</b><span>заработано</span></div>
        </div>
        <div class="row small" style="margin-top:10px;gap:6px;flex-wrap:wrap">
          <span data-inline="workStatus"><span class="badge ${p.ext.workStatus==='working'?'c-green':'c-gray'}">${p.ext.workStatus==='working'?'Работаю':'Не работаю'}</span></span>
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

  /* Стабильные номера людей (вариант 2): монотонный счётчик, каждой новой
     записи номер присваивается один раз и не переиспользуется после удаления. */
  function nextPersonNum(){
    S.settings = S.settings || {};
    /* Первая строка Excel — заголовки колонок, поэтому люди нумеруются с 2:
       номер 1 зарезервирован под шапку таблицы при импорте. */
    S.settings._personSeq = Math.max(1, S.settings._personSeq || 0) + 1;
    const n = S.settings._personSeq;
    saveState();
    return n;
  }
  /* Номер человека для отображения: стабильный ext.num; для импортированных
     без num используем номер строки книги (xlsxRow); иначе позиционный фолбэк. */
  function personDisplayNum(p, fallback){
    if (p && p.ext && p.ext.num) return p.ext.num;
    if (p && p.ext && p.ext.xlsxRow) return p.ext.xlsxRow;
    return fallback;
  }

  function openPersonForm(role, editPerson){
    const p = editPerson || { id:uid(), username:'', email:'', pw:'', role, full_name:'', phone:'', about:'', mode:'system', accent:'violet', is_online:true, avatar:'', consent_marketing:true, tour_completed:false, created_at:Date.now(), ext:{ specializations:[], qualification:{}, qualOverall:0, earned:0, status:'active', workStatus:'working', comment:'', commentPersonal:'', managerId:'' } };
    const isNew = !editPerson;
    const manOpts = S.users.filter(x=>['manager','top_manager'].includes(x.role)).map(m=>'<option value="'+m.id+'" '+(p.ext.managerId===m.id?'selected':'')+'>'+esc(m.full_name)+'</option>').join('');
    openWinModal({
      narrow:true, title: isNew ? (role==='executor'?'Новый исполнитель':'Новый клиент') : 'Редактировать профиль',
      body: '<div class="stack" style="gap:12px">' +
        '<div class="field"><label>ФИО / Название *</label><input class="input" id="pf-name" value="'+esc(p.full_name)+'"></div>' +
        '<div class="cols-2 grid" style="gap:12px">' +
          '<div class="field"><label>Email</label><input class="input" id="pf-email" value="'+esc(p.email)+'"></div>' +
          '<div class="field"><label>Телефон</label><input class="input" id="pf-phone" value="'+esc(p.phone)+'"></div>' +
        '</div>' +
        (isNew ? '<div class="field"><label>Пароль</label><input class="input" id="pf-pw" value="'+esc(p.pw||'client123')+'"></div>' : '') +
        '<div class="field"><label>О себе</label><textarea class="input" id="pf-about" rows="2">'+esc(p.about||'')+'</textarea></div>' +
        (role==='executor' ? '<div class="field"><label>Менеджер</label><select class="input" id="pf-manager">'+manOpts+'</select></div>' : '') +
        (role==='client' ? '<div class="row row--between" style="padding:10px 12px;background:var(--panel-2);border-radius:12px"><label class="check" style="display:flex;align-items:center;gap:10px;cursor:pointer"><input type="checkbox" id="pf-thinking" '+((p.ext&&p.ext.thinking)?'checked':'')+'><span class="box"><svg><use href="#i-check-c"/></svg></span><span class="small"><b>Клиент «думает»</b><br><span class="faint">Напоминать менеджеру и удалить данные по сроку</span></span></label></div>' +
          '<div class="cols-2 grid" style="gap:12px">' +
            '<div class="field"><label>Удалить данные</label><input class="input" type="date" id="pf-del-at" value="'+(p.ext&&p.ext.thinking&&p.ext.thinking.deleteAt?new Date(p.ext.thinking.deleteAt).toISOString().slice(0,10):'')+'"></div>' +
            '<div class="field"><label>Напомнить за (дней)</label><input class="input" type="number" min="0" max="30" id="pf-remind-before" value="'+((p.ext&&p.ext.thinking&&p.ext.thinking.remindBefore!=null)?p.ext.thinking.remindBefore:3)+'"></div>' +
          '</div>' : '') +
      '</div>',
      footer: '<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-save>'+(isNew?'Добавить':'Сохранить')+'</button>',
      onMount: (mask, close)=>{
        mask.querySelector('[data-x]').onclick = close;
        mask.querySelector('[data-save]').onclick = ()=>{
          const name = mask.querySelector('#pf-name').value.trim();
          if (!name){ toast('Введите имя','warn'); return; }
          p.full_name = name; p.email = mask.querySelector('#pf-email').value.trim(); p.phone = mask.querySelector('#pf-phone').value.trim(); p.about = mask.querySelector('#pf-about').value.trim();
          if (isNew){ p.pw = mask.querySelector('#pf-pw').value || 'client123'; p.username = 'user_'+uid().slice(0,5); if (p.ext) p.ext.num = nextPersonNum(); S.users.push(p); }
          if (role==='executor'){ p.ext.managerId = mask.querySelector('#pf-manager').value; }
          if (role==='client'){
            p.ext = p.ext || {};
            const thOn = !!(mask.querySelector('#pf-thinking') && mask.querySelector('#pf-thinking').checked);
            const delVal = (mask.querySelector('#pf-del-at')||{}).value || '';
            const rbVal = +(mask.querySelector('#pf-remind-before')||{}).value;
            const prev = p.ext.thinking;
            if (thOn){
              const dt = delVal ? new Date(delVal + 'T12:00:00').getTime() : Date.now() + 7*86400000;
              p.ext.thinking = {
                since: prev && prev.since ? prev.since : Date.now(),
                deleteAt: dt,
                remindBefore: isNaN(rbVal) ? 3 : Math.max(0, rbVal),
                lastRemind: prev && prev.lastRemind ? prev.lastRemind : 0
              };
              if (prev && prev.deleteAt !== dt) p.ext.thinking.lastRemind = 0; /* дата перенесена — напомним заново */
            } else {
              p.ext.thinking = null; /* «передумал» — данные остаются */
            }
          }
          if (isNew) logAudit('Добавлен ' + (role==='executor'?'исполнитель':'клиент') + ': ' + p.full_name, 'Люди');
          else logAudit('Профиль обновлён: ' + p.full_name, 'Люди');
          saveState(); close(); APP.render(); toast(isNew?((role==='executor'?'Исполнитель':'Клиент') + ' добавлен'):'Профиль обновлён','ok');
        };
      }
    });
  }


  /* Импортированный человек ещё не «в системе» (не приглашён/не входил)?
     Маркер импорта — ext.xlsxRow; факт входа/приглашения — ext.invited либо созданный
     для него invite (в invites ищем по email или по полю personId). */
  function importedNeedsInvite(p){
    if (!p || !p.ext || !p.ext.xlsxRow) return false;
    if (p.ext.invited || p.ext.activated) return false;
    if (p.email && (S.invites||[]).some(inv => inv.personId === p.id || inv.email && norm(inv.email) === norm(p.email))) return false;
    return true;
  }
  function createInviteForPerson(p){
    const u = me();
    if (!u || !isStaff(u.role)) return null;
    const role = p.role;
    if (!canInviteRole(u.role, role)) return null;
    const inv = { id: uid(), token: inviteToken(), role,
      limit: 1, used: 0, usedBy: [], personId: p.id, email: p.email || '', targetName: p.full_name,
      expiresAt: Date.now() + 30*86400000, createdAt: Date.now(), createdBy: u.id };
    S.invites = S.invites || [];
    S.invites.push(inv); saveState();
    if (p.ext) p.ext.invited = true;
    saveState();
    logAudit('Приглашён импортированный: ' + p.full_name + ' (' + (ROLE_LABEL[role]||role) + ')', 'Приглашения');
    toast('Ссылка-приглашение создана и скопирована','ok');
    return inv;
  }
  function openPersonCard(uidv, role){
    const p = userById(uidv); if (!p) return;
    if (!p.ext) p.ext = { status:'active', workStatus:'working', specializations:[], qualification:{}, qualOverall:0, earned:0, comment:'', commentPersonal:'', managerId:'' };
    /* Роль может не передаваться (например, клик по никнейму в чате):
       определяем её по самой записи, чтобы карточка открывалась у всех. */
    const roleEff = role || (p.role === 'executor' ? 'executor' : 'client');
    const isStaffUser = !['client','executor'].includes(p.role);
    const u = me(); const staff = isStaff(u.role);
    const mt = roleEff==='executor' ? executorMetrics(p) : clientMetrics(p);
    const managers = S.users.filter(x=>['manager','top_manager'].includes(x.role));
    const bl = p.ext.status==='blacklisted';

    openWinModal({
      wide:true, title: roleEff==='executor'?'Профиль исполнителя':(isStaffUser?'Профиль сотрудника':'Карточка клиента'),
      body:`<div class="cols-2 grid" style="gap:14px">
        <div class="stack" style="gap:14px">
          <div class="card card-pad">
            <div class="row pf-head" style="gap:14px">${avatarHTML(p,'avatar--lg')}
              <div class="pf-head__txt"><b style="font-size:16px">${esc(p.full_name)}</b>
                <span class="badge c-violet" style="margin-left:6px">${esc(ROLE_LABEL[p.role]||p.role)}</span><br>
                <span class="small muted"><span class="nowrap">${esc(p.email)}</span> · <span class="nowrap">${esc(p.phone)}</span></span><br>
                <span class="small faint">Должность: <b style="color:var(--text-2)">${esc(ROLE_LABEL[p.role]||p.role)}</b> · логин: <span class="mono">${esc(p.username)}</span> · с ${fmtDate(p.created_at)}</span></div>
              <span class="spacer"></span>
              ${bl?'<span class="badge c-red">В чёрном списке</span>':`<span class="badge c-green">Активен</span>`}
              <div class="pf-head__actions">
                ${(u.id!==p.id)?`<button class="btn btn--primary btn--sm" data-pf-dm>${icon('chats','ico-sm')} Написать лично</button>`
                  :`<button class="btn btn--primary btn--sm" data-pf-dm>${icon('star','ico-sm')} Избранное</button>`}
                ${staff?`<button class="btn btn--ghost btn--sm" data-pf-edit>${icon('edit','ico-sm')} Редактировать</button>`:''}
              </div>
            </div>
            ${(canChangeRoles(u.role) && p.id !== u.id) ? `<div class="row" style="gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">
              <span class="small faint">Роль в системе:</span>
              <select class="input" id="pf-role" style="width:auto;min-width:150px">
                ${['admin','top_manager','manager','executor','client'].map(r=>`<option value="${r}" ${p.role===r?'selected':''}>${ROLE_LABEL[r]||r}</option>`).join('')}
              </select>
              <button class="btn btn--ghost btn--sm" data-pf-role-save>${icon('shield','ico-sm')} Сменить роль</button>
              <span class="small faint">Менять роли может только администратор</span>
            </div>` : ''}
            ${p.about?`<p class="small" style="margin-top:12px;color:var(--text-2)">${esc(p.about)}</p>`:''}
            ${(()=>{
              const k = calcKarma(p);
              const hist = (p.karmaAdj||[]).slice(0,4);
              return `<hr>
              <div class="karma">
                <div class="row row--between" style="align-items:center">
                  <b class="small">Карма · рейтинг лояльности</b>
                  <span class="badge ${k.cls}">${k.score} · ${k.label}</span>
                </div>
                <div class="karma__bar" title="${k.score} из 100"><span style="width:${k.score}%"></span></div>
                <div class="small faint" style="margin-top:6px">Выполнено: ${k.parts.done} · проблемы: ${k.parts.problems} · доработки: ${k.parts.revisions} · реакции: ${k.parts.reactions}${k.parts.adj?` · ручные: ${k.parts.adj>0?'+':''}${k.parts.adj}`:''}</div>
                ${staff?`<div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
                  <button class="btn btn--ghost btn--sm" data-karma="5">+5</button>
                  <button class="btn btn--ghost btn--sm" data-karma="-5">−5</button>
                  <button class="btn btn--ghost btn--sm" data-karma-custom>Изменить с причиной…</button>
                </div>`:''}
                ${hist.length?`<div class="small faint" style="margin-top:8px">${hist.map(x=>`${x.delta>0?'+':''}${x.delta} — ${esc(x.reason)}`).join('<br>')}</div>`:''}
              </div>`;
            })()}
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
              ${importedNeedsInvite(p)?`<button class="btn btn--primary btn--sm btn--block" data-invite-person>${icon('user-plus')} Пригласить в систему</button>`:''}
            </div>
          </div>`:''}
        </div>
      </div>`,
      footer:`<button class="btn btn--ghost" data-x>Закрыть</button>`,
      onMount:(mask, close)=>{
        mask.querySelector('[data-x]').onclick = close;
        const dmBtn = mask.querySelector('[data-pf-dm]');
        if (dmBtn) dmBtn.onclick = ()=>{ close(); window.openDirectChat(p.id); };
        const invPersonBtn = mask.querySelector('[data-invite-person]');
        if (invPersonBtn) invPersonBtn.onclick = ()=>{
          const inv = createInviteForPerson(p);
          if (inv) {
            try { navigator.clipboard.writeText(inviteLink(inv)); } catch(e){}
            toast('Приглашение: '+inviteLink(inv),'info');
            close(); openPersonCard(p.id, roleEff);
          } else toast('Вы не можете пригласить с этой ролью','warn');
        };
        const editBtn = mask.querySelector('[data-pf-edit]');
        if (editBtn) editBtn.onclick = () => { close(); openPersonForm(role, p); };
        /* Смена роли — только админ; себе роль менять нельзя (защита от потери доступа) */
        const roleSave = mask.querySelector('[data-pf-role-save]');
        if (roleSave) roleSave.onclick = ()=>{
          const sel = mask.querySelector('#pf-role');
          const to = sel && sel.value;
          if (!to || to === p.role) return;
          if (!canChangeRoles(u.role)){ toast('Менять роли может только администратор','err'); return; }
          if (p.id === u.id){ toast('Нельзя менять собственную роль','warn'); return; }
          const from = p.role;
          p.role = to;
          if (to === 'executor' && !p.ext){
            p.ext = { status:'active', workStatus:'working', specializations:[], qualification:{}, qualOverall:0, earned:0, comment:'', commentPersonal:'', managerId:'' };
          }
          logAudit(`Смена роли: ${p.full_name} — ${ROLE_LABEL[from]||from} → ${ROLE_LABEL[to]||to}`, 'Люди');
          saveState();
          close();
          openPersonCard(p.id, to==='executor' ? 'executor' : 'client');
          APP.render();
          toast('Роль изменена: '+(ROLE_LABEL[to]||to), 'ok');
        };
        /* Карма: быстрые ±5 и правка с причиной (staff) */
        const rerenderCard = () => { close(); openPersonCard(p.id, role); };
        $$('[data-karma]', mask).forEach(b=>b.onclick = ()=>{
          const delta = Number(b.dataset.karma) || 0;
          karmaAdjust(p.id, delta, delta>0 ? 'Бонус от команды' : 'Снижение от команды');
          logAudit(`Карма: ${p.full_name} ${delta>0?'+':''}${delta}`,'Карма');
          toast(`Карма обновлена: ${calcKarma(p).score}`,'ok');
          rerenderCard();
        });
        const kCustom = mask.querySelector('[data-karma-custom]');
        if (kCustom) kCustom.onclick = ()=>{
          openWinModal({ narrow:true, title:'Изменить карму',
            body:`<div class="field"><label>Изменение (например, 5 или -10)</label><input class="input" id="km-delta" type="number" step="1" value="5"></div>
              <div class="field" style="margin-top:10px"><label>Причина</label><input class="input" id="km-reason" placeholder="За что начисляем/списываем"></div>`,
            footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-save>Применить</button>`,
            onMount:(m2, c2)=>{
              m2.querySelector('[data-x]').onclick = c2;
              m2.querySelector('[data-save]').onclick = ()=>{
                const d = Number(m2.querySelector('#km-delta').value) || 0;
                const r = (m2.querySelector('#km-reason').value||'').trim();
                if (!d){ toast('Укажите изменение кармы','warn'); return; }
                karmaAdjust(p.id, d, r || 'Корректировка');
                logAudit(`Карма: ${p.full_name} ${d>0?'+':''}${d} (${r||'без причины'})`,'Карма');
                c2(); close(); openPersonCard(p.id, role);
                toast('Карма обновлена','ok');
              };
            } });
        };
        $$('[data-ct]', mask).forEach(t=>t.onclick = ()=>{
          $$('[data-ct]', mask).forEach(x=>x.classList.remove('on')); t.classList.add('on');
          mask.querySelectorAll('[data-cm]').forEach(p2=>p2.style.display = p2.dataset.cm===t.dataset.ct?'':'none');
        });
        $$('[data-ws]', mask).forEach(b=>b.onclick = ()=>{
          p.ext.workStatus = b.dataset.ws;
          /* Сетевой статус следует за рабочим: «Не работаю» = офлайн. */
          p.is_online = (b.dataset.ws === 'working');
          logAudit(`Рабочий статус: ${p.full_name} → ${b.dataset.ws}`,'Исполнитель');
          saveState(); close(); APP.render(); toast('Рабочий статус обновлён','ok');
        });
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
            openWinModal({ narrow:true, title:'Добавить в чёрный список',
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
    openWinModal({
      narrow:true, title:'Квалификация исполнителя',
      body:`<div class="stack" style="gap:10px">${Object.keys(p.ext.qualification||{}).map(s=>`
        <div class="row row--between"><span class="small">${esc(s)}</span>
        <div class="seg" data-q-spec="${esc(s)}">${[1,2,3].map(v=>`<button data-v="${v}" class="${p.ext.qualification[s]===v?'on':''}">${'★'.repeat(v)||v}</button>`).join('')}</div></div>`).join('')}
        <p class="small faint">Изменение рейтинга требует одобрения всех менеджеров. Администратор и ТОП-менеджер меняют без голосования.</p>
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
    openWinModal({
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
    openWinModal({ title:'Реквизиты', narrow:true, route:'clients',
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
      <div class="page-head"><div><h2>Импорт и экспорт</h2><div class="sub">${window.__lastImport ? 'Добавлено '+(window.__lastImport.added||0)+' · пропущено '+(window.__lastImport.skipped||0)+' · ошибок '+(window.__lastImport.errs||0) : 'Нет импортов за эту сессию'}</div></div>${me().role==='admin'?`<div class="page-actions"><button class="btn btn--ghost btn--sm" id="il-exp">${icon('export')} Экспорт журнала</button></div>`:''}</div>
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
        <span class="small faint">условия (И), regex · приоритет сверху вниз</span></div>
        <div class="card-b stack" style="gap:9px">
          <div id="rules-list" class="stack" style="gap:8px">
            ${S.importRules.map(r=>`<div class="card card-pad" style="padding:11px 13px;background:var(--bg-2)">
              <div class="row row--between" style="gap:8px">
                <span class="badge ${r.entity==='client'?'c-green':'c-violet'}">${r.entity==='client'?'Клиент':'Заказ'}</span>
                <span class="small" style="flex:1;min-width:0;color:var(--text-2)">${esc(ruleLabel(r))}</span>
                ${admin?`<button class="iconbtn" style="width:28px;height:28px" data-ruleup="${r.id}" title="Выше приоритетом">${icon('chev-u','ico-sm')}</button>
                <button class="iconbtn" style="width:28px;height:28px" data-ruledn="${r.id}" title="Ниже приоритетом">${icon('chev-d','ico-sm')}</button>
                <button class="iconbtn" style="width:30px;height:30px" data-editrule="${r.id}" title="Изменить">${icon('edit')}</button>
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
        m.id = find('id заказа','id','заказ'); m.clientnum = find('номер клиента','клиент');
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

    const parseMoney = s => { const raw = String(s==null?'':s).trim(); if (!raw) return 0; /* Пробел/неразрывный пробел — разделитель тысяч: «1 234 567,89» → 1234567.89 */ const n = raw.replace(/[\s\u00A0]/g,'').replace(/[^0-9.,-]/g,''); if (!n) return 0; const lastComma = n.lastIndexOf(','); const lastDot = n.lastIndexOf('.'); let num = 0; if (lastComma > lastDot && lastComma > 0) num = parseFloat(n.replace(/\./g,'').replace(',','.')) || 0; else if (lastDot > -1) num = parseFloat(n) || 0; else num = parseFloat(n.replace(',','.')) || 0; return Number.isFinite(num) ? num : 0; };
    function parseExecsRaw(v){
      const out = [];
      String(v||'').split(/[,;]/).forEach(tok=>{
        const t = tok.trim();
        if (!t) return;
        const m = t.match(/^\+?(\d+)\s*[—–\-=:]\s*([\d.,\s]+)/);
        if (m) out.push({ num: +m[1], amount: parseMoney(m[2]) });
        else {
          /* «ФИО — 5000» или «ФИО: сумма»: число в конце → ссылка по имени, сумма справа */
          const mName = t.match(/^(.+?)\s*[—–\-=:]\s*([\d.,\s]+)$/);
          if (mName){ out.push({ num: mName[1].trim(), amount: parseMoney(mName[2]) }); return; }
          const m2 = t.match(/(\d+)/);
          if (m2) out.push({ num: +m2[1], amount: 0 });
          else out.push({ num: t, amount: 0 });
        }
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
        openWinModal({
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
      /* «Номер клиента»/«Номер исполнителя» = номер строки книги (данные с 2).
         Разрешение по цепочке: номер строки импорта → № строки (xlsxRow) у уже
         существующих → имя/ФИО (если в ячейке не число) → позиция в списке. */
      const resolveNum = (n, imp, base, all) => {
        if (n == null || n === '') return null;
        if (imp[n] != null) return imp[n];
        const asNum = parseInt(String(n), 10);
        if (!Number.isNaN(asNum)){
          const byRow = all.find(x => x.ext && x.ext.xlsxRow === asNum);
          if (byRow) return byRow.id;
          /* Импортированные записи нумеруются ext.num (нумерация с 2, 1 — шапка):
             без этой ветки «Номер клиента» в заказах не находил клиента. */
          const byNum = all.find(x => x.ext && x.ext.num === asNum);
          if (byNum) return byNum.id;
          if (base[asNum - 2]) return base[asNum - 2].id;
        }
        const byName = all.find(x => norm(x.full_name) === norm(String(n)));
        if (byName) return byName.id;
        return null;
      };
      const clientByNum = n => resolveNum(n, _imp.clients, baseClients, S.users.filter(x=>x.role==='client'));
      const executorByNum = n => resolveNum(n, _imp.executors, baseExecs, S.users.filter(x=>x.role==='executor'));

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
          const nu = { id: uid(), username: norm(email).split('@')[0] || 'user' + rowNo, email: email || '', pw: 'import123', role: 'client', full_name: fio, phone, about: '', theme: 'system', is_online: false, avatar: '', consent_marketing: false, tour_completed: false, created_at: Date.now(),
            ext: { company: /^(ооо|ао|ип|зао)\b/i.test(fio) ? fio : '', roleIn: '', comment, discountApplied: false, managerId: me().id, status: 'active', requisites: {}, consentNews: false, xlsxRow: j.rowNo, num: nextPersonNum() } };
          applyRules('client', ruleContext('client', nu, null, j.rowNo), nu, null, n => { addLog(`[${j.sheet}] ` + n, 'rule'); ruled++; });
          S.users.push(nu); _imp.clients[j.rowNo] = nu.id; if (nu.email) clientKeys.add('e:' + norm(nu.email)); if (nu.phone) clientKeys.add('p:' + nu.phone); mark(j,'added',1); added++;
          logBuf.push([`[${j.sheet}] Строка ${rowNo}: + клиент ${fio}`, 'ok']);
        } else if (j.kind === 'executors'){
          const fio = get(r,j.map,'fio'), email = get(r,j.map,'email'), phone = get(r,j.map,'phone').replace(/[^\d+]/g,''), spec = get(r,j.map,'spec'), comment = collectComments(r,j.map);
          const earned = parseMoney(get(r,j.map,'earned'));
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
          const nu = { id: uid(), username: norm(email).split('@')[0] || 'user' + rowNo, email: email || '', pw: 'import123', role: 'executor', full_name: fio, phone, about: '', theme: 'system', is_online: false, avatar: '', consent_marketing: false, tour_completed: false, created_at: Date.now(),
            ext: { specializations: specs, qualification: {}, qualOverall: specs.length ? 1 : 0, earned, status: 'active', workStatus: 'working', comment, commentPersonal: '', managerId: me().id, xlsxRow: j.rowNo, num: nextPersonNum() } };
          S.users.push(nu); _imp.executors[j.rowNo] = nu.id; if (nu.email) execKeys.add('e:' + norm(nu.email)); if (nu.phone) execKeys.add('p:' + nu.phone); mark(j,'added',1); added++;
          logBuf.push([`[${j.sheet}] Строка ${rowNo}: + исполнитель ${fio}${earned ? ' · ' + fmtMoney(earned) : ''}`, 'ok']);
        } else {
          const oid = sanitizeOrderId(get(r,j.map,'id')) || generateOrderId();
          if (orderIdSet.has(norm(oid))){ logBuf.push([`[${j.sheet}] Строка ${rowNo}: дубликат ID ${oid} — пропущен`, 'warn']); mark(j,'skipped',1); skipped++; return; }
          orderIdSet.add(norm(oid));
          const clNum = parseInt(get(r,j.map,'clientnum'), 10);
          const cl = clientByNum(clNum);
          if (!cl){ logBuf.push([`[${j.sheet}] Строка ${rowNo}: клиент №${clNum || '?'} не найден — пропущено`, 'warn']); mark(j,'skipped',1); skipped++; return; }
          const status = STATUS_RU[norm(get(r,j.map,'status'))] || 'waiting';
          const total2 = parseMoney(get(r,j.map,'total'));
          const cert = parseMoney(get(r,j.map,'cert'));
          const dateTs = parseDateVal(get(r,j.map,'date')) || Date.now();
          const startTs = parseDateVal(get(r,j.map,'start')) || dateTs;
          const dlRaw = String(get(r,j.map,'deadline'));
          const dlTs = dlRaw ? parseDateVal(dlRaw.replace(/^до\s*/i, '')) : null;
          const execs = parseExecsRaw(get(r,j.map,'execs')).map(e => {
            const uid2 = executorByNum(e.num);
            return uid2 ? { uid: uid2, amount: e.amount, is_paid: false } : null;
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
        /* Счётчик в шапке — только про текущий сеанс: после перезагрузки
           он снова нулевой, а не показывает прошлый импорт. */
        window.__lastImport = { added, skipped, errs: domErr, ts: stamp };
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
        /* Колонки в ТОЧНОСТИ как у импорта (buildMapping orders):
           ID заказа · Номер клиента · Номера исполнителей · Дата заказа ·
           Дата начала · Дедлайн · Статус · Итого · Заверение · Комментарий.
           «Номер клиента»/«Номер исполнителя» — номер строки книги (xlsxRow)
           или позиция в списке + 2; импорт разрешает оба варианта обратно. */
        const clList = noDemo(S.users.filter(x=>x.role==='client'));
        const exList = noDemo(S.users.filter(x=>x.role==='executor'));
        const clNum = id => { const i = clList.findIndex(x=>x.id===id); if (i<0) return ''; const c = clList[i]; return c.ext && c.ext.xlsxRow ? c.ext.xlsxRow : (i+2); };
        const exNum = id => { const i = exList.findIndex(x=>x.id===id); if (i<0) return ''; const e = exList[i]; return e.ext && e.ext.xlsxRow ? e.ext.xlsxRow : (i+2); };
        return [['ID заказа','Номер клиента','Номера исполнителей','Дата заказа','Дата начала','Дедлайн','Статус','Итого','Заверение','Комментарий'],
          ...noDemo(S.orders.filter(o=>!nid||o.nish_id===nid)).map(o=>{
            const execCell = (o.executors||[]).map(e=>{
              const ex = userById(e.uid);
              if (!ex) return '';
              const num = exNum(e.uid);
              return (num ? num + ' — ' : '') + (e.amount||0);
            }).join(', ');
            return [ o.order_id,
              clNum(o.client_id),
              execCell,
              o.order_date ? fmtDate(o.order_date) : '',
              o.start_date ? fmtDate(o.start_date) : '',
              o.deadline ? fmtDT(o.deadline) : '',
              STATUS_META[o.status].label,
              o.total,
              o.certification_amount || 0,
              o.comment || ''
            ];
          })];
      }
      if (ent==='clients'){
        return [['ФИО/Компания','Логин','Email','Телефон','Комментарий','Статус','№ строки'],
          ...noDemo(S.users.filter(x=>x.role==='client')).map((x,i)=>[x.full_name,x.username,x.email,x.phone,x.ext.comment,x.ext.status,x.ext.xlsxRow||(i+2)])];
      }
      return [['ФИО','Логин','Email','Телефон','Специализации','Заработано','Статус','№ строки'],
        ...noDemo(S.users.filter(x=>x.role==='executor')).map((x,i)=>[x.full_name,x.username,x.email,x.phone,x.ext.specializations.join(', '),x.ext.earned,x.ext.status,x.ext.xlsxRow||(i+2)])];
    };
    const emitCsv = (ent, nid) => {
      const rows2 = buildRows(ent, nid);
      const csv = '\ufeff' + rows2.map(r=>r.map(c=>`"${String(c??'').replace(/"/g,'""')}"`).join(';')).join('\n');
      downloadText(`${ent}-export.csv`, csv, 'text/csv');
    };
    /* Единая книга XLSX: клиенты — по листам менеджеров, остальное — как раньше */
    const emitXlsxAll = (nid) => {
      const book = { ...clientSheets(), 'Исполнители': buildRows('executors', nid), 'Заказы': buildRows('orders', nid) };
      downloadXlsxBook(book, 'audiowizard-export.xlsx');
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
      if (expFmt === 'xlsx'){
        if (ent === 'clients') downloadXlsxBook(clientSheets(), 'clients-by-managers.xlsx');
        else emitXlsxAll(nid);
      }
      else { emitCsv(ent, nid); }
      logAudit(`Экспорт: ${ent} (${expFmt.toUpperCase()})`, 'Экспорт');
      toast('Экспорт готов — файл скачивается', 'ok');
    };

    /* правила: редактор условий + regex */
    const ruleEditor = (existing) => {
      const isNew = !existing;
      const rule = existing ? JSON.parse(JSON.stringify(existing)) : { id: uid(), entity: 'client', conditions: [{ field:'comment', op:'contains', value:'' }], action_type: 'discount', action_value: '' };
      openWinModal({
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
        /* Приоритет правил: порядок в списке = порядок применения (сверху вниз) */
        const up = e.target.closest('[data-ruleup]');
        const dn = e.target.closest('[data-ruledn]');
        if (up || dn){
          const id = (up || dn).dataset[up ? 'ruleup' : 'ruledn'];
          const arr = S.importRules;
          const i = arr.findIndex(x => x.id === id);
          const j = i + (up ? -1 : 1);
          if (i >= 0 && j >= 0 && j < arr.length){
            const [it] = arr.splice(i, 1);
            arr.splice(j, 0, it);
            saveState();
            APP.render();
            requestAnimationFrame(()=>{
              const el = (document.querySelector(`[data-ruleup="${id}"]`) || {}).closest ? document.querySelector(`[data-ruleup="${id}"]`).closest('.card') : null;
              if (el){ el.classList.add('rule-moved'); setTimeout(()=>el.classList.remove('rule-moved'), 520); }
            });
          }
        }
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
  /* Клиенты — отдельный лист на каждого менеджера: удобно передавать
     менеджеру его базу, не фильтруя общую выгрузку. Клиенты без
     назначенного менеджера и с устаревшей ссылкой идут в «Без менеджера». */
  function clientSheets(){
    const clients = noDemo(S.users.filter(x=>x.role==='client'));
    const numOf = new Map(clients.map((c,i)=>[c.id, (c.ext && c.ext.xlsxRow) || (i+2)]));
    const groups = new Map();
    clients.forEach(c=>{
      const rawMid = (c.ext && c.ext.managerId) || '';
      const mid = userById(rawMid) ? rawMid : '';
      if (!groups.has(mid)) groups.set(mid, []);
      groups.get(mid).push(c);
    });
    const rank = { top_manager:0, manager:1, admin:2 };
    const entries = [...groups.entries()].sort((a,b)=>{
      if (!a[0]) return 1;
      if (!b[0]) return -1;
      const ua = userById(a[0]), ub = userById(b[0]);
      const ra = ua ? (rank[ua.role] ?? 9) : 9;
      const rb = ub ? (rank[ub.role] ?? 9) : 9;
      if (ra !== rb) return ra - rb;
      return String(ua ? ua.full_name : '').localeCompare(String(ub ? ub.full_name : ''), 'ru');
    });
    const used = new Set();
    const sheetName = (label)=>{
      const base = String(label).replace(/[:\\/?*\[\]]/g,' ').replace(/\s+/g,' ').trim().slice(0,31) || 'Клиенты';
      let name = base, i = 2;
      while (used.has(name.toLowerCase())){
        const suffix = ` (${i++})`;
        name = base.slice(0, 31 - suffix.length).trimEnd() + suffix;
      }
      used.add(name.toLowerCase());
      return name;
    };
    const header = ['ФИО/Компания','Логин','Email','Телефон','Комментарий','Статус','№ строки'];
    const book = {};
    entries.forEach(([mid, list])=>{
      const m = mid ? userById(mid) : null;
      const label = m ? `Клиенты — ${m.full_name}` : 'Клиенты — Без менеджера';
      book[sheetName(label)] = [header, ...list.map(x=>[
        x.full_name,
        x.username,
        x.email,
        x.phone,
        (x.ext && x.ext.comment) || '',
        (x.ext && x.ext.status) || 'active',
        numOf.get(x.id)
      ])];
    });
    if (!Object.keys(book).length) book['Клиенты'] = [header];
    return book;
  }
  function downloadXlsxBook(book, name){
    const bytes = AWX.writeSheets(book);
    const blob = new Blob([bytes], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  }
  function exportPeople(role){
    if (role === 'client'){
      downloadXlsxBook(clientSheets(), 'clients-by-managers.xlsx');
      toast('XLSX по менеджерам выгружен','ok');
      return;
    }
    const rows2 = [['ФИО','Email','Телефон','Статус'], ...noDemo(S.users.filter(x=>x.role===role)).map(x=>[x.full_name,x.email,x.phone,x.ext.status])];
    downloadText(`${role}s.csv`, '\ufeff'+rows2.map(r=>r.join(';')).join('\n'), 'text/csv');
    toast('CSV выгружен','ok');
  }

  /* ==================== КАЛЬКУЛЯТОР ==================== */
  function openCalculator({ onResult=null } = {}){
    const staffView = isStaff(me().role);
    const m = openWinModal({
      narrow:true, title:'Калькулятор услуг', route:'orders',
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
      footer:`<button class="btn btn--ghost" data-x>Закрыть</button>${onResult?'<button class="btn btn--primary" data-apply2>Подставить</button>':''}<button class="btn btn--primary" data-create>${icon('plus')} Создать заказ</button>`,
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
        /* Создать заказ из калькулятора: результат → сумма нового заказа */
        const cr = mask.querySelector('[data-create]');
        if (cr) cr.onclick = ()=>{
          let sum = val + svcSum();
          close();
          openOrderForm(null, sum || 0);
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
        openWinModal({ narrow:true, title:'Новая карточка',
          body:`<div class="stack" style="gap:12px">
            <div class="field"><label>Название *</label><input class="input" id="kc-title" placeholder="Что нужно сделать"></div>
            <div class="field"><label>Колонка</label><select class="input" id="kc-col">${cols.map(cn=>`<option>${esc(cn)}</option>`).join('')}</select></div>
            <div class="field"><label>Описание</label><textarea class="input" id="kc-desc" rows="2"></textarea></div>
          </div>`,
          footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-kc-save>Добавить</button>`,
          onMount:(m2,close)=>{
            m2.querySelector('[data-x]').onclick = close;
            m2.querySelector('[data-kc-save]').onclick = ()=>{
              const title = m2.querySelector('#kc-title').value.trim();
              if (!title){ toast('Введите название карточки','warn'); return; }
              S.kbCards.push({ id:uid(), board_id:cur, column_id:m2.querySelector('#kc-col').value, position:0, title, order_id:null, description:m2.querySelector('#kc-desc').value.trim() });
              logAudit('Карточка канбана: '+title, 'Канбан'); saveState(); close(); render(); toast('Карточка добавлена','ok');
            };
          } });
      });
      const kb = $('#kb', root);
      /* Двойной клик по карточке канбана — модалка с деталями */
      kb.addEventListener('dblclick', e=>{
        const card = e.target.closest('.kb-card');
        if (!card) return;
        const c = (S.kbCards || []).find(x=>x.id === card.dataset.card);
        if (!c) return;
        openWinModal({ narrow:true, title:'Карточка', route:'kanban',
          body:`<div class="stack" style="gap:10px"><b>${esc(c.title)}</b>${c.order_id?`<span class="badge c-blue">${esc(c.order_id)}</span>`:''}${c.description?`<p class="small" style="white-space:pre-wrap;color:var(--text-2)">${esc(c.description)}</p>`:''}</div>`,
          footer:`<button class="btn btn--primary" data-x>Закрыть</button>`,
          onMount:(m2,c2)=>m2.querySelector('[data-x]').onclick=c2 });
      });
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
    openWinModal({
      narrow:true, title:'Сообщить о проблеме',
      body:`<div class="stack" style="gap:12px">
        <div class="field"><label>Тема</label><input class="input" id="tk-sub" placeholder="Коротко о проблеме"></div>
        <div class="field"><label>Описание</label><textarea class="input" id="tk-msg" placeholder="Что случилось? Шаги, ожидание и факт"></textarea></div>
        <div class="field">
          <label>Скриншот или файл</label>
          <label class="file-btn" for="tk-file">${icon('clip')} <span>Выбрать файл</span></label>
          <input class="input" type="file" id="tk-file" accept="image/*,.pdf,.zip,.doc,.docx,.xls,.xlsx,.txt" multiple hidden>
          <div id="tk-files" class="stack" style="gap:4px;margin-top:6px"></div>
        </div>
        ${orderRef?`<p class="small faint">Привязка к заказу: <b>${esc(orderRef)}</b></p>`:''}
      </div>`,
      footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-send>Отправить</button>`,
      onMount:(mask, close)=>{
        const files = [];
        const fList = mask.querySelector('#tk-files');
        const fInp = mask.querySelector('#tk-file');
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
        mask.querySelector('[data-x]').onclick = close;
        mask.querySelector('[data-send]').onclick = ()=>{
          const sub = mask.querySelector('#tk-sub').value.trim();
          if (!sub){ toast('Укажите тему','err'); return; }
          S.tickets.unshift({ id:uid(), user_id:me().id, order_id:orderRef||null, subject:sub, message:mask.querySelector('#tk-msg').value, status:'new', created_at:Date.now(), resolved_at:null, attachments: files.length ? files : undefined });
          logAudit(`Создан тикет: ${sub}` + (files.length ? ` (+${files.length} файл(ов))` : ''), 'Тикет');
          saveState(); toast('Тикет создан — менеджеры увидят его в разделе «Тикеты»','ok');
          close(); APP.render();
        };
      }
    });
  }

  /* ---------- Приглашения ----------
     Механика (как в ТГ): ссылка с токеном → регистрация по ней создаёт аккаунт
     нужной роли. Одна ссылка — N человек (лимит), срок действия, автор, отзыв. */
  function invRow(inv){
    const st = inviteStatus(inv);
    const stTxt = { active:'Активна', used:'Использована', expired:'Истекла', revoked:'Отозвана' }[st];
    const stCls = { active:'c-green', used:'c-gray', expired:'c-yellow', revoked:'c-red' }[st];
    const links = inv.usedBy || [];
    const when = inv.expiresAt ? ('до ' + fmtDT(inv.expiresAt)) : 'бессрочно';
    return `<div class="inv-row" data-token="${esc(inv.token)}" data-st="${st}">
      <div class="inv-row__main">
        <div class="inv-row__t"><b>${ROLE_LABEL[inv.role]||inv.role}</b>
          <span class="badge ${stCls}">${stTxt}</span>
          <span class="small faint">${links.length} из ${inv.limit} · ${when}${inv.email? ' · '+esc(inv.email):''}</span>
        </div>
        <div class="inv-row__link">${esc(inviteLink(inv))}</div>
        ${links.length?`<div class="small faint">Вошли: ${links.map(l=>esc((userById(l.userId)||{}).full_name||l.userId)).join(', ')}</div>`:''}
      </div>
      <div class="inv-row__acts">
        <button class="iconbtn" data-copy title="Копировать ссылку">${icon('copy','ico-sm')}</button>
        <button class="iconbtn" data-mail title="Отправить на email">${icon('mail','ico-sm')}</button>
        ${st==='active'?`<button class="iconbtn" data-revoke title="Отозвать">${icon('x','ico-sm')}</button>`:''}
      </div>
    </div>`;
  }
  function openInvites(){
    const u = me();
    if (!u) return;
    /* Кто может приглашать: staff (админ/топ/менеджер) — роли executor/client;
       исполнитель — только роль client (приглашает заказчиков). */
    const isStaffU = isStaff(u.role);
    /* Роли, доступные этому пользователю: админ — все (вкл. менеджеров/топов),
       staff — исполнитель/заказчик, исполнитель — только заказчик */
    const canRoles = INVITE_ROLES_ALL.filter(r => canInviteRole(u.role, r));
    const renderInv = (m2)=>{
      const host = m2.querySelector('#inv-list');
      const invs = noDemo(S.invites||[]).slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
      host.innerHTML = invs.length
        ? invs.map(invRow).join('')
        : '<div class="empty" style="padding:18px">'+icon('user-plus')+'<span>Приглашений пока нет — создайте первое</span></div>';
      /* Прогресс лимита */
      host.querySelectorAll('[data-copy]').forEach(b=>b.onclick = ()=>{
        const t = b.closest('.inv-row').dataset.token;
        const inv = inviteById(t);
        if (!inv) return;
        try { navigator.clipboard.writeText(inviteLink(inv)); toast('Ссылка скопирована','ok'); }
        catch(err){ toast('Не удалось скопировать','err'); }
      });
      host.querySelectorAll('[data-mail]').forEach(b=>b.onclick = ()=>{
        const t = b.closest('.inv-row').dataset.token;
        const inv = inviteById(t);
        if (!inv) return;
        if (inv.email){ /* уже отправляли — просто напоминаем */
          toast('Приглашение отправлено на '+inv.email,'info'); return;
        }
        /* Спросим email */
        openWinModal({ narrow:true, title:'Отправить приглашение',
          body:`<div class="field"><label>Email получателя</label><input class="input" id="inv-mail" placeholder="name@example.com"></div>
            <p class="small faint">Письмо с ссылкой придёт на этот адрес (демо: показать ссылку).</p>`,
          footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-go>Отправить</button>`,
          onMount:(m3,c3)=>{
            m3.querySelector('[data-x]').onclick = c3;
            m3.querySelector('[data-go]').onclick = ()=>{
              const em = (m3.querySelector('#inv-mail').value||'').trim();
              if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)){ toast('Некорректный email','warn'); return; }
              inv.email = em; saveState();
              /* демо: письмо = тост с ссылкой (как другие уведомления) */
              toast('Письмо отправлено: '+inviteLink(inv),'info');
              c3(); renderInv(m2);
            };
          } });
      });
      host.querySelectorAll('[data-revoke]').forEach(b=>b.onclick = ()=>{
        const t = b.closest('.inv-row').dataset.token;
        const inv = inviteById(t);
        if (!inv) return;
        inv.revoked = true; saveState();
        renderInv(m2); toast('Ссылка отозвана','ok');
      });
    };
    /* Личная реферальная ссылка + статистика (у всех пользователей) */
    const stats = referralStats(u.id);
    const cfg = refConfig();
    const invitedRows = stats.invited.slice(0, 8).map(r=>{
      const nu = userById(r.userId);
      if (!nu) return '';
      const earned = stats.accruals.filter(a=>a.userId===nu.id).reduce((sm,a)=>sm+(Number(a.amount)||0),0);
      return `<div class="inv-row" style="padding:8px 6px"><div class="inv-row__main">
        <div class="inv-row__t"><b>${esc(nu.full_name)}</b>
          <span class="small faint">${esc(ROLE_LABEL[nu.role]||nu.role)} · ${new Date(r.at).toLocaleDateString('ru-RU')}${earned?` · ${fmtMoney(earned)}`:''}</span>
        </div>
      </div></div>`;
    }).join('');
    const personalBlock = `
      <div class="ref-block">
        <div class="row row--between" style="align-items:center">
          <b class="small">Моя реферальная ссылка</b>
          <span class="badge ${stats.total?'c-green':'c-gray'}">Приглашено: ${stats.total}${stats.activeCount?` · активных: ${stats.activeCount}`:''}</span>
        </div>
        <div class="ref-link">
          <input class="input" id="ref-link" readonly value="${esc(refLink(u))}">
          <button class="iconbtn" id="ref-copy" title="Копировать ссылку">${icon('copy','ico-sm')}</button>
        </div>
        <div class="small faint" style="margin-top:6px">Начислено по рефералам: <b style="color:var(--text-2)">${fmtMoney(stats.earned)}</b> · процент: ${cfg.percent}% от заказов${cfg.fixedBonus?`, бонус за первый заказ: ${fmtMoney(cfg.fixedBonus)}`:''}${cfg.karmaPerRef?`, карма: +${cfg.karmaPerRef}`:''}</div>
        ${invitedRows?`<div class="small" style="margin-top:8px"><b>Мои рефералы</b></div><div class="inv-list">${invitedRows}</div>`:''}
      </div>`;

    const body = `
      ${personalBlock}
      <div class="field" style="margin-top:12px">
        <div class="row row--between" style="align-items:flex-end">
          <div style="flex:1"><label>Роль нового пользователя</label>
            <div class="seg" id="inv-role" style="margin-top:4px">
              ${canRoles.map((r,i)=>{
                const ic = r==='client' ? 'clients' : (r==='executor' ? 'executor' : (r==='admin' ? 'shield' : 'clients'));
                const lbl = { client:'Заказчик', executor:'Исполнитель', manager:'Менеджер', top_manager:'ТОП-менеджер', admin:'Администратор' }[r] || ROLE_LABEL[r] || r;
                return `<button data-role="${r}" class="${i===0?'on':''}">${icon(ic,'ico-sm')} ${lbl}</button>`;
              }).join('')}
            </div>
          </div>
          <div style="width:120px"><label>Лимит</label>
            <select class="input" id="inv-limit">
              <option value="1">1 человек</option>
              <option value="3">3 человека</option>
              <option value="5">5 человек</option>
              <option value="10">10 человек</option>
              <option value="0">Без лимита</option>
            </select>
          </div>
        </div>
        <label style="margin-top:10px">Срок действия</label>
        <select class="input" id="inv-exp">
          <option value="0">Бессрочно</option>
          <option value="1">1 день</option>
          <option value="7" selected>7 дней</option>
          <option value="30">30 дней</option>
        </select>
        <button class="btn btn--primary btn--block" id="inv-create" style="margin-top:12px">${icon('user-plus')} Создать ссылку-приглашение</button>
      </div>
      <div class="small faint" style="margin:10px 0 6px">Созданные приглашения</div>
      <div class="inv-list" id="inv-list"></div>
      ${u.role==='admin' ? `
      <div class="small" style="margin:14px 0 6px"><b>Настройки реферальной программы</b></div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <div style="width:120px"><label class="small faint">Процент</label><input class="input" id="ref-cfg-percent" type="number" min="0" max="50" value="${cfg.percent}"></div>
        <div style="width:150px"><label class="small faint">Бонус за 1-й заказ</label><input class="input" id="ref-cfg-fixed" type="number" min="0" value="${cfg.fixedBonus}"></div>
        <div style="width:110px"><label class="small faint">Карма за реферала</label><input class="input" id="ref-cfg-karma" type="number" min="0" value="${cfg.karmaPerRef}"></div>
        <div style="width:130px"><label class="small faint">Роль по ссылке</label><select class="input" id="ref-cfg-role"><option value="client" ${cfg.role==='client'?'selected':''}>Заказчик</option><option value="executor" ${cfg.role==='executor'?'selected':''}>Исполнитель</option></select></div>
      </div>
      <button class="btn btn--ghost btn--sm" id="ref-cfg-save" style="margin-top:8px">${icon('check-c','ico-sm')} Сохранить настройки</button>` : ''}`;
    openWinModal({ narrow:true, title:'Приглашения', icon:'user-plus',
      body,
      onMount:(m2,c2)=>{
        /* Личная реферальная ссылка */
        const refCopy = m2.querySelector('#ref-copy');
        if (refCopy) refCopy.onclick = ()=>{
          try { navigator.clipboard.writeText(refLink(u)); toast('Реферальная ссылка скопирована','ok'); }
          catch(e){ toast('Не удалось скопировать','err'); }
        };
        const refInput = m2.querySelector('#ref-link');
        if (refInput) refInput.onclick = ()=>{ try{ refInput.select(); }catch(e){} };
        /* Настройки программы (только админ) */
        const cfgSave = m2.querySelector('#ref-cfg-save');
        if (cfgSave) cfgSave.onclick = ()=>{
          const c2ref = refConfig();
          c2ref.percent = Math.max(0, Math.min(50, Number(m2.querySelector('#ref-cfg-percent').value)||0));
          c2ref.fixedBonus = Math.max(0, Number(m2.querySelector('#ref-cfg-fixed').value)||0);
          c2ref.karmaPerRef = Math.max(0, Number(m2.querySelector('#ref-cfg-karma').value)||0);
          c2ref.role = m2.querySelector('#ref-cfg-role').value || 'client';
          saveState();
          logAudit('Обновлены настройки реферальной программы','Рефералы');
          toast('Настройки программы сохранены','ok');
        };
        let role = canRoles[0];
        const seg = m2.querySelector('#inv-role');
        if (seg) seg.querySelectorAll('[data-role]').forEach(b=>b.onclick=()=>{
          seg.querySelectorAll('[data-role]').forEach(x=>x.classList.toggle('on',x===b));
          role = b.dataset.role;
        });
        const invCreateBtn = m2.querySelector('#inv-create');
        /* Клиентам разовые приглашения недоступны — прячем форму, оставляем личную ссылку */
        if (!canRoles.length && invCreateBtn){
          const f = invCreateBtn.closest('.field'); if (f) f.remove();
        }
        if (invCreateBtn) invCreateBtn.onclick = ()=>{
          const limit = parseInt(m2.querySelector('#inv-limit').value||'1',10);
          const days = parseInt(m2.querySelector('#inv-exp').value||'0',10);
          const inv = { id:uid(), token:inviteToken(), role,
            limit: limit || 0, used:0, usedBy:[],
            expiresAt: days ? Date.now() + days*86400000 : null,
            createdAt: Date.now(), createdBy: u.id };
          S.invites = S.invites || [];
          S.invites.push(inv); saveState();
          logAudit('Создано приглашение: '+ROLE_LABEL[role],'Приглашения');
          renderInv(m2);
          /* сразу копируем ссылку */
          try { navigator.clipboard.writeText(inviteLink(inv)); toast('Ссылка создана и скопирована','ok'); } catch(e){ toast('Ссылка создана','ok'); }
        };
        renderInv(m2);
      } });
  }
  window.openInvites = openInvites;

  return { ordersView, openOrderForm, openOrderDetail, openCalculator, openTicket, orderContextMenu,
    peopleView, projectsView, toolsView, kanbanView, setStatus, payOrder, generateOrderId, openPersonForm, openPersonCard };
})();
