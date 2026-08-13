# Dungeon Crawler King: Title Subject to Change — Prototype Design Brief

**Title:** *Dungeon Crawler King: Title Subject to Change* `[LOCKED]` — the subtitle is the joke and the joke is intentional. Do not "fix," placeholder-ify, or helpfully rename it.
**Status:** Prototype spec. Core systems are settled in principle; anything tagged `[PROVISIONAL]` or `[OPEN]` is expected to change with playtesting. Anything tagged `[LOCKED]` should not be changed without a design conversation first.
**Audience:** Claude Code. This document is the single source of truth for the prototype.

---

## 1. Concept

A dungeon crawler roguelike where the player is a **king (summoner)** exploring a turn-based tile dungeon. Enemy summoners (also kings) roam the map. When a duel triggers, a magical barrier conjures a chess arena out of the local dungeon geometry, both sides' armies materialize in formation, and the fight is a small-scale chess game — **mini-chess, not crazyhouse** — played against a full-strength engine. Checkmate (or king capture) ends it. Exploration and combat are one continuous system: where you stand, what terrain surrounds you, and who caught whom all project directly into the chess position.

---

## 2. Hard Constraints `[LOCKED]`

1. **The Prime Directive:** every duel state must be fully evaluable by Fairy-Stockfish. All duel mechanics must be expressible as **variant config (variants.ini options) + FEN**. If a mechanic can't be expressed in FSF's grammar, it does not go in the duel layer. (The exploration layer lives entirely outside FSF — that's fine and by design.)
2. **Full-strength engine, always.** No UCI_Elo weakening during live play. Difficulty comes from asymmetric material, position, and terrain — never from engine handicapping.
3. **Classical evaluation only.** This game is a pile of user-defined variants with per-duel board dimensions and wall squares; no NNUE net exists or will exist for them. FSF's handcrafted classical eval is the opponent — it's what FSF's reputation for master-level play on user-defined variants is built on. Do not rely on NNUE-specific behavior or restrictions anywhere.
4. **Tech stack:** vanilla JS, no build tools, static hosting on GitHub Pages, mobile-first UI. Fairy-Stockfish WASM (UCI engine) + ffish.js (rules/legality/FEN/SAN) run client-side. `coi-serviceworker` if threading is needed (proven approach from prior project).

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
- **Overworld terrain inside the barrier carries into the duel as static wall squares (`*` in FEN).** This is the entire point of the dynamic-arena design: pillars, wall stubs, and room edges shape every fight.

### 4.2 Formations `[LOCKED]`

- Each side's formation is **2 ranks deep**: a back row (king + pieces) and a pawn row in front of it. Like chess.
- **Patch = N×2, N ∈ [3, 5].** Width cap of 5 (5 pawns, king + up to 4 pieces). Minimum 3 (3 pawns, king + 2 pieces).
- **Clip rule:** the patch is anchored to the king's projected overworld position (king can be anywhere in his back row — no centering requirement), shifted inward only if he'd clip a wall. Walls eat slots. What survives is what you fight with.
- Pawn row is **automatic, pawns only**, spanning the patch width. Pawn direction: toward the enemy along the duel axis (canonical orientation comes from the alignment axis).
- Formations spawn whole. **No hands/pockets by default** — all material starts on the board. Early-game deployment turns were judged a drag; materializing the whole army *is* the summoning.

### 4.3 Player placement at duel start `[LOCKED]`

- After the barrier drops, the player sees **everything** — real patch shape, walls carried in, the enemy's complete formation — then places their back-row pieces into the surviving slots.
- When collection size > available slots (clipped duels), placement includes **selection**: choose which pieces deploy.
- Placement consumes **no plies** and happens before White's first move regardless of initiative.
- QoL: last arrangement pre-filled as default (one tap to accept); auto-skip when there's no meaningful choice.
- Enemy arrangement is generated/authored and fixed — the player's responsive placement is a deliberate asymmetric advantage.

### 4.4 Duel rules `[LOCKED unless noted]`

- **Win/loss (both sides): checkmate or king capture.** Player king falls → run over. Enemy king falls → duel won. (Exact FSF config for the dual condition is a spike item — see §9.)
- **Promotion region = enemy back rank** (per-color `promotionRegion`). March a pawn onto their home row and it transforms. Promotion piece targets `[OPEN]`.
- **Initiative:** whichever side's move *completes* the legal duel condition plays White. Ambusher moves first; a player who deliberately steps into alignment holds White.
- If a **player** move creates legal alignment with multiple roamers simultaneously, the player chooses their opponent.
- **capturesToHand:** believed variant-wide only (not per-color) — if so, it is **not** a general rule. At most a symmetric boss modifier ("the Necromancer"). `[PROVISIONAL, pending spike]`
- **Reserve slot** (single piece in hand, droppable on own back ranks) is a possible high-tier upgrade, not a core mechanic. `[OPEN]`
- **Gap math:** formations are 2 deep each → 4 ranks of formation; FSF's 10-rank cap gives gap ∈ [0, 6]; the trigger condition enforces gap ≥ 2. Gap 2 = ambush-sharp, 3–4 = standard (4 = classic chess spacing), 5–6 = ranged/rider-friendly. One ruleset across the whole band.

---

## 5. Exploration Layer

### 5.1 Basics

- Turn-based, tile grid. Player is a king. `[PROVISIONAL: player moves 1 tile/turn, 8-directional — speed parity with hunters assumed but not settled]`
- **Roamers are kings/summoners only.** No non-king pieces on the overworld (armies exist only inside duels). What a summoner *looks like* telegraphs their book/level.
- Roamers are **finite per floor, no respawns** — kills the farming incentive, makes clearing a floor mean something.
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
2. Kings are **≥ 5 tiles apart** along that axis (guarantees gap ≥ 2).
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

---

## 7. Calibration Harness `[Phase 0–1 — this is design work, not tooling]`

The central unknown of the whole design is **material budget**. It is empirically answerable and nearly everything downstream (progression, enemy levels, rewards, the 3-vs-5 width floor) hangs off it. Do this early.

- Engine-vs-engine self-play sweeps over: material budgets & compositions, patch widths 3–5, gaps 2–6, terrain/wall densities, player-arrangement archetypes (balanced, queen-corner, rook-flanks, knight-core).
- Log result distributions and **game length in plies**. Pacing target: duels resolve in roughly **20–40 plies** `[PROVISIONAL]`. Expect a curve, not a line — bare-bones positions can grind while moderate sharp material mates fastest.
- Human-winnability estimation via weakened-FSF proxy opponent (calibration only — never in live play).
- MultiPV on enemy move selection for run-to-run variety (carryover idea; validate it doesn't tank strength unacceptably).
- Outputs: the material-budget curve that defines the enemy **level** scale and player progression pacing.

---

## 8. Progression & Content `[mostly OPEN]`

- **Collection:** the player accumulates pieces; back-row slots are filled from the collection at placement time.
- **Enemy level = visible material budget.** Simple number on the summoner. Fancier telegraphing later.
- **Reward candidate:** a beaten summoner drops a piece from their own formation (you saw it fight; scouting = shopping). Sizing waits on the sweep.
- **Pawn-type upgrades:** the screen stays pawns-only, but *what your pawns are* is a build axis (Berolina, triple-step, etc. — repurposed from the prior project's gimmick pool, pending spikes).
- **Boss-modifier shelf:** symmetric capturesToHand ("Necromancer"), king with open space behind him ("Errant King" — the exception that proves the backs-to-walls default).
- Standard roguelike content — floors, exits, shops, shrines, chests, traps, bosses — is expected and **deferred** until the core loop is playable.

---

## 9. Phase 0 Spike List

Cheap fairyground / ffish.js checks. All load-bearing — do these before building systems on top of them.

1. **Per-duel runtime variant loading.** Generate a variants.ini snippet + startFen per encounter and load it (ffish `loadVariantConfig` / engine option). Measure cost & correctness of doing this every fight.
2. **Static wall squares (`*`) in startFen** on custom variants, at various densities. Sanity-check classical eval behavior with heavy walls.
3. **Variable board dimensions per duel** (3–12 files × 6–10 ranks), including the small/clipped end.
4. **Dual loss condition: checkmate OR king capture** — find the cleanest config (check rules vs. extinction-style king capture) and verify the engine plays sanely under it.
5. **Per-color `promotionRegion` = enemy back rank** on generated boards.
6. **capturesToHand per-color?** Expected answer: no (variant-wide only). Confirm, then design the boss modifier as symmetric.
7. **Clipped/asymmetric formations:** off-center kings, unequal patch widths, non-mirrored positions — confirm nothing about eval or move-gen assumes symmetry.
8. **Mobile perf:** engine strength/latency at these board sizes on a phone; single-thread vs. threaded (coi-serviceworker).
9. **Reserve-slot drop** (tiny pocket + dropRegion = own back ranks) — verify now so the upgrade path stays open.

---

## 10. Build Phases

- **Phase 0 — Spikes + harness skeleton.** Everything in §9; harness able to run one sweep end-to-end.
- **Phase 1 — Duel vertical slice.** Hand-authored arena JSON → variant config + FEN → playable duel vs. engine on a phone. Placement UI, win/loss, promotion. No overworld.
- **Phase 2 — Exploration slice.** One hand-built map, two summoners with different levels. LOS/hunt/pursuit state machine, threat display, trigger → barrier → FEN pipeline proven end to end.
- **Phase 3 — The loop.** Rewards, collection, level scaling from sweep data, floor transitions. First full runs.

---

## 11. Open Questions

- Player overworld movement rules; speed parity with hunters.
- LOS range cap and occlusion rules.
- Duel escape valve: none for now (to the death, both sides) — revisit if runs feel too brutal.
- Promotion piece targets (fixed? collection-based?).
- Progression axes final shape (slot unlocks vs. pawn types vs. reserve slot vs. …).
- Multi-hunter dynamics beyond the initiative rule (aggro sharing, converging patrols).
- Frozen vs. live world during duels.
- Reward economy sizing (post-sweep).
- Title collision / availability check before any public release (title itself is locked).

---

## 12. Non-Goals (v1)

- No NNUE. No engine handicapping. No duel mechanics outside FSF's grammar (auras, HP, hidden info, multi-move turns, per-turn randomness).
- No hands/pockets as a core economy (upgrade path only).
- No procedural map gen in v1 (hand-built maps; linter still applies).
- No meta-progression between runs, no art/sound polish, no desktop-first layout.

---

## 13. Prior-Project Carryovers

Decisions inherited from the earlier chess-roguelike design work, still in force:

- FSF WASM + ffish.js client-side on GitHub Pages is proven (pychess/fairyground precedent); coi-serviceworker for threading.
- Prefer FSF's **predefined piece types** over custom Betza definitions — they come with pre-tuned evaluation values.
- Asymmetric-advantage difficulty philosophy (the player gets structural edges; the engine plays perfectly).
- **Kaneo piece set** (Kadagaden/chess-pieces, CC-BY-4.0) as the working asset source; Alfaerie / Wikimedia Commons as gap-fillers.
