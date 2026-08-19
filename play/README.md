# Phase 1 — duel vertical slice

Hand-authored arena JSON → variant config + FEN → playable duel vs the engine
on a phone (brief §10). Placement UI, win/loss, promotion, live Earthquakes
(the Board State Director). No overworld. Vanilla JS ES modules, no build
step, GitHub Pages.

**This build replaces the §4.5 crumble system with the Board State Director
("THE GODS")** — the experimental arena-regeneration design from the 2026-08
prototype sweeps. Repetition is no longer punished at all (no repetition
crumble, no position tracking). Instead, past a rising hazard ramp the arena
quakes: pieces scoot to adjacent squares (displacement — symmetric-preferred,
one piece per side) and, increasingly late, squares collapse (crumbles).
Displacements un-stick terrain-locked positions; crumbles shrink the board so
duels provably end. Tune it in Options → **The Gods** (Calm / Restless /
Wrathful / Custom / Off); `window.__DCK.setFavor(m)` is the runtime tuning
hook for future in-game effects (Favor of the Gods).

## Running

Any static host works locally for a quick look, but the engine is a pthread
build (needs `SharedArrayBuffer`): serve with COOP/COEP headers, or over
https / `localhost` where `coi-serviceworker.min.js` (which must stay NEXT TO
`index.html` — service-worker scope) injects them after one self-reload.

- `index.html` — the game. Debug/E2E query params (see `js/main.mjs` header):
  `?arena=<id>&autoplace=1&autobegin=1&go=…` plus Director overrides
  `&onset=&qramp=&cramp=&debt=&asymonset=&asymramp=&seed=` and `&fx=<scale>`
  (animation speed; **`fx=0` disables motion entirely — drivers want this**,
  since animations run inside `app.busy` and `waitIdle()` waits them out).
  `prefers-reduced-motion` does the same by default.
- `selftest.html` — in-browser infra cross-check (ffish ↔ engine perft parity,
  50-variant catalog, crumble filter, stalemate-as-loss protocol). All lines
  must read PASS.

## Layout

- `js/fen.mjs`, `js/prng.mjs`, `js/crumbleFilter.mjs` — verbatim ports of the
  validated Phase 0 modules (import paths only). (`js/crumble.mjs` — the old
  repetition+pacing controller — is deleted; `phase0/harness/crumble.mjs`
  remains the historical record.)
- `js/director.mjs` — **the Board State Director.** Exhaustive crumble
  candidate enumeration (neutral vs terminal — terminal fires only when the
  board has closed, termination `earthquake`), tiered displacement
  (A frees a terrain-locked pawn / B unsticks a piece / C cosmetic
  camouflage), symmetric-preferred pairing with a patience ramp for
  one-sided stirs, rising `P(quake)` + slower squared `P(crumble|quake)`
  + debt cap (termination guarantee), seeded RNG, `setFavor()` hook.
  Kings are never displaced; pawns never land on rank 1/promotion rank;
  quakes never give check, never leave a side in check, never end the game
  except through the terminal-crumble path, and — **Phase 1.1** — never hand
  out material (see `js/threat.mjs`). **Phase 1.2:** instrumented from the
  inside — every `quake()` call records a roll trace (`lastTrace`), the
  enumerators return their rejections with reasons, and RNG-free getters
  (`pQuake`/`pCrumble`/`pOneSided`/`forecast`) + live dials (`tune()`)
  expose the math without touching the seeded stream (see the debug-overlay
  section below).
- `js/threat.mjs` — **landing safety.** Attack chains + a simplified static
  exchange evaluation over the FEN grid; pure, no ffish, no engine. Exists
  because every other displacement guard is a *king*-safety guard, so a
  "symmetric" quake could step a piece onto an already-attacked square and
  gift it (observed on arena03: enemy rook a7→b7 into a white rook on the
  open b-file, White to move). Two guards use it: each candidate's landing
  square must be materially safe, and a paired second leg must leave the
  first leg's landing square safe too — filtering legs independently is not
  enough, since only leg 1 → leg 2 is covered by enumeration order.
  Verified: 420 seeded quakes over 7 realistic positions, zero gifts;
  it rejects ~11% of grid-legal steps overall (0% from opening positions,
  25–35% once files open), and 411/420 quakes still paired symmetrically.
  Known gaps, deliberately left to Phase 1.3: discovered attacks from the
  vacated square, rescues of already-hanging pieces, pins, and crumbles
  (which pick uniformly and so may swallow a queen as readily as air).
- `js/variant.mjs` — Phase 0 port + the fixed 50-variant catalog
  (`duel_3x6`…`duel_12x10`, loaded ONCE at boot — variant names are
  single-use) and a variants.ini key allowlist (unknown keys are silently
  ignored by both libraries).
- `js/engine.mjs` — browser engine/ffish access; `UciEngine` is the Phase 0
  class verbatim, incl. the search watchdog. Boot always sets
  `Use NNUE false` (defaults TRUE in this build) and `Threads 1`.
- `js/arena.mjs` — arena JSON validation/loading, §6 connectivity lint,
  placement → startFen. The initiative side plays White and sits at the
  bottom in FEN terms; the UI flips the view when the player is Black.
- `js/duel.mjs` — the live game loop, a structural port of
  `phase0/harness/game.mjs`: ffish is the source of truth, game end is
  `numberLegalMoves() === 0` → side to move loses. The bare-army rule (a
  side stripped to a bare king loses — no lone-king chases) is IN-GRAMMAR
  (`extinctionPieceTypes=*`, `extinctionPieceCount=1`), so the engine plays
  for strips and hint arrows/eval bar are truthful about them; quakes are
  guarded so they can never strip a last piece. The game layer adjudicates
  only kingless states (surgery-only). Engine history resets via bare
  `position fen` after every quake, plus an engine-stall recovery
  ladder (recycle instance, retry at reduced depth).
- `js/board-ui.mjs`, `style.css` — board/tray/promotion rendering, absolute
  `data-square` addressing, fits 3×6–12×10 boards on a 390×844 viewport.
  **Phase 1.1 motion:** pieces travel between squares as FLIP clones on an
  `.fx-layer` overlay (`animateSlide`/`animateSlides`) instead of teleporting
  — used by both the engine's replies and quake displacements, with captures
  dissolving under the incoming piece. Quakes play as three beats (rumble →
  motion → settle) rather than one 450 ms window, and leave **directional**
  marks (`quake-from` hollow, `quake-to` filled, `fresh-pit`) that persist
  through the enemy's reply and clear when the player moves. The old cue
  flashed both squares with one class, so it showed *that* something moved
  but never *which way* — and its 700 ms flash outlived the 450 ms wait, so
  the piece teleported mid-flash.
- `js/main.mjs` — boot, menu, placement flow (§4.3), duel driving, win/loss.
- `arenas/*.json` — the authored arenas (schema documented below).
- `vendor/` — fairy-stockfish-nnue.wasm 1.1.11 largeboard + ffish 0.7.9,
  the exact builds Phase 0 validated.

## Arena JSON (schema 1)

```json
{
  "schema": 1, "id": "arena01-first-duel", "title": "First Duel",
  "intro": "1–2 lines of flavor",
  "files": 4, "ranks": 6,
  "walls": [],
  "enemy":  { "backRank": ["N", "K"], "backRankStart": 1, "pawns": ["b", "c"] },
  "player": { "pieceSet": ["R", "N"], "backRankStart": 0, "patchWidth": 3, "pawns": ["a", "b", "c"] },
  "initiative": "player",
  "crumble": { "onsetPly": 40, "cadence": 10, "seed": 101 }
}
```

The `crumble` block is legacy-shaped: **only `seed` is read by this build**
(the Director's pacing comes from the settings preset / query params);
`onsetPly`/`cadence` are validated but ignored.

Absolute board coordinates; `backRank` arrays are file-ascending; player
patch width 3–5 (§4.2), enemy patch width 2–5 (the width-3 floor is
player-side only — a 2-wide "scrub" army just leaves open lanes); gap
(`ranks − 4`) capped at 4 — gaps 5–6 grind past 100 plies in every sweep,
and the Phase 2 duel trigger will enforce the same ceiling; walls eat slots
(a walled back-row slot suppresses that file's pawn too — under the default
automatic pawn row); never wall a 3-file arena (one wall costs a third of a
rank's cross-section — the linter caught a walled 3×8 turning into an enemy
fortress); `pieceSet` excludes the king (always in the placement pool). The optional per-side `"pawns"` array (file letters) authors a SPARSE
pawn row instead of §4.2's automatic full-patch row (`[]` = pawnless).
`loadArena` rejects out-of-catalog dims, patch violations, a walled
enemy-king slot, and arenas whose walls sever the two formations.

Placement (deliberately looser than §4.2's patch): the arena's
`backRankStart`/`patchWidth`/`pawns` define only the DEFAULT arrangement.
During setup the player may place pieces anywhere on their back row and
pawns anywhere on their first two rows (FSF accepts back-rank pawns; they
keep a single-step push). The pool is king + `pieceSet` + the authored pawn
count.

Balance philosophy (§13, §2.2): the engine is always full strength, so
arenas hand the PLAYER a decisive material edge — difficulty tuning happens
entirely in these JSON files. The shipped arenas follow the puzzle vision:
the player fields the 3×2 starter army (K+R+N + 3 pawns) against small
armies (K + one or two pieces, 0–2 pawns), targeting mates in roughly 10–20
plies under good play while staying ~2 blunders from a loss. Engine-vs-engine
plies per arena are measured by `phase0/harness/verify-play-arenas.mjs`
(encounter linter v0 — run it after editing any arena).

## Options / Cheater Mode

The gear menu has a Cheater Mode toggle with four sub-options, persisted in
localStorage: **Show best n moves** (a MultiPV probe of the current position
on the player's turn — lichess-style arrows whose width/opacity scale with
how close each move is to the best one, + SANs in the status line; MultiPV
is always reset to 1 before the engine's own replies, which stay
full-strength), **Allow undo** (snapshot-based rewind to the player's
previous turn, usable from the loss screen; the Director RNG stream is not
rewound), **Show eval bar** (player-POV score from the engine's replies and
the cheat probes), and **Edit enemy pieces** (testing tool: during
placement, tap an enemy piece to pick it up, tap a square to move it, tap it
again to remove it — the enemy king can be moved but never removed, and the
final position is FSF-validated at Begin).

## The Gods debug overlay (Phase 1.2)

The Director's tuning instrument (brief §10): built BEFORE Phase 1.3 changes
the rules it measures, so before/after comparisons run on one instrument.
Toggle: Options → The Gods → **Debug overlay**, or `?godsdebug=1` (E2E/dev;
not persisted). It is not gated on Cheater Mode — it is a debug tool, not a
cheat. The panel renders under the duel log; everything it shows derives
from `duel.record` plus the Director's pure getters.

**The invariant everything hangs on:** the Director's three rolls share one
seeded stream and the draw pattern is state-dependent (no draw before onset,
the debt cap skips the crumble roll, the displacement leg consumes a
variable number of picks). So the overlay NEVER re-rolls to preview:
probabilities come from RNG-free getters (`pQuake`/`pCrumble`/`pOneSided`/
`forecast`, pure functions of ply+config+debt+favor), and rolls are recorded
by instrumentation *inside* `quake()`. Tracing is unconditional, and the
draw sequence is byte-identical to the pre-1.2 Director — `selftest.html`
asserts a seeded quake sequence replays exactly with the overlay hammered
between rolls.

What the panel shows:

- **Per-ply roll trace** — one line per completed ply (quiet plies dim),
  from `record.quakeTraces`. Each trace carries every draw (value +
  threshold), the RNG-free probabilities, the census of what the
  enumerations produced, and an ordered reason-code path: `pre-onset` ·
  `quake-roll-failed` · `quake` · `crumble-forced` · `crumble-roll-passed` ·
  `crumble-roll-failed` · `no-first-leg` · `paired` · `unpaired-one-sided` ·
  `unpaired-held` · `crumble-neutral` · `crumble-terminal` · `starved`.
  `fellThrough` marks the case the nominal numbers hide — the displacement
  leg came up empty (`no-first-leg` / `unpaired-held`) and the quake dropped
  into the crumble leg anyway — which is why crumbles land MORE often than
  `P(crumble|quake)` implies. A `VETOED` marker means the duel layer's
  safety net overrode the Director (also logged to `record.anomalies`).
- **Next-roll readout + forecast** — the getters at ply+1, debt/cap, favor,
  plus median plies for next quake / first crumble / closure from
  `director.forecast()`. The forecast is the NOMINAL model (it prices the
  crumble roll, not the fall-through), deliberately: the gap between
  forecast and trace is the fall-through effect, measured.
- **Candidate census** (`census now`) — a full enumeration of the CURRENT
  position: displacement tiers A/B/C per side with veto reasons
  (`unsafe_landing` per side is the Phase 1.3 starvation-risk metric),
  neutral/terminal crumble candidates with veto reasons (`last_piece`,
  `exposes_king`, …), locked pawns. This is the one expensive act in the
  overlay — a quake-scale enumeration, 300–720 ms synchronous (rule 14) —
  so it only ever runs from the button (player's turn) or the `__DCK` hook,
  never per-ply. Quake traces get their census for free from the
  enumerations the quake itself ran.
- **Board heat** (`heat: on`) — the census painted on the board: landing
  squares by tier (A gold / B blue / C dim), terminal crumbles red. The
  census describes one position, so heat switches itself off on any move or
  quake instead of silently re-enumerating.
- **Eval delta per quake** — the ground truth of "did the arena change who's
  winning": two short probes (`depth 12 movetime 300`, paired limits) of the
  quake's pre/post FENs, normalized to white POV, `flipped` when the sign
  changed (mate scores count as ±∞ — SEE is blind to mate-net changes, which
  the sweeps measured as the dominant flip mode). Probes run in the player's
  idle window on the shared engine, sequenced with the cheat probe, and
  carry their OWN staleness seq + visible failure + capped recycle
  (rule 12 — the duel's stall ladder never fires for probes). Results land
  on the `record.quakes` entry (`evalDelta`).
- **Live dials** — while the overlay is on, Gods settings changes
  (temperament preset / custom knobs) also retune the LIVE Director via
  `director.tune()`, and the favor slider drives `setFavor()` — both
  recorded on `record.tunes` with their ply, so an exported trace explains
  itself. Without the overlay they keep their shipped meaning (next duel).
  Config changes never touch the RNG stream, debt, or favor.
- **Export** (`copy trace`) — the full ledger as JSON (arena, seed, config,
  tunes, moves, quakes + deltas, every roll trace) to the clipboard;
  `__DCK.gods.export()` returns the same object.

Console/E2E surface: `window.__DCK.gods` — `traces`, `quakes`, `tunes`,
`probs()`, `forecast()`, `census()`, `tune(partial)`, `export()`.
