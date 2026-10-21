#!/usr/bin/env python3
"""CAPTURE OR WAIT (piece-states.patch, Phase 3.4, 2026-10-21) — the designer's
question on mind control: "I'd be curious to see if the engine tends to
capture a mind controlled piece or wait out the effect." On a handful of
middle-game boards a black piece stands under White's control for n plies.
Two seats are searched at each n:

  the OWNER (Black, to move, its piece just stolen): does its best line take
  the stolen piece back by capture, or wait for the return?
  the THIEF (White, to move, holding the piece): does its best line SPEND the
  piece — a capture with it, or a sacrifice — before it returns, or just use
  the tempo?

  python3 control-curve.py <native-largeboard-build> [n,n,…] [depth]

The test variant is states.ini's states8 (control cards 120-123 declare the
effect; the records themselves are the FEN's). Prints a table; nothing is
tuned by it — the no-values rule — it is a measurement for the record.
"""
import sys, os, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from native_test_common import Engine

HERE = os.path.dirname(os.path.abspath(__file__))
args = [a for a in sys.argv[1:] if not a.startswith('--')]
binary = args[0] if args else './stockfish'
NS = [int(a) for a in args[1].split(',')] if len(args) > 1 else [1, 2, 3, 4, 6, 8]
DEPTH = int(args[2]) if len(args) > 2 else 14
E = Engine(binary, ini=os.path.join(HERE, 'states.ini'), variant='states8')

# (name, board with the stolen piece written in WHITE's colour, its square)
BOARDS = [
  # (name, the board with the stolen piece written in WHITE's colour, its square) — nobody is in check on either seat
  ('a rook on d6 among pawns', 'r3k2r/pp3ppp/3R4/2p5/8/2N5/PPP2PPP/R3K2R', 'd6'),
  ('a knight on f6 beside a castled king', 'r1bq1r1k/ppp2ppp/3p1N2/4p3/2B1P3/8/PPPP1PPP/R1BQK2R', 'f6'),
  ('a bishop on c5 in the open', 'r2qk2r/ppp2ppp/2n5/2B1p3/4P3/2N5/PPP2PPP/R2QK2R', 'c5'),
  ('the owner\'s own queen on d8', 'r1bq1rk1/pppp1ppp/2n2n2/4p3/4P3/5N2/PPPP1PPP/RNB1KB1R'.replace('r1bq1rk1', 'r1bQ1rk1'), 'd8'),
  ('a rook on a8 behind its bishop', 'R1bqkb1r/pp3ppp/2n5/8/8/2N5/PPP2PPP/2KR3R', 'a8'),
  ('a pawn on e5 pushed ahead', 'r1bqkb1r/pppp1ppp/2n2n2/4P3/8/5N2/PPPP1PPP/RNBQKB1R', 'e5'),
]

def captures_of(pv, fen, sq):
    """Does the line's FIRST move land on `sq` (the owner taking its stolen piece back)?"""
    return pv and pv[0][2:4] == sq

def spends(pv, sq, n):
    """Within n plies of the thief's line, does the stolen piece (tracked by square) make a capture, or get captured?"""
    at = sq
    for i, m in enumerate(pv[:n]):
        frm, to = m[:2], m[2:4]
        if i % 2 == 0 and frm == at:  # the thief moves it
            at = to
            if 'x' in m: return f'captures with it at ply {i+1}'
        if to == at and frm != at and i % 2 == 1:  # the owner takes it
            return f'it is taken on ply {i+1}'
    return None

print(f'depth {DEPTH} · the records: White holds the piece, it returns to Black in n plies')
print(f'{"board":<40} {"n":>2}  {"owner (Black) best":<22} {"takes it back?":<16} {"thief (White) best":<22} {"spends it?":<28}')
for name, board, sq in BOARDS:
    for n in NS:
        owner_fen = f'{board}[] b - - 0 1 {{%{sq}c{n}b}}'
        thief_fen = f'{board}[] w - - 0 1 {{%{sq}c{n}b}}'
        E.send('ucinewgame'); E.send('isready'); E.wait('readyok')
        o = E.bestmove_info(owner_fen, DEPTH)
        E.send('ucinewgame'); E.send('isready'); E.wait('readyok')
        t = E.bestmove_info(thief_fen, DEPTH)
        def parse(l):
            sc = l.split(' score ')[1].split(' nodes')[0] if ' score ' in l else '?'
            pv = l.split(' pv ')[1].split() if ' pv ' in l else []
            return sc, pv
        osc, opv = parse(o); tsc, tpv = parse(t)
        # a capture of the stolen piece by the owner's first move: the SAN is not available over UCI, so read the destination
        back = 'YES' if opv and opv[0][2:4] == sq else 'waits'
        # the thief's line: does the stolen piece move at all, capture, or get taken within n plies
        at = sq; spent = '-'
        for i, m in enumerate(tpv[:n]):
            frm, to = m[:2], m[2:4]
            if i % 2 == 0 and frm == at:
                at = to; spent = f'moves it on ply {i+1}'
            if i % 2 == 1 and to == at:
                spent = f'the owner takes it on ply {i+1}'; break
        print(f'{name:<40} {n:>2}  {(opv[0] if opv else "?") + " " + osc:<22} {back:<16} {(tpv[0] if tpv else "?") + " " + tsc:<22} {spent:<28}')
E.close()
