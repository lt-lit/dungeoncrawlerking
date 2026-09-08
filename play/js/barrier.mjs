// THE BARRIER BY HAND — Phase 2 milestone 4c (2026-09-08). Pure: where the
// barrier drops on an army as it stands, and the deal it stamps into it.
//
// Brief §1 read literally: the duel is a camera view of the same world,
// zoomed — the barrier is a CROP of the floor (world.mjs cropTransform),
// dropped around the player's king where he stands. The rules, decided
// with the designer 2026-09-08:
//
//   • THE KING ANCHORS THE ARENA (brief §4.2): his rank is arena row 0 and
//     his facing is arena-north, so the arena reads north-up on the screen
//     under the camera that turns with the army.
//   • WIDTH is the local room width at the king's rank (brief §4.1),
//     capped at the engine's 12 files: the window is centred on the king's
//     file and slid whole to stay inside the room; a way under 3 wide is
//     no place to raise an army (§5.3).
//   • GAP 4, KINGS ALIGNED (designer: "a duel can start at gap 4 for now,
//     and the kings have to be aligned"): the enemy royal stands on the
//     player's king's FILE on the arena's last row, and there are exactly
//     four empty ranks between the two armies' closest rows (armygen's
//     gap). So the DEPTH is computed, not dialled — the player's molded
//     depth + 4 + the enemy's — by iteration, since the enemy's depth
//     depends on the crop's own terrain; past the engine's 10 ranks the
//     drop refuses. A 2-deep kit against a 2-deep enemy is 8 ranks, the
//     kings 7 apart.
//   • THE STAMP IS THE PATTERN, not the pieces' walk positions: the
//     formation materializes whole (brief §4.2 — the summoning), molded by
//     the deal's own rule (armygen layoutArmy: royal rearmost, pawns in
//     front per file) with the royal PINNED to the king's cell and the
//     back row in the order the player walked with; stragglers snap into
//     their slots. The camp line and the per-deal double-step variant fall
//     out as for any deal.
//   • A square that hangs off the map is the barrier's wall; a pit from an
//     earlier duel is a wall to the deal and a hole to the gods (never
//     weakened, never counted — duel.mjs seeds the Director from
//     World.cropLayers); the enemy is dealt fresh from a spec (the setup
//     screen's Black knobs) and re-dealt on a lint failure, as dealMatchup
//     does; nothing here is a TRIGGER — that rule is a design conversation
//     of its own (CLAUDE.md § Phase 2).
//
// Node gate: phase0/harness/test-barrier.mjs.

import { cropTransform, arenaToWorld, FLOOR } from './world.mjs';
import { rotateBody, bagOfPattern } from './army.mjs';
import { buildMatchup, armiesConnected, campLineRank, registerDealVariant, lintMatchupFen } from './armygen.mjs';
import { dealVariant } from './variant.mjs';
import { childSeed } from './prng.mjs';

export const GAP = 4; // designer 2026-09-08: "a duel can start at gap 4 for now"
export const MIN_FILES = 3; // §5.3: width 1–2 passages are crawlspaces
export const MAX_FILES = 12; // the engine's caps (rule 7's catalog)
export const MIN_RANKS = 5;
export const MAX_RANKS = 10;

/** The room's floor to the left and right of a cell, perpendicular to a
 *  facing: how many floor cells run each way before anything else (a wall,
 *  a pit, furniture, the map's edge). */
export function roomWidth(world, at, facing) {
  const right = rotateBody(1, 0, facing);
  const run = (sign) => {
    let n = 0;
    for (let k = 1; ; k++) {
      const f = at.f + sign * right.df * k, r = at.r + sign * right.dr * k;
      if (world.at(f, r) !== FLOOR) break;
      n++;
    }
    return n;
  };
  return { left: run(-1), right: run(1) };
}

/**
 * The barrier's window across the king: its width (the room's, capped at
 * MAX_FILES) and the king's arena FILE inside it (centred, slid whole to
 * stay in the room). Null when the way is under MIN_FILES wide.
 */
export function barrierWindow(world, king, facing) {
  const { left, right } = roomWidth(world, king, facing);
  const files = Math.min(MAX_FILES, left + 1 + right);
  if (files < MIN_FILES) return null;
  const half = (files - 1) >> 1;
  const kingFile = Math.max(files - 1 - right, Math.min(left, half));
  return { files, kingFile, left, right };
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
 * Plan the barrier on an army as it stands: the crop, the stage the crop
 * makes, and the deal stamped into it (dealMatchup's shape — the session,
 * the log and the debris layer read it like any other deal).
 *
 * opts = {
 *   enemy: { spec | army, archetype },   — the enemy's bag (the setup screen's Black knobs)
 *   seed,                                 — the deal's seed (the Director's derives from it)
 *   turn: 'w' | 'b',                      — initiative (the player is always White)
 *   gap: 4, ffish, attempts: 8, id,       — `id` names the stage (default: world@crop)
 * }
 * Returns { ok: true, crop, stage, kingFile, deal } or { ok: false, error, reasons }.
 */
export function planBarrier(world, army, { enemy, seed = 1, turn = 'w', gap = GAP, ffish = null, attempts = 8, id = null } = {}) {
  const king = army.king;
  const facing = army.facing;
  const win = barrierWindow(world, king, facing);
  if (!win) return { ok: false, error: 'no room to raise an army here — the way is under 3 wide', reasons: ['too narrow'] };
  const bag = bagOfPattern(army.pattern);
  const white = { army: bag, order: 'as-given', royalAt: { f: win.kingFile, row: 0 } };
  const black = { ...(enemy.army ? { army: enemy.army } : { spec: enemy.spec }), archetype: enemy.archetype ?? 'heavies-deep', royalAt: { f: win.kingFile, row: 0 } };
  const reasons = [];
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
    const attemptSeed = attempt === 0 ? seed : childSeed(seed, `attempt${attempt}`);
    // THE DEPTH: a fixed point of the molding. Start at the open-ground
    // depth (2 + gap + 2), mold both armies on the crop's real terrain,
    // grow while either side overflows or the gap is under `gap`, shrink
    // by the surplus when the gap runs over; a rectangle seen twice, or
    // one past the engine's caps, refuses.
    let ranks = Math.max(MIN_RANKS, 2 + gap + 2);
    const seen = new Set();
    let found = null;
    let last = null;
    while (ranks >= MIN_RANKS && ranks <= MAX_RANKS && !seen.has(ranks)) {
      seen.add(ranks);
      const crop = cropAt(world, king, facing, win.files, win.kingFile, ranks);
      const stage = world.arenaStage(crop, { id });
      const m = buildMatchup({ stage, white, black, seed: attemptSeed, gapMin: gap, turn });
      last = { crop, stage, m };
      if (m.error) {
        ranks += 1; // more room ahead (a walled far row, a deep molding, a short gap)
        continue;
      }
      if (m.gap > gap) {
        ranks -= m.gap - gap; // too deep: pull the far row in by the surplus
        continue;
      }
      found = last;
      break;
    }
    if (!found) {
      const why = last?.m?.error ?? 'no depth fits';
      reasons.push(`attempt ${attempt}: ${why}`);
      // The geometry does not change with the seed; only the enemy's draw
      // does, and a geometric refusal names the ground, not the army.
      if (!enemy.spec || enemy.spec.mode === 'pieces' || enemy.spec.pieces) break;
      continue;
    }
    const { crop, stage, m } = found;
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
        continue; // a fresh enemy draw, the same ground
      }
    }
    const kf = String.fromCharCode(97 + win.kingFile);
    return {
      ok: true,
      crop,
      stage,
      kingFile: win.kingFile,
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
        world: { id: world.id, crop, kingFile: win.kingFile, kingSquare: `${kf}1`, enemyKingSquare: `${kf}${stage.ranks}` },
      },
    };
  }
  const error = reasons[reasons.length - 1]?.replace(/^attempt \d+: /, '') ?? 'no attempt ran';
  return { ok: false, error: error === 'disconnected' ? 'the barrier would seal the armies apart' : /doesn't fit|outside/.test(error) ? `no room for the armies here (${error})` : error, reasons };
}
