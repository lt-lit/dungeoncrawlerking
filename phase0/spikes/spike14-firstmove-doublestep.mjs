// Spike 14 — first-move-only pawn double-step (designer correction, 2026-08-21).
//
// §4.4's universal double-step shipped with the spike-13 caveat "region
// semantics are every-visit" — a pawn could SAVE its double-step and fire
// it mid-board. The designer rejected that: the double-step belongs to a
// pawn's FIRST move only, whatever rank it starts on.
//
// Constraint that shapes everything: the engine has NO per-pawn move
// history that survives our architecture — quake surgery reloads bare
// FENs (rule 9), so "has this pawn moved?" must be derivable from the
// POSITION alone. Pawns never move backward, so a pawn is provably
// unmoved iff it stands on the square it was dealt onto. Hence:
//
//   doubleStepRegion<Color> = the exact SQUARES that color's pawns
//   occupy at deal time, in a PER-DEAL variant registered on the fly.
//
// This spike proves the four load-bearing facts:
//   1. Variant registration is INCREMENTAL in both libraries: new names
//      can be added after the catalog load (rule 7 said names are
//      single-use — redefinition no-ops — but ADDITION was untested).
//      Deal-variant names encode their own config, so a re-registration
//      is always an identical-config no-op, never a silent rules change.
//   2. doubleStepRegion accepts explicit SQUARE lists, and the semantics
//      are exactly "double-step iff standing on a listed square": on the
//      square → available; one step later → gone; en passant works
//      against a region double-step with the correct ep square.
//   3. Betza's `i` ("initial") modifier is REGION-GATED, not
//      move-tracked — customPiece z:fmWfceFifmnD offers its double
//      exactly on doubleStepRegion squares. There is no deeper
//      first-move mechanism to reach for; start-square regions are the
//      expressibility ceiling.
//   4. The residual: a pawn that steps onto ANOTHER dealt pawn square
//      (stacked-file molding: the front pawn vacates, the rear pawn
//      arrives) regains the option once. Accepted as an engine-grammar
//      limit; it requires 2+ pawns dealt in one file AND the rear pawn
//      declining its own double first. (Quakes can also displace a pawn
//      onto/off a dealt square — same class.)
//
// Exit 0 = all PASS.
import { loadFfish, loadEngine } from '../lib/load.mjs';
import { makeCatalogIni, makeDuelVariantIni, dealVariant } from '../../play/js/variant.mjs';

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

const ffish = await loadFfish();
ffish.loadVariantConfig(makeCatalogIni());

// ---- 1+2: incremental registration + square-list regions (ffish) ----
// Deal fiction: white pawns dealt on a3 and b4 (stacked-file molding),
// black pawn dealt on c6.
const NAME = 'duel_5x8__wa3b4__bc6';
const ini = makeDuelVariantIni({
  name: NAME,
  files: 5,
  ranks: 8,
  extra: { doubleStepRegionWhite: 'a3 b4', doubleStepRegionBlack: 'c6' },
});
ffish.loadVariantConfig(ini); // AFTER the 60-variant catalog — incremental add
const F = ['4k', '5', '2p2', '5', '1P3', 'P4', '5', 'KR3'].join('/') + ' w - - 0 1';
check('incremental variant validates a FEN', ffish.validateFen(F, NAME) === 1);

const moves = (name, fen) => {
  const b = new ffish.Board(name, fen);
  const m = b.legalMoves().trim().split(/\s+/).filter(Boolean);
  b.delete();
  return m;
};
let m = moves(NAME, F);
check('dealt pawn a3 has its double', m.includes('a3a5'));
check('dealt pawn b4 has its double (arbitrary rank)', m.includes('b4b6'));
m = moves(NAME, ['4k', '5', '2p2', 'P4', '1P3', '5', '5', 'KR3'].join('/') + ' w - - 0 1');
check('moved pawn (a5, off its square) has NO double', !m.includes('a5a7'));
m = moves(NAME, F.replace(' w ', ' b '));
check('black dealt pawn c6 has its double', m.includes('c6c4'));
m = moves(NAME, ['4k', '5', '5', '2p2', '1P3', 'P4', '5', 'KR3'].join('/') + ' b - - 0 1');
check('moved black pawn (c5) has NO double', !m.includes('c5c3'));

// the residual, stated as a fact so a future change is visible:
m = moves(NAME, ['4k', '5', '2p2', '5', 'PP3', '5', '5', 'KR3'].join('/') + ' w - - 0 1');
check('KNOWN residual: pawn arriving on a comrade dealt square regains once', m.includes('b4b6'));

// en passant against a region double-step
{
  const b = new ffish.Board(NAME, ['4k', '5', 'p4', '5', '1P3', '5', '5', 'KR3'].join('/') + ' w - - 0 1');
  b.push('b4b6');
  const ep = b.fen().split(' ')[3];
  const ml = b.legalMoves();
  b.delete();
  check('ep works against a dealt-square double', ml.includes('a6b5') && ep === 'b5', `ep field ${ep}`);
}

// a realistically long deal-variant name (16 dealt squares) loads fine
{
  const long = 'duel_10x10__wa2b2c2d2e2f2g2h2__ba9b9c9d9e9f9g9h9';
  ffish.loadVariantConfig(
    makeDuelVariantIni({
      name: long,
      files: 10,
      ranks: 10,
      extra: {
        doubleStepRegionWhite: 'a2 b2 c2 d2 e2 f2 g2 h2',
        doubleStepRegionBlack: 'a9 b9 c9 d9 e9 f9 g9 h9',
      },
    })
  );
  const fen = '4k5/pppppppp2/10/10/10/10/10/10/PPPPPPPP2/4K5 w - - 0 1';
  check('long deal-variant name registers and validates', ffish.validateFen(fen, long) === 1);
  check('long-name variant serves doubles', moves(long, fen).includes('a2a4'));
}

// ---- 2b: THE SHIPPED RULE — the camp line (designer-final, 2026-08-21) ----
// Exact dealt squares proved too literal to read: quakes scoot untouched
// pawns sideways/backwards off their squares, and a player can't see
// where a pawn was born. The designer chose rows: each side's double-step
// zone is every rank from its home edge up to its FRONT-MOST dealt pawn
// rank — "at or behind your starting line, you can leap; past it, never
// again" (chess's own row rule generalized; the two readings only differ
// because quakes can move pawns backward). Three signed consequences:
// knocked-back moved pawns regain; stacked rear pawns can 1-then-2 while
// behind the line; wall-scattered molding sets the line at the deepest
// front pawn. dealVariant() is the production builder under test here.
{
  const v = dealVariant(5, 8, 4, 6); // white camp = ranks 1-4, black camp = ranks 6-8
  check('dealVariant name encodes the lines', v.name === 'duel_5x8__w4__b6', v.name);
  ffish.loadVariantConfig(v.ini);
  // quake-scoot fiction: a NEVER-MOVED white pawn now sits on a2 — not a
  // square any pawn was dealt onto, but behind the line. It must leap.
  let mm = moves(v.name, ['4k', '5', '2p2', '5', '5', '5', 'P4', 'K1R2'].join('/') + ' w - - 0 1');
  check('camp line: scooted pawn behind the line leaps (a2a4)', mm.includes('a2a4'));
  mm = moves(v.name, ['4k', '5', '2p2', '5', '1P3', '5', '5', 'KR3'].join('/') + ' w - - 0 1');
  check('camp line: pawn ON the line leaps (b4b6)', mm.includes('b4b6'));
  mm = moves(v.name, ['4k', '5', '2p2', 'P4', '5', '5', '5', 'KR3'].join('/') + ' w - - 0 1');
  check('camp line: pawn past the line never leaps (a5a7 absent)', !mm.includes('a5a7'));
  mm = moves(v.name, ['4k', '2p2', '5', '5', '5', '5', 'P4', 'K1R2'].join('/') + ' b - - 0 1');
  check('camp line: black pawn behind ITS line leaps (c7c5)', mm.includes('c7c5'));
  mm = moves(v.name, ['4k', '5', '5', '2p2', '5', '5', 'P4', 'K1R2'].join('/') + ' b - - 0 1');
  check('camp line: black pawn past its line never leaps (c5c3 absent)', !mm.includes('c5c3'));
}

// ---- 3: betza `i` is region-gated (no hidden move tracking) ----
ffish.loadVariantConfig('[sp14_zt:chess]\ncustomPiece1 = z:fmWfceFifmnD\ndoubleStepRegionWhite = *3\n');
check(
  'betza i fires ON the region (z d3, region *3)',
  moves('sp14_zt', 'rnbqkbnr/pppppppp/8/8/8/3Z4/PPPP1PPP/RNBQKBNR w - - 0 1').includes('d3d5')
);
check(
  'betza i silent OFF the region (z d4, region *3)',
  !moves('sp14_zt', 'rnbqkbnr/pppppppp/8/8/3Z4/8/PPPP1PPP/RNBQKBNR w - - 0 1').includes('d4d6')
);

// ---- 1b: the ENGINE side — cumulative ini reloads on one instance ----
{
  const engine = await loadEngine();
  await engine.uci();
  engine.setoption('Use NNUE', 'false'); // rule 1
  engine.setoption('Threads', '1');
  await engine.loadVariantsIni(makeCatalogIni() + '\n' + ini);
  engine.setoption('UCI_Variant', NAME);
  engine.position({ fen: F });
  const perftLines = await engine.sendUntil('go perft 1', (l) => l.startsWith('Nodes searched'));
  const perft1 = parseInt(perftLines[perftLines.length - 1].split(':')[1], 10);
  const nf = moves(NAME, F).length;
  check('engine perft1 matches ffish on the incremental variant', perft1 === nf, `${perft1} vs ${nf}`);
  // a SECOND reload on the same instance (one per deal in live play)
  const ini2 = makeDuelVariantIni({
    name: 'duel_5x8__wa2__bc7',
    files: 5,
    ranks: 8,
    extra: { doubleStepRegionWhite: 'a2', doubleStepRegionBlack: 'c7' },
  });
  await engine.loadVariantsIni(makeCatalogIni() + '\n' + ini + '\n' + ini2);
  engine.setoption('UCI_Variant', 'duel_5x8__wa2__bc7');
  engine.position({ fen: F });
  const res = await engine.go('depth 4 movetime 2000');
  check('second cumulative reload searches fine', !!res.bestmove, `bestmove ${res.bestmove}`);
}

console.log(failures === 0 ? '\nSPIKE 14 PASS' : `\nSPIKE 14 FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
