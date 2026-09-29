// The children of a search round (giga4.c 96-168, 732-796): each drawn move
// destroyed on this thread and looked up in the memo of children already run
// and among the round's earlier children; the rest run on run.runner, repeats
// take the kept result, and what ran goes into the memo and onto the run's
// trace, all in child order.

import { sameBits } from './design.js';
import { push } from './trace.js';
import { REPAIRS, destroy } from './moves.js';

const R_PAIR = REPAIRS.indexOf('pair');
const R_REFINE = REPAIRS.indexOf('refine');

// ── Memo of children run (giga4.c 96-168) ────────────────────────────────────

// giga4.c memo_key 135-139: what a child's outcome depends on beyond its
// destroyed design: the repair, its window (not for refine) and the spacer
// (pair only).
export function memoKey(move, k0, k1) {
    const refine = move.repair === R_REFINE;
    return {
        repair: move.repair, k0: refine ? 0 : k0, k1: refine ? 0 : k1,
        spacer: move.repair === R_PAIR ? move.spacer : 0,
    };
}

const REFINE_KEY = Object.freeze({ repair: R_REFINE, k0: 0, k1: 0, spacer: 0 });

const sameKey = (a, b) => a.repair === b.repair && a.k0 === b.k0 && a.k1 === b.k1 && a.spacer === b.spacer;

// giga4.c memo_find 141-147: the entry of a destroyed design (bit for bit)
// under a key, or -1. memo: Array<{ dst, key, out: { layers, mf } }>.
export function memoFind(memo, dst, key) {
    return memo.findIndex(e => sameKey(e.key, key) && sameBits(e.dst, dst));
}

// ── One round's children ─────────────────────────────────────────────────────

// giga4.c 749-755: the first earlier child of this round with the same key and
// destroyed design, among those that run; -1 when none.
function earlierTwin(kids, kid) {
    return kids.findIndex(j => j.src < 0 && j.dup < 0 && sameKey(j.key, kid.key) && sameBits(j.dst, kid.dst));
}

// giga4.c 757-760: a carve or pair child starts from its destroyed design's
// kept refinement when that has a finite merit.
function keptRefinement(s, kid) {
    if (kid.move.repair === R_REFINE) return null;
    const e = memoFind(s.memo, kid.dst, REFINE_KEY);
    return e >= 0 && Number.isFinite(s.memo[e].out.mf) ? s.memo[e].out : null;
}

// giga4.c 732-762: each move destroyed on this thread, with src (the memo
// entry it repeats), dup (the earlier child it repeats) and pre.
export function destroyRound(s, { moves, bound }) {
    const kids = [];
    for (const move of moves) {
        const d = destroy(s.ev, s.inc.layers, move, { bound, points: s.points });
        const key = memoKey(move, d.k0, d.k1);
        const kid = { move, dst: d.layers, k0: d.k0, k1: d.k1, key, src: memoFind(s.memo, d.layers, key), dup: -1 };
        if (kid.src < 0) kid.dup = earlierTwin(kids, kid);
        kid.pre = kid.src < 0 && kid.dup < 0 ? keptRefinement(s, kid) : null;
        kids.push(kid);
    }
    return kids;
}

const runsNow = kid => kid.src < 0 && kid.dup < 0;

// giga4.c 763-765: the children that run, on the runner, in child order.
export async function runChildren(s, run, kids) {
    const todo = kids.filter(runsNow);
    const items = todo.map(k => ({
        kind: REPAIRS[k.move.repair], dst: k.dst, k0: k.k0, k1: k.k1, spacer: k.move.spacer, pre: k.pre, fit: true,
    }));
    const results = items.length > 0 ? await run.runner.child(s.ev, items) : [];
    todo.forEach((k, i) => {
        k.out = { layers: results[i].layers, mf: results[i].mf };
        k.ref = results[i].ref;
    });
}

// giga4.c 766-772: repeats take the kept result.
export function resolveRepeats(s, kids) {
    for (const k of kids) {
        if (runsNow(k)) continue;
        k.out = k.src >= 0 ? s.memo[k.src].out : kids[k.dup].out;
        s.repeats++;
    }
}

// giga4.c 773-783: what ran is kept in child order, and a carve or pair
// child's refinement of its destroyed design as a refine child's result.
export function keepResults(s, kids) {
    for (const k of kids.filter(runsNow)) {
        s.memo.push({ dst: k.dst, key: k.key, out: k.out });
        if (k.move.repair === R_REFINE || !k.ref || memoFind(s.memo, k.dst, REFINE_KEY) >= 0) continue;
        s.memo.push({ dst: k.dst, key: REFINE_KEY, out: k.ref });
    }
}

// giga4.c 784-796: every child with a finite merit on the run's trace.
export function traceChildren(run, kids) {
    for (const k of kids) if (Number.isFinite(k.out.mf)) push(run.log.trace, k.out.mf, k.out.layers.length);
}
