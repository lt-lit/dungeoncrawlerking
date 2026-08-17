// Aggregate sweep JSONL into the §7 outputs: result distributions, game
// length in plies, crumble stats, and the crumble alarm metric.
import fs from 'fs';

export function summarize(records) {
  const byConfig = new Map();
  // Per-side labels (harness arena.mjs extensions): `label` names the side in
  // summaries; width/pawns overrides are appended so rows self-document.
  const sideName = (s) => {
    if (s.label) return s.label;
    const base = `${Array.isArray(s.comp) ? s.comp.join('') || 'K' : s.comp}/${s.arch ?? 'balanced'}`;
    const mods = [s.width !== undefined ? `w${s.width}` : null, s.pawns !== undefined ? `p${s.pawns}` : null]
      .filter(Boolean);
    return mods.length ? `${base}[${mods.join(',')}]` : base;
  };
  for (const r of records) {
    const m = r.arena;
    const key = `w${m.width} g${m.gap} d${m.wallDensity} ${sideName(m.white)} vs ${sideName(m.black)}`;
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
        quakes: 0,
        displacements: 0,
        crumbles: 0,
        oneSided: 0,
        piecesLostToCrumbles: 0,
        quakeFlipGames: 0,
        gamesWithQuakes: 0,
        lockedStart: 0,
        lockedEnd: 0,
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
    c.quakes += r.quakes.length;
    c.displacements += r.displacementCount ?? 0;
    c.crumbles += r.crumbleCount ?? 0;
    c.oneSided += r.oneSidedQuakes ?? 0;
    c.piecesLostToCrumbles += r.piecesLostToCrumbles ?? 0;
    c.lockedStart += r.lockedPawnsStart ?? 0;
    c.lockedEnd += r.lockedPawnsEnd ?? 0;
    if (r.quakes.length > 0) c.gamesWithQuakes++;
    if ((r.quakeFlips ?? 0) > 0) c.quakeFlipGames++;
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
      // §7 alarm metric: fraction of games where a QUAKE flipped the eval sign.
      // Displacement is the common case now, so this is measured per quake
      // rather than per crumble.
      alarmRate: c.games ? +(c.quakeFlipGames / c.games).toFixed(3) : 0,
      // §7 locked-pawn trajectory — the Director's actual job, measured
      // directly. Only displacement can free a terrain-locked pawn.
      lockedMeanStart: c.games ? +(c.lockedStart / c.games).toFixed(2) : 0,
      lockedMeanEnd: c.games ? +(c.lockedEnd / c.games).toFixed(2) : 0,
    };
  });
}

export function renderSummary(cfg, summary) {
  const lines = [];
  lines.push(`# Sweep summary: ${cfg.name}`);
  lines.push('');
  lines.push(`go: \`${cfg.go}\` · maxPlies: ${cfg.maxPlies ?? 400} · director: \`${JSON.stringify(cfg.director ?? null)}\` · seeds/config: ${cfg.seeds}`);
  lines.push('');
  lines.push('| config | val W/B | games | W wins | B wins | err | plies mean/med (min-max) | in 20-40 | quakes (disp/crumb) | 1-sided | pieces lost | locked start→end | alarm rate |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of summary) {
    lines.push(
      `| ${c.key} | ${c.whiteValue}/${c.blackValue} | ${c.games} | ${c.whiteWins} | ${c.blackWins} | ${c.errors} | ` +
        `${c.meanPlies}/${c.medianPlies} (${c.minPlies}-${c.maxPlies}) | ${c.inPacingBand}/${c.games} | ` +
        `${c.quakes} (${c.displacements}/${c.crumbles}) | ${c.oneSided} | ${c.piecesLostToCrumbles} | ` +
        `${c.lockedMeanStart}→${c.lockedMeanEnd} | ${c.alarmRate} |`
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
