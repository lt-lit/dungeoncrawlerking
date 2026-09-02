# Legacy crumble-era duel loop — RETIRED for calibration

These modules are the Phase 0 crumble-system harness (repetition +
fixed-cadence pacing, pre-Director), kept ONLY so spikes 07 and 08 remain
runnable as the deterministic evidence artifacts they are. Everything they
model was superseded: the crumble system by the Board State Director's v3
severity ladder (brief §4.5), and `arena.mjs`'s generated bed by the
designer-locked stage set × `armygen.dealMatchup` (Phase 1.2.4/1.2.5).

**Never produce Director or pacing data with these.** The §7
sweep-validity law — calibration counts only if the harness plays the
EXACT shipped ruleset — is why the sweep driver that used to sit on top of
them (`sweep.mjs`/`analyze.mjs`, deleted 2026-09-01) is gone rather than
ported: Phase 1.5's rig is `harness/godlab/`, which drives the canon
`play/js` DuelController instead of reimplementing it. The old
`results/sweep-*.jsonl` corpora and summaries are crumble-era output —
kept as history, not evidence (see `results/` note in the docs).

`duel.mjs` in `play/js/` began life as a structural port of `game.mjs`
here; the live game is the reference implementation now, and this copy is
frozen.
