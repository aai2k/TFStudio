import {
    isArgwave, isBlank, isConstraint, isDmfs, isInequality, isIntegral,
    isMath, isMathPairRef, isMathSingleRef, isMinmax, isRangeTarget,
    isTotalThickness, mathResidualKind,
} from '../../../../../utils/physics/optimizer.js';

const TYPE_COLORS = {
    T: [80, 150, 255], TS: [80, 150, 255], TP: [80, 150, 255], TAV: [80, 150, 255],
    TIW: [80, 150, 255], TMN: [80, 150, 255], TMX: [80, 150, 255], TGT: [80, 150, 255],
    R: [50, 200, 100], RS: [50, 200, 100], RP: [50, 200, 100], RAV: [50, 200, 100],
    RIW: [50, 200, 100], RMN: [50, 200, 100], RMX: [50, 200, 100], RGT: [50, 200, 100],
    A: [255, 130, 30], AS: [255, 130, 30], AP: [255, 130, 30], AAV: [255, 130, 30],
    AIW: [255, 130, 30], AMN: [255, 130, 30], AMX: [255, 130, 30], AGT: [255, 130, 30],
    TT: [180, 100, 255],
    OPGT: [140, 160, 200], OPLT: [140, 160, 200], OPVA: [140, 160, 200], ABSO: [140, 160, 200],
    ABGT: [140, 160, 200], ABLT: [140, 160, 200], DIFF: [140, 160, 200],
    SUMM: [140, 160, 200], PROD: [140, 160, 200],
    MXWT: [230, 190, 80], MXWR: [230, 190, 80], MXWA: [230, 190, 80],
    MNWT: [230, 190, 80], MNWR: [230, 190, 80], MNWA: [230, 190, 80],
    MNT: [180, 100, 255], MXT: [180, 100, 255], BLNK: [140, 140, 140],
};

export const COLS = [
    { key: 'num', w: 32, label: '#' },
    { key: 'enabled', w: 28, label: '✓' },
    { key: 'type', w: 72, label: 'Type' },
    { key: 'lambdaStart', w: 96, label: 'λ / Layer' },
    { key: 'lambdaEnd', w: 84, label: 'End *' },
    { key: 'aoi', w: 58, label: 'AOI (°)' },
    { key: 'pol', w: 56, label: 'Pol' },
    { key: 'target', w: 80, label: 'Target' },
    { key: 'weight', w: 62, label: 'Weight' },
    { key: 'current', w: 84, label: 'Current' },
    { key: 'delta', w: 72, label: 'Δ' },
];

export const TABLE_W = COLS.reduce((sum, col) => sum + col.w, 0) + 4;
export const RANGE_AVG_TYPES = new Set(['TAV', 'RAV', 'AAV']);
export const RANGE_TARGET_TYPES = new Set(['TGT', 'RGT', 'AGT']);
const EDITABLE_KEYS = ['enabled', 'type', 'lambdaStart', 'lambdaEnd', 'aoi', 'pol', 'target', 'weight'];

const HEADER_LABELS = [
    [op => isBlank(op.type), { lambdaStart: 'Comment', lambdaEnd: '—' }],
    [op => isTotalThickness(op.type), { lambdaStart: 'Cmp', lambdaEnd: '—' }],
    [op => isConstraint(op.type), { lambdaStart: 'Layer 1', lambdaEnd: 'Layer 2 (range)' }],
    [op => isIntegral(op.type), { lambdaStart: 'Integral', lambdaEnd: '—' }],
    [op => isArgwave(op.type), { lambdaStart: 'λ Start', lambdaEnd: 'λ End' }],
    [op => isMathSingleRef(op.type), { lambdaStart: 'Ref Op#', lambdaEnd: '—' }],
    [op => isMathPairRef(op.type), { lambdaStart: 'Ref Op#1', lambdaEnd: 'Ref Op#2' }],
    [op => isMinmax(op.type) || RANGE_AVG_TYPES.has(op.type) || RANGE_TARGET_TYPES.has(op.type),
        { lambdaStart: 'λ Start', lambdaEnd: 'λ End' }],
];

const EDITABLE_COLS = [
    [op => isDmfs(op.type) || isBlank(op.type), ['enabled']],
    [op => isTotalThickness(op.type), ['enabled', 'type', 'lambdaStart', 'target', 'weight']],
    [op => isConstraint(op.type), ['enabled', 'type', 'lambdaStart', 'lambdaEnd', 'target', 'weight']],
    [op => isIntegral(op.type), ['enabled', 'type', 'lambdaStart', 'aoi', 'pol', 'target', 'weight']],
    [op => isArgwave(op.type), ['enabled', 'type', 'lambdaStart', 'lambdaEnd', 'aoi', 'pol', 'target', 'weight']],
    [op => isMathSingleRef(op.type), ['enabled', 'type', 'lambdaStart', 'target', 'weight']],
    [op => isMathPairRef(op.type), ['enabled', 'type', 'lambdaStart', 'lambdaEnd', 'target', 'weight']],
];

export function typeRgba(type, alpha) {
    const rgb = TYPE_COLORS[type];
    return rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})` : null;
}

export function dynamicHeaderLabels(op) {
    if (!op || isDmfs(op.type)) return { lambdaStart: 'λ / Layer', lambdaEnd: 'End *' };
    const hit = HEADER_LABELS.find(([test]) => test(op));
    return hit ? hit[1] : { lambdaStart: 'λ', lambdaEnd: '—' };
}

export function editableColsForRow(op) {
    const hit = EDITABLE_COLS.find(([test]) => test(op));
    if (hit) return hit[1];
    return EDITABLE_KEYS.filter(key => key !== 'lambdaEnd' || RANGE_AVG_TYPES.has(op.type)
        || RANGE_TARGET_TYPES.has(op.type) || isMinmax(op.type));
}

export function isRangeType(type) {
    if (RANGE_AVG_TYPES.has(type) || RANGE_TARGET_TYPES.has(type)) return true;
    return isMinmax(type) || isInequality(type) || isArgwave(type);
}

export function rowDisplayMeta(op, rawCur, mathPercent) {
    const isCon = isConstraint(op.type);
    const isTT = isTotalThickness(op.type);
    const isArg = isArgwave(op.type);
    const isMth = isMath(op.type);
    const useFraction = !isCon && !isTT && !isArg && (!isMth || mathPercent);
    const cur = rawCur != null ? (useFraction ? rawCur * 100 : rawCur) : null;
    const isRampRow = isRangeTarget(op.type);
    const tgt = useFraction ? op.target * 100 : op.target;
    const rawDelta = cur != null ? (isRampRow ? cur : cur - tgt) : null;
    return {
        isCon, isTT, isArg, isMth, mthPct: mathPercent, useFraction, cur, tgt,
        rawDelta, isRampRow, isRange: isRangeType(op.type),
    };
}

function sideColor(rawDelta, satisfiedWhenNeg, c) {
    const ok = satisfiedWhenNeg ? rawDelta <= 0 : rawDelta >= 0;
    return ok ? c.success : c.error;
}

function proximityColor(rawDelta, near, mid, c) {
    const magnitude = Math.abs(rawDelta);
    return magnitude < near ? c.success : magnitude < mid ? '#ffa726' : '#ef5350';
}

function mathColor(op, rawDelta, c) {
    const kind = mathResidualKind(op.type);
    if (kind === 'one-sided-min') return sideColor(rawDelta, false, c);
    if (kind === 'one-sided-max') return sideColor(rawDelta, true, c);
    return proximityColor(rawDelta, 0.005, 0.02, c);
}

export function deltaColor(op, rawDelta, meta, c) {
    if (rawDelta == null) return c.textDim;
    if (meta.isCon) return sideColor(rawDelta, op.type !== 'MNT', c);
    if (meta.isTT && (op.cmp === 'le' || op.cmp === 'ge')) return sideColor(rawDelta, op.cmp === 'le', c);
    if (meta.isMth) return mathColor(op, rawDelta, c);
    const [near, mid] = meta.isArg ? [1, 5] : [0.5, 2];
    return proximityColor(rawDelta, near, mid, c);
}

export function fmtCurrent(cur, meta) {
    if (cur == null) return '—';
    if (meta.isMth) return cur.toPrecision(4);
    if (meta.isCon || meta.isTT || meta.isArg) return cur.toFixed(2) + ' nm';
    return cur.toFixed(3) + ' %';
}

export function fmtDelta(value, meta) {
    if (value == null) return '—';
    const sign = value >= 0 ? '+' : '';
    if (meta.isMth) return sign + value.toPrecision(3);
    if (meta.isCon || meta.isTT || meta.isArg) return sign + value.toFixed(2) + ' nm';
    return sign + value.toFixed(3) + ' %';
}

export function fmtTargetDisplay(op, meta) {
    if (meta.isMth) return meta.mthPct ? (op.target * 100).toFixed(2) : (op.target?.toPrecision?.(4) ?? '0');
    if (meta.isCon || meta.isTT || meta.isArg) return op.target.toFixed(2);
    if (meta.isRampRow) {
        const end = op.targetEnd != null ? op.targetEnd : op.target;
        return `${(op.target * 100).toFixed(1)}→${(end * 100).toFixed(1)}`;
    }
    return (op.target * 100).toFixed(2);
}
