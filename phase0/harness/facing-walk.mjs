// THE FACING WALK (Phase 2, the camera PR — 2026-09-08): the camera's turn
// over the whole arena bed, pixel for pixel.
//
// The claim under test (CLAUDE.md § Phase 2): a quarter turn of the camera
// is a CUT that paints the same dungeon seen from another side — every
// direction-bearing tile is generated from a mask, so permuting the masks
// to the screen makes wall faces, ruin stubs, pit rims and doorway posts
// follow the turn; debris turns by index permutation; pieces and props
// never turn; the variant hashes key on world coordinates so the floor
// holds still; a door stands edge-on when its line runs up the screen and
// a double's halves are dealt on the screen. The ORACLE is the renderer
// itself with no camera at all: for every stage and every facing f, the
// stage painted at facing f must equal the stage ROTATED IN THE WORLD by f
// quarter turns (its grid, skins, pieces and ledgers turned) painted at
// facing 0 — with the rotated board told, through `hashCoords`, which
// original square each of its squares is, so the cosmetic hashes agree.
// Both boards draw no coordinates (the edge labels legitimately differ)
// and no debris (the selftest covers the debris permutation on a pixel).
//
// A dressed position — walls, crates with skins, doors (singles, doubles,
// stacks), holes, god-cracked walls, opened doorways, ruins, pieces of
// both colours, a few marks and arrows — is put on every stage so every
// painter runs. 36 stages × 3 facings × the three themes' door sets.
//
// Usage (from phase0/, after npm i --no-save playwright):
//   node harness/facing-walk.mjs [--stages 36] [--shots]
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { encodePng } from '../lib/png.mjs';
import { loadStageV2, stageSkins } from '../../play/js/stage.mjs';
import { serializeBoard } from '../../play/js/fen.mjs';
import { toScreen } from '../../play/js/camera.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'phase0/results/facing-walk');
const PORT = 8937;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' };
const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt; };
const SHOTS = argv.includes('--shots');
const LIMIT = parseInt(arg('stages', '999'), 10);

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] ?? 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
if (SHOTS) { fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true }); }

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'play/stages/manifest.json'), 'utf8'));
const stages = manifest.stages.slice(0, LIMIT).map((j) => loadStageV2(j));

const sqName = (f, rank) => String.fromCharCode(97 + f) + rank;

/** A dressed position on a stage: the terrain as authored, then pieces on
 *  the first free floor squares of each king row, a hole, a god-cracked
 *  wall, an opened doorway and a ruin on the first squares that can carry
 *  them, a selection, a check, two arrows. Deterministic per stage. */
function dress(stage) {
  const { files, ranks, grid } = stage; // grid[rankFromBottom][file]
  const board = Array.from({ length: ranks }, (_, i) => Array.from({ length: files }, (_, f) => grid[ranks - 1 - i][f] ?? null)); // [rankFromTop][file]
  const floor = (f, r) => board[ranks - r][f] === null;
  const holes = [], godCrates = [], opened = [], rubble = [];
  const walls = [];
  for (let r = 1; r <= ranks; r++) for (let f = 0; f < files; f++) if (board[ranks - r][f] === '*') walls.push(sqName(f, r));
  if (walls[3]) holes.push(walls[3]);
  if (walls[7]) { godCrates.push(walls[7]); const f = walls[7].charCodeAt(0) - 97, r = parseInt(walls[7].slice(1), 10); board[ranks - r][f] = '^'; }
  if (walls[11]) { rubble.push(walls[11]); const f = walls[11].charCodeAt(0) - 97, r = parseInt(walls[11].slice(1), 10); board[ranks - r][f] = null; }
  const skins = stageSkins(stage);
  const doorSquares = Object.keys(skins).filter((sq) => skins[sq] === 'door');
  if (doorSquares[1]) { opened.push(doorSquares[1]); const f = doorSquares[1].charCodeAt(0) - 97, r = parseInt(doorSquares[1].slice(1), 10); board[ranks - r][f] = null; }
  // Pieces: white along rank 1 and 2, black along the top two ranks.
  const white = 'KQRBNPPRNB', black = 'kqrbnpprnb';
  let wi = 0, bi = 0;
  for (let r = 1; r <= 2; r++) for (let f = 0; f < files; f++) if (floor(f, r) && wi < white.length) board[ranks - r][f] = white[wi++];
  for (let r = ranks; r > ranks - 2; r--) for (let f = files - 1; f >= 0; f--) if (floor(f, r) && bi < black.length) board[ranks - r][f] = black[bi++];
  const fen = `${serializeBoard(board)} w - - 0 1`;
  const kingSq = (() => { for (let r = 1; r <= ranks; r++) for (let f = 0; f < files; f++) if (board[ranks - r][f] === 'K') return sqName(f, r); return null; })();
  const bkSq = (() => { for (let r = 1; r <= ranks; r++) for (let f = 0; f < files; f++) if (board[ranks - r][f] === 'k') return sqName(f, r); return null; })();
  const marks = { selected: kingSq, check: bkSq, targets: [sqName(Math.min(files - 1, 3), Math.min(ranks, 4))], pits: holes.slice(0, 1), cracked: godCrates.slice(0, 1), breached: rubble.slice(0, 1), heat: {} };
  const arrows = [{ from: sqName(0, 1), to: sqName(files - 1, ranks), kind: 'last', strength: 1 }, { from: sqName(files - 1, 1), to: sqName(0, ranks), kind: 'hint', rank: 1, strength: 0.8 }];
  return { fen, holes, godCrates, opened, rubble, skins, marks, arrows, board };
}

/** The same position turned by `facing` quarter turns IN THE WORLD: the
 *  square (f, rank) of the original becomes the square at its screen
 *  position (camera.mjs toScreen) read as a north-up board of the swapped
 *  dims. Every ledger, skin, mark and arrow follows. */
function rotate(pos, stage, facing) {
  const { files, ranks } = stage;
  const odd = facing & 1;
  const nf = odd ? ranks : files, nr = odd ? files : ranks;
  const map = (sq) => {
    const f = sq.charCodeAt(0) - 97, rank = parseInt(sq.slice(1), 10);
    const s = toScreen(f, rank, files, ranks, facing);
    return sqName(s.col, nr - s.row);
  };
  const board = Array.from({ length: nr }, () => Array(nf).fill(null));
  for (let r = 1; r <= ranks; r++) for (let f = 0; f < files; f++) {
    const v = pos.board[ranks - r][f];
    if (v === null) continue;
    const to = map(sqName(f, r));
    board[nr - parseInt(to.slice(1), 10)][to.charCodeAt(0) - 97] = v;
  }
  const mapList = (a) => a.map(map);
  const skins = Object.fromEntries(Object.entries(pos.skins).map(([sq, s]) => [map(sq), s]));
  const m = pos.marks;
  const marks = { selected: m.selected ? map(m.selected) : null, check: m.check ? map(m.check) : null, targets: mapList(m.targets), pits: mapList(m.pits), cracked: mapList(m.cracked), breached: mapList(m.breached), heat: {} };
  const arrows = pos.arrows.map((a) => ({ ...a, from: map(a.from), to: map(a.to) }));
  // The inverse: which ORIGINAL square each rotated square is (for hashCoords).
  const inverse = {};
  for (let r = 1; r <= ranks; r++) for (let f = 0; f < files; f++) inverse[map(sqName(f, r))] = [f, r];
  return { files: nf, ranks: nr, fen: `${serializeBoard(board)} w - - 0 1`, holes: mapList(pos.holes), godCrates: mapList(pos.godCrates), opened: mapList(pos.opened), rubble: mapList(pos.rubble), skins, marks, arrows, inverse };
}

const RENDER = `async (input) => {
  const { CanvasBoard, loadAtlas } = await import('/play/js/canvas-board.mjs');
  const atlas = await loadAtlas();
  const host = document.getElementById('host');
  const inv = input.inverse ?? null;
  const ui = new CanvasBoard(host, { files: input.files, ranks: input.ranks, facing: input.facing, atlas, showCoords: false, hashCoords: inv ? (f, rank) => inv[String.fromCharCode(97 + f) + rank] : null });
  await ui.ready;
  ui.setTheme(input.theme);
  ui.setDoors(input.doors);
  ui.setPieces('nulltale');
  const S = (a) => new Set(a ?? []);
  ui.setPosition(input.fen, { holes: S(input.holes), godCrates: S(input.godCrates), skins: input.skins, opened: S(input.opened), rubble: S(input.rubble) });
  ui.setMarks({ ...input.marks, arrows: input.arrows });
  ui.paintNow();
  const buf = ui.bufferPixels();
  const hash = (px) => { let h = 0x811c9dc5; for (let i = 0; i < px.length; i++) { h ^= px[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  const squares = {};
  for (const sq of ui.cells.keys()) squares[sq] = hash(ui.squarePixels(sq));
  const classes = {};
  for (const sq of ui.cells.keys()) classes[sq] = ui.cellClasses(sq).filter((c) => /^(door2-|door-edge|wall|ruin|hole|furniture)/.test(c)).join(' ');
  let pixels = null;
  if (input.wantPixels) {
    const bytes = new Uint8Array(buf.data.buffer, buf.data.byteOffset, buf.data.length);
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    pixels = btoa(s);
  }
  ui.destroy();
  return { width: buf.width, height: buf.height, all: hash(buf.data), squares, classes, pixels };
}`;

const executablePath = process.env.CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 500, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
await page.goto(`http://127.0.0.1:${PORT}/phase0/harness/lab/board.html`);

const failures = [];
let ok = 0;
let edgeDoors = 0, halves = 0, compared = 0;
for (const stage of stages) {
  const pos = dress(stage);
  const theme = stage.theme ?? 'hall';
  for (const facing of [1, 2, 3]) {
    const rot = rotate(pos, stage, facing);
    const a = await page.evaluate(`(${RENDER})(${JSON.stringify({ files: stage.files, ranks: stage.ranks, facing, theme, doors: null, fen: pos.fen, holes: pos.holes, godCrates: pos.godCrates, opened: pos.opened, rubble: pos.rubble, skins: pos.skins, marks: pos.marks, arrows: pos.arrows, wantPixels: SHOTS })})`);
    const b = await page.evaluate(`(${RENDER})(${JSON.stringify({ files: rot.files, ranks: rot.ranks, facing: 0, theme, doors: null, fen: rot.fen, holes: rot.holes, godCrates: rot.godCrates, opened: rot.opened, rubble: rot.rubble, skins: rot.skins, marks: rot.marks, arrows: rot.arrows, inverse: rot.inverse, wantPixels: SHOTS })})`);
    compared++;
    // Square by square, the turned board's square against the rotated
    // world's square at the same screen spot.
    const map = (sq) => { const f = sq.charCodeAt(0) - 97, rank = parseInt(sq.slice(1), 10); const s = toScreen(f, rank, stage.files, stage.ranks, facing); return sqName(s.col, rot.ranks - s.row); };
    const bad = [];
    for (const sq of Object.keys(a.squares)) if (a.squares[sq] !== b.squares[map(sq)]) bad.push(`${sq}→${map(sq)} [${a.classes[sq]}|${b.classes[map(sq)]}]`);
    const same = a.width === b.width && a.height === b.height && a.all === b.all;
    if (same && bad.length === 0) ok++;
    else failures.push(`${stage.id} facing ${facing}: ${same ? '' : `buffer ${a.width}×${a.height} vs ${b.width}×${b.height}; `}${bad.length} squares differ: ${bad.slice(0, 8).join(' ')}${bad.length > 8 ? ' …' : ''}`);
    for (const c of Object.values(a.classes)) { if (c.includes('door-edge')) edgeDoors++; if (/door2-/.test(c)) halves++; }
    if (SHOTS && (facing === 1 || bad.length)) {
      const png = (r, file) => fs.writeFileSync(path.join(OUT, file), encodePng({ width: r.width, height: r.height, data: Buffer.from(r.pixels, 'base64') }));
      png(a, `${stage.id}-f${facing}-camera.png`);
      png(b, `${stage.id}-f${facing}-world.png`);
    }
  }
}
await browser.close();
server.close();
for (const f of failures) console.log(`FAIL ${f}`);
if (errs.length) console.log(`page errors: ${errs.join(' | ')}`);
console.log(`facing-walk: ${ok}/${compared} stage × facing paints identical to the rotated world (${stages.length} stages; ${edgeDoors} edge-on door paints, ${halves} double-door halves seen)${SHOTS ? ` — shots in ${OUT}` : ''}`);
process.exit(failures.length || errs.length ? 1 : 0);
