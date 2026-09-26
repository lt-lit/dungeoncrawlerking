#!/usr/bin/env python3
"""THE YOU-WIN HORIZON (deck.patch + deck-search.patch, 2026-09-26): on a board
with no counterplay — the kings and two blocked pawns sealed in a walled pocket,
so no strip and no check is ever possible — one side holds four ice cards and
a pile with the win card under A other cards (mate in floor(A/4) + 2 by
mulligans). At which depth does the search first report that exact mate?

  python3 horizon.py <native-largeboard-build> [A,A,…] [movetime-ms] [--mirror]

--mirror puts the deck on BLACK with white to move: does the engine SEE the
opponent's dig — a mate AGAINST it in the same count — from the other seat?
(the brief's "mirror", §4.10 "Phase 3.3"). The test variant is deck.ini's deck8.
"""
import sys, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from native_test_common import Engine

HERE = os.path.dirname(os.path.abspath(__file__))
args = [a for a in sys.argv[1:] if not a.startswith('--')]
mirror = '--mirror' in sys.argv
binary = args[0] if args else './stockfish'
As = [int(a) for a in args[1].split(',')] if len(args) > 1 else [0, 4, 8, 12, 16, 20, 24, 28]
budget = int(args[2]) if len(args) > 2 else 180000
E = Engine(binary, ini=os.path.join(HERE, 'deck.ini'), variant='deck8')
ICE = [5, 6, 7, 8, 9, 1, 2, 3]

def fen_for(A):
    pile = [ICE[i % 8] for i in range(A)] + [20]
    p = '.'.join(map(str, pile))
    if mirror:
        # black holds the hand and the pile; white (to move) has nothing to do but shuffle its king
        return f'7k/8/**6/p*6/P*6/**6/8/4K3[stuv] w - - 0 1 {{b|{p},S=b1,T=b2,U=b3,V=b4}}'
    return f'7k/8/**6/p*6/P*6/**6/8/4K3[STUV] w - - 0 1 {{w|{p},S=w1,T=w2,U=w3,V=w4}}'

print(f'{"the mirror: the deck on black, white to move" if mirror else "the deck on white, white to move"} — budget {budget} ms a position')
for A in As:
    N = A // 4 + 2
    want = f' score mate {-N} ' if mirror else f' score mate {N} '
    E.send('ucinewgame'); E.send('isready'); E.wait('readyok')
    E.send('position fen ' + fen_for(A))
    t0 = time.time()
    E.send(f'go depth 40 movetime {budget}')
    first = None; stopped = False; last = None
    while True:
        line = E.p.stdout.readline().rstrip('\n')
        if not line:
            raise RuntimeError('the engine died')
        if line.startswith('info depth') and ' pv ' in line:
            last = line
            if want in line and first is None:
                first = line
                if not stopped:
                    E.send('stop'); stopped = True
        if line.startswith('bestmove'):
            break
    def brief(l):
        if not l:
            return '-'
        d = l.split()[2]; sc = l.split(' score ')[1].split(' nodes')[0]; n = l.split(' nodes ')[1].split()[0]; ms = l.split(' time ')[1].split()[0]; pv = l.split(' pv ')[1]
        return f'depth {d:>2} {sc:<10} nodes {int(n):>10,} {int(ms):>7} ms  pv {pv[:60]}'
    print(f'A={A:>2} (mate in {N}{" against white" if mirror else ""}): first exact mate at {brief(first)}' if first else f'A={A:>2} (mate in {N}): NOT FOUND in {time.time() - t0:.0f}s; last {brief(last)}', flush=True)
E.close()
