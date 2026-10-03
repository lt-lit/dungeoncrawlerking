// THE TERRAIN INTERPRETER's grammar on the page (Phase 3.3b, 2026-10-03;
// brief §4.10 "Phase 3.3b" and "3.3b RULED"; engine/patches/terrain.patch).
// A card is a DEFINITION the engine interprets over the board:
//
//     <effect> <shape> <targeting>        e.g.  hit1 xxx/xox/xxx near
//                                               drop p o camp
//
// EFFECTS: hit1 / hit2 (an intact wall cracks into a crate, a crate is
// floor; hit2 floors both at once; bedrock, pits and pieces untouched), ice
// (the floor of the shape slippery), wall / pit (empty floor rises as stone /
// sinks into a pit, the ice under it cleared), harden (an intact wall becomes
// bedrock), sledge (the caster's colour may hammer from now on), drop
// <letter> (a real piece of the caster placed on the anchor), win, portal,
// meta. SHAPES are picture strings: rows north to south separated by '/',
// 'x' a cell, 'o' the anchor (a cell too), '.' nothing; no rotation on cast
// (an L's four orientations are four cards); clipped at the board's edge.
// TARGETING: any (every anchor where the effect changes something), near
// (the anchor within a king's step of one of the caster's pieces), middle
// (the board's two middle rows), margin<n> (every cell n rows off both king
// rows), king (the caster's king's own square), ray / ray<n> (from the
// caster's king in one of eight directions, through pieces and over pits to
// bedrock or the edge; the cast is the drop on the king's neighbour in that
// direction), camp (an empty square of the caster's double-step region). A
// one-word value is a LEGACY kind with its old default: ice = ice xxx/xox/xxx
// middle, win = win o king, portal and meta as they were.
//
// This module is pure and mirrors parser.cpp's parse_card_def: the page never
// decides legality (ffish lists the legal casts), it only needs to READ a
// def — for the face (the effect's glyph, the shape's mini-map, the targeting
// badge), the drag preview and the hint (the cells a cast at an anchor would
// cover), the log's words, and the deal's declaration (the string itself).

/** The effect words the engine knows, with the kind of thing they do. */
export const EFFECTS = Object.freeze({
  hit: 'terrain', ice: 'terrain', wall: 'terrain', pit: 'terrain', harden: 'terrain',
  sledge: 'enchant', drop: 'piece', win: 'meta', portal: 'portal', meta: 'meta',
});
export const TARGETS = Object.freeze(['any', 'near', 'middle', 'margin', 'king', 'ray', 'camp']);
/** The effects whose cast is recorded by its own name in the duel record (`cast: 'hit' | 'wall' | …`; ice, win and the portal keep theirs). */
export const TERRAIN_EFFECTS = Object.freeze(new Set(['hit', 'wall', 'pit', 'harden', 'sledge', 'drop']));
export const MAX_SHAPE_CELLS = 32;

const LEGACY = { ice: ['xxx/xox/xxx', 'middle'], win: ['o', 'king'] };

/**
 * Parse a def string. Returns { effect, arg, shape, cells: [[df, dr]…] (board
 * space: +file east, +rank north; the anchor at [0, 0]), target, targetArg,
 * text } or throws on a malformed one (the engine would read it as a blank).
 * `arg` is the hits per square for a hit (1 or 2), the piece letter for a drop.
 */
export function parseDef(text) {
  const tok = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  if (!tok.length) throw new Error('empty card definition');
  const m = tok[0].match(/^([a-z]+)(\d*)$/);
  if (!m) throw new Error(`bad effect: ${tok[0]}`);
  const effect = m[1];
  const num = m[2] ? parseInt(m[2], 10) : null;
  if (!(effect in EFFECTS)) throw new Error(`unknown effect: ${effect}`);
  if (num !== null && effect !== 'hit') throw new Error(`a number on ${effect}`);
  let at = 1;
  let arg = null;
  if (effect === 'hit') {
    arg = num ?? 1;
    if (arg < 1 || arg > 2) throw new Error('hit takes 1 or 2');
  }
  if (effect === 'drop') {
    if (at >= tok.length || tok[at].length !== 1 || !/[a-z]/i.test(tok[at])) throw new Error('drop needs a piece letter');
    arg = tok[at].toLowerCase();
    at++;
  }
  if (effect === 'portal' || effect === 'meta') {
    if (at !== tok.length) throw new Error(`${effect} takes no shape`);
    return { effect, arg, shape: 'o', cells: [[0, 0]], target: 'any', targetArg: 0, text: tok.join(' ') };
  }
  let shape, target;
  if (at === tok.length && LEGACY[effect]) [shape, target] = LEGACY[effect];
  else if (at + 2 === tok.length) [shape, target] = [tok[at], tok[at + 1]];
  else throw new Error('expected <effect> <shape> <targeting>');
  const cells = shapeCells(shape);
  const tm = target.match(/^([a-z]+)(\d*)$/);
  if (!tm || !TARGETS.includes(tm[1])) throw new Error(`unknown targeting: ${target}`);
  const tword = tm[1];
  const tnum = tm[2] ? parseInt(tm[2], 10) : null;
  if (tnum !== null && tword !== 'margin' && tword !== 'ray') throw new Error(`a number on ${tword}`);
  const targetArg = tword === 'margin' ? (tnum ?? 2) : tword === 'ray' ? (tnum ?? 0) : 0;
  if ((effect === 'win' || effect === 'sledge') && tword !== 'king') throw new Error(`${effect} is cast on the king`);
  if (tword === 'ray' && cells.length !== 1) throw new Error("a ray's shape is o");
  return { effect, arg, shape, cells, target: tword, targetArg, text: tok.join(' ') };
}

/** A picture string's cells as [df, dr] offsets from its anchor (the first row is the north). */
export function shapeCells(shape) {
  const rows = String(shape).split('/');
  if (rows.length > 7 || rows.some((r) => r.length > 7)) throw new Error(`shape too large: ${shape}`);
  let anchor = null;
  const cells = [];
  rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === 'o') {
        if (anchor) throw new Error(`two anchors in ${shape}`);
        anchor = [r, c];
        cells.push([r, c]);
      } else if (ch === 'x') cells.push([r, c]);
      else if (ch !== '.') throw new Error(`bad shape: ${shape}`);
    });
  });
  if (!anchor) throw new Error(`no anchor in ${shape}`);
  if (cells.length > MAX_SHAPE_CELLS) throw new Error(`too many cells in ${shape}`);
  return cells.map(([r, c]) => [c - anchor[1], anchor[0] - r]);
}

/** The shape as a small grid for a card face: { w, h, rows: [[0|1|2…]] } with 1 a cell and 2 the anchor, north first. */
export function shapeGrid(shape) {
  const rows = String(shape).split('/');
  const w = Math.max(...rows.map((r) => r.length));
  return { w, h: rows.length, rows: rows.map((r) => [...r.padEnd(w, '.')].map((ch) => (ch === 'o' ? 2 : ch === 'x' ? 1 : 0))) };
}

const sq = (f, r) => String.fromCharCode(97 + f) + (r + 1);
const parseSq = (s) => { const m = String(s).match(/^([a-l])(10|[1-9])$/); return m ? [m[1].charCodeAt(0) - 97, parseInt(m[2], 10) - 1] : null; };

/**
 * The squares a cast of `def` at `anchor` covers on a files × ranks board — the
 * shape clipped to the board, or a ray from the caster's king (`kingSq`) on
 * through the anchor to bedrock or the edge (`at(sq)` the square's glyph:
 * '#' stops the ray, '_' is passed over, as the engine reads them), capped by
 * the def's length. For the drag preview, the hint's tint and the log.
 */
export function castCells(def, anchor, { files, ranks, at = () => null, kingSq = null } = {}) {
  const a = parseSq(anchor);
  if (!a) return [];
  if (def.target === 'ray') {
    const k = kingSq ? parseSq(kingSq) : null;
    if (!k) return [anchor];
    const df = Math.sign(a[0] - k[0]), dr = Math.sign(a[1] - k[1]);
    if (Math.abs(a[0] - k[0]) > 1 || Math.abs(a[1] - k[1]) > 1 || (!df && !dr)) return [anchor];
    const out = [];
    let [f, r] = a, n = 0;
    while (f >= 0 && f < files && r >= 0 && r < ranks) {
      const s = sq(f, r);
      if (at(s) === '#') break;
      out.push(s);
      if (def.targetArg && ++n >= def.targetArg) break;
      f += df; r += dr;
    }
    return out;
  }
  const out = [];
  for (const [df, dr] of def.cells) {
    const f = a[0] + df, r = a[1] + dr;
    if (f < 0 || f >= files || r < 0 || r >= ranks) continue;
    out.push(sq(f, r));
  }
  return out;
}

/**
 * The squares a cast would CHANGE, by the per-square table of the ruling (a
 * hit: walls and crates; ice: floor not yet slippery; wall / pit: empty floor
 * off every portal square; harden: intact walls; drop / sledge / win: the
 * anchor). `at(sq)` gives null for empty floor, a piece letter, or a terrain
 * glyph; `slick` and `portals` are Sets of squares. For the faithful half of
 * the preview and the log's words — never for legality.
 */
export function castChanges(def, cells, anchor, { at = () => null, slick = new Set(), portals = new Set() } = {}) {
  const terrain = (c) => c === '*' || c === '^' || c === '#' || c === '_';
  switch (def.effect) {
    case 'hit': return cells.filter((s) => at(s) === '*' || at(s) === '^');
    case 'ice': return cells.filter((s) => !terrain(at(s)) && !slick.has(s));
    case 'wall': case 'pit': return cells.filter((s) => at(s) == null && !portals.has(s));
    case 'harden': return cells.filter((s) => at(s) === '*');
    default: return [anchor];
  }
}

/** One line of words for a def, for a card's face and the reader. */
export function defWords(def) {
  const shapeWords = def.cells.length === 1 ? 'one square' : def.cells.length === 9 && def.shape === 'xxx/xox/xxx' ? 'a 3×3' : `${def.cells.length} squares (${def.shape})`;
  const where = { any: 'anywhere', near: 'beside your pieces', middle: 'on the middle rows', margin: `${def.targetArg} rows off the king rows`, king: 'on your king', ray: def.targetArg ? `a ray of ${def.targetArg} from your king` : 'a ray from your king', camp: 'in your camp' }[def.target];
  switch (def.effect) {
    case 'hit': return def.target === 'ray' ? `${where}: every wall on it cracks, every crate is floor` : `${def.arg === 2 ? 'smash' : 'crack'} ${shapeWords} ${where}: ${def.arg === 2 ? 'walls and crates become floor' : 'a wall cracks, a crate becomes floor'}`;
    case 'ice': return `${shapeWords} of ice ${where}; a piece that moves onto it slides on`;
    case 'wall': return `raise ${shapeWords} of stone ${where}, on empty floor`;
    case 'pit': return `sink ${shapeWords} into a pit ${where}, on empty floor`;
    case 'harden': return `petrify ${shapeWords} ${where}: intact walls become bedrock`;
    case 'sledge': return 'your king may crack adjacent walls for the rest of the duel';
    case 'drop': return `place a ${PIECE_NAMES[def.arg] ?? def.arg} ${where}`;
    case 'win': return 'play it and you win';
    case 'portal': return 'a pair of portals, cast in one turn';
    default: return def.text;
  }
}
export const PIECE_NAMES = Object.freeze({ p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' });

/** A short badge for the targeting word on a card face. */
export function targetBadge(def) {
  return { any: 'any', near: 'near', middle: 'mid', margin: `m${def.targetArg}`, king: 'king', ray: def.targetArg ? `ray${def.targetArg}` : 'ray', camp: 'camp' }[def.target] ?? def.target;
}
