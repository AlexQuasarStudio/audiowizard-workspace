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
      managerFee: clamp(f.managerFee ?? 5, 0, 100),
      commission: clamp(f.payoutCommission ?? 2, 0, 50)
    };
  }

  /* Доли заказа: исполнители (их суммы), админ (маржа), менеджер (доля),
     свободный остаток. Отрицательный остаток — превышение бюджета. */
  function split(o){
    const c = cfg();
    const total = Math.max(0, Number(o && o.total) || 0);
    const exec = ((o && o.executors) || []).reduce((a, e) => a + (Number(e.amount) || 0), 0);
    const admin = Math.round(total * c.adminMargin / 100);
    const manager = Math.round(total * c.managerFee / 100);
    const left = total - exec - admin - manager;
    return { total, exec, admin, manager, left, over: left < 0 ? -left : 0, cfg: c };
  }

  function addEarned(uid, delta){
    const u = (S.users || []).find(x => x.id === uid);
    if (!u) return;
    u.ext = u.ext || {};
    u.ext.earned = Math.max(0, Math.round((u.ext.earned || 0) + delta));
  }

  function adminUser(){ return (S.users || []).find(u => u.role === 'admin') || null; }
  function managerIdOf(o){
    return o.manager_id || ((S.users || []).find(u => u.role === 'manager') || {}).id || null;
  }

  /* Начисление при переходе в «Выполнено» и его отмена.
     Исполнителям — их суммы, админу — маржа, менеджеру заказа — его доля.
     Состав начисления хранится в самом заказе (o.splitAccrual) — этого
     достаточно, чтобы корректно отменить статус и показать долги. */
  function accrue(o, sign){
    if (!o) return;
    const s = split(o);
    const adm = adminUser();
    const mgrId = managerIdOf(o);
    if (sign > 0){
      (o.executors || []).forEach(e => addEarned(e.uid, Number(e.amount) || 0));
      if (!o.splitAccrual){
        o.splitAccrual = {
          admin: adm ? { uid: adm.id, amount: s.admin, paid: true } : null,
          manager: mgrId ? { uid: mgrId, amount: s.manager, paid: false } : null,
          exec: s.exec
        };
        if (adm) addEarned(adm.id, s.admin);
        if (mgrId) addEarned(mgrId, s.manager);
      }
    } else {
      (o.executors || []).forEach(e => { addEarned(e.uid, -(Number(e.amount) || 0)); e.is_paid = false; });
      const a = o.splitAccrual;
      if (a){
        if (a.admin) addEarned(a.admin.uid, -a.admin.amount);
        if (a.manager) addEarned(a.manager.uid, -a.manager.amount);
      }
      o.splitAccrual = null;
    }
  }

  /* Долг по заказу. Исполнительские доли — по is_paid, доля менеджера —
     по splitAccrual.manager.paid. Возвращает и разбивку по пользователям. */
  function debts(o){
    const out = { exec: 0, manager: 0, total: 0, count: 0, byUser: {} };
    if (!o || !['done', 'archived'].includes(o.status)) return out;
    (o.executors || []).forEach(e => {
      if (e.is_paid) return;
      const amount = Number(e.amount) || 0;
      if (!amount) return;
      out.exec += amount;
      out.byUser[e.uid] = (out.byUser[e.uid] || 0) + amount;
      out.count += 1;
    });
    const a = o.splitAccrual;
    if (a && a.manager && !a.manager.paid && a.manager.amount > 0){
      out.manager += a.manager.amount;
      out.byUser[a.manager.uid] = (out.byUser[a.manager.uid] || 0) + a.manager.amount;
    }
    out.total = out.exec + out.manager;
    return out;
  }

  function hasDebt(o){ return debts(o).total > 0; }

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
    return { from, to, days: p.days, time: p.time, tz: p.tz };
  }
  function fmtPeriod(p){
    const f = new Date(p.from), t = new Date(p.to);
    const opts = { day:'numeric', month:'short', timeZone:'Europe/Moscow' };
    return `${f.toLocaleDateString('ru-RU', opts)} 15:00 — ${t.toLocaleDateString('ru-RU', opts)} 15:00 МСК`;
  }

  /* Заказы, выполненные в текущем полуинтервале, с неоплаченными долями. */
  function pending(now){
    const p = period(now);
    const orders = (S.orders || []).filter(o => {
      if (o.status !== 'done') return false;
      const t = o.done_at || (o.history || []).reduce((a, h) => Math.max(a, h.t || 0), 0);
      if (!t) return false;
      return t >= p.from && t < p.to;
    }).filter(o => debts(o).total > 0);
    const byUser = {};
    let total = 0;
    orders.forEach(o => {
      const d = debts(o);
      total += d.total;
      Object.entries(d.byUser).forEach(([uid, amount]) => {
        byUser[uid] = (byUser[uid] || 0) + amount;
      });
    });
    const commission = Math.round(total * cfg().commission / 100);
    return { period: p, orders, byUser, total, commission, net: total - commission };
  }

  /* Выплата (вручную или по расписанию): закрывает доли в заказах периода. */
  function runPayout(opts = {}){
    const pend = pending(opts.now);
    if (!pend.orders.length) return { ok:false, why:'Нет выполненных заказов с неоплаченными долями в текущем периоде' };
    const by = (me() || {}).id || 'system';
    pend.orders.forEach(o => {
      (o.executors || []).forEach(e => { e.is_paid = true; });
      if (o.splitAccrual && o.splitAccrual.manager) o.splitAccrual.manager.paid = true;
      o.history = o.history || [];
      o.history.push({ t: Date.now(), txt: `Выплата${opts.manual ? ' (вручную)' : ' по расписанию'}: ${fmtMoney(pend.total)}` });
    });
    const p = payoutCfg();
    p.lastRunAt = Date.now();
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
    const sc = scOf(uid);
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
        login: sc.login || (u && u.username) || '',
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

  return { cfg, split, accrue, debts, hasDebt, payoutCfg, period, fmtPeriod, pending, runPayout,
    scOf, scStatusLabel, requestSmartcat, approveSmartcat, rejectSmartcat, smartcatPayload, docsForOrder };
})();
window.Finance = Finance;
