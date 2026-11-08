/* Быстрая проверка синтаксиса: все скрипты проекта и тестов.
   Запуск: node tests/check.js (или npm run check). Без зависимостей. */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const files = [];
for (const dir of ['js', 'tests']){
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs).sort()){
    if (f.endsWith('.js')) files.push(path.join(dir, f));
  }
}
if (fs.existsSync(path.join(ROOT, 'sw.js'))) files.push('sw.js');

let bad = 0;
for (const rel of files){
  try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, rel)], { stdio: 'pipe' });
  } catch (e){
    bad++;
    console.error('✗ ' + rel);
    console.error(String(e.stderr || e.message));
  }
}
console.log(`Проверено файлов: ${files.length}, ошибок: ${bad}`);
process.exit(bad ? 1 : 0);
