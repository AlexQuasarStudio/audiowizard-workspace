/* Простейший статический сервер для тестов: без зависимостей.
   Запуск: node tests/serve.js [порт]  (по умолчанию 8777) */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8777);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);
  /* Не выпускаем за пределы проекта: тестовый сервер, но правило то же. */
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')){
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()){ res.writeHead(404); res.end('not found'); return; }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    /* Range нужен аудио: без него Safari/Chrome не проигрывают WAV с seek. */
    if (range){
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Number(m[2]) : st.size - 1;
      if (start >= st.size || end >= st.size || start > end){
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return;
      }
      res.writeHead(206, {
        'Content-Type': type, 'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Content-Length': end - start + 1
      });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    /* Картинки (/bg/) — долгий кэш: узор 680 КБ иначе скачивается заново
       на каждую маску (preload + splash + auth + фон приложения). Код и
       стили по-прежнему no-store, чтобы правки подхватывались сразу.
       Меняя рисунок, переименуйте файл — иначе браузер отдаст старый. */
    const cache = /^\/bg\//.test(url) ? 'public, max-age=31536000, immutable' : 'no-store';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': cache });
    fs.createReadStream(file).pipe(res);
  });
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE'){
    console.error(`Порт ${PORT} занят — сервер уже запущен, тесты можно гонять.`);
    process.exit(0);
  }
  throw e;
});

server.listen(PORT, () => console.log(`Тестовый сервер: http://localhost:${PORT}/index.html`));
