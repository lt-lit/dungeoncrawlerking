// THE RUN — Phase 2 milestone 4b (2026-09-08): one save per run, and
// nothing else (designer: "each run has its own save… no meta progression";
// "we still want to have the ability to export and import save files";
// "assume I do not give a single shit about backwards compatibility").
//
// A run is ONE object: its id and seed, when it began, the world file it
// walks (by id), the FLOOR as it stands now (world.mjs World.serialize —
// the whole terrain grid, the pieces, the skins, the Director's and the
// residue's layers), the ARMY (army.mjs Army.serialize — the pattern, the
// pieces, the facing), the turn count and THE TURN LIST — every input
// since the run began (army.mjs planTurn's `input` shapes, each with the
// turn number) — plus the floor and the army AT THE START, so a run
// replays from its seed and its inputs (the rule is pure) and a save is
// also a bug report. `floors` is a map keyed by floor id with one entry for
// now; Phase 3's floor transitions add entries, not a format.
//
// A schema STAMP guards every load: a mismatch refuses the object with one
// line naming the build that wrote it — no migrations, no optional reads
// beyond the stamp. The save lives under ONE localStorage key (the newest
// run wins; a new run overwrites); export / import move the same object as
// a JSON file through replaylog.mjs's delivery path and the page's file
// input, paste or `?save=` URL.
import { World } from './world.mjs';
import { Army } from './army.mjs';

export const RUN_SCHEMA = 'dck-run/1';
export const RUN_KEY = 'dck.run.v1';

/** A fresh run object from its parts. */
export function newRun({ id = null, seed, worldId, world, army, build = null, options = null } = {}) {
  const now = new Date().toISOString();
  return {
    schema: RUN_SCHEMA,
    build,
    id: id ?? `run-${Date.now().toString(36)}-${(seed >>> 0).toString(36)}`,
    seed,
    createdAt: now,
    savedAt: now,
    worldId,
    floor: worldId,
    floors: { [worldId]: { world: world.serialize(), army: army.serialize() } },
    start: { world: world.serialize(), army: army.serialize() },
    turn: 0,
    turns: [],
    options,
  };
}

/** Write the live floor and army into the run (before a save). */
export function updateRun(run, { world, army, turn = null }) {
  run.floors[run.floor] = { world: world.serialize(), army: army.serialize() };
  if (turn !== null) run.turn = turn;
  run.savedAt = new Date().toISOString();
  return run;
}

/** Append one input to the turn list. */
export function recordTurn(run, input, turn) {
  run.turns.push({ t: turn, ...input });
  run.turn = turn;
}

/** The live floor and army out of a run: { world, army }. */
export function openRun(run) {
  const fl = run.floors?.[run.floor];
  if (!fl) throw new Error(`run ${run.id}: no floor "${run.floor}"`);
  return { world: World.load(fl.world), army: Army.load(fl.army) };
}

/**
 * Check a parsed object is a run this build can read: the schema stamp,
 * the floor, the turn list. Returns { ok, reason }.
 */
export function checkRun(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, reason: 'not a save' };
  if (obj.schema !== RUN_SCHEMA) return { ok: false, reason: `a save of schema ${JSON.stringify(obj.schema ?? null)}${obj.build ? ` from build ${obj.build}` : ''} — this build reads ${RUN_SCHEMA} only` };
  if (!obj.floors || !obj.floor || !obj.floors[obj.floor]?.world || !obj.floors[obj.floor]?.army) return { ok: false, reason: 'the save has no floor' };
  if (!Array.isArray(obj.turns)) return { ok: false, reason: 'the save has no turn list' };
  return { ok: true };
}

/** The one saved run, or null (a corrupt or foreign object reads as none). */
export function loadSavedRun(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(RUN_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return checkRun(obj).ok ? obj : null;
  } catch {
    return null;
  }
}

export function saveRun(run, storage = globalThis.localStorage) {
  try {
    storage?.setItem(RUN_KEY, JSON.stringify(run));
    return true;
  } catch {
    return false;
  }
}

export function clearSavedRun(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(RUN_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** The file name a run exports under. */
export function runFileName(run) {
  const when = (run.savedAt ?? run.createdAt ?? '').replace(/[:T]/g, '-').slice(0, 16);
  return `dck-run_${run.worldId}_${run.seed}_${when || 'now'}.json`;
}
