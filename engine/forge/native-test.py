#!/usr/bin/env python3
"""Portals v2 — the native gate: hand-verified fixtures over UCI, the engine's
own consistency sweep (xsweep, scratch build), and the independent Python
oracle on random positions (perft 1 move sets, perft 2 per-move counts).

  python3 native-test.py <binary> [--random N] [--sweep] [--depth D]
"""
import subprocess, sys, re, random, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oracle

HERE = os.path.dirname(os.path.abspath(__file__))
INI = os.path.join(HERE, 'portals-v2.ini')

class Engine:
    def __init__(self, path, variant='portal8'):
        self.p = subprocess.Popen([path], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        self.send('uci'); self.wait('uciok')
        self.send(f'setoption name VariantPath value {INI}')
        self.send('setoption name Use NNUE value false')
        self.variant = None
        self.set_variant(variant)
    def set_variant(self, v):
        if v != self.variant:
            self.send(f'setoption name UCI_Variant value {v}')
            self.variant = v
            self.send('isready'); self.wait('readyok')
    def send(self, s):
        self.p.stdin.write(s + '\n'); self.p.stdin.flush()
    def wait(self, token):
        out = []
        while True:
            line = self.p.stdout.readline()
            if not line:
                raise RuntimeError('engine died: ' + '\n'.join(out[-20:]))
            out.append(line.rstrip('\n'))
            if line.startswith(token):
                return out
    def perft(self, fen, depth, moves=()):
        self.send('position fen ' + fen + (' moves ' + ' '.join(moves) if moves else ''))
        self.send(f'go perft {depth}')
        out = self.wait('Nodes searched')
        per = {}
        for l in out:
            m = re.match(r'^([a-l]\d+[a-l]\d+[nbrqkNBRQK]?|[A-Z]@[a-l]\d+): (\d+)$', l.strip())
            if m:
                per[m.group(1)] = int(m.group(2))
        total = int(out[-1].split(':')[1])
        return per, total
    def display(self, fen, moves=()):
        self.send('position fen ' + fen + (' moves ' + ' '.join(moves) if moves else ''))
        self.send('d')
        out = self.wait('Checkers')
        fenline = next(l for l in out if l.startswith('Fen:'))
        return fenline[4:].strip(), out[-1][len('Checkers:'):].strip()
    def gives_check(self, fen, move):
        _, chk = self.display(fen, [move])
        return bool(chk)
    def board_after(self, fen, move):
        f, _ = self.display(fen, [move])
        return f.split(' ')[0].split('[')[0]
    def sweep(self, fen, depth):
        self.send('position fen ' + fen)
        self.send(f'xsweep {depth}')
        out = self.wait('xsweep depth')
        bad = int(out[-1].split()[-1])
        return bad, [l for l in out if l.startswith('BAD')]
    def close(self):
        try: self.send('quit'); self.p.wait(timeout=5)
        except Exception: self.p.kill()

passed = failed = 0
def ok(name, cond, extra=''):
    global passed, failed
    if cond: passed += 1
    else: failed += 1
    print(('PASS ' if cond else 'FAIL ') + name + (('  ' + str(extra)) if (extra and not cond) else ''))

def moveset(per): return set(per.keys())

def fixtures(E):
    E.set_variant('portal8')
    # ---- F1 the body and the tunnel: a1's line stops at a4, comes out of h5 and runs on to h8
    fen = '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}'
    per, n = E.perft(fen, 1)
    want = {'a1a2','a1a3','a1a4','a1h6','a1h7','a1h8','a1b1','a1c1','a1d1','e1d1','e1d2','e1e2','e1f1','e1f2'}
    ok('F1 body+tunnel: exactly the 14 moves (a5..a7 gone, h6..h8 through the tunnel)', moveset(per) == want, sorted(moveset(per) ^ want))
    ok('F1 a1h8 gives check through the tunnel', E.gives_check(fen, 'a1h8'))
    ok('F1 a1h7 gives no check', not E.gives_check(fen, 'a1h7'))
    ok('F1 a1a4 lands on h5', E.board_after(fen, 'a1a4') == '4k3/p7/8/7R/8/8/8/4K3', E.board_after(fen, 'a1a4'))
    ok('F1 a1h6 leaves the rook on h6', E.board_after(fen, 'a1h6') == '4k3/p7/7R/8/8/8/8/4K3', E.board_after(fen, 'a1h6'))
    # ---- F2 the plugged exit: no tunnel, the landing swaps with the plug
    fen = '4k3/p7/8/7n/8/8/8/R3K3[] w - - 0 1 {a4-h5}'
    per, n = E.perft(fen, 1)
    want = {'a1a2','a1a3','a1a4','a1b1','a1c1','a1d1','e1d1','e1d2','e1e2','e1f1','e1f2'}
    ok('F2 plugged exit: 11 moves, no tunnel', moveset(per) == want, sorted(moveset(per) ^ want))
    ok('F2 a1a4 swaps with the knight', E.board_after(fen, 'a1a4') == '4k3/p7/8/7R/n7/8/8/4K3', E.board_after(fen, 'a1a4'))
    # ---- F3 the plugged entry: capture on landing, teleport, no tunnel
    fen = '4k3/p7/8/8/n7/8/8/R3K3[] w - - 0 1 {a4-h5}'
    per, n = E.perft(fen, 1)
    ok('F3 plugged entry: 11 moves', moveset(per) == want, sorted(moveset(per) ^ want))
    ok('F3 a1a4 captures the knight and lands on h5', E.board_after(fen, 'a1a4') == '4k3/p7/8/7R/8/8/8/4K3', E.board_after(fen, 'a1a4'))
    # ---- F4 check through the tunnel; the through-pin
    fen = '8/6bk/8/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}'
    _, chk = E.display(fen)
    ok('F4 black is in check through the tunnel', bool(chk), chk)
    per, n = E.perft(fen, 1)
    want = {'h7g6','h7g8','g7h6','g7a1'}
    ok('F4 the 4 evasions: two king steps, the bishop blocks at h6 or takes the rook', moveset(per) == want, sorted(moveset(per) ^ want))
    fen = '7k/8/7b/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}'
    per, n = E.perft(fen, 1)
    want = {'h8g8','h8g7','h8h7'}
    ok('F4b the bishop on h6 is pinned through the tunnel: 3 king moves only', moveset(per) == want, sorted(moveset(per) ^ want))
    # ---- F5 discovered check through the tunnel: every bishop move off h6 gives check
    fen = '7k/1p6/7B/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}'
    per, n = E.perft(fen, 1)
    bish = {'h6g7','h6f8','h6g5','h6f4','h6e3','h6d2','h6c1'}
    want = bish | {'a1a2','a1a3','a1a4','a1b1','a1c1','a1d1','e1d1','e1d2','e1e2','e1f1','e1f2'}
    ok('F5 18 moves, the tunnel closed by the bishop', moveset(per) == want, sorted(moveset(per) ^ want))
    ok('F5 every bishop move discovers the check', all(E.gives_check(fen, m) for m in bish))
    ok('F5 a1a4 (rook to h5 under its own bishop) gives no check', not E.gives_check(fen, 'a1a4'))
    # ---- F6 stepping into the tunnel blocks; the body stops the rook's own line short of a1
    fen = 'r7/7k/8/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}'
    _, chk = E.display(fen)
    ok('F6 black in check', bool(chk))
    per, n = E.perft(fen, 1)
    want = {'h7g6','h7g7','h7g8','a8a4'}
    ok('F6 the 4 evasions: a8a4 lands on h5 and plugs the exit; a8a1 is not a move', moveset(per) == want, sorted(moveset(per) ^ want))
    ok('F6 a8a4 puts the rook on h5', E.board_after(fen, 'a8a4') == '8/7k/8/7r/8/8/8/R3K3', E.board_after(fen, 'a8a4'))
    # ---- F7 the chain through two pairs
    fen = '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-c6,c7-f2}'
    per, n = E.perft(fen, 1)
    want = {'a1a2','a1a3','a1c7','a1f3','a1f4','a1f5','a1f6','a1f7','a1f8','a1b1','a1c1','a1d1','e1d1','e1d2','e1e2','e1f1','e1f2'}
    ok('F7 chain: 17 moves, c8 never reached, f3..f8 through both pairs', moveset(per) == want, sorted(moveset(per) ^ want))
    ok('F7 a1f8 gives check', E.gives_check(fen, 'a1f8'))
    ok('F7 a1a3 lands on c6', E.board_after(fen, 'a1a3') == '4k3/p7/2R5/8/8/8/8/4K3', E.board_after(fen, 'a1a3'))
    ok('F7 a1c7 lands on f2', E.board_after(fen, 'a1c7') == '4k3/p7/8/8/8/8/5R2/4K3', E.board_after(fen, 'a1c7'))
    ok('F7 e1f2 (the king steps into the second pair) lands on c7', E.board_after(fen, 'e1f2') == '4k3/p1K5/8/8/8/8/8/R7', E.board_after(fen, 'e1f2'))
    # ---- F8 each pair once per line: the loop stops at the used pair
    fen = '7k/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-e5,e6-e3}'
    per, n = E.perft(fen, 1)
    want = {'a1a2','a1a3','a1e6','a1e4','a1e5','a1b1','a1c1','a1d1','e1d1','e1d2','e1e2','e1f1','e1f2'}
    ok('F8 cycle cap: 13 moves, a4..a8 and e7/e8 never reached', moveset(per) == want, sorted(moveset(per) ^ want))
    ok('F8 a1e5 (landing on the used pair) puts the rook on a3', E.board_after(fen, 'a1e5') == '7k/p7/8/8/8/R7/8/4K3', E.board_after(fen, 'a1e5'))
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
    # ---- F10 casts: a linking cast gives check through the new pair; one that exposes the caster is illegal
    fen = '8/1p5k/8/8/8/8/8/R3K3[OO] w - - 0 1 {a4w}'
    per, n = E.perft(fen, 1)
    ok('F10a O@h5 is a legal cast', 'O@h5' in per)
    ok('F10a O@h5 gives check through the new tunnel', E.gives_check(fen, 'O@h5'))
    ok('F10a O@g5 gives no check', not E.gives_check(fen, 'O@g5'))
    checks = {m for m in per if m.startswith('O@') and E.gives_check(fen, m)}
    ok('F10a exactly the h2..h6 casts give check', checks == {'O@h2','O@h3','O@h4','O@h5','O@h6'}, sorted(checks))
    per2, n2 = E.perft(fen, 1, ['O@h5'])
    ok('F10a after O@h5 black has the 3 king steps', moveset(per2) == {'h7g6','h7g7','h7g8'}, sorted(per2))
    fen = 'r2k4/8/8/8/7K/8/8/1R6[OO] w - - 0 1 {a5w}'
    per, n = E.perft(fen, 1)
    ok('F10b self-exposing casts h5/h6/h7 refused, c3 offered', not ({'O@h5','O@h6','O@h7'} & moveset(per)) and 'O@c3' in per, sorted(m for m in per if m.startswith('O@h')))
    ok('F10b 62 legal moves (43 casts + 5 king + 14 rook)', n == 62, n)
    # ---- v1 regressions that v2 keeps or changes as computed by hand
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
    ok('F14 a king may not step through onto an attacked exit: 21 moves, d2d3 refused, and d2c3 refused too (h7 attacks c3 through g7-d3)', n == 21 and 'd2d3' not in per and 'd2c3' not in per, (n, sorted(per)))
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
    # ---- the plain board: no pairs, node-identical to the build before (perft 4 on the v1 gate's opening)
    fen = 'r2qk2r/pp1bppb1/2np1np1/8/3P4/2N2N2/PPQ1PPPP/R3KB1R[] w - - 0 1'
    per, n = E.perft(fen, 3)
    ok('F17 plain board perft 3 (recorded for the identity check)', n > 0, n)
    print('F17 perft3 =', n)

def perft_deep(E, depth):
    """Perft at depth on every fixture position: the debug build's asserts do the checking."""
    E.set_variant('portal8')
    fens = ['4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}', '4k3/p7/8/7n/8/8/8/R3K3[] w - - 0 1 {a4-h5}',
            '8/6bk/8/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}', '7k/1p6/7B/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}',
            'r7/7k/8/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}', '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-c6,c7-f2}',
            '7k/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-e5,e6-e3}', '8/1p5k/8/8/8/8/8/R3K3[OO] w - - 0 1 {a4w}',
            'r2k4/8/8/8/7K/8/8/1R6[OO] w - - 0 1 {a5w}', 'r7/3p4/4k3/8/8/8/3P4/2R1K3[] w - - 0 1 {c3-e6}',
            'r2qk2r/pp1bppb1/2np1np1/8/3P4/2N2N2/PPQ1PPPP/R3KB1R[] w - - 0 1 {c4-f5,d5-g6}',
            '4k3/3p4/8/8/8/8/3P4/4K3[OOoo] w - - 0 1 {c3-f6}']
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
                  '8/1p5k/8/8/8/8/8/R3K3[OO] w - - 0 1 {a4w}', 'r2k4/8/8/8/7K/8/8/1R6[OO] w - - 0 1 {a5w}', 'r2qk2r/pp1bppb1/2np1np1/8/3P4/2N2N2/PPQ1PPPP/R3KB1R[OOoo] w - - 0 1 {c4-f5,d5-g6}']:
            sb, lines = E.sweep(f, 3)
            ok(f'xsweep 3 clean on {f}', sb == 0, lines[:5])
    if N:
        random_vs_oracle(E, N, sweep='--sweep' in args, seed=int(args[args.index('--seed') + 1]) if '--seed' in args else 7, pairs_boost=int(args[args.index('--pairs') + 1]) if '--pairs' in args else 0)
    if D:
        perft_deep(E, D)
    E.close()
    print(f'\nnative: {passed} passed, {failed} failed')
    sys.exit(1 if failed else 0)
