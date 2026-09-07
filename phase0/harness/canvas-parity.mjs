// CANVAS PARITY (Phase 2 milestone 1, 2026-09-07): the canvas board's
// native buffer draws what the DOM board draws, tile pixel for tile pixel.
//
// Both boards paint the same 16×16 tiles (the atlas PNG and tiles.css's
// data URIs are one repack), so on the same position — the same deal, the
// same plies, the same quakes — every square's 16×16 should agree: floor
// variant and shade, wall case, hole and ruin cases, doorways, props,
// doors and their doubles, cracks masked to the wall, decor, debris, the
// gods' residue frames, and the pieces at the same lift and shift with
// their one-pixel shadow. This drives play/index.html twice in headless
// Chromium at dpr 1 — once per renderer — with the DOM board forced to an
// exact integer cell (k device pixels per tile pixel, so a screenshot
// sampled at the block centres IS the DOM's tile pixels) and reads the
// canvas board's buffer straight off __DCK.renderer.buffer(). Compared
// on the start position and again after a run of seeded random plies with
// the gods hot; the edge coordinates are masked (a font on one, a pixel
// font on the other), the arrows are left out on both (the DOM's SVG
// hidden, the canvas's pixel arrows cleared) and a per-channel tolerance
// of 2 absorbs alpha rounding.
//
// Usage (from phase0/): node harness/canvas-parity.mjs [--stage s59-hall-corner]
//   [--seed 3] [--plies 14] [--k 3] [--theme hall|castle|crypt] [--shots]
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { decodePng, encodePng, blank } from '../lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'phase0/results/canvas-parity');
const PORT = 8933;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.ini': 'text/plain' };
const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt; };
const STAGE = arg('stage', 's59-hall-corner');
const SEED = arg('seed', '3');
const PLIES = parseInt(arg('plies', '14'), 10);
const K = parseInt(arg('k', '3'), 10);
const THEME = arg('theme', null);
const SHOTS = argv.includes('--shots');
const TOL = 2;

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] ?? 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const failures = [], notes = [];
const expect = (ok, what) => (ok ? notes.push(`ok  ${what}`) : failures.push(what));
if (SHOTS) { fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true }); }

const executablePath = process.env.CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });

// A seeded move list so both pages play the SAME game (the engine replies
// at a fixed depth with no movetime, so its answers repeat).
const prng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

async function openPage(renderer) {
  const page = await browser.newPage({ viewport: { width: 640, height: 1100 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  const q = new URLSearchParams({ stage: STAGE, autobegin: '1', fx: '0', seed: SEED, go: 'depth 5', probe: 'depth 4', renderer, onset: '1', mramp: '2', debt: '2', ...(THEME ? { theme: THEME } : {}) });
  await page.goto(`http://127.0.0.1:${PORT}/play/index.html?${q}`);
  await page.waitForFunction(() => window.__DCK?.app?.duel?.state === 'playing', null, { timeout: 120000 });
  await page.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
  const files = await page.evaluate(() => window.__DCK.app.boardUI.files);
  if (renderer === 'dom') {
    // An exact integer cell: the board K device px per tile pixel, the coordinates hidden.
    await page.addStyleTag({ content: `#board.board { width: ${files * 16 * K}px !important; min-width: 0 !important; box-sizing: content-box !important; } #board .coord { visibility: hidden !important; } #board .arrow-layer { visibility: hidden !important; }` });
  } else {
    await page.evaluate(() => window.__DCK.renderer.ready());
  }
  await page.waitForTimeout(150);
  return { page, errs, files };
}

/** The DOM board's tile pixels: a screenshot sampled at every cell's device-pixel block centres. */
async function domTiles(page) {
  const rects = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#board .cell[data-square]')].map((c) => { const r = c.getBoundingClientRect(); return [c.dataset.square, { x: r.left, y: r.top, w: r.width, h: r.height }]; })));
  const png = decodePng(await page.screenshot({ type: 'png' }));
  const tiles = {};
  for (const [sq, r] of Object.entries(rects)) {
    const k = r.w / 16;
    const buf = new Uint8ClampedArray(16 * 16 * 4);
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
      const x = Math.round(r.x + i * k + k / 2), y = Math.round(r.y + j * k + k / 2);
      const o = (y * png.width + x) * 4, d = (j * 16 + i) * 4;
      buf[d] = png.data[o]; buf[d + 1] = png.data[o + 1]; buf[d + 2] = png.data[o + 2]; buf[d + 3] = png.data[o + 3];
    }
    tiles[sq] = { buf, cell: `${r.w.toFixed(2)}` };
  }
  return { tiles, png };
}

/** The canvas board's tile pixels: its buffer, per square. */
async function canvasTiles(page) {
  const { squares, info } = await page.evaluate(() => {
    const K = window.__DCK;
    K.app.boardUI.setArrows([]); // the arrows are pixels in this buffer; the DOM's SVG is hidden — compare the tiles alone
    K.renderer.paintNow();
    const ui = K.app.boardUI;
    const out = {};
    for (const sq of ui.cells.keys()) out[sq] = Array.from(K.renderer.square(sq));
    return { squares: out, info: K.renderer.info };
  });
  const tiles = {};
  for (const [sq, arr] of Object.entries(squares)) tiles[sq] = { buf: Uint8ClampedArray.from(arr) };
  return { tiles, info };
}

/** Compare two boards' tiles; the coordinate corners are masked. */
function compare(dom, cvs, classes, files, ranks) {
  const per = [];
  let total = 0, same = 0;
  for (const sq of Object.keys(dom)) {
    const a = dom[sq].buf, b = cvs[sq]?.buf;
    if (!b) { per.push({ sq, bad: 256, of: 256, note: 'missing on canvas' }); continue; }
    const f = sq.charCodeAt(0) - 97, rank = parseInt(sq.slice(1), 10);
    let bad = 0, of = 0;
    const worst = [];
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
      if (rank === 1 && i >= 8 && j >= 9) continue; // the file letter's corner
      if (f === 0 && i <= 8 && j <= 7) continue; // the rank number's corner
      const o = (j * 16 + i) * 4;
      of++;
      const d = Math.max(Math.abs(a[o] - b[o]), Math.abs(a[o + 1] - b[o + 1]), Math.abs(a[o + 2] - b[o + 2]));
      if (d > TOL) { bad++; if (worst.length < 2) worst.push(`(${i},${j}) dom ${a[o]},${a[o + 1]},${a[o + 2]} cvs ${b[o]},${b[o + 1]},${b[o + 2]}`); }
    }
    total += of;
    same += of - bad;
    if (bad) per.push({ sq, bad, of, cls: classes[sq]?.filter((c) => !/^(cell|light|dark|f\d|ck\d|sv\d+)$/.test(c)).join(' ') ?? '', worst });
  }
  per.sort((x, y) => y.bad - x.bad);
  return { total, same, per };
}

async function snapshot(name, A, B) {
  const [d, c] = await Promise.all([domTiles(A.page), canvasTiles(B.page)]);
  const classes = await A.page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#board .cell[data-square]')].map((el) => [el.dataset.square, [...el.classList]])));
  const fens = await Promise.all([A.page, B.page].map((p) => p.evaluate(() => ({ fen: window.__DCK.app.duel.fen(), holes: [...window.__DCK.app.duel.director.holes].sort().join(','), crates: [...window.__DCK.app.duel.director.godCrates].sort().join(','), plies: window.__DCK.app.duel.ply, debris: window.__DCK.debris.stats().events }))));
  const sameGame = fens[0].fen === fens[1].fen && fens[0].holes === fens[1].holes && fens[0].crates === fens[1].crates;
  expect(sameGame, `${name}: both pages hold the same position (ply ${fens[0].plies} / ${fens[1].plies}; ${fens[0].debris} / ${fens[1].debris} debris events)`);
  const cellOk = Object.values(d.tiles).every((t) => Math.abs(parseFloat(t.cell) - 16 * K) < 1e-6);
  expect(cellOk, `${name}: the DOM board's cells are exactly ${16 * K} px (k ${K})`);
  expect(c.info.k === K && c.info.integer, `${name}: the canvas board is at k ${c.info.k} (${c.info.integer ? 'integer' : 'fill'}), ${c.info.devW}×${c.info.devH} device px`);
  if (SHOTS) {
    fs.writeFileSync(path.join(OUT, `${name}-dom.png`), await A.page.locator('#board').screenshot({ type: 'png' }));
    fs.writeFileSync(path.join(OUT, `${name}-canvas.png`), await B.page.locator('#board').screenshot({ type: 'png' }));
    // The sampled tiles of both, side by side at ×4, for the eye.
    const ranks = await A.page.evaluate(() => window.__DCK.app.boardUI.ranks);
    const S = 4, W = A.files * 16 * S, H = ranks * 16 * S;
    const img = blank(W * 2 + 8, H);
    const put = (tiles, ox) => {
      for (const [sq, t] of Object.entries(tiles)) {
        const f = sq.charCodeAt(0) - 97, rank = parseInt(sq.slice(1), 10);
        const x0 = ox + f * 16 * S, y0 = (ranks - rank) * 16 * S;
        for (let j = 0; j < 16 * S; j++) for (let i = 0; i < 16 * S; i++) {
          const src = ((Math.floor(j / S) * 16 + Math.floor(i / S)) * 4), dst = ((y0 + j) * img.width + x0 + i) * 4;
          img.data[dst] = t.buf[src]; img.data[dst + 1] = t.buf[src + 1]; img.data[dst + 2] = t.buf[src + 2]; img.data[dst + 3] = 255;
        }
      }
    };
    put(d.tiles, 0);
    put(c.tiles, W + 8);
    fs.writeFileSync(path.join(OUT, `${name}-tiles.png`), encodePng(img));
  }
  if (!sameGame) return null;
  const r = compare(d.tiles, c.tiles, classes, A.files);
  const pct = ((100 * r.same) / r.total).toFixed(3);
  const worst = r.per.slice(0, 8).map((p) => `${p.sq}[${p.cls}] ${p.bad}/${p.of}${p.note ? ` ${p.note}` : ''} ${p.worst?.join(' | ') ?? ''}`);
  expect(r.per.length === 0, `${name}: ${pct}% of ${r.total} tile pixels agree (tolerance ${TOL}/channel); ${r.per.length} square(s) differ${worst.length ? ` — ${worst.join(' ;; ')}` : ''}`);
  return r;
}

const A = await openPage('dom');
const B = await openPage('canvas');
await snapshot('start', A, B);
// The same seeded random plies on both pages, the gods hot.
const rnd = prng(parseInt(SEED, 10) * 7919 + 17);
let played = 0;
for (let i = 0; i < PLIES; i++) {
  const legalA = await A.page.evaluate(() => window.__DCK.app.duel.state === 'playing' ? window.__DCK.legalMoves() : null);
  const legalB = await B.page.evaluate(() => window.__DCK.app.duel.state === 'playing' ? window.__DCK.legalMoves() : null);
  if (!legalA || !legalB) break;
  if (legalA.join() !== legalB.join()) { failures.push(`the games diverged before ply ${i + 1} (legal moves differ)`); break; }
  const mv = legalA[Math.floor(rnd() * legalA.length)];
  const [sa, sb] = await Promise.all([A.page, B.page].map((p) => p.evaluate(async (m) => { const s = await window.__DCK.playerMove(m); await window.__DCK.waitIdle(); return s; }, mv)));
  played++;
  if (sa !== 'playing' || sb !== 'playing') break;
}
notes.push(`--  ${played} player plies played on both pages`);
await snapshot('played', A, B);
// The pieces at another placement and the other themes, on the start position of a fresh deal.
for (const t of THEME ? [] : ['castle', 'crypt']) {
  await Promise.all([A.page, B.page].map((p) => p.evaluate((th) => { window.__DCK.options.theme = th; window.__DCK.applyOptions(); }, t)));
  await A.page.waitForTimeout(400);
  await B.page.evaluate(() => window.__DCK.renderer.ready());
  await B.page.waitForTimeout(100);
  await snapshot(`theme-${t}`, A, B);
}
expect(A.errs.length === 0 && B.errs.length === 0, `no page errors (dom ${A.errs.length}, canvas ${B.errs.length})${[...A.errs, ...B.errs].slice(0, 3).map((e) => ` — ${e}`).join('')}`);
await browser.close();
server.close();
for (const n of notes) console.log(n);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`SUMMARY: ${notes.length} ok, ${failures.length} failed${SHOTS ? ` — screenshots in ${OUT}` : ''}`);
process.exit(failures.length ? 1 : 0);
