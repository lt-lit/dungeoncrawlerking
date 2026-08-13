# Spike 1 — Per-duel runtime variant loading

**Verdict: PASS**

Builds: ffish.js `Fairy-Stockfish 010526 LB by Fabian Fichter`; engine WASM `fairy-stockfish-nnue.wasm` (`id name Fairy-Stockfish [commit: 5589ea54, upstream: , emscripten: 2.0.26] LB`), run with `Use NNUE = false` (classical eval only, §2.3).

Script: `spikes/spike01-runtime-variant-loading.mjs` (deterministic, no RNG — variant stream is a fixed cycle of 10 dim combos x 4 rule tweaks).

## Question

Brief §9.1: "**Per-duel runtime variant loading.** Generate a variants.ini snippet + startFen per encounter and load it (ffish `loadVariantConfig` / engine option). Measure cost & correctness of doing this every fight."

## Method

- Generated 200 distinct duel variants via `makeDuelVariantIni` (dims cycling through 8x8, 5x6, 10x9, 3x6, 12x10, 7x7, 4x8, 9x8, 6x10, 11x7; rule tweaks cycling baseline / `doubleStep=false` / `promotionPieceTypes=nbr` / `enPassantRegion=-`; FEN-level walls on every third roomy board; every ini also carries a `startFen` matching its dims).
- Loaded each sequentially into **both** libraries under a unique name (`duel_000`…`duel_199`), timing each path: ffish = one synchronous `loadVariantConfig(ini)` call; engine = `FS.writeFile('/duel.ini', ini)` + `setoption name VariantPath value /duel.ini` + wait for `readyok`. **Each ini contained only the newest variant** — deliberately, to test whether earlier variants survive re-pointing VariantPath.
- Correctness: `validateFen` + ffish `legalMoves()` count vs engine `go perft 1` on every 7th variant of the first 60 (stride 7 is coprime to the 10-long dims cycle, so all dims get sampled) and every 25th thereafter; `perft 2` cross-checks on three variants (8x8, walled 8x8, 12x10).
- Persistence, list sanity, and `process.memoryUsage()` snapshots every 20 loads.
- Same-name redefinition tested last, on a **fresh** engine instance, with a uniquely-named twin variant in ffish as ground truth and the engine `d` command's `Fen:` line as the observable for which definition is active.

## Findings

### Latency (the per-duel cost is trivial)

| path | n | mean | p50 | p95 | max |
|---|---|---|---|---|---|
| ffish `loadVariantConfig` (excluding load #0) | 199 | 0.40 ms | 0.37 ms | 0.57 ms | 1.04 ms |
| engine writeFile + VariantPath + readyok | 200 | 2.05 ms | 1.63 ms | 4.53 ms | 19.4 ms (load #0) |

- **One-time first-load cost in ffish: ~560 ms** (load #0 only). Cause identified: `ffish.variants()` returns `""` until the first `loadVariantConfig` call, after which it returns the full builtin list (120 names) — i.e. the first `loadVariantConfig` lazily initializes ffish's entire variant map. Every subsequent load is sub-millisecond. → do one throwaway warmup load at app boot, before the first duel.
- Headline over the first 60 loads (the brief's 50–100 window): ffish p50 0.40 ms / p95 0.58 ms (plus the one 560 ms outlier at #0); engine p50 1.87 ms / p95 5.85 ms.

### Correctness

- 14/14 sampled perft-1 cross-checks agree exactly (ffish legal-move count == engine `Nodes searched`), across 3x6…12x10 dims, all four rule tweaks, walled and unwalled boards (e.g. `duel_014` 12x10: 24=24; `duel_021` 5x6 `doubleStep=false`: 7=7 — the tweak visibly changes the count, so the loaded config is demonstrably live in both).
- perft-2 spot checks: `duel_000` (walled 8x8) 288=288, `duel_004` (12x10) 456=456, `duel_030` 288=288.

### Persistence & list sanity over 200 uniquely-named loads

- **Both libraries accumulate variants; nothing is evicted.** After 200 loads where each ini/VariantPath file contained *only* the newest variant, `duel_000` still validated, generated 18 legal moves in ffish, and perft-1'd to 18 in the engine. Re-pointing VariantPath does **not** forget previously parsed variants.
- Engine `UCI_Variant` combo after re-`uci`: 320 entries (120 builtin + 200 ours), contains `duel_000` and `duel_199`. `ffish.variants()`: 320 names likewise. Both lists stay sane.
- Memory: rss 252 MB → 429 MB over 200 loads. Almost all of that is a first-window jump (rss 405 MB by load 19 — lazy init + first searches); **steady state is ~54 KB/load** (last 100 loads: +5.3 MB). heapUsed flat (6.6 MB), external 35→48 MB. Linear but tiny: even a 500-duel run session costs ~30 MB of variant definitions. No unbounded blow-up, no need to recycle engines mid-run.

### Same-name redefinition: **unreliable in BOTH libraries — silently ignored**

- ffish: `loadVariantConfig` of a second `[fsame:chess]` with different dims/rules prints `Variant 'fsame' already exists.` to the console and **keeps the old definition** (validateFen of the new-dims FEN still fails with code −8 and prints `curRankWidth != nbFiles: 5 != 8`; the default board is still the old startFen). No exception is thrown — the call *looks* like it succeeded.
- Engine: all three protocols keep the old definition:
  - rewrite same VariantPath file + re-`setoption` → re-parses the file (the UCI stream emits `Variant 'fsame' already exists.`) but does **not** replace the definition;
  - rewriting the file **without** `setoption` → not re-read at all;
  - `setoption` alone with the same value → re-reads the file but again refuses the redefinition.
- So a "reuse one variant name per duel" harness would **silently play every duel after the first under the first duel's rules**. This is the worst failure mode available (no error, wrong rules) and rules that strategy out completely.

## Verdict

**PASS** — per-duel runtime loading is cheap (≈0.4 ms ffish + ≈2 ms engine per duel, after a one-time ~0.6 s ffish warmup), correct (all perft cross-checks exact, rule tweaks demonstrably live), and stable across 200 uniquely-named variants in one session with bounded memory. Same-name reuse is off the table by direct evidence.

## Design implications

1. **Unique variant name per duel, always** (`duel_<counter>`), monotonically increasing per engine/ffish process lifetime. Never reuse a name — redefinition is silently ignored by both libraries. A page reload resets both, so the counter only needs process-lifetime uniqueness.
2. **Recommended per-duel loading protocol** (exact call sequence):
   ```
   // once at app boot, per process:
   ffish.loadVariantConfig(warmupIni)          // absorbs the one-time ~0.6s lazy init
   engine: uci → setoption name Use NNUE value false → isready

   // per duel n, with generated iniText (containing ONLY [duel_n:chess] and its startFen):
   ffish.loadVariantConfig(iniText)            // sync, ~0.4ms
   sf.FS.writeFile('/duel.ini', iniText)       // same path every duel is fine
   setoption name VariantPath value /duel.ini
   isready                                     // wait readyok (~2ms)
   setoption name UCI_Variant value duel_n
   ucinewgame
   isready
   position fen <startFen>
   ```
3. **Include `startFen` in every generated ini** (matching the variant's dims). Generated variants inherit chess's 8x8 startFen otherwise, which is wrong for non-8x8 dims; a correct startFen makes `position startpos` and the `d` debug command coherent and costs nothing. (`makeDuelVariantIni`'s `extra: { startFen }` does this; consider making it non-optional in the harness.)
4. **Guard each load**: after `loadVariantConfig`, assert `ffish.variants().includes(name)` (cheap; also catches the silently-rejected-config failure mode found in spike 3). In dev builds, also watch the engine stream for `already exists` / error chatter during VariantPath loads.
5. The per-duel file may contain only the current variant — both libraries retain all previously loaded variants regardless, at ~54 KB/load steady-state. No eviction mechanism exists, and none is needed at run scale.
6. Note for tooling: `ffish.validateFen` returns negative error codes (e.g. −8 for rank-width mismatch) and prints diagnostics like `curRankWidth != nbFiles: 5 != 8` straight to the console — treat any value ≠ 1 as invalid.
