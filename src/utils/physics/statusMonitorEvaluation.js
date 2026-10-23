import {
    makeOperand, evaluateOperands, buildEvalContext, resolveEvalMode, isExtremumRow,
} from './optimizer.js';
import { evaluateQualifier, coatedThickness } from '../synthesis/qualifiers.js';

export const DIRECT_MONITOR_META = {
    GD:       { mode: 'point', unit: 'fs', decimals: 3, phase: true },
    GDT:      { mode: 'point', unit: 'fs', decimals: 3, phase: true },
    GDD:      { mode: 'point', unit: 'fs2', decimals: 3, phase: true },
    GDDT:     { mode: 'point', unit: 'fs2', decimals: 3, phase: true },
    TOD:      { mode: 'point', unit: 'fs3', decimals: 3, phase: true },
    TODT:     { mode: 'point', unit: 'fs3', decimals: 3, phase: true },
    GDFLAT:   { mode: 'band', unit: 'fs', decimals: 3, phase: true, level: true },
    GDTFLAT:  { mode: 'band', unit: 'fs', decimals: 3, phase: true, level: true },
    GDDFLAT:  { mode: 'band', unit: 'fs2', decimals: 3, phase: true, level: true },
    GDDTFLAT: { mode: 'band', unit: 'fs2', decimals: 3, phase: true, level: true },
    TODFLAT:  { mode: 'band', unit: 'fs3', decimals: 3, phase: true, level: true },
    TODTFLAT: { mode: 'band', unit: 'fs3', decimals: 3, phase: true, level: true },
    EFMX:     { mode: 'point', unit: 'none', decimals: 4, frontOnly: true },
    PSI:      { mode: 'point', unit: 'deg', decimals: 3, frontOnly: true, noPol: true },
    DEL:      { mode: 'point', unit: 'deg', decimals: 3, frontOnly: true, noPol: true },
    PR:       { mode: 'point', unit: 'deg', decimals: 3, phase: true },
    PT:       { mode: 'point', unit: 'deg', decimals: 3, phase: true },
    MXWT:     { mode: 'band', unit: 'nm', decimals: 2 },
    MXWR:     { mode: 'band', unit: 'nm', decimals: 2 },
    MXWA:     { mode: 'band', unit: 'nm', decimals: 2 },
    MNWT:     { mode: 'band', unit: 'nm', decimals: 2 },
    MNWR:     { mode: 'band', unit: 'nm', decimals: 2 },
    MNWA:     { mode: 'band', unit: 'nm', decimals: 2 },
    TT:       { mode: 'fact', unit: 'nm', decimals: 2, noGeometry: true },
    STR:      { mode: 'fact', unit: 'newtonPerM', decimals: 2, noGeometry: true },
    MNT:      { mode: 'layers', unit: 'nm', decimals: 3, noGeometry: true },
    MXT:      { mode: 'layers', unit: 'nm', decimals: 3, noGeometry: true },
};

export const FACT_MONITOR_META = {
    layerCount:       { unit: 'none', decimals: 0 },
    totalThickness:   { unit: 'nm', decimals: 2 },
    materialCount:    { unit: 'none', decimals: 0 },
    minThickness:     { unit: 'nm', decimals: 3 },
    maxThickness:     { unit: 'nm', decimals: 3 },
};

export const DERIVED_MONITOR_META = {
    fwhm:     { unit: 'nm', decimals: 2 },
    edgeLeft: { unit: 'nm', decimals: 2 },
    edgeRight:{ unit: 'nm', decimals: 2 },
};

// The step flag a monitor searches a band for its peak at, and scans a FWHM or
// edge monitor's band at: 0.1 nm (operandModel.js extremumStepNm), ten times
// finer than a merit row's default. The status bar works its monitors out on
// the analysis worker and follows a run four times a second, so the cost,
// which grows with the width of the band, never holds up the interface.
export const MONITOR_FLAG = 2;

// The flag a monitor row carries: MONITOR_FLAG on a row that searches its band
// for an extremum. A band average, integral or flatness monitor takes none, so
// it keeps the band grid it has always had.
const searchFlag = type => (isExtremumRow(type) ? { flag: MONITOR_FLAG } : {});

const MONITOR_OPERAND_TYPE = {
    point:    quantity => quantity,
    avg:      quantity => quantity + 'AV',
    min:      quantity => quantity + 'MN',
    max:      quantity => quantity + 'MX',
    integral: quantity => quantity + 'IW',
};

export function scopedFactLayers(design) {
    const mode = resolveEvalMode(design);
    if (mode === 'back') return design.backLayers || [];
    if (mode === 'total') return [...(design.frontLayers || []), ...(design.backLayers || [])];
    return design.frontLayers || [];
}

const thicknessesOf = layers => layers.map(layer => Number(layer.thickness) || 0);

// The fact monitors that read the layers scopedFactLayers gives.
const LAYER_FACTS = {
    layerCount:    layers => layers.length,
    materialCount: layers => new Set(layers.map(layer => layer.material)).size,
    minThickness:  layers => (layers.length ? Math.min(...thicknessesOf(layers)) : null),
    maxThickness:  layers => (layers.length ? Math.max(...thicknessesOf(layers)) : null),
};

// A fact monitor's reading. Total thickness is the coated sides' thickness the
// TT row reads (coatedThickness), whatever side the design is evaluated on.
function factValue(monitor, design) {
    if (monitor.fact === 'totalThickness') return coatedThickness(design);
    const read = LAYER_FACTS[monitor.fact];
    return read ? read(scopedFactLayers(design)) : null;
}

function derivedValue(monitor, design, resolveMaterial) {
    const result = evaluateQualifier({
        id: 'monitor', enabled: true,
        kind: monitor.type === 'fwhm' ? 'FWHM' : 'EDGE_LAMBDA',
        channel: monitor.qty || 'T', pol: monitor.pol || 'avg', aoi: monitor.aoi || 0,
        lambdaStart: monitor.lambdaStart, lambdaEnd: monitor.lambdaEnd,
        direction: monitor.direction || 'max', level: monitor.level ?? 0.5,
        edgeSide: monitor.type === 'edgeRight' ? 'right' : 'left',
        cmp: 'ge', target: 0, flag: MONITOR_FLAG,
    }, design, resolveMaterial);
    return Number.isFinite(result?.value) ? result.value : null;
}

function directValue(direct, monitor, design, resolveMaterial) {
    const operand = makeOperand({
        type: monitor.type,
        lambdaStart: direct.mode === 'point' ? monitor.lambda
            : direct.mode === 'layers' ? (monitor.layerStart ?? 1) : monitor.lambdaStart,
        lambdaEnd: direct.mode === 'point' ? monitor.lambda
            : direct.mode === 'layers' ? (monitor.layerEnd ?? 1000000) : monitor.lambdaEnd,
        aoi: monitor.aoi || 0, pol: monitor.pol || 'avg', target: monitor.target ?? 0, weight: 1,
        ...searchFlag(monitor.type),
    });
    const value = evaluateOperands([operand], buildEvalContext(design, resolveMaterial))[0];
    return Number.isFinite(value) ? value : null;
}

export function computeMonitor(monitor, design, resolveMaterial) {
    try {
        if (monitor.type === 'fact') return factValue(monitor, design);
        if (DERIVED_MONITOR_META[monitor.type]) return derivedValue(monitor, design, resolveMaterial);
        const direct = DIRECT_MONITOR_META[monitor.type];
        if (direct) return directValue(direct, monitor, design, resolveMaterial);
        const makeType = MONITOR_OPERAND_TYPE[monitor.type];
        return makeType ? percentValue(makeType, monitor, design, resolveMaterial) : null;
    } catch {
        return null;
    }
}

// A spectral monitor's reading, in percent.
function percentValue(makeType, monitor, design, resolveMaterial) {
    const single = monitor.type === 'point';
    const operand = makeOperand({
        type: makeType(monitor.qty),
        lambdaStart: single ? monitor.lambda : monitor.lambdaStart,
        lambdaEnd: single ? monitor.lambda : monitor.lambdaEnd,
        aoi: monitor.aoi || 0,
        pol: monitor.pol || 'avg',
        target: 0,
        weight: 1,
        ...searchFlag(makeType(monitor.qty)),
        ...(monitor.type === 'integral'
            ? { source: monitor.source || { id: 'E' }, detector: monitor.detector || { id: 'flat' } }
            : {}),
    });
    const value = evaluateOperands([operand], buildEvalContext(design, resolveMaterial))[0];
    return (value == null || !Number.isFinite(value)) ? null : value * 100;
}

export function computeMonitors(monitors, design, resolveMaterial) {
    return monitors.map(monitor => computeMonitor(monitor, design, resolveMaterial));
}
