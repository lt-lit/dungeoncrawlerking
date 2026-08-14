# Dungeon Crawler King: Title Subject to Change — Prototype Design Brief

**Title:** *Dungeon Crawler King: Title Subject to Change* `[LOCKED]` — the subtitle is the joke and the joke is intentional. Do not "fix," placeholder-ify, or helpfully rename it.
**Status:** Prototype spec. Core systems are settled in principle; anything tagged `[PROVISIONAL]` or `[OPEN]` is expected to change with playtesting. Anything tagged `[LOCKED]` should not be changed without a design conversation first.
**Audience:** Claude Code. This document is the single source of truth for the prototype.

---

## 1. Concept

A dungeon crawler roguelike where the player is a **king (summoner)** exploring a turn-based tile dungeon. Enemy summoners (also kings) roam the map. When a duel triggers, a magical barrier conjures a chess arena out of the local dungeon geometry, both sides' armies materialize in formation, and the fight is a small-scale chess game — **mini-chess, not crazyhouse** — played against a full-strength engine. Checkmate (or king capture) ends it. Exploration and combat are one continuous system: where you stand, what terrain surrounds you, and who caught whom all project directly into the chess position.

---

## 2. Hard Constraints `[LOCKED]`

1. **The Prime Directive:** every duel state must be fully evaluable by Fairy-Stockfish. All duel mechanics must be expressible as **variant config (variants.ini options) + FEN**. If a mechanic can't be expressed in FSF's grammar, it does not go in the duel layer. (The exploration layer lives entirely outside FSF — that's fine and by design.) One sanctioned boundary case: **crumble events (§4.5)** are arena *regeneration*, not a duel mechanic — the harness rewrites the FEN between plies and play continues from the new position. Every state the engine ever sees is FSF-pure; only the transition is harness-owned, exactly like duel generation itself.
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
- **Overworld terrain inside the barrier carries into the duel as static wall squares (`*` in FEN).** This is the entire point of the dynamic-arena design: pillars, wall stubs, and room edges shape every fight. Walls and crumble holes (§4.5, §5.1) project identically.

### 4.2 Formations `[LOCKED]`

- Each side's formation is **2 ranks deep**: a back row (king + pieces) and a pawn row in front of it. Like chess.
- **Patch = N×2. Player: N ∈ [3, 5]; enemy floor is 2.** Width cap of 5 (5 pawns, king + up to 4 pieces). The width-3 minimum is PLAYER-side only — 2-wide "scrub" armies (king + one piece) are the standard early encounter, and the arena itself never drops below 3 files, so a narrow enemy just leaves open lanes. `[REVISED with the small-army/puzzle vision.]`
- **The pawn row is authorable and sparse** (0–N pawns; pawnless piece-scraps are legal). The §4.2 automatic full-width row is only the default. `[REVISED — Phase 1 arenas ship 0–3 pawns per side.]`
- **The player's opening kit is a 3×2 army — K+R+N + 3 pawns** `[PROVISIONAL in composition]` — and the army's bounding box GROWS through the run (3×2 → 4×2 → 5×2, 6 → 8 → 10 units), terminating at the patch cap (§8). Keep a major piece in the kit: rook mates work at any arena width; minors-only armies grind on wide boards.
- **Clip rule:** the patch is anchored to the king's projected overworld position (king can be anywhere in his back row — no centering requirement), shifted inward only if he'd clip a wall. Walls eat slots. What survives is what you fight with.
- Pawn row is **automatic, pawns only**, spanning the patch width. Pawn direction: toward the enemy along the duel axis (canonical orientation comes from the alignment axis).
- Formations spawn whole. **No hands/pockets by default** — all material starts on the board. Early-game deployment turns were judged a drag; materializing the whole army *is* the summoning.

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
  - `stalemateValue = loss` — a king with no legal moves loses, both sides: the floor gives way beneath him (§4.5).
  - `nMoveRule = 0` — no move-count draw clock.
  - `nFoldRule = 0` **+ `nFoldValue = loss`** — repetition never adjudicates a result. Repetition is handled *physically* by the crumble system (§4.5). `[RESOLVED by spike 10 — "A-prime":` `nFoldRule = 0` alone is insufficient (the engine privately draw-scores repetition lines in search); adding `nFoldValue = loss` disables that scoring path while rule 0 keeps adjudication dead. The spike's Plan B as written below is refuted — do not ship it (parity exploit: a losing engine chases repetitions as wins). Crumble still fires on the 3rd occurrence. Details: `phase0/results/spike10-repetition-scoring.md`.`]`
  - Insufficient-material and fortress states resolve via §4.5: arenas that can't produce a result stop existing.
- **Promotion region = enemy back rank** (per-color `promotionRegion`). March a pawn onto their home row and it transforms. Promotion piece targets `[OPEN]`.
- **Initiative:** whichever side's move *completes* the legal duel condition plays White. Ambusher moves first; a player who deliberately steps into alignment holds White.
- If a **player** move creates legal alignment with multiple roamers simultaneously, the player chooses their opponent.
- **capturesToHand:** believed variant-wide only (not per-color) — if so, it is **not** a general rule. At most a symmetric boss modifier ("the Necromancer"). `[PROVISIONAL, pending spike]`
- **Reserve slot** (single piece in hand, droppable on own back ranks) is a possible high-tier upgrade, not a core mechanic. `[OPEN]`
- **Gap math:** formations are 2 deep each → 4 ranks of formation; the trigger condition enforces **gap ∈ [2, 4]**. Gap 2 = ambush-sharp (the puzzle sweet spot), 3–4 = standard (4 = classic chess spacing). `[REVISED: gaps 5–6 produced 100+-ply grinds at every width in the Phase 0 smoke sweep — the ranged/rider band is cut; the catalog keeps 9/10-rank variants but arenas and the trigger may not use them.]`

### 4.5 The crumble system `[LOCKED in shape, PROVISIONAL in numbers]`

Late in a duel, the conjured arena begins to fail: squares collapse into pits and become wall squares (`*`). Crumbles are **orchestration-layer arena regeneration** — the harness rewrites the FEN between plies and play continues (see the Prime Directive carve-out, §2). The engine never anticipates a crumble; it replans perfectly after each one. That asymmetry is acceptable *because crumbles are late and rare* — if sweep games are routinely decided by crumbles, the tuning is wrong (§7).

Two triggers:

1. **Repetition crumble `[LOCKED]`.** The third occurrence of any position collapses the square the loop-closing piece just moved *from*. That square is empty by construction (the piece left it) and is never a king's current square — repetition crumbles can't kill pieces, no special-casing required. Position history resets after every crumble (new walls = new positions), so each loop costs exactly one square.
2. **Pacing crumble `[LOCKED in shape]`.** Past an onset ply P, a random square collapses every k plies (P, k `[PROVISIONAL]` — calibrate in §7). **Pure random, no telegraph.** Both kings' current squares are excluded; every other square is fair game, occupied squares included — a piece standing on a collapsing square is lost. (Player pieces lost this way are restored on a win like any other capture — §8.)

Rules of the pit:

- **A king's own square collapses only via the stalemate rule** (§4.4): run out of legal moves and the floor takes you. Pacing crumbles never target kings.
- **Legality filter:** every random candidate square is validated with ffish.js before it collapses. Re-roll any candidate that would expose the side-not-to-move's king (a duel must never be decided by a dice roll in one ply), that would instantly end the game by mate or stalemate, **or that would strip a side's LAST piece** (under in-grammar army extinction, §4.4, such a crumble ends the game outright). Crumbles pressure games; they don't end them.
- **En-passant rights are cleared on every crumble.** Stale ep squares against rewritten geometry are a bug factory.
- **Termination guarantee:** every repetition crumble permanently removes a square and the board is finite, so with no draw rules left (§4.4) every duel provably ends. No adjudication exists anywhere.

Notes:

- **FSF wall semantics already match pit fiction:** sliders are blocked (a rook can't roll across a pit), nothing may stand there, and leapers jump clean over. Cavalry leaps the pit for free.
- **Deliberate repetition is a siege tool.** A repetition needs both sides to recreate the position — which is exactly what a passive, fortressed engine does. A player who understands the rule can shuttle a piece to demolish a *chosen* square (the one they vacate), sealing an enemy king's escape or cracking fortress geometry. The engine can't plan this back: asymmetric knowledge, per the difficulty philosophy (§13). The fortress problem's real answer is player skill, not RNG.
- **Crumble-sight** — telegraphing upcoming collapse squares — is deliberately *not* a base rule. Pure randomness mildly favors the side that replans perfectly (the engine), so the sight upgrade buys back real value on the §8 shelf.
- **Holes persist after the duel** as overworld terrain (§5.1). Persistence policy vs map guarantees is open (§11).
- Crumble RNG is **seeded per duel** so harness sweeps replay exactly.

---

## 5. Exploration Layer

### 5.1 Basics

- Turn-based, tile grid. **The army IS the avatar** `[REVISED — the army-avatar pivot]`: the player moves their whole formation as ONE unit — a flexible blob that holds the customized marching pattern where the ground allows and deforms through narrow gaps and around holes. `[PROVISIONAL: 1 tile/turn, 8-directional — speed parity with hunters assumed but not settled]`
- **Enemy summoners' armies are likewise visible while roaming** — what they have is what you see (scouting = shopping, §8; level telegraphing is literal). The old "roamers are kings only" rule is repealed; armies still materialize into the §4.2 patch when the barrier drops (v1: both formations stamped auto-facing each other; facing/flanking consequences deferred — §11).
- Roamers are **finite per floor, no respawns** — kills the farming incentive, makes clearing a floor mean something.
- **Two terrain classes:** *walls* block movement and LOS; *holes* (crumble scars, §4.5) block movement but not LOS — you can see across a pit. Both project into duels identically as `*` wall squares, and the linter (§6) counts both when clipping patches.
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

---

## 7. Calibration Harness `[Phase 0–1 — this is design work, not tooling]`

The central unknown of the whole design is **material budget**. It is empirically answerable and nearly everything downstream (progression, enemy levels, rewards, the 3-vs-5 width floor) hangs off it. Do this early.

- Engine-vs-engine self-play sweeps over: material budgets & compositions, per-side patch widths (player 3–5, enemy 2–5) and pawn counts, gaps 2–4, terrain/wall densities, player-arrangement archetypes (balanced, queen-corner, rook-flanks, knight-core).
- Log result distributions and **game length in plies**. **Puzzle pacing target** `[REVISED from 20–40 plies]`: mates in roughly **10–20 plies at gap 2** under best play (native-config starter sweep: median 15), ≤ ~35 at gap 4, with the player ~2 blunders (≈ a 5–6 point material edge) from losing. **No mirror matches, ever** — the engine is superhuman; every encounter hands the player a decisive material edge, and difficulty tuning lives in that edge.
- **Sweep validity rule (hard-won):** calibration data counts only if the harness engine plays the EXACT shipped ruleset — two sweep generations were invalidated by an engine that couldn't see the bare-army win condition (`results/sweep-starter-findings.md`).
- Human-winnability estimation via weakened-FSF proxy opponent (calibration only — never in live play).
- MultiPV on enemy move selection for run-to-run variety (carryover idea; validate it doesn't tank strength unacceptably).
- Sweeps must simulate the crumble system (§4.5) — which requires the same mid-game position-surgery mechanism as live play (spike 11). Crumble RNG seeded per game for exact replays.
- **Crumble alarm metric:** fraction of games where a crumble flips the eval sign. Target ≈ 0 in balanced configs — if crumbles decide games, onset is too early or cadence too fast, and the design intent ("late and rare") is being violated. `[Status: at puzzle pacing under the native config, games end before onset — the native starter sweep fired ZERO crumbles in 90 games. Crumbles are now purely the anti-fortress failsafe.]`
- Outputs: the material-budget curve that defines the enemy **level** scale and player progression pacing; crumble onset/cadence numbers (P, k in §4.5).

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
- **Upgrade shelf:** **crumble-sight** (telegraphs upcoming collapse squares, §4.5) — the base game keeps crumbles unreadable, so the sight upgrade buys real value.
- Standard roguelike content — floors, exits, shops, shrines, chests, traps, bosses — is expected and **deferred** until the core loop is playable.

---

## 9. Phase 0 Spike List

**Status: all 12 spikes complete and verified — verdicts, configs, and the findings the design must absorb are in `phase0/PHASE0-RESULTS.md`.** The list below is preserved as originally written; where a spike's "expected answer" was wrong, the results doc wins (notably spike 10 — see §4.4). Spike 4's config was additionally superseded POST-Phase-0 by the native bare-army quartet (§4.4); spikes 04/10 and the selftests were re-validated in full under it.

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
- **Phase 1 — Duel vertical slice.** Hand-authored arena JSON → variant config + FEN → playable duel vs. engine on a phone. Placement UI, win/loss, promotion. No overworld. **✅ Done — `play/`; subsequently re-aligned to the puzzle vision (3×2 starter vs small armies, in-grammar win con, gap ≤ 4) with all arenas engine-verified.**
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
- Persistent-hole policy (§4.5/§6): cap per region, dungeon heals, or bless erosion as a diggable resource — deliberate moat-digging is an exploit or a strategy; choose on purpose.
- Crumble onset ply P and cadence k (post-sweep numbers).
- Reward economy sizing (post-sweep).
- Title collision / availability check before any public release (title itself is locked).

---

## 12. Non-Goals (v1)

- No NNUE. No engine handicapping. No duel mechanics outside FSF's grammar (auras, HP, hidden info, multi-move turns). Randomness touches a duel only through the crumble system (§4.5) — arena regeneration at the harness layer — never inside the move rules the engine reasons about.
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
