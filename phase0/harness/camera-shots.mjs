// CAMERA SHOTS (Phase 2, the camera PR — 2026-09-08): screenshots for the
// eye, not a gate — the wide layout on a desktop-sized viewport (the camera
// owns the screen, k height-bound, the panels in the column), the phone at
// each facing, and a zoomed crop of an edge-on door beside a leaf. The
// designer's verdict on the desktop look is the real gate.
//
// Usage (from phase0/): node harness/camera-shots.mjs [--out dir] [--stage s59-hall-corner]
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 8938;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.ini': 'text/plain' };
const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt; };
const OUT = path.resolve(arg('out', path.join(ROOT, 'phase0/results/camera-shots')));
const STAGE = arg('stage', 's59-hall-corner');
fs.mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] ?? 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const executablePath = process.env.CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });

async function open(viewport, extra = {}) {
  const page = await browser.newPage({ viewport });
  const q = new URLSearchParams({ stage: STAGE, autobegin: '1', fx: '0', seed: '3', go: 'depth 3', probe: 'depth 3', onset: '999', ...extra });
  await page.goto(`http://127.0.0.1:${PORT}/play/index.html?${q}`);
  await page.waitForFunction(() => window.__DCK?.app?.duel?.state === 'playing', null, { timeout: 120000 });
  await page.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
  await page.evaluate(() => window.__DCK.renderer.ready());
  await page.waitForTimeout(200);
  await page.evaluate(() => window.__DCK.renderer.paintNow());
  return page;
}

// The desktop: 1920×1080 and 1280×720, the wide layout.
for (const [w, h] of [[1920, 1080], [1280, 720]]) {
  const page = await open({ width: w, height: h });
  const info = await page.evaluate(() => window.__DCK.renderer.info);
  console.log(`${w}×${h}: k ${info.k}, fit ${info.fit}, canvas ${info.devW}×${info.devH}, board ${info.bufW * info.k}×${info.bufH * info.k} at (${info.x0}, ${info.y0})`);
  await page.screenshot({ path: path.join(OUT, `desktop-${w}x${h}.png`) });
  await page.close();
}
// The phone at each facing, and the door crop.
{
  const page = await open({ width: 390, height: 844 });
  for (const facing of [0, 1, 2, 3]) {
    await page.evaluate(async (f) => { window.__DCK.renderer.facing(f); await window.__DCK.renderer.ready(); window.__DCK.renderer.paintNow(); }, facing);
    await page.waitForTimeout(150);
    const info = await page.evaluate(() => window.__DCK.renderer.info);
    console.log(`phone facing ${facing} (${info.facingName} up): ${info.screenCols}×${info.screenRows} tiles at k ${info.k}`);
    await page.locator('#screen-duel').screenshot({ path: path.join(OUT, `phone-facing${facing}.png`) });
  }
  await page.evaluate(async () => { window.__DCK.renderer.facing(0); await window.__DCK.renderer.ready(); window.__DCK.renderer.paintNow(); });
  // A crop around d8 (the edge-on door) and g5+h5 (the double leaf), 8× the tile.
  const crop = await page.evaluate(() => {
    const K = window.__DCK;
    const r = document.querySelector('#board canvas').getBoundingClientRect();
    const a = K.renderer.pointOfSquare('d8'), b = K.renderer.pointOfSquare('h5');
    const t = K.renderer.info.tilePx / K.renderer.info.dpr;
    return { x: Math.min(a.x, b.x) - 2.5 * t, y: Math.min(a.y, b.y) - 1.5 * t, w: Math.abs(b.x - a.x) + 5 * t, h: Math.abs(b.y - a.y) + 3 * t, r: { x: r.left, y: r.top, w: r.width, h: r.height } };
  });
  await page.screenshot({ path: path.join(OUT, 'doors-d8-g5h5.png'), clip: { x: Math.max(0, crop.x), y: Math.max(0, crop.y), width: crop.w, height: crop.h } });
  await page.close();
}
await browser.close();
server.close();
console.log(`shots in ${OUT}`);
