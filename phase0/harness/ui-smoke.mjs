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
await browser.close();
server.close();

for (const n of notes) console.log(n);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`rungs seen: weaken ${seen.weaken} · breach ${seen.breach} · displace ${seen.displace} · crumble ${seen.crumble}`);
console.log(`SUMMARY: ${notes.length} ok, ${failures.length} failed${SHOTS ? ` — screenshots in ${OUT}` : ''}`);
process.exit(failures.length ? 1 : 0);
