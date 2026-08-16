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
  out material (see `js/threat.mjs`).
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
  `arena01`–`arena04` are the campaign ladder; `test01`–`test15` are the test
  shelf — terrain structure (pillar lattice, a 2-wide causeway, a diagonal
  fault, a walled court, a rubble field, a half-walled muster ground), army
  shapes (K+Q alone, pawns-only, four knights, a mirror match, an outgunned
  player, the 2×2 floor, a 5×3 double-rank formation), and the scale extremes
  (`test14-classic` is literal 8×8 chess under duel rules — its startFen is
  `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR` with the expected 20 legal
  moves, which makes it the sharpest regression fixture in the set;
  `test15-emperor` is 12×10, the FSF ceiling, with 24 units a side).
- `vendor/` — fairy-stockfish-nnue.wasm 1.1.11 largeboard + ffish 0.7.9,
  the exact builds Phase 0 validated.

## Arena JSON (schema 2)

```json
{
  "schema": 2, "section": "test", "id": "test13-full-muster", "title": "Full Muster",
  "intro": "1–2 lines of flavor",
  "files": 8, "ranks": 8,
  "walls": [],
  "enemy":  { "rows": [["R","B","K","N","R"], [null,"N","B",null,null]],
              "backRankStart": 1, "pawns": ["b","c","d","e","f"] },
  "player": { "rows": [["R","N","K","N","R"], ["B","R","Q","R","B"]],
              "pieceRows": 2, "backRankStart": 1, "patchWidth": 5,
              "pawns": ["b","c","d","e","f"] },
  "initiative": "player",
  "expect": "any",
  "crumble": { "seed": 1113 }
}
```

Schema 1 still loads unchanged — `backRank` is shorthand for `rows: [backRank]`,
and every schema-2 field has a default.

**Formations are N piece rows plus ONE pawn row.** `rows[0]` is the back rank
(furthest from the enemy) and each later entry steps one rank toward the enemy;
the pawn row sits in front of the last piece row. So an N×M army in §4.2
bounding-box terms is `M-1` piece rows over one pawn row: **8×2 is the classic
chess army, 5×3 is two piece rows of five over five pawns.** The player's
`pieceRows` sets how deep the piece-placement region runs.

The player side is a POOL plus an anchor, not a fixed formation:
`pieceSet` (king excluded — it is always in the pool) with `backRankStart` /
`patchWidth` seeding the default arrangement. Authoring `player.rows` instead
pins the exact default squares and DERIVES `pieceSet` from it — needed when the
shape matters (`test14-classic` only comes out as `RNBQKBNR` this way; the
value-sorted fallback produces `BNRKQRBN`). The player may still rearrange
everything during setup either way.

The optional per-side `"pawns"` array (file letters) authors a SPARSE pawn row
instead of §4.2's automatic full-patch row (`[]` = pawnless). Absolute board
coordinates throughout; `rows` arrays are file-ascending; walls eat slots (a
walled back-row slot suppresses that file's pawn too, under the default
automatic pawn row).

`section` is `"campaign"` (default) or `"test"` and groups the menu — **it
gates nothing.** `expect` (`"player"` / `"enemy"` / `"any"`) is what the
encounter linter asserts; it defaults to `"player"` for campaign arenas (the
§13 balance philosophy) and `"any"` for test scenarios.

The `crumble` block is legacy-shaped: **only `seed` is read by this build**
(the Director's pacing comes from the settings preset / query params);
`onsetPly`/`cadence` are accepted and ignored.

### What `loadArena` rejects, and what it merely reports

**Hard errors are limited to what the engine or our own code cannot survive:**
dimensions outside the FSF largeboard ceiling (files 2–12, ranks 2–10 — one
step past it, 13×10 or 12×11, crashes the WASM heap on Board construction, and
`loadVariantConfig` does *not* reject the oversized block, it silently drops the
variant); a side without exactly one king (FSF itself tolerates two, but
`duel.mjs`'s kingless adjudication and the Director's never-displace-a-king rule
assume one); a walled or clipped enemy-king slot; formations deep enough to
overlap (the two stamps would silently overwrite); a side with no non-king
material (already decided at load under the bare-army rule); a player with no
placement square at all; squares off the board; and a `player.rows` /
`pieceSet` mismatch.

**Everything we merely believe is a warning** on `arena.warnings`, surfaced in
the boot log and by the linter: gap width, formation clipping/overhang, queen
count, too few placement squares for the pool, and severed formations (§6). The
§4.2 patch caps (player 3–5, enemy 2–5), the `pieceSet ≤ 7` ceiling, the 3×6
dimension floor and the `gap ≤ 4` cap used to be throws. They were authoring
guesses hardened into errors — from a brief that marks army composition
`[PROVISIONAL]` and a §8 that says the army *grows* through the run — and the
gap cap in particular rested on sweep data from the retired crumble system,
which CLAUDE.md disowns until the Phase 1.5 harness port. A throw prevents us
from ever collecting the counter-evidence; a warning stays falsifiable. Phase
1.5 re-derives the real numbers.

Placement (deliberately looser than §4.2's patch): the arena's
`backRankStart`/`patchWidth`/`pawns` define only the DEFAULT arrangement.
During setup the player may place pieces anywhere on their back row and
pawns anywhere on their first two rows (FSF accepts back-rank pawns; they
keep a single-step push). The pool is king + `pieceSet` + the authored pawn
count.

Balance philosophy (§13, §2.2): the engine is always full strength, so
CAMPAIGN arenas hand the PLAYER a decisive material edge — difficulty tuning
happens entirely in these JSON files. The campaign arenas follow the puzzle
vision: the player fields the 3×2 starter army (K+R+N + 3 pawns) against small
armies (K + one or two pieces, 0–2 pawns), targeting mates in roughly 10–20
plies under good play while staying ~2 blunders from a loss. The test shelf is
deliberately exempt — it exists to cover shapes the campaign does not, several
of them unbalanced on purpose.

Engine-vs-engine plies per arena are measured by
`phase0/harness/verify-play-arenas.mjs` (encounter linter v1 — run it after
editing any arena):

```sh
cd phase0
node harness/verify-arena-schema.mjs             # schema + validator policy, ~50 ms, no engine
node harness/verify-play-arenas.mjs              # campaign only — the GATING run
node harness/verify-play-arenas.mjs --all        # + the test shelf, informational
node harness/verify-play-arenas.mjs --games 5    # more seeds per arena
```

`verify-arena-schema.mjs` pins the validation policy itself — it asserts that
the shapes listed above as *warnings* still LOAD (2-wide patches, 12-wide
patches, 8-piece pools, 12×10, 4×2, gap 6, severed formations) and that the
engine-fatal ones still throw. Run it first; it is instant and needs no engine.

Every arena must be decisive and error-free; *who* wins is asserted only when
the arena's `expect` claims to know. The `--all` scope is slow (the 12×10 and
classic scenarios search wide boards with full armies), which is why it is not
the default.

**Known: `--all` currently exits nonzero.** 18 of the 19 arenas are decisive;
`test02-causeway` hits the 400-ply cap with ~29 crumbles — its 2-wide bridge
builds a fortress the crumble pacing cannot close. That is the case the
scenario was authored to produce, and the number comes from the RETIRED crumble
system the harness still drives (see the caveat in the linter header), not from
the Director. Retuning the arena until the old system can close it would be
measuring against a system we do not ship. Recheck it after the Phase 1.5
harness port; the campaign scope is the one that gates.

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
