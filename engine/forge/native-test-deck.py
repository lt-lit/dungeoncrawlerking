#!/usr/bin/env python3
"""THE DECK (deck.patch) — the native gate: hand-derived fixtures over UCI, the
engine's own consistency sweep (xsweep, scratch build), and the independent
Python oracle (oracle.py, the deck rules from the rule text) on random
positions with hands, piles, halves, ice and pits — perft 1 move sets and
perft 2 per-move counts. The test variants are deck.ini (hand 4, slots s..z,
card IDs 1-9 ice, 10-19 portal, 20-29 win, 30-39 meta).

  python3 native-test-deck.py <binary> [--fixtures] [--random N] [--sweep] [--depth D] [--seed S]
"""
import subprocess, sys, re, random, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oracle
from native_test_common import Engine, ok, moveset, report

HERE = os.path.dirname(os.path.abspath(__file__))
INI = os.path.join(HERE, 'deck.ini')

def oracle_moves(fen, moves=()):
    """The oracle's legal move set after `moves` from `fen` (the deck read with hand size 4)."""
    p = oracle.from_fen(fen, handsize=4)
    for u in moves:
        p = next(m[3] for m in p.legal_moves() if oracle.uci(m) == u)
    return {oracle.uci(m) for m in p.legal_moves()}, p

def agree(E, name, fen, moves=()):
    """The engine's perft-1 set equals the oracle's after the same moves; returns the set."""
    per, n = E.perft(fen, 1, moves)
    want, _ = oracle_moves(fen, moves)
    ok(f'{name}: engine = oracle on the move set ({len(want)} moves)', moveset(per) == want and n == len(want), sorted(moveset(per) ^ want))
    return per

def fixtures(E):
    E.set_variant('deck8')
    # ---- D1 THE START: white holds an ice card (id 1) in slot s, its pile a win card and a blank; black an ice card (id 2) in s, its pile another ice
    fen = '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|20.30,b|1,S=w1,S=b2}'
    per = agree(E, 'D1 the start', fen)
    casts = sorted(m for m in per if m.startswith('S@'))
    ok('D1 sixteen ice casts on the middle rows, the mulligan, 14 piece moves: 31', len(casts) == 16 and all(m[3] in '45' for m in casts) and '@@@@' in per and len(per) == 31, (len(casts), len(per)))
    f, _ = E.display(fen)
    ok('D1 the FEN round-trips: the pocket [Ss], the piles, the bindings', f == '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|20.30,S=w1,b|1,S=b2}', f)
    # ---- D2 THE DRAW: after white's ice cast, black draws its pile's ice into its next free slot (t); white draws nothing yet
    f2, _ = E.display(fen, ['S@e4'])
    ok('D2 S@e4: the patch iced, white\'s card spent, black draws id 1 into t', f2 == '4k3/p7/8/8/8/8/8/R3K3[st] b - - 0 1 {~d3,~e3,~f3,~d4,~e4,~f4,~d5,~e5,~f5,w|20.30,S=b2,T=b1}', f2)
    per2 = agree(E, 'D2 black to move with two ice cards', fen, ['S@e4'])
    ok('D2 black: fifteen casts from each slot (e4 already iced through), 7 piece moves, no mulligan (its pile is empty): 37', len(per2) == 37 and '@@@@' not in per2, len(per2))
    # ---- D3 white draws at the end of black's move: the win card (20) into s, the blank (30) into t
    f3, _ = E.display(fen, ['S@e4', 'e8d8'])
    ok('D3 e8d8: white draws 20 into S and 30 into T, its pile empty', f3 == '3k4/p7/8/8/8/8/8/R3K3[STst] w - - 0 2 {~d3,~e3,~f3,~d4,~e4,~f4,~d5,~e5,~f5,S=w20,T=w30,S=b2,T=b1}', f3)
    per3 = agree(E, 'D3 white with the win card and a blank', fen, ['S@e4', 'e8d8'])
    ok('D3 the win card is cast on the king\'s own square alone, the blank never, no mulligan on an empty pile: 15', 'S@e1' in per3 and not any(m.startswith('T@') for m in per3) and '@@@@' not in per3 and len(per3) == 15, sorted(per3))
    # ---- D4 THE WIN: the game ends at once; the search sees mate in 1 (black has material, so the strip is no shortcut)
    f4, _ = E.display(fen, ['S@e4', 'e8d8', 'S@e1'])
    ok('D4 S@e1: the field carries !w, the card spent', f4.endswith('{~d3,~e3,~f3,~d4,~e4,~f4,~d5,~e5,~f5,T=w30,S=b2,T=b1,!w}') and '[Tst]' in f4, f4)
    per4, n4 = E.perft(fen, 1, ['S@e4', 'e8d8', 'S@e1'])
    ok('D4 black has no legal move: the game is over', n4 == 0, n4)
    fenW = 'r2k4/p7/8/8/8/8/8/R3K3[STst] w - - 0 2 {S=w20,T=w30,S=b2,T=b1}'
    ok('D4 bestmove is the win card', E.bestmove(fenW, 4) == 'S@e1', E.bestmove(fenW, 4))
    ok('D4 ...and the oracle agrees the move set', agree(E, 'D4 the winning position', fenW) is not None)
    # ---- D5 THE MULLIGAN: discard the hand, draw four; the discards never return; the other side draws nothing
    fen5 = '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|10.11.20.31,b|1,S=w1,S=b2}'
    per5 = agree(E, 'D5 a mulligan on offer', fen5)
    ok('D5 @@@@ among the moves', '@@@@' in per5)
    f5, _ = E.display(fen5, ['@@@@'])
    ok('D5 after it: two portals, the win card and a blank in s..v, the ice gone, the pile empty; black unchanged', f5 == '4k3/p7/8/8/8/8/8/R3K3[STUVst] b - - 0 1 {S=w10,T=w11,U=w20,V=w31,S=b2,T=b1}', f5)
    agree(E, 'D5 black after the mulligan', fen5, ['@@@@'])
    ok('D5 a mulligan is irreversible: the halfmove clock reset', f5.split(' ')[4] == '0', f5)
    # ---- D6 THE PORTAL CARD: the half marks its slot and spends nothing, the frozen side draws nothing, the link spends the card
    fen6 = '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|1,b|1,S=w10,S=b2}'
    per6 = agree(E, 'D6 a portal card in hand', fen6)
    ok('D6 the casts are S@ on the castable squares (rows 2-7 less the pawn on a7: 47)', sum(1 for m in per6 if m.startswith('S@')) == 47, sum(1 for m in per6 if m.startswith('S@')))
    f6, _ = E.display(fen6, ['S@e4'])
    ok('D6 S@e4: the half stands, the slot marked +, the card still in hand, nobody drew', f6 == '4k3/p7/8/8/8/8/8/R3K3[Ss] b - - 0 1 {e4w,w|1,S=w10+,b|1,S=b2}', f6)
    per6b = agree(E, 'D6 black frozen', fen6, ['S@e4'])
    ok('D6 the frozen side\'s one move is the pass', moveset(per6b) == {'e8e8'}, sorted(per6b))
    per6c = agree(E, 'D6 the link ply', fen6, ['S@e4', 'e8e8'])
    ok('D6 the link ply offers the slot\'s drops alone (46 links: the castables less e4), no mulligan, no piece move', all(m.startswith('S@') for m in per6c) and len(per6c) == 46, (len(per6c), sorted(per6c)[:3]))
    f6c, _ = E.display(fen6, ['S@e4', 'e8e8', 'S@c5'])
    ok('D6 the link: the pair stands, the card spent, black draws its pile\'s ice into t', f6c == '4k3/p7/8/8/8/8/8/R3K3[st] b - - 0 2 {e4-c5,w|1,S=b2,T=b1}', f6c)
    f6d, _ = E.display(fen6, ['S@e4', 'e8e8', 'S@c5', 'e8d8'])
    ok('D6 white then draws its ice into s', f6d.endswith('{e4-c5,S=w1,S=b2,T=b1}') and '[Sst]' in f6d, f6d)
    # ---- D7 THE FIZZLE under the deck spends the card
    E.set_variant('deck6')
    fen7 = '2p1k1/******/******/******/1*****/K4N[S] w - - 0 1 {S=w10}'  # black keeps a pawn: a bare king is decided at load (rule 4b)
    per7 = agree(E, 'D7 one castable square', fen7)
    ok('D7 S@a2 the one cast, beside Ka2 and Kb1', moveset(per7) == {'S@a2', 'a1a2', 'a1b1'}, sorted(per7))
    per7b = agree(E, 'D7 black frozen', fen7, ['S@a2'])
    per7c = agree(E, 'D7 the caster with no link left', fen7, ['S@a2', 'e6e6'])
    ok('D7 the fizzle pass alone', moveset(per7c) == {'a1a1'}, sorted(per7c))
    f7, _ = E.display(fen7, ['S@a2', 'e6e6', 'a1a1'])
    ok('D7 after it the half is gone and the card spent', f7 == '2p1k1/******/******/******/1*****/K4N[] b - - 0 2', f7)
    E.set_variant('deck8')
    # ---- D8 IDENTICAL CARDS share a slot
    fen8 = '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {w|1.1.30,b|2}'
    f8, _ = E.display(fen8, ['a1b1', 'e8d8'])
    ok('D8 two ice cards of one ID drawn into one slot with a count of two, the blank beside; black drew its one card; the draw reset the clock', f8.endswith('[SSTs] w - - 0 2 {S=w1,T=w30,S=b2}'), f8)
    agree(E, 'D8 the doubled slot', fen8, ['a1b1', 'e8d8'])
    f8b, _ = E.display(fen8, ['a1b1', 'e8d8', 'S@e4'])
    ok('D8 one cast leaves one', '[STs]' in f8b and 'S=w1' in f8b, f8b)
    # ---- D9 NO CARD IN CHECK: the evasions alone, no mulligan
    fen9 = '4k3/p7/8/8/8/8/8/r3K2R[STst] w - - 0 1 {w|1.2,S=w10,T=w20,S=b2,T=b1}'
    per9 = agree(E, 'D9 in check', fen9)
    ok('D9 three king moves and nothing else', moveset(per9) == {'e1d2', 'e1e2', 'e1f2'}, sorted(per9))
    # ---- D10 CARDS ARE NEVER PIECES: a bared king with a hand full of cards has lost
    fen10 = '4k3/p7/8/8/8/8/8/4K3[STst] w - - 0 1 {S=w10,T=w20,S=b2,T=b1}'
    per10, n10 = E.perft(fen10, 1)
    ok('D10 white is bared: no legal move, the cards count for nothing', n10 == 0, n10)
    # ---- D11 THE DIG: the win card under A cards of the pile is a mate in floor(A/4)+2 (each mulligan draws
    # four), and the search reports that exact mate at a depth near its ply count - the board a sealed pocket
    # of blocked pawns (no strip, no counterplay: the dig is the only win). Measured on the native release:
    # A 0 / 4 / 8 / 12 / 16 / 20 / 24 / 28 -> depth 3 / 5 / 7 / 9 / 12 / 13 / 22 / 23 (mates in 2..9; horizon.py, the shipped build).
    def dig_fen(A):
        pile = [[5, 6, 7, 8, 9, 1, 2, 3][i % 8] for i in range(A)] + [20]
        return '7k/8/**6/p*6/P*6/**6/8/4K3[STUV] w - - 0 1 {w|' + '.'.join(map(str, pile)) + ',S=w1,T=w2,U=w3,V=w4}'
    agree(E, 'D11 the dig board (four cards over the win card)', dig_fen(4))
    for A, N, depth in ((0, 2, 4), (4, 3, 8), (8, 4, 10), (12, 5, 18)):
        info = E.bestmove_info(dig_fen(A), depth)
        ok(f'D11 {A} cards over the win card: mate in {N} by depth {depth}', f' score mate {N} ' in info, info)
    # the fixture the probes began on - a pawn queens with check in three (the test variant's double step runs from
    # every rank), so the third mulligan in a row is refuted and the search rightly prefers a longer mate
    fen11 = '3k4/pppp4/8/8/8/8/8/R3K3[STUV] w - - 0 1 {w|5.6.7.8.20,S=w1,T=w2,U=w3,V=w4}'
    agree(E, 'D11 the dig with counterplay', fen11)
    info = E.bestmove_info(fen11, 8)
    ok('D11 two mulligans under counterplay: still mate in 3 (a cast draws too, so the line may open with one)', ' score mate 3 ' in info, info)
    # ---- D13 THE ROOT BY MOVES: a position reached through mulligans and draws must search on the same
    # move set as its own FEN parsed fresh (a search's root is re-set from pos.fen() with the setup state
    # copied over it - the pile pointer must survive that re-parse; it did not when it counted the drawn)
    fen13 = '3k4/pppp4/8/8/8/8/P7/4K3[STUV] w - - 0 1 {w|5.6.7.8.9.1.2.3.20,S=w1,T=w2,U=w3,V=w4}'
    line13 = ['@@@@', 'c7c5', '@@@@', 'c5c4']
    per13 = agree(E, 'D13 after two mulligans and two pawn moves, by moves', fen13, line13)
    f13, _ = E.display(fen13, line13)
    ok('D13 one card left on the pile, the hand 9.1.2.3', f13 == '3k4/pp1p4/8/8/2p5/8/P7/4K3[STUV] w - - 0 3 {w|20,S=w9,T=w1,U=w2,V=w3}', f13)
    per13f = agree(E, 'D13 the same position from its FEN', f13)
    ok('D13 the mulligan is offered both ways (the third in a row, the last card)', '@@@@' in per13 and '@@@@' in per13f and moveset(per13) == moveset(per13f), (len(per13), len(per13f)))
    ok('D13 the search finds the win card by moves: mate 2', ' score mate 2 ' in E.bestmove_info(fen13, 6, line13), E.bestmove_info(fen13, 6, line13))
    # ---- D12 THE 10x10 DUEL SHAPE with decks: the oracle agrees, a search lives
    E.set_variant('deck10')
    fen12 = 'r1bqkbn3/pppppp4/10/10/10/10/10/10/PPPPPP4/RNBQKB4[STUVstuv] w - - 0 1 {w|5.12.21.33.7,S=w1,T=w10,U=w20,V=w30,b|1.2,S=b3,T=b11,U=b31,V=b12}'
    agree(E, 'D12 the duel shape', fen12)
    per12, n12 = E.perft(fen12, 2)
    want12 = oracle.perft(oracle.from_fen(fen12, handsize=4), 2)
    ok(f'D12 perft 2 = {want12} (the oracle\'s)', n12 == want12, (n12, want12))
    ok('D12 a depth-8 search completes', E.bestmove(fen12, 8) != '(none)')
    E.set_variant('deck8')

def perft_deep(E, depth):
    E.set_variant('deck8')
    fens = ['4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|20.30,b|1,S=w1,S=b2}', '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|10.11.20.31,b|1,S=w1,S=b2}',
            '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|1,b|1,S=w10,S=b2}', '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {w|1.1.30,b|2}',
            'r2k4/p7/8/8/8/8/8/R3K3[STst] w - - 0 2 {S=w20,T=w30,S=b2,T=b1}', '3k4/pppp4/8/8/8/8/8/R3K3[STUV] w - - 0 1 {w|5.6.7.8.20,S=w1,T=w2,U=w3,V=w4}',
            'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR[STst] w - - 0 1 {w|3.14.35,S=w1,T=w10,S=b2,T=b11,b|9.19}']
    for f in fens:
        t = time.time()
        per, n = E.perft(f, depth)
        print(f'  perft {depth} {n:>9}  {time.time()-t:5.1f}s  {f}')
    ok(f'perft {depth} on {len(fens)} deck fixtures completed (asserts on in a debug build)', True)

def random_vs_oracle(E, N, seed=7, depth2=True, sweep=False):
    rng = random.Random(seed)
    bad = 0
    kinds = {'perft1': 0, 'perft2': 0, 'sweep': 0}
    shapes = [(8, 8, 'deck8'), (6, 6, 'deck6'), (8, 8, 'deck8'), (10, 10, 'deck10')]
    t0 = time.time()
    for i in range(N):
        F, R, var = shapes[i % len(shapes)]
        pairs = (i % 3 == 2) + (i % 7 == 6)
        pos = oracle.random_position(rng, F, R, pairs=pairs, ice='mixed' if i % 2 else None, terrain=(0, 4), deck=True)
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
    ok(f'oracle: {N} random deck positions (perft 1 move sets{", perft 2 per-move counts" if depth2 else ""}{", xsweep 2" if sweep else ""}) agree', bad == 0, f'{bad} mismatches {kinds}')
    print(f'  {N} positions in {time.time()-t0:.1f}s')

if __name__ == '__main__':
    binary = sys.argv[1]
    args = sys.argv[2:]
    N = int(args[args.index('--random') + 1]) if '--random' in args else 0
    D = int(args[args.index('--depth') + 1]) if '--depth' in args else 0
    E = Engine(binary, ini=INI, variant='deck8')
    if '--fixtures' in args or not (N or D or '--sweep' in args):
        fixtures(E)
    if '--sweep' in args and not N:
        E.set_variant('deck8')
        for f in ['4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|20.30,b|1,S=w1,S=b2}', '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|10.11.20.31,b|1,S=w1,S=b2}',
                  '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|1,b|1,S=w10,S=b2}', '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {w|1.1.30,b|2}',
                  '3k4/pppp4/8/8/8/8/8/R3K3[STUV] w - - 0 1 {w|5.6.7.8.20,S=w1,T=w2,U=w3,V=w4}',
                  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR[STst] w - - 0 1 {w|3.14.35,S=w1,T=w10,S=b2,T=b11,b|9.19}']:
            sb, lines = E.sweep(f, 3)
            ok(f'xsweep 3 clean on {f}', sb == 0, lines[:5])
    if N:
        random_vs_oracle(E, N, sweep='--sweep' in args, seed=int(args[args.index('--seed') + 1]) if '--seed' in args else 7)
    if D:
        perft_deep(E, D)
    E.close()
    report('native (deck)')
