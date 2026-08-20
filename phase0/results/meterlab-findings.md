# Meter lab — Phase 1.3 evidence pass (restlessness-meter trigger vs the ply ramp)

**Status: DRAFT — corpus running, numbers landing below.**

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

*(baseline arm; "hot" = side to move in check, or a capture/check/promotion
within the last 3 plies; eval classes from the white-POV referee — HARMFUL =
mate-lost / mate-delayed / sign-flip)*

TBD

### B — Counterfactual timing: would the meter have rolled at all?

*(baseline arm; every quake stamped with the passive meter's P at that ply;
"meter-quiet" = meterP < 0.25 — plies where a meter trigger would rarely
fire)*

TBD

### C — Termination & pacing under the meter arm

*(meter arm vs baseline: every game must terminate; plies distribution;
termination mix; quake volume and placement; §7 alarm rate; how often the
backstop floor, not the meter, was the binding trigger)*

TBD

## Reading the results

TBD

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
