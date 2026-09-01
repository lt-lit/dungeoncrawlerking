# Phase 1 — duel vertical slice (the proving grounds)

Designer-locked stage terrain × generated armies → variant config + FEN →
playable duel vs the engine on a phone (brief §10). Setup screen (stage
picker + army generator), win/loss, promotion, live Earthquakes (the Board
State Director). No overworld. Vanilla JS ES modules, no build step,
GitHub Pages.

**The slice-refresh setup flow replaced the original arena menu + placement
screen** (retired with `arenas/*.json`, `js/arena.mjs`, and the enemy-edit
cheat): pick one of the 33 locked stages, then shape both armies LIVE — the
generator knobs (width 3–8, points budget or exact pieces, depth archetype,
anchor, initiative, flip, crop, one master seed + 🎲) sit under the board
preview, and every change re-deals the armies on the board in place (an
impossible combo shows the bare terrain and the reason, with Begin
blocked). One master seed derives the armies, their molding AND the
Director's quake stream — re-entering a seed reproduces the whole duel.
The player always holds White at the bottom; "Enemy moves first" is the
turn field, not a seat swap.

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
  `?stage=<id>&flip=1&ct=&cb=&turn=w|b&seed=<n>&w=<spec>&b=<spec>&autobegin=1&go=…`
  (army spec strings are `width:spec:archetype:anchor`, spec = `b<points>`
  or piece letters — e.g. `w=6:b30`, `b=5:QRNN:scrambled`), plus Director
  overrides `&onset=&qramp=&cramp=&debt=&asymonset=&asymramp=&dirseed=`
  and `&fx=<scale>` (animation speed; **`fx=0` disables motion entirely —
  drivers want this**, since animations run inside `app.busy` and
  `waitIdle()` waits them out). `prefers-reduced-motion` does the same by
  default.
- `selftest.html` — in-browser infra cross-check (ffish ↔ engine perft parity,
  60-variant catalog, crumble filter, stalemate-as-loss protocol). All lines
  must read PASS.

## Layout

- `js/fen.mjs`, `js/prng.mjs`, `js/crumbleFilter.mjs` — verbatim ports of the
  validated Phase 0 modules (import paths only). (`js/crumble.mjs` — the old
  repetition+pacing controller — is deleted; `phase0/harness/legacy/crumble.mjs`
  remains the historical record.)
- `js/director.mjs` — **the Board State Director (v3 — the ladder;
  brief §4.5).** Triggered by two meters — restlessness (`js/meter.mjs`,
  the record) × staleness (`js/staleness.mjs`, the position / fun score,
  which sets the fill rate) — never by ply (the old ramp survives only as
  the late backstop floor) and never while a king is in check. Each quake
  spends a DRAWN action budget across four rungs: weaken (`*`→`^`),
  breach (`^`→floor, king-filtered), displace (ONE piece, either side,
  best tier over both — A frees a terrain-locked pawn / B unsticks a
  piece / C cosmetic camouflage; v2's one-per-side pairing is repealed),
  and crumble (a permanent HOLE — `director.holes`, Director state, since
  FSF cannot tell a hole from an authored wall; at most one per quake,
  debt cap counts every rung). Exhaustive candidate enumeration
  throughout (neutral vs terminal crumbles — terminal fires only when the
  board has closed, termination `earthquake`); targets picked
  seeded-weighted by STRUCTURAL impact, never by eval. Kings are never
  displaced; pawns never land on rank 1/promotion rank; quakes never give
  check, never leave a side in check, never end the game except through
  the terminal-crumble path, and — **Phase 1.1** — never hand out
  material (see `js/threat.mjs`), a guard that now holds across the whole
  budget. **Phase 1.2:** instrumented from the inside — every `quake()`
  call records a roll trace (`lastTrace`), the enumerators return their
  rejections with reasons, and RNG-free getters
  (`pQuake`/`pressure`/`rungWeights`/`forecast`) + live dials (`tune()`)
  expose the math without touching the seeded stream (see the
  debug-overlay section below).
- `js/threat.mjs` — **landing safety.** Attack chains + a simplified static
  exchange evaluation over the FEN grid; pure, no ffish, no engine. Exists
  because every other displacement guard is a *king*-safety guard, so a
  "symmetric" quake could step a piece onto an already-attacked square and
  gift it (observed on arena03: enemy rook a7→b7 into a white rook on the
  open b-file, White to move). Two guards use it: each candidate's landing
  square must be materially safe, and every later action in a quake's budget
  must leave every square this quake already landed a piece on safe too —
  filtering actions independently is not enough, since only earlier → later
  is covered by enumeration order (v3 generalized this from v2's leg pair).
  Verified: 420 seeded quakes over 7 realistic positions, zero gifts;
  it rejects ~11% of grid-legal steps overall (0% from opening positions,
  25–35% once files open), and 411/420 quakes still paired symmetrically.
  Known gaps, deliberately left to Phase 1.3: discovered attacks from the
  vacated square, rescues of already-hanging pieces, pins, and crumbles
  (which pick uniformly and so may swallow a queen as readily as air).
- `js/variant.mjs` — Phase 0 port + the fixed 60-variant catalog (3–12 files ×
  5–10 ranks: `duel_3x5`…`duel_12x10`, loaded ONCE at boot — variant names
  are single-use) and a variants.ini key allowlist (unknown keys are
  silently ignored by both libraries). Promotion region = the ENTIRE far
  rank, per color, in every variant (designer rule — see the stage section).
  `dealVariant()` builds the PER-DEAL variant that carries the CAMP-LINE
  double-step (spike 14): its `doubleStepRegion` spans every rank from
  each home edge to that side's camp line (armygen `campLineRank` — the
  mode pawn rank, ties toward the enemy), its name encodes that config
  (`duel_<f>x<r>__w<line>__b<line>` — so re-registration is always an
  identical no-op, never a silent rules change), and deal variants
  register INCREMENTALLY alongside the catalog — ffish via
  `loadVariantConfig`, the engine via the cumulative `app.catalog`
  reload that every recycle path already performs.
- `js/stage.mjs` — stage schema v2: terrain-only ASCII maps ('.', '#',
  '^' furniture — §4.6) → `loadStageV2`, plus the two transforms every
  corpus and the setup screen use: `flipStageVertical` (the
  both-orientations testing convention) and `cropStage` (boundary
  redraw — the manual gap knob AND the king-anchored auto-crop's
  mechanism; the old fully-walled-extreme-rank guards are retired, see
  the crop rule below).
- `js/armygen.mjs` — the army generator + molding layout (unit bags W×2,
  W 3–8; molding v2.1 with the two designer invariants: royal rearmost,
  pawns in front PER FILE) and **`dealMatchup`, the single composed entry
  point** (terrain transforms + armies + molding + connectivity + ffish
  sanity checks + seeded retries) shared by the setup screen,
  `phase0/harness/verify-stages.mjs`, and the meter-lab corpus builder —
  never re-assemble the pipeline by hand (the crumbleFilter split is the
  cautionary tale).
- `stages/*.json` — the stage set, authored with §4.6 capturable walls
  from the start (wave 4, s01–s33: the furniture bed — locked, all 33
  accepted 2026-08-27, replacing the retired waves 1–3; wave 5,
  s34–s58: rooms & breaches — sectioned maps, crate clusters,
  furniture in wall structures, breakable double doors, and the s51+
  floorplans (multi-room maps: hallways, doors to and between rooms,
  per-room furniture patterns) — locked, all 25 accepted 2026-08-27);
  `stages/manifest.json` is the
  generated browser bundle (regenerate with
  `phase0/harness/gen-stage-manifest.mjs` after any stage edit —
  `verify-stages.mjs` fails on a stale bundle). Designer review gallery:
  `stages-gallery.html` (generated by `phase0/harness/gen-gallery.mjs`;
  both tools need the patched pair overlaid into phase0/node_modules —
  they fail with the recipe when it isn't).
- `js/engine.mjs` — browser engine/ffish access; `UciEngine` is the Phase 0
  class verbatim, incl. the search watchdog. Boot always sets
  `Use NNUE false` (defaults TRUE in this build) and `Threads 1`.
- `js/duel.mjs` — the live game loop, a structural port of
  `phase0/harness/game.mjs` (since frozen in `harness/legacy/`): ffish is the source of truth, game end is
  `numberLegalMoves() === 0` → side to move loses. The bare-army rule (a
  side stripped to a bare king loses — no lone-king chases) is IN-GRAMMAR
  (`extinctionPieceTypes=*`, `extinctionPieceCount=1`), so the engine plays
  for strips and hint arrows/eval bar are truthful about them; quakes are
  guarded so they can never strip a last piece. The game layer adjudicates
  only kingless states (surgery-only). Engine history resets via bare
  `position fen` after every quake, plus an engine-stall recovery
  ladder (recycle instance, retry at reduced depth).
- `js/board-ui.mjs`, `style.css` — board/promotion rendering, absolute
  `data-square` addressing, fits 3×5–12×10 boards on a 390×844 viewport.
  Terrain: a stone wall is a sunken-pit CELL treatment; furniture (§4.6)
  deliberately renders like a PIECE — a neutral `▦` glyph
  (`.piece.neutral`, the `--furniture` wood tone) over a raised cell
  bevel — because it can be captured: the capture-dissolve animation and
  the ringed target mark then cover crate smashes with zero extra code.
  One sprite for every furniture flavor (crates, doors, weak masonry —
  per-stage fiction); skins are a future cosmetic layer, never grid state.
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
- `js/main.mjs` — boot, the setup screen (stage picker + generator panel),
  duel driving, win/loss.
- `vendor/` — fairy-stockfish-nnue.wasm 1.1.11 largeboard + ffish 0.7.9,
  the exact builds Phase 0 validated.

## Stages (schema 2) + the army generator

A stage is GROUND — walls and dimensions drawn as ASCII, nothing else
(armies are never part of a stage):

```json
{ "schema": 2, "id": "s03-the-squeeze", "title": "The Squeeze",
  "notes": "why this terrain exists / what it tests",
  "map": ["#....", ".....", "..."] }
```

`.` floor · `#` stone wall (`*` accepted — the FEN glyph) · `^` furniture
(§4.6: the neutral capturable occupant — terrain to molding/crop/the gods,
an ordinary capture in play; `^`→`.` derives the stone-only corpus control
arm from the same file); rectangular, top rank first; 3–12 files × 5–10
ranks (the engine's largeboard caps). The locked stages are a curated
sample of plausible dungeon slices — Phase 2's dungeon generator replaces
authoring wholesale, so there is no editor; the diff and the gallery are
the review surface.

**The deal pipeline** (armygen `dealMatchup`, one call): stage →
`flipStageVertical`? → `cropStage`? → per-side armies (`makeArmy`: width
3–8, explicit pieces or a seeded points-budget draw) → molding
(`layoutArmy` — dense center-out fill; royal rearmost, pawns in front per
file; terrain reshapes everything, furniture included) → gap check →
**king-anchored auto-crop** (rows behind either king are removed; below 5
ranks the attempt is rejected) → connectivity check on the cropped board
(furniture is PASSABLE — armies smash through; a furniture-only seal is
legal and warn-flagged by the verifier) → the deal's own variant (the
camp-line double-step, spike 14) → ffish sanity probes (no side starts in
check, not decided at ply 0) → seeded retries on rejection → start FEN +
`variantName`/`variantIni`. Everything derives from ONE master seed via
`childSeed` (armies, molding, and the Director's quake stream), so a
seed + knobs reproduces the entire duel.

**Double-step = the CAMP LINE (designer rule, 2026-08-21).** Every pawn
has the two-square push **at or behind its side's camp line** — the rank
holding the most of that side's dealt pawns, ties toward the enemy — and
never past it. Spike 13's every-visit caveat (repeated doubles from
anywhere) is repealed. The line sits where the position LOOKS like the
starting line: chess's row-based rule generalized — it equals
first-move-only until a quake moves a pawn backward or sideways, and
there the row wins, because a player can see a line, not a pawn's
history. Accepted consequences: a pawn molded AHEAD of the wall
(~10% of dealt pawns on this bed) reads and plays as already advanced —
no leap, ever; a moved pawn knocked back behind the line regains the
jump; rear pawns behind the line can single-step then double once lanes
open (tied stacks put the line at the front wall).

**Crop = redrawing the boundary, and KINGS ANCHOR THE ARENA (designer
ground rules, 2026-08-27).** To every piece a rank of solid wall and the
board simply ending are identical, so `cropStage` REMOVES far/near ranks
instead of walling them; the cropped board uses the smaller catalog
variant. On top of that, the deal itself enforces the king anchors: the
player's king always starts on the first row and the enemy king on the
last — after molding, `dealMatchup` AUTO-CROPS every row behind either
king (floor 5 ranks — gap 1, a duel can't start closer; below it the
attempt is rejected). Consequence, load-bearing: **the promotion zone is
ALWAYS the enemy king's starting row — the real far rank — and it always
holds a usable square, because the king is standing on it.** The old
corollary ("no stage or crop may produce a fully-walled extreme rank") is
RETIRED — the guarantee is true by construction, so
`loadStageV2`/`cropStage` no longer police extreme ranks and the verifier
instead flags stages whose fully-terrain edge rows leave fewer than 5
playable ranks (nothing could ever deal there). Manual cropping still
exists so every stage can test smaller gaps than its full height
supports — it rehearses how a dungeon encounter will draw arena
boundaries.

Balance philosophy (§13, §2.2): the engine is always full strength, so the
tuning knob is the material edge the generator hands the player (the setup
screen shows the live edge; §7's puzzle band is ~+4..+7, "two blunders
from losing"). Mirror matches are a lab-only bias canary, never a play
mode. The static verifier is `phase0/harness/verify-stages.mjs` (every
stage × both orientations × crops × sampled armies through `dealMatchup`,
exit-code semantics — run it after editing any stage); engine-vs-engine
verification is the meter-lab rerun on this same bed.

## Options / Cheater Mode

The gear menu has a Cheater Mode toggle with three sub-options, persisted in
localStorage: **Show best n moves** (a MultiPV probe of the current position
on the player's turn — lichess-style arrows whose width/opacity scale with
how close each move is to the best one, + SANs in the status line; MultiPV
is always reset to 1 before the engine's own replies, which stay
full-strength), **Allow undo** (snapshot-based rewind to the player's
previous turn, usable from the loss screen; the Director RNG stream is not
rewound), and **Show eval bar** (player-POV score from the engine's replies
and the cheat probes). The old "edit enemy pieces" testing tool retired
with the placement screen — the generator knobs + seeds cover its job.

Engine pacing (designer decision, 2026-08): the enemy thinks up to **10
seconds** per move (`depth 22 movetime 10000` — the depth cap is the WASM
stability rule, not a strength limit). Small boards still reply in
<200 ms because depth 22 arrives first; big boards get the full think.
Lab corpora set their own faster limits.

## The Gods debug overlay (Phase 1.2)

The Director's tuning instrument (brief §10): built BEFORE Phase 1.3 changes
the rules it measures, so before/after comparisons run on one instrument.
Toggle: Options → The Gods → **Debug overlay**, or `?godsdebug=1` (E2E/dev;
holds for the session, and is only written to storage if some option is
changed afterwards). It is not gated on Cheater Mode — it is a debug tool,
not a cheat. The panel renders under the duel log; everything it shows
derives from `duel.record` plus the Director's pure getters.

**The invariant everything hangs on:** the Director's draws share one
seeded stream and the draw pattern is state-dependent (no draw before onset,
the debt cap skips the rung roll, the budget consumes a variable number of
draws and picks). So the overlay NEVER re-rolls to preview: probabilities
come from RNG-free getters (`pQuake`/`pressure`/`rungWeights`/`forecast` —
pure functions of the meters, config, debt and favor), and rolls are
recorded by instrumentation *inside* `quake()`. Tracing is unconditional. Two
separate guarantees back this: byte-identity of the draw sequence to the
pre-1.2 Director was verified at development time by a Node A/B harness
(12 seeds × 24 plies × 2 fixtures, old vs new, getters/census/forecast
hammered between rolls — identical, incl. 118 fall-throughs); and
`selftest.html` permanently asserts the live half — a seeded quake
sequence replays exactly whether or not the overlay is exercised between
rolls, and the getters consume zero RNG.

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
- **Export** (`copy trace`) — the full ledger as JSON to the clipboard:
  the deal provenance (stage id, flip, crop, army specs, master setup
  seed — everything a replay re-deals from), the Director seed,
  `config0` (the starting config a replay constructs with),
  the live config, tunes (undo drops a `{ply, undo: true}` marker on the
  ledger, since an undo forks the RNG stream and ends replayability),
  moves, quakes + deltas, every roll trace. `__DCK.gods.export()` returns
  the same object.

Console/E2E surface: `window.__DCK.gods` — `traces`, `quakes`, `tunes`,
`probs()`, `forecast()`, `census()`, `tune(partial)`, `export()`.
