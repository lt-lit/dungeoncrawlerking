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

// THE ICE (2026-09-24): the fourth sample — the first ice duel, the designer's
// phone log (vaults-2 at walk turn 24, restless, Android Firefox, 68 plies,
// 1-0 by checkmate) — renders with both casts of the ice on its timeline,
// the slides in words (a pawn's double step onto the patch sliding on to
// d8; a rook stopped on c5 by the pawn on c4), the field's slick squares
// growing cast by cast (eight from the player's d6 — e5 is a wall — fourteen
// once the enemy's b6 overlaps it), the enemy's portal pair cast after in
// one turn, and both kings hammering (the enemy's three times).
if (!process.argv[2]) {
  const L4 = JSON.parse(fs.readFileSync(path.join(ROOT, 'replay/samples/dck-log_vaults-2-t24_s3571496125.json'), 'utf8'));
  const full4 = R.renderReport(L4, { sections: R.SECTION_NAMES });
  const tl4 = R.timelineSection(L4);
  expect(full4.length > 10000 && full4.includes('world vaults-2') && /RESULT 1-0/.test(full4) && /checkmate/.test(full4) && /anomalies 0/.test(full4), 'the ice duel sample renders: the world line, 1-0 by checkmate, no anomaly');
  expect(tl4.some((l) => /I@d6/.test(l) && /the ice is cast/.test(l)) && tl4.some((l) => /I@b6/.test(l) && /the ice is cast/.test(l)), "both casts of the ice are on the timeline, the player's I@d6 and the enemy's I@b6");
  expect(tl4.some((l) => /\bd5\b/.test(l) && /slides to d8/.test(l)) && tl4.some((l) => /Rc5/.test(l) && /stops on c5/.test(l)), "the slides read in words: the pawn's double step onto the ice slides to d8, the rook stops on c5");
  const slick = (s) => (s.fen.match(/\{([^}]*)\}/)?.[1] ?? '').split(',').filter((e) => e.startsWith('~')).length;
  const s26 = L4.states[26], s34 = L4.states[34], s35 = L4.states[35], s39 = L4.states[39];
  expect(s26.cast === 'ice' && s26.mover === 'player' && slick(L4.states[25]) === 0 && slick(s26) === 8 && !/~e5/.test(s26.fen), "the player's cast ices the eight floor squares of d6's 3×3 — e5, a wall, takes none");
  expect(s39.cast === 'ice' && s39.mover === 'engine' && slick(s39) === 14 && slick(L4.states[L4.states.length - 1]) === 14, "the enemy's cast at b6 overlaps it — fourteen slippery squares, to the end");
  expect(s34.move === 'd3d5' && s34.slide?.steps?.length === 1 && s34.slide.steps[0].from === 'd5' && s34.slide.steps[0].to === 'd8' && /P/.test(s34.fen.split(' ')[0].split('/')[2]), "the state records the pawn's slide from d5 to d8, and the pawn stands on d8");
  expect(s35.move === 'c9c5' && s35.slide?.steps?.[0]?.to === 'c5' && /^[^ ]*/.test(s35.fen), "the rook's slide stops where it landed (a pawn stands on c4)");
  const hammers = L4.states.filter((s) => s.hammer).map((s) => `${s.ply}:${s.mover}:${s.san}`);
  expect(hammers.join(' ') === '1:engine:K*e10 4:player:K*e2 11:engine:K*f8 19:engine:K*g8', `both kings hammered — the enemy's three times (${hammers.join(' ')})`);
  expect(L4.states[41]?.cast === 'half' && L4.states[42]?.cast === 'pass' && L4.states[42]?.san === '--' && L4.states[43]?.cast === 'link' && /\{f4-c8,~a5/.test(L4.states[43].fen), "the enemy's portal pair follows in one turn — the half, the player's pass, the link — and the field names the pair before the ice");
  expect((L4.quakes?.length ?? 0) === 3 && (L4.branches?.length ?? 0) === 6 && (L4.anomalies?.length ?? 0) === 0 && !L4.engine.some((e) => e.recovered), 'three quakes landed, six undos, no anomaly, no recovered search');
}

// THE DECK (2026-09-25): the fifth sample — THE FIRST DECK DUEL, the
// designer's log on the card UI build (s77 The Smithy flipped, Firefox on
// Windows, the Adept deck against the starter's six spells): the header's
// decks line, the draws and the Reveal on the timeline, the enemy casting
// its whole deck from behind, the hands on every state.
if (!process.argv[2]) {
  const L5 = JSON.parse(fs.readFileSync(path.join(ROOT, 'replay/samples/dck-log_s77-the-smithy_s210339940.json'), 'utf8'));
  const full5 = R.renderReport(L5, { sections: R.SECTION_NAMES });
  const tl5 = R.timelineSection(L5);
  expect(full5.length > 10000 && /stage s77-the-smithy/.test(full5) && /RESULT 1-0/.test(full5) && /checkmate/.test(full5) && /anomalies 0/.test(full5) && /undos 5/.test(full5), 'the deck duel sample renders: s77, 1-0 by checkmate, no anomaly, five undos');
  expect(/decks  W 8 cards \/ B 6 cards \(as shuffled\)  draws 6  meta plays reveal @p10  hands at the end W \[Ice, Portal, Portal, Undo\] B \[—\]/.test(full5), `the header carries both decks, the six draws, the Reveal at ply 10 and the hands at the end (${full5.split('\n').find((l) => l.startsWith('decks')) ?? 'no decks line'})`);
  expect(tl5.some((l) => /^p 10 /.test(l) && /☉ Reveal played/.test(l)) && tl5.some((l) => /^p 12 /.test(l) && /🂠 W draws Portal/.test(l)) && tl5.some((l) => /^p 15 /.test(l) && /🂠 B draws Ice/.test(l)), 'the timeline marks the Reveal at ply 10 and the draws at the turns\' starts (W a portal after ply 12, B an ice after ply 15)');
  expect(tl5.some((l) => /^p 14 /.test(l) && /I@e5/.test(l) && /the ice is cast/.test(l)) && tl5.some((l) => /^p 36 /.test(l) && /O@a3/.test(l)) && tl5.some((l) => /^p 37 /.test(l) && /--/.test(l)) && tl5.some((l) => /^p 38 /.test(l) && /O@d3/.test(l)), "the enemy's casts read on the timeline: the ice at 14, a pair in one turn at 36–38");
  const by = (mover, kind) => L5.states.filter((s) => s.mover === mover && s.cast === kind).length;
  expect(by('engine', 'ice') === 3 && by('engine', 'link') === 3 && by('player', 'ice') === 2 && by('player', 'link') === 1, `the enemy cast its whole deck from behind — three ices and three portal pairs — the player two ices and a pair (${by('engine', 'ice')}/${by('engine', 'link')} vs ${by('player', 'ice')}/${by('player', 'link')})`);
  const last5 = L5.states[L5.states.length - 1];
  expect(L5.states[0].deck?.w?.hand?.length === 4 && L5.states[0].deck?.b?.hand?.length === 4 && L5.states.every((s) => s.deck) && last5.deck.w.spent.includes('reveal') && last5.deck.b.hand.length === 0 && last5.deck.b.pile.length === 0, 'every state carries both decks: hands of four at the start, the Reveal spent and the enemy\'s deck empty at the end');
  expect(L5.metaPlays?.length === 1 && L5.metaPlays[0].kind === 'reveal' && L5.metaPlays[0].ply === 10 && L5.states.filter((s) => s.drew).length === 6, 'the record holds the one meta play and six draws');
  expect((L5.quakes?.length ?? 0) === 8 && (L5.branches?.length ?? 0) === 5 && (L5.anomalies?.length ?? 0) === 0 && !L5.engine.some((e) => e.recovered), 'eight quakes landed, five undos, no anomaly, no recovered search');
}

for (const n of notes) console.log(n);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(failures.length ? `\n${failures.length} FAILED` : `\nPASS (${notes.length} checks)`);
process.exit(failures.length ? 1 : 0);
