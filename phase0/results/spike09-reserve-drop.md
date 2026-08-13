# Spike 9 — Reserve-slot drop

**Question (§9.9):** "Reserve-slot drop (tiny pocket + dropRegion = own back
ranks) — verify now so the upgrade path stays open."

**Script:** `spikes/spike09-reserve-drop.mjs` (15/15 checks pass).
**Builds:** ffish.js `010526 LB`; engine `5589ea54 LB`; classical eval.

## Verdict: PASS — the upgrade path is open and cheap.

## Findings

1. **Validated config** (on top of the duel baseline; example for an 8-rank board):

   ```ini
   pieceDrops = true
   capturesToHand = false
   dropRegionWhite = *1 *2
   dropRegionBlack = *7 *8
   ```

   plus the reserve piece in the startFen pocket: `...[N] w - - 0 1`.
2. **Region grammar:** rank unions like `*1 *2` are shipped FSF grammar (used by
   existing variants) and work per-color. "Own back ranks" (plural) is directly
   expressible.
3. **Drop semantics all correct:** drop moves (`N@a2` style) generated only into
   the region; never onto walls; never onto occupied squares; pocket empties after
   the drop; **captures do NOT refill the hand** (`capturesToHand=false` — the
   one-shot reserve is a distinct mechanic from crazyhouse economy, confirmed
   independent).
4. **Engine:** plays legally with a reserve in hand, searches drop moves with sane
   scores (probed via `searchmoves N@a1`), and the reserve costs only ~37% more
   nodes to fixed depth — no search blow-up.
5. **perft(1) matches ffish with pockets** (15/15 including drops).
6. Spike 11 additionally verified pockets are compatible with mid-game FEN surgery
   (crumbles) — no interaction issues.

## Design implications

- The §8 shelf item is engineering-ready: granting a reserve = appending one
  pocket piece to the startFen + the four config lines above. Placement UI and
  economy sizing remain design work.
- FEN pockets and drop moves flow through lib/fen.mjs and the harness unchanged.
