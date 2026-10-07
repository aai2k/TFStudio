import { CodevParseError } from './parseError.js';

/*
 * The MIC block of a .mul, positions 1-based as CODE V's own pointers are.
 * Each MWL group is its wavelengths in µm, then for each material a label word
 * (the 6-character label in the 8 bytes of a REAL*8, printed as a number near
 * 6E-154), its n at those wavelengths and its k. After the groups, from the
 * position `sampledStart`, each material used in the stack has a label word,
 * its n at the analysis wavelengths and its k, as CODE V computed them. A
 * final 0 ends the block.
 *
 * The link integers at the same positions: at the start p of a group, the
 * number of MWL points and the position of its first label word; one past
 * that label word, the start of the next group, 0 after the last. Every
 * sample group holds one material; more than one is read as materials
 * following each other in the group, which no sample shows.
 */

const notMul = () => new CodevParseError('notMul');
const at = (list, position) => list[position - 1];
const span = (list, position, count) => list.slice(position - 1, position - 1 + count);
const nm = (um) => Number((um * 1000).toPrecision(12));

function readGroup(record, start, end, tables) {
    const points = at(record.micLinks, start);
    const first = at(record.micLinks, start + 1);
    if (!(points > 0) || first !== start + points) throw notMul();
    const mwl = span(record.micBlock, start, points).map(nm);
    const next = at(record.micLinks, first + 1);
    const stop = next > 0 ? next : end;
    for (let word = first; word < stop; word += 2 * points + 1) {
        const n = span(record.micBlock, word + 1, points);
        const k = span(record.micBlock, word + 1 + points, points);
        tables.push(mwl.map((lam, i) => [lam, n[i], k[i]]));
    }
    return next;
}

/**
 * The MIC tables of a .mul as [λ_nm, n, k] rows by label, CODE V's n and k at
 * the analysis wavelengths by label, and the label of each sampled block's
 * label-word position.
 */
export function readMulMic(record) {
    const { sampledStart, micBlock, micLabels, wavelengthsUm } = record;
    const tableRows = [];
    for (let start = 1; start > 0 && start < sampledStart;) {
        start = readGroup(record, start, sampledStart, tableRows);
    }
    const stride = 2 * wavelengthsUm.length + 1;
    const blocks = (micBlock.length - sampledStart) / stride;
    if (!Number.isInteger(blocks) || micLabels.length !== tableRows.length + blocks) throw notMul();

    const tables = {};
    tableRows.forEach((rows, i) => { tables[micLabels[i]] = rows; });
    const sampled = {};
    const labelAt = {};
    for (let b = 0; b < blocks; b++) {
        const word = sampledStart + b * stride;
        const label = micLabels[tableRows.length + b];
        if (!tables[label]) throw notMul();
        labelAt[word] = label;
        sampled[label] = {
            n: span(micBlock, word + 1, wavelengthsUm.length),
            k: span(micBlock, word + 1 + wavelengthsUm.length, wavelengthsUm.length),
        };
    }
    return { tables, sampled, labelAt };
}
