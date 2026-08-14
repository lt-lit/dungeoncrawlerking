# Starter-army sweep — findings

**Question:** is the 3×2 starter army (K+R+N + 3 pawns, value 11) viable as the
run's opening kit against small "scrub" armies, at puzzle pacing (mates in
~10–20 plies under good play), across gaps 2–4 and both initiative colors?

**Answer: yes, cleanly.** 90/90 games decisive, zero errors, zero anomalies,
and the starter converted **all 90** — as White and as Black alike. Full table:
`sweep-starter-summary.md`; raw games: `sweep-starter.jsonl` (seeded, exact
replays). Run: `depth 60 movetime 150`, crumble onset 40 / cadence 8, seeds
3000–3002, engine-vs-engine at full strength both sides (so ply counts are
best-play conversion lengths — the "if you know what you're doing" number).

## Roster

| label | army | width | value |
|---|---|---|---|
| startRN | K+R+N + 3P | 3 | 11 |
| scrubN | K+N + 2P | 2 | 5 |
| scrubB | K+B + 2P | 2 | 5 |
| eliteR | K+R + 2P | 2 | 7 |
| tinyN | K+N + P | 2 | 4 |
| scrapNB | K+N+B, pawnless | 3 | 6 |

## Findings

1. **Gap 2 is the puzzle band.** Every gap-2 matchup resolved in 17–29 plies
   (mates in ~9–15 moves). The 3-unit tinyN dies in 17; scrubB in ~20. Gap 3
   runs ~26–36; gap 4 ~27–48 for everything except the rook elite.
2. **Initiative does not rescue small armies.** The 67% White edge measured on
   mirrored smoke configs vanishes at a 4–7 point material edge: scrub-as-White
   games lasted within ±2 plies of the reversed color. Being ambushed by a
   scrub is the same puzzle with a different move order — the ambush cost the
   design should price is formation/facing (Phase 2), not initiative per se.
3. **The rook elite marks the grind boundary.** eliteR (K+R+2P) at gaps 2–3 is
   fine (24–50 plies). At gap 4 it has room to run and harass: 66–121 plies,
   32 crumbles across 6 games, 6 pieces lost to collapses — the only cell in
   the sweep where the crumble system did real work. Consequences: the gap ≤ 4
   trigger cap is confirmed as the ceiling (gaps 5–6 were already 100+-ply
   grinds in the smoke sweep), and rook-bearing enemies play best at gap ≤ 3 —
   or accept that elite fights run long, which may be right for elites.
4. **Crumbles are now pure failsafe.** Sub-40-ply games never reach onset 40;
   crumble-alarm rate was 0 in every cell (no eval flips, ever). The puzzle
   pacing quietly resolves the §7 crumble-calibration problem: onset/cadence
   only matter in botched grinds, which is exactly the §4.5 design intent
   ("late and rare").

## Arena verification (encounter linter v0)

`harness/verify-play-arenas.mjs` plays the four `play/arenas/*.json` from
their default placement, 3 seeded games each — results in the table below
(engine-vs-engine; PASS = decisive, error-free, player side wins).

<!-- ARENA-VERIFY -->
