/**
 * Designs with narrow or close peaks, and the readings the step tests take on
 * them: a merit row at a flag, and a Specification check with options.
 *
 * Load the app (or initCatalogs) before calling `row` or `check`, so the
 * built-in materials resolve.
 */
import { buildEvalContext, evaluateOperands, makeOperand } from '../src/utils/physics/optimizer.js';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';
import { evaluateQualifier, makeQualifier } from '../src/utils/synthesis/qualifiers.js';

const H = ['TiO2', 57], L = ['SiO2', 94];
const rep = (n, pair) => Array.from({ length: n }, () => pair).flat();
const twice = layer => [layer[0], 2 * layer[1]];

export const design = (spec, qualifiers = []) => ({
    id: 'peaks', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: spec.map(([material, thickness], i) => ({ id: `L${i}`, material, thickness, locked: false })),
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side', referenceWavelength: 550, qualifiers,
});

// air | (HL)^5 H LL H (LH)^5 | BK7: resonance at 557.53 nm, FWHM 0.36 nm.
export const fabryPerot = design([...rep(5, [H, L]), H, twice(L), H, ...rep(5, [L, H])]);

// Two coupled cavities whose peaks sit 1.9 nm apart: T 0.98 at 556.90 nm and
// 0.75 at 558.82 nm.
export const coupled = design([
    ...rep(5, [H, L]), H, twice(L), H, ...rep(3, [L, H]), L,
    ...rep(3, [H, L]), H, ['SiO2', 2 * 94 * 1.003], H, ...rep(5, [L, H]),
]);

// A band over the coupled pair on which a search at the default 1 nm step
// reads the lower peak, and one at 0.1 nm or finer the higher.
export const COUPLED_BAND = { lambdaStart: 530.4, lambdaEnd: 590.4 };

/** A merit row's value at `flag`, or at the default step without one. */
export const row = (d, type, a, b, flag) => evaluateOperands([makeOperand({
    type, lambdaStart: a, lambdaEnd: b, aoi: 0, pol: 'avg', target: 0, weight: 1, ...(flag ? { flag } : {}),
})], buildEvalContext(d, designMaterialLookup(d)))[0];

/** T at one wavelength. */
export const T = (d, lam) => row(d, 'T', lam, lam);

/** A Specification check's result, with `options` as evaluateQualifier takes them. */
export const check = (d, fields, options) =>
    evaluateQualifier(makeQualifier(fields), d, designMaterialLookup(d), options);

/** The width of the peak at `top` at half its height, its crossings found by bisection. */
export function trueFwhm(d, top) {
    const half = T(d, top) / 2;
    const cross = (inside, outside) => {
        for (let k = 0; k < 60; k++) {
            const mid = 0.5 * (inside + outside);
            if (T(d, mid) > half) inside = mid; else outside = mid;
        }
        return 0.5 * (inside + outside);
    };
    return cross(top, top + 2) - cross(top, top - 2);
}
