import { CodevParseError } from './parseError.js';
import { mulReader } from './mulReader.js';

/*
 * Layout of a .mul, the file CODE V's SAV writes. The help does not describe
 * it; this is what two sets of files show, each saved from a .seq that is
 * also at hand: the 15 sample coatings CODE V ships with (format 5), and
 * seven TFStudio exports saved by CODE V 11.2 (format 6, in
 * tests/reference/codev). Fixed-width Fortran text: integers I10, eight to a
 * line, reals G20.10, four to a line, every block on a new line.
 *
 *   line 1   format number (5 or 6) and a real (0.0)
 *   line 2   TIT, 80 characters
 *   line 3   date of the SAV; format 6 adds PLAINTEXT
 *   5 ints   unknown (0 9600 10233 1010 0 in every format 5 file)
 *   45 ints  counts, by position (0-based) in HEADER below; the rest unknown.
 *            Format 5 repeats the wavelength count at [4] and the angle
 *            count at [42]. Format 6 has 1 at [4] in every file, and at [42]
 *            a number from 0 to 5 that is not the angle count.
 *   12 ints  unknown, zero in every file
 *   M ints   thickness code of each medium, incident medium first (COA code;
 *            the incident medium's is 0 in every sample, the substrate's 100
 *            in all but one, where it is 0)
 *   M ints   per medium: −1 for an index entered on the line, else the
 *            1-based position in the MIC block of the label word that heads
 *            that material's n and k at the analysis wavelengths
 *   C ints   links between the MWL groups of the MIC block (see mulMic.js)
 *   S reals  settings; [6] is REF in µm, [20..24] the ANG angles in radians;
 *            [7], [8] and [14] change with the stack and look like results of
 *            an analysis (one angle, no absorber: [14] = 1 − [7]); [19] is 1
 *            in the samples with a MIC and 0 in the others; the rest unknown
 *            (ones, zeros, 0.5 and 0.98 in every sample)
 *   W reals  analysis wavelengths in µm, float32 (0.4000000060)
 *   4×W      per wavelength, two of ones and two of zeros in every sample:
 *            the MAU targets and weights (TRT, WTW, RST, RPT) by their
 *            defaults; which is which is not known
 *   M reals  thickness of each medium in waves of REF, n(REF) · d / REF
 *   M reals  k of each medium entered on the line, 0 for a MIC medium
 *   M reals  n of each medium at REF, a MIC medium's as CODE V computes it
 *   labels   count, then 10-character labels: one per MIC table, then one
 *            per block of n and k at the analysis wavelengths
 *   C reals  the MIC block (see mulMic.js)
 *   labels   the MIC materials once each, then M reals and one real per
 *            angle: not read here
 *
 * M media (incident, layers, substrate), W wavelengths, C the MIC block
 * length, S the settings count.
 */
const HEADER = {
    media: 16, wavelengths: 17, micLength: 18, settings: 22,
    interfaces: 26, angles: 28, sampledStart: 35,
};
// The formats read, each with the counts it repeats elsewhere in the header.
const REPEATS = { 5: { wavelengths: 4, angles: 42 }, 6: {} };
const SETTING = { refUm: 6, firstAngle: 20 };
const TARGET_BLOCKS = 4;

const notMul = () => new CodevParseError('notMul');

// The counts by name. Each count the format repeats elsewhere in the header
// has to agree with its repeat, or the text is not a .mul.
function counts(header, repeats) {
    const c = Object.fromEntries(Object.entries(HEADER).map(([name, at]) => [name, header[at]]));
    const conditions = [
        c.wavelengths >= 1, c.media >= 3, c.micLength >= 1, c.angles >= 1, c.sampledStart >= 1,
        c.settings > SETTING.firstAngle, c.interfaces === c.media - 1,
        ...Object.entries(repeats).map(([name, at]) => header[at] === c[name]),
    ];
    if (!conditions.every(Boolean)) throw notMul();
    return c;
}

function readHead(reader) {
    const format = /^\s*(\d+)\s+\S+\s*$/.exec(reader.line())?.[1];
    if (!Object.hasOwn(REPEATS, format)) throw notMul();
    const title = reader.line().trimEnd();
    reader.line();
    reader.ints(5);
    const header = reader.ints(45);
    reader.ints(12);
    return { title, ...counts(header, REPEATS[format]) };
}

/**
 * The numbers of a .mul by their place in the layout above.
 * @param {string} text
 * @returns {object} raw record; lengths in µm, angles in radians
 * @throws {CodevParseError} notMul
 */
export function readMulRecord(text) {
    const reader = mulReader(text);
    const head = readHead(reader);
    const codes = reader.ints(head.media);
    const pointers = reader.ints(head.media);
    const micLinks = reader.ints(head.micLength);
    const settings = reader.reals(head.settings);
    const wavelengthsUm = reader.reals(head.wavelengths);
    for (let i = 0; i < TARGET_BLOCKS; i++) reader.reals(head.wavelengths);
    const thicknessWaves = reader.reals(head.media);
    const kOnLine = reader.reals(head.media);
    const nAtRef = reader.reals(head.media);
    const micLabels = reader.labels();
    const micBlock = reader.reals(head.micLength);
    return {
        title: head.title,
        refUm: settings[SETTING.refUm],
        anglesRad: settings.slice(SETTING.firstAngle, SETTING.firstAngle + head.angles),
        wavelengthsUm, codes, pointers, thicknessWaves, kOnLine, nAtRef,
        micLinks, micLabels, micBlock, sampledStart: head.sampledStart,
    };
}
