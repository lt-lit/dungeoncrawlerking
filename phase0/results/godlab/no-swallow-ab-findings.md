# No-swallow rule, A/B — quakes cannot eat pieces

2026-09-01. `godlab-prelim-*-gentle.jsonl` vs the tuned corpus
(`tuned-ab-findings.md`), same 48 deals per arm. The ONLY change is the
Director commit "quakes cannot swallow pieces" (occupied squares dropped
from the crumble vocabulary). 144 games, zero errors/stalls/in-check
fires, 48/48 termination.

## The rule holds, and it was needed

Swallowed pieces per game (tuned → no-swallow):

| arm | swallows/game | median swallow ply | now |
|----------|---------------|--------|------|
| calm | 0.02 | 181 | **0** |
| restless | 0.29 | 64 | **0** |
| wrathful | **1.96** | **51** | **0** |

The designer's ply-13 knight was not a tail: wrathful ate ~2 pieces per
game, half of them before ply 51. The count is now exactly 0 in every
arm (analyze.mjs guards it as a regression check, not a dial).

## Nothing else moved — except wrathful mates more

Termination, pacing and terrain held flat (the crumble still lands, on
floor; breach/weaken/displace untouched):

| arm | quakes/100p | median plies | terrain left | terminations |
|----------|-------------|------|---------------|--------------|
| calm | 5.9 → 5.7 | 92 → 92 | 43% → 43% | flat |
| restless | 11.7 → 11.2 | 93 → 93 | 24% → 23% | flat |
| wrathful | 26.1 → 23.3 | 81 → 82 | 18% → 18% | **mate 27→32, strip 17→14** |

The one real shift is wrathful's win MIX: pieces the gods used to eat now
survive to be mated or to keep fighting, so checkmates rose and
army-extinction strips fell. That is the mechanic working as intended —
the arena stops removing material the players should be removing
themselves. Wrathful's holes eased slightly (12.4 → 9.8/game) as a
second-order effect of the different board evolution; still the highest
of the three presets, and that is its job.

## Status

The `[designer-final 2026-09-01]` no-swallow rule is shipped and
measured. Termination is provably untouched (the debt-forced hole lands
on floor, and the closed-board `terminal` crumble that finishes a locked
position never ate anything). Combined with the earlier passes, the v3
Director's Phase 1.5 story: calm is calm (5.7 q/100p, 0.3% flips, 43%
terrain kept), the exposure guard killed the free-material gifts it can
see, and quakes no longer eat pieces at all. Remaining 1.5 work is the
live-regime arm (needs the favored-seat decision) and whatever the phone
says next.
