# God-lab preliminary corpus — the first v3 numbers on the locked bed

2026-09-01. `harness/godlab/sweeps/prelim.json`, sized to the designer's
1–2h preliminary budget: 12-stage stratified spread × both orientations ×
2 seeds × four arms (off / calm / restless / wrathful), both seats at
`depth 8 movetime 250` (the god-behavior regime — this asks how the
DIRECTOR behaves, not how a human converts), referee `depth 8 movetime
200`. 192 games; in the god arms zero errors, zero engine stalls, zero
quakes fired into check. Corpus: `godlab-prelim-*.jsonl` alongside this
note. PRELIMINARY: 2 seeds, shallow referee, floorplan n=8/arm — read
directions, not third decimal places.

## 1. The termination service, quantified

Gods off, **20 of 48 games (42%) never terminate** in 600 plies — 12/28
core, 2/12 rooms, and **6 of 8 floorplan games**. Every god arm: 48/48
terminated. The wider bed is worse than ladder-smoke's 5/14 control
suggested; on multi-room maps a duel without the gods mostly just never
ends.

## 2. The designer's "Calm isn't calm" report — confirmed, and it's the staleness multiplier, not the preset

Calm fires **8.2 quakes/100 plies on core stages but 24.2/100 on
floorplans — 3×, and higher than wrathful's all-class average (20.8)**.
Stage class moves the quake rate more than the preset dial does.
First-quake ply is identical across classes (26 — onset gates the start);
the whole divergence is post-onset fill rate, i.e. staleness (out of
contact + cramped + locked pawns reads a floorplan as near-dead from
ply 1). Overall preset separation: calm 12.3 vs restless 14.3 quakes/100p
(weak — 16% apart) vs wrathful 20.8 (separates). This is Phase 1.5(c)'s
case: presets need to reach into the staleness knobs, and the contact
term probably needs to wait for first contact.

## 3. Terrain attrition — everything strips, calm included

Authored terrain remaining at game end: **calm 23.7% · restless 9.1% ·
wrathful 7.8%** (calm on floorplans: 17.9%, with 11 holes/game). The
gods-off control shows the armies alone account for a real share — 66.2%
remains with no gods at all, and authored CRATES specifically drop to
17.3% because play captures crates and nothing replenishes them (the god
arms' higher crate-remaining numbers are weaken minting new crates from
walls — the wall→crate→floor pipeline reading on itself). This is Phase
1.5(b)'s case: the conservation brake has to reason about authored
proportions, and the armies' own crate consumption is part of the budget.

## 4. Locked pawns — v3 clears them

Start → end means: 6.4 → 0.2–0.7 across the god arms (floorplans: 12.5 →
1.8); gods-off 6.0 → 1.5, and only among the 28 games that terminated at
all. The §6 promotion-reachability lint's deferral holds — the ladder is
doing the lint's job at runtime.

## 5. The alarm metric collapsed vs v2 — the rework did what it claimed

**2.6–3.8% of refereed quakes flip the eval sign** (games with ≥1 flip:
29% calm/restless, 44% wrathful; mean |Δeval| ≈ 100cp, quakes with both
probes cp-valued). The v2-era measurements put every configuration at
**31–75% of games** at an order of magnitude less quake volume. Moving
god activity onto the terrain rungs moved the harm out of it.

## 6. Ladder shape

By action: weaken 14–26% · breach 16–22% · displace 44–54% · crumble
8–16%; 1.4–2.6 actions/quake, 22–52% of quakes mixing rungs. Consistent
with ladder-smoke's split — displacement leads once a board's terrain
supply is spent, which is the structural fallback, not a preference.

## What this changes

Nothing is retuned yet — this is the before picture (instrument before
intervention). It confirms both queued Director changes are live targets:
1.5(b) the breach-side conservation brake (§3 above) and 1.5(c) preset
separation via the staleness path (§2). The next corpus after either
change compares directly against these files: same seeds, same deals,
same metrics.
