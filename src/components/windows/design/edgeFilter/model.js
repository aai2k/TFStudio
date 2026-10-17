/**
 * The Edge Filter window's model, pure of React: its starting inputs, the
 * request the search runs on, the period written as a Stack Formula formula,
 * the layers that formula builds, and the preview spectrum.
 *
 * The search itself is src/utils/synthesis/edgeFilter.js.
 */

import { evaluateSpectrum } from '../../../../utils/physics/thinFilmMath.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { autoSymbolMap, buildStackFromFormula, stackFormulaResolvers } from '../../../../utils/synthesis/stackFormula.js';
import { previewWavelengthRange } from '../stackFormula/model.js';

// The reference program's worked example: a shortwave pass at 45° between
// SiO2 and TiO2, 19 periods, a searched from 0.1 to 1 in steps of 0.05.
const EXAMPLE = {
    pass: 'short', angle: 45, periods: 19, lower: 0.1, upper: 1.0, step: 0.05,
    low: 'builtin:SiO2', high: 'builtin:TiO2',
};

// The inputs the search reads; changing any of them makes the listed periods
// stale.
export const SEARCH_INPUTS = ['pass', 'edgeLambda', 'angle', 'incidentMat', 'matA', 'matB', 'lower', 'upper', 'step'];

/**
 * The window's starting inputs. The media and the edge wavelength are the
 * design's; A and B are the lowest and highest index of its front layers, as
 * in the example, or the example's own pair when it has fewer than two.
 */
export function initialInputs(design) {
    const edgeLambda = design.referenceWavelength || 550;
    const { ranked } = autoSymbolMap(design.frontLayers || [], edgeLambda, stackFormulaResolvers(design));
    const [matA, matB] = ranked.length >= 2 ? [ranked.at(-1), ranked[0]] : [EXAMPLE.low, EXAMPLE.high];
    return {
        pass: EXAMPLE.pass, edgeLambda, angle: EXAMPLE.angle,
        incidentMat: design.incidentMedium || 'builtin:Air',
        substrateMat: design.substrate?.material || 'builtin:BK7',
        matA, matB, periods: EXAMPLE.periods,
        lower: EXAMPLE.lower, upper: EXAMPLE.upper, step: EXAMPLE.step,
    };
}

/** A string that changes whenever an input the search reads changes. */
export function searchSignature(inputs) {
    return JSON.stringify(SEARCH_INPUTS.map(key => inputs[key]));
}

// [n, k] of a material at λ, or null when it has none there.
function indexAt(resolveMaterial, id, lambda) {
    try {
        const nk = resolveMaterial(id).getNK(lambda);
        return Number.isFinite(nk[0]) && nk[0] > 0 ? nk : null;
    } catch {
        return null;
    }
}

/**
 * The search request: each material's real index at the edge wavelength.
 * `absorbing` lists the ids of A and B with k > 0 there, which the search
 * treats as lossless. `{ errorKey: 'noIndex' }` when a material has no index
 * at the edge wavelength.
 */
export function edgeRequest(design, inputs) {
    const resolveMaterial = designMaterialLookup(design);
    const lambda = inputs.edgeLambda;
    const [inc, a, b] = [inputs.incidentMat, inputs.matA, inputs.matB].map(id => indexAt(resolveMaterial, id, lambda));
    if (!inc || !a || !b) return { errorKey: 'noIndex' };
    return {
        request: {
            pass: inputs.pass, edgeLambda: lambda, angleDeg: inputs.angle,
            nIncident: inc[0], nA: a[0], nB: b[0],
            lower: inputs.lower, upper: inputs.upper, step: inputs.step,
        },
        absorbing: [[inputs.matA, a], [inputs.matB, b]].filter(([, nk]) => nk[1] > 0).map(([id]) => id),
    };
}

/**
 * Stack Formula symbols for the two materials: H the higher index at the edge
 * wavelength, L the lower, as Stack Formula's own defaults read.
 */
export function formulaSymbols(inputs, request) {
    const aIsHigh = request.nA > request.nB;
    return {
        A: aIsHigh ? 'H' : 'L', B: aIsHigh ? 'L' : 'H',
        symbolMap: aIsHigh ? { H: inputs.matA, L: inputs.matB } : { H: inputs.matB, L: inputs.matA },
    };
}

// Six decimals hold the edge to a millionth of the edge wavelength.
const coef = x => String(Number(x.toFixed(6)));

/** The period, repeated `periods` times, in Stack Formula's syntax. */
export function periodFormula(solution, symbols, periods) {
    const [outer, inner] = solution.outer === 'A' ? [symbols.A, symbols.B] : [symbols.B, symbols.A];
    const { a, b, c } = solution;
    const body = `${coef(a)}${outer} ${coef(b)}${inner} ${coef(c)}${outer} ${coef(b)}${inner} ${coef(a)}${outer}`;
    return periods > 1 ? `(${body})^${periods}` : body;
}

/**
 * Where two periods meet, their outer layers are one material, deposited as
 * one layer of the summed thickness.
 */
export function joinSameMaterial(layers) {
    const joined = [];
    for (const layer of layers) {
        const last = joined.at(-1);
        if (last && last.material === layer.material) joined[joined.length - 1] = { ...last, thickness: last.thickness + layer.thickness };
        else joined.push(layer);
    }
    return joined;
}

/**
 * The layers the formula builds through Stack Formula, quarter waves at the
 * edge wavelength, with each pair of touching outer layers joined. The shape
 * of Stack Formula's compiled result, so its apply code takes it as it is.
 */
export function compileEdgeFilter(design, formula, symbolMap, edgeLambda) {
    const built = buildStackFromFormula({
        text: formula, symbolMap, refLambda: edgeLambda, resolvers: stackFormulaResolvers(design),
    });
    return built.ok ? { ...built, layers: joinSameMaterial(built.layers) } : built;
}

/**
 * Ts, Tp and their mean T of the finished filter between the incident medium
 * and the substrate at the angle of incidence, with each material's full n and
 * k; { error } when a material cannot be computed.
 */
export function edgePreviewSpectrum(design, compiled, inputs) {
    if (!compiled?.ok) return { error: 'none' };
    try {
        const resolveMaterial = designMaterialLookup(design);
        const layers = compiled.layers.map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
        const { lambdaStart, lambdaEnd, interval } = previewWavelengthRange(inputs.edgeLambda);
        const spec = evaluateSpectrum(
            { lambdaStart, lambdaEnd, lambdaStep: Math.max(1, (lambdaEnd - lambdaStart) / 300),
              theta: inputs.angle, polarization: 'avg' },
            resolveMaterial(inputs.incidentMat), resolveMaterial(inputs.substrateMat), layers);
        return { lambda: spec.lambda, Ts: spec.Ts, Tp: spec.Tp, T: spec.T, xInterval: interval };
    } catch (error) {
        return { error: error.message };
    }
}

/**
 * What Stack Formula opens on when the formula is handed to it: the formula,
 * its two symbols, and the wavelength and media it is written for.
 */
export function stackFormulaSeed(formula, symbolMap, inputs) {
    return {
        text: formula,
        rows: Object.entries(symbolMap).map(([sym, matId]) => ({ sym, matId, fixed: true })),
        refLambda: inputs.edgeLambda, incidentMat: inputs.incidentMat, substrateMat: inputs.substrateMat,
    };
}
