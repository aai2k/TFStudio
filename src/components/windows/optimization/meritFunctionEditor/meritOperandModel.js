import {
    FILTER_TYPES, generateFilterOperands,
    makeOperand, makeConstraintOperand, makeDmfsOperand,
    isConstraint, isTotalThickness, isArgwave, isMath, mathTargetInPercent,
} from '../../../../utils/physics/optimizer.js';

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

function formatCustomTarget({ params: p }) {
    const cmp = p.cmp === 'le' ? '≤' : p.cmp === 'ge' ? '≥' : '=';
    return `${p.channel} ${cmp} ${p.valuePct}%, λ ${p.lamStart}–${p.lamEnd} nm`;
}

const FIELD_FORMATTERS = [
    ['channel', formatCustomTarget],
    ['lamStart', formatRangeFields],
    ['lam0', ({ params: p }) => `λ₀=${p.lam0} nm`],
    ['lam3', ({ params: p }) => `λ=${p.lam1}/${p.lam2}/${p.lam3} nm`],
    ['lam2', ({ params: p }) => `λ=${p.lam1}/${p.lam2} nm`],
    ['passStart', formatPassStopFields],
    ['lowStopStart', ({ params: p }) => `stop ${p.lowStopStart}–${p.lowStopEnd} | pass ${p.passStart}–${p.passEnd} | stop ${p.highStopStart}–${p.highStopEnd} nm`],
    ['lowPassStart', ({ params: p }) => `pass ${p.lowPassStart}–${p.lowPassEnd} | stop ${p.stopStart}–${p.stopEnd} | pass ${p.highPassStart}–${p.highPassEnd} nm`],
];

function formatDmfsFields(def, params) {
    const ctx = { def, params, fieldKeys: new Set(def.fields.map(field => field.key)) };
    const entry = FIELD_FORMATTERS.find(([key]) => hasField(ctx, key));
    return entry ? entry[1](ctx) : '';
}

export function buildDmfsComment(options) {
    const {
        tw, typeId, params, common,
        constraintsEnabled, minThick, maxThick, totalEnabled, maxTotal,
    } = options;
    const def = options.filterTypes?.[typeId] || FILTER_TYPES[typeId];
    const typeLabel = tw.types[typeId]?.label || typeId;
    const fieldText = formatDmfsFields(def, params);
    const aoiText = common.aoi === common.aoiEnd || common.aoiEnd == null
        ? `AOI ${common.aoi}°`
        : `AOI ${common.aoi}–${common.aoiEnd}° (${common.aoiSteps} steps)`;
    let text = `${typeLabel}, ${fieldText}, ${aoiText}, ${common.pol} pol`;
    if (def.supportsTargetMode) {
        text += common.targetMode === 'discrete'
            ? `, discrete @${common.stepNm} nm`
            : `, continuous target`;
    }
    if (constraintsEnabled) text += `; ≥${minThick} nm, ≤${maxThick} nm`;
    if (totalEnabled) text += `; Σd ≤ ${maxTotal} nm`;
    return text;
}

export function buildWizardBlock(options) {
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
        stepNm: Math.max(0.1, Number(options.stepNm) || 1),
    };
    const comment = buildDmfsComment({
        tw, typeId, params, common,
        constraintsEnabled, minThick, maxThick, totalEnabled, maxTotal,
    });
    const block = [makeDmfsOperand(comment), ...generateFilterOperands(typeId, params, common)];
    if (constraintsEnabled) {
        block.push(
            makeConstraintOperand({ type: 'MNT', lambdaStart: 1, lambdaEnd: 9999, target: Math.max(0.01, minThick) }),
            makeConstraintOperand({ type: 'MXT', lambdaStart: 1, lambdaEnd: 9999, target: Math.max(0.01, maxThick) }),
        );
    }
    if (totalEnabled) {
        block.push(makeOperand({ type: 'TT', cmp: 'le', target: Math.max(1, maxTotal), weight: 1 }));
    }
    return block;
}

export function wizardAppendRow(operandCount) {
    return (operandCount || 0) + 1;
}

export function wizardGenerationRows(startRow, blockLength) {
    const normalized = Math.max(1, Math.round(startRow));
    return { startRow: normalized, nextStartRow: normalized + blockLength };
}

export function editOperand(operands, id, key, value) {
    return operands.map(op => {
        if (op.id !== id) return op;
        if (key === '_patch') return { ...op, ...value };
        if (key !== 'target') return { ...op, [key]: value };

        const target = typeof value === 'number' ? value : parseFloat(value);
        const operandsById = new Map(operands.map(item => [item.id, item]));
        const mathPercent = isMath(op.type) && mathTargetInPercent(op, operandsById);
        const rawTarget = isConstraint(op.type) || isTotalThickness(op.type) || isArgwave(op.type)
            || (isMath(op.type) && !mathPercent);
        return { ...op, target: rawTarget ? target : target / 100 };
    });
}

export function replaceOperandTail(operands, block, startRow) {
    const pos = Math.max(0, Math.min((startRow ?? operands.length + 1) - 1, operands.length));
    return { operands: [...operands.slice(0, pos), ...block], selectedId: null };
}

export function addOperands(operands, data, atIndex, createOperand = makeOperand) {
    const list = Array.isArray(data) ? data : [data];
    const added = list.map(item => createOperand(item ?? { type: 'BLNK', comment: '' }));
    if (added.length === 0) return null;
    const pos = atIndex == null ? operands.length : Math.max(0, Math.min(atIndex, operands.length));
    return {
        operands: [...operands.slice(0, pos), ...added, ...operands.slice(pos)],
        selectedId: added[added.length - 1].id,
    };
}

export function insertOperand(operands, insertIndex, createOperand = makeOperand) {
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
    const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
    return { operands: operands.filter(op => !idSet.has(op.id)), selectedId: null };
}

export function moveOperand(operands, selectedId, direction) {
    const index = operands.findIndex(op => op.id === selectedId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= operands.length) return operands;
    const moved = operands.slice();
    [moved[index], moved[nextIndex]] = [moved[nextIndex], moved[index]];
    return moved;
}

export function reIdOperands(operands, createOperand = makeOperand) {
    return operands.map(({ id, ...rest }) => createOperand(rest));
}
