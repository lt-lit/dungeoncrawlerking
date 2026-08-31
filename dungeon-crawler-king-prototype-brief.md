# Dungeon Crawler King: Title Subject to Change — Prototype Design Brief

**Title:** *Dungeon Crawler King: Title Subject to Change* `[LOCKED]` — the subtitle is the joke and the joke is intentional. Do not "fix," placeholder-ify, or helpfully rename it.
**Status:** Prototype spec. Core systems are settled in principle; anything tagged `[PROVISIONAL]` or `[OPEN]` is expected to change with playtesting. Anything tagged `[LOCKED]` should not be changed without a design conversation first.
**Audience:** Claude Code. This document is the single source of truth for the prototype.

---

## 1. Concept

A dungeon crawler roguelike where the player is a **king (summoner)** exploring a turn-based tile dungeon. Enemy summoners (also kings) roam the map. When a duel triggers, a magical barrier conjures a chess arena out of the local dungeon geometry, both sides' armies materialize in formation, and the fight is a small-scale chess game — **mini-chess, not crazyhouse** — played against a full-strength engine. Checkmate, or stripping the enemy army to a bare king, ends it. Exploration and combat are one continuous system: where you stand, what terrain surrounds you, and who caught whom all project directly into the chess position.

And the arena is not neutral ground. **The gods watch, and they get bored.** A duel that grinds toward stalemate starts to shake: pieces slide, the floor opens, and the position the engine had solved is a different position now. This is the **Board State Director** (§4.5) — the design's answer to the fact that a perfect opponent plus a small board plus terrain produces a lot of dead games. It is not a difficulty knob and not a handicap; it is the dungeon refusing to let a fight be boring.

---

## 2. Hard Constraints `[LOCKED]`

1. **The Prime Directive:** every duel state must be fully evaluable by Fairy-Stockfish. All duel mechanics must be expressible as **variant config (variants.ini options) + FEN**. If a mechanic can't be expressed in FSF's grammar, it does not go in the duel layer. (The exploration layer lives entirely outside FSF — that's fine and by design.) One sanctioned boundary case: **Earthquakes — the Board State Director (§4.5)** — are arena *regeneration*, not a duel mechanic: the harness rewrites the FEN between plies (moving a piece, collapsing a square) and play continues from the new position. Every state the engine ever sees is FSF-pure; only the transition is harness-owned, exactly like duel generation itself.
2. **Full-strength engine, always.** No UCI_Elo weakening during live play. Difficulty comes from asymmetric material, position, and terrain — never from engine handicapping.
3. **Classical evaluation only.** This game is a pile of user-defined variants with per-duel board dimensions and wall squares; no NNUE net exists or will exist for them. FSF's handcrafted classical eval is the opponent — it's what FSF's reputation for master-level play on user-defined variants is built on. Do not rely on NNUE-specific behavior or restrictions anywhere.
4. **Tech stack:** vanilla JS, no build tools, static hosting on GitHub Pages, mobile-first UI. Fairy-Stockfish WASM (UCI engine) + ffish.js (rules/legality/FEN/SAN) run client-side. `coi-serviceworker` if threading is needed (standard static-hosting workaround — see §13 for provenance).

---

## 3. Architecture Overview

Two layers with a one-way pipeline between them:

```
EXPLORATION LAYER (pure JS, outside FSF)
  turn-based grid · LOS detection · hunt/pursuit state machine
        │
        ▼  duel trigger (patch-alignment condition met)
DUEL GENERATION
  barrier geometry from standing positions
  → terrain inside barrier becomes wall squares
  → patches stamped & clipped · player places back row
  → emit: variants.ini snippet + startFen
        │
        ▼
DUEL LAYER (FSF)
  ffish.js for legality/game-end · engine WASM for opponent moves
```

Each duel is a **generated variant**: a config block (board dims, regions, win conditions) plus a start FEN (pieces, walls). Nothing persists inside FSF between duels.

---

## 4. Duel Layer

### 4.1 Arena generation `[LOCKED in shape, PROVISIONAL in numbers]`

- The barrier is a rectangle along the **alignment axis** between the two kings, spawned from their **standing positions** (kings are never teleported/rearranged).
- Barrier walls sit at both kings' backs. Backs-to-the-wall is the default for every duel — it's what makes mating patterns work.
- **Width = local room width**, up to FSF's max files. Side barriers are only added when needed to fit FSF limits. Board caps: 12 files × 10 ranks (largeboard build).
- **Overworld terrain inside the barrier carries into the duel as static wall squares (`*` in FEN).** This is the entire point of the dynamic-arena design: pillars, wall stubs, and room edges shape every fight. Walls and Earthquake holes (§4.5, §5.1) project identically.

### 4.2 Formations `[REVISED 2026-08 — the proving-grounds refresh; was: fixed N×2 patches, width 3–5, walls-eat-slots]`

- An army is a **unit bag with a native W×2 shape**: a back row (one royal + W−1 non-pawns) and a pawn row of **exactly W pawns** — pawn count always equals non-pawn count. **W ∈ [3, 8]**, both sides (the old 2-wide enemy "scrub" floor and the width-5 cap are superseded).
- **Army size is INDEPENDENT of stage geometry** — the old board-width/patch-width coupling was a bug of assumption. The W×2 shape is only what the bag looks like on open ground; on real terrain the army **MOLDS**: a dense back-to-front, center-out fill that squishes through narrow ground and flows around walls (an 8×2 army in a 4-wide hall deploys 4 ranks deep). Exactly TWO invariants constrain the rearrangement:
  1. the royal sits in the army's **rearmost occupied row**;
  2. **pawns stay in front, per file** — within each file, every pawn is forward of every non-pawn. Mixed piece/pawn rows are legal and normal.
  Non-pawns favor back rows + center columns; pawns take the outer cells of mixed rows and center themselves on a sparse front row. Reference implementation: `play/js/armygen.mjs` (`layoutArmy`) — one pure seeded function shared by the setup tool, the calibration lab, and (later) the dungeon layer.
- **Pawn cover is a diagnostic, not a rule**: a piece counts as screened by an own pawn OR a wall forward of it in its file (walls block sliders — cover is cover). Unscreened files are reported, never forced.
- The old **clip rule ("walls eat slots") is superseded by molding**: the army reshapes around terrain instead of losing units. A deployment that cannot fit (gap floor violated, ground too broken) is REJECTED by the lint — what the dungeon does with an un-deployable duel is `[OPEN]` (§5).
- Compositions come from the **army generator**: explicit piece list or point-budget draw (±2 accuracy — the {3,5,9} value lattice has edge gaps), arrangement archetypes, one royal per side. Royal TYPE is a parameter (king variants are schema-ready; engine-side variant work deferred).
- **The player's opening kit is a 3×2 army — K+R+N + 3 pawns** `[PROVISIONAL in composition]` — and the army GROWS through the run (3×2 → … → 8×2), terminating at the width cap (§8). Keep a major piece in the kit: rook mates work at any arena width.
- Pawn direction: toward the enemy along the duel axis (canonical orientation from the alignment axis). Formations spawn whole. **No hands/pockets by default** — materializing the whole army *is* the summoning.
- **Kings anchor the arena `[NEW 2026-08-27 — designer ground rules]`.** Three rules, set together:
  1. **Stages are emergent, not authored.** The final game deals arenas out of dungeon terrain — nobody picks from a list — so every deployment guarantee must be enforced by the DEAL itself, never by stage-authoring lints (Phase 2's generator would silently outgrow them).
  2. **The player's king always starts on the first row, and the enemy king on the last.** Molding already puts each royal in its army's rearmost occupied row; if that row is not the extreme row, every row behind either king is **auto-cropped** out of the arena's playable area (crop-as-boundary-redraw — removed ranks simply stop existing, and any terrain in them, furniture included, goes with them). The floor is 5 ranks (gap 1 — a duel simply can't start any closer); a deal whose auto-crop would go below it is rejected like any other "doesn't fit".
  3. **The promotion zone is always the row the enemy king is starting on** — the far row of the playable area, per color — and it is guaranteed to hold a usable square because the enemy king is standing there. `[SUPERSEDES the 2026-08 "no stage or crop may produce a fully-walled extreme rank" authoring rule (the gap-dial session) — that rule policed the guarantee at the wrong layer and is retired: `loadStageV2`/`cropStage`/the verifier no longer reject extreme-rank terrain; the deal's auto-crop makes the guarantee true by construction.]`

### 4.3 Player placement at duel start `[SUPERSEDED by the army-avatar pivot — see §5.1]`

`[The per-duel placement screen is retired with Phase 2: the player customizes
a persistent MARCHING PATTERN (the Phase 1 placement UI relives as its
editor), and at duel start the pattern is stamped into the patch — v1 rule:
the army auto-faces the enemy; facing/flanking consequences are deferred
(§11). Pre-duel rearrangement returns as an in-game upgrade on the §8 shelf.
The Phase 1 slice keeps the placement screen until the overworld exists. The
original clauses below stand only for that interim and as design record.]`

- After the barrier drops, the player sees **everything** — real patch shape, walls carried in, the enemy's complete formation — then places their back-row pieces into the surviving slots.
- When collection size > available slots (clipped duels), placement includes **selection**: choose which pieces deploy.
- Placement consumes **no plies** and happens before White's first move regardless of initiative.
- QoL: last arrangement pre-filled as default (one tap to accept); auto-skip when there's no meaningful choice.
- Enemy arrangement is generated/authored and fixed — the player's responsive placement is a deliberate asymmetric advantage.

### 4.4 Duel rules `[LOCKED unless noted]`

- **Win/loss (both sides): checkmate, stalemate, or ARMY EXTINCTION — stripped to a bare king, the summoning fails.** Player loses → run over. All conditions live IN-GRAMMAR, so the engine plays for strips (scores them mate-1) and duels never degenerate into lone-king chases. `[RESOLVED post-Phase-1, superseding spike 4's config: the extinction quartet is `extinctionValue=loss`, `extinctionPieceTypes=*`, `extinctionPieceCount=1`, `extinctionPseudoRoyal=false` — total-count semantics. King capture as a separate rule is gone (the single extinction slot can watch kings or totals, not both); the king stays fully royal, and the game layer keeps one three-line backstop: a kingless board — unreachable outside position surgery — is an immediate loss. Config history, probes, and sweep data: `phase0/results/sweep-starter-findings.md`.]`
- **No draws, ever `[LOCKED]`.** Every duel ends in a win or a loss. The config closes every draw door FSF knows about:
  - `stalemateValue = loss` — a king with no legal moves loses, both sides: the floor gives way beneath him (§4.5). This is also the mechanism by which an Earthquake can end a duel, and the reason it is the *only* such mechanism.
  - `nMoveRule = 0` — no move-count draw clock.
  - `nFoldRule = 0` **+ `nFoldValue = loss`** — repetition never adjudicates a result, and is not punished by any other mechanic either (§4.5 repealed the repetition crumble). `[RESOLVED by spike 10 — "A-prime":` `nFoldRule = 0` alone is insufficient (the engine privately draw-scores repetition lines in search); adding `nFoldValue = loss` disables that scoring path while rule 0 keeps adjudication dead. The spike's Plan B as written below is refuted — do not ship it (parity exploit: a losing engine chases repetitions as wins; re-measured post-Phase-1 at cp −707 → "mate 3"). Details: `phase0/results/spike10-repetition-scoring.md`.`]`
  - Insufficient-material and fortress states resolve via §4.5: the Board State Director reopens what it can and closes the board when it cannot — arenas that can't produce a result stop existing.
  - **Cost of no repetition bound:** nothing caps how long a shuffle can persist, so iterative deepening can race to MAX_PLY in a fortress and hard-crash the WASM pthread. The duel layer needs a stall-recovery ladder (recycle instance, retry at reduced depth) and a depth cap; both ship in `play/`. Track the stall rate as a first-class metric (§7).
- **Promotion region = enemy back rank** (per-color `promotionRegion`) — under the king-anchor rules (§4.2) that is always the enemy king's starting row, so it always holds a usable square. March a pawn onto their home row and it transforms; furniture standing on that row is a legal capture-promotion square (§4.6). Promotion piece targets `[OPEN]`.
- **Pawn double-step: the CAMP LINE** `[REVISED 2026-08-21 — designer correction; spikes 13+14]`: every pawn gets the two-square push **at or behind its side's camp line — the rank holding the most of that side's dealt pawns, ties resolved toward the enemy**. Past the line, the leap is gone forever. (Spike 13's every-visit caveat is REPEALED — under it a pawn could double-step repeatedly from anywhere, and it had been recorded as "accepted" without that consequence ever being put to the designer, who rejected it on contact.) The line sits where the position LOOKS like the starting line — the pawn wall — chess's own row-based rule generalized: row equals first-move-only in chess only because nothing there moves pawns backward; Earthquakes can, and where the readings diverge the row wins, because a player can see a line and cannot see a pawn's move history. Implementation: each deal registers its own variant with `doubleStepRegion` = every rank from the home edge to the camp line (per-pawn move history cannot exist — quake surgery reloads bare FENs). Designer-accepted consequences: a pawn dealt AHEAD of the line (molding bumped it past the wall — ~10% of dealt pawns on the proving-grounds bed) is already advanced and never leaps; a moved pawn knocked back behind the line regains the jump ("back to camp, take the run-up again"); rear pawns behind the line can single-step then double once lanes open (a tied stack puts the line at its front wall, so the whole mass has access); all-scattered terrain ties resolve toward the enemy, keeping nearly every pawn leap-capable. Walls block both the jumped and landing squares; en passant works against any double-step. Verified in both libraries: `phase0/results/spike13-universal-doublestep.md`, `phase0/results/spike14-firstmove-doublestep.md`.
- **Initiative:** whichever side's move *completes* the legal duel condition plays White. Ambusher moves first; a player who deliberately steps into alignment holds White.
- If a **player** move creates legal alignment with multiple roamers simultaneously, the player chooses their opponent.
- **capturesToHand:** believed variant-wide only (not per-color) — if so, it is **not** a general rule. At most a symmetric boss modifier ("the Necromancer"). `[PROVISIONAL, pending spike]`
- **Reserve slot** (single piece in hand, droppable on own back ranks) is a possible high-tier upgrade, not a core mechanic. `[OPEN]`
- **Gap math:** the trigger condition enforces **gap ∈ [2, 4]**. Gap 2 = ambush-sharp (the puzzle sweet spot), 3–4 = standard (4 = classic chess spacing). `[REVISED: gaps 5–6 produced 100+-ply grinds at every width in the Phase 0 smoke sweep — the ranged/rider band is cut; the catalog keeps 9/10-rank variants but arenas and the trigger may not use them.]` `[UNDER RE-INVESTIGATION 2026-08: molded armies are no longer fixed 2-deep, so gap and formation depth decouple; the proving-grounds lab tests gaps 1–6 and whether the ideal gap scales with army size — designer expects a practical trigger band of 2–5. The lint floor for a legal deal is gap ≥ 1.]`

### 4.5 The Board State Director — Earthquakes `[v3 — THE LADDER, designer 2026-08-31; PROVISIONAL in numbers]`

**v3 gutted v2's decision layer.** The lock on §4.5's shape was lifted by the
design conversation the phase plan required; what follows is its outcome. v2
triggered on a ply ramp — blind to the board — and the meter-lab pass measured
the cost: 23.3% of quakes wrecked a mate or flipped the eval (3.27 per game)
and 11.1% fired while a king was in check, so the mechanic built to shorten
duels was lengthening them by dissolving the mates that would have ended them.

Three things changed, and nothing else:

1. **The trigger is two meters, not a ply count.** *Restlessness* reads the
   game record ("nothing has happened lately"); *staleness* reads the position
   ("nothing CAN happen here" — the fun score) and sets how fast restlessness
   fills. Neither consults the engine: eval answers *who is winning*, which is
   the one question the gods must never act on, and a movetime-bounded search
   in the trigger would destroy seeded replay. The old ply ramp survives only
   as a late backstop floor. **The gods never stir while a king is in check.**
2. **A severity ladder, not one move.** Restlessness buys escalation, and the
   cheap rungs are the safe ones — **weaken** (`*` → `^`, a wall cracks; opens
   no line, only adds a capture option to both sides, so it is safe by
   construction rather than by filter, and it telegraphs the breach to come),
   **breach** (`^` → floor, the line opens for real), **displace** (v2's
   quake, rules unchanged), **crumble** (a permanent HOLE — demoted from a
   mid-game event to the closer). Most god activity now lands where it cannot
   wreck a game. Terrain edits also solve three measured v2 problems at once:
   they unlock terrain-locked pawns directly (v2's crumbles never could —
   0/7073), they cannot hand out material (the whole arena03 free-rook class),
   and they are genuinely side-neutral, so they need no pairing rule.
3. **Targeting is structural, never evaluative.** The rung comes from the
   meter; the target is a seeded weighted pick over an impact score (how much
   would this unstick?). A structural criterion never references a side, so
   "reads as random" and "never picks a winner" hold by construction.

**Holes are not walls.** `*` now means two things and FSF cannot tell them
apart, so the Director does: a hole is a square a crumble created, and it is
permanent — never weakened, never reopened. That is what keeps termination
provable now that free squares are no longer monotone (see "Walls are forever"
below, amended). Hole-ness is Director state, not FEN state — an authored wall
that was weakened, breached, occupied and then crumbled reads as `*` on a
square the stage authored as `*`.

The dungeon has opinions. As a duel runs long, **THE GODS** stir the arena: the screen shakes, a few pieces scoot to neighbouring squares, and sometimes the floor gives way and a square becomes a pit (`*`). Collectively these events are **Earthquakes**, and the system that chooses them is the **Board State Director**.

The Director is **orchestration-layer arena regeneration** — the harness rewrites the FEN between plies and play continues (the Prime Directive carve-out, §2). Every state the engine sees is FSF-pure; only the transition is ours. The engine never anticipates an Earthquake and replans perfectly after each one.

**Its job is not pacing. Its job is to make the board more fun.** A duel that has gone inert — blockaded pawns, a fortress, nothing either side can profitably do — is the failure the Director exists to prevent. It reaches for the smallest intervention that reopens the position, and only escalates to destruction when nothing else is left.

`[SUPERSEDES the two-trigger crumble system (repetition crumble + pacing crumble), which shipped through Phase 1. Rationale and measurements throughout this section come from the 2026-08 walled-arena prototype sweeps; the shipped implementation is `play/js/director.mjs`.]`

**Repetition is not punished. At all. `[REVISED — repeals the repetition crumble]`** Shuffle as much as you like. Two independent findings killed it:

- The old rule let a player shuttle a piece to demolish a *chosen* square for free, and — because repetition crumbles bypassed the legality filter — a player could dig away an enemy king's last flight square and win on the spot. The engine can never understand or counter this, and no engine-vs-engine sweep can surface it.
- The obvious fix (make repetition cost the repeating piece) cannot be made visible to the engine. `nFoldRule = 3` turns repetition into a **win** the losing side chases: measured, a dead-lost engine went from an honest cp −707 to claiming *mate 3* and playing for it. `moveRepetitionIllegal` is a no-op in these builds. And piece-centric repetition at threshold 3 would have fired in **46% of games** (69 firings across 90, 30 of them kings) — a core mechanic, not a failsafe.

#### The two moves the Director can make

1. **Displacement `[LOCKED in shape]`** — a piece slides to an adjacent empty square. This is the Director's primary tool and the *only* mechanic that can reopen a locked position. Measured: a crumble frees a terrain-locked pawn **0 times in 7,073** instances (it cannot — the block *is* a wall and a crumble only adds walls); displacing that pawn works 12.7% of the time. Mean effect on total legal moves: displacement **+0.08**, crumble **−1.55**.
   - **Symmetric-preferred `[LOCKED in shape, definition REVISED]`.** Each quake tries to move one piece **per side**. If the arena has to break a deadlock it must break it evenly — one-sided stirs hand whole games away (measured: the median one-sided eval flip was a *mate-score transition*). If only one side has a candidate, the Director waits; its patience runs out on its own ramp as the duel drags, after which it will settle for one-sided.
     - **One piece per side is not symmetry.** `[REVISED — Phase 1.1]` As shipped, "symmetric" meant symmetric in **count**; every filter in the displacement path was a *king*-safety filter (no check given, no side left in check, no zero-legal-move result) and ordinary piece safety was never considered. Observed in play on arena03: the gods stepped the enemy rook a7→b7, straight into a white rook already bearing down the open b-file, with White to move — a free rook, delivered by a quake the system called symmetric. Displacement landing squares now go through a static exchange evaluation and no piece may land where the opponent wins material.
     - **Symmetry is a property of the composite board, not of each leg.** `[Phase 1.1]` Filtering legs independently is not enough, and the failure is common rather than exotic: leg 2 is enumerated on leg 1's board, so leg 1's effect on leg 2 is covered, but nothing checked leg 2's effect on leg 1. On the very same arena03 position, the pair (r a7→a6, R b5→a5) parks the white rook on a5 attacking the black rook it had just relocated to a6 — the identical gift, reached through the other ordering. The second leg is now filtered against the first leg's landing square.
     - Still open (Phase 1.3): discovered attacks from the vacated square, *rescuing* an already-hanging piece (also a gift), pinned pieces counted as defenders, and whether crumbles — which pick uniformly among candidates and so are as likely to swallow a queen as an empty square — need a value guard of their own.
   - **Tiered selection.** Frees a terrain-locked pawn → unsticks a piece with no legal moves → cosmetic. The cosmetic tier is not filler: if pieces only ever scooted when something was stuck, an attentive player would learn to read it. Cosmetic stirs are camouflage.
   - **Kings are never displaced.** They anchor all mate geometry, and "the earthquake moved my king into check" is the worst outcome in the design.
2. **Crumble `[LOCKED in shape]`** — a square collapses into a pit, taking any occupant with it. Rare in the midgame, rising to certain late. Crumbles are **the clock**: they are the only monotonic force in the system and the whole termination guarantee rests on them.

#### Timing

**A rising hazard, never a fixed cadence `[REVISED]`.** Each ply past an onset, `P(quake)` ramps from ~0 toward 1; within a quake, `P(crumble)` rides its own, much slower ramp. No onset cliff, nothing to count, and — load-bearing — **no parity bias.** A fixed cadence fires on plies of one parity, so the same colour is always the side to move when the arena acts. Under a system where a collapse can immobilize the mover, that made exactly one colour quake-mortal. Random intervals hit both sides evenly.

All Director RNG is **seeded per duel** so harness sweeps replay exactly.

#### Rules of the quake

- **Candidates are enumerated exhaustively, never sampled.** The old 60-random-rolls approach *starved* — 3 observed failures in a 32-game walled sweep, each leaving the board untouched in precisely the late, sparse position where termination depends on it. A full board sweep costs ~12 ms; randomness lives in choosing *within* a tier. Zero starvations across 80 prototype games since.
- **A quake never gives check, and never leaves a side in check.** Displacements that would do either are rejected outright. Quakes are quiet.
- **A quake never hands out material.** `[NEW — Phase 1.1]` A displacement is rejected if the moved piece would land where the opponent wins material by static exchange, and a paired second leg is rejected if it leaves the first leg's landing square unsafe. Even trades still pass — the gods forcing a trade is a far smaller sin than the gods handing over a rook — and the threshold is a named constant (`SAFE_LANDING_LOSS`) pending Phase 1.3. Cost is negligible: the check is pure array walks over the grid and runs *before* the ffish probes, so rejected candidates get cheaper, not dearer.
- **A crumble never strips a side's last piece.** Under in-grammar extinction (§4.4) that would end the duel by dice roll, and it would cheapen a win condition the player is supposed to earn.
- **Pawns never land on rank 1 or a promotion rank.** Undefined state; excluded.
- **A crumble cannot create an attack — proven, not assumed.** A wall blocks exactly what a piece blocks, so blocking is monotonically non-decreasing and the attacker set monotonically non-increasing. Verified exhaustively: **0 exposures and 0 created checks in 46,048 candidates.** The exposure filter exists for *displacements*, which genuinely can open lines.
- **En-passant rights are cleared on every quake.** Stale ep squares against rewritten geometry are a bug factory.

#### How a duel can end by Earthquake

**Only one way: the arena runs out of room.** When *every* remaining collapse would leave the side to move with no legal moves — i.e. no neutral candidate exists anywhere on the board — the Director takes one anyway and the floor claims them (termination `earthquake`; §4.4's stalemate-as-loss, wearing the arena's name). This is the arena finishing a duel that had already closed, not deciding one. A quake never ends a duel by stripping a last piece, and displacement can never end one at all.

**Termination guarantee `[LOCKED]`.** Free squares only ever decrease; a debt cap forces a crumble after a bounded run of displacement-only quakes; kings need free squares to move. The board therefore closes, and stalemate-as-loss ends it. No adjudication exists anywhere. (In practice this backstop has never been reached: **0 terminal crumbles across every prototype run.**)

#### Notes

- **FSF wall semantics already match pit fiction:** sliders are blocked (a rook can't roll across a pit), nothing may stand there, and leapers jump clean over. Cavalry leaps the pit for free.
- **Favor of the Gods `[OPEN]`** — a runtime multiplier on quake probability (`setFavor()` in the shipped module). 0 silences them, 1 is baseline, >1 angers them. In-game effects — items, shrines, shrine-desecration, taunting the dungeon — move it during a run. Theme and economy TBD; the hook is live.
- **Quake-sight** — telegraphing what the gods are about to do — is deliberately *not* a base rule, and remains an §8 upgrade.
- **The Director is tunable in-game** (Options → The Gods: Calm / Restless / Wrathful / Custom / Off). This is a playtest instrument first, but temperament-as-difficulty-axis is a live design option.
- **Holes persist after the duel** as overworld terrain (§5.1). Persistence policy vs map guarantees is open (§11).
- **Holes are forever** `[AMENDED v3 2026-08-31 — was "Walls are forever"]`. The old rule banned every terrain edit because it read the termination guarantee as "free squares only ever shrink". That over-claimed the premise: what actually carries the guarantee is that HOLES accumulate and never reverse. Breaching spends a finite supply — there are only ever W authored walls, each convertible once — so free squares can rise by at most W across a whole duel and then only fall, while holes grow without bound. The board still provably closes and the duel still ends via stalemate-as-loss (§4.4); it just closes later. So the exact bans now are: **nothing ever converts a HOLE back to a playable square, and nothing ever weakens one.** Walls may be cracked to `^` and crates may be smashed open, by the gods (§4.5's ladder) or by a player capturing one. Letting rubble refill a pit is still ruled out on purpose; do not re-invent it.

### 4.6 Furniture — capturable walls `[NEW 2026-08-25 — designer-approved; engine substrate is Phase 1.2.3]`

The second terrain glyph: **`^` — furniture** (crates, weak masonry, force fields; per-stage flavor). Neutral, immobile, owned by neither side, and **either side may capture it** by moving a piece onto it — an ordinary capture the engine generates, prices (SEE 0), and plays for and against at full strength. That engine-visibility is the point, and the price: stock FSF has no such object, so the vendored WASM pair carries the **dead-squares patch** (the design from FSF issue #609; authored fresh 2026-08-25 as `engine/patches/dead-squares.patch` — the KOTH-Stockfish PR #29 diff served as feasibility reference only and carries three known defects. Natively validated: one patch applies to both trees, ffish↔engine-grade perft agreement on `^` boards, and `^`-free boards **node-for-node identical** to the stock pair at fixed depth; evidence and recipe in `engine/README.md`).

**Terrain everywhere except the capture itself `[designer-final]`.** To molding, slot-eating (§4.2), the camp line (§4.4), crop (§4.2 — a row auto-cropped behind a king takes its furniture with it), and the Director, a `^` is a wall. (The old promotion-rank authoring rule is retired — §4.2's king-anchor rules replaced it, so furniture on the enemy king's row is simply a legal capture-promotion square. Connectivity is deliberately NOT on this list: armies can smash through furniture, so a furniture-only seal never disconnects a deal — it is legal and warn-flagged, below.) Play is the one difference, and its consequences are verified in the patched binaries:

- Sliders are blocked by furniture and open the line by taking it; leapers jump it like stone.
- A pawn captures it diagonally, never straight ahead — **furniture in front of a pawn locks that pawn exactly like stone** (it can never clear its own blocker). The locked-pawn metrics (§6, §7) must count `^` as blocking, split hard-locked (stone) vs soft-locked (furniture).
- A pawn capturing furniture diagonally into the promotion zone promotes. Legal, intended.
- Bare-army extinction (§4.4) never sees furniture — it is nobody's piece, in count or in type.
- **The gods treat `^` as stone** — never displaced, never a landing square, terrain in every census — until the Director rework sets the real policy (a crumble swallowing furniture is monotone and default-allowed; the rework decides). The restlessness meter must not give furniture-smashing full capture credit, or the player farms crates to keep the gods asleep — rework-owned (§11).
- **The gods create and destroy `^`** `[REPEALED v3 2026-08-31 — was "nothing creates a ^ mid-duel, ever"]`. The `[Phase 1.2.4 interim]` clause handed the real policy to the Director rework, and this is it: §4.5's ladder cracks a wall into furniture (weaken) and smashes furniture open (breach). Nothing ELSE creates one — not a player, not a promotion, not a capture — so furniture is still stage-authored plus god-authored, and it is still terrain to molding, crop, the camp line, and to displacement, which neither carries a crate nor lands on one.
- **Terrain is not a victim `[designer-final 2026-08-25]`.** Variant rules that reward or compel *capturing* mean enemy pieces, never furniture: `mustCapture` neither forces a crate capture nor is satisfied by one, and capture-gated promotion (`piecePromotionOnCapture`) gives no promotion credit for smashing a crate. No duel variant uses those rules — the engine patch implements the ruling engine-wide for coherence. To search, move ordering, and SAN, a crate capture is still an ordinary capture (this is what makes game-layer capture detection, §4.5's meters included, see crate-smashes — their *weight* is the rework's question, §11).

**Termination (§4.5) is untouched.** Furniture is an occupant, not a wall: the guarantee rests on crumbles converting playable squares to stone, and never rested on occupants. Stone is forever; furniture is mortal, and dies exactly once.

**Stages carry it as a second map character** — `^` in the ASCII map, matching the FEN glyph (`.` open, `#` stone, `^` furniture). The flip transform is character-agnostic; the verifier admits `^` and treats it as a wall, plus one warning: a stage where furniture alone seals the armies apart — a chamber you must smash into — is **legal**, flagged for the gallery eye, never rejected. And because `^` → `.` is a pure substitution, the same 33 stage files drive both §7 corpus arms: stone-only control and furniture arm, all 33 stages, no forked evidence.


---

## 5. Exploration Layer

### 5.1 Basics

- Turn-based, tile grid. **The army IS the avatar** `[REVISED — the army-avatar pivot]`: the player moves their whole formation as ONE unit — a flexible blob that holds the customized marching pattern where the ground allows and deforms through narrow gaps and around holes. `[PROVISIONAL: 1 tile/turn, 8-directional — speed parity with hunters assumed but not settled]`
- **Enemy summoners' armies are likewise visible while roaming** — what they have is what you see (scouting = shopping, §8; level telegraphing is literal). The old "roamers are kings only" rule is repealed; armies still materialize into the §4.2 patch when the barrier drops (v1: both formations stamped auto-facing each other; facing/flanking consequences deferred — §11).
- Roamers are **finite per floor, no respawns** — kills the farming incentive, makes clearing a floor mean something.
- **Two terrain classes:** *walls* block movement and LOS; *holes* (Earthquake scars, §4.5) block movement but not LOS — you can see across a pit. Both project into duels identically as `*` wall squares, and the linter (§6) counts both when clipping patches.
- Patrol behavior while roaming: `[OPEN — routes vs. random walk]`

### 5.2 Detection & pursuit state machine `[LOCKED]`

```
ROAM ──(line of sight to player)──► HUNT
HUNT: each enemy turn, move toward the nearest square that would
      complete a legal duel vs. the player's current position.
      Persistent — no give-up timer while LOS is held.
HUNT ──(LOS broken)──► move to player's last known position
      ├─ reacquire LOS on the way → HUNT
      └─ arrive, no player → ROAM
```

- Detection is **simple line of sight**, decoupled entirely from duel geometry. Walls and corners are the stealth system. `[OPEN: LOS range cap, what blocks LOS beyond walls]`
- The pursuer chases a *relationship* (a duel-legal square band), not the player's tile — so persistent pursuit converges even though equal-speed tag never catches anyone. Evasion buys time and choice of ground, not immunity.

### 5.3 Duel trigger condition `[LOCKED]`

A duel starts when, after any move, all of the following hold between a hunting summoner and the player:

1. Their prospective patches are **aligned along one axis** (band alignment — king anywhere in his back row; no strict colinearity).
2. Kings are **5–7 tiles apart** along that axis (guarantees gap ∈ [2, 4] — the ≥ 5 floor keeps duels legal, the ≤ 7 cap keeps them out of grind territory, §4.4).
3. Both endpoint patches are **placeable at ≥ 3 wide** after terrain clipping.
4. The resulting arena fits FSF limits (side barriers added only if required).

The same check runs in three places from one source of truth: the map-gen linter, the live duel-start check, and the threat-display UI.

- **Width 1–2 passages are non-duelable crawlspaces** — no room to raise an army. Author them scarce so they read as claustrophobic exceptions, not safe hallways. Width ≥ 3 is duelable with clipping: tight ground doesn't block fights, it **eats your formation**. Terrain-modulated material, one ruleset.

### 5.4 Threat display `[LOCKED in concept]`

While hunted, highlight the tiles where a duel could legally complete, shaded by **clip severity** (which formation slots would survive there). Into-the-Breach-style legibility: one glance says "if he catches me in this hall, I fight at 3-wide."

### 5.5 World state during duels

- **Frozen** during duels. `[PROVISIONAL — live-world variant (other roamers keep taking turns) flagged as a tension mechanic but it punishes deliberate play inside duels; revisit later]`

---

## 6. Map Generation & Validation

- **Per-tile linter:** stamp-check whether a ≥3-wide patch fits at each tile, per axis (pure local check — no line-run scans needed since colinearity was dropped).
- **Region-level guarantees:** every region contains duel-capable ground; hunters can path to duel-completing squares; no geometry permits infinite consequence-free camping; crawlspaces are scarce.
- **Encounter enumerability:** because the trigger is deterministic, every (roamer, spotting geometry) → arena instance is knowable at map-gen time. Generated maps can have sampled arenas validated (winnability + pacing) before acceptance. **v1 sidesteps this with hand-built maps.**
- **Runtime erosion:** persistent holes (§4.5) accumulate after map-gen, so a floor's duels can slowly erode the gen-time guarantees — enough scars could manufacture the safe hallways §5.3 forbids. The linter counts holes as walls and will *know*; what it's allowed to tolerate is an open policy question (§11).
- **Pawn promotion reachability `[NEW — unbuilt]`.** The linter checks that walls don't sever the two formations; it does **not** check that pawns can reach a promotion rank. They frequently can't: 5 of 18 pawns across the shipped Phase 1 arenas are push-blocked from move one, and at generated wall densities 0.15–0.3, **95.6% of positions carry at least one terrain-locked pawn** (mean 4.18). This is the single largest source of inert boards, and the Director can only paper over it — displacement frees such a pawn 12.7% of the time per attempt, so clearing a board's worth costs more Earthquakes than the design can afford (§7).
  - **This lint reduces the problem; it can never eliminate it.** Real duels take the terrain where the fight happens — there is no re-roll — and Earthquakes themselves create new locks (measured: 8.1% of crumbles do). Locked starts are a permanent feature of the game and **must stay in the test set**; the lint is for the generator's benefit, not the harness's.
  - Policy `[OPEN]`: require every pawn to have a clear push path (strictest — expect heavy re-rolls at density 0.3), at least one per side (guarantees each side a live promotion threat), or player-side only.

---

## 7. Calibration Harness `[Phase 0–1 — this is design work, not tooling]`

The central unknown of the whole design is **material budget**. It is empirically answerable and nearly everything downstream (progression, enemy levels, rewards, the 3-vs-5 width floor) hangs off it. Do this early.

- Engine-vs-engine self-play sweeps over: material budgets & compositions, per-side patch widths (player 3–5, enemy 2–5) and pawn counts, gaps 2–4, terrain/wall densities, player-arrangement archetypes (balanced, queen-corner, rook-flanks, knight-core).
- Log result distributions and **game length in plies**. **Puzzle pacing target** `[REVISED from 20–40 plies]`: mates in roughly **10–20 plies at gap 2** under best play (native-config starter sweep: median 15), ≤ ~35 at gap 4, with the player ~2 blunders (≈ a 5–6 point material edge) from losing. **No mirror matches, ever** — the engine is superhuman; every encounter hands the player a decisive material edge, and difficulty tuning lives in that edge.
- **Sweep validity rule (hard-won):** calibration data counts only if the harness engine plays the EXACT shipped ruleset — two sweep generations were invalidated by an engine that couldn't see the bare-army win condition (`results/sweep-starter-findings.md`).
- Human-winnability estimation via weakened-FSF proxy opponent (calibration only — never in live play).
- MultiPV on enemy move selection for run-to-run variety (carryover idea; validate it doesn't tank strength unacceptably).
- Sweeps must simulate the Board State Director (§4.5) — which requires the same mid-game position-surgery mechanism as live play (spike 11). Director RNG seeded per game for exact replays. **`harness/game.mjs` still runs the retired crumble system and must be ported to `director.mjs` before any Director numbers are trustworthy `[TODO]`.**
- **Alarm metric:** fraction of games where an Earthquake flips the eval sign. `[REVISED — the old ≈0 target was never actually met; it was an artifact.]` The wall-free native sweep reported 0 only because crumbles *never fired* (6 events in 90 games — games ended before onset). The moment arena regeneration actually engages in a walled arena, every configuration measured lands between **31% and 75%** of games — including the old crumble-only system at 44%, and the shipped Phase 1 pacing at 0.5–1.0.
  - The reason is structural, not tuning: **a locked position has no natural winner, so whatever breaks the lock decides it.** Flip rate tracks event volume almost perfectly, and the volume needed to reopen a board (tens of quakes per duel) is an order of magnitude above what a ≈0 target permits (~4). Symmetric displacement is the mitigation that works — it halves one-sided swings — but it does not abolish the trade.
  - **New target `[PROVISIONAL]`:** minimize flips *per unit of un-sticking achieved*, and treat the metric as a comparison between configs rather than an absolute bar. A metric that can distinguish "the dice picked a winner" from "the dungeon reopened a dead game and someone then won it" would be worth more than tightening the number, and does not yet exist `[OPEN]`.
- **Termination-by-Earthquake rate:** should be low but non-zero. Zero means the Director never mattered; high means it is deciding duels.
- **Engine stall rate** (searches that hang or crash the WASM pthread, per 100 engine plies) — first-class now that no repetition bound exists (§4.4). Baseline measured: ~2.5/100 on the pre-Director build at `depth 60`; the shipped `depth 22` cap took it to ~0.
- **Locked-pawn trajectory:** mean terrain-locked pawns per position, start vs end. The Director's actual job, measured directly.
- Outputs: the material-budget curve that defines the enemy **level** scale and player progression pacing; Director ramp numbers (onset, quake ramp, crumble ramp, debt cap — §4.5).

---

## 8. Progression & Content `[mostly OPEN]`

- **Collection:** the player accumulates pieces; back-row slots are filled from the collection at placement time.
- **No attrition `[LOCKED]`:** pieces captured during a duel — by the enemy or by a collapsing floor — are restored after a win. Duels are all-or-nothing: win and the army walks out whole; lose and the run is over. The only stake is everything.
- **Promotions do not persist `[LOCKED]`:** promoted pawns revert on restoration. Promotion is tactical, in-duel only — no queen farming in easy fights.
- **Enemy level = visible material budget — now literal:** the army roams in the open (§5.1), so the telegraph IS the army. Small enemies are defined by their single piece (knight-guy forks, bishop-guy wants diagonals, rook-guy harasses — the monster taxonomy comes free).
- **Army growth is the primary progression axis:** bounding box 3×2 → 4×2 → 5×2 (§4.2); piece quality within a width is the second axis. Pre-duel rearrangement (the retired §4.3 screen) joins the upgrade shelf.
- **Reward candidate:** a beaten summoner drops a piece from their own formation (you saw it fight; scouting = shopping). Sizing waits on the sweep.
- **Pawn-type upgrades:** the screen stays pawns-only, but *what your pawns are* is a build axis (Berolina, triple-step, etc. — repurposed from the prior project's gimmick pool, pending spikes).
- **Boss-modifier shelf:** symmetric capturesToHand ("Necromancer"), king with open space behind him ("Errant King" — the exception that proves the backs-to-walls default).
- **Upgrade shelf:** **quake-sight** (telegraphs what the gods are about to do, §4.5) — the base game keeps Earthquakes unreadable, so the sight upgrade buys real value. **Favor of the Gods** (§4.5) is the other axis: anything that raises or lowers quake frequency mid-run is a build decision, and a player who *wants* chaos is a legitimate build.
- **Reward tiering by termination `[NEW]`:** checkmate should pay more than an army-extinction strip — it is measurably the harder win (the engine scores a strip as mate-1 and takes it whenever it is shorter, so mates happen when the player engineers them). Stalemate tiers *with* checkmate: same constriction work, and thematically the same king-death. An `earthquake` termination pays the floor rate — you did not earn it. **Decay total reward with ply count**, so the mate bonus can't be farmed by stalling. `[The engine cannot be made to prefer mates: every result-shaped variants.ini option is ternary win/loss/draw, extinction resolves to the identical mate score, and a non-ternary value silently disables the rule. Reward tiering is a game-layer concern, permanently.]`
- Standard roguelike content — floors, exits, shops, shrines, chests, traps, bosses — is expected and **deferred** until the core loop is playable.

---

## 9. Phase 0 Spike List

**Status: all 12 spikes complete and verified — verdicts, configs, and the findings the design must absorb are in `phase0/PHASE0-RESULTS.md`.** The list below is preserved as originally written; where a spike's "expected answer" was wrong, the results doc wins (notably spike 10 — see §4.4). Spike 4's config was additionally superseded POST-Phase-0 by the native bare-army quartet (§4.4); spikes 04/10 and the selftests were re-validated in full under it. Spikes 11 and 12 remain load-bearing under the Board State Director — position surgery and the legality filter are exactly what Earthquakes are built from — but note that spike 12's filter is now called on an **exhaustive** enumeration rather than sampled re-rolls (§4.5), and its `reason` strings mislabel last-piece strips as `instant_checkmate`/`instant_stalemate` (harmless to the accept/reject verdict, load-bearing if you key tier logic off the reason — the Director pre-filters strips itself).

Cheap fairyground / ffish.js checks. All load-bearing — do these before building systems on top of them.

1. **Per-duel runtime variant loading.** Generate a variants.ini snippet + startFen per encounter and load it (ffish `loadVariantConfig` / engine option). Measure cost & correctness of doing this every fight.
2. **Static wall squares (`*`) in startFen** on custom variants, at various densities. Sanity-check classical eval behavior with heavy walls. (`*` walls in startFen are confirmed shipping-grade — crossderby in the reference variants.ini bakes them in with no wallingRule — so this spike is about *eval behavior* at density, not support.)
3. **Variable board dimensions per duel** (3–12 files × 6–10 ranks), including the small/clipped end. Confirm the shipped WASM artifact is the **largeboard** flavor (the pychess build is; 8×8-only builds float around).
4. **Dual loss condition: checkmate OR king capture** — find the cleanest config (check rules vs. extinction-style king capture) and verify the engine plays sanely under it. Expected answer: `extinctionValue = loss` + `extinctionPieceTypes = k` + `extinctionPseudoRoyal = true` — the pseudo-royal pattern shipped variants use; it keeps check/checkmate semantics while the king stays capturable.
5. **Per-color `promotionRegion` = enemy back rank** on generated boards.
6. **capturesToHand per-color?** Expected answer: no (variant-wide only). Confirm, then design the boss modifier as symmetric.
7. **Clipped/asymmetric formations:** off-center kings, unequal patch widths, non-mirrored positions — confirm nothing about eval or move-gen assumes symmetry.
8. **Mobile perf:** engine strength/latency at these board sizes on a phone; single-thread vs. threaded (coi-serviceworker).
9. **Reserve-slot drop** (tiny pocket + dropRegion = own back ranks) — verify now so the upgrade path stays open.
10. **In-search repetition scoring `[load-bearing — do first]`.** With `nFoldRule = 0`, confirm the engine does not *privately* score repetition lines as draws inside search (Stockfish-lineage cycle detection is separate from the rule). If that belief survives config, a losing engine will deliberately loop and farm crumbles — the exact failure §4.5 forbids. **Plan B if un-disableable:** set `nFoldValue = loss` so the engine believes looping loses, and fire the repetition crumble at the *second* occurrence — history resets before the in-engine rule can ever adjudicate a third.
11. **Mid-game position surgery.** Edit FEN between plies (add walls, remove a piece, clear ep), reload, and confirm the engine continues sanely from arbitrary rewritten positions. Core infrastructure: live crumbles and §7's crumble simulation both stand on it.
12. **Crumble legality filter.** Validate candidate collapse squares via ffish.js (§4.5): detect exposed-king and instant-end positions cheaply enough to re-roll in real time on a phone.

---

## 10. Build Phases

- **Phase 0 — Spikes + harness skeleton.** Everything in §9; harness able to run one sweep end-to-end. **✅ Done — `phase0/PHASE0-RESULTS.md`.**
- **Phase 1 — Duel vertical slice.** Hand-authored arena JSON → variant config + FEN → playable duel vs. engine on a phone. Placement UI, win/loss, promotion. No overworld. **✅ Done — `play/`; subsequently re-aligned to the puzzle vision (3×2 starter vs small armies, in-grammar win con, gap ≤ 4) with all arenas engine-verified, then re-based onto the Board State Director (§4.5) with in-game tuning knobs.**
- **Phase 1.1 — Quake legibility `[NEW, ✅ done]`.** Playtest finding: a quake fired before the enemy's turn was unreadable — the board rearranged and the engine replied inside one ~1 s breath, so the only way to learn what happened was the log. Root causes were structural, not just pacing: pieces teleported (no motion at all), the vacated and landing squares flashed with the *same* class so direction was unreadable, the 700 ms flash outlived the 450 ms window and the piece jumped mid-cue, and `lastMove` marks wiped every trace of the quake the moment the enemy replied. Fixed by sliding pieces as FLIP clones on an fx overlay (engine replies too), splitting the quake into rumble → motion → settle beats, and holding directional quake marks on the board until the player moves. Shipped alongside the landing-safety stopgap below.
- **Phase 1.2 — The Gods debug overlay `[NEW, ✅ done]`.** Tuning instrument, built before the rules it measures change. Live ramp dials; a per-ply roll trace with reason codes (crucially including the fall-through path — an unpairable displacement drops into the crumble leg, so crumbles land more often than `P(crumble|quake)` implies); candidate census (A/B/C per side, neutral/terminal crumbles, locked pawns); a board heat overlay of what the gods are considering; a forecast of next-quake/first-crumble/closure plies; and an engine eval delta across each quake — the ground-truth measure of "did the arena change who's winning." Constraint: the three rolls share one seeded stream and the draw pattern is state-dependent, so the overlay must expose RNG-free probability getters and record rolls via instrumentation *inside* `quake()` — never by re-rolling to preview. **Shipped:** trace recording lives inside `quake()` (unconditional; draw-for-draw identity to the untraced Director was verified by a dev-time A/B harness over 12 seeds × 2 fixtures, and `play/selftest.html` permanently asserts that a seeded quake sequence replays identically with the overlay exercised between rolls); the enumerators return their rejections with reasons (`unsafe_landing` per side = 1.3's starvation-risk metric, `last_piece`, `exposes_king`, …); the census is free on quake plies (reusing the quake's own enumerations) and an explicit button press otherwise (a quake-scale enumeration is 300–720 ms — never per-ply); the forecast is deliberately the NOMINAL model, so forecast-vs-trace measures the fall-through effect; eval deltas run as their own recovered probe path in the player's idle window (white-POV, sign flip = the §7 alarm, mate scores kept explicit); dials and favor apply live under the overlay and land on the duel ledger (`record.tunes`), exportable as one JSON. See `play/README.md` § "The Gods debug overlay".
- **Phase 1.2.3 — The Forge `[NEW — furniture (§4.6), part 1: the engine pair]`.** Rebuild the vendored WASM pair from patched source — the one deliberate exception to "never patch the engine," governed by CLAUDE.md rules 15–17 (the matched-pair build, the equivalence gate, the patch bar). Scope, part one **✅ done 2026-08-25**: the patch is AUTHORED fresh against the pinned trees (`engine/patches/dead-squares.patch` — 73+/22− across four files; the internet reference diff was audited hunk-by-hunk and demoted to reference-only after a THIRD defect surfaced: undoing a promotion-capture of a crate corrupts occupancy, a bug the spike's fixtures could not see; the two known movegen defects vanish by construction in the authored design). The terrain-is-not-a-victim ruling (§4.6) is implemented engine-wide. Natively validated end-to-end: `^`-free boards node-for-node identical to stock at fixed depth 12, crate perft cross-checked against the independent reference implementation, promo mirror-pair exact, mustCapture semantics as ruled — full table in `engine/README.md`. Part two **✅ 2026-08-26 — built and VENDORED**: both artifacts built from the one patch (emsdk 1.39.16 / 2.0.26) and the rule-16 gate ran green end to end — `^`-free perft AND fixed-depth search-transcript identity vs the shipped 1.1.11/0.7.9 pair for BOTH binaries (`regress.cjs`, `regress-ffish.cjs`, `search-identity.cjs` — node-exact), ffish↔engine agreement on all crate fixtures (`xcheck.cjs`, promo mirror pair included), `play/selftest.html` 29/29 in headless Chromium with SharedArrayBuffer live (incl. a new §4.6 furniture block on a catalog variant), the rule-11 depth-cap re-measure (d22 110/110 clean, cap unchanged), and a spike10 rerun (32/32). **Phone feel check ✅ passed 2026-08-26** (duel feel unchanged, selftest green on device) — **the phase is COMPLETE**; the crates-dense live-duel feel reading arrives with 1.2.4's stage support and belongs to its exit criterion. Upstreaming is NOT planned `[designer 2026-08-25]` — the patch stays upstream-shaped in case that changes, and the walled-passer eval fix stays unshipped, documented in `engine/README.md`. No stage, JS, or rules change beyond the substrate.
- **Phase 1.2.4 — Set Dressing `[furniture (§4.6), part 2 — ✅ COMPLETE 2026-08-27]`.** The game learns the glyph; the designer gets it on the phone. Retire the hard-coded `'*'` equality tests for a shared terrain helper (`fen.mjs`: `WALL`/`FURNITURE`/`isTerrain` — the full audit found 65 sites across 24 files; both known landmines confirmed, plus: the gods could enumerate furniture as a displaceable piece AND as a white-owned crumble victim, the board renderer painted `^` as a white piece, and the deal/preview emitters silently DROPPED `^` from composed FENs); the Director's interim rule (§4.6: furniture is stone to the gods — never displaced, never a crumble candidate, silent in every census; NO new rejection reason codes, so the 1.2→1.3 census schema stays comparable); a board sprite (furniture renders as a piece-like neutral glyph — third color class — so the capture-dissolve animation covers crate smashes unchanged, over a subtle raised cell tint so it still reads as terrain); the **king-anchored auto-crop** (§4.2 ground rules 2026-08-27, replacing the retired extreme-rank authoring ban) inside `dealMatchup`; `^` admitted to the stage map + verifier (wall-equivalent to molding/crop; connectivity treats furniture as PASSABLE — armies can smash through — with furniture-only army separation legal + warn-flagged per §4.6); and a **REPLACEMENT stage set** — the designer retired the original 33 (2026-08-27: "not attached — I intend to replace them all"); shipped as two gallery-reviewed waves, both designer-locked 2026-08-27: **wave 4** (s01–s33, the furniture bed) and **wave 5** (s34–s58, rooms & breaches — sectioned maps, crate clusters, furniture integrated into wall structures, breakable double doors, and the s51+ multi-room FLOORPLANS: hallways, doors to and between rooms, per-room furniture; 10-wide confirmed comfortable on-phone). **Exit ✅ PASSED 2026-08-27**: crate duels live on-device with Earthquakes on at 10 s/move — designer verdict: "surprisingly really fun."
- **Phase 1.2.5 — The Proving Grounds `[NEW — the calibration test bed; partly shipped]`.** Everything the §7 sweeps need before their numbers can be trusted, split out of 1.3 because the first meter-lab pass proved the old bed was not representative: four hand-authored arenas (3–5 files, 0–2 walls) with baked armies, so every measurement inherited a wrong distribution. The whole phase is **the automated-playtest rig and the data it runs on** — no duel rules change here. **✅ Shipped (PRs #10, #11):** the data bed — 33 designer-locked stages (`play/stages/`) × the army generator (`play/js/armygen.mjs`: unit bags W 3–8, molding v2.1, independent of stage geometry), stage schema v2 with the flip and crop transforms, `armygen.dealMatchup()` as the ONE composed deal entry point shared by game/verifier/lab, the static verifier (`phase0/harness/verify-stages.mjs`), and the setup screen that drives it by hand (stage picker → live army preview, one master seed, initiative/flip/crop). Two rules corrections fell out of building it and are canon: the camp-line double-step (§4.4) and crop-as-boundary-redraw (§4.2) — whose promotion-rank corollary ("no fully-walled extreme rank") was superseded 2026-08-27 by the king-anchor ground rules (§4.2). Note the 33-stage bed itself was retired by the designer in 1.2.4 and replaced with a furniture-bearing set; the corpus machinery below runs on whatever the locked set is. **⬜ Remaining — the lab rig:** (a) a **corpus materializer** — the converter that turns the locked stage bed (58 stages since 1.2.4) × both orientations × both terrain arms (§4.6: stone-only via `^`→`.`, furniture as authored) × generated matchups into the stage-file sets `harness/meterlab/run.mjs` consumes (§7 player-favored edge, plus a full-strength mirror arm); (b) the **mirror-canary drift metric** in `harness/meterlab/analyze.mjs` (colour-winrate drift with material equalized = a clean Director-bias signal); (c) the **meter-lab rerun** on the new bed; (d) two rig defects found in 1.2.4's pre-merge review, to fix before the rerun — corpus lines must record `variantName`/`variantIni` (run.mjs plays deal variants but omits them from its output, so `replay.mjs` reconstructs the catalog baseline and deal-variant corpora cannot replay byte-exact), and run.mjs's MultiPV human-seat path lacks the fresh-engine retry (an engine death mid-corpus crashes the arm). Designer input needed at the START of the rerun, before compute is burned: which arms run (baseline + meter v0 + which of the nine one-knob variants + the §4.6 furniture arm), seeds/matchups per stage-orientation, and whether the favored seat stays the depth-2 proxy or moves to the human-shaped MultiPV model — switching mid-corpus forks the evidence. **Phase ends when the evidence is on the table; the rule decision is 1.3's.**
- **Phase 1.3 — Redefine "symmetric" `[NEW, blocked on 1.2.5]`.** **Scope note (meter-lab first pass, `phase0/results/meterlab-findings.md`):** the completed evidence pass found the *trigger* was the wrong half — `pQuake` is a function of ply alone, and a state-aware "restlessness meter" cut per-game god-inflicted harm ~55% with the filter stack untouched. So this phase may widen from "redefine symmetric" to **replace the decision layer** (meter trigger + effect rules + possibly dropping the pairing rule). §4.5 is `[LOCKED in shape]`, so that widening needs a design conversation before any commit rewrites it. The original scope follows. Promote the Phase 1.1 stopgap to the full rule: a quake may create no new winning capture for **either** side, judged on the composite post-quake position. Closes what landing safety alone still misses — discovered attacks from the vacated square, rescues of already-hanging pieces, pinned "defenders" — and settles whether SEE alone suffices or the engine eval delta has to become a gate (SEE is blind to mate-net changes, which the prototype sweeps measured as the dominant flip mode). Expect the crumble rate to move: a stricter displacement filter pushes more quakes down the fall-through path. Retune the presets after. The 1.2.5 evidence now includes the furniture arm (§4.6), so the rule is decided once, on the full board vocabulary — "no new winning capture" and the SEE-sufficiency question must price `^`-captures too.
- **Phase 1.5 — Director calibration `[NEW, blocked on 1.3]`.** Port `harness/game.mjs` from the retired crumble system to `director.mjs` so §7 sweeps measure the shipped rules; add the promotion-reachability lint (§6); playtest the temperament presets and settle the ramp numbers. The Director is committed as canon on the strength of prototype sweeps and hands-on play — the numbers are not settled and are expected to move. Gated behind 1.3: calibrating ramps against a displacement filter that is about to change would burn the sweeps twice.
- **Phase 2 — Exploration slice.** One hand-built map, two summoners with different levels. Army-as-avatar movement (blob + marching pattern, visible enemy armies), LOS/hunt/pursuit state machine, threat display, trigger → barrier → FEN pipeline proven end to end.
- **Phase 3 — The loop.** Rewards, collection, level scaling from sweep data, floor transitions. First full runs.

---

## 11. Open Questions

- Player overworld movement rules; speed parity with hunters; blob deformation/reformation rules (how the marching pattern squeezes through crawlspaces and reforms).
- Facing & flanking: v1 auto-faces both armies at duel start; how rear/side ambushes should degrade the stamped formation is deferred, as is the marching-pattern edit-lock rule (proposal on record: editing locks while any enemy holds LOS/HUNT on you).
- LOS range cap and occlusion rules.
- Duel escape valve: none for now (to the death, both sides) — revisit if runs feel too brutal.
- Promotion piece targets (fixed? collection-based?).
- Progression axes final shape (slot unlocks vs. pawn types vs. reserve slot vs. …).
- Multi-hunter dynamics beyond the initiative rule (aggro sharing, converging patrols).
- Frozen vs. live world during duels.
- Persistent-hole policy (§4.5/§6): cap per region, dungeon heals, or bless erosion as a diggable resource. `[Note: the player can no longer aim holes — the repetition crumble that allowed deliberate moat-digging is repealed. This is now purely a map-integrity question, not an exploit question.]`
- Director ramp numbers — onset, quake ramp, crumble ramp, debt cap, one-sided patience (§4.5), post-sweep, and only after `harness/game.mjs` runs the Director.
- Favor of the Gods (§4.5): what moves it, how far, and whether temperament is a difficulty axis, a build axis, or both.
- Furniture × the Director rework (§4.6): the gods' real crate policy (interim canon: `^` is stone to them; crumble-swallow default-allowed) and the restlessness meter's weight for furniture smashes — full capture credit would let the player farm crates to keep the gods asleep.
- Pawn promotion-reachability lint policy (§6).
- An alarm metric that separates "the arena picked the winner" from "the arena reopened a dead game" (§7).
- Reward economy sizing (post-sweep), including the checkmate/strip tier ratio and the speed-decay curve (§8).
- Title collision / availability check before any public release (title itself is locked).

---

## 12. Non-Goals (v1)

- No NNUE. No engine handicapping. No duel mechanics outside FSF's grammar (auras, HP, hidden info, multi-move turns) — "FSF" meaning the vendored pair, patches included: the grammar widens only through the rule-17 patch bar, as furniture (§4.6) did. Randomness touches a duel only through the Board State Director (§4.5) — arena regeneration at the harness layer — never inside the move rules the engine reasons about. (The `depth 22` search cap is a WASM-stability measure, not handicapping: the engine was reaching depth 22–23 in live play regardless, and deeper searches crash the pthread.)
- No hands/pockets as a core economy (upgrade path only).
- No procedural map gen in v1 (hand-built maps; linter still applies).
- No meta-progression between runs, no art/sound polish, no desktop-first layout.

---

## 13. Prior-Project Carryovers

Decisions inherited from the earlier chess-roguelike design work, still in force. That project barely left the ground — these are design conclusions, not working code. Nothing below is proven *by us*; the stack's proof is public precedent, and our own integration is unvalidated until the Phase 0 spikes pass.

- FSF WASM + ffish.js client-side on GitHub Pages, proven in the wild by pychess and fairyground. Fairyground is effectively a reference implementation of runtime variant loading against FSF WASM — crib from it. `coi-serviceworker` for threading only if spike 8 demands it; nothing exists to inherit, it would be set up fresh.
- Prefer FSF's **predefined piece types** over custom Betza definitions — they come with pre-tuned evaluation values.
- Asymmetric-advantage difficulty philosophy (the player gets structural edges; the engine plays perfectly).
- **Kaneo piece set** (Kadagaden/chess-pieces, CC-BY-4.0) as the working asset source; Alfaerie / Wikimedia Commons as gap-fillers.
