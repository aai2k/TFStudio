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
 * each label word, the position the next material starts at, 0 after the
 * last. That is the next label word of the same group, whose own link is 0,
 * or the start of the next group, whose link is its point count; either way
 * it follows straight on, and the last material ends at `sampledStart`. A
 * group holds the materials entered after one MWL command: the format 5
 * samples have one to a group, and CODE V 11.2 kept the four materials
 * TFStudio wrote under one MWL in one group, and a repeated MWL command, with
 * the same wavelengths, as a group of its own.
 */

const notMul = () => new CodevParseError('notMul');
const at = (list, position) => list[position - 1];
const span = (list, position, count) => list.slice(position - 1, position - 1 + count);
const nm = (um) => Number((um * 1000).toPrecision(12));

// Where the material whose label word is at `word` hands on: the position
// its link names, checked against where the material ends.
function nextMaterial(record, word, points) {
    const next = at(record.micLinks, word + 1);
    if (word + 2 * points + 1 !== (next || record.sampledStart)) throw notMul();
    return next;
}

// The materials of the group that starts at `start`, as [λ_nm, n, k] rows
// added to `tables`. Returns the start of the next group, or 0 after the last.
function readGroup(record, start, tables) {
    const points = at(record.micLinks, start);
    let word = at(record.micLinks, start + 1);
    if (!(points > 0) || word !== start + points) throw notMul();
    const mwl = span(record.micBlock, start, points).map(nm);
    for (;;) {
        const n = span(record.micBlock, word + 1, points);
        const k = span(record.micBlock, word + 1 + points, points);
        tables.push(mwl.map((lam, i) => [lam, n[i], k[i]]));
        word = nextMaterial(record, word, points);
        if (word === 0 || at(record.micLinks, word) > 0) return word;
    }
}

/**
 * The MIC tables of a .mul as [λ_nm, n, k] rows by label, CODE V's n and k at
 * the analysis wavelengths by label, and the label of each sampled block's
 * label-word position.
 */
export function readMulMic(record) {
    const { sampledStart, micBlock, micLabels, wavelengthsUm } = record;
    const tableRows = [];
    let start = sampledStart > 1 ? 1 : 0;
    while (start > 0) start = readGroup(record, start, tableRows);
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
