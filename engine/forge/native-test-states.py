#!/usr/bin/env python3
"""THE PIECE STATES (piece-states.patch) — the native gate: hand-derived
fixtures over UCI (stun, invincible, mind control, entomb; the overwrite; the
ply clock with the pass, the link and the mulligan; the returns judged on the
board a move leaves; the extinction count by owner; the field's round trip; no
card in check; the area, the ray and the king's neighbours as shapes), the
engine's own consistency sweep (xsweep, scratch build), and the independent
Python oracle (oracle.py, the rules from the rule text) on random positions
with records on the pieces — perft 1 move sets and perft 2 per-move counts.
The test variants are states.ini (terrain.ini's boards plus the piece-effect
cards 100-131).

  python3 native-test-states.py <binary> [--fixtures] [--random N] [--sweep] [--depth D] [--seed S]
"""
import subprocess, sys, re, random, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oracle
from native_test_common import Engine, ok, moveset, report

HERE = os.path.dirname(os.path.abspath(__file__))
INI = os.path.join(HERE, 'states.ini')
oracle.set_defs(open(INI).read())

def oracle_moves(fen, moves=()):
    p = oracle.from_fen(fen, handsize=4)
    for u in moves:
        p = next(m[3] for m in p.legal_moves() if oracle.uci(m) == u)
    return {oracle.uci(m) for m in p.legal_moves()}, p

def agree(E, name, fen, moves=()):
    """The engine's perft-1 set equals the oracle's after the same moves; returns the engine's set."""
    per, n = E.perft(fen, 1, moves)
    want, _ = oracle_moves(fen, moves)
    ok(f'{name}: engine = oracle on the move set ({len(want)} moves)', moveset(per) == want and n == len(want), sorted(moveset(per) ^ want))
    return per

def casts(per, L='S'):
    return sorted(m for m in per if m.startswith(L + '@'))

def field(fen):
    return fen[fen.index('{'):] if '{' in fen else ''

def fixtures(E):
    E.set_variant('states8')
    # ---- S1 STUN (100: stun3 o any): the piece cannot move, still attacks and defends, can be taken; the clock in plies
    fen = '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {S=w100}'
    per = agree(E, 'S1 a stun card', fen)
    ok('S1 the casts: both non-king pieces, either colour (S@a1, S@d6), 13 piece moves beside', casts(per) == ['S@a1', 'S@d6'] and len(per) == 15, sorted(per))
    f1, _ = E.display(fen, ['S@d6'])
    ok('S1 S@d6: the record %d6s3, the card spent, the clock not yet ticking on the cast\'s own move', f1 == '4k3/8/3r4/8/8/8/8/R3K3[] b - - 0 1 {%d6s3}', f1)
    per1 = agree(E, 'S1 black with a stunned rook', fen, ['S@d6'])
    ok('S1 the rook has no moves: five king moves', len(per1) == 5 and not any(m.startswith('d6') for m in per1), sorted(per1))
    per2 = agree(E, 'S1 white after e8d8', fen, ['S@d6', 'e8d8'])
    ok('S1 the stunned rook still attacks: e1d1 and e1d2 are not on offer, e1f1 is', 'e1d1' not in per2 and 'e1d2' not in per2 and 'e1f1' in per2, sorted(per2))
    f2, _ = E.display(fen, ['S@d6', 'e8d8'])
    ok('S1 the count dropped with black\'s move: %d6s2', field(f2) == '{%d6s2}', f2)
    f3, _ = E.display(fen, ['S@d6', 'e8d8', 'a1a2'])
    ok('S1 and with white\'s: %d6s1', field(f3) == '{%d6s1}', f3)
    f4, _ = E.display(fen, ['S@d6', 'e8d8', 'a1a2', 'd8e8'])
    ok('S1 at zero the stun ends as the move\'s last act: no record', '{' not in f4, f4)
    per4 = agree(E, 'S1 the rook free again', fen, ['S@d6', 'e8d8', 'a1a2', 'd8e8', 'a2a1'])
    ok('S1 black has its rook back: 19 moves', len(per4) == 19, len(per4))
    fen1c = '4k3/8/3r4/8/8/8/8/3RK3[] w - - 0 1 {%d6s3}'
    per1c = agree(E, 'S1 a stunned piece is capturable', fen1c)
    ok('S1 d1d6 takes it', 'd1d6' in per1c)
    f1c, _ = E.display(fen1c, ['d1d6'])
    ok('S1 the victim\'s record goes with it', '{' not in f1c, f1c)
    # ---- S2 INVINCIBLE (110: invincible5 o any): nothing captures it; it moves, attacks and gives check; the pit still kills
    fen2 = '4k3/8/3r4/8/8/8/8/3RK3[S] w - - 0 1 {S=w110}'
    per = agree(E, 'S2 an invincible card', fen2)
    ok('S2 the casts: S@d1 and S@d6', casts(per) == ['S@d1', 'S@d6'], casts(per))
    f2a, _ = E.display(fen2, ['S@d6'])
    ok('S2 S@d6: %d6i5', field(f2a) == '{%d6i5}', f2a)
    per2b = agree(E, 'S2 white facing an invincible rook', fen2, ['S@d6', 'e8f8'])
    ok('S2 d1d6 is not on offer, d1d5 is; the count read 4 after black\'s move', 'd1d6' not in per2b and 'd1d5' in per2b and field(E.display(fen2, ['S@d6', 'e8f8'])[0]) == '{%d6i4}', sorted(m for m in per2b if m.startswith('d1')))
    fen2c = '4k3/8/R3r3/8/8/8/8/4K3[] w - - 0 1 {%e6i5}'
    per2c = agree(E, 'S2 check from an invincible rook', fen2c)
    ok('S2 the checker cannot be taken: the king walks (d1 d2 f1 f2), a6e6 is not on offer', moveset(per2c) == {'e1d1', 'e1d2', 'e1f1', 'e1f2'}, sorted(per2c))
    fen2d = '4k3/3p4/8/4P3/8/8/8/4K3[] b - - 0 1 {%d7i5}'
    agree(E, 'S2 an invincible pawn double-steps', fen2d)
    f2d, _ = E.display(fen2d, ['d7d5'])
    ok('S2 the record rides the pawn: %d5i4', field(f2d) == '{%d5i4}', f2d)
    per2d = agree(E, 'S2 no en passant onto it', fen2d, ['d7d5'])
    ok('S2 e5d6 is not on offer, e5e6 is', 'e5d6' not in per2d and 'e5e6' in per2d, sorted(per2d))
    fen2e = '4k3/8/8/2p1p3/3p4/8/8/Q3K3[] w - - 0 1 {%a1i9}'
    best = E.bestmove(fen2e, 10)
    ok('S2 the search takes the defended pawn with the invincible queen (a1d4: nothing can take it back)', best == 'a1d4', best)
    best2 = E.bestmove(fen2e.replace(' {%a1i9}', ''), 10)
    ok('S2 ...and never without the invincibility', best2 != 'a1d4', best2)
    fen2f = '4k3/p7/8/8/7_/8/8/4K2R[] w - - 0 1 {~h2,~h3,%h1i5}'
    per2f = agree(E, 'S2 an invincible rook before a run of ice into a pit', fen2f)
    ok('S2 the slide h1h3 (the last empty ice before the pit) is on offer', 'h1h3' in per2f, sorted(per2f))
    f2f, _ = E.display(fen2f, ['h1h3'])
    ok('S2 the pit still kills: the rook is gone with its record', f2f.startswith('4k3/p7/8/8/7_/8/8/4K3[] b') and '%' not in f2f, f2f)
    # ---- S3 MIND CONTROL (120: control4 o any; 122: control3): the flip, the count by owner, the uses, the return judged on the move
    fen3 = '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {S=w120}'
    per = agree(E, 'S3 a control card', fen3)
    f3a, _ = E.display(fen3, ['S@d6'])
    ok('S3 S@d6: the rook is white, the record %d6c4b (it returns to black in four)', f3a == '4k3/8/3R4/8/8/8/8/R3K3[] b - - 0 1 {%d6c4b}', f3a)
    per3a = agree(E, 'S3 black, its rook stolen', fen3, ['S@d6'])
    ok('S3 black is not bare (the rook counts for its owner): three king moves', len(per3a) == 3 and moveset(per3a) == {'e8e7', 'e8f7', 'e8f8'}, sorted(per3a))
    per3b = agree(E, 'S3 white uses the stolen rook', fen3, ['S@d6', 'e8f8'])
    ok('S3 the rook moves as white\'s (d6d2 among its moves); the count read 3', 'd6d2' in per3b and field(E.display(fen3, ['S@d6', 'e8f8'])[0]) == '{%d6c3b}', sorted(per3b))
    f3c, _ = E.display(fen3, ['S@d6', 'e8f8', 'd6d2'])
    ok('S3 the record rides the rook: %d2c2b', field(f3c) == '{%d2c2b}', f3c)
    per3d = agree(E, 'S3 white to move with the return due at the end of this move', fen3, ['S@d6', 'e8f8', 'd6d2', 'f8e8'])
    ok('S3 the moves that would leave the returning rook on the king\'s line are illegal (e1d1 e1e2 e1f2 d2d1 d2e2); e1f1 and d2d8 stand', all(m not in per3d for m in ['e1d1', 'e1e2', 'e1f2', 'd2d1', 'd2e2']) and 'e1f1' in per3d and 'd2d8' in per3d and len(per3d) == 23, sorted(per3d))
    f3e, _ = E.display(fen3, ['S@d6', 'e8f8', 'd6d2', 'f8e8', 'e1f1'])
    ok('S3 after e1f1 the rook is black again, no record', f3e.startswith('4k3/8/8/8/8/8/3r4/R4K2[] b') and '{' not in f3e, f3e)
    agree(E, 'S3 black has its rook back', fen3, ['S@d6', 'e8f8', 'd6d2', 'f8e8', 'e1f1'])
    # the owner's move returns it with check (control3: the return falls on the owner's move)
    fen3f = '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {S=w122}'
    agree(E, 'S3 control3 cast', fen3f, ['S@d6', 'e8f8', 'd6e6'])
    f3f, chk = E.display(fen3f, ['S@d6', 'e8f8', 'd6e6', 'f8g8'])
    ok('S3 the rook returns on black\'s move and gives check from e6: Checkers e6, no record', chk == 'e6' and f3f.startswith('6k1/8/4r3/8/8/8/8/R3K3[] w') and '{' not in f3f, (f3f, chk))
    per3f = agree(E, 'S3 white in check from the returned rook', fen3f, ['S@d6', 'e8f8', 'd6e6', 'f8g8'])
    ok('S3 the four king moves are the evasions', moveset(per3f) == {'e1d1', 'e1d2', 'e1f1', 'e1f2'}, sorted(per3f))
    # a controlled pawn marches the caster's way, promotes, and returns as what it has become
    fen3g = '4k3/8/8/3p4/8/8/P7/4K3[S] w - - 0 1 {S=w120}'
    per3g = agree(E, 'S3 control on a black pawn', fen3g)
    ok('S3 S@d5 on offer', 'S@d5' in per3g)
    per3h = agree(E, 'S3 the stolen pawn pushes white\'s way', fen3g, ['S@d5', 'e8f8'])
    ok('S3 d5d6 and the double step d5d7 (the camp runs to rank 7): nine moves', 'd5d6' in per3h and 'd5d7' in per3h and len(per3h) == 9, sorted(per3h))
    f3h, chk3h = E.display(fen3g, ['S@d5', 'e8f8', 'd5d7', 'f8g8', 'd7d8q'])
    ok('S3 the promotion then the return: a black queen on d8, no record, no check', f3h.startswith('3q2k1/8/8/8/8/8/P7/4K3[] b') and '{' not in f3h and chk3h == '', (f3h, chk3h))
    agree(E, 'S3 after the returned queen', fen3g, ['S@d5', 'e8f8', 'd5d7', 'f8g8', 'd7d8q'])
    # the recall: control cast on your own stolen piece brings it home, no record
    fen3i = '4k3/p7/8/8/8/8/4K3/r7[S] w - - 0 1 {%a1c3w,S=w120}'
    per3i = agree(E, 'S3 a white rook held by black, white holding a control card', fen3i)
    ok('S3 the recall S@a1 is on offer (white is not bare: the rook counts for it)', 'S@a1' in per3i, sorted(per3i))
    f3i, _ = E.display(fen3i, ['S@a1'])
    ok('S3 recalled: a white rook on a1, no record', f3i.startswith('4k3/p7/8/8/8/8/4K3/R7[] b') and '{' not in f3i, f3i)
    # the owner captures its own stolen piece and bares itself: the game is over
    fen3j = '4k3/3R4/8/8/8/8/8/R3K3[] b - - 0 1 {%d7c4b}'
    per3j = agree(E, 'S3 black may take its stolen rook', fen3j)
    ok('S3 e8d7 on offer', 'e8d7' in per3j)
    per3k, n3k = E.perft(fen3j, 1, ['e8d7'])
    ok('S3 ...and is bare after it: no moves, the game decided', n3k == 0, n3k)
    # ---- S4 ENTOMB (130: entomb o any): inert, uncapturable, a wall to lines and to the slide; freed by a hit
    fen4 = '4k3/8/3r4/8/8/8/8/3RK3[S] w - - 0 1 {S=w130}'
    per = agree(E, 'S4 an entomb card', fen4)
    ok('S4 the casts: S@d1 and S@d6', casts(per) == ['S@d1', 'S@d6'], casts(per))
    f4a, _ = E.display(fen4, ['S@d6'])
    ok('S4 S@d6: %d6e, no count', field(f4a) == '{%d6e}', f4a)
    per4a = agree(E, 'S4 black with an entombed rook', fen4, ['S@d6'])
    ok('S4 five king moves, the rook has none', len(per4a) == 5, sorted(per4a))
    per4b = agree(E, 'S4 white beside an entombed rook', fen4, ['S@d6', 'e8f8'])
    ok('S4 it attacks nothing (e1d2 on offer), nothing takes it (d1d6 not), its square ends the file (d1d7 not): 11 moves', 'e1d2' in per4b and 'd1d6' not in per4b and 'd1d7' not in per4b and len(per4b) == 11, sorted(per4b))
    f4b, _ = E.display(fen4, ['S@d6', 'e8f8', 'e1d2', 'f8e8', 'd2e1'])
    ok('S4 the block has no clock: the record stands after four plies', field(f4b) == '{%d6e}', f4b)
    fen4c = '4k3/8/3r4/8/8/8/8/3RK3[S] w - - 0 1 {%d6e,S=w43}'
    per4c = agree(E, 'S4 a hit frees it (43: hit1 3x3 any)', fen4c)
    ok('S4 the nine anchors whose 3x3 covers d6', len(casts(per4c)) == 9 and all(m[2] in 'cde' and m[3] in '567' for m in casts(per4c)), casts(per4c))
    f4c, _ = E.display(fen4c, ['S@d6'])
    ok('S4 freed: a black rook on d6, no record', f4c.startswith('4k3/8/3r4/8/8/8/8/3RK3[] b') and '{' not in f4c, f4c)
    fen4d = '4k3/8/8/8/8/8/8/3rK3[S] w - - 0 1 {%d1e,S=w43}'
    per4d = agree(E, 'S4 freeing a piece onto your own king is illegal', fen4d)
    ok('S4 no cast at all (every anchor covering d1 would free the rook onto e1)', not casts(per4d), casts(per4d))
    fen4e = '4k3/p3R3/8/8/8/8/8/4K3[S] w - - 0 1 {%e7e,S=w43}'
    ok('S4 freeing your own rook onto the enemy king gives check', E.gives_check(fen4e, 'S@e6'))
    per4e = agree(E, 'S4 black in check from the freed rook', fen4e, ['S@e6'])
    ok('S4 the freed rook is capturable again: e8e7 among the evasions, with d8 and f8', moveset(per4e) == {'e8e7', 'e8d8', 'e8f8'}, sorted(per4e))
    fen4f = '3rk3/8/3n4/8/8/8/8/3RK3[] w - - 0 1 {%d6e}'
    per4f = agree(E, 'S4 a wall to the line', fen4f)
    ok('S4 the white rook\'s file ends at the block: no d1d6, no d1d8', 'd1d6' not in per4f and 'd1d8' not in per4f and 'd1d5' in per4f, sorted(m for m in per4f if m.startswith('d1')))
    fen4g = '4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {~a2,~a3,~a4,%a5e}'
    per4g = agree(E, 'S4 a wall to the slide', fen4g)
    ok('S4 the rook\'s slide is listed at a4 (the last empty ice before the block), never a1a5', 'a1a4' in per4g and 'a1a5' not in per4g and 'a1a2' not in per4g, sorted(m for m in per4g if m.startswith('a1')))
    f4g, _ = E.display(fen4g, ['a1a4'])
    ok('S4 the rook rests on a4 before the entombed knight', f4g.startswith('4k3/p7/8/n7/R7/8/8/4K3[] b'), f4g)
    fen4h = '6k1/7n/8/8/8/8/8/2R1K3[] w - - 0 1 {c3-h7,%h7e}'
    per4h = agree(E, 'S4 a landing never swaps with an entombed twin', fen4h)
    ok('S4 c1c3 is not on offer (its twin holds the block); c1c2 is, and the line still ends at the body (no c1c4)', 'c1c3' not in per4h and 'c1c2' in per4h and 'c1c4' not in per4h, sorted(m for m in per4h if m.startswith('c1')))
    # ---- S5 OVERWRITE: one state per piece; a controlled piece first returns to its owner
    fen5 = '4k3/8/3R4/8/8/8/8/R3K3[s] b - - 0 1 {%d6c4b,S=b100}'
    per5 = agree(E, 'S5 the owner stuns its stolen rook', fen5)
    ok('S5 the casts: S@d6 (the stolen rook) and S@a1 (white\'s)', casts(per5) == ['S@a1', 'S@d6'], casts(per5))
    f5a, _ = E.display(fen5, ['S@d6'])
    ok('S5 the control ends: a black rook on d6, stunned for three', f5a == '4k3/8/3r4/8/8/8/8/R3K3[] w - - 0 2 {%d6s3}', f5a)
    f5b, _ = E.display(fen5.replace('S=b100', 'S=b110'), ['S@d6'])
    ok('S5 the owner\'s invincibility as counterplay: it comes home and cannot be taken', f5b == '4k3/8/3r4/8/8/8/8/R3K3[] w - - 0 2 {%d6i5}', f5b)
    fen5c = '4k3/8/3R4/8/8/8/8/R3K3[S] w - - 0 1 {%d6c4b,S=w130}'
    agree(E, 'S5 the thief entombs the piece it holds', fen5c)
    f5c, _ = E.display(fen5c, ['S@d6'])
    ok('S5 it goes back to its owner as a block', f5c == '4k3/8/3r4/8/8/8/8/R3K3[] b - - 0 1 {%d6e}', f5c)
    fen5d = '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {%d6s1,S=w100}'
    agree(E, 'S5 a recast refreshes', fen5d)
    f5d, _ = E.display(fen5d, ['S@d6'])
    ok('S5 the count is three again', field(f5d) == '{%d6s3}', f5d)
    per5e = agree(E, 'S5 a recast that changes nothing is no move', fen5d.replace('%d6s1', '%d6s3'))
    ok('S5 S@d6 is not on offer, S@a1 is', casts(per5e) == ['S@a1'], casts(per5e))
    fen5f = '4k3/8/4R3/8/8/8/8/4K3[S] w - - 0 1 {%e6c4b,S=w100}'
    per5f = agree(E, 'S5 a return onto your own king is illegal', fen5f)
    ok('S5 stunning the stolen rook on e6 would return it onto e1: no cast', not casts(per5f), sorted(per5f))
    fen5g = '4k3/p7/4r3/8/8/8/8/3K4[S] w - - 0 1 {%e6c4w,S=w100}'
    agree(E, 'S5 a return that gives check', fen5g)
    ok('S5 stunning the rook black holds returns it to white on e6: check', E.gives_check(fen5g, 'S@e6'))
    per5g = agree(E, 'S5 black in check from the returned rook', fen5g, ['S@e6'])
    ok('S5 four king moves are the evasions (the stunned rook is not adjacent)', moveset(per5g) == {'e8d8', 'e8f8', 'e8d7', 'e8f7'}, sorted(per5g))
    fen5h = '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {%d6s3,S=w120}'
    agree(E, 'S5 control overwrites a stun', fen5h)
    f5h, _ = E.display(fen5h, ['S@d6'])
    ok('S5 the rook is white\'s and free to move', field(f5h) == '{%d6c4b}', f5h)
    per5h = agree(E, 'S5 white moves the un-stunned rook', fen5h, ['S@d6', 'e8f8'])
    ok('S5 d6d2 on offer', 'd6d2' in per5h)
    # ---- S6 THE CLOCK: the half ticks, the pass and the link do not; the mulligan ticks
    fen6 = '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {%d6s2,S=w10}'
    agree(E, 'S6 a portal card beside a stun with two left', fen6)
    f6a, _ = E.display(fen6, ['S@b3'])
    ok('S6 the half ticks: %d6s1', '%d6s1' in f6a and 'b3w' in f6a, f6a)
    agree(E, 'S6 the frozen side', fen6, ['S@b3'])
    f6b, _ = E.display(fen6, ['S@b3', 'e8e8'])
    ok('S6 the forced pass ticks nothing: still %d6s1', '%d6s1' in f6b, f6b)
    agree(E, 'S6 the link ply', fen6, ['S@b3', 'e8e8'])
    f6c, _ = E.display(fen6, ['S@b3', 'e8e8', 'S@g3'])
    ok('S6 the link ticks nothing: still %d6s1, the pair stands', '%d6s1' in f6c and 'b3-g3' in f6c, f6c)
    f6d, _ = E.display(fen6, ['S@b3', 'e8e8', 'S@g3', 'e8f8'])
    ok('S6 black\'s move ticks it out', '%' not in f6d, f6d)
    agree(E, 'S6 after the clock', fen6, ['S@b3', 'e8e8', 'S@g3', 'e8f8'])
    fen6e = '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {w|101,%d6s2,S=w100}'
    per6e = agree(E, 'S6 the mulligan on offer', fen6e)
    ok('S6 @@@@ among the moves', '@@@@' in per6e)
    f6e, _ = E.display(fen6e, ['@@@@'])
    ok('S6 the mulligan ticks: %d6s1, the hand redrawn (101)', '%d6s1' in f6e and 'S=w101' in f6e, f6e)
    # ---- S7 THE FIELD ROUND-TRIPS, in square order after the flags
    fen7 = '4k3/p7/3r4/8/8/8/8/R2RK3[] w - - 0 1 {%a1i5,%d1e,%d6c4w}'
    f7, _ = E.display(fen7)
    ok('S7 the field echoes', f7 == fen7, f7)
    agree(E, 'S7 the three records', fen7)
    f7b, _ = E.display('4k3/p7/3r4/8/8/8/8/R2RK3[] w - - 0 1 {%d6c4b,%e8s3,%a1s0,%d1i20}')
    ok('S7 a record that cannot stand is dropped (an owner of the piece\'s own colour, a king, a zero stun, a count over 15)', '{' not in f7b, f7b)
    # ---- S8 NO CARD IN CHECK
    fen8 = '4k3/8/8/8/8/8/P7/r3K3[STU] w - - 0 1 {S=w100,T=w120,U=w130}'
    per8 = agree(E, 'S8 in check', fen8)
    ok('S8 the king moves alone: the three evasions, no cast of any kind', moveset(per8) == {'e1d2', 'e1e2', 'e1f2'}, sorted(per8))
    # ---- S12 AN AREA STUN (101: stun3 3x3 any), S13 A RAY (104), S14 THE KING'S NEIGHBOURS (105)
    fen12 = '4k3/8/2nr4/2pq4/8/8/8/R3K3[S] w - - 0 1 {S=w101}'
    agree(E, 'S12 an area stun', fen12)
    f12, _ = E.display(fen12, ['S@c5'])
    ok('S12 S@c5 stuns all four black pieces', field(f12) == '{%c5s3,%d5s3,%c6s3,%d6s3}', f12)
    per12 = agree(E, 'S12 black after the area stun', fen12, ['S@c5'])
    ok('S12 five king moves and nothing else', len(per12) == 5, sorted(per12))
    fen13 = '4k3/8/8/8/4r3/8/P3n3/4K3[S] w - - 0 1 {S=w104}'
    per13 = agree(E, 'S13 a stun on a ray', fen13)
    ok('S13 the one ray with pieces on it: S@e2', casts(per13) == ['S@e2'], casts(per13))
    f13, _ = E.display(fen13, ['S@e2'])
    ok('S13 the knight and the rook on the ray are stunned, the king never', field(f13) == '{%e2s3,%e4s3}', f13)
    fen14 = '4k3/8/8/8/8/8/P2rb3/4K3[S] w - - 0 1 {S=w105}'
    per14 = agree(E, 'S14 the king\'s neighbours', fen14)
    ok('S14 S@e1, e1f2, e1xd2 and the pawn\'s two: five moves', moveset(per14) == {'S@e1', 'e1f2', 'e1d2', 'a2a3', 'a2a4'}, sorted(per14))
    f14, _ = E.display(fen14, ['S@e1'])
    ok('S14 both neighbours stunned for four', field(f14) == '{%d2s4,%e2s4}', f14)
    # ---- S15 THE HAMMER UNDER A RETURN: in check from a stolen piece that returns with this move, the hammer stands
    fen15 = '4k3/p7/8/8/8/8/2n*4/4K3[] w - - 0 1 {*w,%c2c1w}'
    per15 = agree(E, 'S15 white in check from its own knight, held by black until the end of this move', fen15)
    ok('S15 the hammer e1d2 and the four king steps: the return resolves the check', moveset(per15) == {'e1d2', 'e1d1', 'e1f1', 'e1e2', 'e1f2'}, sorted(per15))
    f15, chk15 = E.display(fen15, ['e1d2'])
    ok('S15 after the hammer: a crate on d2, the knight white again, no record (the sledge flag alone), no check', f15.startswith('4k3/p7/8/8/8/8/2N^4/4K3[] b') and field(f15) == '{*w}' and chk15 == '', (f15, chk15))
    fen15b = '4k3/p7/8/8/8/8/2n*4/4K3[] w - - 0 1 {*w,%c2c2w}'
    per15b = agree(E, 'S15 the same check with the return a ply later', fen15b)
    ok('S15 a plain check: the four king steps, no hammer', moveset(per15b) == {'e1d1', 'e1f1', 'e1e2', 'e1f2'}, sorted(per15b))
    fen15c = '4r1k1/p7/8/8/8/8/2n*4/4K3[] w - - 0 1 {*w,%c2c1w}'
    per15c = agree(E, 'S15 a second checker the return does not answer', fen15c)
    ok('S15 the rook on e8 still checks: three king steps off the file, no hammer', moveset(per15c) == {'e1d1', 'e1f1', 'e1f2'}, sorted(per15c))
    # ---- S9 THE 10x10 DUEL SHAPE with state decks: the oracle agrees at perft 2, a search lives
    E.set_variant('states10')
    fen9 = 'r1bqkbn3/pppppp4/10/2*3*3/10/3^2^3/10/10/PPPPPP4/RNBQKB4[STUVstuv] w - - 0 1 {w|100.120.130.110,S=w101,T=w120,U=w130,V=w110,b|100.122,S=b100,T=b121,U=b131,V=b112}'
    agree(E, 'S9 the duel shape', fen9)
    per9, n9 = E.perft(fen9, 2)
    want9 = oracle.perft(oracle.from_fen(fen9, handsize=4), 2)
    ok(f'S9 perft 2 = {want9} (the oracle\'s)', n9 == want9, (n9, want9))
    ok('S9 a depth-8 search completes', E.bestmove(fen9, 8) != '(none)')
    E.set_variant('states8')

def perft_deep(E, depth):
    E.set_variant('states8')
    fens = ['4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {S=w100}', '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {S=w120}',
            '4k3/p7/3r4/8/8/8/8/R2RK3[] w - - 0 1 {%a1i5,%d1e,%d6c4w}', '4k3/8/3R4/8/8/8/8/R3K3[s] b - - 0 1 {%d6c4b,S=b100}',
            '4k3/8/2nr4/2pq4/8/8/8/R3K3[S] w - - 0 1 {S=w101}', '4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {~a2,~a3,~a4,%a5e}',
            'rnbqkbnr/pppppppp/8/2*^4/8/8/PPPPPPPP/RNBQKBNR[STst] w - - 0 1 {w|100.120,S=w130,T=w110,S=b101,T=b122,b|43.80,%e2c2b,%d7s1}']
    for f in fens:
        t = time.time()
        per, n = E.perft(f, depth)
        print(f'  perft {depth} {n:>9}  {time.time()-t:5.1f}s  {f}')
    ok(f'perft {depth} on {len(fens)} piece-state fixtures completed (asserts on in a debug build)', True)

def random_vs_oracle(E, N, seed=7, depth2=True, sweep=False):
    rng = random.Random(seed)
    bad = 0
    kinds = {'perft1': 0, 'perft2': 0, 'sweep': 0}
    shapes = [(8, 8, 'states8'), (6, 6, 'states6'), (8, 8, 'states8'), (10, 10, 'states10')]
    t0 = time.time()
    for i in range(N):
        F, R, var = shapes[i % len(shapes)]
        pairs = (i % 3 == 2) + (i % 7 == 6)
        pos = oracle.random_position(rng, F, R, pairs=pairs, ice='mixed' if i % 2 else None, terrain=(1, 6), deck=True, states=True)
        fen = oracle.to_fen(pos)
        E.set_variant(var)
        want = {oracle.uci(m): oracle.perft(m[3], 1) for m in pos.legal_moves()}
        try:
            per, n = E.perft(fen, 1)
        except RuntimeError as e:
            print('ENGINE DIED on', fen); print(str(e)[-400:]); raise
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
    ok(f'oracle: {N} random piece-state positions (perft 1 move sets{", perft 2 per-move counts" if depth2 else ""}{", xsweep 2" if sweep else ""}) agree', bad == 0, f'{bad} mismatches {kinds}')
    print(f'  {N} positions in {time.time()-t0:.1f}s')

if __name__ == '__main__':
    binary = sys.argv[1]
    args = sys.argv[2:]
    N = int(args[args.index('--random') + 1]) if '--random' in args else 0
    D = int(args[args.index('--depth') + 1]) if '--depth' in args else 0
    E = Engine(binary, ini=INI, variant='states8')
    if '--fixtures' in args or not (N or D or '--sweep' in args):
        fixtures(E)
    if '--sweep' in args and not N:
        E.set_variant('states8')
        for f in ['4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {S=w100}', '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {S=w120}',
                  '4k3/p7/3r4/8/8/8/8/R2RK3[] w - - 0 1 {%a1i5,%d1e,%d6c4w}', '4k3/8/3R4/8/8/8/8/R3K3[s] b - - 0 1 {%d6c4b,S=b100}',
                  '4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {~a2,~a3,~a4,%a5e}',
                  'rnbqkbnr/pppppppp/8/2*^4/8/8/PPPPPPPP/RNBQKBNR[STst] w - - 0 1 {w|100.120,S=w130,T=w110,S=b101,T=b122,b|43.80,%e2c2b,%d7s1}']:
            sb, lines = E.sweep(f, 3)
            ok(f'xsweep 3 clean on {f}', sb == 0, lines[:5])
    if N:
        random_vs_oracle(E, N, sweep='--sweep' in args, seed=int(args[args.index('--seed') + 1]) if '--seed' in args else 7)
    if D:
        perft_deep(E, D)
    E.close()
    report('native (piece states)')
