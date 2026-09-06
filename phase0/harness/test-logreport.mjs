// The shared report module's Node gate (2026-09-07): play/js/logreport.mjs
// renders the committed sample log (replay/samples/) in full, the branch
// tree resolves the sample's undos, and an OLD-SHAPE log (the why-layer and
// state-annotation fields stripped, as a replay-log.0 export would be)
// renders without throwing. No engine, no browser.
//
// Usage: cd phase0 && node harness/test-logreport.mjs [log.json]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as R from '../../play/js/logreport.mjs';
import { classifyTerrain, residueStep } from '../../play/js/board-ui.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const file = process.argv[2] ?? path.join(ROOT, 'replay/samples/dck-log_s77-the-smithy_s1818861954.json');
const L = JSON.parse(fs.readFileSync(file, 'utf8'));

const failures = [];
const notes = [];
const expect = (ok, what) => (ok ? notes.push(`ok  ${what}`) : failures.push(what));

// --- the full report, every section ---------------------------------------
const full = R.renderReport(L, { sections: R.SECTION_NAMES });
expect(full.length > 10000, `full report renders (${(full.length / 1024).toFixed(0)} KB)`);
for (const title of ['REPLAY LOG', 'TIMELINE', 'QUAKES', 'UNDOS', 'FLAGS', 'ANOMALIES', 'ENGINE', 'DUEL LOG']) expect(full.includes(`═ ${title}`), `section ${title} present`);
const timeline = R.timelineSection(L);
const plyRows = timeline.filter((l) => /^p\s*\d+ /.test(l));
expect(plyRows.length === (L.moves?.length ?? 0), `one timeline row per ply (${plyRows.length} for ${L.moves?.length})`);
expect((L.branches ?? []).every((b, i) => timeline.some((l) => l.includes(`undo #${i + 1} rewound to`))), 'every undo is marked on the timeline');
for (const q of L.quakes ?? []) {
  const t = (L.quakeTraces ?? []).find((x) => x.ply === q.ply);
  const block = R.quakeBlock(q, t, { states: L.states, attempts: L.attempts ?? [], files: L.files });
  expect(block[0].startsWith(`⚡ ply ${q.ply}`), `quake block for ply ${q.ply}`);
  expect(block.some((l) => l.includes('path ')), `quake ${q.ply}: the ladder path is printed`);
  if (t?.candidates?.length) expect(block.some((l) => l.includes('◀ CHOSEN')), `quake ${q.ply}: the pick is marked in its pool`);
  const stacked = R.quakeBlock(q, t, { states: L.states, attempts: L.attempts ?? [], files: L.files, stacked: true });
  expect(stacked.includes('  before:') && stacked.includes('  after:') && stacked.length > block.length, `quake ${q.ply}: the stacked (phone) layout carries both boards`);
}
expect(R.deltaWords({ type: 'mate', value: 10 }, { type: 'cp', value: 900 }, 'the move') === "the move LOST white's mate-in-10", 'deltaWords: a lost mate');
expect(R.deltaWords({ type: 'cp', value: 100 }, { type: 'cp', value: 130 }, 'the quake') === 'the quake kept it (+0.3)', 'deltaWords: a kept position');

// --- the branch tree -------------------------------------------------------
const tree = R.lineTree(L);
expect(tree.lines.length === 1 + (L.branches?.length ?? 0), `lineTree: ${tree.lines.length} lines`);
for (const n of tree.lines) {
  if (n.id === 'main') continue;
  const b = L.branches[n.index];
  expect(n.states.length === n.plies + 1 || n.states.length === n.plies + 2, `${n.id}: one state per ply (+ an ended marker)`);
  expect(n.states[n.states.length - 1]?.fen === b.from.fen, `${n.id}: its last board is the pre-undo board`);
  expect(n.moves.slice(0, n.forkPly).join() === tree.byId.get(n.parent).moves.slice(0, n.forkPly).join(), `${n.id}: shares its parent's prefix`);
  expect(n.moves.slice(n.forkPly).join() === (b.tail.moves ?? []).join(), `${n.id}: the tail is the abandoned line`);
}
// A synthetic nested undo: undo to 6 after an undo to 8 → the first branch
// hangs off the second (its fork ply 8 was moved into the second's tail).
{
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ ply: i, fen: `f${i}` }));
  const S = {
    moves: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], sans: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], states: mk(8), engine: [], quakes: [], quakeTraces: [], attempts: [], anomalies: [], log: [], flags: [],
    branches: [
      { seq: 50, fromPly: 10, toPly: 8, from: { ply: 10, fen: 'x10' }, tail: { moves: ['i', 'j'], sans: ['i', 'j'], states: [{ ply: 9, fen: 'x9' }, { ply: 10, fen: 'x10' }] } },
      { seq: 80, fromPly: 9, toPly: 6, from: { ply: 9, fen: 'y9' }, tail: { moves: ['p', 'q', 'r'], sans: ['p', 'q', 'r'], states: [{ ply: 7, fen: 'y7' }, { ply: 8, fen: 'y8' }, { ply: 9, fen: 'y9' }] } },
    ],
  };
  const t = R.lineTree(S);
  const b1 = t.byId.get('branch-1');
  const b2 = t.byId.get('branch-2');
  expect(b2.parent === 'main' && b1.parent === 'branch-2', `nested undo: branch-1 hangs off branch-2 (got ${b1.parent} / ${b2.parent})`);
  expect(b1.states.map((s) => s.fen).join() === 'f0,f1,f2,f3,f4,f5,f6,y7,y8,x9,x10', `nested undo: branch-1's states run through branch-2's tail (${b1.states.map((s) => s.fen).join()})`);
  expect(b2.forks.length === 1 && b2.forks[0].id === 'branch-1' && t.main.forks.length === 1, 'nested undo: forks are attached to the right lines');
}

// --- an OLD-SHAPE log renders --------------------------------------------
const old = JSON.parse(JSON.stringify(L));
for (const s of old.states) for (const k of ['move', 'san', 'mover', 'predicted', 'followed', 'engineSaw']) delete s[k];
for (const t of old.quakeTraces) {
  for (const k of ['candidates', 'moveEv', 'threatKeys', 'stale', 'inputs', 'timing', 'evalGate']) delete t[k];
  if (t.protected) for (const k of ['pieceList', 'squareList', 'keys', 'by', 'engine']) delete t.protected[k];
}
delete old.autoCrop;
delete old.attempts;
delete old.flags;
for (const b of old.branches) delete b.tail.flags;
let oldReport = null;
try {
  oldReport = R.renderReport(old, { sections: R.SECTION_NAMES });
} catch (e) {
  failures.push(`old-shape log threw: ${e.message}`);
}
expect(oldReport && oldReport.length > 5000, 'old-shape log (no why layer, no state annotations, no flags) renders');
try {
  R.lineTree(old);
  notes.push('ok  old-shape log: lineTree');
} catch (e) {
  failures.push(`old-shape lineTree threw: ${e.message}`);
}
// --- the empty log ---------------------------------------------------------
try {
  const empty = R.renderReport({ schema: 'dck-log/1' }, { sections: R.SECTION_NAMES });
  expect(empty.includes('REPLAY LOG'), 'an empty log renders its header');
  R.lineTree({});
} catch (e) {
  failures.push(`empty log threw: ${e.message}`);
}

// --- the residue walk (the game's paintBoard rule on data) ----------------
{
  let res = { opened: new Set(), rubble: new Set() };
  const S = L.states;
  const firstRuin = [];
  for (let i = 1; i < S.length; i++) {
    const prev = { fen: S[i - 1].fen, holes: new Set(S[i - 1].holes), godCrates: new Set(S[i - 1].godCrates), ...res };
    res = residueStep(prev, { fen: S[i].fen, holes: new Set(S[i].holes) }, {}, L.files, L.ranks);
    if (res.rubble.size && !firstRuin.length) firstRuin.push(S[i].ply, [...res.rubble]);
  }
  // s77: the gods crack f7 at ply 12; the player takes it at ply 32 → a ruin.
  const crackedAt = L.quakes.find((q) => q.terrain?.some((e) => e.kind === 'weaken'));
  expect(!!crackedAt, 'the sample has a god-cracked wall');
  if (crackedAt) {
    const sq = crackedAt.terrain.find((e) => e.kind === 'weaken').square;
    expect(firstRuin[1]?.includes(sq), `the cracked wall at ${sq} leaves a ruin once captured (first ruin ${JSON.stringify(firstRuin)})`);
    const k = classifyTerrain(R.stateAt(L.states, crackedAt.ply).fen, { holes: new Set(), godCrates: new Set(R.stateAt(L.states, crackedAt.ply).godCrates) }, L.files, L.ranks).get(sq);
    expect(k?.cracked === true && k.mask >= 0, `classifyTerrain: ${sq} is a cracked wall with an autotile case after the quake`);
  }
}

for (const n of notes) console.log(n);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(failures.length ? `\n${failures.length} FAILED` : `\nPASS (${notes.length} checks)`);
process.exit(failures.length ? 1 : 0);
