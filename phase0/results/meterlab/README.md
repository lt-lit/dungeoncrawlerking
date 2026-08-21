# Meter-lab corpora — what is evidence and what is superseded

**The first-pass corpora (`corpus-baseline-*.jsonl`, `corpus-meter-*.jsonl`)
are the Phase 1.3 trigger evidence** — 96 games, 96/96 replay-verified;
read `../meterlab-findings.md`. They were collected on the four LEGACY
arenas, which is exactly why their *numbers* gate on the proving-grounds
rerun; the *finding* (ply-ramp trigger is the wrong half) stands.

**The v3 variant-sweep partials (`corpus-hold-*`, `corpus-drain-*`,
`corpus-decay-*` + `run-log-variants.txt`) are SUPERSEDED — do not analyze
them.** The sweep was deliberately stopped 54 games in (3 of 9 variants;
hold-a01 ran 12 seeds, later batches 6; drain-a03 truncated at 4) once the
stage/army distribution was recognized as unrepresentative
(`play/SLICE-REFRESH-PLAN.md`). They are kept only as the record of that
decision. The rerun collects every arm fresh on the locked 33-stage bed ×
both orientations × generated matchups.

Replay note: every corpus line is self-contained (startFen + config +
seed + moves), so `harness/meterlab/replay.mjs` can still re-derive the
old quake sequences engine-free even though the legacy arenas and their
loader are gone. Replays of PRE-1.3 corpora must run the pre-1.3
Director (check out the corpus's commit) once the 1.3 rule change lands —
the rule change legitimately alters the draw pattern.
