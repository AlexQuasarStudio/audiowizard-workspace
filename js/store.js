/* ============================================================
   Audiowizard Workspace — состояние, демо-данные, утилиты
   ============================================================ */
'use strict';

const LS_KEY = 'aw_state_v1';

const STATUS_META = {
  draft:    { label:'Черновик',    cls:'c-gray',   row:'tr-draft' },
  waiting:  { label:'В ожидании',  cls:'c-gray',   row:'tr-waiting' },
  work:     { label:'В работе',    cls:'c-yellow', row:'tr-work' },
  done:     { label:'Выполнено',   cls:'c-green',  row:'tr-done' },
  revision: { label:'В доработке', cls:'c-orange', row:'tr-revision' },
  problem:  { label:'Проблема',    cls:'c-red',    row:'tr-problem' },
  archived: { label:'В архиве',    cls:'c-gray',   row:'tr-archived' }
};
const ROLE_LABEL = {
  admin:'Администратор', top_manager:'ТОП-менеджер', manager:'Менеджер',
  executor:'Исполнитель', client:'Заказчик', marketing:'Маркетолог',
  security:'Служба безопасности', support:'Техподдержка'
};
const MODE_LIST = ['system','dark','light'];
const ACCENT_LIST = ['violet','blue','red','green','mono'];
const MODE_LABEL = { system:'Системная', dark:'Тёмная', light:'Светлая' };
const ACCENT_LABEL = { violet:'Фиолетовый', blue:'Синий', red:'Красный', green:'Зелёный', mono:'Монохром' };
const BG_LABEL = { doodle:'Дудлы', photo:'Моё фото', none:'Без фона' };

/* Горячие клавиши по умолчанию: id действия → строка-комбинация.
   Формат: модификаторы через '+' + клавиша (lowercase). */
const DEFAULT_KEYS = {
  search: 'ctrl+k',
  newOrder: 'ctrl+b',
  settings: 'ctrl+,',
  theme: 'ctrl+shift+y',
  zen: 'ctrl+shift+z'
};
/* миграция старого поля theme → mode + accent */
function migrateThemes(){
  if (!S) return;
  S.users.forEach(u => {
    if (u.mode !== undefined) return;
    const t = u.theme || 'system';
    const m = t.match(/^(dark|light)-(red|blue|green)$/);
    u.mode = m ? m[1] : 'system';
    u.accent = m ? m[2] : 'red';
    delete u.theme;
  });
}

/* ---------- Утилиты ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

/* Глобальное переопределение текста интерфейса.
   __t('dash.subtitle', 'Значение по умолчанию') → берёт S.uiText['dash.subtitle'], если задано.
   Имя __t — чтобы не конфликтовать с локальными const t в других модулях. */
const __t = (key, fallback) => (S && S.uiText && S.uiText[key] != null && S.uiText[key] !== '') ? S.uiText[key] : (fallback ?? key);
const DAY = 86400000;
const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };

const fmtMoney = n => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:0}).format(n||0);
const fmtNum = n => new Intl.NumberFormat('ru-RU').format(n||0);
const fmtDate = t => t ? new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',year:'numeric'}).format(new Date(t)) : '—';
const fmtDT = t => t ? new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(t)) : '—';
const fmtTime = t => new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'}).format(new Date(t));
const fmtDur = s => { s = Math.round(s||0); const m = Math.floor(s/60); return m >= 60 ? `${Math.floor(m/60)}:${String(m%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}` : `${m}:${String(s%60).padStart(2,'0')}`; };
const timeAgo = t => {
  const d = Date.now() - t;
  if (d < 60000) return 'только что';
  if (d < 3600000) return `${Math.floor(d/60000)} мин назад`;
  if (d < DAY) return `${Math.floor(d/3600000)} ч назад`;
  const days = Math.floor(d/DAY);
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн назад`;
  return fmtDate(t);
};
const initials = fio => (fio||'?').trim().split(/\s+/).slice(0,2).map(w=>w[0].toUpperCase()).join('');
const norm = s => String(s||'').toLowerCase().trim();
const debounce = (fn, ms=160) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };
const rndIp = () => `192.168.${1+Math.floor(Math.random()*40)}.${1+Math.floor(Math.random()*240)}`;

/* ---------- Сид-данные ---------- */
function seedState(){
  const now = Date.now(), T = today();
  const days = n => new Date(T.getTime() - n*DAY).getTime();
  const daysFwd = n => new Date(T.getTime() + n*DAY).getTime();

  const users = [
    { id:'u-admin', username:'admin', email:'admin@audiowizard.ru', pw:'admin123', role:'admin', full_name:'Алексей Дьяченко', phone:'+7 912 345-67-01', about:'Слежу за тем, чтобы всё работало как часы.', mode:'system', accent:'violet', is_online:true, avatar:'', consent_marketing:true, tour_completed:false, created_at:days(300) },
    { id:'u-top', username:'top', email:'handzhyan@audiowizard.ru', pw:'top123', role:'top_manager', full_name:'Анжелика Ханджян', phone:'+7 912 345-67-02', about:'Топ-менеджер. Приоритетное распределение заказов.', mode:'dark', accent:'violet', is_online:true, avatar:'', consent_marketing:true, tour_completed:false, created_at:days(290) },
    { id:'u-manager', username:'manager', email:'denisyuk@audiowizard.ru', pw:'manager123', role:'manager', full_name:'Андрей Денисюк', phone:'+7 912 345-67-03', about:'Веду проекты по аудио и переводам.', mode:'dark', accent:'violet', is_online:true, avatar:'', consent_marketing:true, tour_completed:false, created_at:days(240) },
    { id:'u-ex1', username:'maria', email:'maria@audiowizard.ru', pw:'executor123', role:'executor', full_name:'Мария Кузнецова', phone:'+7 903 111-22-33', about:'Стенографист, 4 года опыта. Конференции, интервью, подкасты.', mode:'system', accent:'violet', is_online:true, avatar:'', consent_marketing:false, tour_completed:false, created_at:days(200),
      ext:{ specializations:['Стенографирование','Расшифровка интервью'], qualification:{'Стенографирование':3,'Расшифровка интервью':2}, qualOverall:3, earned:268400, status:'active', workStatus:'working', comment:'', commentPersonal:'', managerId:'u-manager' } },
    { id:'u-ex2', username:'pavel', email:'pavel@audiowizard.ru', pw:'executor123', role:'executor', full_name:'Павел Смирнов', phone:'+7 903 111-22-34', about:'Копирайтинг и рерайт. Люблю сложные тексты.', mode:'dark', accent:'green', is_online:true, avatar:'', consent_marketing:true, tour_completed:false, created_at:days(190),
      ext:{ specializations:['Копирайтинг','Рерайт'], qualification:{'Копирайтинг':3,'Рерайт':3}, qualOverall:3, earned:151900, status:'active', workStatus:'working', comment:'Надёжный, сдаёт вовремя.', commentPersonal:'', managerId:'u-manager' } },
    { id:'u-ex3', username:'olga', email:'olga@audiowizard.ru', pw:'executor123', role:'executor', full_name:'Ольга Лебедева', phone:'+7 903 111-22-35', about:'Английский и немецкий. Письменные переводы.', mode:'light', accent:'red', is_online:false, avatar:'', consent_marketing:true, tour_completed:false, created_at:days(160),
      ext:{ specializations:['Письменный перевод'], qualification:{'Письменный перевод':2}, qualOverall:2, earned:98200, status:'active', workStatus:'working', comment:'', commentPersonal:'Просит заказы заранее, уходит оффлайн после 21:00.', managerId:'u-top' } },
    { id:'u-ex4', username:'dmitry', email:'dmitry@audiowizard.ru', pw:'executor123', role:'executor', full_name:'Дмитрий Ершов', phone:'+7 903 111-22-36', about:'Монтаж аудио, чистка записей.', mode:'dark', accent:'violet', is_online:false, avatar:'', consent_marketing:false, tour_completed:false, created_at:days(120),
      ext:{ specializations:['Монтаж аудио'], qualification:{'Монтаж аудио':2}, qualOverall:2, earned:47500, status:'active', workStatus:'not_working', comment:'', commentPersonal:'', managerId:'u-manager' } },
    { id:'u-ex5', username:'tanya', email:'tanya@audiowizard.ru', pw:'executor123', role:'executor', full_name:'Татьяна Морозова', phone:'+7 903 111-22-37', about:'SEO-тексты и редактура.', mode:'system', accent:'violet', is_online:false, avatar:'', consent_marketing:true, tour_completed:false, created_at:days(40),
      ext:{ specializations:['SEO-тексты','Редактура'], qualification:{'SEO-тексты':1,'Редактура':2}, qualOverall:1, earned:8600, status:'active', workStatus:'working', comment:'Новенькая. Рейтинг не подтверждён.', commentPersonal:'', managerId:'u-manager' } },
    { id:'u-ex6', username:'ilya', email:'ilya@audiowizard.ru', pw:'executor123', role:'executor', full_name:'Илья Гущин', phone:'+7 903 111-22-38', about:'Расшифровки.', mode:'system', accent:'violet', is_online:false, avatar:'', consent_marketing:false, tour_completed:false, created_at:days(210),
      ext:{ specializations:['Стенографирование'], qualification:{'Стенографирование':1}, qualOverall:1, earned:22000, status:'blacklisted', workStatus:'not_working', comment:'Нарушение сроков и передача контактов. В ЧС.', commentPersonal:'', managerId:'u-top' } },
    { id:'u-cl1', username:'client', email:'petrov@media-line.ru', pw:'client123', role:'client', full_name:'ООО «Медиа-Лайн»', phone:'+7 495 200-30-40', about:'Продюсерский центр. Подкасты и видео.', theme:'system', is_online:true, avatar:'', consent_marketing:true, tour_completed:false, created_at:days(220),
      ext:{ company:'ООО «Медиа-Лайн»', roleIn:'Сотрудник', comment:'Постоянный клиент. Скидка 10% (PROMO10).', discountApplied:true, managerId:'u-manager', status:'active', requisites:{ inn:'7712345678', kpp:'771201001', bank:'АО «Альфа-Банк»', account:'40702810123450000000', corr:'30101810200000000593', bik:'044525593', address:'г. Москва, ул. Примерная, д. 1' }, consentNews:true } },
    { id:'u-cl2', username:'sokolova_ap', email:'a.sokolova@ip-sokolova.ru', pw:'client123', role:'client', full_name:'ИП Соколова А. П.', phone:'+7 916 555-10-20', about:'Индивидуальные переводы.', mode:'dark', accent:'violet', is_online:false, avatar:'', consent_marketing:false, tour_completed:false, created_at:days(180),
      ext:{ company:'', roleIn:'', comment:'', discountApplied:false, managerId:'u-manager', status:'active', requisites:{}, consentNews:false } },
    { id:'u-cl3', username:'rgpartner', email:'office@rg-partner.ru', pw:'client123', role:'client', full_name:'ООО «РГ-Партнер»', phone:'+7 812 600-40-50', about:'Юридическая компания. Много NDA.', mode:'dark', accent:'violet', is_online:true, avatar:'', consent_marketing:true, tour_completed:false, created_at:days(150),
      ext:{ company:'ООО «РГ-Партнер»', roleIn:'Директор', comment:'Всегда NDA на заказах. Конфиденциальные материалы.', discountApplied:false, managerId:'u-top', status:'active', requisites:{ inn:'7801234567', kpp:'780101001', bank:'ПАО «Сбербанк»', account:'40702810900012345678', corr:'30101810600000000603', bik:'044030653', address:'г. Санкт-Петербург, Невский пр-т, д. 10' }, consentNews:true } },
    { id:'u-cl4', username:'voicelab', email:'hi@voicelab.studio', pw:'client123', role:'client', full_name:'Studio «VoiceLab»', phone:'+7 495 777-80-90', about:'Звукозаписывающая студия.', mode:'light', accent:'green', is_online:false, avatar:'', consent_marketing:true, tour_completed:false, created_at:days(90),
      ext:{ company:'Studio «VoiceLab»', roleIn:'Менеджер', comment:'', discountApplied:false, managerId:'u-manager', status:'active', requisites:{}, consentNews:true } },
    { id:'u-cl5', username:'fincom', email:'zakaz@finkom.ru', pw:'client123', role:'client', full_name:'АО «ФинКом»', phone:'+7 495 123-45-67', about:'Финансовая организация. Тендеры и конференции.', mode:'light', accent:'violet', is_online:true, avatar:'', consent_marketing:true, tour_completed:false, created_at:days(60),
      ext:{ company:'АО «ФинКом»', roleIn:'Сотрудник', comment:'Крупный клиент, предоплата 50%.', discountApplied:false, managerId:'u-manager', status:'active', requisites:{ inn:'9705123456', kpp:'970501001', bank:'АО «Тинькофф Банк»', account:'40701810100000001234', corr:'30101810145250000974', bik:'044525974', address:'г. Москва, ул. Финансовая, д. 5' }, consentNews:true } }
  ];

  /* Smartcat-аккаунты для выплат. Менеджеры тоже получают оплату через
     Smartcat — закладываем это сразу, чтобы модель не пришлось менять. */
  const smartcatSeed = {
    'u-ex1': { login:'maria.kuznetsova', status:'approved', approvedBy:'u-manager', approvedAt:days(40) },
    'u-ex2': { login:'pavel.smirnov.copy', status:'pending', requestedBy:'u-ex2', requestedAt:days(1) },
    'u-ex3': { login:'olga.lebedeva.translations', status:'approved', approvedBy:'u-top', approvedAt:days(70) },
    'u-ex4': { login:'dmitry.ershov.audio', status:'approved', approvedBy:'u-manager', approvedAt:days(30) },
    'u-ex5': { login:'', status:'none' },
    'u-ex6': { login:'', status:'none' },
    'u-manager': { login:'andrey.denisyuk', status:'approved', approvedBy:'u-admin', approvedAt:days(90) },
    'u-top': { login:'angelika.handzhyan', status:'approved', approvedBy:'u-admin', approvedAt:days(120) }
  };
  users.forEach(u => {
    if (!u.ext) return;
    u.ext.smartcat = smartcatSeed[u.id] || { login:'', status:'none' };
  });

  const niches = [
    { id:'n1', name:'Аудио', description:'Расшифровки, стенограммы, монтаж' },
    { id:'n2', name:'Тексты', description:'Копирайтинг, рерайт, редактура' },
    { id:'n3', name:'Переводы', description:'Письменные переводы и редактура' }
  ];
  const specializations = [
    { id:'s1', nish_id:'n1', name:'Стенографирование' }, { id:'s2', nish_id:'n1', name:'Расшифровка интервью' },
    { id:'s3', nish_id:'n1', name:'Монтаж аудио' }, { id:'s4', nish_id:'n2', name:'Копирайтинг' },
    { id:'s5', nish_id:'n2', name:'Рерайт' }, { id:'s6', nish_id:'n2', name:'SEO-тексты' },
    { id:'s7', nish_id:'n2', name:'Редактура' }, { id:'s8', nish_id:'n3', name:'Письменный перевод' },
    { id:'s9', nish_id:'n3', name:'Редактура перевода' }
  ];

  const projects = [
    { id:'p1', name:'Подкаст «Медиа-Лайн» — сезон 4', client_id:'u-cl1', nish_id:'n1', status:'active', created_at:days(80), description:'Еженедельные выпуски: расшифровки, монтаж, описания.' },
    { id:'p2', name:'Конференция FinTalk 2026', client_id:'u-cl5', nish_id:'n1', status:'active', created_at:days(30), description:'Стенографирование секций, переводы докладов.' },
    { id:'p3', name:'Каталог текстов VoiceLab', client_id:'u-cl4', nish_id:'n2', status:'archived', created_at:days(120), description:'Описание услуг студии для сайта.' }
  ];
  const folders = [
    { id:'f1', name:'Июльские расшифровки', client_id:'u-cl1', nish_id:'n1', created_at:days(70) },
    { id:'f2', name:'Договоры и NDA', client_id:'u-cl3', nish_id:'n3', created_at:days(50) }
  ];

  const mk = (id, order_id, client_id, status, total, opts={}) => ({
    id, order_id, client_id,
    order_date: opts.date ?? days(2),
    start_date: opts.start ?? opts.date ?? days(2),
    deadline: opts.deadline ?? null,
    executor_deadline: null,
    status, total,
    certification_amount: opts.cert || 0,
    comment: opts.comment || '',
    manager_id: opts.manager || 'u-manager',
    project_id: opts.project || null,
    folder_id: opts.folder || null,
    nish_id: opts.nish,
    executors: opts.execs || [],
    audio: opts.audio || 0,
    files: opts.files || [],
    proposed_price: opts.proposed || 0,
    paid_amount: opts.paid ?? (status==='done' ? total : 0),
    need_cert: !!(opts.cert),
    forbid_download: !!opts.forbid,
    portfolio_ban: true,
    nda: !!opts.nda,
    archived_at: status==='archived' ? days(3) : null,
    created_at: opts.date ?? days(2),
    history: opts.history || []
  });

  const orders = [
    mk('o1','AW-1042','u-cl1','work',34800,{ nish:'n1', project:'p1', folder:'f1', deadline:daysFwd(2), start:days(4), cert:5600, comment:'Выпуск №17. Чистка записи + расшифровка.', execs:[{uid:'u-ex1',amount:14200,is_paid:false},{uid:'u-ex4',amount:8300,is_paid:false}], audio:5340, files:[{name:'episode17_raw.m4a',size:184000000,type:'audio/x-m4a',duration:5340}], date:days(6), history:[{t:days(6),txt:'Заказ создан (Игорь Волков)'},{t:days(4),txt:'Статус: В ожидании → В работе'}] }),
    mk('o2','AW-1043','u-cl5','work',61200,{ nish:'n1', manager:'u-top', deadline:daysFwd(4), comment:'Стенограммы секций A/B, синхронный перевод — позже.', execs:[{uid:'u-ex1',amount:22500,is_paid:false},{uid:'u-ex3',amount:15000,is_paid:false}], audio:14200, files:[{name:'fintalk_day1.mp3',size:210000000,type:'audio/mpeg',duration:14200}], date:days(5), project:'p2', nda:true, history:[{t:days(5),txt:'Заказ создан (Марина Соколова)'},{t:days(3),txt:'NDA подписан всеми участниками'}] }),
    mk('o3','AW-1044','u-cl2','waiting',12800,{ nish:'n3', deadline:daysFwd(6), comment:'Перевод договоров с немецкого, 24 стр.', execs:[{uid:'u-ex3',amount:7600,is_paid:false}], date:days(1), history:[{t:days(1),txt:'Заказ создан (Игорь Волков)'}] }),
    mk('o4','AW-1045','u-cl4','waiting',9400,{ nish:'n2', proposed:8200, comment:'Тексты для лендинга. Клиент предложил свою цену.', execs:[], date:days(0), history:[{t:days(0),txt:'Заказ создан. Клиент предложил цену: 8 200 ₽'}] }),
    mk('o5','AW-1046','u-cl1','done',24100,{ nish:'n1', project:'p1', cert:3100, execs:[{uid:'u-ex1',amount:9800,is_paid:true}], audio:7420, files:[{name:'ep16_final.m4a',size:170000000,type:'audio/x-m4a',duration:7420}], date:days(9), deadline:days(4), history:[{t:days(9),txt:'Заказ создан'},{t:days(4),txt:'Статус: В работе → Выполнено. Начислен заработок исполнителям.'},{t:days(2),txt:'Получена полная оплата'}] }),
    mk('o6','AW-1047','u-cl3','done',47500,{ nish:'n3', manager:'u-top', nda:true, forbid:true, comment:'Перевод аудита. Запрет на скачивание файлов.', execs:[{uid:'u-ex3',amount:27000,is_paid:true}], date:days(15), deadline:days(6), history:[{t:days(15),txt:'Заказ создан (Марина Соколова)'},{t:days(6),txt:'Выполнено. NDA соблюдено.'}] }),
    mk('o7','AW-1048','u-cl4','revision',8600,{ nish:'n2', deadline:daysFwd(1), comment:'Правки по стилю от клиента.', execs:[{uid:'u-ex5',amount:4200,is_paid:false}], date:days(7), history:[{t:days(7),txt:'Заказ создан'},{t:days(1),txt:'Статус: Выполнено → В доработке. Начисления аннулированы.'}] }),
    mk('o8','AW-1049','u-cl1','done',18900,{ nish:'n1', project:'p1', folder:'f1', execs:[{uid:'u-ex1',amount:7600,is_paid:true}], audio:4980, files:[{name:'ep15.m4a',size:96000000,type:'audio/x-m4a',duration:4980}], date:days(16), deadline:days(9), history:[{t:days(9),txt:'Выполнено и оплачено'}] }),
    mk('o9','AW-1050','u-cl5','problem',30800,{ nish:'n1', manager:'u-top', deadline:days(1), comment:'Трек испорчен при передаче, нужен дубль.', execs:[{uid:'u-ex1',amount:12000,is_paid:false}], audio:9100, date:days(8), history:[{t:days(8),txt:'Заказ создан'},{t:days(1),txt:'Статус: В работе → Проблема. Создан тикет #3'}] }),
    mk('o10','AW-1051','u-cl3','work',27400,{ nish:'n3', nda:true, deadline:daysFwd(3), start:days(2), execs:[{uid:'u-ex3',amount:15800,is_paid:false}], date:days(3), folder:'f2', history:[{t:days(3),txt:'Заказ создан (Игорь Волков)'},{t:days(2),txt:'NDA подписан'}] }),
    mk('o11','AW-1052','u-cl2','draft',5600,{ nish:'n2', comment:'Черновик: статья для блога.', execs:[], date:days(0), history:[{t:days(0),txt:'Черновик создан'}] }),
    mk('o12','AW-1035','u-cl1','archived',21500,{ nish:'n1', project:'p1', folder:'f1', execs:[{uid:'u-ex1',amount:8700,is_paid:true}], audio:4210, date:days(40), deadline:days(33), history:[{t:days(33),txt:'Выполнено'},{t:days(3),txt:'Перемещено в архив'}] }),
    mk('o13','AW-1031','u-cl4','archived',9700,{ nish:'n2', execs:[{uid:'u-ex2',amount:4800,is_paid:true}], date:days(55), deadline:days(48), history:[{t:days(48),txt:'Выполнено'},{t:days(20),txt:'Перемещено в архив'}] })
  ];

  /* Финансовые доли выполненных заказов. Хранятся в самом заказе (splitAccrual):
     админу — маржа 25%, менеджеру заказа — 5%, исполнителям — их суммы.
     Долг виден там, где доля ещё не оплачена — без отдельных сущностей. */
  orders.forEach(o => {
    if (!['done','archived'].includes(o.status)) return;
    const mgr = o.manager_id || 'u-manager';
    o.splitAccrual = {
      admin: { uid:'u-admin', amount: Math.round(o.total * 0.25), paid: true },
      manager: { uid: mgr, amount: Math.round(o.total * 0.05), paid: o.status === 'archived' },
      exec: o.executors.reduce((a, e) => a + (e.amount || 0), 0)
    };
    if (!o.done_at){
      const h = (o.history || []).reduce((a, x) => Math.max(a, x.t || 0), 0);
      o.done_at = h || o.order_date;
    }
  });
  /* Свежий выполненный заказ с долгом исполнителю — чтобы демо показывало
     «выполнено, но не оплачено» и общий долг в таблице заказов. */
  const o6demo = orders.find(o => o.order_id === 'AW-1047');
  if (o6demo){ o6demo.executors.forEach(e => { e.is_paid = false; }); o6demo.done_at = days(3); }

  const chats = [
    { id:'ch1', type:'corporate', name:'Корпоративный чат', description:'Общий чат для всех исполнителей и менеджеров', avatar:'', is_active:true, unread:{'u-admin':1,'u-manager':0} },
    { id:'ch2', type:'order', name:'Заказ AW-1042 — Подкаст', description:'Менеджер, заказчик и исполнители заказа', avatar:'', is_active:true, order_id:'o1', unread:{'u-manager':2} },
    { id:'ch3', type:'manager', name:'Менеджеры и админ', description:'Управленческий состав', avatar:'', is_active:true, system:true, unread:{'u-top':0,'u-admin':0} },
    { id:'ch4', type:'group', name:'Стенографисты', description:'Группа по специализации «Стенографирование»', avatar:'', is_active:true, unread:{} },
    { id:'ch5', type:'company', name:'VoiceLab — команда', description:'Клиенты компании и менеджер', avatar:'', is_active:true, system:true, company:'Studio «VoiceLab»', unread:{} }
  ];
  const messages = [
    { id:'m1', chat_id:'ch1', user_id:'u-admin', text:'Коллеги, добро пожаловать в новый рабочий инструмент! Нашли баг или есть идея — раздел «Идеи» всегда открыт.', created_at:days(6)+3600000, reactions:{'👍':['u-manager','u-ex1','u-ex2']} },
    { id:'m2', chat_id:'ch1', user_id:'u-ex2', text:'Красиво! Таблица заказов огонь 🔥', created_at:days(6)+7200000, reactions:{'😂':['u-ex1'],'❤️':['u-top']} },
    { id:'m3', chat_id:'ch1', user_id:'u-top', text:'Напоминаю: дедлайны ставим с запасом, клиент должен успеть проверить.', created_at:days(5)+8*3600000 },
    { id:'m4', chat_id:'ch2', user_id:'u-manager', text:'Мария, трек подкаста уже в заказе. Срок — послезавтра к 18:00.', created_at:days(3)+10*3600000 },
    { id:'m5', chat_id:'ch2', user_id:'u-ex1', text:'Приняла! Начала с первой половины, качество записи хорошее.', created_at:days(3)+11*3600000, reactions:{'👍':['u-cl1']} },
    { id:'m6', chat_id:'ch2', user_id:'u-cl1', text:'Ребята, в выпуске есть момент на 45:12 — оттуда убрать рекламную вставку, пожалуйста.', created_at:days(1)+15*3600000 },
    { id:'m7', chat_id:'ch2', user_id:'u-manager', text:'Принято, добавил в комментарий заказа.', created_at:days(1)+15*3600000+600000 },
    { id:'m8', chat_id:'ch3', user_id:'u-top', text:'AW-1050 у клиента горит. Игорь, возьми на контроль, я передала заказ себе.', created_at:days(2)+9*3600000 },
    { id:'m9', chat_id:'ch4', user_id:'u-ex1', text:'Есть у кого опыт с многочасовыми круглыми столами? Делимся шаблонами.', created_at:days(4)+12*3600000, reactions:{'🙌':['u-ex6']} },
    { id:'m10', chat_id:'ch5', user_id:'u-cl4', text:'Готовим бриф по новым текстам, скоро пришлём.', created_at:days(2)+14*3600000 }
  ];
  const polls = [
    { id:'pl1', chat_id:'ch1', user_id:'u-top', question:'Какой формат еженедельного созвона удобнее?', options:['Вторник 11:00','Четверг 16:00','Без созвона — письменно'], votes:{'Вторник 11:00':['u-manager','u-ex1'],'Четверг 16:00':['u-ex2','u-cl1']}, created_at:days(2) }
  ];

  const tickets = [
    { id:'t1', user_id:'u-ex1', order_id:'AW-1042', subject:'Не загружается вторая часть трека', message:'Файл episode17_raw.m4a отдаёт ошибку при повторной загрузке. Первая часть на месте.', status:'in_progress', created_at:days(2)+11*3600000, resolved_at:null },
    { id:'t2', user_id:'u-cl5', order_id:'AW-1050', subject:'Проблема с испорченной записью', message:'Запись с секции B повреждена. Просим разобраться и сделать дубль.', status:'new', created_at:days(1)+9*3600000, resolved_at:null },
    { id:'t3', user_id:'u-cl2', order_id:null, subject:'Вопрос по способам оплаты', message:'Можно ли оплатить по счёту от ИП?', status:'resolved', created_at:days(8)+13*3600000, resolved_at:days(7)+10*3600000 }
  ];

  const ideas = [
    { id:'i1', user_id:'u-ex1', title:'Умные шаблоны договоров', description:'Готовые шаблоны договоров с автоподстановкой реквизитов клиента — чтобы не заполнять вручную каждый раз.', likes:24, likedBy:['u-cl1','u-cl3','u-ex2','u-manager'], visibility:'all', status:'active', rewarded:true, created_at:days(20) },
    { id:'i2', user_id:'u-cl1', title:'Напоминания о дедлайне в календарь', description:'Кнопка «Добавить дедлайн в календарь» в карточке заказа. ICS-файл — и ничего не теряется.', likes:17, likedBy:['u-ex3','u-cl5'], visibility:'all', status:'active', rewarded:false, created_at:days(12) },
    { id:'i3', user_id:'u-ex2', title:'Тёмная тема с красным акцентом по умолчанию', description:'Фирменная тёмная тема смотрится дорого — сделать её стандартной для новых пользователей.', likes:9, likedBy:['u-ex1'], visibility:'executors', status:'active', rewarded:false, created_at:days(9) },
    { id:'i4', user_id:'u-cl5', title:'Сравнение цен исполнителей в заказе', description:'Показывать вилку ставок по специализации, чтобы понимать адекватность бюджета.', likes:13, likedBy:[], visibility:'clients', status:'active', rewarded:false, created_at:days(5) },
    { id:'i5', user_id:'u-ex6', title:'Спам-фильтр в общий чат', description:'(скрыта модератором — дублирует идею i3)', likes:0, likedBy:[], visibility:'executors', status:'hidden', rewarded:false, created_at:days(30) }
  ];

  const kanban = [
    { id:'kb1', name:'Производство', type:'shared', columns:['Новые','В работе','На проверке','Готово'], owner_id:null },
    { id:'kb2', name:'Мои задачи', type:'personal', columns:['План','Делаю','Готово'], owner_id:'u-manager' }
  ];
  const kbCards = [
    { id:'kc1', board_id:'kb1', column_id:'Новые', position:0, title:'Стенограмма FinTalk — секция C', order_id:'AW-1043', description:'14 200 ₽ · дедлайн 4 дня' },
    { id:'kc2', board_id:'kb1', column_id:'В работе', position:0, title:'Подкаст №17 — расшифровка', order_id:'AW-1042', description:'Мария Кузнецова' },
    { id:'kc3', board_id:'kb1', column_id:'В работе', position:1, title:'Перевод аудита (NDA)', order_id:'AW-1051', description:'Ольга Лебедева' },
    { id:'kc4', board_id:'kb1', column_id:'На проверке', position:0, title:'Правки лендинга VoiceLab', order_id:null, description:'Татьяна Морозова, ждём ответ клиента' },
    { id:'kc5', board_id:'kb1', column_id:'Готово', position:0, title:'Подкаст №16 — выпущен', order_id:'AW-1046', description:'Оплачен' },
    { id:'kc6', board_id:'kb2', column_id:'План', position:0, title:'Созвон с VoiceLab по брифу', order_id:null, description:'Среда, 12:00' },
    { id:'kc7', board_id:'kb2', column_id:'Делаю', position:0, title:'Проверить ставки по AW-1043', order_id:'AW-1043', description:'Сверить с лимитом комиссии' }
  ];

  const changelog = [
    { id:'v0', version:'0.1-prototype', title:'Прототип Audiowizard Workspace', content:'Первая версия приложения', created_at:Date.now()-3600000, is_published:true },
    { id:'v4', version:'0.1-prototype', title:'PWA-оболочка и финальная полировка', content:'Тосты, плавные модалки, глобальный поиск, офлайн-очередь, обновления через service worker.', created_at:days(1), is_published:true, demo:true },
    { id:'v1', version:'0.1-prototype', title:'Онбординг, темы и калькулятор', content:'Обучающий тур для новых ролей, пять тем оформления (включая системную), калькулятор услуг встроен в форму заказа, автосохранение черновиков и очередь офлайн-операций.', created_at:days(2), is_published:true, demo:true },
    { id:'v2', version:'0.1-prototype', title:'Чаты: реакции и опросы', content:'Реакции на сообщения, опросы с голосованием, массовые сообщения клиентам от менеджеров. Исправлена мелкая ошибка в таблице заказов.', created_at:days(6), is_published:true, demo:true },
    { id:'v3', version:'0.1-prototype', title:'Первый бета-релиз', content:'Дашборды, заказы со статусами, клиенты и исполнители, импорт/экспорт, тикеты и идеи. Добро пожаловать в Audiowizard Workspace!', created_at:days(20), is_published:true, demo:true }
  ];

  const importRules = [
    { id:'r-d1', entity:'client', conditions:[{ field:'name', op:'not_empty' }], action_type:'manager', action_value:'u-top' },
    { id:'r-a1', entity:'client', conditions:[{ field:'comment', op:'contains', value:'Андрей' }], action_type:'manager', action_value:'u-manager' },
    { id:'r-p1', entity:'client', conditions:[{ field:'comment', op:'regex', value:'промокод|скидка|PROMO10' }], action_type:'discount', action_value:'' }
  ];

  const calcServices = {
    n1:[ {id:'cs1', name:'Расшифровка записи', price:900, unit:'за час аудио', margin:25}, {id:'cs2', name:'Монтаж/чистка аудио', price:2500, unit:'за трек', margin:25}, {id:'cs3', name:'Заверение стенограммы', price:5600, unit:'за документ', margin:25} ],
    n2:[ {id:'cs4', name:'Копирайтинг', price:1200, unit:'за 1000 знаков', margin:25}, {id:'cs5', name:'Рерайт', price:700, unit:'за 1000 знаков', margin:25}, {id:'cs6', name:'SEO-оптимизация', price:1500, unit:'за статью', margin:25} ],
    n3:[ {id:'cs7', name:'Письменный перевод', price:950, unit:'за страницу', margin:25}, {id:'cs8', name:'Редактура перевода', price:500, unit:'за страницу', margin:25}, {id:'cs9', name:'Нотариальное заверение', price:2800, unit:'за документ', margin:25} ]
  };

  const notifs = [
    { id:'nf1', icon:'i-orders', title:'Заказ AW-1042 в работе', text:'Игорь Волков изменил статус заказа', t:days(4), read:{'u-manager':true} },
    { id:'nf2', icon:'i-bell', title:'Доступна версия 0.9.2-beta', text:'Онбординг, темы и калькулятор услуг. Обновите приложение.', t:Date.now()-2*3600000, read:{} },
    { id:'nf3', icon:'i-tickets', title:'Новый тикет #2', text:'АО «ФинКом»: проблема с испорченной записью', t:days(1)+9*3600000, read:{'u-manager':false} }
  ];

  /* помечаем только демо-записи аудита (seed) */
function getDemoAudit(){ return [
    { id:uid(), user:'Игорь Волков', action:'Статус заказа AW-1042: В работе', entity:'Заказ', ip:rndIp(), t:days(1)+15*3600000, demo:true },
    { id:uid(), user:'Мария Кузнецова', action:'Скачивание файла episode17_raw.m4a', entity:'Файл', ip:rndIp(), t:days(2)+10*3600000, demo:true },
    { id:uid(), user:'Марина Соколова', action:'Смена статуса AW-1046: Выполнено, начисление 9 800 ₽', entity:'Заказ', ip:rndIp(), t:days(4)+12*3600000, demo:true },
    { id:uid(), user:'Алексей Орлов', action:'Гостевой вход в аккаунт: Игорь Волков (guest access by admin)', entity:'Сессия', ip:rndIp(), t:days(5)+9*3600000, demo:true },
    { id:uid(), user:'Неизвестный IP', action:'5 неудачных попыток входа — блокировка на 15 минут', entity:'Безопасность', ip:'203.0.113.66', t:days(3)+21*3600000, demo:true }
  ];
}
const audit = getDemoAudit();

  const sessions = u => ([
    { device:'MacBook Pro · Chrome', ip:rndIp(), t:Date.now()-40*60000, current:true },
    { device:'iPhone 15 · Safari', ip:rndIp(), t:Date.now()-26*3600000 },
    { device:'Windows 11 · Edge', ip:rndIp(), t:Date.now()-3*DAY }
  ]).slice(0, u.role==='client' ? 2 : 3);

  const importLogs = [
    { t:days(3)+4*3600000, added:12, skipped:1, ruled:2, errs:0, warns:1, infos:2, file:'clients-2026.csv', entity:'clients' },
    { t:days(1)+9*3600000, added:8, skipped:0, ruled:1, errs:1, warns:0, infos:1, file:'executors.xlsx', entity:'executors' }
  ];
  const importLogLines = [
    { t:days(3)+4*3600000, file:'clients-2026.csv', entity:'clients', kind:'ok', text:'Кодировка: UTF-8 (определена автоматически)' },
    { t:days(3)+4*3600000, file:'clients-2026.csv', entity:'clients', kind:'ok', text:'[Клиенты] Строка 2: + клиент ООО «Медиа-Лайн»' },
    { t:days(3)+4*3600000, file:'clients-2026.csv', entity:'clients', kind:'rule', text:'[Клиенты] Правило: назначить менеджера (u-top)' },
    { t:days(3)+4*3600000, file:'clients-2026.csv', entity:'clients', kind:'warn', text:'[Клиенты] Строка 9: дубликат (ИП Соколова) — пропущен' },
    { t:days(1)+9*3600000, file:'executors.xlsx', entity:'executors', kind:'ok', text:'XLSX прочитан напрямую: 8 строк' },
    { t:days(1)+9*3600000, file:'executors.xlsx', entity:'executors', kind:'ok', text:'Итог: добавлено 8, пропущено 0 · листов: 1' }
  ];

  return {
    _v:1,
    users, niches, specializations, projects, folders, orders, chats, messages, polls,
    tickets, ideas, kanbanBoards:kanban, kbCards, changelog, importRules, calcServices,
    calcHistory:[], notifs, audit, backups:[], importLogs, importLogLines,
    settings:{ demoEnabled:true, minPrepay:50, selfDeleteDays:90, hiddenRoutes:[], balance: 100000, appBgDoodles:true,
      referral:{ enabled:true, percent:2, fixedBonus:0, karmaPerRef:2, role:'client' },
      /* Доли от суммы заказа: админ — 25% (маржа услуг), менеджер — 5%.
         Разница (итого − исполнители − админ − менеджер) показывается как
         свободный остаток; отрицательная — предупреждение о превышении. */
      finance:{ adminMargin:25, managerFee:10, executorShare:40, payoutCommission:5, minOrderTotal:500, minExecutorPay:100 },
      /* Платёжный провайдер не захардкожен: имя, комиссия и включённость
         берутся отсюда, чтобы смена/отключение провайдера не требовали правок кода. */
      integrations:{ payout:{ key:'smartcat', name:'Smartcat', commission:5, enabled:true, perUser:true } },
      /* Выплаты исполнителям: 1-е и 15-е число в 15:00 МСК, полуинтервалы
         [1;14] и [15;последнее число]. Полностью настраивается. */
      payout:{ enabled:true, auto:true, days:[1,15], time:'15:00', tz:'Europe/Moscow', lastRunAt:null, history:[] },
      betaRoutes:['ai-transcribe','ai-texts','ai-translate'] },
    product:{ beta:true, version:'0.1-prototype', build:1, notes:['Прототип Audiowizard Workspace'] },
    featureUsage:[
      { name:'Заказы', share:34 }, { name:'Чаты', share:26 }, { name:'Дашборды', share:16 },
      { name:'Импорт/экспорт', share:10 }, { name:'Идеи', share:8 }, { name:'Тикеты', share:6 }
    ],
    usageConsent:{}, cookiesAccepted:false,
    draftPrefs:{}, currentUserId:null, rememberedLogin:null,
    invites:[] /* приглашения: { id, token, role, limit, used, expiresAt, createdBy, email?, note? } */,
    keys:{ ...DEFAULT_KEYS },
    uiText:{} /* переопределения текстов интерфейса: {ключ: текст} (правит админ) */
  };
}

/* ---------- Персистентность ---------- */
let S;
function loadState(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if (raw){ S = JSON.parse(raw); if (S && S._v === 1){ migrateThemes(); migrateRules(); migrateVioletDefault(); migrateDemoMarks(); migrateImportRulesSeed(); migrateUiText(); migrateKeys(); migrateFinance(); saveState(); return; } }
  }catch(e){}
  S = seedState();
  saveState();
}
/* ---------- Демо-данные: пометки и полная очистка для продакшена ---------- */
const SEED_DEMO_RE = /^(u-(manager|top|ex\d+|cl\d+)|(o|ch|m\d|n\d|nf\d|i\d|t\d|p\d|f\d|v\d|kb\d|kc\d)\d*$)/;
function migrateFinance(){
  if (!S.settings) S.settings = {};
  S.settings.finance = Object.assign({ adminMargin:25, managerFee:10, executorShare:40, payoutCommission:5, minOrderTotal:500, minExecutorPay:100 }, S.settings.finance || {});
  /* Старые сохранения держали прежний дефолт 5% — поднимаем до 10%,
     если пользователь явно не менял значение (метка версии дефолтов). */
  if (S.settings.finance._defaultsVersion !== 2){
    if (S.settings.finance.managerFee == null || Number(S.settings.finance.managerFee) === 5) S.settings.finance.managerFee = 10;
    S.settings.finance._defaultsVersion = 2;
  }
  S.settings.integrations = Object.assign({ payout:{ key:'smartcat', name:'Smartcat', commission:5, enabled:true, perUser:true } }, S.settings.integrations || {});
  S.settings.payout = Object.assign({ enabled:true, auto:true, days:[1,15], time:'15:00', tz:'Europe/Moscow', lastRunAt:null, history:[] }, S.settings.payout || {});
  if (!Array.isArray(S.settings.payout.days) || !S.settings.payout.days.length) S.settings.payout.days = [1,15];
  (S.users || []).forEach(u => {
    if (!u.ext) return;
    if (!u.ext.smartcat) u.ext.smartcat = { login:'', status:'none' };
  });
}
function migrateDemoMarks(){
  /* Гарантия: баланс платформы есть для всех пользователей (и старых сохранений) */
  if (S.settings && S.settings.balance == null) S.settings.balance = 100000;
  /* Реферальная программа: настройки по умолчанию и журналы */
  if (S.settings){
    S.settings.referral = Object.assign({ enabled:true, percent:2, fixedBonus:0, karmaPerRef:2, role:'client' }, S.settings.referral || {});
  }
  S.referrals = S.referrals || [];
  S.referralAccruals = S.referralAccruals || [];
  /* Beta-режим вкладок: какие разделы помечать значком Beta */
  if (S.settings && !Array.isArray(S.settings.betaRoutes)){
    S.settings.betaRoutes = ['ai-transcribe','ai-texts','ai-translate'];
  }
  /* Дудл-фон по умолчанию: для старых сохранений без явного поля включаем дудлы */
  if (S.settings && S.settings.appBgDoodles === undefined) S.settings.appBgDoodles = true;
  /* Настройки интерфейса теперь хранятся у аккаунта (u.prefs): глобальные
     значения переносим только текущему пользователю и без zen-состояния,
     чтобы полноэкранный режим и позиция аватара не переходили между аккаунтами. */
  /* Старая позиция «низ по центру» больше не используется — только углы. */
  if (S.draftPrefs && S.draftPrefs.zenAvatarPos === 'bc') S.draftPrefs.zenAvatarPos = 'br';
  (S.users||[]).forEach(u => { if (u.prefs && u.prefs.zenAvatarPos === 'bc') u.prefs.zenAvatarPos = 'br'; });
  if (S.draftPrefs && S.currentUserId){
    const cu = (S.users||[]).find(x => x.id === S.currentUserId);
    if (cu && !cu.prefs){
      cu.prefs = Object.assign({}, S.draftPrefs);
      delete cu.prefs.zen;
      delete cu.prefs.zenAvatarPos;
    }
  }
  /* Первый вход: приветствие показываем каждому, пока он его не прошёл.
     Одноразово снимаем старые отметки «тур пройден» — иначе демо-аккаунты
     и пользователи из старых сохранений не увидели бы онбординг. */
  if (S.settings && !S.settings.welcomeResetV1){
    (S.users||[]).forEach(u => { u.tour_completed = false; });
    S.settings.welcomeResetV1 = true;
  }
  /* Патчноут прототипа: у v0 всегда есть описание «Первая версия приложения» */
  (S.changelog || []).forEach(c => { if (c.id === 'v0' && !c.content) c.content = 'Первая версия приложения'; });
  if (S.__demoMarked) {
    (S.featureUsage || []).forEach(f => { if (!f.demo) f.demo = true; });
    (S.changelog || []).forEach(c => { if (c.id === 'v0') delete c.demo; else if (!c.demo) c.demo = true; });
    if (!S.importLogs || !S.importLogs.length) S.importLogs = [
      { t:Date.now()-3*DAY, added:12, skipped:1, ruled:2, errs:0, warns:1, infos:2, file:'clients-2026.csv', entity:'clients' },
      { t:Date.now()-DAY, added:8, skipped:0, ruled:1, errs:1, warns:0, infos:1, file:'executors.xlsx', entity:'executors' }
    ];
    if (!S.importLogLines || !S.importLogLines.length) S.importLogLines = [
      { t:Date.now()-3*DAY, file:'clients-2026.csv', entity:'clients', kind:'ok', text:'Кодировка: UTF-8 (определена автоматически)' },
      { t:Date.now()-3*DAY, file:'clients-2026.csv', entity:'clients', kind:'ok', text:'[Клиенты] Строка 2: + клиент ООО «Медиа-Лайн»' },
      { t:Date.now()-3*DAY, file:'clients-2026.csv', entity:'clients', kind:'rule', text:'[Клиенты] Правило: назначить менеджера (u-top)' },
      { t:Date.now()-3*DAY, file:'clients-2026.csv', entity:'clients', kind:'warn', text:'[Клиенты] Строка 9: дубликат (ИП Соколова) — пропущен' },
      { t:Date.now()-DAY, file:'executors.xlsx', entity:'executors', kind:'ok', text:'XLSX прочитан напрямую: 8 строк' },
      { t:Date.now()-DAY, file:'executors.xlsx', entity:'executors', kind:'ok', text:'Итог: добавлено 8, пропущено 0 · листов: 1' }
    ];
    return;
  }
  (S.users || []).forEach(u => { if (u.id !== 'u-admin' && SEED_DEMO_RE.test(u.id)) u.demo = true; });
  (S.orders || []).forEach(o => { if (SEED_DEMO_RE.test(o.id)) o.demo = true; });
  (S.chats || []).forEach(c => { if (SEED_DEMO_RE.test(c.id)) c.demo = true; });
  (S.messages || []).forEach(m => { if (SEED_DEMO_RE.test(m.id) || SEED_DEMO_RE.test(m.chat_id || '')) m.demo = true; });
  (S.notifs || []).forEach(n => { if (SEED_DEMO_RE.test(n.id)) n.demo = true; });
  (S.ideas || []).forEach(i => { if (SEED_DEMO_RE.test(i.id)) i.demo = true; });
  (S.tickets || []).forEach(t => { if (SEED_DEMO_RE.test(t.id)) t.demo = true; });
  (S.kbCards || []).forEach(k => { if (SEED_DEMO_RE.test(k.id)) k.demo = true; });
  (S.projects || []).forEach(p => { if (SEED_DEMO_RE.test(p.id)) p.demo = true; });
  (S.folders || []).forEach(f => { if (SEED_DEMO_RE.test(f.id)) f.demo = true; });
  (S.featureUsage || []).forEach(f => { f.demo = true; });
  S.__demoMarked = true;
}

function migrateImportRulesSeed(){
  /* Обновить демонстрационные правила до актуальных (не трогает пользовательские) */
  if (S.__rulesSeedV2) return;
  const seedIds = ['r1','r2','r3','r4'];
  const had = (S.importRules||[]).filter(r=>seedIds.includes(r.id));
  if (had.length === 4 || had.length === 0 && !(S.importRules||[]).length){
    S.importRules = [
      { id:'r-d1', entity:'client', conditions:[{ field:'name', op:'not_empty' }], action_type:'manager', action_value:'u-top' },
      { id:'r-a1', entity:'client', conditions:[{ field:'comment', op:'contains', value:'Андрей' }], action_type:'manager', action_value:'u-manager' },
      { id:'r-p1', entity:'client', conditions:[{ field:'comment', op:'regex', value:'промокод|скидка|PROMO10' }], action_type:'discount', action_value:'' },
  
      ...((S.importRules||[]).filter(r=>!seedIds.includes(r.id) && !['r-d1','r-a1','r-p1'].includes(r.id)))
    ];
  }
  S.__rulesSeedV2 = true;
}
function migrateVioletDefault(){
  if (S.violetDefaultDone) return;
  S.users.forEach(u => { u.accent = 'violet'; });
  S.violetDefaultDone = true;
}
function migrateUiText(){
  if (!S.uiText || typeof S.uiText !== 'object') S.uiText = {};
}
function migrateKeys(){
  if (!S.keys || typeof S.keys !== 'object') S.keys = { ...DEFAULT_KEYS };
  else {
    // Конфликтные хоткеи заменяем на новые дефолты
    if (S.keys.theme === 'ctrl+shift+t') S.keys.theme = DEFAULT_KEYS.theme;
    if (S.keys.newOrder === 'ctrl+n' || S.keys.newOrder === 'ctrl+shift+enter') S.keys.newOrder = DEFAULT_KEYS.newOrder;
    if (S.keys.zen === 'ctrl+shift+f') S.keys.zen = DEFAULT_KEYS.zen;
    Object.keys(DEFAULT_KEYS).forEach(id => { if (!S.keys[id]) S.keys[id] = DEFAULT_KEYS[id]; });
  }
}
function migrateRules(){
  (S.importRules || []).forEach(r => {
    if (r.conditions) return;
    r.conditions = [{ field:'comment', op:'contains', value: r.trigger_text || '' }];
    delete r.trigger_text;
  });
}
let saveTimer = null;
function saveState(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>{ try{ localStorage.setItem(LS_KEY, JSON.stringify(S)); }catch(e){} }, 120);
}

/* ---------- Хелперы над состоянием ---------- */
/* Глобальное правило: строка, состоящая только из дефисов/тире (—, –, -, −),
   считается пустым значением — и при импорте, и при вводе. */
const DASH_ONLY_RE = /^[\s\-—–−_]+$/;
function cleanValue(v){
  if (v == null) return '';
  const s = String(v).trim();
  return DASH_ONLY_RE.test(s) ? '' : s;
}
function cleanRecord(obj){
  if (!obj || typeof obj !== 'object') return obj;
  Object.keys(obj).forEach(k => { if (typeof obj[k] === 'string') obj[k] = cleanValue(obj[k]); });
  return obj;
}
const userById = id => S.users.find(u=>u.id===id);
const clientById = id => S.users.find(u=>u.id===id && u.role==='client');
const clientsOf = o => ((o.client_ids && o.client_ids.length ? o.client_ids : [o.client_id]).filter(Boolean)).map(clientById).filter(Boolean);
const me = () => userById(S.currentUserId);
const isStaff = r => ['admin','top_manager','manager'].includes(r);
/* Прод-режим: при отключённом демо демо-записи скрываются во всех разделах (данные не удаляются) */
const isProd = () => !!(S.settings && S.settings.demoEnabled === false);
const noDemo = arr => isProd() ? arr.filter(x => !x.demo) : arr;
const isManagerLike = r => ['admin','top_manager','manager'].includes(r);

const ordersFor = user => {
  if (!user) return [];
  if (isStaff(user.role)) return noDemo(S.orders);
  if (user.role==='executor') return noDemo(S.orders.filter(o => o.executors.some(e=>e.uid===user.id)));
  if (user.role==='client') return noDemo(S.orders.filter(o => o.client_ids && o.client_ids.length ? o.client_ids.includes(user.id) : o.client_id===user.id));
  return [];
};
const nichesById = {}; S && S.niches && S.niches.forEach(n=>nichesById[n.id]=n);
function nicheName(id){ const n = (S.niches||[]).find(n=>n.id===id); return n ? n.name : '—'; }

function executorMetrics(u){
  const mine = S.orders.filter(o=>o.executors.some(e=>e.uid===u.id) && o.status!=='archived');
  const done = mine.filter(o=>o.status==='done');
  const rev = mine.filter(o=>o.status==='revision');
  const overdue = mine.filter(o=>o.deadline && o.deadline < Date.now() && !['done','archived'].includes(o.status));
  const help = 2; // демо-метрика
  const total = mine.length || 1;
  const sum = mine.reduce((a,o)=>a+o.total,0); // сумма заказов исполнителя
  return { orders:mine.length, done:done.length, revision:rev.length, overdue:overdue.length, help,
    success: Math.round((done.length/total)*100), sum };
}
function clientMetrics(u){
  const mine = S.orders.filter(o=>o.client_id===u.id && o.status!=='archived');
  const sum = mine.reduce((a,o)=>a+o.total,0);
  return { orders:mine.length, sum };
}
function chatForUser(u){
  const removed = (u && u.ext && Array.isArray(u.ext.chatRemoved)) ? u.ext.chatRemoved : [];
  return noDemo(S.chats.filter(c=>{
    if (removed.includes(c.id) && !isSystemChat(c)) return false;
    if (c.type === 'direct') return !!(c.member_ids || []).includes(u.id);
    if (isStaff(u.role)) return true;
    if (u.role==='executor') return ['corporate','order','group'].includes(c.type);
    if (u.role==='client') return ['corporate','company','order'].includes(c.type);
    return false;
  }));
}
/* Пустое ЛС удаляется при выходе из чата (как в ТГ): если в личном
   сообщении нет ни одного сообщения, чат не имеет смысла оставаться
   в списке. «Избранное» (ЛС с собой) не трогаем. */
function pruneEmptyDirects(){
  const u = me && me();
  if (!u) return 0;
  const emptyIds = [];
  S.chats.forEach(c=>{
    if (c.type !== 'direct' || c.isSelf) return;
    if (!(c.member_ids||[]).includes(u.id)) return;
    const hasMsg = (S.messages||[]).some(m=>m.chat_id===c.id && !(m.type==='system'));
    if (!hasMsg) emptyIds.push(c.id);
  });
  if (!emptyIds.length) return 0;
  S.chats = S.chats.filter(c=>!emptyIds.includes(c.id));
  return emptyIds.length;
}
/* ---------- Карма: полуавтоматический рейтинг лояльности ----------
   База 50 баллов + автоматические начисления за реальную работу
   (выполненные заказы +, проблемы/доработки −, полученные реакции +)
   + ручные корректировки staff с причиной. Диапазон 0..100.
   Бонусы за карму — в будущем; сейчас только рейтинг и история. */
const KARMA_LEVELS = [
  { min:85, key:'excellent', label:'Отличная', cls:'c-green' },
  { min:60, key:'good',      label:'Хорошая',  cls:'c-blue' },
  { min:30, key:'normal',    label:'Обычная',  cls:'c-gray' },
  { min:0,  key:'low',       label:'Низкая',   cls:'c-red' }
];
function karmaLevel(score){
  return KARMA_LEVELS.find(l => score >= l.min) || KARMA_LEVELS[KARMA_LEVELS.length-1];
}
function calcKarma(u){
  if (!u) return { score:50, ...karmaLevel(50), parts:{} };
  const orders = (S.orders || []).filter(o=>{
    if (u.role === 'executor') return (o.executors || []).some(e=>e.uid === u.id);
    if (u.role === 'client') return o.client_id === u.id;
    return false;
  });
  const done = orders.filter(o=>o.status === 'done').length;
  const problems = orders.filter(o=>o.status === 'problem').length;
  const revisions = orders.filter(o=>o.status === 'revision').length;
  /* Реакции, которые пользователь получал на свои сообщения */
  let reactions = 0;
  (S.messages || []).forEach(m=>{
    if (m.user_id !== u.id || !m.reactions) return;
    Object.values(m.reactions).forEach(us=>{ if (Array.isArray(us) && us.length) reactions += us.length; });
  });
  const adjList = u.karmaAdj || [];
  const adj = adjList.reduce((a, x) => a + (Number(x.delta) || 0), 0);
  let score = 50;
  score += Math.min(20, done * (u.role === 'executor' ? 2 : 1));
  score -= problems * 3;
  score -= revisions * 1;
  score += Math.min(8, Math.round(reactions / 3));
  score += adj;
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, ...karmaLevel(score), parts:{ done, problems, revisions, reactions, adj } };
}
/* Ручная корректировка (staff): сохраняет историю с причиной */
function karmaAdjust(userId, delta, reason){
  const u = userById(userId);
  if (!u) return null;
  u.karmaAdj = u.karmaAdj || [];
  u.karmaAdj.unshift({ delta:Number(delta)||0, reason:String(reason||'Корректировка'), at:Date.now(), by:(me()||{}).id || null });
  saveState();
  return calcKarma(u);
}


/* Архив чатов (как в ТГ): скрытые из основного списка, список хранится у пользователя */
function archiveIds(u){
  return (u && u.ext && Array.isArray(u.ext.chatArchive)) ? u.ext.chatArchive : [];
}
function isArchived(c, u){
  return archiveIds(u).includes(c.id);
}
function setArchived(c, u, val){
  if (!u || !c) return;
  u.ext = u.ext || {};
  const arr = archiveIds(u);
  const i = arr.indexOf(c.id);
  if (val && i < 0) arr.push(c.id);
  if (!val && i >= 0) arr.splice(i, 1);
  u.ext.chatArchive = arr;
  saveState();
}
/* Системные чаты (по умолчанию) нельзя удалять и скрывать */
function isSystemChat(c){
  return !!(c && (c.system || c.type === 'corporate'));
}

/* Раздел помечен как Beta (управляется админом в настройках) */
function isBetaRoute(route){
  const list = (S.settings && S.settings.betaRoutes) || [];
  return Array.isArray(list) && list.includes(route);
}

/* ---------- Реферальная программа ----------
   У каждого пользователя — постоянный личный код и ссылка. Приглашённый
   привязывается к рефереру (referredBy). За его заказы рефереру начисляется
   процент (настраивается), возможен фикс-бонус за первый заказ и карма. */
function refConfig(){
  S.settings = S.settings || {};
  S.settings.referral = Object.assign({ enabled:true, percent:2, fixedBonus:0, karmaPerRef:2, role:'client' }, S.settings.referral || {});
  return S.settings.referral;
}
/* Постоянный личный код: генерируется один раз и сохраняется */
function refCode(u){
  if (!u) return '';
  if (!u.refCode){
    u.refCode = (String(u.username || 'ref').replace(/[^a-z0-9]/gi,'').slice(0,8) || 'ref').toLowerCase()
      + '-' + Math.random().toString(36).slice(2,6);
    try { saveState(); } catch(e){}
  }
  return u.refCode;
}
function refLink(u){
  if (!u) return '';
  const base = location.origin + location.pathname;
  return base + '#/join?ref=' + encodeURIComponent(refCode(u));
}
function userByRefCode(code){
  if (!code) return null;
  const c = String(code).toLowerCase();
  return (S.users || []).find(x => (x.refCode||'').toLowerCase() === c) || null;
}
/* Привязать нового пользователя к рефереру */
function addReferral(newUserId, referrerId, via){
  const nu = userById(newUserId), ref = userById(referrerId);
  if (!nu || !ref || nu.id === ref.id) return null;
  if (nu.referredBy) return null; /* уже привязан */
  nu.referredBy = ref.id;
  S.referrals = S.referrals || [];
  S.referrals.unshift({ id:uid(), userId:nu.id, referrerId:ref.id, via:via||'link', at:Date.now() });
  const cfg = refConfig();
  if (cfg.karmaPerRef){
    try { karmaAdjust(ref.id, cfg.karmaPerRef, 'Приглашён новый пользователь'); } catch(e){}
  }
  saveState();
  return nu;
}
/* Начисление за выполненный заказ приглашённого */
function accrueReferral(order){
  if (!order || order.status !== 'done') return null;
  const cfg = refConfig();
  if (!cfg.enabled) return null;
  /* Платим тому, кто привёл заказчика заказа */
  const buyer = userById(order.client_id);
  const referrer = buyer && buyer.referredBy ? userById(buyer.referredBy) : null;
  if (!referrer) return null;
  S.referralAccruals = S.referralAccruals || [];
  /* Один заказ — одно начисление */
  if (S.referralAccruals.some(a => a.orderId === order.id)) return null;
  const firstOrder = !(S.referralAccruals.some(a => a.userId === buyer.id));
  const base = Number(order.total) || 0;
  const percent = Number(cfg.percent) || 0;
  let amount = Math.round(base * percent / 100);
  if (firstOrder && Number(cfg.fixedBonus)) amount += Number(cfg.fixedBonus);
  if (amount <= 0) return null;
  const rec = { id:uid(), referrerId:referrer.id, userId:buyer.id, orderId:order.id,
    base, percent, amount, first:firstOrder, at:Date.now() };
  S.referralAccruals.unshift(rec);
  S.referralAccruals = S.referralAccruals.slice(0, 500);
  referrer.refEarned = (Number(referrer.refEarned) || 0) + amount;
  saveState();
  return rec;
}
/* Статистика реферера */
function referralStats(userId){
  const invited = (S.referrals || []).filter(r => r.referrerId === userId);
  const ids = invited.map(r => r.userId);
  const accruals = (S.referralAccruals || []).filter(a => a.referrerId === userId);
  const earned = accruals.reduce((s, a) => s + (Number(a.amount)||0), 0);
  const active = ids.filter(id => {
    const u2 = userById(id); if (!u2) return false;
    return u2.is_online || (S.orders||[]).some(o => o.client_id === id || (o.executors||[]).some(e=>e.uid===id));
  });
  return { invited, ids, accruals, earned, activeCount: active.length, total: ids.length };
}

/* ---------- Приглашения ---------- */
const INVITE_ROLES = ['executor','client']; /* базовые роли по ссылке: staff и исполнители */
const INVITE_ROLES_ALL = ['top_manager','manager','executor','client']; /* полный набор для админа */
/* Кто какую роль вправе раздавать приглашением */
function canInviteRole(actorRole, targetRole){
  if (!actorRole || !targetRole) return false;
  if (actorRole === 'admin') return INVITE_ROLES_ALL.includes(targetRole);
  if (isStaff(actorRole)) return INVITE_ROLES.includes(targetRole);
  if (actorRole === 'executor') return targetRole === 'client';
  return false;
}
/* Менять роли (повышать привилегии) может ТОЛЬКО админ */
function canChangeRoles(actorRole){ return actorRole === 'admin'; }
function inviteToken(){
  /* Криптостойкий токен: длинная случайная строка, не угадывается */
  const bytes = (typeof crypto!=='undefined' && crypto.getRandomValues)
    ? crypto.getRandomValues(new Uint8Array(18))
    : Array.from({length:18},()=>Math.floor(Math.random()*256));
  return Array.from(bytes).map(b=>b.toString(36).padStart(2,'0')).join('');
}
/* Статус приглашения: active / used / expired / revoked */
function inviteStatus(inv){
  if (!inv) return 'revoked';
  if (inv.revoked) return 'revoked';
  if (inv.limit && inv.used != null && inv.used >= inv.limit) return 'used';
  if (inv.expiresAt && Date.now() > inv.expiresAt) return 'expired';
  return 'active';
}
function inviteValid(inv){
  return !!inv && inviteStatus(inv) === 'active';
}
function inviteLink(inv){
  const base = location.origin + location.pathname;
  return base + '#/join?token=' + inv.token;
}
function inviteById(token){
  return (S.invites||[]).find(i=>i.token===token);
}
/* Учесть использование приглашения (по токену). Возвращает true, если можно использовать. */
function consumeInvite(token, newUserId){
  const inv = inviteById(token);
  if (!inviteValid(inv)) return false;
  inv.used = (inv.used||0) + 1;
  inv.usedBy = inv.usedBy || [];
  inv.usedBy.push({ userId:newUserId, at:Date.now() });
  saveState();
  return true;
}

function unreadCount(chat, uidv){
  const lastRead = (chat.unread||{})[uidv];
  if (lastRead === undefined) return 0;
  return S.messages.filter(m=>m.chat_id===chat.id && m.created_at>lastRead && m.user_id!==uidv).length;
}
/* Отображение непрочитанного для пользователя:
   - если после отметки есть ЧУЖИЕ сообщения — число (счётчик);
   - если просрочены только СВОИ (чат помечен непрочитанным вручную) — просто точка.
   Возвращает { count } или { dot:true }. */
function chatUnreadUI(chat, uidv){
  const lastRead = (chat.unread||{})[uidv];
  if (lastRead === undefined) return { count: 0 };
  const unread = S.messages.filter(m=>m.chat_id===chat.id && m.created_at>lastRead);
  const otherN = unread.filter(m=>m.user_id!==uidv && m.type!=='system').length;
  /* Упомянут: в непрочитанном есть сообщение, где я в mentions (включая ответ на моё).
     replyToMe — пинг именно ответом на моё сообщение (для подсказки в списке). */
  let mentioned = false, replyToMe = false;
  unread.some(m=>{
    if (m.user_id === uidv) return false;
    if (m.reply_to){
      const s = S.messages.find(x=>x.id===m.reply_to);
      if (s && s.user_id === uidv){ mentioned = true; replyToMe = true; return true; }
    }
    if ((m.mentions||[]).includes(uidv)){ mentioned = true; return true; }
    return false;
  });
  if (otherN > 0) return { count: otherN, mentioned, replyToMe };
  const anyN = unread.length;
  if (anyN > 0) return { dot:true, mentioned, replyToMe };
  return { count: 0, mentioned: false, replyToMe: false };
}

/* Audit + ops queue */
function logAudit(action, entity){
  S.audit.unshift({ id:uid(), user:me()?me().full_name:'Система', action, entity:entity||'—', ip:rndIp(), t:Date.now() });
  S.audit = S.audit.slice(0,200);
  saveState();
}
/* Draft autosave (IndexedDB) */
const DraftsDB = (()=>{
  let dbp = null;
  function open(){
    if (dbp) return dbp;
    dbp = new Promise((res)=>{
      const rq = indexedDB.open('aw-workspace', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('drafts');
      rq.onsuccess = () => { dbp = rq.result; res(dbp); };
      rq.onerror = () => res(null);
    });
    return dbp;
  }
  return {
    async put(key, val){ const db = await open(); if(!db) return; return new Promise(r=>{ const tx=db.transaction('drafts','readwrite'); tx.objectStore('drafts').put({val,t:Date.now()}, key); tx.oncomplete=r; }); },
    async get(key){ const db = await open(); if(!db) return null; return new Promise(r=>{ const tx=db.transaction('drafts','readonly'); const rq=tx.objectStore('drafts').get(key); rq.onsuccess=()=>r(rq.result||null); rq.onerror=()=>r(null); }); },
    async del(key){ const db = await open(); if(!db) return; return new Promise(r=>{ const tx=db.transaction('drafts','readwrite'); tx.objectStore('drafts').delete(key); tx.oncomplete=r; }); }
  };
})();

/* XSS-безопасный текст → HTML с \n */
const nl2br = s => esc(s).replace(/\n/g,'<br>');
