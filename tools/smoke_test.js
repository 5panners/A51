// Smoke test for the sim: serves sim/, loads it in headless Chromium, fires the AR-15 on foot,
// boards the Little Bird, starts the engine, lifts off, flies forward, and saves screenshots to smoke-out/.
//
//   npm i -D playwright && npx playwright install chromium   (once)
//   node tools/smoke_test.js                      # loads three.js from the CDN
//   node tools/smoke_test.js --three path/to/three   # offline: a local copy of the three@0.170.0 package
//
// Exits non-zero if the page throws, the model never loads, or the helicopter fails to fly.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const root = path.join(__dirname, '..', 'sim');
const ti = process.argv.indexOf('--three'), threeDir = ti > 0 ? path.resolve(process.argv[ti + 1]) : null;
const out = path.join(__dirname, '..', 'smoke-out'); fs.mkdirSync(out, { recursive: true });
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.txt': 'text/plain', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  let file = threeDir && url.startsWith('/three/') ? path.join(threeDir, url.slice(7)) : path.join(root, url);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    if (threeDir && url === '/index.html') data = Buffer.from(String(data)
      .replace('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js', '/three/build/three.module.js')
      .replace('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/', '/three/examples/jsm/'));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(data);
  });
}).listen(0);

(async () => {
  const port = server.address().port, errors = [];
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://localhost:${port}/index.html`);
    await page.waitForFunction(() => window.littlebird && window.littlebird.heli, null, { timeout: 120000 });
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(out, '0-pad.png') });
    // on foot: fire one round, then walk up to the helicopter and get in
    await page.evaluate(() => window.littlebird.fire());
    await page.waitForFunction(() => window.littlebird.RIFLE.mag < 30, null, { timeout: 10000 }).catch(() => {});
    const foot = await page.evaluate(() => {
      const L = window.littlebird, mag = L.RIFLE.mag;
      L.sol.pos.set(L.fm.position.x + 2.5, L.sol.pos.y, L.fm.position.z + 1); L.toggleBoard();
      return { mag, seated: L.sol.seated };
    });
    console.log('on foot', JSON.stringify(foot));
    await page.screenshot({ path: path.join(out, '0b-boarded.png') });
    const t = await page.evaluate(() => {
      const L = window.littlebird; L.fm.setEngine(true);
      L.step(5, { collective: 0, pitch: 0, roll: 0, yaw: 0 });     // spool up
      L.step(4, { collective: 1, pitch: 0, roll: 0, yaw: 0 });     // climb
      L.step(1.2, { collective: 0.3, pitch: 0.6, roll: 0, yaw: 0 }); // nose down
      L.step(5, { collective: 0.25, pitch: 0, roll: 0, yaw: 0 });  // cruise
      const m = L.fm.telemetry; return { agl: m.agl, kmh: m.kmh, crashed: m.crashed, rpm: m.rpm };
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, '1-cruise.png') });
    console.log('telemetry', JSON.stringify(t));
    const ok = !errors.length && foot.mag === 29 && foot.seated && !t.crashed && t.agl > 20 && t.kmh > 60 && t.rpm > 0.95;
    if (errors.length) console.error('page errors:\n' + errors.join('\n'));
    console.log(ok ? 'PASS' : 'FAIL', '- screenshots in smoke-out/');
    process.exitCode = ok ? 0 : 1;
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
