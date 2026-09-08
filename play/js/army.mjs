// THE ARMY RULE — Phase 2 milestone 4b (2026-09-08): brief §5.1's ONE
// MOVEMENT RULE on the world grid, pure and Node-testable
// (phase0/harness/test-army.mjs).
//
// The army IS the avatar. A virtual d-pad moves the formation's ANCHOR —
// the king — one king step; two buttons turn the marching PATTERN a
// quarter turn around the king (a rotation COSTS A MOVE, designer
// 2026-09-08: it is a wait with a turned pattern); a wait passes a turn in
// place. Every turn, every other piece takes the single move — a king
// step OR its own chess move on the world grid (sliders blocked by
// terrain and pieces, knights hop, pawns one step forward along the
// army's facing) — that most reduces its BFS distance (walls, never
// Chebyshev) to its SLOT in the pattern. Under that one rule an army on
// open floor moves in unison, a wall in front of one piece makes the blob
// flow around it, a straggler walks home (a rook slides home in one, a
// knight hops, a bishop on the wrong colour walks, a pawn that cannot
// move backward as a pawn king-steps), and a rotation makes the army
// about-face over a few turns instead of teleporting. Conflicts resolve
// KING FIRST, then nearest-to-slot, in passes so a piece can step into a
// cell a comrade is leaving. AUTOMATIC MOVES NEVER CAPTURE (a returning
// rook stops short of a crate). An INDIVIDUAL move (tap a piece, tap a
// target) spends the turn on ONE piece and may capture — smashing
// furniture is a capture; the king never makes one (the d-pad is the
// king). A slot that is not floor sends its piece to the NEAREST FREE
// FLOOR cell to it, ties toward the king — molding on the move (brief
// §4.2's dense, centre-out fill, on the walk). Friendly pieces are
// passable to the BFS; enemies and terrain are not. A diagonal king step
// between two wall corners is allowed, chess-style, and watched.
//
// THE PATTERN is body-relative: for each slot, `dx` right of the king and
// `dy` ahead of it, with a piece letter; slot 0 is the king. The army's
// FACING (camera.mjs: 0 north … 3 west) turns the pattern into world
// deltas (rotateBody) and the camera turns with it. The pattern of a
// dealt army is its molded W×2 layout on open ground (armygen.mjs
// layoutArmy — royal rearmost, pawns in front per file).
import { normFacing } from './camera.mjs';
import { FLOOR, FURNITURE } from './world.mjs';
import { makeArmy, layoutArmy } from './armygen.mjs';
import { mulberry32 } from './prng.mjs';

export const KING_STEPS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
export const KNIGHT_HOPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const ORTHO = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const DIAG = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
/** Turn inputs: a body-relative king step (dx right, dy forward), a quarter turn, a wait, one piece's own move. */
export const INPUTS = ['step', 'turn', 'wait', 'move'];

/** A body-relative delta (dx right, dy forward) → a world delta under a facing. */
export function rotateBody(dx, dy, facing) {
  switch (normFacing(facing)) {
    case 1: return { df: dy, dr: -dx }; // facing east: forward is +f, right is south
    case 2: return { df: -dx, dr: -dy };
    case 3: return { df: -dy, dr: dx }; // facing west: forward is −f, right is north
    default: return { df: dx, dr: dy };
  }
}

/** The inverse: a world delta → body-relative under a facing. */
export function toBody(df, dr, facing) {
  switch (normFacing(facing)) {
    case 1: return { dx: -dr, dy: df };
    case 2: return { dx: -df, dy: -dr };
    case 3: return { dx: dr, dy: -df };
    default: return { dx: df, dy: dr };
  }
}

/**
 * The marching pattern of an army spec (armygen.mjs makeArmy's shape or a
 * spec for it): its molded W×2 layout on open ground, as body-relative
 * slots around the king. `archetype` orders the back row (heavies-deep /
 * minors-deep / scrambled), `seed` the draw.
 */
export function makePattern(spec, { archetype = 'heavies-deep', seed = 1 } = {}) {
  const army = spec.back ? spec : makeArmy(spec, mulberry32(seed));
  const w = army.width;
  const grid = Array.from({ length: 4 }, () => Array(w).fill(null)); // open ground, 4 ranks deep
  const laid = layoutArmy({ grid, files: w, ranks: 4, side: 'white', army, anchor: 'center', archetype, rng: mulberry32(seed + 1) });
  if (!laid) throw new Error('pattern: the army does not fit its own width');
  const king = laid.cells.find((c) => c.piece === army.royal);
  const slots = [{ ch: army.royal, dx: 0, dy: 0 }];
  for (const c of laid.cells) {
    if (c === king) continue;
    slots.push({ ch: c.piece.toUpperCase(), dx: c.f - king.f, dy: c.r - king.r });
  }
  return { width: w, royal: army.royal, slots, value: army.value };
}

/** A pattern from explicit slots (tests, a saved run). */
export function patternOf(slots) {
  return { width: 0, royal: slots[0]?.ch ?? 'K', slots: slots.map((s) => ({ ...s })), value: 0 };
}

/** The world cell a slot wants, given the king's cell and the facing. */
export function slotCell(pattern, i, king, facing) {
  const s = pattern.slots[i];
  const { df, dr } = rotateBody(s.dx, s.dy, facing);
  return { f: king.f + df, r: king.r + dr };
}

/**
 * An army on the world: `side` 'w' (the player, uppercase letters) or 'b',
 * `facing`, `pattern`, `pieces` [{ id, ch, slot, f, r }] (the king is
 * `pieces[0]`, slot 0). The world's piece grid is written from it
 * (`stamp`), never the other way.
 */
export class Army {
  constructor({ side = 'w', facing = 0, pattern, pieces = [] }) {
    this.side = side;
    this.facing = normFacing(facing);
    this.pattern = pattern;
    this.pieces = pieces;
  }

  get king() {
    return this.pieces[0];
  }

  letter(ch) {
    return this.side === 'w' ? ch.toUpperCase() : ch.toLowerCase();
  }

  /** Is this letter one of ours? */
  owns(ch) {
    return !!ch && (this.side === 'w' ? ch === ch.toUpperCase() : ch === ch.toLowerCase());
  }

  piece(id) {
    return this.pieces.find((p) => p.id === id) ?? null;
  }

  pieceAt(f, r) {
    return this.pieces.find((p) => p.f === f && p.r === r) ?? null;
  }

  /** The cell a piece's slot wants now. */
  slotOf(p) {
    return slotCell(this.pattern, p.slot, this.king, this.facing);
  }

  /** Write the pieces into the world's piece grid (clearing our old letters). */
  stamp(world) {
    for (let i = 0; i < world.pieces.length; i++) if (this.owns(world.pieces[i])) world.pieces[i] = null;
    for (const p of this.pieces) world.pieces[world.idx(p.f, p.r)] = this.letter(p.ch);
  }

  serialize() {
    return { side: this.side, facing: this.facing, pattern: { width: this.pattern.width, royal: this.pattern.royal, slots: this.pattern.slots.map((s) => ({ ...s })), value: this.pattern.value ?? 0 }, pieces: this.pieces.map((p) => ({ ...p })) };
  }

  static load(obj) {
    return new Army({ side: obj.side, facing: obj.facing, pattern: obj.pattern, pieces: (obj.pieces ?? []).map((p) => ({ ...p })) });
  }
}

/** A cell the BFS may cross: floor, no enemy piece (friendly pieces pass). */
function crossable(world, army, f, r) {
  if (world.at(f, r) !== FLOOR) return false;
  const ch = world.pieceAt(f, r);
  return !ch || army.owns(ch);
}

/** Floor with nothing on it at all (a landing cell for an automatic move). */
function vacant(world, f, r) {
  return world.at(f, r) === FLOOR && !world.pieceAt(f, r);
}

/**
 * BFS over crossable cells from a set of sources (8-connected: a king step
 * is the unit): Int32Array of distances, −1 unreached.
 */
export function distanceField(world, army, sources) {
  const n = world.size;
  const dist = new Int32Array(n).fill(-1);
  const queue = [];
  for (const s of sources) {
    if (!world.inBounds(s.f, s.r)) continue;
    const i = world.idx(s.f, s.r);
    if (dist[i] >= 0) continue;
    dist[i] = 0;
    queue.push(i);
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const f = i % world.files, r = (i - f) / world.files;
    for (const [df, dr] of KING_STEPS) {
      const nf = f + df, nr = r + dr;
      if (!crossable(world, army, nf, nr)) continue;
      const j = world.idx(nf, nr);
      if (dist[j] >= 0) continue;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  return dist;
}

/**
 * Where a slot's piece should go: the slot itself when it is crossable
 * floor reachable from the king; else the reachable crossable cell nearest
 * the slot (Chebyshev), ties toward the king (the BFS distance from it),
 * then by file and rank — molding on the move. `fromKing` is the king's
 * distance field. Null when nothing is reachable at all.
 */
export function targetOf(world, army, slot, fromKing) {
  if (world.inBounds(slot.f, slot.r) && fromKing[world.idx(slot.f, slot.r)] >= 0) return { f: slot.f, r: slot.r };
  let best = null;
  for (let i = 0; i < fromKing.length; i++) {
    if (fromKing[i] < 0) continue;
    const f = i % world.files, r = (i - f) / world.files;
    const cheb = Math.max(Math.abs(f - slot.f), Math.abs(r - slot.r));
    const key = [cheb, fromKing[i], f, r];
    if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && (key[1] < best.key[1] || (key[1] === best.key[1] && (key[2] < best.key[2] || (key[2] === best.key[2] && key[3] < best.key[3])))))) best = { f, r, key };
  }
  return best ? { f: best.f, r: best.r } : null;
}

/**
 * The single moves a piece may make on the world grid: every king step,
 * plus its own chess move — sliders along their lines until blocked by
 * terrain or any piece, the knight's hops, a pawn's one step forward along
 * the army's facing (never two; never a capture by a push). With
 * `captures` (an individual move) a landing on an ENEMY piece or on
 * FURNITURE is a capture — a pawn captures diagonally forward only, and
 * the king step captures nothing (the king's own captures come with the
 * duel, not the walk). Returns [{ f, r, capture }], capture 'piece' /
 * 'furniture' / null.
 */
export function pieceMoves(world, army, p, { captures = false, viaComrades = false } = {}) {
  const out = [];
  const seen = new Set();
  const push = (f, r, capture = null, comrade = false) => {
    if (!world.inBounds(f, r)) return;
    const key = r * world.files + f;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ f, r, capture, comrade });
  };
  // What a landing cell holds: 'free', 'comrade' (ours — a landing only
  // when the planner may count on it being vacated), 'furniture' / 'piece'
  // (a capture when allowed), 'blocked', 'off'.
  const landing = (f, r, mayCapture) => {
    if (!world.inBounds(f, r)) return 'off';
    const t = world.at(f, r);
    if (t === FURNITURE) return mayCapture ? 'furniture' : 'blocked';
    if (t !== FLOOR) return 'blocked';
    const ch = world.pieceAt(f, r);
    if (!ch) return 'free';
    return army.owns(ch) ? (viaComrades ? 'comrade' : 'blocked') : mayCapture ? 'piece' : 'blocked';
  };
  const land = (f, r, l) => {
    if (l === 'free') push(f, r);
    else if (l === 'comrade') push(f, r, null, true);
    else if (l === 'furniture' || l === 'piece') push(f, r, l);
  };
  const type = p.ch.toLowerCase();
  // The king step: any piece, one square any way, onto floor.
  for (const [df, dr] of KING_STEPS) land(p.f + df, p.r + dr, landing(p.f + df, p.r + dr, false));
  // A slider runs until something stops it; a comrade's cell can be its
  // landing (never passed through), a capture its last cell.
  const slide = (dirs) => {
    for (const [df, dr] of dirs) {
      for (let k = 1; ; k++) {
        const f = p.f + df * k, r = p.r + dr * k;
        const l = landing(f, r, captures);
        land(f, r, l);
        if (l !== 'free') break;
      }
    }
  };
  if (type === 'r' || type === 'q') slide(ORTHO);
  if (type === 'b' || type === 'q') slide(DIAG);
  if (type === 'n') for (const [df, dr] of KNIGHT_HOPS) land(p.f + df, p.r + dr, landing(p.f + df, p.r + dr, captures));
  if (type === 'p') {
    const { df, dr } = rotateBody(0, 1, army.facing);
    const l = landing(p.f + df, p.r + dr, false);
    if (l === 'free' || l === 'comrade') land(p.f + df, p.r + dr, l);
    if (captures) {
      for (const side of [-1, 1]) {
        const d = rotateBody(side, 1, army.facing);
        const l2 = landing(p.f + d.df, p.r + d.dr, true);
        if (l2 === 'furniture' || l2 === 'piece') push(p.f + d.df, p.r + d.dr, l2);
      }
    }
  }
  return out;
}

/**
 * Plan one turn (pure — nothing moves): the king's step (refused when the
 * cell is not vacant floor — a bump costs nothing), then every other piece's
 * one move toward its target. Returns { ok, facing, moves: [{ id, from, to }],
 * targets, reason }. `input` = { kind: 'step', dx, dy } (body-relative) |
 * { kind: 'turn', dir: ±1 } | { kind: 'wait' } | { kind: 'move', id, to: { f, r } }.
 */
export function planTurn(world, army, input) {
  const facing = input.kind === 'turn' ? normFacing(army.facing + (input.dir < 0 ? -1 : 1)) : army.facing;
  const king = army.king;
  const moves = [];
  const claimed = new Map(); // cell key → piece id
  const key = (f, r) => r * world.files + f;
  const at = new Map(army.pieces.map((p) => [key(p.f, p.r), p])); // current occupancy, ours
  const dest = new Map(); // id → { f, r } (the cell each piece ends on)
  for (const p of army.pieces) dest.set(p.id, { f: p.f, r: p.r });

  if (input.kind === 'move') {
    // One piece's own move; everyone else stays. The king never.
    const p = army.piece(input.id);
    if (!p || p === king) return { ok: false, reason: p ? 'the king never moves alone' : 'no such piece', facing, moves: [] };
    const legal = pieceMoves(world, army, p, { captures: true }).find((m) => m.f === input.to.f && m.r === input.to.r);
    if (!legal) return { ok: false, reason: 'not a move of that piece', facing, moves: [] };
    return { ok: true, facing, moves: [{ id: p.id, from: { f: p.f, r: p.r }, to: { f: legal.f, r: legal.r }, capture: legal.capture }], individual: true };
  }

  // The king first.
  let kingTo = { f: king.f, r: king.r };
  if (input.kind === 'step') {
    const { df, dr } = rotateBody(input.dx, input.dy, facing);
    const f = king.f + df, r = king.r + dr;
    // The king steps onto floor that is empty or held by a comrade (who is
    // then displaced — unison: the front rank vacates as the king arrives);
    // terrain and an enemy refuse the step, and a refusal costs nothing.
    const ch = world.pieceAt(f, r);
    if (world.at(f, r) !== FLOOR || (ch && !army.owns(ch))) return { ok: false, reason: 'blocked', facing, moves: [] };
    kingTo = { f, r };
  }
  claimed.set(key(kingTo.f, kingTo.r), king.id);
  dest.set(king.id, kingTo);
  if (kingTo.f !== king.f || kingTo.r !== king.r) moves.push({ id: king.id, from: { f: king.f, r: king.r }, to: kingTo });

  // The targets: each slot around the king's NEW cell under the NEW facing,
  // molded to reachable floor.
  const view = new Army({ side: army.side, facing, pattern: army.pattern, pieces: army.pieces.map((p) => (p === king ? { ...p, ...kingTo } : p)) });
  const fromKing = distanceField(world, army, [kingTo]);
  const targets = new Map();
  const fields = new Map();
  for (const p of army.pieces) {
    if (p === king) continue;
    const t = targetOf(world, army, view.slotOf(p), fromKing);
    targets.set(p.id, t);
    if (t) {
      const tk = key(t.f, t.r);
      if (!fields.has(tk)) fields.set(tk, distanceField(world, army, [t]));
    }
  }
  const distTo = (p, f, r) => {
    const t = targets.get(p.id);
    if (!t) return -1;
    const d = fields.get(key(t.f, t.r))[key(f, r)];
    return d;
  };
  // Nearest-to-slot first, then by id — the order of precedence.
  const others = army.pieces.filter((p) => p !== king).sort((a, b) => {
    const da = distTo(a, a.f, a.r), db = distTo(b, b.f, b.r);
    if (da !== db) return (da < 0 ? 1e9 : da) - (db < 0 ? 1e9 : db);
    return a.id - b.id;
  });
  // Each piece's best cell: its own (stay) or a move that strictly reduces
  // the distance; a cell held by a comrade counts as free only once that
  // comrade is known to be leaving it. Passes until nothing changes.
  const leaving = (f, r, self) => {
    const q = at.get(key(f, r));
    if (!q || q === self) return true;
    const d = dest.get(q.id);
    return d.f !== q.f || d.r !== q.r; // the comrade is going elsewhere
  };
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const p of others) {
      const cur = dest.get(p.id);
      const here = distTo(p, p.f, p.r);
      // Standing still is a candidate only while nobody has claimed the
      // cell (the king displacing this piece has); a piece that must move
      // takes its nearest reachable cell even if that is farther from home.
      const evicted = claimed.has(key(p.f, p.r)) && claimed.get(key(p.f, p.r)) !== p.id;
      let best = evicted ? { f: null, r: null, d: 1e9 } : { f: p.f, r: p.r, d: here < 0 ? 1e9 : here };
      for (const m of pieceMoves(world, army, p, { viaComrades: true })) {
        const k = key(m.f, m.r);
        const c = claimed.get(k);
        if (c !== undefined && c !== p.id) continue; // spoken for this turn
        if (!leaving(m.f, m.r, p)) continue; // a comrade stays there
        const d = distTo(p, m.f, m.r);
        if (d < 0) continue;
        if (d < best.d || (best.f === null && d <= best.d)) best = { f: m.f, r: m.r, d }; // strictly nearer; among equals the first enumerated
      }
      if (best.f === null) continue; // nowhere to go: the final check refuses the turn
      // One claim per piece — its destination.
      if (best.f !== cur.f || best.r !== cur.r) {
        if (claimed.get(key(cur.f, cur.r)) === p.id) claimed.delete(key(cur.f, cur.r));
        claimed.set(key(best.f, best.r), p.id);
        dest.set(p.id, { f: best.f, r: best.r });
        changed = true;
      } else if (!claimed.has(key(best.f, best.r))) {
        claimed.set(key(best.f, best.r), p.id);
      }
    }
    if (!changed) break;
  }
  // A comrade the king could not displace refuses the step.
  for (const p of others) {
    const d = dest.get(p.id);
    if (d.f === p.f && d.r === p.r && claimed.get(key(p.f, p.r)) !== p.id) return { ok: false, reason: 'the way is held', facing, moves: [] };
  }
  for (const p of others) {
    const d = dest.get(p.id);
    if (d.f !== p.f || d.r !== p.r) moves.push({ id: p.id, from: { f: p.f, r: p.r }, to: { f: d.f, r: d.r } });
  }
  return { ok: true, facing, moves, targets: Object.fromEntries([...targets].map(([id, t]) => [id, t])) };
}

/** Apply a plan: the army's facing and pieces, the world's piece grid;
 *  a capture removes the enemy letter or turns the furniture to floor.
 *  Returns the plan. */
export function applyTurn(world, army, plan) {
  if (!plan.ok) return plan;
  army.facing = plan.facing;
  for (const m of plan.moves) {
    const p = army.piece(m.id);
    if (m.capture === 'furniture') world.setTerrain(m.to.f, m.to.r, FLOOR);
    if (m.capture === 'piece') world.setPiece(m.to.f, m.to.r, null);
    p.f = m.to.f;
    p.r = m.to.r;
  }
  army.stamp(world);
  return plan;
}

/** Plan and apply one turn; the plan comes back (for the animation and the log). */
export function advance(world, army, input) {
  return applyTurn(world, army, planTurn(world, army, input));
}

/**
 * Put an army on the world at the king's cell, facing `facing`: each slot
 * on its cell when it is vacant floor, else the nearest vacant floor cell
 * reachable from the king (the same molding). Pieces get ids 1… in slot
 * order. Throws when the king's cell is not floor.
 */
export function spawnArmy(world, pattern, at, facing = 0, side = 'w') {
  if (world.at(at.f, at.r) !== FLOOR) throw new Error(`spawn: (${at.f}, ${at.r}) is not floor`);
  const army = new Army({ side, facing, pattern, pieces: [] });
  army.pieces.push({ id: 1, ch: pattern.slots[0].ch, slot: 0, f: at.f, r: at.r });
  const taken = new Set([world.idx(at.f, at.r)]);
  const probe = new Army({ side, facing, pattern, pieces: army.pieces });
  const fromKing = distanceField(world, probe, [at]);
  for (let i = 1; i < pattern.slots.length; i++) {
    const want = slotCell(pattern, i, at, facing);
    let cell = null;
    if (world.inBounds(want.f, want.r) && vacant(world, want.f, want.r) && !taken.has(world.idx(want.f, want.r)) && fromKing[world.idx(want.f, want.r)] >= 0) cell = want;
    else {
      let best = null;
      for (let j = 0; j < fromKing.length; j++) {
        if (fromKing[j] < 0 || taken.has(j)) continue;
        const f = j % world.files, r = (j - f) / world.files;
        if (!vacant(world, f, r)) continue;
        const cheb = Math.max(Math.abs(f - want.f), Math.abs(r - want.r));
        if (!best || cheb < best.cheb || (cheb === best.cheb && (fromKing[j] < best.d || (fromKing[j] === best.d && (f < best.f || (f === best.f && r < best.r)))))) best = { f, r, cheb, d: fromKing[j] };
      }
      if (!best) throw new Error(`spawn: no floor for slot ${i}`);
      cell = { f: best.f, r: best.r };
    }
    taken.add(world.idx(cell.f, cell.r));
    army.pieces.push({ id: i + 1, ch: pattern.slots[i].ch, slot: i, f: cell.f, r: cell.r });
  }
  army.stamp(world);
  return army;
}
