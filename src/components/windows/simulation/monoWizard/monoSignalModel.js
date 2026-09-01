/**
 * Single-λ monitor signal vs deposited thickness (one layer).
 *
 * Varies layer `k`'s (1-based, storage order) thickness 0→dHi at λ = monRow.lambda
 * with previous layers fully grown; returns signal (%) vs thickness, plus the
 * target thickness. Optional Gaussian random noise (% of signal) for the
 * Signal Errors page.
 */

import { mulberry32 }     from '../../../../utils/monitoring/monoSim.js';
import { systemSpectrum, flipLayerIndex } from '../../../../utils/monitoring/depositionSpectrum.js';

export function monoSignalVsThickness({ layers, k, monRow, common, ctx, noisePct, absPct = 0, nonce }) {
    // `k` counts deposition layers (1 = substrate-adjacent, grown first) while
    // `layers` is in storage order (air→substrate).
    const lam = monRow?.lambda || 550;
    const dTarget = layers[flipLayerIndex(layers.length, k)]?.thickness || 0;
    const dHi = Math.max(2 * dTarget, dTarget + 50);
    const NP = 70;
    // An even grid plus the exact target thickness: the axis tooltip snaps to
    // samples, and the target falls between two grid samples, so without its
    // own sample the readout could never land on the marked cut line.
    const dList = [];
    for (let s = 0; s < NP; s++) dList.push((s / (NP - 1)) * dHi);
    if (dTarget > 0 && !dList.includes(dTarget)) {
        dList.push(dTarget);
        dList.sort((a, b) => a - b);
    }
    const baseThicks = layers.map(l => l.thickness || 0);
    const frontDep = layers.map(l => ({ material: ctx.resolveMat(l.material) }));
    const rng = (noisePct > 0 || absPct > 0) ? mulberry32((nonce | 0) + 17) : null;
    const ds = [], ys = [];
    for (const d of dList) {
        const thicks = baseThicks.map((t, idx) => {
            const dep = flipLayerIndex(baseThicks.length, idx);
            if (dep < k) return t;
            if (dep === k) return d;
            return 0;
        });
        // In-chamber monitor signal: the witness chip as a plane-parallel slab,
        // the growing coating on its front face, its bare back face returning
        // light incoherently, both faces in the chamber medium. Independent of
        // the front/back/total mode.
        const r = systemSpectrum({
            evalMode: 'total',
            frontStored: frontDep.map((fd, idx) => ({ material: fd.material, thickness: thicks[idx] })),
            backStored: [],
            quantity: common.char, aoi: common.aoi, polarization: common.pol,
            lambdaStart: lam, lambdaEnd: lam, lambdaStep: 1,
            incidentMat: ctx.incidentMatActive, substrateMat: ctx.subMat,
            exitMat: ctx.incidentMatActive, substrateThk: ctx.subThk,
        });
        let v = r.values[0];
        if (rng) {
            const gauss = () => {
                let u1 = rng(); while (u1 <= 1e-12) u1 = rng();
                return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng());
            };
            // Relative noise scales with the reading; the absolute term is
            // the photometric floor, which does not.
            v = v * (1 + gauss() * noisePct / 100);
            if (absPct > 0) v += gauss() * absPct / 100;
        }
        ds.push(d); ys.push(v * 100);
    }
    return { d: ds, signal: ys, dTarget, lam };
}
