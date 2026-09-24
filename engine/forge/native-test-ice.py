#!/usr/bin/env python3
"""THE ICE (ice.patch) — the native gate: hand-verified fixtures over UCI, the
engine's own consistency sweep (xsweep, scratch build), and the independent
Python oracle (oracle.py, the ice rules from the rule text) on random positions
with slippery squares of every shape, pits, shoves, falls, portals and both
scrolls in hand — perft 1 move sets and perft 2 per-move counts.

  python3 native-test-ice.py <binary> [--fixtures] [--random N] [--sweep] [--depth D] [--seed S]
"""
import subprocess, sys, re, random, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oracle
from native_test_common import Engine, ok, moveset, report

HERE = os.path.dirname(os.path.abspath(__file__))
INI = os.path.join(HERE, 'ice.ini')

def fixtures(E):
    """Every count and board below was derived with the oracle before the engine ran it."""
    E.set_variant('ice8')
    # ---- I1 THE SLIDE: a rider never parks on ice - its moves onto a3..a5 are folded into the landing a6
    fen = '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {~a3,~a4,~a5}'
    per, n = E.perft(fen, 1)
    want = {'a1a2', 'a1a6', 'a1a7', 'a1b1', 'a1c1', 'a1d1', 'e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2'}
    ok('I1 a rider never parks on ice: 11 moves, a3..a5 gone, a6 the landing', moveset(per) == want, sorted(moveset(per) ^ want))
    ok('I1 the field round-trips', E.display(fen)[0].endswith('{~a3,~a4,~a5}'), E.display(fen)[0])
    # ---- I2 THE SHOVE: a knight on a5 (ice): the rook onto a4 stops there and shoves the knight to a6; the capture on a5 slides the rook on to a6
    fen = '4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {~a3,~a4,~a5}'
    per, n = E.perft(fen, 1)
    want = {'a1a2', 'a1a4', 'a1a5', 'a1b1', 'a1c1', 'a1d1', 'e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2'}
    ok('I2 the shove and the capture: 11 moves (a1a4 the shove, a1a5 the capture, a1a3 folded into a1a4)', moveset(per) == want, sorted(moveset(per) ^ want))
    ok('I2 a1a4: the rook stops on a4, the knight is shoved to a6', E.board_after(fen, 'a1a4') == '4k3/p7/n7/8/R7/8/8/4K3', E.board_after(fen, 'a1a4'))
    ok('I2 a1a5: the capture, then the rook slides on to a6', E.board_after(fen, 'a1a5') == '4k3/p7/R7/8/8/8/8/4K3', E.board_after(fen, 'a1a5'))
    ok('I2 neither gives check', not E.gives_check(fen, 'a1a4') and not E.gives_check(fen, 'a1a5'))
    # ---- I3 THE KING: a step onto ice carries him across it; into a pit is illegal; the enemy king shoved into a pit ends the game
    fen = '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {~e2,~e3,~e4}'
    per, n = E.perft(fen, 1)
    ok('I3 the king steps onto e2 and slides to e5: 14 moves, e1e2 among them', n == 14 and 'e1e2' in per and E.board_after(fen, 'e1e2') == '4k3/p7/8/4K3/8/8/8/R7', (n, E.board_after(fen, 'e1e2')))
    fen = '4k3/p7/8/4_3/8/8/8/R3K3[] w - - 0 1 {~e2,~e3,~e4}'
    per, n = E.perft(fen, 1)
    ok('I3 a pit on e5: the king may not slide into it - e1e2 is no move, 13 moves', 'e1e2' not in per and n == 13, sorted(per))
    fen = '8/p7/8/8/8/8/8/R3K1k_[] w - - 0 1 {~f1,~g1}'
    per, n = E.perft(fen, 1)
    ok('I3 the enemy king on ice at g1 with a pit behind him: Kf1 shoves him in - offered, 13 moves', 'e1f1' in per and n == 13, sorted(per))
    ok('I3 ...the board after has no black king', E.board_after(fen, 'e1f1') == '8/p7/8/8/8/8/8/R4K1_', E.board_after(fen, 'e1f1'))
    per2, n2 = E.perft(fen, 1, ['e1f1'])
    ok('I3 ...black has lost: no legal moves', n2 == 0, n2)
    ok('I3 ...the search wins on the spot: bestmove e1f1 (the pit) or a1a7 (the strip)', E.bestmove(fen, 4) in ('e1f1', 'a1a7'), E.bestmove(fen, 4))
    # ---- I4 THE CHAIN: the momentum passes down a row of pieces; the last one moves if it can
    fen = '4k3/p7/8/8/8/8/8/RnnnK3[] w - - 0 1 {~b1,~c1,~d1}'
    per, n = E.perft(fen, 1)
    want = {'a1a2', 'a1a3', 'a1a4', 'a1a5', 'a1a6', 'a1a7', 'a1b1', 'e1d1', 'e1f1'}
    ok('I4 three knights on ice up to the king: 9 moves, a1b1 the capture', moveset(per) == want, sorted(moveset(per) ^ want))
    ok('I4 a1b1: the momentum runs c1, d1 into the king and nobody moves - the rook rests on b1', E.board_after(fen, 'a1b1') == '4k3/p7/8/8/8/8/8/1RnnK3', E.board_after(fen, 'a1b1'))
    fen = '4k3/p7/8/8/8/8/8/R1nn1K2[] w - - 0 1 {~b1,~c1,~d1,~e1}'
    per, n = E.perft(fen, 1)
    ok('I4 a gap: a1b1 shoves c1 into d1, c1 stays, d1 slides to e1 and stops before the king', 'a1b1' in per and n == 11 and E.board_after(fen, 'a1b1') == '4k3/p7/8/8/8/8/8/1Rn1nK2', (n, E.board_after(fen, 'a1b1')))
    # ---- I5 THE PAWN: a push onto ice slides on, the double step too, no en passant square; a slide onto the promotion rank promotes, one move per piece
    fen = '4k3/p7/8/8/8/8/3P4/4K3[] w - - 0 1 {~d3,~d4}'
    per, n = E.perft(fen, 1)
    ok('I5 d2d3 and d2d4 both slide to d5: 6 moves', n == 6 and E.board_after(fen, 'd2d3') == '4k3/p7/8/3P4/8/8/8/4K3' and E.board_after(fen, 'd2d4') == '4k3/p7/8/3P4/8/8/8/4K3', (n, E.board_after(fen, 'd2d3'), E.board_after(fen, 'd2d4')))
    f, _ = E.display(fen, ['d2d4'])
    ok('I5 no en passant square after the slide', f.split(' ')[3] == '-', f)
    fen = '1k6/p7/8/8/3P4/8/8/4K3[] w - - 0 1 {~d5,~d6,~d7}'
    per, n = E.perft(fen, 1)
    want = {'d4d5b', 'd4d5n', 'd4d5q', 'd4d5r', 'd4d6b', 'd4d6n', 'd4d6q', 'd4d6r', 'e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2'}
    ok('I5 the push and the double step both slide onto d8: a promotion each, four pieces each, 13 moves', moveset(per) == want, sorted(moveset(per) ^ want))
    ok('I5 d4d5q: a queen on d8, giving check', E.board_after(fen, 'd4d5q') == '1k1Q4/p7/8/8/8/8/8/4K3' and E.gives_check(fen, 'd4d5q'), E.board_after(fen, 'd4d5q'))
    fen = '7r/8/8/8/8/8/1P1R4/K5k1[] w - - 0 1 {~b3,~b4,~b5,~b6,~b7}'
    per, n = E.perft(fen, 1)
    ok('I5 b2b3 slides the pawn to b8: b2b3q/r/b/n and b2b4q/r/b/n', {'b2b3q', 'b2b3n', 'b2b4q', 'b2b4b'} <= moveset(per) and 'b2b3' not in per and E.board_after(fen, 'b2b3q') == '1Q5r/8/8/8/8/8/3R4/K5k1', (sorted(m for m in per if m.startswith('b2')), E.board_after(fen, 'b2b3q')))
    # ---- I6 A SHOVED PAWN promotes to the strongest piece where it stops
    fen = '1R6/p3k3/8/8/8/8/1p5K/8[] w - - 0 1 {~b3,~b2}'
    per, n = E.perft(fen, 1)
    ok('I6 18 moves; b8b3 stops on b3 and shoves the pawn from b2 to b1', 'b8b3' in per and n == 18, (n, sorted(per)))
    ok('I6 ...where it is a queen', E.board_after(fen, 'b8b3') == '8/p3k3/8/8/8/1R6/7K/1q6', E.board_after(fen, 'b8b3'))
    # ---- I7 THE PIT: a slide into a pit loses the piece; a piece shoved into a pit is gone
    fen = '4k3/p7/8/8/_7/8/8/R3K3[] w - - 0 1 {~a2,~a3}'
    per, n = E.perft(fen, 1)
    ok('I7 a1a3 (the last ice square before the pit) slides the rook into the pit: offered, a1a2 folded into it, 9 moves', 'a1a3' in per and 'a1a2' not in per and n == 9, sorted(per))
    ok('I7 ...the rook is gone', E.board_after(fen, 'a1a3') == '4k3/p7/8/8/_7/8/8/4K3', E.board_after(fen, 'a1a3'))
    fen = '4k3/p7/8/8/_7/n7/8/R3K3[] w - - 0 1 {~a2,~a3}'
    per, n = E.perft(fen, 1)
    ok('I7 the knight on a3 (ice) is shoved into the pit by a1a2 and is gone, the rook rests on a2; 10 moves', 'a1a2' in per and n == 10 and E.board_after(fen, 'a1a2') == '4k3/p7/8/8/_7/8/R7/4K3', (n, sorted(per), E.board_after(fen, 'a1a2')))
    # ---- I8 PORTALS: a slide into an empty portal square lands on the twin and rests there, even on ice; a piece on a portal square is an obstacle; a portal square is never slippery
    fen = '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a5-h7,~a3,~a4,~h6,~h7}'
    per, n = E.perft(fen, 1)
    want = {'a1a2', 'a1a5', 'a1b1', 'a1c1', 'a1d1', 'e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2'}
    ok('I8 the rook onto a3/a4 would slide into the portal - the ordinary landing a1a5 is that outcome, so both fold into it: 10 moves', moveset(per) == want, sorted(moveset(per) ^ want))
    ok('I8 a1a5 lands on h7 and rests there though h7 is iced', E.board_after(fen, 'a1a5') == '4k3/p6R/8/8/8/8/8/4K3', E.board_after(fen, 'a1a5'))
    fen = '4k3/p7/8/8/8/8/8/R2K4[] w - - 0 1 {d5-h7,~d2,~d3,~d4,~h6,~h7}'
    per, n = E.perft(fen, 1)
    ok('I8 a king step onto d2 slides d3, d4 and into the portal at d5, out at h7, at rest: d1d2 offered, 13 moves', 'd1d2' in per and n == 13 and E.board_after(fen, 'd1d2') == '4k3/p6K/8/8/8/8/8/R7', (n, sorted(per), E.board_after(fen, 'd1d2')))
    fen = '4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {a5-h7,~a3,~a4}'
    per, n = E.perft(fen, 1)
    ok('I8 a knight on the portal square a5 is an obstacle: a1a4 stops on a4 with no shove (a portal square is never slippery); a1a5 is the capture and the landing on h7', 'a1a4' in per and E.board_after(fen, 'a1a4') == '4k3/p7/8/n7/R7/8/8/4K3' and E.board_after(fen, 'a1a5') == '4k3/p6R/8/8/8/8/8/4K3', (sorted(per), E.board_after(fen, 'a1a4'), E.board_after(fen, 'a1a5')))
    # ---- I9 THE CAST: one scroll each, on any floor square of the cast rows (4 and 5), under pieces too; the 3x3 iced, walls skipped; never in check
    fen = '4k3/p7/8/8/8/8/8/R3K3[IOOioo] w - - 0 1'
    per, n = E.perft(fen, 1)
    casts = sorted(m for m in per if m.startswith('I@'))
    ok('I9 sixteen ice casts (rows 4 and 5) beside 14 piece moves and 47 portal casts: 77 moves', len(casts) == 16 and all(m[3] in '45' for m in casts) and n == 77, (n, casts))
    f, _ = E.display(fen, ['I@e4'])
    ok('I9 I@e4 ices d3..f5, the scroll spent', f.endswith('{~d3,~e3,~f3,~d4,~e4,~f4,~d5,~e5,~f5}') and '[OOioo]' in f, f)
    fen = '4k3/p7/8/8/3n4/8/8/R3K3[IOOioo] w - - 0 1'
    per, n = E.perft(fen, 1)
    ok('I9 a cast under the knight on d4 is offered', 'I@d4' in per and n == 75, (n, sorted(m for m in per if m.startswith('I@'))))
    f, _ = E.display(fen, ['I@d4'])
    ok('I9 ...the knight stands on the ice', '3n4' in f and f.endswith('{~c3,~d3,~e3,~c4,~d4,~e4,~c5,~d5,~e5}'), f)
    fen = '4k3/p7/8/8/3*4/8/8/R3K3[IOOioo] w - - 0 1'
    per, n = E.perft(fen, 1)
    f, _ = E.display(fen, ['I@d5'])
    ok('I9 the wall on d4 takes no ice (and is no cast square): I@d5 ices the eight around it', 'I@d4' not in per and f.endswith('{~c4,~e4,~c5,~d5,~e5,~c6,~d6,~e6}'), f)
    fen = '4k3/p7/8/8/8/8/8/r3K2R[IOOioo] w - - 0 1'
    per, n = E.perft(fen, 1)
    ok('I9 no cast in check: the three king evasions alone', moveset(per) == {'e1d2', 'e1e2', 'e1f2'}, sorted(per))
    ok('I9 the search casts or moves, never crashes: a bestmove', E.bestmove('4k3/p7/8/8/8/8/8/R3K3[IOOioo] w - - 0 1', 5) != '(none)')
    # ---- I10 A knight lands: its jump has no direction
    fen = '4k3/p7/8/8/8/8/8/N3K3[] w - - 0 1 {~b3,~c2,~c3,~c4}'
    per, n = E.perft(fen, 1)
    ok('I10 the knight lands on b3 and c2 and stays: 7 moves', n == 7 and 'a1b3' in per and 'a1c2' in per and E.board_after(fen, 'a1b3') == '4k3/p7/8/8/8/1N6/8/4K3', (n, E.board_after(fen, 'a1b3')))
    # ---- I11 CHECK THROUGH THE PHYSICS: evasions by a slide, check by a shove, a slide that exposes the king
    fen = '4k3/p7/8/8/8/1R6/8/K6r[] w - - 0 1 {~b2,~b1}'
    per, n = E.perft(fen, 1)
    ok('I11 in check from h1: three evasions - Ka2, Kb2 (the king slides on to c3), Rb1 (the rook slides down to b1 and interposes)', moveset(per) == {'a1a2', 'a1b2', 'b3b1'}, sorted(per))
    ok('I11 a1b2 ends on c3; b3b1 interposes on b1', E.board_after(fen, 'a1b2') == '4k3/p7/8/8/8/1RK5/8/7r' and E.board_after(fen, 'b3b1') == '4k3/p7/8/8/8/8/8/KR5r', (E.board_after(fen, 'a1b2'), E.board_after(fen, 'b3b1')))
    fen = '8/p7/8/8/8/4B3/R7/KR1nk3[] w - - 0 1 {~c1,~d1,~e1,~f1}'
    per, n = E.perft(fen, 1)
    ok('I11 b1c1 stops on c1 and shoves the knight into the king, who slides to g1 - into the bishop\'s line: check by a shove; 32 moves', 'b1c1' in per and n == 32 and E.gives_check(fen, 'b1c1') and E.board_after(fen, 'b1c1') == '8/p7/8/8/8/4B3/R7/K1Rn2k1', (n, sorted(per), E.board_after(fen, 'b1c1')))
    per2, n2 = E.perft(fen, 1, ['b1c1'])
    ok('I11 ...black escapes to f1 or h1 (the second rank is covered): 2 moves', moveset(per2) == {'g1f1', 'g1h1'}, sorted(per2))
    ok('I11 ...a search on the position completes', E.bestmove(fen, 4) != '(none)', E.bestmove(fen, 4))
    fen = 'k7/p7/8/8/8/8/8/K2R3r[] w - - 0 1 {~d2,~d3}'
    per, n = E.perft(fen, 1)
    ok('I11 the rook on d1 shields a1 from h1: sliding off the rank (d1d2 onto ice, d1d3, d1d4) is illegal, 9 moves', not ({'d1d2', 'd1d3', 'd1d4'} & moveset(per)) and n == 9, sorted(per))
    # ---- I12 EN PASSANT onto ice: the captor slides on diagonally - here to a8, where it promotes
    fen = '4k3/8/8/2pP4/8/8/8/4K3[] w - c6 0 1 {~c6,~b7}'
    per, n = E.perft(fen, 1)
    ok('I12 the en passant capture d5c6 slides the pawn to a8: four promotions, 11 moves', {'d5c6q', 'd5c6r', 'd5c6b', 'd5c6n'} <= moveset(per) and 'd5c6' not in per and n == 11, sorted(per))
    ok('I12 d5c6q: the c5 pawn gone, a queen on a8', E.board_after(fen, 'd5c6q') == 'Q3k3/8/8/8/8/8/8/4K3', E.board_after(fen, 'd5c6q'))
    # ---- I13 A pawn shoves the enemy king (the one piece that can push what it does not attack)
    fen = '4r3/p7/8/8/4k3/8/4P3/4K3[] w - - 0 1 {~e3,~e4}'
    per, n = E.perft(fen, 1)
    ok('I13 e2e3 shoves the black king from e4 to e5, no check: 5 moves', 'e2e3' in per and n == 5 and not E.gives_check(fen, 'e2e3') and E.board_after(fen, 'e2e3') == '4r3/p7/8/4k3/8/4P3/8/4K3', (n, E.board_after(fen, 'e2e3')))
    # ---- I14 SAN and the promotion suffix through the engine's own notation
    E.set_variant('ice8')

def perft_deep(E, depth):
    E.set_variant('ice8')
    fens = ['4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {~a3,~a4,~a5}', '4k3/p7/8/8/8/8/3P4/4K3[] w - - 0 1 {~d3,~d4}',
            '7r/8/8/8/8/8/1P1R4/K5k1[] w - - 0 1 {~b3,~b4,~b5,~b6,~b7}', '4k3/p7/8/8/_7/n7/8/R3K3[] w - - 0 1 {~a2,~a3}',
            '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a5-h7,~a3,~a4,~h6,~h7}', '4k3/p7/8/8/3n4/8/8/R3K3[IOOioo] w - - 0 1',
            '4k3/p7/8/8/8/1R6/8/K6r[] w - - 0 1 {~b2,~b1}', '8/p7/8/8/8/4B3/R7/KR1nk3[] w - - 0 1 {~c1,~d1,~e1,~f1}',
            'r2qk2r/pp1bppb1/2np1np1/8/3P4/2N2N2/PPQ1PPPP/R3KB1R[IOOioo] w - - 0 1 {c4-f5,~d4,~d5,~e4,~e5,~e6}']
    for f in fens:
        t = time.time()
        per, n = E.perft(f, depth)
        print(f'  perft {depth} {n:>9}  {time.time()-t:5.1f}s  {f}')
    ok(f'perft {depth} on {len(fens)} ice fixtures completed (asserts on in a debug build)', True)

def random_vs_oracle(E, N, seed=7, depth2=True, sweep=False):
    rng = random.Random(seed)
    bad = 0
    kinds = {'perft1': 0, 'perft2': 0, 'sweep': 0}
    shapes = [(8, 8, 'ice8'), (6, 6, 'ice6'), (8, 8, 'ice8'), (10, 10, 'ice10')]
    t0 = time.time()
    for i in range(N):
        F, R, var = shapes[i % len(shapes)]
        pairs = (i % 3 == 2) + (i % 7 == 6)
        pos = oracle.random_position(rng, F, R, pairs=pairs, ice='mixed', terrain=(0, 4))
        fen = oracle.to_fen(pos)
        E.set_variant(var)
        want = {oracle.uci(m): oracle.perft(m[3], 1) for m in pos.legal_moves()}
        per, n = E.perft(fen, 1)
        if set(per) != set(want):
            bad += 1
            kinds['perft1'] += 1
            if bad <= 10:
                print('MISMATCH perft1', fen, 'engine-only', sorted(set(per) - set(want)), 'oracle-only', sorted(set(want) - set(per)))
            continue
        if depth2 and want:
            per2, n2 = E.perft(fen, 2)
            diff = {m: (per2.get(m), want[m]) for m in want if per2.get(m) != want[m]}
            if diff:
                bad += 1
                kinds['perft2'] += 1
                if bad <= 10:
                    print('MISMATCH perft2', fen, diff)
                    m0 = next(iter(diff))
                    child = next(x[3] for x in pos.legal_moves() if oracle.uci(x) == m0)
                    cw = {oracle.uci(x) for x in child.legal_moves()}
                    cp, cn = E.perft(fen, 1, [m0])
                    print('   after', m0, 'child fen (oracle)', oracle.to_fen(child), '| engine:', E.display(fen, [m0])[0])
                    print('   oracle-only', sorted(cw - set(cp)), 'engine-only', sorted(set(cp) - cw), 'engine perft1 total', cn)
        if sweep:
            sb, lines = E.sweep(fen, 2)
            if sb:
                bad += 1
                kinds['sweep'] += 1
                if bad <= 10:
                    print('SWEEP', fen, lines[:4])
    ok(f'oracle: {N} random ice positions (perft 1 move sets{", perft 2 per-move counts" if depth2 else ""}{", xsweep 2" if sweep else ""}) agree', bad == 0, f'{bad} mismatches {kinds}')
    print(f'  {N} positions in {time.time()-t0:.1f}s')

if __name__ == '__main__':
    binary = sys.argv[1]
    args = sys.argv[2:]
    N = int(args[args.index('--random') + 1]) if '--random' in args else 0
    D = int(args[args.index('--depth') + 1]) if '--depth' in args else 0
    E = Engine(binary, ini=INI, variant='ice8')
    if '--fixtures' in args or not (N or D or '--sweep' in args):
        fixtures(E)
    if '--sweep' in args and not N:
        E.set_variant('ice8')
        for f in ['4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {~a3,~a4,~a5}', '4k3/p7/8/8/8/8/3P4/4K3[] w - - 0 1 {~d3,~d4}',
                  '7r/8/8/8/8/8/1P1R4/K5k1[] w - - 0 1 {~b3,~b4,~b5,~b6,~b7}', '4k3/p7/8/8/_7/n7/8/R3K3[] w - - 0 1 {~a2,~a3}',
                  '4k3/p7/8/8/8/8/8/R3K3[IOOioo] w - - 0 1 {a5-h7,~a3,~a4,~h6,~h7}', '8/p7/8/8/8/4B3/R7/KR1nk3[] w - - 0 1 {~c1,~d1,~e1,~f1}',
                  '4k3/p7/8/8/8/1R6/8/K6r[] w - - 0 1 {~b2,~b1}', '1R6/p3k3/8/8/8/8/1p5K/8[] w - - 0 1 {~b3,~b2}',
                  'r2qk2r/pp1bppb1/2np1np1/8/3P4/2N2N2/PPQ1PPPP/R3KB1R[IOOioo] w - - 0 1 {c4-f5,~d4,~d5,~e4,~e5,~e6}']:
            sb, lines = E.sweep(f, 3)
            ok(f'xsweep 3 clean on {f}', sb == 0, lines[:5])
    if N:
        random_vs_oracle(E, N, sweep='--sweep' in args, seed=int(args[args.index('--seed') + 1]) if '--seed' in args else 7)
    if D:
        perft_deep(E, D)
    E.close()
    report('native (ice)')
