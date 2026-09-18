// PORTALS v2, the game half's Node gate (2026-09-18): the shared ray walker
// (play/js/rays.mjs) and the route classifier, and the gods' grid code on it —
// attacks, the landing guard, the exposure rule, pins through a tunnel, the
// loser's terrain reach, a grid copy keeping its pairs. The fixtures are the
// engine gate's, so the grid and the engine read one rule.
//   node phase0/harness/test-portals-game.mjs
import { walkRay, gridFromFen, portalRoute, copyGrid, twinAt, SQ } from '../../play/js/rays.mjs';
import { attacksFrom, threatLedger, terrainReach, gridOf } from '../../play/js/tactics.mjs';
import { captureLoss, landingIsSafe, editExposes } from '../../play/js/threat.mjs';
import { fenGrid } from '../../play/js/director.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !extra ? '' : '  ' + extra}`); };
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const names = (list) => list.map((a) => SQ(a.f, a.r));

// ---- the walker
{
  const { grid, files, ranks } = gridFromFen('4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}');
  ok('gridFromFen: 8x8, the pair on the grid', files === 8 && ranks === 8 && twinAt(grid, 0, 3) && twinAt(grid, 0, 3).f === 7 && twinAt(grid, 0, 3).r === 4);
  const seen = [];
  walkRay(grid, files, ranks, 0, 0, 0, 1, (f, r, occ, through) => { seen.push(SQ(f, r) + (through ? '>' : '')); return true; });
  ok('walkRay: the a-file line stops at the body a4, comes out of h5 and runs to h8', seen.join(' ') === 'a2 a3 a4> h6 h7 h8', seen.join(' '));
  const plain = [];
  walkRay(grid, files, ranks, 0, 0, 1, 0, (f, r) => { plain.push(SQ(f, r)); return true; });
  ok('walkRay: the rank line stops at the king', plain.join(' ') === 'b1 c1 d1 e1', plain.join(' '));
}
{
  const { grid, files, ranks } = gridFromFen('4k3/p7/8/7n/8/8/8/R3K3[] w - - 0 1 {a4-h5}');
  const seen = [];
  walkRay(grid, files, ranks, 0, 0, 0, 1, (f, r, occ, through) => { seen.push(SQ(f, r) + (through ? '>' : '')); return true; });
  ok('walkRay: a plugged exit closes the tunnel — the line ends at the entry', seen.join(' ') === 'a2 a3 a4', seen.join(' '));
}
{
  const { grid, files, ranks } = gridFromFen('4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-c6,c7-f2}');
  const seen = [];
  walkRay(grid, files, ranks, 0, 0, 0, 1, (f, r, occ, through) => { seen.push(SQ(f, r) + (through ? '>' : '')); return true; });
  ok('walkRay: the chain through two pairs', seen.join(' ') === 'a2 a3> c7> f3 f4 f5 f6 f7 f8', seen.join(' '));
  const g2 = gridFromFen('7k/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-e5,e6-e3}');
  const loop = [];
  walkRay(g2.grid, g2.files, g2.ranks, 0, 0, 0, 1, (f, r, occ, through) => { loop.push(SQ(f, r) + (through ? '>' : '')); return true; });
  ok('walkRay: each pair once per line — the loop stops at the used pair', loop.join(' ') === 'a2 a3> e6> e4 e5', loop.join(' '));
}

// ---- the route
{
  const fen = '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}';
  ok('portalRoute: a plain move is null', portalRoute(fen, 'a1a3') === null);
  ok('portalRoute: a plain landing on the entry is null (the commit shows the twin)', portalRoute(fen, 'a1a4') === null);
  const r = portalRoute(fen, 'a1h7');
  ok('portalRoute: a1h7 went through a4→h5', r && JSON.stringify(r.pairs) === '[["a4","h5"]]' && r.path.join(' ') === 'a1 a4 h5 h7', JSON.stringify(r));
  ok('portalRoute: the king never tunnels', portalRoute(fen, 'e1e2') === null);
  const chain = portalRoute('4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-c6,c7-f2}', 'a1f8');
  ok('portalRoute: the chain names both pairs in order', chain && JSON.stringify(chain.pairs) === '[["a3","c6"],["c7","f2"]]' && chain.path.join(' ') === 'a1 a3 c6 c7 f2 f8', JSON.stringify(chain));
  const land = portalRoute('4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-c6,c7-f2}', 'a1c7');
  ok('portalRoute: a landing at the end of a tunnel keeps the tunnel and ends on the entry', land && JSON.stringify(land.pairs) === '[["a3","c6"]]' && land.path.join(' ') === 'a1 a3 c6 c7', JSON.stringify(land));
  ok('portalRoute: no pairs, no route', portalRoute('4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1', 'a1a8') === null);
  ok('portalRoute: a null board is null', portalRoute(null, 'a1a8') === null);
  // the same square reachable plainly and through a pair reads plain
  const both = portalRoute('4k3/8/8/8/8/8/8/Q3K3[] w - - 0 1 {a2-b1}', 'a1b2');
  ok('portalRoute: a square reachable plainly is plain, whatever tunnel also leads there', both === null, JSON.stringify(both));
}

// ---- the gods' grid code
{
  const fen = '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}';
  const g = gridOf(fen, 8, 8);
  ok('gridOf attaches the pairs', !!g.portals && g.portals.size === 2);
  const atk = names(attacksFrom(g, 0, 0, 8, 8));
  ok('attacksFrom: the rook covers a2..a4, h6..h8 and b1..d1 — never a5..a7', same(atk, ['a2', 'a3', 'a4', 'h6', 'h7', 'h8', 'b1', 'c1', 'd1', 'e1']), atk.join(','));
  ok('captureLoss: a black piece on h7 would be taken through the tunnel', captureLoss(gridOf('4k3/p6n/8/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}', 8, 8), 7, 6, 8, 8) > 0);
  ok('landingIsSafe: h7 is no safe landing for a black knight', !landingIsSafe(gridOf('4k3/p6n/8/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}', 8, 8), 7, 6, 8, 8));
  ok('landingIsSafe: a6 IS safe — the body at a4 shields it', landingIsSafe(gridOf('4k3/8/n7/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}', 8, 8), 0, 5, 8, 8));
  ok('landingIsSafe: without the pair a6 is not safe (the plain file)', !landingIsSafe(gridOf('4k3/8/n7/8/8/8/8/R3K3[] w - - 0 1', 8, 8), 0, 5, 8, 8));
  const led = threatLedger(gridOf('7k/8/7b/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}', 8, 8), 8, 8);
  ok('threatLedger: the bishop on h6 is pinned through the tunnel', led.white.keys.has('pin:h6') && led.white.squares.has('h7') && led.white.squares.has('a2'), [...led.white.keys].join(','));
  const ledPlain = threatLedger(gridOf('7k/8/7b/8/8/8/8/R3K3[] b - - 0 1', 8, 8), 8, 8);
  ok('threatLedger: no pin without the pair', !ledPlain.white.keys.has('pin:h6'));
  const reach = terrainReach(gridOf('4k3/p6*/8/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}', 8, 8), 8, 8, true);
  ok('terrainReach: the wall on h7 is in white\'s reach through the tunnel', reach.has('h7'), [...reach].join(','));
  // editExposes: cracking a wall opens a line that ends through a tunnel onto a hanging piece
  const pre = gridOf('4k3/6*n/8/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}', 8, 8);
  const post = copyGrid(pre);
  post[6][6] = null; // the wall on g7 comes down: the knight on h7 is on the rook's tunnel line already — it was hanging before, so not NEW
  ok('copyGrid keeps the pairs', !!post.portals && post.portals.size === 2);
  const pre2 = gridOf('4k3/8/8/7n/8/8/8/R3K3[] w - - 0 1 {a4-h5}', 8, 8); // the knight plugs the exit: safe
  const post2 = copyGrid(pre2);
  post2[4][7] = null; post2[5][7] = 'n'; // the knight steps off the exit onto h6 — now on the open tunnel's line
  const exposed = editExposes(pre2, post2, [{ f: 7, r: 4 }, { f: 7, r: 5 }], 8, 8);
  ok('editExposes: the piece that stepped off the exit onto the line stays landing safety\'s (moved) — nothing standing is newly exposed', exposed === null, JSON.stringify(exposed));
  const pre3 = fenGrid('4k3/8/7n/7p/8/8/8/R3K3[] w - - 0 1 {a4-h5}', 8, 8); // the pawn plugs the exit, the knight behind it on h6 is safe
  const post3 = copyGrid(pre3);
  post3[4][7] = null; // the gods lift the pawn: the tunnel opens onto the knight
  const exposed3 = editExposes(pre3, post3, [{ f: 7, r: 4 }], 8, 8);
  ok('editExposes: removing the plug exposes the knight behind it through the tunnel', exposed3 && SQ(exposed3.f, exposed3.r) === 'h6', JSON.stringify(exposed3));
  ok('fenGrid (director.mjs) attaches the pairs too', !!pre3.portals);
}

// ---- a line that comes back round to its own square (the smoke found this one as an infinite loop in the landing guard)
{
  // b5's line north: b6 → d2 (pair 1), d3 → b2 (pair 2), b3, b4, b5 — its own square
  const fen = '4k3/8/8/1n6/3*4/8/8/R3K3[] w - - 0 1 {b6-d2,d3-b2}';
  const { grid, files, ranks } = gridFromFen(fen);
  const seen = [];
  walkRay(grid, files, ranks, 1, 4, 0, 1, (f, r, occ, through) => { seen.push(SQ(f, r) + (through ? '>' : '')); return true; });
  ok('walkRay: the loop ends at the origin, unvisited', seen.join(' ') === 'b6> d3> b3 b4', seen.join(' '));
  const t0 = Date.now();
  const loss = captureLoss(gridOf(fen, 8, 8), 1, 4, 8, 8);
  ok('captureLoss terminates on the loop and reads the knight as safe (nothing attacks it round the loop but itself)', Date.now() - t0 < 2000 && loss <= 0, String(loss));
  const led = threatLedger(gridOf(fen, 8, 8), 8, 8);
  ok('threatLedger terminates on the loop', !!led);
  const route = portalRoute(fen, 'b5b4');
  ok('portalRoute: the knight has no route (a leaper)', route === null);
  // a rook on the loop with a wall under it: b3 is reachable only round the loop, through both pairs
  ok('portalRoute: a rook on the loop reaches b3 through both pairs', (() => { const r = portalRoute('4k3/8/8/1r6/1*6/8/8/R3K3[] b - - 0 1 {b6-d2,d3-b2}', 'b5b3'); return r && JSON.stringify(r.pairs) === '[["b6","d2"],["d3","b2"]]' && r.path.join(' ') === 'b5 b6 d2 d3 b2 b3'; })());
  ok('portalRoute: without the wall b3 is plain (the shorter picture)', portalRoute('4k3/8/8/1r6/8/8/8/R3K3[] b - - 0 1 {b6-d2,d3-b2}', 'b5b3') === null);
}

console.log(`\nportals-game: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
