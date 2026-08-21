# Vertical-slice refresh — the proving grounds (plan)

> **This document is the work plan for PHASE 1.2.5 — The Proving Grounds**
> (brief §10): the calibration test bed and the automated-playtest rig that
> Phase 1.3 (the Gods rule change) is blocked on. The data bed and the setup
> screen shipped (PRs #10, #11); what REMAINS is the lab rig — corpus
> materializer, mirror-canary metric, and the meter-lab rerun. See the
> STATUS block near the end of this file for the live picture.

Status: **data bed + setup screen SHIPPED; the lab rig remains** (see the
header and the STATUS block below). This document is the work plan and the
record of the decisions behind it. It gates the rest of Phase 1.3: the meter-lab variant sweep was deliberately stopped (partial
data committed, labeled) because its stage/army distribution was not
representative — tuning numbers collected on it would have baked bad
assumptions into canon.

## Why (decision history, condensed)

- The Gods redesign evidence (meter lab, `phase0/results/meterlab-findings.md`)
  is directionally solid — the ply-ramp trigger was the wrong half, a
  state-aware meter halves god-harm — but every *number* inherits the test
  distribution, and that distribution was wrong twice over:
  1. **Stage geometry**: only the four authored arenas (3–5 files wide,
     0–2 walls). Phase 0's sweep generator conflates board width with the
     §4.2 army-patch width and has NEVER emitted a board wider than 5 files.
     Real stages run up to ~10 wide.
  2. **Armies**: baked per-arena piece sets — no variety axis at all.
- Verdict from design review: stages get AUTHORED (by Claude) and VERIFIED
  (by the designer, via a gallery — no arena editor; see below); armies get
  a fully-knobbed GENERATOR. Board geometry and army composition are
  **independent** — the old width coupling was a bug of assumption.
- Stages are stand-ins: in the real game, terrain and board states are
  emergent from randomly generated dungeons, not authored. The stage set is
  a curated sample of plausible dungeon slices — it should look
  procedurally-shaped, not set-piece-designed, and an arena editor would be
  effort spent on throwaway content. Phase 2's dungeon generator replaces
  authoring wholesale.

## Design spec (agreed)

### Stages

- Range **3×5 up to 10×10** (engine grammar caps at 12 files × 10 ranks;
  10×10 is inside it). The extremes (3-wide, 10-wide) are for feel-testing
  and may not ship; the expected center of mass is hallways ≥4–5 wide.
- Authored as JSON with an **ASCII map** field (walls drawn as text rows) —
  reviewable in a diff, no editor.
- Verified via an **in-browser gallery**: one static page rendering every
  proposed stage (plus sample molded armies at several widths), for
  accept/reject/tweak feedback per stage.
- The four Phase-1 arenas are **retired** (not remade).
- Perf gates for the big end, measured not assumed: phone benchmark at
  10×10 (spike08-style — search cost AND `quake()` cost both scale with
  board area; the WASM pthread showed stress in a 10×10 lab smoke), and
  square/drag ergonomics at 10 files on a phone screen.

### Armies (the generator)

- Native shape **W×2, W = 3…8**: front row = **W pawns, always full width
  of the army** (subject to change; no intentional pawn-line gaps for now),
  back row = **exactly one royal** (type parameterized, default K — royal
  variants are future engine work, schema-ready now) plus W−1 non-pawns.
- Composition knobs, per side independently: explicit piece list OR
  point-budget random draw; arrangement archetype (balanced / queen-corner /
  rook-flanks / knight-core / scrambled); seed (visible, re-enterable).
- **Army size has NOTHING to do with stage geometry.** The only coupling is
  feasibility (below).
- Testing posture: the setup tool generates both armies freely; tuning
  corpora assume a player-favored edge (the live edge is displayed).
  Mirror matches are a lab-only instrument — with the material edge
  removed, color-winrate drift in engine-vs-engine play is a clean Director
  bias canary — never a play mode.

### Molding (the layout function)

Armies **mold to terrain**: an army entering narrow or broken ground
squishes and rearranges. The duel only ever needs the squished SNAPSHOT at
duel start, so deployment is one **pure seeded function**
`(stage, side, offset, army, seed) → placement` shared by the setup UI, the
lab, and (later) the dungeon layer. No marching simulation.

Invariants (the ONLY constraints on rearrangement — designer-specified):
1. The royal sits in the army's **rearmost occupied row**.
2. **Pawns stay in front**: every pawn forward of every non-pawn.

Implementation shape: fill order — royal deepest, non-pawns fill from the
back edge inward, pawns continue toward the front; rows flow around walls.
An 8×2 army in a 4-wide hall becomes 2 piece rows behind 2 pawn rows with
no special-casing. Placement is NOT necessarily centered, and the two
armies need not align (offset is a knob / seeded).

Feasibility lint (validate, never silently fix): both armies fit within
`ranks − minGap` total depth; §6-style connectivity between the armies; no
side starts in check; not decided at ply 0; strict invariant violations
(wall pocket forcing a piece past a pawn) re-roll the offset, else the
triple is rejected "doesn't fit".

### Decisions (designer-resolved 2026-08)

- **Double-step: UNIVERSAL.** Every pawn gets the two-square push
  regardless of rank — spike 13 verified FSF supports multi-rank
  `doubleStepRegion` lists (walls block correctly, ep works, engine
  parses). Caveat accepted: region semantics are every-visit, not
  first-move-only — pawns always have the double-step available. Canon
  edit queued for §4.4 alongside the §4.2 rewrite.
  `[REPEALED 2026-08-21 — the "accepted" caveat had never been put to
  the designer as its concrete consequence (unlimited repeated
  double-steps from anywhere) and was rejected on contact. The rule is
  the CAMP LINE: spike 14 — per-deal variants whose doubleStepRegion
  runs from each home edge to that side's line, THE MODE PAWN RANK with
  ties toward the enemy (three passes: exact dealt squares failed the
  quake-scoot reading; front-most rank failed the straggler reading —
  molding bumps ~10% of pawns past the wall and a lone one dragged the
  zone forward; the wall itself is where the eye puts the line).
  Position-derivable, so it survives quake FEN surgery, which no
  move-history scheme could. Designer-accepted consequences: pawns
  dealt ahead of the line are "advanced" and never leap; knocked-back
  moved pawns regain the jump; stacked rear pawns can 1-then-2 behind
  the line (tied stacks put the line at the front wall); all-scattered
  ties resolve generous. Census on the 33-stage bed: 10.5% of dealt
  pawns advanced, 49% of deals have ≥1, worst 40%. No camp shading —
  the line is clean.]`
- **Gap between armies**: lint rejects gap < 1. In practice duels are
  expected to begin at gap 2–5, but extremes get tested; **whether ideal
  gap scales with army size is a lab investigation item** (game-quality
  metrics vs gap × army width). `[REVISED 2026-08-21: the planned min/max
  gap knob became the CROP knob — see the setup-UI decisions below —
  since molded armies pack to their home edges and gap is otherwise
  emergent from stage height.]`
- **Pawn coverage**: "generally at least one pawn in front of each
  non-pawn piece" — implemented as a soft preference in the molding fill
  (violations only where walls force them), surfaced visually in the
  gallery for the designer to judge in action.
- **Back-piece ordering when pieces overflow into multiple rows**: default
  "heavies deep, minors forward", exposed as the archetype knob; judged in
  the gallery.
- **Armies that don't fit at all** (e.g. two 8×2 armies in a 3-wide
  corridor): rejected by lint. What the DUNGEON does about it (refuse the
  duel? partial deploy? attrition?) is an open design question for Phase 2,
  deliberately not answered here.
- **Mirror-match bias canary**: kept, lab-only, FULL-strength engines on
  both seats (no shallow-seat handicap in that arm).
- **Wall patterns**: a deliberate mix — corridors, chambers, pillars,
  rubble, everything; variety is the point, and arenas are NOT assumed
  symmetrical.

### Canon edits queued (need designer sign-off before committing)

- Brief **§4.2 rewrite**: patch width 3–5 → army W 3–8; formation model →
  unit bag + molding invariants. `[REVISED]` stamp per the Phase-1.1
  precedent. CLAUDE.md and module headers follow.
- **LANDED** (commit `cfd3419`, with the 33-stage lock): §4.2 and §4.4
  both carry `[REVISED 2026-08]` stamps. This section is history, not a
  work item.

### Setup-UI decisions (designer-resolved 2026-08-21)

- **Seat & initiative**: the player ALWAYS holds White at the bottom;
  "enemy moves first" is the deal's turn field (`turn: 'b'`), never a
  seat swap. The flip toggle mirrors the TERRAIN.
- **One master seed**: a visible, re-enterable seed field (+ 🎲 reroll)
  drives armies, molding AND the Director via `childSeed` — one number
  reproduces the whole duel, quakes included.
- **Gap control = CROP**: two steppers REMOVE far/near ranks
  (`cropStage`), redrawing the boundary the way a dungeon encounter will;
  every stage can then test smaller gaps than its height supports. To
  every piece a boundary is a boundary, so this changes no rules — and it
  keeps the designer's promotion rule by construction: **the promotion
  zone is ALWAYS the entire actual far rank of the playable area, both
  sides, at every crop.** No stage/crop may produce a fully-walled
  extreme rank (enforced in loader, crop, and verifier).
- **Archetypes**: ship the implemented three (heavies-deep / minors-deep /
  scrambled). Full custom back-row arrangement is deferred to its own
  session.
- **Rejection policy**: `dealMatchup` auto-retries a few derived seeds,
  then surfaces "doesn't fit" with the reason. One shared entry point for
  UI / verifier / corpus builder — no re-assembled pipelines.
- **Pacing**: perf/optimization work is DEFERRED (designer call — not a
  concern at this stage). Human play caps the engine at 10 s/move
  (`depth 22 movetime 10000`; d22 stays as the WASM stability cap). The
  10×10 phone benchmark is parked with it; lab corpora keep their own
  faster limits.
- **Verifier scope**: `verify-stages.mjs` is STATIC (deal sampling +
  invariants over 33 stages × both orientations × crops, exit-code
  gated); engine-vs-engine verification belongs to the meter-lab rerun.
- **Live preview (designer correction, same day)**: army generation
  happens AFTER the stage is picked, on the board — the knob panel sits
  under the preview and every change re-deals in place; an impossible
  combo shows the bare terrain and the reason with Begin blocked. The
  first build's picker-side panel with a text-only readout was rejected.
- **Double-step follows the CAMP LINE (designer corrections, same
  day, three passes)**: first-move-only was the intent; the shipped
  semantics are row-based — at or behind the side's MODE pawn rank,
  ties toward the enemy — because quakes move pawns backwards/sideways
  (a scooted untouched pawn must still read as able to leap) and
  molding bumps stragglers past the wall (a lone forward pawn must
  read as advanced, not drag the zone up). See the repeal note under
  Decisions above; spike 14 + per-deal variants implement it.

## Stage set v1 — LOCKED (designer-reviewed 2026-08)

All 12 stages in `play/stages/` are stamped as viable test arenas
(s01-the-closet … s12-rat-warren; gallery `play/stages-gallery.html`).
Two follow-ups from the same review, in order:

1. **Molding v2.1 — SHIPPED** (two designer corrections deep): v1's
   strict row separation hollowed formations; v2's outer-first +
   coverage-driven pawn placement scattered the sparse front row. Final
   rule is ONE mechanism: dense back-to-front cursor, CENTER-OUT for both
   unit classes — mixed rows put pawns on the outer cells automatically
   (pieces already hold the center) and sparse front rows center their
   spares. "Pawns in front" is a PER-FILE screen held by fill order and
   asserted per-file in the test bench; royal rearmost; the royal's row
   provably never holds a pawn. Pawn cover is a REPORT, never a placement
   force, and WALLS COUNT as cover (they block sliders; designer: "cover
   is cover") — `violations` lists open files only.
2. **Flip-testing convention (designer rule)**: every stage is also
   tested VERTICALLY FLIPPED in every balance corpus — mirrors are not
   separate scenarios (`flipStageVertical` in stage.mjs). The pre-game
   test setup must expose a board-flip toggle (queued in the setup-UI
   work item).
3. **Stage wave 2 — LOCKED** (designer-reviewed, molding v2.1 confirmed
   working as intended): s13–s22, the broken-deployment-ground set —
   gatehouse stubs, buried flanks, colonnade pillars in the pawn ranks, a
   cave-mouth back rank, rubble at the deployment lines, split pockets, a
   diagonal scar, the anvil, a collapsed keep at 10×10, a minimal
   sinkhole.
4. **Stage wave 3 — LOCKED**: s23–s33, the coverage-gap set —
   room-corridor-room neck, pillar lattice, two-front divide,
   wide-shallow 10×6, cornered-royal posterngates, the walled pawn rank
   (deep pawn starts under the universal double-step), the one-door
   fortress redoubt, serpentine weave, L-shaped playfield,
   3-wide-with-walls, and the 5×5 minimum square.

**ALL 33 STAGES LOCKED (s01–s33)** — the proving-grounds stage set is
complete and designer-stamped. Canon updated: brief §4.2 rewritten
(unit-bag armies, W 3–8, molding invariants, clip rule superseded),
§4.4 gains the universal double-step rule and the gap re-investigation
note, both `[REVISED 2026-08]`.

## What ships in the first PR vs what comes next

This branch delivers: the meter-lab evidence pass (Phase 1.3 trigger
finding + 9 vetted variants + replay-verified corpora), the proving
grounds (armygen + molding v2.1, stage schema v2, 33 locked stages,
gallery pipeline), spike 13 + the universal double-step baseline, the
60-variant catalog, and the canon edits. The shipped game (play/index.html)
is UNCHANGED in behavior except the variant baseline: it still plays the
four legacy arenas through the old placement screen.

Next branch (in work-plan order): the setup-UI rework — generator panel
(per-side knobs, seeds, live edge readout, board-flip toggle), retiring
the legacy arenas + placement screen + enemyEdit cheat — then the phone
perf benchmark at 10×10, then the meter-lab rerun over the locked 33 ×
both orientations × generated matchups, which reopens Phase 1.3's rule
decision on representative data.

**STATUS 2026-08-21 — the setup-UI rework is BUILT** (this branch):
stage picker + generator panel (per-side width/points-or-pieces/
archetype/anchor, initiative, flip, crop steppers, master seed + 🎲,
live fit/gap/edge readout), deal preview on the board, Rematch/Re-deal,
new driver params, 10 s think cap; legacy arenas + placement screen +
enemyEdit + `js/arena.mjs` retired; `dealMatchup`/`cropStage` shipped
with bench + verifier coverage (`test-armygen.mjs` §10–11,
`verify-stages.mjs` replacing `verify-play-arenas.mjs`); browser
selftest extended (manifest, flip involution, deterministic deal,
crop-promotion rule, 3×5 extreme); meter-lab runner decoupled from the
retired arena loader (`--stage-file` only). The phone perf gate is
PARKED by designer decision (see setup-UI decisions). Remaining before
1.3 reopens: the corpus materializer (stages × orientations ×
`dealMatchup` → run.mjs stage-file, + mirror-canary arm and its
analyze.mjs drift metric) and the meter-lab rerun itself.

## Work plan

1. **Schema v2 + core modules**: arena JSON with ASCII maps; army
   generator (composition + budget draw); molding layout + feasibility
   lint. One shared module under `play/js/`, imported by the harness (no
   second copy — the crumbleFilter split is the cautionary tale).
2. **Stage set + gallery**: author ~12 stages spanning the full range
   (procedural-looking wall patterns); build the static gallery page;
   designer verification loop until the set is stamped.
3. **Setup UI rework**: replace the drag-placement screen with the
   generator panel (per-side knobs, seeds, reroll, live edge readout);
   retire baked arena armies and the enemyEdit cheat.
4. **Lints + selftest**: port `verify-play-arenas` to matchup-sampling
   over the new schema; keep `play/selftest.html` PASSing; phone perf
   benchmark at 10×10.
5. **Meter lab rerun**: corpus = (verified stages) × (generated matchup
   grid, player-favored) + a small mirror bias-canary arm; re-run the
   variant sweep; THEN the 1.3 rule decision and retune on data that
   finally matches the game.
