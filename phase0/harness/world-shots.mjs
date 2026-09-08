// WORLD SHOTS (Phase 2 milestone 4b, 2026-09-08): the walk-around fixtures
// for the designer's eye — every world in play/worlds painted whole by the
// canvas board on the bare lab page (the gallery the arena waves were
// approved from), plus the walk screen itself on a phone viewport and a
// desktop one, the army standing at the start. Not a gate.
//
// Usage (from phase0/): node harness/world-shots.mjs [--out dir] [--k 3]
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { encodePng } from '../lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 8939;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.ini': 'text/plain' };
const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt; };
const OUT = path.resolve(arg('out', path.join(ROOT, 'phase0/results/world-shots')));
const K = parseInt(arg('k', '3'), 10);
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
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'play/worlds/manifest.json'), 'utf8'));

// The whole world, painted north-up on the lab page: the army at its start.
const RENDER = `async (input) => {
  const { CanvasBoard, loadAtlas } = await import('/play/js/canvas-board.mjs');
  const { loadWorld } = await import('/play/js/world.mjs');
  const { makePattern, spawnArmy } = await import('/play/js/army.mjs');
  const atlas = await loadAtlas();
  const world = loadWorld(input.json);
  const at = world.start ?? { f: 1, r: 1, facing: 0 };
  spawnArmy(world, makePattern({ width: 3, royal: 'K', pieces: ['R', 'N'] }), { f: at.f, r: at.r }, at.facing ?? 0, 'w');
  const host = document.getElementById('host');
  host.style.width = (world.files * 16 * input.k) + 'px';
  host.style.height = (world.ranks * 16 * input.k + 24 * input.k) + 'px';
  const ui = new CanvasBoard(host, { world, crop: false, fit: 'window', viewport: 'screen', zoom: input.k, atlas, showCoords: false });
  await ui.ready;
  ui.setTheme(world.theme ?? null);
  ui.setPieces('nulltale');
  ui.dimOutside = false;
  ui.lookAt(Math.floor(world.files / 2), Math.floor(world.ranks / 2));
  ui.paintNow();
  const buf = ui.bufferPixels();
  const bytes = new Uint8Array(buf.data.buffer, buf.data.byteOffset, buf.data.length);
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  const out = { width: buf.width, height: buf.height, pixels: btoa(s), info: ui.renderInfo };
  ui.destroy();
  return out;
}`;

const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.goto(`http://127.0.0.1:${PORT}/phase0/harness/lab/board.html`);
for (const json of manifest.worlds) {
  const k = json.map[0].length > 70 ? 1 : K;
  const r = await page.evaluate(`(${RENDER})(${JSON.stringify({ json, k })})`);
  const file = path.join(OUT, `${json.id}.png`);
  fs.writeFileSync(file, encodePng({ width: r.width, height: r.height, data: Buffer.from(r.pixels, 'base64') }));
  console.log(`${json.id}: ${r.width}×${r.height} native px (${r.info.window.cols}×${r.info.window.rows} tiles) → ${path.relative(ROOT, file)}`);
}
await page.close();

// The walk screen: a phone and a desktop, the run just begun.
for (const [name, w, h] of [['phone', 390, 844], ['desktop', 1440, 900]]) {
  const p2 = await browser.newPage({ viewport: { width: w, height: h } });
  p2.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  await p2.goto(`http://127.0.0.1:${PORT}/play/index.html?world=${manifest.worlds[0].id}&fx=0`);
  await p2.waitForFunction(() => window.__DCK?.app?.phase === 'walk', null, { timeout: 60000 });
  await p2.evaluate(async () => { const K = window.__DCK; await K.renderer.ready(); K.renderer.paintNow(); await new Promise((r) => setTimeout(r, 300)); });
  const info = await p2.evaluate(() => window.__DCK.renderer.info);
  await p2.screenshot({ path: path.join(OUT, `walk-${name}.png`) });
  console.log(`walk-${name}: k ${info.k}, window ${info.window.cols}×${info.window.rows} tiles, ${info.devW}×${info.devH} device px`);
  await p2.close();
}
await browser.close();
server.close();
if (errs.length) console.log(`page errors: ${errs.join(' | ')}`);
console.log(`world-shots: ${manifest.worlds.length} worlds + the walk screen → ${OUT}`);
process.exit(errs.length ? 1 : 0);
