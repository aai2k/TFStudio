/**
 * The merit function wizard's curve types: the rows they write and the curves
 * they put on the design.
 *
 * Curve writes the block Fit… writes, through the same builder, so a curve
 * target made either way is the same row. Gain flattening writes the target as
 * a block in dB with its level free, a PPEF row against it and a TDBMN row
 * holding the insertion loss at the target's peak; a gain taken as input is
 * turned into a target curve first, and that curve goes on the design so it
 * draws on the plot and can be opened like any other.
 */

import {
    X_UNITS, makeMeasuredCurve, parseSpectrumTable, xToNm,
} from '../../../../utils/io/spectrumTable.js';
import { flatteningLossDb } from '../../../../utils/physics/gainFlattening.js';
import { FILTER_TYPES, fractionFromLog, makeOperand } from '../../../../utils/physics/optimizer.js';
import { measuredFitSnapshot } from '../../dataExchange/spectrumExchange/model.js';

/** The design's measured curves a curve field offers, by quantity. */
export function wizardCurveOptions(design, quantities) {
    return (design?.measuredCurves || []).filter(curve => quantities.includes(curve.quantity));
}

/**
 * The curve a curve field holds among `curves`: the one picked, or, while none
 * is, the only curve there is to pick, so a curve made for the job is taken
 * without choosing it from a list of one. Null when there is a choice to make.
 */
export function heldCurve(curves, curveId) {
    return curves.find(curve => curve.id === curveId) || (curves.length === 1 ? curves[0] : null);
}

/**
 * A gain read from text, as { name, x (nm), y (dB) }, or null when the text
 * holds no table. The first value column is taken as gain in dB, as written.
 */
export function gainCurveFromText(text, fileName = '') {
    const table = parseSpectrumTable(text);
    const column = table.ok ? table.columns[0] : null;
    if (!column) return null;
    const unit = column.xUnit === X_UNITS.UNKNOWN ? X_UNITS.NM : column.xUnit;
    const pairs = column.x
        .map((value, index) => [xToNm(value, unit), column.values[index]])
        .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
        .sort((a, b) => a[0] - b[0]);
    if (pairs.length < 2) return null;
    return {
        name: String(fileName).replace(/\.[^.]+$/, '') || 'Gain',
        x: pairs.map(pair => pair[0]),
        y: pairs.map(pair => pair[1]),
    };
}

/** The transmittance curve that flattens a gain, at the given angle and polarization. */
export function gainTargetCurve(gain, { aoi = 0, pol = 'avg' } = {}, name = gain.name) {
    return makeMeasuredCurve({
        name, x: gain.x, xUnit: X_UNITS.NM,
        y: flatteningLossDb(gain.y).map(db => fractionFromLog('dB', db)),
        quantity: 'T', aoi, pol, source: 'gain flattening',
    });
}

// A curve the design already holds with the same points and conditions, so
// generating again from the same gain does not add a second copy.
const sameConditions = (a, b) => ['quantity', 'aoi', 'pol'].every(key => a[key] === b[key]);
const samePoints = (a, b) => a.x.length === b.x.length
    && a.x.every((x, index) => x === b.x[index] && a.y[index] === b.y[index]);
function sameCurve(a, b) {
    return sameConditions(a, b) && samePoints(a, b);
}

// The curve a type's curve field holds (heldCurve): 'noCurves' when the design
// has none it could take, 'noCurve' when there are several and none is picked.
function pickedCurve(design, typeId, curveId) {
    const { quantities } = FILTER_TYPES[typeId].fields.find(field => field.kind === 'curve');
    const curves = wizardCurveOptions(design, quantities);
    if (!curves.length) return { error: 'noCurves' };
    const curve = heldCurve(curves, curveId);
    return curve ? { curve } : { error: 'noCurve' };
}

function targetCurveOf(design, params, flatteningName) {
    if (params.input === 'target') {
        const picked = pickedCurve(design, 'GAIN_FLATTENING', params.curveId);
        return picked.error ? picked : { curve: picked.curve, added: [] };
    }
    if (!params.gain?.x?.length) return { error: 'noGain' };
    const derived = gainTargetCurve(params.gain, { aoi: params.curveAoi, pol: params.curvePol },
        flatteningName(params.gain.name));
    const existing = (design?.measuredCurves || []).find(item => sameCurve(item, derived));
    return existing ? { curve: existing, added: [] } : { curve: derived, added: [derived] };
}

// The wavelength of the block's highest target: where a passive filter's loss
// is least, so the insertion loss is held there.
function peakLambda(block) {
    let best = 0;
    block.sampleTargets.forEach((value, index) => { if (value > block.sampleTargets[best]) best = index; });
    return block.sampleLambdas[best];
}

function blockOf(design, curve, scale) {
    const snapshot = measuredFitSnapshot(design, curve, { scale });
    return snapshot.operand ? { block: snapshot.operand } : { error: snapshot.error === 'dbEmpty' ? 'dbEmpty' : 'range' };
}

function curveTargetRows(design, params) {
    const { curve, error: missing } = pickedCurve(design, 'CURVE_TARGET', params.curveId);
    if (missing) return { error: missing };
    const { block, error } = blockOf(design, curve, params.scale);
    return error ? { error } : { rows: [block], curves: [], curveName: curve.name };
}

function gainFlatteningRows(design, params, flatteningName) {
    const target = targetCurveOf(design, params, flatteningName);
    if (target.error) return { error: target.error };
    const { block: fitted, error } = blockOf(design, target.curve, 'dB');
    if (error) return { error };
    const block = { ...fitted, levelFree: true };
    const lambda = peakLambda(block);
    const ppef = makeOperand({ type: 'PPEF', refId: block.id, target: Number(params.ppefDb) || 0, weight: 1 });
    const loss = makeOperand({
        type: 'TDBMN', lambdaStart: lambda, lambdaEnd: lambda, aoi: block.aoi, pol: block.pol,
        target: -(Number(params.insertionLossDb) || 0), weight: 1,
    });
    return { rows: [block, ppef, loss], curves: target.added, curveName: target.curve.name };
}

/**
 * The rows a curve type writes, the curves it adds to the design, and the
 * name of the curve it read; or { error } naming what is missing: 'noCurves'
 * (no curve on the design the type can take), 'noCurve' (none picked),
 * 'noGain', 'range' (no point inside the materials' data) or 'dbEmpty' (no
 * point above 0 %). `flatteningName` names a target derived from a gain.
 */
export function curveWizardRows({ typeId, params, design, flatteningName = name => name }) {
    if (typeId === 'GAIN_FLATTENING') return gainFlatteningRows(design, params, flatteningName);
    return curveTargetRows(design, params);
}
