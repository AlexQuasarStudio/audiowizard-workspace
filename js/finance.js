/* Финансы Audiowizard Workspace.
   Доли заказа (админ/менеджер/исполнители), остаток и превышение,
   долги по выполненным заказам, расписание выплат 1/15 в 15:00 МСК
   с полуинтервалами, ручные выплаты и данные для Smartcat.

   Все суммы считаются от o.total; ничего не дублируется в отдельных
   сущностях: долг = выполненные заказы с неоплаченными долями. */
const Finance = (function(){
  const DAY = 86400000;
  const clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n) || 0));

  function cfg(){
    const f = (S.settings && S.settings.finance) || {};
    return {
      adminMargin: clamp(f.adminMargin ?? 25, 0, 100),
      managerFee: clamp(f.managerFee ?? 10, 0, 100),
      executorShare: clamp(f.executorShare ?? 40, 0, 100),
      /* Ставка за вычитку/доработку после сдачи — по умолчанию 10% от
         суммы исполнителям; настраивается глобально и в самом заказе. */
      reviewFee: clamp(f.reviewFee ?? 10, 0, 50),
      commission: clamp(f.payoutCommission ?? 4, 0, 50),
      /* Минимумы — настраиваемые, не хардкод: 500 ₽ за заказ и 100 ₽ исполнителю
         по умолчанию; тестовый заказ их обходит. */
      minOrderTotal: Math.round(clamp(f.minOrderTotal ?? 500, 0, 10000000)),
      minExecutorPay: Math.round(clamp(f.minExecutorPay ?? 200, 0, 10000000))
    };
  }

  /* Доли заказа: исполнители (их суммы), админ (маржа), менеджер (доля),
     свободный остаток. Отрицательный остаток — превышение бюджета. */
  function split(o){
    const c = cfg();
    const total = Math.max(0, Number(o && o.total) || 0);
    const exec = ((o && o.executors) || []).reduce((a, e) => a + (Number(e.amount) || 0), 0);
    const admin = Math.round(total * c.adminMargin / 100);
    /* Менеджер сам прописывает оплату за заказ (o.managerFee, %), по умолчанию
       10%. Потолок — свободный остаток: больше, чем осталось после
       исполнителей и маржи, начислить нельзя. */
    const mgrPct = clamp(o && o.managerFee != null ? o.managerFee : c.managerFee, 0, 100);
    const managerWant = Math.round(total * mgrPct / 100);
    const manager = Math.max(0, Math.min(managerWant, total - exec - admin));
    const left = total - exec - admin - manager;
    return { total, exec, admin, manager, left, over: left < 0 ? -left : 0, cfg: c };
  }

  function addEarned(uid, delta){
    const u = (S.users || []).find(x => x.id === uid);
    if (!u) return;
    u.ext = u.ext || {};
    u.ext.earned = Math.round((u.ext.earned || 0) + delta);
  }
  /* Баланс — это начислено минус выведено и штрафы; может уходить в минус.
     Выплата (полная или частичная) уменьшает баланс получателя, включая админа и менеджера. */
  function credit(uid, amount){ addEarned(uid, Math.max(0, Number(amount) || 0)); }
  function withdraw(uid, amount){ addEarned(uid, -(Math.max(0, Number(amount) || 0))); }
  function finesFor(uid){
    return (S.fines || []).filter(f => f.uid === uid && !f.revoked_at).sort((a,b) => (b.created_at||0) - (a.created_at||0));
  }
  function finesAll(uid){
    return (S.fines || []).filter(f => f.uid === uid).sort((a,b) => (b.created_at||0) - (a.created_at||0));
  }
  function fineSum(uid){
    return finesFor(uid).reduce((a,f) => a + (Number(f.amount) || 0), 0);
  }
  /* После штрафа/отмены баланс меняется сразу во всех местах: плашка,
     открытые профили и история. Раньше обновлялся только профиль, и
     плашка могла показывать старую сумму. */
  function refreshMoneyUi(uid){
    try {
      /* CRM объявлен как const, поэтому window.CRM === undefined —
         проверяем лексический глобал через typeof. */
      if (typeof CRM !== 'undefined' && typeof CRM.refreshMoneyUsers === 'function') CRM.refreshMoneyUsers([uid]);
      else if (window.refreshSideBalance) window.refreshSideBalance();
    } catch(e){}
    try { const bp = document.querySelector('.bal-panel'); if (bp) bp.remove(); } catch(e){}
  }
  function fine(uid, amount, reason, opts = {}){
    const u = (S.users || []).find(x => x.id === uid);
    const amt = Math.round(Math.max(0, Number(amount) || 0));
    const why = String(reason || '').trim();
    if (!u || u.role === 'client' || !amt || !why) return null;
    const m = (typeof me === 'function' && me()) || {};
    const rec = {
      id: 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      uid, amount: amt, reason: why, order_id: opts.order_id || null,
      created_at: Date.now(), created_by: m.id || 'system', created_by_name: m.full_name || 'Система',
      revoked_at: null, revoked_by: null, revoked_reason: ''
    };
    S.fines = S.fines || [];
    S.fines.unshift(rec);
    withdraw(uid, amt);
    try { logAudit(`Штраф ${fmtMoney(amt)}: ${u.full_name} — ${why}`, 'Финансы'); } catch(e){}
    saveState();
    refreshMoneyUi(uid);
    return rec;
  }
  function revokeFine(id, reason){
    const f = (S.fines || []).find(x => x.id === id);
    if (!f || f.revoked_at) return false;
    const u = (S.users || []).find(x => x.id === f.uid);
    f.revoked_at = Date.now();
    f.revoked_by = (typeof me === 'function' && me() ? me().id : 'system');
    f.revoked_reason = String(reason || '').trim();
    credit(f.uid, f.amount);
    try { logAudit(`Штраф отменён: ${u ? u.full_name : f.uid} — ${fmtMoney(f.amount)}`, 'Финансы'); } catch(e){}
    saveState();
    refreshMoneyUi(f.uid);
    return true;
  }

  function adminUser(){ return (S.users || []).find(u => u.role === 'admin') || null; }
  function managerIdOf(o){
    return o.manager_id || ((S.users || []).find(u => u.role === 'manager') || {}).id || null;
  }

  /* Баланс и долг — единственный источник цифр для интерфейса.
     balanceOf — начислено минус выплачено и штрафы (может быть отрицательным);
     debtsOf — сколько ещё не выплачено по выполненным заказам. */
  function balanceOf(uid){
    const u = (S.users || []).find(x => x.id === uid);
    return Math.round(Number(u && u.ext && u.ext.earned) || 0);
  }
  function debtsOf(uid){
    return (S.orders || []).reduce((sum, o) => sum + (debts(o).byUser[uid] || 0), 0);
  }
  /* Админ — плательщик, а не получатель: его доля и остаток не попадают
     ни в «К выплате», ни в Smartcat. */
  function isPayoutRecipient(uid){
    const u = userById(uid);
    return !!(u && u.role !== 'admin' && u.role !== 'client');
  }

  /* ---------- Страховочный резерв ----------
     Это отдельные деньги платформы «на случай чего», не баланс сотрудника.
     Баланс не хранится отдельным числом: он всегда сумма opening + всех
     движений. Поэтому удаление/исправление движения не оставляет «фантомный»
     остаток, а каждое изменение имеет автора и причину. */
  const RESERVE_EVENTS = {
    orderLeft: 'Свободный остаток по выполненному заказу',
    refund: 'Возврат клиенту',
    tax: 'Налоговый резерв',
    payout: 'Выплата из резерва',
    correction: 'Корректировка'
  };
  function reserveRules(){
    const f = (S.settings && S.settings.finance) || {};
    return Object.assign({ orderLeft:true, refund:false, tax:false, payout:false }, f.reserveRules || {});
  }
  function reserveState(){
    if (!S.reserve || typeof S.reserve !== 'object' || Array.isArray(S.reserve)) S.reserve = { opening:0, entries:[] };
    if (!Array.isArray(S.reserve.entries)) S.reserve.entries = [];
    return S.reserve;
  }
  function reserveBalance(){
    const r = reserveState();
    return Math.round((Number(r.opening) || 0) + r.entries.reduce((a, e) => a + (Number(e.amount) || 0), 0));
  }
  function reserveList(){
    return reserveState().entries.slice().sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0));
  }
  /* Единая точка движения резерва. opts.system=true разрешает вызов из
     автоматических сценариев; ручные операции — только админ.
     amount со знаком: плюс — пополнение, минус — списание. */
  function reserveAdjust(amount, reason, opts = {}){
    const amt = Math.round(Number(amount) || 0);
    const why = String(reason || '').trim();
    const m = (typeof me === 'function' && me()) || {};
    if (!amt || !why) return null;
    if (!opts.system && m.role !== 'admin') return null;
    const r = reserveState();
    const rec = {
      id: 'rv' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      at: Date.now(),
      amount: amt,
      reason: why,
      comment: String(opts.comment || '').trim(),
      type: String(opts.type || (amt > 0 ? 'manual_in' : 'manual_out')),
      source: opts.system ? 'auto' : 'admin',
      order_id: opts.order_id || null,
      author_id: m.id || 'system',
      author_name: m.full_name || 'Система'
    };
    r.entries.unshift(rec);
    try { logAudit(`Резерв ${amt > 0 ? '+' : ''}${fmtMoney(amt)}: ${why}`, 'Финансы'); } catch(e){}
    saveState();
    try { window.dispatchEvent(new CustomEvent('aw:reserve-changed', { detail: rec })); } catch(e){}
    return rec;
  }
  /* Задел под автоматические сценарии: правило включается в настройках,
     а вызывающий код передаёт событие и сумму. Пока правила выключены,
     вызов ничего не меняет — исторические данные не переписываются молча. */
  function reservePost(event, amount, meta = {}){
    if (!reserveRules()[event]) return null;
    const label = RESERVE_EVENTS[event] || 'Движение резерва';
    return reserveAdjust(amount, meta.reason || label, {
      system:true, type:event, order_id:meta.order_id || null, comment:meta.comment || ''
    });
  }
  /* Админ может исправить или удалить ошибочное движение. Это не «тихая»
     правка: сохраняем автора и пишем в аудит, баланс пересчитывается из
     журнала. */
  function reserveUpdate(id, patch = {}){
    const m = (typeof me === 'function' && me()) || {};
    if (m.role !== 'admin') return null;
    const e = reserveState().entries.find(x => x.id === id);
    if (!e) return null;
    const amt = Math.round(Number(patch.amount != null ? patch.amount : e.amount) || 0);
    const why = String(patch.reason != null ? patch.reason : e.reason || '').trim();
    if (!amt || !why) return null;
    e.amount = amt;
    e.reason = why;
    if (patch.comment != null) e.comment = String(patch.comment).trim();
    e.edited_at = Date.now();
    e.edited_by = m.id || 'system';
    try { logAudit(`Резерв исправлен: ${why} → ${fmtMoney(amt)}`, 'Финансы'); } catch(e2){}
    saveState();
    try { window.dispatchEvent(new CustomEvent('aw:reserve-changed', { detail:e })); } catch(e2){}
    return e;
  }
  function reserveDelete(id){
    const m = (typeof me === 'function' && me()) || {};
    if (m.role !== 'admin') return false;
    const r = reserveState();
    const i = r.entries.findIndex(x => x.id === id);
    if (i < 0) return false;
    const e = r.entries[i];
    r.entries.splice(i, 1);
    try { logAudit(`Движение резерва удалено: ${e.reason || e.id} (${fmtMoney(e.amount)})`, 'Финансы'); } catch(e2){}
    saveState();
    try { window.dispatchEvent(new CustomEvent('aw:reserve-changed', { detail:e })); } catch(e2){}
    return true;
  }

  /* Пересчёт автоматической части по конкретному заказу. Нужен при смене
     статуса «выполнен ↔ архив/отмена» и при правке суммы: резерв должен
     следовать за заказом, а не за устаревшим снимком. */
  function reserveSyncOrder(o){
    if (!o || !o.order_id) return 0;
    const rules = reserveRules();
    if (!rules.orderLeft) return 0;
    const target = ['done','archived'].includes(o.status) ? split(o).left : 0;
    const cur = reserveState().entries
      .filter(e => e.type === 'orderLeft' && e.order_id === o.order_id)
      .reduce((a, e) => a + (Number(e.amount) || 0), 0);
    const delta = Math.round(target - cur);
    if (!delta) return 0;
    reserveAdjust(delta, `Пересчёт резерва по заказу ${o.order_id}`, {
      system:true, type:'orderLeft', order_id:o.order_id,
      comment: target ? 'Свободный остаток заказа' : 'Заказ больше не считается выполненным'
    });
    return delta;
  }

  /* Начисление при переходе в «Выполнено» и его отмена.
     Исполнителям — их суммы, админу — маржа, менеджеру заказа — его доля.
     Каждая доля помечается accrued:true, чтобы при отмене снять ровно
     начисленное и не списать дважды то, что уже выплачено. Маржа админа
     сразу уходит в вывод (paid:true) и на балансе не задерживается,
     поэтому при отмене её не трогаем. */
  function accrue(o, sign){
    if (!o) return;
    const s = split(o);
    const adm = adminUser();
    const mgrId = managerIdOf(o);
    if (sign > 0){
      (o.executors || []).forEach(e => { addEarned(e.uid, Number(e.amount) || 0); e.accrued = true; });
      if (!o.splitAccrual){
        o.splitAccrual = {
          admin: adm ? { uid: adm.id, amount: s.admin, paid: true } : null,
          manager: mgrId ? { uid: mgrId, amount: s.manager, paid: false } : null,
          exec: s.exec
        };
        if (adm){
          /* Маржа админа помечена paid:true — это сразу вывод средств,
             поэтому баланс админа не накапливает её. */
          addEarned(adm.id, s.admin);
          withdraw(adm.id, s.admin);
        }
        if (mgrId) addEarned(mgrId, s.manager);
      }
    } else {
      (o.executors || []).forEach(e => {
        /* Вычитка, добавленная уже после выполнения, не начислялась —
           при отмене статуса её снимать нельзя. */
        if (e.accrued === false) return;
        addEarned(e.uid, -(Number(e.amount) || 0));
        e.accrued = false;
      });
      const a = o.splitAccrual;
      if (a && a.manager && Number(a.manager.amount) > 0) addEarned(a.manager.uid, -a.manager.amount);
      o.splitAccrual = null;
    }
  }

  /* Долг по заказу. Исполнительская доля — остаток от amount с учётом
     частичной оплаты (e.paid); is_paid — производный признак «оплачено
     полностью». Доля менеджера — по splitAccrual.manager.paid. */
  function debts(o){
    const out = { exec: 0, manager: 0, total: 0, count: 0, byUser: {} };
    if (!o || !['done', 'archived'].includes(o.status)) return out;
    /* Архив без начисления (в архив ушёл незавершённый заказ) денег не
       образует: долг есть только у заказов, которые начислялись. */
    if (o.status === 'archived' && !o.splitAccrual && !o._accrued) return out;
    (o.executors || []).forEach(e => {
      if (!isPayoutRecipient(e.uid)) return;
      const amount = Number(e.amount) || 0;
      if (!amount) return;
      const paid = e.paid != null ? Math.max(0, Math.min(amount, Number(e.paid) || 0))
                                  : (e.is_paid ? amount : 0);
      const left = amount - paid;
      if (left <= 0) return;
      out.exec += left;
      out.byUser[e.uid] = (out.byUser[e.uid] || 0) + left;
      out.count += 1;
    });
    const a = o.splitAccrual;
    if (a && a.manager && !a.manager.paid && a.manager.amount > 0 && isPayoutRecipient(a.manager.uid)){
      out.manager += a.manager.amount;
      out.byUser[a.manager.uid] = (out.byUser[a.manager.uid] || 0) + a.manager.amount;
    }
    out.total = out.exec + out.manager;
    return out;
  }

  function hasDebt(o){ return debts(o).total > 0; }

  /* Исключения: заказы, вручную убранные из выплаты (по order_id). */
  function excludedIds(){
    const p = (S.settings && S.settings.payout) || {};
    return Array.isArray(p.excluded) ? p.excluded : [];
  }
  function isExcluded(o){ return excludedIds().includes(o && o.order_id); }
  function setExcluded(orderId, on){
    const p = payoutCfg();
    const set = new Set(excludedIds());
    if (on) set.add(orderId); else set.delete(orderId);
    p.excluded = [...set];
    S.settings.payout = p;
    saveState();
    return p.excluded;
  }
  /* Все выполненные заказы с неоплаченными долями — без привязки к периоду:
     к моменту выплаты в неё попадает всё, что ещё не оплачено. */
  function payoutOrders(){
    /* Архив — финансово тот же «выполнен», поэтому долги по нему тоже
       должны попадать в выплату, иначе деньги зависают вне выплат. */
    return (S.orders || []).filter(o => ['done','archived'].includes(o.status) && debts(o).total > 0);
  }

  /* --- Расписание выплат (по умолчанию 1-е и 15-е, 15:00 МСК) --- */
  function payoutCfg(){
    const p = Object.assign({ enabled:true, auto:true, days:[1,15], time:'15:00', tz:'Europe/Moscow' }, (S.settings && S.settings.payout) || {});
    if (!Array.isArray(p.days) || !p.days.length) p.days = [1, 15];
    return p;
  }

  /* Московское «настенное» время как Date в UTC-полях. */
  function mskNow(ts){
    const d = ts ? new Date(ts) : new Date();
    return new Date(d.getTime() + (d.getTimezoneOffset() + 180) * 60000);
  }
  /* Праздники РФ (2026) — выплата не должна падать на выходной.
     Сдвигаем НАЗАД, до предыдущего рабочего дня, и предупреждаем. */
  const HOLIDAYS = new Set([
    '2026-01-01','2026-01-02','2026-01-05','2026-01-06','2026-01-07','2026-01-08',
    '2026-02-23','2026-03-08','2026-03-09','2026-05-01','2026-05-09','2026-05-11',
    '2026-06-12','2026-11-04'
  ]);
  function isWorkday(d){
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) return false;
    const iso = d.toISOString().slice(0, 10);
    return !HOLIDAYS.has(iso);
  }
  function shiftBack(ts){
    let d = new Date(ts), moved = false, guard = 0;
    while (!isWorkday(d) && guard++ < 14){ d = new Date(d.getTime() - DAY); moved = true; }
    return { ts: d.getTime(), shifted: moved };
  }
  function cutTimestamp(year, month, day, hh, mm){
    return Date.UTC(year, month, day, hh - 3, mm, 0, 0);
  }
  function cutsAround(now){
    const p = payoutCfg();
    const [hh, mm] = String(p.time || '15:00').split(':').map(n => Number(n) || 0);
    const m = mskNow(now);
    const dayList = p.days.map(Number).filter(d => d >= 1 && d <= 28).sort((a, b) => a - b);
    if (!dayList.length) dayList.push(1, 15);
    const out = [];
    [-1, 0, 1].forEach(shift => {
      const y = m.getUTCFullYear(), mo = m.getUTCMonth() + shift;
      dayList.forEach(d => out.push(cutTimestamp(y, mo, d, hh, mm)));
    });
    return { cuts: out.sort((a, b) => a - b), cfg: p };
  }
  /* Ближайшая и последняя точки расписания (реальные cut, без сдвига). */
  function nextCut(now){ return period(now).rawTo; }
  function lastCut(now){ return period(now).rawFrom; }

  /* Разовая отмена ближайшей выплаты по расписанию: одна точка, один раз.
     Не выключает расписание целиком — только пропускает конкретный запуск. */
  function skipNextPayout(on){
    const p = payoutCfg();
    p.skipNext = on ? { at: nextCut(), by: (me() || {}).id || null, madeAt: Date.now() } : null;
    S.settings.payout = p;
    saveState();
    return p.skipNext;
  }
  function skipInfo(now){
    const p = payoutCfg();
    const s = p.skipNext;
    if (!s || !s.at) return null;
    const cut = nextCut(now);
    /* Отметка протухла — точка уже прошла, отмена израсходована. */
    if (Math.abs(s.at - cut) > 1000 && s.at < Date.now()){ p.skipNext = null; S.settings.payout = p; saveState(); return null; }
    return s;
  }

  /* Планировщик: срабатывает в 15-минутном окне после точки расписания,
     если выплаты включены и не было разовой отмены. */
  function autoTick(now){
    const p = payoutCfg();
    if (!p.enabled || !p.auto) return null;
    const t = now || Date.now();
    const cut = lastCut(t);
    if (t - cut > 15 * 60000) return null;
    if (p.lastRunAt && p.lastRunAt >= cut) return null;
    const s = p.skipNext;
    if (s && Math.abs(s.at - cut) <= 1000){
      p.skipNext = null;
      p.lastRunAt = cut;
      S.settings.payout = p;
      saveState();
      try { logAudit('Разовая отмена выплаты по расписанию: ' + new Date(cut).toLocaleString('ru-RU'), 'Оплата'); } catch(e){}
      return { skipped:true, cut };
    }
    return runPayout({ auto:true, now:t });
  }

  function period(now){
    const { cuts, cfg: p } = cutsAround(now);
    const t = now || Date.now();
    let from = null, to = null;
    for (const c of cuts){
      if (c <= t) from = c;
      if (c > t){ to = c; break; }
    }
    if (from == null) from = cuts[0];
    if (to == null) to = cuts[cuts.length - 1];
    const a = shiftBack(from), b = shiftBack(to);
    return { from: a.ts, to: b.ts, shiftedFrom: a.shifted, shiftedTo: b.shifted,
      rawFrom: from, rawTo: to, days: p.days, time: p.time, tz: p.tz };
  }
  function fmtPeriod(p){
    const f = new Date(p.from), t = new Date(p.to);
    const opts = { day:'numeric', month:'short', timeZone:'Europe/Moscow' };
    const mark = (p.shiftedFrom || p.shiftedTo) ? ' · ⚠ сдвинуто с выходного' : '';
    return `${f.toLocaleDateString('ru-RU', opts)} 15:00 — ${t.toLocaleDateString('ru-RU', opts)} 15:00 МСК${mark}`;
  }

  /* Все выполненные заказы с неоплаченными долями, кроме вручную
     исключённых. Период расписания влияет только на дату выплаты. */
  function pending(now){
    const p = period(now);
    const orders = payoutOrders().filter(o => !isExcluded(o));
    const byUser = {};
    let total = 0;
    orders.forEach(o => {
      const d = debts(o);
      Object.entries(d.byUser).forEach(([uid, amount]) => {
        if (!isPayoutRecipient(uid)) return;
        byUser[uid] = (byUser[uid] || 0) + amount;
      });
    });
    total = Object.values(byUser).reduce((a, n) => a + n, 0);
    const commission = Math.round(total * cfg().commission / 100);
    const excluded = excludedIds().length;
    return { period: p, orders, byUser, total, commission, net: total - commission, excluded };
  }

  /* Выплата (вручную или по расписанию): закрывает доли в заказах периода. */
  function runPayout(opts = {}){
    const pend = pending(opts.now);
    if (!pend.orders.length) return { ok:false, why:'Нет выполненных заказов с неоплаченными долями' };
    const by = (me() || {}).id || 'system';
    pend.orders.forEach(o => {
      (o.executors || []).forEach(e => {
        if (!isPayoutRecipient(e.uid)) return;
        const amt = Number(e.amount) || 0;
        const already = Math.max(0, Math.min(amt, Number(e.paid) || 0));
        const due = Math.max(0, amt - already);
        if (due > 0) withdraw(e.uid, due);
        e.paid = amt;
        e.is_paid = amt > 0;
      });
      if (o.splitAccrual && o.splitAccrual.manager && !o.splitAccrual.manager.paid && isPayoutRecipient(o.splitAccrual.manager.uid)){
        const m = o.splitAccrual.manager;
        if (Number(m.amount) > 0) withdraw(m.uid, m.amount);
        m.paid = true;
      }
      o.history = o.history || [];
      o.history.push({ t: Date.now(), txt: `Выплата${opts.manual ? ' (вручную)' : ' по расписанию'}: ${fmtMoney(pend.total)}` });
    });
    const p = payoutCfg();
    p.lastRunAt = Date.now();
    p.skipNext = null;
    p.history = p.history || [];
    p.history.unshift({
      t: Date.now(), by, manual: !!opts.manual, total: pend.total,
      commission: pend.commission, net: pend.net,
      orders: pend.orders.map(o => o.order_id),
      period: { from: pend.period.from, to: pend.period.to }
    });
    p.history = p.history.slice(0, 40);
    S.settings.payout = p;
    try { logAudit(`Выплата ${fmtMoney(pend.total)} (комиссия ${fmtMoney(pend.commission)})`, 'Оплата'); } catch(e){}
    saveState();
    return { ok:true, ...pend };
  }

  /* --- Smartcat --- */
  function scOf(uid){
    const u = userById(uid);
    return (u && u.ext && u.ext.smartcat) || { login:'', status:'none' };
  }
  function scStatusLabel(st){
    return { none:'Не привязан', pending:'Ожидает подтверждения', approved:'Подтверждён', rejected:'Отклонён' }[st] || 'Не привязан';
  }
  function requestSmartcat(uid, login){
    const u = userById(uid);
    if (!u) return false;
    u.ext = u.ext || {};
    u.ext.smartcat = { login: String(login || '').trim(), status:'pending', requestedBy:(me()||{}).id || uid, requestedAt: Date.now() };
    saveState();
    return true;
  }
  function approveSmartcat(uid){
    const u = userById(uid);
    if (!u || !u.ext || !u.ext.smartcat) return false;
    u.ext.smartcat.status = 'approved';
    u.ext.smartcat.approvedBy = (me() || {}).id;
    u.ext.smartcat.approvedAt = Date.now();
    saveState();
    return true;
  }
  function rejectSmartcat(uid){
    const u = userById(uid);
    if (!u || !u.ext || !u.ext.smartcat) return false;
    u.ext.smartcat.status = 'rejected';
    saveState();
    return true;
  }

  /* Платёжный payload для Smartcat: реалистичная структура для переводов.
     Документы берём из поля order.scDocs (если заполнено) или генерируем
     по заказу детерминированно — чтобы демо-данные выглядели как выгрузка. */
  const LANGS = ['en','de','fr','es','it','zh','tr','pl'];
  const LANG_RU = { en:'английского', de:'немецкого', fr:'французского', es:'испанского', it:'итальянского', zh:'китайского', tr:'турецкого', pl:'польского' };
  function docsForOrder(o){
    if (Array.isArray(o.scDocs) && o.scDocs.length) return o.scDocs;
    const seed = String(o.order_id || '').replace(/\D/g, '').slice(-4) || '1042';
    const n = Number(seed);
    const src = LANGS[n % LANGS.length];
    const words = 1200 + (n * 137) % 9000;
    const rate = 2.4 + (n % 7) * 0.35;
    return [{
      documentId: `sc-${o.order_id}-1`,
      documentName: `${o.order_id}_${src.toUpperCase()}-RU_${['contract','manual','audit','website','report'][n % 5]}.docx`,
      sourceLanguage: src,
      targetLanguage: 'ru',
      wordCount: words,
      rate: Math.round(rate * 100) / 100,
      amount: Math.round(words * rate)
    }];
  }
  function smartcatPayload(uid, entries){
    const u = userById(uid);
    if (!isPayoutRecipient(uid)) return null;
    const sc = scOf(uid);
    /* В Smartcat-выгрузку — только подтверждённые аккаунты с логином.
       Непривязанные/ожидающие остаются в ручной выплате, но не в файле:
       иначе импорт в Smartcat падает на неизвестном vendor.login. */
    if (sc.status !== 'approved' || !String(sc.login || '').trim()) return null;
    const docs = [];
    (entries || []).forEach(o => {
      /* Сумма документа должна совпадать с долгом по этому заказу: иначе
         выгрузка для оплаты не сойдётся с тем, что система должна человеку. */
      const debt = debts(o).byUser[uid] || 0;
      if (!debt) return; /* в этом заказе человеку ничего не должны */
      const raw = docsForOrder(o);
      const rawSum = raw.reduce((a, d) => a + (d.amount || 0), 0) || 1;
      raw.forEach(d => {
        const amount = debt ? Math.round(debt * (d.amount || 0) / rawSum) : d.amount;
        const rate = d.rate || 1;
        docs.push({
          ...d, amount, wordCount: Math.round(amount / rate), rate,
          orderId: o.order_id, completedAt: new Date(o.done_at || Date.now()).toISOString()
        });
      });
    });
    const amount = docs.reduce((a, d) => a + (d.amount || 0), 0);
    const commission = Math.round(amount * cfg().commission / 100);
    return {
      schema: 'smartcat.payout.v1',
      generatedAt: new Date().toISOString(),
      vendor: {
        login: String(sc.login || '').trim(),
        internalId: uid,
        fullName: (u && u.full_name) || '',
        email: (u && u.email) || ''
      },
      currency: 'RUB',
      directions: [...new Set(docs.map(d => `${d.sourceLanguage}→${d.targetLanguage}`))],
      documents: docs,
      totals: { documents: docs.length, words: docs.reduce((a, d) => a + d.wordCount, 0), amount, commission, net: amount - commission }
    };
  }

  return { cfg, split, accrue, addEarned, credit, withdraw, balanceOf, debtsOf,
    reserveRules, reserveState, reserveBalance, reserveList, reserveAdjust, reserveUpdate, reserveDelete, reservePost, reserveSyncOrder, isPayoutRecipient,
    finesFor, finesAll, fineSum, fine, revokeFine, debts, hasDebt, payoutCfg, period, fmtPeriod, pending, runPayout,
    nextCut, lastCut, skipNextPayout, skipInfo, autoTick,
    payoutOrders, excludedIds, isExcluded, setExcluded,
    scOf, scStatusLabel, requestSmartcat, approveSmartcat, rejectSmartcat, smartcatPayload, docsForOrder };
})();
window.Finance = Finance;
