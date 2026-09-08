// THE ARMY RULE's Node gate (Phase 2 milestone 4b, 2026-09-08):
// play/js/army.mjs against brief §5.1's own cases — unison on open floor,
// flow around a wall, a rook home in one, a knight hopping, a bishop on the
// wrong colour walking, a pawn king-stepping back, the about-face over a
// few turns, a chain stepping into cells comrades leave, a slot in a wall
// molding to the nearest floor, never a capture on an automatic move, the
// individual move capturing furniture, refusals that cost nothing, and the
// save round trip. No browser, no engine.
// Usage (from phase0/): node harness/test-army.mjs
import * as A from '../../play/js/army.mjs';
import { World, FLOOR, WALL, FURNITURE } from '../../play/js/world.mjs';

let ok = 0;
const bad = [];
const expect = (cond, what) => { if (cond) ok++; else bad.push(what); };

/** A world from rows (top rank first): '.' floor, '#' wall, '^' furniture. */
function worldOf(rows, id = 'w') {
  const ranks = rows.length, files = rows[0].length;
  const w = new World({ id, files, ranks });
  rows.forEach((row, i) => {
    const r = ranks - 1 - i;
    for (let f = 0; f < files; f++) w.setTerrain(f, r, row[f] === '#' ? WALL : row[f] === '^' ? FURNITURE : FLOOR);
  });
  return w;
}
const open = (files, ranks) => worldOf(Array.from({ length: ranks }, () => '.'.repeat(files)));
const onSlots = (army) => army.pieces.every((p) => { const s = army.slotOf(p); return s.f === p.f && s.r === p.r; });
const rows = (world) => world.rows().join('\n');
const KIT = { width: 3, royal: 'K', pieces: ['R', 'N'] };

// --- the pattern: the 3×2 kit is the king rearmost with pawns in front per file
{
  const pat = A.makePattern(KIT);
  expect(pat.slots.length === 6 && pat.slots[0].ch === 'K' && pat.slots[0].dx === 0 && pat.slots[0].dy === 0, `the kit's pattern has 6 slots, the king at the origin (${JSON.stringify(pat.slots)})`);
  const pawns = pat.slots.filter((s) => s.ch === 'P');
  expect(pawns.length === 3 && pawns.every((s) => s.dy === 1), `three pawns one row ahead (${JSON.stringify(pawns)})`);
  const back = pat.slots.filter((s) => s.ch !== 'P');
  expect(back.every((s) => s.dy === 0) && new Set(back.map((s) => s.dx)).size === 3, 'the back row is one row wide, three files');
  // Body → world under the facings: forward is north / east / south / west; right is east / south / west / north.
  const fwd = [0, 1, 2, 3].map((fc) => A.rotateBody(0, 1, fc));
  expect(fwd[0].dr === 1 && fwd[1].df === 1 && fwd[2].dr === -1 && fwd[3].df === -1, `forward turns with the facing (${JSON.stringify(fwd)})`);
  const right = [0, 1, 2, 3].map((fc) => A.rotateBody(1, 0, fc));
  expect(right[0].df === 1 && right[1].dr === -1 && right[2].df === -1 && right[3].dr === 1, `right turns with the facing (${JSON.stringify(right)})`);
  for (let fc = 0; fc < 4; fc++) for (const [dx, dy] of [[1, 0], [0, 1], [-2, 3]]) {
    const w = A.rotateBody(dx, dy, fc);
    const b = A.toBody(w.df, w.dr, fc);
    expect(b.dx === dx && b.dy === dy, `toBody inverts rotateBody at facing ${fc}`);
  }
}

// --- unison: on open floor a step moves every piece one cell the same way, and they stay on their slots
{
  const world = open(14, 14);
  const army = A.spawnArmy(world, A.makePattern(KIT), { f: 6, r: 4 }, 0);
  expect(army.pieces.length === 6 && onSlots(army) && world.pieceAt(6, 4) === 'K', 'the kit spawns on its slots, the king on its cell');
  for (const [dx, dy, name] of [[0, 1, 'forward'], [1, 0, 'right'], [1, 1, 'forward-right'], [0, -1, 'back'], [-1, 0, 'left']]) {
    const before = army.pieces.map((p) => ({ ...p }));
    const plan = A.advance(world, army, { kind: 'step', dx, dy });
    const { df, dr } = A.rotateBody(dx, dy, army.facing);
    const all = plan.ok && plan.moves.length === 6 && army.pieces.every((p, i) => p.f === before[i].f + df && p.r === before[i].r + dr);
    expect(all && onSlots(army), `a ${name} step on open floor moves all six one cell, in unison (${plan.moves.length} moves, ok ${plan.ok})`);
  }
  // The world's piece grid follows.
  let count = 0;
  for (const ch of world.pieces) if (ch) count++;
  expect(count === 6, 'the world carries exactly the six letters after five steps');
}

// --- the about-face: a turn costs a move; the pattern turns, the pieces walk to their new slots over a few turns
{
  const world = open(14, 14);
  const army = A.spawnArmy(world, A.makePattern(KIT), { f: 6, r: 6 }, 0);
  const plan = A.advance(world, army, { kind: 'turn', dir: 1 });
  expect(plan.ok && army.facing === 1 && army.king.f === 6 && army.king.r === 6, 'a right turn faces east and the king stays');
  let turns = 1;
  while (!onSlots(army) && turns < 8) { A.advance(world, army, { kind: 'wait' }); turns++; }
  expect(onSlots(army) && turns <= 4, `the army about-faces onto its turned slots in ${turns} turns (≤ 4)`);
  // Facing east, "forward" is +f.
  const k0 = { ...army.king };
  A.advance(world, army, { kind: 'step', dx: 0, dy: 1 });
  expect(army.king.f === k0.f + 1 && army.king.r === k0.r && onSlots(army), 'facing east, a forward step is +f and the army keeps formation');
  A.advance(world, army, { kind: 'turn', dir: -1 });
  A.advance(world, army, { kind: 'turn', dir: -1 });
  expect(army.facing === 3, 'two left turns from east face west');
}

// --- a wall ahead of one piece: the blob flows around it and reforms beyond
{
  const world = worldOf([
    '..............',
    '..............',
    '..............',
    '..............',
    '..............',
    '.....#........',
    '.....#........',
    '..............',
    '..............',
    '..............',
    '..............',
    '..............',
  ]);
  const army = A.spawnArmy(world, A.makePattern(KIT), { f: 6, r: 2 }, 0);
  const refused = [];
  for (let i = 0; i < 9; i++) {
    const plan = A.advance(world, army, { kind: 'step', dx: 0, dy: 1 });
    if (!plan.ok) refused.push(plan.reason);
    if (army.king.r >= 9) break;
  }
  expect(army.king.r >= 9 && refused.length <= 2, `the army walked past the pillar (king at rank ${army.king.r}, ${refused.length} refused steps: ${refused.join(',')})`);
  let t = 0;
  while (!onSlots(army) && t < 4) { A.advance(world, army, { kind: 'wait' }); t++; }
  expect(onSlots(army), `beyond the pillar the formation reforms within ${t} waits\n${rows(world)}`);
}

// --- stragglers walk home: a rook in one slide, a knight in hops, a bishop on the wrong colour on foot, a pawn backward on foot
{
  const world = open(16, 16);
  const pat = A.patternOf([{ ch: 'K', dx: 0, dy: 0 }, { ch: 'R', dx: -1, dy: 0 }, { ch: 'N', dx: 1, dy: 0 }, { ch: 'B', dx: 2, dy: 0 }, { ch: 'P', dx: 0, dy: 1 }]);
  const army = A.spawnArmy(world, pat, { f: 8, r: 8 }, 0);
  // Scatter: the rook 6 cells back on its file, the knight 4 back, the bishop on a cell of the wrong colour 3 back, the pawn 2 ahead of its slot.
  const rook = army.pieces[1], knight = army.pieces[2], bishop = army.pieces[3], pawn = army.pieces[4];
  rook.r = 2; knight.r = 4; bishop.f = 10; bishop.r = 5; pawn.r = 11;
  army.stamp(world);
  const plan1 = A.advance(world, army, { kind: 'wait' });
  const moved = (p) => plan1.moves.find((m) => m.id === p.id);
  expect(moved(rook) && rook.f === 7 && rook.r === 8, `the rook slides home in one (${JSON.stringify(moved(rook))})`);
  const knightMove = moved(knight);
  expect(knightMove && (Math.abs(knightMove.to.f - knightMove.from.f) * Math.abs(knightMove.to.r - knightMove.from.r) === 2), `the knight hops (${JSON.stringify(knightMove)})`);
  expect(moved(pawn) && pawn.r === 10, `a pawn ahead of its slot king-steps back (${JSON.stringify(moved(pawn))})`);
  let t = 1;
  while (!onSlots(army) && t < 8) { A.advance(world, army, { kind: 'wait' }); t++; }
  expect(onSlots(army), `everyone is home after ${t} waits\n${rows(world)}`);
  expect(t <= 5, `the bishop on the wrong colour walked (${t} turns)`);
}

// --- a chain: a file of three steps forward together (each into the cell the one ahead leaves)
{
  const world = open(8, 12);
  const pat = A.patternOf([{ ch: 'K', dx: 0, dy: 0 }, { ch: 'P', dx: 0, dy: 1 }, { ch: 'P', dx: 0, dy: 2 }, { ch: 'R', dx: 0, dy: -1 }]);
  const army = A.spawnArmy(world, pat, { f: 3, r: 3 }, 0);
  expect(onSlots(army), 'a file of four spawns in a column');
  const plan = A.advance(world, army, { kind: 'step', dx: 0, dy: 1 });
  expect(plan.ok && plan.moves.length === 4 && onSlots(army) && army.king.r === 4, `the column steps forward as one, each into the cell the one ahead left (${plan.moves.length} moves)`);
}

// --- molding: a slot in a wall sends its piece to the nearest floor, toward the king; a 3-wide corridor squeezes a 5-wide line
{
  const world = worldOf([
    '#########',
    '#...#...#',
    '#...#...#',
    '#...#...#',
    '#...#...#',
    '#...#...#',
    '#...#...#',
    '#########',
  ]);
  const pat = A.patternOf([{ ch: 'K', dx: 0, dy: 0 }, { ch: 'R', dx: -2, dy: 0 }, { ch: 'N', dx: -1, dy: 0 }, { ch: 'B', dx: 1, dy: 0 }, { ch: 'Q', dx: 2, dy: 0 }]);
  const army = A.spawnArmy(world, pat, { f: 2, r: 3 }, 0);
  expect(army.pieces.every((p) => world.at(p.f, p.r) === FLOOR && p.f >= 1 && p.f <= 3), 'a 5-wide line spawns molded into the 3-wide corridor');
  const plan = A.planTurn(world, army, { kind: 'wait' });
  expect(plan.ok, 'a wait plans');
  const targets = Object.values(plan.targets);
  expect(targets.every((t) => t && world.at(t.f, t.r) === FLOOR && t.f >= 1 && t.f <= 3), `every target is floor inside the corridor (${JSON.stringify(targets)})`);
  A.advance(world, army, { kind: 'step', dx: 0, dy: 1 });
  A.advance(world, army, { kind: 'step', dx: 0, dy: 1 });
  expect(army.king.r === 5 && army.pieces.every((p) => p.f >= 1 && p.f <= 3), `the squeezed line walks the corridor (king at rank ${army.king.r})\n${rows(world)}`);
}

// --- never a capture: a rook whose way home is a crate stops short; the crate stands
{
  const world = worldOf([
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '.^......',
    '........',
  ]);
  const pat = A.patternOf([{ ch: 'K', dx: 0, dy: 0 }, { ch: 'R', dx: -3, dy: 0 }]);
  const army = A.spawnArmy(world, pat, { f: 4, r: 4 }, 0);
  const rook = army.pieces[1];
  rook.f = 1; rook.r = 0; // below the crate at (1, 1), its slot at (1, 4) straight up the file
  army.stamp(world);
  const plan = A.advance(world, army, { kind: 'wait' });
  expect(plan.ok && world.at(1, 1) === FURNITURE && !(rook.f === 1 && rook.r === 4), `an automatic move never smashes the crate (${JSON.stringify(plan.moves)})`);
  expect(rook.f !== 1 || rook.r !== 0, 'the rook still made progress around it');
}

// --- the individual move: one piece, captures allowed, the king never
{
  const world = worldOf([
    '........',
    '........',
    '..^.....',
    '........',
    '.....^..',
    '........',
    '........',
    '........',
  ]);
  const pat = A.patternOf([{ ch: 'K', dx: 0, dy: 0 }, { ch: 'R', dx: -1, dy: 0 }, { ch: 'P', dx: 0, dy: -1 }]);
  const army = A.spawnArmy(world, pat, { f: 2, r: 2 }, 0);
  const rook = army.pieces[1], pawn = army.pieces[2]; // the rook at (1, 2), the pawn behind the king at (2, 1)
  // The crates: (2, 5) on the king's file, (5, 3) on rank 3. The rook's lines from (1, 2) see neither.
  const ms = A.pieceMoves(world, army, rook, { captures: true });
  expect(ms.some((m) => m.capture === null) && !ms.some((m) => m.capture === 'furniture'), 'the rook sees no crate on its lines from (1, 2)');
  const p1 = A.advance(world, army, { kind: 'move', id: rook.id, to: { f: 1, r: 3 } });
  expect(p1.ok && p1.individual && p1.moves.length === 1 && rook.r === 3 && army.king.r === 2, 'an individual move moves that piece alone');
  const ms2 = A.pieceMoves(world, army, rook, { captures: true });
  const smash = ms2.find((m) => m.capture === 'furniture');
  expect(smash && smash.f === 5 && smash.r === 3, `from (1, 3) the rook can smash the crate at (5, 3) (${JSON.stringify(smash)})`);
  const p2 = A.advance(world, army, { kind: 'move', id: rook.id, to: { f: 5, r: 3 } });
  expect(p2.ok && world.at(5, 3) === FLOOR && rook.f === 5, 'smashing furniture is a capture: the crate is floor, the rook stands there');
  const kingTry = A.planTurn(world, army, { kind: 'move', id: army.king.id, to: { f: 3, r: 2 } });
  expect(!kingTry.ok && /king/.test(kingTry.reason), 'the king never makes an individual move');
  // The pawn at (2, 1): a crate diagonal-forward at (3, 2) is a capture; the king ahead at (2, 2) blocks its push.
  world.setTerrain(3, 2, FURNITURE);
  const pm = A.pieceMoves(world, army, pawn, { captures: true });
  expect(pm.some((m) => m.f === 3 && m.r === 2 && m.capture === 'furniture') && !pm.some((m) => m.f === 2 && m.r === 2), `a pawn captures diagonally forward, never by its push (${JSON.stringify(pm)})`);
  const auto = A.pieceMoves(world, army, pawn);
  expect(!auto.some((m) => m.capture), 'an automatic move list carries no captures');
}

// --- refusals cost nothing: a wall ahead, a comrade wedged in a dead end
{
  const world = worldOf([
    '#####',
    '#...#',
    '#.#.#',
    '#...#',
    '#####',
  ]);
  const pat = A.patternOf([{ ch: 'K', dx: 0, dy: 0 }, { ch: 'P', dx: 0, dy: 1 }]);
  const army = A.spawnArmy(world, pat, { f: 1, r: 1 }, 0);
  const snap = JSON.stringify(army.serialize()) + rows(world);
  const plan = A.planTurn(world, army, { kind: 'step', dx: 1, dy: 0 }); // into the pillar at (2, 2)? no: (2, 1) is floor. Step into the wall east of (3, 1): first go there.
  void plan;
  const wall = A.planTurn(world, army, { kind: 'step', dx: 0, dy: -1 });
  expect(!wall.ok && wall.reason === 'blocked' && wall.moves.length === 0, 'a step into a wall is refused with no moves');
  expect(JSON.stringify(army.serialize()) + rows(world) === snap, 'planTurn is pure: nothing moved');
  // A dead end: R K P in a one-cell-high pocket facing east. The king steps
  // onto the pawn; the pawn's only exit is the king's old cell, which the
  // rook (its slot: behind the king) takes first. Nowhere to go: refused.
  const w2 = worldOf([
    '#####',
    '#####',
    '#...#',
    '#####',
  ]);
  const a2 = new A.Army({ side: 'w', facing: 1, pattern: A.patternOf([{ ch: 'K', dx: 0, dy: 0 }, { ch: 'P', dx: 0, dy: 1 }, { ch: 'R', dx: 0, dy: -1 }]), pieces: [{ id: 1, ch: 'K', slot: 0, f: 2, r: 1 }, { id: 2, ch: 'P', slot: 1, f: 3, r: 1 }, { id: 3, ch: 'R', slot: 2, f: 1, r: 1 }] });
  a2.stamp(w2);
  // (The evicted pawn goes first — its target is its own cell — so it swaps
  // into the king's old cell before the rook can claim it; the rook, its
  // slot taken, stands. "The way is held" needs a cell nobody can vacate,
  // which the swap makes nearly impossible by construction: the king can
  // almost always step. The refusal path stays as a safety net.)
  const held = A.planTurn(w2, a2, { kind: 'step', dx: 0, dy: 1 });
  expect(held.ok && held.moves.length === 2 && held.moves.some((m) => m.id === 2 && m.to.f === 2) && !held.moves.some((m) => m.id === 3), `the king evicts the pawn, which swaps into his old cell; the rook stands (${JSON.stringify(held.moves)})`);
  // With the rook gone the same swap.
  a2.pieces.pop();
  a2.stamp(w2);
  const swap = A.planTurn(w2, a2, { kind: 'step', dx: 0, dy: 1 });
  expect(swap.ok && swap.moves.length === 2, `the king and a cornered pawn swap cells (${JSON.stringify(swap.moves)})`);
}

// --- the save round trip and the plan's determinism
{
  const world = open(10, 10);
  const army = A.spawnArmy(world, A.makePattern({ width: 5, royal: 'K', budget: 22 }, { archetype: 'scrambled', seed: 7 }), { f: 4, r: 2 }, 2);
  const obj = JSON.parse(JSON.stringify(army.serialize()));
  const back = A.Army.load(obj);
  expect(back.facing === 2 && back.pieces.length === army.pieces.length && back.king.ch === 'K' && JSON.stringify(back.pattern.slots) === JSON.stringify(army.pattern.slots), 'an army serializes and loads');
  const w2 = World.load(JSON.parse(JSON.stringify(world.serialize())));
  const p1 = A.planTurn(world, army, { kind: 'step', dx: 1, dy: 1 });
  const p2 = A.planTurn(w2, back, { kind: 'step', dx: 1, dy: 1 });
  expect(JSON.stringify(p1) === JSON.stringify(p2), 'the same input on the same state plans the same turn');
  expect(A.makePattern(KIT).slots.length === A.makePattern(KIT).slots.length && JSON.stringify(A.makePattern({ width: 4, royal: 'K', budget: 18 }, { seed: 3 })) === JSON.stringify(A.makePattern({ width: 4, royal: 'K', budget: 18 }, { seed: 3 })), 'a pattern is deterministic from its spec and seed');
}

for (const b of bad) console.log(`FAIL ${b}`);
console.log(`test-army: ${ok}/${ok + bad.length} checks passed`);
process.exit(bad.length ? 1 : 0);
