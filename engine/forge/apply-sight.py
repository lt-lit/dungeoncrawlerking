#!/usr/bin/env python3
"""THE SIGHT WORD (sight.patch, 2026-10-21; brief 4.10 "3.4 RULED", the
targeting ruling after the first piece-states log) - anchor-based edits on a
tree that carries the twelve patches (dead-squares, thread-stack, portals,
wall-kinds, hammer, portals-body, portals-cast, ice, deck, deck-search,
terrain, piece-states). Writes the files in place; the patch of record is the
git diff the forge takes after it ran.

  python3 apply-sight.py <src dir>

ONE TARGETING WORD for the card grammar, `sight` (and `sight<n>`, a cap):

  A square is in sight of a colour when a queen standing on any of that
  colour's pieces could move onto it - every piece is an eye along its ranks,
  files and diagonals, and a line is blocked by what blocks a slider: a piece
  of either colour, a crate, a wall, a pit, bedrock, with a portal body ending
  it. The first blocker on a line is IN sight (so a wall in sight is a hit's
  anchor, a piece in sight a piece effect's); the eye's own square is not.
  With a number the line runs that many squares and no more. The enemy's
  pieces see nothing for you; a piece you hold under mind control sees for
  you while you hold it; a stunned or an entombed piece still sees.

The anchor is what the word restricts (as `near` restricts it): a shaped
cast's other cells follow the shape wherever it falls. The rays are the
engine's own rider attacks on the occupancy every slider reads
(byTypeBB[ALL_PIECES] | the portal bodies), masked to the board.
"""
import sys, os

SRC = sys.argv[1]

def edit(name, pairs):
    p = os.path.join(SRC, name)
    t = open(p).read()
    for old, new in pairs:
        assert t.count(old) == 1, f'{name}: anchor not unique or missing ({t.count(old)}):\n{old[:300]}'
        t = t.replace(old, new)
    open(p, 'w').write(t)
    print(f'edited {name} ({len(pairs)} edits)')

# ---------------------------------------------------------------- types.h
edit('types.h', [
('''enum CardTarget : int { TARGET_ANY, TARGET_NEAR, TARGET_MIDDLE, TARGET_MARGIN, TARGET_KING, TARGET_RAY, TARGET_CAMP };
''',
'''enum CardTarget : int { TARGET_ANY, TARGET_NEAR, TARGET_MIDDLE, TARGET_MARGIN, TARGET_KING, TARGET_RAY, TARGET_CAMP,
                        TARGET_SIGHT }; // THE SIGHT WORD (sight.patch): the anchor in sight of the caster's army, targetArg the cap (0 = none)
'''),
])

# ---------------------------------------------------------------- parser.cpp
edit('parser.cpp', [
('''      // the targeting word, with a number attached (margin2, ray5)
''',
'''      // the targeting word, with a number attached (margin2, ray5, sight3)
'''),
('''          else if (tword == "ray")    { def.target = TARGET_RAY; def.targetArg = tnum < 0 ? 0 : tnum; }
''',
'''          else if (tword == "ray")    { def.target = TARGET_RAY; def.targetArg = tnum < 0 ? 0 : tnum; }
          else if (tword == "sight")  { def.target = TARGET_SIGHT; def.targetArg = tnum < 0 ? 0 : tnum; } // THE SIGHT WORD (sight.patch): the cap, 0 = none
'''),
('''          if (tnum >= 0 && def.target != TARGET_MARGIN && def.target != TARGET_RAY)
''',
'''          if (tnum >= 0 && def.target != TARGET_MARGIN && def.target != TARGET_RAY && def.target != TARGET_SIGHT)
'''),
])

# ---------------------------------------------------------------- position.h
edit('position.h', [
('''  Bitboard cast_anchors(Color c, PieceType pt) const;
''',
'''  Bitboard cast_anchors(Color c, PieceType pt) const;
  Bitboard sight_squares(Color c, int cap = 0) const; // THE SIGHT WORD (sight.patch)
'''),
])

# ---------------------------------------------------------------- position.cpp
edit('position.cpp', [
('''/// The anchors a slot card may be cast on: the effect's own candidate squares,
/// narrowed by the targeting word, kept by the null rule.

Bitboard Position::cast_anchors(Color c, PieceType pt) const {
''',
'''/// THE SIGHT WORD (sight.patch, 2026-10-21): the squares in sight of a colour's
/// army - every square a queen standing on one of its pieces could move onto,
/// the first blocker on each line included (a piece of either colour, a crate,
/// a wall, a pit, bedrock; a portal body ends a line), read off the occupancy
/// every slider reads, each line capped at `cap` squares when cap > 0. The
/// eye's own square is not in its sight; the enemy's pieces are nobody's eyes.

Bitboard Position::sight_squares(Color c, int cap) const {

  const Bitboard occupied = byTypeBB[ALL_PIECES] | st->portalSquares;
  Bitboard out = 0;
  for (Bitboard b = pieces(c); b; )
  {
      const Square s = pop_lsb(b);
      Bitboard rays = attacks_bb<ROOK>(s, occupied) | attacks_bb<BISHOP>(s, occupied);
      if (cap > 0)
          for (Bitboard r = rays; r; )
          {
              const Square t = pop_lsb(r);
              if (distance(s, t) > cap)
                  rays ^= t;
          }
      out |= rays;
  }
  return out & board_size_bb(var->maxFile, var->maxRank);
}


/// The anchors a slot card may be cast on: the effect's own candidate squares,
/// narrowed by the targeting word, kept by the null rule.

Bitboard Position::cast_anchors(Color c, PieceType pt) const {
'''),
('''  case TARGET_CAMP:
      cand &= double_step_region(c);
      break;
''',
'''  case TARGET_CAMP:
      cand &= double_step_region(c);
      break;
  case TARGET_SIGHT: // THE SIGHT WORD (sight.patch): the anchor in sight of the caster's army
      cand &= sight_squares(c, def->targetArg);
      break;
'''),
])

print('sight edits applied')
