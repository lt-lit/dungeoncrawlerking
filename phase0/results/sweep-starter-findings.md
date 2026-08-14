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

| arena | board | enemy | plies (3 games) | verdict |
|---|---|---|---|---|
| arena01-first-duel | 4×6 g2 | scrubN | 19, 21, 25 | PASS ×3 — the teaching puzzle |
| arena02-ambush | 5×7 g3, pillars | scrubB (moves first) | 40, 40, 46 | PASS ×3 — player converts as Black |
| arena03-clipped-vault | 5×7 g3, clip + pillar | eliteR | 35, 41, 73 | PASS ×3 — fat tail (35–103 across runs) |
| arena04-long-stair | 3×8 g4 | scrapNB | 35, 43, 45 | PASS ×3 — after the fix below |

Two lessons the linter earned its keep on, first run out:

- **arena04 as first authored had a center wall (b5) and the ENEMY WON a
  seed** (178 plies, 15 crumbles, crumble-decided). A wall on a 3-file board
  leaves two 1-file channels — near-crawlspace geometry a pawnless K+N+B holds
  indefinitely. Removing the wall matches the sweep's clean wall-free cell
  (35 plies). **Authoring rule: no walls on 3-file arenas** — one wall costs a
  third of a rank's cross-section; the narrowest boards must stay open.
- **Engine-vs-engine games are NOT replay-deterministic across runs** (the
  crumble RNG is seeded, but `movetime` search is timing-sensitive), so
  verifier plies are samples from a distribution, not fixed numbers —
  arena03's tail showed 35–103 plies across two runs. Judge arenas on the
  distribution over ≥3 games, and re-run before trusting a borderline verdict.

Wins terminate as both `checkmate` and `stalemate-or-extinction` — the
suffocation win (stalemateValue=loss) is doing real work in cramped small-army
duels, exactly as the no-draw config intends.
