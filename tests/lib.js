/* Общие помощники для браузерных тестов проекта.
   Playwright берём из окружения: переменная PLAYWRIGHT_MODULE, локальный
   node_modules или общий набор навыков MultiTool. */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');

function resolvePlaywright(){
  const candidates = [];
  if (process.env.PLAYWRIGHT_MODULE) candidates.push(process.env.PLAYWRIGHT_MODULE);
  candidates.push('playwright');
  const skills = process.env.GIGATOOL_SKILLS || path.join(os.homedir(), '.config/gigatool/skills');
  candidates.push(path.join(skills, 'web-automation/scripts/lib.js'));
  for (const c of candidates){
    try {
      if (c.endsWith('.js')){
        if (!fs.existsSync(c)) continue;
        const mod = require(c);
        if (mod && typeof mod.findPlaywright === 'function') return mod.findPlaywright();
      } else {
        return require.resolve(c);
      }
    } catch(e){ /* пробуем следующий вариант */ }
  }
  throw new Error(
    'Playwright не найден. Укажите PLAYWRIGHT_MODULE=/путь/к/playwright или установите пакет.'
  );
}

const BASE = process.env.BASE_URL || 'http://localhost:8777';

async function openPage(browser, { width = 1440, height = 1000 } = {}){
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE + '/index.html?_sw=0');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.waitForTimeout(650);
  return { ctx, page, errors };
}

/* Демо-вход и уборка служебных плашек поверх интерфейса. */
async function login(page, uid = 'u-admin'){
  await page.click(`.demo-chip[data-demo="${uid}"]`);
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const b = document.querySelector('.cookie-bar [data-ok]');
    if (b) b.click();
    if (window.Windows) Windows.closeAll();
  });
  await page.waitForTimeout(250);
}

module.exports = { resolvePlaywright, openPage, login, BASE };
