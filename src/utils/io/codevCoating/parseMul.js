import { CodevParseError } from './parseError.js';
import { readMulRecord } from './mulRecord.js';
import { readMulMic } from './mulMic.js';
import { shortestNear } from './mulReader.js';

// How far a value read back may sit from the one entered, relative. A float32
// holds 24 significant bits, so a stored value is within 2^-24 of the one
// entered; an angle also passes through a product with π/180, so it gets
// twice the room. A thickness is not rounded this way: one entered in waves
// (PHT N) has no short decimal form in nm.
const STORED = 2 ** -23;
const ANGLE = 2 ** -22;

function mediumIndex(record, labelAt, i) {
    const pointer = record.pointers[i];
    if (pointer < 0) return { n: shortestNear(record.nAtRef[i], STORED), k: shortestNear(record.kOnLine[i], STORED) };
    const label = labelAt[pointer];
    if (label === undefined) throw new CodevParseError('notMul');
    return { label };
}

// d = T · REF / n(REF): the thickness CODE V stored in waves of REF, back in
// nm, with the same n(REF) it was stored with.
function layerOf(record, labelAt, refNm, i) {
    const index = mediumIndex(record, labelAt, i);
    const n = 'label' in index ? record.nAtRef[i] : index.n;
    if (!(n > 0)) throw new CodevParseError('notMul');
    return {
        thicknessNm: record.thicknessWaves[i] * refNm / n,
        code: record.codes[i],
        index,
    };
}

/**
 * The stack and CODE V's own n and k of each MIC material at the analysis
 * wavelengths (`sampled`, by label), from the text of a .mul.
 * @throws {CodevParseError} notMul
 */
export function readCodevMul(text) {
    const record = readMulRecord(text);
    const { tables, sampled, labelAt } = readMulMic(record);
    const refNm = shortestNear(record.refUm * 1000, STORED);
    const last = record.codes.length - 1;
    const layers = [];
    for (let i = 1; i < last; i++) layers.push(layerOf(record, labelAt, refNm, i));
    const stack = {
        title: record.title,
        refNm,
        wavelengthsNm: record.wavelengthsUm.map(um => shortestNear(um * 1000, STORED)),
        anglesDeg: record.anglesRad.map(rad => shortestNear(rad * 180 / Math.PI, ANGLE)),
        incident: mediumIndex(record, labelAt, 0),
        substrate: mediumIndex(record, labelAt, last),
        layers,
        mic: tables,
        warnings: [],
    };
    return { stack, sampled };
}

/**
 * Read a .mul saved by CODE V into a CodevStack.
 * @param {string} text
 * @returns {object} CodevStack, see codevCoatingFile.js
 * @throws {CodevParseError} notMul
 */
export function parseCodevMul(text) {
    return readCodevMul(text).stack;
}
