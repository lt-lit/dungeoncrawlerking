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
import { portalLedger, portalInfo } from '../../play/js/fen.mjs';

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

// THE PORTAL SPELL (2026-09-17): the second sample — the first portal duel
// (vaults-4 at walk turn 75) — renders with its casts on the timeline, its
// field growing cast by cast, and the casters' ledger (fen.mjs portalLedger,
// the analyzer's walk) naming each pair's side.
if (!process.argv[2]) {
  const L2 = JSON.parse(fs.readFileSync(path.join(ROOT, 'replay/samples/dck-log_vaults-4-t75_s3904618753.json'), 'utf8'));
  const full2 = R.renderReport(L2, { sections: R.SECTION_NAMES });
  const tl2 = R.timelineSection(L2);
  expect(full2.length > 10000 && tl2.some((l) => /1… O@f5/.test(l)) && tl2.some((l) => /2\. O@b6/.test(l)) && tl2.some((l) => /3\. O@h8/.test(l)), 'the portal duel sample renders with its casts on the timeline');
  expect(full2.includes('world vaults-4') && /kings on file f/.test(full2) && /RESULT 1-0/.test(full2), 'its header carries the world line and the result');
  const fields = L2.states.slice(0, 6).map((s) => s.fen.match(/\{([^}]*)\}/)?.[1] ?? '').join('|');
  expect(fields === '||f5w|f5w,b6b|f5-i9,b6b|f5-i9,b6-h8', `the FEN field grows cast by cast through the states (${fields})`);
  const led = portalLedger(L2.states.map((s) => s.fen));
  const P = portalInfo(L2.states[5].fen, led);
  const own = (sq) => `${P.owner.get(sq)?.side}${P.owner.get(sq)?.n}`;
  expect(own('f5') === 'w0' && own('i9') === 'w0' && own('b6') === 'b0' && own('h8') === 'b0' && led.count.w === 1 && led.count.b === 1, `the ledger names the player's pair f5-i9 and the enemy's b6-h8 (${own('f5')} ${own('i9')} ${own('b6')} ${own('h8')})`);
  const H = portalInfo(L2.states[3].fen, portalLedger(L2.states.slice(0, 4).map((s) => s.fen)));
  expect(H.owner.get('f5')?.half === true && H.owner.get('f5')?.side === 'w' && H.owner.get('b6')?.half === true && H.owner.get('b6')?.side === 'b' && H.owner.get('b6')?.n === 0, 'at ply 3 both halves are open, each its caster\'s, numbered for the pair to come');
  expect(portalInfo(L2.states[5].fen).owner.get('f5')?.side === 'x', 'a bare FEN with no history paints every pair as nobody\'s');
}

// THE SLEDGEHAMMER (2026-09-17): the third sample — the first sledge duel,
// the designer's phone log (vaults-4 at walk turn 109) — renders with the
// hammer on its timeline (SAN `K*e4`, the state marked `hammer`, the wall a
// crate in the gods' ledger from that ply on) and every crumble of the
// wall-kinds build written as a `#` the holes ledger names, so the report's
// board prints it as a pit (`O`) and never as bedrock.
if (!process.argv[2]) {
  const L3 = JSON.parse(fs.readFileSync(path.join(ROOT, 'replay/samples/dck-log_vaults-4-t109_s3010228489.json'), 'utf8'));
  const full3 = R.renderReport(L3, { sections: R.SECTION_NAMES });
  const tl3 = R.timelineSection(L3);
  expect(full3.length > 10000 && tl3.some((l) => /K\*e4/.test(l)) && !tl3.some((l) => /[KQRBNP]\*[a-j]\d+/.test(l) && !/K\*e4/.test(l)), 'the sledge duel sample renders with its one hammer, K*e4, on the timeline');
  expect(full3.includes('world vaults-4') && /RESULT 1-0/.test(full3) && /anomalies 0|0 anomal/.test(full3), 'its header carries the world line, the result and no anomaly');
  const s16 = L3.states[16];
  expect(s16.san === 'K*e4' && s16.move === 'd3e4' && s16.hammer === 'e4' && s16.mover === 'player' && (s16.godCrates ?? []).includes('e4') && !(L3.states[15].godCrates ?? []).includes('e4'), 'the hammer\'s state carries `hammer: e4`, and e4 joins the gods\' crate ledger on that ply');
  expect(/\^/.test(s16.fen.split('/')[6]) && !L3.states.some((s, i) => i !== 16 && s.hammer), 'the hammered wall is a crate in the FEN, and no other state is marked');
  expect(s16.predicted === 'd3e4' && s16.followed === true, 'the enemy\'s own search had predicted the hammer (the followed line)');
  const last = L3.states[L3.states.length - 1];
  const hard = (last.fen.split('[')[0].match(/#/g) ?? []).length;
  expect(hard === 20 && last.holes.length === 20 && (L3.startFen.split('[')[0].match(/#/g) ?? []).length === 0, `every # on the final board is a pit the ledger names (${hard} of ${last.holes.length}), none at the start`);
  const rows = R.boardRows(last.fen, last, L3.files ?? 10);
  expect(rows.some((r) => /O/.test(r)) && !rows.some((r) => /#/.test(r)), 'the report prints those pits as O and never as a # wall');
  expect((L3.quakes?.length ?? 0) === 25 && (L3.quakeTraces?.length ?? 0) > 25 && (L3.branches?.length ?? 0) === 0, `twenty-five quakes fired of ${L3.quakeTraces?.length} rolls, no undo`);
}

for (const n of notes) console.log(n);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(failures.length ? `\n${failures.length} FAILED` : `\nPASS (${notes.length} checks)`);
process.exit(failures.length ? 1 : 0);
