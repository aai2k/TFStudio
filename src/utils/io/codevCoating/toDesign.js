import { createPchipInterpolator, TABULATED_INTERPOLATION } from '../../materials/pchip.js';

// A constant index is tabulated from the deep UV to the far infrared, the
// range the other design importers give one (designImport/materialResolution.js).
const CONSTANT_RANGE_NM = [200, 50000];
const D_LINE_NM = 587.5618;
const LOCKED_CODE = 100;

const short = (x) => String(Number(x.toPrecision(6)));
const idOf = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'material';

function record(name, rows, comment) {
    const tabData = rows.map(([lam, n, k]) => [lam, n, k]).sort((a, b) => a[0] - b[0]);
    const nAt = createPchipInterpolator(tabData.map(row => [row[0], row[1]]));
    return {
        id: idOf(name),
        name,
        formulaNum: -1,
        interp: TABULATED_INTERPOLATION,
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
    return record(name, CONSTANT_RANGE_NM.map(lam => [lam, n, k]), comment);
}

/**
 * The TFStudio materials and layers of a CodevStack.
 *
 * Each MIC table becomes a tabulated material named after its label, with
 * the rows as entered (TFStudio's n + ik with k ≥ 0 is CODE V's MIC k as
 * entered). Each index entered on a line becomes a constant material named
 * after its value; equal values share one. The tables are read with
 * TFStudio's default interpolation, which does not reproduce CODE V's between
 * MWL points (see micIndex.js). The warnings are the stack's own, then a
 * `coupledLayers` {count} when layers carry a coupling code (1 to 99), which
 * TFStudio has no equivalent of: those layers come in free.
 *
 * @param {object} stack  CodevStack
 * @param {{sourceName?: string}} [opts]  file name for the materials' comment
 * @returns {{materials: Array<{key:string, material:object}>, incidentKey:string,
 *   substrateKey:string, layers: Array<{materialKey:string, thickness:number, locked:boolean}>,
 *   warnings: Array<object>}}  layers incident side first, thickness in nm
 */
export function codevStackToDesign(stack, opts = {}) {
    const comment = `Imported from CODE V ${opts.sourceName || 'coating'}`;
    const materials = [];
    const keys = new Map();
    const keyOf = (index) => {
        const key = 'label' in index ? `mic:${index.label}` : `n:${index.n}:${index.k}`;
        if (!keys.has(key)) {
            keys.set(key, true);
            const material = 'label' in index
                ? record(index.label, stack.mic[index.label], comment)
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
