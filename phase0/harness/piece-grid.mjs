// THE PIECE GRID gate (2026-09-07): a tile-grid piece's pixels land on the
// floor tile's device-pixel grid — the same size AND the same alignment —
// in a real browser, on the SHIPPED CSS (play/style.css + play/tiles.css),
// at fractional cell sizes and device pixel ratios, in Chromium and (when
// installed — `npx playwright install firefox`) Firefox.
//
// How: a 2×3 board wearing the real rules, its floor and its king REPLACED
// by coordinate-encoded images (every pixel's red = its column, green = its
// row), screenshot with the king hidden and shown, and every device pixel
// the king covers must show the floor pixel under it at the same (column,
// row) — over the king's own square (the body, --piece-lo) and the square
// above it (the head, the ::before painting --piece-hi). The control is the
// same king in the 'free' mode (the fitted box at the dials): it drifts by
// a device pixel on some rows in most layouts, which is the whole point.
//
// Why this exact construction (two cell-sized boxes, `center / 100% 100%`,
// one 16×16 image each): it is the ONLY one that measured exact in BOTH
// browsers — see the header of style.css's tile-grid block and
// lib/piecehalves.mjs. Keep this gate green when touching the piece rules,
// the floor rules or the atlas.
//
// Usage (from phase0/): node harness/piece-grid.mjs [--browser chromium|firefox|all]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium, firefox } from 'playwright';
import { encodePng, decodePng } from '../lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const which = argv[argv.indexOf('--browser') + 1] && argv.includes('--browser') ? argv[argv.indexOf('--browser') + 1] : 'all';

const STYLE = fs.readFileSync(path.join(ROOT, 'play/style.css'), 'utf8');
const TILES = fs.readFileSync(path.join(ROOT, 'play/tiles.css'), 'utf8');

// Coordinate-encoded images: pixel (x, y) → (x·8, y·8, blue), opaque.
const rgba = (w, h, fill) => {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = fill(x, y); if (!v) continue; const o = (y * w + x) * 4; data[o] = v[0]; data[o + 1] = v[1]; data[o + 2] = v[2]; data[o + 3] = 255; }
  return `url('data:image/png;base64,${encodePng({ width: w, height: h, data }).toString('base64')}')`; // single quotes: these land inside a style="…" attribute
};
const SPRITE_H = 23, CANVAS_H = 32; // a nulltale-sized king: rows 9..31 of its 32-row atlas cell
const FLOOR = rgba(16, 16, (x, y) => [x * 8, y * 8, 0]);
const spritePx = (x, c) => (c >= CANVAS_H - SPRITE_H ? [x * 8, (c - (CANVAS_H - SPRITE_H)) * 8, 255] : null);
const LO = rgba(16, 16, (x, y) => spritePx(x, y + 16)); // the body: canvas rows 16..31
const HI = rgba(16, 16, (x, y) => spritePx(x, y)); // the head: canvas rows 0..15
const FULL = rgba(16, SPRITE_H, (x, y) => [x * 8, y * 8, 255]); // the fitted box image (the free mode's --piece-img)

function html({ width, offx, offy, mode, show }) {
  const attrs = mode === 'tile' ? 'data-piece-pixels="tile"' : '';
  return `<!doctype html><style>${STYLE}\n${TILES}\nbody{margin:0;background:#888}</style>
<div style="position:absolute;left:${offx}px;top:${offy}px;width:${width}px">
<div id="board" class="board" data-pieces="nulltale" ${attrs} style="--files:2;--ranks:3;width:${width}px;--tile-floor-1:${FLOOR};--piece-K-lo:${LO};--piece-K-hi:${HI};--piece-K:${FULL}">
<div class="cell light f1" data-square="a3"></div><div class="cell light f1" data-square="b3"></div>
<div class="cell light f1" data-square="a2"><span class="piece white" data-piece="K" style="${show ? '' : 'visibility:hidden'}"></span></div><div class="cell light f1" data-square="b2"></div>
<div class="cell light f1" data-square="a1"></div><div class="cell light f1" data-square="b1"></div>
</div></div>`;
}

const LAYOUTS = [[75, 0.3, 0.7], [73.4, 0, 0], [80, 0, 0], [82.6, 10.55, 20.2], [66.66, 5.1, 2.9], [78.1, 0, 0]];
const DPRS = [1, 2, 3];

async function measure(page, cfg) {
  const shots = [];
  let rect = null;
  for (const show of [false, true]) {
    await page.setContent(html({ ...cfg, show }));
    await page.waitForTimeout(120);
    rect ??= await page.evaluate(() => { const r = document.querySelector('[data-square="a2"]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    shots.push(decodePng(await page.screenshot({ type: 'png' })));
  }
  const [floor, piece] = shots;
  const dpr = cfg.dpr;
  const x0 = rect.x * dpr, y0 = rect.y * dpr, s = rect.w * dpr, sh = rect.h * dpr;
  let covered = 0, head = 0, bad = 0;
  const samples = [];
  for (let y = Math.ceil(y0 - sh - 1); y < Math.floor(y0 + sh + 1); y++) for (let x = Math.ceil(x0 - 1); x < Math.floor(x0 + s + 1); x++) {
    const o = (y * floor.width + x) * 4;
    if (floor.data[o + 2] !== 0 || piece.data[o + 2] !== 255) continue; // a floor pixel in shot 1, a king pixel in shot 2
    covered++;
    if (y < y0) head++;
    const fi = floor.data[o] / 8, fj = floor.data[o + 1] / 8, pi = piece.data[o] / 8, pj = piece.data[o + 1] / 8;
    if (fi !== pi || fj !== (pj + (CANVAS_H - SPRITE_H)) % 16) { bad++; if (samples.length < 2) samples.push(`(${x},${y}) floor ${fi},${fj} king ${pi},${pj}`); }
  }
  return { covered, head, bad, samples, cell: `${rect.w.toFixed(2)}×${rect.h.toFixed(2)}` };
}

const failures = [], notes = [];
const expect = (ok, what) => (ok ? notes.push(`ok  ${what}`) : failures.push(what));

async function runBrowser(name) {
  let browser;
  if (name === 'chromium') {
    const executablePath = process.env.CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
    browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  } else {
    if (!fs.existsSync(firefox.executablePath())) { notes.push(`--  firefox not installed (npx playwright install firefox) — skipped`); return; }
    browser = await firefox.launch();
  }
  let layouts = 0, exact = 0, controlBad = 0, headPx = 0;
  const fails = [];
  for (const dpr of DPRS) {
    const ctx = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width: 240, height: 240 } });
    const page = await ctx.newPage();
    for (const [width, offx, offy] of LAYOUTS) {
      const tile = await measure(page, { width, offx, offy, dpr, mode: 'tile' });
      layouts++;
      headPx += tile.head;
      if (tile.bad === 0 && tile.covered > 0 && tile.head > 0) exact++;
      else fails.push(`dpr${dpr} width ${width} cell ${tile.cell}: covered ${tile.covered} (head ${tile.head}) bad ${tile.bad} ${tile.samples.join(' ')}`);
      const free = await measure(page, { width, offx, offy, dpr, mode: 'free' });
      controlBad += free.bad;
    }
    await ctx.close();
  }
  await browser.close();
  expect(exact === layouts, `${name}: tile-grid king exact on the floor's grid in ${exact}/${layouts} layouts (${DPRS.length} dprs × ${LAYOUTS.length} fractional cells), head pixels ${headPx}${fails.length ? ` — ${fails.slice(0, 3).join(' | ')}` : ''}`);
  expect(controlBad > 0, `${name}: the control (free mode, the fitted box) is off the grid — ${controlBad} misaligned device pixels over the same layouts`);
}

for (const name of which === 'all' ? ['chromium', 'firefox'] : [which]) await runBrowser(name);
for (const n of notes) console.log(n);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`SUMMARY: ${notes.length} ok, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
