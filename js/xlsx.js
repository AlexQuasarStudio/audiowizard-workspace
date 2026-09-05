/* ============================================================
   Audiowizard Workspace — минимальный XLSX-ридер (без зависимостей)
   ZIP (EOCD → central directory → inflate-raw через DecompressionStream)
   + workbook/rels/sharedStrings/sheet XML → { sheets: [{ name, rows }] }
   ============================================================ */
'use strict';

const AWX = (() => {

  const dec = new TextDecoder('utf-8');
  const u16 = (v, o) => v[o] | (v[o+1] << 8);
  const u32 = (v, o) => (v[o] | (v[o+1] << 8) | (v[o+2] << 16) | (v[o+3] << 24)) >>> 0;

  function findEOCD(v){
    for (let i = v.length - 22; i >= Math.max(0, v.length - 22 - 65557); i--){
      if (u32(v, i) === 0x06054b50) return i;
    }
    return -1;
  }

  async function inflateRaw(bytes){
    if (!('DecompressionStream' in self)) throw new Error('браузер не поддерживает распаковку (DecompressionStream)');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(bytes){
    const eocd = findEOCD(bytes);
    if (eocd < 0) throw new Error('это не XLSX (нет ZIP-заголовка)');
    const count = u16(bytes, eocd + 10);
    let p = u32(bytes, eocd + 16);
    const files = {};
    for (let i = 0; i < count; i++){
      if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) break;
      const method = u16(bytes, p + 10);
      const csize = u32(bytes, p + 20);
      const nlen = u16(bytes, p + 28), elen = u16(bytes, p + 30), clen = u16(bytes, p + 32);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
      const lho = u32(bytes, p + 42);
      if (lho + 30 <= bytes.length && u32(bytes, lho) === 0x04034b50){
        const lnlen = u16(bytes, lho + 26), lelen = u16(bytes, lho + 28);
        const start = lho + 30 + lnlen + lelen;
        const data = bytes.subarray(start, start + csize);
        files[name] = (method === 8) ? await inflateRaw(data) : data;
      }
      p += 46 + nlen + elen + clen;
    }
    return files;
  }

  function unescapeXml(s){
    return String(s)
      .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function parseShared(xml){
    const out = [];
    const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(xml))){
      let s = '';
      const tre = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
      let t;
      while ((t = tre.exec(m[1]))) s += t[1];
      out.push(unescapeXml(s));
    }
    return out;
  }

  function colIdx(ref){
    let n = 0;
    for (const ch of ref){
      if (ch >= 'A' && ch <= 'Z') n = n * 26 + (ch.charCodeAt(0) - 64);
      else break;
    }
    return Math.max(0, n - 1);
  }

  function parseSheet(xml, sst){
    const rows = [];
    const rre = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g;
    let rm;
    while ((rm = rre.exec(xml))){
      const cells = [];
      const cre = /<c\s+([^>]*?)\/>|<c\s+([^>]*?)>([\s\S]*?)<\/c>/g;
      let cm;
      while ((cm = cre.exec(rm[1]))){
        const attrs = cm[1] || cm[2] || '';
        const inner = cm[3] || '';
        const refm = attrs.match(/r="([A-Z]+)\d+"/);
        const idx = refm ? colIdx(refm[1]) : cells.length;
        const t = (attrs.match(/t="([^"]+)"/) || [])[1] || 'n';
        let val = '';
        if (t === 's'){
          const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
          if (vm) val = sst[+vm[1]] || '';
        } else if (t === 'inlineStr'){
          let s = '';
          const tre = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
          let x;
          while ((x = tre.exec(inner))) s += x[1];
          val = unescapeXml(s);
        } else if (t === 'str' || t === 'e'){
          const vm = inner.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/) || inner.match(/<v>([\s\S]*?)<\/v>/);
          val = unescapeXml(vm ? vm[1] : '');
        } else {
          const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
          if (vm) val = vm[1];
        }
        cells[idx] = val;
      }
      rows.push(cells);
    }
    return rows;
  }

  async function read(file){
    return readBytes(new Uint8Array(await file.arrayBuffer()));
  }

  async function readBytes(bytes){
    const files = await unzip(bytes);
    const wb = dec.decode(files['xl/workbook.xml'] || new Uint8Array());
    const rels = dec.decode(files['xl/_rels/workbook.xml.rels'] || new Uint8Array());
    const sst = files['xl/sharedStrings.xml'] ? parseShared(dec.decode(files['xl/sharedStrings.xml'])) : [];
    const relMap = {};
    const rre = /Id="(rId\d+)"[^>]*Target="([^"]+)"/g;
    let m;
    while ((m = rre.exec(rels))) relMap[m[1]] = m[2].replace(/^\//, '').replace(/^xl\//, '');
    const sheets = [];
    const sre = /<sheet\b[^>]*>/g;
    while ((m = sre.exec(wb))){
      const tag = m[0];
      const nm = tag.match(/name="([^"]+)"/);
      const rid = tag.match(/r:id="(rId\d+)"/);
      if (!nm || !rid) continue;
      const target = relMap[rid[1]] || '';
      const xml = files['xl/' + target] || files[target];
      if (!xml) continue;
      sheets.push({ name: unescapeXml(nm[1]), rows: parseSheet(dec.decode(xml), sst) });
    }
    if (!sheets.length) throw new Error('в книге не найдено листов');
    return { sheets };
  }


  /* ---------- Мини-райтер: XLSX (stored ZIP + inlineStr) ---------- */
  const crcTable = (() => { const t = new Uint32Array(256); for (let n=0;n<256;n++){ let c=n; for (let k=0;k<8;k++) c = (c&1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1); t[n]=c>>>0; } return t; })();
  const crc32 = u8 => { let c = 0xFFFFFFFF; for (let i=0;i<u8.length;i++) c = crcTable[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const strU8 = s => new TextEncoder().encode(s);
  const concatU8 = parts => { const len = parts.reduce((a,p)=>a+p.length,0); const out = new Uint8Array(len); let o=0; for (const p of parts){ out.set(p,o); o+=p.length; } return out; };
  const u16b = v => new Uint8Array([v & 255, (v>>>8) & 255]);
  const u32b = v => new Uint8Array([v & 255, (v>>>8) & 255, (v>>>16) & 255, (v>>>24) & 255]);
  const dosDT = () => { const d = new Date(); const time = (d.getHours()<<11)|(d.getMinutes()<<5)|(d.getSeconds()>>>1); const date = ((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate(); return { time, date }; };
  function zipStore(files){
    const { time, date } = dosDT();
    const locals = [], centr = [], offsets = [];
    let offset = 0;
    for (const [name, content] of files){
      const nm = strU8(name), data = typeof content === 'string' ? strU8(content) : content;
      const crc = crc32(data);
      const local = concatU8([ u32b(0x04034b50), u16b(20), u16b(0), u16b(0), u16b(time), u16b(date), u32b(crc), u32b(data.length), u32b(data.length), u16b(nm.length), u16b(0), nm, data ]);
      locals.push(local); offsets.push(offset);
      centr.push(concatU8([ u32b(0x02014b50), u16b(20), u16b(20), u16b(0), u16b(0), u16b(time), u16b(date), u32b(crc), u32b(data.length), u32b(data.length), u16b(nm.length), u16b(0), u16b(0), u16b(0), u16b(0), u32b(0), u32b(offset), nm ]));
      offset += local.length;
    }
    const cdStart = offset; const cd = concatU8(centr);
    const eocd = concatU8([ u32b(0x06054b50), u16b(0), u16b(0), u16b(files.length), u16b(files.length), u32b(cd.length), u32b(cdStart), u16b(0) ]);
    return concatU8([...locals, cd, eocd]);
  }
  const escX = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const colRef = n => { let s=''; n+=1; while(n>0){ const m=(n-1)%26; s = String.fromCharCode(65+m)+s; n = Math.floor((n-1)/26); } return s; };
  function sheetXml(rows){
    const width = Math.max(1, ...rows.map(r=>r.length));
    const body = rows.map((r,ri)=>'<row r="'+(ri+1)+'">'+Array.from({length:width},(_,ci)=>{
      const c = r[ci];
      if (c === '' || c == null) return '';
      if (typeof c === 'number' && isFinite(c)) return '<c r="'+colRef(ci)+(ri+1)+'"><v>'+c+'</v></c>';
      return '<c r="'+colRef(ci)+(ri+1)+'" t="inlineStr"><is><t xml:space="preserve">'+escX(c)+'</t></is></c>';
    }).join('')+'</row>').join('');
    const lastCol = colRef(width-1); const lastRow = rows.length || 1;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:'+lastCol+lastRow+'"/><sheetData>'+body+'</sheetData></worksheet>';
  }
  function writeSheets(book){
    const names = Object.keys(book);
    const files = [];
    files.push(['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + names.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>']);
    files.push(['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rwb" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>']);
    files.push(['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + names.map((n,i)=>'<sheet name="'+escX(n)+'" sheetId="'+(i+1)+'" r:id="rs'+(i+1)+'"/>').join('') + '</sheets></workbook>']);
    files.push(['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + names.map((n,i)=>'<Relationship Id="rs'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('') + '</Relationships>']);
    names.forEach((n,i)=>files.push(['xl/worksheets/sheet'+(i+1)+'.xml', sheetXml(book[n])]));
    return zipStore(files);
  }

  return { read, readBytes, writeSheets };
})();
