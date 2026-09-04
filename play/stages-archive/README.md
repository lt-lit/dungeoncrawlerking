# Archived stages — waves 4–5 (s01–s58)

The Phase 1.2.4 bed (locked 2026-08-27): wave 4, s01–s33, the furniture
bed; wave 5, s34–s58, rooms & breaches incl. the s51+ floorplans.
**Retired 2026-09-04** by the arena refresh (designer: the small stages
had become useless; the big complex 10×10s were the fun) and replaced
by wave 6, `play/stages/s59–s94`.

These files are NOT loaded by the game (`gen-stage-manifest.mjs` bundles
`play/stages/` only) and are kept for one reason: the god-lab and
meter-lab corpora under `phase0/results/` were played on them, so their
findings (`prelim-findings.md`, `brake-ab-findings.md`,
`tuned-ab-findings.md`, the meter-lab data) reference these ids and the
`core` / `rooms` / `floorplan` stage classes (`godlab/run.mjs
stageClass`, which still recognises the old id ranges). To replay one,
copy it back into `play/stages/` and regenerate the manifest.
