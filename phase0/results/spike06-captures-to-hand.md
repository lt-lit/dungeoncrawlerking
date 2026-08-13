# Spike 6 — capturesToHand: per-color?

**Question (§9.6):** "capturesToHand per-color? Expected answer: no (variant-wide
only). Confirm, then design the boss modifier as symmetric."

**Script:** `spikes/spike06-captures-to-hand.mjs` (7/7 checks pass).
**Builds:** ffish.js `010526 LB`; engine `5589ea54 LB`; classical eval.

## Verdict: PASS — variant-wide only, as expected. §4.4's `[PROVISIONAL]` resolves to: not a general rule.

## Findings

1. **`capturesToHand` is variant-wide only.** The documented option grammar has no
   per-color spelling, and behavioral probes confirm it: configs containing
   `capturesToHandWhite = true` or `whiteCapturesToHand = true` load without
   error but the captured piece never reaches the pocket — the keys do not exist.
2. **Footgun: unknown config keys are silently ignored** (no parser error in
   either library). A typo in a generated variant block produces a legal-looking
   variant with silently-wrong rules. The duel generator should validate every
   key it emits against the documented option list (generation-time lint).
3. **Variant-wide `capturesToHand=true` + `pieceDrops=true` works fully:** white's
   capture fills white's pocket (`board.pocket()`), drop moves (`P@sq`) appear,
   pockets round-trip through FEN `[...]`, the engine plays legally under the
   rules, and perft(1) matches ffish with pockets in play (32/32, 24 of them
   drops).

## Design implications

- **The "Necromancer" boss modifier is symmetric by necessity**, exactly as §4.4
  anticipated. Validated block (on top of the duel baseline):

  ```ini
  pieceDrops = true
  capturesToHand = true
  ```

- Both sides gain the mechanic in a Necromancer duel — the asymmetric-advantage
  philosophy (§13) then lives in the player's superior drop *placement*, plus
  whatever material edge the encounter grants.
- Drop-move UCI/SAN uses `@` notation; UI work lands in Phase 1+ only if the boss
  ships.
