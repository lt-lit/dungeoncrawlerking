#!/usr/bin/env python3
"""xsweep (THE FORGE, scratch only): the engine's own consistency sweep as a UCI
command, added to a patched tree's uci.cpp for the native gate. Never vendored.

  python3 apply-xsweep.py <tree>/src
"""
import sys, os
SRC = sys.argv[1]
p = os.path.join(SRC, 'uci.cpp'); t = open(p).read()
anchor = 'void UCI::loop(int argc, char* argv[]) {'
code = '''// xsweep (THE FORGE, scratch only): the engine's own consistency sweep. Every
// pseudo-legal move to depth D: pseudo_legal() true for what movegen emits (a
// king's evasion onto an attacked square is generated and then refused by
// pseudo_legal's own filter - stock behaviour, skipped), legal() against the
// king's real fate after the move (present and not attacked), gives_check()
// against the real attackers of the enemy king, the incremental state against
// a fresh position from the FEN, and the undo. Findings print BAD lines; the
// last line is "xsweep depth D bad N".
namespace {
  int xsweep_bad = 0;
  void xsweep(Position& pos, int depth, const Variant* v, Thread* th) {
      if (depth == 0 || pos.is_immediate_game_end())
          return; // the search never generates a move on a finished board (a king in a pit, a strip)
      std::vector<Move> moves;
      if (pos.checkers())
          for (const auto& m : MoveList<EVASIONS>(pos)) moves.push_back(m);
      else
          for (const auto& m : MoveList<NON_EVASIONS>(pos)) moves.push_back(m);
      std::string before = pos.fen();
      for (Move m : moves)
      {
          if (!pos.pseudo_legal(m) && !(pos.checkers() && type_of(pos.moved_piece(m)) == KING))
          {
              sync_cout << "BAD pseudo_legal false for generated move " << UCI::move(pos, m) << " (type " << (type_of(m) >> (2 * SQUARE_BITS)) << ", checkers " << bool(pos.checkers()) << ") in " << before << sync_endl;
              ++xsweep_bad;
          }
          bool leg = pos.legal(m);
          bool gc = pos.gives_check(m);
          StateInfo st;
          pos.do_move(m, st, gc);
          Color us = ~pos.side_to_move();
          Color them = pos.side_to_move();
          bool kingGone = !pos.count<KING>(us);
          bool attacked = !kingGone && pos.attackers_to(pos.square<KING>(us), them);
          bool realLegal = !kingGone && !attacked;
          // a pass's legality is the rule's (the frozen side's, the fizzle's), not the king's
          if (leg != realLegal && !is_pass(m))
          {
              sync_cout << "BAD legal " << leg << " real " << realLegal << " (kingGone " << kingGone << ") move " << UCI::move(pos, m) << " in " << before << sync_endl;
              ++xsweep_bad;
          }
          bool realCheck = pos.count<KING>(them) && pos.attackers_to(pos.square<KING>(them), us);
          if (gc != realCheck)
          {
              sync_cout << "BAD gives_check " << gc << " real " << realCheck << " move " << UCI::move(pos, m) << " in " << before << sync_endl;
              ++xsweep_bad;
          }
          {
              Position p2;
              StateInfo st2;
              std::string f = pos.fen();
              p2.set(v, f, false, &st2, th);
              if (p2.key() != pos.key() || p2.material_key() != pos.material_key() || p2.pawn_key() != pos.pawn_key()
                  || p2.fen() != f || p2.checkers() != pos.checkers() || p2.non_pawn_material(WHITE) != pos.non_pawn_material(WHITE)
                  || p2.non_pawn_material(BLACK) != pos.non_pawn_material(BLACK))
              {
                  sync_cout << "BAD state after " << UCI::move(pos, m) << " in " << before << " -> " << f << " (fresh " << p2.fen() << ")" << sync_endl;
                  ++xsweep_bad;
              }
          }
          if (leg)
              xsweep(pos, depth - 1, v, th);
          pos.undo_move(m);
          if (pos.fen() != before)
          {
              sync_cout << "BAD undo of " << UCI::move(pos, m) << " gives " << pos.fen() << " not " << before << sync_endl;
              ++xsweep_bad;
          }
      }
  }
}

void UCI::loop(int argc, char* argv[]) {'''
assert t.count(anchor) == 1; t = t.replace(anchor, code)
anchor2 = '''      else if (token == "d")        sync_cout << pos << sync_endl;'''
code2 = '''      else if (token == "d")        sync_cout << pos << sync_endl;
      else if (token == "xsweep")
      {
          int d = 2;
          is >> d;
          xsweep_bad = 0;
          xsweep(pos, d, pos.variant(), Threads.main());
          sync_cout << "xsweep depth " << d << " bad " << xsweep_bad << sync_endl;
      }'''
assert t.count(anchor2) == 1; t = t.replace(anchor2, code2)
open(p, 'w').write(t); print('xsweep added')
