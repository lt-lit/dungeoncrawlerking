# Phase 1 — duel vertical slice

Hand-authored arena JSON → variant config + FEN → playable duel vs the engine
on a phone (brief §10). Placement UI, win/loss, promotion, live crumble
system. No overworld. Vanilla JS ES modules, no build step, GitHub Pages.

## Running

Any static host works locally for a quick look, but the engine is a pthread
build (needs `SharedArrayBuffer`): serve with COOP/COEP headers, or over
https / `localhost` where `coi-serviceworker.min.js` (which must stay NEXT TO
`index.html` — service-worker scope) injects them after one self-reload.

- `index.html` — the game. Debug/E2E query params (see `js/main.mjs` header):
  `?arena=<id>&autoplace=1&autobegin=1&go=…&onset=…&cadence=…&seed=…`.
- `selftest.html` — in-browser infra cross-check (ffish ↔ engine perft parity,
  50-variant catalog, crumble filter, stalemate-as-loss protocol). All lines
  must read PASS.

## Layout

- `js/fen.mjs`, `js/prng.mjs`, `js/crumble.mjs`, `js/crumbleFilter.mjs` —
  verbatim ports of the validated Phase 0 modules (import paths only).
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
  `numberLegalMoves() === 0` → side to move loses, engine repetition history
  resets via bare `position fen` after every crumble, plus an engine-stall
  recovery ladder (recycle instance, retry at reduced depth).
- `js/board-ui.mjs`, `style.css` — board/tray/promotion rendering, absolute
  `data-square` addressing, fits 3×6–12×10 boards on a 390×844 viewport.
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
previous turn, usable from the loss screen; the crumble RNG stream is not
rewound), **Show eval bar** (player-POV score from the engine's replies and
the cheat probes), and **Edit enemy pieces** (testing tool: during
placement, tap an enemy piece to pick it up, tap a square to move it, tap it
again to remove it — the enemy king can be moved but never removed, and the
final position is FSF-validated at Begin).
