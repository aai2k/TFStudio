import {
    DEFAULT_CONSTRAINT_LAST_LAYER, FILTER_TYPES, customTargetStatement, generateFilterOperands,
    makeOperand, makeConstraintOperand, makeDmfsOperand,
    isConstraint, isFractionalUnit, isMath, isRangeTarget, mathTargetInPercent,
    removeOperandsAndDependents, rowRangeDomain, targetDomain,
} from '../../../../utils/physics/optimizer.js';
import { limitRows, limitsText } from './wizardLimits.js';

function hasField(ctx, key) {
    return ctx.fieldKeys.has(key);
}

function formatRangeFields(ctx) {
    const { params: p } = ctx;
    let text = `λ ${p.lamStart}–${p.lamEnd} nm`;
    if (hasField(ctx, 'tStart')) {
        text += `, T ${p.tStart.toFixed(2)}`;
        if (p.tEnd != null) text += `→${p.tEnd.toFixed(2)}`;
    }
    if (hasField(ctx, 'rPct')) text += `, R=${p.rPct}%`;
    if (hasField(ctx, 'rsPct')) text += `, Rs=${p.rsPct}% / Rp=${p.rpPct}%`;
    return text;
}

function formatPassStopFields(ctx) {
    const { def, params: p } = ctx;
    const stopFirst = hasField(ctx, 'stopStart') && def.fields[0].key === 'stopStart';
    return stopFirst
        ? `stop ${p.stopStart}–${p.stopEnd} nm, pass ${p.passStart}–${p.passEnd} nm`
        : `pass ${p.passStart}–${p.passEnd} nm, stop ${p.stopStart}–${p.stopEnd} nm`;
}

// A density is written as itself, OD ≥ 3, not as a statement about T.
const STATEMENT_UNITS = { pct: '%', dB: ' dB', OD: '' };
const COMPARISON_SYMBOLS = { le: '≤', ge: '≥', eq: '=' };
function formatCustomTarget({ params: p }) {
    const { channel, unit, cmp } = customTargetStatement(p);
    const quantity = unit === 'OD' ? 'OD' : channel;
    return `${quantity} ${COMPARISON_SYMBOLS[cmp]} ${p.valuePct}${STATEMENT_UNITS[unit]}, λ ${p.lamStart}–${p.lamEnd} nm`;
}

// The first entry whose key the type carries wins, so a three-band type has to
// be matched before the two-band one: a bandpass has a `passStart` of its own,
// and read as a plain pass-and-stop pair it would name a stop it does not have.
const FIELD_FORMATTERS = [
    ['channel', formatCustomTarget],
    ['lamStart', formatRangeFields],
    ['lam0', ({ params: p }) => `λ₀=${p.lam0} nm`],
    ['lam3', ({ params: p }) => `λ=${p.lam1}/${p.lam2}/${p.lam3} nm`],
    ['lam2', ({ params: p }) => `λ=${p.lam1}/${p.lam2} nm`],
    ['lowStopStart', ({ params: p }) => `stop ${p.lowStopStart}–${p.lowStopEnd} | pass ${p.passStart}–${p.passEnd} | stop ${p.highStopStart}–${p.highStopEnd} nm`],
    ['lowPassStart', ({ params: p }) => `pass ${p.lowPassStart}–${p.lowPassEnd} | stop ${p.stopStart}–${p.stopEnd} | pass ${p.highPassStart}–${p.highPassEnd} nm`],
    ['passStart', formatPassStopFields],
];

function formatDmfsFields(def, params) {
    const ctx = { def, params, fieldKeys: new Set(def.fields.map(field => field.key)) };
    const entry = FIELD_FORMATTERS.find(([key]) => hasField(ctx, key));
    return entry ? entry[1](ctx) : '';
}

export function buildDmfsComment(options) {
    const { tw, typeId, params, common } = options;
    const def = options.filterTypes?.[typeId] || FILTER_TYPES[typeId];
    const typeLabel = tw.types[typeId]?.label || typeId;
    const fieldText = formatDmfsFields(def, params);
    const aoiText = common.aoi === common.aoiEnd || common.aoiEnd == null
        ? `AOI ${common.aoi}°`
        : `AOI ${common.aoi}–${common.aoiEnd}° (${common.aoiSteps} steps)`;
    // A type that sets polarization itself does not carry the wizard's choice.
    let text = def.fixedPol
        ? `${typeLabel}, ${fieldText}, ${aoiText}`
        : `${typeLabel}, ${fieldText}, ${aoiText}, ${common.pol} pol`;
    if (def.supportsTargetMode) {
        text += common.targetMode === 'discrete'
            ? `, discrete @${common.stepNm} nm`
            : `, continuous target`;
    }
    return text + limitsText(options);
}

// The header of a curve type's block names the curve it read; the angle and
// polarization are the curve's own.
function curveComment(options, curveName) {
    const typeLabel = options.tw.types[options.typeId]?.label || options.typeId;
    return `${typeLabel}, ${curveName}${limitsText(options)}`;
}

/**
 * The block the wizard writes, and the curves it adds to the design. A curve
 * type's rows come in `options.curveRows` (curveWizardModel.js), built where
 * the design is at hand; when they name an error the block is empty.
 */
export function buildWizardResult(options) {
    const { curveRows } = options;
    if (curveRows?.error) return { block: [], curves: [], error: curveRows.error };
    const block = curveRows
        ? [makeDmfsOperand(curveComment(options, curveRows.curveName)), ...curveRows.rows]
        : filterTypeBlock(options);
    return { block: [...block, ...limitRows(options)], curves: curveRows?.curves || [], error: null };
}

export function buildWizardBlock(options) {
    return buildWizardResult(options).block;
}

function filterTypeBlock(options) {
    const {
        tw, typeId, params, pol, targetMode,
        constraintsEnabled, minThick, maxThick, totalEnabled, maxTotal,
    } = options;
    const common = {
        aoi: Number(options.aoi) || 0,
        aoiEnd: Number(options.aoiEnd) || 0,
        aoiSteps: Math.max(1, Math.round(options.aoiSteps)),
        pol,
        targetMode,
        stepNm: Number(options.stepNm) || 1,
    };
    const comment = buildDmfsComment({
        tw, typeId, params, common,
        constraintsEnabled, minThick, maxThick, totalEnabled, maxTotal,
    });
    return [makeDmfsOperand(comment), ...generateFilterOperands(typeId, params, common)];
}

export function wizardAppendRow(operandCount) {
    return (operandCount || 0) + 1;
}

export function wizardGenerationRows(startRow, blockLength) {
    const normalized = Math.max(1, Math.round(startRow));
    return { startRow: normalized, nextStartRow: normalized + blockLength };
}

/**
 * Build a table row of any operand type.
 *
 * A thickness constraint reads λ Start and λ End as a layer range, so it needs
 * different defaults from a spectral operand and cannot come out of makeOperand.
 * Its range covers layers the design does not have yet, because synthesis adds
 * them and a constraint written for today's layer count would silently stop
 * covering the stack it grows.
 */
export function makeRowOperand(spec) {
    const item = spec ?? { type: 'BLNK', comment: '' };
    if (!isConstraint(item.type)) return makeOperand(item);
    return makeConstraintOperand({
        lambdaStart: 1, lambdaEnd: DEFAULT_CONSTRAINT_LAST_LAYER, ...item,
    });
}

/**
 * Change a row's operand type, keeping the fields that still mean the same thing
 * and reseeding the ones that do not.
 *
 * λ Start, λ End and the target are numbers whose meaning comes from the type.
 * Carried across a type change they are not merely unhelpful but wrong: a row
 * retyped from RAV to MNT would constrain layers 400 to 700 to be at least 0.99
 * nm thick, none of which the user asked for and all of which looks deliberate.
 */
export function retypeOperand(op, type) {
    const next = { ...op, id: op.id, type };
    if (rowRangeDomain(type) !== rowRangeDomain(op.type)) {
        delete next.lambdaStart;
        delete next.lambdaEnd;
    }
    if (targetDomain(type) !== targetDomain(op.type)) delete next.target;
    return makeRowOperand(next);
}

export function editOperand(operands, id, key, value) {
    return operands.map(op => {
        if (op.id !== id) return op;
        if (key === '_patch') return { ...op, ...value };
        if (key === 'type') return retypeOperand(op, value);
        if (key !== 'target') return { ...op, [key]: value };

        const target = typeof value === 'number' ? value : parseFloat(value);
        const operandsById = new Map(operands.map(item => [item.id, item]));
        const mathPercent = isMath(op.type) && mathTargetInPercent(op, operandsById);
        const percentTarget = isFractionalUnit(op.type) || (isMath(op.type) && mathPercent);
        const next = { ...op, target: percentTarget ? target / 100 : target };
        // A single number typed into a spectral target means a flat target: the
        // ramp end follows, or a row set to 100→100 would turn into 0→100.
        if (isRangeTarget(op.type)) next.targetEnd = next.target;
        return next;
    });
}

export function replaceOperandTail(operands, block, startRow) {
    const pos = Math.max(0, Math.min((startRow ?? operands.length + 1) - 1, operands.length));
    return { operands: [...operands.slice(0, pos), ...block], selectedId: null };
}

export function addOperands(operands, data, atIndex, createOperand = makeRowOperand) {
    const list = Array.isArray(data) ? data : [data];
    const added = list.map(item => createOperand(item ?? { type: 'BLNK', comment: '' }));
    if (added.length === 0) return null;
    const pos = atIndex == null ? operands.length : Math.max(0, Math.min(atIndex, operands.length));
    return {
        operands: [...operands.slice(0, pos), ...added, ...operands.slice(pos)],
        selectedId: added[added.length - 1].id,
    };
}

export function insertOperand(operands, insertIndex, createOperand = makeRowOperand) {
    const op = createOperand({ type: 'BLNK', comment: '' });
    const pos = Math.max(0, Math.min(insertIndex, operands.length));
    return {
        operands: [...operands.slice(0, pos), op, ...operands.slice(pos)],
        selectedId: op.id,
    };
}

export function duplicateOperands(operands, ids, makeId = () => makeOperand().id) {
    const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
    if (idSet.size === 0) return null;
    const result = [];
    let selectedId = null;
    for (const op of operands) {
        result.push(op);
        if (idSet.has(op.id)) {
            const clone = { ...op, id: makeId(), enabled: op.enabled !== false };
            result.push(clone);
            selectedId = clone.id;
        }
    }
    return { operands: result, selectedId };
}

export function deleteOperands(operands, ids) {
    return { operands: removeOperandsAndDependents(operands, ids), selectedId: null };
}

export function moveOperand(operands, selectedId, direction) {
    const index = operands.findIndex(op => op.id === selectedId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= operands.length) return operands;
    const moved = operands.slice();
    [moved[index], moved[nextIndex]] = [moved[nextIndex], moved[index]];
    return moved;
}

