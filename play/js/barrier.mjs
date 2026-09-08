// THE BOX — Phase 2 milestone 5 (2026-09-08, the trigger conversation).
// Pure: where the barrier drops on an army as it stands, and the deal it
// stamps. Milestone 4c's barrier by hand measured the room's width and
// iterated the depth; the designer replaced both the same day:
//
//   "just make it always a 10x10 arena. As soon as the two armies fit in a
//    10x10 box and it's a legal board state with both kings in the right
//    rows, then the duel can start."
//
//   • THE ARENA IS ALWAYS 10×10 (BOX). The player's king anchors it (brief
//     §4.2): his rank is arena row 0, his facing arena-north, so the arena
//     reads north-up under the camera that turns with the army. The room's
//     walls, whatever stands in the box, are the arena's terrain; a square
//     off the map is the barrier's wall (World.arenaFen).
//   • THE PLACEMENT across the king (boxPlacement — ONE rule, shared with
//     the generator's lint, dungeon.mjs): the floor run through his cell
//     at his rank; a run that fits the box sits centred in it, a wider one
//     puts the king in the middle of the box and slides the box to stay in
//     the run (4c's formula with the width pinned at ten).
//   • THE ENEMY KING stands on the FAR ROW (arena row 9) — on ANY file of
//     it (brief §5.3's band alignment; "both kings in the right rows"):
//     `planBox` takes the enemy's file; the button (`planBarrier`) tries
//     the king's own file first and walks outward. The kings are ALWAYS
//     nine apart.
//   • THE GAP IS AN OUTPUT — ten ranks minus the two moldings — with a
//     MINIMUM OF 2 (GAP_MIN, designer). No band, no depth iteration.
//   • THE STAMP IS THE PATTERN (4c): the formation materializes whole,
//     molded by the deal's own rule (armygen layoutArmy: royal rearmost,
//     pawns in front per file) with the royal PINNED to the king's cell
//     and the back row in the order the player walked with; and, new with
//     the fixed box, THE SUMMONING LANDS ONLY ON GROUND CONNECTED TO ITS
//     KING (`reach`): a ten-wide box in a corridor holds the next room's
//     floor beyond a thin wall, and the molding must not put a piece
//     there. That floor stays in the arena — a knight may hop into it.
//   • The enemy is dealt fresh from a spec (the setup screen's Black knobs)
//     and re-dealt on a lint failure, as dealMatchup does; an enemy that
//     walks the map (milestone 6) carries its own pattern in as `army`.
//
// Node gate: phase0/harness/test-barrier.mjs.

import { cropTransform, arenaToWorld, FLOOR, WALL } from './world.mjs';
import { rotateBody, bagOfPattern } from './army.mjs';
import { buildMatchup, armiesConnected, campLineRank, registerDealVariant, lintMatchupFen } from './armygen.mjs';
import { dealVariant } from './variant.mjs';
import { childSeed } from './prng.mjs';

/** THE ARENA IS ALWAYS 10×10 (designer 2026-09-08). */
export const BOX = 10;
/** The least gap a deal may leave between the two armies' closest rows (designer 2026-09-08). */
export const GAP_MIN = 2;

/**
 * The floor run through a cell across a facing: how many floor cells lie
 * to the left and to the right before anything else (a wall, a pit,
 * furniture, the map's edge). `isFloor(f, r)` must be false off the map.
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
 * THE PLACEMENT: the king's arena FILE inside a `box`-wide arena whose row
 * 0 is his rank. A floor run that fits the box sits centred in it (the
 * walls on either side balanced); a wider run centres the king and slides
 * the box whole to stay inside the run. Pure — `isFloor(f, r)` reads the
 * ground, so the generator's lint and the game share one rule.
 */
export function boxPlacement(isFloor, king, facing, box = BOX) {
  const { left, right } = floorRun(isFloor, king, facing);
  const width = left + 1 + right;
  const half = (box - 1) >> 1;
  const kingFile = width <= box ? ((box - width) >> 1) + left : Math.max(box - 1 - right, Math.min(left, half));
  return { kingFile, left, right, width };
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

/** THE BOX on a world: the 10×10 crop across a king at a facing, and where he stands in it. */
export function boxAt(world, king, facing) {
  const p = boxPlacement((f, r) => world.at(f, r) === FLOOR, king, facing);
  return { crop: cropAt(world, king, facing, BOX, p.kingFile, BOX), ...p };
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
 * Plan the box on an army as it stands, the enemy king on `enemyFile` of
 * the far row: the crop, the stage the crop makes, and the deal stamped
 * into it (dealMatchup's shape — the session, the log and the debris layer
 * read it like any other deal).
 *
 * opts = {
 *   enemy: { spec | army, archetype },   — the enemy's bag (the setup screen's Black knobs, or a walking army's pattern)
 *   enemyFile,                            — the enemy king's arena file on row 9 (default: the player's king's file)
 *   seed,                                 — the deal's seed (the Director's derives from it)
 *   turn: 'w' | 'b',                      — initiative (the player is always White)
 *   ffish, attempts: 8, id,               — `id` names the stage (default: world@crop)
 * }
 * Returns { ok: true, crop, stage, kingFile, enemyFile, deal } or { ok: false, error, reasons }.
 */
export function planBox(world, army, { enemy, enemyFile = null, seed = 1, turn = 'w', ffish = null, attempts = 8, id = null } = {}) {
  const king = army.king;
  const facing = army.facing;
  const box = boxAt(world, king, facing);
  const { crop, kingFile } = box;
  const ef = enemyFile ?? kingFile;
  if (ef < 0 || ef >= BOX) return { ok: false, error: `enemy file ${ef} outside the box`, reasons: ['enemy file'] };
  const stage = world.arenaStage(crop, { id });
  if (stage.grid[0][kingFile] !== null) return { ok: false, error: 'the king does not stand on floor', reasons: ['king'] };
  if (stage.grid[BOX - 1][ef] !== null) return { ok: false, error: `no floor for the enemy king on the far row (file ${ef})`, reasons: ['far row'] };
  // THE SUMMONING LANDS ONLY ON GROUND CONNECTED TO ITS KING.
  const reachW = reachOf(stage, { f: kingFile, r: 0 });
  if (!reachW(ef, BOX - 1)) return { ok: false, error: 'the barrier would seal the armies apart', reasons: ['disconnected'] };
  const reachB = reachOf(stage, { f: ef, r: BOX - 1 });
  const bag = bagOfPattern(army.pattern);
  const white = { army: bag, order: 'as-given', royalAt: { f: kingFile, row: 0 }, reach: reachW };
  const black = { ...(enemy.army ? { army: enemy.army, order: enemy.order ?? 'archetype' } : { spec: enemy.spec }), archetype: enemy.archetype ?? 'heavies-deep', royalAt: { f: ef, row: 0 }, reach: reachB };
  const reasons = [];
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
    const attemptSeed = attempt === 0 ? seed : childSeed(seed, `attempt${attempt}`);
    const m = buildMatchup({ stage, white, black, seed: attemptSeed, gapMin: GAP_MIN, turn });
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
        edge: m.white.army.value - m.black.army.value,
        violations: m.violations,
        seed,
        attempt,
        attemptSeed,
        directorSeed: childSeed(attemptSeed, 'director'),
        // THE WORLD's own provenance (the log's `world` block, the run's duel entry).
        world: { id: world.id, crop, kingFile, enemyFile: ef, kingSquare: `${kf}1`, enemyKingSquare: `${efc}${stage.ranks}` },
      },
    };
  }
  const error = reasons[reasons.length - 1]?.replace(/^attempt \d+: /, '') ?? 'no attempt ran';
  return { ok: false, error: error === 'disconnected' ? 'the barrier would seal the armies apart' : /doesn't fit|outside|gap/.test(error) ? `no room for the armies here (${error})` : error, reasons };
}

/**
 * THE BUTTON (4c's barrier by hand on the box): drop the barrier in front
 * of the army as it stands, the enemy dealt on the far row — on the
 * king's own file when that deals, else the nearest file that does (the
 * band a walking enemy will use). Same result shape as planBox.
 */
export function planBarrier(world, army, opts = {}) {
  const { kingFile } = boxAt(world, army.king, army.facing);
  const order = [kingFile];
  for (let d = 1; d < BOX; d++) {
    if (kingFile + d < BOX) order.push(kingFile + d);
    if (kingFile - d >= 0) order.push(kingFile - d);
  }
  let last = null;
  const reasons = [];
  for (const ef of order) {
    const plan = planBox(world, army, { ...opts, enemyFile: ef });
    if (plan.ok) return plan;
    if (!last || !/far row/.test(plan.error)) last = plan;
    reasons.push(`file ${ef}: ${plan.error}`);
  }
  return { ok: false, error: last?.error ?? 'no far-row file deals', reasons };
}
