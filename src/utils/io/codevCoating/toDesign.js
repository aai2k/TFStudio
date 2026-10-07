import { createLinearInterpolator, LINEAR_INTERPOLATION, TABULATED_INTERPOLATION } from '../../materials/pchip.js';
import { micCurve } from './micIndex.js';

// A constant index is tabulated from the deep UV to the far infrared, the
// range the other design importers give one (designImport/materialResolution.js).
const CONSTANT_RANGE_NM = [200, 50000];
const D_LINE_NM = 587.5618;
const LOCKED_CODE = 100;
// How far a straight line between two rows of an imported MIC material may
// stray from CODE V's n: half a unit in the sixth decimal, the precision
// CODE V prints n with.
const LINE_MISS = 5e-7;

const short = (x) => String(Number(x.toPrecision(6)));
const idOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'material';

function record(name, tabData, interp, comment) {
    const nAt = createLinearInterpolator(tabData.map(row => [row[0], row[1]]));
    return {
        id: idOf(name),
        name,
        formulaNum: -1,
        interp,
        coefficients: [],
        kTable: [],
        tabData,
        lambdaMin: tabData[0][0] / 1000,
        lambdaMax: tabData[tabData.length - 1][0] / 1000,
        nd: nAt ? nAt(D_LINE_NM) : null,
        vd: null, density: null,
        comment,
        color: null,
        group: 'Imported',
    };
}

function constantRecord(n, k, comment) {
    const name = k ? `n = ${short(n)}, k = ${short(k)}` : `n = ${short(n)}`;
    return record(name, CONSTANT_RANGE_NM.map(lam => [lam, n, k]), TABULATED_INTERPOLATION, comment);
}

// The wavelengths a MIC material is tabulated at: its MWL points, where k
// bends, and the wavelengths in `needed`, where CODE V computes it; between
// each two, evenly spaced, as many more as keep a straight line within
// LINE_MISS of n. A line between rows h apart misses a curve by at most
// h² · max|n''| / 8.
function micWavelengths(curve, needed) {
    const marks = [...new Set([...curve.mwl, ...needed])].sort((a, b) => a - b);
    const out = [marks[0]];
    for (let i = 1; i < marks.length; i++) {
        const lo = marks[i - 1], hi = marks[i];
        const bend = curve.bendMax(lo, hi);
        const steps = Number.isFinite(bend) ? Math.max(1, Math.ceil((hi - lo) * Math.sqrt(bend / (8 * LINE_MISS)))) : 1;
        for (let s = 1; s < steps; s++) out.push(lo + (hi - lo) * s / steps);
        out.push(hi);
    }
    return out;
}

function micRecord(label, rows, needed, comment) {
    const curve = micCurve(rows);
    const tabData = micWavelengths(curve, needed).map(lam => [lam, curve.n(lam), curve.k(lam)]);
    return record(label, tabData, LINEAR_INTERPOLATION, `${comment}. The rows are CODE V's interpolation of its MIC table.`);
}

/**
 * The TFStudio materials and layers of a CodevStack.
 *
 * Each MIC table becomes a tabulated material named after its label, read
 * with straight lines between rows (TFStudio's n + ik with k ≥ 0 is CODE V's
 * MIC k as entered). Its rows are n and k as CODE V computes them from the
 * table (micIndex.js), from the shortest to the longest of its MWL points,
 * analysis wavelengths and REF, so CODE V's values past the ends of the table
 * come in where the file analyses. Each index entered on a line becomes a
 * constant material named after its value; equal values share one. The
 * warnings are the stack's own, then a `coupledLayers` {count} when layers
 * carry a coupling code (1 to 99), which TFStudio has no equivalent of: those
 * layers come in free.
 *
 * @param {object} stack  CodevStack
 * @param {{sourceName?: string}} [opts]  file name for the materials' comment
 * @returns {{materials: Array<{key:string, material:object}>, incidentKey:string,
 *   substrateKey:string, layers: Array<{materialKey:string, thickness:number, locked:boolean}>,
 *   warnings: Array<object>}}  layers incident side first, thickness in nm
 */
export function codevStackToDesign(stack, opts = {}) {
    const comment = `Imported from CODE V ${opts.sourceName || 'coating'}`;
    const needed = [...stack.wavelengthsNm, stack.refNm].filter(Number.isFinite);
    const materials = [];
    const keys = new Map();
    const keyOf = (index) => {
        const key = 'label' in index ? `mic:${index.label}` : `n:${index.n}:${index.k}`;
        if (!keys.has(key)) {
            keys.set(key, true);
            const material = 'label' in index
                ? micRecord(index.label, stack.mic[index.label], needed, comment)
                : constantRecord(index.n, index.k, comment);
            materials.push({ key, material });
        }
        return key;
    };
    const incidentKey = keyOf(stack.incident);
    const layers = stack.layers.map(layer => ({
        materialKey: keyOf(layer.index),
        thickness: layer.thicknessNm,
        locked: layer.code === LOCKED_CODE,
    }));
    const substrateKey = keyOf(stack.substrate);
    const coupled = stack.layers.filter(layer => layer.code > 0 && layer.code < LOCKED_CODE).length;
    const warnings = [...(stack.warnings || [])];
    if (coupled) warnings.push({ kind: 'coupledLayers', count: coupled });
    return { materials, incidentKey, substrateKey, layers, warnings };
}
