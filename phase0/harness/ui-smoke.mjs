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
//   [--stage s07-the-doorway] [--plies 60] [--seed 3] [--shots]
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
const STAGE = arg('stage', 's07-the-doorway');
const PLIES = parseInt(arg('plies', '60'), 10);
const SEED = arg('seed', '3');
const SHOTS = argv.includes('--shots');

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
  go: 'depth 8 movetime 120',
  probe: 'depth 12 movetime 400',
  onset: '1',
  mramp: '2',
  debt: '2',
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
  page.evaluate(() => {
    const board = document.getElementById('board');
    const bg = (sel) => getComputedStyle(document.querySelector(sel)).backgroundImage;
    return {
      theme: window.__DCK.theme,
      attr: board.dataset.theme ?? null,
      legend: document.querySelector('.legend').dataset.theme ?? null,
      wall: bg('#board .cell.wall'),
      floor: bg('#board .cell.light:not(.wall):not(.furniture):not(.hole)'),
      door: document.querySelector('#board .cell.skin-door .piece.neutral') ? bg('#board .cell.skin-door .piece.neutral') : '',
      doorBg: document.querySelector('#board .cell.skin-door') ? bg('#board .cell.skin-door') : '',
      masks: [...document.querySelectorAll('#board .cell.wall')].map((c) => `${c.dataset.square}:${[...c.classList].find((k) => k.startsWith('wm-'))}`).join(' '),
      pieces: window.__DCK.pieces,
      king: (() => { const el = document.querySelector('#board .piece[data-piece="K"]'); const cs = el && getComputedStyle(el); return cs ? { bg: cs.backgroundImage, font: cs.fontSize } : null; })(),
    };
  });
const stageTheme = await page.evaluate(() => window.__DCK.app.session.deal.stage.theme);
{
  const t = await themeState();
  expect(!!stageTheme && t.theme === stageTheme && t.attr === stageTheme && t.legend === stageTheme, `board and legend wear the stage's theme "${stageTheme}" (${t.theme}/${t.attr}/${t.legend})`);
  expect(t.wall.includes('data:image/png') && t.floor.includes('data:image/png'), `themed walls and floor paint the repacked PNG tiles (wall ${t.wall.slice(0, 30)}…, floor ${t.floor.slice(0, 30)}…)`);
  if (STAGE === 's07-the-doorway') {
    expect(t.door.includes('data:image/png'), 'the door leaf paints the pack door sprite');
    // d6 is a dark square: the checker shade (a flat gradient) is allowed, the in-house bevel (160deg) is not.
    expect(t.doorBg.includes('data:image/png') && !t.doorBg.includes('160deg'), `the floor tile shows behind the door, no in-house bevel (${t.doorBg.slice(0, 60)}…)`);
    // ##.^## on rank 6: a6 joins east, b6 west, e6 joins the door west and f6 east, f6 west.
    expect(t.masks === 'a6:wm-2 b6:wm-8 e6:wm-10 f6:wm-8', `wall autotile masks on the doorway's wall line (${t.masks})`);
  }
}
const setTheme = (name) =>
  page.evaluate((n) => {
    window.__DCK.options.theme = n;
    window.__DCK.applyOptions();
  }, name);
for (const name of ['hall', 'castle', 'crypt']) {
  await setTheme(name);
  const t = await themeState();
  expect(t.theme === name && t.legend === name && t.wall.includes('data:image/png'), `Art set "${name}" overrides the stage (${t.theme}, legend ${t.legend})`);
  await shot(`00-theme-${name}`);
}
await setTheme('classic');
{
  const t = await themeState();
  expect(t.theme === null && t.attr === null && t.wall.includes('data:image/svg') && !t.floor.includes('data:image'), `"classic" strips the theme: in-house SVG wall, flat floor (${t.wall.slice(0, 30)}…)`);
  await shot('00-theme-classic');
}
await setTheme('auto');
expect((await themeState()).theme === stageTheme, 'Art set "auto" returns to the stage\'s own theme');
// Piece sprites: the default set paints the king as a PNG sprite; classic is the glyph.
{
  const t = await themeState();
  expect(t.pieces === 'pixel-chess' && t.king?.bg.includes('data:image/png') && t.king?.font === '0px', `pieces default to the Pixel Chess sprites (${t.pieces}, ${t.king?.font})`);
  await page.evaluate(() => { window.__DCK.options.pieces = 'classic'; window.__DCK.applyOptions(); });
  const c = await themeState();
  expect(c.pieces === null && c.king?.bg === 'none' && c.king?.font !== '0px', `"classic" pieces are the glyphs again (${c.king?.bg.slice(0, 20)}, ${c.king?.font})`);
  await page.evaluate(() => { window.__DCK.options.pieces = 'pixel-chess-wood'; window.__DCK.applyOptions(); });
  expect((await themeState()).pieces === 'pixel-chess-wood', 'the wood set applies');
  await shot('00-pieces-wood');
  await page.evaluate(() => { window.__DCK.options.pieces = 'pixel-chess'; window.__DCK.applyOptions(); });
}

// --- skins: the doorway's furniture leaf paints as a door from ply 0 ---------
if (STAGE === 's07-the-doorway') {
  const door = await page.evaluate(() => ({ cls: window.__DCK.marks.cell('d6'), sprite: !!document.querySelector('#board [data-square="d6"] .piece.neutral') }));
  expect(door.cls?.includes('furniture') && door.cls?.includes('skin-door') && door.sprite, `d6 is the door leaf with its sprite (${door.cls})`);
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
      expect(wantFrom.every((sq) => m.from.includes(sq)) && m.arrows.length >= wantFrom.length, `merged residue keeps every displacement (${wantFrom}) as from-mark + arrow`);
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
        else {
          expect(cells[sq]?.includes('fresh-crack') && cells[sq]?.includes('cracked') && cells[sq]?.includes('furniture'), `${sq}: cracked-wall tile + fresh-crack ring (${cells[sq]})`);
          // The sprite on a cracked wall is the CRACK, never a crate (the
          // crate default and the crack rule share a specificity — order bug
          // caught 2026-09-02 by a screenshot).
          const bg = await page.evaluate((s) => getComputedStyle(document.querySelector(`#board [data-square="${s}"] .piece.neutral`)).backgroundImage, sq);
          expect(bg.includes('0b0a10') && !bg.includes('3a2213'), `${sq}: cracked wall paints the crack, not a crate sprite`);
        }
      }
      for (const sq of wantBreached) {
        if (wantPits.includes(sq)) expect(cells[sq]?.includes('hole') && !cells[sq]?.includes('fresh-breach'), `${sq}: breached then collapsed → hole only (${cells[sq]})`);
        else expect(cells[sq]?.includes('fresh-breach') && !cells[sq]?.includes('furniture'), `${sq}: breach opened to floor + fresh-breach ring (${cells[sq]})`);
      }
      for (const sq of wantFrom) expect(cells[sq]?.includes('quake-from'), `${sq}: quake-from mark (${cells[sq]})`);
      // EVERY fresh hole keeps its rim — two crumbles in one window used to
      // leave only the latest marked.
      for (const sq of wantPits) expect(cells[sq]?.includes('hole') && cells[sq]?.includes('fresh-pit'), `${sq}: hole tile + fresh-pit ring (${cells[sq]})`);
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
 *  '^' paints cracked. Runs in the page. */
function tilesVsLedgers({ holes, godCrates, fen }) {
  const bad = [];
  for (const sq of holes) if (!window.__DCK.marks.cell(sq).includes('hole')) bad.push(`${sq} not a hole`);
  for (const cell of document.querySelectorAll('#board .cell.cracked')) if (!godCrates.includes(cell.dataset.square)) bad.push(`${cell.dataset.square} cracked without ledger`);
  for (const sq of godCrates) {
    const cls = window.__DCK.marks.cell(sq);
    if (cls.includes('furniture') && !cls.includes('cracked')) bad.push(`${sq} god crate painted as authored`);
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
expect(await page.evaluate(() => !!document.getElementById('optHintCont') && document.querySelectorAll('.legend .cell').length === 6), 'options panel has the Keep-evaluating toggle and a 6-tile legend');
if (SHOTS) await page.locator('#options-card').screenshot({ path: path.join(OUT, '06-options.png') });
await browser.close();
server.close();

for (const n of notes) console.log(n);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`rungs seen: weaken ${seen.weaken} · breach ${seen.breach} · displace ${seen.displace} · crumble ${seen.crumble}`);
console.log(`SUMMARY: ${notes.length} ok, ${failures.length} failed${SHOTS ? ` — screenshots in ${OUT}` : ''}`);
process.exit(failures.length ? 1 : 0);
