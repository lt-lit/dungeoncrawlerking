#!/usr/bin/env python3
"""THE TERRAIN INTERPRETER (terrain.patch) — the native gate: hand-derived
fixtures over UCI (every effect and every targeting word, the null rule, check
by demolition, immurement, the lance, the sledge enchantment, the drop, ice
anywhere, the shape clipped at the edge), the engine's own consistency sweep
(xsweep, scratch build), and the independent Python oracle (oracle.py, the
rules from the rule text) on random positions with hands, piles, terrain of
every kind, ice, pairs and enchantments — perft 1 move sets and perft 2
per-move counts. The test variants are terrain.ini (hand 4, slots s..z,
hammerPieceTypes = k, a library of 26 defs: 1-4 ice, 10 portal, 20 win, 30
meta, 40-46 hits, 50-53 walls, 60-61 pits, 70-71 harden, 80 sledge, 90-91
drops).

  python3 native-test-terrain.py <binary> [--fixtures] [--random N] [--sweep] [--depth D] [--seed S]
"""
import subprocess, sys, re, random, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oracle
from native_test_common import Engine, ok, moveset, report

HERE = os.path.dirname(os.path.abspath(__file__))
INI = os.path.join(HERE, 'terrain.ini')
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

def fixtures(E):
    E.set_variant('terrain8')
    # ---- T1 THE CRACK (40: hit1 o near): the wall beside the king cracks into a crate; black draws
    fen = '4k3/p7/8/8/8/8/3*4/R3K3[Ss] w - - 0 1 {w|20.30,b|41,S=w40,S=b45}'
    per = agree(E, 'T1 the crack on offer', fen)
    ok('T1 one cast, S@d2 (the wall beside the king), with the mulligan and 13 piece moves', casts(per) == ['S@d2'] and '@@@@' in per and len(per) == 15, sorted(per))
    f1, _ = E.display(fen, ['S@d2'])
    ok('T1 S@d2: d2 is a crate, the card spent, black drew 41 into t', f1 == '4k3/p7/8/8/8/8/3^4/R3K3[st] b - - 0 1 {w|20.30,S=b45,T=b41}', f1)
    per1 = agree(E, 'T1 black after the crack (a lance and a smash in hand, nothing to hit)', fen, ['S@d2'])
    ok('T1 black casts nothing: no wall on any ray from e8, none beside its pieces', not casts(per1, 'S') and not casts(per1, 'T'), sorted(per1))
    ok('T1 the crack gives no check', not E.gives_check(fen, 'S@d2'))
    # ---- T2 THE SMASH (41: hit2 o near): the wall is floor at once; a crate too
    fen2 = '4k3/p7/8/8/8/8/3*^3/R3K3[SS] w - - 0 1 {S=w41}'
    per2 = agree(E, 'T2 two smashes in hand', fen2)
    ok('T2 the casts: d2 (a wall) and e2 (a crate), both beside the king', casts(per2) == ['S@d2', 'S@e2'], casts(per2))
    f2, _ = E.display(fen2, ['S@d2'])
    ok('T2 S@d2: floor at once, one smash left', f2 == '4k3/p7/8/8/8/8/4^3/R3K3[S] b - - 0 1 {S=w41}', f2)
    f2b, _ = E.display(fen2, ['S@d2', 'e8d8', 'S@e2'])
    ok('T2 S@e2 next: the crate is floor', f2b.startswith('3k4/p7/8/8/8/8/8/R3K3[] b'), f2b)
    # ---- T3 THE NULL RULE: a crack with nothing to crack is no move; a hit anchored anywhere needs a wall or a crate in its shape
    fen3 = '4k3/p7/8/8/8/8/8/R3K3[ST] w - - 0 1 {S=w40,T=w43}'
    per3 = agree(E, 'T3 nothing to hit', fen3)
    ok('T3 no cast of either card', not casts(per3, 'S') and not casts(per3, 'T'), sorted(per3))
    # ---- T4 CHECK BY DEMOLITION: a hit that floors the crate between the rook and the enemy king gives check...
    fen4 = 'k7/7p/8/8/^7/8/8/R3K3[S] w - - 0 1 {S=w43}'  # black keeps a pawn: a bare king is decided at load (rule 4b)
    per4 = agree(E, 'T4 the demolition (43: hit1 3x3 any)', fen4)
    ok('T4 six anchors cover the crate on a4: a3 a4 a5 b3 b4 b5', casts(per4) == ['S@a3', 'S@a4', 'S@a5', 'S@b3', 'S@b4', 'S@b5'], casts(per4))
    ok('T4 flooring a4 opens the a-file: the cast gives check', all(E.gives_check(fen4, m) for m in casts(per4)))
    f4, chk = E.display(fen4, ['S@a4'])
    ok('T4 after S@a4 the crate is gone and black is in check from a1', f4.startswith('k7/7p/8/8/8/8/8/R3K3[] b') and chk == 'a1', (f4, chk))
    per4b = agree(E, 'T4 black in check after the demolition', fen4, ['S@a4'])
    ok('T4 black has the evasions alone (b7, b8)', moveset(per4b) == {'a8b7', 'a8b8'}, sorted(per4b))
    # ...and one that opens a line onto the caster's own king is illegal
    fen4c = 'r6k/8/8/8/^7/8/1P6/K7[S] w - - 0 1 {S=w43}'  # the king and the pawn still move; every hit would expose the king
    per4c = agree(E, 'T4 the self-exposing demolition', fen4c)
    ok('T4 every hit covering a4 would expose the king: no cast at all, four plain moves', not casts(per4c) and len(per4c) == 4, sorted(per4c))
    # ---- T5 THE LANCE (45: hit1 o ray): from the king's neighbour on, through pieces and over pits, to bedrock or the edge
    fen5 = '7k/p3#3/4^3/4*3/8/4*1*1/5_2/4K2R[S] w - - 0 1 {S=w45}'
    per5 = agree(E, 'T5 the lance', fen5)
    ok('T5 two rays change something: north (e2 the anchor) and north-east (f2, a pit passed over)', casts(per5) == ['S@e2', 'S@f2'], casts(per5))
    f5, _ = E.display(fen5, ['S@e2'])
    ok('T5 north: e3 and e5 crack, the crate on e6 is floor, the bedrock on e7 stops the ray', f5.startswith('7k/p3#3/8/4^3/8/4^1*1/5_2/4K2R[] b'), f5)
    f5b, _ = E.display(fen5, ['S@f2'])
    ok('T5 north-east over the pit: g3 cracks', f5b.startswith('7k/p3#3/4^3/4*3/8/4*1^1/5_2/4K2R[] b'), f5b)
    fen5c = '7k/p3#3/4^3/4*3/8/4*1*1/5_2/4K2R[S] w - - 0 1 {S=w46}'
    per5c = agree(E, 'T5 the short lance (46: ray2)', fen5c)
    ok('T5 ray2 reaches e3 (north) and g3 (north-east) and no farther', casts(per5c) == ['S@e2', 'S@f2'], casts(per5c))
    f5c, _ = E.display(fen5c, ['S@e2'])
    ok('T5 ray2 north: e3 cracks, e5 and e6 untouched', f5c.startswith('7k/p3#3/4^3/4*3/8/4^1*1/5_2/4K2R[] b'), f5c)
    # ---- T6 THE WALL (51: wall xox any) and IMMUREMENT: the enemy king's last flight square walled, stalemate is a loss
    fen6 = 'k*6/1*6/8/8/8/7p/7P/4K3[S] w - - 0 1 {S=w51}'  # the king's pocket: b8 and b7 walled, a7 open; black's pawn blocked
    per6 = agree(E, 'T6 a wall card', fen6)
    ok('T6 S@a7 among the casts (a7 rises; b7 is a wall already)', 'S@a7' in per6)
    f6, _ = E.display(fen6, ['S@a7'])
    ok('T6 after S@a7 the pocket is sealed', f6.startswith('k*6/**6/8/8/8/7p/7P/4K3[] b'), f6)
    per6b, n6b = E.perft(fen6, 1, ['S@a7'])
    ok('T6 black has no legal move: immured, and stalemate is a loss', n6b == 0, n6b)
    ok('T6 the search finds the immurement: mate in 1', ' score mate 1 ' in E.bestmove_info(fen6, 6), E.bestmove_info(fen6, 6))
    fen6c = '4k3/p7/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w50}'
    per6c = agree(E, 'T6 wall x/o/x near', fen6c)
    ok('T6 near: anchors within a king step of a1 or e1 only', all(m[2] in 'abdef' and m[3] in '12' for m in casts(per6c)), casts(per6c))
    f6c, _ = E.display(fen6c, ['S@d2'])
    ok('T6 S@d2 raises d2 and d3 (d1 is empty floor too)', f6c.startswith('4k3/p7/8/8/8/3*4/3*4/R2*K3[] b'), f6c)
    # ---- T7 THE PIT (60: pit ox near): empty floor sinks; the king cannot enter it
    fen7 = '4k3/p7/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w60}'
    per7 = agree(E, 'T7 a sink card', fen7)
    f7, _ = E.display(fen7, ['S@f2'])
    ok('T7 S@f2 sinks f2 and g2', f7.startswith('4k3/p7/8/8/8/8/5__1/R3K3[] b'), f7)
    per7b = agree(E, 'T7 black after the sink', fen7, ['S@f2'])
    per7c = agree(E, 'T7 white again', fen7, ['S@f2', 'e8d8'])
    ok('T7 the king does not step into the pit', 'e1f2' not in per7c and 'e1f1' in per7c, sorted(m for m in per7c if m.startswith('e1')))
    # ---- T8 HARDEN (71: harden o any): an intact wall becomes bedrock, immune to hits
    fen8 = '4k3/p7/8/8/8/8/3*4/R3K3[ST] w - - 0 1 {S=w71,T=w41}'
    per8 = agree(E, 'T8 petrify + smash in hand', fen8)
    ok('T8 the petrify casts on d2 alone; the smash too', casts(per8, 'S') == ['S@d2'] and casts(per8, 'T') == ['T@d2'], (casts(per8, 'S'), casts(per8, 'T')))
    f8, _ = E.display(fen8, ['S@d2'])
    ok('T8 S@d2: d2 is bedrock', f8.startswith('4k3/p7/8/8/8/8/3#4/R3K3[T] b'), f8)
    per8b = agree(E, 'T8 the smash against bedrock', fen8, ['S@d2', 'e8d8'])
    ok('T8 nothing to smash any more', not casts(per8b, 'T'), casts(per8b, 'T'))
    # ---- T9 THE SLEDGE (80: sledge o king): no hammer until the enchantment, then the king cracks; black never
    fen9 = '4k3/p7/8/8/8/8/3*4/R3K3[S] w - - 0 1 {S=w80}'
    per9 = agree(E, 'T9 a sledge card, the hammer off', fen9)
    ok('T9 no hammer yet (the sledge card gates it); the cast is on the king', 'e1d2' not in per9 and casts(per9) == ['S@e1'], sorted(per9))
    f9, _ = E.display(fen9, ['S@e1'])
    ok('T9 S@e1: the flag *w in the field, the card spent', f9 == '4k3/p7/8/8/8/8/3*4/R3K3[] b - - 0 1 {*w}', f9)
    per9b = agree(E, 'T9 black has no hammer', fen9, ['S@e1'])
    per9c = agree(E, 'T9 white hammers now', fen9, ['S@e1', 'e8d8'])
    ok('T9 the hammer e1d2 is on offer', 'e1d2' in per9c, sorted(per9c))
    f9c, _ = E.display(fen9, ['S@e1', 'e8d8', 'e1d2'])
    ok('T9 after the hammer d2 is a crate and the flag stays', f9c == '3k4/p7/8/8/8/8/3^4/R3K3[] b - - 0 2 {*w}', f9c)
    fen9d = '4k3/p2*4/8/8/8/8/3*4/R3K3[] w - - 0 1 {*b}'
    per9d = agree(E, 'T9 black enchanted, white not', fen9d)
    ok('T9 white has no hammer under *b', 'e1d2' not in per9d)
    per9e = agree(E, 'T9 black hammers under *b', fen9d, ['e1f1'])
    ok('T9 the hammer e8d7 is on offer to black', 'e8d7' in per9e, sorted(per9e))
    # ---- T10 THE DROP (90: drop p o camp; 91: drop n o near): a real piece placed, in the camp, never on a king row
    fen10 = '4k3/p7/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w90}'
    per10 = agree(E, 'T10 a reinforcement', fen10)
    ok('T10 47 drops: every empty square of ranks 2-7', len(casts(per10)) == 47 and all(m[3] in '234567' for m in casts(per10)), len(casts(per10)))
    f10, _ = E.display(fen10, ['S@e2'])
    ok('T10 S@e2: a pawn stands on e2, the card spent, black drew nothing (its pile empty)', f10 == '4k3/p7/8/8/8/8/4P3/R3K3[] b - - 0 1', f10)
    fen10b = '7p/8/8/4k3/8/8/8/R3K3[S] w - - 0 1 {S=w90}'
    ok('T10 a pawn dropped on d4 or f4 gives check to the king on e5', E.gives_check(fen10b, 'S@d4') and E.gives_check(fen10b, 'S@f4') and not E.gives_check(fen10b, 'S@e4'))
    agree(E, 'T10 black in check after the drop', fen10b, ['S@d4'])
    fen10c = '4k3/p7/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w91}'
    per10c = agree(E, 'T10 a knight near', fen10c)
    ok('T10 the knight lands within a king step of a1 or e1: eight empty squares', all(m[2] in 'abdef' and m[3] in '12' for m in casts(per10c)) and len(casts(per10c)) == 8, casts(per10c))
    f10c, _ = E.display(fen10c, ['S@d1'])
    ok('T10 S@d1: a knight on d1', f10c.startswith('4k3/p7/8/8/8/8/8/R2NK3[] b'), f10c)
    # ---- T11 ICE ANYWHERE (2), on the middle rows (3), with a margin (4), and the legacy word (1)
    fen11 = '4k3/p7/8/8/8/8/8/R3K3[STUV] w - - 0 1 {S=w2,T=w3,U=w4,V=w1}'
    per11 = agree(E, 'T11 four ice cards', fen11)
    ok('T11 ice anywhere: 64 anchors, the king rows included', len(casts(per11, 'S')) == 64, len(casts(per11, 'S')))
    ok('T11 ice xox middle: 16 anchors on ranks 4 and 5', len(casts(per11, 'T')) == 16 and all(m[3] in '45' for m in casts(per11, 'T')), len(casts(per11, 'T')))
    ok('T11 ice x/o/x margin1: anchors on ranks 3-6 alone (a cell on a king row is out)', all(m[3] in '3456' for m in casts(per11, 'U')) and len(casts(per11, 'U')) == 32, (len(casts(per11, 'U')), casts(per11, 'U')[:4]))
    ok('T11 the legacy word: the 3x3 on the middle rows, 16 anchors', len(casts(per11, 'V')) == 16 and all(m[3] in '45' for m in casts(per11, 'V')), len(casts(per11, 'V')))
    f11, _ = E.display(fen11, ['S@a1'])
    ok('T11 S@a1 ices the corner: a2, b1, b2 and a1 under the rook', f11.endswith('{~a1,~b1,~a2,~b2,T=w3,U=w4,V=w1}'), f11)
    f11b, _ = E.display(fen11, ['S@e8'])
    ok('T11 S@e8 ices the enemy king row under him', f11b.endswith('{~d7,~e7,~f7,~d8,~e8,~f8,T=w3,U=w4,V=w1}'), f11b)
    # ---- T12 ICE UNDER A RAISED WALL IS CLEARED
    fen12 = '4k3/p7/8/8/8/8/8/R3K3[S] w - - 0 1 {~e4,~f4,S=w51}'
    f12, _ = E.display(fen12, ['S@e4'])
    ok('T12 the wall on d4 e4 f4 clears the ice under it', f12 == '4k3/p7/8/8/3***2/8/8/R3K3[] b - - 0 1', f12)
    agree(E, 'T12 after the wall', fen12, ['S@e4'])
    # ---- T13 THE SHAPE CLIPPED AT THE EDGE: a 3x3 hit anchored in the corner
    fen13 = '4k3/p7/8/8/8/8/8/*3K2R[S] w - - 0 1 {S=w43}'
    per13 = agree(E, 'T13 a wall in the corner', fen13)
    ok('T13 the anchors whose clipped 3x3 covers a1: a1 a2 b1 b2', casts(per13) == ['S@a1', 'S@a2', 'S@b1', 'S@b2'], casts(per13))
    # ---- T14 pieces untouched: a 3x3 hit centred on a piece cracks the walls around it
    fen14 = '4k3/p7/8/8/1*n*4/8/8/R3K3[S] w - - 0 1 {S=w43}'
    f14, _ = E.display(fen14, ['S@c4'])
    ok('T14 S@c4: the knight stays, b4 and d4 crack', f14.startswith('4k3/p7/8/8/1^n^4/8/8/R3K3[] b'), f14)
    agree(E, 'T14 after it', fen14, ['S@c4'])
    # ---- T15 FEN round trips with both flags and a full field
    fen15 = '4k3/p7/8/8/8/8/3*4/R3K3[STst] w - - 0 1 {d4-e5,~a2,w|20,S=w40,T=w80,b|41,S=b45,T=b60,*w,*b}'
    f15, _ = E.display(fen15)
    ok('T15 the field round-trips in the engine\'s order', f15 == fen15, f15)
    agree(E, 'T15 both enchanted: white hammers e1d2', fen15)
    # ---- T16 NO CARD IN CHECK: hits, walls and drops alike
    fen16 = '4k3/p7/8/8/8/8/3*4/r3K3[STU] w - - 0 1 {S=w40,T=w51,U=w90}'
    per16 = agree(E, 'T16 in check', fen16)
    ok('T16 the king moves alone', all(m.startswith('e1') for m in per16) and not any('@' in m for m in per16), sorted(per16))
    # ---- T17 THE 10x10 DUEL SHAPE with terrain decks: the oracle agrees, a search lives
    E.set_variant('terrain10')
    fen17 = 'r1bqkbn3/pppppp4/10/2*3*3/10/3^2^3/10/10/PPPPPP4/RNBQKB4[STUVstuv] w - - 0 1 {w|45.80.53.60,S=w40,T=w2,U=w50,V=w90,b|43.41,S=b42,T=b51,U=b61,V=b4}'
    agree(E, 'T17 the duel shape', fen17)
    per17, n17 = E.perft(fen17, 2)
    want17 = oracle.perft(oracle.from_fen(fen17, handsize=4), 2)
    ok(f'T17 perft 2 = {want17} (the oracle\'s)', n17 == want17, (n17, want17))
    ok('T17 a depth-8 search completes', E.bestmove(fen17, 8) != '(none)')
    E.set_variant('terrain8')

def perft_deep(E, depth):
    E.set_variant('terrain8')
    fens = ['4k3/p7/8/8/8/8/3*4/R3K3[Ss] w - - 0 1 {w|20.30,b|41,S=w40,S=b45}', '7k/4#3/4^3/4*3/8/4*1*1/5_2/4K2R[S] w - - 0 1 {S=w45}',
            'k7/1**5/8/8/8/7p/7P/4K3[S] w - - 0 1 {S=w51}', '4k3/p7/8/8/8/8/3*4/R3K3[S] w - - 0 1 {S=w80}',
            '4k3/p7/8/8/8/8/8/R3K3[STUV] w - - 0 1 {S=w2,T=w3,U=w4,V=w1}', '4k3/p7/8/8/8/8/3*4/R3K3[STst] w - - 0 1 {d4-e5,~a2,w|20,S=w40,T=w80,b|41,S=b45,T=b60,*w,*b}',
            'rnbqkbnr/pppppppp/8/2*^4/8/8/PPPPPPPP/RNBQKBNR[STst] w - - 0 1 {w|43.90.60,S=w40,T=w50,S=b41,T=b61,b|70.80}']
    for f in fens:
        t = time.time()
        per, n = E.perft(f, depth)
        print(f'  perft {depth} {n:>9}  {time.time()-t:5.1f}s  {f}')
    ok(f'perft {depth} on {len(fens)} terrain fixtures completed (asserts on in a debug build)', True)

def random_vs_oracle(E, N, seed=7, depth2=True, sweep=False):
    rng = random.Random(seed)
    bad = 0
    kinds = {'perft1': 0, 'perft2': 0, 'sweep': 0}
    shapes = [(8, 8, 'terrain8'), (6, 6, 'terrain6'), (8, 8, 'terrain8'), (10, 10, 'terrain10')]
    t0 = time.time()
    for i in range(N):
        F, R, var = shapes[i % len(shapes)]
        pairs = (i % 3 == 2) + (i % 7 == 6)
        pos = oracle.random_position(rng, F, R, pairs=pairs, ice='mixed' if i % 2 else None, terrain=(1, 6), deck=True)
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
    ok(f'oracle: {N} random terrain positions (perft 1 move sets{", perft 2 per-move counts" if depth2 else ""}{", xsweep 2" if sweep else ""}) agree', bad == 0, f'{bad} mismatches {kinds}')
    print(f'  {N} positions in {time.time()-t0:.1f}s')

if __name__ == '__main__':
    binary = sys.argv[1]
    args = sys.argv[2:]
    N = int(args[args.index('--random') + 1]) if '--random' in args else 0
    D = int(args[args.index('--depth') + 1]) if '--depth' in args else 0
    E = Engine(binary, ini=INI, variant='terrain8')
    if '--fixtures' in args or not (N or D or '--sweep' in args):
        fixtures(E)
    if '--sweep' in args and not N:
        E.set_variant('terrain8')
        for f in ['4k3/p7/8/8/8/8/3*4/R3K3[Ss] w - - 0 1 {w|20.30,b|41,S=w40,S=b45}', '7k/4#3/4^3/4*3/8/4*1*1/5_2/4K2R[S] w - - 0 1 {S=w45}',
                  'k7/1**5/8/8/8/7p/7P/4K3[S] w - - 0 1 {S=w51}', '4k3/p7/8/8/8/8/3*4/R3K3[S] w - - 0 1 {S=w80}',
                  '4k3/p7/8/8/8/8/3*4/R3K3[STst] w - - 0 1 {d4-e5,~a2,w|20,S=w40,T=w80,b|41,S=b45,T=b60,*w,*b}',
                  'rnbqkbnr/pppppppp/8/2*^4/8/8/PPPPPPPP/RNBQKBNR[STst] w - - 0 1 {w|43.90.60,S=w40,T=w50,S=b41,T=b61,b|70.80}']:
            sb, lines = E.sweep(f, 3)
            ok(f'xsweep 3 clean on {f}', sb == 0, lines[:5])
    if N:
        random_vs_oracle(E, N, sweep='--sweep' in args, seed=int(args[args.index('--seed') + 1]) if '--seed' in args else 7)
    if D:
        perft_deep(E, D)
    E.close()
    report('native (terrain)')
