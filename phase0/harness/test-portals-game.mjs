// PORTALS ON THE GRID, the game half's Node gate (2026-09-18 as Portals v2; the
// body rule alone since Portals v4, 2026-09-19): the shared ray walker
// (play/js/rays.mjs) and the gods' grid code on it — attacks, the landing
// guard, the exposure rule, pins, the loser's terrain reach, a grid copy
// keeping its pairs. A linked portal square is a BODY: every line ends at it,
// whatever stands on it, and NOTHING runs through a pair (v2's tunnel is
// retired). The fixtures are the engine gate's, so the grid and the engine
// read one rule.
//   node phase0/harness/test-portals-game.mjs
import { walkRay, gridFromFen, copyGrid, twinAt, SQ } from '../../play/js/rays.mjs';
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
  walkRay(grid, files, ranks, 0, 0, 0, 1, (f, r) => { seen.push(SQ(f, r)); return true; });
  ok('walkRay: the a-file line ends at the body a4 — nothing past it, nothing out of h5', seen.join(' ') === 'a2 a3 a4', seen.join(' '));
  const plain = [];
  walkRay(grid, files, ranks, 0, 0, 1, 0, (f, r) => { plain.push(SQ(f, r)); return true; });
  ok('walkRay: the rank line stops at the king', plain.join(' ') === 'b1 c1 d1 e1', plain.join(' '));
  const visited = [];
  walkRay(grid, files, ranks, 0, 0, 0, 1, (f, r, occ) => { visited.push(occ === null || occ === undefined ? '.' : occ); return true; });
  ok('walkRay: the portal square is visited as an empty square (the landing), then the walk ends', visited.join('') === '...', visited.join(''));
}
{
  const { grid, files, ranks } = gridFromFen('4k3/p7/8/7n/8/8/8/R3K3[] w - - 0 1 {a4-h5}');
  const seen = [];
  walkRay(grid, files, ranks, 0, 0, 0, 1, (f, r) => { seen.push(SQ(f, r)); return true; });
  ok('walkRay: a plugged twin changes nothing — the line ends at the entry as ever', seen.join(' ') === 'a2 a3 a4', seen.join(' '));
  const g2 = gridFromFen('4k3/p7/8/8/n7/8/8/R3K3[] w - - 0 1 {a4-h5}');
  const occ = [];
  walkRay(g2.grid, g2.files, g2.ranks, 0, 0, 0, 1, (f, r, ch) => { occ.push(SQ(f, r) + (ch ?? '')); return true; });
  ok('walkRay: a piece on the entry is the occupant the line stops at (a capture on landing)', occ.join(' ') === 'a2 a3 a4n', occ.join(' '));
}
{
  const { grid, files, ranks } = gridFromFen('4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-c6,c7-f2}');
  const seen = [];
  walkRay(grid, files, ranks, 0, 0, 0, 1, (f, r) => { seen.push(SQ(f, r)); return true; });
  ok('walkRay: two pairs — the first is the body, nothing chains through (v2 ran a2 a3> c7> f3..f8)', seen.join(' ') === 'a2 a3', seen.join(' '));
  const g2 = gridFromFen('7k/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-e5,e6-e3}');
  const loop = [];
  walkRay(g2.grid, g2.files, g2.ranks, 0, 0, 0, 1, (f, r) => { loop.push(SQ(f, r)); return true; });
  ok('walkRay: v2\'s loop fixture ends at the first body', loop.join(' ') === 'a2 a3', loop.join(' '));
}

// ---- the gods' grid code
{
  const fen = '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}';
  const g = gridOf(fen, 8, 8);
  ok('gridOf attaches the pairs', !!g.portals && g.portals.size === 2);
  const atk = names(attacksFrom(g, 0, 0, 8, 8));
  ok('attacksFrom: the rook covers a2..a4 and b1..e1 — never a5..a7, never h6..h8', same(atk, ['a2', 'a3', 'a4', 'b1', 'c1', 'd1', 'e1']), atk.join(','));
  ok('captureLoss: a black piece on h7 is NOT attacked through the pair (v2 took it through the tunnel)', captureLoss(gridOf('4k3/p6n/8/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}', 8, 8), 7, 6, 8, 8) <= 0);
  ok('landingIsSafe: h7 IS a safe landing for a black knight', landingIsSafe(gridOf('4k3/p6n/8/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}', 8, 8), 7, 6, 8, 8));
  ok('landingIsSafe: a6 IS safe — the body at a4 shields it', landingIsSafe(gridOf('4k3/8/n7/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}', 8, 8), 0, 5, 8, 8));
  ok('landingIsSafe: without the pair a6 is not safe (the plain file)', !landingIsSafe(gridOf('4k3/8/n7/8/8/8/8/R3K3[] w - - 0 1', 8, 8), 0, 5, 8, 8));
  ok('landingIsSafe: a piece standing ON the entry is attacked as normal (a capture on landing)', !landingIsSafe(gridOf('4k3/8/8/8/n7/8/8/R3K3[] w - - 0 1 {a4-h5}', 8, 8), 0, 3, 8, 8));
  const led = threatLedger(gridOf('7k/8/7b/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}', 8, 8), 8, 8);
  ok('threatLedger: no pin through the pair (v2 pinned the bishop on h6 through the tunnel)', !led.white.keys.has('pin:h6'), [...led.white.keys].join(','));
  const ledPin = threatLedger(gridOf('R4b1k/8/8/8/8/8/8/4K3[] b - - 0 1 {a4-h5}', 8, 8), 8, 8);
  ok('threatLedger: a plain pin still reads with a pair on the board (the rook a8 pins the bishop f8 to the king h8, no portal square on that rank)', ledPin.white.keys.has('pin:f8'), [...ledPin.white.keys].join(','));
  const reach = terrainReach(gridOf('4k3/p6*/8/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}', 8, 8), 8, 8, true);
  ok('terrainReach: the wall on h7 is NOT in white\'s reach (nothing runs through the pair)', !reach.has('h7'), [...reach].join(','));
  const reach2 = terrainReach(gridOf('4k3/8/8/8/*7/8/8/R3K3[] w - - 0 1 {a5-h5}', 8, 8), 8, 8, true);
  ok('terrainReach: a wall on the line before the pair is in reach as ever', reach2.has('a4'), [...reach2].join(','));
  // editExposes: the pair as a shield — removing the plug on the twin no longer exposes what stands beyond it
  const pre3 = fenGrid('4k3/8/7n/7p/8/8/8/R3K3[] w - - 0 1 {a4-h5}', 8, 8);
  const post3 = copyGrid(pre3);
  post3[4][7] = null; // the gods lift the pawn off h5: the knight on h6 stays out of the rook's reach
  ok('copyGrid keeps the pairs', !!post3.portals && post3.portals.size === 2);
  const exposed3 = editExposes(pre3, post3, [{ f: 7, r: 4 }], 8, 8);
  ok('editExposes: lifting the plug exposes nothing — no tunnel opens onto the knight (v2 reported h6)', exposed3 === null, JSON.stringify(exposed3));
  const pre4 = fenGrid('4k3/8/8/8/n7/8/8/R3K3[] w - - 0 1 {c5-h5}', 8, 8); // a black knight on a4 under the rook's plain file, a crate on... none: the a-file is open and the knight hangs already
  const post4 = copyGrid(pre4);
  ok('editExposes: a hanging piece is not NEW (the guard\'s own rule holds with pairs on the board)', editExposes(pre4, post4, [{ f: 2, r: 4 }], 8, 8) === null);
  const pre5 = fenGrid('4k3/8/8/8/n7/*7/8/R3K3[] w - - 0 1 {c5-h5}', 8, 8); // the wall on a3 shields the knight on a4
  const post5 = copyGrid(pre5);
  post5[2][0] = null; // the wall comes down: the knight is exposed along the plain file
  const exposed5 = editExposes(pre5, post5, [{ f: 0, r: 2 }], 8, 8);
  ok('editExposes: a wall coming down still exposes along a plain line', exposed5 && SQ(exposed5.f, exposed5.r) === 'a4', JSON.stringify(exposed5));
  ok('fenGrid (director.mjs) attaches the pairs too', !!pre3.portals);
}

// ---- the old loop position: a straight walk, nothing comes round
{
  const fen = '4k3/8/8/1n6/3*4/8/8/R3K3[] w - - 0 1 {b6-d2,d3-b2}';
  const { grid, files, ranks } = gridFromFen(fen);
  const seen = [];
  walkRay(grid, files, ranks, 1, 4, 0, 1, (f, r) => { seen.push(SQ(f, r)); return true; });
  ok('walkRay: b5\'s line north ends at the body b6', seen.join(' ') === 'b6', seen.join(' '));
  const t0 = Date.now();
  const loss = captureLoss(gridOf(fen, 8, 8), 1, 4, 8, 8);
  ok('captureLoss reads the knight as safe, at once', Date.now() - t0 < 2000 && loss <= 0, String(loss));
  const led = threatLedger(gridOf(fen, 8, 8), 8, 8);
  ok('threatLedger runs on it', !!led);
}

console.log(`\nportals-game: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
