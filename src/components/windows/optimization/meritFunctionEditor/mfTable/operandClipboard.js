/**
 * Whole operand rows on the clipboard: one tab-separated line per operand,
 * holding its type, band, angle, polarization, flag, target and weight, in the
 * order the table shows them. Ctrl+C on selected rows writes them and Ctrl+V
 * reads them back as new operands; a line without the flag, as earlier releases
 * wrote, still reads.
 */
import {
    EXTREMUM_FLAG_MAX, GENERATED_ONLY_OPERAND_TYPES, OPERAND_POLS, OPERAND_TYPES,
    isFractionalUnit, isValidMeritWeight, takesStepFlag,
} from '../../../../../utils/physics/optimizer.js';
import { parseNumberStrict } from '../../../../../utils/misc/numberParsing.js';

/**
 * Whether the clipboard holds operand rows, as Ctrl+C on rows writes them:
 * every line has the eight row fields, or the seven without the flag, and
 * opens with a type code. Anything else is a grid of cell values.
 */
export function looksLikeOperandRows(grid) {
    return grid.length > 0
        && grid.every(line => (line.length === 7 || line.length === 8) && OPERAND_TYPES.includes(line[0]));
}

export function serializeOperandsTsv(operands, selectedIds) {
    return operands.filter(op => selectedIds.has(op.id)).map(op => {
        const target = op.target ?? 0;
        const targetText = (isFractionalUnit(op.type) ? target * 100 : target).toFixed(2);
        const flagText = Number.isInteger(op.flag) ? op.flag : '';
        return [op.type, op.lambdaStart, op.lambdaEnd, op.aoi, op.pol, flagText, targetText, op.weight].join('\t');
    }).join('\n');
}

const orDefault = (value, fallback) => (isFinite(value) ? value : fallback);

// The flag of a pasted line, for a type that takes one and a value in range.
function flagField(type, text) {
    const flag = parseNumberStrict(text ?? '');
    const valid = Number.isInteger(flag) && flag >= 1 && flag <= EXTREMUM_FLAG_MAX;
    return valid && takesStepFlag({ type }) ? { flag } : {};
}

// The fields of a line, by name: in table order with the flag, or the seven
// an earlier release wrote.
function lineFields(line) {
    const parts = line.split('\t');
    const [type, startText, endText, aoiText, pol] = parts;
    const [flagText, targetText, weightText] = parts.length >= 8 ? parts.slice(5, 8) : ['', parts[5], parts[6]];
    return { type, startText, endText, aoiText, pol, flagText, targetText, weightText };
}

function operandFromLine(line) {
    const { type, startText, endText, aoiText, pol, flagText, targetText, weightText } = lineFields(line);
    // A generated row carries data the clipboard does not: a measured block
    // is its sampled curve. Retyping it would paste an unrelated operand
    // built from the block's range and its target of zero, so skip it.
    if (GENERATED_ONLY_OPERAND_TYPES.includes(type)) return null;
    const safeType = OPERAND_TYPES.includes(type) ? type : 'RAV';
    const target = parseNumberStrict(targetText);
    const weight = parseNumberStrict(weightText);
    return {
        type: safeType,
        lambdaStart: orDefault(parseNumberStrict(startText), 400),
        lambdaEnd: orDefault(parseNumberStrict(endText), 700),
        aoi: orDefault(parseNumberStrict(aoiText), 0),
        pol: OPERAND_POLS.includes(pol) ? pol : 'avg',
        target: isFinite(target) ? (isFractionalUnit(safeType) ? target / 100 : target) : 0,
        weight: isValidMeritWeight(weight) ? weight : 1,
        ...flagField(safeType, flagText),
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
