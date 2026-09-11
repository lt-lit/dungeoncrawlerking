// THE ENEMIES — Phase 2 milestone 6 (2026-09-10, the enemies session;
// brief §5.1–§5.4, CLAUDE.md § "THE ENEMIES SESSION"). Pure and
// Node-testable (phase0/harness/test-enemy.mjs); main.mjs § THE WALK
// runs the turn loop and the drop.
//
// AN ENEMY IS THE SAME ARMY: an army.mjs Army on the black side with a
// pattern from its spawn's digit (the WIDTH — brief §8's level telegraph;
// all threes for now, designer 2026-09-10) and a composition drawn from
// the run's seed in a band (nine to thirteen points at width 3: knights
// and bishops up to two rooks, no queens), driven through the walk's own
// turn planner with step inputs, so the cluster, the box and nobody-
// behind-the-king hold for it as for the player; its pieces trail its
// king in formation on the map and are re-molded at the drop (ruling 16),
// so only its king's cell decides a duel.
//
// SENTRY → HUNT → SEARCH (brief §5.2): a sentry stands until its king
// SEES yours — king to king on the cell grid, a ray through cell centres;
// walls, doors and crates block, holes do not; no range cap, no fog —
// checked after EVERY move. A hunter walks toward THE TRIGGER: the far
// rows of the four 10×10 boxes on the player's king (one per world axis,
// each slid to hold his army — barrier.mjs, the walk's own boxOf — and
// for an axis other than his facing the box of the army AS THE DROP
// WOULD PIVOT IT), the cells where the deal comes out legal for THIS
// enemy's bag (planBox: molded around the player's pieces, the gap
// between the camp lines, the lint), by a BFS over ground it can cross
// (its own pieces pass; the player's, furniture, holes and walls block —
// a closed door is a wall to it). With no legal cell reachable it walks
// at the player's king and parks at the mouth of wherever he hides.
// Sight lost sends it to the last-seen cell, where it stands (a sentry
// again). A duel starts the moment a HUNTING king stands on a far-row
// cell with a legal deal; the side whose move completed it moves first.
import { Army, makePattern, spawnArmy, planTurn, applyTurn, distanceField, facingOfStep, bagOfPattern, KING_STEPS } from './army.mjs';
import { FLOOR, HOLE, worldToArena } from './world.mjs';
import { childSeed } from './prng.mjs';
import { planBox, farRowTargets, boxAt, BOX } from './barrier.mjs';
import { normFacing } from './camera.mjs';

export const ENEMY_STATES = ['sentry', 'hunt', 'search'];

/** The composition band at a width (designer 2026-09-10: nine to thirteen
 *  points at width 3 — width + 4 per piece, ±2 — which no queen fits). */
export function enemyBudget(width) {
  return { budget: width + 4 * (width - 1), budgetTol: 2 };
}

/**
 * The facing a sentry stands with: the first step of the way from its
 * cell toward `toward` (the start — it looks the way you come); north
 * when there is no way. Every letter passes (a facing is cosmetic).
 */
export function facingToward(world, from, toward) {
  if (!toward) return 0;
  const field = distanceField(world, { owns: () => true }, [toward]);
  let best = null;
  for (const [df, dr] of KING_STEPS) {
    const f = from.f + df, r = from.r + dr;
    if (!world.inBounds(f, r)) continue;
    const d = field[world.idx(f, r)];
    if (d < 0) continue;
    if (!best || d < best.d) best = { df, dr, d };
  }
  if (!best) return 0;
  if (best.df && best.dr) {
    // A diagonal first step: the cardinal of the longer leg to the target (ties north / south).
    const dx = toward.f - from.f, dy = toward.r - from.r;
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy >= 0 ? 0 : 2);
  }
  return facingOfStep(0, best.df, best.dr);
}

/**
 * THE SPAWNS: an enemy for every digit on the map (world.spawns, sorted
 * by number), its width the digit, its two-piece bag drawn from the run's
 * seed, its army stamped on the floor facing the way the start lies. A
 * spawn the floor cannot hold is skipped. Returns [{ id, n, width, seed,
 * spawn, army, state, lastSeen, seen }].
 */
export function spawnEnemies(world, runSeed, { archetype = 'heavies-deep' } = {}) {
  const out = [];
  for (const s of world.spawns) {
    const width = Math.max(3, Math.min(8, s.n | 0));
    const seed = childSeed(runSeed >>> 0, `enemy:${s.n}:${s.f},${s.r}`);
    const pattern = makePattern({ width, royal: 'K', ...enemyBudget(width) }, { archetype, seed });
    const facing = facingToward(world, { f: s.f, r: s.r }, world.start);
    let army;
    try {
      army = spawnArmy(world, pattern, { f: s.f, r: s.r }, facing, 'b');
    } catch {
      continue;
    }
    out.push({ id: out.length + 1, n: s.n, width, seed, spawn: { f: s.f, r: s.r }, army, state: 'sentry', lastSeen: null, seen: false });
  }
  return out;
}

export function serializeEnemy(e) {
  return { id: e.id, n: e.n, width: e.width, seed: e.seed, spawn: { ...e.spawn }, army: e.army.serialize(), state: e.state, lastSeen: e.lastSeen ? { ...e.lastSeen } : null, seen: !!e.seen };
}

export function loadEnemy(obj) {
  return { id: obj.id, n: obj.n, width: obj.width, seed: obj.seed, spawn: { ...obj.spawn }, army: Army.load(obj.army), state: ENEMY_STATES.includes(obj.state) ? obj.state : 'sentry', lastSeen: obj.lastSeen ? { ...obj.lastSeen } : null, seen: !!obj.seen };
}

/**
 * LINE OF SIGHT between two cells: a ray through the cell centres; every
 * cell it crosses between them must be see-through — floor or a hole
 * (walls, doors and crates block; pieces never do). A ray through the
 * corner between two cells passes when either of them is see-through.
 */
export function lineOfSight(world, a, b) {
  if (a.f === b.f && a.r === b.r) return true;
  const clear = (f, r) => {
    if (!world.inBounds(f, r)) return false;
    const t = world.at(f, r);
    return t === FLOOR || t === HOLE;
  };
  let x = a.f, y = a.r;
  const dx = b.f - a.f, dy = b.r - a.r;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const ax = Math.abs(dx), ay = Math.abs(dy);
  let tx = ax ? 0.5 / ax : Infinity, ty = ay ? 0.5 / ay : Infinity;
  const dtx = ax ? 1 / ax : Infinity, dty = ay ? 1 / ay : Infinity;
  for (let guard = 0; guard < ax + ay + 2; guard++) {
    if (x === b.f && y === b.r) return true;
    if (Math.abs(tx - ty) < 1e-9) {
      const side = clear(x + sx, y) || clear(x, y + sy);
      x += sx; y += sy; tx += dtx; ty += dty;
      if (!side) return false;
      if (x === b.f && y === b.r) return true;
      if (!clear(x, y)) return false;
    } else if (tx < ty) {
      x += sx; tx += dtx;
      if (x === b.f && y === b.r) return true;
      if (!clear(x, y)) return false;
    } else {
      y += sy; ty += dty;
      if (x === b.f && y === b.r) return true;
      if (!clear(x, y)) return false;
    }
  }
  return x === b.f && y === b.r;
}

/**
 * The player's army AS IT WOULD STAND along an axis: itself along its
 * facing; along another, the army after the pivot the drop would make
 * (ruling 14's wheel — a `face` turn planned on the world, not applied),
 * or null when it cannot turn that way.
 */
export function armyAlong(world, army, axis) {
  const fc = normFacing(axis);
  if (fc === army.facing) return army;
  const plan = planTurn(world, army, { kind: 'face', facing: fc });
  if (!plan.ok) return null;
  const cells = new Map(plan.moves.map((m) => [m.id, m.to]));
  const pieces = army.pieces.map((p) => { const c = cells.get(p.id) ?? p; return { ...p, f: c.f, r: c.r }; });
  return new Army({ side: army.side, facing: fc, pattern: army.pattern, pieces, at: plan.at });
}

/** The deal's enemy side for an enemy on the map: its bag as it walks. */
export function enemyDealSide(enemy) {
  return { army: bagOfPattern(enemy.army.pattern), order: 'as-given' };
}

/**
 * THE HUNTER'S GOALS: every far-row cell of the four boxes on the player's
 * king where the deal comes out legal for this enemy's bag — the trigger
 * function itself (barrier.mjs farRowTargets), grid-only unless `ffish` is
 * given. Returns { goals: [{ f, r, axis, file }] in world cells, axes:
 * [{ axis, crop, kingFile, pivot }] }.
 */
export function hunterGoals(world, player, enemy, { ffish = null, seed = 1 } = {}) {
  const side = enemyDealSide(enemy);
  const goals = [];
  const axes = [];
  for (let axis = 0; axis < 4; axis++) {
    const along = armyAlong(world, player, axis);
    if (!along) continue;
    const t = farRowTargets(world, along, { enemy: side, seed, axis, ffish });
    if (!t.ok) continue;
    axes.push({ axis, crop: t.crop, kingFile: t.kingFile, pivot: along !== player });
    for (const c of t.cells) goals.push({ f: c.world.f, r: c.world.r, axis, file: c.f });
  }
  return { goals, axes };
}

/**
 * THE TRIGGER for one enemy: a HUNTING king standing on a far-row cell of
 * one of the player's four boxes where the deal is legal. `turn` is the
 * side whose move completed the alignment ('w' the player's, 'b' the
 * enemy's — the deal's initiative, brief §4.4). Returns the candidate
 * { enemy, axis, file, plan, pivot, turn } or null.
 */
export function triggerFor(world, player, enemy, { ffish = null, seed = 1, turn = 'w' } = {}) {
  if (enemy.state !== 'hunt') return null;
  const k = enemy.army.king;
  const side = enemyDealSide(enemy);
  for (let axis = 0; axis < 4; axis++) {
    const along = armyAlong(world, player, axis);
    if (!along) continue;
    const box = boxAt(world, along, axis);
    if (!box.ok) continue;
    const a = worldToArena(box.crop, k.f, k.r);
    if (!a || a.r !== BOX - 1) continue;
    const plan = planBox(world, along, { enemy: side, enemyFile: a.f, axis, seed, turn, ffish });
    if (plan.ok) return { enemy, axis, file: a.f, plan, pivot: along !== player, turn };
  }
  return null;
}

/** Update an enemy's sight of the player's king: sentry → hunt on sight,
 *  hunt → search when sight is lost. Returns whether it sees. */
export function updateSight(world, player, enemy) {
  const saw = lineOfSight(world, enemy.army.king, player.king);
  if (saw) {
    enemy.state = 'hunt';
    enemy.lastSeen = { f: player.king.f, r: player.king.r };
    enemy.seen = true;
  } else if (enemy.state === 'hunt') enemy.state = 'search';
  return saw;
}

/**
 * THE ENEMY'S TURN: one step of its army toward its goal — the nearest
 * legal far-row cell while hunting (or the player's king when none is
 * reachable), the last-seen cell while searching; a sentry stands. The
 * step is the king's neighbour nearest a goal by the BFS, cardinals
 * before diagonals on a tie, fed to planTurn as the army's own step; a
 * refused step tries the next neighbour; nothing walkable is a stand.
 * Sight is read before the move (the state) and after it (the trigger
 * needs a hunter that still sees). Mutates the enemy and the world.
 * Returns { plan, saw, state, goal, arrived, blocked }.
 */
export function enemyTurn(world, player, enemy, { ffish = null, seed = 1 } = {}) {
  const saw = updateSight(world, player, enemy);
  const out = { plan: null, saw, state: enemy.state, goal: null, arrived: false, blocked: false, goals: 0, goalList: [] };
  let goals = [];
  if (enemy.state === 'hunt') {
    goals = hunterGoals(world, player, enemy, { ffish, seed }).goals;
    out.goalList = goals; // the threat display reads these (one computation a turn)
  } else if (enemy.state === 'search') {
    const k = enemy.army.king;
    if (enemy.lastSeen && !(k.f === enemy.lastSeen.f && k.r === enemy.lastSeen.r)) goals = [enemy.lastSeen];
    else {
      enemy.state = 'sentry';
      enemy.lastSeen = null;
      out.state = enemy.state;
      out.arrived = true;
      return out;
    }
  } else return out;
  out.goals = goals.length;
  const k = enemy.army.king;
  // The king's neighbours that bring it STRICTLY nearer a target (a step
  // that does not is drift — a formation that cannot stand on the goal
  // cell would otherwise slide along the wall forever); none → it parks.
  const stepsToward = (targets) => {
    const field = distanceField(world, enemy.army, targets);
    const d0 = field[world.idx(k.f, k.r)];
    if (d0 === 0) return { onGoal: true, steps: [] };
    const steps = [];
    for (const [df, dr] of KING_STEPS) {
      const f = k.f + df, r = k.r + dr;
      if (!world.inBounds(f, r)) continue;
      const d = field[world.idx(f, r)];
      if (d >= 0 && (d0 < 0 || d < d0)) steps.push({ df, dr, d });
    }
    steps.sort((a, b) => a.d - b.d || Math.abs(a.df) + Math.abs(a.dr) - (Math.abs(b.df) + Math.abs(b.dr)));
    return { onGoal: false, steps };
  };
  // Toward the targets by the BFS; when none is reachable, toward the
  // reachable cell nearest one of them (the mouth of wherever it hides —
  // a hunter parks against the wall line, a searcher at the closed door).
  const approach = (targets) => {
    const first = stepsToward(targets);
    if (first.onGoal || first.steps.length) return first;
    const reach = distanceField(world, enemy.army, [{ f: k.f, r: k.r }]);
    let best = null;
    for (let i = 0; i < world.size; i++) {
      if (reach[i] < 0) continue;
      const f = i % world.files, r = (i - f) / world.files;
      for (const t of targets) {
        const d = Math.max(Math.abs(f - t.f), Math.abs(r - t.r));
        const m = Math.abs(f - t.f) + Math.abs(r - t.r); // the straighter of two equally near cells
        if (!best || d < best.d || (d === best.d && (m < best.m || (m === best.m && reach[i] < best.n)))) best = { f, r, d, m, n: reach[i] };
      }
    }
    if (!best || (best.f === k.f && best.r === k.r)) return { onGoal: true, steps: [] };
    return stepsToward([{ f: best.f, r: best.r }]);
  };
  let { onGoal, steps } = goals.length ? stepsToward(goals) : { onGoal: false, steps: [] };
  if (onGoal) {
    out.arrived = true;
    return out;
  }
  if (!steps.length) {
    if (enemy.state === 'hunt') {
      // No legal cell reachable: walk at the player's king.
      const pk = player.king;
      const near = KING_STEPS.map(([df, dr]) => ({ f: pk.f + df, r: pk.r + dr })).filter((c) => world.inBounds(c.f, c.r) && world.at(c.f, c.r) === FLOOR);
      ({ onGoal, steps } = approach(near.length ? near : [{ f: pk.f, r: pk.r }]));
    } else ({ onGoal, steps } = approach(goals));
    if (onGoal) {
      out.arrived = true;
      return out;
    }
  }
  for (const s of steps) {
    const plan = planTurn(world, enemy.army, { kind: 'step', df: s.df, dr: s.dr });
    if (!plan.ok) continue;
    applyTurn(world, enemy.army, plan);
    out.plan = plan;
    out.goal = s;
    // Sight after the move: a hunter that stepped out of sight is searching, not hunting.
    updateSight(world, player, enemy);
    out.state = enemy.state;
    return out;
  }
  out.blocked = true;
  return out;
}

/**
 * THE THREAT DISPLAY's cells (brief §5.4): the far-row cells lit while any
 * enemy hunts — the union of every hunter's goals — in world cells.
 */
export function threatCells(world, player, enemies, { ffish = null, seed = 1 } = {}) {
  const seen = new Map();
  for (const e of enemies) {
    if (e.state !== 'hunt') continue;
    for (const g of hunterGoals(world, player, e, { ffish, seed }).goals) seen.set(`${g.f},${g.r}`, { f: g.f, r: g.r });
  }
  return [...seen.values()];
}

/**
 * A BYSTANDER at the drop (a second army with pieces inside the box): its
 * letters inside the crop leave the floor for the duel (the pieces keep
 * their cells). Returns the pieces lifted.
 */
export function liftInside(world, enemy, crop) {
  const lifted = [];
  for (const p of enemy.army.pieces) {
    if (!worldToArena(crop, p.f, p.r)) continue;
    const i = world.idx(p.f, p.r);
    if (enemy.army.owns(world.pieces[i])) world.pieces[i] = null;
    enemy.army.stamped?.delete(i);
    lifted.push({ id: p.id, f: p.f, r: p.r });
  }
  return lifted;
}

/**
 * SET A BYSTANDER BACK after the duel: each of its pieces on its own cell
 * when that is vacant floor, else the nearest vacant floor (the duel may
 * have dug a pit under it). Re-stamps the army.
 */
export function settleBack(world, enemy) {
  const taken = new Set();
  const vacant = (f, r) => world.inBounds(f, r) && world.at(f, r) === FLOOR && !world.pieceAt(f, r) && !taken.has(world.idx(f, r));
  for (const p of enemy.army.pieces) {
    if (!vacant(p.f, p.r)) {
      let best = null;
      for (let i = 0; i < world.size; i++) {
        const f = i % world.files, r = (i - f) / world.files;
        if (!vacant(f, r)) continue;
        const d = Math.max(Math.abs(f - p.f), Math.abs(r - p.r));
        if (!best || d < best.d) best = { f, r, d };
      }
      if (best) { p.f = best.f; p.r = best.r; }
    }
    taken.add(world.idx(p.f, p.r));
  }
  enemy.army.stamped = new Set();
  enemy.army.stamp(world);
}

/** An enemy's one-line description for the status strip and the chooser. */
export function describeEnemy(enemy) {
  const back = enemy.army.pattern.slots.slice(1).map((s) => s.ch.toUpperCase()).filter((ch) => ch !== 'P');
  const pawns = enemy.army.pieces.length - back.length - 1;
  return `${enemy.width} wide · ${back.join(' ')} + ${pawns} pawn${pawns === 1 ? '' : 's'}`;
}
