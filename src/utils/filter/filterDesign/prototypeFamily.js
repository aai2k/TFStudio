import { nReal } from './nReal.js';
import { buildPrototypeLayers } from './prototypeLayers.js';
import { embeddedT } from './spectrum.js';
import { measureWidth } from './bandwidth.js';
import { oddUp, couplingOrder, coupledMirrors } from './coupledPrototype.js';

/**
 * Build the step-4 equivalent-prototype table: a set of (ext. mirror
 * layers m, spacer order k) pairs whose COUPLED N-cavity prototype all have
 * approximately the TARGET passband width. There are two ways to hit a given
 * width — stronger mirrors + low spacer order, or weaker mirrors + high spacer
 * order — so the table trades m against k at constant width.
 *
 * Adapts to the target: the Thelen row (k=1) is the strongest mirror m whose
 * k=1 prototype is still ≥ the target width; weaker mirrors below it use higher
 * k. A narrow filter yields large m (many rows); a wide filter yields small m
 * (few rows). Validated against LEC25D9 (target ~3 nm → m up to 8, k 1/5/16/…).
 *
 * @param {number} p.targetFWHM   desired passband full width (nm) ≈ 2·halfPass
 * @returns {{notationM, spacerOrder, width, mirrorLayers}[]}  strongest→weakest
 */
export function buildPrototypeFamily({
    nH, nL, nSub, lambda0_nm, spacerKind = 'L', cavities = 4,
    targetFWHM = 3, level = 0.5, mCap = 14, maxOrder = 400, maxRows = 9,
}) {
    const N = Math.max(1, Math.round(cavities));
    const span = Math.max(targetFWHM * 2, 5);
    const step = Math.max(targetFWHM / 60, 0.03);
    const d = couplingOrder(nReal(nH, lambda0_nm), nReal(nL, lambda0_nm), nReal(nSub, lambda0_nm));
    const cache = new Map();
    // Width (at `level`) of the coupled N-cavity prototype for (m, k).
    const widthOf = (m, k) => {
        const key = m * 100000 + k;
        if (cache.has(key)) return cache.get(key);
        const lay = buildPrototypeLayers({ nH, nL, lambda0_nm, mirrors: coupledMirrors(N, m, d), spacers: new Array(N).fill(k), spacerKind });
        const pk = embeddedT(lay, lambda0_nm, nSub);
        const w = measureWidth(lay, lambda0_nm, level * Math.max(pk, 1e-6), nSub, { span, step });
        cache.set(key, w);
        return w;
    };
    // Bisect for integer k whose width ≈ targetFWHM (width decreasing in k).
    const bisectK = (m) => {
        if (!(widthOf(m, 1) > targetFWHM)) return 1;     // even k=1 already ≤ target
        let lo = 1, hi = 2;
        while (hi < maxOrder && widthOf(m, hi) > targetFWHM) { lo = hi; hi *= 2; }
        hi = Math.min(hi, maxOrder);
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (widthOf(m, mid) > targetFWHM) lo = mid; else hi = mid;
        }
        return Math.abs(widthOf(m, lo) - targetFWHM) <= Math.abs(widthOf(m, hi) - targetFWHM) ? lo : hi;
    };

    // Thelen row: the largest m whose k=1 prototype is still ≥ target width.
    // width(m,1) decreases with m, so scan up until it drops below target.
    let mThelen = 1;
    for (let m = 1; m <= mCap; m++) {
        if (widthOf(m, 1) >= targetFWHM) mThelen = m; else break;
    }
    // Rows: m from mThelen down to 1 (each bisects k for the target width).
    const rows = [];
    const lo = Math.max(1, mThelen - maxRows + 1);
    for (let m = mThelen; m >= lo; m--) {
        const k = bisectK(m);
        rows.push({ notationM: m, mirrorLayers: oddUp(m), spacerOrder: k, width: widthOf(m, k) });
    }
    return rows;
}
