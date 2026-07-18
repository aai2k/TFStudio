/**
 * Per-role candidate selection and combination enumeration for AR_TEMPLATES.
 */

// Candidate materials per role (capped). low = the perRole lowest-index
// materials; high = the perRole highest; med = the perRole closest to the
// geometric mean of the extremes. Combinations of these are enumerated by
// cartesianAssignments, so a bigger pool can only EXPAND the set of trios
// tried — it can never push the generator onto a worse fixed trio (the
// "adding materials made it worse" bug). rankSeeds() then refines all and
// keeps the best.
export function pickRoleCandidates(byN, perRole) {
    const lowCands  = byN.slice(0, perRole);
    const highCands = byN.slice(-perRole).reverse();
    let medCands = [];
    if (byN.length >= 3) {
        const target = Math.sqrt(byN[0].n * byN[byN.length - 1].n);
        medCands = byN.slice().sort((a, b) => Math.abs(a.n - target) - Math.abs(b.n - target)).slice(0, perRole);
    }
    return { low: lowCands, med: medCands, high: highCands };
}

// Cartesian product of material choices over the DISTINCT roles a template
// uses (each role capped at perRole → bounded combo count).
export function cartesianAssignments(usedRoles, roleCands) {
    let combos = [{}];
    for (const r of usedRoles) {
        const next = [];
        for (const c of combos) for (const m of roleCands[r]) next.push({ ...c, [r]: m });
        combos = next;
    }
    return combos;
}
