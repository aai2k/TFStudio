/**
 * Systematic Deviations tests — verifies that applying an identity deviation
 * is a no-op (bit-identical to baseline), global Δn/Δk + thickness-scale
 * propagate correctly into the TMM spectrum, per-material overrides combine
 * additively with global, sweeps produce well-shaped 2-D arrays, and the
 * unique-material enumerator covers front/back/substrate/media without
 * duplicates.
 *
 * Run: node tests/systematic_deviations.mjs
 */

import {
    emptyDeviation, cloneDeviation, isIdentityDeviation,
    enumerateUniqueMaterials,
    perturbLayers, perturbMedium,
    computeDeviatedSpectrum, runDeviationSweep,
    applyParamValue, paramLabel,
} from '../src/utils/physics/systematicDeviations.js';
import { evaluateSpectrum } from '../src/utils/physics/thinFilmMath.js';

let fails = 0;
const ok    = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const near  = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol;
const nearV = (a, b, tol) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
    && a.every((v, i) => near(v, b[i], tol));

// ── Minimal material factory ─────────────────────────────────────────────────
// Non-dispersive (constant n,k) so we can hand-build comparison designs.
function mat(id, n, k = 0) {
    return { id, name: id, color: '#888', getNK: () => [n, k] };
}

const MATERIALS = {
    'Air':  mat('Air',  1.0, 0),
    'SiO2': mat('SiO2', 1.46, 0),
    'TiO2': mat('TiO2', 2.40, 0.001),
    'BK7':  mat('BK7',  1.52, 0),
};
const resolveMat = (id) => MATERIALS[id] || MATERIALS['Air'];

const DESIGN = {
    incidentMedium: 'Air',
    exitMedium:     'Air',
    substrate:      { material: 'BK7', thickness: 1.0 },
    frontLayers: [
        { material: 'TiO2', thickness: 95.0 },
        { material: 'SiO2', thickness: 137.0 },
        { material: 'TiO2', thickness: 95.0 },
        { material: 'SiO2', thickness: 137.0 },
    ],
    backLayers: [
        { material: 'SiO2', thickness: 137.0 },
    ],
};

const PARAMS = { lambdaStart: 400, lambdaEnd: 800, lambdaStep: 25, theta: 0, polarization: 'avg' };

// ── 1) Identity deviation ⇒ bit-identical to the bare evaluateSpectrum path ─
{
    const dev = emptyDeviation();
    const dev2 = cloneDeviation(dev);
    ok(isIdentityDeviation(dev),  'emptyDeviation is identity');
    ok(isIdentityDeviation(dev2), 'cloneDeviation preserves identity');

    const deviated = computeDeviatedSpectrum(DESIGN, PARAMS, dev, 'front', resolveMat);

    const bareLayers = DESIGN.frontLayers.map(l => ({ material: resolveMat(l.material), thickness: l.thickness }));
    const baseline = evaluateSpectrum(PARAMS, resolveMat('Air'), resolveMat('BK7'), bareLayers);

    ok(nearV(deviated.lambda, baseline.lambda, 1e-9), 'identity: λ grid matches');
    ok(nearV(deviated.T, baseline.T, 1e-15), 'identity: T bit-identical to baseline');
    ok(nearV(deviated.R, baseline.R, 1e-15), 'identity: R bit-identical to baseline');
    ok(nearV(deviated.A, baseline.A, 1e-15), 'identity: A bit-identical to baseline');
}

// ── 2) Global thickness scale equals a manually-scaled design ──────────────
{
    const s = 1.05;
    const dev = { ...emptyDeviation(), globalThicknessScale: s };
    const deviated = computeDeviatedSpectrum(DESIGN, PARAMS, dev, 'front', resolveMat);

    const scaledLayers = DESIGN.frontLayers.map(l => ({
        material: resolveMat(l.material), thickness: l.thickness * s,
    }));
    const expected = evaluateSpectrum(PARAMS, resolveMat('Air'), resolveMat('BK7'), scaledLayers);

    ok(nearV(deviated.T, expected.T, 1e-15), 'thickness-scale: T matches manually-scaled design');
    ok(nearV(deviated.R, expected.R, 1e-15), 'thickness-scale: R matches manually-scaled design');
}

// ── 3) Global Δn / Δk equals a manually-shifted material design ────────────
{
    const dn = 0.05, dk = 0.002;
    const dev = { ...emptyDeviation(), globalDeltaN: dn, globalDeltaK: dk };
    const deviated = computeDeviatedSpectrum(DESIGN, PARAMS, dev, 'front', resolveMat);

    const wrapBase = (m) => ({
        id: m.id + "'", name: m.name + "'",
        getNK: (lam) => {
            const nk = m.getNK(lam);
            return [nk[0] + dn, Math.max(0, nk[1] + dk)];
        }
    });
    const shifted = DESIGN.frontLayers.map(l => ({
        material: wrapBase(resolveMat(l.material)), thickness: l.thickness,
    }));
    const expected = evaluateSpectrum(PARAMS, wrapBase(resolveMat('Air')), wrapBase(resolveMat('BK7')), shifted);

    ok(nearV(deviated.T, expected.T, 1e-14), 'Δn/Δk: T matches manually-shifted material design');
    ok(nearV(deviated.R, expected.R, 1e-14), 'Δn/Δk: R matches manually-shifted material design');
}

// ── 4) Per-material override combines additively with global ───────────────
{
    // Global Δn=0.02 + TiO2-specific Δn=0.03 ⇒ TiO2 sees +0.05; SiO2 sees +0.02.
    const dev = {
        globalDeltaN: 0.02, globalDeltaK: 0, globalThicknessScale: 1.0,
        perMaterial: { TiO2: { dn: 0.03, dk: 0, dScale: 1 } },
    };

    // Build the equivalent design by hand: TiO2 wrapped +0.05, SiO2 wrapped +0.02.
    const wrap = (m, dn) => ({
        id: m.id + "'", getNK: (lam) => { const nk = m.getNK(lam); return [nk[0] + dn, nk[1]]; }
    });
    const expected = evaluateSpectrum(PARAMS,
        wrap(resolveMat('Air'), 0.02),
        wrap(resolveMat('BK7'), 0.02),
        DESIGN.frontLayers.map(l => ({
            material: wrap(resolveMat(l.material), l.material === 'TiO2' ? 0.05 : 0.02),
            thickness: l.thickness,
        })),
    );
    const deviated = computeDeviatedSpectrum(DESIGN, PARAMS, dev, 'front', resolveMat);

    ok(nearV(deviated.T, expected.T, 1e-14), 'per-material: TiO2 sees Δn=global+override, SiO2 only global');
    ok(nearV(deviated.R, expected.R, 1e-14), 'per-material: R matches');
}

// ── 5) Per-material thickness scale is multiplicative with global ──────────
{
    // global d-scale = 1.10, TiO2 d-scale = 0.95 ⇒ TiO2 layers see 1.10·0.95 = 1.045
    const dev = {
        globalDeltaN: 0, globalDeltaK: 0, globalThicknessScale: 1.10,
        perMaterial: { TiO2: { dn: 0, dk: 0, dScale: 0.95 } },
    };

    const expected = evaluateSpectrum(PARAMS,
        resolveMat('Air'), resolveMat('BK7'),
        DESIGN.frontLayers.map(l => ({
            material: resolveMat(l.material),
            thickness: l.thickness * 1.10 * (l.material === 'TiO2' ? 0.95 : 1.0),
        })),
    );
    const deviated = computeDeviatedSpectrum(DESIGN, PARAMS, dev, 'front', resolveMat);

    ok(nearV(deviated.T, expected.T, 1e-15), 'per-material d-scale: multiplicative with global');
}

// ── 5b) Flat thickness OFFSET — nm / OT / QW units, global + per-material ───
// λ₀ falls back to 550 (DESIGN has no referenceWavelength). n: TiO2=2.4, SiO2=1.46.
{
    const LAM0 = 550;
    const nOf = (id) => resolveMat(id).getNK(LAM0)[0];
    const expectFor = (offNmFn) => evaluateSpectrum(PARAMS,
        resolveMat('Air'), resolveMat('BK7'),
        DESIGN.frontLayers.map(l => ({
            material: resolveMat(l.material),
            thickness: l.thickness + offNmFn(l.material),
        })),
    );

    // (a) Physical nm: +5 nm to every layer, regardless of material.
    {
        const dev = { ...emptyDeviation(), globalThicknessOffset: 5, globalThicknessOffsetUnit: 'nm' };
        ok(!isIdentityDeviation(dev), 'offset(nm): not identity');
        const got = computeDeviatedSpectrum(DESIGN, PARAMS, dev, 'front', resolveMat);
        const exp = expectFor(() => 5);
        ok(nearV(got.T, exp.T, 1e-15), 'offset(nm): +5 nm to every layer');
    }

    // (b) Optical thickness (OT) offset: Δ(n·d)=10 nm ⇒ Δd = 10/n (material-dependent).
    {
        const dev = { ...emptyDeviation(), globalThicknessOffset: 10, globalThicknessOffsetUnit: 'ot' };
        const got = computeDeviatedSpectrum(DESIGN, PARAMS, dev, 'front', resolveMat);
        const exp = expectFor((id) => 10 / nOf(id));
        ok(nearV(got.T, exp.T, 1e-13), 'offset(OT): Δd = ΔOT / n per material');
    }

    // (c) Quarter-wave offset: 0.1 QW ⇒ Δd = 0.1·λ₀/(4n).
    {
        const dev = { ...emptyDeviation(), globalThicknessOffset: 0.1, globalThicknessOffsetUnit: 'qw' };
        const got = computeDeviatedSpectrum(DESIGN, PARAMS, dev, 'front', resolveMat);
        const exp = expectFor((id) => 0.1 * LAM0 / (4 * nOf(id)));
        ok(nearV(got.T, exp.T, 1e-13), 'offset(QW): Δd = q·λ₀/(4n) per material');
    }

    // (d) Full-wave offset: 0.05 FW ⇒ Δd = 0.05·λ₀/n.
    {
        const dev = { ...emptyDeviation(), globalThicknessOffset: 0.05, globalThicknessOffsetUnit: 'fw' };
        const got = computeDeviatedSpectrum(DESIGN, PARAMS, dev, 'front', resolveMat);
        const exp = expectFor((id) => 0.05 * LAM0 / nOf(id));
        ok(nearV(got.T, exp.T, 1e-13), 'offset(FW): Δd = f·λ₀/n per material');
    }

    // (e) Global + per-material offsets are additive in physical nm.
    //     global +3 nm, TiO2 +2 nm ⇒ TiO2 layers +5 nm, SiO2 +3 nm.
    {
        const dev = {
            ...emptyDeviation(),
            globalThicknessOffset: 3, globalThicknessOffsetUnit: 'nm',
            perMaterial: { TiO2: { dn: 0, dk: 0, dScale: 1, dOffset: 2, dOffsetUnit: 'nm' } },
        };
        const got = computeDeviatedSpectrum(DESIGN, PARAMS, dev, 'front', resolveMat);
        const exp = expectFor((id) => id === 'TiO2' ? 5 : 3);
        ok(nearV(got.T, exp.T, 1e-15), 'offset: global + per-material add in physical nm');
    }

    // (f) Scale and offset compose as d' = d·scale + offset.
    {
        const dev = { ...emptyDeviation(), globalThicknessScale: 1.05, globalThicknessOffset: 4, globalThicknessOffsetUnit: 'nm' };
        const got = computeDeviatedSpectrum(DESIGN, PARAMS, dev, 'front', resolveMat);
        const exp = evaluateSpectrum(PARAMS, resolveMat('Air'), resolveMat('BK7'),
            DESIGN.frontLayers.map(l => ({ material: resolveMat(l.material), thickness: l.thickness * 1.05 + 4 })));
        ok(nearV(got.T, exp.T, 1e-14), 'offset: d′ = d·scale + offset');
    }

    // (g) clone + identity preserve / detect the offset fields.
    {
        const dev = { ...emptyDeviation(), globalThicknessOffset: 7, globalThicknessOffsetUnit: 'qw' };
        const cl = cloneDeviation(dev);
        ok(cl.globalThicknessOffset === 7 && cl.globalThicknessOffsetUnit === 'qw', 'clone preserves offset + unit');
        ok(!isIdentityDeviation(cl), 'isIdentity: offset breaks identity');
    }

    // (h) sweep param encoding for offsets.
    {
        const dev = emptyDeviation();
        applyParamValue(dev, 'globalThicknessOffset', 6);
        ok(dev.globalThicknessOffset === 6, 'applyParamValue: globalThicknessOffset');
        applyParamValue(dev, 'mat:SiO2:dOffset', 1.5);
        ok(dev.perMaterial.SiO2.dOffset === 1.5, 'applyParamValue: mat:SiO2:dOffset');
        ok(paramLabel('globalThicknessOffset') === 'Global thickness offset', 'paramLabel: globalThicknessOffset');
        ok(paramLabel('mat:SiO2:dOffset') === 'SiO2 d-offset', 'paramLabel: mat:SiO2:dOffset');
    }
}

// ── 6) Sweep shape + identity row reproduces baseline ──────────────────────
{
    const sweep = { param: 'globalThicknessScale', from: 0.95, to: 1.05, steps: 11 };
    const res = runDeviationSweep({ design: DESIGN, params: PARAMS, baseDev: emptyDeviation(), sweep, evalMode: 'front', resolveMat });

    ok(res.paramValues.length === 11, 'sweep: 11 parameter values');
    ok(Math.abs(res.paramValues[5] - 1.0) < 1e-12, 'sweep: middle step at exactly 1.0');
    ok(res.T2D.length === 11, 'sweep: 11 T rows');
    ok(res.T2D[5].length === res.lambda.length, 'sweep: each row matches λ grid length');

    // Row at s=1.0 must match the baseline bit-identically.
    const bareLayers = DESIGN.frontLayers.map(l => ({ material: resolveMat(l.material), thickness: l.thickness }));
    const baseline = evaluateSpectrum(PARAMS, resolveMat('Air'), resolveMat('BK7'), bareLayers);
    ok(nearV(res.T2D[5], baseline.T, 1e-15), 'sweep at s=1.0 row: T identical to baseline');
    ok(nearV(res.R2D[5], baseline.R, 1e-15), 'sweep at s=1.0 row: R identical to baseline');
}

// ── 7) Per-material sweep parameter encoding works end-to-end ──────────────
{
    const sweep = { param: 'mat:TiO2:dScale', from: 0.95, to: 1.05, steps: 5 };
    const res = runDeviationSweep({ design: DESIGN, params: PARAMS, baseDev: emptyDeviation(), sweep, evalMode: 'front', resolveMat });
    ok(res.paramValues.length === 5, 'mat-sweep: 5 values');
    ok(Math.abs(res.paramValues[2] - 1.0) < 1e-12, 'mat-sweep: midpoint at 1.0');
    // Middle row reproduces baseline because TiO2-dScale=1 with all global=identity = no-op.
    const bareLayers = DESIGN.frontLayers.map(l => ({ material: resolveMat(l.material), thickness: l.thickness }));
    const baseline = evaluateSpectrum(PARAMS, resolveMat('Air'), resolveMat('BK7'), bareLayers);
    ok(nearV(res.T2D[2], baseline.T, 1e-15), 'mat-sweep midpoint: T identical to baseline');
}

// ── 8) Enumerate unique materials covers everything once, in order ─────────
{
    const list = enumerateUniqueMaterials(DESIGN);
    const ids = list.map(x => x.id);
    ok(ids.includes('TiO2'), 'enumerate: TiO2 included');
    ok(ids.includes('SiO2'), 'enumerate: SiO2 included');
    ok(ids.includes('BK7'),  'enumerate: substrate BK7 included');
    ok(ids.includes('Air'),  'enumerate: incident Air included');
    // Each material appears once
    const dupe = ids.filter((v, i, a) => a.indexOf(v) !== i);
    ok(dupe.length === 0, `enumerate: no duplicates (saw ${dupe.join(',') || 'none'})`);
    // Front order: TiO2, SiO2, then back-only adds nothing new, then substrate BK7, then media
    ok(ids[0] === 'TiO2', 'enumerate: front layers first (TiO2)');
    ok(ids[1] === 'SiO2', 'enumerate: second is SiO2 (then back is dup, skipped)');
    // Roles are aggregated: Air serves as BOTH incident and exit (was previously
    // deduped to just 'incident', making the exit medium look missing).
    const air = list.find(x => x.id === 'Air');
    ok(air && air.roles.includes('incident') && air.roles.includes('exit'),
        `enumerate: Air reports both incident+exit roles (got "${air?.source}")`);
}

// ── 9) applyParamValue handles every param shape ───────────────────────────
{
    const dev = emptyDeviation();
    applyParamValue(dev, 'globalDeltaN', 0.1);
    ok(dev.globalDeltaN === 0.1, 'applyParamValue: globalDeltaN');
    applyParamValue(dev, 'globalDeltaK', 0.01);
    ok(dev.globalDeltaK === 0.01, 'applyParamValue: globalDeltaK');
    applyParamValue(dev, 'globalThicknessScale', 1.05);
    ok(dev.globalThicknessScale === 1.05, 'applyParamValue: globalThicknessScale');
    applyParamValue(dev, 'mat:SiO2:dn', 0.02);
    ok(dev.perMaterial.SiO2.dn === 0.02, 'applyParamValue: mat:SiO2:dn');
    applyParamValue(dev, 'mat:SiO2:dk', 0.001);
    ok(dev.perMaterial.SiO2.dk === 0.001, 'applyParamValue: mat:SiO2:dk');
    applyParamValue(dev, 'mat:SiO2:dScale', 0.97);
    ok(dev.perMaterial.SiO2.dScale === 0.97, 'applyParamValue: mat:SiO2:dScale');
    // Unknown field — should not crash, should leave perMaterial entry intact
    applyParamValue(dev, 'mat:SiO2:wat', 99);
    ok(dev.perMaterial.SiO2.dn === 0.02, 'applyParamValue: unknown field is ignored');
}

// ── 10) paramLabel produces something human-readable for every shape ──────
{
    ok(paramLabel('globalDeltaN')         === 'Global Δn',                'paramLabel: globalDeltaN');
    ok(paramLabel('globalDeltaK')         === 'Global Δk',                'paramLabel: globalDeltaK');
    ok(paramLabel('globalThicknessScale') === 'Global thickness scale',   'paramLabel: globalThicknessScale');
    ok(paramLabel('mat:TiO2:dn')          === 'TiO2 Δn',                  'paramLabel: mat:TiO2:dn');
    ok(paramLabel('mat:TiO2:dk')          === 'TiO2 Δk',                  'paramLabel: mat:TiO2:dk');
    ok(paramLabel('mat:TiO2:dScale')      === 'TiO2 d-scale',             'paramLabel: mat:TiO2:dScale');
}

// ── 11) perturbLayers + perturbMedium do not mutate inputs ────────────────
{
    const dev = { globalDeltaN: 0.1, globalDeltaK: 0, globalThicknessScale: 1.05, perMaterial: {} };
    const before = JSON.stringify(DESIGN);
    perturbLayers(DESIGN.frontLayers, dev, resolveMat);
    perturbMedium('TiO2', dev, resolveMat);
    perturbMedium('BK7',  dev, resolveMat);
    const after = JSON.stringify(DESIGN);
    ok(before === after, 'perturbLayers/Medium do not mutate the source design');
}

// ── Summary ────────────────────────────────────────────────────────────────
if (fails === 0) {
    console.log('All systematic-deviations tests passed.');
    process.exit(0);
} else {
    console.error(`${fails} test(s) failed.`);
    process.exit(1);
}
