import { nReal } from './nReal.js';
import { spectrumT } from './spectrum.js';

/** Mean transmittance over the passband for a layer list in a given medium. */
function passbandMeanT(layers, target, nInc, nSub) {
    let s = 0, n = 0;
    for (let i = 0; i < target.lambda.length; i++) {
        if (target.target[i] !== 1) continue;     // passband samples only
        s += spectrumT(layers, target.lambda[i], nInc, nSub); n++;
    }
    return n > 0 ? s / n : 0;
}

/** Peak T within ±3 nm of λ₀ for a layer list in a given medium. */
function peakTransmittance(layers, lambda0_nm, nInc, nSub) {
    let pk = 0;
    for (let lam = lambda0_nm - 3; lam <= lambda0_nm + 3; lam += 0.02) pk = Math.max(pk, spectrumT(layers, lam, nInc, nSub));
    return pk;
}

/** Best single AR layer (material + thickness) by passband mean T, scanning L and H. */
function search1LayerAR({ filterLayers, target, nInc, nSub, mkLayer, dHmax, dLmax, grid }) {
    let best = null;
    for (const tag of ['L', 'H']) {
        const dmax = tag === 'H' ? dHmax : dLmax;
        for (let gi = 1; gi <= grid; gi++) {
            const d = (gi / grid) * dmax;
            const layers = [mkLayer(tag, d), ...filterLayers];
            const meanT = passbandMeanT(layers, target, nInc, nSub);
            if (!best || meanT > best.meanT) best = { layers, arLayers: [mkLayer(tag, d)], meanT };
        }
    }
    return best;
}

/** Best (d1,d2) thickness pair for a 2-layer AR with materials fixed as t1(outer), t2(inner). */
function bestArPair(t1, t2, { filterLayers, target, nInc, nSub, mkLayer, d1max, d2max, grid }) {
    let best = null;
    for (let i = 1; i <= grid; i++) {
        const d1 = (i / grid) * d1max;
        for (let j = 1; j <= grid; j++) {
            const d2 = (j / grid) * d2max;
            // air-adjacent first: [t1(outer), t2(inner), ...filter]
            const ar = [mkLayer(t1, d1), mkLayer(t2, d2)];
            const layers = [...ar, ...filterLayers];
            const meanT = passbandMeanT(layers, target, nInc, nSub);
            if (!best || meanT > best.meanT) best = { layers, arLayers: ar, meanT };
        }
    }
    return best;
}

/** Best 2-layer "V" AR coating by passband mean T, scanning both material orderings. */
function search2LayerAR({ filterLayers, target, nInc, nSub, mkLayer, dHmax, dLmax, grid }) {
    let best = null;
    for (const [t1, t2] of [['H', 'L'], ['L', 'H']]) {
        const d1max = t1 === 'H' ? dHmax : dLmax;
        const d2max = t2 === 'H' ? dHmax : dLmax;
        const cand = bestArPair(t1, t2, { filterLayers, target, nInc, nSub, mkLayer, d1max, d2max, grid });
        if (!best || cand.meanT > best.meanT) best = cand;
    }
    return best;
}

/**
 * Transition an embedded filter design to the real incident medium (air) by
 * adding an antireflection coating on the incident side. (Step 6.)
 *
 * The integer search produced an embedded design (incident index = substrate).
 * In air the front surface reflects, depressing passband T. A No-AR / 1-layer /
 * 2-layer "V" coating restores it. The filter layers are taken in
 * incident→substrate order; AR layers are PREPENDED (air-adjacent).
 *
 * @param {object} p
 * @param {Array}  p.filterLayers   engine layers (incident→substrate), embedded design
 * @param {function} p.nH @param {function} p.nL @param {function} p.nInc @param {function} p.nSub
 * @param {number} p.lambda0_nm
 * @param {object} p.target          filter target (passband samples drive the AR)
 * @param {'none'|'1layer'|'vcoat'} p.mode
 * @param {number} [p.grid=48]       thickness grid resolution per layer
 * @returns {{ layers:Array, mode, meanT:number, peakT:number, arLayers:Array }}
 */
export function adjustToIncidentMedium({
    filterLayers, nH, nL, nInc, nSub, lambda0_nm, target, mode = 'vcoat', grid = 48,
}) {
    if (mode === 'none') {
        return {
            layers: filterLayers, mode, arLayers: [],
            meanT: passbandMeanT(filterLayers, target, nInc, nSub),
            peakT: peakTransmittance(filterLayers, lambda0_nm, nInc, nSub),
        };
    }

    const dHmax = lambda0_nm / (2 * nReal(nH, lambda0_nm));   // up to a half-wave
    const dLmax = lambda0_nm / (2 * nReal(nL, lambda0_nm));
    const mkLayer = (tag, d) => ({ tag: 'ar', nk: tag === 'H' ? nH : nL, n0: nReal(tag === 'H' ? nH : nL, lambda0_nm), d, arMat: tag });
    const searchArgs = { filterLayers, target, nInc, nSub, mkLayer, dHmax, dLmax, grid };

    const best = mode === '1layer' ? search1LayerAR(searchArgs) : search2LayerAR(searchArgs);
    return { ...best, mode, peakT: peakTransmittance(best.layers, lambda0_nm, nInc, nSub) };
}
