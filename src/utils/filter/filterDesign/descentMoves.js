/**
 * Improvement sweeps that move a spacer against its mirrors, the trade the
 * single-variable sweeps of localDescent.js cannot make.
 *
 * Macleod Eq. 8.24 and 8.25 (Thin-Film Optical Filters 5th ed., p. 266) give a
 * cavity's half-width as the mirror transmittance factor (n_L/n_H)^2x over
 * m + n_L/(n_H − n_L), m the spacer order. Raising m by one at constant
 * half-width therefore asks the mirrors on the two sides of that spacer for
 * ln((m + 1 + c)/(m + c)) / (2·ln(n_L/n_H)) fewer pairs, c = n_L/(n_H − n_L):
 * 0.7 layers for m = 1 → 2 at 2.20/1.45, 0.4 layers at 3 → 4, and about twice
 * that for a two-order step. A spacer step on its own halves that cavity's
 * linewidth and breaks the balance between the cavities, so it is uphill from
 * almost any seed and the plain sweep never takes it. Paired with the opposite
 * mirror step it is a move at roughly constant width, and that is the move
 * that reaches the higher-order designs.
 */

/** Accept a neighbour only when it improves the merit by more than round-off. */
export const better = (m2, mf) => m2 < mf - 1e-12;

/**
 * The compound move: one spacer by ±1 or ±2 orders, both adjacent mirrors by
 * one or two layers the other way. Stepping one side alone was tried as well
 * and gave worse designs in more time: on the 1530 nm specification with
 * seven restarts the two-sided set alone reached MF 0.43 to 0.57 in under
 * 20 s, the set with one-sided steps 0.45 to 0.63 in 26 to 30 s.
 */
const COMPOUND_MOVES = [];
for (const delta of [1, -1, 2, -2]) for (const step of [1, 2]) COMPOUND_MOVES.push({ delta, step });

/** The compound neighbour of spacer i for one move, or null when the clamps leave it in place. */
function compoundNeighbour(mirrors, spacers, i, { delta, step }, { clampMirror, clampOrder }) {
    const spa = spacers.slice(); spa[i] = clampOrder(spa[i] + delta);
    const mir = mirrors.slice();
    for (const s of [i, i + 1]) mir[s] = clampMirror(mir[s] - Math.sign(delta) * step);
    const moved = spa[i] !== spacers[i] && (mir[i] !== mirrors[i] || mir[i + 1] !== mirrors[i + 1]);
    return moved ? { mir, spa } : null;
}

/** One compound improvement sweep over every spacer. */
export function tryImproveCompound(mirrors, spacers, mf, ctx) {
    let improved = false;
    for (let i = 0; i < spacers.length; i++) {
        if (ctx.symCavities && i > Math.floor(spacers.length / 2)) continue;
        // The move steps mirrors i and i+1 together, so both have to sit in the
        // half symmetry keeps. Otherwise applySymmetry overwrites mirror i+1 on
        // the way into the merit and what gets scored is a one-sided step, not
        // the paired one this sweep exists to try.
        if (ctx.symMirrors && 2 * (i + 1) > mirrors.length - 1) continue;
        for (const move of COMPOUND_MOVES) {
            const cand = compoundNeighbour(mirrors, spacers, i, move, ctx);
            if (!cand) continue;
            const m2 = ctx.mfOf(cand.mir, cand.spa);
            if (better(m2, mf)) { mirrors = cand.mir; spacers = cand.spa; mf = m2; improved = true; }
        }
    }
    return { mirrors, spacers, mf, improved };
}

/**
 * The joint move: every spacer one order up or down together, with the inner
 * mirrors stepped one layer the other way. The same width trade as the
 * compound move applied to the whole filter at once, which carries a design
 * between the rows of the step-4 table without passing through the uphill
 * single-spacer steps in between. The two outer mirrors stay: they set the
 * match to the substrate and the incident medium (Thelen's condition,
 * couplingOrder), not a cavity's width.
 */
export function tryImproveJoint(mirrors, spacers, mf, { clampMirror, clampOrder, mfOf }) {
    let improved = false;
    const last = mirrors.length - 1;
    for (const delta of [1, -1]) {
        const spa = spacers.map((s) => clampOrder(s + delta));
        if (spa.every((s, i) => s === spacers[i])) continue;
        const mir = mirrors.map((g, i) => ((i === 0 || i === last) ? g : clampMirror(g - delta)));
        const m2 = mfOf(mir, spa);
        if (better(m2, mf)) { mirrors = mir; spacers = spa; mf = m2; improved = true; }
    }
    return { mirrors, spacers, mf, improved };
}
