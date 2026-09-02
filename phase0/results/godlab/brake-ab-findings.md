# The conservation brake, A/B — same seeds, same deals, brake on

2026-09-01. `godlab-prelim-{calm,restless,wrathful}-brake.jsonl` vs the
frozen baseline corpus (`prelim-findings.md`): identical config,
identical 48 deals per arm, the only change is the Director commit ("the
gods stop stripping rooms bare" — conserveAt 0.6 / conserveFloor 0.3
defaults, god-crate breach targeting). The gods-off arm is untouched by
the change and was not rerun. 144 games, zero errors, zero stalls, zero
in-check fires, 48/48 termination in every arm.

## The target metric moved

Authored terrain remaining at game end (baseline → brake):

| arm      | all stages    | floorplans      | authored crates, all |
|----------|---------------|-----------------|----------------------|
| calm     | 23.7% → 31.0% | 17.9% → 32.1%   | 39.3% → 54.4%        |
| restless |  9.1% → 15.5% | —               | 11.8% → 19.1%        |
| wrathful |  7.8% → 18.8% |  4.7% → 16.6%   | 10.4% → 33.9%        |

Calm on floorplans — the designer's complaint — nearly doubled its
surviving terrain, and its median floorplan game shortened (177 → 137
plies). Boards still end below the 30% floor on hotter presets because
the brake only silences the GODS — armies go on capturing crates below
the floor, which is play, not stripping (the control arm put army
consumption at ~1/3 of a board's terrain on its own).

## What it cost, and what it didn't

- **Displacement share rose** (calm 45→47%, restless 44→55%, wrathful
  54→61% of actions): braked terrain rungs fall through to displacement,
  the structural fallback. This is the known trade — displacement is the
  one rung that can still hand out material, but it is SEE-guarded, and
  the alarm didn't move with it (below).
- **Alarm flat**: flip rate 2.9/2.6/3.8% → 2.8/3.3/4.1% per quake; mean
  |Δeval| unchanged (~92–120cp). At ~600–800 refereed quakes per arm the
  deltas are a handful of events.
- **Pacing flat**: quakes/100p and first-quake ply essentially unchanged
  (the brake edits WHAT the gods do, never WHEN — the trigger is
  untouched), and median plies moved <5 in every arm. No re-lengthening.
- **Locked pawns still cleared**: 6.4 → 0.2–0.8 across arms (floorplans
  12.5 → 0.4–2.4; calm's 2.4 is up from 1.8 — fewer breaches free fewer
  pawns, worth an eye at tuning time).
- **Wrathful floorplan holes 20.3 → 24.5**: mostly pre-existing (debtCap
  6 was already producing 20+), mildly amplified as actions shift
  down-ladder. If wrathful floorplans reading as swiss cheese is a
  problem, it is a debtCap/crumbleBias conversation, not the brake's.

## Read

The brake does what the designer asked — the stage stays recognizably
the stage, calm now keeps a third of its terrain instead of a fifth
(half, counting only crates) — at the cost of a fatter displacement
share and with pacing untouched. Preset separation (1.5(c), the
staleness path) remains open: calm still fires ~21 quakes/100p on
floorplans vs ~8 on core. Knobs on the dial surface for feel-tuning:
`conserveAt`, `conserveFloor`.
