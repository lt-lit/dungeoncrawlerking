#!/usr/bin/env python3
"""The forge's UCI test harness, shared by native-test.py (portals) and
native-test-ice.py (the ice): the Engine driver, the pass/fail tally."""
import subprocess, sys, re, os

HERE = os.path.dirname(os.path.abspath(__file__))
INI = os.path.join(HERE, 'portals-v2.ini')

class Engine:
    def __init__(self, path, variant='portal8', ini=INI):
        self.p = subprocess.Popen([path], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        self.send('uci'); self.wait('uciok')
        self.send(f'setoption name VariantPath value {ini}')
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
    def bestmove(self, fen, depth, moves=()):
        self.send('position fen ' + fen + (' moves ' + ' '.join(moves) if moves else ''))
        self.send(f'go depth {depth}')
        out = self.wait('bestmove')
        return out[-1].split()[1]
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

def report(label):
    print(f'\n{label}: {passed} passed, {failed} failed')
    sys.exit(1 if failed else 0)

