# The Gods v4 — memory, heat, protection: the wave 6 corpora

2026-09-05. The designer's five complaints after phone play on the wave 6
bed, measured on the v3 corpora first (`../godlab/*.jsonl`, the archived
small-stage bed) and then on the FIRST god-lab corpus ever played on wave 6
(`godlab-wave6-*-v3base.jsonl`, shipped v3, 12-stage stratified spread ×
both orientations × 1 seed = 24 games per preset, `depth 8 movetime 250`,
referee `depth 12 movetime 300` — `sweeps/wave6-v3-baseline.json`). Every
change was then re-measured on the same 24 deals per arm. Scorecard by
`harness/godlab/gods-metrics.mjs`:

```
corpus                 games  ended  med plies  q/100p  act/q  gap=1  med gap  dbl-touch  un-mate  un-mate≤3  heat  pinned  floor  dead  terrain  prot pcs 
wave6-calm-v3base      24     100%   200.5      13.8    1.57   53%    1        21%        35/96    12/43      —     4%      50%    0%    37%      —        
wave6-calm-v4a         24     100%   204        7.5     1.48   39%    2        0%         21/66    3/32       45%   1%      55%    0%    45%      2 (0 cut)
wave6-calm-v4b         24     83%    212.5      2.1     1.09   2%     19       0%         1/4      0/1        42%   0%      4%     0%    56%      0 (0 cut)
wave6-calm-v4d         24     92%    210        2.0     1.08   3%     19.5     0%         2/6      0/1        40%   0%      3%     0%    55%      0 (0 cut)
wave6-calm-v4e         24     92%    209        2.9     1.73   1%     12       0%         2/6      0/2        42%   0%      1%     0%    55%      0 (0 cut)
wave6-calm-v4f         24     96%    206.5      4.2     1.80   10%    8        0%         1/4      0/2        42%   0%      0%     42%   52%      0 (0 cut)
wave6-restless-v3base  24     100%   182.5      17.2    1.77   32%    2        28%        30/98    15/55      —     0%      37%    0%    25%      —        
wave6-restless-v4a     24     100%   203.5      19.4    2.10   51%    1        0%         31/110   5/52       47%   4%      65%    0%    19%      0 (0 cut)
wave6-restless-v4b     24     96%    258        3.6     1.30   1%     13       0%         1/9      0/6        44%   0%      0%     0%    37%      0 (0 cut)
wave6-restless-v4d     24     88%    232.5      3.6     1.16   3%     15       0%         1/5      0/3        43%   0%      0%     0%    42%      0 (0 cut)
wave6-restless-v4e     24     96%    190.5      4.5     2.10   2%     13       0%         2/11     2/9        45%   0%      0%     0%    46%      0 (0 cut)
wave6-restless-v4f     24     100%   206.5      7.8     2.46   14%    5        0%         5/17     0/9        44%   0%      0%     44%   43%      0 (0 cut)
wave6-wrathful-v3base  24     100%   171        32.1    2.98   59%    1        55%        48/110   23/57      —     10%     18%    0%    17%      —        
wave6-wrathful-v4a     24     100%   189.5      15.4    2.31   36%    2        0%         32/100   4/46       53%   1%      51%    0%    21%      0 (0 cut)
wave6-wrathful-v4b     24     100%   197        5.3     1.57   2%     8        0%         1/14     0/9        53%   0%      1%     0%    30%      0 (0 cut)
wave6-wrathful-v4d     24     100%   211.5      7.7     1.66   8%     6        0%         3/8      0/3        45%   0%      0%     0%    31%      0 (0 cut)
wave6-wrathful-v4e     24     100%   196        9.2     2.59   5%     6        0%         5/15     2/10       48%   0%      0%     0%    26%      0 (0 cut)
wave6-wrathful-v4f     24     100%   178.5      10.7    2.76   14%    5        0%         9/30     4/19       49%   0%      0%     26%   27%      0 (0 cut)

terminations:
  wave6-calm-v3base: checkmate 14, army-extinct 8, stalemate 2
  wave6-calm-v4a: checkmate 19, army-extinct 5
  wave6-calm-v4b: max-plies (600) reac 4, checkmate 15, army-extinct 5
  wave6-calm-v4d: max-plies (600) reac 2, checkmate 15, army-extinct 7
  wave6-calm-v4e: army-extinct 10, stalemate 2, checkmate 10, max-plies (600) reac 2
  wave6-calm-v4f: checkmate 16, army-extinct 6, max-plies (600) reac 1, stalemate 1
  wave6-restless-v3base: army-extinct 8, checkmate 16
  wave6-restless-v4a: army-extinct 10, checkmate 12, stalemate 2
  wave6-restless-v4b: checkmate 13, army-extinct 10, max-plies (600) reac 1
  wave6-restless-v4d: checkmate 12, max-plies (600) reac 3, army-extinct 9
  wave6-restless-v4e: checkmate 15, army-extinct 8, max-plies (600) reac 1
  wave6-restless-v4f: checkmate 16, army-extinct 7, stalemate 1
  wave6-wrathful-v3base: checkmate 9, stalemate 6, army-extinct 9
  wave6-wrathful-v4a: checkmate 14, army-extinct 9, stalemate 1
  wave6-wrathful-v4b: army-extinct 12, checkmate 11, stalemate 1
  wave6-wrathful-v4d: army-extinct 12, checkmate 11, stalemate 1
  wave6-wrathful-v4e: checkmate 13, army-extinct 11
  wave6-wrathful-v4f: checkmate 10, army-extinct 14
```

Columns: q/100p quakes per 100 plies · act/q actions per quake · gap=1 the
share of quakes on the very next ply after a quake · dbl-touch the share of
multi-action quakes that touched a square or moved a piece twice · un-mate
quakes fired with a forced mate on the referee's board that destroyed or
delayed it (all mates / mate-in-3 or less) · heat mean heat of the record ·
pinned share of plies at P ≥ 0.95 · floor / dead share of quakes fired by
the late ply backstop / the dead-board backstop · terrain standing
walls+crates at the end over the start.

## What v3 did on the bed the phone plays (v3base)

- **No relief.** Calm fired 13.8 quakes/100 plies with 53% of them on the
  very next ply; wrathful 32.1 and 59%. Half of calm's quakes (50%) were the
  late PLY FLOOR — wave 6 games run ~200 plies and the floor started rising
  at 120, so the end of every long game was a barrage nothing could relieve.
  The meter had no ceiling, so a quiet stretch banked a debt no aggression
  could repay (simulated with the shipped class: 8–10 consecutive captures
  to bring wrathful under P 0.5 after twenty quiet plies past full).
- **No memory within a quake.** 21% (calm) to 55% (wrathful) of multi-action
  quakes moved a piece twice, stepped a second piece into the square the
  first had just left, cracked and smashed one wall in a breath (the
  telegraph the ladder was built on), or opened a hole where a crate stood
  a second ago.
- **No tactical vocabulary.** A quarter to a third of the quakes that fired
  onto a forced mate destroyed or delayed it (mate-in-3 or less: calm
  12/43, restless 15/55, wrathful 23/57). The guards asked only whether an
  edit CREATES a hanging piece; the second displacement tier hunts
  immobilized pieces, which is what a mating net is.
- **Aggression could not hold them off.** The meter's forcing list was the
  fifty-move list plus checks; best-move engine play drained it on 20–25%
  of plies, at or below break-even on restless/wrathful once staleness sat
  high — and a pawn shuffle drained it as much as winning a queen.

## The steps (each arm re-run on the same 24 deals)

- **v4a** — protection (`tactics.mjs`), heat, touched set, discharge,
  ceiling; the old floor. Double-touch 0. Un-mate≤3 3/32 · 5/52 · 4/46.
  But gap=1 still 39–51%: with the meter half quiet, the ply floor was
  55–65% of every quake.
- **v4b** — the floor counts plies since the last quake. gap=1 1–2%, median
  gap 8–19 — and calm 2.1 q/100p with 4/24 games never terminating: the
  ladder was keyed to instantaneous pressure, which a discharging meter
  rarely reaches, so a dead board got weaken after weaken and no holes.
- **v4d** — tedium (a sated accumulator) + game-long threat memory (a 16-ply
  memory left 25–39% of the plies in 600-ply shuffles reading hot). Still
  2.0 / 3.6 / 7.7 with 2 + 3 games at the cap: a sated accumulator never
  rose on calm (a 12%-event shuffle drained it as fast as it filled).
- **v4e** — tedium as the cold share of a window, threats heat but do not
  sate, the ramps down (26/14/6; offline replay of the records projected
  ~5/~10/~14, the lab gave 2.9/4.5/9.2). Two classes of holdout: 600-ply
  CHECK FARMS (half the plies hot, the meter never above 0.08 — checks were
  on the sating list and this ruleset has no perpetual-check draw) and a
  10×10 FORTRESS that took 29 holes and was still open at the cap.
- **v4f — shipped.** Checks heat but do not sate, a repeated position is
  cold, the DEAD-BOARD BACKSTOP (P floor 0.25/0.35/0.5 while the record has
  been dead for the whole tedium window and nothing irreversible has
  happened for 8/6/4 plies; undischarged; gone the ply something happens),
  and the mate search widened (quiet first moves on ≤32-move boards, 12k
  nodes). **4.2 / 7.8 / 10.7 q/100p** (v3: 13.8 / 17.2 / 32.1), next-ply
  quakes **10% / 14% / 14%** (53 / 32 / 59) — all of them on records with
  nothing irreversible for 8/6/4 plies, the dead backstop by construction
  (26–44% of quakes) — double-touch **0**, un-mate≤3 **0/2 · 0/9 · 4/19**
  (12/43 · 15/55 · 23/57), terrain remaining 52% / 43% / 27% (37 / 25 / 17),
  termination 23/24 · 24/24 · 24/24.

## Honest residue

- **One calm holdout** (s92-undercroft-to-cave flipped): a genuine fortress —
  64 quakes, 37 holes, tedium 0.85, 45 of the quakes dead-floor driven, and
  still open at the lab's 600-ply cap (the live cap is 1000). v3 closed such
  boards with 84 holes at 32 quakes/100 plies; the dead-board backstop is
  the honest replacement and it is a dial (`tediumFloor`).
- **The search's horizon.** Wrathful's four un-mated short mates are three
  mate-in-3s and one mate-in-2 whose first move was quiet on a wide board —
  beyond `forcedWins` (win-in-1 exact; mate-in-2 checks-and-captures, quiet
  first moves only under 33 legal moves). A weaken can undo such a mate: a
  cracked wall is a crate the mated king may capture to flee — "safe by
  construction" was never true of nets.
- **The alarm metric** (referee eval flips per quake) is flat-to-mixed:
  calm 0.3%→1.3%, restless 1.6%→0.7%, wrathful 1.9%→2.2% on 150–450
  refereed quakes per arm. v4's quakes are bigger (1.8–2.8 actions on a dead
  record) and rarer; the flip-prone rung is still displacement.
- **The offline replay** (`metersim.py`, scratch) over-projects pacing by
  ~1.7× — it ignores that a quake changes the record — but ranked the
  variants correctly and is how the ramps were chosen in one round instead
  of five.

## Gates run

`play/selftest.html` 39/39 in headless Chromium (four v4 checks: the
ledger reads hang/fork/pin/skewer; ceiling, discharge, heat, tedium, the
dead floor; no double-touch + discharge on 42 quakes; a forced win survives
24 seeded quakes while the unprotected control un-mates 8/8);
`ladder-smoke.mjs` 6/6 terminated on calm and restless, 0 double-touched,
0 in-check fires; `lib/selftest.mjs` on the overlaid pair ALL PASSED.

## v4.1 — the ladder leans on the crack (same day, `*-v4g.jsonl`)

Designer, after restless on the phone: "feels okay, huge improvement …
weakens should definitely be weighted higher than breaches." Defaults went
weakenBias 1.8→3, breachBias 2.2→1.2, breachAt 0.15→0.3, and the crate brake
now counts only god-minted crates (a crate-heavy stage was braking cracks
from ply 1). Same 24 deals per arm:

| arm | weaken / breach by action | crates left (of authored) | q/100p | ended | un-mate≤3 |
|---|---|---|---|---|---|
| calm | 31/22% → **39/11%** | 12% → 31% | 4.2 → 3.7 | 23/24 → 24/24 | 0/2 → 0/1 |
| restless | 15/14% → **25/13%** | 15% → 34% | 7.8 → 7.0 | 24/24 | 0/9 → 4/8 |
| wrathful | 19/17% → **24/11%** | 24% → 43% | 10.7 → 10.6 | 24/24 | 4/19 → 0/9 |

Every un-mated short mate in v4g is `wins found 0` — three mate-in-3s and a
quiet-move mate-in-2, the search residue. Displacement still leads by
action (38–49%): the terrain rungs run dry and the budget falls through to
it, as before. The four biases are live sliders in the debug panel
(`#gods-ladder`), verified in a real browser: defaults 3 / 1.2 / 1.6 / 3,
a drag retunes the running Director and persists, `defaults` resets.

## v4.2 — the gods read the engine's mate lines (same day, `*-v4h/i/j.jsonl`)

Designer: "Wait we're NOT feeding engine results to The Gods to detect
Mate in N? … Ditch the dumbass rule." The "never consults the engine"
clause is repealed for MATE and only for mate. When the quake roll passes,
the duel gathers mate lines — the enemy's fresh reply search, a fixed-depth
probe of the board, and one of the turn-flipped "trap is set" board
(`mateGo` `depth 12 movetime 600`) — and every principal variation is
replayed on ffish into the protected set: movers, destinations, paths, the
loser's king zone at the end of the line and now. The grid search stays as
the exact win-in-1 check and the fallback for a failed probe.

Three rounds on the same 24 deals per arm:

- **v4h** — the probes as first wired. Short-mate moves 2/6 · 0/7 · 0/17
  (v4g: 0/1 · 4/8 · 0/9). Reading the eleven moved mates across all
  distances: in four the probe found NO line where the referee saw a mate
  (in 3, 8, 11 and 13). Replaying those positions uncontended: a depth-12
  probe finishes in 27–180 ms and finds the mate in 3 every time from a
  FRESH hash, but run on the transposition table the depth-8 reply search
  had just left, one trial in three reported +12 instead. The referee,
  probing after the game with a hindsight-filled table, saw more mates
  than a fresh search does.
- **v4i** — the probe clears the hash first. Every remaining moved mate now
  had the engine's line IN HAND (mates ≥ 1 on all eleven), and three of
  them were single WEAKENS: a cracked wall next to a net is a capture the
  defender can spend on an escape — "safe by construction" is false there.
- **v4j (shipped)** — while a mate line exists, every wall or crate the
  LOSING side could capture is off limits to the terrain rungs
  (`tactics.mjs terrainReach`). Moved mates, all distances: **1/9 · 2/10 ·
  3/29** (baseline 35/96 · 30/98 · 48/110); mate-in-3 or less: **0/4 ·
  1/6 · 0/17** (baseline 12/43 · 15/55 · 23/57). The six that remain: a
  mate in 6 delayed to 8 and a mate in 2 delayed to 3 by pawn
  displacements outside the line, a mate in 9 delayed to 10, and three
  mates in 4–8 that became +15 to +23 pawns — decided positions, not the
  "+10 that runs twenty turns longer". Pacing 3.3 / 7.4 / 11.0 q/100p, 24/24
  terminated in every arm, double-touch 0, the engine handing the gods a
  line on 7–9% of quakes.

```
corpus                 games  ended  med plies  q/100p  act/q  gap=1  med gap  dbl-touch  un-mate  un-mate≤3  heat  pinned  floor  dead  terrain  prot pcs   eng mates
wave6-calm-v3base      24     100%   200.5      13.8    1.57   53%    1        21%        35/96    12/43      —     4%      50%    0%    37%      —          —        
wave6-restless-v3base  24     100%   182.5      17.2    1.77   32%    2        28%        30/98    15/55      —     0%      37%    0%    25%      —          —        
wave6-wrathful-v3base  24     100%   171        32.1    2.98   59%    1        55%        48/110   23/57      —     10%     18%    0%    17%      —          —        
wave6-calm-v4g         24     100%   196.5      3.7     1.72   12%    8        0%         1/4      0/1        43%   0%      0%     42%   53%      0 (0 cut)  —        
wave6-restless-v4g     24     100%   197.5      7.0     2.33   9%     7        0%         9/16     4/8        44%   0%      0%     34%   39%      0 (0 cut)  —        
wave6-wrathful-v4g     24     100%   157        10.6    2.79   13%    5        0%         3/16     0/9        49%   0%      0%     22%   27%      0 (0 cut)  —        
wave6-calm-v4h         24     96%    214.5      4.0     1.63   7%     8        0%         3/11     2/6        42%   0%      0%     39%   50%      2 (0 cut)  50/211   
wave6-restless-v4h     24     100%   190        7.0     2.36   10%    7        0%         4/16     0/7        44%   0%      0%     32%   36%      0 (0 cut)  22/324   
wave6-wrathful-v4h     24     100%   173.5      12.5    2.81   18%    4        0%         4/32     0/17       48%   0%      0%     38%   22%      0 (0 cut)  40/584   
wave6-calm-v4i         24     100%   214        3.4     1.70   12%    11       0%         3/12     1/5        42%   0%      0%     27%   51%      0 (0 cut)  15/167   
wave6-restless-v4i     24     100%   226        7.9     2.47   13%    6        0%         6/18     1/10       43%   0%      0%     42%   30%      0 (0 cut)  26/440   
wave6-wrathful-v4i     24     100%   182        11.8    2.84   16%    4        0%         4/29     1/15       46%   0%      0%     33%   19%      2 (0 cut)  41/492   
wave6-calm-v4j         24     100%   199        3.3     1.69   13%    11.5     0%         1/9      0/4        43%   0%      0%     27%   53%      0 (0 cut)  11/158   
wave6-restless-v4j     24     100%   214        7.4     2.47   13%    6        0%         2/10     1/6        44%   0%      0%     40%   34%      0 (0 cut)  14/395   
wave6-wrathful-v4j     24     100%   169.5      11.0    2.80   14%    5        0%         3/29     0/17       47%   0%      0%     28%   20%      2 (0 cut)  37/446
```

Cost: two probes per quake, 30–340 ms each uncontended at depth 12–14 on
late 10×10 positions; quakes are 3–11 per 100 plies. Replay: the probes are
depth-bounded, so a corpus replays unless a probe's movetime binds.
