/* ============================================================
   Audiowizard Workspace — ИИ-сервисы (демо-движок, офлайн)
   Стенограммы: караоке-синхрон, диаризация, альтернативы слов
   Копирайтинг: генерация, рерайт, саммари, заголовки
   Переводы: сохранение структуры, демо-словари
   ============================================================ */
'use strict';

const AI = (() => {

  /* ==================== ОБЩЕЕ ==================== */
  function initState(){
    if (!S.aiUsage) S.aiUsage = { plan:'Pro · демо', min:14, limit:180 };
    if (!S.aiSpeakers) S.aiSpeakers = {};
    if (!S.aiEdits) S.aiEdits = {};
    if (!S.aiSegOverrides) S.aiSegOverrides = {};
  }

  const hashStr = s => { let h = 0; for (let i=0;i<s.length;i++){ h = (h*31 + s.charCodeAt(i)) | 0; } return Math.abs(h); };
  const seededPick = (arr, seed) => arr[hashStr(String(seed)) % arr.length];

  function usagePillHTML(){
    const u = S.aiUsage;
    const pct = Math.min(100, Math.round(u.min / u.limit * 100));
    return `<div class="card card-pad ai-usage">
      <div class="row row--between"><b class="small">${icon('sparkle','ico-sm')} Подписка ИИ</b><span class="badge c-accent">${esc(u.plan)}</span></div>
      <div class="progress" style="margin:10px 0 6px"><span style="width:${pct}%"></span></div>
      <div class="small faint">Использовано ${u.min.toFixed(0)} из ${u.limit} минут в этом месяце</div>
    </div>`;
  }
  function aiHead(title, sub, active){
    initState();
    const tabs = [['ai-transcribe','Стенограммы','mic'],['ai-texts','Копирайтинг','edit'],['ai-translate','Переводы','globe']];
    return `<div class="page-head"><div><h2>${title}</h2><div class="sub">${sub}</div></div>
      <div class="page-actions">${((S.product||{}).beta !== false) ? '<span class="beta-badge">Beta</span>' : ''}<span class="badge c-accent">${icon('sparkle','ico-sm')} ИИ-движок</span></div></div>
      <div class="tabs" style="margin-bottom:16px">${tabs.map(([r,t,ic])=>`<button class="tab ${active===r?'on':''}" data-ai-tab="${r}">${icon(ic,'ico-sm')} ${t}</button>`).join('')}</div>`;
  }
  function bindTabs(root){
    $$('[data-ai-tab]', root).forEach(b=>b.onclick = ()=>APP.go(b.dataset.aiTab));
  }
  function attachToOrder(kind, filename, text){
    const orders = ordersFor(me()).filter(o=>o.status!=='archived');
    if (!orders.length){ toast('Нет доступных заказов для прикрепления','warn'); return; }
    openModal({
      narrow:true, title:`Прикрепить к заказу`,
      body:`<div class="field"><label>Заказ</label><select class="input" id="at-order">${orders.map(o=>`<option value="${o.id}">${o.order_id} · ${(clientById(o.client_id)||{}).full_name||''}</option>`).join('')}</select></div>
        <p class="small faint" style="margin-top:10px">Файл появится в карточке заказа: <b>${esc(filename)}</b></p>`,
      footer:`<button class="btn btn--ghost" data-x>Отмена</button><button class="btn btn--primary" data-ok>Прикрепить</button>`,
      onMount:(mask, close)=>{
        mask.querySelector('[data-x]').onclick = close;
        mask.querySelector('[data-ok]').onclick = ()=>{
          const o = S.orders.find(x=>x.id===mask.querySelector('#at-order').value);
          o.files.push({ name:filename, size:text.length, type:'text/plain', duration:0 });
          o.history.push({ t:Date.now(), txt:`Прикреплён ИИ-файл (${kind}): ${filename}` });
          logAudit(`ИИ-результат прикреплён к ${o.order_id}: ${filename}`, 'Файл');
          saveState(); toast(`Прикреплено к ${o.order_id}`, 'ok');
          close();
        };
      }
    });
  }
  function dl(name, content, mime='text/plain'){
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type:mime+';charset=utf-8' }));
    a.download = name; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  }
  const fmtClock = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
  const srtTime = s => { const ms = Math.round((s%1)*1000); return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')},${String(ms).padStart(3,'0')}`; };

  /* ==================== СТЕНОГРАММЫ ==================== */
  const T = { audio:null, flat:[], activeWord:-1, activeSeg:-1, processed:false, uploading:false, scale:1, rate:1, search:'' };

  function segText(si){
    const ov = S.aiSegOverrides[si];
    if (ov) return ov;
    const seg = AI_DATA.segments[si];
    return seg.words.map((w, wi)=>{
      const ed = S.aiEdits[si+'_'+wi];
      return ed ? ed.t : w.w;
    }).join(' ');
  }
  function buildWords(si){
    const seg = AI_DATA.segments[si];
    const text = segText(si);
    const tokens = text.split(/\s+/).filter(Boolean);
    const words = seg.words;
    const out = [];
    if (!S.aiSegOverrides[si]){
      tokens.forEach((tok, wi)=>{
        const base = words[wi] || words[words.length-1];
        const ed = S.aiEdits[si+'_'+wi];
        out.push({ si, wi, t:tok, s:base.s, e:base.e, conf: ed ? 0.99 : (base.conf||null), alts: ed ? [] : (base.alts||[]) });
      });
    } else {
      const totalW = tokens.reduce((a,t2)=>a+Math.max(2,t2.length),0);
      let cur = seg.start;
      const span = seg.end - seg.start;
      tokens.forEach(tok=>{
        const d = span * Math.max(2,tok.length)/totalW * 0.88;
        out.push({ si, wi:out.length, t:tok, s:cur, e:Math.min(cur+d, seg.end), conf:null, alts:[] });
        cur += d + 0.02;
      });
    }
    return out;
  }

  function transcriptPlain(){
    let out = `Стенограмма · Audiowizard Workspace · ${fmtDate(Date.now())}\nАудио: ${T.sourceName}\n\n`;
    AI_DATA.segments.forEach((seg, si)=>{
      out += `[${fmtClock(seg.start)}] ${S.aiSpeakers[seg.speaker]||AI_DATA.speakers[seg.speaker]}: ${segText(si)}\n\n`;
    });
    return out;
  }
  function transcriptSRT(){
    return AI_DATA.segments.map((seg, si)=>{
      const spk = S.aiSpeakers[seg.speaker]||AI_DATA.speakers[seg.speaker];
      return `${si+1}\n${srtTime(seg.start)} --> ${srtTime(seg.end)}\n${spk}: ${segText(si)}\n`;
    }).join('\n');
  }

  function transcribeView(root){
    let data = AI_DATA;
    T.scale = T.scale || 1;
    bindTabs(root);

    const segsHTML = ()=> AI_DATA.segments.map((seg, si)=>{
      const spkId = seg.speaker;
      const spkName = S.aiSpeakers[spkId]||AI_DATA.speakers[spkId];
      const words = buildWords(si);
      const text = words.map(w=>{
        const cls = ['w'];
        if (w.conf && w.conf < 0.8) cls.push('low');
        if (S.aiEdits[w.si+'_'+w.wi]) cls.push('edited');
        const title = w.conf ? ` data-conf="${Math.round(w.conf*100)}"` : '';
        return `<span class="${cls.join(' ')}" data-wi="${w.wi}" data-si="${w.si}"${title}>${esc(w.t)}</span>`;
      }).join(' ');
      return `<div class="tseg" data-seg="${si}">
        <div class="tseg__meta">
          <button class="spk spk-${spkId}" data-spk="${spkId}">${icon('mic','ico-sm')} ${esc(spkName)}</button>
          <button class="tstamp" data-seek="${seg.start}">${icon('play','ico-sm')} ${fmtClock(seg.start)}</button>
          <span class="spacer"></span>
          <span class="small faint">уверенность сегмента ${Math.round((words.reduce((a,w)=>a+(w.conf||0.97),0)/words.length)*100)}%</span>
        </div>
        <p class="tseg__text" data-editable="0" spellcheck="false">${text}</p>
      </div>`;
    }).join('');

    root.innerHTML = `
      ${aiHead('ИИ-стенограммы','Караоке-синхрон с аудио, диаризация спикеров и альтернативы для неуверенных слов','ai-transcribe')}
      <div class="ai-layout">
        <div class="stack" style="gap:12px">
          ${usagePillHTML()}
          <div class="card card-pad">
            <b class="small">${icon('mic','ico-sm')} Источник аудио</b>
            <div class="ai-source ${T.uploading?'has-file':''}" id="ai-src">
              <span class="ai-source__ic">${icon(T.uploading?'check-c':'upload','ico-sm')}</span>
              <div style="min-width:0"><b class="small" id="ai-src-name">${esc(T.sourceName||'Демо-подкаст «Про ИИ-сервисы»')}</b>
              <div class="small faint" id="ai-src-meta">${T.uploading?`ваш файл · ${Math.round(AI_DATA.duration*T.scale)} сек`:'58 сек · 2 спикера'}</div></div>
            </div>
            <input type="file" id="ai-file" accept="audio/*" hidden>
            <div class="row" style="gap:8px;margin-top:12px">
              <button class="btn btn--ghost btn--sm" id="ai-upload">${icon('clip')} Свой файл</button>
              <button class="btn btn--ghost btn--sm" id="ai-reset" style="display:${T.uploading?'':'none'}">${icon('refresh')} Демо-аудио</button>
              <span class="spacer"></span>
              <button class="btn btn--primary" id="ai-run" ${T.processed?'disabled':''}>${T.processed?icon('check-c')+' Готово':icon('sparkle')+' Распознать'}</button>
            </div>
            <div id="ai-progress" class="stack" style="gap:8px;margin-top:14px;display:none">
              <div class="progress"><span id="ai-bar" style="width:0%"></span></div>
              <div class="small muted" id="ai-stage">Подготовка…</div>
            </div>
          </div>
          <div class="card card-pad">
            <b class="small">Экспорт и действия</b>
            <div class="stack" style="gap:8px;margin-top:10px">
              <button class="btn btn--ghost btn--sm btn--block" id="ai-txt" disabled>${icon('file')} Скачать TXT</button>
              <button class="btn btn--ghost btn--sm btn--block" id="ai-srt" disabled>${icon('file')} Скачать SRT (субтитры)</button>
              <button class="btn btn--soft btn--sm btn--block" id="ai-attach" disabled>${icon('clip')} Прикрепить к заказу</button>
            </div>
            
          </div>
        </div>
        <div class="card ai-transcript">
          <div class="ai-toolbar">
            <button class="iconbtn" id="ai-play" disabled>${icon('play')}</button>
            <span class="mono small" id="ai-time">00:00 / ${fmtClock(AI_DATA.duration)}</span>
            <select class="input" id="ai-rate" style="width:auto;padding:5px 26px 5px 10px;font-size:12px">
              ${[0.75,1,1.25,1.5].map(r=>`<option value="${r}" ${r===1?'selected':''}>×${r}</option>`).join('')}
            </select>
            <span class="spacer"></span>
            <div class="input-wrap" style="width:200px">${icon('search')}<input class="input" id="ai-search" placeholder="Поиск в тексте…" style="padding:6px 10px 6px 32px;font-size:12.5px"></div>
            <button class="btn btn--ghost btn--sm" id="ai-editmode">${icon('edit')} Ручная правка</button>
          </div>
          <canvas id="ai-wave" height="56"></canvas>
          <div class="ai-msg" id="ai-msg">${icon('sparkle')} Запустите распознавание, чтобы получить стенограмму с караоке-синхроном.</div>
          <div class="ai-segs" id="ai-segs" hidden>${segsHTML()}</div>
          <div class="ai-legend small faint">${icon('alert','ico-sm')} пунктир — неуверенное слово (кликните для альтернатив) · <span class="c-green">зелёный</span> — исправлено вручную · подсветка бежит синхронно с аудио</div>
        </div>
      </div>`;

    bindTabs(root);
    const g = s => root.querySelector(s);

    /* --- распознавание (симуляция пайплайна) --- */
    const stages = [['Загрузка аудио на сервер…',18],['Диаризация: поиск спикеров…',42],['Распознавание речи…',78],['Постобработка и пунктуация…',96],['Готово',100]];
    g('#ai-run').onclick = ()=>{
      const prog = g('#ai-progress'); prog.style.display = '';
      const bar = g('#ai-bar'), stage = g('#ai-stage');
      let i = 0;
      const tick = ()=>{
        if (i >= stages.length){
          T.processed = true;
          S.aiUsage.min = Math.min(S.aiUsage.limit, S.aiUsage.min + AI_DATA.duration*T.scale/60);
          saveState();
          g('#ai-msg').style.display = 'none';
          g('#ai-segs').hidden = false;
          g('#ai-run').disabled = true;
          g('#ai-run').innerHTML = icon('check-c')+' Готово';
          ['#ai-txt','#ai-srt','#ai-attach'].forEach(s=>g(s).disabled = false);
          g('#ai-play').disabled = false;
          stage.textContent = 'Стенограмма готова · 139 слов · 2 спикера';
          rebuildFlat();
          drawWave();
          return;
        }
        const [label, pct] = stages[i];
        stage.textContent = label; bar.style.width = pct+'%';
        i++; setTimeout(tick, 520 + Math.random()*420);
      };
      tick();
      logAudit('ИИ-стенограмма: запущено распознавание', 'ИИ');
    };

    /* --- источник --- */
    g('#ai-upload').onclick = ()=>g('#ai-file').click();
    g('#ai-file').onchange = e=>{
      const f = e.target.files[0]; if (!f) return;
      T.uploading = true; T.sourceName = f.name; T.processed = false;
      const url = URL.createObjectURL(f);
      setAudio(new Audio(url));
      const a = T.audio;
      a.onloadedmetadata = ()=>{
        T.scale = (a.duration && isFinite(a.duration)) ? a.duration / AI_DATA.duration : 1;
        T.audio.onloadedmetadata = null;
        render();
        toast(`Файл «${f.name}» загружен — запустите распознавание`, 'ok');
      };
    };
    g('#ai-reset').onclick = ()=>{ resetSource(); render(); };

    function resetSource(){
      T.uploading = false; T.sourceName = null; T.processed = false; T.scale = 1;
      setAudio(new Audio('data:audio/wav;base64,' + AI_AUDIO_B64));
    }
    function setAudio(a){
      if (T.audio){
        T.audio.pause();
        if (T._handlers) Object.entries(T._handlers).forEach(([ev,fn])=>T.audio.removeEventListener(ev, fn));
      }
      T.audio = a;
      T.audio.preload = 'auto';
    }
    function bindAudio(){
      if (!T.audio) return;
      const old = document.getElementById('ai-audio');
      if (old && old !== T.audio) old.remove();
      if (!T.audio.isConnected){ T.audio.id = 'ai-audio'; T.audio.style.display = 'none'; document.body.appendChild(T.audio); }
      T._handlers = {
        timeupdate:onTime, seeked:onTime, play:onTime,
        ended:()=>{ const b = g('#ai-play'); b && (b.innerHTML = icon('play')); }
      };
      Object.entries(T._handlers).forEach(([ev,fn])=>T.audio.addEventListener(ev, fn));
    }
    if (!T.audio) setAudio(new Audio('data:audio/wav;base64,' + AI_AUDIO_B64));
    if (T.uploading && T.audio) { /* уже установлен */ }
    bindAudio();

    /* --- плеер --- */
    g('#ai-play').onclick = ()=>{
      if (!T.audio) return;
      if (T.audio.paused){ T.audio.playbackRate = T.rate; T.audio.play(); g('#ai-play').innerHTML = icon('x-c'); }
      else { T.audio.pause(); g('#ai-play').innerHTML = icon('play'); }
    };
    g('#ai-rate').onchange = e=>{ T.rate = +e.target.value; if (T.audio) T.audio.playbackRate = T.rate; };
    g('#ai-wave').onclick = e=>{
      if (!T.processed) return;
      const r = e.currentTarget.getBoundingClientRect();
      const t = (e.clientX - r.left) / r.width * AI_DATA.duration;
      if (T.audio){ T.audio.currentTime = Math.min(t, T.audio.duration||t); if (T.audio.paused) g('#ai-play').click(); }
    };
    g('#ai-search').addEventListener('input', debounce(()=>{
      T.search = g('#ai-search').value.trim();
      highlightSearch();
    }));

    function highlightSearch(){
      if (!T.search) { $$('#ai-segs .tseg__text').forEach(p=>{ p.innerHTML = p.innerHTML.replace(/<\/?mark>/g,''); }); return; }
      const q = norm(T.search);
      $$('#ai-segs .tseg__text').forEach(p=>{
        const spans = $$('.w', p);
        p.innerHTML = spans.map(sp=>norm(sp.textContent).includes(q) ? `<mark>${sp.outerHTML}</mark>` : sp.outerHTML).join(' ');
      });
    }

    function drawWave(){
      const cv = g('#ai-wave'); if (!cv) return;
      const W = Math.max(160, cv.parentElement.clientWidth - 4), H = 56;
      cv.width = W * devicePixelRatio; cv.height = H * devicePixelRatio;
      cv.style.width = W+'px';
      const ctx = cv.getContext('2d'); ctx.scale(devicePixelRatio, devicePixelRatio);
      const N = Math.floor(W/4);
      const peaks = new Array(N).fill(0.06);
      AI_DATA.segments.forEach(seg=>{
        seg.words.forEach(w=>{
          const a = Math.floor(w.s*T.scale/AI_DATA.duration*N), b = Math.ceil(w.e*T.scale/AI_DATA.duration*N);
          for (let i=a;i<=Math.min(b,N-1);i++) peaks[i] = Math.max(peaks[i], 0.3 + 0.6*hashStr(w.w)%40/60);
        });
      });
      T._peaks = peaks; T._waveW = W;
      paintWave(0);
    }
    function paintWave(progress){
      const cv = g('#ai-wave'); if (!cv || !T._peaks) return;
      const H = 56, W = T._waveW, N = T._peaks.length;
      const ctx = cv.getContext('2d');
      ctx.clearRect(0,0,W,H);
      const px = progress * W;
      for (let i=0;i<N;i++){
        const h = Math.max(3, T._peaks[i]*H*0.9);
        const x = i*4;
        ctx.fillStyle = x <= px ? getComputedStyle(document.documentElement).getPropertyValue('--accent') : getComputedStyle(document.documentElement).getPropertyValue('--panel-3');
        ctx.beginPath();
        ctx.roundRect(x, (H-h)/2, 2.6, h, 2);
        ctx.fill();
      }
    }

    function onTime(){
      if (!T.processed) return;
      const cur = T.audio ? T.audio.currentTime / (T.scale||1) : 0;
      g('#ai-time') && (g('#ai-time').textContent = `${fmtClock(cur)} / ${fmtClock(AI_DATA.duration)}`);
      paintWave(Math.min(1, cur/AI_DATA.duration));
      /* караоке: поиск текущего слова */
      let wi = -1;
      const flat = T._flat || [];
      for (let i=0;i<flat.length;i++){
        const w = flat[i];
        if (cur >= w.s && cur < w.e){ wi = i; break; }
        if (w.s > cur) break;
      }
      if (wi !== T.activeWord){
        if (T.activeWord >= 0 && flat[T.activeWord]) flat[T.activeWord].el.classList.remove('k-active');
        if (wi >= 0 && flat[wi]){
          const el = flat[wi].el;
          el.classList.add('k-active');
          if (el.parentElement && el.closest('.tseg')){
            const seg = el.closest('.tseg');
            if (+seg.dataset.seg !== T.activeSeg){
              T.activeSeg = +seg.dataset.seg;
              if (!T.audio.paused) seg.scrollIntoView({ block:'center', behavior:'smooth' });
            }
          }
        }
        T.activeWord = wi;
      }
      /* пройденные слова */
      if (flat.length){
        const upTo = wi >= 0 ? wi : flat.findIndex(w=>w.s > cur);
        flat.forEach((w, i)=>{ w.el && w.el.classList.toggle('k-done', i < (upTo < 0 ? flat.length : upTo)); });
      }
    }
    T._onTimeBound = true;

    /* --- слова: альтернативы --- */
    root.addEventListener('click', e=>{
      const wEl = e.target.closest('.w.low');
      if (wEl){
        const si = +wEl.dataset.si, wi = +wEl.dataset.wi;
        const w = buildWords(si).find(x=>x.wi===wi);
        const curConf = Math.round((w.conf||0.6)*100);
        const items = (w.alts||[]).map((alt, i)=>({
          label:`${alt} · уверенность ${Math.max(38, curConf - 7 - i*9)}%`,
          icon:'edit',
          onClick:()=>{
            /* сохраняем знаки препинания слова */
            const m = w.t.match(/^(.*?)([.,!?;:…]*)$/);
            const punct = m[2]||'';
            S.aiEdits[si+'_'+wi] = { t: alt + punct };
            saveState();
            wEl.textContent = alt + punct;
            wEl.classList.remove('low'); wEl.classList.add('edited');
            logAudit(`ИИ-стенограмма: «${w.t}» → «${alt+punct}»`, 'ИИ');
            toast('Слово заменено — правка сохранена', 'ok');
          }
        }));
        contextMenu(e.clientX, e.clientY, [
          { label:`Уверенность распознавания: ${curConf}%`, header:true },
          ...items,
          '-',
          { label:'Оставить как есть', icon:'check-c', onClick:()=>{ wEl.classList.remove('low'); wEl.classList.add('edited'); S.aiEdits[si+'_'+wi] = { t:wEl.textContent }; saveState(); } }
        ]);
        return;
      }
      const ts = e.target.closest('[data-seek]');
      if (ts && T.audio){ T.audio.currentTime = +ts.dataset.seek * (T.scale||1); if (T.audio.paused) g('#ai-play').click(); return; }
      const spk = e.target.closest('[data-spk]');
      if (spk){
        const idv = spk.dataset.spk;
        const name = prompt2(`Имя спикера ${idv}:`, S.aiSpeakers[idv]||AI_DATA.speakers[idv]);
        if (name){ S.aiSpeakers[idv] = name; saveState(); render(); }
      }
    });

    /* --- ручная правка --- */
    let editMode = false;
    g('#ai-editmode').onclick = ()=>{
      editMode = !editMode;
      g('#ai-editmode').classList.toggle('btn--soft', editMode);
      $$('#ai-segs .tseg__text').forEach(p=>{
        p.contentEditable = editMode;
        p.classList.toggle('editing', editMode);
        p.dataset.editable = editMode ? '1' : '0';
      });
      toast(editMode ? 'Ручная правка включена — изменяйте текст прямо в сегментах' : 'Ручная правка выключена', 'info');
    };
    root.addEventListener('blur', e=>{
      const p = e.target.closest && e.target.closest('.tseg__text.editing');
      if (!p) return;
      const si = +p.closest('.tseg').dataset.seg;
      S.aiSegOverrides[si] = p.textContent.replace(/\s+/g,' ').trim();
      saveState();
      logAudit('ИИ-стенограмма: сегмент отредактирован вручную', 'ИИ');
      rebuildFlat();
    }, true);

    /* --- экспорт --- */
    g('#ai-txt').onclick = ()=>{ dl(`transcript-${fmtDate(Date.now()).replace(/\s/g,'-')}.txt`, transcriptPlain()); toast('TXT выгружен','ok'); };
    g('#ai-srt').onclick = ()=>{ dl('transcript.srt', transcriptSRT(), 'application/x-subrip'); toast('SRT выгружен','ok'); };
    g('#ai-attach').onclick = ()=>attachToOrder('стенограмма', 'ai-transcript.txt', transcriptPlain());

    /* --- индекс слов для караоке --- */
    function rebuildFlat(){
      T._flat = [];
      $$('#ai-segs .tseg').forEach(segEl=>{
        const si = +segEl.dataset.seg;
        const words = buildWords(si);
        $$('.w', segEl).forEach(sp=>{
          const wi = +sp.dataset.wi;
          const w = words.find(x=>x.wi===wi);
          if (w) T._flat.push({ ...w, el:sp });
        });
      });
      T._flat.sort((a,b)=>a.s-b.s);
      T.activeWord = -1; T.activeSeg = -1;
    }
    if (T.processed){ rebuildFlat(); drawWave(); g('#ai-msg').style.display='none'; g('#ai-segs').hidden=false; }
    if (!T._resizeInit){ T._resizeInit = true; window.addEventListener('resize', debounce(()=>{ if (T.processed && document.querySelector('#ai-wave')) drawWave(); }, 200)); }
  }

  /* ==================== ИИ-КОПИРАЙТИНГ ==================== */
  const TONES = {
    business: { name:'Деловой', adj:'надёжное решение', verb:'обеспечивает', cta:'Запросите коммерческое предложение — ответим в течение рабочего дня.' },
    friendly: { name:'Дружелюбный', adj:'удобное решение', verb:'помогает', cta:'Попробуйте бесплатно — и убедитесь сами!' },
    selling:  { name:'Продающий', adj:'выгодное решение', verb:'экономит', cta:'Оставьте заявку сегодня — скидка 10% на первый заказ!' }
  };
  const HOOKS = [
    t=>`${t} — задача, которая отнимает часы у вашей команды.`,
    t=>`Каждый день бизнес теряет время на ${t.toLowerCase()}. Пора это исправить.`,
    t=>`Что если ${t.toLowerCase()} занимали бы минуты, а не дни?`,
    t=>`${t}: как перестать тонуть в рутине и начать расти.`
  ];
  const BENEFITS = [
    'Экономия до 70% рабочего времени на рутинных операциях',
    'Прозрачный контроль качества на каждом этапе',
    'Готовые интеграции с вашими инструментами',
    'Поддержка живых людей, а не ботов',
    'Гибкие тарифы под любой объём задач',
    'Конфиденциальность: данные шифруются по стандарту AES-256'
  ];
  const DETAILS = [
    t=>`Мы спроектировали решение так, чтобы ${t.toLowerCase()} не требовали обучения: интерфейс понятен с первого экрана, а умные подсказки ведут пользователя шаг за шагом.`,
    t=>`Команды, которые уже перешли к нам, отмечают главное — предсказуемость. Дедлайны соблюдаются, статусы прозрачны, а каждый заказ виден в реальном времени.`,
    t=>`Безопасность встроена по умолчанию: резервные копии, журнал аудита и разграничение прав ролей. Ваши данные остаются вашими.`,
    t=>`Подключение занимает один день: импорт данных из привычных таблиц, настройка процессов с наставником и запуск без остановки работы.`
  ];

  function composeArticle(theme, tone, len, variant){
    const T2 = TONES[tone] || TONES.business;
    const pick = (arr, i) => arr[(hashStr(theme+'|'+variant+'|'+i)) % arr.length];
    const bullets = [...BENEFITS].sort(()=>hashStr(theme+variant+len) % 2 - 1).slice(0, 2+len).map(b=>`— ${b}.`);
    const details = [];
    for (let i=0;i<Math.max(1, Math.round(len/1.5));i++) details.push(pick(DETAILS, i)(theme));
    const title = pick([
      `${theme}: ${T2.adj} для вашей команды`,
      `Как ${theme.toLowerCase()} перестаёт быть проблемой`,
      `${theme} без хаоса — за один день`,
      `Пора перезагрузить ${theme.toLowerCase()}`
    ], 0);
    const body = [
      pick(HOOKS, 0)(theme),
      `«${theme}» ${T2.verb} время и нервы: процессы выстроены, статусы прозрачны, а результат предсказуем. ${details[0]}`,
      `Что вы получаете:\n${bullets.join('\n')}`,
      details.slice(1).join(' '),
      T2.cta
    ].filter(Boolean).join('\n\n');
    return { title, body };
  }
  function rewriteText(src){
    const DICT = { 'очень':'по-настоящему', 'быстро':'стремительно', 'хорошо':'качественно', 'проблема':'задача', 'купить':'приобрести', 'дешево':'выгодно', 'крутой':'отличный', 'сделать':'выполнить', 'сказал':'отметил', 'много':'значительный объём', 'хочу':'планирую', 'надо':'необходимо', 'лучший':'оптимальный', 'просто':'легко', 'красивый':'аккуратный', 'быстрый':'оперативный', 'большой':'масштабный', 'плохо':'недостаточно хорошо', 'работает':'функционирует', 'использовать':'применять', 'начать':'приступить', 'получить':'получить доступ к' };
    let count = 0;
    const out = src.replace(/[А-ЯЁа-яё]+/g, w=>{
      const lw = w.toLowerCase();
      if (DICT[lw]){
        count++;
        const rep = DICT[lw];
        return w[0] === w[0].toUpperCase() ? rep[0].toUpperCase()+rep.slice(1) : rep;
      }
      return w;
    }).replace(/\s{2,}/g,' ').replace(/\s+([,.!?;:])/g,'$1');
    return { text: out, count };
  }
  function summarizeText(src){
    const sents = src.replace(/\n+/g,' ').split(/(?<=[.!?])\s+/).filter(s=>s.trim().length > 20);
    const scored = sents.map((s,i)=>({ s, i, score: (/[0-9]/.test(s)?2:0) + (/(клиент|заказ|проект|запуск|результат|эконом|качеств)/i.test(s)?2:0) + Math.min(2, s.length/160) }));
    const top = scored.sort((a,b)=>b.score-a.score).slice(0,3).sort((a,b)=>a.i-b.i);
    return `Краткое содержание:\n\n• ${top.map(x=>x.s.trim()).join('\n• ')}`;
  }
  function headlinesFor(theme){
    return [
      `${theme}: полное руководство для занятых команд`,
      `7 способов, которыми ${theme.toLowerCase()} экономит бюджет`,
      `Почему ${theme.toLowerCase()} без автоматизации — это потерянные деньги`,
      `${theme} в 2026 году: тренды, цифры, выводы`,
      `Как внедрить ${theme.toLowerCase()} за неделю — чек-лист`,
      `${theme}: сравнили подходы и выбрали лучший`
    ];
  }

  function textsView(root){
    bindTabs(root);
    let variants = [], curVar = 0, genKind = null;
    root.innerHTML = `
      ${aiHead('ИИ-копирайтинг','Генерация, рерайт, саммари и заголовки — структура и стиль сохраняются','ai-texts')}
      <div class="ai-layout">
        <div class="stack" style="gap:12px">
          ${usagePillHTML()}
          <div class="card card-pad">
            <b class="small">${icon('edit','ico-sm')} Бриф</b>
            <div class="field" style="margin-top:10px"><label>Тема или продукт</label>
              <input class="input" id="tx-theme" placeholder="Например: сервис расшифровки аудио" value="${esc(T.txTheme||'')}"></div>
            <div class="field" style="margin-top:10px"><label>Тон</label>
              <div class="seg" id="tx-tone">${Object.entries(TONES).map(([k,t],i)=>`<button data-t="${k}" class="${i===0?'on':''}">${t.name}</button>`).join('')}</div></div>
            <div class="field" style="margin-top:12px"><label>Длина: <b id="tx-len-v">3</b></label>
              <input type="range" id="tx-len" min="1" max="5" value="3"></div>
            <div class="stack" style="gap:7px;margin-top:14px">
              <button class="btn btn--primary btn--block" data-kind="write">${icon('sparkle')} Написать текст</button>
              <button class="btn btn--ghost btn--sm btn--block" data-kind="head">${icon('bulb')} Заголовки</button>
            </div>
          </div>
          <div class="card card-pad">
            <b class="small">${icon('file','ico-sm')} Исходный текст — для рерайта и саммари</b>
            <textarea class="input" id="tx-src" style="margin-top:10px;min-height:110px" placeholder="Вставьте текст: рерайт освежит стиль, саммари выжмет суть…">${esc(T.txSrc||'')}</textarea>
            <div class="row" style="gap:7px;margin-top:10px">
              <button class="btn btn--ghost btn--sm" data-kind="rewrite">${icon('refresh')} Рерайт</button>
              <button class="btn btn--ghost btn--sm" data-kind="summ">${icon('scroll')} Саммари</button>
            </div>
          </div>
        </div>
        <div class="card ai-transcript">
          <div class="ai-toolbar">
            <b class="small" id="tx-out-title">Результат</b>
            <span class="spacer"></span>
            <div id="tx-vars" class="chips" style="display:none">
              ${[0,1,2].map(i=>`<span class="chip" data-v="${i}">Вариант ${i+1}</span>`).join('')}
              <button class="iconbtn" id="tx-regen" title="Перегенерировать" style="width:30px;height:30px">${icon('refresh')}</button>
            </div>
          </div>
          <div class="ai-msg" id="tx-msg">${icon('sparkle')} Заполните бриф слева и выберите действие — текст появится здесь с эффектом печати.</div>
          <div class="ai-out" id="tx-out" hidden></div>
          <div class="ai-toolbar" id="tx-actions" style="border-top:1px solid var(--border);display:none">
            <button class="btn btn--ghost btn--sm" id="tx-copy">${icon('copy')} Копировать</button>
            <button class="btn btn--ghost btn--sm" id="tx-dl">${icon('export')} Скачать</button>
            <button class="btn btn--soft btn--sm" id="tx-attach">${icon('clip')} Прикрепить к заказу</button>
            <span class="spacer"></span><span class="small faint" id="tx-stat"></span>
          </div>
        </div>
      </div>`;

    const g = s => root.querySelector(s);
    let tone = 'business', lastResult = '';
    g('#tx-len').oninput = e=>g('#tx-len-v').textContent = e.target.value;
    $$('#tx-tone button', root).forEach(b=>b.onclick = ()=>{ $$('#tx-tone button',root).forEach(x=>x.classList.remove('on')); b.classList.add('on'); tone = b.dataset.t; });

    function typeOut(html){
      const out = g('#tx-out');
      out.hidden = false; g('#tx-msg').style.display = 'none';
      g('#tx-actions').style.display = '';
      let i = 0;
      out.textContent = '';
      const plain = lastResult;
      const iv = setInterval(()=>{
        i += 7;
        out.textContent = plain.slice(0, i);
        out.scrollTop = out.scrollHeight;
        if (i >= plain.length){ clearInterval(iv); out.textContent = plain; }
      }, 12);
    }
    function showResult(kind, content, stat){
      genKind = kind; lastResult = content;
      g('#tx-out-title').textContent = ({ write:'Сгенерированный текст', rewrite:'Рерайт', summ:'Саммари', head:'Варианты заголовков' })[kind];
      g('#tx-vars').style.display = kind==='write' ? '' : 'none';
      g('#tx-stat').textContent = stat||'';
      typeOut();
    }
    $$('[data-kind]', root).forEach(b=>b.onclick = ()=>{
      const kind = b.dataset.kind;
      const theme = g('#tx-theme').value.trim() || 'Наш сервис';
      T.txTheme = g('#tx-theme').value; T.txSrc = g('#tx-src').value;
      if ((kind==='rewrite'||kind==='summ') && g('#tx-src').value.trim().length < 40){ toast('Вставьте исходный текст (минимум 40 символов)','warn'); return; }
      if (kind==='write'){
        const len = +g('#tx-len').value;
        variants = [0,1,2].map(v=>{ const r = composeArticle(theme, tone, len, v); return `${r.title}\n\n${r.body}`; });
        curVar = 0;
        $$('#tx-vars .chip', root).forEach((c,i)=>c.classList.toggle('on', i===0));
        showResult('write', variants[0], `${variants[0].length} символов · тон: ${TONES[tone].name}`);
      }
      if (kind==='head'){
        const hs = headlinesFor(theme);
        showResult('head', hs.map((h,i)=>`${i+1}. ${h}`).join('\n'), '6 формул заголовков');
      }
      if (kind==='rewrite'){
        const r = rewriteText(g('#tx-src').value);
        showResult('rewrite', r.text, `правок: ${r.count}`);
      }
      if (kind==='summ'){
        showResult('summ', summarizeText(g('#tx-src').value), '3 ключевых тезиса');
      }
      logAudit(`ИИ-копирайтинг: ${kind}`, 'ИИ');
    });
    $$('#tx-vars .chip', root).forEach(c=>c.onclick = ()=>{
      curVar = +c.dataset.v;
      $$('#tx-vars .chip', root).forEach(x=>x.classList.toggle('on', x===c));
      lastResult = variants[curVar];
      typeOut();
      g('#tx-stat').textContent = `${lastResult.length} символов · вариант ${curVar+1}`;
    });
    g('#tx-regen').onclick = ()=>{
      const theme = g('#tx-theme').value.trim() || 'Наш сервис';
      const len = +g('#tx-len').value;
      variants = [0,1,2].map(v=>{ const r = composeArticle(theme+' ', tone, len, v+3+hashStr(genKind)); return `${r.title}\n\n${r.body}`; });
      lastResult = variants[curVar]; typeOut();
      toast('Новые варианты готовы','ok');
    };
    g('#tx-copy').onclick = ()=>{ navigator.clipboard && navigator.clipboard.writeText(lastResult); toast('Скопировано в буфер','ok'); };
    g('#tx-dl').onclick = ()=>dl('ai-text.txt', lastResult);
    g('#tx-attach').onclick = ()=>attachToOrder('ИИ-текст', 'ai-text.txt', lastResult);
  }

  /* ==================== ИИ-ПЕРЕВОДЫ ==================== */
  const DICT_EN = ('и:and,в:in,не:not,на:on,с:with,как:as,а:and,но:but,мы:we,вы:you,они:they,это:this,того:that,для:for,по:on,из:from,у:at,о:about,за:behind,то:then,же:too,от:from,бы:would,был:was,была:was,было:was,будет:will,есть:is,мой:my,ваш:your,наш:our,их:their,к:to,до:until,при:at,над:above,под:under,без:without,через:through,между:between,каждый:every,все:all,или:or,если:if,когда:when,что:that,чтобы:to,клиент:client,клиента:client,заказ:order,заказа:order,заказы:orders,заказов:orders,документ:document,документа:document,документы:documents,аудио:audio,запись:recording,записи:recording,файл:file,файла:file,файлы:files,текст:text,текста:text,тексты:texts,перевод:translation,перевода:translation,переводы:translations,переводчик:translator,стенограмма:transcript,стенограммы:transcripts,расшифровка:transcription,качество:quality,качества:quality,срок:deadline,сроки:deadlines,дедлайн:deadline,цена:price,цены:prices,стоимость:cost,оплата:payment,оплаты:payment,счёт:invoice,счета:invoice,договор:contract,договора:contract,проект:project,проекта:project,команда:team,команды:team,менеджер:manager,менеджера:manager,исполнитель:contractor,исполнителя:contractor,время:time,времени:time,день:day,дня:day,минута:minute,минуты:minutes,час:hour,часа:hour,работа:work,работы:work,работать:work,сделать:make,сделает:will make,система:system,системы:system,сервис:service,сервиса:service,сервисы:services,платформа:platform,данные:data,данных:data,данные_:data,безопасность:security,караоке:karaoke,синхрон:sync,подсветка:highlight,слово:word,слова:words,язык:language,языка:language,языки:languages,структура:structure,структуры:structure,абзац:paragraph,абзацы:paragraphs,список:list,списки:lists,форматирование:formatting,сохраняется:is preserved,сохранение:preservation,быстро:fast,точно:accurate,точно_:precisely,удобно:convenient,просто:simply,готовый:ready,готовая:ready,готовое:ready,новый:new,новая:new,новое:new,первый:first,второй:second,три:three,два:two,один:one,вы:you,ваш_:your,результат:result,результаты:results,вариант:variant,варианты:variants,задача:task,задачи:tasks,рутина:routine,машине:machine,команда_:team,занимается:handles,спасибо:thank you,привет:hello,добро:welcome,пожаловать:welcome,сегодня:today,говорить:speak,говорим:speak,понимает:understands,понял:understood,нравится:like,понравилось:liked,выбираешь:choose,выбрать:choose,запускаем:launch,запустить:launch,загрузили:uploaded,загрузка:upload,получили:received,получаете:get,прикрепить:attach,приложить:attach,отправить:send,отправка:sending,скачать:download,копировать:copy,буфер:buffer,интерфейс:interface,тап:none,клик:click,кнопка:button,сервер:server,облако:cloud,офлайн:offline,онлайн:online,тариф:plan,тарифы:plans,подписка:subscription,минута_:minute,бесплатно:free,бесплатный:free,скидка:discount,скидки:discounts,промокод:promo code,услуга:service,услуги:services,заказчик:customer,заказчика:customer,аудио_:audio,видео:video,субтитры:subtitles,субтитр:subtitle,таймкод:timecode,таймкоды:timecodes,точность:accuracy,модель:model,модели:model,нейросеть:neural network,и_:and,а_:whereas,да:yes,нет:no,хорошо:good,отлично:excellent,спасибо_:thanks,пожалуйста:please,извините:sorry,здравствуйте:hello');
  const DICT_DE = ('и:und,в:in,не:nicht,на:auf,с:mit,как:wie,но:aber,мы:wir,вы:Sie,они:sie,это:dies,для:für,из:aus,у:bei,о:über,есть:ist,будет:wird,был:war,клиент:Kunde,заказ:Bestellung,документ:Dokument,документы:Dokumente,аудио:Audio,запись:Aufnahme,файл:Datei,текст:Text,перевод:Übersetzung,стенограмма:Transkript,качество:Qualität,срок:Frist,цена:Preis,стоимость:Kosten,оплата:Zahlung,договор:Vertrag,проект:Projekt,команда:Team,менеджер:Manager,время:Zeit,день:Tag,час:Stunde,работа:Arbeit,система:System,сервис:Service,платформа:Plattform,данные:Daten,безопасность:Sicherheit,язык:Sprache,структура:Struktur,абзац:Absatz,список:Liste,быстро:schnell,точно:genau,готовый:fertig,новый:neu,результат:Ergebnis,задача:Aufgabe,подписка:Abonnement,скидка:Rabatt,услуги:Leistungen,субтитры:Untertitel,таймкод:Zeitcode,модель:Modell,привет:Hallo,спасибо:Danke,пожалуйста:bitte,сегодня:heute,понимает:versteht,сохраняется:wird beibehalten');
  const DICT_ES = ('и:y,в:en,не:no,на:en,с:con,как:como,но:pero,мы:nosotros,вы:ustedes,они:ellos,это:esto,для:para,из:de,есть:es,будет:será,клиент:cliente,заказ:pedido,документ:documento,документы:documentos,аудио:audio,запись:grabación,файл:archivo,текст:texto,перевод:traducción,стенограмма:transcripción,качество:calidad,срок:plazo,цена:precio,стоимость:coste,оплата:pago,договор:contrato,проект:proyecto,команда:equipo,менеджер:gerente,время:tiempo,день:día,час:hora,работа:trabajo,система:sistema,сервис:servicio,платформа:plataforma,данные:datos,безопасность:seguridad,язык:idioma,структура:estructura,абзаz:párrafo,абзац:párrafo,список:lista,быстро:rápido,точно:preciso,готовый:listo,новый:nuevo,результат:resultado,задача:tarea,подписка:suscripción,скидка:descuento,услуги:servicios,субтитры:subtítulos,таймкод:código de tiempo,модель:modelo,привет:hola,спасибо:gracias,пожалуйста:por favor,сегодня:hoy,понимает:entiende,сохраняется:se conserva');
  const LANGS = { en:{ name:'English', dict:DICT_EN }, de:{ name:'Deutsch', dict:DICT_DE }, es:{ name:'Español', dict:DICT_ES } };
  function parseDict(str){
    const d = {};
    str.split(',').forEach(p=>{ const [k,v] = p.split(':'); if (k && v) d[k.trim().toLowerCase()] = v.trim(); });
    return d;
  }
  function pseudoTranslate(text, dict){
    let total = 0, known = 0;
    const re = /([А-ЯЁа-яё]+(?:-[А-ЯЁа-яё]+)*)/g;
    const out = text.replace(re, word=>{
      total++;
      const parts = word.split('-');
      const tr = parts.map(p=>{
        const lw = p.toLowerCase().replace(/ё/g,'е');
        const hit = dict[lw] || dict[p.toLowerCase()];
        if (hit){ known++; return word[0] === word[0].toUpperCase() ? hit[0].toUpperCase()+hit.slice(1) : hit; }
        return p;
      }).join('-');
      return tr;
    });
    return { text: out, total, known };
  }

  function translateView(root){
    bindTabs(root);
    let target = 'en', lastResult = '', lastSrc = '';
    root.innerHTML = `
      ${aiHead('ИИ-переводы','Автоматический перевод с сохранением структуры: абзацы, списки и форматирование остаются на местах','ai-translate')}
      <div class="ai-layout" style="grid-template-columns:1fr 1fr;max-width:none">
        <div class="stack" style="gap:12px">
          ${usagePillHTML()}
          <div class="card card-pad">
            <div class="row" style="gap:10px">
              <div class="field" style="flex:1"><label>Исходный язык</label><input class="input" value="Русский" disabled></div>
              <button class="iconbtn" style="margin-top:20px" disabled title="В демо исходный язык — русский">${icon('arrow-r')}</button>
              <div class="field" style="flex:1"><label>Целевой язык</label>
                <select class="input" id="tr-lang">${Object.entries(LANGS).map(([k,l])=>`<option value="${k}">${l.name}</option>`).join('')}</select></div>
            </div>
            <div class="field" style="margin-top:12px"><label>Текст для перевода</label>
              <textarea class="input" id="tr-src" style="min-height:180px" placeholder="Вставьте текст на русском… Абзацы, списки и переносы строк сохранятся.">Уважаемый клиент! Ваш заказ готов. Расшифровка аудио выполнена точно и в срок. Качество перевода гарантируем: структура документа сохраняется, абзацы и списки на своих местах. Счёт за услуги уже в вашем кабинете. Спасибо, что выбираете наш сервис!</textarea></div>
            <div class="row" style="gap:8px;margin-top:12px">
              <button class="btn btn--primary" id="tr-go">${icon('sparkle')} Перевести</button>
              <button class="btn btn--ghost btn--sm" id="tr-swap">${icon('refresh')} Вставить результат в источник</button>
              <span class="spacer"></span>
              <span class="small faint" id="tr-count"></span>
            </div>
          </div>
          <div class="card card-pad">
            <b class="small">О качестве</b>
            <p class="small muted" style="margin-top:6px">Перевод выполняется движком платформы: структура документа, абзацы и списки сохраняются. Глоссарий клиента и память переводов (TM) подключаются в настройках проекта.</p>
          </div>
        </div>
        <div class="card ai-transcript">
          <div class="ai-toolbar"><b class="small" id="tr-out-title">Перевод</b><span class="spacer"></span><span class="badge c-blue" id="tr-cov" hidden></span></div>
          <div class="ai-msg" id="tr-msg">${icon('globe')} Перевод появится здесь. Абзацы, переносы и списки сохраняются один в один.</div>
          <div class="ai-out" id="tr-out" hidden></div>
          <div class="ai-toolbar" id="tr-actions" style="border-top:1px solid var(--border);display:none">
            <button class="btn btn--ghost btn--sm" id="tr-copy">${icon('copy')} Копировать</button>
            <button class="btn btn--ghost btn--sm" id="tr-dl">${icon('export')} Скачать</button>
            <button class="btn btn--soft btn--sm" id="tr-attach">${icon('clip')} Прикрепить к заказу</button>
          </div>
        </div>
      </div>`;

    const g = s => root.querySelector(s);
    g('#tr-src').addEventListener('input', ()=>g('#tr-count').textContent = g('#tr-src').value.length + ' символов');
    g('#tr-count').textContent = g('#tr-src').value.length + ' символов';
    g('#tr-lang').onchange = e=>target = e.target.value;

    g('#tr-go').onclick = ()=>{
      const src = g('#tr-src').value;
      if (!src.trim()){ toast('Введите текст для перевода','warn'); return; }
      lastSrc = src;
      const lang = LANGS[target];
      const dict = parseDict(lang.dict);
      g('#tr-msg').style.display = '';
      g('#tr-msg').innerHTML = `<span class="spin" style="display:inline-block">${icon('refresh')}</span> Переводим на ${lang.name}…`;
      g('#tr-out').hidden = true; g('#tr-actions').style.display = 'none'; g('#tr-cov').hidden = true;
      setTimeout(()=>{
        const r = pseudoTranslate(src, dict);
        lastResult = r.text;
        const cov = Math.round(r.known / Math.max(1, r.total) * 100);
        g('#tr-msg').style.display = 'none';
        const out = g('#tr-out');
        out.hidden = false;
        out.textContent = r.text;
        g('#tr-actions').style.display = '';
        const covEl = g('#tr-cov');
        covEl.hidden = false;
        covEl.textContent = `покрытие словаря: ${cov}%`;
        logAudit(`ИИ-перевод: RU → ${target.toUpperCase()} (${r.total} слов)`, 'ИИ');
      }, 900);
    };
    g('#tr-swap').onclick = ()=>{
      if (!lastResult){ toast('Сначала переведите текст','info'); return; }
      g('#tr-src').value = lastResult; g('#tr-count').textContent = lastResult.length + ' символов';
      toast('Результат вставлен в источник','ok');
    };
    g('#tr-copy').onclick = ()=>{ navigator.clipboard && navigator.clipboard.writeText(lastResult); toast('Скопировано','ok'); };
    g('#tr-dl').onclick = ()=>dl(`translation-${target}.txt`, lastResult);
    g('#tr-attach').onclick = ()=>attachToOrder('перевод', `translation-${target}.txt`, lastResult);
  }

  function stopPlayback(){
    if (T.audio){ try{ T.audio.pause(); }catch(e){} }
  }

  return { transcribeView, textsView, translateView, stopPlayback,
    __dbg: () => ({ processed:T.processed, flat:(T._flat||[]).length, cur:T.audio?T.audio.currentTime:-1, aw:T.activeWord, handlers:!!T._handlers, scale:T.scale, audioOk:!!(T.audio&&(T.audio.duration>0||T.audio.readyState>0)) }) };
})();
