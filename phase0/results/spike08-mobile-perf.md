# Spike 8 — Mobile perf: engine strength/latency at duel board sizes

**Question (§9.8):** "Engine strength/latency at these board sizes on a phone;
single-thread vs. threaded (coi-serviceworker)."

**Scripts:** `spikes/spike08-perf.mjs` (Node proxy, 7/7 checks pass) +
`spikes/spike08-mobile/` (static browser page, validated end-to-end in headless
Chromium incl. the cross-origin-isolation path).
**Builds:** engine `fairy-stockfish-nnue.wasm` 1.1.11 (`5589ea54 LB`, pthread build);
classical eval.

## Verdict: PASS (proxy) — phone numbers pending a real device, test page ready.

## Node proxy numbers (this container, 4-core x86)

- **Init → uciok:** 0.9–1.2 s. **50-variant duel catalog** (all dims 3–12 × 6–10,
  one variants.ini): ffish 558 ms + engine 24 ms, 15.6 KB.
- **Search at duel sizes** (movetime → depth reached / nps):

  | arena | 200 ms | 500 ms | 1000 ms | to depth 8 | to depth 12 |
  |---|---|---|---|---|---|
  | small 3x6 | d18, 272k nps | d23, 512k | d26, 547k | 5 ms | 23 ms |
  | standard 5x8 + walls | d16, 396k | d17, 393k | d18, 382k | 8 ms | 51 ms |
  | max 5x10 + walls | d18, 467k | d20, 467k | d23, 475k | 3 ms | 20 ms |

- **Headless Chromium (same machine):** init 1009 ms; small arena d16 at 200 ms —
  browser overhead is modest.
- **Memory:** ~713 MB RSS with THREE engine instances + ffish + catalog resident
  (init-time test keeps extras); a single engine instance is roughly a third of
  that. Fine for desktop; phone memory is a real-device question.

## Threading

- The build exposes `Threads` (1–512) and is a **pthread build referencing
  SharedArrayBuffer** — SAB is required even at Threads=1.
- **Threads=2 was SLOWER to fixed depth than Threads=1** in Node (86 ms vs 47 ms
  to depth 12 — lazy-SMP overhead dwarfs gains at these tiny search sizes).
- **Recommendation: ship Threads=1.** coi-serviceworker is still REQUIRED (SAB),
  but for isolation only, not for multi-threaded speed. It's vendored and proven:
  the page self-reloads once and `crossOriginIsolated` flips true.
  - Gotcha discovered: the serviceworker file must sit **next to index.html**
    (service worker scope), not in a vendor subdirectory — otherwise the page
    reload-loops forever.

## Phone protocol (deferred to a real device)

`spikes/spike08-mobile/README.md` has the serving instructions (GitHub Pages or
localhost port-forward — plain LAN http cannot work, no secure context → no SAB).
Pass thresholds: **init < 3 s; standard arena depth ≥ 10 at 500 ms**. Given the
proxy reaches d16–d23 at 500 ms, a 5–10x slower phone still lands at d12+ —
comfortable "full-strength feel" at these board sizes, but confirm on-device.

## Design implications

- **500 ms/move is a realistic mobile budget** at duel board sizes; even 200 ms
  looks viable on the small end.
- Boot path for the live game: init engine once, load the 50-variant catalog once
  (<1 s combined), then every duel is FEN-only. No per-duel load cost at all.
- GitHub Pages deployment needs coi-serviceworker at the app root from day one.
