/**
 * Interface roughness as transition layers (src/utils/physics/scattering.js).
 *
 * References: Macleod, Thin-Film Optical Filters, 5th ed., §16, p. 626;
 * C. K. Carniglia and D. G. Jensen, Appl. Opt. 41, 3167 (2002);
 * C. Guo et al., Opt. Lett. 38, 40 (2013), Eq. 1.
 *
 * Tests:
 *   1) Carniglia-Jensen n and k (Eqs. 16, 42, 43) in closed form, symmetric in
 *      the two neighbours, k proportional to σ and to 1/λ; Guo's air/film form
 *   2) One surface through the TMM: the layer reproduces scalar-scattering ΔR
 *      and ΔT (Eqs. 4, 6) for light from either side
 *   3) transitionLayers: 2σ in total; the graded profile runs from the
 *      substrate-side material to the other
 *   4) roughenFrontStack: thickness taken from the layer beneath each
 *      interface, nothing from the substrate, interface order as the editor lists
 *   5) roughenBackStack: the same rule for a stack stored substrate-first
 *   6) A layer thinner than the transition layer is set to zero and reported
 *  6b) A layer of zero thickness has no interfaces of its own: the layer
 *      beneath meets the next layer that is there
 *   7) resolveSigmas / resolveRanges, including the per-interface fallback
 *   8) extrapolateSlicing: exact on a 1/N² error, and on a graded layer much
 *      closer to the continuous profile than twice the slices
 *   9) spec defaults, cloning, interface count
 *
 * Run: node tests/scattering.mjs
 */

import {
    carnigliaJensenNK, longRangeMaterial, transitionLayers, roughenFrontStack, roughenBackStack,
    extrapolateSlicing, emptyRoughness, cloneRoughness, resolveSigmas, resolveRanges,
    countInterfaces, ROUGHNESS_RANGES,
} from '../src/utils/physics/scattering.js';
import { evaluateSpectrumAt } from '../src/utils/physics/thinFilmMath.js';
import { buildGradedSlices } from '../src/utils/physics/inhomogeneity.js';

let fails = 0;
const ok   = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const near = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol;
const mat  = (id, n, k = 0) => ({ id, getNK: () => [n, k] });
const sum  = layers => layers.reduce((s, l) => s + l.thickness, 0);

// ── 1) Carniglia-Jensen n and k ────────────────────────────────────────────
{
    const na = 1.0, ns = 1.52, sigma = 3, lam = 550;
    const [n, k] = carnigliaJensenNK(na, ns, sigma, lam);
    const nRef = Math.sqrt((na * na + ns * ns) / 2);
    const kRef = Math.PI * (na - ns) ** 2 * (na + ns) * (2 * sigma) / (4 * nRef * lam);
    ok(near(n, nRef, 1e-15), `CJ n = sqrt((na²+ns²)/2) (got ${n})`);
    ok(near(k, kRef, 1e-18), `CJ k = π(na-ns)²(na+ns)d/(4nλ) (got ${k})`);
    const [n2, k2] = carnigliaJensenNK(ns, na, sigma, lam);
    ok(n2 === n && near(k2, k, 1e-18), 'CJ layer is the same whichever side the light comes from');
    ok(near(carnigliaJensenNK(na, ns, 2 * sigma, lam)[1] / k, 2, 1e-12), 'k ∝ σ');
    ok(near(carnigliaJensenNK(na, ns, sigma, 2 * lam)[1] / k, 0.5, 1e-12), 'k ∝ 1/λ');
    const [nSame, kSame] = carnigliaJensenNK(1.46, 1.46, sigma, lam);
    ok(near(nSame, 1.46, 1e-15) && kSame === 0, 'no index step: the layer is the host material');
    // Guo et al. Eq. 1, air over a film of index no:
    // n1 = [(1 + no²)/2]^½, k1 = π(1 - no)²(1 + no) d1 / (4 n1 λ), d1 = 2σ
    const no = 1.38;
    const n1 = Math.sqrt((1 + no * no) / 2);
    const k1 = Math.PI * (1 - no) ** 2 * (1 + no) * (2 * sigma) / (4 * n1 * lam);
    const [nG, kG] = carnigliaJensenNK(1, no, sigma, lam);
    ok(near(nG, n1, 1e-15) && near(kG, k1, 1e-18), 'matches Guo et al. Eq. 1');
    // The material form follows the neighbours' dispersion through their real parts.
    const absorbing = { id: 'm', getNK: lam_ => [2 + lam_ / 1000, 3] };
    const lm = longRangeMaterial(mat('air', 1), absorbing, sigma);
    const [nm, km] = lm.getNK(600);
    const [nx, kx] = carnigliaJensenNK(1, 2.6, sigma, 600);
    ok(near(nm, nx, 1e-15) && near(km, kx, 1e-18), 'longRangeMaterial uses real parts at each λ');
}

// ── 2) One surface: scalar scattering, both directions ─────────────────────
{
    const air = mat('air', 1), glass = mat('glass', 1.52);
    const params = { theta: 0, polarization: 'avg' };
    const sigma = 1;
    const lams = [400, 550, 800];
    for (const [inc, sub] of [[air, glass], [glass, air]]) {
        const na = inc.getNK()[0], ns = sub.getNK()[0];
        const layer = transitionLayers(inc, sub, sigma, 'long');
        const smooth = evaluateSpectrumAt(lams, params, inc, sub, []);
        const rough = evaluateSpectrumAt(lams, params, inc, sub, layer);
        lams.forEach((lam, i) => {
            const dRs = -smooth.R[i] * (4 * Math.PI * na * sigma / lam) ** 2;
            const dTs = -smooth.T[i] * (2 * Math.PI * (na - ns) * sigma / lam) ** 2;
            const dR = rough.R[i] - smooth.R[i];
            const dT = rough.T[i] - smooth.T[i];
            // Agreement to terms in (σ/λ)²; the residue at σ = 1 nm is ~1e-3.
            ok(Math.abs(dR / dRs - 1) < 2e-3, `n_a=${na}: ΔR = -R0(4π n_a σ/λ)² at ${lam} nm (${dR} vs ${dRs})`);
            ok(Math.abs(dT / dTs - 1) < 2e-3, `n_a=${na}: ΔT = -T0[2π(n_a-n_s)σ/λ]² at ${lam} nm (${dT} vs ${dTs})`);
        });
    }
}

// ── 3) transitionLayers ─────────────────────────────────────────────────────
{
    const A = mat('A', 2.0), B = mat('B', 1.5);
    const graded = transitionLayers(A, B, 2.5, 'short', 10);
    ok(graded.length === 10 && near(sum(graded), 5, 1e-12), 'short: 10 slices, 2σ in total');
    ok(near(graded[0].material.getNK(500)[0], 2.0 - 0.5 * 0.05, 1e-12), 'short: first slice next to the substrate-side material');
    ok(near(graded[9].material.getNK(500)[0], 1.5 + 0.5 * 0.05, 1e-12), 'short: last slice next to the other material');
    const single = transitionLayers(A, B, 2.5, 'long', 10);
    ok(single.length === 1 && single[0].thickness === 5, 'long: one layer 2σ thick');
    ok(transitionLayers(A, B, 0, 'long', 10).length === 0, 'σ = 0: no layer');
    ok(transitionLayers(A, B, NaN, 'short', 10).length === 0, 'σ not a number: no layer');
    ok(ROUGHNESS_RANGES.join() === 'short,long', 'two kinds of roughness');
}

// ── 4) Front stack: air-first, interface 0 at the incident medium ──────────
{
    const I = mat('I', 1), A = mat('A', 2.3), B = mat('B', 1.45), S = mat('S', 1.52);
    const layers = [{ material: A, thickness: 100 }, { material: B, thickness: 80 }];
    const { layers: out, thinned } = roughenFrontStack(layers, { incident: I, substrate: S },
        { sigmas: [1, 2, 3], ranges: ['long', 'long', 'long'] }, 16);
    ok(out.length === 5, `front: 2 layers + 3 transition layers (got ${out.length})`);
    ok(near(out[0].thickness, 2) && near(out[2].thickness, 4) && near(out[4].thickness, 6),
        'front: transition layers 2σ thick, in editor order from the incident medium');
    ok(out[1].material === A && near(out[1].thickness, 98), 'front: A gives up 2σ to the interface above it');
    ok(out[3].material === B && near(out[3].thickness, 76), 'front: B gives up 2σ to the interface above it');
    ok(near(sum(out), 186, 1e-12), 'front: total grows only by the transition on the substrate');
    ok(near(out[0].material.getNK(550)[0], Math.sqrt((1 + 2.3 ** 2) / 2), 1e-15), 'front: first transition sits between medium and A');
    ok(near(out[4].material.getNK(550)[0], Math.sqrt((1.45 ** 2 + 1.52 ** 2) / 2), 1e-15), 'front: last transition sits between B and substrate');
    ok(thinned.length === 0, 'front: nothing thinned to zero');
    ok(layers[0].thickness === 100 && layers[1].thickness === 80, 'front: input layers untouched');
    // Short range: in the air-first list the slices run from the air side down.
    const graded = roughenFrontStack(layers, { incident: I, substrate: S },
        { sigmas: [0, 2, 0], ranges: ['short', 'short', 'short'] }, 4).layers;
    ok(graded.length === 6 && near(graded[0].thickness, 100) && near(graded[5].thickness, 76),
        'front short: A untouched above a smooth interface, B thinned by 2σ');
    const slice = i => graded[1 + i].material.getNK(550)[0];
    ok(slice(0) > slice(3) && near(slice(0), 2.3 + (1.45 - 2.3) * 0.125, 1e-12),
        'front short: the slice next to A comes first');
}

// ── 5) Back stack: substrate-first, interface 0 at the substrate ───────────
{
    const S = mat('S', 1.52), E = mat('E', 1), C = mat('C', 2.1), D = mat('D', 1.38);
    const layers = [{ material: C, thickness: 50 }, { material: D, thickness: 60 }];
    const { layers: out } = roughenBackStack(layers, { substrate: S, exit: E },
        { sigmas: [1, 1, 1], ranges: ['long', 'long', 'long'] }, 16);
    ok(out.length === 5 && out[1].material === C && out[3].material === D, 'back: order kept substrate-first');
    ok(near(out[1].thickness, 48) && near(out[3].thickness, 58), 'back: each layer gives up 2σ to the interface above it');
    ok(near(out[0].material.getNK(550)[0], Math.sqrt((1.52 ** 2 + 2.1 ** 2) / 2), 1e-15), 'back: first transition sits on the substrate');
    ok(near(out[4].material.getNK(550)[0], Math.sqrt((1.38 ** 2 + 1) / 2), 1e-15), 'back: last transition faces the exit medium');
}

// ── 6) A layer thinner than its transition layer ───────────────────────────
{
    const I = mat('I', 1), A = mat('A', 2.3), B = mat('B', 1.45), S = mat('S', 1.52);
    const layers = [{ material: A, thickness: 100 }, { material: B, thickness: 3 }];
    const { layers: out, thinned } = roughenFrontStack(layers, { incident: I, substrate: S },
        { sigmas: [1, 2, 1], ranges: ['long', 'long', 'long'] }, 16);
    ok(out[3].thickness === 0, 'thin layer set to zero thickness, never negative');
    ok(thinned.length === 1 && thinned[0] === 1, `thinned reports air-first index 1 (got ${thinned})`);
}

// ── 6b) A layer of zero thickness is not in the coating ────────────────────
{
    const I = mat('I', 1), A = mat('A', 2.3), B = mat('B', 1.45), C = mat('C', 1.8), S = mat('S', 1.52);
    const lams = [450, 550, 650];
    const rough = (layers, sigmas) => roughenFrontStack(layers, { incident: I, substrate: S },
        { sigmas, ranges: sigmas.map(() => 'long') }, 16);
    const spectrum = layers => evaluateSpectrumAt(lams, { theta: 0, polarization: 'avg' }, I, S, layers);
    // 60 nm A, 0 nm B, 60 nm A is one 120 nm A layer, with no interface where B would be.
    const split = rough([{ material: A, thickness: 60 }, { material: B, thickness: 0 }, { material: A, thickness: 60 }], [1, 1, 1, 1]);
    const whole = rough([{ material: A, thickness: 120 }], [1, 1]);
    const a = spectrum(split.layers), b = spectrum(whole.layers);
    ok(lams.every((_, i) => near(a.R[i], b.R[i], 1e-12) && near(a.T[i], b.T[i], 1e-12)),
        `zero-thickness layer: same R and T as the merged layer (ΔR at 550 nm ${a.R[1] - b.R[1]})`);
    ok(split.thinned.length === 0, `zero-thickness layer: not reported as thinned (got ${split.thinned})`);
    // Across a missing layer, C (beneath) meets A through the interface on top of C.
    const bridged = rough([{ material: A, thickness: 60 }, { material: B, thickness: 0 }, { material: C, thickness: 80 }], [0, 5, 2, 0]);
    const kept = bridged.layers.filter(l => l.thickness > 0);
    ok(kept.length === 3 && near(kept[1].thickness, 4) && near(kept[2].thickness, 76),
        `missing layer: one transition, 2σ of the interface on top of C (got ${kept.map(l => l.thickness)})`);
    ok(kept.length === 3 && near(kept[1].material.getNK(550)[0], Math.sqrt((2.3 ** 2 + 1.8 ** 2) / 2), 1e-15),
        'missing layer: the transition sits between C and A');
}

// ── 7) resolveSigmas / resolveRanges ───────────────────────────────────────
{
    const uni = resolveSigmas({ mode: 'uniform', sigma: 1.5 }, 4);
    ok(uni.length === 4 && uni.every(s => s === 1.5), 'resolveSigmas uniform: 4 × 1.5');
    const per = resolveSigmas({ mode: 'perInterface', sigma: 0.7, sigmas: [1, 2, 3] }, 3);
    ok(per.join() === '1,2,3', 'resolveSigmas perInterface: own values');
    // An interface without its own value takes the uniform σ the editor shows for it.
    const short = resolveSigmas({ mode: 'perInterface', sigma: 0.7, sigmas: [1, null] }, 4);
    ok(short.join() === '1,0.7,0.7,0.7', `resolveSigmas perInterface: missing entries take σ (got ${short})`);
    ok(resolveSigmas(null, 3).join() === '0,0,0', 'resolveSigmas null → zeros');

    ok(resolveRanges({ mode: 'uniform', range: 'short' }, 3).join() === 'short,short,short', 'resolveRanges uniform');
    ok(resolveRanges({ mode: 'perInterface', range: 'short', ranges: ['long', 'bogus'] }, 3).join() === 'long,short,short',
        'resolveRanges perInterface: missing or unknown entries take the uniform kind');
    ok(resolveRanges({ mode: 'uniform' }, 2).join() === 'long,long', 'resolveRanges: long range when unset');
}

// ── 8) extrapolateSlicing ──────────────────────────────────────────────────
{
    const exact = [0.3, 0.6];
    const withError = N => exact.map((v, i) => v + (i + 1) * 0.01 / (N * N));
    const coarse = { lambda: [1, 2], R: withError(8), T: withError(8).map(v => 1 - v) };
    const fine = { lambda: [1, 2], R: withError(16), T: withError(16).map(v => 1 - v) };
    const out = extrapolateSlicing(coarse, fine);
    ok(out.R.every((v, i) => near(v, exact[i], 1e-15)), 'a pure 1/N² error is removed exactly');
    ok(out.R.every((v, i) => near(v + out.T[i], 1, 1e-15)), 'R + T is kept');
    ok(out.lambda === fine.lambda && out.A === undefined, 'grid kept, missing keys skipped');

    // A 20 nm graded H/L interface inside a quarter-wave pair on glass.
    const air = mat('air', 1), glass = mat('glass', 1.52), H = mat('H', 2.35), L = mat('L', 1.46);
    const lams = [450, 500, 550, 600, 650];
    const spec = N => evaluateSpectrumAt(lams, { theta: 0, polarization: 'avg' }, air, glass, [
        { material: H, thickness: 58.5 - 10 }, ...buildGradedSlices(H, L, 20, 'linear', N), { material: L, thickness: 94.2 - 10 },
    ]);
    const ref = extrapolateSlicing(spec(256), spec(512));
    const plain = spec(32);
    const extra = extrapolateSlicing(spec(16), spec(32));
    let ePlain = 0, eExtra = 0;
    lams.forEach((_, i) => {
        ePlain = Math.max(ePlain, Math.abs(plain.R[i] - ref.R[i]));
        eExtra = Math.max(eExtra, Math.abs(extra.R[i] - ref.R[i]));
    });
    ok(eExtra * 20 < ePlain, `16/32 slices extrapolated beat 32 plain slices twentyfold (${eExtra.toExponential(2)} vs ${ePlain.toExponential(2)})`);
}

// ── 9) Spec defaults, cloning, interface count ─────────────────────────────
{
    const e = emptyRoughness();
    ok(e.mode === 'uniform' && e.sigma === 1.0 && e.range === 'long', 'emptyRoughness defaults');
    const c = cloneRoughness({ mode: 'perInterface', sigma: 5, sigmas: [1, 2, 3], ranges: ['short'] });
    c.sigmas[0] = 999;
    const c2 = cloneRoughness(c);
    ok(c2.sigmas[0] === 999 && c2.ranges[0] === 'short', 'cloneRoughness: arrays copied');
    c2.sigmas[0] = 0;
    ok(c.sigmas[0] === 999, 'cloneRoughness: independent from source');
    ok(cloneRoughness({ mode: 'uniform', sigma: 2 }).range === 'long', 'cloneRoughness: a spec without a kind is long range');
    ok(countInterfaces(0) === 1 && countInterfaces(1) === 2 && countInterfaces(5) === 6, 'countInterfaces = N + 1, at least 1');
}

if (fails === 0) {
    console.log('All scattering tests passed.');
    process.exit(0);
} else {
    console.error(`${fails} test(s) failed.`);
    process.exit(1);
}
