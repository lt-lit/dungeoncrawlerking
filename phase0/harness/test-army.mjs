// THE ARMY RULE's Node gate (Phase 2 milestone 4b, 2026-09-08; REWRITTEN
// 2026-09-09 for the controls and camera session — brief §5.1's eighteen
// rulings): play/js/army.mjs against the rulings' own cases — the facing
// follows a world step (the diagonal rule, no ties), unison on open floor,
// a turn is a PIVOT (the about-face in a three-wide corridor swaps the
// rows in one beat), the formation's front-centre is the anchor (the pawns
// file through a door first and the king last; blocked means the front met
// the wall), CATCH-UP (a pawn that lost a step to a pillar makes it up next
// turn), a STUCK piece and a piece the box cannot hold TELEPORT, manual
// moves are actual chess moves only (furniture a capture, never the d-pad,
// never an enemy piece), the king's own move is a step the army follows,
// the box filters manual moves, a knight beyond a thin wall keeps its hop
// and hops home, refusals cost nothing, the save round trip. No browser,
// no engine. Usage (from phase0/): node harness/test-army.mjs
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
const N = { kind: 'step', df: 0, dr: 1 }, E = { kind: 'step', df: 1, dr: 0 }, S = { kind: 'step', df: 0, dr: -1 }, W = { kind: 'step', df: -1, dr: 0 };
const WAIT = { kind: 'wait' };

// --- the pattern: the 3×2 kit is the king rearmost with pawns in front; the anchor is the front-centre
{
  const pat = A.makePattern(KIT);
  expect(pat.slots.length === 6 && pat.slots[0].ch === 'K' && pat.slots[0].dx === 0 && pat.slots[0].dy === 0, `the kit's pattern has 6 slots, the king at the origin (${JSON.stringify(pat.slots)})`);
  const pawns = pat.slots.filter((s) => s.ch === 'P');
  expect(pawns.length === 3 && pawns.every((s) => s.dy === 1), `three pawns one row ahead (${JSON.stringify(pawns)})`);
  expect(pat.anchor.dx === 0 && pat.anchor.dy === 1, `the anchor is the front-centre, one ahead of the king (${JSON.stringify(pat.anchor)})`);
  // THE OPENING KIT (2026-09-10, the enemies session): four wide — K + R + N + B and four pawns, laid N K R B over P P P P; the anchor on the king's file.
  const kit = A.makePattern(A.OPENING_KIT);
  expect(A.OPENING_KIT.width === 4 && kit.slots.length === 8 && kit.value === 15, `the opening kit is 4 wide, 8 slots, value 15 (${kit.slots.length} slots, value ${kit.value})`);
  const kitBack = kit.slots.filter((s) => s.dy === 0).sort((a, b) => a.dx - b.dx).map((s) => s.ch).join('');
  const kitFront = kit.slots.filter((s) => s.dy === 1).map((s) => s.dx).sort((a, b) => a - b);
  expect(kitBack === 'NKRB' && kitFront.join(',') === '-1,0,1,2' && kit.anchor.dx === 0 && kit.anchor.dy === 1, `the kit's back row is N K R B, four pawns ahead of it, the anchor on the king's file (${kitBack}, pawns at ${kitFront.join(',')}, anchor ${JSON.stringify(kit.anchor)})`);
  const wide = A.makePattern({ width: 6, royal: 'K', budget: 30 }, { seed: 3 });
  expect(wide.anchor.dy === Math.max(...wide.slots.map((s) => s.dy)) && Math.abs(wide.anchor.dx) <= 1, `a 6-wide pattern's anchor sits on its front row near the king's file (${JSON.stringify(wide.anchor)})`);
  // Body → world under the facings: forward is north / east / south / west; right is east / south / west / north.
  const fwd = [0, 1, 2, 3].map((fc) => A.rotateBody(0, 1, fc));
  expect(fwd[0].dr === 1 && fwd[1].df === 1 && fwd[2].dr === -1 && fwd[3].df === -1, `forward turns with the facing (${JSON.stringify(fwd)})`);
  for (let fc = 0; fc < 4; fc++) for (const [dx, dy] of [[1, 0], [0, 1], [-2, 3]]) {
    const w = A.rotateBody(dx, dy, fc);
    const b = A.toBody(w.df, w.dr, fc);
    expect(b.dx === dx && b.dy === dy, `toBody inverts rotateBody at facing ${fc}`);
  }
}

// --- THE FACING FOLLOWS THE STEP (ruling 2): cardinal steps face their way; a diagonal keeps a facing that is one of its components, else turns to the perpendicular one, never about-face
{
  const F = A.facingOfStep;
  expect(F(0, 0, 1) === 0 && F(0, 1, 0) === 1 && F(0, 0, -1) === 2 && F(0, -1, 0) === 3, 'a cardinal step faces that way');
  expect(F(2, 0, 1) === 0 && F(3, 1, 0) === 1, 'a cardinal step about-faces when pressed straight back');
  expect(F(0, 1, 1) === 0 && F(0, -1, 1) === 0, 'facing north, NE and NW keep north');
  expect(F(0, 1, -1) === 1 && F(0, -1, -1) === 3, 'facing north, SE turns east and SW turns west (never south)');
  expect(F(1, 1, 1) === 1 && F(1, 1, -1) === 1 && F(1, -1, 1) === 0 && F(1, -1, -1) === 2, 'facing east: NE and SE keep east; NW turns north; SW turns south');
  expect(F(2, 1, -1) === 2 && F(2, -1, -1) === 2 && F(2, 1, 1) === 1 && F(2, -1, 1) === 3, 'facing south: SE and SW keep south; NE turns east; NW turns west');
  expect(F(3, -1, 1) === 3 && F(3, -1, -1) === 3 && F(3, 1, 1) === 0 && F(3, 1, -1) === 2, 'facing west: NW and SW keep west; NE turns north; SE turns south');
  expect(F(1, 0, 0) === 1, 'no step keeps the facing');
}

// --- unison: on open floor a step moves every piece one cell the same way, and they stay on their slots; a step in a new direction PIVOTS first
{
  const world = open(16, 16);
  const army = A.spawnArmy(world, A.makePattern(KIT), { f: 8, r: 4 }, 0);
  expect(army.pieces.length === 6 && onSlots(army) && world.pieceAt(8, 4) === 'K' && army.at.f === 8 && army.at.r === 5, `the kit spawns on its slots, the king on its cell, the anchor one ahead (${JSON.stringify(army.at)})`);
  for (const [input, name] of [[N, 'north'], [{ kind: 'step', df: 1, dr: 1 }, 'north-east'], [{ kind: 'step', df: -1, dr: 1 }, 'north-west']]) {
    const before = army.pieces.map((p) => ({ ...p }));
    const plan = A.advance(world, army, input);
    const all = plan.ok && !plan.pivot && plan.moves.length === 6 && army.pieces.every((p, i) => p.f === before[i].f + input.df && p.r === before[i].r + input.dr);
    expect(all && onSlots(army) && army.facing === 0, `a ${name} step facing north moves all six one cell in unison, no pivot (${plan.moves.length} moves, pivot ${plan.pivot})`);
  }
  // East: the facing turns, the formation pivots about the king, then steps.
  const k0 = { ...army.king };
  const plan = A.advance(world, army, E);
  expect(plan.ok && plan.pivot && army.facing === 1 && army.king.f === k0.f + 1 && army.king.r === k0.r && onSlots(army), `an east step pivots the formation east and steps: everyone on their turned slots, the king one east (${JSON.stringify(army.king)})`);
  const pawnsEast = army.pieces.filter((p) => p.ch === 'P').every((p) => p.f === army.king.f + 1);
  expect(pawnsEast, 'facing east the pawns stand one file east of the king');
  expect(plan.moves.every((m) => !m.teleport), 'a pivot on open ground is no teleport');
  // South: an about-face (a step straight back), the rows swap.
  const p2 = A.advance(world, army, S);
  expect(p2.ok && p2.pivot && army.facing === 2 && onSlots(army) && army.pieces.filter((p) => p.ch === 'P').every((p) => p.r === army.king.r - 1), 'a step straight back about-faces: the pawns are now south of the king, everyone on slots');
  let count = 0;
  for (const ch of world.pieces) if (ch) count++;
  expect(count === 6, 'the world carries exactly the six letters after five steps');
}

// --- a `face` input is the pivot alone, a move; facing the way you already face is refused
{
  const world = open(14, 14);
  const army = A.spawnArmy(world, A.makePattern(KIT), { f: 6, r: 6 }, 0);
  const plan = A.advance(world, army, { kind: 'face', facing: 3 });
  expect(plan.ok && plan.pivot && army.facing === 3 && army.king.f === 6 && army.king.r === 6 && onSlots(army) && plan.moves.length === 5, `a face-west input pivots in place: the king stays, the other five slide to their turned slots (${plan.moves.length} moves)`);
  const same = A.planTurn(world, army, { kind: 'face', facing: 3 });
  expect(!same.ok && same.moves.length === 0, 'facing the way you already face is refused and costs nothing');
}

// --- THE ABOUT-FACE IN A THREE-WIDE CORRIDOR (ruling 14): one beat, the rows swap
{
  const world = worldOf([
    '#####',
    '#...#',
    '#...#',
    '#...#',
    '#...#',
    '#...#',
    '#...#',
    '#####',
  ]);
  const army = A.spawnArmy(world, A.makePattern(KIT), { f: 2, r: 3 }, 0);
  expect(onSlots(army), 'the kit fits the corridor facing north');
  const pawnRow = army.pieces.filter((p) => p.ch === 'P')[0].r;
  const plan = A.advance(world, army, { kind: 'face', facing: 2 });
  expect(plan.ok && plan.pivot && onSlots(army) && army.pieces.filter((p) => p.ch === 'P').every((p) => p.r === army.king.r - 1) && army.king.r === 3, `an about-face in the corridor swaps the rows in one turn (pawns ${pawnRow} → ${army.pieces.filter((p) => p.ch === 'P')[0].r})\n${rows(world)}`);
  expect(army.pieces.every((p) => world.at(p.f, p.r) === FLOOR && p.f >= 1 && p.f <= 3), 'every piece stands on the corridor floor');
}

// --- THE ANCHOR IS THE FRONT (ruling 12): blocked means the front met the wall; through a one-wide door the pawns file in first and the king last
{
  // A dead end: the front meets the wall while the king still has room behind it.
  const dead = worldOf([
    '#####',
    '#...#',
    '#...#',
    '#...#',
    '#...#',
    '#####',
  ]);
  const a0 = A.spawnArmy(dead, A.makePattern(KIT), { f: 2, r: 1 }, 0);
  const refused = [];
  for (let i = 0; i < 5; i++) { const p = A.advance(dead, a0, N); if (!p.ok) refused.push(p.reason); }
  expect(refused.length >= 1 && refused.every((r) => r === 'blocked'), `the front meets the wall and the step is refused (${refused.join(',')})`);
  expect(a0.pieces.filter((p) => p.ch === 'P').every((p) => p.r === 4) && a0.king.r === 3, `blocked with the pawns against the wall, the king a rank behind them (king ${JSON.stringify(a0.king)})\n${rows(dead)}`);
  // A one-wide door on the corridor's centre file into a room.
  const world = worldOf([
    '#######',
    '#.....#',
    '#.....#',
    '#.....#',
    '#.....#',
    '#.....#',
    '#.....#',
    '#.....#',
    '#.....#',
    '###.###',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '#######',
  ]);
  const army = A.spawnArmy(world, A.makePattern(KIT), { f: 3, r: 2 }, 0);
  expect(onSlots(army), 'the kit stands in the corridor facing north, the door ahead of the middle pawn');
  const entered = []; // the order pieces cross the doorway (3, 5)
  const seen = new Set();
  let perTurn = 0, worstLag = 0;
  const kingLag = () => { const s = army.slotOf(army.king); return Math.max(Math.abs(s.f - army.king.f), Math.abs(s.r - army.king.r)); };
  for (let i = 0; i < 16; i++) {
    A.advance(world, army, i < 9 ? N : WAIT); // the pad held: nine steps, then waits
    worstLag = Math.max(worstLag, kingLag());
    let n = 0;
    for (const p of army.pieces) if (!seen.has(p.id) && p.r >= 5) { seen.add(p.id); entered.push(p.ch); if (p.ch !== 'N') n++; }
    perTurn = Math.max(perTurn, n);
    if (seen.size === 6 && army.pieces.every((p) => p.r >= 6)) break;
  }
  expect(army.pieces.every((p) => p.r >= 6), `the whole army is in the north room (king ${JSON.stringify(army.king)})\n${rows(world)}`);
  expect(perTurn === 1, `one piece at a time through the door, the knight's hop over the wall aside (at most ${perTurn} a turn)`);
  expect(worstLag <= A.KING_LEASH, `through the door the king never lags more than the leash (worst ${worstLag})`);
  // THE LEASH itself: a king six cells behind his slot cannot close in one turn — the step becomes a regroup, the anchor holds, he hurries three.
  const open2 = open(12, 20);
  const a2 = A.spawnArmy(open2, A.makePattern(KIT), { f: 5, r: 10 }, 0);
  a2.king.r = 4;
  a2.stamp(open2);
  const at0 = { ...a2.at };
  const plan = A.advance(open2, a2, N);
  expect(plan.ok && plan.regroup && a2.at.f === at0.f && a2.at.r === at0.r && a2.king.r === 7, `a step the king cannot follow regroups: the anchor holds and he hurries three (regroup ${plan.regroup}, king at rank ${a2.king.r})`);
  const plan2 = A.advance(open2, a2, N);
  expect(plan2.ok && !plan2.regroup && a2.at.r === at0.r + 1, 'the next step advances again once he is within the leash');
  expect(entered.length === 6 && entered[entered.length - 1] === 'K', `the king was the LAST through the door (order ${entered.join('')})`);
  expect(entered[0] === 'P', `a pawn was the first through the door (order ${entered.join('')})`);
  let t = 0;
  while (!onSlots(army) && t < 3) { A.advance(world, army, WAIT); t++; }
  expect(onSlots(army), `beyond the door the formation reforms within ${t} waits`);
}

// --- FLOW (designer 2026-09-09, the first walk of the build): a single crate or pillar in front of the middle pawn never stops the army — it flows around; a solid wall still refuses
{
  const world = worldOf([
    '..........',
    '..........',
    '..........',
    '....^.....',
    '..........',
    '..........',
    '....#.....',
    '..........',
    '..........',
    '..........',
  ]);
  const army = A.spawnArmy(world, A.makePattern(KIT), { f: 4, r: 0 }, 0);
  const refused = [];
  for (let i = 0; i < 8; i++) { const p = A.advance(world, army, N); if (!p.ok) refused.push(p.reason); }
  expect(refused.length === 0 && army.king.r >= 7, `a pillar and a crate ahead of the middle pawn are flowed around, no step refused (king at rank ${army.king.r})\n${rows(world)}`);
  expect(world.at(4, 6) === FURNITURE, 'the crate stands — the flow is never a capture');
  let t = 0;
  while (!onSlots(army) && t < 3) { A.advance(world, army, WAIT); t++; }
  expect(onSlots(army), `beyond them the formation is whole within ${t} waits`);
  const dead = worldOf(['#####', '#...#', '#...#', '#...#', '#####']);
  const a2 = A.spawnArmy(dead, A.makePattern(KIT), { f: 2, r: 1 }, 0);
  A.advance(dead, a2, N);
  const wall = A.planTurn(dead, a2, N);
  expect(!wall.ok && wall.reason === 'blocked', 'a solid wall ahead still refuses: nobody could move');
}

// --- THE KING KEEPS UP (designer 2026-09-09: "the king is lagging behind sometimes"): through clutter the king is never more than the leash from his slot; a step he could not follow regroups instead of leaving him
{
  const world = worldOf([
    '############',
    '#..........#',
    '#....^.....#',
    '#.^........#',
    '#.....^.^..#',
    '#..#.......#',
    '#....^..#..#',
    '#.^........#',
    '#......^...#',
    '#..........#',
    '#..^.....^.#',
    '#..........#',
    '#..........#',
    '############',
  ]);
  const army = A.spawnArmy(world, A.makePattern(KIT), { f: 5, r: 1 }, 0);
  let worstLag = 0, advanced = 0, regroups = 0, refused = 0;
  const lag = () => { const s = army.slotOf(army.king); return Math.max(Math.abs(s.f - army.king.f), Math.abs(s.r - army.king.r)); };
  const walkOn = (inputs) => { for (const inp of inputs) { const p = A.advance(world, army, inp); if (!p.ok) { refused++; continue; } if (p.regroup) regroups++; else if (inp.kind === 'step') advanced++; worstLag = Math.max(worstLag, lag()); } };
  walkOn([N, N, N, N, N, N, N, N, N, N, E, E, E, N, W, W, W, W, S, S, S, S, S, S]);
  expect(worstLag <= A.KING_LEASH, `through the clutter the king never lags more than the leash (worst ${worstLag}, ${advanced} steps advanced, ${regroups} regroups, ${refused} refused)\n${rows(world)}`);
  expect(advanced >= 16, `the walk mostly advances (${advanced} of 24 inputs)`);
}

// --- CATCH-UP (ruling 13): a pawn that lost a step to a pillar makes it up next turn; nobody trails on a long walk
{
  const world = worldOf([
    '..............',
    '..............',
    '..............',
    '..............',
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
  let trailing = 0, worst = 0;
  for (let i = 0; i < 8; i++) {
    A.advance(world, army, N);
    const lag = Math.max(...army.pieces.map((p) => { const s = army.slotOf(p); return Math.max(Math.abs(s.f - p.f), Math.abs(s.r - p.r)); }));
    if (lag > 1) trailing++;
    worst = Math.max(worst, lag);
  }
  expect(army.king.r === 10, `the army walked past the pillar without a refusal (king at rank ${army.king.r})`);
  expect(worst <= 2 && trailing <= 1, `no piece ever trailed its slot by more than a step for more than a turn (worst lag ${worst}, ${trailing} turns over one)\n${rows(world)}`);
  expect(onSlots(army), 'beyond the pillar the formation is whole');
  // A straggler two behind its slot in the open: one turn home (two steps).
  const pawn = army.pieces.find((p) => p.ch === 'P');
  pawn.r -= 2;
  army.stamp(world);
  const plan = A.advance(world, army, WAIT);
  const m = plan.moves.find((x) => x.id === pawn.id);
  expect(m && !m.teleport && m.via.length === 2, `a pawn two behind the king hurries three cells around the back row, no teleport (${JSON.stringify(m)})`);
  A.advance(world, army, WAIT);
  expect(onSlots(army), 'and is home the turn after');
}

// --- stragglers walk home: a rook in one slide, a knight in hops, a bishop on the wrong colour on foot
{
  const world = open(16, 16);
  const pat = A.patternOf([{ ch: 'K', dx: 0, dy: 0 }, { ch: 'R', dx: -1, dy: 0 }, { ch: 'N', dx: 1, dy: 0 }, { ch: 'B', dx: 2, dy: 0 }, { ch: 'P', dx: 0, dy: 1 }]);
  const army = A.spawnArmy(world, pat, { f: 8, r: 8 }, 0);
  const rook = army.pieces[1], knight = army.pieces[2], bishop = army.pieces[3], pawn = army.pieces[4];
  rook.r = 2; knight.r = 4; bishop.f = 10; bishop.r = 5; pawn.r = 11;
  army.stamp(world);
  const plan1 = A.advance(world, army, WAIT);
  const moved = (p) => plan1.moves.find((m) => m.id === p.id);
  expect(moved(rook) && rook.f === 7 && rook.r === 8 && !moved(rook).teleport, `the rook slides home in one (${JSON.stringify(moved(rook))})`);
  expect(moved(knight) && !moved(knight).teleport, `the knight hops (${JSON.stringify(moved(knight))})`);
  expect(moved(pawn) && pawn.r === 9 && !moved(pawn).teleport, `a pawn two ahead of its slot walks back in one turn (${JSON.stringify(moved(pawn))})`);
  let t = 1;
  while (!onSlots(army) && t < 6) { A.advance(world, army, WAIT); t++; }
  expect(onSlots(army) && t <= 3, `everyone is home after ${t} waits\n${rows(world)}`);
}

// --- a chain: a file of four steps forward together (each into the cell the one ahead leaves); the royal is rearmost, as every pattern's is
{
  const world = open(8, 12);
  const pat = A.patternOf([{ ch: 'K', dx: 0, dy: 0 }, { ch: 'P', dx: 0, dy: 1 }, { ch: 'P', dx: 0, dy: 2 }, { ch: 'R', dx: 0, dy: 3 }]);
  const army = A.spawnArmy(world, pat, { f: 3, r: 3 }, 0);
  expect(onSlots(army) && army.at.r === 6, 'a file of four spawns in a column, the anchor at its head');
  const plan = A.advance(world, army, N);
  expect(plan.ok && plan.moves.length === 4 && plan.moves.every((m) => !m.teleport) && onSlots(army) && army.king.r === 4, `the column steps forward as one, each into the cell the one ahead left (${plan.moves.length} moves)`);
}

// --- molding: a slot in a wall sends its piece to the nearest floor, ahead of the king first; a 3-wide corridor squeezes a 5-wide line
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
  expect(army.pieces.every((p) => p.r >= army.king.r), 'the molding puts nobody behind the king');
  A.advance(world, army, N);
  A.advance(world, army, N);
  expect(army.pieces.every((p) => p.f >= 1 && p.f <= 3) && army.pieces.every((p) => p.r >= army.king.r), `the squeezed line walks the corridor, nobody behind the king (king at rank ${army.king.r})\n${rows(world)}`);
}

// --- never a capture on an automatic move; a d-pad step into furniture is a bump
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
  const plan = A.advance(world, army, WAIT);
  const rm = plan.moves.find((m) => m.id === rook.id);
  expect(plan.ok && world.at(1, 1) === FURNITURE && rm && !rm.via.some((c) => c.f === 1 && c.r === 1) && !(rm.to.f === 1 && rm.to.r === 1), `an automatic move never smashes the crate: the rook goes around it (${JSON.stringify(rm)})`);
  expect(rook.f !== 1 || rook.r !== 0, 'the rook still made progress around it');
  const w2 = worldOf(['....', '.^..', '....', '....']);
  const a2 = A.spawnArmy(w2, A.patternOf([{ ch: 'K', dx: 0, dy: 0 }]), { f: 1, r: 1 }, 0);
  const bump = A.planTurn(w2, a2, N);
  expect(!bump.ok && bump.reason === 'blocked' && w2.at(1, 2) === FURNITURE, 'a d-pad step into a crate is a bump, never a capture');
}

// --- MANUAL MOVES ARE ACTUAL CHESS MOVES (ruling 11): no king-step option, furniture a capture, the pawn's push and diagonals, never an enemy piece
{
  const world = worldOf([
    '........',
    '.^......',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
  ]);
  const pat = A.patternOf([{ ch: 'K', dx: 0, dy: 0 }, { ch: 'R', dx: -1, dy: 0 }, { ch: 'P', dx: 0, dy: 1 }]);
  const army = A.spawnArmy(world, pat, { f: 2, r: 2 }, 0);
  const rook = army.pieces[1], pawn = army.pieces[2]; // the rook at (1, 2), the pawn at (2, 3), a crate at (1, 6) up the rook's file
  const rm = A.manualMoves(world, army, rook);
  expect(rm.length > 0 && rm.every((m) => m.f === rook.f || m.r === rook.r), 'a rook\'s manual moves are its lines alone — no diagonal king step');
  expect(!rm.some((m) => m.f === 2 && m.r === 2) && rm.some((m) => m.f === 0 && m.r === 2), 'the rook cannot land on the king, and slides west past nothing');
  const smash = rm.find((m) => m.capture === 'furniture');
  expect(smash && smash.f === 1 && smash.r === 6 && !rm.some((m) => m.f === 1 && m.r === 7), `the crate at (1, 6) is a capture and the slide stops there (${JSON.stringify(smash)})`);
  const p1 = A.advance(world, army, { kind: 'move', id: rook.id, to: { f: 1, r: 3 } });
  expect(p1.ok && p1.individual && p1.moves.length === 1 && rook.r === 3 && army.king.r === 2, 'an individual move moves that piece alone');
  const p2 = A.advance(world, army, { kind: 'move', id: rook.id, to: { f: 1, r: 6 } });
  expect(p2.ok && world.at(1, 6) === FLOOR && rook.r === 6 && p2.moves[0].capture === 'furniture', 'smashing furniture is a capture: the crate is floor, the rook stands there');
  // The pawn at (2, 3): its push to (2, 4); a crate diagonal-forward at (3, 4) is a capture; the crate at (2, 5) is not on its push.
  world.setTerrain(3, 4, FURNITURE);
  const pm = A.manualMoves(world, army, pawn);
  expect(pm.some((m) => m.f === 3 && m.r === 4 && m.capture === 'furniture') && pm.some((m) => m.f === 2 && m.r === 4 && !m.capture) && pm.length === 2, `a pawn's manual moves are its push and its diagonal capture, nothing sideways (${JSON.stringify(pm)})`);
  world.setTerrain(2, 4, FURNITURE);
  const pm2 = A.manualMoves(world, army, pawn);
  expect(!pm2.some((m) => m.f === 2 && m.r === 4), 'a pawn never takes the crate dead ahead of it');
  // An enemy piece is never a capture on the map.
  world.setPiece(1, 7, 'p');
  const rm2 = A.manualMoves(world, army, rook);
  expect(!rm2.some((m) => m.f === 1 && m.r === 7), 'an enemy pawn on the rook\'s file is not a target');
  world.setPiece(1, 7, null);
  const auto = A.pieceMoves(world, army, pawn);
  expect(!auto.some((m) => m.capture) && auto.some((m) => m.f === 1 && m.r === 3), 'an automatic move list carries no captures and has the sideways king step');
}

// --- THE KING'S OWN MOVE (ruling 10): his chess move, a capture included, and the army takes its formation move with it
{
  const world = worldOf([
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
    '..........',
  ]);
  const army = A.spawnArmy(world, A.makePattern(KIT), { f: 4, r: 2 }, 0);
  const km = A.manualMoves(world, army, army.king);
  expect(km.length === 3 && km.every((m) => Math.max(Math.abs(m.f - 4), Math.abs(m.r - 2)) === 1 && m.r === 1), `the king's manual moves are his three free neighbouring cells behind him — R, N and the pawns hold the rest (${km.length})`);
  const k0 = { ...army.king };
  const plan = A.advance(world, army, { kind: 'move', id: army.king.id, to: { f: 4, r: 1 } });
  expect(plan.ok && !plan.individual && plan.pivot && army.facing === 2 && army.king.f === 4 && army.king.r === 1, `the king stepping straight back about-faces the army (facing ${army.facing}, king ${JSON.stringify(army.king)} from ${JSON.stringify(k0)})`);
  expect(onSlots(army) && army.pieces.filter((p) => p.ch === 'P').every((p) => p.r === 0), 'the army followed: the pawns are south of him on rank 0, everyone on slots');
  // A crate beside him: his capture is a step the army follows too.
  world.setTerrain(5, 1, FURNITURE);
  const cap = A.manualMoves(world, army, army.king).find((m) => m.capture === 'furniture');
  expect(cap && cap.f === 5 && cap.r === 1, `the king may smash the crate beside him (${JSON.stringify(cap)})`);
  const p2 = A.advance(world, army, { kind: 'move', id: army.king.id, to: { f: 5, r: 1 } });
  expect(p2.ok && world.at(5, 1) === FLOOR && army.king.f === 5 && p2.moves.find((m) => m.id === army.king.id)?.capture === 'furniture', 'the king smashes it and stands there');
  expect(army.facing === 1 && army.pieces.filter((p) => p.ch === 'P').every((p) => p.f === 6), `the army turned east with him and the pawns stand east of him (${army.pieces.filter((p) => p.ch === 'P').map((p) => `${p.f},${p.r}`).join(' ')})`);
}

// --- THE BOX (ruling 15): a manual move that would break it is not offered; a piece left behind the king teleports; a stuck piece teleports
{
  const world = open(24, 24);
  const army = A.spawnArmy(world, A.makePattern(KIT), { f: 10, r: 4 }, 0);
  const rook = army.pieces.find((p) => p.ch === 'R');
  const rm = A.manualMoves(world, army, rook);
  expect(rm.every((m) => m.r >= army.king.r && m.r <= army.king.r + 9 && Math.abs(m.f - army.king.f) <= 9), `the rook's manual moves stay inside the box (${rm.length} offered)`);
  expect(!rm.some((m) => m.r < army.king.r), 'no manual move goes behind the king');
  expect(rm.some((m) => m.r === army.king.r && m.f === army.king.f - 8) && !rm.some((m) => m.f === army.king.f - 9), 'a slide west to eight files off the king is offered (the knight beside him makes the span ten), nine is not');
  const box = A.boxOf(army);
  expect(box.ok && box.spread === 3 && box.left === -4 && box.kingFile === 4 && box.rect.f1 - box.rect.f0 === 9 && box.rect.r1 - box.rect.r0 === 9 && box.rect.r0 === army.king.r, `the kit's box is centred on it (left ${box.left}, king file ${box.kingFile}, rect ${JSON.stringify(box.rect)})`);
  // A pawn six behind the king in the open: it walks three (behind) and is still outside → teleported home.
  const pawn = army.pieces.find((p) => p.ch === 'P');
  pawn.r = army.king.r - 6;
  army.stamp(world);
  const plan = A.advance(world, army, WAIT);
  const m = plan.moves.find((x) => x.id === pawn.id);
  expect(m && m.teleport && plan.teleports.includes(pawn.id) && onSlots(army), `a pawn the box cannot hold teleports to its slot (${JSON.stringify(m)})`);
  // The box slides: a rook far to the right puts the king off-centre.
  rook.f = army.king.f + 8;
  army.stamp(world);
  const b2 = A.boxOf(army);
  expect(b2.ok && b2.left === -1 && b2.kingFile === 1, `the box slides to hold a rook eight files right: the king on file ${b2.kingFile}`);
  // Stuck: a knight sealed in a pocket with no hop out teleports; a knight beyond a thin wall hops home instead.
  const w3 = worldOf([
    '##########',
    '#........#',
    '#........#',
    '#........#',
    '#........#',
    '#........#',
    '#.....####',
    '#.....#.##',
    '#.....#..#',
    '##########',
  ]);
  const a3 = A.spawnArmy(w3, A.makePattern(KIT), { f: 2, r: 3 }, 0);
  const kn = a3.pieces.find((p) => p.ch === 'N');
  kn.f = 8; kn.r = 1; // a sealed pocket of three cells; every hop out lands on a wall or off the map
  a3.stamp(w3);
  const p3 = A.advance(w3, a3, WAIT);
  const mk = p3.moves.find((x) => x.id === kn.id);
  expect(mk && mk.teleport && w3.at(kn.f, kn.r) === FLOOR && kn.f >= 1 && kn.f <= 3, `a knight sealed in a pocket with no hop out teleports to the army (${JSON.stringify(mk)})\n${rows(w3)}`);
  // Beyond a thin wall with a hop back: no teleport, it hops.
  const w4 = worldOf([
    '#########',
    '#...#...#',
    '#...#...#',
    '#...#...#',
    '#...#...#',
    '#...#...#',
    '#########',
  ]);
  const a4 = A.spawnArmy(w4, A.makePattern(KIT), { f: 2, r: 2 }, 0);
  const n4 = a4.pieces.find((p) => p.ch === 'N');
  const hop = A.manualMoves(w4, a4, n4).find((m) => m.f >= 5);
  expect(hop, `the knight may hop over the thin wall into the next room (${JSON.stringify(A.manualMoves(w4, a4, n4))})`);
  A.advance(w4, a4, { kind: 'move', id: n4.id, to: hop });
  expect(n4.f >= 5, 'it stands in the next room');
  const back = A.advance(w4, a4, WAIT);
  const mb = back.moves.find((x) => x.id === n4.id);
  expect(mb && !mb.teleport && n4.f <= 3, `on the next turn it hops home on its own, no teleport (${JSON.stringify(mb)})`);
}

// --- refusals cost nothing; planTurn is pure
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
  const wall = A.planTurn(world, army, W);
  expect(!wall.ok && wall.reason === 'blocked' && wall.moves.length === 0, 'a step into a wall is refused with no moves');
  const off = A.planTurn(world, army, { kind: 'move', id: 99, to: { f: 1, r: 2 } });
  expect(!off.ok, 'a move of no piece is refused');
  expect(JSON.stringify(army.serialize()) + rows(world) === snap, 'planTurn is pure: nothing moved');
}

// --- the save round trip and the plan's determinism
{
  const world = open(12, 12);
  const army = A.spawnArmy(world, A.makePattern({ width: 5, royal: 'K', budget: 22 }, { archetype: 'scrambled', seed: 7 }), { f: 5, r: 2 }, 2);
  const obj = JSON.parse(JSON.stringify(army.serialize()));
  const back = A.Army.load(obj);
  expect(back.facing === 2 && back.at.f === army.at.f && back.at.r === army.at.r && back.pieces.length === army.pieces.length && back.king.ch === 'K' && JSON.stringify(back.pattern.slots) === JSON.stringify(army.pattern.slots) && back.pattern.anchor.dy === army.pattern.anchor.dy, 'an army serializes and loads with its anchor');
  const w2 = World.load(JSON.parse(JSON.stringify(world.serialize())));
  const p1 = A.planTurn(world, army, { kind: 'step', df: 1, dr: 1 });
  const p2 = A.planTurn(w2, back, { kind: 'step', df: 1, dr: 1 });
  expect(JSON.stringify(p1) === JSON.stringify(p2), 'the same input on the same state plans the same turn');
  const legacy = A.Army.load({ side: 'w', facing: 0, pattern: { width: 3, royal: 'K', slots: A.makePattern(KIT).slots, value: 0 }, pieces: army.pieces.map((p) => ({ ...p })) });
  expect(legacy.at.f === legacy.king.f && legacy.at.r === legacy.king.r + 1, 'an army saved without an anchor derives it from the king');
  expect(JSON.stringify(A.makePattern({ width: 4, royal: 'K', budget: 18 }, { seed: 3 })) === JSON.stringify(A.makePattern({ width: 4, royal: 'K', budget: 18 }, { seed: 3 })), 'a pattern is deterministic from its spec and seed');
  const focus = A.formationFocus(army);
  expect(Number.isFinite(focus.f) && Number.isFinite(focus.r), `the formation's focus is a point (${focus.f}, ${focus.r})`);
}

// --- THE CLUSTER (designer 2026-09-09, the third walk: "when moving with just a d-pad the army should never be split. They should stay in a battle ready cluster as much as possible"): one 8-connected body after every d-pad turn — through a door, round a pillar, through clutter, at every turn of a random walk; a piece dragged away by hand rallies back while the body stands
{
  const walkAll = (world, army, inputs, label) => {
    let splits = 0, behind = 0, turns = 0;
    for (const inp of inputs) { const p = A.advance(world, army, inp); if (!p.ok) continue; turns++; if (!A.isClustered(world, army)) splits++; if (!A.boxOf(army).ok) behind++; }
    expect(splits === 0, `${label}: one body after every turn (${splits} split turns of ${turns})\n${rows(world)}`);
    // Ruling 4, the fifth walk (2026-09-10): nobody behind the king after any input — the box is whole after every turn.
    expect(behind === 0, `${label}: nobody behind the king after any turn (${behind} turns of ${turns} with the box broken)`);
  };
  // The door: a 3-wide corridor, a one-wide door, a room beyond.
  const door = worldOf(['#######', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '###.###', '##...##', '##...##', '##...##', '##...##', '#######']);
  walkAll(door, A.spawnArmy(door, A.makePattern(KIT), { f: 3, r: 2 }, 0), Array(14).fill(N), 'through the door');
  // The pillar in front of the left pawn, and a crate pair beside the way.
  const pillar = worldOf(['..............', '..............', '..............', '....^.........', '..............', '..............', '..............', '..............', '..............', '.....#........', '.....#........', '..............', '..............', '..............', '..............', '..............']);
  const a1 = A.spawnArmy(pillar, A.makePattern(KIT), { f: 6, r: 2 }, 0);
  walkAll(pillar, a1, Array(11).fill(N), 'round the pillar');
  expect(a1.king.r >= 10, `and the army passed it (king at rank ${a1.king.r})`);
  // The cluttered hall, every direction.
  const hall = worldOf(['############', '#..........#', '#....^.....#', '#.^........#', '#.....^.^..#', '#..#.......#', '#....^..#..#', '#.^........#', '#......^...#', '#..........#', '#..^.....^.#', '#..........#', '#..........#', '############']);
  walkAll(hall, A.spawnArmy(hall, A.makePattern(KIT), { f: 5, r: 1 }, 0), [N, N, N, N, N, N, N, N, N, N, E, E, E, N, W, W, W, W, S, S, S, S, S, S, E, E, N, N, N, W, W, W], 'through the clutter');
  // A seeded random walk with diagonals and turns over the hall: never split.
  {
    const a3 = A.spawnArmy(hall, A.makePattern(KIT), { f: 5, r: 1 }, 0);
    let x = 7;
    const rnd = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
    const dirs = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
    const inputs = [];
    for (let i = 0; i < 120; i++) { const d = dirs[Math.floor(rnd() * 8)]; const n = 1 + Math.floor(rnd() * 4); for (let k = 0; k < n; k++) inputs.push({ kind: 'step', df: d[0], dr: d[1] }); }
    walkAll(hall, a3, inputs, 'a random walk through the clutter');
  }
  // A rook dragged four cells away by hand: the body stands, the rook rallies, the army is whole again within two inputs.
  {
    const open2 = open(16, 16);
    const a4 = A.spawnArmy(open2, A.makePattern(KIT), { f: 8, r: 8 }, 0);
    const rook = a4.pieces.find((p) => p.ch === 'R');
    rook.f -= 4; rook.r -= 2;
    a4.stamp(open2);
    expect(!A.isClustered(open2, a4), 'the dragged rook leaves the army in two bodies');
    const before = a4.pieces.filter((p) => p !== rook).map((p) => `${p.f},${p.r}`).join(' ');
    const p1 = A.advance(open2, a4, WAIT);
    const after = a4.pieces.filter((p) => p !== rook).map((p) => `${p.f},${p.r}`).join(' ');
    expect(p1.ok && before === after, `on a wait the body stands (${before} → ${after})`);
    expect(A.isClustered(open2, a4) && p1.moves.some((m) => m.id === rook.id && !m.teleport), `the rook rallied back on foot (${JSON.stringify(p1.moves.find((m) => m.id === rook.id))})`);
    let t = 0;
    while (!onSlots(a4) && t < 3) { A.advance(open2, a4, WAIT); t++; }
    expect(onSlots(a4), `and the formation is whole within ${t} more waits`);
  }
}

for (const b of bad) console.log(`FAIL ${b}`);
console.log(`test-army: ${ok}/${ok + bad.length} checks passed`);
process.exit(bad.length ? 1 : 0);
