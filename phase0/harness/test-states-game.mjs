// THE PIECE STATES on the page (Phase 3.4, 2026-10-21; brief §4.10 "3.4
// RULED"; engine/patches/piece-states.patch): the FEN's records read and
// written (fen.mjs pieceStates / withStates / settleStates / stateChanges,
// carried through withSlick and withDeck), the grids reading an entombed
// piece as stone and an invincible one as uncapturable (director.mjs fenGrid,
// tactics.mjs gridOf, rays.mjs copyGrid), the gods' landing guard pricing no
// capture of an invincible piece and ending an exchange at an invincible
// captor (threat.mjs captureLoss), the slide stopping before a block and
// shoving a stunned piece (ice.mjs slideOutcome), the gods leaving a piece
// with a record alone (director.mjs displacementCandidates' blocked set),
// and — on the vendored ffish — the record's own reading of a cast and a
// return through castKind + stateChanges on real positions, the duel
// variant declaring the five cards. Needs the play/vendor overlay for the
// ffish half (engine/README.md). Usage: cd phase0 && node harness/test-states-game.mjs
import { pieceStates, withStates, settleStates, stateChanges, withSlick, withDeck, stateEntry, getSquare } from '../../play/js/fen.mjs';
import { fenGrid, displacementCandidates, uncapturableOf } from '../../play/js/director.mjs';
import { gridOf } from '../../play/js/tactics.mjs';
import { copyGrid } from '../../play/js/rays.mjs';
import { captureLoss, landingIsSafe } from '../../play/js/threat.mjs';
import { slideOutcome } from '../../play/js/ice.mjs';
import { castKind } from '../../play/js/duel.mjs';
import { CARDS, SPELL_KINDS, starterCards, deckDeclaration, newDeckState } from '../../play/js/deck.mjs';
import { dealVariant } from '../../play/js/variant.mjs';
import { loadFfish } from '../lib/load.mjs';

let pass = 0, fail = 0;
const check = (ok, what) => { process.stderr.write(`${ok ? 'ok ' : 'BAD'} ${what}\n`); if (ok) pass++; else fail++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- the field
{
  const fen = '4k3/p7/3r4/8/8/8/8/R2RK3[] w - - 0 1 {%a1i5,%d1e,%d6c4w}';
  const S = pieceStates(fen);
  check(S.size === 3 && same(S.get('a1'), { kind: 'invincible', count: 5, owner: null }) && same(S.get('d1'), { kind: 'entomb', count: null, owner: null }) && same(S.get('d6'), { kind: 'control', count: 4, owner: 'w' }), 'pieceStates reads an invincible, a block and a control with its owner');
  check(pieceStates('4k3/8/8/8/8/8/8/4K3 w - - 0 1').size === 0 && pieceStates('4k3/8/8/8/8/8/8/4K3[] w - - 0 1 {c3-h8,~e4,*w}').size === 0, 'a FEN without records reads empty, whatever else its field carries');
  check(stateEntry('e5', { kind: 'stun', count: 3 }) === '%e5s3' && stateEntry('e5', { kind: 'control', count: 4, owner: 'b' }) === '%e5c4b' && stateEntry('e5', { kind: 'entomb' }) === '%e5e', 'stateEntry writes the field\'s own spelling');
  const w = withStates('4k3/p7/3r4/8/8/8/8/R2RK3[] w - - 0 1 {~e4,*w,%a1s1}', { d6: { kind: 'control', count: 4, owner: 'w' }, a1: { kind: 'stun', count: 3 } });
  check(w === '4k3/p7/3r4/8/8/8/8/R2RK3[] w - - 0 1 {~e4,*w,%a1s3,%d6c4w}', `withStates replaces the records and keeps the rest of the field, in square order (${w})`);
  check(withStates(fen, []) === '4k3/p7/3r4/8/8/8/8/R2RK3[] w - - 0 1', 'withStates with no records drops the field');
  check(withSlick(fen, ['e4']) === '4k3/p7/3r4/8/8/8/8/R2RK3[] w - - 0 1 {~e4,%a1i5,%d1e,%d6c4w}', `withSlick carries the records last (${withSlick(fen, ['e4'])})`);
  const d = withDeck('4k3/p7/3r4/8/8/8/8/R2RK3[] w - - 0 1 {*w,%d6c4w}', { piles: { w: [1, 2], b: [] }, slots: { w: { s: { id: 1, n: 1 } }, b: {} } });
  check(d === '4k3/p7/3r4/8/8/8/8/R2RK3[S] w - - 0 1 {w|1.2,S=w1,*w,%d6c4w}', `withDeck carries the records after the deck and the flags (${d})`);
  const settled = settleStates(fen);
  check(settled === '4k3/p7/3R4/8/8/8/8/R2RK3[] w - - 0 1', `settleStates returns the controlled rook to White and drops every record (${settled})`);
  check(settleStates('4k3/8/3R4/8/8/8/8/4K3[] b - - 0 1 {c3-h8,%d6c2b}') === '4k3/8/3r4/8/8/8/8/4K3[] b - - 0 1 {c3-h8}', 'settleStates returns a piece to Black and keeps the pairs');
  check(settleStates('4k3/8/8/8/8/8/8/4K3 w - - 0 1') === '4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'settleStates leaves a plain FEN alone');
}
// ---- what a ply did to the records
{
  const a = stateChanges('4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {%a1s2}', '4k3/8/3R4/8/8/8/8/R3K3[] b - - 0 1 {%a1s1,%d6c4b}');
  check(a.set.length === 1 && a.ended.length === 0 && same(a.set[0], { sq: 'd6', kind: 'control', count: 4, owner: 'b', piece: 'R', was: 'r', prev: null }), `a cast's new record is set, a ticking one is not (${JSON.stringify(a)})`);
  const b = stateChanges('4k3/8/3R4/8/8/8/8/R3K3[] w - - 0 1 {%d6c1b}', '4k3/8/3r4/8/8/8/8/R4K2[] b - - 0 1');
  check(b.set.length === 0 && b.ended.length === 1 && same(b.ended[0], { sq: 'd6', kind: 'control', owner: 'b', piece: 'r', was: 'R' }), `a return at the count's end is an ended record with the piece home (${JSON.stringify(b.ended)})`);
  const c = stateChanges('4k3/8/3R4/8/8/8/8/R3K3[S] w - - 0 1 {%d6c4b,S=w70}', '4k3/8/3r4/8/8/8/8/R3K3[] b - - 0 1 {%d6s3}');
  check(c.set.length === 1 && c.set[0].kind === 'stun' && c.set[0].piece === 'r' && c.set[0].was === 'R' && same(c.set[0].prev, { kind: 'control', count: 4, owner: 'b' }) && c.ended.length === 0, 'an overwrite reports the record it replaced');
  const d = stateChanges('4k3/8/3r4/8/8/8/8/3RK3[] w - - 0 1 {%d6s3}', '4k3/8/3R4/8/8/8/8/4K3[] b - - 0 1');
  check(d.ended.length === 1 && d.ended[0].piece === 'R' && d.ended[0].was === 'r', 'a captured stunned piece: the record ends, another piece stands there');
  const e = stateChanges('4k3/8/3r4/8/8/8/8/R3K3[] w - - 0 1 {%d6s3}', '4k3/8/3r4/8/8/8/8/R3K3[] b - - 0 1 {%d6s3}');
  check(e.set.length === 0 && e.ended.length === 0, 'a record set this ply (no tick yet) is neither new nor ended on the next reading');
}
// ---- the grids
{
  const fen = '4k3/p7/3r4/8/8/8/8/R2RK3[] w - - 0 1 {%a1i5,%d1e,%d6c4w}';
  const g = fenGrid(fen, 8, 8), g2 = gridOf(fen, 8, 8);
  check(g[0][3] === '#' && g2[0][3] === '#' && g[5][3] === 'r' && g2[5][3] === 'r', 'both grid builders write an entombed piece as bedrock and leave a controlled one as it stands');
  check(g.uncapturable?.has('0,0') && g2.uncapturable?.has('0,0') && !g.uncapturable.has('3,5'), 'both grids carry the invincible square as uncapturable');
  const c = copyGrid(g);
  check(c.uncapturable === g.uncapturable && c.portals === g.portals && c[0][3] === '#', 'copyGrid keeps the uncapturable set with the pairs');
  check(fenGrid('4k3/8/8/8/8/8/8/4K3[] w - - 0 1', 8, 8).uncapturable === null, 'a grid without records has no uncapturable set');
  const unc = uncapturableOf('4k3/8/8/8/8/8/8/4K3[] w - - 0 1 {%e8i3,%e1s2}', fenGrid('4k3/8/8/8/8/8/8/4K3[] w - - 0 1', 8, 8));
  check(unc.size === 1 && unc.has('4,7'), 'uncapturableOf lists the invincible squares alone');
}
// ---- the landing guard: no capture of an invincible piece; an invincible captor ends the exchange
{
  const F = (sq) => sq.charCodeAt(0) - 97, Rk = (sq) => parseInt(sq.slice(1), 10) - 1;
  const loss = (fen, sq) => captureLoss(fenGrid(fen, 8, 8), F(sq), Rk(sq), 8, 8);
  const hanging = '4k3/8/8/8/3q4/8/8/R3K3[] w - - 0 1'; // a black queen on d4 under the rook? no: the rook on a1 does not see d4 — put it on d1
  check(loss('4k3/8/8/8/3q4/8/8/3RK3[] w - - 0 1', 'd4') === 900 && loss('4k3/8/8/8/3q4/8/8/3RK3[] w - - 0 1 {%d4i3}', 'd4') === 0, `a hanging queen loses 900; an invincible one nothing (${loss('4k3/8/8/8/3q4/8/8/3RK3[] w - - 0 1', 'd4')} / ${loss('4k3/8/8/8/3q4/8/8/3RK3[] w - - 0 1 {%d4i3}', 'd4')})`);
  void hanging;
  // a defended black pawn on d4 (by the pawn on e5) attacked by the white queen on d1: the queen loses the exchange (100 − 900 → 0 nets nothing)… unless she is invincible
  const defended = '4k3/8/8/4p3/3p4/8/8/3QK3[] w - - 0 1';
  check(loss(defended, 'd4') === 0, `a defended pawn is no gain for a queen (${loss(defended, 'd4')})`);
  check(loss(`${defended}[] w - - 0 1`.replace('[] w - - 0 1[] w - - 0 1', '[] w - - 0 1') + ' {%d1i9}', 'd4') === 100 || loss('4k3/8/8/4p3/3p4/8/8/3QK3[] w - - 0 1 {%d1i9}', 'd4') === 100, `an invincible queen wins the defended pawn outright (${loss('4k3/8/8/4p3/3p4/8/8/3QK3[] w - - 0 1 {%d1i9}', 'd4')})`);
  check(landingIsSafe(fenGrid('4k3/8/8/8/3Q4/8/8/4r1K1[] w - - 0 1 {%d4i2}', 8, 8), 3, 3, 8, 8) && !landingIsSafe(fenGrid('4k3/8/8/8/3Q4/8/8/3r2K1[] w - - 0 1', 8, 8), 3, 3, 8, 8), 'landingIsSafe: an invincible queen on a rook\'s file is safe, a plain one is not');
  // an entombed piece is stone: the rook behind it attacks nothing through it, and it is no victim
  check(loss('4k3/8/8/8/3q4/3n4/8/3RK3[] w - - 0 1 {%d3e}', 'd4') === 0 && loss('4k3/8/8/8/3q4/3n4/8/3RK3[] w - - 0 1 {%d3e}', 'd3') === 0, 'an entombed knight blocks the rook\'s file and loses nothing itself');
}
// ---- the slide
{
  const o = slideOutcome('4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {~a2,~a3,~a4,%a5e}', 'a1a4');
  check(o && o.steps.length === 1 && o.steps[0].to === 'a4' && o.steps[0].from === 'a4' && !o.steps[0].pit, `the rook's slide is listed at a4 (the last empty ice before the block) and it rests there (${JSON.stringify(o?.steps)})`);
  const o2 = slideOutcome('4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {~a2,~a3,~a4,~a5,%a5s2}', 'a1a2');
  check(o2 && o2.steps.length === 2 && o2.steps[1].piece === 'n' && o2.steps[1].from === 'a5' && o2.steps[1].to === 'a6', `a stunned knight on the ice is shoved like any piece (${JSON.stringify(o2?.steps)})`);
  const o3 = slideOutcome('4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {~a2,~a3,~a4,~a5,%a5e}', 'a1a2');
  check(o3 && o3.steps.length === 1 && o3.steps[0].to === 'a4', `an entombed knight on the ice is a wall: the rook stops on a4 and shoves nothing (${JSON.stringify(o3?.steps)})`);
}
// ---- the catalog and the deal's declaration
{
  check(SPELL_KINDS.length === 27 && ['stun', 'stun-area', 'invincible', 'control', 'entomb'].every((k) => SPELL_KINDS.includes(k)) && CARDS.stun.engine === 'stun' && CARDS.control.engine === 'control' && CARDS.entomb.def === 'entomb o any' && CARDS['stun-area'].def === 'stun3 xxx/xox/xxx any', 'the library holds the five piece-state cards, their effects their words');
  const decks = { w: newDeckState(starterCards('library'), 1), b: newDeckState(['stun', 'control'], 2) };
  const dv = dealVariant(8, 8, 2, 7, { portals: true, ice: true, deck: deckDeclaration(decks) });
  check(/card70 = stun3 o any\n/.test(dv.ini) && /card80 = control4 o any\n/.test(dv.ini) && /card85 = entomb o any\n/.test(dv.ini) && /card75 = invincible5 o any\n/.test(dv.ini) && /card71 = stun3 xxx\/xox\/xxx any\n/.test(dv.ini), 'the deal declares the five to the engine by their defs');
}
// ---- on the vendored ffish: the record's reading of a cast and a return
{
  const ffish = await loadFfish();
  const dv = dealVariant(8, 8, 2, 7, { portals: true, ice: true, deck: deckDeclaration({ w: { pile: ['stun', 'control', 'entomb', 'invincible'] }, b: { pile: ['stun'] } }) });
  ffish.loadVariantConfig(dv.ini);
  const f0 = '4k3/p7/3r4/8/8/8/P7/R3K3[STUVs] w - - 0 1 {S=w70,T=w80,U=w85,V=w75,S=b70}';
  check(ffish.validateFen(f0, dv.name) === 1, `the game's deal variant accepts a hand of the four piece-state cards (${dv.name})`);
  const b = new ffish.Board(dv.name, f0);
  const legal = b.legalMoves().split(' ').filter(Boolean);
  check(legal.includes('S@d6') && legal.includes('T@d6') && legal.includes('U@d6') && legal.includes('V@a1') && !legal.includes('S@e8') && !legal.includes('T@e1'), `the four cast on the non-king pieces of either colour, never a king (${legal.filter((m) => m.includes('@')).join(' ')})`);
  const before = b.fen();
  b.push('T@d6');
  const after = b.fen();
  check(castKind(before, 'T@d6', after) === 'control' && castKind(before, 'S@d6', after) === 'stun' && castKind(before, 'U@d6', after) === 'entomb' && castKind(before, 'V@a1', after) === 'invincible', 'castKind reads a piece effect by its word off the slot\'s card');
  const S = stateChanges(before, after);
  check(S.set.length === 1 && S.set[0].sq === 'd6' && S.set[0].kind === 'control' && S.set[0].count === 4 && S.set[0].owner === 'b' && S.set[0].piece === 'R' && S.set[0].was === 'r', `the record of record: the black rook on d6 is white's for four, owner black (${JSON.stringify(S.set)})`);
  b.push('e8f8'); b.push('d6d2'); b.push('f8e8');
  const f4 = b.fen();
  check(pieceStates(f4).get('d2')?.count === 1 && getSquare(f4, 'd2') === 'R', `three plies on, the record rides the rook to d2 at count 1 (${f4})`);
  b.push('e1f1');
  const f5 = b.fen();
  const R = stateChanges(f4, f5);
  check(pieceStates(f5).size === 0 && getSquare(f5, 'd2') === 'r' && R.ended.length === 1 && R.ended[0].sq === 'd2' && R.ended[0].piece === 'r' && R.ended[0].was === 'R', `white's move ends the count: the rook is black's again on d2, the record ended (${JSON.stringify(R.ended)})`);
  b.delete();
  // the gods leave a piece with a record alone: no displacement of it, and its square is no landing
  const fenG = '4k3/p7/3r4/8/8/8/P7/R3K3[] w - - 0 1 {%d6s3,%a1i2}';
  const tiers = displacementCandidates(ffish, dv.name, fenG, 8, 8, { touched: new Set(), pieces: new Set(), squares: new Set(), states: new Set(pieceStates(fenG).keys()) });
  const all = [...tiers.A, ...tiers.B, ...tiers.C];
  const movers = new Set(all.map((c) => c.from));
  const vetoed = tiers.rejected.filter((r) => r.reason === 'state').map((r) => r.from);
  check(all.length > 0 && !movers.has('d6') && !movers.has('a1') && vetoed.includes('d6') && vetoed.includes('a1'), `displacement candidates never move the stunned rook or the invincible one — both vetoed 'state' (movers ${[...movers].join(' ')}; vetoed ${[...new Set(vetoed)].join(' ')})`);
}
console.error(`states-game: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
