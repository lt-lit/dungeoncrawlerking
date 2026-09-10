// THE BOX — Phase 2 milestone 5 (2026-09-08, the trigger conversation),
// THE DUEL START (2026-09-10, the enemies session — brief §5.1 rulings 3,
// 9 and 16). Pure: where the barrier drops on an army as it stands, and
// the deal it makes. Milestone 4c's barrier by hand measured the room's
// width and iterated the depth; the designer replaced both the same day:
//
//   "just make it always a 10x10 arena. As soon as the two armies fit in a
//    10x10 box and it's a legal board state with both kings in the right
//    rows, then the duel can start."
//
//   • THE ARENA IS ALWAYS 10×10 (BOX). The player's king anchors it (brief
//     §4.2): his rank is arena row 0, the AXIS arena-north — his facing by
//     default, or any of the four world directions for a catch from the
//     side or behind (the drop PIVOTS the army to the axis first: main.mjs
//     walkBarrier, a `face` turn — ruling 14's wheel) — so the arena reads
//     north-up under the camera that turns for the duel. The room's walls,
//     whatever stands in the box, are the arena's terrain; a square off
//     the map is the barrier's wall (World.arenaFen).
//   • THE PLACEMENT is THE WALK'S OWN RULE (army.mjs boxOf — ruling 15:
//     the army always fits a box, slid along the king's rank to hold every
//     piece and centred on the formation when there is slack). The first
//     cut slid the box to keep the room's floor run inside it (the army
//     hugging the edge — designer 2026-09-09: "why is the arena bounds not
//     centered around the armies?"), the second centred it on the king's
//     FILE; now the walk's box and the barrier's box are one function. A
//     lone king (the generator's lint) still gets the centred box, file 4.
//   • THE PLAYER'S PIECES STAND WHERE THEY STAND (ruling 3): nothing is
//     summoned — the walk's cells through the crop are the deal's white
//     cells (armygen buildMatchup `white.cells`); 4c's "the stamp is the
//     pattern" is retired.
//   • THE GAP IS BETWEEN THE CAMP LINES (ruling 9): each side's pawn line,
//     never the front-most pieces, with a MINIMUM OF 2 (GAP_MIN, designer);
//     a piece pre-moved ahead of the pawns sits inside the gap and the
//     ENEMY MOLDS AROUND IT (ruling 16): the enemy's summoning lands on
//     ground connected to its king (`reach`) that no player piece holds.
//   • THE ENEMY KING stands on the FAR ROW (arena row 9) — on ANY file of
//     it (THE BAND, brief §5.3, confirmed 2026-09-10): `planBox` takes the
//     enemy's file; the button (`planBarrier`) tries the king's own file
//     first and walks outward. The kings are ALWAYS nine apart. A far-row
//     cell where the deal fails the lint — the player's rook covering that
//     file, say — is no target: the hunter walks round it.
//   • The enemy is dealt fresh from a spec (the setup screen's Black knobs)
//     and re-dealt on a lint failure, as dealMatchup does; an enemy that
//     walks the map (milestone 6) carries its own pattern in as `army`.
//
// Node gate: phase0/harness/test-barrier.mjs.

import { cropTransform, arenaToWorld, worldToArena, FLOOR, WALL } from './world.mjs';
import { normFacing } from './camera.mjs';
import { rotateBody, bagOfPattern, boxOf } from './army.mjs';
import { buildMatchup, armiesConnected, campLineRank, registerDealVariant, lintMatchupFen } from './armygen.mjs';
import { dealVariant } from './variant.mjs';
import { childSeed } from './prng.mjs';

/** THE ARENA IS ALWAYS 10×10 (designer 2026-09-08). */
export const BOX = 10;
/** The least gap a deal may leave between the two camp lines (designer 2026-09-08; between the pawn lines since 2026-09-10, ruling 9). */
export const GAP_MIN = 2;

/**
 * The floor run through a cell across a facing: how many floor cells lie
 * to the left and to the right before anything else (a wall, a pit,
 * furniture, the map's edge). `isFloor(f, r)` must be false off the map.
 * Reported for the record; it decides nothing.
 */
export function floorRun(isFloor, at, facing) {
  const right = rotateBody(1, 0, facing);
  const run = (sign) => {
    let n = 0;
    for (let k = 1; ; k++) {
      if (!isFloor(at.f + sign * right.df * k, at.r + sign * right.dr * k)) break;
      n++;
    }
    return n;
  };
  return { left: run(-1), right: run(1) };
}

/**
 * THE PLACEMENT of a LONE king (the generator's lint — no army stands
 * with him): the walk's rule on a one-piece army, which is the centred
 * box — file 4 of ten, four files to his left and five to his right. The
 * floor run through his cell is reported for the record. Pure —
 * `isFloor(f, r)` reads the ground. `box` is BOX (the rule's).
 */
export function boxPlacement(isFloor, king, facing, box = BOX) {
  void box;
  const { left, right } = floorRun(isFloor, king, facing);
  const lone = { king: { id: 1, f: king.f, r: king.r }, pieces: [{ id: 1, f: king.f, r: king.r }], facing };
  return { kingFile: boxOf(lone, null, facing).kingFile, left, right, width: left + 1 + right };
}

/**
 * The crop transform of a `files` × `ranks` arena whose row 0 is the
 * king's rank, arena-north the facing, the king on arena file `kingFile`.
 */
export function cropAt(world, king, facing, files, kingFile, ranks) {
  const base = cropTransform({ wf: 0, wr: 0, facing, files, ranks, worldFiles: world.files, worldRanks: world.ranks });
  const c0 = arenaToWorld(base, kingFile, 0);
  return cropTransform({ wf: king.f - c0.f, wr: king.r - c0.r, facing, files, ranks, worldFiles: world.files, worldRanks: world.ranks });
}

/**
 * THE BOX on an army as it stands along an axis (its facing by default):
 * the walk's rule (army.mjs boxOf) — slid along the king's rank to hold
 * every piece, centred on the formation when there is slack — and the
 * 10×10 crop it makes. `ok` is false when the army does not fit a box
 * along that axis (a piece behind the king along it — the drop pivots
 * first); `box` is boxOf's reading, `left` / `right` the floor run.
 */
export function boxAt(world, army, axis = army.facing) {
  const facing = normFacing(axis);
  const b = boxOf(army, null, facing);
  const run = floorRun((f, r) => world.at(f, r) === FLOOR, army.king, facing);
  // No crop for an army the box does not hold (its file can lie outside 0…9).
  const crop = b.ok ? cropAt(world, army.king, facing, BOX, b.kingFile, BOX) : null;
  return { crop, kingFile: b.kingFile, ok: b.ok, box: b, facing, left: run.left, right: run.right, width: run.left + 1 + run.right };
}

/**
 * The cells of a stage a royal can reach by king steps without crossing
 * stone (furniture is passable — the brief's connectivity rule: an army
 * can smash through), as a predicate on arena (f, r). The summoning
 * materializes on these cells alone.
 */
export function reachOf(stage, from) {
  const { grid, files, ranks } = stage;
  const seen = new Uint8Array(files * ranks);
  const q = [];
  const push = (f, r) => {
    if (f < 0 || f >= files || r < 0 || r >= ranks) return;
    const i = r * files + f;
    if (seen[i] || grid[r][f] === WALL) return;
    seen[i] = 1;
    q.push(i);
  };
  push(from.f, from.r);
  while (q.length) {
    const i = q.pop();
    const f = i % files, r = (i - f) / files;
    for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) if (df || dr) push(f + df, r + dr);
  }
  const reach = (f, r) => f >= 0 && f < files && r >= 0 && r < ranks && seen[r * files + f] === 1;
  reach.count = seen.reduce((a, b) => a + b, 0);
  return reach;
}

/**
 * THE PLAYER'S PIECES WHERE THEY STAND, as the deal's white cells on the
 * crop's stage: [{ f, r, piece }], the king first. Null when a piece
 * stands outside the crop (the box did not hold it) or on stone.
 */
export function standingCells(army, crop, stage) {
  const cells = [];
  for (const p of army.pieces) {
    const a = worldToArena(crop, p.f, p.r);
    if (!a || stage.grid[a.r][a.f] !== null) return null;
    cells.push({ f: a.f, r: a.r, piece: p.ch.toUpperCase() });
  }
  return cells;
}

/**
 * Plan the box on an army as it stands along `axis` (its facing by
 * default), the enemy king on `enemyFile` of the far row: the crop, the
 * stage the crop makes, and the deal read into it (dealMatchup's shape —
 * the session, the log and the debris layer read it like any other deal).
 * The army must already fit the box along the axis (boxAt's `ok`): a catch
 * from the side or behind is the drop's to pivot for before calling.
 *
 * opts = {
 *   enemy: { spec | army, archetype },   — the enemy's bag (the setup screen's Black knobs, or a walking army's pattern)
 *   enemyFile,                            — the enemy king's arena file on row 9 (default: the player's king's file)
 *   axis,                                 — the world direction that is arena-north (default: the army's facing)
 *   seed,                                 — the deal's seed (the Director's derives from it)
 *   turn: 'w' | 'b',                      — initiative (the player is always White)
 *   ffish, attempts: 8, id,               — `id` names the stage (default: world@crop)
 * }
 * Returns { ok: true, crop, stage, kingFile, enemyFile, axis, deal } or { ok: false, error, reasons }.
 */
export function planBox(world, army, { enemy, enemyFile = null, axis = null, seed = 1, turn = 'w', ffish = null, attempts = 8, id = null } = {}) {
  const facing = axis === null || axis === undefined ? army.facing : normFacing(axis);
  const box = boxAt(world, army, facing);
  if (!box.ok) return { ok: false, error: 'the army does not fit the box along this axis', reasons: ['box'] };
  const { crop, kingFile } = box;
  const ef = enemyFile ?? kingFile;
  if (ef < 0 || ef >= BOX) return { ok: false, error: `enemy file ${ef} outside the box`, reasons: ['enemy file'] };
  const stage = world.arenaStage(crop, { id });
  const cells = standingCells(army, crop, stage);
  if (!cells) return { ok: false, error: 'a piece stands outside the box or on stone', reasons: ['box'] };
  if (cells[0].f !== kingFile || cells[0].r !== 0) return { ok: false, error: 'the king is not on row 0 of his file', reasons: ['king'] };
  const held = new Set(cells.map((c) => c.r * BOX + c.f));
  if (stage.grid[BOX - 1][ef] !== null || held.has((BOX - 1) * BOX + ef)) return { ok: false, error: `no floor for the enemy king on the far row (file ${ef})`, reasons: ['far row'] };
  // THE SUMMONING LANDS ONLY ON GROUND CONNECTED TO ITS KING — and never on
  // a player's piece (ruling 16: the enemy molds around them).
  const reachW = reachOf(stage, { f: kingFile, r: 0 });
  if (!reachW(ef, BOX - 1)) return { ok: false, error: 'the barrier would seal the armies apart', reasons: ['disconnected'] };
  const reachB0 = reachOf(stage, { f: ef, r: BOX - 1 });
  const reachB = (f, r) => reachB0(f, r) && !held.has(r * BOX + f);
  const bag = bagOfPattern(army.pattern);
  const white = { army: bag, cells };
  const black = { ...(enemy.army ? { army: enemy.army, order: enemy.order ?? 'archetype' } : { spec: enemy.spec }), archetype: enemy.archetype ?? 'heavies-deep', royalAt: { f: ef, row: 0 }, reach: reachB };
  const reasons = [];
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
    const attemptSeed = attempt === 0 ? seed : childSeed(seed, `attempt${attempt}`);
    const m = buildMatchup({ stage, white, black, seed: attemptSeed, gapMin: GAP_MIN, turn, gapAt: 'camp' });
    if (m.error) {
      reasons.push(`attempt ${attempt}: ${m.error}`);
      // The geometry does not change with the seed; only a drawn enemy does.
      if (!enemy.spec || enemy.spec.pieces) break;
      continue;
    }
    if (!armiesConnected(stage, m)) {
      reasons.push(`attempt ${attempt}: disconnected`);
      break;
    }
    const variant = dealVariant(stage.files, stage.ranks, campLineRank(m.white.layout.cells, 1), campLineRank(m.black.layout.cells, -1));
    if (ffish) {
      registerDealVariant(ffish, variant);
      const lint = lintMatchupFen(ffish, variant.name, m.fen);
      if (!lint.ok) {
        reasons.push(`attempt ${attempt}: ${lint.reasons.join(',')}`);
        if (!enemy.spec || enemy.spec.pieces) break;
        continue; // a fresh enemy draw, the same ground
      }
    }
    const kf = String.fromCharCode(97 + kingFile);
    const efc = String.fromCharCode(97 + ef);
    return {
      ok: true,
      crop,
      stage,
      kingFile,
      enemyFile: ef,
      axis: facing,
      deal: {
        ok: true,
        stageId: stage.id,
        flip: false,
        cropTop: 0,
        cropBottom: 0,
        stage,
        files: stage.files,
        ranks: stage.ranks,
        autoCrop: { top: 0, bottom: 0 },
        variantName: variant.name,
        variantIni: variant.ini,
        fen: m.fen,
        turn,
        white: m.white,
        black: m.black,
        gap: m.gap,
        gapFront: m.gapFront,
        edge: m.white.army.value - m.black.army.value,
        violations: m.violations,
        seed,
        attempt,
        attemptSeed,
        directorSeed: childSeed(attemptSeed, 'director'),
        // THE WORLD's own provenance (the log's `world` block, the run's duel entry).
        world: { id: world.id, crop, kingFile, enemyFile: ef, axis: facing, kingSquare: `${kf}1`, enemyKingSquare: `${efc}${stage.ranks}` },
      },
    };
  }
  const error = reasons[reasons.length - 1]?.replace(/^attempt \d+: /, '') ?? 'no attempt ran';
  return { ok: false, error: error === 'disconnected' ? 'the barrier would seal the armies apart' : /doesn't fit|outside|gap/.test(error) ? `no room for the armies here (${error})` : error, reasons };
}

/**
 * THE BUTTON (4c's barrier by hand on the box): drop the barrier in front
 * of the army as it stands along `opts.axis` (its facing by default), the
 * enemy dealt on the far row — on the king's own file when that deals,
 * else the nearest file that does (the band a walking enemy uses). Same
 * result shape as planBox.
 */
export function planBarrier(world, army, opts = {}) {
  const facing = opts.axis === null || opts.axis === undefined ? army.facing : normFacing(opts.axis);
  const box = boxAt(world, army, facing);
  if (!box.ok) return { ok: false, error: 'the army does not fit the box along this axis', reasons: ['box'] };
  const { kingFile } = box;
  const order = [kingFile];
  for (let d = 1; d < BOX; d++) {
    if (kingFile + d < BOX) order.push(kingFile + d);
    if (kingFile - d >= 0) order.push(kingFile - d);
  }
  let last = null;
  const reasons = [];
  for (const ef of order) {
    const plan = planBox(world, army, { ...opts, axis: facing, enemyFile: ef });
    if (plan.ok) return plan;
    if (!last || !/far row/.test(plan.error)) last = plan;
    reasons.push(`file ${ef}: ${plan.error}`);
  }
  return { ok: false, error: last?.error ?? 'no far-row file deals', reasons };
}

/**
 * EVERY FAR-ROW CELL THAT DEALS along an axis (milestone 6's hunter targets
 * and the threat display): the arena files of row 9 where planBox comes
 * out legal, with the plan of each. Grid-only unless `ffish` is given.
 */
export function farRowTargets(world, army, opts = {}) {
  const facing = opts.axis === null || opts.axis === undefined ? army.facing : normFacing(opts.axis);
  const box = boxAt(world, army, facing);
  const out = { axis: facing, ok: box.ok, crop: box.crop, kingFile: box.kingFile, cells: [] };
  if (!box.ok) return out;
  for (let ef = 0; ef < BOX; ef++) {
    const plan = planBox(world, army, { ...opts, axis: facing, enemyFile: ef });
    if (plan.ok) out.cells.push({ f: ef, r: BOX - 1, world: arenaToWorld(box.crop, ef, BOX - 1), plan });
  }
  return out;
}
