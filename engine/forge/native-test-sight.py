#!/usr/bin/env python3
"""THE SIGHT WORD (sight.patch) — the native gate: hand-derived fixtures over
UCI (a square in sight of a colour's army: every square a queen standing on
one of its pieces could move onto, the first blocker on each line included —
a piece of either colour, a crate, a wall, a pit, bedrock — a portal body
ending the line, the cap, the enemy's pieces nobody's eyes, a stolen piece its
holder's eye, a shaped cast's anchor the thing restricted, a hit on the wall
you see, a wall raised where you see, a control cast through sight that
checks), the engine's own consistency sweep (xsweep, scratch build), and the
independent Python oracle (oracle.py, grown for the sight) on random positions
with sight cards forced into both hands — perft 1 move sets and perft 2
per-move counts. The test variants are states.ini (the sight cards 140-147).

  python3 native-test-sight.py <binary> [--fixtures] [--random N] [--sweep] [--depth D] [--seed S]
"""
import subprocess, sys, re, random, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oracle
from native_test_common import Engine, ok, moveset, report

HERE = os.path.dirname(os.path.abspath(__file__))
INI = os.path.join(HERE, 'states.ini')
oracle.set_defs(open(INI).read())
SIGHT_IDS = [140, 141, 142, 143, 144, 145, 146, 147]

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

def agree2(E, name, fen):
    """perft 2 per-move counts equal the oracle's."""
    want_set, pos = oracle_moves(fen)
    want = {oracle.uci(m): oracle.perft(m[3], 1) for m in pos.legal_moves()}
    per2, n2 = E.perft(fen, 2)
    diff = {m: (per2.get(m), want[m]) for m in want if per2.get(m) != want[m]}
    ok(f'{name}: perft 2 per-move counts equal the oracle\'s ({n2} nodes)', not diff and set(per2) == set(want), str(diff)[:300])

def casts(per, L='S'):
    return sorted(m for m in per if m.startswith(L + '@'))

def field(fen):
    return fen[fen.index('{'):] if '{' in fen else ''

def fixtures(E):
    E.set_variant('states8')
    # ---- G1 THE LINE AND ITS BLOCKERS (140: stun3 o sight): the rook a1 and the king e1 the eyes
    base = 'r3k3/8/8/8/{a4}/8/8/R3K3[S] w - - 0 1 {{S=w140{extra}}}'
    f = base.format(a4='8', extra='')
    per = agree(E, 'G1a open a-file', f)
    ok('G1a the rook a8 is in sight up the a-file, the rook a1 along rank 1 from the king: S@a1, S@a8', casts(per) == ['S@a1', 'S@a8'], casts(per))
    f = base.format(a4='P7', extra='')
    per = agree(E, 'G1b a white pawn on a4', f)
    ok('G1b a pawn of yours on the line is an eye of its own: S@a1, S@a4, S@a8', casts(per) == ['S@a1', 'S@a4', 'S@a8'], casts(per))
    f = base.format(a4='*7', extra='')
    per = agree(E, 'G1c a wall on a4', f)
    ok('G1c a wall ends the line: S@a1 alone', casts(per) == ['S@a1'], casts(per))
    f = base.format(a4='p7', extra='')
    per = agree(E, 'G1d a black pawn on a4', f)
    ok('G1d an enemy piece is in sight and ends the line (it is no eye of yours): S@a1, S@a4', casts(per) == ['S@a1', 'S@a4'], casts(per))
    f = base.format(a4='^7', extra='')
    per = agree(E, 'G1e a crate on a4', f)
    ok('G1e a crate ends the line: S@a1 alone', casts(per) == ['S@a1'], casts(per))
    f = base.format(a4='_7', extra='')
    per = agree(E, 'G1f a pit on a4', f)
    ok('G1f a pit ends the line: S@a1 alone', casts(per) == ['S@a1'], casts(per))
    f = base.format(a4='#7', extra='')
    per = agree(E, 'G1g bedrock on a4', f)
    ok('G1g bedrock ends the line: S@a1 alone', casts(per) == ['S@a1'], casts(per))
    f = base.format(a4='8', extra=',~a4')
    per = agree(E, 'G1h ice on a4', f)
    ok('G1h a slippery square is no blocker: S@a1, S@a8', casts(per) == ['S@a1', 'S@a8'], casts(per))
    f = 'r3k3/8/8/8/8/8/8/N3K3[S] w - - 0 1 {S=w140}'
    per = agree(E, 'G1i a knight for an eye', f)
    ok('G1i every piece sees along queen lines, a knight too: S@a1, S@a8', casts(per) == ['S@a1', 'S@a8'], casts(per))
    # ---- G2 THE CAP (146: stun3 o sight2)
    f = '4k3/8/8/8/8/r7/8/R3K3[S] w - - 0 1 {S=w146}'
    per = agree(E, 'G2 sight2', f)
    ok('G2 sight2: the rook a3 within two of a1 is in sight, the rook a1 four from the king is not: S@a3 alone', casts(per) == ['S@a3'], casts(per))
    f = '4k3/8/8/8/8/r7/8/R3K3[S] w - - 0 1 {S=w140}'
    per = agree(E, 'G2 uncapped on the same board', f)
    ok('G2 without the cap: S@a1, S@a3', casts(per) == ['S@a1', 'S@a3'], casts(per))
    # ---- G3 THE PORTAL BODY ends a line; a piece on the body is in sight
    f = '4k3/8/8/4n3/8/8/8/B3K3[S] w - - 0 1 {S=w140}'
    per = agree(E, 'G3a a diagonal and a file to e5', f)
    ok('G3a the knight e5 is seen on the bishop\'s diagonal and the king\'s file: S@a1, S@e5', casts(per) == ['S@a1', 'S@e5'], casts(per))
    f = '4k3/8/8/4n3/8/8/8/B3K3[S] w - - 0 1 {c3-e3,S=w140}'
    per = agree(E, 'G3b the pair c3-e3 on both lines', f)
    ok('G3b a portal body ends each line short of e5: S@a1 alone', casts(per) == ['S@a1'], casts(per))
    f = '4k3/8/8/8/8/2n5/8/B3K3[S] w - - 0 1 {c3-e3,S=w140}'
    per = agree(E, 'G3c a knight on the body c3', f)
    ok('G3c the piece on the body is in sight: S@a1, S@c3', casts(per) == ['S@a1', 'S@c3'], casts(per))
    # ---- G4 A SHAPED CAST (143: stun3 xxx/xox/xxx sight): the anchor must be in sight, the cells follow the shape
    f = '4k3/8/8/3n1n2/8/8/8/R3K3[S] w - - 0 1 {S=w143}'
    per = agree(E, 'G4 the 3x3 stun', f)
    ok('G4 anchors in sight whose 3x3 holds a piece: around the rook a1 (a1, a2, b1, b2) and the knights d5/f5 through d4, e4, e5, e6, f6 — never d5 or f5 themselves, off every line',
       casts(per) == ['S@a1', 'S@a2', 'S@b1', 'S@b2', 'S@d4', 'S@e4', 'S@e5', 'S@e6', 'S@f6'], casts(per))
    f1, _ = E.display(f, ['S@e5'])
    ok('G4 S@e5 stuns both knights off the line: %d5s3,%f5s3', field(f1) == '{%d5s3,%f5s3}', f1)
    # ---- G5 A HIT IN SIGHT (144: hit1 o sight): the first wall on a line is the anchor
    f = '2*1k2*/1p6/8/*7/8/8/8/R2*K3[S] w - - 0 1 {S=w144}'
    per = agree(E, 'G5 walls on the lines', f)
    ok('G5 the walls d1 (rank 1), a5 (the a-file) and h8 (the long diagonal) are in sight, c8 is not: S@a5, S@d1, S@h8', casts(per) == ['S@a5', 'S@d1', 'S@h8'], casts(per))
    f1, _ = E.display(f, ['S@h8'])
    ok('G5 S@h8 cracks the wall at the end of the diagonal', f1.startswith('2*1k2^/'), f1)
    # ---- G6 A WALL RAISED IN SIGHT (145: wall o sight): the empty squares on the lines
    f = '4k3/1p6/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w145}'
    per = agree(E, 'G6 empty floor in sight', f)
    ok('G6 30 anchors: the a-file, rank 1, the two long diagonals, the e-file and the king\'s short diagonals (e5 on two of them once); h7 on no line, e8 under the king',
       len(casts(per)) == 30 and 'S@a8' in casts(per) and 'S@h8' in casts(per) and 'S@h7' not in casts(per) and 'S@e8' not in casts(per), casts(per))
    # ---- G7 MIND CONTROL THROUGH SIGHT (141: control4 o sight): the stolen rook checks from where it stands
    f = 'r3k3/8/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w141}'
    per = agree(E, 'G7 the rook a8 in sight', f)
    ok('G7 the control casts on the rook a8 alone (your own a1 changes nothing)', casts(per) == ['S@a8'], casts(per))
    ok('G7 S@a8 gives check: the stolen rook strikes e8 along rank 8', E.gives_check(f, 'S@a8'))
    f1, _ = E.display(f, ['S@a8'])
    ok('G7 the record %a8c4b, the rook white\'s', f1.startswith('R3k3/') and field(f1) == '{%a8c4b}', f1)
    per1 = agree(E, 'G7 black in check from its own rook', f, ['S@a8'])
    ok('G7 black has the three king steps off rank 8 and no cast: e8d7, e8e7, e8f7', moveset(per1) == {'e8d7', 'e8e7', 'e8f7'}, sorted(per1))
    f = '3rk3/8/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w141}'
    per = agree(E, 'G7 the rook d8 off every line', f)
    ok('G7 nothing in sight to steal: no cast', casts(per) == [], casts(per))
    # ---- G8 THE ENEMY'S PIECES ARE NOBODY'S EYES
    f = '4k3/8/8/8/8/8/7r/R3K3[S] w - - 0 1 {S=w140}'
    per = agree(E, 'G8a a black rook on h2 off your lines', f)
    ok('G8a the rook h2 sees your pieces; you do not see it: S@a1 alone', casts(per) == ['S@a1'], casts(per))
    f = '4k3/8/8/8/8/7P/7r/R3K3[S] w - - 0 1 {S=w140}'
    per = agree(E, 'G8b a white pawn on h3 above it', f)
    ok('G8b the pawn is an eye down the file (and itself on no other line): S@a1, S@h2', casts(per) == ['S@a1', 'S@h2'], casts(per))
    # ---- G9 A STOLEN PIECE IS ITS HOLDER'S EYE
    f = '4k3/7n/8/8/7R/8/8/R3K3[S] w - - 0 1 {S=w140,%h4c3b}'
    per = agree(E, 'G9 a rook held under control on h4', f)
    ok('G9 the held rook sees up the h-file to the knight h7, and is itself seen from the king: S@a1, S@h4, S@h7', casts(per) == ['S@a1', 'S@h4', 'S@h7'], casts(per))
    f1, _ = E.display(f, ['S@h4'])
    ok('G9 a stun on the held rook returns it to black, stunned (the overwrite)', '/7r/' in f1 and field(f1) == '{%h4s3}', f1)
    # ---- G10 BLACK'S OWN SIGHT (black to move, a sight card of its own)
    f = '4k3/1p6/8/8/8/8/8/R3K3[s] b - - 0 1 {S=b140}'
    per = agree(E, 'G10a black with the king and a pawn off every line', f)
    ok('G10a the rook a1 is off both black eyes\' lines, the pawn b7 off the king\'s: no cast', casts(per) == [], casts(per))
    f = '4k3/1p6/8/8/R7/8/8/4K3[s] b - - 0 1 {S=b140}'
    per = agree(E, 'G10b the rook a4 on the king\'s diagonal', f)
    ok('G10b in sight down e8-a4: S@a4', casts(per) == ['S@a4'], casts(per))
    # ---- G11 THE 10x10 DUEL SHAPE with sight cards in both hands
    E.set_variant('states10')
    f = '4k5/pppp6/10/10/10/10/10/10/PPPP6/R3K5[STst] w - - 0 1 {w|144,S=w140,T=w141,S=b140,T=b143,b|142}'
    per = agree(E, 'G11 a duel-shaped 10x10 with sight decks', f)
    ok('G11 each pawn sees straight up its file across the gap to the enemy\'s front pawn: the control casts on a9, b9, c9, d9 and nothing behind them; the stun on those and your own',
       casts(per, 'T') == ['T@a9', 'T@b9', 'T@c9', 'T@d9'] and casts(per) == ['S@a1', 'S@a2', 'S@a9', 'S@b2', 'S@b9', 'S@c2', 'S@c9', 'S@d2', 'S@d9'], (casts(per), casts(per, 'T')))
    agree2(E, 'G11 perft 2', f)
    f = '4k5/pppp6/10/10/10/10/10/10/P1PP6/R3K5[STst] w - - 0 1 {w|144,S=w140,T=w141,S=b140,T=b143,b|142}'
    per = agree(E, 'G11b the b-file open', f)
    ok('G11b nothing of yours stands on the b-file: b9 drops out of sight, a9, c9 and d9 stay', casts(per, 'T') == ['T@a9', 'T@c9', 'T@d9'], casts(per, 'T'))
    f = '4k5/pppp6/10/10/10/10/10/10/P1PP6/RB2K5[STst] w - - 0 1 {w|144,S=w140,T=w141,S=b140,T=b143,b|142}'
    per = agree(E, 'G11c a bishop on b1 under the open file', f)
    ok('G11c the bishop sees up the b-file to the pawn b9: T@b9 and S@b9 join', casts(per, 'T') == ['T@a9', 'T@b9', 'T@c9', 'T@d9'] and 'S@b9' in casts(per), (casts(per), casts(per, 'T')))
    agree2(E, 'G11c perft 2', f)
    E.set_variant('states8')

def perft_deep(E, depth):
    E.set_variant('states8')
    fens = ['r3k3/8/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w140}', '4k3/8/8/4n3/8/8/8/B3K3[S] w - - 0 1 {c3-e3,S=w140}',
            '4k3/8/8/3n1n2/8/8/8/R3K3[S] w - - 0 1 {S=w143}', '2*1k2*/1p6/8/*7/8/8/8/R2*K3[S] w - - 0 1 {S=w144}',
            'r3k3/8/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w141}', '4k3/7n/8/8/7R/8/8/R3K3[S] w - - 0 1 {S=w140,%h4c3b}',
            '4k3/8/8/8/8/r7/8/R3K3[ST] w - - 0 1 {S=w146,T=w147}']
    for f in fens:
        t = time.time()
        per, n = E.perft(f, depth)
        print(f'  perft {depth} {n:>9}  {time.time()-t:5.1f}s  {f}')
    E.set_variant('states10')
    f = '4k5/pppp6/10/10/10/10/10/10/P1PP6/RB2K5[STst] w - - 0 1 {w|144,S=w140,T=w141,S=b140,T=b143,b|142}'
    t = time.time()
    per, n = E.perft(f, max(2, depth - 1))
    print(f'  perft {max(2, depth - 1)} {n:>9}  {time.time()-t:5.1f}s  {f}')
    ok(f'perft {depth} on {len(fens)} sight fixtures (+ the 10x10 at {max(2, depth - 1)}) completed (asserts on in a debug build)', True)

def force_sight(rng, pos):
    """A sight card into a slot of each colour: the first slot that is not the one whose portal half is open,
    with an id no other slot of that colour holds."""
    d = pos.deck
    for c in (oracle.WHITE, oracle.BLACK):
        i = next((i for i in range(8) if i != d['castslot'][c]), 0)
        held = {e[0] for j, e in enumerate(d['slots'][c]) if e and j != i}
        d['slots'][c][i] = [rng.choice([x for x in SIGHT_IDS if x not in held]), 1]

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
        force_sight(rng, pos)
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
    ok(f'oracle: {N} random positions with sight cards in both hands (perft 1 move sets{", perft 2 per-move counts" if depth2 else ""}{", xsweep 2" if sweep else ""}) agree', bad == 0, f'{bad} mismatches {kinds}')
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
        for f in ['r3k3/8/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w140}', '4k3/8/8/4n3/8/8/8/B3K3[S] w - - 0 1 {c3-e3,S=w140}',
                  '4k3/8/8/3n1n2/8/8/8/R3K3[S] w - - 0 1 {S=w143}', 'r3k3/8/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w141}',
                  '4k3/7n/8/8/7R/8/8/R3K3[S] w - - 0 1 {S=w140,%h4c3b}', '2*1k2*/1p6/8/*7/8/8/8/R2*K3[ST] w - - 0 1 {S=w144,T=w145}']:
            sb, lines = E.sweep(f, 3)
            ok(f'xsweep 3 clean on {f}', sb == 0, lines[:5])
    if N:
        random_vs_oracle(E, N, sweep='--sweep' in args, seed=int(args[args.index('--seed') + 1]) if '--seed' in args else 7)
    if D:
        perft_deep(E, D)
    E.close()
    report('native (sight)')
