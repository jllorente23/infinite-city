// Headless screenshotter. Renders the game with SwiftShader so the look of a
// change can be checked without a desktop browser.
//   node scripts/shot.mjs out.png [seconds] [keys]
// `keys` is a comma list like "w:3,a:1" meaning hold W for 3s, then A for 1s.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const BIN = 'chrome-headless-shell/linux-152.0.7977.82/chrome-headless-shell-linux64/chrome-headless-shell';
const URL_BASE = process.env.GAME_URL ?? 'http://localhost:3001/';

const out = resolve(process.argv[2] ?? 'shots/shot.png');
const settle = Number(process.argv[3] ?? 8);
const script = (process.argv[4] ?? '').split(',').filter(Boolean);

mkdirSync(dirname(out), { recursive: true });

const chrome = spawn(resolve(BIN), [
  '--remote-debugging-port=0',
  '--hide-scrollbars',
  '--no-sandbox',
  '--enable-unsafe-swiftshader',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--window-size=1280,720',
  'about:blank',
], {
  stdio: ['ignore', 'ignore', 'pipe'],
  // Chrome's runtime deps are unpacked under /tmp rather than installed system wide.
  env: { ...process.env, LD_LIBRARY_PATH: '/tmp/chlibs/root/usr/lib/x86_64-linux-gnu' },
});

let wsUrl = '';
await new Promise((ok, fail) => {
  const t = setTimeout(() => fail(new Error('chrome did not report a debug port')), 20000);
  chrome.stderr.on('data', (d) => {
    const m = /ws:\/\/\S+/.exec(String(d));
    if (m) { wsUrl = m[0]; clearTimeout(t); ok(); }
  });
});

const browser = await puppeteer.connect({ browserWSEndpoint: wsUrl, defaultViewport: { width: 1280, height: 720 } });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[page error]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });

await page.goto(URL_BASE + (process.env.GAME_QS ?? ''), { waitUntil: 'networkidle2', timeout: 90000 });
// The title screen swallows the first click; the canvas needs it to take keys.
await page.mouse.click(640, 360).catch(() => {});
await new Promise((r) => setTimeout(r, settle * 1000));

for (const step of script) {
  const [key, secs] = step.split(':');
  await page.keyboard.down(key);
  await new Promise((r) => setTimeout(r, Number(secs) * 1000));
  await page.keyboard.up(key);
}
await new Promise((r) => setTimeout(r, 1200));

// GAME_CAM is a snippet returning { p: [x,y,z], t: [x,y,z] }. It renders one
// frame from that viewpoint straight to a file, so the chase camera can be
// stepped around without touching the game loop.
if (process.env.GAME_CAM) {
  const data = await page.evaluate(`(() => {
    const { scene, camera, gl } = window.three;
    const spot = (() => { ${process.env.GAME_CAM} })();
    camera.position.set(...spot.p);
    camera.lookAt(...spot.t);
    camera.updateMatrixWorld();
    gl.render(scene, camera);
    return gl.domElement.toDataURL('image/png');
  })()`);
  writeFileSync(out.replace(/\.png$/, '-cam.png'), Buffer.from(data.split(',')[1], 'base64'));
  console.log('wrote', out.replace(/\.png$/, '-cam.png'));
}

if (process.env.GAME_EVAL) {
  const r = await page.evaluate(`(() => {
    const { scene, camera } = window.three;
    ${process.env.GAME_EVAL}
  })()`);
  console.log(JSON.stringify(r, null, 1));
}

await page.screenshot({ path: out });
console.log('wrote', out);
await browser.disconnect();
chrome.kill();
