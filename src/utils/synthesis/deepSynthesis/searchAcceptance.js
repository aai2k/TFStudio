// The acceptance rule of the search (giga4.c 798-945): record-to-record
// travel over a round's results in child order, with a deviation that falls
// over the run (the starting one for a stale chain); a chain away from its
// record that accepts nothing goes back to it; and every `segment` rounds the
// operator weights move toward the scores the children earned.

import { sameDesign } from './design.js';
import { GAIN_TOL } from './needleHelpers.js';
import { DESTROYS, REPAIRS } from './moves.js';

// A design as the chain holds it: its layers and merit.
export const held = d => ({ layers: d.layers, mf: d.mf });
// One value per destroy and per repair operator, in DESTROYS and REPAIRS order.
export const perOperator = value => ({ destroy: DESTROYS.map(() => value), repair: REPAIRS.map(() => value) });

// ── Acceptance (giga4.c 798-921) ─────────────────────────────────────────────

// giga4.c 798-819 and 885 (rrt_zero): the deviation falls from rrt to 0 over
// the rounds; a stale chain accepts by rrt. The C's FR (1 + t)^2 on F is
// rec.mf (1 + t) on MF.
function levels(s) {
    const { rrt, rounds, stale } = s.o;
    const t = rrt * (rounds > 1 ? 1 - s.round / (rounds - 1) : 0);
    const tc = s.stay >= stale ? rrt : t;
    return { accept: s.rec.mf * (1 + tc), falling: s.rec.mf * (1 + t) };
}

// giga4.c 827-831: a child that comes back to the incumbent, or to a design the
// chain went back to its record from, is no move.
function isMove(s, c) {
    if (!Number.isFinite(c.mf) || sameDesign(s.ev.nRef, c, s.inc)) return false;
    return !s.gone.some(g => sameDesign(s.ev.nRef, g, c));
}

// giga4.c 834-840: below the record, below the incumbent, within the level.
function childScore(s, c, accept) {
    if (c.mf < s.rec.mf * (1 - GAIN_TOL)) return s.o.scoreBest;
    if (c.mf < s.inc.mf * (1 - GAIN_TOL)) return s.o.scoreBetter;
    return c.mf <= accept ? s.o.scoreAccepted : 0;
}

function countOperators(counts, move, value) {
    counts.destroy[move.destroy] += value;
    counts.repair[move.repair] += value;
}

// giga4.c 822-843: every child counts a use of its operators; the moves score
// and the lowest merit among them is the round's best, ties to the earlier.
function scoreChildren(s, results, accept) {
    let best = -1;
    results.forEach((c, i) => {
        countOperators(s.uses, c.move, 1);
        if (!isMove(s, c)) return;
        if (best < 0 || c.mf < results[best].mf) best = i;
        countOperators(s.score, c.move, childScore(s, c, accept));
    });
    return best;
}

// giga4.c 895-902: the chain moves to the child.
function acceptChild(s, c, falling) {
    if (c.mf > falling) s.restarted++;
    s.inc = held(c);
    s.stay = 0;
    s.accepted++;
    s.atRec = sameDesign(s.ev.nRef, s.inc, s.rec);
    if (s.atRec) s.stay = s.rrec;
}

// giga4.c 903-910: back to the record; the incumbent left is no move from now on.
function returnToRecord(s) {
    s.gone.push(s.inc);
    s.inc = s.rec;
    s.stay = s.rrec;
    s.atRec = true;
    s.returned++;
}

// giga4.c 883-910: the round's best child below the record becomes the
// record; within the accept level it becomes the incumbent; otherwise a chain
// away from its record goes back to it.
function moveChain(s, c, lv) {
    s.stay++;
    if (s.atRec) s.rrec++;
    if (c && c.mf < s.rec.mf * (1 - GAIN_TOL)) {
        s.rec = held(c);
        s.rrec = 0;
    }
    if (c && c.mf <= lv.accept) acceptChild(s, c, lv.falling);
    else if (!s.atRec) returnToRecord(s);
}

// giga4.c 798-910 for one round of results ({ move, layers, mf } in child
// order): scores, a new best below best.mf (1 - GAIN_TOL), then the chain's
// move. Returns the round's best child (-1 for none) and whether it is a new best.
export function judgeRound(s, results) {
    const lv = levels(s);
    const best = scoreChildren(s, results, lv.accept);
    const c = best >= 0 ? results[best] : null;
    s.since++;
    const newBest = !!c && c.mf < s.best.mf * (1 - GAIN_TOL);
    if (newBest) {
        Object.assign(s, { best: held(c), since: 0, rb: s.round });
        countOperators(s.newBests, c.move, 1);
    }
    moveChain(s, c, lv);
    return { best, newBest };
}

// ── Operator weights (giga4.c 936-945) ───────────────────────────────────────

// giga4.c 936-945: every `segment` rounds each operator used moves its weight
// toward its mean score; scores and uses start again.
export function reweigh(s) {
    const { segment, react } = s.o;
    if ((s.round + 1) % Math.max(1, segment) !== 0) return;
    const blend = kind => s.weights[kind].map((w, i) => {
        const uses = s.uses[kind][i];
        return uses ? (1 - react) * w + react * s.score[kind][i] / uses : w;
    });
    s.weights = { destroy: blend('destroy'), repair: blend('repair') };
    s.score = perOperator(0);
    s.uses = perOperator(0);
}
