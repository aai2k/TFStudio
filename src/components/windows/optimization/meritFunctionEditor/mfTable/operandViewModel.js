import {
    isArgwave, isBlank, isConstraint, isDmfs, isInequality, isIntegral,
    isMath, isMathPairRef, isMathSingleRef, isMinmax, isRangeTarget,
    isTotalThickness, isPhase, isGroupDelayFlat, isFractionalUnit,
} from '../../../../../utils/physics/optimizer.js';

// Display unit for a phase/field operand type (empty = dimensionless).
const PHASE_UNITS = {
    PSI: '°', DEL: '°', TANPSI: '', COSDEL: '',
    PR: '°', PT: '°', DPR: '°', DPT: '°',
    GD: 'fs', GDT: 'fs', GDFLAT: 'fs', GDTFLAT: 'fs',
    GDD: 'fs²', GDDT: 'fs²', GDDFLAT: 'fs²', GDDTFLAT: 'fs²',
    TOD: 'fs³', TODT: 'fs³', TODFLAT: 'fs³', TODTFLAT: 'fs³',
    EFMX: '',
};
function phaseUnit(type) { return PHASE_UNITS[type] || ''; }

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
    PSI: [80, 200, 200], DEL: [80, 200, 200], TANPSI: [80, 200, 200], COSDEL: [80, 200, 200],
    PR: [160, 140, 230], PT: [160, 140, 230], DPR: [160, 140, 230], DPT: [160, 140, 230],
    GD: [110, 180, 220], GDT: [110, 180, 220], GDD: [110, 180, 220], GDDT: [110, 180, 220],
    TOD: [110, 180, 220], TODT: [110, 180, 220], GDFLAT: [110, 180, 220],
    GDTFLAT: [110, 180, 220], GDDFLAT: [110, 180, 220], GDDTFLAT: [110, 180, 220],
    TODFLAT: [110, 180, 220], TODTFLAT: [110, 180, 220],
    EFMX: [220, 120, 180],
    MNT: [180, 100, 255], MXT: [180, 100, 255], BLNK: [140, 140, 140],
};

// Column widths are proportions, not pixels: the table fills whatever width it
// is given and shares it out in these ratios, down to a floor of TABLE_W where
// it starts to scroll instead. The numbers below are that floor in pixels, sized
// so the whole table still fits a half-width window at 125% display scaling with
// room for a vertical scrollbar.
//
// Type is the widest of the fixed-vocabulary columns because the longest operand
// names (GDDTFLAT, TODTFLAT) must read in full inside the picker, which spends
// about 25 px of the column on its padding and caret. The wavelength, layer,
// angle and weight columns hold at most a four-digit number.
export const COLS = [
    { key: 'num', w: 24, label: '#' },
    { key: 'enabled', w: 20, label: '✓' },
    { key: 'type', w: 82, label: 'Type' },
    { key: 'lambdaStart', w: 54, label: 'λ / Layer' },
    { key: 'lambdaEnd', w: 50, label: 'End *' },
    { key: 'aoi', w: 44, label: 'AOI (°)' },
    { key: 'pol', w: 42, label: 'Pol' },
    { key: 'target', w: 64, label: 'Target' },
    { key: 'weight', w: 44, label: 'Weight' },
    { key: 'current', w: 70, label: 'Current' },
    { key: 'contribution', w: 50, label: '% of MF²' },
];

const COLS_W = COLS.reduce((sum, col) => sum + col.w, 0);

export const TABLE_W = COLS_W + 4;

/** A column's share of the table, so the rows span the window at any width. */
export function columnPercent(col) {
    return `${(col.w / COLS_W) * 100}%`;
}
export const RANGE_AVG_TYPES = new Set(['TAV', 'RAV', 'AAV']);
export const RANGE_TARGET_TYPES = new Set(['TGT', 'RGT', 'AGT']);
const EDITABLE_KEYS = ['enabled', 'type', 'lambdaStart', 'lambdaEnd', 'aoi', 'pol', 'target', 'weight'];

const HEADER_LABELS = [
    [op => isBlank(op.type), { lambdaStart: 'Comment', lambdaEnd: '—' }],
    [op => isTotalThickness(op.type), { lambdaStart: 'Cmp', lambdaEnd: '—' }],
    [op => isConstraint(op.type), { lambdaStart: 'Layer 1', lambdaEnd: 'Layer 2' }],
    [op => isIntegral(op.type), { lambdaStart: 'Integral', lambdaEnd: '—' }],
    [op => isArgwave(op.type), { lambdaStart: 'λ Start', lambdaEnd: 'λ End' }],
    [op => isGroupDelayFlat(op.type), { lambdaStart: 'λ Start', lambdaEnd: 'λ End' }],
    [op => isPhase(op.type), { lambdaStart: 'λ', lambdaEnd: '—' }],
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
    [op => isGroupDelayFlat(op.type), ['enabled', 'type', 'lambdaStart', 'lambdaEnd', 'aoi', 'pol', 'target', 'weight']],
    [op => isPhase(op.type), ['enabled', 'type', 'lambdaStart', 'aoi', 'pol', 'target', 'weight']],
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

// Operands whose λ End column carries a wavelength, so the cell shows a value
// instead of a dash. Must stay in step with editableColsForRow and
// dynamicHeaderLabels: the flatness operands sample a band and own a λ End.
export function isRangeType(type) {
    if (RANGE_AVG_TYPES.has(type) || RANGE_TARGET_TYPES.has(type)) return true;
    return isMinmax(type) || isInequality(type) || isArgwave(type)
        || isGroupDelayFlat(type);
}

export function rowDisplayMeta(op, rawCur, mathPercent, bandLevel = null) {
    const isCon = isConstraint(op.type);
    const isTT = isTotalThickness(op.type);
    const isArg = isArgwave(op.type);
    const isMth = isMath(op.type);
    const isPhs = isPhase(op.type);
    const isFlat = isGroupDelayFlat(op.type);
    // Fraction-unit rows display value ×100 as a percent. Optical T/R/A carry a
    // fractional unit; a math row inherits percent only when its refs are optical.
    const useFraction = isFractionalUnit(op.type) || (isMth && mathPercent);
    const value = rawCur != null ? (useFraction ? rawCur * 100 : rawCur) : null;
    // Spectral-target and phase-flatness rows carry an RMS deviation as their
    // evaluated value, rather than a signed current-minus-target difference.
    const isRampRow = isRangeTarget(op.type) || isFlat;
    const tgt = useFraction ? op.target * 100 : op.target;
    const rawResidual = value != null ? (isRampRow ? value : value - tgt) : null;
    // A flatness operand's own value is an RMS deviation, which shares the
    // target's unit but not its meaning and goes to zero as the row is met.
    // Current shows the level the band actually reaches, so it can be read
    // against Target directly; the RMS remains available in the tooltip.
    const cur = isFlat && bandLevel != null ? bandLevel : value;
    return {
        isCon, isTT, isArg, isMth, isPhs, phaseUnit: isPhs ? phaseUnit(op.type) : '',
        mthPct: mathPercent, useFraction, cur, tgt,
        rawResidual, isRampRow, isRange: isRangeType(op.type),
    };
}

function withUnit(text, unit) { return unit ? text + ' ' + unit : text; }

// A row's share of the weighted sum of squares the merit function is the root
// of. It is a share of MF², not of MF, because the terms are additive there and
// the square root is not linear; the header says so. Shares sum to 100% when MF
// is nonzero, so the column needs no per-type units or colour thresholds.
export function fmtContribution(fraction) {
    if (fraction == null) return '—';
    if (fraction === 0) return '0';
    if (fraction < 0.001) return '<0.1%';
    return (fraction * 100).toFixed(1) + '%';
}

// The bar is drawn behind the number inside the cell it already occupies, so it
// costs no width. Scaled to the largest share in the table rather than to 100%,
// so the ranking stays readable when every row holds only a few percent.
export function contributionBarWidth(fraction, largest) {
    if (!fraction || !(largest > 0)) return 0;
    return Math.max(0.02, fraction / largest);
}

// What the row is missing by, in its own units, for the contribution tooltip.
// The labels spell out the different residual meanings.
export function residualTooltip(meta, text = {}) {
    if (meta.rawResidual == null) return null;
    const shown = fmtResidual(meta.rawResidual, meta);
    if (meta.isCon) return `${text.residualSlack || 'Slack'} ${shown}`;
    if (meta.isRampRow) return `${text.residualRms || 'RMS deviation'} ${shown}`;
    return `${text.residualDifference || 'Current − target'}: ${shown}`;
}

export function fmtCurrent(cur, meta) {
    if (cur == null) return '—';
    if (meta.isMth) return cur.toPrecision(4);
    if (meta.isPhs) return withUnit(cur.toFixed(3), meta.phaseUnit);
    if (meta.isCon || meta.isTT || meta.isArg) return cur.toFixed(2) + ' nm';
    return cur.toFixed(3) + ' %';
}

export function fmtResidual(value, meta) {
    if (value == null) return '—';
    const sign = value >= 0 ? '+' : '';
    if (meta.isMth) return sign + value.toPrecision(3);
    if (meta.isPhs) return withUnit(sign + value.toFixed(3), meta.phaseUnit);
    if (meta.isCon || meta.isTT || meta.isArg) return sign + value.toFixed(2) + ' nm';
    return sign + value.toFixed(3) + ' %';
}

export function fmtTargetDisplay(op, meta) {
    if (meta.isMth) return meta.mthPct ? (op.target * 100).toFixed(2) : (op.target?.toPrecision?.(4) ?? '0');
    if (meta.isPhs) return withUnit(op.target.toFixed(2), meta.phaseUnit);
    if (meta.isCon || meta.isTT || meta.isArg) return op.target.toFixed(2);
    if (meta.isRampRow) {
        const end = op.targetEnd != null ? op.targetEnd : op.target;
        return `${(op.target * 100).toFixed(1)}→${(end * 100).toFixed(1)}`;
    }
    return (op.target * 100).toFixed(2);
}
