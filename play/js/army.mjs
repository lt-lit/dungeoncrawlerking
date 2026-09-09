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

  /** Write the pieces into the world's piece grid (clearing our old letters). */
  stamp(world) {
    for (let i = 0; i < world.pieces.length; i++) if (this.owns(world.pieces[i])) world.pieces[i] = null;
    for (const p of this.pieces) world.pieces[world.idx(p.f, p.r)] = this.letter(p.ch);
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
export function targetOf(world, army, slot, fromKing, king, facing, { tie = fromKing, royal = false, origin = king, floorAt = null, taken = null, near = null } = {}) {
  const direct = king ? directFrom(world, fromKing, king) : (f, r) => world.inBounds(f, r) && fromKing[world.idx(f, r)] >= 0;
  let adj = null; // the cells TOUCHING `near` (never across a wall's corner)
  if (near) {
    adj = new Set();
    for (const i of near) {
      const f = i % world.files, r = (i - f) / world.files;
      for (const [df, dr] of KING_STEPS) if (world.inBounds(f + df, r + dr) && touching(world, army, { f, r }, { f: f + df, r: r + dr })) adj.add(world.idx(f + df, r + dr));
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
 * MAY THE ANCHOR STEP HERE? The anchor is a cell of the formation, not a
 * piece: floor, or stone ONE cell deep — a pillar or a crate in front of
 * the middle pawn is FLOWED AROUND (designer 2026-09-09: "bumping into
 * single blocks the army should just be able to flow around") — as long
 * as the cell, or a floor neighbour of it, is DIRECT from the king (this
 * side of the walls: never through a wall into the next room); never off
 * the map, never an enemy. A solid wall is refused by the walk instead: a
 * step that moves nobody is "blocked".
 */
function anchorMay(world, army, to, fromKing, kc) {
  if (!world.inBounds(to.f, to.r) || enemyAt(world, army, to.f, to.r)) return false;
  const direct = directFrom(world, fromKing, kc);
  if (world.at(to.f, to.r) === FLOOR) return direct(to.f, to.r);
  for (const [df, dr] of KING_STEPS) {
    const f = to.f + df, r = to.r + dr;
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

/** Does the army still fit the box with piece `p` on `to`? */
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
 * TOUCHING, the cluster's adjacency: a king step apart, and a diagonal
 * only when one of its two orthogonal cells is crossable — a piece across
 * a wall's corner is NOT part of the body (it is on the far side of the
 * wall; the army walked away from such pieces along the wall, the
 * designer's third walk).
 */
function touching(world, army, a, b) {
  const df = b.f - a.f, dr = b.r - a.r;
  if (Math.max(Math.abs(df), Math.abs(dr)) !== 1) return false;
  if (df === 0 || dr === 0) return true;
  return crossable(world, army, a.f + df, a.r) || crossable(world, army, a.f, a.r + dr);
}

/** BEHIND THE KING: a cell behind his row, unless one rank behind and touching him (a queued rook at a door; the drop molds it into the box). */
function behindKing(world, army, c, kd, facing) {
  const dy = bodyOf(c, kd, facing).dy;
  return dy < 0 && !(dy === -1 && touching(world, army, c, kd));
}

/** The ids of the king's BODY: the pieces touching him through `cells` (id → cell), by chains of touching. */
function kingComponent(world, army, cells, skip = null) {
  const seen = new Set([army.king.id]);
  const stack = [army.king.id];
  while (stack.length) {
    const c = cells.get(stack.pop());
    for (const q of army.pieces) {
      if (seen.has(q.id) || (skip && skip.has(q.id))) continue;
      if (touching(world, army, c, cells.get(q.id))) { seen.add(q.id); stack.push(q.id); }
    }
  }
  return seen;
}

/** THE CLUSTER: is the army one body (as it stands, or on `cells`)? */
export function isClustered(world, army, cells = null) {
  return kingComponent(world, army, cells ?? new Map(army.pieces.map((p) => [p.id, cellOf(p)]))).size === army.pieces.length;
}

/**
 * THE RETRACTION: a walk whose end leaves the army in more than one body —
 * or a piece BEHIND THE KING'S CELL (the box's row) — gives back last
 * steps until it is one body with the king rearmost: first the steps of
 * the pieces outside the body that did not bring them nearer it (a pawn
 * that rounded a pillar a step too far waits a step beside the rook), then
 * the BODY'S own steps, the king first (he waits for a straggler still on
 * its way, and for the queued rook he stepped past at the door), then the
 * rest nearest the stragglers first. A piece stepping back onto a cell a
 * comrade took in its wake pushes that comrade back a step too, and nobody
 * steps back onto a cell behind the king. `skip` holds the stuck (they
 * teleport beside the body and do not count). Mutates `walked` (dest,
 * vias); returns whether the army is one body at the end (false only when
 * it was split before the walk began).
 */
function retractSplit(world, army, cells, walked, facing, skip = null) {
  const { dest, vias } = walked;
  const king = army.king;
  const kingStart = cells.get(king.id);
  const counts = (p) => !skip || !skip.has(p.id);
  const at = (c) => army.pieces.find((q) => { const d = dest.get(q.id); return d.f === c.f && d.r === c.r; });
  const steps = (p) => (vias.get(p.id)?.length ?? 0) + (dest.get(p.id).f !== cells.get(p.id).f || dest.get(p.id).r !== cells.get(p.id).r ? 1 : 0);
  // Behind the king (behindKing) and worse off than at the start of the turn.
  const behind = (p) => p !== king && behindKing(world, army, dest.get(p.id), dest.get(king.id), facing) && !behindKing(world, army, cells.get(p.id), kingStart, facing);
  // `kd`: the king's cell to judge against — his retreat cell while his own undo cascades into a comrade in his way.
  const undo = (p, depth = 0, kd = dest.get(king.id)) => {
    if (steps(p) === 0) return false; // nothing to give back (a piece already at its start would "step back" onto itself)
    const start = cells.get(p.id);
    const path = [start, ...(vias.get(p.id) ?? []), dest.get(p.id)];
    const startBad = p !== king && behindKing(world, army, start, kingStart, facing);
    while (path.length > 1) {
      path.pop();
      const c = path[path.length - 1];
      if (p !== king && !startBad && behindKing(world, army, c, kd, facing)) continue;
      const occ = at(c);
      if (occ && occ !== p && !(depth < army.pieces.length && undo(occ, depth + 1, p === king ? c : kd))) continue;
      dest.set(p.id, { f: c.f, r: c.r });
      vias.set(p.id, path.slice(1, -1));
      return true;
    }
    return false;
  };
  const cheb = (a, b) => Math.max(Math.abs(a.f - b.f), Math.abs(a.r - b.r));
  for (let guard = 0; guard < 8 * army.pieces.length; guard++) {
    const body = kingComponent(world, army, dest, skip);
    const outside = army.pieces.filter((p) => counts(p) && (!body.has(p.id) || behind(p)));
    if (outside.length === 0) return true;
    const bodyCells = [...body].filter((id) => !outside.some((p) => p.id === id)).map((id) => dest.get(id));
    const field = distanceField(world, army, bodyCells);
    const toBody = (c) => { const d = field[world.idx(c.f, c.r)]; return d < 0 ? 1e9 : d; };
    const nearestOf = (c, list) => Math.min(...list.map((b) => cheb(b, c)));
    const outsideCells = outside.map((p) => dest.get(p.id));
    // A step that brought a straggler nearer the body is kept.
    const givers = outside.filter((p) => steps(p) > 0 && !body.has(p.id)).filter((p) => {
      const path = [cells.get(p.id), ...(vias.get(p.id) ?? []), dest.get(p.id)];
      return toBody(path[path.length - 2]) <= toBody(dest.get(p.id));
    }).sort((a, b) => nearestOf(dest.get(a.id), bodyCells) - nearestOf(dest.get(b.id), bodyCells) || a.id - b.id);
    let undone = false;
    for (const p of givers) if (undo(p)) { undone = true; break; }
    if (undone) continue;
    const inside = army.pieces.filter((p) => body.has(p.id) && !outside.includes(p) && steps(p) > 0)
      .sort((a, b) => (a === king ? -1 : b === king ? 1 : 0) || nearestOf(dest.get(a.id), outsideCells) - nearestOf(dest.get(b.id), outsideCells) || a.id - b.id);
    for (const p of inside) if (undo(p)) { undone = true; break; }
    if (!undone) return false;
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
export function planTurn(world, army, input) {
  const king = army.king;
  const kind = input?.kind;
  const fail = (reason) => ({ ok: false, reason, facing: army.facing, at: { ...army.at }, moves: [] });
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
    const to = { f: at.f + stepDelta.df, r: at.r + stepDelta.dr };
    if (!fixed && !anchorMay(world, army, to, distanceField(world, army, [kc0]), kc0)) return fail('blocked');
    at = to;
  }
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
  // for a straggler still on its way the walk gives back steps (the
  // retraction) — the army waits; an army split before the walk began (a
  // piece moved away by hand) walks on and converges.
  const kingStart = cells.get(king.id);
  const settleBody = (w) => {
    const kd = w.dest.get(king.id);
    const behind = (p) => p !== king && behindKing(world, army, w.dest.get(p.id), kd, facing) && !behindKing(world, army, cells.get(p.id), kingStart, facing);
    const body = kingComponent(world, army, w.dest);
    if (body.size === army.pieces.length && !army.pieces.some(behind)) return true;
    const moved = (p) => { const d = w.dest.get(p.id), c = cells.get(p.id); return d.f !== c.f || d.r !== c.r; };
    // A laggard the body went on without: stuck, unless a comrade was what stopped it (queued: it is waited for).
    const stuckNow = new Set(army.pieces.filter((p) => !body.has(p.id) && !moved(p) && !w.queued?.has(p.id)).map((p) => p.id));
    for (const id of stuckNow) if (!w.stuck.includes(id)) w.stuck.push(id);
    if (kingComponent(world, army, w.dest, stuckNow).size + stuckNow.size === army.pieces.length && !army.pieces.some((p) => !stuckNow.has(p.id) && behind(p))) return true;
    const copy = { ...w, dest: new Map([...w.dest].map(([id, c]) => [id, { ...c }])), vias: new Map([...w.vias].map(([id, v]) => [id, v.map((c) => ({ ...c }))])) };
    if (retractSplit(world, army, cells, copy, facing, stuckNow)) { w.dest = copy.dest; w.vias = copy.vias; return true; }
    return false;
  };
  let walked = walk(world, army, cells, at, facing, fixed);
  let whole = settleBody(walked);
  if (stepDelta && !fixed) {
    const kd = walked.dest.get(king.id);
    const ks = slotCell(army.pattern, 0, at, facing);
    if (Math.max(Math.abs(kd.f - ks.f), Math.abs(kd.r - ks.r)) > KING_LEASH || !whole) {
      at = held;
      walked = walk(world, army, cells, at, facing, fixed);
      whole = settleBody(walked);
      regroup = true;
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
      taken.delete(world.idx(cur.f, cur.r));
      const want = slotCell(army.pattern, p.slot, at, facing);
      const body = [...kingComponent(world, army, dest)].filter((id) => id !== p.id).map((id) => dest.get(id));
      const c = placeNear(world, army, field, taken, want, kcFinal, facing, body) ?? placeNear(world, army, field, taken, want, kcFinal, facing);
      if (c && (c.f !== cur.f || c.r !== cur.r)) {
        dest.set(p.id, c);
        taken.add(world.idx(c.f, c.r));
        teleports.push(p.id);
        why[p.id] = reason;
        return true;
      }
      taken.add(world.idx(cur.f, cur.r));
      return false;
    };
    for (const id of stuck) {
      const p = army.piece(id);
      if (p !== king) place(p, 'stuck');
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
  // A step that moves nobody is the front meeting the wall.
  if (kind === 'step' && !pivot && moves.length === 0) return fail('blocked');
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
  const mold = (p, near) => targetOf(world, army, slotOf(p), fromKing, kc, facing, { origin, floorAt: kc, taken, near })
    ?? targetOf(world, army, slotOf(p), fromKing, kc, facing, { origin, floorAt: kc, taken });
  for (const p of molded) claim(p, mold(p, taken.size ? taken : null));
  // THE SET IS CONNECTED: the component holding the king's target grows
  // until it holds every target.
  if (!tK) return targets;
  const component = () => {
    const seen = new Set([idx(tK)]);
    const stack = [idx(tK)];
    while (stack.length) {
      const i = stack.pop();
      const f = i % world.files, r = (i - f) / world.files;
      for (const [df, dr] of KING_STEPS) {
        if (!world.inBounds(f + df, r + dr) || !touching(world, army, { f, r }, { f: f + df, r: r + dr })) continue;
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
    const t2 = targetOf(world, army, slotOf(pick.p), fromKing, kc, facing, { origin, floorAt: kc, taken, near: main });
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
  // (the rook takes the doorway ahead of him; his retraction gives back
  // any step past a comrade).
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
        // freely: where he ends ahead of a comrade, the retraction gives
        // his steps back (the third walk retired the planning rule that
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
        const myTarget = key(world, t.f, t.r);
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
          let byComrade = false;
          for (const m of pieceMoves(world, army, { ...p, f: start.f, r: start.r }, { viaComrades: true, facing })) {
            const d = dist(m.f, m.r);
            if (d < 0 || d >= here || !ahead(m.f, m.r)) continue;
            if (world.at(m.f, m.r) === FLOOR && !enemyAt(world, army, m.f, m.r)) { byComrade = true; break; }
          }
          if (byComrade) queued.add(p.id); else queued.delete(p.id);
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
        // no way to its target at all, or none that does not end up behind
        // the king — a pawn in a pocket beside him whose only way out is
        // round his back walks nowhere, so it rejoins by teleport.
        const stays = plan.final.f === start.f && plan.final.r === start.r;
        const region = p === king ? null : (f, r) => dyOf({ f, r }, kd) >= myFloor;
        if (here !== 0 && stays && (hereThrough < 0 || (region && distanceField(world, army, [t], null, region)[key(world, start.f, start.r)] < 0))) stuck.add(p.id);
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
 * pocket cannot hold takes the nearest vacant floor anywhere.
 */
export function spawnArmy(world, pattern, at, facing = 0, side = 'w', { lenient = false } = {}) {
  if (world.at(at.f, at.r) !== FLOOR) throw new Error(`spawn: (${at.f}, ${at.r}) is not floor`);
  const fc = normFacing(facing);
  const army = new Army({ side, facing: fc, pattern, pieces: [], at: anchorCell(pattern, at, fc) });
  army.pieces.push({ id: 1, ch: pattern.slots[0].ch, slot: 0, f: at.f, r: at.r });
  const taken = new Set([world.idx(at.f, at.r)]);
  const fromKing = distanceField(world, army, [at]);
  const direct = directFrom(world, fromKing, at);
  const vacant = (f, r) => world.at(f, r) === FLOOR && !world.pieceAt(f, r);
  for (let i = 1; i < pattern.slots.length; i++) {
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
  army.stamp(world);
  return army;
}
