// Browser-side engine + ffish access for the duel slice.
//
// Port of phase0/lib/load.mjs: the Node loaders (which hide global `fetch`
// during Emscripten init) are replaced by browser factories. The page loads
// vendor/ffish.js (classic build, pre-seeded via window.__ffishPromise) and
// vendor/stockfish.js (MODULARIZE `Stockfish()` factory) with <script> tags;
// this module only wraps those globals. UciEngine itself is a verbatim port.
// Importing this module never touches `window` — only the factories below do.

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
  async go(args = 'depth 10', { timeout = 120000, onLine = null } = {}) {
    const mt = args.match(/movetime (\d+)/);
    let watchdog = null;
    if (mt) {
      watchdog = setTimeout(() => this.send('stop'), parseInt(mt[1], 10) + 1500);
    }
    // `onLine` streams every engine line for the search's lifetime (the
    // hint probe repaints its arrows per `info multipv` depth instead of
    // waiting for bestmove). Additive: the collected result is unchanged.
    if (onLine) this.listeners.add(onLine);
    let lines;
    try {
      lines = await this.sendUntil(`go ${args}`, (l) => l.startsWith('bestmove'), { timeout });
    } finally {
      if (watchdog) clearTimeout(watchdog);
      if (onLine) this.listeners.delete(onLine);
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

  /** The principal variation of the last "info ... pv ..." line, as UCI
   *  moves (v4.2: the gods read the engine's mate lines). Empty if none. */
  lastPv(result) {
    for (let i = result.infoLines.length - 1; i >= 0; i--) {
      const m = result.infoLines[i].match(/ pv (.+)$/);
      if (m) return m[1].trim().split(/\s+/).filter(Boolean);
    }
    return [];
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

/**
 * Create a fresh Fairy-Stockfish instance from the page-global `Stockfish()`
 * factory (vendor/stockfish.js must already be loaded via <script> tag),
 * wrapped in UciEngine and configured for duel play.
 */
export async function createEngine() {
  const sf = await window.Stockfish();
  const engine = new UciEngine(sf);
  await engine.uci();
  // Defaults TRUE in this build; classical eval is a hard constraint (brief §2.3).
  engine.setoption('Use NNUE', 'false');
  // Spike 8: lazy SMP is a net loss on phone-class hardware; pin explicitly.
  engine.setoption('Threads', '1');
  await engine.isready();
  return engine;
}

/**
 * The initialized ffish.js module. Resolves the page's pre-seeded
 * window.__ffishPromise (the inline block that must run BEFORE the
 * vendor/ffish.js script tag — see index.html).
 */
export function getFfish() {
  if (typeof window === 'undefined' || !window.__ffishPromise) {
    throw new Error(
      'window.__ffishPromise is missing — the page must pre-seed Module/__ffishPromise before the vendor/ffish.js script tag (copy the inline block from index.html)'
    );
  }
  return window.__ffishPromise;
}
