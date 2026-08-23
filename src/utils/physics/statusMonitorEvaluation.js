import {
    makeOperand, evaluateOperands, buildEvalContext, resolveEvalMode,
} from './optimizer.js';
import { evaluateQualifier } from '../synthesis/qualifiers.js';

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

export function computeMonitor(monitor, design, resolveMaterial) {
    try {
        if (monitor.type === 'fact') {
            const layers = scopedFactLayers(design);
            if (monitor.fact === 'layerCount') return layers.length;
            if (monitor.fact === 'materialCount') return new Set(layers.map(layer => layer.material)).size;
            if (monitor.fact === 'totalThickness') {
                return layers.reduce((sum, layer) => sum + (Number(layer.thickness) || 0), 0);
            }
            if (!layers.length) return null;
            if (monitor.fact === 'minThickness') return Math.min(...layers.map(layer => Number(layer.thickness) || 0));
            if (monitor.fact === 'maxThickness') return Math.max(...layers.map(layer => Number(layer.thickness) || 0));
            return null;
        }

        if (DERIVED_MONITOR_META[monitor.type]) {
            const result = evaluateQualifier({
                id: 'monitor', enabled: true,
                kind: monitor.type === 'fwhm' ? 'FWHM' : 'EDGE_LAMBDA',
                channel: monitor.qty || 'T', pol: monitor.pol || 'avg', aoi: monitor.aoi || 0,
                lambdaStart: monitor.lambdaStart, lambdaEnd: monitor.lambdaEnd,
                direction: monitor.direction || 'max', level: monitor.level ?? 0.5,
                edgeSide: monitor.type === 'edgeRight' ? 'right' : 'left',
                cmp: 'ge', target: 0,
            }, design, resolveMaterial);
            return Number.isFinite(result?.value) ? result.value : null;
        }

        const direct = DIRECT_MONITOR_META[monitor.type];
        if (direct) {
            const operand = makeOperand({
                type: monitor.type,
                lambdaStart: direct.mode === 'point' ? monitor.lambda
                    : direct.mode === 'layers' ? (monitor.layerStart ?? 1) : monitor.lambdaStart,
                lambdaEnd: direct.mode === 'point' ? monitor.lambda
                    : direct.mode === 'layers' ? (monitor.layerEnd ?? 1000000) : monitor.lambdaEnd,
                aoi: monitor.aoi || 0, pol: monitor.pol || 'avg', target: monitor.target ?? 0, weight: 1,
            });
            const value = evaluateOperands([operand], buildEvalContext(design, resolveMaterial))[0];
            return Number.isFinite(value) ? value : null;
        }

        const makeType = MONITOR_OPERAND_TYPE[monitor.type];
        if (!makeType) return null;
        const single = monitor.type === 'point';
        const operand = makeOperand({
            type: makeType(monitor.qty),
            lambdaStart: single ? monitor.lambda : monitor.lambdaStart,
            lambdaEnd: single ? monitor.lambda : monitor.lambdaEnd,
            aoi: monitor.aoi || 0,
            pol: monitor.pol || 'avg',
            target: 0,
            weight: 1,
            ...(monitor.type === 'integral'
                ? { source: monitor.source || { id: 'E' }, detector: monitor.detector || { id: 'flat' } }
                : {}),
        });
        const evalDesign = monitor.type === 'integral' ? { ...design, mfEvalMode: 'total' } : design;
        const value = evaluateOperands([operand], buildEvalContext(evalDesign, resolveMaterial))[0];
        return (value == null || !Number.isFinite(value)) ? null : value * 100;
    } catch {
        return null;
    }
}

export function computeMonitors(monitors, design, resolveMaterial) {
    return monitors.map(monitor => computeMonitor(monitor, design, resolveMaterial));
}
