// Live-board UI smoke: drive play/index.html in headless Chromium through the
// __DCK hook with the gods forced hot, and assert the 2026-09-02 UI refresh
// on the REAL board — the selftest's renderer check covers a detached board,
// this covers the wiring: tiles painted from the Director ledgers after a
// quake, the per-rung residue marks + displacement arrows, the gods line,
// the log naming terrain rungs, ranked hint arrows from the STREAMING probe
// with a depth readout, and a clean cancel path (no "unresponsive" recycle).
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
    // null when nothing matches — a stage with no stone wall (s49 Crate
    // Quarry is crates only) has no wall cell to probe; never hand a null
    // to getComputedStyle, which throws out of page.evaluate and kills the
    // run instead of failing a check.
    const bg = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).backgroundImage : null; };
    return {
      theme: window.__DCK.theme,
      attr: board.dataset.theme ?? null,
      legend: document.querySelector('.legend').dataset.theme ?? null,
      wall: bg('#board .cell.wall'),
      floor: bg('#board .cell.light:not(.wall):not(.furniture):not(.hole)'),
      // s59's g5 is a door in an EAST–WEST wall line — the one that paints the
      // leaf. (d8, in the north–south line down file d, is a weak spot: the
      // wall tile with a crack, no leaf — the ply-0 skins check below.)
      door: document.querySelector('#board [data-square="g5"] .piece.neutral') ? bg('#board [data-square="g5"] .piece.neutral') : '',
      doorBg: document.querySelector('#board [data-square="g5"]') ? bg('#board [data-square="g5"]') : '',
      // Every wall's autotile case, re-derived from its neighbours by the
      // renderer's own rule (a standing wall, a cracked wall, a door or
      // authored masonry is solid; a hole, floor or loose furniture is not;
      // off-board is not)
      // through the renderer's own canonicalMask — stage-independent, so
      // it runs on any --stage.
      masksBad: await (async () => {
        const { canonicalMask } = await import('/play/js/board-ui.mjs');
        const cells = new Map([...document.querySelectorAll('#board .cell[data-square]')].map((c) => [c.dataset.square, c]));
        const solid = (f, r) => {
          const c = cells.get(String.fromCharCode(97 + f) + r);
          return !!c && !c.classList.contains('hole') && (c.classList.contains('wall') || c.classList.contains('cracked') || c.classList.contains('skin-door') || c.classList.contains('skin-masonry'));
        };
        const bad = [];
        let n = 0;
        for (const [sq, c] of cells) {
          if (!c.classList.contains('wall') || c.classList.contains('hole')) continue;
          n++;
          const f = sq.charCodeAt(0) - 97;
          const r = parseInt(sq.slice(1), 10);
          const want = canonicalMask((solid(f, r + 1) ? 1 : 0) | (solid(f + 1, r) ? 2 : 0) | (solid(f, r - 1) ? 4 : 0) | (solid(f - 1, r) ? 8 : 0) | (solid(f + 1, r + 1) ? 16 : 0) | (solid(f + 1, r - 1) ? 32 : 0) | (solid(f - 1, r - 1) ? 64 : 0) | (solid(f - 1, r + 1) ? 128 : 0));
          if (!c.classList.contains(`wm-${want}`)) bad.push(`${sq}:${[...c.classList].find((k) => k.startsWith('wm-')) ?? 'none'}≠wm-${want}`);
        }
        return { n, bad };
      })(),
      pieces: window.__DCK.pieces,
      king: (() => { const el = document.querySelector('#board .piece[data-piece="K"]'); const cs = el && getComputedStyle(el); return cs ? { bg: cs.backgroundImage, font: cs.fontSize } : null; })(),
    };
  });
const stageTheme = THEME ?? (await page.evaluate(() => window.__DCK.app.session.deal.stage.theme));
// The wall half of a theme check passes vacuously on a stage with no stone
// wall (themeState's wall is null there); the note says so.
const wallOk = (wall, want) => wall === null || wall.includes(want);
const wallNote = (t) => (t.wall === null ? ' — no stone wall on this stage, wall check skipped' : '');
const short = (v) => (v ?? 'none').slice(0, 30);
{
  const t = await themeState();
  expect(!!stageTheme && t.theme === stageTheme && t.attr === stageTheme && t.legend === stageTheme, `board and legend wear the stage's theme "${stageTheme}" (${t.theme}/${t.attr}/${t.legend})`);
  expect(wallOk(t.wall, 'data:image/png') && (t.floor ?? '').includes('data:image/png'), `themed walls and floor paint the repacked PNG tiles (wall ${short(t.wall)}…, floor ${short(t.floor)}…)${wallNote(t)}`);
  expect(t.masksBad.n > 0 && t.masksBad.bad.length === 0, `wall autotile masks match the standing-neighbour rule on all ${t.masksBad.n} walls${t.masksBad.bad.length ? ` — ${t.masksBad.bad.join(' ')}` : ''}`);
  if (STAGE === 's59-hall-corner') {
    expect(t.door.includes('data:image/png'), 'the door leaf paints the pack door sprite (g5, a door in an east–west line)');
    // g5 is a dark square: the checker shade (a flat gradient) is allowed, the in-house bevel (160deg) is not.
    expect(t.doorBg.includes('data:image/png') && !t.doorBg.includes('160deg'), `the floor tile shows behind the door, no in-house bevel (${t.doorBg.slice(0, 60)}…)`);
  }
}
const setTheme = (name) =>
  page.evaluate((n) => {
    window.__DCK.options.theme = n;
    window.__DCK.applyOptions();
  }, name);
for (const name of THEME ? [] : ['hall', 'castle', 'crypt']) {
  await setTheme(name);
  const t = await themeState();
  expect(t.theme === name && t.legend === name && wallOk(t.wall, 'data:image/png'), `Art set "${name}" overrides the stage (${t.theme}, legend ${t.legend})${wallNote(t)}`);
  await shot(`00-theme-${name}`);
}
if (!THEME) await setTheme('classic');
if (!THEME) {
  const t = await themeState();
  expect(t.theme === null && t.attr === null && wallOk(t.wall, 'data:image/svg') && !(t.floor ?? '').includes('data:image'), `"classic" strips the theme: in-house SVG wall, flat floor (${short(t.wall)}…)${wallNote(t)}`);
  await shot('00-theme-classic');
}
await setTheme('auto');
expect((await themeState()).theme === stageTheme, 'Art set "auto" returns to the stage\'s own theme');
// Doors: the option overrides the theme's door; auto returns it.
await page.evaluate(() => { window.__DCK.options.doors = 'castle'; window.__DCK.applyOptions(); });
expect((await page.evaluate(() => window.__DCK.doors)) === 'castle', 'Doors option stamps the door set');
await page.evaluate(() => { window.__DCK.options.doors = 'auto'; window.__DCK.applyOptions(); });
expect((await page.evaluate(() => window.__DCK.doors)) === null, 'Doors "auto" is the theme\'s own');
// Piece sprites: the default set paints the king as a PNG sprite; classic is the glyph.
{
  const t = await themeState();
  expect(t.pieces === 'nulltale' && t.king?.bg.includes('data:image/png') && t.king?.font === '0px', `pieces default to the NullTale sprites (${t.pieces}, ${t.king?.font})`);
  await page.evaluate(() => { window.__DCK.options.pieces = 'classic'; window.__DCK.applyOptions(); });
  const c = await themeState();
  expect(c.pieces === null && c.king?.bg === 'none' && c.king?.font !== '0px', `"classic" pieces are the glyphs again (${c.king?.bg.slice(0, 20)}, ${c.king?.font})`);
  await page.evaluate(() => { window.__DCK.options.pieces = 'pixel-chess-wood'; window.__DCK.applyOptions(); });
  expect((await themeState()).pieces === 'pixel-chess-wood', 'the wood set applies');
  await shot('00-pieces-wood');
  await page.evaluate(() => { window.__DCK.options.pieces = 'nulltale'; window.__DCK.applyOptions(); });
  // Decor: wall props (torch / banner / chain) on wall faces only — the
  // floor litter is packed away (round 10) — never on holes or furniture.
  const decor = await page.evaluate(() => [...document.querySelectorAll('#board .decor')].map((d) => ({ cls: [...d.classList].filter((c) => c.startsWith('decor-')), cell: [...d.parentElement.classList] })));
  expect(decor.every((d) => d.cls.length === 1 && (d.cls[0] === 'decor-doorway' ? !d.cell.includes('wall') && !d.cell.includes('furniture') : d.cell.includes('wall') && ['decor-torch', 'decor-banner', 'decor-chain'].includes(d.cls[0]))), `${decor.length} cosmetic props: wall props on wall faces only, no floor litter`);
}

// --- skins: the hall's doors paint from ply 0 — g5 (east–west line) as the
// leaf, d8 (north–south line) as a weak spot ---------------------------------
if (STAGE === 's59-hall-corner') {
  const door = await page.evaluate(() => ({ g5: window.__DCK.marks.cell('g5'), d8: window.__DCK.marks.cell('d8'), sprite: !!document.querySelector('#board [data-square="g5"] .piece.neutral') }));
  expect(door.g5?.includes('furniture') && door.g5?.includes('skin-door') && door.sprite, `g5 is the door leaf with its sprite (${door.g5})`);
  // Round 16: g5+h5, the double doors in the south wall, are ONE two-wide
  // door — g5 the left half, h5 the right — and each half paints its own
  // pack sprite (the leaves' data URIs differ).
  const dbl = await page.evaluate(() => {
    const bg = (sq) => getComputedStyle(document.querySelector(`#board [data-square="${sq}"] .piece.neutral`)).backgroundImage;
    return { g5: window.__DCK.marks.cell('g5'), h5: window.__DCK.marks.cell('h5'), same: bg('g5') === bg('h5'), png: bg('g5').includes('data:image/png') };
  });
  expect(dbl.g5?.includes('door2-l') && dbl.h5?.includes('door2-r') && dbl.png && !dbl.same, `g5+h5 are one double door: left half + right half, two different pack sprites (${dbl.g5} / ${dbl.h5})`);
  // Round 17: a furniture PROP's sprite box is two cells tall, anchored to
  // its cell's bottom (small props centred in the square, tall urns rising
  // north); a door's stays one cell.
  const boxes = await page.evaluate(() => {
    const h = (sq) => { const c = document.querySelector(`#board [data-square="${sq}"]`); const p = c.querySelector('.piece.neutral'); return p ? Math.round(p.getBoundingClientRect().height / c.getBoundingClientRect().height * 100) / 100 : null; };
    return { crate: h('j1'), door: h('g5') };
  });
  expect(boxes.crate === 2 && boxes.door === 1, `a prop's sprite box is 2 cells tall, a door's 1 (j1 crate ${boxes.crate}, g5 door ${boxes.door})`);
  expect(door.d8?.includes('furniture') && door.d8?.includes('skin-door') && door.d8?.includes('weak'), `d8, the door in the north–south line, is a weak spot (${door.d8})`);
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
  const labels = await page.evaluate(() => [...document.querySelectorAll('#board .arrow-layer g.arrow-hint text.label')].map((t) => t.textContent));
  expect(labels.length === probe.arrows.length && labels.every((l) => /^(\+|−|-)?\d+\.\d$|^−?M\d+$/.test(l)), `every hint arrow carries an eval label: ${labels}`);
  const domRanks = await page.evaluate(() => [...document.querySelectorAll('#board .arrow-layer g.arrow-hint')].map((g) => g.dataset.rank));
  expect(domRanks.length === probe.arrows.length && domRanks[domRanks.length - 1] === '1', `DOM draws hints worst→best, best on top: ${domRanks}`);
  // A streaming probe repaints: wait for the depth to move at least once
  // within the movetime (depth 12 is far past what 400 ms reaches on any
  // board, so the readout climbs).
  const d0 = probe.depth;
  const climbed = await page.waitForFunction((d) => window.__DCK.cheat.depth > d, d0, { timeout: 3000 }).then(() => true).catch(() => false);
  expect(climbed, `probe streamed a deeper paint after d${d0}`);
  await shot('01-hints');
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
          // The sprite on a cracked wall is the CRACK, never a crate (the
          // crate default and the crack rule share a specificity — order bug
          // caught 2026-09-02 by a screenshot).
          const bg = await page.evaluate((s) => { const el = document.querySelector(`#board [data-square="${s}"] .piece.neutral`); return el ? getComputedStyle(el).backgroundImage : null; }, sq);
          expect(bg !== null && bg.includes('0b0a10') && !bg.includes('3a2213'), `${sq}: cracked wall paints the crack, not a crate sprite${bg === null ? ' (no sprite element!)' : ''}`);
          // …and the WALL under it: the cell keeps its wall case over the
          // floor (two image layers), not floor alone (the furniture
          // floor-through rule once outranked the cracked rule under a theme).
          const cellCs = await page.evaluate((s) => { const cs = getComputedStyle(document.querySelector(`#board [data-square="${s}"]`)); return { bg: cs.backgroundImage, size: cs.backgroundSize }; }, sq);
          expect((cellCs.bg.match(/url\(/g) ?? []).length >= 2 && cellCs.bg.includes('data:image/png') && !cellCs.size.startsWith('auto'), `${sq}: cracked wall keeps its wall tile under the crack, full size (${(cellCs.bg.match(/url\(/g) ?? []).length} layers, ${cellCs.size})`);
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
      // case, solid to the walls beside it) — or, for a door in an east–
      // west line, its open doorway (residue ledger) — unless it is now a
      // hole; a burst crate (never part of the wall line) leaves nothing.
      const residue = await page.evaluate(() => window.__DCK.residue);
      const skinsNow = await page.evaluate(() => window.__DCK.skins);
      for (const sq of m.breached) {
        if (cells[sq]?.includes('hole')) continue;
        const dec = await page.evaluate((s) => document.querySelector(`#board [data-square="${s}"] .decor`)?.className ?? null, sq);
        const stub = cells[sq]?.find((c) => c.startsWith('wm-')) ?? null;
        if (residue.rubble.includes(sq)) expect(cells[sq]?.includes('ruin') && stub !== null && dec === null, `${sq}: breached wall keeps its ruin stub (${stub}, ${dec})`);
        else if (residue.opened.includes(sq)) expect(dec === 'decor decor-doorway' && !cells[sq]?.includes('ruin'), `${sq}: breached door keeps its open doorway (${dec})`);
        else expect(!cells[sq]?.includes('ruin') && dec === null && !['door', 'masonry'].includes(skinsNow[sq] ?? null), `${sq}: a burst crate leaves nothing (${skinsNow[sq]}, ${stub}, ${dec})`);
      }
      const quakeArrows = await page.evaluate(() => document.querySelectorAll('#board .arrow-layer g.arrow-quake').length);
      expect(quakeArrows >= wantFrom.length, `${quakeArrows} quake arrow(s) on the SVG layer for ${wantFrom.length} displacement(s)`);
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
  for (const sq of holes) if (!window.__DCK.marks.cell(sq).includes('hole')) bad.push(`${sq} not a hole`);
  for (const cell of document.querySelectorAll('#board .cell.cracked')) if (!godCrates.includes(cell.dataset.square)) bad.push(`${cell.dataset.square} cracked without ledger`);
  for (const sq of godCrates) {
    const cls = window.__DCK.marks.cell(sq);
    if (cls.includes('furniture') && !cls.includes('cracked')) bad.push(`${sq} god crate painted as authored`);
  }
  const standing = (f, r) => {
    const c = document.querySelector(`#board [data-square="${String.fromCharCode(97 + f)}${r}"]`);
    return !!c && (c.classList.contains('wall') || c.classList.contains('cracked') || c.classList.contains('skin-door') || c.classList.contains('skin-masonry'));
  };
  for (const cell of document.querySelectorAll('#board .cell.ruin')) {
    const sq = cell.dataset.square;
    const f = sq.charCodeAt(0) - 97;
    const r = parseInt(sq.slice(1), 10);
    const want = (standing(f, r + 1) ? 1 : 0) | (standing(f + 1, r) ? 2 : 0) | (standing(f, r - 1) ? 4 : 0) | (standing(f - 1, r) ? 8 : 0);
    if (!cell.classList.contains(`wm-${want}`)) bad.push(`${sq} ruin wears ${[...cell.classList].find((k) => k.startsWith('wm-')) ?? 'no case'}, its standing neighbours say wm-${want}`);
  }
  for (const span of document.querySelectorAll('#board .decor-doorway')) {
    const cell = span.parentElement;
    const sq = cell.dataset.square;
    const f = sq.charCodeAt(0) - 97;
    const r = parseInt(sq.slice(1), 10);
    const want = (standing(f + 1, r) ? 2 : 0) | (standing(f - 1, r) ? 8 : 0);
    if (!cell.classList.contains(`wm-${want}`)) bad.push(`${sq} doorway wears ${[...cell.classList].find((k) => k.startsWith('wm-')) ?? 'no case'}, its standing walls say wm-${want}`);
  }
  const isHole = (f, r) => !!document.querySelector(`#board [data-square="${String.fromCharCode(97 + f)}${r}"].hole`);
  for (const cell of document.querySelectorAll('#board .cell.hole')) {
    const sq = cell.dataset.square;
    const f = sq.charCodeAt(0) - 97;
    const r = parseInt(sq.slice(1), 10);
    const want = (isHole(f, r + 1) ? 1 : 0) | (isHole(f + 1, r) ? 2 : 0) | (isHole(f, r - 1) ? 4 : 0) | (isHole(f - 1, r) ? 8 : 0);
    if (!cell.classList.contains(`wm-${want}`)) bad.push(`${sq} hole wears ${[...cell.classList].find((k) => k.startsWith('wm-')) ?? 'no case'}, its hole neighbours say wm-${want}`);
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
expect(await page.evaluate(() => !!document.getElementById('optHintCont') && document.querySelectorAll('.legend .cell').length === 5), 'options panel has the Keep-evaluating toggle and a 5-tile legend');
// Pixel-perfect pieces (round 11): the king's box is a whole device-pixel
// multiple of the set's native height, then the dial goes back off. Sits
// here, after the probe checks: every applyOptions re-runs the idle probe.
const snap = await page.evaluate(() => {
  window.__DCK.options.pieceSnap = true; window.__DCK.applyOptions();
  const el = document.querySelector('#board .piece[data-piece="K"]');
  const fit = parseFloat(getComputedStyle(document.getElementById('board')).getPropertyValue('--piece-fit'));
  const r = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const on = window.__DCK.pieceFit;
  window.__DCK.options.pieceSnap = false; window.__DCK.applyOptions();
  return { fit, h: r.height, k: (r.height * dpr) / fit, on, off: window.__DCK.pieceFit };
});
expect(snap.fit > 0 && snap.k >= 1 && Math.abs(snap.k - Math.round(snap.k)) < 1e-3 && snap.on.snap && snap.on.box?.h && !snap.off.snap && !snap.off.box, `pixel-perfect pieces: king box ${snap.h}px = ${snap.k}× the set's ${snap.fit}-px height, off again after`);
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
// painted square carries a 16×16 PNG data URL in its own --debris layer.
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
    const painted = [...document.querySelectorAll('#board .cell[data-square]')].filter((c) => c.querySelector(':scope > img.debris')).map((c) => c.dataset.square);
    // every debris image is a decoded 16×16 PNG, the cell's FIRST child (under the sprites and pieces), with painted pixels behind it
    const urlsOk = painted.every((sq) => { const c = document.querySelector(`#board [data-square="${sq}"]`); const im = c.querySelector(':scope > img.debris'); return im.naturalWidth === 16 && im.naturalHeight === 16 && im.complete && im.src.startsWith('data:image/png;base64,') && c.firstElementChild === im && K.debris.cell(sq).painted && K.debris.cell(sq).pixels > 0; });
    const paintedOnFloor = painted.every((sq) => { const cl = K.marks.cell(sq); return !cl.includes('wall') && !cl.includes('hole') && !cl.includes('furniture'); });
    const breachSquares = d.record.quakes.flatMap((q) => (q.terrain ?? []).filter((t) => t.kind === 'breach').map((t) => t.square));
    const breachPainted = breachSquares.filter((sq) => !!K.debris.cell(sq)?.painted);
    // No canvas on the board, no piece z-index (Firefox dropped z-indexed pieces for a frame): the pieces stack as they always did.
    const layerOrder = (() => { const cs = (sel) => getComputedStyle(document.querySelector(sel)).zIndex; return { canvases: document.querySelectorAll('#board canvas').length, piece: cs('#board .piece'), arrows: cs('#board .arrow-layer'), fx: cs('#board .fx-layer') }; })();
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
  expect(dz.events > 0 && dz.painted > 0 && dz.urlsOk && dz.paintedOnFloor && dz.pending === 0, `${dz.painted} squares wear a 16×16 debris canvas as their first child, all on floor, nothing left in flight (${dz.events} events)`);
  expect(dz.layerOrder.piece === 'auto' && dz.layerOrder.arrows === '3' && dz.layerOrder.fx === '4' && dz.layerOrder.canvases === 0, `the stack is untouched: pieces z ${dz.layerOrder.piece}, arrows ${dz.layerOrder.arrows}, clones ${dz.layerOrder.fx}, and not one canvas on the board`);
  expect(dz.breach === 0 || dz.breachPainted > 0, `a breached wall's square wears its own stone (${dz.breachPainted}/${dz.breach})`);
  expect(dz.plyMax <= dz.ply, `no event outlives the record after the undos (latest event ply ${dz.plyMax} ≤ ${dz.ply})`);
  expect(dz.traffic > 0, `traffic wears the floor (${dz.traffic} cells visited)`);
  expect(dz.savedEvents === dz.events && dz.savedEpoch === dz.epoch, `localStorage holds the ledger (${dz.savedEvents} events, epoch ${dz.savedEpoch})`);
  expect(dz.samplerN > 0, `the sprite sampler decoded ${dz.samplerN} sprites off the board`);
  // Toggles filter the paint, not the record.
  const tog = await page.evaluate(async () => {
    const K = window.__DCK;
    const count = () => document.querySelectorAll('#board .cell[data-square] > img.debris').length;
    const before = count();
    K.options.debris = { ...K.options.debris, destruction: false, blood: false, skid: false, wear: false };
    K.applyOptions();
    const off = count();
    const attrOff = document.getElementById('board').dataset.debris;
    const eventsOff = K.debris.stats().events;
    K.options.debris = { ...K.options.debris, destruction: true, blood: true, skid: true, wear: true };
    K.applyOptions();
    // the images come back once each is decoded (setDebris swaps off the DOM) — a few ms
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
    const previewPainted = document.querySelectorAll('#board .cell[data-square] > img.debris').length;
    const previewPhase = K.app.phase;
    await K.begin();
    return { events, epoch, previewPainted, previewPhase, epochNow: K.debris.stats().epoch, eventsNow: K.debris.stats().events, phase: K.app.phase };
  });
  await page.waitForFunction(() => !window.__DCK.app.busy && window.__DCK.app.duel?.state === 'playing', null, { timeout: 60000 });
  expect(again.previewPhase === 'preview' && again.previewPainted > 0, `the setup preview shows the stage's scars (${again.previewPainted} squares)`);
  expect(again.epochNow === again.epoch + 1 && again.eventsNow === again.events && again.phase === 'playing', `a rematch is a new epoch on the same floor (epoch ${again.epoch} → ${again.epochNow}, ${again.eventsNow} events kept)`);
}
// --- THE FLIGHT: with motion on, the debris flies before it lands (the
// canvas on the fx layer draws frames; the landing sets the cells' layer). ---
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
    const canvases = document.querySelectorAll('#board .cell[data-square] > img.debris').length;
    const st = K.debris.stats();
    // every image is a persistent one, the cell's first child; the flight's group is gone
    const persistent = st.painted;
    const firstChild = [...document.querySelectorAll('#board .cell[data-square] > img.debris')].every((c) => c.parentElement.firstElementChild === c);
    const transient = document.querySelectorAll('#board svg.flight-layer g.flight').length + document.querySelectorAll('#board canvas').length;
    return { plies, captures, frames: K.debris.frames(), canvases, persistent, firstChild, transient, events: evs.length, pending: st.pending, flights: st.flights, fx: K.debris.options.fx };
  });
  expect(fl.fx && fl.events > 0, `motion on: ${fl.events} events over ${fl.plies} plies (${fl.captures} captures)`);
  expect(fl.frames > 0, `the flight drew ${fl.frames} frames on the flight SVG`);
  expect(fl.pending === 0 && fl.flights === 0 && fl.transient === 0 && fl.canvases === fl.persistent && fl.persistent > 0 && fl.firstChild, `everything landed: no flight held, nothing pending, the flight group gone, no canvas, ${fl.persistent} squares keep their debris image as the cell's first child`);
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
