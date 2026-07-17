/**
 * Single-λ monitor signal vs deposited thickness (one layer).
 *
 * Varies layer `k`'s (1-based, storage order) thickness 0→dHi at λ = monRow.lambda
 * with previous layers fully grown; returns signal (%) vs thickness, plus the
 * target thickness. Optional Gaussian random noise (% of signal) for page 4.
 */

import { resolveMat }     from '../wizardShared.js';
import { mulberry32 }     from '../../../../utils/monitoring/monoSim.js';
import { systemSpectrum } from '../../../../utils/monitoring/depositionSpectrum.js';

export function monoSignalVsThickness({ layers, k, monRow, common, ctx, noisePct, nonce }) {
    const lam = monRow?.lambda || 550;
    const dTarget = layers[k - 1]?.thickness || 0;
    const dHi = Math.max(2 * dTarget, dTarget + 50);
    const NP = 70;
    const baseThicks = layers.map(l => l.thickness || 0);
    const frontDep = layers.map(l => ({ material: resolveMat(l.material) }));
    const rng = noisePct > 0 ? mulberry32((nonce | 0) + 17) : null;
    const ds = new Array(NP), ys = new Array(NP);
    for (let s = 0; s < NP; s++) {
        const d = (s / (NP - 1)) * dHi;
        const thicks = baseThicks.map((t, idx) => {
            const dep = idx + 1;
            if (dep < k) return t;
            if (dep === k) return d;
            return 0;
        });
        // In-chamber monitor signal: the active coating on a SEMI-INFINITE
        // substrate (no back surface), independent of the front/back/total mode.
        const r = systemSpectrum({
            evalMode: 'front',
            frontStored: frontDep.map((fd, idx) => ({ material: fd.material, thickness: thicks[idx] })),
            quantity: common.char, aoi: common.aoi, polarization: common.pol,
            lambdaStart: lam, lambdaEnd: lam, lambdaStep: 1,
            incidentMat: ctx.incidentMatActive, substrateMat: ctx.subMat,
        });
        let v = r.values[0];
        if (rng) {
            let u1 = rng(); while (u1 <= 1e-12) u1 = rng();
            const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng());
            v = v * (1 + g * noisePct / 100);
        }
        ds[s] = d; ys[s] = v * 100;
    }
    return { d: ds, signal: ys, dTarget, lam };
}
