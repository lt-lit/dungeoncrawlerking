// Meter lab analysis (Phase 1.3 evidence pass).
//
// Reads corpus JSONL files (run.mjs output) and reports the three
// measurements the redesign discussion hinges on:
//   A — HARM: what fraction of baseline ('restless') quakes fire on HOT
//       boards (side to move in check, or a forcing event within the last 3
//       plies), and how the offline eval referee scores them (mate-lost /
//       mate-delayed / sign-flip) hot vs stale.
//   B — COUNTERFACTUAL TIMING: among the harmful baseline quakes, how many
//       land on plies where the meter was QUIET (meterP < 0.25) — i.e. the
//       fraction of observed harm a meter trigger would simply not have
//       rolled for. (Timing overlay, not a replayed game: after the first
//       differing quake the timelines diverge; arm-vs-arm distributions
//       below are the real A/B.)
//   C — TERMINATION & PACING: per arm — every game must terminate (no
//       MAX_PLIES/error), plies distribution vs the §7 10-20-ply puzzle
//       band, termination mix, quake/crumble volume, eval-flip rate per
//       quake (§7 alarm), quakes-in-check rate, and how often the meter
//       arm's backstop floor (not the meter itself) was the binding trigger.
//
// Usage: cd phase0 && node harness/meterlab/analyze.mjs results/meterlab/corpus-*.jsonl
import fs from 'fs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node harness/meterlab/analyze.mjs <corpus.jsonl> [...]');
  process.exit(1);
}

const games = [];
for (const f of files) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (line.trim()) games.push(JSON.parse(line));
  }
}

const DEADBAND = 75; // cp band treated as "nobody is winning" for flip detection
const EVAL_NOTE = 'depth 12 movetime 300 — the Phase 1.2 instrument settings';

const num = (s) => (s.type === 'mate' ? (s.value > 0 ? 1e6 - s.value : -1e6 - s.value) : s.value);
const decisiveSign = (s) => {
  const v = num(s);
  return v > DEADBAND ? 1 : v < -DEADBAND ? -1 : 0;
};

/** Classify one quake's white-POV eval delta. Order matters: the mate
 *  categories subsume flips that pass through a mate score. */
function classify(b, a) {
  if (!b || !a) return 'no-data';
  if (b.type === 'mate') {
    if (a.type !== 'mate' || Math.sign(a.value) !== Math.sign(b.value)) return 'mate-lost';
    if (Math.abs(a.value) > Math.abs(b.value)) return 'mate-delayed';
    if (Math.abs(a.value) < Math.abs(b.value)) return 'mate-accelerated';
    return 'benign';
  }
  if (a.type === 'mate') return 'mate-created';
  const sb = decisiveSign(b);
  const sa = decisiveSign(a);
  if (sb !== 0 && sa !== 0 && sb !== sa) return 'sign-flip';
  if (Math.abs(a.value - b.value) >= 300) return 'big-swing';
  return 'benign';
}

const HARMFUL = new Set(['mate-lost', 'mate-delayed', 'sign-flip']);

/** Forcing event on any of the last `n` plies up to and including `ply`. */
function hotRecent(g, ply, n = 3) {
  for (let p = ply; p > ply - n && p >= 1; p--) {
    const e = g.plyEvents[p - 1] ?? '';
    if (/[cko]/.test(e)) return true; // capture, check, promotion (pawn quiet-push alone ≠ hot board)
  }
  return false;
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const quartiles = (arr) => {
  if (!arr.length) return '—';
  const s = [...arr].sort((x, y) => x - y);
  const q = (f) => s[Math.min(s.length - 1, Math.floor(f * (s.length - 1)))];
  return `${q(0.25)}/${median(arr)}/${q(0.75)}`;
};

const byArm = {};
for (const g of games) (byArm[g.arm] ??= []).push(g);

for (const [arm, gs] of Object.entries(byArm)) {
  console.log(`\n===== arm: ${arm} — ${gs.length} games =====`);
  const errors = gs.filter((g) => g.error);
  console.log(`errors/backstops: ${errors.length}${errors.length ? '  ← TERMINATION FAILURES:' : ''}`);
  for (const g of errors) console.log(`  - ${g.arena} seed ${g.seed}: ${g.error}`);
  const terms = {};
  for (const g of gs) terms[g.termination ?? 'error'] = (terms[g.termination ?? 'error'] ?? 0) + 1;
  console.log(`terminations: ${JSON.stringify(terms)}`);
  const playerWins = gs.filter((g) => g.winner === g.playerColor).length;
  console.log(`player (favored side) wins: ${playerWins}/${gs.length}`);
  console.log(`plies q1/med/q3: ${quartiles(gs.map((g) => g.plies))}`);
  console.log(`wall s q1/med/q3: ${quartiles(gs.map((g) => Math.round(g.wallMs / 1000)))}`);

  const quakes = gs.flatMap((g) => g.quakes.map((q) => ({ g, q })));
  const crumbles = quakes.filter(({ q }) => q.crumble);
  console.log(`quakes/game q1/med/q3: ${quartiles(gs.map((g) => g.quakes.length))}  (total ${quakes.length}, crumbles ${crumbles.length})`);
  const fell = gs.reduce((s, g) => s + g.fellThrough, 0);
  const outcomes = {};
  for (const g of gs) for (const [k, v] of Object.entries(g.outcomes)) outcomes[k] = (outcomes[k] ?? 0) + v;
  console.log(`quake-phase outcomes (all plies): ${JSON.stringify(outcomes)}  fellThrough ${fell}`);

  // --- board-state placement of fired quakes ---
  const inCheck = quakes.filter(({ q }) => q.preCheck === true);
  const hot = quakes.filter(({ g, q }) => q.preCheck === true || hotRecent(g, q.ply));
  const meterQuiet = quakes.filter(({ q }) => q.meterP !== null && q.meterP < 0.25);
  console.log(`fired with side-to-move IN CHECK: ${inCheck.length}/${quakes.length} (${pct(inCheck.length, quakes.length)})`);
  console.log(`fired on HOT board (check or forcing within 3 plies): ${hot.length}/${quakes.length} (${pct(hot.length, quakes.length)})`);
  console.log(`fired while meter QUIET (meterP<0.25): ${meterQuiet.length}/${quakes.length} (${pct(meterQuiet.length, quakes.length)})`);
  if (arm !== 'baseline') {
    const floorBound = quakes.filter(({ g, q }) => {
      const mc = g.meterConfig;
      const t = mc.thresholdM ?? 0;
      const meterOnly = (q.meterV ?? 0) < t ? 0 : Math.min(1, ((q.meterV ?? 0) - t) / mc.rampPlies);
      const floor = Math.min(1, Math.max(0, (q.ply - mc.floorOnsetPly) / mc.floorRampPlies));
      return floor > meterOnly;
    });
    console.log(`fired where the backstop FLOOR (not the meter) was binding: ${floorBound.length}/${quakes.length} (${pct(floorBound.length, quakes.length)})`);
  }

  // --- offline eval referee ---
  const probed = quakes.filter(({ q }) => q.evalBefore && q.evalAfter);
  const classes = {};
  for (const { g, q } of probed) {
    const c = classify(q.evalBefore, q.evalAfter);
    (classes[c] ??= []).push({ g, q });
  }
  console.log(`\neval referee (${probed.length}/${quakes.length} quakes probed, white POV, ${EVAL_NOTE}):`);
  for (const [c, arr] of Object.entries(classes).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${c}: ${arr.length} (${pct(arr.length, probed.length)})`);
  }
  const harmful = probed.filter(({ q }) => HARMFUL.has(classify(q.evalBefore, q.evalAfter)));
  const harmfulHot = harmful.filter(({ g, q }) => q.preCheck === true || hotRecent(g, q.ply));
  const harmfulInCheck = harmful.filter(({ q }) => q.preCheck === true);
  const harmfulMeterQuiet = harmful.filter(({ q }) => q.meterP !== null && q.meterP < 0.25);
  console.log(`HARMFUL (mate-lost/mate-delayed/sign-flip): ${harmful.length}/${probed.length} (${pct(harmful.length, probed.length)}) — ${(harmful.length / gs.length).toFixed(2)}/game`);
  console.log(`  … of which on HOT boards: ${harmfulHot.length}/${harmful.length} (${pct(harmfulHot.length, harmful.length)})`);
  console.log(`  … of which side-to-move in check: ${harmfulInCheck.length}/${harmful.length} (${pct(harmfulInCheck.length, harmful.length)})`);
  console.log(`  … of which on METER-QUIET plies (a meter trigger would rarely roll): ${harmfulMeterQuiet.length}/${harmful.length} (${pct(harmfulMeterQuiet.length, harmful.length)})`);

  // --- stage-geometry breakdown (varied stage set only) ---
  const staged = gs.filter((g) => g.stageMeta);
  if (staged.length) {
    const wallBucket = (m) => (m.walls === 0 ? 'walls 0' : m.walls <= 6 ? 'walls 1-6' : 'walls 7+');
    const groupings = [
      ['by walls', (m) => wallBucket(m)],
      ['by dims', (m) => m.dims],
    ];
    console.log(`\nstage-geometry breakdown (${staged.length} varied-stage games):`);
    for (const [label, keyOf] of groupings) {
      const rows = {};
      for (const g of staged) {
        const r = (rows[keyOf(g.stageMeta)] ??= { games: 0, fails: 0, quakes: 0, probed: 0, harm: 0, plies: [] });
        r.games++;
        if (g.error) r.fails++;
        r.plies.push(g.plies);
        for (const q of g.quakes) {
          r.quakes++;
          if (q.evalBefore && q.evalAfter) {
            r.probed++;
            if (HARMFUL.has(classify(q.evalBefore, q.evalAfter))) r.harm++;
          }
        }
      }
      console.log(`  ${label}:`);
      for (const [k, r] of Object.entries(rows).sort()) {
        console.log(
          `    ${k}: ${r.games} games · plies med ${median(r.plies)} · quakes/game ${(r.quakes / r.games).toFixed(1)} · ` +
            `harmful ${r.harm}/${r.probed} (${pct(r.harm, r.probed)})${r.fails ? ` · TERM FAILURES ${r.fails}` : ''}`
        );
      }
    }
  }

  // sample worst offenders for the findings doc
  const worst = harmful
    .map(({ g, q }) => ({ g, q, cls: classify(q.evalBefore, q.evalAfter) }))
    .slice(0, 8);
  if (worst.length) {
    console.log(`  samples:`);
    for (const { g, q, cls } of worst) {
      const fmt = (s) => (s.type === 'mate' ? `M${s.value}` : `${s.value}cp`);
      console.log(
        `    ${g.arena} seed ${g.seed} ply ${q.ply}: ${cls} ${fmt(q.evalBefore)}→${fmt(q.evalAfter)} ` +
          `${q.crumble ? `crumble ${q.crumble.sq}` : q.displacements.join(' + ')} ` +
          `(preCheck=${q.preCheck}, meterP=${q.meterP?.toFixed(2)})`
      );
    }
  }
}
