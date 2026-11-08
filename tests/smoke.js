/* Smoke-набор: то, что должно быть верно после любой правки.
   Запуск: node tests/smoke.js   (сервер: node tests/serve.js)
   Выход: код 1, если хоть одна проверка провалилась. */
'use strict';
const fs = require('fs');
const path = require('path');
const { resolvePlaywright, openPage, login, BASE } = require('./lib');

const ROOT = path.resolve(__dirname, '..');
const results = [];
function check(name, ok, detail){
  results.push({ name, ok: !!ok, detail: detail === undefined ? null : detail });
  return ok;
}

(async () => {
  const { chromium } = require(resolvePlaywright());
  const build = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).build;
  const browser = await chromium.launch();
  const errors = [];
  let page = null;
  try {
    const opened = await openPage(browser);
    page = opened.page;
    errors.push(...opened.errors);

    check('сборка совпадает с version.json',
      (await page.evaluate(() => window.__BUILD_NUM__)) === build,
      { build });

    await login(page);
    check('после демо-входа отрисована оболочка',
      await page.evaluate(() => !!document.querySelector('.side__nav') && document.querySelector('#app').children.length > 0),
      null);

    /* Все разделы меню открываются и что-то рисуют. */
    const routes = await page.evaluate(() => (window.NAV || []).flatMap(s => s.items.map(i => i.route)));
    const broken = [];
    for (const r of routes){
      await page.evaluate(hash => { location.hash = '#/' + hash; }, r);
      await page.waitForTimeout(320);
      const nodes = await page.evaluate(() => document.querySelector('#app')?.querySelectorAll('*').length || 0);
      if (nodes < 40) broken.push({ route: r, nodes });
    }
    check('все разделы меню отрисованы', broken.length === 0, { routes: routes.length, broken });

    /* Демо-аудио не должно грузиться до входа в раздел ИИ. */
    const audioBefore = await page.evaluate(() => performance.getEntriesByType('resource').some(e => e.name.includes('demo-podcast.wav')));
    check('аудио ИИ не грузится на старте', !audioBefore, null);

    await page.evaluate(() => { location.hash = '#/ai-transcribe'; });
    await page.waitForTimeout(1600);
    const audio = await page.evaluate(() => {
      const a = document.querySelector('audio');
      return a ? { src: a.getAttribute('src'), duration: a.duration || 0 } : null;
    });
    check('раздел ИИ подключает демо-аудио', !!audio && /demo-podcast\.wav/.test(audio.src || ''), audio);

    /* Окна детализаций дашборда: одинаковые размеры и содержимое. */
    await page.evaluate(() => { location.hash = '#/dash'; });
    await page.waitForTimeout(700);
    const sizes = {};
    for (const [name, sel] of [['rev', '[data-rev-detail]'], ['active', '[data-active-detail]'], ['reg', '[data-reg-detail]']]){
      const has = await page.evaluate(s => !!document.querySelector(s), sel);
      if (!has){ sizes[name] = null; continue; }
      await page.evaluate(s => document.querySelector(s).click(), sel);
      await page.waitForTimeout(700);
      sizes[name] = await page.evaluate(() => {
        const w = [...document.querySelectorAll('.aw-win')].pop();
        return w ? Math.round(w.getBoundingClientRect().height) : null;
      });
      await page.evaluate(() => window.Windows && Windows.closeAll());
      await page.waitForTimeout(350);
    }
    const same = sizes.rev && sizes.rev === sizes.active && sizes.rev === sizes.reg;
    check('окна детализаций одной высоты', same, sizes);

    check('нет ошибок в консоли и на странице', errors.length === 0, errors.slice(0, 5));
  } catch (e) {
    check('набор выполнен без исключения', false, String(e && e.message || e));
  } finally {
    await browser.close();
  }

  const failed = results.filter(r => !r.ok);
  console.log(JSON.stringify({ base: BASE, build, ok: failed.length === 0, failed: failed.length, results }, null, 1));
  process.exit(failed.length ? 1 : 0);
})();
