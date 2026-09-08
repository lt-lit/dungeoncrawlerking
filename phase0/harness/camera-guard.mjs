// THE CAMERA GUARD (Phase 2, the camera PR — 2026-09-08): the renderer's
// paint, byte for byte, before and after a change to the board's geometry.
//
// The method is milestone 2's (the DOM board's retirement was gated the
// same way): drive a live duel on the game page, and at the start and on
// fourteen hot plies record every INPUT the board paints from — the FEN,
// the Director's ledgers, the residue, the skins, the theme / piece set /
// door set / placement / arrow style, every mark and arrow, every square's
// debris buffer — plus a hash of every square's pixels on the live board
// and on a MIRROR board mounted beside it with the 180° turn (`flipped`,
// which the camera generalises to `facing: 2`). `dump` writes that record;
// `compare` mounts detached boards on the CURRENT code from the recorded
// inputs alone (no engine, no dice — a renderer gate must not depend on a
// search being deterministic), hashes them the same way and diffs square
// by square: facing 0 against the live paint of record, facing 2 against
// the mirror. A square may differ ONLY where the change under test says
// so: `--allow door` admits the door squares and the doorways they leave
// (the camera PR turns a north–south door from a crack into an edge-on
// door and pairs a double's halves on the screen), anything else is a
// regression.
//
// Six cases: the three themes (a stage of each), the classic set, a door
// set and another piece set, all with the gods hot from ply 1.
//
// Usage (from phase0/, after npm i --no-save playwright):
//   node harness/camera-guard.mjs dump <dir>              # on the build of record
//   node harness/camera-guard.mjs compare <dir> [--allow door] [--shots]
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { encodePng } from '../lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 8936;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.ini': 'text/plain' };
const argv = process.argv.slice(2);
const MODE = argv[0];
const DIR = argv[1];
const arg = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt; };
const ALLOW = (arg('allow', '') || '').split(',').filter(Boolean);
const SHOTS = argv.includes('--shots');
const PLIES = parseInt(arg('plies', '14'), 10);
if (!['dump', 'compare'].includes(MODE) || !DIR) {
  console.error('usage: node harness/camera-guard.mjs dump|compare <dir> [--allow door] [--plies 14] [--shots]');
  process.exit(2);
}

const CASES = [
  { name: 'hall', stage: 's59-hall-corner' },
  { name: 'crypt', stage: 's60-the-junction' },
  { name: 'castle', stage: 's61-the-oubliettes' },
  { name: 'classic', stage: 's59-hall-corner', theme: 'classic' },
  { name: 'doors-castle', stage: 's59-hall-corner', doors: 'castle' },
  { name: 'pieces-pixel', stage: 's59-hall-corner', pieces: 'pixel-chess' },
];

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] ?? 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const executablePath = process.env.CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
fs.mkdirSync(DIR, { recursive: true });

/** In the page: mount a detached board from a recorded input set and hash
 *  every square (FNV-1a over its 16×16 RGBA). `facing` 0 or 2 — the old
 *  API reads `flipped`, the camera reads `facing`; both are passed. */
const RENDER_FN = `async (input, facing) => {
  const { CanvasBoard, loadAtlas } = await import('/play/js/canvas-board.mjs');
  const atlas = await loadAtlas();
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-2000px;top:0;width:400px;';
  document.body.appendChild(host);
  const ui = new CanvasBoard(host, { files: input.files, ranks: input.ranks, flipped: facing === 2, facing, atlas, showCoords: input.showCoords ?? true });
  await ui.ready;
  ui.setTheme(input.theme);
  ui.setPieces(input.pieces);
  ui.setDoors(input.doors);
  ui.setPieceFit(input.fit);
  ui.setArrowStyle(input.arrowStyle);
  const S = (a) => new Set(a ?? []);
  const bufs = input.debris ?? {};
  ui.setPosition(input.fen, { holes: S(input.holes), godCrates: S(input.godCrates), skins: input.skins ?? {}, opened: S(input.opened), rubble: S(input.rubble), debris: (sq) => (bufs[sq] ? new Uint8ClampedArray(bufs[sq]) : null) });
  ui.setMarks({ ...input.marks, arrows: input.arrows ?? [] });
  ui.paintNow();
  const hash = (px) => { let h = 0x811c9dc5; for (let i = 0; i < px.length; i++) { h ^= px[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  const squares = {};
  for (const sq of ui.cells.keys()) squares[sq] = hash(ui.squarePixels(sq));
  const buf = ui.bufferPixels();
  const out = { squares, width: buf.width, height: buf.height, all: hash(buf.data) };
  if (input.wantPixels) {
    const bytes = new Uint8Array(buf.data.buffer, buf.data.byteOffset, buf.data.length);
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    out.pixels = btoa(s);
  }
  ui.destroy();
  host.remove();
  return out;
}`;

/** In the page: the live board's inputs and its per-square hashes, read in
 *  one synchronous pass so the arrows and the pixels agree. */
const LIVE_FN = `() => {
  const K = window.__DCK;
  const ui = K.app.boardUI;
  ui.paintNow();
  const hash = (px) => { let h = 0x811c9dc5; for (let i = 0; i < px.length; i++) { h ^= px[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  const dir = K.app.duel?.director;
  const m = ui.marks;
  const debris = {};
  for (const [sq, b] of ui.debrisBufs) debris[sq] = Array.from(b);
  const input = {
    files: ui.files, ranks: ui.ranks, fen: ui.fen,
    holes: [...(dir?.holes ?? [])], godCrates: [...(dir?.godCrates ?? [])],
    opened: [...K.app.residue.opened], rubble: [...K.app.residue.rubble],
    skins: K.skins, theme: ui.theme, pieces: ui.pieces, doors: ui.doors,
    fit: { tileLift: ui.tileLift, tileShift: ui.tileShift }, arrowStyle: { ...ui.arrowStyle },
    marks: { selected: m.selected, targets: [...m.targets], check: m.check, pits: [...m.pits], cracked: [...m.cracked], breached: [...m.breached], heat: { ...m.heat } },
    arrows: ui.arrows.map((a) => ({ ...a })),
    debris,
  };
  const squares = {};
  for (const sq of ui.cells.keys()) squares[sq] = hash(ui.squarePixels(sq));
  const buf = ui.bufferPixels();
  return { input, live: { squares, width: buf.width, height: buf.height, all: hash(buf.data) }, ply: K.app.duel?.ply ?? 0 };
}`;

async function openCase(c) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
  const q = new URLSearchParams({ stage: c.stage, autobegin: '1', fx: '0', seed: '3', go: 'depth 3', probe: 'depth 6 movetime 200', onset: '1', mramp: '2', debt: '2', ...(c.theme ? { theme: c.theme } : {}), ...(c.doors ? { doors: c.doors } : {}), ...(c.pieces ? { pieces: c.pieces } : {}) });
  await page.goto(`http://127.0.0.1:${PORT}/play/index.html?${q}`);
  await page.waitForFunction(() => window.__DCK?.app?.duel?.state === 'playing', null, { timeout: 120000 });
  await page.evaluate(() => { const o = window.__DCK.options; o.cheat = true; o.hints = true; o.hintN = 3; window.__DCK.applyOptions(); });
  await page.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
  await page.evaluate(() => window.__DCK.renderer.ready());
  return { page, errs };
}

function pngOf(b64, width, height, file) {
  fs.writeFileSync(file, encodePng({ width, height, data: Buffer.from(b64, 'base64') }));
}

const failures = [];
const notes = [];
const expect = (ok, what) => (ok ? notes.push(`ok  ${what}`) : failures.push(what));

for (const c of CASES) {
  const file = path.join(DIR, `${c.name}.json`);
  if (MODE === 'dump') {
    const { page, errs } = await openCase(c);
    const plies = [];
    for (let i = 0; i <= PLIES; i++) {
      if (i > 0) {
        const st = await page.evaluate(async () => { const K = window.__DCK; if (K.app.duel.state !== 'playing') return K.app.duel.state; const mv = K.randomMove(); const s = await K.playerMove(mv); await K.waitIdle(); return s; });
        if (st !== 'playing') break;
      }
      const rec = await page.evaluate(`(${LIVE_FN})()`);
      // Sanity: a detached board fed the same inputs paints the live board's
      // pixels — the reproduction the compare run relies on is faithful.
      const det = await page.evaluate(`(${RENDER_FN})(${JSON.stringify({ ...rec.input, wantPixels: i === 0 })}, 0)`);
      const mirror = await page.evaluate(`(${RENDER_FN})(${JSON.stringify({ ...rec.input, wantPixels: i === 0 })}, 2)`);
      const same = det.all === rec.live.all;
      expect(same, `${c.name} p${rec.ply}: a detached board reproduces the live paint (${det.all} vs ${rec.live.all})`);
      if (!same) { const bad = Object.keys(rec.live.squares).filter((sq) => rec.live.squares[sq] !== det.squares[sq]); notes.push(`    differing squares: ${bad.join(' ')}`); }
      plies.push({ ply: rec.ply, input: rec.input, facing0: { squares: rec.live.squares, all: rec.live.all, width: rec.live.width, height: rec.live.height }, facing2: { squares: mirror.squares, all: mirror.all, width: mirror.width, height: mirror.height } });
      if (i === 0) {
        pngOf(det.pixels, det.width, det.height, path.join(DIR, `${c.name}-p0-facing0.png`));
        pngOf(mirror.pixels, mirror.width, mirror.height, path.join(DIR, `${c.name}-p0-facing2.png`));
      }
    }
    fs.writeFileSync(file, JSON.stringify({ case: c, plies }));
    expect(errs.length === 0, `${c.name}: no page errors${errs.length ? ` — ${errs.join(' | ')}` : ''}`);
    notes.push(`ok  ${c.name}: ${plies.length} plies recorded (${plies.map((p) => p.ply).join(',')})`);
    await page.close();
  } else {
    if (!fs.existsSync(file)) { failures.push(`${c.name}: no dump at ${file}`); continue; }
    const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
    const { page, errs } = await openCase(c);
    for (const p of dump.plies) {
      for (const facing of [0, 2]) {
        const want = p[`facing${facing}`];
        const got = await page.evaluate(`(${RENDER_FN})(${JSON.stringify({ ...p.input, wantPixels: SHOTS })}, ${facing})`);
        const diff = Object.keys(want.squares).filter((sq) => want.squares[sq] !== got.squares[sq]);
        const skins = p.input.skins ?? {};
        const opened = new Set(p.input.opened ?? []);
        const isDoorish = (sq) => skins[sq] === 'door' || opened.has(sq);
        // `turned`: at a facing other than north the paint of a square
        // whose art has a DIRECTION legitimately differs from the old
        // flipped path, which mirrored positions and nothing else — a
        // wall's faces, a ruin's stubs, a pit's rim, a doorway's posts and
        // a wall's hanging prop follow the turn (the masks are permuted to
        // the screen), a square's debris turns by index permutation. What
        // must still match: bare floor, the pieces, the marks, the arrows
        // and the coordinates — the position map itself.
        const grid = p.input.fen.split(' ')[0].split('/').map((row) => { const cells = []; for (const m of row.match(/\d+|./g)) { if (/\d/.test(m)) for (let i = 0; i < +m; i++) cells.push(null); else cells.push(m); } return cells; });
        const at = (sq) => grid[p.input.ranks - parseInt(sq.slice(1), 10)]?.[sq.charCodeAt(0) - 97] ?? null;
        const holes = new Set(p.input.holes ?? []), crates = new Set(p.input.godCrates ?? []), rubble = new Set(p.input.rubble ?? []);
        const isTurned = (sq) => at(sq) === '*' || holes.has(sq) || crates.has(sq) || rubble.has(sq) || opened.has(sq) || skins[sq] === 'masonry' || !!p.input.debris?.[sq];
        const allowed = diff.filter((sq) => (ALLOW.includes('door') && isDoorish(sq)) || (ALLOW.includes('turned') && facing !== 0 && isTurned(sq)));
        const bad = diff.filter((sq) => !allowed.includes(sq));
        const sizeOk = got.width === want.width && got.height === want.height;
        expect(sizeOk && bad.length === 0, `${c.name} p${p.ply} facing ${facing}: ${sizeOk ? '' : `buffer ${got.width}×${got.height} vs ${want.width}×${want.height}; `}${bad.length ? `${bad.length} squares differ: ${bad.join(' ')}` : 'identical'}${allowed.length ? ` (+${allowed.length} allowed: ${allowed.join(' ')})` : ''}`);
        if (SHOTS && got.pixels && (bad.length || allowed.length || p.ply === dump.plies[0].ply)) pngOf(got.pixels, got.width, got.height, path.join(DIR, `${c.name}-p${p.ply}-facing${facing}-after.png`));
      }
    }
    expect(errs.length === 0, `${c.name}: no page errors${errs.length ? ` — ${errs.join(' | ')}` : ''}`);
    await page.close();
  }
}

await browser.close();
server.close();
for (const n of notes) console.log(n);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`${MODE}: ${notes.length} ok, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
