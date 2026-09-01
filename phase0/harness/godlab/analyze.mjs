// God-lab corpus analysis: aggregate run.mjs JSONL into the §7 calibration
// readouts, per arm and per arm × stage class.
//
// The metric list is the designer's 2026-09-01 playtest report turned into
// numbers ("even Calm reshapes the whole arena; breach strips rooms bare"):
//
//   pacing     — plies q1/med/q3, time-to-first-quake, quakes & actions per
//                100 plies, mixed-rung share, ladder split by ACTION
//   terrain    — attrition: authored walls+crates remaining at game end (%),
//                crates remaining (%), holes at end; the "stage stops being
//                the stage" curve
//   lock       — locked pawns start → end (the §6 lint's replacement: if v3
//                clears locks, the lint stays dead; if boards still go
//                inert, it comes back as a generator lint)
//   alarm      — §7 REVISED: eval sign flips per refereed quake and per
//                game, treated as a comparison BETWEEN configs, plus mean
//                |eval delta| per quake
//   discipline — terminations (earthquake endings should be low, non-zero),
//                quakes fired while a king was in check (must be 0), errors,
//                retries, engine stalls
//
// Usage: node harness/godlab/analyze.mjs <godlab-*.jsonl ...> [--by-class]
import fs from 'fs';

const DEADBAND = 50; // cp band treated as "equal" for flip detection (§7)

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const BY_CLASS = process.argv.includes('--by-class');
if (!files.length) {
  console.error('usage: node harness/godlab/analyze.mjs <godlab-*.jsonl ...> [--by-class]');
  process.exit(2);
}

const lines = files.flatMap((f) =>
  fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
);

const q = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.floor(p * (s.length - 1))] : NaN;
};
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN);
const pct = (v) => `${(100 * v).toFixed(1)}%`;
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');

const scoreNum = (s) =>
  s == null ? null : s.type === 'mate' ? (s.value > 0 ? 1e6 - s.value : -1e6 - s.value) : s.value;
const sign = (v) => (v > DEADBAND ? 1 : v < -DEADBAND ? -1 : 0);

function summarizeGroup(games) {
  const played = games.filter((g) => !g.skipped && g.plies !== undefined);
  const errors = played.filter((g) => g.error);
  const ok = played.filter((g) => !g.error);

  const terminations = {};
  for (const g of ok) terminations[g.termination ?? '?'] = (terminations[g.termination ?? '?'] ?? 0) + 1;

  // pacing
  const plies = ok.map((g) => g.plies);
  const allQuakes = ok.flatMap((g) => g.quakes.map((k) => ({ ...k, game: g })));
  const actions = allQuakes.reduce((a, k) => a + k.rungsSpent.length, 0);
  const firstQuake = ok.filter((g) => g.quakes.length).map((g) => g.quakes[0].ply);
  const mixed = allQuakes.filter((k) => new Set(k.rungsSpent).size > 1).length;
  const ladder = {};
  for (const k of allQuakes) for (const r of k.rungsSpent) ladder[r] = (ladder[r] ?? 0) + 1;
  const totalPlies = plies.reduce((a, b) => a + b, 0);

  // terrain attrition (authored walls+crates vs what the last ply's trail saw)
  const attrition = ok
    .filter((g) => g.trail?.walls?.length && g.authored)
    .map((g) => {
      const t0 = g.authored.walls + g.authored.crates;
      const end = g.trail.walls.at(-1) + g.trail.crates.at(-1) - g.holesEnd; // holes render as '*' — not standing terrain
      return t0 > 0 ? { total: end / t0, crates: g.authored.crates > 0 ? g.trail.crates.at(-1) / g.authored.crates : null } : null;
    })
    .filter(Boolean);
  // NOTE crates-remaining can exceed 100%: weakens mint new crates from
  // walls. That is exactly the wall→crate→floor pipeline reading on it.

  // locked pawns start → end
  const lock = ok
    .filter((g) => g.trail?.lockedPawns?.length)
    .map((g) => ({ start: g.trail.lockedPawns[0], end: g.trail.lockedPawns.at(-1) }));

  // §7 alarm metric
  const probed = allQuakes.filter((k) => k.evalBefore && k.evalAfter);
  const flips = probed.filter((k) => {
    const b = sign(scoreNum(k.evalBefore));
    const a = sign(scoreNum(k.evalAfter));
    return b !== 0 && a !== 0 && b !== a;
  });
  // |Δeval| only where BOTH probes are cp scores — a mate probe's ±1e6
  // sentinel would swamp the mean (flip detection above still sees mates).
  const deltas = probed
    .filter((k) => k.evalBefore.type === 'cp' && k.evalAfter.type === 'cp')
    .map((k) => Math.abs(scoreNum(k.evalAfter) - scoreNum(k.evalBefore)));
  const flipGames = new Set(flips.map((k) => k.game)).size;

  const heldFires = allQuakes.filter((k) => k.held).length;

  // Swallows: crumbles that ate a piece. Since 2026-09-01 quakes cannot
  // swallow (occupied squares are not crumble candidates), so this must be
  // EXACTLY 0 on any corpus from the current Director — a regression guard,
  // not a tuning dial. A non-zero count means the no-swallow rule broke.
  const swallows = allQuakes.filter((k) => k.crumble?.pieceLost);

  return {
    games: played.length,
    skipped: games.length - played.length,
    errors: errors.length,
    retried: played.filter((g) => g.retried).length,
    stalls: ok.reduce((a, g) => a + (g.anomalies?.filter((x) => x.includes('recycling')).length ?? 0), 0),
    terminations,
    plies: `${q(plies, 0.25)}/${q(plies, 0.5)}/${q(plies, 0.75)}`,
    firstQuakeMed: q(firstQuake, 0.5),
    quakesPer100: totalPlies ? (100 * allQuakes.length) / totalPlies : 0,
    actionsPer100: totalPlies ? (100 * actions) / totalPlies : 0,
    actionsPerQuake: allQuakes.length ? actions / allQuakes.length : 0,
    mixedShare: allQuakes.length ? mixed / allQuakes.length : 0,
    ladder: Object.fromEntries(Object.entries(ladder).map(([k, v]) => [k, actions ? v / actions : 0])),
    terrainEnd: mean(attrition.map((a) => a.total)),
    cratesEnd: mean(attrition.map((a) => a.crates).filter((v) => v !== null)),
    holesEnd: mean(ok.map((g) => g.holesEnd ?? 0)),
    swallowed: swallows.length,
    swallowedPerGame: ok.length ? swallows.length / ok.length : 0,
    swallowMedPly: q(swallows.map((k) => k.ply), 0.5),
    lockStart: mean(lock.map((l) => l.start)),
    lockEnd: mean(lock.map((l) => l.end)),
    probed: probed.length,
    flipRate: probed.length ? flips.length / probed.length : NaN,
    flipGameRate: ok.length ? flipGames / ok.length : NaN,
    meanAbsDelta: mean(deltas),
    heldFires,
  };
}

function render(label, s) {
  const lad = ['weaken', 'breach', 'displace', 'crumble', 'terminal']
    .filter((r) => s.ladder[r])
    .map((r) => `${r} ${pct(s.ladder[r])}`)
    .join(' · ');
  console.log(`\n== ${label} — ${s.games} games (${s.skipped} skipped, ${s.errors} errors, ${s.retried} retried, ${s.stalls} stalls)`);
  console.log(`  terminations: ${JSON.stringify(s.terminations)}`);
  console.log(`  plies q1/med/q3 ${s.plies} · first quake med ply ${s.firstQuakeMed}`);
  console.log(
    `  quakes ${f1(s.quakesPer100)}/100p · actions ${f1(s.actionsPer100)}/100p (${s.actionsPerQuake.toFixed(2)}/quake, mixed ${pct(s.mixedShare)})`
  );
  console.log(`  ladder by action: ${lad || '(no god activity)'}`);
  console.log(
    `  terrain remaining at end: ${Number.isFinite(s.terrainEnd) ? pct(s.terrainEnd) : '-'} of authored` +
      ` (crates ${Number.isFinite(s.cratesEnd) ? pct(s.cratesEnd) : '-'}) · holes ${f1(s.holesEnd)}` +
      ` · swallowed ${s.swallowed} pieces (${s.swallowedPerGame.toFixed(2)}/game${s.swallowed ? `, med ply ${s.swallowMedPly}` : ''})`
  );
  console.log(`  locked pawns start→end: ${f1(s.lockStart)} → ${f1(s.lockEnd)}`);
  console.log(
    `  alarm: ${s.probed} refereed quakes, flip rate ${Number.isFinite(s.flipRate) ? pct(s.flipRate) : '-'} ` +
      `(games with a flip: ${Number.isFinite(s.flipGameRate) ? pct(s.flipGameRate) : '-'}) · mean |Δeval| ${f1(s.meanAbsDelta)}cp`
  );
  console.log(`  fired while a king was in check: ${s.heldFires}${s.heldFires ? '  ← MUST BE 0' : ''}`);
}

const byArm = new Map();
for (const l of lines) {
  const key = l.arm ?? '?';
  if (!byArm.has(key)) byArm.set(key, []);
  byArm.get(key).push(l);
}
for (const [arm, games] of byArm) {
  render(`arm ${arm}`, summarizeGroup(games));
  if (BY_CLASS) {
    const byClass = new Map();
    for (const g of games) {
      const c = g.class ?? '?';
      if (!byClass.has(c)) byClass.set(c, []);
      byClass.get(c).push(g);
    }
    for (const [cls, sub] of [...byClass.entries()].sort()) render(`arm ${arm} / ${cls}`, summarizeGroup(sub));
  }
}
console.log('');
