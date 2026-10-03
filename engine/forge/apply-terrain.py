#!/usr/bin/env python3
"""THE TERRAIN INTERPRETER (terrain.patch, the eleventh patch; brief 4.10
"Phase 3.3b" and "3.3b RULED", 2026-10-03) - anchor-based edits on a tree that
carries the ten patches before it (dead-squares, thread-stack, portals,
wall-kinds, hammer, portals-body, portals-cast, ice, deck, deck-search).
engine/patches/terrain.patch is this script's diff; both are committed.

  python3 apply-terrain.py <tree>/src

A card is a DEFINITION the engine interprets over the board:

  card<ID> = <effect> <shape> <targeting>     e.g.  card7 = hit1 xxx/xox/xxx near
                                                    card9 = drop p o camp

  effects    hit1 / hit2 (intact wall -> cracked -> floor; bedrock and pits
             immune, pieces untouched), ice (the floor of the shape slippery),
             wall (empty floor -> breakable stone), pit (empty floor -> a pit),
             harden (an intact breakable wall -> bedrock), sledge (the caster's
             colour may hammer from now on), drop <letter> (a real piece of the
             caster placed on the anchor), win, portal, meta
  shapes     a picture string: rows north to south separated by '/', 'x' a
             cell, 'o' the anchor cell, '.' nothing; no rotation on cast;
             clipped at the board's edge; at most 32 cells
  targeting  any (every anchor where the effect changes something), near (the
             anchor within a king's step of one of the caster's pieces),
             middle (the board's two middle rows), margin<n> (every cell of the
             shape n rows off both king rows), king (the caster's king's own
             square), ray / ray<n> (from the caster's king in one of eight
             directions, through pieces and over pits, to bedrock or the edge;
             the cast is the drop on the king's neighbour in that direction),
             camp (an empty square of the caster's double-step region)
  legacy     a one-word value keeps its old meaning: ice = ice xxx/xox/xxx
             middle, win = win o king, portal, meta

A cast is the slot letter's drop on the anchor (S@e4); a cast that changes
nothing is not generated; no cast in check; a hit's demolition (a crate or,
under hit2, a wall becoming floor) changes occupancy and is judged for check
and legality on the virtual occupancy; the sledge flag is one entry per
enchanted colour in the trailing field ("*w"), hashed; ice under a raised wall
or a new pit is cleared.
"""
import sys, os

SRC = sys.argv[1]

def edit(name, pairs):
    p = os.path.join(SRC, name)
    t = open(p).read()
    for old, new in pairs:
        assert t.count(old) == 1, f'{name}: anchor not unique or missing:\n{old[:200]}'
        t = t.replace(old, new)
    open(p, 'w').write(t)
    print(f'edited {name} ({len(pairs)} edits)')

# ---------------------------------------------------------------- types.h
edit('types.h', [
('''enum CardKind : int { CARD_NONE, CARD_PORTAL, CARD_ICE, CARD_WIN, CARD_META };
''',
'''enum CardKind : int { CARD_NONE, CARD_PORTAL, CARD_ICE, CARD_WIN, CARD_META,
                      CARD_HIT, CARD_WALL, CARD_PIT, CARD_HARDEN, CARD_SLEDGE, CARD_DROP }; // THE TERRAIN INTERPRETER (terrain.patch)

// THE TERRAIN INTERPRETER (terrain.patch, brief 4.10 "Phase 3.3b"): a card is
// a DEFINITION - an effect, a shape and a targeting rule - the engine
// interprets over the board; the card library is data in the variant ini.
constexpr int MAX_SHAPE_CELLS = 32;
enum CardTarget : int { TARGET_ANY, TARGET_NEAR, TARGET_MIDDLE, TARGET_MARGIN, TARGET_KING, TARGET_RAY, TARGET_CAMP };
struct CardDef {
  CardKind kind = CARD_NONE;
  int arg = 0;                      // hit: the hits per square (1 or 2); drop: the piece type placed
  int cells = 0;                    // the shape as offsets from the anchor, board space (+file east, +rank north)
  int8_t df[MAX_SHAPE_CELLS] = {};
  int8_t dr[MAX_SHAPE_CELLS] = {};
  CardTarget target = TARGET_ANY;
  int targetArg = 0;                // margin: the rows off each king row; ray: the length cap (0 = to bedrock or the edge)
};
'''),
])

# ---------------------------------------------------------------- variant.h
edit('variant.h', [
('''  std::map<int, int> cardKinds;
''',
'''  std::map<int, int> cardKinds;
  // THE TERRAIN INTERPRETER (terrain.patch): every card's definition by ID (its
  // kind is cardKinds'; its shape and targeting live here), and whether a
  // sledge card is in the deal - the hammer then needs the colour's enchantment
  std::map<int, CardDef> cardDefs;
  bool sledgeCards = false;
'''),
])

# ---------------------------------------------------------------- parser.cpp
edit('parser.cpp', [
('''template <bool DoCheck>
Variant* VariantParser<DoCheck>::parse() {''',
'''namespace {

  // THE TERRAIN INTERPRETER (terrain.patch): card<ID> = <effect> <shape> <targeting>
  // (apply-terrain.py's header has the grammar). A one-word value is a legacy
  // kind with its old default. Returns false with a reason in `err`.
  bool parse_card_def(const std::string& value, const std::string& pieceToChar, CardDef& def, std::string& err) {
      std::vector<std::string> tok;
      {
          std::istringstream ss(value);
          std::string t;
          while (ss >> t)
              tok.push_back(t);
      }
      def = CardDef();
      if (tok.empty())
      {
          err = "empty";
          return false;
      }
      // the effect word, with a number attached (hit2)
      const std::string& effect = tok[0];
      size_t p = 0;
      while (p < effect.size() && isalpha((unsigned char)effect[p]))
          ++p;
      const std::string word = effect.substr(0, p);
      int num = -1;
      if (p < effect.size())
      {
          for (size_t q = p; q < effect.size(); ++q)
              if (!isdigit((unsigned char)effect[q]))
              {
                  err = "bad effect: " + effect;
                  return false;
              }
          num = std::stoi(effect.substr(p));
      }
      size_t at = 1;
      if (word == "portal")      def.kind = CARD_PORTAL;
      else if (word == "ice")    def.kind = CARD_ICE;
      else if (word == "win")    def.kind = CARD_WIN;
      else if (word == "meta")   def.kind = CARD_META;
      else if (word == "hit")    { def.kind = CARD_HIT; def.arg = num < 0 ? 1 : num; }
      else if (word == "wall")   def.kind = CARD_WALL;
      else if (word == "pit")    def.kind = CARD_PIT;
      else if (word == "harden") def.kind = CARD_HARDEN;
      else if (word == "sledge") def.kind = CARD_SLEDGE;
      else if (word == "drop")
      {
          def.kind = CARD_DROP;
          if (at >= tok.size() || tok[at].size() != 1)
          {
              err = "drop needs a piece letter";
              return false;
          }
          size_t idx = pieceToChar.find(char(toupper((unsigned char)tok[at][0])));
          if (idx == std::string::npos || idx >= size_t(PIECE_TYPE_NB) || idx == size_t(KING))
          {
              err = "drop: no such piece: " + tok[at];
              return false;
          }
          def.arg = int(idx);
          ++at;
      }
      else
      {
          err = "unknown effect: " + word;
          return false;
      }
      if (num >= 0 && def.kind != CARD_HIT)
      {
          err = "a number on " + word;
          return false;
      }
      if (def.kind == CARD_HIT && (def.arg < 1 || def.arg > 2))
      {
          err = "hit takes 1 or 2";
          return false;
      }
      // the legacy one-word kinds
      std::string shape, target;
      if (def.kind == CARD_PORTAL || def.kind == CARD_META)
      {
          if (at != tok.size())
          {
              err = word + " takes no shape";
              return false;
          }
          return true;
      }
      if (at == tok.size() && def.kind == CARD_ICE)
      {
          shape = "xxx/xox/xxx";
          target = "middle";
      }
      else if (at == tok.size() && def.kind == CARD_WIN)
      {
          shape = "o";
          target = "king";
      }
      else if (at + 2 == tok.size())
      {
          shape = tok[at];
          target = tok[at + 1];
      }
      else
      {
          err = "expected <effect> <shape> <targeting>";
          return false;
      }
      // the shape: rows north to south, 'o' the anchor
      {
          int row = 0, col = 0, orow = -1, ocol = -1, rows = 1;
          std::vector<std::pair<int, int>> cells;
          for (char ch : shape)
          {
              if (ch == '/')
              {
                  ++row; col = 0; ++rows;
                  continue;
              }
              if (ch == 'o')
              {
                  if (orow >= 0)
                  {
                      err = "two anchors in " + shape;
                      return false;
                  }
                  orow = row; ocol = col;
                  cells.emplace_back(row, col);
              }
              else if (ch == 'x')
                  cells.emplace_back(row, col);
              else if (ch != '.')
              {
                  err = "bad shape: " + shape;
                  return false;
              }
              ++col;
              if (col > 7 || rows > 7)
              {
                  err = "shape too large: " + shape;
                  return false;
              }
          }
          if (orow < 0)
          {
              err = "no anchor in " + shape;
              return false;
          }
          if (int(cells.size()) > MAX_SHAPE_CELLS)
          {
              err = "too many cells in " + shape;
              return false;
          }
          for (const auto& rc : cells)
          {
              def.df[def.cells] = int8_t(rc.second - ocol);
              def.dr[def.cells] = int8_t(orow - rc.first); // the first row is the north
              ++def.cells;
          }
      }
      // the targeting word, with a number attached (margin2, ray5)
      {
          size_t q = 0;
          while (q < target.size() && isalpha((unsigned char)target[q]))
              ++q;
          const std::string tword = target.substr(0, q);
          int tnum = -1;
          if (q < target.size())
          {
              for (size_t r = q; r < target.size(); ++r)
                  if (!isdigit((unsigned char)target[r]))
                  {
                      err = "bad targeting: " + target;
                      return false;
                  }
              tnum = std::stoi(target.substr(q));
          }
          if (tword == "any")         def.target = TARGET_ANY;
          else if (tword == "near")   def.target = TARGET_NEAR;
          else if (tword == "middle") def.target = TARGET_MIDDLE;
          else if (tword == "king")   def.target = TARGET_KING;
          else if (tword == "camp")   def.target = TARGET_CAMP;
          else if (tword == "margin") { def.target = TARGET_MARGIN; def.targetArg = tnum < 0 ? 2 : tnum; }
          else if (tword == "ray")    { def.target = TARGET_RAY; def.targetArg = tnum < 0 ? 0 : tnum; }
          else
          {
              err = "unknown targeting: " + target;
              return false;
          }
          if (tnum >= 0 && def.target != TARGET_MARGIN && def.target != TARGET_RAY)
          {
              err = "a number on " + tword;
              return false;
          }
          if ((def.kind == CARD_WIN || def.kind == CARD_SLEDGE) && def.target != TARGET_KING)
          {
              err = word + " is cast on the king";
              return false;
          }
          if (def.target == TARGET_RAY && def.cells != 1)
          {
              err = "a ray's shape is o";
              return false;
          }
      }
      return true;
  }

} // namespace

template <bool DoCheck>
Variant* VariantParser<DoCheck>::parse() {'''),
('''        for (const std::string& key : cardKeys)
        {
            const std::string kind = config.find(key)->second;
            const int id = std::stoi(key.substr(4));
            v->cardKinds[id] = kind == "portal" ? CARD_PORTAL : kind == "ice" ? CARD_ICE : kind == "win" ? CARD_WIN : kind == "meta" ? CARD_META : CARD_NONE;
            if (DoCheck && v->cardKinds[id] == CARD_NONE)
                std::cerr << key << " - unknown card kind: " << kind << std::endl;
        }''',
'''        for (const std::string& key : cardKeys)
        {
            // THE TERRAIN INTERPRETER (terrain.patch): the card's definition - its kind, shape and targeting
            const std::string value = config.find(key)->second;
            const int id = std::stoi(key.substr(4));
            CardDef def;
            std::string err;
            if (!parse_card_def(value, v->pieceToChar, def, err))
            {
                if (DoCheck)
                    std::cerr << key << " - bad card definition (" << err << "): " << value << std::endl;
                def = CardDef();
            }
            v->cardKinds[id] = def.kind;
            v->cardDefs[id] = def;
            if (def.kind == CARD_SLEDGE)
                v->sledgeCards = true;
        }'''),
])

# ---------------------------------------------------------------- position.h
edit('position.h', [
('''  int8_t   cardWinner;
''',
'''  int8_t   cardWinner;
  uint8_t  sledge;        // THE TERRAIN INTERPRETER (terrain.patch): bit c set = colour c's hammer enchantment is on
'''),
('''  bool       fizzleSpent;                  // the fizzle spent the open half's card
''',
'''  bool       fizzleSpent;                  // the fizzle spent the open half's card
  bool       castPlaced;                   // THE TERRAIN INTERPRETER (terrain.patch): a drop effect placed a piece on 'to', for undo
'''),
('''  bool is_card_move(Move m) const;
  bool is_dig_move(Move m) const;
''',
'''  bool is_card_move(Move m) const;
  bool is_dig_move(Move m) const;
  // THE TERRAIN INTERPRETER (terrain.patch): a slot card's definition and its
  // interpretation over the board - the anchors its targeting allows and the
  // null rule keeps, the cells its shape (or its ray) covers, what a hit
  // floors, the king-attack tests of a cast on the virtual occupancy, and
  // whether a colour's hammer is enchanted on
  const CardDef* card_def(Color c, PieceType pt) const;
  Bitboard rect_bb() const;
  Bitboard effect_cells(const CardDef& def, Square anchor, Color c) const;
  bool cast_changes(const CardDef& def, Bitboard cells, Color c, Square anchor) const;
  Bitboard cast_anchors(Color c, PieceType pt) const;
  Bitboard demolished(const CardDef& def, Bitboard cells) const;
  bool cast_attacks_king(Move m, Color kingColor) const;
  bool cast_gives_check(Move m) const;
  bool sledge_on(Color c) const;
'''),
('''  void refill(Color c, Key& k);
  void do_mulligan(Color us, Key& k);
''',
'''  void refill(Color c, Key& k);
  void do_mulligan(Color us, Key& k);
  void apply_cast(const CardDef& def, Square anchor, Color us, Key& k); // THE TERRAIN INTERPRETER (terrain.patch)
'''),
('''// The floor an ice cast on s ices: the 3x3 around it, walls, pits and crates skipped
inline Bitboard Position::ice_patch(Square s) const {''',
'''// THE TERRAIN INTERPRETER (terrain.patch): the definition of the card a slot
// holds, while it holds one; nullptr for a legacy scroll or an empty slot
inline const CardDef* Position::card_def(Color c, PieceType pt) const {
  const int s = slot_index(pt);
  if (s < 0 || pieceCountInHand[c][pt] <= 0)
      return nullptr;
  const auto it = var->cardDefs.find(st->cardId[c][s]);
  return it == var->cardDefs.end() ? nullptr : &it->second;
}

// The board's whole rectangle, walls included
inline Bitboard Position::rect_bb() const {
  assert(var != nullptr);
  return board_size_bb(var->maxFile, var->maxRank);
}

// The hammer is on for a colour when no sledge card is in the deal (the
// hammerPieceTypes key alone decides, as before) or when its enchantment is
inline bool Position::sledge_on(Color c) const {
  assert(var != nullptr);
  return var->sledgeCards ? bool(st->sledge & (1 << c)) : true;
}

// The floor an ice cast on s ices: the 3x3 around it, walls, pits and crates skipped
inline Bitboard Position::ice_patch(Square s) const {'''),
])

# ---------------------------------------------------------------- position.cpp
edit('position.cpp', [
('''  Key castSlot[COLOR_NB][MAX_CARD_SLOTS]; // THE DECK (deck.patch): the slot whose portal half stands open
  Key cardWinner[COLOR_NB];            // the side that played a win card
''',
'''  Key castSlot[COLOR_NB][MAX_CARD_SLOTS]; // THE DECK (deck.patch): the slot whose portal half stands open
  Key cardWinner[COLOR_NB];            // the side that played a win card
  Key sledge[COLOR_NB];                // THE TERRAIN INTERPRETER (terrain.patch): a colour's hammer enchantment
'''),
('''      Zobrist::cardWinner[c] = deckRng.rand<Key>();
  }
''',
'''      Zobrist::cardWinner[c] = deckRng.rand<Key>();
  }

  // THE TERRAIN INTERPRETER (terrain.patch): the sledge enchantment per colour
  PRNG terrainRng(0x7E2D1C4B9A6F3E51ULL);
  for (Color c : {WHITE, BLACK})
      Zobrist::sledge[c] = terrainRng.rand<Key>();
'''),
# set_state: hash the flags
('''      if (si->cardWinner >= 0)
          si->key ^= Zobrist::cardWinner[si->cardWinner];
  }

  for (Color c : {WHITE, BLACK})
      for (PieceType pt = PAWN; pt <= KING; ++pt)''',
'''      if (si->cardWinner >= 0)
          si->key ^= Zobrist::cardWinner[si->cardWinner];
  }

  // THE TERRAIN INTERPRETER (terrain.patch): the sledge enchantments
  for (Color c : {WHITE, BLACK})
      if (si->sledge & (1 << c))
          si->key ^= Zobrist::sledge[c];

  for (Color c : {WHITE, BLACK})
      for (PieceType pt = PAWN; pt <= KING; ++pt)'''),
# fen(): the field opens for the flags too, and prints them
('''  if (st->portalSquares || st->portalHalf[WHITE] != SQ_NONE || st->portalHalf[BLACK] != SQ_NONE || st->slickSquares || deckField)
  {''',
'''  if (st->portalSquares || st->portalHalf[WHITE] != SQ_NONE || st->portalHalf[BLACK] != SQ_NONE || st->slickSquares || deckField || st->sledge)
  {'''),
('''          if (st->cardWinner >= 0)
          {
              ss << (first ? "" : ",") << "!" << (st->cardWinner == WHITE ? "w" : "b");
              first = false;
          }
      }
      ss << "}";''',
'''          if (st->cardWinner >= 0)
          {
              ss << (first ? "" : ",") << "!" << (st->cardWinner == WHITE ? "w" : "b");
              first = false;
          }
      }
      // THE TERRAIN INTERPRETER (terrain.patch): "*w" - White's hammer enchantment is on
      for (Color c : {WHITE, BLACK})
          if (st->sledge & (1 << c))
          {
              ss << (first ? "" : ",") << "*" << (c == WHITE ? "w" : "b");
              first = false;
          }
      ss << "}";'''),
# pseudo_legal(): a cast's anchor may be a wall square - validate a slot card's drop by regeneration BEFORE the
# board check (as the hammer is), not after it
('''  // A hammer's destination IS a wall square: validate a TT hammer by regeneration
  if (type_of(m) == HAMMER)
      return !checkers() && MoveList<NON_EVASIONS>(*this).contains(m);
''',
'''  // A hammer's destination IS a wall square: validate a TT hammer by regeneration
  if (type_of(m) == HAMMER)
      return !checkers() && MoveList<NON_EVASIONS>(*this).contains(m);

  // THE TERRAIN INTERPRETER (terrain.patch): a slot card's cast is validated by
  // regeneration - its anchor may be a wall square (a hit, a petrify, a ray's
  // first square), so this comes before the board check below
  if (type_of(m) == DROP && is_card_slot(in_hand_piece_type(m)))
      return !checkers() && can_drop(us, in_hand_piece_type(m)) && MoveList<NON_EVASIONS>(*this).contains(m);
'''),
('''  if (type_of(m) == MULLIGAN)
      return from == to && count<KING>(us) && from == square<KING>(us) && mulligan_allowed(us);
  if (type_of(m) == DROP && is_card_slot(in_hand_piece_type(m)))
      return !checkers() && can_drop(us, in_hand_piece_type(m)) && MoveList<NON_EVASIONS>(*this).contains(m);
''',
'''  if (type_of(m) == MULLIGAN)
      return from == to && count<KING>(us) && from == square<KING>(us) && mulligan_allowed(us);
'''),
# legal(): the assert on 'to', and the cast section
('''  assert((board_bb() & to) || type_of(m) == HAMMER);

  // PORTALS v3 (the one-turn cast): the frozen side's pass is its one legal''',
'''  assert((board_bb() & to) || type_of(m) == HAMMER || (type_of(m) == DROP && is_card_slot(dropped_piece_type(m)))); // a cast's anchor may be a wall (terrain.patch)

  // PORTALS v3 (the one-turn cast): the frozen side's pass is its one legal'''),
('''  if (type_of(m) == DROP && is_spell_scroll(dropped_piece_type(m)))
  {
      const CardKind kind = card_kind(us, dropped_piece_type(m));
      if (kind == CARD_PORTAL)
          return !checkers() && !(portal_taken() & to);
      return kind != CARD_NONE && kind != CARD_META && !checkers();
  }
''',
'''  if (type_of(m) == DROP && is_spell_scroll(dropped_piece_type(m)))
  {
      const CardKind kind = card_kind(us, dropped_piece_type(m));
      if (kind == CARD_PORTAL)
          return !checkers() && !(portal_taken() & to);
      if (kind == CARD_NONE || kind == CARD_META || checkers())
          return false;
      // THE TERRAIN INTERPRETER (terrain.patch): a hit that floors a crate or a
      // wall opens lines - one that opens a line onto the caster's own king is
      // illegal; the other effects only add occupancy or touch the ice
      if (kind == CARD_HIT)
          return !cast_attacks_king(m, us);
      return true;
  }
'''),
# gives_check(): the casts
('''  // A cast moves nothing on the board (a linking portal cast adds two bodies,
  // which can only close lines; the ice, the win card alike); nor does the
  // mulligan (deck.patch)
  if (type_of(m) == MULLIGAN || (type_of(m) == DROP && is_spell_scroll(dropped_piece_type(m))))
      return false;
''',
'''  // The mulligan moves nothing (deck.patch); a cast moves nothing either (a
  // linking portal cast adds two bodies, which can only close lines; the ice,
  // the win card alike) - except a HIT, whose demolition opens lines, and a
  // DROP effect, whose piece attacks from where it lands (terrain.patch)
  if (type_of(m) == MULLIGAN)
      return false;
  if (type_of(m) == DROP && is_spell_scroll(dropped_piece_type(m)))
      return cast_gives_check(m);
'''),
# do_move(): the def path for slot cards
('''  st->drawnCount = 0;
  st->discardedCount = 0;
  st->fizzleSpent = false;
''',
'''  st->drawnCount = 0;
  st->discardedCount = 0;
  st->fizzleSpent = false;
  st->castPlaced = false; // THE TERRAIN INTERPRETER (terrain.patch)
'''),
('''      else if (kind == CARD_ICE)
      {
          // THE ICE (ice.patch): an ice cast places nothing. The hand loses the
          // scroll and the floor of the 3x3 around the square turns slippery,
          // under whatever stands there; a square already slippery stays so.
          remove_from_hand(make_piece(us, in_hand_piece_type(m)));
          Bitboard patch = ice_patch(to) & ~st->slickSquares;''',
'''      else if (is_card_slot(type_of(pc)) && kind != CARD_NONE && kind != CARD_META)
      {
          // THE TERRAIN INTERPRETER (terrain.patch): a slot card's cast is its
          // definition applied over the board at the anchor - the hand loses
          // the card (the win card and the ice card alike, by their defs)
          const CardDef* def = card_def(us, type_of(pc));
          assert(def != nullptr);
          remove_from_hand(make_piece(us, in_hand_piece_type(m)));
          apply_cast(*def, to, us, k);
      }
      else if (kind == CARD_ICE)
      {
          // THE ICE (ice.patch): an ice cast places nothing. The hand loses the
          // scroll and the floor of the 3x3 around the square turns slippery,
          // under whatever stands there; a square already slippery stays so.
          remove_from_hand(make_piece(us, in_hand_piece_type(m)));
          Bitboard patch = ice_patch(to) & ~st->slickSquares;'''),
# undo_move(): a drop effect's piece leaves the board
('''              const bool openedHalf =   is_card_slot(in_hand_piece_type(m))
                                     && st->portalHalf[us] != SQ_NONE && st->previous->portalHalf[us] == SQ_NONE;
              if (!openedHalf)
                  add_to_hand(make_piece(us, in_hand_piece_type(m)));''',
'''              const bool openedHalf =   is_card_slot(in_hand_piece_type(m))
                                     && st->portalHalf[us] != SQ_NONE && st->previous->portalHalf[us] == SQ_NONE;
              if (st->castPlaced)
                  remove_piece(to); // THE TERRAIN INTERPRETER (terrain.patch): the drop effect's piece leaves; the keys return with the state
              if (!openedHalf)
                  add_to_hand(make_piece(us, in_hand_piece_type(m)));'''),
# parse_portal_field(): "*w"
('''      // "!w" the side that played a win card
      if (field[i] == '!')
      {''',
'''      // THE TERRAIN INTERPRETER (terrain.patch): "*w" - White's hammer enchantment is on
      if (field[i] == '*')
      {
          ++i;
          if (i < field.size() && (field[i] == 'w' || field[i] == 'b'))
          {
              if (var->sledgeCards)
                  st->sledge |= uint8_t(1 << (field[i] == 'w' ? WHITE : BLACK));
              ++i;
          }
          continue;
      }
      // "!w" the side that played a win card
      if (field[i] == '!')
      {'''),
# the interpreter's functions, after do_mulligan
('''/// Position::do_mulligan() discards the mover's whole hand (the blanks too)
/// and draws anew from its pile.
''',
'''/// THE TERRAIN INTERPRETER (terrain.patch, brief 4.10 "Phase 3.3b"). A slot
/// card's definition - effect, shape, targeting - interpreted over the board.
/// The cells of a cast at an anchor: the shape's offsets clipped to the
/// board, or the ray from the king's neighbour on through pieces and over
/// pits to bedrock or the edge (capped by the def's length).

Bitboard Position::effect_cells(const CardDef& def, Square anchor, Color c) const {

  Bitboard out = 0;
  if (def.target == TARGET_RAY)
  {
      if (!count<KING>(c))
          return 0;
      const Square ksq = square<KING>(c);
      const int df = int(file_of(anchor)) - int(file_of(ksq));
      const int dr = int(rank_of(anchor)) - int(rank_of(ksq));
      if (std::abs(df) > 1 || std::abs(dr) > 1 || (df == 0 && dr == 0))
          return 0;
      const Bitboard bedrock = st->hardSquares & ~st->holeSquares;
      int f = int(file_of(anchor)), r = int(rank_of(anchor)), n = 0;
      while (f >= 0 && f <= int(max_file()) && r >= 0 && r <= int(max_rank()))
      {
          const Square s = make_square(File(f), Rank(r));
          if (bedrock & s)
              break;
          out |= s;
          if (def.targetArg && ++n >= def.targetArg)
              break;
          f += df;
          r += dr;
      }
      return out;
  }
  for (int i = 0; i < def.cells; ++i)
  {
      const int f = int(file_of(anchor)) + def.df[i];
      const int r = int(rank_of(anchor)) + def.dr[i];
      if (f < 0 || f > int(max_file()) || r < 0 || r > int(max_rank()))
          continue;
      out |= make_square(File(f), Rank(r));
  }
  return out;
}


/// The null rule: a cast that changes nothing is no move. Per effect, the
/// squares the cells would change - the per-square table of the ruling.

bool Position::cast_changes(const CardDef& def, Bitboard cells, Color c, Square anchor) const {

  switch (def.kind)
  {
  case CARD_WIN:
      return st->cardWinner < 0;
  case CARD_SLEDGE:
      return !(st->sledge & (1 << c));
  case CARD_DROP:
      return bool(square_bb(anchor) & board_bb() & ~pieces() & ~portal_taken() & ~promotion_zone(c));
  case CARD_ICE:
      return bool(cells & board_bb() & ~st->deadSquares & ~st->slickSquares);
  case CARD_HIT:
      return bool(cells & (st->deadSquares | breakable_walls()));
  case CARD_WALL:
  case CARD_PIT:
      return bool(cells & board_bb() & ~st->deadSquares & ~pieces() & ~portal_taken());
  case CARD_HARDEN:
      return bool(cells & breakable_walls());
  default:
      return false;
  }
}


/// The anchors a slot card may be cast on: the effect's own candidate squares,
/// narrowed by the targeting word, kept by the null rule.

Bitboard Position::cast_anchors(Color c, PieceType pt) const {

  const CardDef* def = card_def(c, pt);
  if (!def)
      return 0;
  const Square ksq = count<KING>(c) ? square<KING>(c) : SQ_NONE;
  Bitboard cand;
  switch (def->kind)
  {
  case CARD_WIN:
  case CARD_SLEDGE:
      cand = ksq != SQ_NONE ? square_bb(ksq) : Bitboard(0);
      break;
  case CARD_HIT:
      cand = rect_bb() & ~st->hardSquares;                          // a wall, a crate or a floor square
      break;
  case CARD_HARDEN:
      cand = (board_bb() & ~st->deadSquares) | breakable_walls();    // a wall or a floor square
      break;
  case CARD_DROP:
      cand = board_bb() & ~pieces();                                 // empty floor
      break;
  case CARD_ICE:
  case CARD_WALL:
  case CARD_PIT:
      cand = board_bb() & ~st->deadSquares;                          // a floor square, occupied or not
      break;
  default:
      return 0;
  }
  switch (def->target)
  {
  case TARGET_KING:
      cand &= ksq != SQ_NONE ? square_bb(ksq) : Bitboard(0);
      break;
  case TARGET_NEAR:
  {
      Bitboard near = 0;
      for (Bitboard b = pieces(c); b; )
      {
          const Square s = pop_lsb(b);
          near |= PseudoAttacks[WHITE][KING][s] | s;
      }
      cand &= near;
      break;
  }
  case TARGET_MIDDLE:
  {
      const int lo = (int(max_rank()) + 1) / 2 - 1;
      cand &= rank_bb(Rank(lo)) | rank_bb(Rank(lo + 1));
      break;
  }
  case TARGET_CAMP:
      cand &= double_step_region(c);
      break;
  case TARGET_RAY:
  {
      if (ksq == SQ_NONE)
          return 0;
      cand = 0;
      for (int df = -1; df <= 1; ++df)
          for (int dr = -1; dr <= 1; ++dr)
          {
              if (!df && !dr)
                  continue;
              const int f = int(file_of(ksq)) + df, r = int(rank_of(ksq)) + dr;
              if (f >= 0 && f <= int(max_file()) && r >= 0 && r <= int(max_rank()))
                  cand |= make_square(File(f), Rank(r));
          }
      break;
  }
  default:
      break;
  }
  Bitboard band = 0;
  if (def->target == TARGET_MARGIN)
      for (int r = def->targetArg; r <= int(max_rank()) - def->targetArg; ++r)
          band |= rank_bb(Rank(r));
  Bitboard out = 0;
  while (cand)
  {
      const Square a = pop_lsb(cand);
      const Bitboard cells = effect_cells(*def, a, c);
      if (def->target == TARGET_MARGIN && (cells & ~band))
          continue;
      if (cast_changes(*def, cells, c, a))
          out |= a;
  }
  return out;
}


/// What a hit floors: every crate among the cells, and under hit2 every
/// breakable wall too - the squares that leave the occupancy.

Bitboard Position::demolished(const CardDef& def, Bitboard cells) const {

  if (def.kind != CARD_HIT)
      return 0;
  Bitboard d = cells & st->deadSquares;
  if (def.arg >= 2)
      d |= cells & breakable_walls();
  return d;
}


/// Whether a hit cast leaves kingColor's king attacked - judged on the
/// occupancy the demolition leaves (the portal patch's virtual-board idiom).
/// Before the cast nobody is in check (a cast is never made in check, and the
/// side to move cannot be checking), so any attacker found is the cast's own.

bool Position::cast_attacks_king(Move m, Color kingColor) const {

  assert(type_of(m) == DROP);
  const Color us = sideToMove;
  const CardDef* def = card_def(us, in_hand_piece_type(m));
  if (!def || def->kind != CARD_HIT || !count<KING>(kingColor))
      return false;
  const Bitboard dem = demolished(*def, effect_cells(*def, to_sq(m), us));
  if (!dem)
      return false;
  return bool(attackers_to(square<KING>(kingColor), byTypeBB[ALL_PIECES] & ~dem, ~kingColor));
}


/// Whether a cast gives check: a hit through its demolition, a drop effect by
/// the piece it places; every other effect never (it adds occupancy or ice).

bool Position::cast_gives_check(Move m) const {

  assert(type_of(m) == DROP);
  const Color us = sideToMove;
  if (!count<KING>(~us))
      return false;
  const CardDef* def = card_def(us, in_hand_piece_type(m));
  if (!def)
      return false;
  if (def->kind == CARD_HIT)
      return cast_attacks_king(m, ~us);
  if (def->kind == CARD_DROP)
      return bool(attacks_bb(us, PieceType(def->arg), to_sq(m), byTypeBB[ALL_PIECES] | to_sq(m)) & square<KING>(~us));
  return false;
}


/// Position::apply_cast() applies a slot card's definition at the anchor, in
/// do_move, after the hand lost the card: the terrain bitboards, the
/// occupancy and the key change; undo is the state pointer (every bitboard
/// edited lives in the copied state, and undo_move's wall / dead XORs restore
/// the occupancy), a placed piece leaves on castPlaced.

void Position::apply_cast(const CardDef& def, Square anchor, Color us, Key& k) {

  switch (def.kind)
  {
  case CARD_WIN:
      st->cardWinner = int8_t(us);
      k ^= Zobrist::cardWinner[us];
      return;
  case CARD_SLEDGE:
      st->sledge |= uint8_t(1 << us);
      k ^= Zobrist::sledge[us];
      return;
  case CARD_DROP:
  {
      const Piece pc = make_piece(us, PieceType(def.arg));
      put_piece(pc, anchor);
      k ^= Zobrist::psq[pc][anchor];
      st->materialKey ^= Zobrist::psq[pc][pieceCount[pc] - 1];
      if (type_of(pc) == PAWN)
          st->pawnKey ^= Zobrist::psq[pc][anchor];
      else
          st->nonPawnMaterial[us] += PieceValue[MG][pc];
      st->castPlaced = true;
      return;
  }
  default:
      break;
  }
  const Bitboard cells = effect_cells(def, anchor, us);
  if (def.kind == CARD_ICE)
  {
      Bitboard patch = cells & board_bb() & ~st->deadSquares & ~st->slickSquares;
      st->slickSquares |= patch;
      while (patch)
          k ^= Zobrist::slick[pop_lsb(patch)];
  }
  else if (def.kind == CARD_HIT)
  {
      // a crate takes the hit and is floor; an intact wall cracks into a crate
      // under one hit and is floor under two
      Bitboard crates = cells & st->deadSquares;
      Bitboard walls = cells & breakable_walls();
      st->deadSquares ^= crates;
      byTypeBB[ALL_PIECES] ^= crates;
      while (crates)
          k ^= Zobrist::dead[pop_lsb(crates)];
      if (def.arg >= 2)
      {
          st->wallSquares ^= walls;
          byTypeBB[ALL_PIECES] ^= walls;
          while (walls)
              k ^= Zobrist::wall[pop_lsb(walls)];
      }
      else
      {
          st->wallSquares ^= walls;
          st->deadSquares |= walls;
          while (walls)
          {
              const Square s = pop_lsb(walls);
              k ^= Zobrist::wall[s] ^ Zobrist::dead[s];
          }
      }
  }
  else if (def.kind == CARD_WALL || def.kind == CARD_PIT)
  {
      // empty floor rises as breakable stone, or sinks into a pit; the ice
      // under it is cleared (the ruling: what you see is what there is)
      Bitboard floor = cells & board_bb() & ~st->deadSquares & ~pieces() & ~portal_taken();
      Bitboard iced = floor & st->slickSquares;
      st->slickSquares ^= iced;
      while (iced)
          k ^= Zobrist::slick[pop_lsb(iced)];
      st->wallSquares |= floor;
      byTypeBB[ALL_PIECES] |= floor;
      if (def.kind == CARD_PIT)
      {
          st->hardSquares |= floor;
          st->holeSquares |= floor;
          while (floor)
              k ^= Zobrist::hole[pop_lsb(floor)];
      }
      else
          while (floor)
              k ^= Zobrist::wall[pop_lsb(floor)];
  }
  else if (def.kind == CARD_HARDEN)
  {
      // an intact breakable wall becomes bedrock; a crate and a cracked wall are untouched
      Bitboard walls = cells & breakable_walls();
      st->hardSquares |= walls;
      while (walls)
      {
          const Square s = pop_lsb(walls);
          k ^= Zobrist::wall[s] ^ Zobrist::hard[s];
      }
  }
}


/// Position::do_mulligan() discards the mover's whole hand (the blanks too)
/// and draws anew from its pile.
'''),
])

# ---------------------------------------------------------------- movegen.cpp
edit('movegen.cpp', [
('''            if (kind == CARD_PORTAL)
                b &= ~pos.portal_taken();
            else if (kind == CARD_ICE)
            {
                Bitboard cand = pos.ice_cast_region(Us, pt) & pos.board_bb() & ~pos.dead_squares();
                b = 0;
                while (cand)
                {
                    Square s = pop_lsb(cand);
                    if (pos.ice_patch(s) & ~pos.slick_squares())
                        b |= s;
                }
            }
            else if (kind == CARD_WIN)
                b = pos.count<KING>(Us) ? square_bb(pos.square<KING>(Us)) : Bitboard(0);
            else
                return moveList;''',
'''            if (kind == CARD_PORTAL)
                b &= ~pos.portal_taken();
            else if (pos.is_card_slot(pt))
                b = pos.cast_anchors(Us, pt); // THE TERRAIN INTERPRETER (terrain.patch): the def's anchors - its targeting, the null rule
            else if (kind == CARD_ICE)
            {
                Bitboard cand = pos.ice_cast_region(Us, pt) & pos.board_bb() & ~pos.dead_squares();
                b = 0;
                while (cand)
                {
                    Square s = pop_lsb(cand);
                    if (pos.ice_patch(s) & ~pos.slick_squares())
                        b |= s;
                }
            }
            else
                return moveList;'''),
('''  ExtMove* generate_hammers(const Position& pos, ExtMove* moveList) {

    Bitboard walls = pos.breakable_walls();''',
'''  ExtMove* generate_hammers(const Position& pos, ExtMove* moveList) {

    // THE TERRAIN INTERPRETER (terrain.patch): under a sledge card the hammer
    // needs the colour's enchantment
    if (!pos.sledge_on(Us))
        return moveList;
    Bitboard walls = pos.breakable_walls();'''),
])

# ---------------------------------------------------------------- apiutil.h
edit('apiutil.h', [
('''        if (body[i] == '!')
        {
            ++i;
            if (i < body.size() && (body[i] == 'w' || body[i] == 'b'))
                ++i;
            else
                return NOK;
            continue;
        }''',
'''        if (body[i] == '!')
        {
            ++i;
            if (i < body.size() && (body[i] == 'w' || body[i] == 'b'))
                ++i;
            else
                return NOK;
            continue;
        }
        // THE TERRAIN INTERPRETER (terrain.patch): "*w" a colour's hammer enchantment
        if (body[i] == '*')
        {
            ++i;
            if (i < body.size() && (body[i] == 'w' || body[i] == 'b'))
                ++i;
            else
                return NOK;
            continue;
        }'''),
])

print('terrain edits applied')
