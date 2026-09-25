// THE CARD UI's pure half (Phase 3.2, 2026-09-25; play/js/cards.mjs): the
// fan's geometry, the card art (the spells' own glyphs, the meta cards' two
// drawings, the drop shadow), the gesture split into tap / drag / hold, the
// drop preview's squares, the words on a face and under a dragged card.
// Node only, no engine. Usage: cd phase0 && node harness/test-cards.mjs
import { DRAG_SLOP, LONG_PRESS_MS, REVEAL_GLYPH, UNDO_GLYPH, META_GLYPHS, cardArt, artSize, stampGlyph, fanLayout, gestureStart, gestureMove, gestureHold, gestureEnd, castArea, cardHint, dropWords, costWords } from '../../play/js/cards.mjs';
import { CARDS, CARD_KINDS } from '../../play/js/deck.mjs';
import { PORTAL_GLYPH, ICE_GLYPH } from '../../play/js/pixelarrow.mjs';

let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else { fail++; console.log(`FAIL ${what}`); } };

// ---- the catalog carries what a face needs
for (const k of CARD_KINDS) {
  check(typeof CARDS[k].short === 'string' && CARDS[k].short.length > 0 && CARDS[k].short.length <= 26, `${k}: a short line for the face (${CARDS[k].short?.length})`);
  check(CARDS[k].cost === (CARDS[k].cls === 'meta' ? 'free' : 'move'), `${k}: a spell costs the move, a meta card is free (${CARDS[k].cost})`);
  check(!!cardArt(k), `${k} has art`);
}
check(cardArt('ice') === ICE_GLYPH && cardArt('portal') === PORTAL_GLYPH, "a spell card's art IS the hint's glyph (one drawing)");
check(cardArt('reveal') === REVEAL_GLYPH && cardArt('undo') === UNDO_GLYPH && cardArt('bogus') === null, 'the meta cards have their own drawings; an unknown kind none');
check(costWords('ice') === 'costs your move' && costWords('undo') === 'costs no move', 'the cost pip’s words');

// ---- the meta glyphs are 11×11, rectangular, ink and dots only, hollow in the middle like the spells'
for (const [k, g] of Object.entries(META_GLYPHS)) {
  check(g.length === 11 && g.every((row) => row.length === 11), `${k} glyph is 11×11`);
  check(g.every((row) => /^[.A-Z]+$/.test(row)), `${k} glyph is ink and dots`);
  const ink = g.reduce((n, row) => n + row.replace(/\./g, '').length, 0);
  check(ink >= 20 && ink <= 60, `${k} glyph has ${ink} ink pixels — a line drawing, not a blob`);
  const { w, h } = artSize(k);
  check(w === 12 && h === 12, `${k} art box with its shadow is 12×12 (${w}×${h})`);
}
check(REVEAL_GLYPH[5][5] === 'R' && REVEAL_GLYPH[5][4] === '.' && REVEAL_GLYPH[5][0] === 'R', 'the eye: a pupil in a hollow iris inside the almond');
check(UNDO_GLYPH[3].startsWith('UUU') && UNDO_GLYPH[4][1] === 'U' && UNDO_GLYPH[5][0] === '.' && UNDO_GLYPH[5][10] === 'U', 'the undo arrow: the head at the top left, the ring open below it, closed on the right');

// ---- the stamp: a shadow pixel down-right of ink where the glyph has none, the ink over it
{
  const px = new Map();
  const ctx = { fillStyle: '#000', fillRect(x, y, w, h) { for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) px.set(`${x + i},${y + j}`, this.fillStyle); } };
  stampGlyph(ctx, ['X.', '..'], 10, 20, '#abc', '#000');
  check(px.get('10,20') === '#abc' && px.get('11,21') === '#000' && px.size === 2, 'a lone ink pixel gets one shadow pixel down and right');
  px.clear();
  stampGlyph(ctx, ['XX', 'XX'], 0, 0, '#abc', '#000');
  check(px.get('0,0') === '#abc' && px.get('1,1') === '#abc' && px.get('2,2') === '#000' && px.get('2,1') === '#000' && px.get('1,2') === '#000' && px.get('2,0') === undefined, 'a block’s shadow is an L along its right and bottom, never over its own ink');
  px.clear();
  stampGlyph(ctx, ICE_GLYPH, 0, 0, '#fff');
  const inkN = [...px.values()].filter((c) => c === '#fff').length;
  check(inkN === ICE_GLYPH.reduce((n, row) => n + row.replace(/\./g, '').length, 0), 'the snowflake stamps every ink pixel');
}

// ---- the fan
{
  const one = fanLayout(1, 300, 80);
  check(one.length === 1 && one[0].x === 110 && one[0].y === 0 && one[0].rot === 0, `one card sits centred and upright (${JSON.stringify(one)})`);
  const fit = fanLayout(3, 300, 80, { gap: 6 });
  check(fit.map((c) => c.x).join(',') === '24,110,196', `three cards that fit sit side by side, centred (${fit.map((c) => c.x)})`);
  check(fit[0].rot < 0 && fit[1].rot === 0 && fit[2].rot > 0 && fit[0].rot === -fit[2].rot, `the tilt runs left to right through upright (${fit.map((c) => c.rot)})`);
  check(fit[0].y > 0 && fit[1].y === 0 && fit[2].y === fit[0].y, `the outer cards drop for the arc (${fit.map((c) => c.y)})`);
  const over = fanLayout(4, 300, 80);
  check(over.map((c) => c.x).join(',') === '0,73,147,220', `four cards that do not fit overlap in an even step from the left edge to the right (${over.map((c) => c.x)})`);
  check(over[3].x + 80 === 300, 'the last card’s right edge meets the row’s');
  check(over.every((c, i) => i === 0 || c.x > over[i - 1].x), 'the fan’s x is strictly increasing');
  const many = fanLayout(8, 300, 80);
  check(many.length === 8 && many[7].x + 80 === 300 && Math.abs(many[0].rot) === 7, `eight cards still fan the row, the outer tilt at the max (${many[0].rot})`);
  const none = fanLayout(0, 300, 80);
  check(none.length === 0, 'no cards, no layout');
  const narrow = fanLayout(4, 60, 80);
  check(narrow.length === 4 && narrow[3].x < 0, 'a row narrower than a card still lays the cards (the last hangs off the right edge by the step)');
}

// ---- the gesture: tap / drag / hold
{
  const tap = gestureStart(100, 100, 0);
  check(gestureMove(tap, 103, 104) === false && !tap.drag && gestureEnd(tap) === 'tap', 'a press that wobbles inside the slop and lifts is a tap');
  const drag = gestureStart(100, 100, 0);
  check(gestureMove(drag, 104, 100) === false && gestureMove(drag, 100, 112) === true && gestureMove(drag, 100, 140) === false && drag.drag && gestureEnd(drag) === 'drag', 'a press that travels past the slop becomes a drag once and stays one');
  const back = gestureStart(0, 0, 0);
  gestureMove(back, 20, 0);
  gestureMove(back, 0, 0);
  check(back.drag && back.moved === 20 && gestureEnd(back) === 'drag', 'a drag that returns to its origin is still a drag (the travel is the max, not the current offset)');
  const hold = gestureStart(0, 0, 0);
  gestureMove(hold, 2, 2);
  check(gestureHold(hold) === true && hold.held && gestureEnd(hold) === 'hold', 'the timer on a still press makes a hold, and the release is nothing');
  const late = gestureStart(0, 0, 0);
  gestureMove(late, 30, 0);
  check(gestureHold(late) === false && gestureEnd(late) === 'drag', 'the timer after the slop was crossed does not turn a drag into a hold');
  check(DRAG_SLOP === 8 && LONG_PRESS_MS === 450, `the slop is ${DRAG_SLOP} px, the hold ${LONG_PRESS_MS} ms`);
}

// ---- the drop preview
{
  const grid = { d5: '*', e6: '^', f4: 'P', c3: '_' }; // a wall, a crate, a pawn, a pit
  const at = (sq) => grid[sq] ?? null;
  const ice = castArea('ice', 'e5', { files: 10, ranks: 10, at });
  check(ice.length === 7 && !ice.includes('d5') && !ice.includes('e6') && ice.includes('f4') && ice.includes('f5') && ice.includes('e5') && ice.includes('d6') && ice.includes('f6') && ice.includes('d4') && ice.includes('e4'), `the ice tints its 3×3 on the floor alone — the wall and the crate take none, the pawn’s square does (${ice.join(' ')})`);
  const corner = castArea('ice', 'a1', { files: 10, ranks: 10, at });
  check(corner.length === 4 && corner.every((s) => /^[ab][12]$/.test(s)), `a corner cast is clipped to the board (${corner.join(' ')})`);
  const top = castArea('ice', 'j10', { files: 10, ranks: 10, at });
  check(top.length === 4 && top.includes('j10') && top.includes('i9'), `the far corner too (${top.join(' ')})`);
  const pit = castArea('ice', 'b2', { files: 10, ranks: 10, at });
  check(!pit.includes('c3') && pit.length === 8, `a pit takes no ice (${pit.join(' ')})`);
  check(castArea('portal', 'e5', { files: 10, ranks: 10, at }).join() === 'e5', 'a portal previews its one square');
  check(castArea('reveal', 'e5', { files: 10, ranks: 10, at }).length === 0 && castArea('ice', null, { files: 10, ranks: 10, at }).length === 0 && castArea('ice', 'z9', { files: 10, ranks: 10, at }).length === 0, 'a meta card, no square, a bad square: nothing');
  const wide = castArea('ice', 'l10', { files: 12, ranks: 10, at });
  check(wide.length === 4 && wide.includes('l10') && wide.includes('k9'), `the twelfth file reads (${wide.join(' ')})`);
}

// ---- the words
check(/pick the square it links to/.test(cardHint('portal', { halfAt: 'c4' })) && /c4/.test(cardHint('portal', { halfAt: 'c4' })), 'the portal with its half open asks for the link');
check(/pick a square/.test(cardHint('portal')) && /3×3/.test(cardHint('ice')) && cardHint('undo') === CARDS.undo.text && cardHint('bogus') === '', 'the faces’ lines');
check(dropWords('ice', 'e5') === 'release to freeze the floor around e5' && dropWords('portal', 'e5') === 'release to open a portal at e5' && /c4–e5/.test(dropWords('portal', 'e5', { halfAt: 'c4' })) && dropWords('ice', null) === '' && /oracle/.test(dropWords('reveal', 'a1')) && /take back/.test(dropWords('undo', 'a1')), 'the ghost’s tooltip by kind');

console.log(`test-cards: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
