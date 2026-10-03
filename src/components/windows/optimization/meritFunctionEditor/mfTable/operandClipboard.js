/**
 * Whole operand rows on the clipboard: one tab-separated line per operand,
 * holding its type, band, angle, polarization, target and weight. Ctrl+C on
 * selected rows writes them and Ctrl+V reads them back as new operands.
 */
import {
    GENERATED_ONLY_OPERAND_TYPES, OPERAND_POLS, OPERAND_TYPES,
    isFractionalUnit, isValidMeritWeight,
} from '../../../../../utils/physics/optimizer.js';

/**
 * Whether the clipboard holds operand rows, as Ctrl+C on rows writes them:
 * every line has the seven row fields and opens with a type code. Anything
 * else is a grid of cell values.
 */
export function looksLikeOperandRows(grid) {
    return grid.length > 0 && grid.every(line => line.length === 7 && OPERAND_TYPES.includes(line[0]));
}

export function serializeOperandsTsv(operands, selectedIds) {
    return operands.filter(op => selectedIds.has(op.id)).map(op => {
        const target = op.target ?? 0;
        const targetText = (isFractionalUnit(op.type) ? target * 100 : target).toFixed(2);
        return [op.type, op.lambdaStart, op.lambdaEnd, op.aoi, op.pol, targetText, op.weight].join('\t');
    }).join('\n');
}

const orDefault = (value, fallback) => (isFinite(value) ? value : fallback);

function operandFromLine(line) {
    const [type, startText, endText, aoiText, pol, targetText, weightText] = line.split('\t');
    // A generated row carries data the clipboard does not: a measured block
    // is its sampled curve. Retyping it would paste an unrelated operand
    // built from the block's range and its target of zero, so skip it.
    if (GENERATED_ONLY_OPERAND_TYPES.includes(type)) return null;
    const safeType = OPERAND_TYPES.includes(type) ? type : 'RAV';
    const target = parseFloat(targetText);
    const weight = parseFloat(weightText);
    return {
        type: safeType,
        lambdaStart: orDefault(parseFloat(startText), 400),
        lambdaEnd: orDefault(parseFloat(endText), 700),
        aoi: orDefault(parseFloat(aoiText), 0),
        pol: OPERAND_POLS.includes(pol) ? pol : 'avg',
        target: isFinite(target) ? (isFractionalUnit(safeType) ? target / 100 : target) : 0,
        weight: isValidMeritWeight(weight) ? weight : 1,
    };
}

export function parseOperandsTsv(text) {
    return text.replace(/\s+$/, '').split(/\r?\n/)
        .filter(line => line.trim())
        .map(operandFromLine)
        .filter(Boolean);
}

export function copySelectedOperands(operands, selectedIds, clipboard = navigator.clipboard) {
    clipboard?.writeText(serializeOperandsTsv(operands, selectedIds)).catch(() => {});
}

export function pasteOperands(onAdd, atIndex, clipboard = navigator.clipboard) {
    clipboard?.readText().then(text => {
        const items = parseOperandsTsv(text);
        if (items.length) onAdd(items, atIndex);
    }).catch(() => {});
}
