/** Pointwise optical-constant derivatives with respect to angular frequency. */

import { evalNJet, FORMULA_NAMES } from './dispersionFormulas.js';
import {
    dispersionFitModelName,
    evaluateDispersionFit,
    evaluateDispersionFitJets,
} from './dispersionFits.js';
import {
    jetCompose,
    jetConstant,
    jetDerivatives,
    jetScale,
    jetWithImaginaryPart,
    wavelengthOmegaJet,
} from '../../tmmcore.js';

export const C_NM_PER_FS = 299.792458;
// Matches the characteristic-matrix opacity limit. At this field optical
// depth, internal intensity transmission is below exp(-100), so no direct
// pulse remains for a propagation delay to describe.
export const MAX_PROPAGATION_OPTICAL_DEPTH = 50;

function formulaDescriptor(material) {
    if (material?.formulaNum > 0) {
        return {
            formulaNum: material.formulaNum,
            coefficients: material.coefficients || [],
        };
    }
    return material?.getNK?.dispersionFormula || null;
}

function modelName(formula) {
    if (!formula) return null;
    return FORMULA_NAMES[formula.formulaNum] || `Formula ${formula.formulaNum}`;
}

// A table is either C1 (PCHIP: value and slope continuous, curvature jumps at
// a knot) or C0 (linear: the slope itself jumps). The order says which
// derivative is the first to be discontinuous, so a caller can break a curve
// there rather than draw through a jump.
const TABLE_MODEL = { pchip: 'Table (PCHIP)', linear: 'Table (linear)' };
const CONTINUOUS_ORDER_BY_MODEL = { [TABLE_MODEL.pchip]: 1, [TABLE_MODEL.linear]: 0 };

function tableModelName(interpolator) {
    return TABLE_MODEL[interpolator?.interp] || TABLE_MODEL.pchip;
}

// Lowest continuity among the named models; 3 when none of them is a table.
function continuousOrderOf(...models) {
    return Math.min(3, ...models.map(model => CONTINUOUS_ORDER_BY_MODEL[model] ?? 3));
}

const NO_TABLE = { jet: null, inRange: false, segment: null, onKnot: false };

function tableJet(interpolator, wavelengthJet, wavelength, knotSide) {
    const sample = interpolator?.derivativesAt?.(wavelength, knotSide);
    if (!sample) return NO_TABLE;
    return {
        jet: jetCompose(sample.value, sample.derivatives, wavelengthJet),
        inRange: sample.inRange,
        segment: sample.segment,
        onKnot: sample.onKnot,
    };
}

function tableInterpolators(material) {
    const getNK = material?.getNK;
    if (getNK?.nInterpolator && getNK?.kInterpolator) {
        return { nAt: getNK.nInterpolator, kAt: getNK.kInterpolator, unitScale: 1 };
    }
    return null;
}

function materialRangeContains(material, wavelengthNm) {
    const rangeNm = material?.getNK?.rangeNm;
    if (Array.isArray(rangeNm)) return wavelengthNm >= rangeNm[0] && wavelengthNm <= rangeNm[1];
    const minimum = Number(material?.lambdaMin) * 1000;
    const maximum = Number(material?.lambdaMax) * 1000;
    if (material?.rangeDeclared && Number.isFinite(minimum) && Number.isFinite(maximum)) {
        return wavelengthNm >= minimum && wavelengthNm <= maximum;
    }
    return true;
}

/**
 * The tables a material's optical constants are read from, with the factor that
 * turns their knots into nm. One statement of the unit convention, for
 * everything that has to reason about where a table starts and stops: a
 * tabulated n,k pair is sampled in nm, while a k table read beside an analytic n
 * carries the unit the material tagged it with and is µm when untagged, the unit
 * a catalog record stores a k table in.
 */
function tableInterpolatorsNm(material) {
    const getNK = material?.getNK;
    if (getNK?.nInterpolator && getNK?.kInterpolator) {
        return { tables: [getNK.nInterpolator, getNK.kInterpolator], scale: 1 };
    }
    if (getNK?.kInterpolator) {
        return {
            tables: [getNK.kInterpolator],
            scale: getNK.kInterpolatorUnit === 'nm' ? 1 : 1000,
        };
    }
    return { tables: [], scale: 1 };
}

/**
 * Wavelength extents in nm of those tables, one `[minNm, maxNm]` pair each.
 *
 * Outside its extent a table holds the value in its last row and
 * `materialOmegaResponse` reports the wavelength out of range, so these bound
 * what can be evaluated whatever range the material declares around them. BK7
 * states the 300 to 2500 nm validity of its Sellmeier n while the k table
 * derived from its internal transmittance starts at 310.
 */
export function materialTableExtentsNm(material) {
    const { tables, scale } = tableInterpolatorsNm(material);
    return tables.map(at => [at.knots[0] * scale, at.knots[at.knots.length - 1] * scale]);
}

// The dispersion fit a material reads inside its range, or null.
function activeFit(material) {
    const fit = material?.dispersionFit || material?.getNK?.dispersionFit;
    return fit?.active ? fit : null;
}

/**
 * Where an active dispersion fit hands over to the table it was fitted to, and
 * by how much n and k step there.
 *
 * Inside its range the fit is read and outside it the table, so at each end the
 * material changes model and the value itself jumps, by the fit's residual at
 * that wavelength. An end strictly inside the table is listed. One at or past
 * the table's first or last row is not: the material's data ends there anyway,
 * as it does at the table's own end knots.
 *
 * @returns {Array<{ wavelengthNm:number, dn:number, dk:number }>} in ascending
 *          wavelength; dn and dk are the fit minus the table
 */
export function dispersionFitEdges(material) {
    const fit = activeFit(material);
    const nAt = material?.getNK?.nInterpolator;
    const kAt = material?.getNK?.kInterpolator;
    if (!fit || !nAt || !kAt) return [];
    return fitEndsInsideTable(fit, nAt).map((wavelengthNm) => {
        const [n, k] = evaluateDispersionFit(fit, wavelengthNm);
        return { wavelengthNm, dn: n - nAt(wavelengthNm), dk: k - kAt(wavelengthNm) };
    });
}

// The ends of the fit's range strictly inside the n table, ascending.
function fitEndsInsideTable(fit, nAt) {
    const first = nAt.knots[0];
    const last = nAt.knots[nAt.knots.length - 1];
    return [...new Set(fit.rangeNm)]
        .filter(edge => edge > first && edge < last)
        .sort((left, right) => left - right);
}

/**
 * Wavelengths in nm where a material's model changes piece, so a derivative of
 * high enough order jumps, or the value itself at the end of a fit.
 *
 * Interior table knots: the first and last are the ends of the material's
 * range, beyond which it supplies nothing. None for a formula, or inside the
 * span an active dispersion fit covers, both being smooth to every order. The
 * ends of that span are listed wherever `dispersionFitEdges` lists them.
 */
export function materialKnotWavelengths(material) {
    const { tables, scale } = tableInterpolatorsNm(material);
    if (!tables.length) return [];
    let knots = tables.flatMap(at => at.knots.slice(1, -1).map(knot => knot * scale));
    const fit = activeFit(material);
    if (fit) {
        knots = knots.filter(knot => knot < fit.rangeNm[0] || knot > fit.rangeNm[1])
            .concat(dispersionFitEdges(material).map(edge => edge.wavelengthNm));
    }
    return [...new Set(knots)].sort((left, right) => left - right);
}

/**
 * Whether the fit supplies the value at this wavelength. Its range is closed,
 * so an end reads the fit unless `knotSide` asks for the side the table is on:
 * 'left' at the lower end, 'right' at the upper.
 */
function readsFit(fit, wavelengthNm, knotSide) {
    if (!fit) return false;
    const [low, high] = fit.rangeNm;
    if (wavelengthNm === low && knotSide === 'left') return false;
    if (wavelengthNm === high && knotSide === 'right') return false;
    return wavelengthNm >= low && wavelengthNm <= high;
}

// At the end of a fit the value itself steps, so no derivative is continuous
// there, the value included.
const FIT_EDGE_ORDER = -1;

// Whether the wavelength is one of the fit ends dispersionFitEdges lists.
function onFitEdge(fit, material, wavelengthNm) {
    const nAt = material?.getNK?.nInterpolator;
    return Boolean(fit && nAt) && fitEndsInsideTable(fit, nAt).includes(wavelengthNm);
}

// A worker carries jets precomputed at the wavelengths it was given, averaged
// where one falls on a knot, so a request for one side goes to the
// interpolators instead.
function precomputedResponse(material, wavelengthNm, knotSide) {
    return knotSide ? null : material?.getOmegaResponse?.(wavelengthNm);
}

/**
 * Evaluate n + ik and its first three omega derivatives at one wavelength.
 * Formula materials are differentiated directly. Tabulated components use the
 * exact derivatives of the active piece under the material's own rule: the
 * local cubic for PCHIP, the secant for a linear table, whose second and
 * third derivatives are zero inside a piece. Exactly on a table knot the two
 * adjacent pieces are averaged unless `knotSide` names one of them.
 *
 * At an end of an active dispersion fit that `dispersionFitEdges` lists, the
 * value itself steps. The wavelength is reported as a knot with continuity
 * order −1, the fit is read there by default, as getNK reads it, and
 * `knotSide` reads the table instead on the side it lies: 'left' at the lower
 * end, 'right' at the upper.
 */
export function materialOmegaResponse(material, wavelengthNm, knotSide) {
    const precomputed = precomputedResponse(material, wavelengthNm, knotSide);
    if (precomputed) return precomputed;
    const omega = 2 * Math.PI * C_NM_PER_FS / wavelengthNm;
    const wavelengthJet = wavelengthOmegaJet(wavelengthNm, omega);
    const wavelengthMicrometersJet = jetScale(wavelengthJet, 1 / 1000);
    const formula = formulaDescriptor(material);
    const tables = tableInterpolators(material);
    const fit = activeFit(material);
    const useFit = readsFit(fit, wavelengthNm, knotSide);
    const fitEdge = onFitEdge(fit, material, wavelengthNm);
    const baseNK = material?.getNK?.(wavelengthNm) || [NaN, NaN];

    let nJet;
    let kJet;
    let inRange = materialRangeContains(material, wavelengthNm);
    let nModel;
    let kModel;
    let nKnotSegment = null;
    let kKnotSegment = null;
    const tableSamples = [];

    if (useFit) {
        ({ nJet, kJet } = evaluateDispersionFitJets(fit, wavelengthMicrometersJet));
        nModel = dispersionFitModelName(fit);
        kModel = nModel;
    } else if (formula) {
        nJet = evalNJet(formula.formulaNum, formula.coefficients, wavelengthMicrometersJet);
        nModel = modelName(formula);
    } else if (tables) {
        const evaluated = tableJet(tables.nAt, wavelengthJet, wavelengthNm, knotSide);
        tableSamples.push(evaluated);
        nJet = evaluated.jet;
        inRange = inRange && evaluated.inRange;
        nKnotSegment = evaluated.segment;
        nModel = tableModelName(tables.nAt);
    } else if (material?.getNK?.constantNK) {
        nJet = jetConstant(material.getNK.constantNK[0]);
        nModel = 'Constant';
    }

    const kInterpolator = material?.getNK?.kInterpolator;
    if (!useFit && tables) {
        const evaluated = tableJet(tables.kAt, wavelengthJet, wavelengthNm, knotSide);
        tableSamples.push(evaluated);
        kJet = evaluated.jet;
        inRange = inRange && evaluated.inRange;
        kKnotSegment = evaluated.segment;
        kModel = tableModelName(tables.kAt);
    } else if (!useFit && kInterpolator) {
        const useNanometers = material.getNK.kInterpolatorUnit === 'nm';
        const evaluated = tableJet(
            kInterpolator,
            useNanometers ? wavelengthJet : wavelengthMicrometersJet,
            useNanometers ? wavelengthNm : wavelengthNm / 1000,
            knotSide,
        );
        tableSamples.push(evaluated);
        kJet = evaluated.jet;
        inRange = inRange && evaluated.inRange;
        kKnotSegment = evaluated.segment;
        kModel = tableModelName(kInterpolator);
    } else if (!useFit) {
        kJet = jetConstant(baseNK[1] || 0);
        kModel = baseNK[1] ? 'Constant' : 'Zero';
    }

    const onKnot = fitEdge || tableSamples.some(sample => sample.onKnot);
    if (!nJet || !kJet) {
        return {
            nk: [baseNK[0], baseNK[1]],
            derivatives: null,
            model: 'Unavailable',
            phaseModel: nModel || 'Unavailable',
            // Nothing is known about a model that could not be built, so it
            // counts as C0 here; a table that could still reports its order.
            phaseContinuousOrder: CONTINUOUS_ORDER_BY_MODEL[nModel] ?? 0,
            continuousOrder: Math.max(CONTINUOUS_ORDER_BY_MODEL[nModel] ?? 0, CONTINUOUS_ORDER_BY_MODEL[kModel] ?? 0),
            maxOrder: 0,
            inRange,
            onKnot,
        };
    }

    const nkJet = jetWithImaginaryPart(nJet, kJet);
    const derivatives = jetDerivatives(nkJet);
    return {
        nk: derivatives[0],
        derivatives: derivatives.slice(1),
        jet: nkJet,
        model: nModel === kModel ? nModel : `n: ${nModel}; k: ${kModel}`,
        phaseModel: nModel,
        phaseContinuousOrder: fitEdge ? FIT_EDGE_ORDER : continuousOrderOf(nModel),
        continuousOrder: fitEdge ? FIT_EDGE_ORDER : continuousOrderOf(nModel, kModel),
        maxOrder: 3,
        inRange,
        onKnot,
    };
}

/**
 * Single-pass bulk-material phase and dispersion at normal incidence.
 * `knotSide` picks a one-sided value where the wavelength falls on a table knot.
 */
export function materialPropagationDispersion(material, wavelengthNm, thicknessMm, knotSide) {
    const response = materialOmegaResponse(material, wavelengthNm, knotSide);
    // A wavelength outside the material's range still has a value: the table
    // holds its end value there and a formula is extrapolated. The point is
    // returned valid and flagged `outsideRange`, so the window can draw it and
    // shade the band while the table and its export still say which rows are
    // not measurement. A gap here means no value at all.
    const outsideRange = !response.inRange;
    if (!response.derivatives || response.maxOrder < 3) {
        return {
            wavelengthNm,
            valid: false,
            reason: `${material?.name || material?.id || 'Material'}: third-order derivatives are unavailable`,
            model: response.model,
            phaseModel: response.phaseModel,
            phaseContinuousOrder: response.phaseContinuousOrder,
        };
    }
    const omega = 2 * Math.PI * C_NM_PER_FS / wavelengthNm;
    const distanceNm = thicknessMm * 1e6;
    const distanceOverC = distanceNm / C_NM_PER_FS;
    const n = response.nk[0];
    const k = Math.max(response.nk[1], 0);
    const opticalDepth = 2 * Math.PI * k * distanceNm / wavelengthNm;
    const log10InternalTransmission = -2 * opticalDepth / Math.LN10;
    const maximumThicknessMm = k > 0
        ? MAX_PROPAGATION_OPTICAL_DEPTH * wavelengthNm / (2 * Math.PI * k * 1e6)
        : Infinity;
    if (opticalDepth > MAX_PROPAGATION_OPTICAL_DEPTH) {
        return {
            wavelengthNm,
            valid: false,
            reason: `${material?.name || material?.id || 'Material'}: direct pulse is extinguished at this thickness`,
            model: response.model,
            phaseModel: response.phaseModel,
            phaseContinuousOrder: response.phaseContinuousOrder,
            log10InternalTransmission,
            maximumThicknessMm,
        };
    }
    const first = response.derivatives[0][0];
    const second = response.derivatives[1][0];
    const third = response.derivatives[2][0];
    return {
        wavelengthNm,
        valid: true,
        phaseRad: -distanceOverC * omega * n,
        gdFs: distanceOverC * (n + omega * first),
        gddFs2: distanceOverC * (2 * first + omega * second),
        todFs3: distanceOverC * (3 * second + omega * third),
        groupIndex: n + omega * first,
        outsideRange,
        model: response.model,
        phaseModel: response.phaseModel,
        phaseContinuousOrder: response.phaseContinuousOrder,
        log10InternalTransmission,
        maximumThicknessMm,
    };
}
