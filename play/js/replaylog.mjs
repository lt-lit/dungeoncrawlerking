// The replay log (2026-09-06) — build, name, deliver and keep the duel's
// ledger. The DuelController records everything (duel.mjs `record`, see
// RECORD_ARRAYS there); this module turns one record into the export object,
// gets it off the device, and keeps the last few games in localStorage so a
// game that ended in a reload or a dead tab is still exportable.
//
// The export is ONE object for every consumer: the debug overlay's copy
// button, the Export buttons, the autosave, `__DCK.log.build()`, the Node
// report tool (phase0/harness/log-report.mjs) and the offline replayer to
// come. Nothing here touches the DOM except deliverLog (it has to).

export const LOG_SCHEMA = 'dck-log/1';

/** JSON.stringify turns Infinity into null, which silently corrupts an
 *  exported config (the 'off' preset is onsetPly: Infinity — a replay
 *  built from null ramps quakes from ply 0 in a duel that had the gods
 *  OFF). Export non-finite numbers as strings; Number('Infinity') revives
 *  them exactly, so consumers map values through Number() and lose
 *  nothing. Sets become arrays (the Director's ledgers). */
export function jsonSafeNumbers(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (Array.isArray(v)) return v.map(jsonSafeNumbers);
  if (v instanceof Set) return [...v].map(jsonSafeNumbers);
  if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [k, jsonSafeNumbers(x)]));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafeNumbers(x)]));
  return v;
}

/** The trace rides on the quake event AND in quakeTraces — carry it once. */
const stripQuakes = (quakes) => (quakes ?? []).map(({ trace, ...rest }) => rest);
const tailOf = (tail) => ({ ...tail, quakes: stripQuakes(tail?.quakes) });

/**
 * Everything a replay, a report or an offline analysis needs, from the one
 * ledger. `session` is the host's session object (the deal provenance);
 * `meta` is whatever the host knows that the duel does not (build, UA,
 * engine id, options) — recorded verbatim under `meta`.
 */
export function buildLog({ duel, session = null, meta = {} }) {
  if (!duel) return null;
  const d = duel;
  const dir = d.director;
  const r = d.record;
  const deal = session?.deal ?? null;
  return jsonSafeNumbers({
    schema: LOG_SCHEMA,
    meta: {
      exportedAt: new Date().toISOString(),
      startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : null,
      ...meta,
    },
    // Full deal provenance: (stage, flip, crop, specs, setupSeed) + the
    // Director seed below reconstruct the entire session, quakes included.
    stage: deal?.stageId ?? null,
    stageTransformed: session?.id ?? null,
    title: session?.title ?? null,
    flip: deal?.flip ?? false,
    crop: deal ? { top: deal.cropTop, bottom: deal.cropBottom } : null,
    autoCrop: deal?.autoCrop ?? null, // the king-anchored auto-crop on top of `crop` (2026-09-07; older logs: the analyzer recovers it from startFen)
    turn: deal?.turn ?? 'w',
    setupSeed: deal?.seed ?? null,
    dealAttempt: deal?.attempt ?? null,
    armies: deal
      ? {
          white: { ...deal.white.army, archetype: session?.specs?.white?.archetype ?? null, anchor: session?.specs?.white?.anchor ?? null },
          black: { ...deal.black.army, archetype: session?.specs?.black?.archetype ?? null, anchor: session?.specs?.black?.anchor ?? null },
        }
      : null,
    player: session?.playerColor ?? null,
    // THE BARRIER (Phase 2 milestone 4c): a duel on the walk's world — the
    // world, the crop, the stage the crop made (its terrain and skins, so
    // the analyzer paints it without a manifest), the floor's layers at the
    // drop (holes, god crates, doorways, ruins). Null on the setup page.
    world: session?.worldLog ?? null,
    files: d.files,
    ranks: d.ranks,

    variant: d.variantName,
    variantIni: deal?.variantIni ?? null, // the deal's own rules, so the log replays without the catalog
    startFen: d.startFen,
    // The engine's limits — what every recorded search and probe ran under.
    go: d.go,
    mateGo: d.mateGo,
    evalGate: d.evalGate,
    // The Director: seed + starting config reconstruct every roll.
    seed: dir.seed,
    config0: dir.config0, // starting config — what a replay constructs with
    config: {
      // live config at export time (tunes applied); the tunes ledger maps
      // one to the other, undo markers included
      onsetPly: dir.onsetPly,
      rampPlies: dir.meter.rampPlies,
      sate: dir.meter.sate,
      debtCap: dir.debtCap,
      extraActions: dir.extraActions,
    },
    favor: dir.favor,
    tunes: r.tunes,
    // The game.
    result: r.result,
    winner: r.winner,
    termination: r.termination,
    error: r.error,
    plies: d.ply,
    seq: d.seq, // the event counter's final value — every entry below carries its own
    moves: r.moves,
    sans: r.sans,
    states: r.states, // the exact board state after every completed ply (post-quake); states[0] = the start
    engine: r.engine, // the enemy's reply searches
    quakes: stripQuakes(r.quakes), // what landed (+ evalDelta); traces carried once, below
    quakeTraces: r.quakeTraces, // every ply's roll trace — inputs, timing, gate verdict, protected census
    attempts: r.attempts, // v4.3 compositions the eval gate rejected, in full
    anomalies: r.anomalies,
    log: r.log, // what the player was told
    flags: r.flags, // what the player marked
    // UNDO history: every branch is the tail an undo cut off (the same arrays
    // as above, sliced) plus `from`, the exact state right before the undo.
    branches: (r.branches ?? []).map((b) => ({ ...b, tail: tailOf(b.tail) })),
  });
}

/** A file name a phone's Files app can sort: stage, seed, local time. */
export function logFileName(data, date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  const stage = String(data?.world ? `${data.world.id}_t${data.world.walkTurn ?? 0}` : data?.stage ?? 'duel').replace(/[^a-z0-9-]+/gi, '-');

  const seed = data?.setupSeed != null ? `_s${data.setupSeed}` : '';
  return `dck-log_${stage}${seed}_${stamp}.json`;
}

/** Bytes of the serialized log — the readout on the buttons. */
export function logSize(json) {
  return `${(json.length / 1024).toFixed(0)} KB`;
}

/**
 * Get the log off the device. The ladder, best first:
 *   1. Web Share with a FILE (phones: save to Files, AirDrop, message it) —
 *      only where the pointer is coarse; a desktop share sheet is a nuisance
 *      and the download below is what a desktop wants.
 *   2. A download (a blob URL on an <a download>).
 *   3. The clipboard (the old copy-trace channel; a 200 KB paste is a poor
 *      way to move a file, so it is the fallback, not the default).
 *   4. The console.
 * Everything before the share call is synchronous so the user activation
 * that Web Share requires is still live when it is called. Returns the
 * channel that took it, or 'cancelled' if the user closed the share sheet.
 * `force` picks one channel ('clipboard' is the copy button).
 */
export async function deliverLog(data, { force = null, filename = null, doc = globalThis.document, nav = globalThis.navigator } = {}) {
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  const name = filename ?? logFileName(typeof data === 'string' ? null : data);
  const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (!force || force === 'share') {
    if (typeof File === 'function' && nav?.canShare && (phone || force === 'share')) {
      try {
        const file = new File([json], name, { type: 'application/json' });
        if (nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], title: name });
          return 'shared';
        }
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancelled';
        // fall through: an unsupported share falls back to the download
      }
    }
  }
  if (!force || force === 'download') {
    try {
      if (doc && typeof Blob === 'function' && typeof URL?.createObjectURL === 'function') {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const a = doc.createElement('a');
        a.href = url;
        a.download = name;
        a.rel = 'noopener';
        doc.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        return 'downloaded';
      }
    } catch {
      /* fall through */
    }
  }
  if (!force || force === 'clipboard') {
    try {
      await nav.clipboard.writeText(json);
      return 'copied';
    } catch {
      /* fall through */
    }
  }
  console.log('[DCK log]', json);
  return 'console';
}

/**
 * The autosave: a ring of the last few logs in localStorage, one key per
 * slot plus an index. A game claims a slot when it begins and rewrites it
 * after every ply, so the record survives a reload, a killed tab or a dead
 * engine — the weirdness is usually noticed after the game. Every call is
 * quota- and privacy-mode-tolerant: a failed write returns false and the
 * game plays on.
 */
export class LogStore {
  constructor(storage = null, { slots = 3, prefix = 'dck.log.v1' } = {}) {
    this.storage = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    this.slots = slots;
    this.prefix = prefix;
  }

  #key(slot) {
    return `${this.prefix}.${slot}`;
  }

  /** The saved logs' summaries, newest first: [{slot, id, at, stage, seed, plies, result, size}]. */
  index() {
    try {
      const raw = this.storage?.getItem(`${this.prefix}.index`);
      const idx = raw ? JSON.parse(raw) : [];
      return Array.isArray(idx) ? idx.slice().sort((a, b) => (b.at ?? 0) - (a.at ?? 0)) : [];
    } catch {
      return [];
    }
  }

  #writeIndex(idx) {
    this.storage.setItem(`${this.prefix}.index`, JSON.stringify(idx));
  }

  /** The slot for a game id: its own if it already has one, else a free
   *  slot, else the oldest. */
  claim(id) {
    const idx = this.index();
    const mine = idx.find((e) => e.id === id);
    if (mine) return mine.slot;
    const used = new Set(idx.map((e) => e.slot));
    for (let s = 0; s < this.slots; s++) if (!used.has(s)) return s;
    return idx.reduce((oldest, e) => (e.at < oldest.at ? e : oldest), idx[0]).slot;
  }

  /** Write one log into its slot and refresh the index. Returns false on
   *  any storage failure (quota, private mode, disabled storage). */
  save(slot, data, summary) {
    if (!this.storage) return false;
    try {
      const json = typeof data === 'string' ? data : JSON.stringify(data);
      this.storage.setItem(this.#key(slot), json);
      const idx = this.index().filter((e) => e.slot !== slot);
      idx.push({ slot, at: Date.now(), size: json.length, ...summary });
      this.#writeIndex(idx);
      return true;
    } catch {
      return false;
    }
  }

  /** The log in a slot, parsed — or null. */
  load(slot) {
    try {
      const raw = this.storage?.getItem(this.#key(slot));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /** The raw JSON in a slot (deliverLog takes it as-is). */
  loadJson(slot) {
    try {
      return this.storage?.getItem(this.#key(slot)) ?? null;
    } catch {
      return null;
    }
  }

  remove(slot) {
    try {
      this.storage?.removeItem(this.#key(slot));
      this.#writeIndex(this.index().filter((e) => e.slot !== slot));
      return true;
    } catch {
      return false;
    }
  }
}
