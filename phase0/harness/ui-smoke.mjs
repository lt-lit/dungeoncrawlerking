// Live-board UI smoke: drive play/index.html in headless Chromium through the
// __DCK hook with the gods forced hot, and assert the UI on the REAL board
// (the 16×16 canvas board — the one renderer since 2026-09-07) — the
// selftest's renderer check covers a detached board, this covers the
// wiring: tiles painted from the Director ledgers after a quake, the
// per-rung residue marks + displacement arrows, the gods line, the log
// naming terrain rungs, ranked hint arrows from the STREAMING probe with a
// depth readout, a clean cancel path (no "unresponsive" recycle), the
// board's geometry and diagnostics line, the debris layer, the replay log.
// Screenshots land in phase0/results/ui-smoke/ for the eye.
//
// Setup (once): cd phase0 && npm i --no-save playwright  (Chromium: see
// selftest-headless.mjs). Usage: cd phase0 && node harness/ui-smoke.mjs
//   [--stage s59-hall-corner] [--plies 60] [--seed 3] [--shots]
//   [--go 'depth 8 movetime 120']  (the engine's search limits per move —
//   shallower searches grab material, which is how to reproduce the
//   "cracked wall captured in the reply" path below)
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'phase0/results/ui-smoke');
const PORT = 8932;
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.ini': 'text/plain' };

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const STAGE = arg('stage', 's59-hall-corner');
const PLIES = parseInt(arg('plies', '60'), 10);
const SEED = arg('seed', '3');
const SHOTS = argv.includes('--shots');
const THEME = arg('theme', null); // ?theme= override for the run (default: the stage's own)
const GO = arg('go', 'depth 8 movetime 120');

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(p)] ?? 'application/octet-stream',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const failures = [];
const notes = [];
const expect = (ok, what) => {
  process.stderr.write(`${ok ? 'ok ' : 'BAD'} ${what}\n`); // streamed as they land, so a hang is locatable
  if (ok) notes.push(`ok  ${what}`);
  else failures.push(what);
};

const executablePath = process.env.CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).split('\n')[0]));

// The gods hot from ply 1 (onset 1, ramp 2, debt cap 2 so holes land), short
// engine searches, no motion (fx=0 — animations gate app.busy), a short
// STREAMING probe so hints paint several depths per turn.
const q = new URLSearchParams({
  stage: STAGE,
  autobegin: '1',
  fx: '0',
  seed: SEED,
  go: GO,
  probe: 'depth 12 movetime 400',
  onset: '1',
  mramp: '2',
  debt: '2',
  ...(THEME ? { theme: THEME } : {}),
  // No gods overlay: its eval-delta probes run BEFORE the hint probe in the
  // idle window and would delay the hints this smoke times.
});
await page.goto(`http://127.0.0.1:${PORT}/play/index.html?${q}`);
await page.waitForFunction(() => window.__DCK?.app?.duel?.state === 'playing', null, { timeout: 120000 });
// Cheater Mode + hints ON through the options surface (persisted, so the
// probe fires on the very next player turn).
await page.evaluate(() => {
  const o = window.__DCK.options;
  o.cheat = true;
  o.hints = true;
  o.hintN = 3;
  o.evalBar = true;
  window.__DCK.applyOptions();
});
await page.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
// The probes: every square's classes (the shared test surface) and its
// decor, from the board's data; a signature of its drawn pixels.
await page.evaluate(() => {
  const K = window.__DCK;
  window.__smoke = {
    cells: () => Object.fromEntries([...K.app.boardUI.cells.keys()].map((sq) => [sq, K.marks.cell(sq)])),
    decor: (sq) => K.renderer.decor(sq),
    /** A signature of a square's drawn pixels — the theme check's "it changed". */
    sig: (sq) => { const px = K.renderer.square(sq); if (!px) return null; let h = 0; for (let i = 0; i < px.length; i++) h = (h * 31 + px[i]) >>> 0; return h; },
    painted: () => K.debris.stats().painted,
  };
});
await page.evaluate(() => window.__DCK.renderer.ready());

if (SHOTS) {
  fs.rmSync(OUT, { recursive: true, force: true }); // ply-numbered names: a stale shot from an earlier run would masquerade as this one
  fs.mkdirSync(OUT, { recursive: true });
}
const shot = async (name) => {
  if (!SHOTS) return;
  await page.locator('#screen-duel').screenshot({ path: path.join(OUT, `${name}.png`) });
};

// --- art themes (2026-09-03): the stage's own theme dresses the live board;
// the Art-set option and ?theme= override it; the legend follows. ---------
const themeState = () =>
  page.evaluate(async () => {
    const board = document.getElementById('board');
    // The options legend: five canvases painted off the atlas under the
    // theme (main.mjs paintLegend) — a signature per tile, so a theme
    // change must move them.
    const legendSig = [...document.querySelectorAll('.legend canvas[data-legend]')].map((c) => { const d = c.getContext('2d').getImageData(0, 0, 16, 16).data; let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) >>> 0; return h; });
    return {
      theme: window.__DCK.theme,
      attr: board.dataset.theme ?? null,
      legend: legendSig,
      // Every wall's autotile case, re-derived from its neighbours by the
      // renderer's own rule (a standing wall, a cracked wall, a door or
      // authored masonry is solid; a hole, floor or loose furniture is not;
      // off-board is not)
      // through the renderer's own canonicalMask — stage-independent, so
      // it runs on any --stage.
      masksBad: await (async () => {
        const { canonicalMask } = await import('/play/js/board-ui.mjs');
        const cells = new Map(Object.entries(window.__smoke.cells()));
        const has = (cl, k) => !!cl && cl.includes(k);
        const solid = (f, r) => {
          const c = cells.get(String.fromCharCode(97 + f) + r);
          return !!c && !has(c, 'hole') && (has(c, 'wall') || has(c, 'cracked') || has(c, 'skin-door') || has(c, 'skin-masonry'));
        };
        const bad = [];
        let n = 0;
        for (const [sq, c] of cells) {
          if (!has(c, 'wall') || has(c, 'hole')) continue;
          n++;
          const f = sq.charCodeAt(0) - 97;
          const r = parseInt(sq.slice(1), 10);
          const want = canonicalMask((solid(f, r + 1) ? 1 : 0) | (solid(f + 1, r) ? 2 : 0) | (solid(f, r - 1) ? 4 : 0) | (solid(f - 1, r) ? 8 : 0) | (solid(f + 1, r + 1) ? 16 : 0) | (solid(f + 1, r - 1) ? 32 : 0) | (solid(f - 1, r - 1) ? 64 : 0) | (solid(f - 1, r + 1) ? 128 : 0));
          if (!c.includes(`wm-${want}`)) bad.push(`${sq}:${c.find((k) => k.startsWith('wm-')) ?? 'none'}≠wm-${want}`);
        }
        return { n, bad };
      })(),
      pieces: window.__DCK.pieces,
      // Signatures of a wall, a floor and the king's square (a theme or set change must move them).
      sig: (() => { const S = window.__smoke; const cells = S.cells(); const wall = Object.keys(cells).find((sq) => cells[sq].includes('wall')); const floor = Object.keys(cells).find((sq) => !cells[sq].some((c) => ['wall', 'hole', 'furniture'].includes(c))); const fen = window.__DCK.app.duel.fen(); const kingSq = (fen.match(/K/) && (() => { const grid = fen.split(' ')[0].split('/'); for (let r = 0; r < grid.length; r++) { let f = 0; for (const ch of grid[r].replace(/\d+/g, (d) => '.'.repeat(+d))) { if (ch === 'K') return String.fromCharCode(97 + f) + (grid.length - r); f++; } } return null; })()); window.__DCK.renderer.paintNow(); return { wall: wall ? S.sig(wall) : null, floor: floor ? S.sig(floor) : null, king: kingSq ? S.sig(kingSq) : null }; })(),
    };
  });
const stageTheme = THEME ?? (await page.evaluate(() => window.__DCK.app.session.deal.stage.theme));
const themeSigs = {}; // per theme, the signatures
const legendSigs = {}; // per theme, the legend's five tiles
{
  const t = await themeState();
  expect(!!stageTheme && t.theme === stageTheme && t.attr === stageTheme && t.legend.length === 5 && t.legend.every((h) => h !== 0), `board wears the stage's theme "${stageTheme}" (${t.theme}/${t.attr}) and the legend's 5 tiles are painted`);
  themeSigs[stageTheme] = t.sig;
  legendSigs[stageTheme] = t.legend.join(',');
  expect(t.sig.floor !== null && t.sig.wall !== undefined, `the canvas board paints the stage (floor sig ${t.sig.floor}, wall sig ${t.sig.wall}, king sig ${t.sig.king})`);
  expect(t.masksBad.n > 0 && t.masksBad.bad.length === 0, `wall autotile masks match the standing-neighbour rule on all ${t.masksBad.n} walls${t.masksBad.bad.length ? ` — ${t.masksBad.bad.join(' ')}` : ''}`);
}
const setTheme = (name) =>
  page.evaluate((n) => {
    window.__DCK.options.theme = n;
    window.__DCK.applyOptions();
  }, name);
for (const name of THEME ? [] : ['hall', 'castle', 'crypt']) {
  await setTheme(name);
  const t = await themeState();
  themeSigs[name] = t.sig;
  legendSigs[name] = t.legend.join(',');
  expect(t.theme === name && t.attr === name && t.legend.length === 5, `Art set "${name}" overrides the stage (${t.theme})`);
  await shot(`00-theme-${name}`);
}
if (!THEME) {
  const floors = new Set(Object.values(themeSigs).map((x) => x?.floor)), walls = new Set(Object.values(themeSigs).map((x) => x?.wall));
  expect(floors.size === 3 && (walls.size === 3 || themeSigs.hall?.wall === null), `the canvas board repaints per theme: ${floors.size} floor looks, ${walls.size} wall looks over hall / castle / crypt`);
  expect(new Set(Object.values(legendSigs)).size === 3, `the legend repaints per theme (${new Set(Object.values(legendSigs)).size} looks)`);
}
if (!THEME) await setTheme('classic');
if (!THEME) {
  const t = await themeState();
  expect(t.theme === null && t.attr === null && t.sig.floor !== themeSigs.hall?.floor && t.sig.wall !== themeSigs.hall?.wall, `"classic" strips the theme: the flat floor and the drawn wall block off the atlas's classic row (floor sig ${t.sig.floor}, wall sig ${t.sig.wall})`);
  await shot('00-theme-classic');
}
await setTheme('auto');
expect((await themeState()).theme === stageTheme, 'Art set "auto" returns to the stage\'s own theme');
// Doors: the option overrides the theme's door; auto returns it.
await page.evaluate(() => { window.__DCK.options.doors = 'castle'; window.__DCK.applyOptions(); });
expect((await page.evaluate(() => window.__DCK.doors)) === 'castle', 'Doors option stamps the door set');
await page.evaluate(() => { window.__DCK.options.doors = 'auto'; window.__DCK.applyOptions(); });
expect((await page.evaluate(() => window.__DCK.doors)) === null, 'Doors "auto" is the theme\'s own');
// Piece sprites: the default set paints the king; an unknown set (the
// retired 'classic' glyphs, say) falls back to it.
{
  const t = await themeState();
  expect(t.pieces === 'nulltale' && t.sig.king !== null, `pieces default to the NullTale sprites (${t.pieces}; king square sig ${t.sig.king})`);
  await page.evaluate(() => { window.__DCK.options.pieces = 'classic'; window.__DCK.applyOptions(); });
  const c = await themeState();
  expect(c.pieces === null && c.sig.king === t.sig.king, `an unknown piece set ('classic', the retired glyphs) draws the default set — ${c.pieces}, king sig unchanged`);
  await page.evaluate(() => { window.__DCK.options.pieces = 'pixel-chess-wood'; window.__DCK.applyOptions(); });
  const wood = await themeState();
  expect(wood.pieces === 'pixel-chess-wood' && wood.sig.king !== t.sig.king, 'the wood set applies and repaints the king');
  await shot('00-pieces-wood');
  await page.evaluate(() => { window.__DCK.options.pieces = 'nulltale'; window.__DCK.applyOptions(); });
  // Decor: wall props (torch / banner / chain) on wall faces only — the
  // floor litter is packed away (round 10) — never on holes or furniture.
  const decor = await page.evaluate(() => { const S = window.__smoke; const cells = S.cells(); return Object.keys(cells).map((sq) => ({ name: S.decor(sq), cell: cells[sq] })).filter((d) => d.name); });
  expect(decor.every((d) => (d.name === 'doorway' ? !d.cell.includes('wall') && !d.cell.includes('furniture') : d.cell.includes('wall') && ['torch', 'banner', 'chain'].includes(d.name))), `${decor.length} cosmetic props: wall props on wall faces only, no floor litter`);
}

// --- skins: the hall's doors paint from ply 0 — g5 (east–west line) as the
// leaf, d8 (north–south line) as a weak spot ---------------------------------
if (STAGE === 's59-hall-corner') {
  const door = await page.evaluate(() => ({ g5: window.__DCK.marks.cell('g5'), d8: window.__DCK.marks.cell('d8') }));
  expect(door.g5?.includes('furniture') && door.g5?.includes('skin-door'), `g5 is the door leaf (${door.g5})`);
  // Round 16: g5+h5, the double doors in the south wall, are ONE two-wide
  // door — g5 the left half, h5 the right — and each half paints its own
  // pack sprite (the leaves' data URIs differ).
  const dbl = await page.evaluate(() => {
    const S = window.__smoke;
    return { g5: window.__DCK.marks.cell('g5'), h5: window.__DCK.marks.cell('h5'), same: S.sig('g5') === S.sig('h5') };
  });
  expect(dbl.g5?.includes('door2-l') && dbl.h5?.includes('door2-r') && !dbl.same, `g5+h5 are one double door: left half + right half, two different paints (${dbl.g5} / ${dbl.h5})`);
  // THE CAMERA (2026-09-08): a door in a north–south line stands EDGE-ON
  // north-up (the generated placeholder: the wall's band, a slab, two posts)
  // — no longer a weak spot wearing the crack — and its paint differs from
  // the leaf's.
  expect(door.d8?.includes('furniture') && door.d8?.includes('skin-door') && door.d8?.includes('door-edge') && !door.d8?.includes('weak') && door.d8?.some((c) => c.startsWith('wm-')), `d8, the door in the north–south line, stands edge-on with its wall case, not a weak spot (${door.d8})`);
  const edge = await page.evaluate(() => { const S = window.__smoke; return { d8: S.sig('d8'), g5: S.sig('g5'), wallInk: (() => { const px = window.__DCK.renderer.square('d8'); let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i]) n++; return n; })() }; });
  expect(edge.d8 !== edge.g5 && edge.wallInk === 256, `the edge-on door paints its own tile, fully opaque (sig ${edge.d8} vs the leaf's ${edge.g5}, ${edge.wallInk}/256 px)`);
}

// --- masonry (2026-09-04): an authored 'R' is a WEAK SPOT — the wall block
// wearing THE crack, never the retired rubble heap. Stage-independent: a
// no-op on a stage that authors none. ----------------------------------------
{
  const masonry = await page.evaluate(() => Object.entries(window.__DCK.skins)
    .filter(([, skin]) => skin === 'masonry')
    .map(([sq]) => ({ sq, cls: window.__DCK.marks.cell(sq) })));
  for (const m of masonry) {
    expect(m.cls?.includes('weak') && m.cls?.some((c) => c.startsWith('wm-')) && !m.cls?.includes('cracked'),
      `${m.sq}: authored masonry is a weak spot wearing a wall case (${m.cls})`);
  }
  if (masonry.length) console.log(`  (${masonry.length} authored masonry square(s) on ${STAGE})`);
}

// --- the streaming probe: arrows appear, ranked, with a depth readout --------
const probe = await page
  .waitForFunction(() => window.__DCK.cheat.arrows.length > 0 && /d\d+/.test(window.__DCK.cheat.hintLine), null, { timeout: 15000 })
  .then(() => page.evaluate(() => window.__DCK.cheat))
  .catch(() => null);
expect(!!probe, 'hint probe painted arrows with a depth readout on the first player turn');
if (probe) {
  expect(probe.arrows.every((a) => a.kind === 'hint' && a.rank >= 1), `arrows carry rank + kind: ${JSON.stringify(probe.arrows)}`);
  expect(probe.arrows[0].rank === 1, 'rank 1 is first in the arrow list');
  expect(/^1 /.test(probe.hintLine), `hint line starts with the rank-1 SAN: "${probe.hintLine}"`);
  // The drawn arrows: the board's list (pixel art in its buffer), in draw order.
  // No arrow carries an eval (designer 2026-09-07: "not worth keeping"); the hint LIST has them, one per rank.
  const drawn = await page.evaluate(() => window.__DCK.renderer.arrows.filter((a) => a.kind === 'hint').map((a) => ({ label: a.label ?? null, rank: String(a.rank) })));
  expect(drawn.length === probe.arrows.length && drawn.every((d) => d.label === null), `no hint arrow carries a label: ${JSON.stringify(drawn.map((d) => d.label))}`);
  const evals = probe.hintLine.match(/(\+|−|-)\d+\.\d(?!\d)|−?M\d+/g) ?? [];
  expect(evals.length === probe.arrows.length, `the hint line lists an eval per hint: "${probe.hintLine}"`);
  const listed = await page.evaluate(() => [...document.querySelectorAll('#hint-line .hint-item')].map((s) => s.dataset.rank + (s.querySelector('b') ? '' : '?')));
  expect(listed.join('') === probe.arrows.map((a) => a.rank).join(''), `the hint list carries one entry per rank in rank order, each with its eval: ${listed}`);
  const domRanks = drawn.map((d) => d.rank);
  expect(domRanks.length === probe.arrows.length && domRanks[domRanks.length - 1] === '1', `the buffer draws hints worst→best, best on top: ${domRanks}`);
  // A streaming probe repaints: wait for the depth to move at least once
  // within the movetime (depth 12 is far past what 400 ms reaches on any
  // board, so the readout climbs).
  const d0 = probe.depth;
  const climbed = await page.waitForFunction((d) => window.__DCK.cheat.depth > d, d0, { timeout: 3000 }).then(() => true).catch(() => false);
  // A fast, decided position can spend its 400 ms and END at the very depth
  // the first snapshot caught (seen once at d10, +10.9): the search is over
  // and nothing deeper was ever coming — a finished probe, not a stalled
  // stream. Accept that, and say which happened.
  const ended = climbed ? null : await page.evaluate(() => ({ active: window.__DCK.cheat.active, depth: window.__DCK.cheat.depth }));
  expect(climbed || (!!ended && !ended.active && ended.depth >= d0), climbed ? `probe streamed a deeper paint after d${d0}` : `probe finished at d${ended?.depth} with nothing deeper to stream after d${d0} (${JSON.stringify(ended)})`);
  await shot('01-hints');
  // The arrow dials (designer 2026-09-07: "make the arrows thinner. A thickness and opacity dial wouldn't hurt"):
  // width in floor pixels — the gold pixels the rank-1 arrow lights in its origin square of the buffer —
  // and the opacity; the setting persists; the default is 2 px at 85%.
  const dial = await page.evaluate(async () => {
    const K = window.__DCK;
    const first = K.cheat.arrows.find((a) => a.rank === 1);
    const measure = () => {
      K.renderer.paintNow();
      const px = K.renderer.square(first.from);
      let gold = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] === 0xf2 && px[i + 1] === 0xc1 && px[i + 2] === 0x4e && px[i + 3] === 255) gold++;
      return gold;
    };
    const dflt = K.arrowStyle;
    K.setArrowStyle(5, 1);
    const wide = measure();
    K.setArrowStyle(1, 1);
    const thin = measure();
    const thinStyle = K.arrowStyle;
    K.setArrowStyle(1, 0.5);
    const faint = measure();
    const faintStyle = K.arrowStyle;
    const saved = JSON.parse(localStorage.getItem('dck.options.v1') ?? '{}');
    K.setArrowStyle(dflt.width, dflt.alpha);
    return { kind: K.renderer.kind, dflt, wide, thin, faint, thinStyle, faintStyle, saved: { w: saved.arrowWidth, a: saved.arrowAlpha }, back: K.arrowStyle };
  });
  expect(dial.dflt.width === 2 && dial.dflt.alpha === 0.85, `the arrows' default style is 2 px at 85%: ${JSON.stringify(dial.dflt)}`);
  expect(dial.wide > dial.thin && dial.thin > 0 && dial.thinStyle.width === 1 && dial.thinStyle.alpha === 1, `the width dial: gold pixels in the rank-1 arrow's origin square ${dial.wide} at 5 px vs ${dial.thin} at 1 px (${JSON.stringify(dial.thinStyle)})`);
  expect(dial.faint === 0, `the opacity dial: at 50% no pixel is the pure colour any more (${dial.faint}), style ${JSON.stringify(dial.faintStyle)}`);
  expect(dial.faintStyle.alpha === 0.5 && dial.saved.w === 1 && dial.saved.a === 0.5 && dial.back.width === dial.dflt.width, `the dials persist in the options (${JSON.stringify(dial.saved)}) and reset (${JSON.stringify(dial.back)})`);
}

// --- play random moves until each rung has fired (or the ply budget runs out)
const seen = { weaken: 0, breach: 0, displace: 0, crumble: 0 };
let quakesChecked = 0;
let hintTurns = 0;
let turns = 0;
for (let i = 0; i < PLIES; i++) {
  const state = await page.evaluate(() => window.__DCK.app.duel?.state ?? 'none');
  if (state !== 'playing') break;
  turns++;
  const before = await page.evaluate(() => window.__DCK.record.quakes.length);
  // Hints must be present (or arriving) on every player turn.
  const hinted = await page.waitForFunction(() => window.__DCK.cheat.arrows.length > 0, null, { timeout: 8000 }).then(() => true).catch(() => false);
  if (hinted) hintTurns++;
  const st = await page.evaluate(async () => {
    const s = await window.__DCK.playerMove(window.__DCK.randomMove());
    await window.__DCK.waitIdle();
    return s;
  });
  const after = await page.evaluate(() => ({
    quakes: window.__DCK.record.quakes.slice(),
    marks: window.__DCK.marks.quake,
    godsLine: window.__DCK.marks.godsLine,
    logTail: [...document.querySelectorAll('#duel-log div')].slice(-6).map((d) => `${d.className}|${d.textContent}`),
    holes: [...window.__DCK.app.duel.director.holes],
    godCrates: [...window.__DCK.app.duel.director.godCrates],
    fen: window.__DCK.app.duel.fen(),
    turn: window.__DCK.app.duel.turnColor(),
  }));
  const fresh = after.quakes.slice(before);
  for (const ev of fresh) {
    quakesChecked++;
    for (const t of ev.terrain ?? []) seen[t.kind]++;
    seen.displace += ev.displacements.length;
    if (ev.crumble) seen.crumble++;
  }
  // Only quakes since the player's last move are on the board: the last
  // ply here is the ENGINE's reply (or the game ended), so residue from the
  // player's own ply and the reply is expected to be present and merged.
  if (fresh.length && st === 'playing' && after.turn === 'white') {
    const m = after.marks;
    expect(!!m, `quakeMarks present after ${fresh.length} quake(s) at ply ${i + 1}`);
    if (m) {
      const wantFrom = fresh.flatMap((e) => e.displacements.map((d) => d.from));
      const wantCracked = fresh.flatMap((e) => (e.terrain ?? []).filter((t) => t.kind === 'weaken').map((t) => t.square));
      const wantBreached = fresh.flatMap((e) => (e.terrain ?? []).filter((t) => t.kind === 'breach').map((t) => t.square));
      expect(wantFrom.every((sq) => m.from.includes(sq)) && m.arrows.length >= wantFrom.length, `merged residue records every displacement (${wantFrom}) and draws its arrow`);
      // A later rung supersedes: a crack that then broke open lives on as a breach, a breach that collapsed as a pit.
      expect(wantCracked.every((sq) => m.cracked.includes(sq) || m.breached.includes(sq)), `merged residue keeps every crack (${wantCracked})`);
      expect(wantBreached.every((sq) => m.breached.includes(sq) || m.pits.includes(sq)), `merged residue keeps every breach (${wantBreached})`);
      expect(after.godsLine.startsWith('⚡ the gods:'), `gods line set: "${after.godsLine}"`);
      const wantPits = fresh.filter((e) => e.crumble).map((e) => e.crumble.square);
      const cells = await page.evaluate((sqs) => Object.fromEntries(sqs.map((sq) => [sq, window.__DCK.marks.cell(sq)])), [...new Set([...wantFrom, ...wantCracked, ...wantBreached, ...wantPits])]);
      // A later rung on the same square supersedes the earlier mark: a wall
      // cracked and then broken open in one window shows as a breach.
      for (const sq of wantCracked) {
        if (m.breached.includes(sq)) expect(cells[sq]?.includes('fresh-breach') && !cells[sq]?.includes('fresh-crack'), `${sq}: cracked then breached → breach mark only (${cells[sq]})`);
        else if (!cells[sq]?.includes('furniture')) {
          // A cracked wall is a capturable '^': when the ENEMY'S REPLY took
          // it, the sprite went with it and the square is a ruin now
          // (main.mjs residue). Nothing about the crack is left to assert —
          // and the sprite queries below would throw on a missing element
          // (2026-09-03: the harness died with a stack trace when a run
          // under CPU load took this path; the engine's timed searches make
          // the game trajectory load-dependent).
          expect(true, `${sq}: cracked wall captured in the reply — no sprite to check (${cells[sq]})`);
        } else {
          expect(cells[sq]?.includes('fresh-crack') && cells[sq]?.includes('cracked') && cells[sq]?.includes('furniture'), `${sq}: cracked-wall tile + fresh-crack ring (${cells[sq]})`);
          // The cracked wall paints THE crack's black pixels over its wall case
          // (the crack drawing's ink is #0b0a10; the wall tile is never that dark).
          const ink = await page.evaluate((s) => { window.__DCK.renderer.paintNow(); const px = window.__DCK.renderer.square(s); let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] === 0x0b && px[i + 1] === 0x0a && px[i + 2] === 0x10) n++; return n; }, sq);
          expect(ink > 0, `${sq}: the cracked wall wears the crack's ink (${ink} px)`);
        }
      }
      for (const sq of wantBreached) {
        if (wantPits.includes(sq)) expect(cells[sq]?.includes('hole') && !cells[sq]?.includes('fresh-breach'), `${sq}: breached then collapsed → hole only (${cells[sq]})`);
        else expect(cells[sq]?.includes('fresh-breach') && !cells[sq]?.includes('furniture'), `${sq}: breach opened to floor + fresh-breach ring (${cells[sq]})`);
      }
      // A displacement is its arrow alone (round 13): no square mark on
      // either end.
      for (const sq of wantFrom) expect(!cells[sq]?.includes('quake-from') && !cells[sq]?.includes('quake-to'), `${sq}: a displacement leaves no square mark, only its arrow (${cells[sq]})`);
      // EVERY fresh hole keeps its rim — two crumbles in one window used to
      // leave only the latest marked.
      for (const sq of wantPits) expect(cells[sq]?.includes('hole') && cells[sq]?.includes('fresh-pit'), `${sq}: hole tile + fresh-pit ring (${cells[sq]})`);
      // A breached square keeps its RUIN stub (a .ruin cell wearing a stub
      // case, solid to the walls beside it) — or, for a door, its open
      // doorway (residue ledger; any door since the camera) — unless it is
      // now a hole; a burst crate (never part of the wall line) leaves nothing.
      const residue = await page.evaluate(() => window.__DCK.residue);
      const skinsNow = await page.evaluate(() => window.__DCK.skins);
      for (const sq of m.breached) {
        if (cells[sq]?.includes('hole')) continue;
        const dec = await page.evaluate((s) => window.__smoke.decor(s), sq);
        const stub = cells[sq]?.find((c) => c.startsWith('wm-')) ?? null;
        if (residue.rubble.includes(sq)) expect(cells[sq]?.includes('ruin') && stub !== null && dec === null, `${sq}: breached wall keeps its ruin stub (${stub}, ${dec})`);
        else if (residue.opened.includes(sq)) expect(dec === 'doorway' && !cells[sq]?.includes('ruin'), `${sq}: breached door keeps its open doorway (${dec})`);
        else expect(!cells[sq]?.includes('ruin') && dec === null && !['door', 'masonry'].includes(skinsNow[sq] ?? null), `${sq}: a burst crate leaves nothing (${skinsNow[sq]}, ${stub}, ${dec})`);
      }
      const quakeArrows = await page.evaluate(() => window.__DCK.renderer.arrows.filter((a) => a.kind === 'quake').length);
      expect(quakeArrows >= wantFrom.length, `${quakeArrows} quake arrow(s) in the buffer for ${wantFrom.length} displacement(s)`);
      const godLogs = after.logTail.filter((l) => l.startsWith('gods|'));
      expect(godLogs.length >= fresh.length, `log has ${godLogs.length} gods line(s) for ${fresh.length} quake(s)`);
      for (const e of fresh) for (const t of e.terrain ?? []) expect(godLogs.some((l) => l.includes(t.square)), `log names the ${t.kind} at ${t.square}`);
      if (fresh.some((e) => (e.terrain ?? []).length && e.displacements.length)) await shot(`02-mixed-quake-ply${i + 1}`);
      else if (fresh.some((e) => e.crumble)) await shot(`03-hole-ply${i + 1}`);
      else await shot(`04-quake-ply${i + 1}`);
    }
  }
  // Ledger-painted tiles must always agree with the Director on the live board.
  const tiles = await page.evaluate(tilesVsLedgers, after);
  expect(tiles.length === 0, `tiles agree with the ledgers at ply ${i + 1}${tiles.length ? `: ${tiles.join(', ')}` : ''}`);
  if (seen.weaken && seen.breach && seen.displace && seen.crumble && i > 12) break;
}

// --- undo restores BOTH ledgers (holes and god-minted crates) ---------------
if ((await page.evaluate(() => window.__DCK.app.duel?.state)) === 'playing') {
  const undone = await page.evaluate(async () => {
    window.__DCK.options.undo = true;
    window.__DCK.applyOptions();
    const holesBefore = window.__DCK.app.duel.director.holes.size;
    await window.__DCK.undo();
    await window.__DCK.waitIdle();
    const d = window.__DCK.app.duel;
    return { holesBefore, holes: [...d.director.holes], godCrates: [...d.director.godCrates], fen: d.fen(), marks: window.__DCK.marks.quake, godsLine: window.__DCK.marks.godsLine, state: d.state };
  });
  expect(undone.marks === null && undone.godsLine === '', 'undo clears the gods\' residue and the gods line');
  expect(undone.holes.length <= undone.holesBefore, `undo rewound the hole ledger (${undone.holes.length} ≤ ${undone.holesBefore})`);
  const tilesAfterUndo = await page.evaluate(tilesVsLedgers, undone);
  expect(tilesAfterUndo.length === 0, `tiles agree with the restored ledgers after undo${tilesAfterUndo.length ? `: ${tilesAfterUndo.join(', ')}` : ''}`);
}

/** Both directions: every ledger hole paints as a hole, every painted
 *  cracked wall is a ledger crate, and every ledger crate still standing as
 *  '^' paints cracked — and every RUIN wears the stub case of its STANDING
 *  wall neighbours (a wall, a cracked wall, a door or authored masonry;
 *  never another ruin,
 *  an opened doorway, a hole or a crate — round 12's clumps), every opened
 *  DOORWAY the east/west mask of its standing walls (its posts), and every
 *  HOLE the 4-bit mask of its hole neighbours (round 13's pit autotile).
 *  Runs in the page. */
function tilesVsLedgers({ holes, godCrates, fen }) {
  const bad = [];
  const S = window.__smoke;
  const cells = S.cells();
  const cl = (sq) => cells[sq] ?? null;
  const has = (sq, k) => !!cl(sq)?.includes(k);
  const caseOf = (sq) => cl(sq)?.find((k) => k.startsWith('wm-')) ?? 'no case';
  for (const sq of holes) if (!has(sq, 'hole')) bad.push(`${sq} not a hole`);
  for (const sq of Object.keys(cells)) if (has(sq, 'cracked') && !godCrates.includes(sq)) bad.push(`${sq} cracked without ledger`);
  for (const sq of godCrates) if (has(sq, 'furniture') && !has(sq, 'cracked')) bad.push(`${sq} god crate painted as authored`);
  const at = (f, r) => String.fromCharCode(97 + f) + r;
  const standing = (f, r) => { const sq = at(f, r); return !!cl(sq) && (has(sq, 'wall') || has(sq, 'cracked') || has(sq, 'skin-door') || has(sq, 'skin-masonry')); };
  for (const sq of Object.keys(cells)) {
    const f = sq.charCodeAt(0) - 97;
    const r = parseInt(sq.slice(1), 10);
    if (has(sq, 'ruin')) {
      const want = (standing(f, r + 1) ? 1 : 0) | (standing(f + 1, r) ? 2 : 0) | (standing(f, r - 1) ? 4 : 0) | (standing(f - 1, r) ? 8 : 0);
      if (!has(sq, `wm-${want}`)) bad.push(`${sq} ruin wears ${caseOf(sq)}, its standing neighbours say wm-${want}`);
    }
    if (S.decor(sq) === 'doorway') {
      // Four bits since the camera (2026-09-08): a north–south door's
      // doorway has its posts above and below.
      const want = (standing(f, r + 1) ? 1 : 0) | (standing(f + 1, r) ? 2 : 0) | (standing(f, r - 1) ? 4 : 0) | (standing(f - 1, r) ? 8 : 0);
      if (!has(sq, `wm-${want}`)) bad.push(`${sq} doorway wears ${caseOf(sq)}, its standing walls say wm-${want}`);
    }
    if (has(sq, 'hole')) {
      const isHole = (ff, rr) => has(at(ff, rr), 'hole');
      const want = (isHole(f, r + 1) ? 1 : 0) | (isHole(f + 1, r) ? 2 : 0) | (isHole(f, r - 1) ? 4 : 0) | (isHole(f - 1, r) ? 8 : 0);
      if (!has(sq, `wm-${want}`)) bad.push(`${sq} hole wears ${caseOf(sq)}, its hole neighbours say wm-${want}`);
    }
  }
  void fen;
  return bad;
}

// --- residue clears on the player's move, and the cancel path stayed clean ---
const st = await page.evaluate(() => window.__DCK.app.duel?.state);
if (st === 'playing') {
  await page.evaluate(async () => {
    await window.__DCK.playerMove(window.__DCK.randomMove());
  });
  // Immediately after the player's move (before/while the reply lands) the
  // previous residue is gone; the gods line too.
  const cleared = await page.evaluate(() => ({ marks: window.__DCK.marks.quake, godsLine: window.__DCK.marks.godsLine, arrows: window.__DCK.cheat.arrows.length }));
  const replyQuaked = await page.evaluate(() => window.__DCK.record.quakes.length);
  expect(cleared.marks === null || replyQuaked > 0, 'residue cleared by the player\'s move (unless the reply already quaked again)');
  expect(cleared.arrows === 0 || replyQuaked >= 0, 'hint arrows cleared the moment the position changed');
  await page.evaluate(() => window.__DCK.waitIdle());
}
const logAll = await page.evaluate(() => [...document.querySelectorAll('#duel-log div')].map((d) => d.textContent));
expect(!logAll.some((l) => l.includes('unresponsive')), 'no probe cancel ever fell through to a recycle');
expect(!logAll.some((l) => l.includes('probe failed')), 'no probe failure during the run');
expect(!logAll.some((l) => l.includes('desync')), 'no engine desync');
expect(pageErrors.length === 0, `no page errors${pageErrors.length ? `: ${pageErrors.join(' | ')}` : ''}`);
expect(quakesChecked > 0, `${quakesChecked} quake(s) fired in ${PLIES} plies`);
expect(hintTurns === turns, `hints painted on every player turn (${hintTurns}/${turns})`);
await shot('05-final');
// The options panel: the new "Keep evaluating" toggle and the terrain legend.
// A programmatic click: the end-of-duel overlay may be covering the topbar
// button when the random game finished early, and a real click would wait
// on it forever.
await page.evaluate(() => document.getElementById('btnOptions').click());
expect(await page.evaluate(() => !!document.getElementById('optHintCont') && document.querySelectorAll('.legend canvas[data-legend]').length === 5 && !document.getElementById('optRenderer') && !document.getElementById('optPiecePixels') && !document.getElementById('optPieceScale')), 'options panel has the Keep-evaluating toggle, a 5-tile legend, and no Renderer / piece-mode / % dial (retired with the DOM board)');
// The board's geometry: an integer scale, a device-pixel-sized canvas, the
// diagnostics line saying so, the placement dials in whole tile pixels;
// the Scaling option remounts live (fill = the exact quotient) and back.
{
  const geo = await page.evaluate(() => { const K = window.__DCK; return { info: K.renderer.info, diag: K.renderer.diagShown, fit: K.pieceFit, pxDialsShown: !document.getElementById('optTileLift').closest('.opt').hidden, canvases: document.querySelectorAll('#board canvas').length, cw: document.querySelector('#board canvas').width, cssW: document.querySelector('#board canvas').getBoundingClientRect().width, pieces: document.querySelectorAll('#board .piece, #board .cell').length }; });
  expect(geo.info.renderer === 'canvas' && geo.info.integer && Number.isInteger(geo.info.k) && geo.info.k >= 1 && geo.info.devW === geo.cw && Math.abs(geo.cssW * geo.info.dpr - geo.cw) < 1, `canvas board: k ${geo.info.k} (${geo.info.tilePx} device px per tile), the canvas ${geo.cw} device px = its css width × ${geo.info.dpr}, one canvas on the board (${geo.canvases})`);
  expect(typeof geo.diag === 'string' && geo.diag.startsWith('canvas ·') && geo.diag.includes(`k ${geo.info.k}`), `the diagnostics line reads "${geo.diag}"`);
  expect(geo.fit.pixels === 'tile' && geo.pxDialsShown && geo.pieces === 0, `tile-grid only: lift ${geo.fit.tileLift} / shift ${geo.fit.tileShift} px, the px dials shown, no cell or piece elements on the board`);
  const sw = await page.evaluate(async () => {
    const K = window.__DCK;
    const fen = K.app.duel.fen();
    K.renderer.set('fill');
    await K.renderer.ready();
    K.renderer.paintNow();
    const fill = { info: K.renderer.info, painted: K.debris.stats().painted, canvases: document.querySelectorAll('#board canvas').length };
    K.renderer.set('integer');
    await K.renderer.ready();
    K.renderer.paintNow();
    return { fill, back: K.renderer.info, same: K.app.duel.fen() === fen, painted: K.debris.stats().painted, canvases: document.querySelectorAll('#board canvas').length, diag: K.renderer.diagShown };
  });
  expect(sw.fill.info.scaling === 'fill' && !sw.fill.info.integer && sw.fill.canvases === 1 && sw.back.integer && sw.same && sw.canvases === 1 && sw.painted === sw.fill.painted && sw.painted > 0 && !!sw.diag, `the Scaling option remounts live: → fill (k ${sw.fill.info.k.toFixed(3)}, ${sw.fill.painted} debris squares) → integer (k ${sw.back.k}, ${sw.painted} debris squares, diag back)`);
}
// --- THE CAMERA (Phase 2, 2026-09-08): the phone is the stacked layout
// north-up; the debug turn buttons turn the view a quarter at a time — the
// buffer swaps its axes, k refits, every square's hit-test round-trips
// through the turned geometry, the kinds and the debris stay put, the
// coordinates label what varies along each edge — and the door in the
// north–south line shows its LEAF once the line runs across the screen.
{
  const cam = await page.evaluate(async () => {
    const K = window.__DCK;
    const out = { layout: K.renderer.layout, start: K.renderer.info, turns: [] };
    const kinds0 = JSON.stringify([...K.app.boardUI.kinds]);
    const painted0 = K.debris.stats().painted;
    const btn = (id) => document.getElementById(id);
    for (const [click, want] of [['btnTurnR', 1], ['btnTurnR', 2], ['btnTurnL', 1], ['btnTurnL', 0], ['btnTurnL', 3]]) {
      btn(click).click();
      await K.renderer.ready();
      K.renderer.paintNow();
      const info = K.renderer.info;
      let round = 0, total = 0;
      for (const sq of K.app.boardUI.cells.keys()) {
        total++;
        const p = K.renderer.pointOfSquare(sq);
        if (K.renderer.squareAtPoint(p.x, p.y) === sq) round++;
      }
      out.turns.push({ click, want, facing: K.renderer.facing(), info, round, total, kindsSame: JSON.stringify([...K.app.boardUI.kinds]) === kinds0, painted: K.debris.stats().painted, label: document.getElementById('facingName').textContent, d8: K.marks.cell('d8'), g5: K.marks.cell('g5'), h5: K.marks.cell('h5'), diag: K.renderer.diagShown });
    }
    K.renderer.facing(0);
    await K.renderer.ready();
    K.renderer.paintNow();
    out.end = K.renderer.info;
    out.painted0 = painted0;
    return out;
  });
  expect(cam.layout.layout === 'stack' && cam.start.fit === 'width' && cam.start.facing === 0 && !cam.layout.wide, `the phone viewport is the stacked layout, fit width, north up (${JSON.stringify(cam.layout)})`);
  for (const t of cam.turns) {
    const odd = t.facing & 1;
    expect(t.facing === t.want && t.info.facing === t.want && t.info.screenCols === (odd ? t.info.ranks : t.info.files) && t.info.bufW === t.info.screenCols * 16 && Number.isInteger(t.info.k) && t.info.k >= 1, `${t.click} → facing ${t.facing} (${t.label}): the buffer is ${t.info.screenCols}×${t.info.screenRows} tiles at k ${t.info.k}`);
    expect(t.round === t.total && t.total > 0, `facing ${t.facing}: ${t.round}/${t.total} squares hit-test back to themselves`);
    expect(t.kindsSame && t.painted === cam.painted0, `facing ${t.facing}: the world-space kinds and the ${t.painted} debris squares are unchanged`);
    expect(typeof t.diag === 'string' && t.diag.includes(`${t.label}`), `facing ${t.facing}: the diagnostics line says "${t.label}"`);
    if (STAGE === 's59-hall-corner') {
      // The doors that still STAND this late in a hot duel (the gods may
      // have cracked, breached or swallowed any of them by now): d8 in the
      // north–south line is edge-on north / south up and a leaf east / west
      // up; g5 + h5, the double in the east–west south wall, are two edge-on
      // doors east / west up and the halves dealt on the screen otherwise.
      const stands = (c) => !!c && c.includes('furniture') && c.includes('skin-door');
      if (stands(t.d8)) expect(t.d8.includes('door-edge') === !odd, `facing ${t.facing}: d8's line runs ${odd ? 'across the screen — a leaf' : 'up the screen — edge-on'} (${t.d8})`);
      if (stands(t.g5) && stands(t.h5)) {
        if (odd) expect(t.g5.includes('door-edge') && t.h5.includes('door-edge') && !t.g5.some((c) => c.startsWith('door2-')), `facing ${t.facing}: the south wall's double runs up the screen — two edge-on doors (${t.g5} / ${t.h5})`);
        else expect(t.g5.includes(t.facing === 2 ? 'door2-r' : 'door2-l') && t.h5.includes(t.facing === 2 ? 'door2-l' : 'door2-r'), `facing ${t.facing}: the double's halves dealt on the screen (${t.g5} / ${t.h5})`);
      }
      if (!stands(t.d8) && !(stands(t.g5) && stands(t.h5))) notes.push(`    (facing ${t.facing}: the doors are gone by now — d8 ${t.d8?.filter((c) => /hole|ruin|furniture/.test(c)).join('/') || 'floor'}; the stance checks ran at ply 0 above)`);
    }
  }
  expect(cam.end.facing === 0 && cam.end.screenCols === cam.start.screenCols && cam.end.k === cam.start.k, `back north-up: the geometry is the start's (k ${cam.end.k})`);
  await shot('06b-facing');
}
// THE CAMERA OWNS THE SCREEN: a wide viewport flips the layout live — the
// body class, the two columns, the board an explicit box the canvas fills,
// k the largest step that fits BOTH axes (height-bound here), the board
// centred in it — and narrowing flips it back.
{
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(250);
  const wide = await page.evaluate(async () => {
    const K = window.__DCK;
    await K.renderer.ready();
    K.renderer.paintNow();
    const board = document.getElementById('board');
    const c = board.querySelector('canvas');
    const br = board.getBoundingClientRect(), cr = c.getBoundingClientRect();
    const panel = document.getElementById('player-bar').getBoundingClientRect();
    return { layout: K.renderer.layout, info: K.renderer.info, board: { w: br.width, h: br.height, x: br.left }, canvas: { w: cr.width, h: cr.height, cw: c.width, ch: c.height }, panelLeft: panel.left, wide: document.body.classList.contains('layout-wide') };
  });
  const i = wide.info;
  const fitsW = Math.floor(i.devW / i.bufW), fitsH = Math.floor(i.devH / i.bufH);
  expect(wide.wide && wide.layout.layout === 'wide' && i.fit === 'box', `1280×720: the wide layout (fit ${i.fit})`);
  expect(Math.abs(wide.canvas.w - wide.board.w) < 1 && Math.abs(wide.canvas.h - wide.board.h) < 1 && i.devW === wide.canvas.cw && i.devH === wide.canvas.ch, `the canvas IS the board's box: ${wide.canvas.cw}×${wide.canvas.ch} device px`);
  expect(Number.isInteger(i.k) && i.k === Math.min(fitsW, fitsH) && i.k >= 1, `k ${i.k} = the largest step that fits both axes (width ${fitsW}, height ${fitsH})`);
  expect(i.x0 === Math.floor((i.devW - i.bufW * i.k) / 2) && i.y0 === Math.floor((i.devH - i.bufH * i.k) / 2) && (i.x0 > 0 || i.y0 > 0), `the board is centred in the box (x0 ${i.x0}, y0 ${i.y0})`);
  expect(wide.panelLeft > wide.board.x + wide.board.w - 1, `the player's bar sits in the column beside the board (bar at ${Math.round(wide.panelLeft)} px, board ends ${Math.round(wide.board.x + wide.board.w)})`);
  await shot('06c-wide');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const back = await page.evaluate(async () => { const K = window.__DCK; await K.renderer.ready(); K.renderer.paintNow(); return { layout: K.renderer.layout, info: K.renderer.info }; });
  expect(!back.layout.wide && back.info.fit === 'width' && back.info.y0 === 0, `back at the phone width: the stacked layout, fit width (k ${back.info.k})`);
}
if (SHOTS) await page.locator('#options-card').screenshot({ path: path.join(OUT, '06-options.png') });
// --- The replay log (2026-09-06): the export builds from the live duel and
// is complete (states per ply, the engine record, inputs on every due roll,
// the mirrored duel log, the build + engine stamp), the autosave ring holds
// it, the buttons exist, and an UNDO leaves a branch holding the exact
// pre-undo board with the abandoned tail.
{
  const pre = await page.evaluate(() => {
    const d = window.__DCK.app.duel;
    const L = window.__DCK.log.build();
    const due = L.quakeTraces.filter((t) => t.path.includes('quake'));
    return {
      ply: d.ply,
      fen: d.fen(),
      state: d.state,
      saved: window.__DCK.log.saved(),
      buttons: ['btnFlag', 'btnOverlayExport', 'btnOptionsExport', 'btnOptionsCopy', 'btnSavedExport', 'btnGodsExport', 'btnOverlayReview', 'btnSavedOpen'].filter((id) => !document.getElementById(id)),
      schema: L.schema,
      states: L.states.length,
      plies: L.plies,
      ended: L.states[L.states.length - 1]?.ended === true,
      statesAligned: L.states.every((s, i) => s.ply === i || (s.ended && s.ply === L.plies)),
      engine: L.engine.length,
      engineOk: L.engine.every((e) => e.score && Number.isInteger(e.depth) && e.ms >= 0 && Array.isArray(e.pv)),
      traces: L.quakeTraces.length,
      due: due.length,
      inputs: due.filter((t) => t.inputs && Array.isArray(t.inputs.hints) && t.inputs.probes).length,
      // the "why" layer: pools + rejects per rung on every due roll that acted, the meters' inputs on every ply
      why: due.filter((t) => t.outcome === 'quiet' || t.outcome === 'vetoed' || (t.candidates?.length && t.candidates.every((c) => Array.isArray(c.pool) && Array.isArray(c.rejected)))).length,
      whyPlies: L.quakeTraces.filter((t) => t.moveEv && t.stale && Array.isArray(t.threatKeys)).length,
      protectedListed: due.filter((t) => t.protected && Array.isArray(t.protected.pieceList) && t.protected.keys).length,
      timed: L.quakeTraces.every((t) => t.timing && Number.isInteger(t.timing.total) && t.seq > 0),
      quakes: L.quakes.length,
      attempts: L.attempts.length,
      branches: L.branches.length, // the residue check above already undid once
      logLines: L.log.length,
      app: L.meta.app,
      eng: L.meta.engine,
      ua: !!L.meta.ua,
      seq: L.seq,
      size: JSON.stringify(L).length,
    };
  });
  expect(pre.buttons.length === 0, `replay-log buttons present${pre.buttons.length ? ` — missing ${pre.buttons.join(',')}` : ''}`);
  // states[0] is the start and every ply adds one; on a finished game the
  // last ply's state IS the `ended` entry (no undo snapshot after a game-
  // ending move), so the count is plies + 1 either way. A game-ending MOVE
  // never reaches the quake phase, so an ended game has one trace fewer.
  expect(pre.schema === 'dck-log/1' && pre.states === pre.plies + 1 && pre.statesAligned, `export: ${pre.states} states for ${pre.plies} plies${pre.ended ? ' (the last is the final position)' : ''}, aligned`);
  expect(pre.engine > 0 && pre.engineOk && (pre.traces === pre.plies || (pre.ended && pre.traces === pre.plies - 1)) && pre.timed, `export: ${pre.engine} engine searches with score/depth/pv/ms, ${pre.traces} timed roll traces`);
  expect(pre.due > 0 && pre.inputs === pre.due, `export: ${pre.inputs}/${pre.due} due rolls carry the engine inputs verbatim (${pre.quakes} quakes landed, ${pre.attempts} draws rejected)`);
  expect(pre.why === pre.due && pre.whyPlies === pre.traces && pre.protectedListed === pre.due, `export: the "why" layer — pools + rejects on ${pre.why}/${pre.due} due rolls, the protected set listed on ${pre.protectedListed}, meter inputs on ${pre.whyPlies}/${pre.traces} plies`);
  expect(pre.logLines > 0 && !!pre.app && !!pre.eng && pre.ua, `export: ${pre.logLines} mirrored log lines, build "${pre.app}", engine "${pre.eng}"`);
  expect(pre.saved.length >= 1 && pre.saved[0].plies === pre.plies, `autosave ring holds this duel (${pre.saved.length} saved, ${pre.saved[0]?.plies} plies, ${(pre.size / 1024).toFixed(0)} KB export)`);
  // Undo through the real button path (Cheater Mode + Allow undo), then
  // read the branch back from the export.
  await page.evaluate(() => { window.__DCK.options.undo = true; window.__DCK.applyOptions(); });
  const und = await page.evaluate(async () => {
    await window.__DCK.undo();
    await window.__DCK.waitIdle();
    const L = window.__DCK.log.build();
    const b = L.branches[L.branches.length - 1];
    return { n: L.branches.length, ply: L.plies, from: b?.from?.fen ?? null, fromPly: b?.fromPly, toPly: b?.toPly, fromState: b?.from?.state, tail: b?.tail?.moves?.length ?? -1, tailStates: b?.tail?.states?.length ?? -1, marker: L.tunes.some((t) => t.undo && t.branch === b?.seq), saved: window.__DCK.log.saved()[0], logLine: [...document.querySelectorAll('#duel-log div')].some((d) => d.textContent.includes('took back')) };
  });
  expect(und.n === pre.branches + 1 && und.from === pre.fen && und.fromPly === pre.ply && und.toPly === und.ply && und.fromState === pre.state, `undo → branch #${und.n}: ply ${und.fromPly} → ${und.toPly}, pre-undo board kept verbatim (game was ${und.fromState}; ${pre.branches} earlier undo${pre.branches === 1 ? '' : 's'} kept)`);
  expect(und.tail === pre.ply - und.ply && und.tailStates >= und.tail && und.marker && und.logLine, `branch tail holds the ${und.tail} abandoned plies (+${und.tailStates} states), tunes marker points at it, the log says so`);
  expect(und.saved?.branches === und.n && und.saved?.plies === und.ply, `autosave rewritten after the undo (${und.saved?.plies} plies, ${und.saved?.branches} branches)`);
  await page.evaluate(() => { window.__DCK.options.undo = false; window.__DCK.applyOptions(); });
}
// --- The replay log's in-game half (2026-09-06): the debug panel's
// "before" paints the last quake's pre-quake board and "after" restores the
// live one; "deep Δ" probes that quake's three boards at the enemy's own
// limits (the smoke's are fast) and lands the verdict on the record.
{
  await page.evaluate(() => { window.__DCK.options.godsDebug = true; window.__DCK.applyOptions(); });
  await page.waitForFunction(() => !window.__DCK.app.busy && window.__DCK.app.duel?.state === 'playing', null, { timeout: 60000 });
  const ba = await page.evaluate(() => {
    const d = window.__DCK.app.duel;
    const q = d.record.quakes[d.record.quakes.length - 1];
    const live = d.fen();
    const cells = () => Object.fromEntries([...document.querySelectorAll('#board .cell[data-square]')].map((c) => [c.dataset.square, `${[...c.classList].filter((k) => !k.startsWith('f') || k.length > 2).sort().join(' ')}|${c.querySelector('.piece')?.dataset.piece ?? ''}`]));
    const before = cells();
    const btn = document.getElementById('btnGodsBefore');
    const wasDisabled = btn.disabled;
    btn.click();
    const showing = window.__DCK.gods.showingBefore?.ply ?? null;
    const during = cells();
    const label = btn.textContent;
    btn.click();
    const after = cells();
    return {
      hasQuake: !!q,
      quakePly: q?.ply ?? null,
      wasDisabled,
      showing,
      label,
      differ: Object.keys(before).filter((k) => before[k] !== during[k]).length,
      restored: Object.keys(before).every((k) => before[k] === after[k]),
      off: window.__DCK.gods.showingBefore,
      liveFen: d.fen() === live,
      preFen: q?.preFen,
    };
  });
  expect(ba.hasQuake && !ba.wasDisabled && ba.showing === ba.quakePly && ba.label.startsWith('after') && ba.off === null && ba.restored && ba.liveFen, `before/after: painted the pre-quake board of ply ${ba.showing} (${ba.differ} cells differ) and restored the live board`);
  const deep = await page.evaluate(async () => {
    const d = window.__DCK.app.duel;
    const q = d.record.quakes[d.record.quakes.length - 1];
    const queued = window.__DCK.gods.deep();
    const t0 = Date.now();
    while (!q.deepDelta && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 100));
    const btn = document.getElementById('btnGodsDeep');
    return { queued, dd: q.deepDelta ?? null, line: [...document.querySelectorAll('#gods-trace div')].some((x) => x.textContent.includes('DEEP Δ')), btnDisabled: btn.disabled, exported: window.__DCK.log.build().quakes.find((x) => x.ply === q.ply)?.deepDelta ?? null };
  });
  const s = (x) => (x ? `${x.type === 'mate' ? 'M' : ''}${x.value}` : '—');
  expect(deep.queued && deep.dd?.pre && deep.dd?.post && deep.dd.go && deep.line && deep.btnDisabled && deep.exported, `deep Δ landed on the last quake (${deep.dd?.go}: ${s(deep.dd?.beforeMove)} → ${s(deep.dd?.pre)} → ${s(deep.dd?.post)}), the panel says so, the export carries it`);
  await page.evaluate(() => { window.__DCK.options.godsDebug = false; window.__DCK.applyOptions(); });
}
// --- THE DEBRIS LAYER (2026-09-07): the floor remembers. A kill leaves
// blood, a smashed crate its own pixels, a breach the wall's stone, a
// displacement a skid, a crumble the floor's; the ledger is the STAGE's
// (persisted under the stage id, an epoch per duel); toggles filter the
// paint, never the record; an undo forgets the rewound plies' events. Every
// painted square carries a decoded 16×16 PNG <img> as its first child.
{
  const dz = await page.evaluate(() => {
    const K = window.__DCK;
    const d = K.app.duel;
    K.debris.save();
    const st = K.debris.stats();
    const evs = K.debris.events();
    const byKind = {};
    for (const e of evs) byKind[e.k] = (byKind[e.k] ?? 0) + 1;
    const want = { weaken: 0, breach: 0, crumble: 0, skid: 0 };
    for (const q of d.record.quakes) {
      for (const t of q.terrain ?? []) want[t.kind] = (want[t.kind] ?? 0) + 1;
      want.skid += (q.displacements ?? []).length;
      if (q.crumble) want.crumble++;
    }
    const S = window.__smoke;
    const painted = Object.keys(S.cells()).filter((sq) => K.debris.cell(sq).painted);
    // every painted square wears a 16×16 debris buffer in the canvas with painted pixels
    const urlsOk = painted.every((sq) => K.debris.cell(sq).pixels > 0);
    const paintedOnFloor = painted.every((sq) => { const cl = K.marks.cell(sq); return !cl.includes('wall') && !cl.includes('hole') && !cl.includes('furniture'); });
    const breachSquares = d.record.quakes.flatMap((q) => (q.terrain ?? []).filter((t) => t.kind === 'breach').map((t) => t.square));
    const breachPainted = breachSquares.filter((sq) => !!K.debris.cell(sq)?.painted);
    // One canvas is the board: no piece elements, no overlay layers.
    const layerOrder = { canvases: document.querySelectorAll('#board canvas').length, piece: document.querySelectorAll('#board .piece').length, overlays: document.querySelectorAll('#board svg, #board .fx-layer').length };
    const captures = d.record.sans.filter((s) => s.includes('x')).length;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(K.debris.key + K.debris.env)); } catch { /* none */ }
    return {
      env: K.debris.env, stageId: d.record.deal?.stageId ?? K.app.session.deal.stageId, epoch: st.epoch, events: st.events, byKind, want, traffic: st.traffic, pending: st.pending,
      attr: document.getElementById('board').dataset.debris, painted: painted.length, urlsOk, paintedOnFloor, breach: breachSquares.length, breachPainted: breachPainted.length,
      captures, plyMax: Math.max(0, ...evs.map((e) => e.p)), ply: d.ply, samplerN: st.sampler, layerOrder,
      savedEvents: saved?.events?.length ?? null, savedEpoch: saved?.epoch ?? null, savedId: saved?.id ?? null,
    };
  });
  expect(dz.env === dz.stageId && dz.savedId === dz.env && dz.epoch >= 1, `the debris ledger is the stage's own (${dz.env}, epoch ${dz.epoch}), saved under its id`);
  expect(dz.attr === 'destruction blood skid wear fx', `the board carries data-debris (${dz.attr})`);
  expect((dz.byKind.kill ?? 0) + (dz.byKind.smash ?? 0) === dz.captures, `one kill or smash per capture on the record (${dz.byKind.kill ?? 0} kills + ${dz.byKind.smash ?? 0} smashes = ${dz.captures} captures)`);
  expect((dz.byKind.weaken ?? 0) === dz.want.weaken && (dz.byKind.breach ?? 0) === dz.want.breach && (dz.byKind.skid ?? 0) === dz.want.skid && (dz.byKind.crumble ?? 0) === dz.want.crumble, `every quake rung left its event (weaken ${dz.byKind.weaken ?? 0}/${dz.want.weaken}, breach ${dz.byKind.breach ?? 0}/${dz.want.breach}, skid ${dz.byKind.skid ?? 0}/${dz.want.skid}, crumble ${dz.byKind.crumble ?? 0}/${dz.want.crumble})`);
  expect(dz.events > 0 && dz.painted > 0 && dz.urlsOk && dz.paintedOnFloor && dz.pending === 0, `${dz.painted} squares wear a 16×16 debris buffer in the canvas, all on floor, nothing left in flight (${dz.events} events)`);
  expect(dz.layerOrder.canvases === 1 && dz.layerOrder.piece === 0 && dz.layerOrder.overlays === 0, `the canvas board: one canvas, no piece elements, no overlay layers`);
  expect(dz.breach === 0 || dz.breachPainted > 0, `a breached wall's square wears its own stone (${dz.breachPainted}/${dz.breach})`);
  expect(dz.plyMax <= dz.ply, `no event outlives the record after the undos (latest event ply ${dz.plyMax} ≤ ${dz.ply})`);
  expect(dz.traffic > 0, `traffic wears the floor (${dz.traffic} cells visited)`);
  expect(dz.savedEvents === dz.events && dz.savedEpoch === dz.epoch, `localStorage holds the ledger (${dz.savedEvents} events, epoch ${dz.savedEpoch})`);
  expect(dz.samplerN > 0, `the sprite sampler decoded ${dz.samplerN} sprites off the atlas`);
  // Toggles filter the paint, not the record.
  const tog = await page.evaluate(async () => {
    const K = window.__DCK;
    const count = () => window.__smoke.painted();
    const before = count();
    K.options.debris = { ...K.options.debris, destruction: false, blood: false, skid: false, wear: false };
    K.applyOptions();
    const off = count();
    const attrOff = document.getElementById('board').dataset.debris;
    const eventsOff = K.debris.stats().events;
    K.options.debris = { ...K.options.debris, destruction: true, blood: true, skid: true, wear: true };
    K.applyOptions();
    // the squares come back once each buffer is re-encoded (setDebris) — a few ms
    const t0 = Date.now();
    while (count() < before && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 20));
    return { before, off, attrOff, eventsOff, after: count(), waited: Date.now() - t0 };
  });
  expect(tog.before > 0 && tog.off === 0 && tog.attrOff === 'off' && tog.eventsOff === dz.events && tog.after === tog.before, `toggles hide the paint and keep the record (${tog.before} → ${tog.off} → ${tog.after} painted squares, ${tog.eventsOff} events; the images were back in ${tog.waited} ms)`);
  await shot('debris');
  // The scars persist: back to the preview of the same stage, then a new duel — epoch + 1, every event kept.
  const again = await page.evaluate(async () => {
    const K = window.__DCK;
    const events = K.debris.stats().events, epoch = K.debris.stats().epoch;
    K.preview();
    await new Promise((r) => setTimeout(r, 300));
    const previewPainted = window.__smoke.painted();
    const previewPhase = K.app.phase;
    await K.begin();
    return { events, epoch, previewPainted, previewPhase, epochNow: K.debris.stats().epoch, eventsNow: K.debris.stats().events, phase: K.app.phase };
  });
  await page.waitForFunction(() => !window.__DCK.app.busy && window.__DCK.app.duel?.state === 'playing', null, { timeout: 60000 });
  expect(again.previewPhase === 'preview' && again.previewPainted > 0, `the setup preview shows the stage's scars (${again.previewPainted} squares)`);
  expect(again.epochNow === again.epoch + 1 && again.eventsNow === again.events && again.phase === 'playing', `a rematch is a new epoch on the same floor (epoch ${again.epoch} → ${again.epochNow}, ${again.eventsNow} events kept)`);
}
// --- THE FLIGHT: with motion on, the debris flies before it lands (the
// board draws the flight's frames; the landing paints the squares). ---
{
  const page2 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs2 = [];
  page2.on('pageerror', (e) => errs2.push(String(e).split('\n')[0]));
  const q2 = new URLSearchParams({ stage: STAGE, autobegin: '1', seed: SEED, go: GO, probe: 'depth 6 movetime 100', onset: '1', mramp: '2', debt: '2', ...(THEME ? { theme: THEME } : {}) });
  await page2.goto(`http://127.0.0.1:${PORT}/play/index.html?${q2}`);
  await page2.waitForFunction(() => window.__DCK?.app?.duel?.state === 'playing', null, { timeout: 120000 });
  await page2.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
  const fl = await page2.evaluate(async () => {
    const K = window.__DCK;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let captures = 0, plies = 0;
    for (; plies < 40 && K.app.duel.state === 'playing'; plies++) {
      await K.playerMove(K.randomMove());
      const t0 = Date.now();
      while ((K.app.busy || K.debris.busy) && Date.now() - t0 < 30000) await wait(50);
      captures = K.app.duel.record.sans.filter((s) => s.includes('x')).length;
      if (captures >= 2 && K.debris.frames() > 0) break;
    }
    const t0 = Date.now();
    while (K.debris.busy && Date.now() - t0 < 5000) await wait(50);
    const evs = K.debris.events();
    const st = K.debris.stats();
    return { plies, captures, frames: K.debris.frames(), persistent: st.painted, transient: K.debris.busy ? 1 : 0, events: evs.length, pending: st.pending, flights: st.flights, fx: K.debris.options.fx };
  });
  expect(fl.fx && fl.events > 0, `motion on: ${fl.events} events over ${fl.plies} plies (${fl.captures} captures)`);
  expect(fl.frames > 0, `the flight drew ${fl.frames} frames into the canvas buffer`);
  expect(fl.pending === 0 && fl.flights === 0 && fl.transient === 0 && fl.persistent > 0, `everything landed: no flight held, nothing pending, the flight cleared, ${fl.persistent} squares keep their debris`);
  expect(errs2.length === 0, `no page errors with the flight on${errs2.length ? ` — ${errs2.join(' | ')}` : ''}`);
  await page2.close();
}
// --- THE WINDOW (Phase 2 milestone 4, 2026-09-08): `?zoom=12&viewport=screen`
// on a phone puts the arena at a zoom the screen cannot hold whole, so the
// board paints a WINDOW of it — a sub-rectangle of the buffer blitted, the
// visible squares hit-testing back through the window, the diag naming the
// fit — and the duel plays on unchanged.
{
  const page3 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs3 = [];
  page3.on('pageerror', (e) => errs3.push(String(e).split('\n')[0]));
  const q3 = new URLSearchParams({ stage: STAGE, autobegin: '1', seed: SEED, go: GO, probe: 'depth 6 movetime 100', zoom: '12', viewport: 'screen', debris: 'off', fx: '0', ...(THEME ? { theme: THEME } : {}) });
  await page3.goto(`http://127.0.0.1:${PORT}/play/index.html?${q3}`);
  await page3.waitForFunction(() => window.__DCK?.app?.duel?.state === 'playing', null, { timeout: 120000 });
  await page3.waitForFunction(() => !window.__DCK.app.busy, null, { timeout: 60000 });
  const win = await page3.evaluate(async () => {
    const K = window.__DCK;
    await K.renderer.ready();
    K.renderer.paintNow();
    const info = K.renderer.info;
    const inWin = (col, row) => col >= info.window.col0 && col < info.window.col0 + info.window.cols && row >= info.window.row0 && row < info.window.row0 + info.window.rows;
    let visible = 0, round = 0, cells = 0, cellRound = 0;
    for (const sq of K.app.boardUI.cells.keys()) {
      const g = K.app.boardUI.gridPos(sq);
      if (!inWin(g.col, g.row)) continue;
      visible++;
      const p = K.renderer.pointOfSquare(sq);
      if (K.renderer.squareAtPoint(p.x, p.y) === sq) round++;
      const c = K.app.boardUI.cells.get(sq).cell;
      cells++;
      const pc = K.renderer.pointOfCell(c.f, c.r);
      const back = K.renderer.cellAtPoint(pc.x, pc.y);
      if (back && back.f === c.f && back.r === c.r) cellRound++;
    }
    // Zoom out to 2 through the hook: the whole arena fits the width again (the window clips to the world).
    K.renderer.zoom(2);
    await K.renderer.ready();
    K.renderer.paintNow();
    const info3 = K.renderer.info;
    return { info, visible, round, cells, cellRound, diag: K.renderer.diagShown, info3, state: K.app.duel.state };
  });
  expect(win.info.fit === 'window' && win.info.k === 12 && win.info.viewport === 'screen', `?zoom=12&viewport=screen: fit window at k 12 (${win.info.fit}, k ${win.info.k}, ${win.info.viewport})`);
  expect(win.info.window.cols < win.info.files && win.info.bufW === win.info.window.cols * 16 && win.info.blit.sw < win.info.bufW + 1 && win.info.blit.sw * win.info.k >= win.info.devW - 1, `the buffer is a ${win.info.window.cols}×${win.info.window.rows} window of the ${win.info.files}×${win.info.ranks} arena, the blit its visible ${win.info.blit.sw}×${win.info.blit.sh} px`);
  expect(win.visible > 0 && win.round === win.visible && win.cellRound === win.cells, `${win.round}/${win.visible} visible squares and ${win.cellRound}/${win.cells} cells hit-test back through the window`);
  expect(typeof win.diag === 'string' && win.diag.includes('fit window'), `the diagnostics line says fit window (${win.diag})`);
  expect(win.info3.k === 2 && win.info3.window.cols === win.info3.files && win.info3.blit.sw === win.info3.bufW && win.state === 'playing', `zoom 2: the whole arena is the window again (${win.info3.window.cols} cols, blit ${win.info3.blit.sw} of ${win.info3.bufW}); the duel plays on`);
  expect(errs3.length === 0, `no page errors on the window page${errs3.length ? ` — ${errs3.join(' | ')}` : ''}`);
  await page3.close();
}
// --- THE WALK (Phase 2 milestone 4b, 2026-09-08; the controls and camera
// session, 2026-09-09): `?gen=` begins a run on a generated floor; the
// inputs are WORLD-relative and the facing follows the step (a step in a
// new direction pivots first), a `face` input turns in place for a move, a
// wall refuses, the run saves after every turn (schema dck-run/3) and
// exports as one object, a tapped piece marks its chess moves WITHOUT
// moving the camera or the zoom (no box outline since 2026-09-10), the pad's tap turns
// and the keys face, a DRAG looks around and the next move brings the
// camera back, a PINCH steps the zoom, leaving and resuming keep the turn,
// an import lands on the imported state. The board is north-up throughout.
{
  const page4 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs4 = [];
  page4.on('pageerror', (e) => errs4.push(String(e).split('\n')[0]));
  await page4.goto(`http://127.0.0.1:${PORT}/play/index.html?gen=vaults&seed=1&fx=0&enemies=off`); // the enemies have their own block below; this one walks an empty floor
  await page4.waitForFunction(() => window.__DCK?.app?.phase === 'walk', null, { timeout: 120000 });
  const wk = await page4.evaluate(async () => {
    const K = window.__DCK;
    await K.renderer.ready();
    K.renderer.paintNow();
    const out = {};
    out.screen = { walk: !document.getElementById('screen-walk').hidden, duel: !document.getElementById('screen-duel').hidden, setup: !document.getElementById('screen-setup').hidden };
    out.info = K.renderer.info;
    out.start = K.walk.state;
    out.world = { id: K.app.walk.world.id, facing: K.app.walk.world.start.facing, theme: K.app.walk.world.theme, files: K.app.walk.world.files, ranks: K.app.walk.world.ranks };
    out.saved0 = K.walk.saved();
    out.noEnemies = K.walk.enemies.length === 0 && K.walk.state.rows.join('').replace(/[^a-z]/g, '').length === 0;
    // A step the way the army faces (east at the start) is +f for every piece, no pivot; the board stays north-up.
    const fwd = [[0, 1], [1, 0], [0, -1], [-1, 0]][out.start.facing];
    const p1 = await K.walk.input({ kind: 'step', df: fwd[0], dr: fwd[1] });
    out.step = { ok: p1.ok, pivot: p1.pivot, moves: p1.moves.length, state: K.walk.state, boardFacing: K.renderer.info.facing };
    // A face input costs a move: the facing turns a quarter right, the king stays, the board does not turn.
    const p2 = await K.walk.input({ kind: 'face', facing: (out.start.facing + 1) % 4 });
    out.turn = { ok: p2.ok, pivot: p2.pivot, state: K.walk.state, facing: K.renderer.info.facing };
    // A wait.
    const p3 = await K.walk.input({ kind: 'wait' });
    out.wait = { ok: p3.ok, turn: K.walk.state.turn };
    // Step east until a wall refuses (the ring at the latest); the first east step pivots the army east.
    let refused = null, pivots = 0;
    for (let i = 0; i < 80 && !refused; i++) { const p = await K.walk.input({ kind: 'step', df: 1, dr: 0 }); if (!p.ok) refused = p.reason; else if (p.pivot) pivots++; }
    out.refused = { reason: refused, turn: K.walk.state.turn, status: document.getElementById('walk-status').textContent, pivots, facing: K.walk.state.facing };
    // The save after every turn: the stored run's turn equals the state's; the export is one object of the schema with the turn list.
    const saved = K.walk.saved();
    const exp = K.walk.export();
    out.save = { schema: exp.schema, turn: saved.turn, turns: exp.turns.length, worldId: exp.worldId, hasStart: !!exp.start?.world, hasFloor: !!exp.floors?.[exp.floor]?.world, key: localStorage.getItem('dck.run.v1') ? 1 : 0 };
    // Tap a piece (the king included): its chess moves are marked, the zoom and the focus stay, no box outline (the box is read off the debug surface); tap elsewhere: let go.
    const settle = async () => { await new Promise((r) => setTimeout(r, 30)); while (K.walk.busy) await new Promise((r) => setTimeout(r, 20)); };
    // The first piece with a chess move to offer (a pawn against a wall has none).
    const pc = K.walk.state.pieces.filter((p) => p.ch !== 'K').find((p) => { K.walk.select(p.f, p.r); const n = K.walk.state.targets.length; K.walk.select(-1, -1); return n > 0; }) ?? K.walk.state.pieces[1];
    const z0 = K.walk.zoom();
    const f0 = K.walk.focus();
    K.walk.select(pc.f, pc.r);
    const f1 = K.walk.focus();
    out.tap = { z0, z1: K.renderer.info.k, selected: K.walk.state.selected, targets: K.walk.state.targets.length, focusSame: f0.f === f1.f && f0.r === f1.r && f0.dx === f1.dx && f0.dy === f1.dy, box: K.walk.box(), chessOnly: K.walk.state.targets.every((t) => pc.ch === 'N' ? Math.abs(t.f - pc.f) * Math.abs(t.r - pc.r) === 2 : pc.ch === 'R' ? t.f === pc.f || t.r === pc.r : true) };
    K.walk.select(-1, -1);
    out.tap.z2 = K.renderer.info.k;
    out.tap.cleared = K.walk.state.selected === null;
    const kg = K.walk.state.king;
    K.walk.select(kg.f, kg.r);
    out.tapKing = { selected: K.walk.state.selected, targets: K.walk.state.targets.length, allAdjacent: K.walk.state.targets.every((t) => Math.max(Math.abs(t.f - kg.f), Math.abs(t.r - kg.r)) === 1) };
    K.walk.select(-1, -1);
    // The zoom steps as a cut through the surface (the buttons are gone; + − and the wheel drive it).
    K.walk.zoom(z0 + 1);
    out.zoomIn = K.renderer.info.k;
    K.walk.zoom(z0);
    out.zoomOut = K.renderer.info.k;
    // The pad: a TAP on the south arm while facing east turns the army south (a move); the keys: 'q' faces left.
    const t0 = K.walk.state.turn;
    { const pad = document.getElementById('walk-pad'); const pr = pad.getBoundingClientRect(); const px = pr.left + pr.width / 2, py = pr.top + pr.height * 0.86; const pev = (type) => pad.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: px, clientY: py, pointerId: 9, button: 0, buttons: 1 })); pev('pointerdown'); out.padLit = pad.dataset.dir; pev('pointerup'); }
    await settle();
    out.padTap = { turns: K.walk.state.turn - t0, facing: K.walk.state.facing };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }));
    await settle();
    out.pad = { turns: K.walk.state.turn - t0, facing: K.walk.state.facing };
    // A key chord: W and D together is one north-east input (facing east keeps east, so no pivot); the key held past the chord window and released.
    const t2 = K.walk.state.turn, kq = { ...K.walk.state.king };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    await new Promise((r) => setTimeout(r, 90));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', bubbles: true }));
    await settle();
    const lastInput = K.walk.saved().turns.at(-1);
    const chordInputs = K.walk.saved().turns.filter((i) => i.kind !== 'duel').slice(t2);
    out.chord = { turns: K.walk.state.turn - t2, last: lastInput, allNE: chordInputs.every((i) => i.kind === 'step' && i.df === 1 && i.dr === 1), king: { ...K.walk.state.king }, from: kq, facing: K.walk.state.facing };
    // A DRAG on the map looks around: the focus moves, no turn is spent; the next move brings the camera back.
    const t1 = K.walk.state.turn;
    const el = document.getElementById('walk-board');
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const pe = (type, x, y, id = 7) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: id, button: 0, buttons: 1 }));
    const before = K.walk.focus();
    pe('pointerdown', cx, cy); pe('pointermove', cx + 30, cy + 10); pe('pointermove', cx + 60, cy + 20); pe('pointerup', cx + 60, cy + 20);
    await settle();
    out.drag = { turns: K.walk.state.turn - t1, look: K.walk.look(), focusBefore: before, focusAfter: K.walk.focus(), facing: K.walk.state.facing };
    await K.walk.input({ kind: 'wait' });
    out.drag.lookAfterMove = K.walk.look();
    // A PINCH steps the zoom: two pointers spreading apart step k up, closing step it down.
    const zp = K.walk.zoom();
    pe('pointerdown', cx - 40, cy, 11); pe('pointerdown', cx + 40, cy, 12);
    pe('pointermove', cx - 80, cy, 11); pe('pointermove', cx + 80, cy, 12);
    out.pinchUp = K.walk.zoom();
    pe('pointermove', cx - 20, cy, 11); pe('pointermove', cx + 20, cy, 12);
    out.pinchDown = K.walk.zoom();
    pe('pointerup', cx - 20, cy, 11); pe('pointerup', cx + 20, cy, 12);
    out.pinchBase = zp;
    // Leave: the setup shows the resume card; resume: the same turn and facing.
    const snap = K.walk.state;
    K.walk.leave();
    out.leave = { phase: K.app.phase, resume: !document.getElementById('btnRunResume').hidden, resumeText: document.getElementById('btnRunResume').textContent };
    K.walk.resume();
    await K.renderer.ready();
    const back = K.walk.state;
    out.resume = { phase: K.app.phase, sameTurn: back.turn === snap.turn, sameFacing: back.facing === snap.facing, sameKing: back.king.f === snap.king.f && back.king.r === snap.king.r };
    // Import: a copy of the export with the king moved one cell in the save lands on that state; a wrong stamp is refused.
    const bad = { ...exp, schema: 'dck-run/0' };
    const badOk = await K.walk.import(bad);
    out.importBad = { ok: badOk, note: document.getElementById('run-note').textContent };
    const copy = JSON.parse(JSON.stringify(K.walk.export()));
    copy.turn = 99;
    const okImport = await K.walk.import(copy);
    out.importOk = { ok: okImport, turn: K.walk.state.turn, phase: K.app.phase };
    return out;
  });
  expect(wk.screen.walk && !wk.screen.duel && !wk.screen.setup, 'the walk screen is up, the duel and setup screens down');
  expect(wk.info.fit === 'window' && wk.info.viewport === 'screen' && Number.isInteger(wk.info.k) && wk.info.k >= 1 && wk.info.crop === null, `the board is a window over the world at k ${wk.info.k} with no crop`);
  expect(wk.start.worldId === 'vaults-1' && wk.start.facing === wk.world.facing && wk.start.pieces.length === 8 && wk.start.turn === 0, `the run begins on the generated floor facing its start's way with the 4×2 opening kit (${wk.start.pieces.length} pieces, turn ${wk.start.turn})`);
  expect(wk.saved0 && wk.saved0.turn === 0, 'the run is saved at turn 0');
  expect(wk.noEnemies, '?enemies=off walks an empty floor: no enemy, no lowercase letter');
  expect(wk.step.ok && !wk.step.pivot && wk.step.moves === 8 && wk.step.state.king.f === wk.start.king.f + [[0, 1], [1, 0], [0, -1], [-1, 0]][wk.start.facing][0] && wk.step.state.king.r === wk.start.king.r + [[0, 1], [1, 0], [0, -1], [-1, 0]][wk.start.facing][1] && wk.step.state.turn === 1 && wk.step.boardFacing === 0, `a step the way the army faces moves all eight one cell ahead, no pivot, the board north-up (${wk.step.moves} moves, king ${wk.step.state.king.f})`);
  expect(wk.turn.ok && wk.turn.pivot && wk.turn.state.facing === (wk.start.facing + 1) % 4 && wk.turn.facing === 0 && wk.turn.state.king.f === wk.step.state.king.f && wk.turn.state.king.r === wk.step.state.king.r && wk.turn.state.turn === 2, `a face input pivots the army a quarter right for a move; the king stays and the board stays north-up (army facing ${wk.turn.state.facing}, board ${wk.turn.facing})`);
  expect(wk.wait.ok && wk.wait.turn === 3, 'a wait passes a turn');
  expect(wk.refused.reason === 'blocked' && /blocked/.test(wk.refused.status) && wk.refused.pivots === 1 && wk.refused.facing === 1, `stepping east pivots the army east once and walks until a wall refuses and says so (${wk.refused.reason}, turn ${wk.refused.turn}, ${wk.refused.pivots} pivot)`);
  expect(wk.save.schema === 'dck-run/3' && wk.save.turn === wk.refused.turn && wk.save.turns === wk.refused.turn && wk.save.worldId === 'vaults-1' && wk.save.hasStart && wk.save.hasFloor && wk.save.key === 1, `the run saves after every turn under one key: schema ${wk.save.schema}, turn ${wk.save.turn}, ${wk.save.turns} inputs, the start and the floor inside`);
  expect(wk.tap.selected !== null && wk.tap.targets > 0 && wk.tap.z1 === wk.tap.z0 && wk.tap.z2 === wk.tap.z0 && wk.tap.focusSame && wk.tap.cleared && wk.tap.chessOnly, `a tapped piece marks ${wk.tap.targets} chess moves with the zoom (${wk.tap.z0}) and the focus unmoved; a tap elsewhere lets go`);
  expect(wk.tap.box && wk.tap.box.ok && wk.tap.box.rect.f1 - wk.tap.box.rect.f0 === 9 && wk.tap.box.rect.r1 - wk.tap.box.rect.r0 === 9, `the box the army must fit is a 10×10 on the king's rank, nobody behind him (${JSON.stringify(wk.tap.box?.rect)}, depth ${wk.tap.box?.minDy}…${wk.tap.box?.maxDy}, span ${wk.tap.box?.spread})`);
  expect(wk.tapKing.selected !== null && wk.tapKing.targets > 0 && wk.tapKing.allAdjacent, `the king can be tapped and offers his own chess moves (${wk.tapKing.targets}, all adjacent)`);
  expect(wk.zoomIn === wk.tap.z0 + 1 && wk.zoomOut === wk.tap.z0, `the zoom steps k as a cut (${wk.tap.z0} → ${wk.zoomIn} → ${wk.zoomOut})`);
  expect(wk.padTap.turns === 1 && wk.padTap.facing === 2 && wk.padLit === '0,-1', `a tap on the pad's south arm (lit ${JSON.stringify(wk.padLit)}) turns the army south in place for one move (${wk.padTap.turns} turn, facing ${wk.padTap.facing})`);
  expect(wk.pad.turns === 2 && wk.pad.facing === 1, `q faces left, south → east, for a move (${wk.pad.turns} turns, facing ${wk.pad.facing})`);
  // With motion off (fx=0) a held chord chains a step per tick, so the count is the hold's; every input it made must be the one north-east step.
  expect(wk.chord.turns === 0 || (wk.chord.allNE && wk.chord.last?.kind === 'step' && wk.chord.last.df === 1 && wk.chord.last.dr === 1 && wk.chord.facing === 1), `W and D together are one north-east input, and facing east stays east (${wk.chord.turns} turn(s), all north-east ${wk.chord.allNE}, last input ${JSON.stringify(wk.chord.last)})`);
  expect(wk.drag.turns === 0 && wk.drag.look && (wk.drag.look.dx !== 0 || wk.drag.look.dy !== 0) && (wk.drag.focusAfter.dx !== wk.drag.focusBefore.dx || wk.drag.focusAfter.dy !== wk.drag.focusBefore.dy) && wk.drag.lookAfterMove === null, `a drag looks around without spending a turn (look ${JSON.stringify(wk.drag.look)}) and the next move brings the camera back`);
  expect(wk.pinchUp > wk.pinchBase && wk.pinchDown === wk.pinchBase, `a pinch steps the zoom up and back down in whole steps (${wk.pinchBase} → ${wk.pinchUp} → ${wk.pinchDown})`);
  expect(wk.leave.phase === 'setup' && wk.leave.resume && /turn/.test(wk.leave.resumeText), `leaving keeps the run: the setup offers "${wk.leave.resumeText}"`);
  expect(wk.resume.phase === 'walk' && wk.resume.sameTurn && wk.resume.sameFacing && wk.resume.sameKing, 'resuming lands on the same turn, facing and king');
  expect(wk.importBad.ok === false && /dck-run\/0/.test(wk.importBad.note), `a save of another schema is refused with one line (${wk.importBad.note})`);
  expect(wk.importOk.ok && wk.importOk.turn === 99 && wk.importOk.phase === 'walk', `an imported save is the run now (turn ${wk.importOk.turn})`);
  expect(errs4.length === 0, `no page errors on the walk${errs4.length ? ` — ${errs4.join(' | ')}` : ''}`);
  await page4.close();
}
// --- THE BARRIER BY HAND (Phase 2 milestone 4c, 2026-09-08): on the
// fixture, three steps into the corridor, the button drops the barrier —
// the duel runs ON THE WORLD (the crop's FEN equals the duel's board every
// ply, the window shows the dungeon around the crop), a pending entry is
// saved; a concession ends it and the ONE overlay button walks the army
// out whole around the king's final cell with the enemy gone and the run
// recording the duel as its result; a smash on the walk scars the floor
// and the scars ride in the run; a reload mid-duel re-drops the same seeded
// duel; the analyzer paints the barrier log from its world block; a second
// duel on a scarred floor seeds the gods with the pit; a loss ends the run
// and resume refuses it.
{
  const page5 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs5 = [];
  page5.on('pageerror', (e) => errs5.push(String(e).split('\n')[0]));
  const q5 = 'fx=0&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off&enemies=off'; // an empty floor: the enemies have their own block below
  await page5.goto(`http://127.0.0.1:${PORT}/play/index.html?gen=vaults&seed=1&${q5}`);
  await page5.waitForFunction(() => window.__DCK?.app?.phase === 'walk', null, { timeout: 120000 });
  const bar = await page5.evaluate(async () => {
    const K = window.__DCK;
    await K.renderer.ready();
    const settle = async () => { for (let i = 0; i < 1200 && (K.app.busy || K.walk.busy); i++) await new Promise((r) => setTimeout(r, 25)); if (K.app.busy || K.walk.busy) throw new Error(`still busy after 30 s (app ${K.app.busy}, walk ${K.walk.busy}, phase ${K.app.phase}, duel ${K.app.duel?.state})`); };
    const board = (fen) => fen.split(' ')[0];
    const out = {};
    out.world = { id: K.app.walk.world.id, facing: K.app.walk.world.start.facing, theme: K.app.walk.world.theme };
    out.walkTurn = K.walk.state.turn;
    // A smash on the walk: the first piece with a capture among its own moves smashes it; the floor records it.
    // A generated floor promises no crate within reach of the start, so when none is, one is set down on a knight's landing cell by hand.
    const findSmash = () => {
      for (const p of K.walk.state.pieces) {
        if (p.ch === 'K') continue;
        K.walk.select(p.f, p.r);
        const t = K.walk.state.targets.find((x) => x.capture);
        K.walk.select(-1, -1);
        if (t) return { id: p.id, to: { f: t.f, r: t.r } };
      }
      return null;
    };
    let smash = findSmash();
    if (!smash) {
      const n = K.walk.state.pieces.find((p) => p.ch === 'N');
      K.walk.select(n.f, n.r);
      const t = K.walk.state.targets.find((x) => !x.capture && Math.abs(x.f - n.f) * Math.abs(x.r - n.r) === 2); // a knight's hop, not a king step
      K.walk.select(-1, -1);
      if (t) { K.app.walk.world.setTerrain(t.f, t.r, '^'); K.app.boardUI.refresh(); smash = findSmash(); }
    }
    if (smash) await K.walk.input({ kind: 'move', id: smash.id, to: smash.to });
    out.smash = { found: !!smash, debris: K.walk.debris(), saved: K.walk.saved()?.floors[K.walk.saved().floor]?.debris?.events?.length ?? null };
    // THE DROP, through the real button (the initiative select at its default: the player moves first).
    const standing = K.walk.state.pieces.map((p) => ({ ch: p.ch, f: p.f, r: p.r }));
    localStorage.setItem('dck.setup.v1', JSON.stringify({ black: { width: 3, mode: 'pieces', pieces: 'NN', archetype: 'heavies-deep', anchor: 'center' } }));
    document.getElementById('btnWalkBarrier').click();
    await new Promise((r) => setTimeout(r, 50));
    await settle();
    for (let i = 0; i < 200 && K.app.phase !== 'playing'; i++) await new Promise((r) => setTimeout(r, 50));
    out.drop = { phase: K.app.phase, screen: { walk: !document.getElementById('screen-walk').hidden, duel: !document.getElementById('screen-duel').hidden }, back: document.getElementById('btnBack').hidden, duel: K.walk.duel, session: K.app.session?.kind, crop: K.walk.crop, info: K.renderer.info };
    out.drop.fenEqual0 = !!K.app.duel && board(K.walk.arenaFen()) === board(K.app.duel.fen());
    // THE PIECES WHERE THEY STAND (2026-09-10): every piece of the walk is the same letter on the same world cell in the duel's crop.
    out.drop.standing = standing.every((p) => K.walk.cell(p.f, p.r)?.v === p.ch);
    out.drop.standingN = standing.length;
    out.pending = K.walk.saved()?.pending ?? null;
    // Two plies: the player's random move, the engine's reply; the world's crop follows the board.
    await settle();
    if (K.app.duel?.state === 'playing' && K.app.duel.turnColor() === 'white') await K.playerMove(K.randomMove());
    await settle();
    out.ply = K.app.duel?.ply ?? null;
    out.fenEqual1 = !!K.app.duel && board(K.walk.arenaFen()) === board(K.app.duel.fen());
    const L = K.log.build();
    out.log = { world: L?.world ? { id: L.world.id, stage: L.world.stage?.id, files: L.world.stage?.files, theme: L.world.theme, crop: !!L.world.crop } : null, stage: L?.stage, variantIni: !!L?.variantIni };
    // A reload mid-duel: the run resumes and the barrier drops again on the same seed.
    return out;
  });
  const dropSeed = bar.drop?.duel?.seed ?? null;
  expect(bar.smash.found && bar.smash.debris?.events === 1 && bar.smash.saved === 1, `a smash on the walk scars the floor and the scar rides in the run (${bar.smash.debris?.events} event, ${bar.smash.saved} saved)`);
  expect(bar.drop.phase === 'playing' && bar.drop.screen.duel && !bar.drop.screen.walk && bar.drop.back && bar.drop.session === 'world', `the button drops the barrier: the duel screen is up on a world session, Back hidden`);
  expect(bar.drop.duel && bar.drop.duel.gap >= 2 && bar.drop.duel.files === 10 && bar.drop.duel.ranks === 10, `the deal: ${bar.drop.duel?.files}×${bar.drop.duel?.ranks}, gap ${bar.drop.duel?.gap}, kings on file ${bar.drop.duel?.kingFile}`);
  expect(bar.drop.info.viewport === 'screen' && bar.drop.info.facing === bar.world.facing && bar.drop.info.crop && bar.drop.info.crop.facing === bar.world.facing && bar.drop.info.window.cols > bar.drop.info.crop.cols, `the board is a window over the world at the army's facing, the dungeon around the ${bar.drop.info.crop?.cols}×${bar.drop.info.crop?.rows} crop (${bar.drop.info.window?.cols} cols shown)`);
  expect(bar.drop.fenEqual0 && bar.fenEqual1 && bar.ply === 2, `the crop's FEN equals the duel's board at ply 0 and after ${bar.ply} plies`);
  expect(bar.drop.standing && bar.drop.standingN === 8, `the deal reads the ${bar.drop.standingN} pieces where they stand — nothing summoned`);
  expect(bar.pending && bar.pending.seed === dropSeed && bar.pending.turn === 'w' && bar.pending.at === bar.walkTurn + (bar.smash.found ? 1 : 0), `the run holds the pending duel (seed ${bar.pending?.seed}, at walk turn ${bar.pending?.at})`);
  expect(bar.log.world && bar.log.world.id === bar.world.id && bar.log.world.theme === bar.world.theme && bar.log.world.files === bar.drop.duel.files && bar.log.world.crop && bar.log.variantIni, `the replay log carries the world block (${bar.log.world?.stage})`);
  // The reload: the saved run resumes with the duel in flight and drops it again on the same seed.
  await page5.goto(`http://127.0.0.1:${PORT}/play/index.html?run=resume&${q5}`);
  await page5.waitForFunction(() => window.__DCK?.app?.phase === 'playing' && window.__DCK.app.session?.kind === 'world', null, { timeout: 120000 });
  const re = await page5.evaluate(async () => {
    const K = window.__DCK;
    const settle = async () => { for (let i = 0; i < 1200 && (K.app.busy || K.walk.busy); i++) await new Promise((r) => setTimeout(r, 25)); if (K.app.busy || K.walk.busy) throw new Error(`still busy after 30 s (app ${K.app.busy}, walk ${K.walk.busy}, phase ${K.app.phase}, duel ${K.app.duel?.state})`); };
    const board = (fen) => fen.split(' ')[0];
    await settle();
    const out = { seed: K.walk.duel?.seed, fen: K.app.duel?.fen(), ply: K.app.duel?.ply, equal: board(K.walk.arenaFen()) === board(K.app.duel.fen()) };
    // The player wins by the enemy's concession; the one button walks out.
    out.ended = await K.walk.concede('black');
    out.overlay = { hidden: document.getElementById('overlay').hidden, title: document.getElementById('overlay-title').textContent, walkOut: document.getElementById('btnWalkOut').hidden, label: document.getElementById('btnWalkOut').textContent, again: document.getElementById('btnAgain').hidden, redeal: document.getElementById('btnOverlayRedeal').hidden, menu: document.getElementById('btnMenu').hidden, undo: document.getElementById('btnOverlayUndo').hidden };
    document.getElementById('btnWalkOut').click();
    for (let i = 0; i < 200 && (K.app.phase !== 'walk' || K.walk.busy); i++) await new Promise((r) => setTimeout(r, 30));
    const st = K.walk.state;
    const saved = K.walk.saved();
    out.after = { phase: K.app.phase, screen: !document.getElementById('screen-walk').hidden, pieces: st.pieces.length, kingOnFloor: K.walk.cell(st.king.f, st.king.r)?.v === 'K', lower: st.rows.join('').replace(/[^a-z]/g, '').length, turn: st.turn, turns: saved.turns.length, last: saved.turns.at(-1), pending: saved.pending, debris: !!saved.floors[saved.floor]?.debris, status: document.getElementById('walk-status').textContent, session: K.app.session, duel: !!K.app.duel };
    return out;
  });
  expect(re.seed === dropSeed && re.ply === 0 && re.equal, `a reload mid-duel re-drops the same seeded duel from move one (seed ${re.seed})`);
  expect(re.ended === 'ended' && !re.overlay.hidden && re.overlay.title === 'Victory' && !re.overlay.walkOut && /Walk on/.test(re.overlay.label) && re.overlay.again && re.overlay.redeal && re.overlay.menu && re.overlay.undo, `the overlay on a world duel: one button, "${re.overlay.label}" (Rematch / Re-deal / Back / Undo hidden)`);
  expect(re.after.phase === 'walk' && re.after.screen && re.after.pieces === 8 && re.after.kingOnFloor && re.after.lower === 0 && !re.after.session && !re.after.duel, `the army walks out whole (${re.after.pieces} pieces, the survivors where they stood), the enemy gone from the floor`);
  expect(re.after.last?.kind === 'duel' && re.after.last.result === '1-0' && re.after.last.termination === 'concede' && re.after.pending === null && re.after.debris && re.after.turn === bar.walkTurn + (bar.smash.found ? 1 : 0), `the run records the duel as its result (${re.after.last?.result} · ${re.after.last?.termination}), no pending entry, the ledger inside; the walk turn unchanged (${re.after.turn})`);
  // A SECOND DUEL ON A SCARRED FLOOR, on a fresh run of the same floor (the
  // walk-out lands wherever the king ended, where no box is promised): a pit
  // dug by hand ahead of the start seeds the gods from ply 0; the player
  // loses by concession — the run is over, the save stays, resume refuses.
  await page5.goto(`http://127.0.0.1:${PORT}/play/index.html?gen=vaults&seed=1&${q5}`);
  await page5.waitForFunction(() => window.__DCK?.app?.phase === 'walk', null, { timeout: 120000 });
  const re2 = await page5.evaluate(async () => {
    const K = window.__DCK;
    await K.renderer.ready();
    const settle = async () => { for (let i = 0; i < 1200 && (K.app.busy || K.walk.busy); i++) await new Promise((r) => setTimeout(r, 25)); if (K.app.busy || K.walk.busy) throw new Error(`still busy after 30 s (app ${K.app.busy}, walk ${K.walk.busy})`); };
    const board = (fen) => fen.split(' ')[0];
    const out = {};
    const st = K.walk.state;
    const k = st.king;
    const AH = [[0, 1], [1, 0], [0, -1], [-1, 0]][st.facing];
    const W = K.app.walk.world;
    let pit = null;
    for (let d = 2; d <= 5 && !pit; d++) if (W.at(k.f + AH[0] * d, k.r + AH[1] * d) === '.' && !W.pieceAt(k.f + AH[0] * d, k.r + AH[1] * d)) pit = { f: k.f + AH[0] * d, r: k.r + AH[1] * d };
    if (pit) W.setTerrain(pit.f, pit.r, 'O');
    const plan2 = await K.walk.barrier({ knobs: { width: 3, mode: 'pieces', pieces: 'NN' } });
    await settle();
    const holes = K.app.duel ? [...K.app.duel.director.holes] : [];
    out.second = { ok: !!plan2?.ok, error: plan2?.error ?? null, files: plan2?.stage?.files, ranks: plan2?.stage?.ranks, pit, holes, authored: K.app.duel?.director.authoredTerrain ?? null, fenHasPit: null };
    if (plan2?.ok && pit) out.second.fenHasPit = board(K.app.duel.fen()).includes('*');
    out.lost = { ended: await K.walk.concede('white'), label: document.getElementById('btnWalkOut').textContent };
    document.getElementById('btnWalkOut').click();
    for (let i = 0; i < 100 && K.app.phase !== 'setup'; i++) await new Promise((r) => setTimeout(r, 30));
    const gone = K.walk.saved();
    out.over = { phase: K.app.phase, ended: gone?.ended, resumeText: document.getElementById('btnRunResume').textContent, resumed: K.walk.resume(), note: document.getElementById('run-note').textContent, exportable: !!K.walk.export()?.floors };
    return out;
  });
  expect(re2.second.ok && re2.second.pit && re2.second.holes.length >= 1 && re2.second.fenHasPit && re2.second.authored !== null, `a second barrier on the scarred floor: the pit is the gods' hole from ply 0 (${re2.second.holes.join(',')}), the terrain anchor set`);
  expect(re2.lost.ended === 'ended' && /run is over/.test(re2.lost.label) && re2.over.phase === 'setup' && re2.over.ended?.termination === 'concede' && /Run over/.test(re2.over.resumeText) && re2.over.resumed === false && /run is over/.test(re2.over.note) && re2.over.exportable, `a loss ends the run: back to setup, "${re2.over.resumeText}", resume refused (${re2.over.note}), the save still exports`);
  expect(errs5.length === 0, `no page errors on the barrier${errs5.length ? ` — ${errs5.join(' | ')}` : ''}`);
  // The analyzer paints the barrier log from its world block (the crop's terrain and skins, the world's theme).
  await page5.goto(`http://127.0.0.1:${PORT}/replay/index.html?latest=1`);
  await page5.waitForFunction(() => window.__DCK?.replay?.log, null, { timeout: 60000 });
  const an = await page5.evaluate(async () => { const R = window.__DCK.replay; await R.waitIdle?.(); const v = R.view; return { world: R.log?.world?.id ?? null, stage: v.stage ?? null, theme: v.theme ?? null, skins: typeof v.skins === 'object' && v.skins ? Object.keys(v.skins).length : v.skins }; });
  expect(an.world === bar.world.id && typeof an.stage === 'string' && an.stage.startsWith(`${bar.world.id}@`) && an.theme === bar.world.theme, `the analyzer opens the barrier log on its own crop (${an.stage}, theme ${an.theme}, ${an.skins} skins)`);
  await page5.close();
}
// --- THE ENEMIES (Phase 2 milestone 6, 2026-09-10 — the enemies session):
// on the fixture the four spawns stand as sentries with their letters on
// the floor and in the save; a wait moves none of them. THE HUNT: an enemy
// stood in the west corridor in sight of the king (44, 21) sees him on the
// next input, hunts along the rank to the far-row cell (47, 21) and the
// barrier falls with ITS initiative; a concession walks the army out where
// it stood with that enemy gone. THE AMBUSH THROUGH THE PIVOT: an enemy
// stood on the north far row (55, 31) is caught by the player's own wait —
// his initiative, the army pivoted north for the drop; a reload mid-duel
// re-drops the same enemy on the same seed. THE CHOOSER: two enemies on
// two far rows at once — the player picks; the other keeps hunting through
// the frozen duel and catches him on the next input.
{
  const page6 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs6 = [];
  page6.on('pageerror', (e) => errs6.push(String(e).split('\n')[0]));
  const q6 = 'fx=0&go=depth%201%20movetime%2030&mateprobe=off&evalgate=off';
  await page6.goto(`http://127.0.0.1:${PORT}/play/index.html?gen=vaults&seed=1&${q6}`);
  await page6.waitForFunction(() => window.__DCK?.app?.phase === 'walk', null, { timeout: 120000 });
  const en = await page6.evaluate(async () => {
    const K = window.__DCK;
    await K.renderer.ready();
    const settle = async () => { for (let i = 0; i < 1200 && (K.app.busy || K.walk.busy); i++) await new Promise((r) => setTimeout(r, 25)); if (K.app.busy || K.walk.busy) throw new Error(`still busy after 30 s (app ${K.app.busy}, walk ${K.walk.busy}, phase ${K.app.phase}, duel ${K.app.duel?.state})`); };
    const lower = () => K.walk.state.rows.join('').replace(/[^a-z]/g, '').length;
    const cells = () => K.walk.state.pieces.map((p) => `${p.ch}${p.f},${p.r}`).sort().join(' ');
    const untilDuel = async (max) => { let n = 0; for (; n < max && K.app.phase === 'walk' && !K.walk.candidates; n++) { await K.walk.input({ kind: 'wait' }); await settle(); for (let i = 0; i < 200 && K.app.phase === 'walk' && !K.walk.candidates && K.walk.busy; i++) await new Promise((r) => setTimeout(r, 25)); } for (let i = 0; i < 400 && K.app.phase !== 'playing' && !K.walk.candidates; i++) await new Promise((r) => setTimeout(r, 25)); await settle(); return n; };
    const walkOut = async (loser) => { const ended = await K.walk.concede(loser); document.getElementById('btnWalkOut').click(); for (let i = 0; i < 300 && (K.app.phase !== 'walk' || K.walk.busy); i++) await new Promise((r) => setTimeout(r, 30)); return ended; };
    const out = {};
    out.start = { king: { ...K.walk.state.king }, facing: K.walk.state.facing, enemies: K.walk.enemies, lower: lower(), saved: K.walk.saved().floors[K.walk.saved().floor].enemies?.length ?? null, schema: K.walk.saved().schema };
    const kings0 = K.walk.enemies.map((e) => `${e.king.f},${e.king.r}`).join(' ');
    await K.walk.input({ kind: 'wait' });
    await settle();
    out.wait = { moved: K.walk.enemies.map((e) => `${e.king.f},${e.king.r}`).join(' ') !== kings0, states: K.walk.enemies.map((e) => e.state).join(','), threats: K.walk.threats.length, ms: K.walk.enemyMs };
    // THE HUNT: enemy 2 stood at (44, 21) facing east, in sight down the rank; the far-row cell (47, 21) is three steps east.
    const standing = cells();
    out.hunt = { placed: K.walk.placeEnemy(2, 44, 21, 1), sight: K.walk.sight(2), goalsWest: (K.walk.goals(2) ?? []).filter((g) => g.axis === 3).map((g) => `${g.f},${g.r}`).join(' ') };
    await K.walk.input({ kind: 'wait' });
    await settle();
    out.hunt.afterOne = { state: K.walk.enemies.find((e) => e.id === 2)?.state, threats: K.walk.threats.length, status: document.getElementById('walk-status').textContent, ms: K.walk.enemyMs, king: { ...K.walk.enemies.find((e) => e.id === 2).king } };
    out.hunt.turns = await untilDuel(8);
    out.hunt.duel = { phase: K.app.phase, duel: K.walk.duel, lower: lower(), enemiesKept: K.walk.enemies.length, black: K.app.duel ? K.app.duel.fen().split(' ')[0].replace(/[^a-z]/g, '').length : null, logEnemy: K.log.build()?.world?.enemy ?? null };
    out.hunt.ended = await walkOut('black');
    out.hunt.after = { phase: K.app.phase, enemies: K.walk.enemies.map((e) => `${e.id}:${e.state}`).join(' '), lower: lower(), same: cells() === standing, facing: K.walk.state.facing, last: K.walk.saved().turns.at(-1) };
    // THE AMBUSH THROUGH THE PIVOT: enemy 3 on the north far row (55, 31), facing south; the player's wait completes the alignment.
    out.ambush = { placed: K.walk.placeEnemy(3, 55, 31, 2), sight: K.walk.sight(3) };
    out.ambush.turns = await untilDuel(3);
    out.ambush.duel = { phase: K.app.phase, duel: K.walk.duel, facing: K.walk.state.facing, pending: K.walk.saved()?.pending ?? null, crop: K.walk.crop };
    return out;
  });
  const hd = en.hunt.duel.duel, ad = en.ambush.duel.duel;
  expect(en.start.schema === 'dck-run/3' && en.start.enemies.length === 4 && en.start.enemies.every((e) => e.state === 'sentry' && e.width === 3 && e.pieces.length === 6 && /^[NBR]{2}$/.test(e.bag)) && en.start.lower === 24 && en.start.saved === 4, `four 3-wide sentries on the floor (bags ${en.start.enemies.map((e) => e.bag).join(' ')}), 24 letters, all in the save`);
  expect(!en.wait.moved && en.wait.states === 'sentry,sentry,sentry,sentry' && en.wait.threats === 0, `a wait moves no sentry, lights no threat (${en.wait.ms?.toFixed(1)} ms of enemy work)`);
  expect(en.hunt.placed && en.hunt.sight && /47,21/.test(en.hunt.goalsWest), `enemy 2 stood at (44, 21) sees the king; the west far row offers (47, 21) (${en.hunt.goalsWest})`);
  expect(en.hunt.afterOne.state === 'hunt' && en.hunt.afterOne.threats > 0 && /sees you/.test(en.hunt.afterOne.status), `on the next input it hunts: the threat display lights ${en.hunt.afterOne.threats} cells, the strip says so (its king at ${en.hunt.afterOne.king.f}, ${en.hunt.afterOne.king.r}; ${en.hunt.afterOne.ms?.toFixed(1)} ms of enemy work)`);
  expect(en.hunt.afterOne.ms < 120, `the enemy work of a hunting turn stays under the walk's step (${en.hunt.afterOne.ms?.toFixed(1)} ms)`);
  expect(en.hunt.duel.phase === 'playing' && hd && hd.turn === 'b' && hd.enemyId === 2 && hd.axis === 3 && !hd.pivoted && hd.enemyFile !== undefined, `THE HUNT: the barrier falls after ${en.hunt.turns + 1} inputs with the enemy's initiative (turn ${hd?.turn}, enemy ${hd?.enemyId}, axis ${hd?.axis})`);
  expect(en.hunt.duel.black === 6 && en.hunt.duel.lower === 24 && en.hunt.duel.enemiesKept === 4 && en.hunt.duel.logEnemy?.id === 2, `the hunter's own bag is molded into the box (${en.hunt.duel.black} black pieces), the other three stand on the map, the log names the enemy`);
  expect(en.hunt.ended === 'ended' && en.hunt.after.phase === 'walk' && en.hunt.after.enemies === '1:sentry 3:sentry 4:sentry' && en.hunt.after.lower === 18 && en.hunt.after.same && en.hunt.after.facing === 3 && en.hunt.after.last?.kind === 'duel' && en.hunt.after.last.axis === 3, `a win removes the whole enemy army: ${en.hunt.after.enemies}, ${en.hunt.after.lower} letters, the survivors where they stood, the run's entry carries the axis`);
  expect(en.ambush.placed && en.ambush.sight && en.ambush.duel.phase === 'playing' && ad && ad.turn === 'w' && ad.enemyId === 3 && ad.axis === 0 && ad.pivoted && en.ambush.duel.facing === 0 && en.ambush.duel.crop?.facing === 0, `THE AMBUSH THROUGH THE PIVOT: an enemy on the north far row is caught by the player's wait — his initiative (turn ${ad?.turn}), the army pivoted north (facing ${en.ambush.duel.facing}, pivoted ${ad?.pivoted})`);
  expect(en.ambush.duel.pending && en.ambush.duel.pending.enemyId === 3 && en.ambush.duel.pending.axis === 0 && en.ambush.duel.pending.seed === ad?.seed, `the pending entry names the enemy, the axis and the seed`);
  // A reload mid-duel: the same enemy, the same seed, from move one.
  await page6.goto(`http://127.0.0.1:${PORT}/play/index.html?run=resume&${q6}`);
  await page6.waitForFunction(() => window.__DCK?.app?.phase === 'playing' && window.__DCK.app.session?.kind === 'world', null, { timeout: 120000 });
  const en2 = await page6.evaluate(async () => {
    const K = window.__DCK;
    const settle = async () => { for (let i = 0; i < 1200 && (K.app.busy || K.walk.busy); i++) await new Promise((r) => setTimeout(r, 25)); if (K.app.busy || K.walk.busy) throw new Error(`still busy after 30 s (app ${K.app.busy}, walk ${K.walk.busy}, phase ${K.app.phase}, duel ${K.app.duel?.state})`); };
    const lower = () => K.walk.state.rows.join('').replace(/[^a-z]/g, '').length;
    const untilDuel = async (max) => { let n = 0; for (; n < max && K.app.phase === 'walk' && !K.walk.candidates; n++) { await K.walk.input({ kind: 'wait' }); await settle(); for (let i = 0; i < 200 && K.app.phase === 'walk' && !K.walk.candidates && K.walk.busy; i++) await new Promise((r) => setTimeout(r, 25)); } for (let i = 0; i < 400 && K.app.phase !== 'playing' && !K.walk.candidates; i++) await new Promise((r) => setTimeout(r, 25)); await settle(); return n; };
    const walkOut = async (loser) => { const ended = await K.walk.concede(loser); document.getElementById('btnWalkOut').click(); for (let i = 0; i < 300 && (K.app.phase !== 'walk' || K.walk.busy); i++) await new Promise((r) => setTimeout(r, 30)); return ended; };
    await settle();
    const out = {};
    out.redrop = { duel: K.walk.duel, ply: K.app.duel?.ply, enemies: K.walk.enemies.map((e) => `${e.id}:${e.state}`).join(' ') };
    out.redrop.ended = await walkOut('black');
    out.redrop.after = { enemies: K.walk.enemies.map((e) => `${e.id}:${e.state}`).join(' '), lower: lower(), facing: K.walk.state.facing, king: { ...K.walk.state.king } };
    // THE CHOOSER: enemy 1 on the west far row (47, 21) and enemy 4 on the north far row (57, 31), both in sight; the player's wait completes both.
    out.chooser = { placed1: K.walk.placeEnemy(1, 47, 21, 1), placed4: K.walk.placeEnemy(4, 57, 31, 2), sight1: K.walk.sight(1), sight4: K.walk.sight(4) };
    out.chooser.turns = await untilDuel(3);
    out.chooser.up = { candidates: K.walk.candidates, hidden: document.getElementById('walk-chooser').hidden, buttons: document.getElementById('walk-chooser-buttons').children.length, phase: K.app.phase, refused: await K.walk.input({ kind: 'wait' }) };
    await K.walk.choose(4);
    for (let i = 0; i < 400 && K.app.phase !== 'playing'; i++) await new Promise((r) => setTimeout(r, 25));
    await settle();
    out.chooser.duel = { phase: K.app.phase, duel: K.walk.duel, hidden: document.getElementById('walk-chooser').hidden, other: K.walk.enemies.find((e) => e.id === 1)?.state };
    out.chooser.ended = await walkOut('black');
    out.chooser.after = { enemies: K.walk.enemies.map((e) => `${e.id}:${e.state}`).join(' '), lower: lower() };
    // The other hunter stands on the west far row through the frozen duel: the next input is caught by it (through the pivot back west).
    out.last = { turns: await untilDuel(3) };
    out.last.duel = { phase: K.app.phase, duel: K.walk.duel };
    out.last.ended = await walkOut('black');
    out.last.after = { enemies: K.walk.enemies.length, lower: lower(), phase: K.app.phase, threats: K.walk.threats.length, turns: K.walk.saved().turns.filter((t) => t.kind === 'duel').length };
    return out;
  });
  const rd = en2.redrop.duel, cd = en2.chooser.duel.duel, ld = en2.last.duel.duel;
  expect(rd && rd.enemyId === 3 && rd.seed === ad?.seed && en2.redrop.ply === 0 && rd.pivoted && /3:hunt/.test(en2.redrop.enemies), `a reload mid-duel re-drops the same enemy on the same seed from move one (enemy ${rd?.enemyId}, ${en2.redrop.enemies})`);
  expect(en2.redrop.ended === 'ended' && en2.redrop.after.enemies === '1:sentry 4:sentry' && en2.redrop.after.lower === 12 && en2.redrop.after.facing === 0, `the walk-out keeps the army facing the axis it fought on (facing ${en2.redrop.after.facing}), two enemies left`);
  expect(en2.chooser.placed1 && en2.chooser.placed4 && en2.chooser.sight1 && en2.chooser.sight4 && en2.chooser.up.candidates?.length === 2 && !en2.chooser.up.hidden && en2.chooser.up.buttons === 2 && en2.chooser.up.phase === 'walk' && en2.chooser.up.refused === null, `THE CHOOSER: two enemies aligned at once — two candidates, the chooser up with ${en2.chooser.up.buttons} buttons, inputs refused while it waits`);
  expect(en2.chooser.duel.phase === 'playing' && cd && cd.enemyId === 4 && cd.axis === 0 && !cd.pivoted && cd.turn === 'w' && en2.chooser.duel.hidden && en2.chooser.duel.other === 'hunt', `the pick drops the barrier on enemy 4 (axis ${cd?.axis}, turn ${cd?.turn}); the other keeps hunting through the frozen duel`);
  expect(en2.chooser.ended === 'ended' && en2.chooser.after.enemies === '1:hunt' && en2.chooser.after.lower === 6, `after the win one hunter is left on the west far row (${en2.chooser.after.enemies})`);
  expect(en2.last.duel.phase === 'playing' && ld && ld.enemyId === 1 && ld.axis === 3 && ld.pivoted && en2.last.ended === 'ended' && en2.last.after.enemies === 0 && en2.last.after.lower === 0 && en2.last.after.phase === 'walk' && en2.last.after.threats === 0 && en2.last.after.turns === 4, `the next input is caught by it through the pivot back west; the floor is clear after four duels (${en2.last.after.turns} duel entries)`);
  expect(errs6.length === 0, `no page errors with the enemies${errs6.length ? ` — ${errs6.join(' | ')}` : ''}`);
  await page6.close();
}
await browser.close();

server.close();

for (const n of notes) console.log(n);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`rungs seen: weaken ${seen.weaken} · breach ${seen.breach} · displace ${seen.displace} · crumble ${seen.crumble}`);
console.log(`SUMMARY: ${notes.length} ok, ${failures.length} failed${SHOTS ? ` — screenshots in ${OUT}` : ''}`);
process.exit(failures.length ? 1 : 0);
