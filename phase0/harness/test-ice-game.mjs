// THE ICE on the grid, the game half's Node gate (2026-09-20; brief §4.9;
// engine/patches/ice.patch): play/js/ice.mjs — the slide's physics mirrored
// for the page (the animation's legs, the lit resting squares, the log, the
// analyzer's arrows) — held to THE ENGINE'S OWN BOARD after every legal move
// on the engine gate's fixtures and on random ice boards, through the
// vendored ffish (the same binary the game's legality runs on). The engine
// was validated against the independent oracle (engine/forge/oracle.py);
// this gate makes the grid agree with the engine, so one rule is read by all.
//   node phase0/harness/test-ice-game.mjs            (the vendored play/vendor/ffish.js)
//   FFISH_JS=/path/to/ffish.js node phase0/harness/test-ice-game.mjs
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { slideOutcome, slideEnd, slideAliases, slideDirection, fallen } from '../../play/js/ice.mjs';
import { dealVariant, iceCastRanks, spellPocket } from '../../play/js/variant.mjs';
import { splitFen, parsePortalField, slickSquares, withSlick, castLetter, PIT, isTerrain } from '../../play/js/fen.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const FFISH_JS = process.env.FFISH_JS ?? path.join(ROOT, 'play/vendor/ffish.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !extra ? '' : '  ' + extra}`); };
const board = (fen) => splitFen(fen).board;

const realFetch = globalThis.fetch;
delete globalThis.fetch;
const Module = require(FFISH_JS);
const ffish = await new Promise((resolve) => { Module.onRuntimeInitialized = () => { globalThis.fetch = realFetch; resolve(Module); }; });

// The game's own deal variants carry the ice (rule 7: the name encodes it); the
// engine gate's fixtures were written for its ice8 / ice10 variants, which
// draw the same cast rows (the two middle ranks) — so they load here as they are.
const V8 = dealVariant(8, 8, 2, 7, { portals: true, ice: true });
const V10 = dealVariant(10, 10, 2, 9, { portals: true, ice: true });
ffish.loadVariantConfig(V8.ini);
ffish.loadVariantConfig(V10.ini);
const variantOf = (fen) => (board(fen).split('/').length === 10 ? V10.name : V8.name);
const legal = (b) => b.legalMoves().trim().split(/\s+/).filter(Boolean);
const after = (fen, uci) => { const b = new ffish.Board(variantOf(fen), fen); b.push(uci); const out = b.fen(); b.delete(); return out; };

/** Every legal move of the position: the grid's board after it against the engine's. */
function checkPosition(label, fen, { expectSlides = null } = {}) {
  const v = variantOf(fen);
  if (ffish.validateFen(fen, v) !== 1) { ok(`${label}: validateFen`, false, fen); return { slides: 0, moves: 0 }; }
  const b = new ffish.Board(v, fen);
  const moves = legal(b);
  b.delete();
  let slides = 0;
  let bad = 0;
  const notes = [];
  for (const u of moves) {
    if (castLetter(u)) continue;
    const o = slideOutcome(fen, u);
    const got = board(after(fen, u));
    if (o) {
      slides++;
      if (o.board !== got) { bad++; notes.push(`${u}: grid ${o.board} engine ${got}`); }
    }
  }
  ok(`${label}: ${moves.length} moves, ${slides} slide — the grid's board after each slide equals the engine's`, bad === 0 && (expectSlides === null || slides === expectSlides), notes.slice(0, 3).join(' | ') || `${slides} slides (expected ${expectSlides})`);
  return { slides, moves: moves.length };
}

// ---- the direction
ok('slideDirection: a file, a rank, a diagonal, a leap, a pass', JSON.stringify([slideDirection('a1', 'a4'), slideDirection('h3', 'c3'), slideDirection('b2', 'e5'), slideDirection('b1', 'c3'), slideDirection('e1', 'e1')]) === JSON.stringify([{ df: 0, dr: 1 }, { df: -1, dr: 0 }, { df: 1, dr: 1 }, null, null]));

// ---- the engine gate's fixtures (engine/tests/test-ice-ffish.cjs), every legal move
const FIXTURES = [
  ['I1 a run of ice up the a-file', '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {~a3,~a4,~a5}'],
  ['I2 a knight on the ice: the shove and the capture', '4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {~a3,~a4,~a5}'],
  ['I3 the king steps onto ice', '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {~e2,~e3,~e4}'],
  ['I3b a pit behind the ice — the king may not slide in', '4k3/p7/8/4_3/8/8/8/R3K3[] w - - 0 1 {~e2,~e3,~e4}'],
  ['I3c the enemy king shoved into a pit', '8/p7/8/8/8/8/8/R3K1k_[] w - - 0 1 {~f1,~g1}'],
  ['I4 three knights up to the king', '4k3/p7/8/8/8/8/8/RnnnK3[] w - - 0 1 {~b1,~c1,~d1}'],
  ['I4b a gap in the chain', '4k3/p7/8/8/8/8/8/R1nn1K2[] w - - 0 1 {~b1,~c1,~d1,~e1}'],
  ['I5 a pawn push and double step onto ice', '4k3/p7/8/8/8/8/3P4/4K3[] w - - 0 1 {~d3,~d4}'],
  ['I5b a slide onto the promotion zone', '1k6/p7/8/8/3P4/8/8/4K3[] w - - 0 1 {~d5,~d6,~d7}'],
  ['I6 a shoved pawn promotes to the strongest', '1R6/p3k3/8/8/8/8/1p5K/8[] w - - 0 1 {~b3,~b2}'],
  ['I7 a rook into the pit', '4k3/p7/8/8/_7/8/8/R3K3[] w - - 0 1 {~a2,~a3}'],
  ['I7b a knight shoved into the pit', '4k3/p7/8/8/_7/n7/8/R3K3[] w - - 0 1 {~a2,~a3}'],
  ['I8 a slide into a portal is a landing', '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a5-h7,~a3,~a4,~h6,~h7}'],
  ['I8b the king slides into the portal', '4k3/p7/8/8/8/8/8/R2K4[] w - - 0 1 {d5-h7,~d2,~d3,~d4,~h6,~h7}'],
  ['I8c a knight on the portal square is an obstacle', '4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {a5-h7,~a3,~a4}'],
  ['I10 a knight lands where it jumps', '4k3/p7/8/8/8/8/8/N3K3[] w - - 0 1 {~b3,~c2,~c3,~c4}'],
  ['I11 in check: the evasions slide', '4k3/p7/8/8/8/1R6/8/K6r[] w - - 0 1 {~b2,~b1}'],
  ['I11b a shove that gives check', '8/p7/8/8/8/4B3/R7/KR1nk3[] w - - 0 1 {~c1,~d1,~e1,~f1}'],
  ['I11c the pinned rook may not slide off the rank', 'k7/p7/8/8/8/8/8/K2R3r[] w - - 0 1 {~d2,~d3}'],
  ['I12 en passant onto ice, promoting at the end', '4k3/8/8/2pP4/8/8/8/4K3[] w - c6 0 1 {~c6,~b7}'],
  ['I13 a shoved king, no check', '4r3/p7/8/8/4k3/8/4P3/4K3[] w - - 0 1 {~e3,~e4}'],
  ['I14 the 10×10 duel shape with a pair and a patch', '1r2k1r3/1pppppp3/10/10/10/10/10/10/1PPPPPP3/1R2K1R3[IOOioo] w - - 0 1 {d4-g7,~d5,~e5,~f5,~d6,~e6,~f6}'],
];
for (const [label, fen] of FIXTURES) checkPosition(label, fen);

// ---- the shape of the outcome on the fixtures the rules were written from
{
  const o = slideOutcome('4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {~a3,~a4,~a5}', 'a1a4');
  ok('I2 a1a4: the rook stops on a4, the knight is shoved from a5 to a6', JSON.stringify(o.steps.map((s) => [s.piece, s.from, s.to, s.mover])) === JSON.stringify([['R', 'a4', 'a4', true], ['n', 'a5', 'a6', false]]), JSON.stringify(o.steps));
  ok('I2 a1a4: the board after', o.board === '4k3/p7/n7/8/R7/8/8/4K3', o.board);
  const c = slideOutcome('4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {~a3,~a4,~a5}', 'a1a5');
  ok('I2 a1a5: the capture, then the rook slides on to a6', c.steps.length === 1 && c.steps[0].from === 'a5' && c.steps[0].to === 'a6' && c.board === '4k3/p7/R7/8/8/8/8/4K3', JSON.stringify(c));
  ok('I1 a1a6: a plain landing past the ice — no slide', slideOutcome('4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {~a3,~a4,~a5}', 'a1a6') === null);
  ok('I1: the resting square of a1a6 is a6, of a1a2 (not offered, but a slide) a6', slideEnd('4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {~a3,~a4,~a5}', 'a1a6') === 'a6' && slideEnd('4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {~a3,~a4,~a5}', 'a1a3') === 'a6');
}
{
  const fen = '8/p7/8/8/8/8/8/R3K1k_[] w - - 0 1 {~f1,~g1}';
  const o = slideOutcome(fen, 'e1f1');
  ok('I3c e1f1: the king stops on f1, the enemy king slides from g1 into the pit at h1', o.steps.length === 2 && o.steps[1].piece === 'k' && o.steps[1].to === null && o.steps[1].pit === 'h1' && fallen(o).length === 1 && fallen(o)[0].piece === 'k', JSON.stringify(o.steps));
  ok('I3c: the board after has no black king', o.board === '8/p7/8/8/8/8/8/R4K1_', o.board);
}
{
  const fen = '4k3/p7/8/8/8/8/8/R1nn1K2[] w - - 0 1 {~b1,~c1,~d1,~e1}';
  const o = slideOutcome(fen, 'a1b1');
  ok('I4b a1b1: a chain with a gap — the rook rests on b1, c1 shoves d1, d1 slides to e1', JSON.stringify(o.steps.map((s) => [s.piece, s.from, s.to])) === JSON.stringify([['R', 'b1', 'b1'], ['n', 'c1', 'c1'], ['n', 'd1', 'e1']]) && o.board === '4k3/p7/8/8/8/8/8/1Rn1nK2', JSON.stringify(o.steps));
}
{
  const fen = '1k6/p7/8/8/3P4/8/8/4K3[] w - - 0 1 {~d5,~d6,~d7}';
  const o = slideOutcome(fen, 'd4d5q');
  ok('I5b d4d5q: the pawn slides to d8 and promotes to the piece named', o.steps[0].to === 'd8' && o.steps[0].promoted === 'Q' && o.board === '1k1Q4/p7/8/8/8/8/8/4K3', JSON.stringify(o));
  const r = slideOutcome(fen, 'd4d5r');
  ok('I5b d4d5r: a rook when the move names one', r.steps[0].promoted === 'R' && r.board === '1k1R4/p7/8/8/8/8/8/4K3', r.board);
  const s = slideOutcome('1R6/p3k3/8/8/8/8/1p5K/8[] w - - 0 1 {~b3,~b2}', 'b8b3');
  ok('I6 b8b3: the shoved pawn promotes to the strongest', s.steps[1].piece === 'p' && s.steps[1].to === 'b1' && s.steps[1].promoted === 'q' && s.board === '8/p3k3/8/8/8/1R6/7K/1q6', JSON.stringify(s));
}
{
  const fen = '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a5-h7,~a3,~a4,~h6,~h7}';
  const o = slideOutcome(fen, 'a1a3');
  ok('I8 a1a3 (a slide the engine folds into a1a5): the landing on a5 comes out on h7, at rest though h7 is iced', o.steps.length === 1 && o.steps[0].to === 'h7' && o.steps[0].landing?.entry === 'a5' && o.steps[0].landing.twin === 'h7' && o.steps[0].landing.swapped === null && o.board === '4k3/p6R/8/8/8/8/8/4K3', JSON.stringify(o));
  ok('I8 a1a5: the landing itself is no slide', slideOutcome(fen, 'a1a5') === null);
  const p = slideOutcome('4k3/p6n/8/8/8/8/8/R3K3[] w - - 0 1 {a5-h7,~a3,~a4}', 'a1a3');
  ok('I8 a plugged twin: the slide lands on a5, the rook comes out on h7 and the knight swaps back to a5', p.steps[0].to === 'h7' && p.steps[0].landing.swapped === 'n' && p.board === '4k3/p6R/8/n7/8/8/8/4K3', JSON.stringify(p));
}
{
  const fen = '4k3/8/8/2pP4/8/8/8/4K3[] w - c6 0 1 {~c6,~b7}';
  const o = slideOutcome(fen, 'd5c6q');
  ok('I12 d5c6q: en passant onto ice — the c5 pawn gone, the captor slides the diagonal to a8 as a queen', o.board === 'Q3k3/8/8/8/8/8/8/4K3' && o.steps[0].to === 'a8' && o.steps[0].promoted === 'Q', JSON.stringify(o));
}
{
  const fen = '4k3/p7/8/8/8/8/8/N3K3[] w - - 0 1 {~b3,~c2,~c3,~c4}';
  ok('I10: a knight onto ice is no slide', slideOutcome(fen, 'a1b3') === null && slideOutcome(fen, 'a1c2') === null);
  const aliases = slideAliases('4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {~a3,~a4,~a5}', 'a1', ['a1a4', 'a1a5', 'a1b1', 'e1e2']);
  ok('slideAliases: a1a5 (the capture, sliding to a6) lights a6 as its alias; a1a4 rests on its own square', aliases.size === 1 && aliases.get('a6') === 'a1a5', JSON.stringify([...aliases]));
  const pitAlias = slideAliases('4k3/p7/8/8/_7/8/8/R3K3[] w - - 0 1 {~a2,~a3}', 'a1', ['a1a3', 'a1b1']);
  ok('slideAliases: a slide into the pit maps the pit square', pitAlias.get('a4') === 'a1a3', JSON.stringify([...pitAlias]));
}

// ---- random ice boards: kings, a few pieces, walls, crates, pits, a portal
// pair now and then, a 3×3 patch or scattered ice or a floor of it — every
// legal move's board after, the grid against the engine
{
  let seed = 20260920;
  const rng = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const sq = (f, r) => String.fromCharCode(97 + f) + (r + 1);
  let positions = 0, slides = 0, moves = 0, bad = 0, invalid = 0;
  const notes = [];
  for (let n = 0; n < 520; n++) {
    const N = pick([8, 8, 8, 10]);
    const g = Array.from({ length: N }, () => Array(N).fill(null));
    const free = (lo = 0, hi = N - 1) => { for (let t = 0; t < 100; t++) { const f = Math.floor(rng() * N), r = lo + Math.floor(rng() * (hi - lo + 1)); if (g[r][f] === null) return { f, r }; } return null; };
    const put = (ch) => { const c = free(); if (c) g[c.r][c.f] = ch; return c; };
    const wk = put('K');
    let bk = put('k');
    while (bk && wk && Math.abs(bk.f - wk.f) <= 1 && Math.abs(bk.r - wk.r) <= 1) { g[bk.r][bk.f] = null; bk = put('k'); } // kings never adjacent (FSF refuses the FEN)
    const nPieces = 2 + Math.floor(rng() * 6);
    for (let i = 0; i < nPieces; i++) put(pick(['P', 'N', 'B', 'R', 'Q', 'p', 'n', 'b', 'r', 'q']));
    for (let i = 0; i < 2 + Math.floor(rng() * 4); i++) put(pick(['*', '#', '^', '_', '_']));
    // pawns never on the back ranks (an illegal FEN to FSF)
    for (const r of [0, N - 1]) for (let f = 0; f < N; f++) if (g[r][f] && g[r][f].toLowerCase() === 'p') g[r][f] = null;
    const rows = [];
    for (let r = N - 1; r >= 0; r--) { let s = '', run = 0; for (let f = 0; f < N; f++) { const c = g[r][f]; if (c === null) run++; else { if (run) { s += run; run = 0; } s += c; } } if (run) s += run; rows.push(s); }
    const turn = rng() < 0.5 ? 'w' : 'b';
    let fen = `${rows.join('/')}[] ${turn} - - 0 1`;
    const entries = [];
    if (rng() < 0.35) { // a portal pair on two empty squares off the king rows (the engine's parse drops an entry on one)
      const a = free(1, N - 2); if (a) { g[a.r][a.f] = 'o'; const b2 = free(1, N - 2); g[a.r][a.f] = null; if (b2 && !(a.f === b2.f && a.r === b2.r)) entries.push(`${sq(a.f, a.r)}-${sq(b2.f, b2.r)}`); }
    }
    const ice = new Set();
    const kind = pick(['patch', 'patch', 'scatter', 'floor']);
    if (kind === 'patch') { const cf = 1 + Math.floor(rng() * (N - 2)), cr = 1 + Math.floor(rng() * (N - 2)); for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) { const c = g[cr + dr][cf + df]; if (!isTerrain(c)) ice.add(sq(cf + df, cr + dr)); } }
    else if (kind === 'scatter') { for (let i = 0; i < 6 + Math.floor(rng() * 8); i++) { const f = Math.floor(rng() * N), r = Math.floor(rng() * N); if (!isTerrain(g[r][f])) ice.add(sq(f, r)); } }
    else { for (let r = 0; r < N; r++) for (let f = 0; f < N; f++) if (!isTerrain(g[r][f]) && rng() < 0.7) ice.add(sq(f, r)); }
    if (entries.length) fen = `${fen} {${entries.join(',')}}`;
    fen = withSlick(fen, ice);
    const v = variantOf(fen);
    if (ffish.validateFen(fen, v) !== 1) { invalid++; continue; }
    const b = new ffish.Board(v, fen);
    if (b.isGameOver()) { b.delete(); continue; }
    const ms = legal(b);
    b.delete();
    positions++;
    for (const u of ms) {
      if (castLetter(u)) continue;
      moves++;
      const o = slideOutcome(fen, u);
      if (!o) continue;
      slides++;
      const got = board(after(fen, u));
      if (o.board !== got) { bad++; if (notes.length < 4) notes.push(`${fen} ${u}: grid ${o.board} engine ${got}`); }
    }
  }
  ok(`random ice boards: ${positions} positions (${invalid} invalid skipped), ${moves} moves, ${slides} slides — the grid's board after every slide equals the engine's`, bad === 0 && positions >= 250 && slides >= 500, notes.join('\n      '));
}

console.log(`\nice/game: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
