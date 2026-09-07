// THE PIECE GRID gate (2026-09-07): a tile-grid piece's pixels land on the
// floor tile's device-pixel grid — the same size AND the same alignment —
// in a real browser, on the SHIPPED CSS (play/style.css + play/tiles.css),
// at fractional cell sizes and device pixel ratios, in Chromium and (when
// installed — `npx playwright install firefox`) Firefox.
//
// How: a 2×4 board wearing the real rules, its floor and its king REPLACED
// by coordinate-encoded images (every pixel's red = its column, green = its
// row), screenshot with the king hidden and shown, and every device pixel
// the king covers must show the floor pixel under it at the same (column,
// row) — over the king's own square (--piece-lo), the square above
// (--piece-mid, the ::before) and the one above that (--piece-hi, the
// ::after) — both at lift 0 (tiles.css's own tiers) and LIFTED + SHIFTED,
// the tiers cut by play/js/piecetiers.mjs exactly as the board bakes them
// at runtime. The control is the same king in the 'free' mode (the fitted
// box at the dials): it drifts by a device pixel on some rows in most
// layouts, which is the whole point.
//
// Why this exact construction (cell-sized boxes, `center / 100% 100%`, one
// 16×16 image each, the position in the image): it is the ONLY one that
// measured exact in BOTH browsers — see the header of style.css's
// tile-grid block and lib/piecehalves.mjs. Keep this gate green when
// touching the piece rules, the floor rules, the tier cut or the atlas.
//
// Usage (from phase0/): node harness/piece-grid.mjs [--browser chromium|firefox|all]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium, firefox } from 'playwright';
import { encodePng, decodePng } from '../lib/png.mjs';
import { pieceTiers, CANVAS_ROWS } from '../../play/js/piecetiers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const which = argv[argv.indexOf('--browser') + 1] && argv.includes('--browser') ? argv[argv.indexOf('--browser') + 1] : 'all';
const NOFILTER = argv.includes('--nofilter'); // diagnosis: measure with the pieces' CSS filter off

const STYLE = fs.readFileSync(path.join(ROOT, 'play/style.css'), 'utf8');
const TILES = fs.readFileSync(path.join(ROOT, 'play/tiles.css'), 'utf8');
// The game's tier module, injected into the page: the tier boxes come from
// the MEASURED rows through the same function board-ui layoutPieceRows uses.
const TIERS_SRC = fs.readFileSync(path.join(ROOT, 'play/js/piecetiers.mjs'), 'utf8').replace(/^export /gm, '') + '\nwindow.__tiers = { tierRowVars };';

// Coordinate-encoded images: pixel (x, y) → (x·8, y·8, blue), opaque.
const rgba = (w, h, fill) => {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = fill(x, y); if (!v) continue; const o = (y * w + x) * 4; data[o] = v[0]; data[o + 1] = v[1]; data[o + 2] = v[2]; data[o + 3] = 255; }
  return `url('data:image/png;base64,${encodePng({ width: w, height: h, data }).toString('base64')}')`; // single quotes: these land inside a style="…" attribute
};
const SPRITE_H = 23; // a nulltale-sized king, its foot on the fitted tile's bottom row
const FLOOR = rgba(16, 16, (x, y) => [x * 8, y * 8, 0]);
const FULL = rgba(16, SPRITE_H, (x, y) => [x * 8, y * 8, 255]); // the fitted tile (the free mode's --piece-img)
// The king's tiers at a placement, cut exactly as the board does (the
// same function), as inline declarations on the board.
const tiersAt = (lift, shift) => {
  const data = Buffer.alloc(16 * SPRITE_H * 4);
  for (let y = 0; y < SPRITE_H; y++) for (let x = 0; x < 16; x++) { const o = (y * 16 + x) * 4; data[o] = x * 8; data[o + 1] = y * 8; data[o + 2] = 255; data[o + 3] = 255; }
  const t = pieceTiers({ width: 16, height: SPRITE_H, data }, { lift, shift });
  return ['lo', 'mid', 'hi'].map((k) => `--piece-K-${k}:${t[k] ? `url('data:image/png;base64,${encodePng({ width: 16, height: 16, data: Buffer.from(t[k].data) }).toString('base64')}')` : 'none'}`).join(';');
};

function html({ width, offx, offy, mode, show, lift = 0, shift = 0 }) {
  const attrs = mode === 'tile' ? 'data-piece-pixels="tile"' : '';
  const place = mode === 'tile' ? `${tiersAt(lift, shift)};--piece-tile-lift:${lift}` : '';
  return `<!doctype html><style>${STYLE}\n${TILES}\nbody{margin:0;background:#888}${NOFILTER ? '\n.piece[data-piece]{filter:none !important}' : ''}</style>
<div style="position:absolute;left:${offx}px;top:${offy}px;width:${width}px">
<div id="board" class="board" data-pieces="nulltale" ${attrs} style="--files:2;--ranks:4;width:${width}px;--tile-floor-1:${FLOOR};--piece-K:${FULL};${place}">
<div class="cell light f1" data-square="a4"></div><div class="cell light f1" data-square="b4"></div>
<div class="cell light f1" data-square="a3"></div><div class="cell light f1" data-square="b3"></div>
<div class="cell light f1" data-square="a2"><span class="piece white" data-piece="K" style="${show ? '' : 'visibility:hidden'}"></span></div><div class="cell light f1" data-square="b2"></div>
<div class="cell light f1" data-square="a1"></div><div class="cell light f1" data-square="b1"></div>
</div></div>`;
}

const LAYOUTS = [[75, 0.3, 0.7], [73.4, 0, 0], [80, 0, 0], [82.6, 10.55, 20.2], [66.66, 5.1, 2.9], [78.1, 0, 0]];
const DPRS = [1, 2, 3];
const PLACEMENTS = [[0, 0], [6, 0], [13, 2], [20, -3]]; // [lift, shift]: the tiles.css tiers, the default, a hi-tier reach, the clamps' edge

async function measure(page, cfg) {
  const shots = [];
  let rect = null;
  for (const show of [false, true]) {
    await page.setContent(html({ ...cfg, show }));
    await page.addScriptTag({ content: TIERS_SRC });
    await page.evaluate(() => {
      // board-ui layoutPieceRows, on this static board: two files, rows top to bottom.
      const cells = [...document.querySelectorAll('.cell')];
      const rows = [];
      for (let i = 0; i < cells.length; i += 2) rows.push(cells.slice(i, i + 2));
      const rects = rows.map((row) => row.map((c) => c.getBoundingClientRect()));
      rows.forEach((row, r) => row.forEach((cell, c) => { for (const [k, v] of Object.entries(window.__tiers.tierRowVars(rects[r][c], rects[r - 1]?.[c] ?? null, rects[r - 2]?.[c] ?? null))) cell.style.setProperty(k, v); }));
    });
    await page.waitForTimeout(120);
    rect ??= await page.evaluate(() => { const r = document.querySelector('[data-square="a2"]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    shots.push(decodePng(await page.screenshot({ type: 'png' })));
  }
  const [floor, piece] = shots;
  const dpr = cfg.dpr, lift = cfg.lift ?? 0, shift = cfg.shift ?? 0;
  const x0 = rect.x * dpr, y0 = rect.y * dpr, s = rect.w * dpr, sh = rect.h * dpr;
  let covered = 0, head = 0, bad = 0;
  const samples = [];
  // The king's pixel (pi, pj) sits on canvas row pj + (48 − 23 − lift) and column pi + shift; the floor under it shows that row mod 16.
  for (let y = Math.ceil(y0 - 2 * sh - 1); y < Math.floor(y0 + sh + 1); y++) for (let x = Math.ceil(x0 - 1); x < Math.floor(x0 + s + 1); x++) {
    const o = (y * floor.width + x) * 4;
    if (floor.data[o + 2] !== 0 || piece.data[o + 2] !== 255) continue; // a floor pixel in shot 1, a king pixel in shot 2
    covered++;
    if (y < y0) head++;
    const fi = floor.data[o] / 8, fj = floor.data[o + 1] / 8, pi = piece.data[o] / 8, pj = piece.data[o + 1] / 8;
    if (fi !== pi + shift || fj !== (pj + (CANVAS_ROWS - SPRITE_H - lift)) % 16) { bad++; if (samples.length < 2) samples.push(`(${x},${y}) floor ${fi},${fj} king ${pi},${pj}`); }
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
    const ctx = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width: 240, height: 300 } });
    const page = await ctx.newPage();
    for (const [width, offx, offy] of LAYOUTS) {
      for (const [lift, shift] of PLACEMENTS) {
        const tile = await measure(page, { width, offx, offy, dpr, mode: 'tile', lift, shift });
        layouts++;
        headPx += tile.head;
        if (tile.bad === 0 && tile.covered > 0 && tile.head > 0) exact++;
        else fails.push(`dpr${dpr} width ${width} cell ${tile.cell} lift ${lift} shift ${shift}: covered ${tile.covered} (head ${tile.head}) bad ${tile.bad} ${tile.samples.join(' ')}`);
      }
      const free = await measure(page, { width, offx, offy, dpr, mode: 'free' });
      controlBad += free.bad;
    }
    await ctx.close();
  }
  await browser.close();
  expect(exact === layouts, `${name}: tile-grid king exact on the floor's grid in ${exact}/${layouts} layouts (${DPRS.length} dprs × ${LAYOUTS.length} fractional cells × ${PLACEMENTS.length} placements incl. lifted + shifted), pixels above its square ${headPx}${fails.length ? ` — ${fails.slice(0, 3).join(' | ')}` : ''}`);
  expect(controlBad > 0, `${name}: the control (free mode, the fitted box) is off the grid — ${controlBad} misaligned device pixels over the same layouts`);
}

for (const name of which === 'all' ? ['chromium', 'firefox'] : [which]) await runBrowser(name);
for (const n of notes) console.log(n);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`SUMMARY: ${notes.length} ok, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
