// Aggregate sweep JSONL into the §7 outputs: result distributions, game
// length in plies, crumble stats, and the crumble alarm metric.
import fs from 'fs';

export function summarize(records) {
  const byConfig = new Map();
  for (const r of records) {
    const m = r.arena;
    const key = `w${m.width} g${m.gap} d${m.wallDensity} ${m.white.comp}/${m.white.arch ?? 'balanced'} vs ${m.black.comp}/${m.black.arch ?? 'balanced'}`;
    if (!byConfig.has(key)) {
      byConfig.set(key, {
        key,
        whiteValue: m.whiteValue,
        blackValue: m.blackValue,
        games: 0,
        whiteWins: 0,
        blackWins: 0,
        other: 0,
        errors: 0,
        plies: [],
        crumbles: 0,
        repCrumbles: 0,
        pacingCrumbles: 0,
        piecesLostToCrumbles: 0,
        crumbleFlipGames: 0,
        gamesWithCrumbles: 0,
        anomalies: [],
      });
    }
    const c = byConfig.get(key);
    c.games++;
    if (r.error) c.errors++;
    else if (r.winner === 'white') c.whiteWins++;
    else if (r.winner === 'black') c.blackWins++;
    else c.other++;
    c.plies.push(r.plies);
    c.crumbles += r.crumbles.length;
    c.repCrumbles += r.crumbles.filter((x) => x.type === 'repetition').length;
    c.pacingCrumbles += r.crumbles.filter((x) => x.type === 'pacing').length;
    c.piecesLostToCrumbles += r.crumbles.filter((x) => x.pieceLost).length;
    if (r.crumbles.length > 0) c.gamesWithCrumbles++;
    if ((r.crumbleFlips ?? 0) > 0) c.crumbleFlipGames++;
    c.anomalies.push(...(r.anomalies ?? []).map((a) => `[${key}] ${a}`));
  }
  return [...byConfig.values()].map((c) => {
    const sorted = c.plies.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return {
      ...c,
      meanPlies: +(c.plies.reduce((s, p) => s + p, 0) / Math.max(1, c.plies.length)).toFixed(1),
      medianPlies: sorted.length ? sorted[mid] : 0,
      minPlies: sorted[0] ?? 0,
      maxPlies: sorted[sorted.length - 1] ?? 0,
      inPacingBand: c.plies.filter((p) => p >= 20 && p <= 40).length, // §7 target band
      // §7 crumble alarm metric: fraction of games where a crumble flipped the eval sign
      alarmRate: c.games ? +(c.crumbleFlipGames / c.games).toFixed(3) : 0,
    };
  });
}

export function renderSummary(cfg, summary) {
  const lines = [];
  lines.push(`# Sweep summary: ${cfg.name}`);
  lines.push('');
  lines.push(`go: \`${cfg.go}\` · maxPlies: ${cfg.maxPlies ?? 400} · crumble: \`${JSON.stringify(cfg.crumble ?? null)}\` · seeds/config: ${cfg.seeds}`);
  lines.push('');
  lines.push('| config | val W/B | games | W wins | B wins | err | plies mean/med (min-max) | in 20-40 | crumbles (rep/pace) | pieces lost | alarm rate |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of summary) {
    lines.push(
      `| ${c.key} | ${c.whiteValue}/${c.blackValue} | ${c.games} | ${c.whiteWins} | ${c.blackWins} | ${c.errors} | ` +
        `${c.meanPlies}/${c.medianPlies} (${c.minPlies}-${c.maxPlies}) | ${c.inPacingBand}/${c.games} | ` +
        `${c.crumbles} (${c.repCrumbles}/${c.pacingCrumbles}) | ${c.piecesLostToCrumbles} | ${c.alarmRate} |`
    );
  }
  const anomalies = summary.flatMap((c) => c.anomalies);
  lines.push('');
  if (anomalies.length) {
    lines.push(`## Anomalies (${anomalies.length})`);
    for (const a of anomalies.slice(0, 50)) lines.push(`- ${a}`);
    if (anomalies.length > 50) lines.push(`- ... and ${anomalies.length - 50} more`);
  } else {
    lines.push('No anomalies.');
  }
  lines.push('');
  return lines.join('\n');
}

// CLI: node harness/analyze.mjs results/sweep-foo.jsonl
if (process.argv[1] && process.argv[1].endsWith('analyze.mjs')) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node harness/analyze.mjs <sweep.jsonl>');
    process.exit(2);
  }
  const records = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  console.log(renderSummary({ name: file, go: records[0]?.go ?? '?', seeds: '?' }, summarize(records)));
}
