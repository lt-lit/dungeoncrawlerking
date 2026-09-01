# Exposure guard + preset retune, A/B — same seeds, third pass

2026-09-01. `godlab-prelim-*-tuned.jsonl` vs the brake corpus
(`brake-ab-findings.md`), same 48 deals per arm. Two changes land
together but decompose cleanly: **wrathful's preset is untouched, so its
deltas isolate the `editExposes` guard**; calm and restless carry guard +
retune. 144 games, zero errors/stalls/in-check fires, 48/48 termination
in every arm (no max-plies).

## Calm is finally calm — and nearly harmless

| arm | quakes/100p | first quake | terrain left | flip rate/quake | games w/ flip |
|----------|-------------|------|---------------|-------------|-----------|
| calm | 10.7 → **5.9** | p26 → p39 | 31% → **43%** | 2.8% → **0.3%** | 27% → **2%** |
| restless | 14.5 → 11.7 | p14 → p18 | 15% → 24% | 3.3% → 1.3% | 23% → 15% |
| wrathful | 21.7 → 26.1 | p10 | 19% → 18% | 4.1% → 4.1% | 44% → 40% |

Preset separation now reads on the dial: **5.9 / 11.7 / 26.1 quakes/100
plies**, where the baseline had calm ≈ restless (12.3 vs 14.3). The
staleness knobs were the lever, exactly as the prelim data said.

## The guard, isolated (wrathful) — and its honest limits

The reported failure class is dead where the guard can see it: on
calm/restless the flip rate fell 4–10×. On wrathful it did NOT fall
(4.1% flat) — its flips are dominated by multi-action composites, race
re-timings and crumble-forced endgames, which no per-edit ray test can
see (prelim-findings §7 predicted this split). Wrathful also got
HOTTER, not cooler: vetoed breaches/displacements unlock less, boards
stay staler, staleness feeds the meter — quakes 21.7→26.1/100p, median
plies 68→81, holes 7.1→12.4. That is a feedback loop worth knowing
about: safety guards slow the unlock rate, and the meter compensates
with volume. On calm/restless the retune more than covers it.

## Trades on calm worth a feel-check

Calm's long tail stretched (q3 131→178 plies — gentler gods unlock
slower; still 48/48 terminated), locked-pawn clearing is slower (end
mean 0.8→1.0), and breach share fell to 7.8% of actions (the guard vetoes
line-openings that hang a piece, which on tight boards is many of them —
`hangs_piece` counts are in every trace census for the overlay). If calm
now feels TOO passive on the phone, `rampPlies`/`stalenessGain` are the
knobs to walk back first; the guard is not a knob.

## Status

The deferred old-1.3 rule ("no new winning capture for either side") is
PROMOTED and shipped as the `editExposes` ray guard on breach,
displacement and crumble (weaken exempt — safe by construction); the
observed queen-giveaway reproduces in a micro-test and is vetoed.
Presets live in ONE table (`director.mjs`), so the labs always measure
what the phone ships. Next signal is the phone: does calm feel calm, and
does wrathful's extra heat read as intended chaos.
