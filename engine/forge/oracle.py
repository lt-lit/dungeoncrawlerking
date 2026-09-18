#!/usr/bin/env python3
"""Portals v2 ORACLE — an independent model of the rules for perft-1/2 comparison
against the engine. Deliberately written from the rule text, not from the C++:
forward rays for every attack (the engine uses reverse rays + a tunnel term),
make/unmake by copying the board.

Rules modelled (the test variants: chess pieces, no castling, king-row
promotion to n/b/r/q, double step from every non-king row, en passant,
extinction: a side down to one piece has lost, so the position has no moves):
  * walls '*' and '#' block and cannot be entered; crates '^' are captured by
    any piece moving onto them (pawns diagonally only, never pushed onto).
  * PORTALS v2: a linked portal square is a BODY: every line stops at it,
    whatever stands on it. Landing on one (any piece, any move) sends the
    mover through to the twin; whatever stands on the twin swaps back. A piece
    standing on the entry is captured on landing as normal. An EMPTY PAIR is a
    TUNNEL for R/B/Q lines: the line enters the empty portal and continues
    from its empty twin in the same direction, through another empty pair too,
    each pair once per line. A pawn's double step never crosses a portal
    square (it may land on one). No en passant square after a portal landing.
"""
import random, sys

WHITE, BLACK = 0, 1
TERRAIN = set('*#^')
ORTHO = [(1, 0), (-1, 0), (0, 1), (0, -1)]
DIAG = [(1, 1), (1, -1), (-1, 1), (-1, -1)]
KNIGHT = [(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)]
PROMOS = 'nbrq'

def colour(ch):
    return WHITE if ch.isupper() else BLACK

class Pos:
    def __init__(self, files, ranks, board, twin, side, ep=None):
        self.F, self.R = files, ranks
        self.board = board          # dict (f, r) -> char; absent = empty
        self.twin = twin            # dict sq -> sq for linked pairs
        self.side = side
        self.ep = ep                # ep square (f, r) or None

    def on(self, f, r):
        return 0 <= f < self.F and 0 <= r < self.R

    def piece_at(self, sq):
        ch = self.board.get(sq)
        return ch if ch and ch not in TERRAIN else None

    def is_body(self, sq):
        return sq in self.board or sq in self.twin  # a piece, terrain, or a portal square

    def open_pair(self, sq):
        return sq in self.twin and self.piece_at(sq) is None and self.piece_at(self.twin[sq]) is None

    # ---- targets: the squares a piece may move to / attacks, with the occupant found there
    def ray(self, frm, d, out):
        df, dr = d
        f, r = frm[0] + df, frm[1] + dr
        used = set()
        while self.on(f, r):
            sq = (f, r)
            ch = self.board.get(sq)
            if ch in ('*', '#'):
                break
            if sq in self.twin:
                out.append(sq)                       # a landing (empty) or a capture/friend (occupied)
                if self.open_pair(sq) and sq not in used and self.twin[sq] not in used:
                    used.add(sq); used.add(self.twin[sq])
                    f, r = self.twin[sq][0] + df, self.twin[sq][1] + dr   # the tunnel: continue from the twin
                    continue
                break
            out.append(sq)
            if ch:                                   # a piece or a crate: stop
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
                if self.on(f, r) and self.board.get((f, r)) not in ('*', '#'):
                    out.append((f, r))
        if t == 'k':
            for df, dr in ORTHO + DIAG:
                f, r = sq[0] + df, sq[1] + dr
                if self.on(f, r) and self.board.get((f, r)) not in ('*', '#'):
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
        # drop own pieces; one entry per square (a tunnel line and a plain line may meet on one square)
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
        return self.count(WHITE) <= 1 or self.count(BLACK) <= 1

    def make(self, frm, to, promo=None):
        """Return the position after the move (a copy)."""
        b = dict(self.board)
        ch = b.pop(frm)
        c = colour(ch)
        up = 1 if c == WHITE else -1
        ep = None
        if ch.lower() == 'p' and to == self.ep and to not in b:
            b.pop((to[0], to[1] - up), None)         # en passant victim
        b.pop(to, None)                              # the capture (a piece or a crate) on the landing square
        if promo:
            ch = promo.upper() if c == WHITE else promo
        if to in self.twin:
            q = self.twin[to]
            if q == frm:
                b[frm] = ch                          # twin to twin: ends where it stood
            else:
                sw = b.pop(q, None)                  # whatever stands on the twin comes back
                b[q] = ch
                if sw is not None:
                    b[to] = sw
        else:
            b[to] = ch
            if ch.lower() == 'p' and abs(to[1] - frm[1]) == 2:
                ep = (frm[0], frm[1] + up)
        return Pos(self.F, self.R, b, self.twin, 1 - self.side, ep)

    def legal_moves(self):
        if self.ended():
            return []
        res = []
        for s, ch in list(self.board.items()):
            if ch in TERRAIN or colour(ch) != self.side:
                continue
            for to in self.targets(s, ch):
                promos = [None]
                if ch.lower() == 'p' and to not in self.twin and to[1] in (0, self.R - 1):
                    promos = list(PROMOS)
                for pr in promos:
                    nxt = self.make(s, to, pr)
                    k = nxt.king(self.side)
                    if k is not None and nxt.attacked(k, 1 - self.side):
                        continue
                    res.append((s, to, pr, nxt))
        return res

def sqname(sq):
    return 'abcdefghijkl'[sq[0]] + str(sq[1] + 1)

def uci(m):
    s, to, pr, _ = m
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
    field = ''
    pairs = sorted({tuple(sorted([a, b])) for a, b in pos.twin.items()})
    if pairs:
        field = ' {' + ','.join(f'{sqname(a)}-{sqname(b)}' for a, b in pairs) + '}'
    ep = sqname(pos.ep) if pos.ep else '-'
    return '/'.join(rows) + '[] ' + ('w' if pos.side == WHITE else 'b') + ' - ' + ep + ' 0 1' + field

def perft(pos, depth):
    if depth == 0:
        return 1
    moves = pos.legal_moves()
    if depth == 1:
        return len(moves)
    return sum(perft(m[3], depth - 1) for m in moves)

def random_position(rng, F, R, pairs=1, extra=(2, 5), terrain=(0, 3), plug=0.3):
    """A random legal-looking position: kings apart, a few pieces, some terrain, `pairs` portal pairs."""
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
            board[next(it)] = rng.choice('*^^#')
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
        side = rng.choice([WHITE, BLACK])
        pos = Pos(F, R, board, twin, side)
        kw, kb = pos.king(WHITE), pos.king(BLACK)
        # the side not to move may not be in check, nobody may have lost already
        if pos.attacked(kw if side == BLACK else kb, side):
            continue
        if pos.ended():
            continue
        return pos

if __name__ == '__main__':
    # smoke: a fixture and a random position
    rng = random.Random(1)
    p = random_position(rng, 8, 8)
    print(to_fen(p), len(p.legal_moves()), perft(p, 2))
