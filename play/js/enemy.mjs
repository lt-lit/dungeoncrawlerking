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
import { Army, makePattern, spawnArmy, planTurn, applyTurn, manualMoves, distanceField, facingOfStep, bagOfPattern, pivotPlacement, anchorCell, boxOf, KING_STEPS } from './army.mjs';
import { FLOOR, HOLE, worldToArena } from './world.mjs';
import { childSeed } from './prng.mjs';
import { planBox, farRowTargets, boxAt, BOX } from './barrier.mjs';
import { normFacing } from './camera.mjs';

export const ENEMY_STATES = ['sentry', 'hunt', 'search'];
/** Recurring positions before a hunter pivots its formation loose. */
export const STALL_MAX = 3;
/** A second tangle within this many turns of that pivot is a REST of this many turns. */
export const REST_AFTER = 8;
export const REST_TURNS = 6;

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
  return { id: e.id, n: e.n, width: e.width, seed: e.seed, spawn: { ...e.spawn }, army: e.army.serialize(), state: e.state, lastSeen: e.lastSeen ? { ...e.lastSeen } : null, seen: !!e.seen, waypoint: e.waypoint ? { ...e.waypoint } : null, prev: e.prev ? { ...e.prev } : null };
}

export function loadEnemy(obj) {
  return { id: obj.id, n: obj.n, width: obj.width, seed: obj.seed, spawn: { ...obj.spawn }, army: Army.load(obj.army), state: ENEMY_STATES.includes(obj.state) ? obj.state : 'sentry', lastSeen: obj.lastSeen ? { ...obj.lastSeen } : null, seen: !!obj.seen, waypoint: obj.waypoint ? { ...obj.waypoint } : null, prev: obj.prev ? { ...obj.prev } : null };
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

/**
 * The same, FAST: the pivot's placement alone (army.mjs pivotPlacement —
 * the molded cells about the king, without the walk's box loop and rope
 * that a `face` turn runs after it), or null when that placement does not
 * fit a box along the axis. The hunter's GOALS read this (a far row is a
 * far row whichever of the two the pieces take); the TRIGGER and the drop
 * read the exact one.
 */
export function armyAlongFast(world, army, axis) {
  const fc = normFacing(axis);
  if (fc === army.facing) return army;
  const kc = { f: army.king.f, r: army.king.r };
  const placed = pivotPlacement(world, army, fc, kc);
  const pieces = army.pieces.map((p) => { const c = placed.get(p.id) ?? p; return { ...p, f: c.f, r: c.r }; });
  const along = new Army({ side: army.side, facing: fc, pattern: army.pattern, pieces, at: anchorCell(army.pattern, kc, fc) });
  return boxOf(along).ok ? along : null;
}

/** The player's army along each of the four axes — the fast pivots, ~3 ms
 *  each — computed ONCE per input by the page and handed to every
 *  hunter's goals. `exact: true` plans the real turns instead. */
export function axisArmies(world, army, { exact = false } = {}) {
  return [0, 1, 2, 3].map((axis) => (exact ? armyAlong(world, army, axis) : armyAlongFast(world, army, axis)));
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
export function hunterGoals(world, player, enemy, { ffish = null, seed = 1, alongs = null } = {}) {
  const side = enemyDealSide(enemy);
  const goals = [];
  const axes = [];
  const along4 = alongs ?? axisArmies(world, player);
  for (let axis = 0; axis < 4; axis++) {
    const along = along4[axis];
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
export function triggerFor(world, player, enemy, { ffish = null, seed = 1, turn = 'w', alongs = null } = {}) {
  if (enemy.state !== 'hunt') return null;
  const k = enemy.army.king;
  // The cheap half first: is the king nine ranks off along some axis at all?
  if (Math.abs(k.f - player.king.f) !== BOX - 1 && Math.abs(k.r - player.king.r) !== BOX - 1) return null;
  const side = enemyDealSide(enemy);
  void alongs; // the trigger plans the EXACT pivot (what the drop makes), on the one or two axes the king is nine off along
  const axes = [];
  if (k.r - player.king.r === BOX - 1) axes.push(0);
  if (k.f - player.king.f === BOX - 1) axes.push(1);
  if (player.king.r - k.r === BOX - 1) axes.push(2);
  if (player.king.f - k.f === BOX - 1) axes.push(3);
  for (const axis of axes) {
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
  const was = enemy.state;
  if (saw) {
    enemy.state = 'hunt';
    enemy.lastSeen = { f: player.king.f, r: player.king.r };
    enemy.seen = true;
  } else if (enemy.state === 'hunt') enemy.state = 'search';
  if (enemy.state !== was) enemy.waypoint = null;
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
export function enemyTurn(world, player, enemy, { ffish = null, seed = 1, alongs = null, sight = null } = {}) {
  let saw;
  if (sight === true) {
    // The instrument's knob (hunt-stress.mjs): sight granted, the chase alone measured.
    enemy.state = 'hunt';
    enemy.lastSeen = { f: player.king.f, r: player.king.r };
    enemy.seen = true;
    saw = true;
  } else saw = updateSight(world, player, enemy);
  const out = { plan: null, saw, state: enemy.state, goal: null, arrived: false, blocked: false, goals: 0, goalList: [], pivot: false, stalled: false, resting: false };
  let goals = [];
  if (enemy.state === 'hunt') {
    goals = hunterGoals(world, player, enemy, { ffish, seed, alongs }).goals;
    out.goalList = goals; // the threat display reads these (one computation a turn)
  } else if (enemy.state === 'search') {
    const k = enemy.army.king;
    if (enemy.lastSeen && !(k.f === enemy.lastSeen.f && k.r === enemy.lastSeen.r)) goals = [enemy.lastSeen];
    else {
      enemy.state = 'sentry';
      enemy.lastSeen = null;
      enemy.waypoint = null;
      out.state = enemy.state;
      out.arrived = true;
      return out;
    }
  } else return out;
  out.goals = goals.length;
  // A REST: a formation that tangled twice in a row on the same clutter
  // stands for a few turns rather than thrash (the player moves, the goals
  // move, the tangle may open).
  if ((enemy.rest ?? 0) > 0) {
    enemy.rest -= 1;
    out.resting = true;
    return out;
  }
  const army = enemy.army;
  const k = army.king;
  const prev = enemy.prev ?? null;
  // The king's neighbours that bring it STRICTLY nearer a target (`steps`),
  // and the ones that keep it as near (`level`, never straight back to the
  // cell it came from) for when the formation cannot make a nearer step.
  const stepsToward = (targets) => {
    const field = distanceField(world, army, targets);
    const d0 = field[world.idx(k.f, k.r)];
    if (d0 === 0) return { onGoal: true, steps: [], level: [], field, d0 };
    const steps = [], level = [];
    for (const [df, dr] of KING_STEPS) {
      const f = k.f + df, r = k.r + dr;
      if (!world.inBounds(f, r)) continue;
      const d = field[world.idx(f, r)];
      if (d < 0) continue;
      if (d0 < 0 || d < d0) steps.push({ df, dr, d });
      else if (d === d0 && !(prev && prev.f === f && prev.r === r)) level.push({ df, dr, d });
    }
    const byNear = (a, b) => a.d - b.d || Math.abs(a.df) + Math.abs(a.dr) - (Math.abs(b.df) + Math.abs(b.dr));
    steps.sort(byNear);
    level.sort(byNear);
    return { onGoal: false, steps, level, field, d0 };
  };
  // Toward the targets by the BFS; when none is reachable, toward a
  // WAYPOINT — the reachable cell nearest one of them (the mouth of
  // wherever it hides: a hunter parks against the wall line, a searcher at
  // the closed door) — HELD until reached (a cell recomputed every turn
  // relative to the moving king had the army pacing between two cells).
  const approach = (targets, kind) => {
    const first = stepsToward(targets);
    if (first.onGoal || first.steps.length || first.level.length) {
      enemy.waypoint = null;
      return first;
    }
    let wp = enemy.waypoint && enemy.waypoint.kind === kind ? enemy.waypoint : null;
    if (wp && wp.f === k.f && wp.r === k.r) {
      enemy.waypoint = null;
      return { ...first, onGoal: true };
    }
    if (!wp) {
      const reach = distanceField(world, army, [{ f: k.f, r: k.r }]);
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
      if (!best || (best.f === k.f && best.r === k.r)) {
        enemy.waypoint = null;
        return { ...first, onGoal: true };
      }
      wp = { f: best.f, r: best.r, kind };
      enemy.waypoint = wp;
    }
    const s = stepsToward([{ f: wp.f, r: wp.r }]);
    if (!s.onGoal && !s.steps.length && !s.level.length) {
      enemy.waypoint = null;
      return { ...s, onGoal: true };
    }
    return s;
  };
  let got = approach(goals, enemy.state === 'hunt' ? 'goal' : 'search');
  if (got.onGoal && enemy.state === 'hunt' && got.d0 !== 0) {
    // No legal cell reachable: walk at the player's king.
    const pk = player.king;
    const near = KING_STEPS.map(([df, dr]) => ({ f: pk.f + df, r: pk.r + dr })).filter((c) => world.inBounds(c.f, c.r) && world.at(c.f, c.r) === FLOOR);
    got = approach(near.length ? near : [{ f: pk.f, r: pk.r }], 'king');
  }
  if (got.onGoal) {
    out.arrived = true;
    return out;
  }
  const { steps, level, field, d0 } = got;
  // THE STEP, judged by its OUTCOME: the plan of each candidate in order,
  // the first that moves the king nearer taken; else the plan that moves
  // him nearest; else the first plan that runs (a regroup — the pawns
  // filing through a door while the king waits is progress). A STALL is a
  // position the army has stood in before within the last few turns (a
  // formation tangled on clutter cycles; a file through a door does not),
  // and after STALL_MAX of them the army PIVOTS to face its way (ruling
  // 14's wheel re-molds the formation about the king — a human player's
  // own way out of a tangle); a second tangle within a few turns of that
  // is the REST above.
  const from = { f: k.f, r: k.r };
  const kingAfter = (plan) => plan.moves.find((m) => m.id === k.id)?.to ?? from;
  const posHash = () => `${army.pieces.map((p) => `${p.f},${p.r}`).join(';')}|${army.facing}`;
  if ((enemy.stall ?? 0) >= STALL_MAX) {
    if ((enemy.sinceEscape ?? 99) < REST_AFTER) {
      enemy.rest = REST_TURNS;
      enemy.stall = 0;
      enemy.hist = [];
      enemy.sinceEscape = 99;
      out.resting = true;
      return out;
    }
    const want = steps[0] ?? level[0] ?? null;
    const wantFacing = want ? facingOfStep(army.facing, want.df, want.dr) : (army.facing + 1) % 4;
    for (const fc of [wantFacing, (army.facing + 1) % 4, (army.facing + 3) % 4, (army.facing + 2) % 4]) {
      if (fc === army.facing) continue;
      const pv = planTurn(world, army, { kind: 'face', facing: fc });
      if (!pv.ok) continue;
      applyTurn(world, army, pv);
      out.plan = pv;
      out.pivot = true;
      enemy.stall = 0;
      enemy.hist = [];
      enemy.sinceEscape = 0;
      if (sight !== true) updateSight(world, player, enemy);
      out.state = enemy.state;
      return out;
    }
  }
  // The order of merit: the king nearer; a regroup on a NEARER direction
  // (the pawns file on, the king waits — a corridor's normal gait); only
  // then a level move of the king; a regroup on a level direction last.
  // THE KING'S OWN MOVE FIRST (ruling 10 — his chess move, the army taking
  // its formation move with it): a `move` input pins him to the cell the
  // BFS chose, where a d-pad step's catch-up could carry him two cells and
  // straight past the far-row cell he was walking to; the step is the
  // fallback where his move is not offered (the box would not hold).
  const kingMoves = manualMoves(world, army, k);
  const inputFor = (s) => {
    const to = { f: k.f + s.df, r: k.r + s.dr };
    const mm = kingMoves.find((m) => m.f === to.f && m.r === to.r && !m.capture);
    return mm ? { kind: 'move', id: k.id, to } : { kind: 'step', df: s.df, dr: s.dr };
  };
  let best = null;
  for (const s of steps) {
    const plan = planTurn(world, army, inputFor(s));
    if (!plan.ok) continue;
    const ka = kingAfter(plan);
    const moved = !(ka.f === from.f && ka.r === from.r);
    const d = field[world.idx(ka.f, ka.r)];
    const score = moved ? (d >= 0 && d < d0 ? d : 300 + (d >= 0 ? d : 90)) : 500 + s.d;
    if (!best || score < best.score) best = { plan, s, score, moved };
    if (moved && d >= 0 && d < d0) break;
  }
  if (!best || best.score >= 500) for (const s of level) {
    const plan = planTurn(world, army, inputFor(s));
    if (!plan.ok) continue;
    const ka = kingAfter(plan);
    const moved = !(ka.f === from.f && ka.r === from.r);
    const d = field[world.idx(ka.f, ka.r)];
    const score = moved ? 600 + (d >= 0 ? d : 90) : 1000;
    if (!best || score < best.score) best = { plan, s, score, moved };
  }
  if (!best) {
    out.blocked = true;
    return out;
  }
  applyTurn(world, army, best.plan);
  out.plan = best.plan;
  out.goal = best.s;
  if (best.moved) enemy.prev = from;
  enemy.sinceEscape = (enemy.sinceEscape ?? 99) + 1;
  const h = posHash();
  const hist = enemy.hist ?? [];
  if (hist.includes(h)) {
    enemy.stall = (enemy.stall ?? 0) + 1;
    out.stalled = true;
  } else enemy.stall = 0;
  enemy.hist = [...hist, h].slice(-6);
  // Sight after the move: a hunter that stepped out of sight is searching, not hunting.
  if (sight !== true) updateSight(world, player, enemy);
  out.state = enemy.state;
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
