// Shared loaders for ffish.js and the Fairy-Stockfish WASM engine under Node.
//
// Both packages ship old Emscripten builds whose environment detection breaks
// on Node >= 18 (a global `fetch` exists, so the loader tries to fetch() a
// filesystem path). We hide `fetch` for the duration of module init.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

async function withoutFetch(fn) {
  const saved = globalThis.fetch;
  // eslint-disable-next-line no-global-assign
  globalThis.fetch = undefined;
  try {
    return await fn();
  } finally {
    globalThis.fetch = saved;
  }
}

let ffishSingleton = null;

/** Load ffish.js (rules/legality/FEN/SAN library). Returns the initialized module. */
export async function loadFfish() {
  if (ffishSingleton) return ffishSingleton;
  ffishSingleton = await withoutFetch(
    () =>
      new Promise((resolve, reject) => {
        try {
          const ffish = require('ffish');
          ffish.onRuntimeInitialized = () => resolve(ffish);
        } catch (e) {
          reject(e);
        }
      })
  );
  return ffishSingleton;
}

/**
 * Fail LOUDLY when the loaded ffish cannot parse furniture (`^`, brief
 * §4.6). `npm install` here fetches the STOCK 1.1.11/0.7.9 pair, which
 * rejects `^` FENs — every stage/gallery/corpus tool would otherwise die
 * with a cryptic `invalid-fen` the moment a furniture stage is touched.
 * Call it right after loading the variant catalog; `variantName` must be a
 * registered ≥5×5 variant (the catalog's `duel_5x5` by default).
 */
export function assertFurnitureSupport(ffish, variantName = 'duel_5x5', probeFen = null) {
  // Default probe is 5x5, no bare king (rule 4b) — callers whose loaded
  // variants have other dims (the meter-lab corpus) pass their own
  // `^`-bearing FEN + matching variant instead.
  const probe = probeFen ?? 'kq3/5/2^2/5/KQ3 w - - 0 1';
  if (ffish.validateFen(probe, variantName) === 1) return;
  throw new Error(
    'this ffish build rejects the furniture glyph ^ — phase0/node_modules holds the STOCK pair.\n' +
      'Overlay the patched vendored artifacts first (engine/README.md, "phase0 caveat"):\n' +
      '  cp play/vendor/ffish.{js,wasm} phase0/node_modules/ffish/\n' +
      '  cp play/vendor/stockfish.{js,wasm,worker.js} phase0/node_modules/fairy-stockfish-nnue.wasm/'
  );
}

/**
 * Load a fresh Fairy-Stockfish WASM engine instance and wrap it in a small
 * promise-based UCI client. Each call returns an independent engine.
 */
export async function loadEngine() {
  const sf = await withoutFetch(async () => {
    const Stockfish = require('fairy-stockfish-nnue.wasm/stockfish.js');
    return Stockfish();
  });
  return new UciEngine(sf);
}

export class UciEngine {
  constructor(sf) {
    this.sf = sf;
    this.listeners = new Set();
    this.log = [];
    this.logEnabled = false;
    sf.addMessageListener((line) => {
      if (this.logEnabled) this.log.push(line);
      for (const l of [...this.listeners]) l(line);
    });
  }

  send(cmd) {
    this.sf.postMessage(cmd);
  }

  /** Send a command and collect lines until `predicate(line)` matches; resolves with all collected lines. */
  sendUntil(cmd, predicate, { timeout = 120000 } = {}) {
    return new Promise((resolve, reject) => {
      const collected = [];
      const listener = (line) => {
        collected.push(line);
        if (predicate(line)) {
          this.listeners.delete(listener);
          clearTimeout(timer);
          resolve(collected);
        }
      };
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`UCI timeout after ${timeout}ms waiting on: ${cmd}\nlast lines:\n${collected.slice(-5).join('\n')}`));
      }, timeout);
      this.listeners.add(listener);
      if (cmd) this.send(cmd);
    });
  }

  async uci() {
    return this.sendUntil('uci', (l) => l === 'uciok');
  }

  async isready() {
    return this.sendUntil('isready', (l) => l === 'readyok');
  }

  /** Write a variants.ini into the engine's virtual FS and point VariantPath at it. */
  async loadVariantsIni(iniText, path = '/variants.ini') {
    this.sf.FS.writeFile(path, iniText);
    this.send(`setoption name VariantPath value ${path}`);
    await this.isready();
  }

  setoption(name, value) {
    this.send(`setoption name ${name} value ${value}`);
  }

  position({ variant, fen, moves } = {}) {
    if (variant) this.setoption('UCI_Variant', variant);
    let cmd = fen ? `position fen ${fen}` : 'position startpos';
    if (moves && moves.length) cmd += ` moves ${moves.join(' ')}`;
    this.send(cmd);
  }

  /**
   * Run `go` and resolve with { bestmove, ponder, info: lastInfoLines, lines }.
   *
   * Watchdog: under the A-prime no-draw config (nFoldValue=loss), shuttle
   * "fortress" positions have no repetition bound, so iterative deepening can
   * hit MAX_PLY (~245) within the movetime and this WASM build then never
   * emits bestmove on its own. If a time-limited search overruns its budget,
   * send UCI `stop` to force the bestmove out. Live game code needs the same
   * guard.
   */
  async go(args = 'depth 10', { timeout = 120000 } = {}) {
    const mt = args.match(/movetime (\d+)/);
    let watchdog = null;
    if (mt) {
      watchdog = setTimeout(() => this.send('stop'), parseInt(mt[1], 10) + 1500);
    }
    let lines;
    try {
      lines = await this.sendUntil(`go ${args}`, (l) => l.startsWith('bestmove'), { timeout });
    } finally {
      if (watchdog) clearTimeout(watchdog);
    }
    const bmLine = lines[lines.length - 1];
    const m = bmLine.match(/^bestmove (\S+)(?: ponder (\S+))?/);
    return {
      bestmove: m ? m[1] : null,
      ponder: m ? m[2] : null,
      lines,
      infoLines: lines.filter((l) => l.startsWith('info')),
    };
  }

  /** Parse the last "info ... score ..." line into { type: 'cp'|'mate', value } from the mover's POV. */
  lastScore(result) {
    for (let i = result.infoLines.length - 1; i >= 0; i--) {
      const m = result.infoLines[i].match(/score (cp|mate) (-?\d+)/);
      if (m) return { type: m[1], value: parseInt(m[2], 10) };
    }
    return null;
  }

  quit() {
    try {
      this.send('quit');
    } catch {
      /* ignore */
    }
  }
}
