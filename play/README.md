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
  "files": 5, "ranks": 8,
  "walls": ["c4"],
  "enemy":  { "backRank": ["R", "N", "K", "B", null], "backRankStart": 0 },
  "player": { "pieceSet": ["R", "N", "B"], "backRankStart": 0, "patchWidth": 5 },
  "initiative": "player",
  "crumble": { "onsetPly": 60, "cadence": 12, "seed": 101 }
}
```

Absolute board coordinates; `backRank` arrays are file-ascending; patch
widths 3–5 (§4.2); walls eat slots (a walled back-row slot suppresses that
file's pawn too); `pieceSet` excludes the king (always in the placement
pool); a pool larger than the surviving slots gives §4.3 selection mode.
`loadArena` rejects out-of-catalog dims, patch violations, a walled enemy-king
slot, and arenas whose walls sever the two formations.
