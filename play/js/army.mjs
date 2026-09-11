// THE ARMY RULE — Phase 2 milestone 4b (2026-09-08), REWRITTEN 2026-09-09
// for THE CONTROLS AND CAMERA SESSION (brief §5.1's eighteen rulings; the
// designer led it, and this module is the movement half). Pure and
// Node-testable (phase0/harness/test-army.mjs).
//
// The army IS the avatar, and the avatar is THE FORMATION, not the king
// (ruling 12 — "I'd want the pawns to file in first and the king to go
// last"; the back line will be editable, so nothing in the movement is
// special about the king). The d-pad moves the formation's ANCHOR, the
// FRONT-CENTRE cell of the pattern: it must be floor, so "blocked" means
// the front met the wall. Every piece, the king included, then takes the
// move that most reduces its BFS distance (walls, never Chebyshev) to
// its SLOT: a king step OR its own chess move on the world grid — and,
// CATCH-UP (ruling 13), a second step when its path is longer than one, a
// third while it stands behind the king, because a pawn's only walking
// move is one step, the king's own speed, and a pawn that lost a step to
// a pillar could otherwise never make it up. Inputs are WORLD-relative
// (ruling 2 — the camera is north-up on the walk): the FACING FOLLOWS THE
// STEP — a cardinal step faces that way, a diagonal keeps the facing when
// the facing is one of its two components and otherwise turns to the
// perpendicular one, never about-face — and a facing change is a PIVOT
// (ruling 14): the formation wheels in place about the king before the
// step, every piece straight to the cell it holds in the turned formation,
// molded to the ground (the nearest floor at or ahead of the king when its
// cell is stone), then the step. A teleport dressed as a slide, chosen
// because an about-face in a three-wide corridor is a sliding puzzle that
// walking cannot solve. A `face` input is the pivot alone (a move). A wait
// is the walk alone. THE ARMY ALWAYS FITS THE BOX (ruling 15): a 10×10
// with the king on its first row, slid along his rank; after every turn a
// STUCK piece — no sequence of its OWN moves reaches its slot (a knight
// beyond a thin wall has its hop back and is not stuck; a pawn waiting in
// a doorway queue is not stuck) — and any piece the box cannot hold is
// TELEPORTED to its slot ("who gives a fuck"). AUTOMATIC MOVES NEVER
// CAPTURE. A MANUAL move (tap a piece, tap a target) is an ACTUAL CHESS
// MOVE and nothing else (ruling 11): the king-step option lives only
// inside the auto move; furniture (`^`: crates, doors, everything) is
// taken only by a chess move, never by a d-pad step (a bump is a bump);
// enemy pieces are never captured on the map. A manual move that would
// break the box is not offered. THE KING'S manual move is his chess move
// — one square any way, captures included — and the army takes its
// auto-formation move with it, as if the d-pad had been tapped (ruling
// 10). Conflicts resolve FRONT ROWS FIRST, then nearest-to-slot, in passes
// so a piece can step into a cell a comrade is leaving; nobody is ever
// displaced (the king waits behind his pawns at a door).
//
// THE PATTERN is body-relative: for each slot, `dx` right of the king and
// `dy` ahead of it, with a piece letter; slot 0 is the king; `anchor` is
// the front-centre offset from the king. The army's FACING (camera.mjs: 0
// north … 3 west) turns the pattern into world deltas (rotateBody); `at`
// is the anchor's world cell — the formation's position — and the king is
// a follower with a slot like everyone else.
import { normFacing } from './camera.mjs';
import { FLOOR, FURNITURE } from './world.mjs';
import { makeArmy, layoutArmy } from './armygen.mjs';
import { mulberry32 } from './prng.mjs';

export const KING_STEPS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
export const KNIGHT_HOPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const ORTHO = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const DIAG = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
/** Turn inputs: a WORLD step (df, dr), a facing to take, a wait, one piece's own chess move. */
export const INPUTS = ['step', 'face', 'wait', 'move'];
/** THE BOX the army must always fit (ruling 15): 10×10, the king on its first row. barrier.mjs's BOX is the same number (it imports this module, so the number is restated here). */
export const BOX = 10;
/**
 * THE OPENING KIT (brief §4.2; designer 2026-09-10, the enemies session):
 * K + R + N + B and FOUR pawns, value 15 — the ONE constant every reader
 * imports (the page's walk, the generator's start and its lints, the
 * harnesses; it was copy-pasted in six places before). The molder lays it
 * N K R B over P P P P: a width of four has no middle, so the king stands
 * second from the left and the anchor on his file.
 */
export const OPENING_KIT = Object.freeze({ width: 4, royal: 'K', pieces: Object.freeze(['R', 'N', 'B']) });
/** CATCH-UP (ruling 13): steps a turn when the path is longer than one, and while behind the king. */
export const CATCH_UP = 2;
export const CATCH_UP_BEHIND = 3;
/**
 * THIS SIDE OF THE WALL (2026-09-09, the walk-stress harness: the molding
 * ranked cells by straight-line distance to a slot with reachability a
 * yes-or-no, so a slot across a one-thick wall counted as near and the
 * army split around it, 6489 teleports in 11 191 random turns). A cell is
 * DIRECT from the king when the path to it through floor is no longer
 * than the straight line plus this slack — a pillar or a crate pair is
 * flowed around, a wall never is. Every molding, the anchor's step and
 * the spawn use it.
 */
export const DIRECT_SLACK = 2;

/** THE KING'S LEASH (designer 2026-09-09, on the first walk of the build: "the king is lagging behind sometimes… I shouldn't be seeing this without manual moves"): a step that would leave the king more than this many cells from his slot becomes a REGROUP — the anchor holds, the walk still runs, nobody is refused. */
export const KING_LEASH = 2;
/**
 * THE DETOUR (2026-09-09, the walk-stress harness): a piece walking round
 * a crate pair may pass this many cells behind the king ON THE WAY — it
 * never ENDS there (the box invariant is kept by the walk itself). And a
 * way round the comrades longer than the straight way through them by
 * more than DETOUR_MAX is not walked at all: the piece QUEUES behind them
 * instead — the king at a doorway walks up to the room his rook fills
 * rather than round the outside of the building.
 */
export const DETOUR = 2;
export const DETOUR_MAX = 3;
/** A molded cell behind the king's TARGET costs this many cells of distance per rank behind (never behind the king's own cell at all). */
export const BEHIND_COST = 2;

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
 * THE FACING AFTER A STEP (ruling 2): a cardinal step faces that way; a
 * diagonal keeps the facing when the facing is one of its two components
 * and otherwise turns to the perpendicular component — never about-face.
 * The rule has no ties.
 */
export function facingOfStep(facing, df, dr) {
  const f = normFacing(facing);
  df = Math.sign(df | 0);
  dr = Math.sign(dr | 0);
  if (!df && !dr) return f;
  if (!df) return dr > 0 ? 0 : 2;
  if (!dr) return df > 0 ? 1 : 3;
  const a = dr > 0 ? 0 : 2, b = df > 0 ? 1 : 3;
  if (f === a || f === b) return f;
  return (a + 2) % 4 === f ? b : a;
}

/** The front-centre offset of a slot list: the front row's centre file (the king's file when within half a cell of it), the front row's depth. */
function anchorOfSlots(slots) {
  const front = slots.reduce((m, s) => Math.max(m, s.dy), 0);
  const row = slots.filter((s) => s.dy === front);
  const mean = row.length ? row.reduce((a, s) => a + s.dx, 0) / row.length : 0;
  return { dx: Math.abs(mean) <= 0.5 ? 0 : Math.round(mean), dy: front };
}

/**
 * The marching pattern of an army spec (armygen.mjs makeArmy's shape or a
 * spec for it): its molded W×2 layout on open ground, as body-relative
 * slots around the king, plus the front-centre `anchor`. `archetype` orders
 * the back row (heavies-deep / minors-deep / scrambled), `seed` the draw.
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
  return { width: w, royal: army.royal, slots, value: army.value, anchor: anchorOfSlots(slots) };
}

/** A pattern from explicit slots (tests, a saved run). */
export function patternOf(slots) {
  const s = slots.map((x) => ({ ...x }));
  return { width: 0, royal: s[0]?.ch ?? 'K', slots: s, value: 0, anchor: anchorOfSlots(s) };
}

/** The pattern's front-centre offset from the king (a pattern saved without one is measured). */
export function anchorOf(pattern) {
  return pattern.anchor ?? anchorOfSlots(pattern.slots);
}

/**
 * The carried pattern as the deal's BAG (armygen.mjs makeArmy's shape:
 * width = the pawn count, `back` the non-royal pieces IN SLOT ORDER), so
 * the barrier can re-mold it onto a crop with `order: 'as-given'`.
 */
export function bagOfPattern(pattern) {
  const rest = pattern.slots.slice(1).map((s) => s.ch.toUpperCase());
  const back = rest.filter((ch) => ch !== 'P');
  const pawns = rest.length - back.length;
  return { width: pawns || pattern.width || back.length + 1, royal: pattern.royal ?? pattern.slots[0]?.ch ?? 'K', back, value: pattern.value ?? 0 };
}

/** The world cell a slot wants, given the ANCHOR's cell and the facing. */
export function slotCell(pattern, i, at, facing) {
  const a = anchorOf(pattern);
  const s = pattern.slots[i];
  const { df, dr } = rotateBody(s.dx - a.dx, s.dy - a.dy, facing);
  return { f: at.f + df, r: at.r + dr };
}

/** The anchor's cell for a king standing on `king` at a facing (the king on his slot). */
export function anchorCell(pattern, king, facing) {
  const a = anchorOf(pattern);
  const { df, dr } = rotateBody(a.dx, a.dy, facing);
  return { f: king.f + df, r: king.r + dr };
}

/**
 * An army on the world: `side` 'w' (the player, uppercase letters) or 'b',
 * `facing`, `pattern`, `at` (the anchor's cell — the formation's position),
 * `pieces` [{ id, ch, slot, f, r }] (the king is `pieces[0]`, slot 0). The
 * world's piece grid is written from it (`stamp`), never the other way.
 */
export class Army {
  constructor({ side = 'w', facing = 0, pattern, pieces = [], at = null }) {
    this.side = side;
    this.facing = normFacing(facing);
    this.pattern = pattern;
    this.pieces = pieces;
    this.at = at ? { f: at.f, r: at.r } : pieces[0] ? anchorCell(pattern, pieces[0], this.facing) : { f: 0, r: 0 };
    this.stamped = null; // the cells its letters hold (stamp / remember)
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
    return slotCell(this.pattern, p.slot, this.at, this.facing);
  }

  /**
   * Write the pieces into the world's piece grid, clearing THE CELLS THIS
   * ARMY LAST WROTE and no others (milestone 6: two enemy armies share the
   * lowercase letters, and the old stamp cleared every letter of its side
   * — the second army erased the first). `stamped` is the set of cells it
   * holds; an army built from a save learns it on its first turn
   * (applyTurn) from its pieces' cells, which is where its letters are.
   */
  stamp(world) {
    const keep = new Set(this.pieces.map((p) => world.idx(p.f, p.r)));
    for (const i of this.stamped ?? []) if (!keep.has(i) && this.owns(world.pieces[i])) world.pieces[i] = null;
    for (const p of this.pieces) world.pieces[world.idx(p.f, p.r)] = this.letter(p.ch);
    this.stamped = keep;
  }

  /** Remember the cells this army's letters stand on (an army loaded from a save, before its first stamp). */
  remember(world) {
    if (!this.stamped) this.stamped = new Set(this.pieces.map((p) => world.idx(p.f, p.r)));
  }

  /** Take the army's letters OFF the world (a duel's drop, a bystander lifted out of the box); the pieces keep their cells. */
  lift(world) {
    for (const p of this.pieces) {
      const i = world.idx(p.f, p.r);
      if (this.owns(world.pieces[i])) world.pieces[i] = null;
    }
    this.stamped = new Set();
  }

  serialize() {
    const a = anchorOf(this.pattern);
    return { side: this.side, facing: this.facing, at: { ...this.at }, pattern: { width: this.pattern.width, royal: this.pattern.royal, slots: this.pattern.slots.map((s) => ({ ...s })), value: this.pattern.value ?? 0, anchor: { ...a } }, pieces: this.pieces.map((p) => ({ ...p })) };
  }

  static load(obj) {
    return new Army({ side: obj.side, facing: obj.facing, pattern: obj.pattern, at: obj.at ?? null, pieces: (obj.pieces ?? []).map((p) => ({ ...p })) });
  }
}

const key = (world, f, r) => r * world.files + f;
const cellOf = (p) => ({ f: p.f, r: p.r });

/** An enemy letter on a cell? */
function enemyAt(world, army, f, r) {
  const ch = world.pieceAt(f, r);
  return !!ch && !army.owns(ch);
}

/** A cell the BFS may cross: floor, no enemy piece (friendly pieces pass). */
function crossable(world, army, f, r) {
  return world.at(f, r) === FLOOR && !enemyAt(world, army, f, r);
}

/**
 * BFS over crossable cells from a set of sources (8-connected: a king step
 * is the unit): Int32Array of distances, −1 unreached.
 */
export function distanceField(world, army, sources, blocked = null, allow = null) {
  const n = world.size;
  const dist = new Int32Array(n).fill(-1);
  const queue = [];
  for (const s of sources) {
    if (!s || !world.inBounds(s.f, s.r)) continue;
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
      if (dist[j] >= 0 || (blocked && blocked.has(j)) || (allow && !allow(nf, nr))) continue;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  return dist;
}

/** Is (f, r) on the king's side of the walls: reachable, by a path no longer than the straight line plus DIRECT_SLACK? */
function directFrom(world, field, kc) {
  return (f, r) => {
    if (!world.inBounds(f, r)) return false;
    const d = field[world.idx(f, r)];
    return d >= 0 && d <= Math.max(Math.abs(f - kc.f), Math.abs(r - kc.r)) + DIRECT_SLACK;
  };
}

/** Body coordinates of a cell relative to the king under a facing. */
function bodyOf(cell, king, facing) {
  return toBody(cell.f - king.f, cell.r - king.r, facing);
}

/**
 * The nearest cell to `want` for a piece: `want` itself when it is floor,
 * reachable (the `field` from the king) and not `taken`; else the reachable
 * floor cell nearest it (Chebyshev), AT OR AHEAD OF THE KING first (a cell
 * behind him only when nothing else is left), ties toward the king (its
 * BFS distance), then by file and rank. Null when nothing is free.
 */
function placeNear(world, army, field, taken, want, king, facing, near = null) {
  const direct = directFrom(world, field, king);
  let adj = null; // the cells touching `near` (a list of cells): a teleport lands beside the body, never across a wall's corner
  if (near) {
    adj = new Set();
    for (const c of near) for (const [df, dr] of KING_STEPS) if (world.inBounds(c.f + df, c.r + dr) && touching(world, army, c, { f: c.f + df, r: c.r + dr })) adj.add(world.idx(c.f + df, c.r + dr));
  }
  const ok = (f, r) => world.inBounds(f, r) && world.at(f, r) === FLOOR && direct(f, r) && !taken.has(world.idx(f, r)) && !enemyAt(world, army, f, r) && (!adj || adj.has(world.idx(f, r)));
  if (ok(want.f, want.r)) return { f: want.f, r: want.r };
  let best = null;
  for (let i = 0; i < field.length; i++) {
    if (field[i] < 0 || taken.has(i)) continue;
    const f = i % world.files, r = (i - f) / world.files;
    if (!ok(f, r)) continue;
    const behind = bodyOf({ f, r }, king, facing).dy < 0 ? 1 : 0;
    const cheb = Math.max(Math.abs(f - want.f), Math.abs(r - want.r));
    const k = [behind, cheb, field[i], f, r];
    if (!best || lexLess(k, best.k)) best = { f, r, k };
  }
  return best ? { f: best.f, r: best.r } : null;
}

function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/**
 * Where a slot's piece should go on a walk: the slot itself when it is
 * crossable floor DIRECT from the king (this side of the walls) and not
 * `taken`; else the direct cell nearest the slot (Chebyshev), AT OR AHEAD
 * OF `origin` first — the king's own target for every other piece (2026-
 * 09-09, the walk-stress harness: measured from the king's CURRENT cell,
 * a piece whose slot was stone parked itself between the king and his
 * slot, then stood there at its target while he could not pass; measured
 * from where he is GOING, nobody molds into his approach), the row of
 * his own slot for the king (`royal`: never ahead of it) — ties toward
 * the king (`tie`, a BFS field), then by file and rank. `taken` (cell
 * indices) makes the targets of a walk UNIQUE: two pieces whose slots are
 * stone no longer mold to one cell; `near` (cell indices) admits only
 * cells BESIDE one of them — the connected formation (see
 * `assignTargets`). Null when the constraints leave nothing.
 */
export function targetOf(world, army, slot, fromKing, king, facing, { tie = fromKing, royal = false, origin = king, floorAt = null, taken = null, near = null, corners = false } = {}) {
  const direct = king ? directFrom(world, fromKing, king) : (f, r) => world.inBounds(f, r) && fromKing[world.idx(f, r)] >= 0;
  let adj = null; // the cells TOUCHING `near` (never across a wall's corner — unless `corners`: the body's adjacency)
  if (near) {
    adj = new Set();
    for (const i of near) {
      const f = i % world.files, r = (i - f) / world.files;
      for (const [df, dr] of KING_STEPS) if (world.inBounds(f + df, r + dr) && (corners || touching(world, army, { f, r }, { f: f + df, r: r + dr }))) adj.add(world.idx(f + df, r + dr));
    }
  }
  const open = (f, r) => world.inBounds(f, r) && (!taken || !taken.has(world.idx(f, r))) && (!adj || adj.has(world.idx(f, r))) && !(floorAt && bodyOf({ f, r }, floorAt, facing).dy < 0);
  if (direct(slot.f, slot.r) && open(slot.f, slot.r)) return { f: slot.f, r: slot.r };
  let best = null;
  for (let i = 0; i < fromKing.length; i++) {
    if (fromKing[i] < 0 || (taken && taken.has(i)) || (adj && !adj.has(i))) continue;
    const f = i % world.files, r = (i - f) / world.files;
    if (!direct(f, r)) continue;
    // A piece molds NEVER BEHIND THE KING'S CELL (`floorAt`, the box
    // invariant's row) and at or ahead of his TARGET by preference — a
    // cell behind that costs BEHIND_COST per rank, so a pawn stopped by a
    // closed door stands beside the king rather than six cells along the
    // wall (2026-09-09, the stress harness: a hard rule sent the whole
    // front row sideways). THE KING himself never ahead of his own row
    // (his slot's row) — a king whose slot is stone stands beside or
    // behind it, never in the front rank.
    if (floorAt && bodyOf({ f, r }, floorAt, facing).dy < 0) continue;
    const penalty = royal ? (bodyOf({ f, r }, slot, facing).dy > 0 ? 1 : 0) : 0;
    const behind = !royal && origin ? Math.max(0, -bodyOf({ f, r }, origin, facing).dy) : 0;
    const cheb = Math.max(Math.abs(f - slot.f), Math.abs(r - slot.r));
    const k = [penalty, cheb + BEHIND_COST * behind, tie[i] < 0 ? 1e9 : tie[i], f, r];
    if (!best || lexLess(k, best.k)) best = { f, r, k };
  }
  return best ? { f: best.f, r: best.r } : null;
}

/**
 * THE KING'S SIDESTEPS (2026-09-10, the fifth walk): the cells one king
 * step from `kc` on free floor level with him or a rank back — never
 * forward — level first, then back, each nearest-first; where the
 * comrades can move only through his cell, he gives it up and goes last.
 */
function sidesteps(world, army, kc, facing) {
  return KING_STEPS.map(([df, dr]) => ({ f: kc.f + df, r: kc.r + dr, dy: toBody(df, dr, facing).dy, dx: Math.abs(toBody(df, dr, facing).dx) }))
    .filter((c) => c.dy <= 0 && c.dy >= -1 && world.inBounds(c.f, c.r) && world.at(c.f, c.r) === FLOOR && !world.pieceAt(c.f, c.r))
    .sort((a, b) => b.dy - a.dy || a.dx - b.dx || a.f - b.f || a.r - b.r)
    .map((c) => ({ f: c.f, r: c.r }));
}

/**
 * MAY THE ANCHOR STEP HERE? The anchor is a cell of the formation, not a
 * piece: floor, or stone ONE cell deep — a pillar or a crate in front of
 * the middle pawn is FLOWED AROUND (designer 2026-09-09: "bumping into
 * single blocks the army should just be able to flow around") — as long
 * as the cell, or a floor neighbour of it, is DIRECT from the king (this
 * side of the walls: never through a wall into the next room); never off
 * the map, never an enemy. A solid wall is refused by the walk instead: a
 * step that moves nobody is "blocked".
 */
function anchorMay(world, army, to, fromKing, kc, facing = army.facing) {
  if (!world.inBounds(to.f, to.r) || enemyAt(world, army, to.f, to.r)) return false;
  const direct = directFrom(world, fromKing, kc);
  if (world.at(to.f, to.r) === FLOOR) return direct(to.f, to.r);
  // The floor beside the stone must be BESIDE OR AHEAD of it (2026-09-10,
  // the fifth walk: at a dead end's wall the floor behind the stone let the
  // anchor in, and the slots molded beyond the wall sent the army on a
  // tour round the map).
  for (const [df, dr] of KING_STEPS) {
    const f = to.f + df, r = to.r + dr;
    if (toBody(df, dr, facing).dy < 0) continue;
    if (world.inBounds(f, r) && world.at(f, r) === FLOOR && direct(f, r)) return true;
  }
  return false;
}

/**
 * The single moves a piece may make on the world grid.
 *
 * AUTO (the formation move, default): every king step, plus its own chess
 * move — sliders along their lines until blocked by terrain or any piece,
 * the knight's hops, a pawn's one step forward along the facing — never a
 * capture. `viaComrades` marks a comrade's cell as a landing (the planner
 * counts on it being vacated). MANUAL (ruling 11): the piece's ACTUAL
 * CHESS MOVES and nothing else — the king his one square any way, a pawn
 * its push and its diagonal captures, sliders and the knight their own —
 * with FURNITURE a capture ('furniture'); enemy pieces are never captured
 * on the map. Returns [{ f, r, capture, comrade }].
 */
export function pieceMoves(world, army, p, { manual = false, viaComrades = false, facing = army.facing } = {}) {
  const out = [];
  const seen = new Set();
  const push = (f, r, capture = null, comrade = false) => {
    if (!world.inBounds(f, r)) return;
    const k = r * world.files + f;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ f, r, capture, comrade });
  };
  const landing = (f, r, mayCapture) => {
    if (!world.inBounds(f, r)) return 'off';
    const t = world.at(f, r);
    if (t === FURNITURE) return mayCapture ? 'furniture' : 'blocked';
    if (t !== FLOOR) return 'blocked';
    const ch = world.pieceAt(f, r);
    if (!ch) return 'free';
    return army.owns(ch) ? (viaComrades ? 'comrade' : 'blocked') : 'blocked';
  };
  const land = (f, r, l) => {
    if (l === 'free') push(f, r);
    else if (l === 'comrade') push(f, r, null, true);
    else if (l === 'furniture') push(f, r, l);
  };
  const type = p.ch.toLowerCase();
  const isKing = type === 'k';
  // The king step: the auto move of any piece, and the king's own chess move (a capture, manually).
  if (!manual || isKing) for (const [df, dr] of KING_STEPS) land(p.f + df, p.r + dr, landing(p.f + df, p.r + dr, manual && isKing));
  const slide = (dirs) => {
    for (const [df, dr] of dirs) {
      for (let k = 1; ; k++) {
        const f = p.f + df * k, r = p.r + dr * k;
        const l = landing(f, r, manual);
        land(f, r, l);
        if (l !== 'free') break;
      }
    }
  };
  if (type === 'r' || type === 'q') slide(ORTHO);
  if (type === 'b' || type === 'q') slide(DIAG);
  if (type === 'n') for (const [df, dr] of KNIGHT_HOPS) land(p.f + df, p.r + dr, landing(p.f + df, p.r + dr, manual));
  if (type === 'p') {
    const { df, dr } = rotateBody(0, 1, facing);
    const l = landing(p.f + df, p.r + dr, false);
    if (l === 'free' || l === 'comrade') land(p.f + df, p.r + dr, l);
    if (manual) {
      for (const side of [-1, 1]) {
        const d = rotateBody(side, 1, facing);
        const l2 = landing(p.f + d.df, p.r + d.dr, true);
        if (l2 === 'furniture') push(p.f + d.df, p.r + d.dr, l2);
      }
    }
  }
  return out;
}

/**
 * THE BOX (ruling 15) over an army's pieces as they stand (or `cells`, a
 * map id → cell, for a hypothetical): body coordinates relative to the
 * king; `ok` when every piece is within nine ranks ahead of him, none
 * behind, and the files span at most ten. `left` is the box's left edge
 * (in dx) — the offset that CENTRES the formation when there is slack,
 * clamped so every piece is inside — and `kingFile` the king's arena file
 * in it. `rect` is the box in world cells { f0, r0, f1, r1 }.
 */
export function boxOf(army, cells = null, facing = army.facing) {
  const king = army.king;
  const kc = cells ? cells.get(king.id) : cellOf(king);
  facing = normFacing(facing);
  let minDx = 0, maxDx = 0, maxDy = 0, minDy = 0;
  for (const p of army.pieces) {
    const c = cells ? cells.get(p.id) : p;
    const b = bodyOf(c, kc, facing);
    if (b.dx < minDx) minDx = b.dx;
    if (b.dx > maxDx) maxDx = b.dx;
    if (b.dy > maxDy) maxDy = b.dy;
    if (b.dy < minDy) minDy = b.dy;
  }
  const spread = maxDx - minDx + 1;
  const ok = minDy >= 0 && maxDy < BOX && spread <= BOX;
  const centre = (minDx + maxDx) / 2;
  const lo = maxDx - (BOX - 1), hi = minDx;
  const left = Math.max(lo, Math.min(hi, Math.round(centre - (BOX - 1) / 2)));
  const corners = [[left, 0], [left + BOX - 1, 0], [left, BOX - 1], [left + BOX - 1, BOX - 1]].map(([dx, dy]) => { const d = rotateBody(dx, dy, facing); return { f: kc.f + d.df, r: kc.r + d.dr }; });
  const rect = { f0: Math.min(...corners.map((c) => c.f)), r0: Math.min(...corners.map((c) => c.r)), f1: Math.max(...corners.map((c) => c.f)), r1: Math.max(...corners.map((c) => c.r)) };
  return { ok, minDx, maxDx, minDy, maxDy, spread, left, kingFile: -left, rect };
}

/** Does the army still fit the box with piece `p` on `to`? (Nobody behind the king after any input — the fifth walk — so the box is whole before every manual move.) */
function fitsWith(army, p, to) {
  const cells = new Map(army.pieces.map((q) => [q.id, cellOf(q)]));
  cells.set(p.id, to);
  return boxOf(army, cells).ok;
}

/**
 * THE MANUAL MOVES of a piece (ruling 11 + 15): its actual chess moves,
 * furniture a capture, minus any that would break the box. The king's
 * own move shifts the box with him, so his are filtered on the files' span
 * alone (whatever his step leaves behind him is walked or teleported after).
 */
export function manualMoves(world, army, p) {
  const all = pieceMoves(world, army, p, { manual: true });
  if (p === army.king) {
    return all.filter((m) => {
      const cells = new Map(army.pieces.map((q) => [q.id, cellOf(q)]));
      cells.set(p.id, { f: m.f, r: m.r });
      return boxOf(army, cells).spread <= BOX;
    });
  }
  return all.filter((m) => fitsWith(army, p, { f: m.f, r: m.r }));
}

/**
 * THE PIVOT (ruling 14): every piece's cell in the formation turned to
 * `facing` about the king's cell `kc` — its slot when that is floor free
 * of enemies and not yet taken, else the nearest such floor reachable from
 * the king, at or ahead of him first. Own pieces are all in motion, so they
 * never block. A piece with nowhere to go keeps its cell. Returns a map
 * id → cell (the king on `kc`).
 */
export function pivotPlacement(world, army, facing, kc) {
  const king = army.king;
  const at = anchorCell(army.pattern, kc, facing);
  const field = distanceField(world, army, [kc]);
  const targets = assignTargets(world, army, at, facing, kc, field, field, { id: king.id, to: { f: kc.f, r: kc.r } });
  const placed = new Map();
  for (const p of army.pieces) placed.set(p.id, p === king ? { f: kc.f, r: kc.r } : (targets.get(p.id) ?? cellOf(p)));
  return placed;
}

/**
 * TOUCHING, the adjacency a TARGET is molded by: a king step apart, and a
 * diagonal only when one of its two orthogonal cells is crossable — no
 * slot is ever given across a wall's corner (that corner was how pieces
 * slipped onto the far side of thin walls and walked a parallel corridor,
 * the designer's second and third walks).
 */
function touching(world, army, a, b) {
  const df = b.f - a.f, dr = b.r - a.r;
  if (Math.max(Math.abs(df), Math.abs(dr)) !== 1) return false;
  if (df === 0 || dr === 0) return true;
  return crossable(world, army, a.f + df, a.r) || crossable(world, army, a.f, a.r + dr);
}

/**
 * ADJACENT, the BODY's adjacency: a king step apart, corners included
 * (2026-09-10, the fourth walk: judged by `touching`, an army whose only
 * way out of a pocket was the diagonal between a crate and a wall could
 * never pass it as one body — the first piece through was "split off" —
 * so it stood blocked, or a piece already past walked on alone; two pieces
 * on the screen's diagonal ARE together, and the targets, never molded
 * across a corner, pull the body through the gap and compact again).
 */
function adjacent(a, b) {
  return Math.max(Math.abs(b.f - a.f), Math.abs(b.r - a.r)) === 1;
}

/**
 * BEHIND THE KING: a cell behind his row — STRICT (2026-09-10, the fifth
 * walk: "I'm now getting situations where pieces end up behind the king";
 * the third and fourth walks had tolerated one, then two ranks behind).
 * Ruling 4: nobody is ever behind the king after an input — the rope
 * holds the king back for a comrade still on its way, and a comrade that
 * cannot move at all while he must is stuck and teleports beside the body.
 */
function behindKing(world, army, c, kd, facing) {
  return bodyOf(c, kd, facing).dy < 0;
}

/** The ids of the king's BODY: the pieces adjacent to him through `cells` (id → cell), by chains of adjacency. */
function kingComponent(world, army, cells, skip = null) {
  const seen = new Set([army.king.id]);
  const stack = [army.king.id];
  while (stack.length) {
    const c = cells.get(stack.pop());
    for (const q of army.pieces) {
      if (seen.has(q.id) || (skip && skip.has(q.id))) continue;
      if (adjacent(c, cells.get(q.id))) { seen.add(q.id); stack.push(q.id); }
    }
  }
  return seen;
}

/** THE CLUSTER: is the army one body (as it stands, or on `cells`)? */
export function isClustered(world, army, cells = null) {
  return kingComponent(world, army, cells ?? new Map(army.pieces.map((p) => [p.id, cellOf(p)]))).size === army.pieces.length;
}

/**
 * THE ROPE (2026-09-09, the fourth walk: "they're much better at staying
 * together, but now I'm getting blocked in a lot of places I feel
 * shouldn't be a problem" — the greedy retraction of the third walk gave
 * back the whole walk whenever one pocketed pawn could not be reconnected,
 * and the step read as blocked): the army is settled as a ROPE from the
 * king outward. The pieces are ordered by their chain distance from the
 * king as they STAND (each with the parent that links it toward him); the
 * king takes his walk cell, and every piece after him takes the FARTHEST
 * cell on its walk path that is adjacent to a piece already settled — never a
 * cell taken, never one behind the king (unless it started there). A piece
 * with nothing to touch pulls its chain back: the piece in its start cell
 * if one took it, else its nearest ancestor with a step left, gives back a
 * step and the rope is laid again; a laggard with no step at all that
 * stone stopped (not a comrade — `queued`) is STUCK instead and teleports
 * beside the body. A piece the start already left split (moved away by
 * hand) takes its farthest free cell and converges. Mutates `walked`
 * (dest, vias, stuck); returns whether the army is one body at the end.
 */
function ropeSettle(world, army, cells, walked, facing, { breaker = false } = {}) {
  const king = army.king;
  const kingStart = cells.get(king.id);
  const idx = (c) => world.idx(c.f, c.r);
  const paths = new Map();
  for (const p of army.pieces) {
    const d = walked.dest.get(p.id), st = cells.get(p.id);
    const moved = d.f !== st.f || d.r !== st.r;
    paths.set(p.id, moved ? [st, ...(walked.vias.get(p.id) ?? []), d] : [st]);
  }
  const cap = new Map(army.pieces.map((p) => [p.id, paths.get(p.id).length - 1]));
  const cap0 = new Map(cap); // the walk's own steps: a piece the walk could not move at all is a laggard; one the chain pulled back is not
  // The chain as the army stands: BFS from the king over adjacent cells.
  const parent = new Map([[king.id, null]]);
  const order = [king.id];
  for (let i = 0; i < order.length; i++) {
    const c = cells.get(order[i]);
    for (const q of army.pieces) {
      if (parent.has(q.id)) continue;
      if (adjacent(c, cells.get(q.id))) { parent.set(q.id, order[i]); order.push(q.id); }
    }
  }
  const loose = army.pieces.filter((p) => !parent.has(p.id)).map((p) => p.id); // split before the walk began
  for (const id of loose) { parent.set(id, null); order.push(id); }
  const stuck = new Set(walked.stuck);
  const queued = walked.queued ?? new Set();
  const noFollow = new Set();
  // THE FOLLOW STEP: a piece with no cell on its path that touches the body
  // takes ONE move of its own — the king step or its own chess move — to a
  // free floor cell adjacent to a settled comrade, the one nearest its target
  // (a rook that slid north while the king rounded a wall's east end steps
  // east after him instead of holding the whole army back).
  const fields = new Map();
  const toTarget = (id, c) => {
    const t = walked.targets?.get(id);
    if (!t) return 1e9;
    const k = world.idx(t.f, t.r);
    if (!fields.has(k)) fields.set(k, distanceField(world, army, [t]));
    const d = fields.get(k)[idx(c)];
    return d < 0 ? 1e9 : d;
  };
  // NO SWAPS: a piece is never laid on the start of the piece laid on its
  // own start (two pawns in a pocket traded cells every turn through the
  // follow step and read as progress).
  const startOwner = new Map([...cells].map(([id, c]) => [idx(c), id]));
  const swapOf = (chosen, id, start, c) => { const q = startOwner.get(idx(c)); return q !== undefined && q !== id && chosen.has(q) && idx(chosen.get(q)) === idx(start); };
  // THE BREAKER (`breaker`, the LAST RESORT before a step is refused —
  // 2026-09-10, the fifth walk; planTurn tries the king's SIDESTEP
  // first): the king has given back every step for a comrade and the lay
  // moves NOBODY — that comrade can move only through his cell (a
  // pocket's mouth, a gap he stands before), or by a way round the walk
  // never takes (a wall spur's far side) — so waiting would hold the army
  // for good: that comrade is STUCK (it teleports beside the body, ahead
  // of him — ruling 15's "just teleport pieces that get stuck
  // somewhere") and the lay runs again from the walk's own steps.
  let kingBlocker = null;
  for (let lay = 0; lay < 16 * army.pieces.length + 16; lay++) {
    const chosen = new Map();
    const followed = new Map(); // id → the via cells of its follow
    const taken = new Map(); // cell index → id
    for (const id of stuck) taken.set(idx(cells.get(id)), id); // a stuck piece stands where it is until its teleport
    const kPath = paths.get(king.id);
    const kc = kPath[cap.get(king.id)];
    chosen.set(king.id, kc);
    taken.set(idx(kc), king.id);
    let failed = null;
    // A piece that cannot take its WHOLE path is DEFERRED once — laid again
    // after the rest, when the comrade it would touch, or the one that fills
    // the cell it leaves, may have been laid (the chain is laid in the order
    // the pieces stand: a pawn whose way to the body ran through the cell of
    // a pawn laid after it fell back and its chain pulled the king to the
    // start; a pawn ahead of a corner could not step into it until the pawn
    // behind it was laid in its cell: 2026-09-10, the fourth walk).
    const queue = [...order];
    const deferred = new Set();
    for (let qi = 0; qi < queue.length; qi++) {
      const id = queue[qi];
      if (id === king.id || stuck.has(id)) continue;
      const p = army.piece(id);
      const path = paths.get(id);
      const start = path[0];
      const startBad = behindKing(world, army, start, kingStart, facing);
      const free = (c) => !taken.has(idx(c)) && !swapOf(chosen, id, start, c) && (startBad || !behindKing(world, army, c, kc, facing));
      const touchesBody = (c) => { for (const q of chosen.values()) if (adjacent(c, q)) return true; return false; };
      let pick = -1;
      for (let i = cap.get(id); i >= 0; i--) {
        const c = path[i];
        if (free(c) && touchesBody(c)) { pick = i; break; }
      }
      if (pick < cap.get(id) && !deferred.has(id)) { deferred.add(id); queue.push(id); continue; }
      if (pick >= 0) { chosen.set(id, path[pick]); taken.set(idx(path[pick]), id); continue; }
      if (!noFollow.has(id)) {
        // The follow: up to CATCH_UP_BEHIND of its own moves through free floor
        // (never a comrade still standing, never a cell taken or behind the
        // king) to the NEAREST cell adjacent to the body, ties toward its target.
        const standing = new Set();
        for (const q of army.pieces) if (q.id !== id && !chosen.has(q.id)) standing.add(idx(cells.get(q.id)));
        const passable = (c) => world.at(c.f, c.r) === FLOOR && !enemyAt(world, army, c.f, c.r) && !standing.has(idx(c)) && free(c);
        const seen = new Map([[idx(start), null]]);
        let frontier = [start];
        let best = null;
        for (let depth = 1; depth <= CATCH_UP_BEHIND && !best && frontier.length; depth++) {
          const next = [];
          for (const from of frontier) {
            for (const m of pieceMoves(world, army, { ...p, f: from.f, r: from.r }, { viaComrades: true, facing })) {
              const c = { f: m.f, r: m.r };
              if (m.capture || seen.has(idx(c)) || !passable(c)) continue;
              seen.set(idx(c), from);
              next.push(c);
              if (touchesBody(c)) { const d = toTarget(id, c); if (!best || d < best.d) best = { c, d }; }
            }
          }
          frontier = next;
        }
        if (best) {
          const via = [];
          for (let c = seen.get(idx(best.c)); c && (c.f !== start.f || c.r !== start.r); c = seen.get(idx(c))) via.unshift(c);
          chosen.set(id, best.c);
          taken.set(idx(best.c), id);
          followed.set(id, via);
          continue;
        }
      }
      if (parent.get(id) === null) { for (let i = cap.get(id); i >= 0; i--) if (free(path[i])) { pick = i; break; } }
      if (pick >= 0) { chosen.set(id, path[pick]); taken.set(idx(path[pick]), id); continue; }
      // Nothing to touch and nowhere to follow. A laggard stone stopped is stuck; else the chain gives back a step.
      if (cap0.get(id) === 0 && !queued.has(id) && !taken.has(idx(start))) { stuck.add(id); taken.set(idx(start), id); continue; }
      failed = id;
      break;
    }
    if (failed === null) {
      // THE EXTENSION (2026-09-10, the fourth walk): the chain touches only
      // pieces laid BEFORE it, so a pawn laid before the comrade beside its
      // path stopped at its start — with the body laid, every piece now
      // takes the farthest cell on its path that keeps the army ONE BODY,
      // round after round until nothing moves on.
      const skip = new Set(army.pieces.filter((p) => !chosen.has(p.id)).map((p) => p.id));
      const oneBody = () => kingComponent(world, army, chosen, skip).size === chosen.size;
      for (let round = 0, more = true; more && round < 8; round++) {
        more = false;
        for (const id of order) {
          if (id === king.id || !chosen.has(id) || followed.has(id)) continue;
          const path = paths.get(id);
          const cur = chosen.get(id);
          const at = path.findIndex((q) => q.f === cur.f && q.r === cur.r);
          if (at < 0) continue;
          const startBad = behindKing(world, army, path[0], kingStart, facing);
          for (let i = cap.get(id); i > at; i--) {
            const c = path[i];
            if (taken.has(idx(c)) || swapOf(chosen, id, path[0], c) || (!startBad && behindKing(world, army, c, kc, facing))) continue;
            chosen.set(id, c);
            if (oneBody()) { taken.delete(idx(cur)); taken.set(idx(c), id); more = true; break; }
            chosen.set(id, cur);
          }
        }
      }
      const movedAny = [...chosen].some(([id, c]) => { const st = cells.get(id); return c.f !== st.f || c.r !== st.r; });
      if (breaker && !movedAny && kingBlocker !== null && cap.get(king.id) < cap0.get(king.id)) {
        stuck.add(kingBlocker);
        kingBlocker = null;
        for (const [id, c] of cap0) cap.set(id, c);
        noFollow.clear();
        continue;
      }
      for (const p of army.pieces) {
        if (stuck.has(p.id) && !chosen.has(p.id)) { walked.dest.set(p.id, { ...cells.get(p.id) }); walked.vias.set(p.id, []); continue; }
        const c = chosen.get(p.id);
        const path = paths.get(p.id);
        walked.dest.set(p.id, { f: c.f, r: c.r });
        if (followed.has(p.id)) { walked.vias.set(p.id, followed.get(p.id)); continue; }
        const i = path.findIndex((q) => q.f === c.f && q.r === c.r);
        walked.vias.set(p.id, i > 0 ? path.slice(1, i) : []);
      }
      walked.stuck = [...stuck];
      return loose.length === 0;
    }
    // Who gives back: the piece standing in the failed piece's start (a follower loses its follow, a walker a step), else the nearest ancestor with a step left.
    const start = cells.get(failed);
    const occupant = taken.get(idx(start));
    let giver = null;
    if (occupant !== undefined && occupant !== failed) {
      if (followed.has(occupant)) { noFollow.add(occupant); continue; }
      if (cap.get(occupant) > 0) giver = occupant;
    }
    if (giver === null) {
      let anc = parent.get(failed);
      while (anc !== null && cap.get(anc) === 0) anc = parent.get(anc);
      giver = anc;
    }
    if (giver === king.id) kingBlocker = failed;
    if (giver === null) {
      // Even the king has nothing left: the failed piece was split before the walk began; let it converge on its own.
      parent.set(failed, null);
      if (!loose.includes(failed)) loose.push(failed);
      continue;
    }
    cap.set(giver, cap.get(giver) - 1);
  }
  return false;
}

/**
 * Plan one turn (pure — nothing moves). Returns { ok, facing, at, moves:
 * [{ id, from, to, capture, teleport, via }], targets, pivot, teleports,
 * reason } — `via` the cells a catch-up path passes through (the slide's
 * waypoints; empty on a pivot or a teleport).
 * `input` = { kind: 'step', df, dr } (a WORLD delta) | { kind: 'face',
 * facing } | { kind: 'wait' } | { kind: 'move', id, to: { f, r } } (a
 * piece's own chess move; the king's is a step the army follows).
 */
export function planTurn(world, army, input, { trace = null } = {}) {
  const king = army.king;
  const kind = input?.kind;
  const fail = (reason, why = null) => ({ ok: false, reason, why, facing: army.facing, at: { ...army.at }, moves: [] });
  let facing = army.facing;
  let stepDelta = null;
  let fixed = null; // the king's own move: { id, to, capture }
  if (kind === 'move') {
    const p = army.piece(input.id);
    if (!p) return fail('no such piece');
    const legal = manualMoves(world, army, p).find((m) => m.f === input.to.f && m.r === input.to.r);
    if (!legal) return fail('not a move of that piece');
    if (p !== king) {
      return { ok: true, facing, at: { ...army.at }, individual: true, pivot: false, moves: [{ id: p.id, from: cellOf(p), to: { f: legal.f, r: legal.r }, capture: legal.capture, teleport: false }], targets: {}, teleports: [] };
    }
    stepDelta = { df: legal.f - king.f, dr: legal.r - king.r };
    fixed = { id: king.id, to: { f: legal.f, r: legal.r }, capture: legal.capture };
  } else if (kind === 'step') {
    stepDelta = { df: Math.sign(input.df | 0), dr: Math.sign(input.dr | 0) };
    if (!stepDelta.df && !stepDelta.dr) return fail('no direction');
  } else if (kind === 'face') {
    facing = normFacing(input.facing);
    if (facing === army.facing) return fail('already facing that way');
  } else if (kind !== 'wait') return fail('unknown input');

  // 1. THE FACING and THE PIVOT: the formation turns in place about the king.
  if (stepDelta) facing = facingOfStep(army.facing, stepDelta.df, stepDelta.dr);
  const pivot = facing !== army.facing;
  const kc0 = cellOf(king);
  let cells = new Map(army.pieces.map((p) => [p.id, cellOf(p)]));
  let at = { ...army.at };
  if (pivot) {
    cells = pivotPlacement(world, army, facing, kc0);
    at = anchorCell(army.pattern, kc0, facing);
  }
  // 2. THE STEP: the anchor moves — onto floor, or one cell into stone
  // beside reachable floor (anchorMay: a single block is flowed around);
  // off the map or onto an enemy refuses, and a refusal costs nothing. A
  // comrade there is fine (it is a cell of the formation). The king's own
  // move was judged as a chess move above.
  const held = { ...at }; // the anchor after the pivot, before the step
  if (stepDelta) {
    let to = { f: at.f + stepDelta.df, r: at.r + stepDelta.dr };
    if (!fixed) {
      const fromKing = distanceField(world, army, [kc0]);
      if (!anchorMay(world, army, to, fromKing, kc0, facing)) return fail('blocked', 'anchor');
      // THE ANCHOR SNAPS TO THE FLOOR BESIDE IT (2026-09-10, the fifth walk):
      // a second step into stone in a row is a wall walked ALONG, not a
      // block flowed round — the anchor was walking down the wall column
      // beside a one-wide passage, and the slots molded off it swapped the
      // file's pawns — so it takes the floor cell beside it (a file to
      // either side, direct from the king), or the step is refused.
      if (world.at(to.f, to.r) !== FLOOR && world.at(at.f, at.r) !== FLOOR) {
        const direct = directFrom(world, fromKing, kc0);
        const side = [1, -1].map((dx) => { const d = rotateBody(dx, 0, facing); return { f: to.f + d.df, r: to.r + d.dr }; })
          .find((c) => world.inBounds(c.f, c.r) && world.at(c.f, c.r) === FLOOR && !enemyAt(world, army, c.f, c.r) && direct(c.f, c.r));
        if (!side) return fail('blocked', 'anchor');
        to = side;
      }
    }
    at = to;
  }
  const stepAt = { ...at }; // the anchor after the step
  // 3. THE WALK: every piece toward its slot around the anchor's new cell
  // under the new facing, molded to reachable floor; catch-up steps. THE
  // KING'S LEASH: a step that would leave the king more than KING_LEASH
  // from his slot is walked again with the anchor held — a REGROUP (the
  // front waits for its king at a door; the pieces still move, nothing is
  // refused).
  // THE CLUSTER (designer 2026-09-09, the third walk): a d-pad walk NEVER
  // splits the army. A step that would leave it in more than one body is
  // walked again with the anchor held (a regroup, as for the leash); if
  // even that leaves it split, the king's body stands and the stragglers
  // rally to it.
  let regroup = false;
  // ONE BODY, or else (designer 2026-09-09, the third walk: "when moving
  // with just a d-pad the army should never be split. They should stay in
  // a battle ready cluster as much as possible"): a laggard that could not
  // move at all while the body went on is STUCK — it teleports beside the
  // body (ruling 15's "just teleport pieces that get stuck somewhere");
  // for a straggler still on its way the walk gives back steps (THE ROPE,
  // `ropeSettle`) — the army waits; an army split before the walk began
  // (a piece moved away by hand) walks on and converges.
  const kingStart = cells.get(king.id);
  const settleBody = (w, opts) => {
    const kd = w.dest.get(king.id);
    const behind = (p) => p !== king && behindKing(world, army, w.dest.get(p.id), kd, facing) && !behindKing(world, army, cells.get(p.id), kingStart, facing);
    if (kingComponent(world, army, w.dest).size === army.pieces.length && !army.pieces.some(behind)) return true;
    return ropeSettle(world, army, cells, w, facing, opts);
  };
  const snap = (label, w, whole) => { if (trace) trace.push({ label, whole, at: { ...at }, dest: Object.fromEntries([...w.dest].map(([id, c]) => [id, { f: c.f, r: c.r }])), targets: Object.fromEntries([...w.targets].map(([id, c]) => [id, c ? { f: c.f, r: c.r } : null])), vias: Object.fromEntries([...w.vias].map(([id, v]) => [id, v.map((c) => ({ f: c.f, r: c.r }))])), stuck: [...(w.stuck ?? [])], queued: [...(w.queued ?? [])] }); };
  const anyMoved = (w) => army.pieces.some((p) => { const d = w.dest.get(p.id), c = cells.get(p.id); return d.f !== c.f || d.r !== c.r; });
  let walked = walk(world, army, cells, at, facing, fixed);
  snap('walk', walked, null);
  let walkHad = anyMoved(walked); // the walk itself moved someone (before the rope)
  let whole = settleBody(walked);
  snap('settled', walked, whole);
  if (stepDelta && !fixed) {
    const kd = walked.dest.get(king.id);
    const ks = slotCell(army.pattern, 0, at, facing);
    if (Math.max(Math.abs(kd.f - ks.f), Math.abs(kd.r - ks.r)) > KING_LEASH || !whole) {
      const stepped = { walked, whole };
      at = held;
      walked = walk(world, army, cells, at, facing, fixed);
      snap('held walk', walked, null);
      walkHad = walkHad || anyMoved(walked);
      whole = settleBody(walked);
      snap('held settled', walked, whole);
      regroup = true;
      // A REGROUP THAT MOVES NOBODY YIELDS TO THE STEP'S MOVES (2026-09-10,
      // the fourth walk: "blocked in a lot of places I feel shouldn't be a
      // problem" — the anchor held on a crate pair molded the slots into a
      // swap no piece could start, and the step's own walk, whole and
      // moving, was thrown away): the pieces take the step's walk, one
      // body, WITH THE ANCHOR STILL HELD — the formation closes up on the
      // step's cells and the anchor never runs ahead of an army that
      // cannot follow (an anchor that stepped on while one rook walked
      // ran nine cells ahead of the king).
      if (!anyMoved(walked) && stepped.whole && anyMoved(stepped.walked)) { walked = stepped.walked; whole = true; }
    }
  }
  // THE LAST RESORT (2026-09-10, the fifth walk — nobody behind the king,
  // strictly, and still not blocked where the pieces could move): a step
  // whose strict walk moves NOBODY though the walk itself had moves — the
  // rope held the king back for a comrade, or he was queued behind a
  // comrade's way through the one cell he needs (a wall ahead of everyone
  // is a plain refusal) — is walked again — first with THE KING
  // STEPPING ASIDE (one king step to free floor level with him or a rank
  // back, never forward; the comrades who could move only through his
  // cell plan through it and file in first, and he goes last), then, if
  // no sidestep moves anyone, with the rope's BREAKER (the comrade he
  // waited for in vain is stuck and teleports beside the body) — and the
  // first walk that moves anyone stands; the anchor holds where the
  // king's lag would pass the leash.
  if (kind === 'step' && !pivot && !fixed && !anyMoved(walked) && walkHad) {
    let found = null;
    for (const side of sidesteps(world, army, kc0, facing)) {
      const w = walk(world, army, cells, stepAt, facing, { id: king.id, to: side, capture: null });
      const ok = settleBody(w);
      snap('aside', w, ok);
      if (anyMoved(w)) { found = { w, ok }; break; }
    }
    if (!found) {
      const w = walk(world, army, cells, stepAt, facing, fixed);
      const ok = settleBody(w, { breaker: true });
      snap('breaker', w, ok);
      if (anyMoved(w)) found = { w, ok };
    }
    if (found) {
      const kd = found.w.dest.get(king.id);
      const ks = slotCell(army.pattern, 0, stepAt, facing);
      const lag = Math.max(Math.abs(kd.f - ks.f), Math.abs(kd.r - ks.r));
      walked = found.w;
      whole = found.ok;
      at = lag > KING_LEASH ? held : stepAt;
      regroup = lag > KING_LEASH;
    }
  }
  const { dest, targets, vias, stuck } = walked;
  // 4. THE INVARIANT: a stuck piece, and any piece the box cannot hold,
  // teleports to its slot (or the nearest free floor to it).
  const teleports = [];
  const why = {}; // id → 'stuck' | 'behind' | 'box' (the record's and the stress harness's)
  const kcFinal = dest.get(king.id);
  const settle = () => {
    const field = distanceField(world, army, [kcFinal]);
    const taken = new Set([...dest.values()].map((c) => world.idx(c.f, c.r)));
    const place = (p, reason) => {
      const cur = dest.get(p.id);
      const want = slotCell(army.pattern, p.slot, at, facing);
      const body = [...kingComponent(world, army, dest)].filter((id) => id !== p.id).map((id) => dest.get(id));
      // Its own cell stays taken through the search: where it stands is never the answer (a stuck pawn "teleported" onto its own cell, 2026-09-10).
      const c = placeNear(world, army, field, taken, want, kcFinal, facing, body) ?? placeNear(world, army, field, taken, want, kcFinal, facing);
      if (c && (c.f !== cur.f || c.r !== cur.r)) {
        // A stuck piece's cell may be the king's own (he was laid on its start; it stood there until this teleport): a cell shared stays taken.
        const shared = [...dest].some(([id, cc]) => id !== p.id && cc.f === cur.f && cc.r === cur.r);
        if (!shared) taken.delete(world.idx(cur.f, cur.r));
        dest.set(p.id, c);
        taken.add(world.idx(c.f, c.r));
        teleports.push(p.id);
        why[p.id] = reason;
        return true;
      }
      return false;
    };
    for (const id of stuck) {
      const p = army.piece(id);
      if (p !== king) place(p, 'stuck');
    }
    // A stuck piece's teleport can leave a comrade that hung off it alone: it rallies beside the body the same way (one body, ruling 12's amendment).
    for (let guard = 0; guard < army.pieces.length; guard++) {
      const body = kingComponent(world, army, dest);
      const out = army.pieces.find((p) => !body.has(p.id));
      if (!out || !place(out, 'stuck')) break;
    }
    // The box: while it does not hold the army, the piece farthest from its slot goes home.
    for (let guard = 0; guard < army.pieces.length; guard++) {
      const box = boxOf(army, dest, facing);
      if (box.ok) break;
      let worst = null;
      for (const p of army.pieces) {
        if (p === king) continue;
        const c = dest.get(p.id);
        const b = bodyOf(c, kcFinal, facing);
        // One rank behind him but touching him is the walk's tolerance (a queued rook at a door); the drop molds it into the box.
        const outside = behindKing(world, army, c, kcFinal, facing) || b.dy >= BOX || box.spread > BOX;
        if (!outside) continue;
        const s = slotCell(army.pattern, p.slot, at, facing);
        const d = Math.max(Math.abs(c.f - s.f), Math.abs(c.r - s.r));
        if (!worst || d > worst.d) worst = { p, d, reason: b.dy < 0 ? 'behind' : 'box' };
      }
      if (!worst || !place(worst.p, worst.reason)) break;
    }
  };
  settle();
  const moves = [];
  for (const p of army.pieces) {
    const to = dest.get(p.id);
    if (to.f === p.f && to.r === p.r) continue;
    const teleport = teleports.includes(p.id);
    const via = teleport || pivot ? [] : (vias.get(p.id) ?? []).map((c) => ({ f: c.f, r: c.r }));
    moves.push({ id: p.id, from: cellOf(p), to: { f: to.f, r: to.r }, capture: fixed && p.id === fixed.id ? fixed.capture : null, teleport, via });
  }
  if (trace) trace.push({ label: 'settle', whole, at: { ...at }, dest: Object.fromEntries([...dest].map(([id, c]) => [id, { f: c.f, r: c.r }])), stuck: [...stuck], queued: [] });
  // A step that moves nobody is the front meeting the wall.
  if (kind === 'step' && !pivot && moves.length === 0) return fail('blocked', 'walk');
  return { ok: true, facing, at, pivot, regroup, moves, targets: Object.fromEntries([...targets].map(([id, t]) => [id, t])), teleports, teleportWhy: why };
}

/**
 * THE TARGETS of a walk (2026-09-09, the designer's second walk: "I feel
 * the pieces should at least be able to stay adjacent if I'm only using
 * d-pad movement"): once per turn and UNIQUE, and THE SET IS CONNECTED —
 * every target beside another, so the formation flows round stone as ONE
 * BODY and never molds a piece onto the far side of a thin wall (the
 * stress harness's splits: a pawn placed across a wall's corner walked a
 * parallel corridor for twenty turns with the king forbidden to overtake
 * it). The king's target first (his slot, or the nearest direct cell
 * never ahead of its row); then every piece whose slot is free direct
 * floor takes it; then the rest mold — each the nearest free direct cell
 * to its slot at or ahead of the king's target, BESIDE a target already
 * given; and while the set falls into more than one piece, the detached
 * target nearest the king's component is given again, beside it. Returns
 * id → cell (null when nothing is reachable at all).
 */
export function assignTargets(world, army, at, facing, kc, fromKing, fromAnchor, fixed = null) {
  const king = army.king;
  const targets = new Map();
  const taken = new Set();
  const idx = (c) => world.idx(c.f, c.r);
  const claim = (p, t) => { targets.set(p.id, t); if (t) taken.add(idx(t)); };
  const fixedTo = (p) => (fixed && p.id === fixed.id ? fixed.to : null);
  const slotDy = (p) => army.pattern.slots[p.slot]?.dy ?? 0;
  const tK = fixedTo(king) ?? targetOf(world, army, slotCell(army.pattern, 0, at, facing), fromKing, kc, facing, { tie: fromAnchor, royal: true });
  claim(king, tK);
  const origin = tK ?? kc;
  const direct = directFrom(world, fromKing, kc);
  const others = [...army.pieces].filter((p) => p !== king).sort((a, b) => slotDy(b) - slotDy(a) || a.slot - b.slot);
  const molded = [];
  for (const p of others) {
    const fx = fixedTo(p);
    if (fx) { claim(p, fx); continue; }
    const sc = slotCell(army.pattern, p.slot, at, facing);
    if (direct(sc.f, sc.r) && !taken.has(idx(sc)) && bodyOf(sc, kc, facing).dy >= 0) claim(p, sc);
    else molded.push(p);
  }
  const slotOf = (p) => slotCell(army.pattern, p.slot, at, facing);
  // A molded target ties toward the ANCHOR, as the king's does (2026-09-10,
  // the fourth walk: tied toward the king, a pawn threading a one-wide gap
  // was given the gap cell it stood in, and the file behind it waited on
  // a pawn told to stay).
  // …and NEVER BEHIND THE KING'S TARGET (`floorAt: origin` — his cell
  // when he has none): a target level with where he stands is behind
  // where he will be (2026-09-10, the fifth walk).
  const mold = (p, near) => targetOf(world, army, slotOf(p), fromKing, kc, facing, { tie: fromAnchor, origin, floorAt: origin, taken, near })
    ?? targetOf(world, army, slotOf(p), fromKing, kc, facing, { tie: fromAnchor, origin, floorAt: origin, taken });
  for (const p of molded) claim(p, mold(p, taken.size ? taken : null));
  // THE SET IS CONNECTED: the component holding the king's target grows
  // until it holds every target — by the BODY's adjacency, corners
  // included (2026-09-10, the fourth walk: judged corner-free, a slot on
  // direct floor beyond a crate pair was "detached" from a king's target
  // molded beside the crates, and re-molded back into the pocket — a swap
  // of cells nobody could start; the molding itself stays corner-free).
  if (!tK) return targets;
  const component = () => {
    const seen = new Set([idx(tK)]);
    const stack = [idx(tK)];
    while (stack.length) {
      const i = stack.pop();
      const f = i % world.files, r = (i - f) / world.files;
      for (const [df, dr] of KING_STEPS) {
        if (!world.inBounds(f + df, r + dr)) continue;
        const j = world.idx(f + df, r + dr);
        if (taken.has(j) && !seen.has(j)) { seen.add(j); stack.push(j); }
      }
    }
    return seen;
  };
  for (let guard = 0; guard < army.pieces.length; guard++) {
    const main = component();
    if (main.size >= taken.size) break;
    let pick = null;
    for (const p of army.pieces) {
      const t = targets.get(p.id);
      if (!t || p === king || fixedTo(p) || main.has(idx(t))) continue;
      let d = 1e9;
      for (const i of main) { const f = i % world.files, r = (i - f) / world.files; d = Math.min(d, Math.max(Math.abs(f - t.f), Math.abs(r - t.r))); }
      if (!pick || d < pick.d || (d === pick.d && slotDy(p) > slotDy(pick.p))) pick = { p, d };
    }
    if (!pick) break;
    const old = targets.get(pick.p.id);
    taken.delete(idx(old));
    // Given again BESIDE the king's component by the body's adjacency —
    // the corner cell between a crate and a wall is where a set leads
    // through such a gap (2026-09-10, the fourth walk).
    const t2 = targetOf(world, army, slotOf(pick.p), fromKing, kc, facing, { tie: fromAnchor, origin, floorAt: origin, taken, near: main, corners: true });
    if (!t2) { taken.add(idx(old)); break; }
    claim(pick.p, t2);
  }
  return targets;
}

/**
 * THE WALK: from `cells` (id → cell, after any pivot), every piece toward
 * its slot around anchor `at` under `facing`. FRONT ROWS FIRST (the pawns
 * go through a door before the king), THE KING LAST OF ALL, else
 * nearest-to-slot, in passes so a piece can step into a cell a comrade is
 * leaving. A piece's path is measured with the comrades who STAY as
 * obstacles (and every cell another piece ends on), so a pawn boxed in
 * behind the back row walks around it instead of waiting for a cell that
 * never frees; a cell counts as free only when nobody stays on it and
 * nobody else ends on it, and a cell one piece passes THROUGH this turn
 * carries nobody else (one at a time through a doorway). A piece takes one
 * move — a king step or its own chess move — that strictly shortens its
 * path, a second when its path is longer than one, a third while it stands
 * behind the king (CATCH-UP). `fixed` pins one piece (the king's own move)
 * to a destination. Returns { dest, targets, vias, stuck } — stuck: pieces
 * with no king-step path to their target through floor at all and no move
 * that gets nearer (sealed off, not merely queued).
 */
function walk(world, army, cells, at, facing, fixed) {
  const king = army.king;
  const kc = cells.get(king.id);
  const fromKing = distanceField(world, army, [kc]);
  // The king's own molding ties toward the ANCHOR (the formation), not
  // toward himself — a king whose slot is stone must still follow the army.
  const fromAnchor = world.inBounds(at.f, at.r) && world.at(at.f, at.r) === FLOOR ? distanceField(world, army, [at]) : fromKing;
  const targets = assignTargets(world, army, at, facing, kc, fromKing, fromAnchor, fixed);
  const freeFields = new Map(); // friends passable: the stuck test and the ordering
  const freeDist = (p, c) => {
    const t = targets.get(p.id);
    if (!t) return -1;
    const k = key(world, t.f, t.r);
    if (!freeFields.has(k)) freeFields.set(k, distanceField(world, army, [t]));
    return freeFields.get(k)[key(world, c.f, c.r)];
  };
  const slotKeys = new Set([...targets.values()].filter(Boolean).map((c) => key(world, c.f, c.r)));
  const slotDy = (p) => army.pattern.slots[p.slot]?.dy ?? 0;
  // The order: the front rows first (the pawns go through a door before
  // anyone), then the rest nearest-to-slot first, THE KING LAST OF ALL
  // (the rook takes the doorway ahead of him; the rope gives back any
  // step of his that leaves a comrade behind).
  const order = [...army.pieces].sort((a, b) => {
    if (fixed) { if (a.id === fixed.id) return -1; if (b.id === fixed.id) return 1; }
    if (a === king) return 1;
    if (b === king) return -1;
    const ra = slotDy(a), rb = slotDy(b);
    if (ra !== rb) return rb - ra; // the front rows first
    const da = freeDist(a, cells.get(a.id)), db = freeDist(b, cells.get(b.id));
    if (da !== db) return (da < 0 ? 1e9 : da) - (db < 0 ? 1e9 : db);
    return a.id - b.id;
  });
  const occ = new Map(); // cell key → id, where each piece stands now
  for (const [id, c] of cells) occ.set(key(world, c.f, c.r), id);
  const dest = new Map([...cells].map(([id, c]) => [id, { f: c.f, r: c.r }]));
  const vias = new Map();
  const claims = new Map(); // cell key → id, where each piece ends
  const passing = new Map(); // cell key → id: cells passed THROUGH this turn (one at a time through a doorway)
  const plans = new Map(); // id → { final, via, score }: the plan each piece holds
  for (const [id, c] of dest) claims.set(key(world, c.f, c.r), id);
  const leaving = (k, self) => {
    const q = occ.get(k);
    if (q === undefined || q === self) return true;
    const d = dest.get(q);
    return key(world, d.f, d.r) !== k;
  };
  const unbook = (p) => {
    const pl = plans.get(p.id);
    const cur = dest.get(p.id);
    if (claims.get(key(world, cur.f, cur.r)) === p.id) claims.delete(key(world, cur.f, cur.r));
    for (const v of pl?.via ?? []) if (passing.get(key(world, v.f, v.r)) === p.id) passing.delete(key(world, v.f, v.r));
  };
  const book = (p, pl) => {
    claims.set(key(world, pl.final.f, pl.final.r), p.id);
    for (const v of pl.via) passing.set(key(world, v.f, v.r), p.id);
    plans.set(p.id, pl);
    dest.set(p.id, pl.final);
    vias.set(p.id, pl.via);
  };
  const stuck = new Set();
  const queued = new Set();
  // PASSES: a piece can step into a cell a comrade is leaving, so every
  // piece plans again after the others have. A plan HOLDS across passes
  // (its claim and the cells it passes through stay booked): a piece
  // re-plans from where it stands and takes the new plan only when it
  // ends STRICTLY NEARER its target, or the old one no longer stands —
  // without that, the king and a rook waiting on each other swapped
  // plans every pass and the cut-off left one of them standing (2026-
  // 09-09, the walk-stress harness).
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    // THE KING'S PLAN NEVER HOLDS ACROSS PASSES (2026-09-10, the fifth walk):
    // planned last, he had booked the corner cell as his via while the pawn
    // and the rook beside him could not yet step (the knight ahead of them
    // was unplanned), and in the next pass his booking kept them out — so
    // he went first and the rope had to hold him back for good. His cells
    // are released at the start of every pass: the comrades take what they
    // need, and he plans round them, last, from where he stands.
    if (pass > 0 && !(fixed && fixed.id === king.id)) {
      unbook(king);
      const ks = cells.get(king.id);
      dest.set(king.id, { f: ks.f, r: ks.r });
      claims.set(key(world, ks.f, ks.r), king.id);
      vias.set(king.id, []);
      plans.set(king.id, { final: { f: ks.f, r: ks.r }, via: [], score: 1e9 }); // "he stays": his cell an obstacle in the others' fields, nothing else booked
    }
    for (const p of order) {
      const start = cells.get(p.id);
      const t = targets.get(p.id);
      const prev = plans.get(p.id) ?? null;
      const prevFinal = dest.get(p.id);
      unbook(p);
      let plan = { final: { f: start.f, r: start.r }, via: [], score: 1e9 };
      if (fixed && p.id === fixed.id) {
        plan = { final: { f: fixed.to.f, r: fixed.to.r }, via: [], score: 0 };
      } else if (t) {
        // NOBODY ENDS BEHIND THE KING'S CELL (2026-09-09, the designer's
        // second walk: "the king in weird spots… multiple spaces behind the
        // rest of the army"): no piece ends behind the king (on the way it
        // may dip DETOUR cells behind him, round a crate pair; a piece that
        // starts behind him — a pivot's placement, a fixture — may move as
        // long as it falls no farther behind). The king himself plans
        // freely: where he ends ahead of a comrade, the rope gives his
        // steps back (the third walk retired the planning rule that
        // forbade it — with two pieces level with him in a nook it froze
        // the whole army).
        const kd = dest.get(king.id);
        const dyOf = (c, k) => bodyOf(c, k, facing).dy;
        const floor0 = (c, k) => Math.min(0, dyOf(c, k));
        const myFloor = floor0(start, kd);
        const ahead = p === king ? () => true : (f, r) => dyOf({ f, r }, kd) >= myFloor - DETOUR;
        const ends = p === king ? () => true : (f, r) => dyOf({ f, r }, kd) >= myFloor;
        // This piece's field: the comrades who stay, and every cell another
        // piece ends on, are obstacles — a pawn boxed in behind the back row
        // walks round it instead of waiting for a cell that never frees.
        // But a way round longer than the straight way (through the
        // comrades) by more than DETOUR_MAX is not walked: the piece QUEUES
        // on the straight way's field, up to the crowd, and waits.
        // A comrade who has not planned yet this turn is not an obstacle
        // (the pawn in front will most likely move; planning round it sent
        // the pawn behind it back along the king's file instead — the
        // stress harness, 2026-09-09); a planned comrade's cell is, where
        // it stays, and so is every cell a planned comrade ends on.
        const blocked = new Set();
        for (const q of army.pieces) {
          if (q.id === p.id || !plans.has(q.id)) continue;
          const c = cells.get(q.id), d = dest.get(q.id);
          blocked.add(world.idx(d.f, d.r));
          if (c.f === d.f && c.r === d.r) blocked.add(world.idx(c.f, c.r));
        }
        const fieldRound = distanceField(world, army, [t], blocked);
        const hereRound = fieldRound[key(world, start.f, start.r)];
        const hereThrough = freeDist(p, start);
        const queue = hereRound < 0 || (hereThrough >= 0 && hereRound > hereThrough + DETOUR_MAX);
        const field = queue ? freeFields.get(key(world, t.f, t.r)) : fieldRound;
        const dist = (f, r) => field[key(world, f, r)];
        // Free to END on or pass through: nobody else ends there or passes
        // through it this turn (one piece at a time through a doorway —
        // letting a second piece END on a cell a comrade passes through
        // parked a pawn in the doorway on the king's own cell, 2026-09-10),
        // floor, no enemy, and any occupant leaves.
        const myTarget = key(world, t.f, t.r);
        const free = (f, r) => {
          const k = key(world, f, r);
          const c = claims.get(k);
          if (c !== undefined && c !== p.id) return false;
          const pass = passing.get(k);
          if (pass !== undefined && pass !== p.id) return false;
          return world.at(f, r) === FLOOR && !enemyAt(world, army, f, r) && leaving(k, p.id);
        };
        // A path that cuts through a comrade's slot yields to one of the
        // same length that does not (the king, planned last, is otherwise
        // starved of his own cell by pawns catching up across it); where the
        // doorway is the only way, the crossing stands and the king waits.
        const crosses = (f, r) => { const k = key(world, f, r); return k !== myTarget && slotKeys.has(k); };
        const here = dist(start.f, start.r);
        const behind = bodyOf(start, kc, facing).dy < 0;
        const allowed = here === 0 ? 0 : here === 1 ? 1 : behind || p === king ? CATCH_UP_BEHIND : CATCH_UP;
        let cur = start;
        let curD = here < 0 ? 1e9 : here;
        let moved = 0;
        const via = [];
        const trail = []; // [cell, d] after each step, for the retraction
        for (let s = 0; s < allowed; s++) {
          let best = null;
          for (const m of pieceMoves(world, army, { ...p, f: cur.f, r: cur.r }, { viaComrades: true, facing })) {
            if (!free(m.f, m.r) || !ahead(m.f, m.r)) continue;
            const d = dist(m.f, m.r);
            if (d < 0 || d >= curD) continue;
            const cross = d > 0 && crosses(m.f, m.r);
            const fwd = dyOf({ f: m.f, r: m.r }, kd);
            if (!best || d < best.d || (d === best.d && ((best.cross && !cross) || (best.cross === cross && fwd > best.fwd)))) best = { f: m.f, r: m.r, d, cross, fwd };
          }
          if (!best) break;
          if (moved > 0) via.push(cur);
          cur = { f: best.f, r: best.r };
          curD = best.d;
          moved++;
          trail.push([cur, curD]);
          if (curD === 0) break;
        }
        // The dip must come back up within the turn: a path still behind the
        // king at its end is cut back to its last cell level with him.
        while (moved > 0 && !ends(cur.f, cur.r)) {
          trail.pop();
          moved--;
          if (moved === 0) { cur = start; curD = here < 0 ? 1e9 : here; via.length = 0; }
          else { [cur, curD] = trail[trail.length - 1]; via.length = moved - 1; }
        }
        // QUEUED: it did not move, and what stopped it was a comrade — a
        // cell claimed, passed through or not yet left — not stone. (A
        // queued piece is waited for; a piece stone stops is stuck when
        // the body goes on without it.)
        if (moved === 0 && here > 0) {
          let byComrade = false, blocker = null;
          for (const m of pieceMoves(world, army, { ...p, f: start.f, r: start.r }, { viaComrades: true, facing })) {
            const d = dist(m.f, m.r);
            if (d < 0 || d >= here || !ahead(m.f, m.r)) continue;
            if (world.at(m.f, m.r) === FLOOR && !enemyAt(world, army, m.f, m.r)) { byComrade = true; blocker = occ.get(key(world, m.f, m.r)) ?? null; break; }
          }
          if (byComrade) queued.add(p.id); else queued.delete(p.id);
          // THE QUEUE SWAP (2026-09-10, the fifth walk): a comrade standing ON
          // its target in this piece's way, itself able to reach this piece's
          // target, takes that target and this piece takes the comrade's cell
          // — a file of pawns in a one-wide passage, the front one told to
          // stay, moves as one instead of standing.
          if (blocker !== null && blocker !== p.id && pass < 3) {
            const q = army.piece(blocker);
            const tq = targets.get(blocker), cq = cells.get(blocker), dq = dest.get(blocker);
            if (q !== king && tq && tq.f === cq.f && tq.r === cq.r && dq.f === cq.f && dq.r === cq.r && freeDist(q, { f: t.f, r: t.r }) >= 0) {
              targets.set(blocker, { f: t.f, r: t.r });
              targets.set(p.id, { f: cq.f, r: cq.r });
              changed = true;
            }
          }
        } else queued.delete(p.id);
        // THE KING NEVER WALKS AWAY: a path that goes the long way round a
        // wall can end farther from his slot than it began; he stays put
        // instead (the leash regroups the front if that lasts).
        if (p === king && moved > 0) {
          const slot = slotCell(army.pattern, 0, at, facing);
          const chebTo = (c) => Math.max(Math.abs(c.f - slot.f), Math.abs(c.r - slot.r));
          if (chebTo(cur) > chebTo(start)) { cur = start; via.length = 0; moved = 0; curD = here < 0 ? 1e9 : here; }
        }
        plan = { final: cur, via, score: curD };
        // The plan held from the last pass stands unless this one ends nearer.
        if (prev && (prevFinal.f !== start.f || prevFinal.r !== start.r)) {
          const d0 = dist(prevFinal.f, prevFinal.r);
          const stands = d0 >= 0 && free(prevFinal.f, prevFinal.r) && ends(prevFinal.f, prevFinal.r) && prev.via.every((v) => free(v.f, v.r) && ahead(v.f, v.r));
          if (stands && d0 <= plan.score) plan = { final: prevFinal, via: prev.via, score: d0 };
        }
        // STUCK (ruling 15, "just teleport pieces that get stuck somewhere"):
        // no way to its target AT ALL through floor (friends passable). A
        // way that runs behind the king is a way (2026-09-10, the fifth
        // walk): the rope holds him for it, and where it can move only
        // through his cell he steps aside and goes last — the second
        // walk's "none that does not end behind the king" is retired.
        const stays = plan.final.f === start.f && plan.final.r === start.r;
        if (here !== 0 && stays && hereThrough < 0) stuck.add(p.id);
        else stuck.delete(p.id);
      }
      book(p, plan);
      if (plan.final.f !== prevFinal.f || plan.final.r !== prevFinal.r) changed = true;
    }
    if (!changed && pass > 0) break; // pass 0 plans with comrades still unplanned: everyone plans again once
  }
  // A plan made while a comrade still meant to leave its cell is VOID once
  // that comrade stays (the passes are capped, so the last word can be a
  // stayer's): the plan is withdrawn to its start — which may void others
  // in turn (2026-09-09, the stress harness: two pieces on one cell).
  for (let guard = 0; guard < army.pieces.length; guard++) {
    let voided = false;
    for (const p of order) {
      const pl = plans.get(p.id);
      const start = cells.get(p.id);
      if (!pl || (pl.final.f === start.f && pl.final.r === start.r && pl.via.length === 0)) continue;
      for (const c of [...pl.via, pl.final]) {
        const q = occ.get(key(world, c.f, c.r));
        if (q === undefined || q === p.id) continue;
        const qd = dest.get(q), qc = cells.get(q);
        if (qd.f !== qc.f || qd.r !== qc.r) continue; // it leaves
        unbook(p);
        book(p, { final: { f: start.f, r: start.r }, via: [], score: 1e9 });
        if (targets.get(p.id) && freeDist(p, start) < 0) stuck.add(p.id);
        voided = true;
        break;
      }
    }
    if (!voided) break;
  }
  return { dest, targets, vias, stuck: [...stuck], queued };
}

/** Apply a plan: the army's facing, anchor and pieces, the world's piece grid;
 *  a capture turns furniture to floor (enemy pieces are never captured on
 *  the map). Returns the plan. */
export function applyTurn(world, army, plan) {
  if (!plan.ok) return plan;
  army.remember(world);
  army.facing = plan.facing;
  army.at = { f: plan.at.f, r: plan.at.r };
  for (const m of plan.moves) {
    const p = army.piece(m.id);
    if (m.capture === 'furniture') world.setTerrain(m.to.f, m.to.r, FLOOR);
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

/** The formation's centre for the camera: the pattern's footprint middle
 *  around the anchor, in fractional world cells. */
export function formationFocus(army) {
  const a = anchorOf(army.pattern);
  const slots = army.pattern.slots;
  const mx = slots.reduce((s, x) => s + x.dx, 0) / slots.length - a.dx;
  const my = slots.reduce((s, x) => s + x.dy, 0) / slots.length - a.dy;
  const { df, dr } = rotateBody(mx, my, army.facing);
  return { f: army.at.f + df, r: army.at.r + dr };
}

/**
 * Put an army on the world with its KING on `at` facing `facing` (the
 * world's `@` start is the king's cell; the anchor is derived): each slot
 * on its cell when it is vacant floor, else the nearest vacant floor cell
 * reachable from the king, at or ahead of him first (the same molding).
 * Pieces get ids 1… in slot order. Throws when the king's cell is not
 * floor. `lenient` (the walk-out of a closed board): a piece the king's
 * pocket cannot hold takes the nearest vacant floor anywhere. `fixed` (a
 * map slot → cell; the walk-out, 2026-09-10): those slots take the cells
 * given — the survivors of a duel stand where they stood — and only the
 * rest are placed. `stamp: false` leaves the world's piece grid alone (a
 * hypothetical army, the generator's lint).
 */
export function spawnArmy(world, pattern, at, facing = 0, side = 'w', { lenient = false, fixed = null, stamp = true } = {}) {
  if (world.at(at.f, at.r) !== FLOOR) throw new Error(`spawn: (${at.f}, ${at.r}) is not floor`);
  const fc = normFacing(facing);
  const army = new Army({ side, facing: fc, pattern, pieces: [], at: anchorCell(pattern, at, fc) });
  army.pieces.push({ id: 1, ch: pattern.slots[0].ch, slot: 0, f: at.f, r: at.r });
  const taken = new Set([world.idx(at.f, at.r)]);
  if (fixed) for (const c of fixed.values()) taken.add(world.idx(c.f, c.r));
  const fromKing = distanceField(world, army, [at]);
  const direct = directFrom(world, fromKing, at);
  const vacant = (f, r) => world.at(f, r) === FLOOR && !world.pieceAt(f, r);
  for (let i = 1; i < pattern.slots.length; i++) {
    const fx = fixed?.get(i) ?? null;
    if (fx) {
      army.pieces.push({ id: i + 1, ch: pattern.slots[i].ch, slot: i, f: fx.f, r: fx.r });
      continue;
    }
    const want = slotCell(pattern, i, army.at, fc);
    let cell = null;
    if (world.inBounds(want.f, want.r) && vacant(want.f, want.r) && !taken.has(world.idx(want.f, want.r)) && direct(want.f, want.r)) cell = want;
    else {
      let best = null;
      for (let j = 0; j < fromKing.length; j++) {
        if (fromKing[j] < 0 || taken.has(j)) continue;
        const f = j % world.files, r = (j - f) / world.files;
        if (!vacant(f, r) || !direct(f, r)) continue;
        const behind = bodyOf({ f, r }, at, fc).dy < 0 ? 1 : 0;
        const cheb = Math.max(Math.abs(f - want.f), Math.abs(r - want.r));
        const k = [behind, cheb, fromKing[j], f, r];
        if (!best || lexLess(k, best.k)) best = { f, r, k };
      }
      if (!best && lenient) {
        for (let j = 0; j < fromKing.length; j++) {
          if (taken.has(j)) continue;
          const f = j % world.files, r = (j - f) / world.files;
          if (!vacant(f, r)) continue;
          const cheb = Math.max(Math.abs(f - want.f), Math.abs(r - want.r));
          const k = [cheb, f, r];
          if (!best || lexLess(k, best.k)) best = { f, r, k };
        }
      }
      if (!best) throw new Error(`spawn: no floor for slot ${i}`);
      cell = { f: best.f, r: best.r };
    }
    taken.add(world.idx(cell.f, cell.r));
    army.pieces.push({ id: i + 1, ch: pattern.slots[i].ch, slot: i, f: cell.f, r: cell.r });
  }
  if (stamp) army.stamp(world);
  return army;
}

/**
 * THE NEAREST FLOOR THAT CAN HOLD an army of `n` pieces (ruling 15:
 * "nothing is ever sealed off" — after a duel, if the king's pocket
 * cannot hold the army, the whole army moves to the nearest floor that
 * can): the vacant-floor region of at least `n` cells whose nearest cell
 * to `from` (Chebyshev) is the nearest of all; that cell, or null.
 */
export function nearestHold(world, from, n) {
  const n0 = world.size;
  const region = new Int32Array(n0).fill(-1);
  const sizes = [];
  const vacant = (i) => { const f = i % world.files, r = (i - f) / world.files; return world.at(f, r) === FLOOR && !world.pieceAt(f, r); };
  for (let s = 0; s < n0; s++) {
    if (region[s] >= 0 || !vacant(s)) continue;
    const id = sizes.length;
    const stack = [s];
    region[s] = id;
    let size = 0;
    while (stack.length) {
      const i = stack.pop();
      size++;
      const f = i % world.files, r = (i - f) / world.files;
      for (const [df, dr] of KING_STEPS) {
        const nf = f + df, nr = r + dr;
        if (!world.inBounds(nf, nr)) continue;
        const j = world.idx(nf, nr);
        if (region[j] >= 0 || !vacant(j)) continue;
        region[j] = id;
        stack.push(j);
      }
    }
    sizes.push(size);
  }
  let best = null;
  for (let i = 0; i < n0; i++) {
    if (region[i] < 0 || sizes[region[i]] < n) continue;
    const f = i % world.files, r = (i - f) / world.files;
    const d = Math.max(Math.abs(f - from.f), Math.abs(r - from.r));
    const k = [d, Math.abs(f - from.f) + Math.abs(r - from.r), f, r];
    if (!best || lexLess(k, best.k)) best = { f, r, k };
  }
  return best ? { f: best.f, r: best.r } : null;
}

/**
 * THE WALK-OUT of a won duel (2026-09-10, the duel start — ruling 3's
 * other half): the survivors stand WHERE THEY STOOD when the duel ended,
 * the captured return beside the body (the spawn's molding around the
 * survivors), promotions revert (a promoted piece is a pawn again at its
 * cell — brief §8). `survivors` are the side's letters on the board after
 * the duel, in world cells: [{ ch, f, r }], the king among them (or
 * `kingCell` is his). Each survivor takes the slot of its letter nearest
 * its cell; a letter beyond the pattern's count of it is a promoted pawn.
 * The world's piece grid must already be clear of the side's old letters
 * (the crop's letters after a duel). When the king's pocket cannot hold
 * the army, THE WHOLE ARMY MOVES to the nearest floor that can (ruling
 * 15); failing even that, the lenient spawn.
 */
export function walkOutArmy(world, pattern, kingCell, facing, survivors, side = 'w') {
  const fc = normFacing(facing);
  const slots = pattern.slots;
  const at = anchorCell(pattern, kingCell, fc);
  const fixed = new Map();
  const free = survivors.filter((s) => !(s.f === kingCell.f && s.r === kingCell.r)).map((s) => ({ ch: s.ch.toUpperCase(), f: s.f, r: s.r }));
  const cellOfSlot = (i) => slotCell(pattern, i, at, fc);
  const assign = (idxs, pool) => {
    const open = [...idxs];
    const cand = [...pool];
    while (open.length && cand.length) {
      let best = null;
      for (const i of open) {
        const sc = cellOfSlot(i);
        for (const s of cand) {
          const d = Math.max(Math.abs(s.f - sc.f), Math.abs(s.r - sc.r));
          if (!best || d < best.d) best = { i, s, d };
        }
      }
      fixed.set(best.i, { f: best.s.f, r: best.s.r });
      open.splice(open.indexOf(best.i), 1);
      cand.splice(cand.indexOf(best.s), 1);
    }
    return cand;
  };
  const letters = [...new Set(slots.slice(1).map((s) => s.ch.toUpperCase()).filter((ch) => ch !== 'P'))];
  const pawnPool = free.filter((s) => s.ch === 'P' || !letters.includes(s.ch));
  for (const ch of letters) {
    const idxs = slots.map((s, i) => (i > 0 && s.ch.toUpperCase() === ch ? i : -1)).filter((i) => i >= 0);
    pawnPool.push(...assign(idxs, free.filter((s) => s.ch === ch)));
  }
  assign(slots.map((s, i) => (i > 0 && s.ch.toUpperCase() === 'P' ? i : -1)).filter((i) => i >= 0), pawnPool);
  try {
    return spawnArmy(world, pattern, kingCell, fc, side, { fixed });
  } catch {
    const cell = nearestHold(world, kingCell, slots.length);
    if (cell && !(cell.f === kingCell.f && cell.r === kingCell.r)) {
      try {
        return spawnArmy(world, pattern, cell, fc, side, {});
      } catch {
        /* the region holds the count but not the molding — fall through */
      }
    }
    return spawnArmy(world, pattern, kingCell, fc, side, { fixed, lenient: true });
  }
}
