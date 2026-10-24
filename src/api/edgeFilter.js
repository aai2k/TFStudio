// The Edge Filter window's search for a non-polarizing edge filter
// (utils/synthesis/edgeFilter.js) and its Replace and Append, with the
// window's own model (design/edgeFilter/model.js).

import { searchEdgeFilters, EDGE_SEARCH_LIMITS } from '../utils/synthesis/edgeFilter.js';
import {
    initialInputs, edgeRequest, formulaSymbols, periodFormula, compileEdgeFilter, edgeFilterPatch,
} from '../components/windows/design/edgeFilter/model.js';
import { ensureLayerIds } from '../utils/io/newDesign.js';
import { requireMaterial, requireResolved } from './materials.js';
import { scoredSide } from './stackViews.js';
import { checkOptions, requireValue, isPositive, isAngle } from './check.js';
import en from '../constants/locales/en.js';

const SEARCH_OPTIONS = ['pass', 'edge', 'angle', 'a', 'b', 'incident', 'lower', 'upper', 'step', 'periods'];
const L = EDGE_SEARCH_LIMITS;
const isWhole = v => Number.isInteger(v) && v >= 1;

// The window's inputs for the options given: its opening inputs on this
// design (initialInputs with nothing remembered), each option given in place
// of its field, every value checked.
function searchInputs(call, design, options) {
    // The window opens only on a design whose materials all resolve.
    requireResolved(design);
    const opening = initialInputs(design, {});
    const {
        pass = opening.pass, edge = opening.edgeLambda, angle = opening.angle, a = opening.matA, b = opening.matB,
        incident = opening.incidentMat, lower = opening.lower, upper = opening.upper, step = opening.step, periods = opening.periods,
    } = options;
    requireValue(call, 'pass', pass, v => v === 'short' || v === 'long', "'short' or 'long'");
    requireValue(call, 'edge', edge, isPositive, 'a wavelength in nm above 0');
    requireValue(call, 'angle', angle, isAngle, 'an angle of incidence in degrees, 0 <= angle < 90');
    requireValue(call, 'lower', lower, v => Number.isFinite(v) && v >= L.lowerMin, `a number of quarter waves from ${L.lowerMin}`);
    requireValue(call, 'upper', upper, v => Number.isFinite(v) && v > lower && v <= L.upperMax, `a number of quarter waves above lower and up to ${L.upperMax}`);
    requireValue(call, 'step', step, v => Number.isFinite(v) && v >= L.stepMin, `a step of ${L.stepMin} or more`);
    requireValue(call, 'periods', periods, isWhole, 'a whole number of periods from 1');
    for (const [name, id] of [['a', a], ['b', b], ['incident', incident]]) {
        requireValue(call, name, id, v => typeof v === 'string' && v !== '', 'a material id');
        try { requireMaterial(design, id); } catch (err) { throw new Error(`${call}: ${name}: ${err.message}`); }
    }
    return { ...opening, pass, edgeLambda: edge, angle, matA: a, matB: b, incidentMat: incident, lower, upper, step, periods };
}

// The search on `inputs`, as the window runs it on opening and on Search.
function search(call, design, inputs) {
    const prepared = edgeRequest(design, inputs);
    const found = prepared.errorKey ? prepared : searchEdgeFilters(prepared.request);
    if (found.errorKey) throw new Error(`${call}: ${en.edgeFilter.errors[found.errorKey] || found.errorKey}`);
    return { prepared, symbols: formulaSymbols(inputs, prepared.request), solutions: found.solutions };
}

/**
 * The periods of a non-polarizing edge filter, as the
 * [Edge Filter](/design/edge-filter/) window searches them: the five-layer
 * period (aA bB cA bB aA), or (aB bA cB bA aB), whose s and p zone edges
 * meet at the edge wavelength at the angle of incidence, a, b and c quarter
 * waves at the edge wavelength, best first: the widest rejection band, the
 * narrower of the s and p zones, and on a tie the wider pass region. At 0°
 * s and p are one wave, and the search gives the quarter-wave period
 * (½sO sI ½sO) both ways round, the better matched first, with c null. The
 * indices are the materials' real indices at the edge wavelength, and A and B
 * are taken as lossless. Without options, the window's opening settings on
 * the design; the materials the window remembers from its last opening are
 * not used.
 *
 * @param design The design: its reference wavelength, media and front layers give the defaults.
 * @param [options]
 * @param [options.pass='short'] `'short'`, a shortwave pass, or `'long'`, a longwave pass.
 * @param [options.edge] The edge wavelength, nm. Without it, the design's reference wavelength.
 * @param [options.angle=0] The angle of incidence, degrees in the incident medium, 0 up to but not including 90.
 * @param [options.a] Material A, by id. Without it, the lowest index of the front layers at the reference wavelength, or SiO2 when the front has fewer than two materials.
 * @param [options.b] Material B, by id. Without it, the highest index of the front layers, or TiO2.
 * @param [options.incident] The medium the light arrives from, by id. Without it, the design's incident medium.
 * @param [options.lower=0.1] The first a searched, quarter waves, from 0.
 * @param [options.upper=1] The last a searched, quarter waves, above lower and up to 2.
 * @param [options.step=0.05] The step of a, 0.0001 or more. At an angle above 0 the finest step over the widest range takes minutes.
 * @param [options.periods=10] The number of periods each solution's formula repeats.
 * @returns The periods found.
 * @property pass `'short'` or `'long'`.
 * @property edge The edge wavelength, nm.
 * @property angle The angle of incidence, degrees.
 * @property materials The materials searched, `{ a, b, incident }`, by id.
 * @property indices Their real indices at the edge wavelength, `{ a, b, incident }`.
 * @property absorbing The ids of A and B that absorb at the edge wavelength (k above 0), which the search took as lossless.
 * @property periods The number of periods in each formula.
 * @property solutions The periods, best first, each `{ outer, a, b, c, sigma, zoneS, zoneP, passWidth, formula }`: outer `'A'` or `'B'`, the material of the outer and centre layers; a, b and c quarter waves at the edge wavelength, c null for the quarter-wave period at 0°; sigma, +1 or -1, the value of N11 at the edge, +1 on an even-order zone; zoneS and zoneP the widths in nm of the s and p high-reflectance zones from the edge, and passWidth the width in nm of the pass region beside the edge, Infinity where it does not end; formula, the filter as Stack Formula writes it, H the higher index of A and B and L the lower.
 * @throws an option it does not take, or a value an option cannot take
 * @throws a material id that resolves to nothing, naming the closest ids, or a design that names one, on which the window does not open
 * @throws a material with no index at the edge wavelength, A and B of one index there, or a material past its critical angle at the angle, as the window says it
 * @example
 * const design = tf.newDesign({ name: 'Edge' });
 * const found = tf.edgeFilter(design, { edge: 1000, angle: 45, a: 'SiO2', b: 'TiO2' });
 * const best = found.solutions[0];
 * console.log(found.solutions.length, 'periods; best a', best.a, 'b', best.b.toFixed(4), 'c', best.c.toFixed(4));
 * console.log(best.formula);
 */
export function edgeFilter(design, options) {
    const inputs = searchInputs('edgeFilter', design, checkOptions('edgeFilter', options, SEARCH_OPTIONS));
    const { prepared, symbols, solutions } = search('edgeFilter', design, inputs);
    const { request } = prepared;
    return {
        pass: inputs.pass, edge: inputs.edgeLambda, angle: inputs.angle,
        materials: { a: inputs.matA, b: inputs.matB, incident: inputs.incidentMat },
        indices: { a: request.nA, b: request.nB, incident: request.nIncident },
        absorbing: prepared.absorbing,
        periods: inputs.periods,
        solutions: solutions.map(solution => ({ ...solution, formula: periodFormula(solution, symbols, inputs.periods) })),
    };
}

/**
 * A design with an edge filter put in, as the [Edge Filter](/design/edge-filter/)
 * window's Replace or Append puts the period it lists in: the search is
 * edgeFilter's with the same options, and the solution chosen is built
 * through Stack Formula, quarter waves at the edge wavelength, with each pair
 * of touching outer layers joined into one. Replace puts the filter in place
 * of the side's layers, makes the edge wavelength the design's reference
 * wavelength, and makes the medium searched the incident medium of a front
 * filter or the exit medium of a back one; Append adds the layers outside
 * the side's own and changes nothing else. Filling the side a one-sided
 * design does not coat makes it coated on both when its other side has
 * layers, and on the filled side alone when it has none, as the window does.
 *
 * @param design The design.
 * @param [options] edgeFilter's options, which give the search, and these.
 * @param [options.solution=0] Which solution, its place in edgeFilter's list, from 0, the best.
 * @param [options.side] `'front'` or `'back'`. Without it, the front, or the back of a design coated on the back alone. A symmetric design takes the front, its back the mirror.
 * @param [options.mode='replace'] `'replace'` or `'append'`.
 * @returns The design with the filter.
 * @throws what edgeFilter throws
 * @throws a solution that is not in the list, a side other than `'front'` or `'back'`, the back of a symmetric design, or a mode other than `'replace'` or `'append'`
 * @example
 * const design = tf.newDesign({ name: 'Short-wave pass' });
 * const filtered = tf.applyEdgeFilter(design, { edge: 700, a: 'SiO2', b: 'TiO2', periods: 8 });
 * console.log(filtered.frontLayers.length, 'layers; reference', filtered.referenceWavelength, 'nm');
 */
export function applyEdgeFilter(design, options) {
    const { solution = 0, side, mode = 'replace', ...given } = checkOptions('applyEdgeFilter', options, [...SEARCH_OPTIONS, 'solution', 'side', 'mode']);
    const inputs = searchInputs('applyEdgeFilter', design, given);
    requireValue('applyEdgeFilter', 'mode', mode, v => v === 'replace' || v === 'append', "'replace' or 'append'");
    const effSide = scoredSide('applyEdgeFilter', design, side);
    const isSym = design.surfaceMode === 'symmetric';
    if (isSym && effSide === 'back') throw new Error('applyEdgeFilter: in symmetric mode the back mirrors the front; give the front');
    const { symbols, solutions } = search('applyEdgeFilter', design, inputs);
    requireValue('applyEdgeFilter', 'solution', solution, v => Number.isInteger(v) && v >= 0 && v < solutions.length,
        `the place of one of the ${solutions.length} solutions, from 0`);
    const formula = periodFormula(solutions[solution], symbols, inputs.periods);
    const compiled = compileEdgeFilter(design, formula, symbols.symbolMap, inputs.edgeLambda);
    if (!compiled.ok) throw new Error(`applyEdgeFilter: the formula ${formula} does not build: ${compiled.errorKey}`);
    const next = { ...design, ...edgeFilterPatch({ design, mode, isSym, effSide, compiled, inputs, formula, stamp: Date.now() }) };
    return { ...next, frontLayers: ensureLayerIds(next.frontLayers), backLayers: ensureLayerIds(next.backLayers) };
}
