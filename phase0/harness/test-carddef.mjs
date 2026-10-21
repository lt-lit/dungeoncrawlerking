// THE TERRAIN INTERPRETER's grammar on the page (play/js/carddef.mjs): the
// def parser against parser.cpp's rules (the legacy one-word kinds and their
// defaults, the shapes as offsets north-first, the targeting words and their
// numbers, the refusals), the shape grid for a face, the cast's cells (the
// clipped shape; a ray from the king through the anchor, over a pit, stopped
// by bedrock, capped), the changed squares by the per-square table, the words.
//   node harness/test-carddef.mjs
import { parseDef, shapeCells, shapeGrid, castCells, castChanges, defWords, targetBadge, STATE_EFFECTS, EFFECTS, TARGETS } from '../../play/js/carddef.mjs';

let pass = 0, fail = 0;
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };

// the legacy words
let d = parseDef('ice');
ok('ice alone is the 3x3 on the middle rows', d.effect === 'ice' && d.shape === 'xxx/xox/xxx' && d.target === 'middle' && d.cells.length === 9);
d = parseDef('win');
ok('win alone is cast on the king', d.effect === 'win' && d.target === 'king' && same(d.cells, [[0, 0]]));
ok('portal and meta take no shape', parseDef('portal').effect === 'portal' && parseDef('meta').effect === 'meta' && throws(() => parseDef('portal o any')));
// the library's defs
d = parseDef('hit1 o near');
ok('hit1 o near', d.effect === 'hit' && d.arg === 1 && d.target === 'near' && same(d.cells, [[0, 0]]));
d = parseDef('hit2 .x./xox/.x. near');
ok('the plus: five cells, the anchor in the middle', d.arg === 2 && d.cells.length === 5 && same([...d.cells].sort(), [[-1, 0], [0, -1], [0, 0], [0, 1], [1, 0]].sort()));
d = parseDef('wall x../xxo near');
ok('an L: the first row is the north — x.. is one rank up', d.cells.length === 4 && same([...d.cells].sort(), [[-2, 0], [-2, 1], [-1, 0], [0, 0]].sort()), JSON.stringify(d.cells));
d = parseDef('hit1 o ray');
ok('the lance: a ray with no cap', d.target === 'ray' && d.targetArg === 0);
ok('ray2 caps the ray at two', parseDef('hit1 o ray2').targetArg === 2);
ok('margin defaults to 2 and reads its number', parseDef('wall o margin').targetArg === 2 && parseDef('ice x/o/x margin3').targetArg === 3);
d = parseDef('drop p o camp');
ok('drop p o camp: the piece letter is its own token', d.effect === 'drop' && d.arg === 'p' && d.target === 'camp' && d.text === 'drop p o camp');
ok('sledge o king', parseDef('sledge o king').effect === 'sledge');
// the refusals, as the engine's
ok('refused: an unknown effect, a number on ice, hit3, a sledge not on the king, a ray with a shape, two anchors, no anchor, a bad char, a shape too large',
  throws(() => parseDef('melt o any')) && throws(() => parseDef('ice2 o any')) && throws(() => parseDef('hit3 o any')) && throws(() => parseDef('sledge o near'))
  && throws(() => parseDef('hit1 xox ray')) && throws(() => parseDef('hit1 oo any')) && throws(() => parseDef('hit1 xx any')) && throws(() => parseDef('hit1 xq any'))
  && throws(() => parseDef('ice xxxxxxxx/o any')) && throws(() => parseDef('drop o camp')) && throws(() => parseDef('hit1 o')));
// the grid for a face
const g = shapeGrid('x../xxo');
ok('the shape grid: 3 wide, 2 high, the anchor marked 2', g.w === 3 && g.h === 2 && same(g.rows, [[1, 0, 0], [1, 1, 2]]));
// the cast's cells on a board
const board = { d2: '*', e3: '*', e5: '*', e6: '^', e7: '#', f2: '_', g3: '*' };
const at = (s) => board[s] ?? null;
const B = { files: 8, ranks: 8, at, kingSq: 'e1' };
ok('a 3x3 at a1 is clipped to four squares', same(castCells(parseDef('hit1 xxx/xox/xxx any'), 'a1', B).sort(), ['a1', 'a2', 'b1', 'b2']));
ok('the lance north from e1: the anchor e2 on through e6, stopped by the bedrock on e7', same(castCells(parseDef('hit1 o ray'), 'e2', B), ['e2', 'e3', 'e4', 'e5', 'e6']));
ok('the lance north-east over the pit on f2 to the edge', same(castCells(parseDef('hit1 o ray'), 'f2', B), ['f2', 'g3', 'h4']));
ok('ray2 north: two squares', same(castCells(parseDef('hit1 o ray2'), 'e2', B), ['e2', 'e3']));
ok('a king-targeted cast covers the anchor alone', same(castCells(parseDef('sledge o king'), 'e1', B), ['e1']));
// what changes
const lance = castCells(parseDef('hit1 o ray'), 'e2', B);
ok('the lance changes e3, e5 and e6 (walls and the crate), passes e2 and e4', same(castChanges(parseDef('hit1 o ray'), lance, 'e2', { at }), ['e3', 'e5', 'e6']));
ok('ice changes floor not yet slippery', same(castChanges(parseDef('ice xox any'), ['d4', 'e4', 'f4'], 'e4', { at, slick: new Set(['e4']) }), ['d4', 'f4']));
ok('a wall changes empty floor off the portal squares', same(castChanges(parseDef('wall xox any'), ['c2', 'd2', 'e2'], 'd2', { at, portals: new Set(['c2']) }), ['e2']));
ok('petrify changes intact walls alone', same(castChanges(parseDef('harden xxx/xox/xxx any'), ['d2', 'e3', 'e6'], 'e2', { at }), ['d2', 'e3']));
ok('a drop changes its anchor', same(castChanges(parseDef('drop p o camp'), ['e2'], 'e2', { at }), ['e2']));
// THE PIECE STATES (Phase 3.4, 2026-10-21): the four words, the count on the timed ones, the changed squares, the words
d = parseDef('stun3 o any');
ok('stun3 o any: a stun for three plies, one square, anywhere', d.effect === 'stun' && d.arg === 3 && d.cells.length === 1 && d.target === 'any' && STATE_EFFECTS.has('stun') && EFFECTS.stun === 'state');
ok('control4 o any and invincible5 o any read their counts; entomb o any has none', parseDef('control4 o any').arg === 4 && parseDef('invincible5 o any').arg === 5 && parseDef('entomb o any').arg === null && parseDef('entomb o any').effect === 'entomb');
ok('stun3 xxx/xox/xxx any: a 3×3 stun', parseDef('stun3 xxx/xox/xxx any').cells.length === 9);
ok('refused: a timed effect without a count, a count of 0 or 16, a number on entomb', throws(() => parseDef('stun o any')) && throws(() => parseDef('control0 o any')) && throws(() => parseDef('invincible16 o any')) && throws(() => parseDef('entomb2 o any')));
ok('a piece effect changes the squares with a non-king piece of either colour (the king and the floor and the walls never)', same(castChanges(parseDef('stun3 xxx/xox/xxx any'), ['d6', 'e6', 'f6', 'a1', 'b2', 'e3'], 'e6', { at: (s) => ({ d6: 'r', e6: 'k', f6: 'N', a1: 'K', e3: '*' })[s] ?? null }), ['d6', 'f6']));
ok('words: the stun says the plies and that the piece still attacks', /cannot move for 3 plies/.test(defWords(parseDef('stun3 o any'))) && /still attacks/.test(defWords(parseDef('stun3 o any'))), defWords(parseDef('stun3 o any')));
ok('words: the control says it returns to its owner wherever it stands', /yours for 4 plies, then returns to its owner wherever it stands/.test(defWords(parseDef('control4 o any'))), defWords(parseDef('control4 o any')));
ok('words: the entomb says a hit frees it', /sealed in stone/.test(defWords(parseDef('entomb o any'))) && /until a hit frees it/.test(defWords(parseDef('entomb o any'))), defWords(parseDef('entomb o any')));
ok('the badge of a piece effect is its targeting word', targetBadge(parseDef('invincible5 o any')) === 'any');
// the words and the badge
ok('words: the crack', /crack one square beside your pieces/.test(defWords(parseDef('hit1 o near'))), defWords(parseDef('hit1 o near')));
ok('words: the lance', /a ray from your king: every wall on it cracks/.test(defWords(parseDef('hit1 o ray'))));
ok('words: the drop', defWords(parseDef('drop p o camp')) === 'place a pawn in your camp');
ok('badges', targetBadge(parseDef('wall o margin2')) === 'm2' && targetBadge(parseDef('hit1 o ray2')) === 'ray2' && targetBadge(parseDef('ice')) === 'mid');
// THE SIGHT WORD (sight.patch, 2026-10-21): `sight` and `sight<n>` as a targeting word of any effect; the badge, the words
d = parseDef('stun3 o sight');
ok('stun3 o sight: the sight word, no cap', d.target === 'sight' && d.targetArg === 0 && d.cells.length === 1 && TARGETS.includes('sight'));
ok('sight2 reads its cap; sight on a terrain card and on a shape too', parseDef('control4 o sight2').targetArg === 2 && parseDef('hit1 o sight').target === 'sight' && parseDef('stun3 xxx/xox/xxx sight').cells.length === 9);
ok('badges: sight and sight3', targetBadge(parseDef('entomb o sight')) === 'sight' && targetBadge(parseDef('stun3 o sight3')) === 'sight3');
ok('words: in sight of your pieces, the cap named', /one square in sight of your pieces: an enemy piece there is yours for 4 plies/.test(defWords(parseDef('control4 o sight'))) && /in sight of your pieces, within 2/.test(defWords(parseDef('stun3 o sight2'))), defWords(parseDef('stun3 o sight2')));
ok('refused: a number on near or any still', throws(() => parseDef('stun3 o near2')) && throws(() => parseDef('hit1 o any3')));
ok('the sight word restricts the anchor alone: castCells follows the shape as ever', same(castCells(parseDef('stun3 xxx/xox/xxx sight'), 'e5', B).sort(), ['d4', 'd5', 'd6', 'e4', 'e5', 'e6', 'f4', 'f5', 'f6']));
console.log(`\ntest-carddef: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
