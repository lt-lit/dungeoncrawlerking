# Meter lab — Phase 1.3 evidence pass (restlessness-meter trigger vs the ply ramp)

**Status: COMPLETE.** 96 games (12 seeds × 4 arenas × 2 arms), zero
termination failures, 96/96 replay-verified engine-free (`replay.mjs`).

**Verdict in one line: the meter shape works.** Same seeds, same arenas,
same search: the meter arm cut per-game god-inflicted harm by ~55% (3.27 →
1.48 harmful quakes/game), cut in-check quake firing from 11.1% to 2.9%,
and games got slightly SHORTER (median 45 → 43 plies, q3 59 → 52; checkmate
share up 17 → 23 of 48) with the backstop floor never once needed. The
residual harm that remains is the OTHER half of Phase 1.3 — the filter
stack's loosening bias — and it is now cleanly quantified.

## Why this exists

Live play on the `restless` preset surfaced the check-rescue treadmill: quakes
repeatedly moved the enemy king OUT of check and dissolved mate-in-1 positions
(observed as `Δeval M1 → M2` lines in the Phase 1.2 overlay), prolonging
exactly the games the Gods exist to shorten. The design review that followed
traced it to two structural facts, both deeper than the check-guard inversion:

1. **The trigger is state-blind.** `pQuake` is a function of PLY alone, so
   under `restless` the gods fire into mating attacks and dead shuffles with
   equal enthusiasm. The board's actual state never enters the decision of
   *when* to act — even though the Director's charter (§4.5) is to reopen
   INERT boards.
2. **The filter stack is a one-directional pump.** Every veto prunes
   tightening candidates (`gives_check`, `exposes_king`, SEE near a defended
   king) and every survivor loosens; tier B then *prefers* the loosening
   (check-paralyzed defenders count as stuck pieces worth freeing). Near a
   decided position the "random" gods are structurally biased toward
   dissolving whatever was being built.

The redesign hypothesis (this lab's subject): replace "how long has the duel
run?" with "is the game going anywhere?" — a **restlessness meter** in the
fifty-move-rule tradition. Quiet plies (no capture, no check, no pawn
advance, no promotion) feed the meter, +extra on repetitions; forcing plies
sate it; `P(quake)` derives from the meter, with a slow ply-ramp floor as the
termination backstop. The meter is a pure function of the game record — no
engine, no eval, no wall clock — so seeded determinism and ledger replay
survive untouched.

## Method

Everything lives in `harness/meterlab/` and runs the **canon shipped
pipeline** — `play/js/duel.mjs` and `play/js/director.mjs`, unmodified — with
the engine in both seats:

- `meter.mjs` — `RestlessnessMeter` (v0 dials: sate 4, repBonus 2, rampPlies
  16, floor from ply 120 over 120) and `MeterDirector`, a subclass overriding
  `pQuake()` ONLY. `quakeDue` consumes exactly one RNG draw per post-onset
  ply regardless of threshold, so the draw pattern stays aligned with the
  stock Director; everything downstream (tiers, debt, crumbles, traces) is
  inherited untouched.
- `run.mjs` — seeded corpus runner. Two arms on identical seeds/arenas:
  **baseline** (stock Director, `restless`) and **meter** (`MeterDirector`).
  In the baseline arm the meter runs passively, stamping every ply with
  "what would the meter have said here?". After each game, every adopted
  quake gets an offline eval referee: white-POV probes of preFen/postFen at
  the Phase 1.2 instrument settings (`depth 12 movetime 300`), plus a preFen
  in-check tag. Offline only — nothing feeds back into play.
- `replay.mjs` — proves the corpus is self-contained evidence: every game's
  quake sequence re-derives exactly from (seed, config, recorded moves) with
  NO engine. This is the property the evidence-preservation argument rests
  on: the baseline corpus stays fully analyzable after any 1.3 rule change
  ships.
- `analyze.mjs` — the three measurements below.

**The asymmetric-seat design.** Two full-strength engines convert the §7
material edge in ~20 plies and the duel ends before the gods matter; the
live pathology comes from a mid-skill human converting SLOWLY into the
saturated-ramp phase. The favored seat therefore searches shallow
(`depth 2 movetime 80`, with a hash clear before each of its searches so the
shared TT doesn't lend it the enemy's depth-22 lines); the enemy plays the
shipped search (`depth 22 movetime 500`, rule 11 cap). This reproduces the
target regime — 30–70-ply games with quake counts in the dozens — and the
shallow seat's occasional losses keep the §7 "two blunders from losing"
frame honest.

**Corpus.** 12 seeds × 4 arenas × 2 arms = 96 games, one OS process per
arm×arena batch (the WASM engine corrupts under sustained multi-game use —
rule 6 — and dropped instances never free their ~200 MB, pthread workers pin
them; a fresh process per batch plus a one-shot fresh-engine retry on error
keeps every game clean).

## Measurements

### A — Harm: where do restless quakes land, and what do they cost?

*(baseline arm, 48 games, 677 quakes, 674 probed; "hot" = side to move in
check, or a capture/check/promotion within the last 3 plies; HARMFUL =
mate-lost / mate-delayed / sign-flip, white-POV referee)*

- **11.1%** of fired quakes landed with the side to move **in check** — and
  under the inverted postcondition filters every one of those is a rescue by
  construction. **46.7%** landed on hot boards.
- Referee classes: benign 46.4% · **mate-lost 10.5%** · **mate-delayed
  11.6%** · sign-flip 1.2% · mate-accelerated 11.0% · mate-created 9.5% ·
  big-swing 9.8%. Read that middle column again: **more than half of all
  quakes perturb a mate score or swing the eval** — "cosmetic" is a minority
  outcome under `restless` in this regime.
- **HARMFUL: 23.3% of all quakes — 3.27 per game.** The live-play report is
  confirmed at scale and it is not an edge case: `M10→969cp`, `M9→1584cp`,
  `M5→953cp` (that one fired DURING a check), an `M4→M7` delay at ply 20…
  the gods un-mate roughly every fourth stir.
- Note `mate-created` at 9.5%: the same dice also hand mates OUT. The
  Director is not "pro-defender" so much as **pro-entropy against whichever
  structure exists** — which near a decided game is usually the attacker's,
  but the flip side is just as god-decided.

### B — Counterfactual timing: would the meter have rolled at all?

*(baseline arm; every quake stamped with the passive meter's P at that ply;
"meter-quiet" = meterP < 0.25, plies where a meter trigger would rarely
fire)*

- **49.3%** of all baseline quakes fired on meter-quiet plies — half of the
  gods' activity lands where a boredom-driven trigger would mostly hold.
- Among the HARMFUL quakes it is **58.6%** — harm concentrates in exactly
  the (hot, forcing, conversion-in-progress) stretches the meter naturally
  sits out. A timing fix alone plausibly removes the majority of observed
  harm, before any filter work.
- The remaining ~41% of harm sits on plies where the meter was genuinely
  climbing (meterP 0.3–0.6 in the samples): slow grindy conversions where
  the board LOOKS stale to any boredom metric but a mate is quietly being
  assembled. Timing cannot see those — that is the effect-rules half of 1.3.

### C — Termination & pacing under the meter arm

*(meter arm vs baseline, same 12 seeds × 4 arenas)*

| metric | baseline (`restless`) | meter v0 |
|---|---|---|
| termination failures / MAX_PLIES hits | 0 | **0** |
| plies q1/med/q3 | 34/45/59 | **33/43/52** |
| terminations (mate/extinct/stale) | 17/29/2 | **23**/22/3 |
| player (favored side) wins | 40/48 | 39/48 |
| quakes per game q1/med/q3 | 7/10.5/20 | **4/6/11** |
| crumbles (total) | 157 | 103 |
| fell-through rate | 49 | 29 |
| quakes fired in check | 11.1% | **2.9%** |
| quakes on hot boards | 46.7% | **22.5%** |
| HARMFUL per probed quake | 23.3% | **15.7%** |
| HARMFUL per game | 3.27 | **1.48** |
| backstop floor was the binding trigger | n/a | **0.0%** |

- **The pacing worry is refuted.** Fewer quakes did NOT lengthen games —
  the tail shortened (q3 59 → 52) and checkmate share ROSE. This is the
  mechanism the harm data predicted: baseline quakes were actively
  un-mating positions, so removing the mistimed ones speeds games up. The
  gods were the pacing problem they were built to solve.
- **Termination held with zero help from the backstop.** The meter alone
  triggered every quake; debt-forced crumbles kept landing (103 crumbles);
  no game approached MAX_PLIES. (48 games is not a proof — the floor stays
  in the design as the guarantee — but v0 dials never needed it.)
- **God volume redistributes rather than disappearing.** Short clean wins
  in both arms still see a couple of stirs; long grinds still see ~22
  (baseline ~25). The meter cuts the mid-game interference during active
  conversion, which is where the harm lived.
- Residual in-check firing (2.9%) is **sate lag**: a check lands while the
  meter is still draining from a quiet stretch (e.g. a harmful sample fired
  at meterP=0.31 with preCheck=true). An explicit in-check hold or a bigger
  sate on checks composes cleanly and would zero this line.

## Reading the results

1. **The trigger really was the wrong half.** Same filters, same tiers,
   same crumble machinery — changing only *when* the gods roll halved the
   per-game harm and slightly shortened games. The redesign premise
   ("state-aware timing, not more filter rules") survives its first
   adversarial contact with data.
2. **Timing is necessary but not sufficient.** The meter arm still shows
   15.7% harmful quakes, concentrated in slow conversions the meter
   correctly reads as stale — several of the worst are CRUMBLES cutting
   mate nets (`crumble b3: M12→961cp`), which no timing rule can see. That
   is the quantified case for the effect-rules half of 1.3:
   check-status/checker-set preservation, and a mate-aware guard on the
   crumble leg.
3. **Division of labor for Phase 1.3, in numbers:** meter-style timing
   removes ~55% of per-game harm; effect rules must own the rest. Neither
   substitutes for the other.
4. **De-pairing gets its opening.** One-sided stirs were near-absent in
   both arms here (4 vs 0) — the asym ramp barely engaged at these game
   lengths — so this corpus says nothing about removing pairing yet. But
   with quakes now concentrated on genuinely stale boards, the original
   one-sided catastrophe measurements (median flip = mate transition, taken
   across ALL positions) deserve a re-run under meter timing before pairing
   is kept as canon.

## Threats to validity

- **Engine noise.** Movetime-bounded searches are wall-clock-dependent, so
  arm-vs-arm comparisons are distribution comparisons, never ply-matched
  pairs. The counterfactual (measurement B) is a timing overlay on the
  baseline timeline, not a replayed game — after the first differing quake
  the timelines diverge; the real A/B is the arm comparison.
- **The shallow seat is not a human.** A depth-2 engine blunders differently
  from a mid-skill player (it never *plans* a mating net, it stumbles into
  conversions). The check-rescue mechanism it exposes is the same one
  observed live, but harm RATES here calibrate the mechanism, not the live
  experience.
- **v0 meter dials are untuned.** sate/rampPlies/floor were picked by
  argument, not sweep. Measurement C bounds whether the shape works at all;
  dial-tuning belongs to the Phase 1.5 sweeps if the shape survives.
- **The eval referee is shallow.** depth 12 sees the M1–M5 class that
  motivated this work; deep quiet squeezes scored +cp may be misclassified
  as benign in both arms equally.

## Relationship to the phased plan

This lab is scoped as Phase 1.3 *evidence*, not a rule change: no canon file
is touched. If the meter shape survives measurement C, the 1.3 deliverable
becomes "replace the decision layer" (meter trigger + delta-style effect
rules + possible de-pairing) rather than "redefine symmetric" alone — and
§4.5's Timing / Symmetric-preferred / "its job is not pacing" text (LOCKED in
shape) needs the design conversation the brief's protocol requires before
any commit rewrites it. The baseline corpus here doubles as the
evidence-preservation capture that must exist BEFORE any fix ships (the
observed harm class vanishes from live ledgers by construction once a fix
lands).
