# The replay analyzer

A replay log (`play/js/replaylog.mjs` `buildLog`, schema `dck-log/1` — the
game's Export buttons, its autosave ring, `__DCK.log.build()`) on the REAL
board, on the phone. Its own page, a sibling of `play/` on GitHub Pages:
`https://lt-lit.github.io/dungeoncrawlerking/replay/`. It imports the game's
modules (`../play/js/`), wears its stylesheets, and boots the game's engine
build for probes — so it needs the same cross-origin isolation, hence its own
copy of `coi-serviceworker.min.js` (service-worker scope: next to the page).

## Loading a log

- **From the game**: `▶ Review` on the end-of-game overlay opens the duel you
  just played (`?latest=1`); `Open` on the setup screen's saved-logs row opens
  one of the last three (`?slot=N`). Same origin, same `localStorage`: the
  analyzer reads the game's autosave ring directly.
- **A file**: the `⇩` button opens the load panel — a file picker (works on
  the phone), a paste box, the saved ring, and the committed sample. A file
  dropped anywhere on the page loads too.
- **By URL**: `?url=<same-origin path>` (`?sample=1` is
  `samples/dck-log_s77-the-smithy_s1818861954.json`, the designer's third log:
  77 plies, 3 quakes, 3 undos). `?ply=N` starts there.

Old logs load — fields missing before `replay-log.1`/`.2` (`mover`,
`candidates`, `pieceList`, `autoCrop`) shorten the readouts, never break them.
A stage the current build no longer carries paints without skins and says so.

## The screen

- **The board**: every recorded state (`states`) painted with ITS holes and
  god crates, the stage's skins (re-derived from the manifest by id, flip,
  crop and the king-anchored auto-crop — recorded since 2026-09-07, recovered
  from the start position for older logs) and the residue a forward walk
  rebuilds with the game's own rule (`board-ui.mjs residueStep`: an opened
  doorway where a door was captured, a ruin stub where a wall broke). The
  ply's move is an arrow — gold for the player, red for the enemy — and a
  quake's cracks, breaches, pit and displacements are its light-blue marks.
  The eval bar reads the enemy's last search (player POV), or the probe.
- **The scrub strip**: first / prev / next / last, a slider, jump to the
  next quake ⚡ / flag ⚑ / undo point ↶ (keyboard: `←` `→` `Home` `End`, `q`
  / `shift-q` for quakes). The ply line under it is the report's timeline
  line plus the meters.
- **The strips** (`js/strips.mjs`): two small charts under the slider on one
  x-axis (the ply) with a shared cursor — tap or drag either to scrub. *The
  gods*: P(quake) as a filled area, tedium, heat and FUN (1 − staleness,
  the fill rate's input) as lines, all on one 0…1 axis, each line lettered
  at the right edge (P / T / H / F, a leader in the line's colour), and a
  tick at every ply the gods acted (full height = a quake landed, half =
  the eval gate vetoed every draw); gold notches on the top edge are undo
  points. Every legend item is a TOGGLE for its series (the swatch hollows
  out when off; the choice persists on the device). *Eval*: the enemy's reply searches from YOUR point of
  view, clamped to ±10 pawns with a mate on the rail, a zero hairline; a
  probe made here is a ringed dot. The legend row above each is the readout
  at the cursor. Two measures of different scale are two charts, never a
  second y-axis; the series colours are validated on the panel surface
  (dark lightness band, colour-vision separation — no fourth hue clears
  the deutan floor against the other three, so fun sits in the 6–8 band
  the validator allows only with secondary encoding, which the letters and
  the toggles are) and the readout text never wears them.
- **The gods** (open by default): the report's quake block for this ply —
  the ladder path, the meters, the rolls, the ply's classification, the
  protected set with its members and keys, every rung's pool ranked with
  the pick marked, the rejects by reason, the engine inputs, the gate
  verdict, the rejected draws, timing. The parts that are square lists are
  BUTTONS that paint on the board: `before` (the pre-quake board), the
  protected set (pieces gold, squares blue), each rung's pool (the pick
  gold, the rest blue, rejects dim; displacement pools as arrows), each
  rejected draw's board, each engine hint's line as numbered arrows. A quiet
  ply shows its roll trace.
- **probe on demand**: `eval this board` and `deep Δ this quake` (the three
  boards: before the ply's move, before the quake, after it), on the page's
  own engine (booted on the first probe; the log's variant block is
  registered — rule 7), hash cleared, at the log's own limits by default
  (`?go=` or the field). One job at a time; a failed probe is said and the
  instance replaced (rule 12). Results attach to the loaded log
  (`state.probe`, `quake.deepDelta`), show on the ply line, the eval bar and
  the quake block, and `line as arrows` paints the probe's PV.
- **timeline**: one row per ply (tap to jump), fork rows that step INTO an
  abandoned line, and ⚙ tune rows where a preset, dial or favor changed
  mid-duel (a tune belongs to the line whose events surround its `seq`, so
  one made inside an abandoned line shows on that branch only). **undos**: every branch with `step into`. Inside a branch
  the scrubber runs over the parent's prefix plus the abandoned tail and
  ends on the exact pre-undo board; `↰ back to the line` steps out. Nested
  undos form a tree (`logreport.mjs lineTree`).
- **engine / anomalies / duel log / header**: the report's sections.
- **Top bar**: `⎗` copies the whole post-mortem as TEXT (paste it into a
  session); `⚑` exports the log — with every probe made here
  (`meta.analyzed`) — by share sheet, download or clipboard.

## One rendering

`play/js/logreport.mjs` is the ONE rendering of a log: `phase0/harness/
log-report.mjs` (the Node post-mortem) is a CLI over `renderReport`, and
this page prints the same functions' lines on the board. A wording change
lands in both; they cannot drift.

## Gates

```sh
cd phase0
node harness/test-logreport.mjs          # the shared rendering + lineTree + residue on the sample (Node)
node harness/replay-smoke.mjs --shots    # this page driven headlessly on the sample (Playwright, 64 checks incl. the strips and their toggles; screenshots in results/replay-smoke/)
```

Console / E2E surface: `window.__DCK.replay` — `open(data)`, `openUrl`,
`openSlot`, `goto`, `next`, `prev`, `nextQuake`, `prevQuake`, `enterBranch(id)`,
`leaveBranch`, `show('before' | 'protected' | {kind:'pool'|'attempt'|'hint',
index} | null)`, `probe()`, `deep()`, `export(force)`, `report(sections)`,
`toggleSeries(key)`, `waitIdle()`, getters `view` (line, ply, fen, marks, godsLine, plyLine,
evalText, stage, stageNote, skins, theme, engine, `strips` (plies, points,
ticks, the readout at the cursor, the cursor's x), `cell(sq)`), `log`, `tree`.
