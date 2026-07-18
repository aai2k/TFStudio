/**
 * Build a filter target sampler. T should be 1 across the passband and 0 in the
 * rejection band; the transition between Δλp and Δλr is "don't care" (weight 0),
 * matching the pass/stop spec drawn at the 89.13 % and 0.1 % levels.
 *
 * @param {object} p
 * @param {number} p.lambda0_nm
 * @param {number} p.halfPass   half-width of the transmission band (nm)  [Δλ@89.13%]
 * @param {number} p.halfStop   half-width where rejection must hold (nm) [Δλ@0.1%]
 * @param {number} [p.stopSpan] how far beyond halfStop the stopband extends (nm)
 * @param {number} [p.passStep] passband sample spacing (nm)
 * @param {number} [p.stopStep] stopband sample spacing (nm)
 * @param {number} [p.edgeBoost] extra weight on the near-edge skirt (default 6)
 * @returns {{ lambda:number[], target:number[], weight:number[] }}
 *
 * The defining spec is the TWO half-widths: T≥89.13 % out to ±halfPass and
 * T≤0.1 % by ±halfStop. The skirt in between (halfPass→halfStop) is sampled too
 * — its target follows the passband on the inner part and the stopband on the
 * outer part — and the near-edge stopband ([halfStop, halfStop+skirt]) carries
 * `edgeBoost` extra weight so the integer search is rewarded for placing the
 * 0.1 % level exactly at ±halfStop instead of letting the skirt run wide.
 */
export function buildFilterTarget({
    lambda0_nm, halfPass, halfStop, stopSpan = null,
    passStep = null, stopStep = null, edgeBoost = 6,
}) {
    const skirt = Math.max(halfStop - halfPass, halfStop * 0.1);
    const ps = passStep || Math.max(halfPass / 8, 0.02);
    const ss = stopStep || Math.max(skirt / 12, 0.03);
    const span = stopSpan || Math.max(halfStop * 3, halfStop + 5 * halfPass);

    const acc = { lambda: [], target: [], weight: [] };
    addPassbandSamples(acc, lambda0_nm, halfPass, ps);
    addStopbandSamples(acc, { lambda0_nm, halfStop, skirt, span, ss, edgeBoost });
    bandBalanceWeights(acc.target, acc.weight);
    return acc;
}

/** Append passband samples (T=1, unit weight) across [λ₀−halfPass, λ₀+halfPass]. */
function addPassbandSamples(acc, lambda0_nm, halfPass, ps) {
    for (let x = lambda0_nm - halfPass; x <= lambda0_nm + halfPass + 1e-9; x += ps) {
        acc.lambda.push(x); acc.target.push(1); acc.weight.push(1);
    }
}

/**
 * Append stopband samples (T=0) on both sides from halfStop outward. Samples in
 * the near-edge skirt zone [halfStop, halfStop+skirt] carry `edgeBoost` extra
 * weight so the 0.1 % level pins to ±halfStop instead of letting the skirt run wide.
 */
function addStopbandSamples(acc, { lambda0_nm, halfStop, skirt, span, ss, edgeBoost }) {
    const edgeHi = halfStop + skirt;
    for (let side = -1; side <= 1; side += 2) {
        for (let off = halfStop; off <= span + 1e-9; off += ss) {
            const w = (off <= edgeHi) ? edgeBoost : 1;
            acc.lambda.push(lambda0_nm + side * off); acc.target.push(0); acc.weight.push(w);
        }
    }
}

/**
 * Band-balance the weights so the passband and stopband each carry equal TOTAL
 * weight (per-sample edgeBoost ratios inside the stopband are preserved).
 *
 * The stopband has ~10× more samples than the passband (it spans a much wider λ
 * range). With raw per-sample weights the merit function is dominated by the
 * stopband, so a discrete optimizer can lower the MF by COLLAPSING the passband
 * (a near-empty filter satisfies hundreds of stop samples while sacrificing only
 * a few pass samples). Balancing makes a true flat-top the merit minimum and
 * removes the "kill the passband" pathology.
 */
function bandBalanceWeights(target, weight) {
    let wp = 0, ws = 0;
    for (let i = 0; i < target.length; i++) (target[i] === 1 ? (wp += weight[i]) : (ws += weight[i]));
    for (let i = 0; i < weight.length; i++) {
        const denom = target[i] === 1 ? wp : ws;
        if (denom > 0) weight[i] /= denom;
    }
}
