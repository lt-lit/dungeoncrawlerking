#!/usr/bin/env python3
"""THE PIECE STATES (piece-states.patch, the twelfth patch; brief 4.10 "3.4
RULED", 2026-10-21) - anchor-based edits on a tree that carries the eleven
patches before it (dead-squares, thread-stack, portals, wall-kinds, hammer,
portals-body, portals-cast, ice, deck, deck-search, terrain).
engine/patches/piece-states.patch is this script's diff; both are committed.

  python3 apply-states.py <tree>/src

TIMERS ARE FOR TIMED PIECE EFFECTS ONLY. ONE STATE PER PIECE - a record of
the kind, the count and (for control) the owner it returns to - and a new
piece effect OVERWRITES it. THE CLOCK IS IN PLIES: every real move by either
side drops every count by one, and what reaches zero ends as the last thing
that move does (the forced pass and the link ply of a portal cast tick
nothing; the mulligan ticks). The four effects, as card definitions:

  stun<n> <shape> <targeting>        the piece cannot move for n moves; it
                                     still attacks and defends and can be taken
  invincible<n> <shape> <targeting>  the piece cannot be captured for n moves;
                                     it still moves, attacks and gives check
                                     (a pit still kills it)
  control<n> <shape> <targeting>     the piece changes to the caster's colour
                                     and changes back when the count runs out,
                                     wherever it stands and whatever it has
                                     become; it counts for its OWNER in the
                                     extinction count; cast on your own stolen
                                     piece it is a recall
  entomb <shape> <targeting>         untimed: inert - no moves, no attacks,
                                     uncapturable, a wall to lines; freed by any
                                     hit, overwritten by any piece effect

Kings are never targets; every piece effect targets any non-king piece of
either colour (an area takes every non-king piece in its shape); a cast that
changes nothing is not generated (the null rule); recasting the same effect
refreshes the count. Overwriting a control RETURNS the piece at once, as part
of the cast. A cast or an expiry that changes who attacks whom is judged on
the board it leaves (virtual_attacks_king): a return that attacks the
thief's king is a check the move gives, a move that would leave the mover's
own king attacked by a return is illegal. The record rides every relocation
(a move, a promotion, a portal swap, a slide), clears on capture, and lives in
the FEN's trailing field as "%e5s3" (stun, three left), "%e5i5", "%e5c4w"
(controlled, returns to White in four), "%e5e" (entombed) - hashed, in the
copied state, so undo is the state pointer; a control's colour flips are
recorded for undo as the slide's steps are.
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
('''enum CardKind : int { CARD_NONE, CARD_PORTAL, CARD_ICE, CARD_WIN, CARD_META,
                      CARD_HIT, CARD_WALL, CARD_PIT, CARD_HARDEN, CARD_SLEDGE, CARD_DROP }; // THE TERRAIN INTERPRETER (terrain.patch)
''',
'''enum CardKind : int { CARD_NONE, CARD_PORTAL, CARD_ICE, CARD_WIN, CARD_META,
                      CARD_HIT, CARD_WALL, CARD_PIT, CARD_HARDEN, CARD_SLEDGE, CARD_DROP, // THE TERRAIN INTERPRETER (terrain.patch)
                      CARD_STUN, CARD_INVINCIBLE, CARD_CONTROL, CARD_ENTOMB }; // THE PIECE STATES (piece-states.patch)

// THE PIECE STATES (piece-states.patch, brief 4.10 "3.4 RULED"): one record
// per piece - a kind, a count in plies and, for control, the owner it returns
// to. A new piece effect overwrites the record whole.
enum PieceState : int { STATE_NONE, STATE_STUN, STATE_INVINCIBLE, STATE_CONTROL, STATE_ENTOMB, STATE_NB };
constexpr int MAX_STATE_COUNT = 15;
constexpr int MAX_FLIPS = 32;      // the colour flips one move can make (a control's returns, a cast's)
constexpr bool is_piece_effect(CardKind k) { return k >= CARD_STUN && k <= CARD_ENTOMB; }
constexpr bool is_timed_effect(CardKind k) { return k == CARD_STUN || k == CARD_INVINCIBLE || k == CARD_CONTROL; }
'''),
])

# ---------------------------------------------------------------- variant.h
edit('variant.h', [
('''  bool sledgeCards = false;
''',
'''  bool sledgeCards = false;
  bool pieceStateCards = false; // THE PIECE STATES (piece-states.patch): a stun / invincible / control / entomb card is in the deal
'''),
])

# ---------------------------------------------------------------- parser.cpp
edit('parser.cpp', [
('''      else if (word == "drop")
      {
          def.kind = CARD_DROP;''',
'''      // THE PIECE STATES (piece-states.patch): the count rides the effect word (stun3, invincible5, control4); entomb has none
      else if (word == "stun")       { def.kind = CARD_STUN; def.arg = num; }
      else if (word == "invincible") { def.kind = CARD_INVINCIBLE; def.arg = num; }
      else if (word == "control")    { def.kind = CARD_CONTROL; def.arg = num; }
      else if (word == "entomb")     def.kind = CARD_ENTOMB;
      else if (word == "drop")
      {
          def.kind = CARD_DROP;'''),
('''      if (num >= 0 && def.kind != CARD_HIT)
      {
          err = "a number on " + word;
          return false;
      }
      if (def.kind == CARD_HIT && (def.arg < 1 || def.arg > 2))''',
'''      if (num >= 0 && def.kind != CARD_HIT && !is_timed_effect(def.kind))
      {
          err = "a number on " + word;
          return false;
      }
      if (is_timed_effect(def.kind) && (num < 1 || num > MAX_STATE_COUNT))
      {
          err = word + " needs a count from 1 to " + std::to_string(MAX_STATE_COUNT);
          return false;
      }
      if (def.kind == CARD_HIT && (def.arg < 1 || def.arg > 2))'''),
('''            if (def.kind == CARD_SLEDGE)
                v->sledgeCards = true;''',
'''            if (def.kind == CARD_SLEDGE)
                v->sledgeCards = true;
            if (is_piece_effect(def.kind))
                v->pieceStateCards = true; // THE PIECE STATES (piece-states.patch)'''),
])

# ---------------------------------------------------------------- position.h
edit('position.h', [
# StateInfo, the copied part: the records and their bitboards
('''  uint8_t  sledge;        // THE TERRAIN INTERPRETER (terrain.patch): bit c set = colour c's hammer enchantment is on
''',
'''  uint8_t  sledge;        // THE TERRAIN INTERPRETER (terrain.patch): bit c set = colour c's hammer enchantment is on
  // THE PIECE STATES (piece-states.patch): one record per square - the kind
  // (PieceState), the count in plies (0 for entomb) and, for control, the
  // owner the piece returns to; the bitboards are the records' summary
  uint8_t  stateKind[SQUARE_NB];
  uint8_t  stateCount[SQUARE_NB];
  uint8_t  stateOwner[SQUARE_NB];
  Bitboard stated;        // every square with a record
  Bitboard immobile;      // stunned or entombed: no moves
  Bitboard uncapturable;  // invincible or entombed: no capture onto it
  Bitboard entombed;      // entombed: no attacks, a wall to lines and to the slide
  Bitboard controlled;    // under control: the board colour is the thief's, the record's owner is the true one
'''),
# StateInfo, the uncopied part: the flips for undo, the fresh records
('''  bool       castPlaced;                   // THE TERRAIN INTERPRETER (terrain.patch): a drop effect placed a piece on 'to', for undo
''',
'''  bool       castPlaced;                   // THE TERRAIN INTERPRETER (terrain.patch): a drop effect placed a piece on 'to', for undo
  Square     flipSq[MAX_FLIPS];            // THE PIECE STATES (piece-states.patch): the squares whose piece changed colour this move, for undo
  Piece      flipBefore[MAX_FLIPS];
  bool       flipPromoted[MAX_FLIPS];
  Piece      flipUnpromoted[MAX_FLIPS];
  int        flipCount;
  Bitboard   freshStates;                  // the records this move set: the clock starts after the cast, so they do not tick this move
'''),
# the public surface
('''  bool sledge_on(Color c) const;
''',
'''  bool sledge_on(Color c) const;
  // THE PIECE STATES (piece-states.patch): the records' summary, the clock,
  // the targets of a piece effect and the virtual-board judgement of a move
  // that changes who attacks whom - a piece-effect cast, or a control
  // returning to its owner as the move's last act
  Bitboard stated_squares() const;
  Bitboard immobile_squares() const;
  Bitboard uncapturable_squares() const;
  Bitboard entombed_squares() const;
  Bitboard controlled_squares() const;
  int state_kind(Square s) const;
  int state_count(Square s) const;
  Color state_owner(Square s) const;
  Color owner_of(Square s) const;
  bool portal_landable(Square to) const;
  Bitboard portal_landable_bb() const;
  bool ticks(Move m) const;
  Bitboard expiring_controls() const;
  bool needs_virtual_test(Move m) const;
  bool virtual_attacks_king(Move m, Color kingColor) const;
  bool piece_effect_result(const CardDef& def, Square s, Color us, int& kind, int& count, Color& owner, Color& colour) const;
  bool piece_effect_changes(const CardDef& def, Bitboard cells, Color us) const;
'''),
# the private helpers
('''  void apply_cast(const CardDef& def, Square anchor, Color us, Key& k); // THE TERRAIN INTERPRETER (terrain.patch)
''',
'''  void apply_cast(const CardDef& def, Square anchor, Color us, Key& k); // THE TERRAIN INTERPRETER (terrain.patch)
  // THE PIECE STATES (piece-states.patch)
  Key state_key(Square s) const;
  void set_state_record(Square s, int kind, int count, Color owner, Key& k);
  void clear_state_record(Square s, Key& k);
  void move_state_record(Square from, Square to, Key& k);
  void flip_piece_colour(Square s, Key& k);
  void tick_states(Key& k);
  void apply_piece_effect(const CardDef& def, Bitboard cells, Color us, Key& k);
'''),
# the inline definitions
('''// The floor an ice cast on s ices: the 3x3 around it, walls, pits and crates skipped
inline Bitboard Position::ice_patch(Square s) const {''',
'''// THE PIECE STATES (piece-states.patch)
inline Bitboard Position::stated_squares() const { return st->stated; }
inline Bitboard Position::immobile_squares() const { return st->immobile; }
inline Bitboard Position::uncapturable_squares() const { return st->uncapturable; }
inline Bitboard Position::entombed_squares() const { return st->entombed; }
inline Bitboard Position::controlled_squares() const { return st->controlled; }
inline int Position::state_kind(Square s) const { return st->stateKind[s]; }
inline int Position::state_count(Square s) const { return st->stateCount[s]; }
inline Color Position::state_owner(Square s) const { return Color(st->stateOwner[s]); }

// The colour a piece belongs to: a controlled piece's record names its owner,
// every other piece is its board colour's
inline Color Position::owner_of(Square s) const {
  return (st->controlled & s) ? Color(st->stateOwner[s]) : color_of(piece_on(s));
}

// A landing on a portal square swaps with the twin's occupant - never with an
// entombed piece, which is a wall: no landing is generated there
inline bool Position::portal_landable(Square to) const {
  return !(st->entombed & portal_twin(to));
}

inline Bitboard Position::portal_landable_bb() const {
  Bitboard out = 0;
  for (Bitboard b = st->portalSquares; b; )
  {
      const Square s = pop_lsb(b);
      if (!(st->entombed & portal_twin(s)))
          out |= s;
  }
  return out;
}

// THE CLOCK IS IN PLIES: every real move ticks every count - the forced pass
// (and the fizzle) is no move, and the link ply (the mover's half stood open
// before it) belongs to the cast that already ticked
inline bool Position::ticks(Move m) const {
  return !is_pass(m) && st->portalHalf[sideToMove] == SQ_NONE;
}

// The control records that end with the next real move
inline Bitboard Position::expiring_controls() const {
  Bitboard out = 0;
  for (Bitboard b = st->controlled; b; )
  {
      const Square s = pop_lsb(b);
      if (st->stateCount[s] == 1)
          out |= s;
  }
  return out;
}

// Whether a move's legality and check must be judged on the board it leaves:
// a piece-effect cast changes colours and attacks, a control returning at the
// move's end does too
inline bool Position::needs_virtual_test(Move m) const {
  if (type_of(m) == DROP && is_card_slot(dropped_piece_type(m)))
  {
      const CardKind kind = card_kind(sideToMove, dropped_piece_type(m));
      if (is_piece_effect(kind))
          return true;
      if (kind == CARD_HIT && st->entombed) // a hit that frees an entombed piece gives it its attacks back
      {
          const CardDef* def = card_def(sideToMove, dropped_piece_type(m));
          if (def && (effect_cells(*def, to_sq(m), sideToMove) & st->entombed))
              return true;
      }
  }
  return st->controlled && ticks(m) && expiring_controls();
}

// The floor an ice cast on s ices: the 3x3 around it, walls, pits and crates skipped
inline Bitboard Position::ice_patch(Square s) const {'''),
# the extinction count: a controlled piece counts for its owner
('''  for (int s = 0; s < var->cardSlotCount; ++s) // THE DECK: a card in hand is never a piece
      if (pt == ALL_PIECES || pt == var->cardSlotType[s])
          n -= pieceCountInHand[c][var->cardSlotType[s]];
  return n;
}''',
'''  for (int s = 0; s < var->cardSlotCount; ++s) // THE DECK: a card in hand is never a piece
      if (pt == ALL_PIECES || pt == var->cardSlotType[s])
          n -= pieceCountInHand[c][var->cardSlotType[s]];
  // THE PIECE STATES (piece-states.patch): a controlled piece counts for its
  // owner, so a control never bares a king by itself
  if (st->controlled)
  {
      const Bitboard mine   = pt == ALL_PIECES ? pieces(c)  : pieces(c, pt);
      const Bitboard theirs = pt == ALL_PIECES ? pieces(~c) : pieces(~c, pt);
      n -= popcount(st->controlled & mine);
      n += popcount(st->controlled & theirs);
  }
  return n;
}'''),
])

# ---------------------------------------------------------------- position.cpp
edit('position.cpp', [
# Zobrist
('''  Key sledge[COLOR_NB];                // THE TERRAIN INTERPRETER (terrain.patch): a colour's hammer enchantment
''',
'''  Key sledge[COLOR_NB];                // THE TERRAIN INTERPRETER (terrain.patch): a colour's hammer enchantment
  Key pieceState[SQUARE_NB][STATE_NB][MAX_STATE_COUNT + 1][COLOR_NB]; // THE PIECE STATES (piece-states.patch): a record by square, kind, count and owner
'''),
('''  for (Color c : {WHITE, BLACK})
      Zobrist::sledge[c] = terrainRng.rand<Key>();
''',
'''  for (Color c : {WHITE, BLACK})
      Zobrist::sledge[c] = terrainRng.rand<Key>();

  // THE PIECE STATES (piece-states.patch): the records, from their own PRNG
  PRNG stateRng(0x5A3C9E17D2B48F61ULL);
  for (int s = 0; s < SQUARE_NB; ++s)
      for (int kind = 0; kind < STATE_NB; ++kind)
          for (int n = 0; n <= MAX_STATE_COUNT; ++n)
              for (Color c : {WHITE, BLACK})
                  Zobrist::pieceState[s][kind][n][c] = stateRng.rand<Key>();
'''),
# set_state: hash the records
('''  // THE TERRAIN INTERPRETER (terrain.patch): the sledge enchantments
  for (Color c : {WHITE, BLACK})
      if (si->sledge & (1 << c))
          si->key ^= Zobrist::sledge[c];
''',
'''  // THE TERRAIN INTERPRETER (terrain.patch): the sledge enchantments
  for (Color c : {WHITE, BLACK})
      if (si->sledge & (1 << c))
          si->key ^= Zobrist::sledge[c];

  // THE PIECE STATES (piece-states.patch): every record
  for (Bitboard b = si->stated; b; )
  {
      const Square s = pop_lsb(b);
      si->key ^= Zobrist::pieceState[s][si->stateKind[s]][si->stateCount[s]][si->stateOwner[s]];
  }
'''),
# fen(): the field opens for the records too, and prints them after the flags
('''  if (st->portalSquares || st->portalHalf[WHITE] != SQ_NONE || st->portalHalf[BLACK] != SQ_NONE || st->slickSquares || deckField || st->sledge)
  {''',
'''  if (st->portalSquares || st->portalHalf[WHITE] != SQ_NONE || st->portalHalf[BLACK] != SQ_NONE || st->slickSquares || deckField || st->sledge || st->stated)
  {'''),
('''      // THE TERRAIN INTERPRETER (terrain.patch): "*w" - White's hammer enchantment is on
      for (Color c : {WHITE, BLACK})
          if (st->sledge & (1 << c))
          {
              ss << (first ? "" : ",") << "*" << (c == WHITE ? "w" : "b");
              first = false;
          }
      ss << "}";''',
'''      // THE TERRAIN INTERPRETER (terrain.patch): "*w" - White's hammer enchantment is on
      for (Color c : {WHITE, BLACK})
          if (st->sledge & (1 << c))
          {
              ss << (first ? "" : ",") << "*" << (c == WHITE ? "w" : "b");
              first = false;
          }
      // THE PIECE STATES (piece-states.patch): "%e5s3" a stunned piece with
      // three moves left, "%e5i5" an invincible one, "%e5c4w" a controlled
      // piece that returns to White in four, "%e5e" an entombed one
      for (Bitboard b = st->stated; b; )
      {
          const Square s = pop_lsb(b);
          ss << (first ? "" : ",") << "%" << UCI::square(*this, s) << "sice"[st->stateKind[s] - 1];
          if (st->stateCount[s])
              ss << int(st->stateCount[s]);
          if (st->stateKind[s] == STATE_CONTROL)
              ss << (st->stateOwner[s] == WHITE ? "w" : "b");
          first = false;
      }
      ss << "}";'''),
# slider_blockers: an entombed slider pins nothing
('''  if (s == SQ_NONE || !sliders)
      return blockers;
''',
'''  sliders &= ~st->entombed; // THE PIECE STATES (piece-states.patch): an entombed piece attacks nothing

  if (s == SQ_NONE || !sliders)
      return blockers;
'''),
# attackers_to: entombed pieces attack nothing - every caller reads it here
('''      return  (pawn_attacks_bb(~c, s)          & pieces(c, PAWN))
            | (attacks_bb<KNIGHT>(s)           & pieces(c, KNIGHT, ARCHBISHOP, CHANCELLOR))
            | (attacks_bb<  ROOK>(s, occupied) & pieces(c, ROOK, QUEEN, CHANCELLOR))
            | (attacks_bb<BISHOP>(s, occupied) & pieces(c, BISHOP, QUEEN, ARCHBISHOP))
            | (attacks_bb<KING>(s)             & pieces(c, KING, COMMONER));
  }''',
'''      return (  (pawn_attacks_bb(~c, s)          & pieces(c, PAWN))
              | (attacks_bb<KNIGHT>(s)           & pieces(c, KNIGHT, ARCHBISHOP, CHANCELLOR))
              | (attacks_bb<  ROOK>(s, occupied) & pieces(c, ROOK, QUEEN, CHANCELLOR))
              | (attacks_bb<BISHOP>(s, occupied) & pieces(c, BISHOP, QUEEN, ARCHBISHOP))
              | (attacks_bb<KING>(s)             & pieces(c, KING, COMMONER))) & ~st->entombed; // THE PIECE STATES: an entombed piece attacks nothing
  }'''),
('''            | (LeaperAttacks[~c][SHOGI_KNIGHT][s] & pieces(c, SHOGI_KNIGHT))
            | (LeaperAttacks[~c][SHOGI_PAWN][s]   & pieces(c, SHOGI_PAWN, SILVER));
  }''',
'''            | (LeaperAttacks[~c][SHOGI_KNIGHT][s] & pieces(c, SHOGI_KNIGHT))
            | (LeaperAttacks[~c][SHOGI_PAWN][s]   & pieces(c, SHOGI_PAWN, SILVER))) & ~st->entombed; // THE PIECE STATES
  }'''),
('''  if (var->fastAttacks2)
  {
      return  (pawn_attacks_bb(~c, s)             & pieces(c, PAWN, BREAKTHROUGH_PIECE, GOLD))''',
'''  if (var->fastAttacks2)
  {
      return (  (pawn_attacks_bb(~c, s)             & pieces(c, PAWN, BREAKTHROUGH_PIECE, GOLD))'''),
('''  // Unpromoted soldiers
  if (b & pieces(SOLDIER) && relative_rank(c, s, max_rank()) < var->soldierPromotionRank)
      b ^= b & pieces(SOLDIER) & ~PseudoAttacks[~c][SHOGI_PAWN][s];

  return b;
}''',
'''  // Unpromoted soldiers
  if (b & pieces(SOLDIER) && relative_rank(c, s, max_rank()) < var->soldierPromotionRank)
      b ^= b & pieces(SOLDIER) & ~PseudoAttacks[~c][SHOGI_PAWN][s];

  return b & ~st->entombed; // THE PIECE STATES (piece-states.patch): an entombed piece attacks nothing
}'''),
# legal(): the virtual judgement
('''  // THE DECK (deck.patch): the mulligan's legality is the rule's own
  if (type_of(m) == MULLIGAN)
      return mulligan_allowed(us);
''',
'''  // THE PIECE STATES (piece-states.patch): a piece-effect cast changes who
  // attacks whom (a control flips a piece's colour, an overwrite returns one,
  // an entomb silences one), and a control whose count runs out with this
  // move returns to its owner as the move's last act - either is judged on
  // the board the move leaves, with the rules that are not king safety kept
  if (count<KING>(us) && needs_virtual_test(m))
  {
      if (type_of(m) == MULLIGAN && !mulligan_allowed(us))
          return false;
      // (a hammer in check is judged here like any other move: the return
      // may be what resolves the check - no card is, the rule below)
      if (type_of(m) == DROP && is_spell_scroll(dropped_piece_type(m)))
      {
          const CardKind kind = card_kind(us, dropped_piece_type(m));
          if (kind == CARD_NONE || kind == CARD_META || checkers())
              return false;
          if (kind == CARD_PORTAL && (portal_taken() & to))
              return false;
      }
      return !virtual_attacks_king(m, us);
  }

  // THE DECK (deck.patch): the mulligan's legality is the rule's own
  if (type_of(m) == MULLIGAN)
      return mulligan_allowed(us);
'''),
# pseudo_legal(): a hammer in check is regenerated only while a control returns with the move
('''  // A hammer's destination IS a wall square: validate a TT hammer by regeneration
  if (type_of(m) == HAMMER)
      return !checkers() && MoveList<NON_EVASIONS>(*this).contains(m);''',
'''  // A hammer's destination IS a wall square: validate a TT hammer by regeneration
  // (THE PIECE STATES: in check it is generated only while a control returns
  // with this move, and legal() judges it on the board the move leaves)
  if (type_of(m) == HAMMER)
      return !checkers() ? MoveList<NON_EVASIONS>(*this).contains(m)
           : (st->controlled && expiring_controls()) && MoveList<EVASIONS>(*this).contains(m);'''),
# pseudo_legal(): a stunned or entombed piece never moves, nothing captures an invincible or entombed piece
('''  // Use a slower but simpler function for uncommon cases
  // yet we skip the legality check of MoveList<LEGAL>().
  if (type_of(m) != NORMAL || is_gating(m))''',
'''  // THE PIECE STATES (piece-states.patch): a stunned or entombed piece never
  // moves; nothing captures an invincible or entombed piece (en passant
  // included); no landing swaps with an entombed twin
  if (type_of(m) != CASTLING && (st->immobile & from))
      return false;
  if (type_of(m) != HAMMER && (st->uncapturable & to))
      return false;
  if (type_of(m) == EN_PASSANT && (st->uncapturable & capture_square(to)))
      return false;
  if (type_of(m) == PORTAL && (!(st->portalSquares & to) || !portal_landable(to)))
      return false; // a stale TT move may name a square that is no portal any more

  // Use a slower but simpler function for uncommon cases
  // yet we skip the legality check of MoveList<LEGAL>().
  if (type_of(m) != NORMAL || is_gating(m))'''),
# pseudo_legal(): the evasion filter assumes the attack map stands - not when a control returns with this move
('''  // Evasions generator already takes care to avoid some kind of illegal moves
  // and legal() relies on this. We therefore have to take care that the same
  // kind of moves are filtered out here.
  if (checkers() && !(checkers() & non_sliding_riders()))
  {''',
'''  // Evasions generator already takes care to avoid some kind of illegal moves
  // and legal() relies on this. We therefore have to take care that the same
  // kind of moves are filtered out here. THE PIECE STATES: not when a control
  // returns with this move - every move is generated then and legal() judges
  // it on the board the move leaves.
  if (checkers() && !(checkers() & non_sliding_riders()) && !(st->controlled && expiring_controls()))
  {'''),
# gives_check(): the virtual judgement
('''  // Portal moves relocate two pieces: judge the resulting board
  if (type_of(m) == PORTAL)
      return portal_attacks_king(m, ~sideToMove);

  // A hammer moves nothing and the crate blocks what the wall blocked: never a check''',
'''  // THE PIECE STATES (piece-states.patch): a piece-effect cast, or a control
  // returning as this move's last act, is judged on the board the move leaves
  if (needs_virtual_test(m))
      return virtual_attacks_king(m, ~sideToMove);

  // Portal moves relocate two pieces: judge the resulting board
  if (type_of(m) == PORTAL)
      return portal_attacks_king(m, ~sideToMove);

  // A hammer moves nothing and the crate blocks what the wall blocked: never a check'''),
# do_move(): the bookkeeping
('''  st->castPlaced = false; // THE TERRAIN INTERPRETER (terrain.patch)
''',
'''  st->castPlaced = false; // THE TERRAIN INTERPRETER (terrain.patch)
  // THE PIECE STATES (piece-states.patch): the flips this move makes (for
  // undo), the records it sets (they do not tick this move), and whether the
  // clock ticks at all - read before the half changes
  st->flipCount = 0;
  st->freshStates = 0;
  const bool tick = ticks(m);
'''),
('''      bool capturedPromoted = is_promoted(capsq);
      Piece unpromotedCaptured = unpromoted_piece_on(capsq);
      remove_piece(capsq);
''',
'''      bool capturedPromoted = is_promoted(capsq);
      Piece unpromotedCaptured = unpromoted_piece_on(capsq);
      remove_piece(capsq);
      clear_state_record(capsq, k); // THE PIECE STATES: the victim's record goes with it
'''),
('''      Square rfrom, rto;
      do_castling<true>(us, from, to, rfrom, rto);
''',
'''      Square rfrom, rto;
      do_castling<true>(us, from, to, rfrom, rto);
      if (rfrom != rto)
          move_state_record(rfrom, rto, k); // THE PIECE STATES: the rook's record rides along
'''),
('''      if (swapped)
          remove_piece(q);
      move_piece(from, q);
      if (swapped)
      {
          put_piece(swapped, to, swappedPromoted, swappedUnpromoted);
          k ^= Zobrist::psq[swapped][q] ^ Zobrist::psq[swapped][to];
          if (type_of(swapped) == PAWN)
              st->pawnKey ^= Zobrist::psq[swapped][q] ^ Zobrist::psq[swapped][to];
      }
  }''',
'''      if (swapped)
          remove_piece(q);
      move_piece(from, q);
      if (swapped)
      {
          put_piece(swapped, to, swappedPromoted, swappedUnpromoted);
          k ^= Zobrist::psq[swapped][q] ^ Zobrist::psq[swapped][to];
          if (type_of(swapped) == PAWN)
              st->pawnKey ^= Zobrist::psq[swapped][q] ^ Zobrist::psq[swapped][to];
      }
      // THE PIECE STATES (piece-states.patch): the records ride the swap - the
      // twin's first (to the landing square), then the mover's (to the twin)
      if (q != from && (st->stated & (square_bb(from) | q)))
      {
          const int qKind = st->stateKind[q], qCount = st->stateCount[q], qOwner = st->stateOwner[q];
          clear_state_record(q, k);
          move_state_record(from, q, k);
          if (swapped && qKind)
              set_state_record(to, qKind, qCount, Color(qOwner), k);
      }
  }'''),
('''      move_piece(from, to);
      for (int i = 0; i < st->slideCount; ++i)
      {
          SlideStep& s = st->slideSteps[i];
          assert(piece_on(s.from) == s.before);
          s.wasPromoted = is_promoted(s.from);
          s.unpromoted = unpromoted_piece_on(s.from);
          remove_piece(s.from);
          k ^= Zobrist::psq[s.before][s.from];''',
'''      move_piece(from, to);
      move_state_record(from, to, k); // THE PIECE STATES: the mover's record lands with it
      for (int i = 0; i < st->slideCount; ++i)
      {
          SlideStep& s = st->slideSteps[i];
          assert(piece_on(s.from) == s.before);
          s.wasPromoted = is_promoted(s.from);
          s.unpromoted = unpromoted_piece_on(s.from);
          remove_piece(s.from);
          if (s.to == SQ_NONE)
              clear_state_record(s.from, k);        // THE PIECE STATES: a fall takes the record with it
          else if (s.to != s.from)
              move_state_record(s.from, s.to, k);   // a shoved piece's record rides the shove
          k ^= Zobrist::psq[s.before][s.from];'''),
('''  else if (type_of(m) != CASTLING)
  {
      if (Eval::useNNUE)
      {
          dp.piece[0] = pc;
          dp.from[0] = from;
          dp.to[0] = to;
      }

      move_piece(from, to);
  }''',
'''  else if (type_of(m) != CASTLING)
  {
      if (Eval::useNNUE)
      {
          dp.piece[0] = pc;
          dp.from[0] = from;
          dp.to[0] = to;
      }

      move_piece(from, to);
      move_state_record(from, to, k); // THE PIECE STATES (piece-states.patch): the record rides the piece
  }'''),
('''  if (deck_on() && !half_open() && st->cardWinner < 0)
      refill(them, k);
''',
'''  // THE PIECE STATES (piece-states.patch): the clock - every real move drops
  // every count by one, and what reaches zero ends here, as the move's last
  // act (a control returns to its owner); the records this move set are fresh
  if (tick && st->stated)
      tick_states(k);

  if (deck_on() && !half_open() && st->cardWinner < 0)
      refill(them, k);
'''),
# undo_move(): the flips come back first - they were the move's last act
('''  if (st->fizzleSpent)
      add_to_hand(make_piece(us, var->cardSlotType[st->previous->castSlot[us]]));
''',
'''  if (st->fizzleSpent)
      add_to_hand(make_piece(us, var->cardSlotType[st->previous->castSlot[us]]));

  // THE PIECE STATES (piece-states.patch): the colour flips this move made
  // come back first (they were its last act); the records return with the state
  for (int i = st->flipCount - 1; i >= 0; --i)
  {
      remove_piece(st->flipSq[i]);
      put_piece(st->flipBefore[i], st->flipSq[i], st->flipPromoted[i], st->flipUnpromoted[i]);
  }
'''),
# see_ge(): an invincible captor is never taken back; an entombed piece never joins an exchange
('''  swap = PieceValue[MG][moved_piece(m)] - swap;
  if (swap <= 0)
      return true;
''',
'''  swap = PieceValue[MG][moved_piece(m)] - swap;
  if (swap <= 0)
      return true;

  // THE PIECE STATES (piece-states.patch): an invincible captor cannot be taken back
  if (type_of(m) != DROP && (st->uncapturable & from))
      return true;
'''),
('''      if ((bb = stmAttackers & pieces(PAWN)))
      {
          if ((swap = PawnValueMg - swap) < res)
              break;

          occupied ^= least_significant_square_bb(bb);
          attackers |= attacks_bb<BISHOP>(to, occupied | st->portalSquares) & pieces(BISHOP, QUEEN);
      }''',
'''      if ((bb = stmAttackers & pieces(PAWN)))
      {
          if ((swap = PawnValueMg - swap) < res)
              break;
          if (st->uncapturable & lsb(bb))
              return bool(res); // THE PIECE STATES: an invincible captor ends the exchange

          occupied ^= least_significant_square_bb(bb);
          attackers |= attacks_bb<BISHOP>(to, occupied | st->portalSquares) & pieces(BISHOP, QUEEN) & ~st->entombed;
      }'''),
('''      else if ((bb = stmAttackers & pieces(KNIGHT)))
      {
          if ((swap = KnightValueMg - swap) < res)
              break;

          occupied ^= least_significant_square_bb(bb);
      }''',
'''      else if ((bb = stmAttackers & pieces(KNIGHT)))
      {
          if ((swap = KnightValueMg - swap) < res)
              break;
          if (st->uncapturable & lsb(bb))
              return bool(res);

          occupied ^= least_significant_square_bb(bb);
      }'''),
('''      else if ((bb = stmAttackers & pieces(BISHOP)))
      {
          if ((swap = BishopValueMg - swap) < res)
              break;

          occupied ^= least_significant_square_bb(bb);
          attackers |= attacks_bb<BISHOP>(to, occupied | st->portalSquares) & pieces(BISHOP, QUEEN);
      }''',
'''      else if ((bb = stmAttackers & pieces(BISHOP)))
      {
          if ((swap = BishopValueMg - swap) < res)
              break;
          if (st->uncapturable & lsb(bb))
              return bool(res);

          occupied ^= least_significant_square_bb(bb);
          attackers |= attacks_bb<BISHOP>(to, occupied | st->portalSquares) & pieces(BISHOP, QUEEN) & ~st->entombed;
      }'''),
('''      else if ((bb = stmAttackers & pieces(ROOK)))
      {
          if ((swap = RookValueMg - swap) < res)
              break;

          occupied ^= least_significant_square_bb(bb);
          attackers |= attacks_bb<ROOK>(to, occupied | st->portalSquares) & pieces(ROOK, QUEEN);
      }''',
'''      else if ((bb = stmAttackers & pieces(ROOK)))
      {
          if ((swap = RookValueMg - swap) < res)
              break;
          if (st->uncapturable & lsb(bb))
              return bool(res);

          occupied ^= least_significant_square_bb(bb);
          attackers |= attacks_bb<ROOK>(to, occupied | st->portalSquares) & pieces(ROOK, QUEEN) & ~st->entombed;
      }'''),
('''      else if ((bb = stmAttackers & pieces(QUEEN)))
      {
          if ((swap = QueenValueMg - swap) < res)
              break;

          occupied ^= least_significant_square_bb(bb);
          attackers |=  (attacks_bb<BISHOP>(to, occupied | st->portalSquares) & pieces(BISHOP, QUEEN))
                      | (attacks_bb<ROOK  >(to, occupied | st->portalSquares) & pieces(ROOK  , QUEEN));
      }''',
'''      else if ((bb = stmAttackers & pieces(QUEEN)))
      {
          if ((swap = QueenValueMg - swap) < res)
              break;
          if (st->uncapturable & lsb(bb))
              return bool(res);

          occupied ^= least_significant_square_bb(bb);
          attackers |= (  (attacks_bb<BISHOP>(to, occupied | st->portalSquares) & pieces(BISHOP, QUEEN))
                        | (attacks_bb<ROOK  >(to, occupied | st->portalSquares) & pieces(ROOK  , QUEEN))) & ~st->entombed;
      }'''),
('''      else if ((bb = stmAttackers & ~pieces(KING)))
      {
          if ((swap = PieceValue[MG][piece_on(lsb(bb))] - swap) < res)
              break;

          occupied ^= lsb(bb);
      }''',
'''      else if ((bb = stmAttackers & ~pieces(KING)))
      {
          if ((swap = PieceValue[MG][piece_on(lsb(bb))] - swap) < res)
              break;
          if (st->uncapturable & lsb(bb))
              return bool(res);

          occupied ^= lsb(bb);
      }'''),
# slide_outcome(): an entombed piece is a wall to the slide; a landing never swaps with an entombed twin
('''  const Bitboard walls = st->wallSquares & ~st->holeSquares;
  const Bitboard board = board_size_bb(var->maxFile, var->maxRank);
''',
'''  const Bitboard walls = (st->wallSquares & ~st->holeSquares) | st->entombed; // THE PIECE STATES: an entombed piece is a wall to the slide
  const Bitboard board = board_size_bb(var->maxFile, var->maxRank);
'''),
('''          if (st->portalSquares & nx)
          {
              if (!(occ & nx))
                  landing = nx;                        // an empty portal square: a landing on it
              break;                                   // a piece on one is an obstacle
          }''',
'''          if (st->portalSquares & nx)
          {
              if (!(occ & nx) && portal_landable(nx))
                  landing = nx;                        // an empty portal square: a landing on it (never a swap with an entombed twin)
              break;                                   // a piece on one is an obstacle
          }'''),
# parse_portal_field(): "%e5s3"
('''      // "!w" the side that played a win card
      if (field[i] == '!')
      {''',
'''      // THE PIECE STATES (piece-states.patch): "%e5s3" - a record on the piece
      // on e5: the kind letter (s stun, i invincible, c control, e entomb),
      // the count (none for entomb), the owner for control. A record that
      // cannot stand (no piece, a king, a bad count, a control owned by the
      // piece's own colour) is dropped.
      if (field[i] == '%')
      {
          ++i;
          Square s = parse_square(i);
          if (s == SQ_NONE)
              break;
          int kind = STATE_NONE;
          if (i < field.size())
          {
              const char kc = field[i];
              kind = kc == 's' ? STATE_STUN : kc == 'i' ? STATE_INVINCIBLE : kc == 'c' ? STATE_CONTROL : kc == 'e' ? STATE_ENTOMB : STATE_NONE;
              if (kind != STATE_NONE)
                  ++i;
          }
          int cnt = 0;
          while (i < field.size() && isdigit((unsigned char)field[i]))
              cnt = 10 * cnt + (field[i++] - '0');
          bool hasOwner = false;
          Color owner = WHITE;
          if (i < field.size() && (field[i] == 'w' || field[i] == 'b'))
          {
              hasOwner = true;
              owner = field[i++] == 'w' ? WHITE : BLACK;
          }
          if (kind != STATE_NONE && (pieces() & s) && piece_on(s) != NO_PIECE && type_of(piece_on(s)) != KING)
          {
              bool ok = kind == STATE_ENTOMB ? cnt == 0 : (cnt >= 1 && cnt <= MAX_STATE_COUNT);
              if (kind == STATE_CONTROL)
                  ok = ok && hasOwner && owner != color_of(piece_on(s));
              else
                  owner = WHITE;
              if (ok)
              {
                  st->stateKind[s] = uint8_t(kind);
                  st->stateCount[s] = uint8_t(cnt);
                  st->stateOwner[s] = uint8_t(owner);
                  st->stated |= s;
                  if (kind == STATE_STUN || kind == STATE_ENTOMB)
                      st->immobile |= s;
                  if (kind == STATE_INVINCIBLE || kind == STATE_ENTOMB)
                      st->uncapturable |= s;
                  if (kind == STATE_ENTOMB)
                      st->entombed |= s;
                  if (kind == STATE_CONTROL)
                      st->controlled |= s;
              }
          }
          continue;
      }
      // "!w" the side that played a win card
      if (field[i] == '!')
      {'''),
# cast_changes(): the piece effects
('''  switch (def.kind)
  {
  case CARD_WIN:
      return st->cardWinner < 0;''',
'''  if (is_piece_effect(def.kind))
      return piece_effect_changes(def, cells, c); // THE PIECE STATES (piece-states.patch)
  if (def.kind == CARD_HIT && (cells & st->entombed))
      return true;                                // THE PIECE STATES: a hit frees an entombed piece
  switch (def.kind)
  {
  case CARD_WIN:
      return st->cardWinner < 0;'''),
# apply_cast(): a hit frees every entombed piece among its cells
('''  else if (def.kind == CARD_HIT)
  {
      // a crate takes the hit and is floor; an intact wall cracks into a crate
      // under one hit and is floor under two
      Bitboard crates = cells & st->deadSquares;''',
'''  else if (def.kind == CARD_HIT)
  {
      // THE PIECE STATES (piece-states.patch): a hit frees every entombed piece among the cells
      for (Bitboard freed = cells & st->entombed; freed; )
          clear_state_record(pop_lsb(freed), k);
      // a crate takes the hit and is floor; an intact wall cracks into a crate
      // under one hit and is floor under two
      Bitboard crates = cells & st->deadSquares;'''),
# cast_anchors(): a piece effect's anchors are the floor squares, occupied or not
('''  case CARD_ICE:
  case CARD_WALL:
  case CARD_PIT:
      cand = board_bb() & ~st->deadSquares;                          // a floor square, occupied or not
      break;''',
'''  case CARD_ICE:
  case CARD_WALL:
  case CARD_PIT:
  case CARD_STUN:                                                    // THE PIECE STATES: the shape is laid on any floor square and the null rule keeps the anchors whose cells hold a piece it changes
  case CARD_INVINCIBLE:
  case CARD_CONTROL:
  case CARD_ENTOMB:
      cand = board_bb() & ~st->deadSquares;                          // a floor square, occupied or not
      break;'''),
# apply_cast(): the piece effects
('''  const Bitboard cells = effect_cells(def, anchor, us);
  if (def.kind == CARD_ICE)
  {''',
'''  const Bitboard cells = effect_cells(def, anchor, us);
  if (is_piece_effect(def.kind))
  {
      apply_piece_effect(def, cells, us, k); // THE PIECE STATES (piece-states.patch)
      return;
  }
  if (def.kind == CARD_ICE)
  {'''),
# the new functions
('''/// Position::do_mulligan() discards the mover's whole hand (the blanks too)
/// and draws anew from its pile.
''',
'''/// THE PIECE STATES (piece-states.patch, brief 4.10 "3.4 RULED"). One record
/// per square, hashed by square, kind, count and owner; the bitboards are its
/// summary. A record rides the piece it is on through every relocation and
/// clears when the piece is captured. The clock is in plies.

Key Position::state_key(Square s) const {
  return Zobrist::pieceState[s][st->stateKind[s]][st->stateCount[s]][st->stateOwner[s]];
}


void Position::set_state_record(Square s, int kind, int count, Color owner, Key& k) {

  assert(kind != STATE_NONE);
  assert(!(st->stated & s));
  st->stateKind[s] = uint8_t(kind);
  st->stateCount[s] = uint8_t(count);
  st->stateOwner[s] = uint8_t(kind == STATE_CONTROL ? owner : WHITE);
  st->stated |= s;
  if (kind == STATE_STUN || kind == STATE_ENTOMB)
      st->immobile |= s;
  if (kind == STATE_INVINCIBLE || kind == STATE_ENTOMB)
      st->uncapturable |= s;
  if (kind == STATE_ENTOMB)
      st->entombed |= s;
  if (kind == STATE_CONTROL)
      st->controlled |= s;
  k ^= state_key(s);
}


void Position::clear_state_record(Square s, Key& k) {

  if (!(st->stated & s))
      return;
  k ^= state_key(s);
  st->stateKind[s] = st->stateCount[s] = st->stateOwner[s] = 0;
  st->stated &= ~square_bb(s);
  st->immobile &= ~square_bb(s);
  st->uncapturable &= ~square_bb(s);
  st->entombed &= ~square_bb(s);
  st->controlled &= ~square_bb(s);
}


void Position::move_state_record(Square from, Square to, Key& k) {

  if (!(st->stated & from) || from == to)
      return;
  assert(!(st->stated & to));
  const int kind = st->stateKind[from], count = st->stateCount[from], owner = st->stateOwner[from];
  clear_state_record(from, k);
  set_state_record(to, kind, count, Color(owner), k);
  if (st->freshStates & from)
      st->freshStates = (st->freshStates & ~square_bb(from)) | to;
}


/// The board edit of a control: the piece on s changes colour - keys and
/// material follow, the flip is recorded for undo (the records are the
/// state's own and return with it)

void Position::flip_piece_colour(Square s, Key& k) {

  const Piece old = piece_on(s);
  assert(old != NO_PIECE && type_of(old) != KING);
  const Piece nw = ~old;
  const bool promoted = is_promoted(s);
  const Piece unpromoted = unpromoted_piece_on(s);

  remove_piece(s);
  k ^= Zobrist::psq[old][s];
  st->materialKey ^= Zobrist::psq[old][pieceCount[old]];
  if (type_of(old) == PAWN)
      st->pawnKey ^= Zobrist::psq[old][s];
  else
      st->nonPawnMaterial[color_of(old)] -= PieceValue[MG][old];

  put_piece(nw, s, promoted, unpromoted != NO_PIECE ? ~unpromoted : NO_PIECE);
  k ^= Zobrist::psq[nw][s];
  st->materialKey ^= Zobrist::psq[nw][pieceCount[nw] - 1];
  if (type_of(nw) == PAWN)
      st->pawnKey ^= Zobrist::psq[nw][s];
  else
      st->nonPawnMaterial[color_of(nw)] += PieceValue[MG][nw];

  assert(st->flipCount < MAX_FLIPS);
  st->flipSq[st->flipCount] = s;
  st->flipBefore[st->flipCount] = old;
  st->flipPromoted[st->flipCount] = promoted;
  st->flipUnpromoted[st->flipCount] = unpromoted;
  ++st->flipCount;
  st->rule50 = 0;
}


/// THE CLOCK: every record set before this move drops by one; a stun or an
/// invincibility at zero ends, a control at zero returns the piece to its
/// owner (a colour flip on the square it stands on now); entomb has no count.

void Position::tick_states(Key& k) {

  for (Bitboard b = st->stated & ~st->freshStates; b; )
  {
      const Square s = pop_lsb(b);
      if (st->stateCount[s] == 0)
          continue;
      k ^= state_key(s);
      if (--st->stateCount[s] > 0)
      {
          k ^= state_key(s);
          continue;
      }
      const int kind = st->stateKind[s];
      // the record is gone (its key left above with the count it had)
      st->stateKind[s] = st->stateCount[s] = st->stateOwner[s] = 0;
      st->stated &= ~square_bb(s);
      st->immobile &= ~square_bb(s);
      st->uncapturable &= ~square_bb(s);
      st->controlled &= ~square_bb(s);
      if (kind == STATE_CONTROL)
          flip_piece_colour(s, k);
  }
}


/// What a piece effect does to the piece on s, cast by us: the record it
/// leaves and the colour the piece ends in. A controlled piece first returns
/// to its owner (the overwrite); control then takes it for the caster unless
/// the caster IS its owner (a recall). Returns whether anything changes.

bool Position::piece_effect_result(const CardDef& def, Square s, Color us, int& kind, int& count, Color& owner, Color& colour) const {

  const Piece pc = piece_on(s);
  if (pc == NO_PIECE || type_of(pc) == KING)
      return false;
  const Color bc = color_of(pc);
  const int cur = st->stateKind[s], curCount = st->stateCount[s];
  const Color curOwner = Color(st->stateOwner[s]);
  const Color trueOwner = cur == STATE_CONTROL ? curOwner : bc;
  owner = WHITE;
  switch (def.kind)
  {
  case CARD_CONTROL:
      if (trueOwner == us)
      {
          kind = STATE_NONE;
          count = 0;
          colour = us;
      }
      else
      {
          kind = STATE_CONTROL;
          count = def.arg;
          owner = trueOwner;
          colour = us;
      }
      break;
  case CARD_STUN:
      kind = STATE_STUN;
      count = def.arg;
      colour = trueOwner;
      break;
  case CARD_INVINCIBLE:
      kind = STATE_INVINCIBLE;
      count = def.arg;
      colour = trueOwner;
      break;
  case CARD_ENTOMB:
      kind = STATE_ENTOMB;
      count = 0;
      colour = trueOwner;
      break;
  default:
      return false;
  }
  return colour != bc || kind != cur || count != curCount || (kind == STATE_CONTROL && owner != curOwner);
}


bool Position::piece_effect_changes(const CardDef& def, Bitboard cells, Color us) const {

  for (Bitboard b = cells & pieces() & ~pieces(KING); b; )
  {
      int kind, count;
      Color owner, colour;
      if (piece_effect_result(def, pop_lsb(b), us, kind, count, owner, colour))
          return true;
  }
  return false;
}


/// Position::apply_piece_effect() applies a piece-effect cast to every
/// non-king piece among the cells: a controlled piece returns, a control takes
/// it, the record is overwritten; the records set here are fresh (no tick
/// this move) and the flips are recorded for undo.

void Position::apply_piece_effect(const CardDef& def, Bitboard cells, Color us, Key& k) {

  for (Bitboard b = cells & pieces() & ~pieces(KING); b; )
  {
      const Square s = pop_lsb(b);
      int kind, count;
      Color owner, colour;
      if (!piece_effect_result(def, s, us, kind, count, owner, colour))
          continue;
      if (colour != color_of(piece_on(s)))
          flip_piece_colour(s, k);
      clear_state_record(s, k);
      if (kind != STATE_NONE)
          set_state_record(s, kind, count, owner, k);
      st->freshStates |= s;
      st->rule50 = 0;
  }
}


/// Position::virtual_attacks_king() answers whether kingColor's king is
/// attacked after move m is made - the board the move leaves, with the colour
/// flips and entombments a piece-effect cast makes and the returns of every
/// control whose count runs out with this move (the move's last act). The
/// move's own relocations are read per type (the slide's from its physics,
/// the portal's from the swap); the pieces that stay where they are are read
/// off the real board through the new occupancy, the rest from an edit list.

bool Position::virtual_attacks_king(Move m, Color kingColor) const {

  struct Edit { Square sq; Piece pc; bool inert; Square origin; };
  constexpr int MAX_EDITS = 128;
  Edit ed[MAX_EDITS];
  int n = 0;
  auto set_edit = [&](Square s, Piece pc, bool inert, Square origin) {
      for (int i = 0; i < n; ++i)
          if (ed[i].sq == s)
          {
              ed[i].pc = pc;
              ed[i].inert = inert;
              ed[i].origin = origin;
              return;
          }
      assert(n < MAX_EDITS);
      ed[n++] = { s, pc, inert, origin };
  };
  auto piece_at = [&](Square s) -> Piece {
      for (int i = 0; i < n; ++i)
          if (ed[i].sq == s)
              return ed[i].pc;
      return piece_on(s);
  };
  auto inert_at = [&](Square s) -> bool {
      for (int i = 0; i < n; ++i)
          if (ed[i].sq == s)
              return ed[i].inert;
      return bool(st->entombed & s);
  };
  // where the piece that stood on s before the move stands after it (SQ_NONE:
  // gone - captured, fallen, or replaced on its square by another piece)
  auto moved_to = [&](Square s) -> Square {
      for (int i = 0; i < n; ++i)
          if (ed[i].origin == s && ed[i].pc != NO_PIECE)
              return ed[i].sq;
      for (int i = 0; i < n; ++i)
          if (ed[i].sq == s)
              return SQ_NONE;
      return s;
  };

  const Color us = sideToMove;
  const Square from = from_sq(m), to = to_sq(m);
  const Piece pc = moved_piece(m);
  Bitboard occ = pieces();
  Bitboard recast = 0; // the cells a piece-effect cast re-states this move (they no longer expire)

  switch (type_of(m))
  {
  case NORMAL:
  case PROMOTION:
  case PIECE_PROMOTION:
  case PIECE_DEMOTION:
  {
      const Piece after = type_of(m) == PROMOTION       ? make_piece(us, promotion_type(m))
                        : type_of(m) == PIECE_PROMOTION ? make_piece(us, promoted_piece_type(type_of(pc)))
                        : type_of(m) == PIECE_DEMOTION  ? unpromoted_piece_on(from)
                                                        : pc;
      set_edit(from, NO_PIECE, false, SQ_NONE);
      set_edit(to, after, false, from);
      occ = (occ ^ from) | to;
      break;
  }
  case EN_PASSANT:
  {
      const Square capsq = capture_square(to);
      set_edit(from, NO_PIECE, false, SQ_NONE);
      set_edit(capsq, NO_PIECE, false, SQ_NONE);
      set_edit(to, pc, false, from);
      occ = ((occ ^ from) ^ capsq) | to;
      break;
  }
  case CASTLING:
  {
      const Square kto = make_square(to > from ? castling_kingside_file() : castling_queenside_file(), castling_rank(us));
      const Square rto = kto + (to > from ? WEST : EAST);
      const Piece rook = piece_on(to);
      set_edit(from, NO_PIECE, false, SQ_NONE);
      set_edit(to, NO_PIECE, false, SQ_NONE);
      set_edit(kto, pc, false, from);
      set_edit(rto, rook, false, to);
      occ = ((occ ^ from) ^ to) | kto | rto;
      break;
  }
  case PORTAL:
  {
      const Square q = portal_twin(to);
      const Piece swapped = q != from ? piece_on(q) : NO_PIECE;
      set_edit(from, NO_PIECE, false, SQ_NONE);
      set_edit(to, swapped, false, swapped ? q : SQ_NONE);
      set_edit(q, pc, false, from);
      occ = ((occ ^ from) & ~square_bb(to)) | q;
      if (swapped)
          occ |= to;
      break;
  }
  case SLIDE:
  {
      SlideStep steps[MAX_SLIDE_STEPS];
      const int ns = slide_outcome(m, steps);
      Square capsq = SQ_NONE;
      if (!empty(to))
          capsq = to;
      else if (type_of(pc) == PAWN && (st->epSquares & to) && file_of(from) != file_of(to))
          capsq = capture_square(to);
      set_edit(from, NO_PIECE, false, SQ_NONE);
      if (capsq != SQ_NONE && capsq != to)
          set_edit(capsq, NO_PIECE, false, SQ_NONE);
      set_edit(to, slide_mover_piece(m), false, from);
      occ = (occ ^ from) & ~square_bb(to);
      if (capsq != SQ_NONE)
          occ &= ~square_bb(capsq);
      occ |= to;
      for (int i = 0; i < ns; ++i)
      {
          const SlideStep& s = steps[i];
          // the piece on s.from came from somewhere: keep its origin
          Square origin = s.from;
          for (int j = 0; j < n; ++j)
              if (ed[j].sq == s.from && ed[j].pc != NO_PIECE)
                  origin = ed[j].origin;
          if (s.from != s.to)
          {
              set_edit(s.from, NO_PIECE, false, SQ_NONE);
              occ ^= s.from;
          }
          if (s.to != SQ_NONE)
          {
              set_edit(s.to, s.after, false, origin);
              occ |= s.to;
          }
      }
      break;
  }
  case DROP:
  {
      if (!is_spell_scroll(type_of(pc)))
      {
          set_edit(to, pc, false, SQ_NONE);
          occ |= to;
          break;
      }
      const CardDef* def = card_def(us, type_of(pc));
      if (!def)
          break;
      const Bitboard cells = effect_cells(*def, to, us);
      if (def->kind == CARD_HIT)
      {
          occ &= ~demolished(*def, cells);
          for (Bitboard freed = cells & st->entombed; freed; ) // a freed piece attacks again
          {
              const Square s = pop_lsb(freed);
              set_edit(s, piece_on(s), false, s);
          }
      }
      else if (def->kind == CARD_DROP)
      {
          set_edit(to, make_piece(us, PieceType(def->arg)), false, SQ_NONE);
          occ |= to;
      }
      else if (def->kind == CARD_WALL || def->kind == CARD_PIT)
          occ |= cells & board_bb() & ~st->deadSquares & ~pieces() & ~portal_taken();
      else if (is_piece_effect(def->kind))
          for (Bitboard b = cells & pieces() & ~pieces(KING); b; )
          {
              const Square s = pop_lsb(b);
              int kind, count;
              Color owner, colour;
              if (!piece_effect_result(*def, s, us, kind, count, owner, colour))
                  continue;
              set_edit(s, make_piece(colour, type_of(piece_on(s))), kind == STATE_ENTOMB, s);
              recast |= s;
          }
      break;
  }
  default: // HAMMER, MULLIGAN, a pass: nothing moves
      break;
  }

  // The controls that end with this move return to their owners, from
  // wherever their pieces stand after it
  if (ticks(m))
      for (Bitboard b = expiring_controls() & ~recast; b; )
      {
          const Square s = pop_lsb(b);
          const Square at = moved_to(s);
          if (at == SQ_NONE)
              continue;
          const Piece p = piece_at(at);
          if (p == NO_PIECE)
              continue;
          set_edit(at, make_piece(Color(st->stateOwner[s]), type_of(p)), false, at);
      }

  // The king, where he ends (a slide can carry him; a fall is reported as an
  // attack on the mover's own king, as slide_attacks_king does)
  Square ksq = count<KING>(kingColor) ? square<KING>(kingColor) : SQ_NONE;
  if (ksq == SQ_NONE)
      return false;
  {
      const Square at = moved_to(ksq);
      if (at == SQ_NONE)
          return kingColor == us;
      ksq = at;
  }

  const Color att = ~kingColor;
  Bitboard edited = 0;
  for (int i = 0; i < n; ++i)
      edited |= ed[i].sq;

  // Every piece that stands where the real board has it, through the new occupancy
  if (attackers_to(ksq, occ, att) & ~edited)
      return true;

  // The edited squares, from where their pieces end, through the bodies
  const Bitboard bodies = occ | st->portalSquares;
  for (int i = 0; i < n; ++i)
  {
      if (ed[i].pc == NO_PIECE || color_of(ed[i].pc) != att || ed[i].inert || ed[i].sq == ksq)
          continue;
      const PieceType pt = type_of(ed[i].pc);
      const PieceType movePt = pt == KING ? king_type() : pt;
      if (attacks_bb(att, movePt, ed[i].sq, bodies) & ksq)
          return true;
  }
  return false;
}


/// Position::do_mulligan() discards the mover's whole hand (the blanks too)
/// and draws anew from its pile.
'''),
])

# ---------------------------------------------------------------- movegen.cpp
edit('movegen.cpp', [
# a landing never swaps with an entombed twin
('''    // A move landing on a portal square is a portal move; en passant never lands on one
    if (T == NORMAL && (pos.portal_squares() & to))
        *moveList++ = make<PORTAL>(from, to);''',
'''    // A move landing on a portal square is a portal move; en passant never lands on one
    if (T == NORMAL && (pos.portal_squares() & to))
    {
        if (pos.portal_landable(to)) // THE PIECE STATES: never a swap with an entombed twin
            *moveList++ = make<PORTAL>(from, to);
    }'''),
# pawns: the immobile never move, the uncapturable are never taken
('''    const Bitboard pawns      = pos.pieces(Us, PAWN);
    const Bitboard movable    = pos.board_bb(Us, PAWN) & ~pos.pieces();
    const Bitboard capturable = pos.board_bb(Us, PAWN) & (pos.pieces(Them) | pos.dead_squares());

    target = Type == EVASIONS ? target : AllSquares;''',
'''    const Bitboard pawns      = pos.pieces(Us, PAWN) & ~pos.immobile_squares(); // THE PIECE STATES: a stunned or entombed pawn never moves
    const Bitboard movable    = pos.board_bb(Us, PAWN) & ~pos.pieces();
    const Bitboard capturable = pos.board_bb(Us, PAWN) & (pos.pieces(Them) | pos.dead_squares()) & ~pos.uncapturable_squares(); // and nothing takes an invincible or entombed piece

    target = Type == EVASIONS ? target : AllSquares;'''),
('''            Bitboard b = pawns & pawn_attacks_bb(Them, epSquare);

            // En passant square is already disabled for non-fairy variants if there is no attacker
            assert(b || !pos.fast_attacks());''',
'''            // THE PIECE STATES: an invincible pawn is not taken en passant either
            if (pos.uncapturable_squares() & pos.capture_square(epSquare))
                continue;

            Bitboard b = pawns & pawn_attacks_bb(Them, epSquare);

            // En passant square is already disabled for non-fairy variants if there is no attacker
            assert(b || !pos.fast_attacks());'''),
# pieces: the immobile never move
('''    Bitboard bb = pos.pieces(Us, Pt);

    while (bb)
    {
        Square from = pop_lsb(bb);

        Bitboard attacks = pos.attacks_from(Us, Pt, from);''',
'''    Bitboard bb = pos.pieces(Us, Pt) & ~pos.immobile_squares(); // THE PIECE STATES: a stunned or entombed piece never moves

    while (bb)
    {
        Square from = pop_lsb(bb);

        Bitboard attacks = pos.attacks_from(Us, Pt, from);'''),
# portal evasions
('''    const Bitboard portals = pos.portal_squares() & ~pos.pieces(Us);
    if (!portals)
        return moveList;''',
'''    const Bitboard portals = pos.portal_squares() & ~pos.pieces(Us) & ~pos.uncapturable_squares() & pos.portal_landable_bb(); // THE PIECE STATES
    if (!portals)
        return moveList;'''),
('''        const Bitboard pawns      = pos.pieces(Us, PAWN);
        const Bitboard movable    = pos.board_bb(Us, PAWN) & ~pos.pieces();
        const Bitboard capturable = pos.board_bb(Us, PAWN) & pos.pieces(Them);
        Bitboard b1  = shift<Up>(pawns) & movable & portals;''',
'''        const Bitboard pawns      = pos.pieces(Us, PAWN) & ~pos.immobile_squares(); // THE PIECE STATES
        const Bitboard movable    = pos.board_bb(Us, PAWN) & ~pos.pieces();
        const Bitboard capturable = pos.board_bb(Us, PAWN) & pos.pieces(Them);
        Bitboard b1  = shift<Up>(pawns) & movable & portals;'''),
('''        for (Bitboard bb = pos.pieces(Us, pt); bb; )
        {
            Square from = pop_lsb(bb);
            Bitboard b = (  (pos.attacks_from(Us, pt, from) & pos.pieces())
                          | (pos.moves_from(Us, pt, from) & ~pos.pieces())) & portals;''',
'''        for (Bitboard bb = pos.pieces(Us, pt) & ~pos.immobile_squares(); bb; ) // THE PIECE STATES
        {
            Square from = pop_lsb(bb);
            Bitboard b = (  (pos.attacks_from(Us, pt, from) & pos.pieces())
                          | (pos.moves_from(Us, pt, from) & ~pos.pieces())) & portals;'''),
# slide evasions
('''    const Bitboard slick = pos.slick_effective() & ~pos.pieces(Us);
    if (!slick)
        return moveList;''',
'''    const Bitboard slick = pos.slick_effective() & ~pos.pieces(Us) & ~pos.uncapturable_squares(); // THE PIECE STATES
    if (!slick)
        return moveList;'''),
('''        const Bitboard pawns      = pos.pieces(Us, PAWN);
        const Bitboard movable    = pos.board_bb(Us, PAWN) & ~pos.pieces();
        const Bitboard capturable = pos.board_bb(Us, PAWN) & (pos.pieces(Them) | pos.dead_squares());
        const Bitboard passable   = movable & ~pos.portal_squares();''',
'''        const Bitboard pawns      = pos.pieces(Us, PAWN) & ~pos.immobile_squares(); // THE PIECE STATES
        const Bitboard movable    = pos.board_bb(Us, PAWN) & ~pos.pieces();
        const Bitboard capturable = pos.board_bb(Us, PAWN) & (pos.pieces(Them) | pos.dead_squares());
        const Bitboard passable   = movable & ~pos.portal_squares();'''),
('''        for (Bitboard epSquares = pos.ep_squares() & ~pos.pieces() & slick; epSquares; )
        {
            Square epSquare = pop_lsb(epSquares);
            Bitboard b = pawns & pawn_attacks_bb(Them, epSquare);''',
'''        for (Bitboard epSquares = pos.ep_squares() & ~pos.pieces() & slick; epSquares; )
        {
            Square epSquare = pop_lsb(epSquares);
            if (pos.uncapturable_squares() & pos.capture_square(epSquare)) // THE PIECE STATES
                continue;
            Bitboard b = pawns & pawn_attacks_bb(Them, epSquare);'''),
('''        for (Bitboard bb = pos.pieces(Us, pt); bb; )
        {
            Square from = pop_lsb(bb);
            Bitboard b = (  (pos.attacks_from(Us, pt, from) & pos.pieces())
                          | (pos.moves_from(Us, pt, from) & ~pos.pieces())) & slick;''',
'''        for (Bitboard bb = pos.pieces(Us, pt) & ~pos.immobile_squares(); bb; ) // THE PIECE STATES
        {
            Square from = pop_lsb(bb);
            Bitboard b = (  (pos.attacks_from(Us, pt, from) & pos.pieces())
                          | (pos.moves_from(Us, pt, from) & ~pos.pieces())) & slick;'''),
# generate_all: in check with a control about to return, everything is generated and legal() decides
('''    // Skip generating non-king moves when in double check
    if (Type != EVASIONS || !more_than_one(pos.checkers() & ~pos.non_sliding_riders()))
    {''',
'''    // THE PIECE STATES (piece-states.patch): in check with a control whose
    // count runs out with this move, every move is generated and legal()
    // judges it on the board the move leaves - the return may be what
    // resolves the check, and the king may walk into a line the return closes
    if (Type == EVASIONS && pos.controlled_squares() && pos.expiring_controls())
        return generate_all<Us, NON_EVASIONS>(pos, moveList);

    // Skip generating non-king moves when in double check
    if (Type != EVASIONS || !more_than_one(pos.checkers() & ~pos.non_sliding_riders()))
    {'''),
# generate_all: the target masks
('''        // Remove inaccessible squares (outside board + wall squares)
        target &= pos.board_bb();
''',
'''        // Remove inaccessible squares (outside board + wall squares)
        target &= pos.board_bb();

        // THE PIECE STATES (piece-states.patch): nothing captures an invincible or entombed piece
        target &= ~pos.uncapturable_squares();
'''),
('''                      | (pos.moves_from(Us, KING, ksq) & ~pos.pieces())) & (Type == EVASIONS ? ~pos.pieces(Us) & ~pos.portal_squares() & ~pos.slick_effective() : target);''',
'''                      | (pos.moves_from(Us, KING, ksq) & ~pos.pieces())) & (Type == EVASIONS ? ~pos.pieces(Us) & ~pos.portal_squares() & ~pos.slick_effective() & ~pos.uncapturable_squares() : target); // THE PIECE STATES'''),
])

# ---------------------------------------------------------------- apiutil.h
edit('apiutil.h', [
('''        // THE TERRAIN INTERPRETER (terrain.patch): "*w" a colour's hammer enchantment
        if (body[i] == '*')
        {
            ++i;
            if (i < body.size() && (body[i] == 'w' || body[i] == 'b'))
                ++i;
            else
                return NOK;
            continue;
        }''',
'''        // THE TERRAIN INTERPRETER (terrain.patch): "*w" a colour's hammer enchantment
        if (body[i] == '*')
        {
            ++i;
            if (i < body.size() && (body[i] == 'w' || body[i] == 'b'))
                ++i;
            else
                return NOK;
            continue;
        }
        // THE PIECE STATES (piece-states.patch): "%e5s3" a record on a piece - a
        // square, a kind letter, a count, the owner for control
        if (body[i] == '%')
        {
            ++i;
            if (parse_square(i) == SQ_NONE)
                return NOK;
            if (i >= body.size() || !(body[i] == 's' || body[i] == 'i' || body[i] == 'c' || body[i] == 'e'))
                return NOK;
            ++i;
            while (i < body.size() && isdigit((unsigned char)body[i]))
                ++i;
            if (i < body.size() && (body[i] == 'w' || body[i] == 'b'))
                ++i;
            continue;
        }'''),
])

print('piece-states edits applied')
