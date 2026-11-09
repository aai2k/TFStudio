/**
 * Whole operand rows on the clipboard: one tab-separated line per operand,
 * holding its type, band, angle, polarization, flag, target and weight, in the
 * order the table shows them. A DEL row adds a ninth field, the sign of Δ it
 * reads, so a pasted copy scores as its source does; a DEL line without it,
 * typed or copied from elsewhere, pastes as a new DEL row. Ctrl+C on selected
 * rows writes them and Ctrl+V reads them back as new operands; a line without
 * the flag, as earlier releases wrote, still reads.
 *
 * The text cannot hold everything a row does: the end of a sloped target, the
 * row a math row reads, a comment's text, an integral's source and detector,
 * the comparison of a TT or STR row. So the rows themselves are kept beside the
 * text they were copied as, and while the clipboard still holds that text a
 * paste gives them back whole. Text from anywhere else is read field by field.
 */
import {
    GENERATED_ONLY_OPERAND_TYPES, OPERAND_POLS, OPERAND_TYPES,
    flagStepNm, isBandGridRow, isFractionalUnit, isValidMeritWeight, makeOperand, takesStepFlag,
} from '../../../../../utils/physics/optimizer.js';
import { parseNumberStrict } from '../../../../../utils/misc/numberParsing.js';

const DELTA_CONVENTIONS = ['azzam', 'reversed'];
const REF_KEYS = ['refId', 'refId1', 'refId2'];

// The rows behind the text the last row copy wrote, and that text.
let lastCopy = null;

// Moves the decimal point by `places` in decimal rather than by a binary
// multiply or divide, so a target of 0.333 writes as 33.3 percent and reads
// back as exactly 0.333.
function shiftDecimal(value, places) {
    const [mantissa, exponent = '0'] = String(value).split('e');
    return Number(`${mantissa}e${Number(exponent) + places}`);
}

/**
 * Whether the clipboard holds operand rows, as Ctrl+C on rows writes them:
 * every line has the eight row fields, the seven without the flag, or the
 * nine of a DEL row with its sign, and opens with a type code. Anything else
 * is a grid of cell values.
 */
export function looksLikeOperandRows(grid) {
    const rowLength = line => line.length === 7 || line.length === 8
        || (line.length === 9 && DELTA_CONVENTIONS.includes(line[8]));
    return grid.length > 0 && grid.every(line => rowLength(line) && OPERAND_TYPES.includes(line[0]));
}

export function serializeOperandsTsv(operands, selectedIds) {
    return operands.filter(op => selectedIds.has(op.id)).map(op => {
        const target = op.target ?? 0;
        const targetText = String(isFractionalUnit(op.type) ? shiftDecimal(target, 2) : target);
        const flagText = Number.isFinite(op.flag) ? op.flag : '';
        const sign = op.type === 'DEL' && op.deltaConvention ? [op.deltaConvention] : [];
        return [op.type, op.lambdaStart, op.lambdaEnd, op.aoi, op.pol, flagText, targetText, op.weight, ...sign].join('\t');
    }).join('\n');
}

const orDefault = (value, fallback) => (isFinite(value) ? value : fallback);

// The flag of a pasted line, for a type that takes one and a Step it reads:
// 1 to 4, a negative step in nm, or 0 on a band row.
function flagField(type, text) {
    const flag = parseNumberStrict(text ?? '');
    const valid = flagStepNm(flag) != null || (flag === 0 && isBandGridRow(type));
    return valid && takesStepFlag({ type }) ? { flag } : {};
}

// The fields of a line, by name: in table order with the flag, or the seven
// an earlier release wrote.
function lineFields(line) {
    const parts = line.split('\t');
    const [type, startText, endText, aoiText, pol] = parts;
    const [flagText, targetText, weightText] = parts.length >= 8 ? parts.slice(5, 8) : ['', parts[5], parts[6]];
    return { type, startText, endText, aoiText, pol, flagText, targetText, weightText, signText: parts[8] };
}

// The sign of Δ a pasted DEL line was copied with, when it carries one.
function deltaConventionField(type, text) {
    return type === 'DEL' && DELTA_CONVENTIONS.includes(text) ? { deltaConvention: text } : {};
}

function operandFromLine(line) {
    const { type, startText, endText, aoiText, pol, flagText, targetText, weightText, signText } = lineFields(line);
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
        target: isFinite(target) ? (isFractionalUnit(safeType) ? shiftDecimal(target, -2) : target) : 0,
        weight: isValidMeritWeight(weight) ? weight : 1,
        ...flagField(safeType, flagText),
        ...deltaConventionField(safeType, signText),
    };
}

export function parseOperandsTsv(text) {
    return text.replace(/\s+$/, '').split(/\r?\n/)
        .filter(line => line.trim())
        .map(operandFromLine)
        .filter(Boolean);
}

// The copied rows as new rows: each with a new id, and a math row that read a
// row copied with it reads that row's copy. A row it read that was not copied
// with it is still read where it is. Generated rows are left out, as the text
// path leaves them out.
function pastedRows(rows) {
    const kept = rows.filter(op => !GENERATED_ONLY_OPERAND_TYPES.includes(op.type));
    const newIds = new Map(kept.map(op => [op.id, makeOperand().id]));
    return kept.map(op => {
        const row = { ...structuredClone(op), id: newIds.get(op.id) };
        for (const key of REF_KEYS) if (newIds.has(row[key])) row[key] = newIds.get(row[key]);
        return row;
    });
}

const sameText = (a, b) => a.replace(/\r\n/g, '\n').trimEnd() === b.replace(/\r\n/g, '\n').trimEnd();

/**
 * The rows a paste of `text` adds: the copied rows themselves, whole, while
 * the clipboard holds the text they were copied as; otherwise the rows the
 * text describes, as from a spreadsheet.
 */
export function operandsFromClipboard(text) {
    if (lastCopy && sameText(text, lastCopy.text)) return pastedRows(lastCopy.rows);
    return parseOperandsTsv(text);
}

export function copySelectedOperands(operands, selectedIds, clipboard = navigator.clipboard) {
    const text = serializeOperandsTsv(operands, selectedIds);
    lastCopy = { text, rows: structuredClone(operands.filter(op => selectedIds.has(op.id))) };
    clipboard?.writeText(text).catch(() => {});
}

export function pasteOperands(onAdd, atIndex, clipboard = navigator.clipboard) {
    clipboard?.readText().then(text => {
        const items = operandsFromClipboard(text);
        if (items.length) onAdd(items, atIndex);
    }).catch(() => {});
}
