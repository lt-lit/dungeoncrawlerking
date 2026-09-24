#!/usr/bin/env python3
"""Portals v4 (the body rule, no tunnel) + v3 (the one-turn cast) — the native
gate: hand-verified fixtures over UCI, the engine's own consistency sweep
(xsweep, scratch build), and the independent Python oracle on random positions
(perft 1 move sets, perft 2 per-move counts) — with scrolls in hand, open
halves, the frozen pass, the links-only ply and the fizzle. Every count was
re-derived by the oracle when the tunnel was retired (2026-09-19).

  python3 native-test.py <binary> [--random N] [--sweep] [--depth D]
"""
import subprocess, sys, re, random, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oracle
from native_test_common import Engine, ok, moveset, report

HERE = os.path.dirname(os.path.abspath(__file__))
INI = os.path.join(HERE, 'portals-v2.ini')

def fixtures(E):
    E.set_variant('portal8')
    # ---- F1 THE BODY (Portals v4, the tunnel retired): a1's line stops at a4 and the move there is the landing on h5; nothing past a4, nothing out of h5
    fen = '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}'
    per, n = E.perft(fen, 1)
    want = {'a1a2','a1a3','a1a4','a1b1','a1c1','a1d1','e1d1','e1d2','e1e2','e1f1','e1f2'}
    ok('F1 body: exactly the 11 moves (a5..a7 gone behind the body, no h6..h8 out of the twin)', moveset(per) == want, sorted(moveset(per) ^ want))
    ok('F1 a1a4 lands on h5', E.board_after(fen, 'a1a4') == '4k3/p7/8/7R/8/8/8/4K3', E.board_after(fen, 'a1a4'))
    ok('F1 a1a4 gives no check (the rook on h5 sees h6..h8, not e8)', not E.gives_check(fen, 'a1a4'))
    # ---- F2 the plugged exit: the landing swaps with the plug
    fen = '4k3/p7/8/7n/8/8/8/R3K3[] w - - 0 1 {a4-h5}'
    per, n = E.perft(fen, 1)
    ok('F2 plugged exit: the same 11 moves', moveset(per) == want, sorted(moveset(per) ^ want))
    ok('F2 a1a4 swaps with the knight', E.board_after(fen, 'a1a4') == '4k3/p7/8/7R/n7/8/8/4K3', E.board_after(fen, 'a1a4'))
    # ---- F3 the plugged entry: capture on landing, teleport
    fen = '4k3/p7/8/8/n7/8/8/R3K3[] w - - 0 1 {a4-h5}'
    per, n = E.perft(fen, 1)
    ok('F3 plugged entry: 11 moves', moveset(per) == want, sorted(moveset(per) ^ want))
    ok('F3 a1a4 captures the knight and lands on h5', E.board_after(fen, 'a1a4') == '4k3/p7/8/7R/8/8/8/4K3', E.board_after(fen, 'a1a4'))
    # ---- F4 NO CHECK THROUGH A PAIR (v2's check through the tunnel, inverted): the rook's line ends at a4
    fen = '8/6bk/8/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}'
    _, chk = E.display(fen)
    ok('F4 black is NOT in check: nothing runs through the pair', not chk, chk)
    per, n = E.perft(fen, 1)
    want = {'g7a1','g7b2','g7c3','g7d4','g7e5','g7f6','g7f8','g7h6','g7h8','h7g6','h7g8','h7h6','h7h8'}
    ok('F4 black has its 13 free moves (the king to h6 and h8 included)', moveset(per) == want, sorted(moveset(per) ^ want))
    fen = '7k/8/7b/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}'
    per, n = E.perft(fen, 1)
    ok('F4b the bishop on h6 is NOT pinned (v2 pinned it through the tunnel): 10 moves, h6g5 among them', n == 10 and 'h6g5' in per, sorted(per))
    # ---- F5 no discovered check through a pair: the bishop leaves h6 freely (h6g7 checks directly, nothing else does), the rook lands under it unseen
    fen = '7k/1p6/7B/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}'
    per, n = E.perft(fen, 1)
    bish = {'h6g7','h6f8','h6g5','h6f4','h6e3','h6d2','h6c1'}
    want = bish | {'a1a2','a1a3','a1a4','a1b1','a1c1','a1d1','e1d1','e1d2','e1e2','e1f1','e1f2'}
    ok('F5 18 moves', moveset(per) == want, sorted(moveset(per) ^ want))
    ok('F5 only h6g7 gives check, the bishop\'s own direct check; no bishop move DISCOVERS one through the pair', {m for m in bish if E.gives_check(fen, m)} == {'h6g7'}, sorted(m for m in bish if E.gives_check(fen, m)))
    ok('F5 a1a4 (rook to h5 under its own bishop) gives no check', not E.gives_check(fen, 'a1a4'))
    # ---- F6 the body stops both rooks: black is not in check, its rook's line down the a-file ends at a4 (the landing on h5); a8a1 is no move
    fen = 'r7/7k/8/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}'
    _, chk = E.display(fen)
    ok('F6 black is not in check', not chk, chk)
    per, n = E.perft(fen, 1)
    ok('F6 16 moves with a8a4 and without a8a1..a8a3', n == 16 and 'a8a4' in per and not ({'a8a1','a8a2','a8a3'} & moveset(per)), sorted(per))
    ok('F6 a8a4 puts the rook on h5', E.board_after(fen, 'a8a4') == '8/7k/8/7r/8/8/8/R3K3', E.board_after(fen, 'a8a4'))
    # ---- F7 two pairs: each a body and a landing, never a chain
    fen = '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-c6,c7-f2}'
    per, n = E.perft(fen, 1)
    want = {'a1a2','a1a3','a1b1','a1c1','a1d1','e1d1','e1d2','e1e2','e1f1','e1f2'}
    ok('F7 two pairs: 10 moves, a1a3 the landing, nothing through to c7 or f3..f8', moveset(per) == want, sorted(moveset(per) ^ want))
    ok('F7 a1a3 lands on c6', E.board_after(fen, 'a1a3') == '4k3/p7/2R5/8/8/8/8/4K3', E.board_after(fen, 'a1a3'))
    ok('F7 e1f2 (the king steps into the second pair) lands on c7', E.board_after(fen, 'e1f2') == '4k3/p1K5/8/8/8/8/8/R7', E.board_after(fen, 'e1f2'))
    # ---- F8 two pairs on one file: the first is the body, the second is never reached
    fen = '7k/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-e5,e6-e3}'
    per, n = E.perft(fen, 1)
    want = {'a1a2','a1a3','a1b1','a1c1','a1d1','e1d1','e1d2','e1e2','e1f1','e1f2'}
    ok('F8 10 moves: a4..a8, e4, e6 never reached', moveset(per) == want, sorted(moveset(per) ^ want))
    ok('F8 a1a3 puts the rook on e5', E.board_after(fen, 'a1a3') == '7k/p7/8/4R3/8/8/8/4K3', E.board_after(fen, 'a1a3'))
    # ---- F9 the pawn's double step: a portal on the first square ends it; on the second it lands and steps through
    fen = '4k3/7p/8/8/8/8/P7/4K3[] w - - 0 1 {a3-d5}'
    per, n = E.perft(fen, 1)
    ok('F9a double step blocked by the portal on a3: a2a3 only', 'a2a3' in per and 'a2a4' not in per and n == 6, sorted(per))
    ok('F9a a2a3 lands on d5', E.board_after(fen, 'a2a3') == '4k3/7p/8/3P4/8/8/8/4K3', E.board_after(fen, 'a2a3'))
    fen = '4k3/7p/8/8/8/8/P7/4K3[] w - - 0 1 {a4-d5}'
    per, n = E.perft(fen, 1)
    ok('F9b double step onto the portal: a2a3 and a2a4, 7 moves', 'a2a3' in per and 'a2a4' in per and n == 7, sorted(per))
    f, _ = E.display(fen, ['a2a4'])
    ok('F9b a2a4 lands on d5 with no en passant square', f.split('[')[0] == '4k3/7p/8/3P4/8/8/8/4K3' and f.split(' ')[3] == '-', f)
    # ---- F10 casts: a linking cast never gives check and never exposes the caster (a body only closes lines)
    fen = '8/1p5k/8/8/8/8/8/R3K3[OO] w - - 0 1 {a4w}'
    per, n = E.perft(fen, 1)
    ok('F10a the link ply: 45 linking casts', n == 45 and all(m.startswith('O@') for m in per), (n, sorted(m for m in per if not m.startswith('O@'))))
    ok('F10a O@h5 is a legal cast that gives NO check (v2 gave check through the new tunnel)', 'O@h5' in per and not E.gives_check(fen, 'O@h5'))
    checks = {m for m in per if E.gives_check(fen, m)}
    ok('F10a no cast gives check', checks == set(), sorted(checks))
    per2, n2 = E.perft(fen, 1, ['O@h5'])
    ok('F10a after O@h5 black plays on unchecked: 7 moves', n2 == 7 and moveset(per2) == {'b7b5','b7b6','h7g6','h7g7','h7g8','h7h6','h7h8'}, sorted(per2))
    fen = 'r2k4/8/8/8/7K/8/8/1R6[OO] w - - 0 1 {a5w}'
    per, n = E.perft(fen, 1)
    ok('F10b every castable square is a legal link, h5/h6/h7 included (v2 refused them as self-exposing through the tunnel)', {'O@h5','O@h6','O@h7','O@c3'} <= moveset(per), sorted(m for m in per if m.startswith('O@h')))
    ok('F10b 46 legal moves: the linking casts alone (the caster is bound to the link)', n == 46 and all(m.startswith('O@') for m in per), n)
    # ---- the landings as v1 wrote them: twin to twin, the swap of a king, the capture through
    fen = '4k3/3p4/5n2/8/8/2B5/3P4/4K3[] w - - 0 1 {c3-f6}'
    per, n = E.perft(fen, 1)
    ok('F11 twin to twin: c3f6 captures at range, 13 moves', 'c3f6' in per and n == 13, n)
    ok('F11 the bishop is back on c3, the knight gone', E.board_after(fen, 'c3f6') == '4k3/3p4/8/8/8/2B5/3P4/4K3', E.board_after(fen, 'c3f6'))
    fen = '4k3/3p4/8/8/8/2B5/3P4/4K3[] w - - 0 1 {c3-f6}'
    per, n = E.perft(fen, 1)
    ok('F11b the quiet pass c3f6 stays, c3g7 is gone (f6 is a body): 13 moves', 'c3f6' in per and 'c3g7' not in per and n == 13, sorted(per))
    ok('F11b c3f6 changes nothing but the turn', E.board_after(fen, 'c3f6') == '4k3/3p4/8/8/8/2B5/3P4/4K3')
    fen = 'r7/3p4/4k3/8/8/8/3P4/2R1K3[] w - - 0 1 {c3-e6}'
    per, n = E.perft(fen, 1)
    ok('F12 the swap-the-king position: 11 moves (c4..c8 gone), c1c3 offered', 'c1c3' in per and n == 11, n)
    ok('F12 c1c3 gives check (the king is swapped next to the pawn)', E.gives_check(fen, 'c1c3'))
    per2, n2 = E.perft(fen, 1, ['c1c3'])
    ok('F12 8 evasions incl. d7e6, the pawn swapping the king back out', n2 == 8 and 'd7e6' in per2, sorted(per2))
    fen = '4k3/3p4/5b2/8/8/2n5/3P4/2R1K3[] w - - 0 1 {c3-f6}'
    per, n = E.perft(fen, 1)
    ok('F13 capture through with the far occupant swapped back: 9 moves', n == 9 and 'c1c3' in per, n)
    ok('F13 knight gone, rook on f6, bishop on c3', E.board_after(fen, 'c1c3') == '4k3/3p4/5R2/8/8/2b5/3P4/4K3')
    fen = '4k3/p6r/8/8/8/8/1P1K4/R7[] w - - 0 1 {d3-g7}'
    per, n = E.perft(fen, 1)
    ok('F14 a king may not step through onto an attacked exit (d2d3 refused: h7 sees g7) — but d2c3 is fine now, nothing runs through g7-d3: 22 moves', n == 22 and 'd2d3' not in per and 'd2c3' in per, (n, sorted(per)))
    fen = '4k2r/p7/8/8/8/8/1P1K4/R7[] w - - 0 1 {d3-g7}'
    per, n = E.perft(fen, 1)
    ok('F14b ...and may onto a safe one: 23 moves with d2d3', n == 23 and 'd2d3' in per, n)
    fen = '4k3/3p4/4P3/8/8/8/3P4/4K3[] w - - 0 1 {b3-e7}'
    per, n = E.perft(fen, 1)
    ok('F15 a pawn through a portal: 8 moves incl. e6e7', n == 8 and 'e6e7' in per, n)
    ok('F15 the pawn lands on b3', E.board_after(fen, 'e6e7') == '4k3/3p4/8/8/8/1P6/3P4/4K3')
    fen = '4k3/3p4/8/8/8/8/3P4/r3K3[OOoo] w - - 0 1'
    per, n = E.perft(fen, 1)
    ok('F16 no cast while in check: 2 evasions', n == 2 and not any(m.startswith('O@') for m in per), sorted(per))
    # ---- the plain board: no pairs, node-identical to the build before (perft 3 on the v1 gate's opening)
    fen = 'r2qk2r/pp1bppb1/2np1np1/8/3P4/2N2N2/PPQ1PPPP/R3KB1R[] w - - 0 1'
    per, n = E.perft(fen, 3)
    ok('F17 plain board perft 3 (recorded for the identity check)', n > 0, n)
    print('F17 perft3 =', n)
    # ---- B THE SHIELD: a piece beyond a portal square on a rider's line is out of its reach
    fen = '4k3/8/n7/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}'
    per, n = E.perft(fen, 1)
    ok('B1 the knight on a6 is shielded by the body at a4: a1a6 is no move, 11 moves', n == 11 and 'a1a6' not in per and 'a1a4' in per, sorted(per))
    ok('B1 a1a4 lands on h5 with the knight untouched', E.board_after(fen, 'a1a4') == '4k3/8/n7/7R/8/8/8/4K3', E.board_after(fen, 'a1a4'))
    # ---- V3 THE ONE-TURN CAST (2026-09-19): the frozen ply, the link ply, the fizzle
    fen = '4k3/3p4/8/8/8/8/3P4/4K3[OOoo] w - - 0 1'
    per, n = E.perft(fen, 1)
    ok('V3a both hold two scrolls: 46 opening casts beside the 6 piece moves', sum(m.startswith('O@') for m in per) == 46 and n == 52, (n, sorted(m for m in per if not m.startswith('O@'))))
    per, n = E.perft(fen, 1, ['O@c4'])
    ok('V3b after the half black is FROZEN: its one move is the pass e8e8', moveset(per) == {'e8e8'}, sorted(per))
    f, chk = E.display(fen, ['O@c4', 'e8e8'])
    ok('V3b the pass leaves the half standing, white to move, nobody in check', '{c4w}' in f and f.split(' ')[1] == 'w' and not chk, f)
    per, n = E.perft(fen, 1, ['O@c4', 'e8e8'])
    ok('V3c the link ply: the 45 linking casts and nothing else - no piece move, no pass while a link is legal', n == 45 and all(m.startswith('O@') for m in per) and 'O@c4' not in per, (n, sorted(m for m in per if not m.startswith('O@'))))
    f, chk = E.display(fen, ['O@c4', 'e8e8', 'O@f5'])
    ok('V3c the link makes the pair c4-f5 with black to move, unfrozen', '{c4-f5}' in f and f.split(' ')[1] == 'b' and not chk, f)
    per, n = E.perft(fen, 1, ['O@c4', 'e8e8', 'O@f5'])
    ok('V3c black then has its 6 piece moves and 44 opening casts of its own, no pass', n == 50 and 'e8e8' not in per and sum(m.startswith('O@') for m in per) == 44, n)
    ok('V3d the frozen side searches to the pass', E.bestmove(fen, 6, ['O@c4']) == 'e8e8')
    ok('V3d the caster searches to a link', E.bestmove(fen, 6, ['O@c4', 'e8e8']).startswith('O@'))
    E.set_variant('portal6')
    # the fizzle board: ONE castable square on the whole board, so after the half nothing is left to link
    # (the old fizzle board — a link that would have exposed the king through the new tunnel — links freely now: v4 has no tunnel)
    fen = '4rk/******/******/******/1*****/KN4[OO] w - - 0 1'
    per, n = E.perft(fen, 1)
    ok('V3e the fizzle board: Ka2 and the one cast, nothing else (the knight is walled in)', moveset(per) == {'a1a2', 'O@a2'}, sorted(per))
    per, n = E.perft(fen, 1, ['O@a2'])
    ok('V3e black frozen: f6f6', moveset(per) == {'f6f6'}, sorted(per))
    per, n = E.perft(fen, 1, ['O@a2', 'f6f6'])
    ok('V3e no castable square is left: the FIZZLE a1a1 is the one move', moveset(per) == {'a1a1'}, sorted(per))
    f, chk = E.display(fen, ['O@a2', 'f6f6', 'a1a1'])
    ok('V3e after the fizzle the half is gone, the other scroll kept, black to move', '{' not in f and '[O]' in f and f.split(' ')[1] == 'b', f)
    per, n = E.perft(fen, 1, ['O@a2', 'f6f6', 'a1a1'])
    ok('V3e black plays on after two passes in a row: the rook along the sixth rank', moveset(per) == {'e6a6', 'e6b6', 'e6c6', 'e6d6'}, sorted(per))
    fen = '5k/******/*r****/*1****/1*****/KN4[OO] w - - 0 1'
    per, n = E.perft(fen, 1, ['O@a2', 'f6f6'])
    ok('V3e-old the v3 fizzle board links freely now: O@b3 is the one legal move (no tunnel to expose a1)', moveset(per) == {'O@b3'}, sorted(per))
    E.set_variant('portal8')

def perft_deep(E, depth):
    """Perft at depth on every fixture position: the debug build's asserts do the checking."""
    E.set_variant('portal8')
    fens = ['4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}', '4k3/p7/8/7n/8/8/8/R3K3[] w - - 0 1 {a4-h5}',
            '8/6bk/8/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}', '7k/1p6/7B/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}',
            'r7/7k/8/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}', '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-c6,c7-f2}',
            '7k/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-e5,e6-e3}', '8/1p5k/8/8/8/8/8/R3K3[OO] w - - 0 1 {a4w}',
            'r2k4/8/8/8/7K/8/8/1R6[OO] w - - 0 1 {a5w}', 'r7/3p4/4k3/8/8/8/3P4/2R1K3[] w - - 0 1 {c3-e6}',
            'r2qk2r/pp1bppb1/2np1np1/8/3P4/2N2N2/PPQ1PPPP/R3KB1R[] w - - 0 1 {c4-f5,d5-g6}',
            '4k3/3p4/8/8/8/8/3P4/4K3[OOoo] w - - 0 1 {c3-f6}',
            '4k3/3p4/8/8/8/8/3P4/4K3[OOoo] w - - 0 1', '4k3/3p4/8/8/8/8/3P4/4K3[Ooo] b - - 0 1 {c4w}',
            'r2k4/8/8/8/7K/8/8/1R6[Oo] w - - 0 1 {a5w}', '4k3/8/n7/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}']
    for f in fens:
        t = time.time()
        per, n = E.perft(f, depth)
        print(f'  perft {depth} {n:>9}  {time.time()-t:5.1f}s  {f}')
    ok(f'perft {depth} on {len(fens)} fixtures completed (asserts on in a debug build)', True)

def random_vs_oracle(E, N, seed=7, depth2=True, sweep=False, pairs_boost=0):
    rng = random.Random(seed)
    bad = 0
    shapes = [(8, 8, 'portal8'), (6, 6, 'portal6'), (8, 8, 'portal8'), (10, 10, 'portal10')]
    t0 = time.time()
    for i in range(N):
        F, R, var = shapes[i % len(shapes)]
        pairs = 1 + (i % 3 == 2) + (i % 7 == 6) + pairs_boost
        pos = oracle.random_position(rng, F, R, pairs=pairs)
        fen = oracle.to_fen(pos)
        E.set_variant(var)
        want = {oracle.uci(m): oracle.perft(m[3], 1) for m in pos.legal_moves()}
        per, n = E.perft(fen, 1)
        if set(per) != set(want):
            bad += 1
            if bad <= 10:
                print('MISMATCH perft1', fen, 'engine-only', sorted(set(per) - set(want)), 'oracle-only', sorted(set(want) - set(per)))
            continue
        if depth2 and want:
            per2, n2 = E.perft(fen, 2)
            diff = {m: (per2.get(m), want[m]) for m in want if per2.get(m) != want[m]}
            if diff:
                bad += 1
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
                if bad <= 10:
                    print('SWEEP', fen, lines[:4])
    ok(f'oracle: {N} random positions (perft 1 move sets{", perft 2 per-move counts" if depth2 else ""}{", xsweep 2" if sweep else ""}) agree', bad == 0, f'{bad} mismatches')
    print(f'  {N} positions in {time.time()-t0:.1f}s')

if __name__ == '__main__':
    binary = sys.argv[1]
    args = sys.argv[2:]
    N = int(args[args.index('--random') + 1]) if '--random' in args else 0
    D = int(args[args.index('--depth') + 1]) if '--depth' in args else 0
    E = Engine(binary)
    if '--fixtures' in args or not (N or D or '--sweep' in args):
        fixtures(E)
    if '--sweep' in args and not N:
        E.set_variant('portal8')
        for f in ['4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}', '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-c6,c7-f2}', '7k/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-e5,e6-e3}',
                  '8/1p5k/8/8/8/8/8/R3K3[OO] w - - 0 1 {a4w}', 'r2k4/8/8/8/7K/8/8/1R6[OO] w - - 0 1 {a5w}', 'r2qk2r/pp1bppb1/2np1np1/8/3P4/2N2N2/PPQ1PPPP/R3KB1R[OOoo] w - - 0 1 {c4-f5,d5-g6}',
                  '4k3/3p4/8/8/8/8/3P4/4K3[OOoo] w - - 0 1', '4k3/3p4/8/8/8/8/3P4/4K3[Ooo] b - - 0 1 {c4w}', 'r2k4/8/8/8/7K/8/8/1R6[Oo] b - - 0 1 {a5w}']:
            sb, lines = E.sweep(f, 3)
            ok(f'xsweep 3 clean on {f}', sb == 0, lines[:5])
    if N:
        random_vs_oracle(E, N, sweep='--sweep' in args, seed=int(args[args.index('--seed') + 1]) if '--seed' in args else 7, pairs_boost=int(args[args.index('--pairs') + 1]) if '--pairs' in args else 0)
    if D:
        perft_deep(E, D)
    E.close()
    report('native')
