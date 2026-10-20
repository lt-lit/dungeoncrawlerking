#!/usr/bin/env python3
"""Portals + ICE ORACLE — an independent model of the rules for perft-1/2
comparison against the engine. Deliberately written from the rule text, not
from the C++: forward rays for every attack (the engine uses reverse rays
through the bodies), make/unmake by copying the board.

Rules modelled (the test variants: chess pieces, no castling, king-row
promotion to n/b/r/q, double step from every non-king row, en passant,
extinction: a side down to one piece has lost, so the position has no moves):
  * walls '*' and '#' block and cannot be entered; crates '^' are captured by
    any piece moving onto them (pawns diagonally only, never pushed onto);
    a PIT '_' (ice.patch) is a wall to every move and a fall to a slide.
  * PORTALS v4 (2026-09-19, the tunnel retired): a linked portal square is a
    BODY: every line stops at it, whatever stands on it. Landing on one (any
    piece, any move — a rider's line included, which ends there) sends the
    mover through to the twin; whatever stands on the twin swaps back. A piece
    standing on the entry is captured on landing as normal. Nothing passes
    THROUGH a pair: v2's tunnel (an empty pair carrying a rider's line on from
    the twin) is gone, so no line, check or pin runs through a portal. A pawn's
    double step never crosses a portal square (it may land on one). No en
    passant square after a portal landing.
  * PORTALS v3 (the one-turn cast, 2026-09-19): scrolls in hand. A cast
    ('O@sq') opens the caster's HALF on an empty square off both king rows
    that is neither a portal nor a half, never while in check; a half is
    inert (no body, no tunnel). While a half is open the OTHER side is
    FROZEN: its only move is a pass (its king's square twice, 'e8e8'); the
    caster's only moves are the LINKING casts — the twin on any castable
    square (a body can only close a line, so no link exposes the caster) —
    or, when no castable square is left, a pass that FIZZLES the half (the
    half's scroll is spent, the other stays in hand). Neither side is in
    check while a half is open in play; a hand-written position in check
    plays its ordinary evasions (no casts, as ever in check).
  * THE ICE (2026-09-20, brief 4.9; engine/patches/ice.patch): SLIPPERY
    squares ('~e4' entries of the trailing field; a portal square is never
    slippery). A piece whose move ends on a slippery square keeps sliding the
    way it was moving, over slippery squares, and stops on the first square
    that is not slippery. A wall, a crate, the board's edge or a piece that
    cannot slide stops it on the square before; a piece on a slippery square
    that it hits takes its momentum: the hitter stops where it is, the hit
    piece slides the same way and passes it on in turn — either colour, kings
    included; a slide never captures. A pit swallows what slides into it. An
    empty linked portal square is a landing: the slider comes out of the twin,
    swapping with whatever stands there, and rests; a piece standing on a
    portal square is an obstacle. A knight's jump has no direction and lands.
    A capture on a slippery square slides the captor on after the capture
    (the en passant capture included). A pawn that stops on its promotion
    zone promotes: by its own move to the piece the move names, shoved to the
    strongest piece the variant offers. A pawn's own promotion on a slippery
    square of the zone happens on landing, and it slides on as the piece.
    Check is judged on the final board; a move that ends with your own king
    in a pit is illegal, and a side whose king fell has lost at once. No en
    passant square after a slide. A rider's quiet move onto a slippery square
    is listed once per outcome, at the last empty slippery square its line
    reaches before what stops it (the line running on to empty floor or a
    portal square is the ordinary move there). The ICE CAST ('I@sq', one
    scroll per side): on any floor square of the cast rows, under whatever
    stands there, never while in check; it ices the floor of the 3x3 around
    the square (walls, pits, crates and the board's edge skipped). A cast that
    ices nothing new is no move (the null-cast rule, deck.patch).
  * THE DECK (2026-09-26, brief 4.10 "Phase 3.3a"; engine/patches/deck.patch):
    under a hand size H > 0 the cards are SLOTS - a slot letter (s..z, white
    upper) in the pocket with a count, bound per colour to a card ID whose kind
    the ini's card<ID> entry names (here 1-9 ice, 10-19 portal, 20-29 win,
    30-39 meta). Each side has a PILE of IDs (the FEN's "w|12.7.33", top
    first). At the end of every move the side about to move draws up to H
    from its pile - never while a portal half stands open, never once a win
    card has been played: an identical card joins its slot (count + 1), a new
    card takes the lowest free slot. A cast is a drop of the slot's letter
    ("S@e4"): a portal card's half marks its slot and spends nothing, the link
    (a drop of that slot) spends the card, a fizzle spends it too; an ice card
    ices its patch and is spent; a WIN card is cast on the caster's own king
    square and ends the game (the caster has won: the opponent has no moves);
    a META card (a blank) is never cast. THE MULLIGAN ("@@@@"): out of check,
    with no half open and cards left in the pile, discard the whole hand
    (blanks included) and draw anew. No card is cast in check, ever.
  * THE TERRAIN INTERPRETER (2026-10-03, brief 4.10 "Phase 3.3b" and "3.3b
    RULED"; engine/patches/terrain.patch): a card is a DEFINITION, `<effect>
    <shape> <targeting>`, read from the ini (set_defs). The SHAPE is a picture
    string (rows north to south, 'x' a cell, 'o' the anchor, '.' nothing), no
    rotation, clipped at the edge. TARGETING: any (every anchor where the
    effect changes something), near (the anchor within a king's step of one of
    the caster's pieces), middle (the two middle rows), margin<n> (every cell
    n rows off both king rows), king (the caster's king's square), ray /
    ray<n> (from the king's neighbour on in that direction, through pieces and
    over pits, to bedrock '#' or the edge, n squares at most), camp (the
    caster's double-step region - every non-king row in the test variants).
    The anchor candidates per effect: a hit's any square that is not bedrock
    or a pit; harden's a floor square or an intact wall; a drop's an empty
    floor square; ice / wall / pit's a floor square, occupied or not; win and
    sledge's the king's square. EFFECTS, per square of the shape: hit1 - a
    crate '^' becomes floor, an intact wall '*' becomes a crate; hit2 - both
    become floor; bedrock, pits and pieces untouched. ice - every floor cell
    turns slippery (occupied too). wall / pit - every EMPTY floor cell that is
    not a portal square or a half becomes '*' / '_', its ice cleared. harden -
    every intact '*' becomes '#'. sledge - the caster's colour may hammer from
    now on (the flag "*w" in the field). drop <letter> - a piece of the caster
    is placed on the anchor (empty, not a portal square, never on its promotion
    zone). win as before. THE NULL RULE: a cast that changes nothing is no
    move. A hit that leaves the caster's own king attacked (a line opened by
    the demolition) is illegal. A cast draws like any move. THE HAMMER: a king
    may crack an adjacent intact wall into a crate (uci from-to, never in
    check) when the variant declares hammerPieceTypes - and, once a sledge
    card is in the library, only while its colour's enchantment is on.
"""
import random, sys, re

WHITE, BLACK = 0, 1
TERRAIN = set('*#^_')
BLOCKS_MOVES = set('*#_')       # a wall or a pit: nothing enters by a move
ORTHO = [(1, 0), (-1, 0), (0, 1), (0, -1)]
DIAG = [(1, 1), (1, -1), (-1, 1), (-1, -1)]
KNIGHT = [(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)]
PROMOS = 'nbrq'
RIDERS = set('rbq')

def colour(ch):
    return WHITE if ch.isupper() else BLACK

SLOT_LETTERS = 'stuvwxyz'

# ---- THE TERRAIN INTERPRETER: the card library as definitions
DEFS = None           # {id: def} once a terrain ini is loaded (set_defs); None = the deck tests' ID ranges
HAMMER = False        # the variant declares hammerPieceTypes (the king hammers)
SLEDGE_CARDS = False  # a sledge card is in the library: the hammer needs the colour's enchantment

def parse_def(value):
    """`<effect> <shape> <targeting>` as {kind, arg, cells: [(df, dr)], target, targ}; a one-word value is a legacy kind."""
    tok = value.split()
    word = tok[0]
    p = 0
    while p < len(word) and word[p].isalpha():
        p += 1
    eff, num = word[:p], (int(word[p:]) if p < len(word) else None)
    d = {'kind': eff, 'arg': None, 'cells': [(0, 0)], 'target': 'any', 'targ': 0}
    at = 1
    if eff == 'hit':
        d['arg'] = num or 1
    if eff == 'drop':
        d['arg'] = tok[at]
        at += 1
    if eff in ('portal', 'meta'):
        return d
    if len(tok) == at:
        shape, target = ('xxx/xox/xxx', 'middle') if eff == 'ice' else ('o', 'king')
    else:
        shape, target = tok[at], tok[at + 1]
    cells, o = [], None
    for r, row in enumerate(shape.split('/')):
        for c, ch in enumerate(row):
            if ch in 'xo':
                cells.append((r, c))
            if ch == 'o':
                o = (r, c)
    d['cells'] = [(c - o[1], o[0] - r) for r, c in cells]   # (df, dr): the first row is the north
    q = 0
    while q < len(target) and target[q].isalpha():
        q += 1
    d['target'] = target[:q]
    d['targ'] = int(target[q:]) if q < len(target) else (2 if d['target'] == 'margin' else 0)
    return d

def set_defs(ini_text):
    """Load a terrain ini's card<ID> definitions (and whether the king hammers)."""
    global DEFS, HAMMER, SLEDGE_CARDS
    DEFS = {}
    HAMMER = 'hammerPieceTypes' in ini_text
    for line in ini_text.splitlines():
        m = re.match(r'^card(\d+)\s*=\s*(.+?)\s*$', line)
        if m:
            DEFS[int(m.group(1))] = parse_def(m.group(2))
    SLEDGE_CARDS = any(d['kind'] == 'sledge' for d in DEFS.values())

def kind_of(cid):
    """The card kind by ID: the loaded library's, else the deck tests' ranges (deck.ini)."""
    if DEFS is not None:
        return DEFS[cid]['kind'] if cid in DEFS else 'meta'
    return 'ice' if 1 <= cid <= 9 else 'portal' if 10 <= cid <= 19 else 'win' if 20 <= cid <= 29 else 'meta'

def def_of(cid):
    """The card's definition: the library's, else the legacy kind with its old default (ice 3x3 on the middle rows, win on the king)."""
    if DEFS is not None:
        return DEFS.get(cid, {'kind': 'meta', 'arg': None, 'cells': [(0, 0)], 'target': 'any', 'targ': 0})
    k = kind_of(cid)
    cells = [(df, dr) for df in (-1, 0, 1) for dr in (-1, 0, 1)] if k == 'ice' else [(0, 0)]
    return {'kind': k, 'arg': None, 'cells': cells, 'target': 'middle' if k == 'ice' else 'king' if k == 'win' else 'any', 'targ': 0}

def ice_rows(R):
    """The cast rows of the test variants (0-based): the two middle rows."""
    return {R // 2 - 1, R // 2}

class Pos:
    def __init__(self, files, ranks, board, twin, side, ep=None, hand=(0, 0), half=(None, None), slick=None, icehand=(0, 0), deck=None, sledge=(False, False)):
        self.F, self.R = files, ranks
        self.sledge = list(sledge)  # THE TERRAIN INTERPRETER: the hammer enchantment per colour
        # THE DECK: deck = {handsize, slots: [[ [id, count] | None ]*8 per colour], pile: [[ids], [ids]], castslot: [slot | None]*2, winner}
        self.deck = deck
        self.board = board          # dict (f, r) -> char; absent = empty
        self.twin = twin            # dict sq -> sq for linked pairs
        self.side = side
        self.ep = ep                # ep square (f, r) or None
        self.hand = list(hand)      # portal scrolls in hand, per colour
        self.half = list(half)      # the open half per colour: a square, or None
        self.slick = set(slick) if slick else set()   # the slippery squares (portal squares among them are inert)
        self.icehand = list(icehand)                  # ice scrolls in hand, per colour

    def on(self, f, r):
        return 0 <= f < self.F and 0 <= r < self.R

    def piece_at(self, sq):
        ch = self.board.get(sq)
        return ch if ch and ch not in TERRAIN else None

    def is_body(self, sq):
        return sq in self.board or sq in self.twin  # a piece, terrain, or a portal square

    def slippery(self, sq):
        return sq in self.slick and sq not in self.twin

    def castable(self, sq):
        """Empty floor off both king rows, not a portal square, not a half."""
        return sq not in self.board and 0 < sq[1] < self.R - 1 and sq not in self.twin and sq not in self.half

    def castables(self):
        return [(f, r) for r in range(1, self.R - 1) for f in range(self.F) if self.castable((f, r))]

    def ice_castables(self):
        """Any floor square of the cast rows, occupied or not (not a wall, a pit or a crate), whose 3x3 still has floor to ice (the null-cast rule)."""
        out = []
        for r in sorted(ice_rows(self.R)):
            for f in range(self.F):
                if self.board.get((f, r)) in TERRAIN:
                    continue
                if any(self.on(f + df, r + dr) and self.board.get((f + df, r + dr)) not in TERRAIN and (f + df, r + dr) not in self.slick
                       for df in (-1, 0, 1) for dr in (-1, 0, 1)):
                    out.append((f, r))
        return out

    # ---- targets: the squares a piece may move to / attacks, with the occupant found there
    def ray(self, frm, d, out):
        df, dr = d
        f, r = frm[0] + df, frm[1] + dr
        while self.on(f, r):
            sq = (f, r)
            ch = self.board.get(sq)
            if ch in BLOCKS_MOVES:
                break
            out.append(sq)                           # reachable: empty, a landing on a portal square, or a capture / friend
            if ch or sq in self.twin:                # a piece, a crate or a portal square (a body): the line ends here
                break
            f += df; r += dr

    def targets(self, sq, ch, attacks_only=False):
        """Squares the piece on sq may move to (pawn pushes included unless attacks_only)."""
        out = []
        t = ch.lower()
        c = colour(ch)
        if t in 'rq':
            for d in ORTHO: self.ray(sq, d, out)
        if t in 'bq':
            for d in DIAG: self.ray(sq, d, out)
        if t == 'n':
            for df, dr in KNIGHT:
                f, r = sq[0] + df, sq[1] + dr
                if self.on(f, r) and self.board.get((f, r)) not in BLOCKS_MOVES:
                    out.append((f, r))
        if t == 'k':
            for df, dr in ORTHO + DIAG:
                f, r = sq[0] + df, sq[1] + dr
                if self.on(f, r) and self.board.get((f, r)) not in BLOCKS_MOVES:
                    out.append((f, r))
        if t == 'p':
            up = 1 if c == WHITE else -1
            for df in (-1, 1):
                f, r = sq[0] + df, sq[1] + up
                if self.on(f, r):
                    occ = self.board.get((f, r))
                    if occ == '^' or (occ and occ not in TERRAIN and colour(occ) != c):
                        out.append((f, r))
                    elif self.ep == (f, r):
                        out.append((f, r))
            if not attacks_only:
                one = (sq[0], sq[1] + up)
                if self.on(*one) and one not in self.board:      # empty (an empty portal square is empty)
                    out.append(one)
                    two = (sq[0], sq[1] + 2 * up)
                    if 0 < sq[1] < self.R - 1 and self.on(*two) and two not in self.board and one not in self.twin:
                        out.append(two)                          # the double step: from any non-king row, first square no portal
        # drop own pieces; one entry per square
        res, seen = [], set()
        for x in out:
            occ = self.board.get(x)
            if occ and occ not in TERRAIN and colour(occ) == c:
                continue
            if x in seen:
                continue
            seen.add(x)
            res.append(x)
        return res

    def attacked(self, sq, by):
        for s, ch in self.board.items():
            if ch in TERRAIN or colour(ch) != by:
                continue
            if sq in self.targets(s, ch, attacks_only=True):
                return True
        return False

    def king(self, c):
        for s, ch in self.board.items():
            if ch == ('K' if c == WHITE else 'k'):
                return s
        return None

    def count(self, c):
        return sum(1 for ch in self.board.values() if ch not in TERRAIN and colour(ch) == c)

    def ended(self):
        # extinction, or (the ice) a king that fell into a pit, or (the deck) a win card played
        if self.deck and self.deck['winner'] is not None:
            return True
        return self.count(WHITE) <= 1 or self.count(BLACK) <= 1 or self.king(WHITE) is None or self.king(BLACK) is None

    # ---- THE DECK (deck.patch)
    def deck_copy(self):
        d = self.deck
        if not d:
            return None
        return {'handsize': d['handsize'], 'slots': [[list(e) if e else None for e in d['slots'][c]] for c in (WHITE, BLACK)],
                'pile': [list(d['pile'][WHITE]), list(d['pile'][BLACK])], 'castslot': list(d['castslot']), 'winner': d['winner']}

    def hand_count(self, c):
        return sum(e[1] for e in self.deck['slots'][c] if e)

    def refill(self, c):
        """Draw up to the hand size for c (mutates self.deck): an identical card joins its slot, a new card takes the lowest free slot."""
        d = self.deck
        while self.hand_count(c) < d['handsize'] and d['pile'][c]:
            cid = d['pile'][c][0]
            s = next((i for i, e in enumerate(d['slots'][c]) if e and e[1] > 0 and e[0] == cid), None)
            if s is None:
                s = next((i for i, e in enumerate(d['slots'][c]) if (not e or e[1] == 0) and d['castslot'][c] != i), None)
            if s is None:
                break
            d['pile'][c].pop(0)
            if d['slots'][c][s] and d['slots'][c][s][1] > 0:
                d['slots'][c][s][1] += 1
            else:
                d['slots'][c][s] = [cid, 1]

    def after(self, nxt):
        """The engine's end-of-move draw: the side about to move refills unless a half is open or the game is won."""
        if nxt.deck and nxt.deck['winner'] is None and nxt.half[WHITE] is None and nxt.half[BLACK] is None:
            nxt.refill(nxt.side)
        return nxt

    def spend(self, c, slot):
        e = self.deck['slots'][c][slot]
        e[1] -= 1
        if e[1] <= 0:
            self.deck['slots'][c][slot] = None

    # ---- the slide physics (ice.patch)
    @staticmethod
    def direction(frm, to):
        """The unit step of a line move, or None for a leap."""
        df, dr = to[0] - frm[0], to[1] - frm[1]
        if (df, dr) == (0, 0) or (df and dr and abs(df) != abs(dr)):
            return None
        return ((df > 0) - (df < 0), (dr > 0) - (dr < 0))

    def promote(self, ch, sq, named=None):
        """A pawn that stops on its promotion zone promotes: to the piece named, else the strongest."""
        if ch.lower() != 'p':
            return ch
        zone = self.R - 1 if colour(ch) == WHITE else 0
        if sq[1] != zone:
            return ch
        p = named or 'q'
        return p.upper() if colour(ch) == WHITE else p

    def slide(self, b, to, d, named=None):
        """Run the physics on board b (a copy; the mover already on `to`, the victim
        gone) with the mover sliding in direction d. Mutates b."""
        sq = to
        pc = b[to]
        is_mover = True
        while True:
            cur = sq
            landing = None
            shoved = None
            fell = False
            while True:
                nx = (cur[0] + d[0], cur[1] + d[1])
                if not self.on(*nx) or b.get(nx) in ('*', '#', '^'):
                    break                                # the edge, a wall, a crate: stop here
                if b.get(nx) == '_':
                    fell = True                          # a pit: gone
                    break
                if nx in self.twin:
                    if nx not in b:
                        landing = nx                     # an empty portal square: a landing on it
                    break                                # a piece on one is an obstacle
                if nx in b:
                    if self.slippery(nx):
                        shoved = nx                      # a piece on ice: it takes the momentum
                    break                                # stop before it either way
                if self.slippery(nx):
                    cur = nx                             # empty ice: slide on
                    continue
                landing = nx                             # empty floor: land
                break
            del b[sq]
            if fell:
                pass
            elif landing is not None and landing in self.twin:
                q = self.twin[landing]
                sw = b.pop(q, None)                      # whatever stands on the twin comes back
                b[q] = self.promote(pc, q, named if is_mover else None)
                if sw is not None:
                    b[landing] = sw
            else:
                end = landing if landing is not None else cur
                b[end] = self.promote(pc, end, named if is_mover else None)
            if shoved is None:
                break
            sq = shoved
            pc = b[shoved]
            is_mover = False

    # ---- the positions a move leads to (copies)
    def make(self, frm, to, promo=None):
        """Return the position after an ordinary move (a copy)."""
        b = dict(self.board)
        ch = b.pop(frm)
        c = colour(ch)
        up = 1 if c == WHITE else -1
        ep = None
        if ch.lower() == 'p' and to == self.ep and to not in b:
            b.pop((to[0], to[1] - up), None)         # en passant victim
        b.pop(to, None)                              # the capture (a piece or a crate) on the landing square
        zone = self.R - 1 if c == WHITE else 0
        if promo and to[1] == zone:
            ch = promo.upper() if c == WHITE else promo   # the move's own promotion on landing
        d = self.direction(frm, to)
        if to in self.twin:
            q = self.twin[to]
            if q == frm:
                b[frm] = ch                          # twin to twin: ends where it stood
            else:
                sw = b.pop(q, None)                  # whatever stands on the twin comes back
                b[q] = ch
                if sw is not None:
                    b[to] = sw
        elif self.slippery(to) and d is not None:
            b[to] = ch
            self.slide(b, to, d, promo)              # THE ICE: the move ends on ice - it slides on
        else:
            b[to] = ch
            if ch.lower() == 'p' and abs(to[1] - frm[1]) == 2:
                ep = (frm[0], frm[1] + up)
        return self.after(Pos(self.F, self.R, b, self.twin, 1 - self.side, ep, self.hand, self.half, self.slick, self.icehand, self.deck_copy(), self.sledge))

    def cast_half(self, sq, slot=None):
        """The opening cast: the caster's half stands on sq; a legacy scroll leaves the hand, a deck card marks its slot and stays."""
        hand = list(self.hand)
        deck = self.deck_copy()
        if slot is None:
            hand[self.side] -= 1
        else:
            deck['castslot'][self.side] = slot
        half = list(self.half); half[self.side] = sq
        return self.after(Pos(self.F, self.R, dict(self.board), self.twin, 1 - self.side, None, hand, half, self.slick, self.icehand, deck, self.sledge))

    def link(self, sq, slot=None):
        """The linking cast: the caster's half and sq become a pair; a scroll (or the deck card) leaves the hand."""
        a = self.half[self.side]
        twin = dict(self.twin); twin[a] = sq; twin[sq] = a
        hand = list(self.hand)
        deck = self.deck_copy()
        half = list(self.half); half[self.side] = None
        nxt = Pos(self.F, self.R, dict(self.board), twin, 1 - self.side, None, hand, half, self.slick, self.icehand, deck, self.sledge)
        if slot is None:
            nxt.hand[self.side] -= 1
        else:
            nxt.spend(self.side, slot)
            nxt.deck['castslot'][self.side] = None
        return self.after(nxt)

    def cast_ice(self, sq, slot=None):
        """The ice cast: the floor of the 3x3 around sq turns slippery, a scroll (or the deck card) leaves the hand."""
        slick = set(self.slick)
        for df in (-1, 0, 1):
            for dr in (-1, 0, 1):
                s = (sq[0] + df, sq[1] + dr)
                if self.on(*s) and self.board.get(s) not in TERRAIN:
                    slick.add(s)
        icehand = list(self.icehand)
        deck = self.deck_copy()
        nxt = Pos(self.F, self.R, dict(self.board), self.twin, 1 - self.side, None, self.hand, self.half, slick, icehand, deck, self.sledge)
        if slot is None:
            nxt.icehand[self.side] -= 1
        else:
            nxt.spend(self.side, slot)
        return self.after(nxt)

    def cast_win(self, slot):
        """THE DECK: the win card, cast on the caster's own king square - the game is over."""
        deck = self.deck_copy()
        nxt = Pos(self.F, self.R, dict(self.board), self.twin, 1 - self.side, None, self.hand, self.half, self.slick, self.icehand, deck, self.sledge)
        nxt.spend(self.side, slot)
        nxt.deck['winner'] = self.side
        return nxt

    def mulligan(self):
        """THE DECK: discard the whole hand (blanks included) and draw anew; then the other side's turn."""
        deck = self.deck_copy()
        nxt = Pos(self.F, self.R, dict(self.board), self.twin, 1 - self.side, None, self.hand, self.half, self.slick, self.icehand, deck, self.sledge)
        nxt.deck['slots'][self.side] = [None] * 8
        nxt.refill(self.side)
        return self.after(nxt)

    def passed(self):
        """The frozen side's pass: nothing changes but the turn."""
        return self.after(Pos(self.F, self.R, dict(self.board), self.twin, 1 - self.side, None, self.hand, self.half, self.slick, self.icehand, self.deck_copy(), self.sledge))

    def fizzle(self):
        """The caster's pass when no link is legal: the half is gone, its scroll (or the deck card) spent."""
        half = list(self.half); half[self.side] = None
        nxt = Pos(self.F, self.R, dict(self.board), self.twin, 1 - self.side, None, self.hand, half, self.slick, self.icehand, self.deck_copy(), self.sledge)
        if nxt.deck and nxt.deck['castslot'][self.side] is not None:
            nxt.spend(self.side, nxt.deck['castslot'][self.side])
            nxt.deck['castslot'][self.side] = None
        return self.after(nxt)

    def slide_stop(self, frm, to, ch):
        """Where the mover of a (non-promoting) slide ends, or None if it falls."""
        b = dict(self.board); b.pop(frm)
        c = colour(ch); up = 1 if c == WHITE else -1
        if ch.lower() == 'p' and to == self.ep and to not in b:
            b.pop((to[0], to[1] - up), None)
        b.pop(to, None)
        d = self.direction(frm, to)
        # track the mover: run the physics on a board where the mover is uniquely marked
        marker = '@'
        b[to] = marker
        self.slide(b, to, d)
        for s, x in b.items():
            if x == marker:
                return s
        return None

    # ---- THE TERRAIN INTERPRETER (terrain.patch)
    def hammer_on(self, c):
        return HAMMER and (self.sledge[c] if SLEDGE_CARDS else True)

    def cells_of(self, d, a):
        """The squares a cast at anchor a covers: the shape clipped to the board, or the ray from the king's neighbour."""
        if d['target'] == 'ray':
            k = self.king(self.side)
            df, dr = a[0] - k[0], a[1] - k[1]
            out, (f, r), n = [], a, 0
            while self.on(f, r):
                if self.board.get((f, r)) == '#':
                    break                                 # bedrock stops the ray; a pit is passed over
                out.append((f, r))
                n += 1
                if d['targ'] and n >= d['targ']:
                    break
                f += df; r += dr
            return out
        return [(a[0] + df, a[1] + dr) for df, dr in d['cells'] if self.on(a[0] + df, a[1] + dr)]

    def changes(self, d, cells, a):
        """The null rule: does the cast change anything? The per-square table of the ruling."""
        kind = d['kind']
        if kind == 'win':
            return self.deck['winner'] is None
        if kind == 'sledge':
            return not self.sledge[self.side]
        if kind == 'drop':
            zone = self.R - 1 if self.side == WHITE else 0
            return a not in self.board and a not in self.twin and a not in self.half and a[1] != zone
        if kind == 'ice':
            return any(self.board.get(c) not in TERRAIN and c not in self.slick for c in cells)
        if kind == 'hit':
            return any(self.board.get(c) in ('*', '^') for c in cells)
        if kind in ('wall', 'pit'):
            return any(c not in self.board and c not in self.twin and c not in self.half for c in cells)
        if kind == 'harden':
            return any(self.board.get(c) == '*' for c in cells)
        return False

    def anchors(self, d):
        """Where a card may be cast: the effect's candidate squares, narrowed by its targeting, kept by the null rule."""
        us = self.side
        k = self.king(us)
        kind, target = d['kind'], d['target']
        allsq = [(f, r) for f in range(self.F) for r in range(self.R)]
        if kind in ('win', 'sledge'):
            cand = [k] if k else []
        elif kind == 'hit':
            cand = [s for s in allsq if self.board.get(s) not in ('#', '_')]           # a wall, a crate or a floor square
        elif kind == 'harden':
            cand = [s for s in allsq if self.board.get(s) not in ('#', '_', '^')]      # a floor square or an intact wall
        elif kind == 'drop':
            cand = [s for s in allsq if s not in self.board]                           # empty floor
        else:
            cand = [s for s in allsq if self.board.get(s) not in TERRAIN]              # ice, wall, pit: a floor square, occupied or not
        if target == 'king':
            cand = [s for s in cand if s == k]
        elif target == 'near':
            mine = [s for s, ch in self.board.items() if ch not in TERRAIN and colour(ch) == us]
            cand = [s for s in cand if any(max(abs(s[0] - m[0]), abs(s[1] - m[1])) <= 1 for m in mine)]
        elif target == 'middle':
            cand = [s for s in cand if s[1] in ice_rows(self.R)]
        elif target == 'camp':
            cand = [s for s in cand if 0 < s[1] < self.R - 1]                          # the test variants' double-step region: every non-king row
        elif target == 'ray':
            if k is None:
                return []
            cand = [(k[0] + df, k[1] + dr) for df, dr in ORTHO + DIAG if self.on(k[0] + df, k[1] + dr)]
        out = []
        for a in cand:
            cells = self.cells_of(d, a)
            if target == 'margin' and any(not (d['targ'] <= c[1] <= self.R - 1 - d['targ']) for c in cells):
                continue
            if self.changes(d, cells, a):
                out.append(a)
        return out

    def cast_def(self, d, slot, a):
        """The position after a slot card's cast at anchor a: the def applied over the board, the card spent, the draw."""
        kind = d['kind']
        if kind == 'win':
            return self.cast_win(slot)
        b = dict(self.board)
        slick = set(self.slick)
        sledge = list(self.sledge)
        cells = self.cells_of(d, a)
        if kind == 'ice':
            for c in cells:
                if b.get(c) not in TERRAIN:
                    slick.add(c)
        elif kind == 'hit':
            for c in cells:
                if b.get(c) == '^':
                    del b[c]
                elif b.get(c) == '*':
                    if d['arg'] >= 2:
                        del b[c]
                    else:
                        b[c] = '^'
        elif kind in ('wall', 'pit'):
            for c in cells:
                if c not in b and c not in self.twin and c not in self.half:
                    b[c] = '*' if kind == 'wall' else '_'
                    slick.discard(c)
        elif kind == 'harden':
            for c in cells:
                if b.get(c) == '*':
                    b[c] = '#'
        elif kind == 'sledge':
            sledge[self.side] = True
        elif kind == 'drop':
            b[a] = d['arg'].upper() if self.side == WHITE else d['arg'].lower()
        nxt = Pos(self.F, self.R, b, self.twin, 1 - self.side, None, self.hand, self.half, slick, self.icehand, self.deck_copy(), sledge)
        nxt.spend(self.side, slot)
        return self.after(nxt)

    def make_hammer(self, frm, to):
        """The king cracks the adjacent wall on `to` into a crate; nothing moves."""
        b = dict(self.board)
        b[to] = '^'
        return self.after(Pos(self.F, self.R, b, self.twin, 1 - self.side, None, self.hand, self.half, self.slick, self.icehand, self.deck_copy(), self.sledge))

    def legal_moves(self):
        """Moves as (from, to, promo, next): promo is a letter for a promotion,
        'cast' for a portal cast (from None), 'ice' for an ice cast (from None),
        'pass' for a pass (from == to == the king's square)."""
        if self.ended():
            return []
        us, them = self.side, 1 - self.side
        k = self.king(us)
        in_check = k is not None and self.attacked(k, them)
        # Portals v3: an open half binds both sides (never in check, in play)
        if not in_check and k is not None and (self.half[us] is not None or self.half[them] is not None):
            if self.half[us] is not None:
                res = []
                if self.deck:
                    slot = self.deck['castslot'][us]
                    e = self.deck['slots'][us][slot] if slot is not None else None
                    if e and e[1] > 0:
                        for sq in self.castables():
                            res.append((None, sq, 'cast:' + SLOT_LETTERS[slot].upper(), self.link(sq, slot)))
                elif self.hand[us] > 0:
                    for sq in self.castables():
                        res.append((None, sq, 'cast', self.link(sq)))   # a body can only close a line: no link exposes the caster
                if res:
                    return res
                return [(k, k, 'pass', self.fizzle())]
            return [(k, k, 'pass', self.passed())]
        res = []
        for s, ch in list(self.board.items()):
            if ch in TERRAIN or colour(ch) != us:
                continue
            zone = self.R - 1 if us == WHITE else 0
            for to in self.targets(s, ch):
                d = self.direction(s, to)
                sliding = self.slippery(to) and d is not None and to not in self.twin
                # THE ICE: a rider's quiet move onto ice is listed once, at the last
                # empty ice square before what stops it
                if sliding and ch.lower() in RIDERS and to not in self.board:
                    nx = (to[0] + d[0], to[1] + d[1])
                    if self.on(*nx) and nx not in self.board:
                        continue
                promos = [None]
                if ch.lower() == 'p' and to not in self.twin and to[1] == zone:
                    promos = list(PROMOS)
                elif ch.lower() == 'p' and sliding:
                    stop = self.slide_stop(s, to, ch)
                    if stop is not None and stop[1] == zone:
                        promos = list(PROMOS)          # the pawn stops on its promotion zone: one move per piece
                for pr in promos:
                    nxt = self.make(s, to, pr)
                    kk = nxt.king(us)
                    if kk is None or nxt.attacked(kk, them):
                        continue                       # in check where he ends, or in a pit
                    res.append((s, to, pr, nxt))
        # the opening cast: a scroll in hand, not in check, any castable square
        if not in_check and self.hand[us] > 0:
            for sq in self.castables():
                res.append((None, sq, 'cast', self.cast_half(sq)))
        # the ice cast: a scroll in hand, not in check, any floor square of the cast rows
        if not in_check and self.icehand[us] > 0:
            for sq in self.ice_castables():
                res.append((None, sq, 'ice', self.cast_ice(sq)))
        # THE DECK: each slot's card by its definition, never in check (a portal card its half; the
        # rest the interpreter's anchors - a hit judged for the caster's own king); the mulligan while
        # the pile has cards
        if not in_check and self.deck:
            for slot, e in enumerate(self.deck['slots'][us]):
                if not e or e[1] <= 0:
                    continue
                L = SLOT_LETTERS[slot].upper()
                d = def_of(e[0])
                kind = d['kind']
                if kind == 'portal':
                    for sq in self.castables():
                        res.append((None, sq, 'cast:' + L, self.cast_half(sq, slot)))
                elif kind == 'meta':
                    continue
                else:
                    for sq in self.anchors(d):
                        nxt = self.cast_def(d, slot, sq)
                        if kind == 'hit':
                            kk = nxt.king(us)
                            if kk is None or nxt.attacked(kk, them):
                                continue                   # the demolition opened a line onto the caster's own king
                        res.append((None, sq, 'card:' + L, nxt))
            if k is not None and self.deck['pile'][us]:
                res.append((k, k, 'mulligan', self.mulligan()))
        # THE HAMMER: the king cracks an adjacent intact wall, never in check, while his colour's hammer is on
        if not in_check and k is not None and self.hammer_on(us):
            for df, dr in ORTHO + DIAG:
                w = (k[0] + df, k[1] + dr)
                if self.on(*w) and self.board.get(w) == '*':
                    res.append((k, w, 'hammer', self.make_hammer(k, w)))
        return res

def sqname(sq):
    return 'abcdefghijkl'[sq[0]] + str(sq[1] + 1)

def uci(m):
    s, to, pr, _ = m
    if pr == 'cast':
        return 'O@' + sqname(to)
    if pr == 'ice':
        return 'I@' + sqname(to)
    if pr == 'pass':
        return sqname(s) + sqname(to)
    if pr == 'mulligan':
        return '@@@@'
    if pr == 'hammer':
        return sqname(s) + sqname(to)
    if pr and ':' in pr:
        return pr.split(':')[1] + '@' + sqname(to)   # a deck card: its slot letter
    return sqname(s) + sqname(to) + (pr or '')

def to_fen(pos):
    rows = []
    for r in range(pos.R - 1, -1, -1):
        row, empty = '', 0
        for f in range(pos.F):
            ch = pos.board.get((f, r))
            if ch is None:
                empty += 1
            else:
                if empty: row += str(empty); empty = 0
                row += ch
        if empty: row += str(empty)
        rows.append(row)
    pocket = '['
    for c in (WHITE, BLACK):
        if pos.deck:
            for slot, e in enumerate(pos.deck['slots'][c]):
                if e and e[1] > 0:
                    pocket += (SLOT_LETTERS[slot].upper() if c == WHITE else SLOT_LETTERS[slot]) * e[1]
        pocket += ('I' if c == WHITE else 'i') * pos.icehand[c] + ('O' if c == WHITE else 'o') * pos.hand[c]
    pocket += ']'
    entries = [f'{sqname(a)}-{sqname(b)}' for a, b in sorted({tuple(sorted([a, b])) for a, b in pos.twin.items()})]
    for c, letter in ((WHITE, 'w'), (BLACK, 'b')):
        if pos.half[c] is not None:
            entries.append(sqname(pos.half[c]) + letter)
    for s in sorted(pos.slick, key=lambda x: (x[1], x[0])):
        entries.append('~' + sqname(s))
    if pos.deck:
        for c, letter in ((WHITE, 'w'), (BLACK, 'b')):
            if pos.deck['pile'][c]:
                entries.append(letter + '|' + '.'.join(str(i) for i in pos.deck['pile'][c]))
            for slot, e in enumerate(pos.deck['slots'][c]):
                if (e and e[1] > 0) or pos.deck['castslot'][c] == slot:
                    entries.append(SLOT_LETTERS[slot].upper() + '=' + letter + str(e[0] if e else 0) + ('+' if pos.deck['castslot'][c] == slot else ''))
        if pos.deck['winner'] is not None:
            entries.append('!' + ('w' if pos.deck['winner'] == WHITE else 'b'))
    for c, letter in ((WHITE, 'w'), (BLACK, 'b')):
        if pos.sledge[c]:
            entries.append('*' + letter)
    field = (' {' + ','.join(entries) + '}') if entries else ''
    ep = sqname(pos.ep) if pos.ep else '-'
    return '/'.join(rows) + pocket + ' ' + ('w' if pos.side == WHITE else 'b') + ' - ' + ep + ' 0 1' + field

def from_fen(fen, handsize=0):
    """A fixture FEN (board[pocket] side - ep 0 1 {portal field}) as a Pos; the board's size is its own.
    `handsize` > 0 reads the deck (the slot pockets, the piles, the bindings, the win)."""
    parts = fen.split()
    boardpart = parts[0]
    pocket = ''
    if '[' in boardpart:
        boardpart, rest = boardpart.split('[', 1)
        pocket = rest.split(']', 1)[0]
    rows = boardpart.split('/')
    R = len(rows)
    F = 0
    board = {}
    for i, row in enumerate(rows):
        r = R - 1 - i
        f = 0
        j = 0
        while j < len(row):
            ch = row[j]
            if ch.isdigit():
                n = ch
                while j + 1 < len(row) and row[j + 1].isdigit():
                    j += 1; n += row[j]
                f += int(n)
            else:
                board[(f, r)] = ch
                f += 1
            j += 1
        F = max(F, f)
    side = WHITE if parts[1] == 'w' else BLACK
    ep = None
    if len(parts) > 3 and parts[3] != '-':
        ep = ('abcdefghijkl'.index(parts[3][0]), int(parts[3][1:]) - 1)
    hand = [pocket.count('O'), pocket.count('o')]
    icehand = [pocket.count('I'), pocket.count('i')]
    twin, half, slick = {}, [None, None], set()
    deck = None
    field = fen[fen.index('{') + 1:fen.index('}')] if '{' in fen else ''
    def sq(s):
        return ('abcdefghijkl'.index(s[0]), int(s[1:]) - 1)
    entries = [x.strip() for x in field.split(',') if x.strip()]
    if handsize and (any(ch in SLOT_LETTERS or ch.lower() in SLOT_LETTERS for ch in pocket) or any('|' in e or '=' in e or e.startswith('!') for e in entries)):
        deck = {'handsize': handsize, 'slots': [[None] * 8, [None] * 8], 'pile': [[], []], 'castslot': [None, None], 'winner': None}
    elif handsize:
        deck = {'handsize': handsize, 'slots': [[None] * 8, [None] * 8], 'pile': [[], []], 'castslot': [None, None], 'winner': None}
    if deck:
        for ch in pocket:
            if ch.lower() in SLOT_LETTERS:
                c = WHITE if ch.isupper() else BLACK
                slot = SLOT_LETTERS.index(ch.lower())
                if deck['slots'][c][slot]:
                    deck['slots'][c][slot][1] += 1
                else:
                    deck['slots'][c][slot] = [0, 1]
    sledge = [False, False]
    for e in entries:
        if e[0] == '*':
            sledge[WHITE if e[1] == 'w' else BLACK] = True
            continue
        if e[0] == '~':
            slick.add(sq(e[1:]))
        elif deck is not None and len(e) > 1 and e[1] == '|':
            c = WHITE if e[0] == 'w' else BLACK
            deck['pile'][c] = [int(x) for x in e[2:].split('.') if x]
        elif deck is not None and len(e) > 1 and e[1] == '=':
            slot = SLOT_LETTERS.index(e[0].lower())
            c = WHITE if e[2] == 'w' else BLACK
            body = e[3:]
            open_ = body.endswith('+')
            cid = int(body.rstrip('+'))
            if deck['slots'][c][slot]:
                deck['slots'][c][slot][0] = cid
            else:
                deck['slots'][c][slot] = [cid, 0]
            if open_:
                deck['castslot'][c] = slot
        elif deck is not None and e[0] == '!':
            deck['winner'] = WHITE if e[1] == 'w' else BLACK
        elif '-' in e:
            a, b = e.split('-')
            twin[sq(a)] = sq(b); twin[sq(b)] = sq(a)
        else:
            half[WHITE if e[-1] == 'w' else BLACK] = sq(e[:-1])
    if deck:
        for c in (WHITE, BLACK):
            for slot in range(8):
                e = deck['slots'][c][slot]
                if e and e[1] <= 0 and deck['castslot'][c] != slot:
                    deck['slots'][c][slot] = None
    return Pos(F, R, board, twin, side, ep, hand, half, slick, icehand, deck, sledge)

def perft(pos, depth):
    if depth == 0:
        return 1
    moves = pos.legal_moves()
    if depth == 1:
        return len(moves)
    return sum(perft(m[3], depth - 1) for m in moves)

def random_deck(rng, handsize=4, win_p=0.12):
    """A random deck state: 0-4 cards a side in the lowest slots (identical IDs merged), a pile of 0-6 IDs, no half."""
    def card():
        if DEFS is not None:
            while True:
                cid = rng.choice(sorted(DEFS))
                if DEFS[cid]['kind'] != 'win' or rng.random() < win_p:
                    return cid
        r = rng.random()
        return rng.randint(20, 29) if r < win_p else rng.randint(1, 9) if r < 0.45 else rng.randint(10, 19) if r < 0.8 else rng.randint(30, 39)
    d = {'handsize': handsize, 'slots': [[None] * 8, [None] * 8], 'pile': [[], []], 'castslot': [None, None], 'winner': None}
    for c in (WHITE, BLACK):
        for _ in range(rng.randint(0, handsize)):
            cid = card()
            s = next((i for i, e in enumerate(d['slots'][c]) if e and e[0] == cid), None)
            if s is None:
                s = next((i for i, e in enumerate(d['slots'][c]) if not e), None)
            if s is None:
                break
            if d['slots'][c][s]:
                d['slots'][c][s][1] += 1
            else:
                d['slots'][c][s] = [cid, 1]
        d['pile'][c] = [card() for _ in range(rng.randint(0, 6))]
    return d

def random_position(rng, F, R, pairs=1, extra=(2, 5), terrain=(0, 3), plug=0.3, scrolls=True, half_p=0.35, ice=None, deck=False):
    """A random legal-looking position: kings apart, a few pieces, some terrain, `pairs`
    portal pairs, scrolls in hand and — with probability half_p — an open half for one side
    (so the frozen ply and the link ply are exercised). With `ice` (a string):
    'patch' one 3x3 of ice, 'scatter' a few squares, 'floor' most of the board,
    'mixed' one of those at random, plus pits and ice scrolls in hand."""
    while True:
        board, twin = {}, {}
        squares = [(f, r) for f in range(F) for r in range(R)]
        rng.shuffle(squares)
        it = iter(squares)
        board[next(it)] = 'K'; board[next(it)] = 'k'
        for c in (WHITE, BLACK):
            for _ in range(rng.randint(*extra)):
                sq = next(it)
                ch = rng.choice('RNBQPP')
                if ch == 'P' and sq[1] in (0, R - 1):
                    ch = 'N'
                board[sq] = ch if c == WHITE else ch.lower()
        for _ in range(rng.randint(*terrain)):
            board[next(it)] = rng.choice('*^^#' + ('__' if ice else '') + ('***^' if DEFS is not None else ''))
        mid = [(f, r) for f in range(F) for r in range(1, R - 1)]
        rng.shuffle(mid)
        used = set()
        for _ in range(pairs):
            cand = [s for s in mid if s not in used and board.get(s) not in TERRAIN and (s not in board or rng.random() < plug)]
            if len(cand) < 2:
                break
            a, b = cand[0], cand[1]
            twin[a] = b; twin[b] = a
            used |= {a, b}
        hand = [rng.choice([0, 0, 1, 2]), rng.choice([0, 0, 1, 2])] if scrolls else [0, 0]
        half = [None, None]
        if scrolls and rng.random() < half_p:
            c = rng.choice([WHITE, BLACK])
            cand = [s for s in mid if s not in used and s not in board]
            if cand:
                half[c] = cand[0]
                hand[c] = rng.choice([0, 1])   # one scroll went into the half; the other may remain
        slick = set()
        icehand = [0, 0]
        if ice:
            kind = rng.choice(['patch', 'scatter', 'floor']) if ice == 'mixed' else ice
            if kind == 'patch':
                cf, cr = rng.randrange(F), rng.randrange(R)
                slick = {(cf + df, cr + dr) for df in (-1, 0, 1) for dr in (-1, 0, 1)}
            elif kind == 'scatter':
                slick = {(rng.randrange(F), rng.randrange(R)) for _ in range(rng.randint(2, 8))}
            else:
                slick = {(f, r) for f in range(F) for r in range(R) if rng.random() < 0.7}
            slick = {s for s in slick if 0 <= s[0] < F and 0 <= s[1] < R and board.get(s) not in ('*', '#', '_')}
            icehand = [rng.choice([0, 1]), rng.choice([0, 1])]
        side = rng.choice([WHITE, BLACK])
        d = None
        if deck:
            # THE DECK: the legacy scrolls give way to slots; a half open for one side needs a portal card in that side's hand
            hand = [0, 0]
            icehand = [0, 0]
            d = random_deck(rng)
            half = [None, None]
            if rng.random() < half_p:
                c = rng.choice([WHITE, BLACK])
                ps = [i for i, e in enumerate(d['slots'][c]) if e and kind_of(e[0]) == 'portal']
                cand = [s for s in mid if s not in used and s not in board]
                if ps and cand:
                    half[c] = cand[0]
                    d['castslot'][c] = ps[0]
        sledge = [rng.random() < 0.4, rng.random() < 0.4] if (deck and DEFS is not None) else [False, False]
        pos = Pos(F, R, board, twin, side, None, hand, half, slick, icehand, d, sledge)
        kw, kb = pos.king(WHITE), pos.king(BLACK)
        # the side not to move may not be in check, nobody may have lost already
        if pos.attacked(kw if side == BLACK else kb, side):
            continue
        if pos.ended():
            continue
        return pos

if __name__ == '__main__':
    # smoke: a random position with ice
    rng = random.Random(1)
    p = random_position(rng, 8, 8, ice='mixed')
    print(to_fen(p), len(p.legal_moves()), perft(p, 2))
