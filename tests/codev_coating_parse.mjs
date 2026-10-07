/**
 * CODE V MUL coating reader: command syntax, the MDA commands, the .mul
 * layout, and the conversion to TFStudio materials and layers.
 *
 *  1. Syntax: comments, ";", "&" continuation, double-quoted strings, command
 *     words read by their first three letters, any case.
 *  2. MDA: PHT Y and N, REF and ANG and INC defaults, WLG as CODE V builds
 *     it, GRO replay, MIC with MWL changing between materials and EXT
 *     defaulting to 0, a label used before its MIC, commands of other
 *     sub-options passed over.
 *  3. Warnings and errors, each with its values: among them the 21 values
 *     one WL, MWL, 'label' or EXT command keeps, and Essential Macleod's
 *     export with decimal commas.
 *  4. n between MIC points as CODE V computes it, against the n CODE V stored
 *     in the .mul files of its sample coatings.
 *  5. A .mul written in the layout the samples show, read back; a format
 *     number the reader does not know.
 *  6. codevStackToDesign: one material per MIC label and per distinct index.
 *
 * Run: node tests/codev_coating_parse.mjs
 */
import assert from 'node:assert/strict';
import {
    parseCodevSeq, parseCodevMul, codevStackToDesign, CodevParseError,
} from '../src/utils/io/codevCoatingFile.js';
import { micIndexAt } from '../src/utils/io/codevCoating/micIndex.js';
import { fortranReal } from '../src/utils/io/codevCoating/mulReader.js';

let checks = 0;
const near = (actual, expected, tolerance, message) => {
    checks++;
    assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
};
const equal = (actual, expected, message) => { checks++; assert.deepEqual(actual, expected, message); };
const fails = (text, kind, detail, message) => {
    checks++;
    assert.throws(() => parseCodevSeq(text), (err) => {
        assert.ok(err instanceof CodevParseError, `${message}: a CodevParseError`);
        assert.equal(err.kind, kind, message);
        if (detail) assert.deepEqual(err.detail, detail, message);
        return true;
    });
};
const seq = (...lines) => lines.join('\n');

// ── 1. Syntax ────────────────────────────────────────────────────────────────
{
    const stack = parseCodevSeq(seq(
        'mul ! comment after a command',
        'Mda',
        '  pht y; tit "Double quoted; with a semicolon"',
        '  WL 400 450 &',
        '     500 550 &   ! a comment after the mark',
        '     600',
        "  inc 1.0; coa 100 100 1.45; coa 50 0 2.1 0.01; sub 1.52",
        'Mex',
    ));
    equal(stack.title, 'Double quoted; with a semicolon', 'a quoted string keeps its ";" and its blanks');
    equal(stack.wavelengthsNm, [400, 450, 500, 550, 600], '"&" continues WL over three lines');
    equal(stack.layers.map(layer => layer.thicknessNm), [100, 50], 'PHT Y takes nm as entered');
    equal(stack.layers[1].index, { n: 2.1, k: 0.01 }, 'COA with n and k');
    equal(stack.layers.map(layer => layer.code), [100, 0], 'thickness codes as entered');
    equal(stack.warnings, [], 'no warning for a clean file');
}

// ── 2. MDA commands ──────────────────────────────────────────────────────────
// CODE V Multilayer Design Reference Manual, Description of Output, Example 2:
// a group defined with GRO enters its layers there and again at each COA 'A'.
{
    const stack = parseCodevSeq(seq(
        'MUL', 'MDA', "TIT '7 Layer Quarter-wave Stack'",
        'COA 0.25 0 2.3', "Group 'A'", 'COA 0.25 0 1.38', 'COA 0.25 0 2.3', 'END',
        "COA 'A'", "COA 'a'", 'SUB 1.52', 'WLG 400 750 50', 'REF 550', 'ANG 0 30', 'STL 1 2',
        'MAN', 'GO', 'MPL', 'RFL', 'GO',
    ));
    equal(stack.layers.map(layer => layer.index.n), [2.3, 1.38, 2.3, 1.38, 2.3, 1.38, 2.3], 'seven layers, the group three times');
    near(stack.layers[0].thicknessNm, 0.25 * 550 / 2.3, 1e-12, 'PHT N by default: d = T·REF/n');
    near(stack.layers[1].thicknessNm, 0.25 * 550 / 1.38, 1e-12, 'PHT N for a group layer');
    stack.wavelengthsNm.forEach((lam, i) => near(lam, 400 + 50 * i, 1e-4, `WLG point ${i + 1} of 8, both ends included`));
    equal(stack.wavelengthsNm.length, 8, 'WLG 400 750 50 gives 8 wavelengths');
    equal(stack.anglesDeg, [0, 30], 'ANG');
    equal(stack.incident, { n: 1, k: 0 }, 'INC defaults to 1.00');
    equal(stack.warnings, [], 'STL, MAN, MPL, RFL and GO pass without a warning');
}
{
    // CODE V's DWDM sample coating, WLG 1547 1557 .2: its .mul stores these
    // wavelengths in µm, to 10 digits, a float32 running sum that ends
    // 1.7e-3 nm above 1557 nm.
    const stack = parseCodevSeq(seq('MUL', 'MDA', 'WLG 1547 1557 .2', 'COA .25 100 2.05', 'SUB 1.52'));
    equal(stack.wavelengthsNm.length, 51, 'WLG 1547 1557 0.2 gives 51 wavelengths');
    const stored = { 0: 1.547000051, 1: 1.547200084, 25: 1.552000880, 49: 1.556801677, 50: 1.557001710 };
    for (const [i, um] of Object.entries(stored)) {
        near(stack.wavelengthsNm[i] / 1000, um, 5e-10, `WLG point ${+i + 1} as CODE V builds it`);
    }
    equal(stack.refNm, stack.wavelengthsNm[25], 'REF defaults to the central wavelength');
    equal(stack.anglesDeg, [0], 'ANG defaults to 0');
}
{
    const even = parseCodevSeq(seq('MUL', 'MDA', 'WL 400 500 600 700', 'COA 0.25 100 1.38', 'SUB 1.52'));
    equal(even.refNm, 500, 'with an even WL count REF is the one left of centre');
}
{
    // A label used before its MIC; MWL changes between materials; EXT absent is 0.
    const stack = parseCodevSeq(seq(
        'MUL', 'MDA', 'PHT N', "COA 0.5 100 'H'", "COA 0.25 100 'L'", "SUB 'L'",
        'MIC', 'MWL 400 500 600', "'H' 2.40 2.30 2.25", "EXT 'H' 0.01 0.005 0.002",
        'MWL 450 550', "'L' 1.47 1.46", 'END',
        'WL 450 500 550', 'REF 500',
    ));
    equal(stack.mic.H, [[400, 2.4, 0.01], [500, 2.3, 0.005], [600, 2.25, 0.002]], 'MIC table of H as entered');
    equal(stack.mic.L, [[450, 1.47, 0], [550, 1.46, 0]], 'a new MWL for L; its k is 0 without EXT');
    near(stack.layers[0].thicknessNm, 0.5 * 500 / 2.3, 1e-12, 'PHT N of a MIC layer at an MWL point uses its n');
    near(stack.layers[1].thicknessNm, 0.25 * 500 / 1.465, 1e-12, 'between two MWL points n is the straight line');
    equal(stack.substrate, { label: 'L' }, 'SUB can name a MIC material');
}

// ── 3. Warnings and errors ───────────────────────────────────────────────────
{
    const stack = parseCodevSeq(seq(
        'MUL', 'MDA', 'WL 550', 'XYZ 1 2', 'COA 0.25 100 1.38', 'SUB 1.52', 'MAN', 'GO', 'MCH', 'THI S1 0.3', 'MEX',
    ));
    equal(stack.warnings, [
        { kind: 'unknownCommand', command: 'XYZ', line: 4 },
        { kind: 'unknownCommand', command: 'MCH', line: 9 },
    ], 'an unknown MDA command and MCH, whose changes are not applied, are reported with their lines');
    equal(stack.layers.length, 1, 'MCH changes nothing');
}
{
    const stack = parseCodevSeq(seq(
        'MUL', 'MDA', 'MIC', 'MWL 400 500', "'M' 2.0 1.9", 'END', "COA 0.25 100 'M'", "COA 0.5 100 'M'", 'SUB 1.5', 'WL 600',
    ));
    equal(stack.warnings, [{ kind: 'refOutsideTable', label: 'M' }], 'REF past a MIC table is reported once per material');
    // CODE V 11.2 held the end values of a 2-point table (MWL 450 650) from
    // 380 to 425 nm and from 675 to 750 nm.
    near(stack.layers[0].thicknessNm, 0.25 * 600 / 1.9, 1e-12, 'a 2-point table holds its end value there');
}
{
    // CODE V 11.2 printed n 1.743750 at 700 nm for this table, with "Index for
    // material X is being extrapolated": the parabola through its three points.
    const stack = parseCodevSeq(seq(
        'MUL', 'MDA', 'MIC', 'MWL 450 550 650', "'X' 1.9 1.8 1.75", "EXT 'X' 0.1 0.2 0.25", 'END',
        "COA 0.25 100 'X'", 'SUB 1.52', 'WL 700',
    ));
    equal(stack.warnings, [{ kind: 'refOutsideTable', label: 'X' }], 'REF past a 3-point table is reported');
    near(stack.layers[0].thicknessNm, 0.25 * 700 / 1.74375, 1e-9, 'and n there is extrapolated as CODE V does');
}
{
    // CODE V 11.2 listing of a 41-value WL command: it kept 400 to 600 nm and
    // printed "WARNING - Extra data ... ignored" for the rest.
    const values = Array.from({ length: 41 }, (_, i) => 400 + 10 * i);
    const stack = parseCodevSeq(seq(
        'MUL', 'MDA', `WL ${values.slice(0, 24).join(' ')} &`, `   ${values.slice(24).join(' ')} x`,
        'COA 0.25 100 1.38', 'SUB 1.52',
    ));
    equal(stack.wavelengthsNm, values.slice(0, 21), 'one WL command gives its first 21 values');
    equal(stack.refNm, 500, 'REF defaults to the centre of the 21 kept');
    equal(stack.warnings, [{ kind: 'extraValues', command: 'WL', line: 3, count: 21, limit: 21 }],
        'the values past the 21st are reported, a non-number among them included');
    const two = parseCodevSeq(seq('MUL', 'MDA', `WL ${values.slice(0, 21).join(' ')}`, `WL ${values.slice(21).join(' ')}`,
        'COA 0.25 100 1.38', 'SUB 1.52'));
    equal(two.wavelengthsNm, values, 'two WL commands of 21 and 20 give all 41');
    equal(two.warnings, [], 'with no warning');
}
{
    // Essential Macleod's CODE V export as it writes it on a machine set to a
    // decimal-comma locale: lower-case commands, "pht yes", WLG, GO and SAVE
    // with a double-quoted name inside MDA, every decimal a comma, MIC lines
    // longer than the 21 values CODE V 11.2 reads of each, and SUB naming a
    // MIC entry whose EXT is near 1e-8, which CODE V 11.2 took without a word.
    const mwl = Array.from({ length: 23 }, (_, i) => (400 + 3.03 * i).toFixed(2));
    const line = (head, values) => `${head}  ${values.join('   ').replace(/\./g, ',')}`;
    const text = seq(
        '! Exported from Essential Macleod v11.9.605, 07.10.2026 12:32:36', '', 'mul', 'mda',
        "tit 'Opaque Al mirror'", 'wlg 400 460 20', 'ref 550', 'pht yes', '', 'mic',
        line('mwl', mwl),
        line("'Al'", mwl.map(lam => (0.4 + 0.002 * (lam - 400)).toFixed(6))),
        line("EXT 'Al'", mwl.map(lam => (4.45 + 0.011 * (lam - 400)).toFixed(6))),
        line("'Glass'", mwl.map(() => '1.53085008566268')),
        line("EXT 'Glass'", mwl.map(() => '1.15110099230264E-08')),
        'end', '', "coa  1000  100 'Al'", "sub 'Glass'", 'inc 1.0', '', 'go', 'save "al_mirror.mul"', 'mex',
    );
    const stack = parseCodevSeq(text);
    const extra = (command, at) => ({ kind: 'extraValues', command, line: at, count: 2, limit: 21 });
    equal(stack.warnings, [{ kind: 'decimalComma', line: 11 }, extra('MWL', 11), extra('Al', 12), extra('EXT', 13),
        extra('Glass', 14), extra('EXT', 15)], 'decimal commas noted once, at their first line; each MIC line keeps 21 values');
    equal(stack.mic.Al.length, 21, 'the Al table holds the 21 points CODE V reads');
    equal([stack.mic.Al[1], stack.mic.Al[20]], [[403.03, 0.40606, 4.48333], [460.6, 0.5212, 5.1166]],
        'a comma between digits is a decimal point');
    equal(stack.mic.Glass[0], [400, 1.53085008566268, 1.15110099230264e-8], 'in a number with an exponent too');
    equal([stack.title, stack.wavelengthsNm.length, stack.refNm, stack.layers[0].thicknessNm, stack.substrate],
        ['Opaque Al mirror', 4, 550, 1000, { label: 'Glass' }], 'lower-case commands, "pht yes", GO and SAVE');
    const dots = parseCodevSeq(text.replace(/(\d),(\d)/g, '$1.$2'));
    equal(dots.warnings, stack.warnings.slice(1), 'the same file with decimal points has no decimalComma');
    equal({ ...dots, warnings: [] }, { ...stack, warnings: [] }, 'and the same stack');

    const titled = parseCodevSeq(seq('MUL', 'MDA', 'TIT Mirror 1,5', 'WL 550', 'COA 0,25 100 1,38', 'SUB 1,52'));
    equal(titled.title, 'Mirror 1,5', 'a title keeps its commas');
    equal(titled.warnings, [{ kind: 'decimalComma', line: 5 }], 'and is not a value with a decimal comma');
    near(titled.layers[0].thicknessNm, 0.25 * 550 / 1.38, 1e-12, 'PHT N with decimal commas');
}
fails('MUL\nMDA\nWL 400,500,600\nCOA 1 100 1.38\nSUB 1.5', 'badNumber', { line: 3, text: '400,500,600' },
    'two commas in one value are not a decimal');
fails('MUL\nMDA\nWL 400, 500\nCOA 1 100 1.38\nSUB 1.5', 'badNumber', { line: 3, text: '400,' },
    'a comma after a value is not read as a list');
fails('COA 0.25 100 1.38\nSUB 1.5', 'noStack', null, 'commands outside MUL are not a stack');
fails('MUL\nMDA\nWL 550\nSUB 1.5', 'noStack', null, 'MDA without COA');
fails("MUL\nMDA\nWL 550\nCOA 'B'\nSUB 1.5", 'unknownGroup', { label: 'B' }, 'COA names an undefined group');
fails("MUL\nMDA\nWL 550\nCOA 1 100 'Q'\nSUB 1.5", 'unknownMaterial', { label: 'Q' }, 'COA names a label the MIC lacks');
fails("MUL\nMDA\nMIC\nMWL 400\nEXT 'Q' 1\nEND", 'unknownMaterial', { label: 'Q' }, 'EXT before its material');
fails('MUL\nMDA\nWL 550\nCOA 1x5 100 1.38\nSUB 1.5', 'badNumber', { line: 4, text: '1x5' }, 'a thickness that is not a number');
fails('MUL\nMDA\nWL 550\nCOA 1 100\nSUB 1.5', 'badNumber', { line: 4, text: '' }, 'COA without an index');
fails("MUL\nMDA\nMIC\nMWL 400 500\n'M' 2.0\nEND\nWL 550\nCOA 1 100 'M'\nSUB 1.5", 'micMismatch', { label: 'M', line: 5 }, 'fewer n than MWL points');
fails('MUL\nMDA\nWL 550\nCOA 1 100 1.38', 'missingCommand', { command: 'SUB' }, 'no SUB');
fails('MUL\nMDA\nCOA 1 100 1.38\nSUB 1.5', 'missingCommand', { command: 'WL' }, 'no WL or WLG');

// ── 4. n between MIC points, as CODE V computes it ───────────────────────────
// The MIC tables of four CODE V sample coatings (REFL_SILVER_400nm_1000nm,
// REFL_GOLD_550nm_1000nm, REFL_AL_450nm_700nm, REFL_ALSIO_450nm_700nm; data
// from Palik) and the n CODE V stored for them at the analysis wavelengths.
// The k of each table is part of it: the metals, whose k is many times n,
// take the spline, and SiO, whose k/n stays below 0.1, the Hartmann curve.
// The stored n is a float32, and at an MWL point it is 3 float32 steps off
// the table (Al at 700 nm), so the tolerance is 4e-7, relative.
{
    const table = (mwl, n, k) => mwl.map((lam, i) => [lam, n[i], k[i]]);
    const cases = [
        [table([400, 459.2, 495.9, 563.6, 652.6, 774.9, 885.6, 1033], [0.173, 0.144, 0.130, 0.120, 0.140, 0.143, 0.163, 0.226],
            [1.950, 2.560, 2.880, 3.45, 4.150, 5.090, 5.950, 6.99]),
            { 750: 0.1428141594, 1000: 0.2086311132 }, 'silver'],
        [table([495.9, 563.6, 652.6, 774.9, 885.6, 1033], [0.916, 0.306, 0.166, 0.174, 0.210, 0.272],
            [1.840, 2.88, 3.15, 4.86, 5.88, 7.07]),
            { 550: 0.3852337301, 750: 0.1707715690, 1000: 0.2577517629 }, 'gold'],
        [table([400, 500, 550, 600, 700, 750], [0.490, 0.769, 0.958, 1.200, 1.830, 2.40],
            [4.860, 6.080, 6.690, 7.260, 8.310, 8.620]),
            { 450: 0.6156912446, 700: 1.830000639 }, 'aluminium'],
        [table([387.5, 442.8, 563.6, 619.9, 774.9], [2.144, 2.085, 1.994, 1.969, 1.929],
            [0.171, 0.084, 0.022, 0.012, 0.002]),
            { 450: 2.078301290, 550: 2.002352376, 700: 1.944684386 }, 'SiO'],
    ];
    for (const [rows, stored, name] of cases) {
        for (const [lam, n] of Object.entries(stored)) {
            near(micIndexAt(rows, +lam), n, 4e-7 * n, `${name} n at ${lam} nm`);
        }
    }
}

// ── 5. A .mul in the layout of CODE V's samples ──────────────────────────────
// Two layers on glass in air at 500 and 600 nm, one angle (10°), REF 500: an
// inline layer 0.25 waves of n 1.38 and 50 nm of MIC material 'Ti' (MWL 450,
// 650). Reals in G20.10, integers in I10, as CODE V writes them: a G field
// with an exponent fills 20 places, one without fills 16 and four blanks
// follow. The label words are 'Ti' in a REAL*8, printed without their E.
{
    const i10 = (...v) => v.map(x => String(x).padStart(10)).join('');
    const gField = (s) => (/E|\d[+-]\d/.test(s) ? s.padStart(20) : s.padStart(16).padEnd(20));
    const g20 = (...v) => v.map(x => gField(String(x))).join('');
    const word = '0.6011350410-153';
    const header45 = [2, 29, 3, 0, 2, 2, 0, 0, 0, 0, 7, 1, 0, 0, 1, 0, 4, 2, 13, 0, 0, 0, 25, 0,
        0, 0, 3, 0, 1, 0, 5, 3, 0, 1, 2, 8, 1, 0, 0, 0, 0, 0, 1, 3, 3];
    const settings = [1, 1, 1, 1, 1, 0, 0.5, 0, 0, 1, 1, 1, 1, 1, 0, 0.5, 0, 0.98, 0, 1, 0.1745329279, 0, 0, 0, 0];
    const rows = [
        i10(5) + g20('0.0000000000E+00'),
        'Two layers'.padEnd(80),
        '07-Oct-26'.padStart(19).padEnd(80),
        i10(0, 9600, 10233, 1010, 0),
        ...[0, 8, 16, 24, 32, 40].map(at => i10(...header45.slice(at, at + 8))),
        i10(0, 0, 0, 0, 0, 0, 0, 0), i10(0, 0, 0, 0),
        i10(0, 100, 0, 100),
        i10(-1, -1, 8, -1),
        i10(2, 3, 0, 0, 0, 0, 0, 0) + '\n' + i10(0, 0, 0, 0, 0),
        ...[0, 4, 8, 12, 16, 20, 24].map(at => g20(...settings.slice(at, at + 4))),
        g20('0.5000000000', '0.6000000238'),
        g20(1, 1), g20(1, 1), g20(0, 0), g20(0, 0),
        g20(0, '0.2500000000', '0.2300000042', 0),
        g20(0, 0, 0, 0),
        g20(1, '1.379999995', '2.300000000', '1.519999981'),
        i10(2) + 'Ti'.padEnd(10) + 'Ti'.padEnd(10),
        g20('0.4500000000', '0.6500000000', word, '2.400000000'),
        g20('2.200000000', '0.2000000000E-01', '0.1000000000E-01', word),
        g20('2.300000000', '2.250000000', '0.1500000000E-01', '0.1250000000E-01'),
        g20('0.0000000000E+00'),
        i10(1) + 'Ti'.padEnd(10),
        g20(1, word, '1.519999981', 1),
        g20(1),
    ];
    const stack = parseCodevMul(rows.join('\r\n'));
    equal(stack.title, 'Two layers', 'title');
    equal([stack.refNm, stack.wavelengthsNm, stack.anglesDeg], [500, [500, 600], [10]],
        'REF, WL and ANG back as entered from float32 µm and radians');
    equal(stack.incident, { n: 1, k: 0 }, 'incident medium');
    equal(stack.substrate, { n: 1.52, k: 0 }, 'substrate n from its float32');
    equal(stack.layers.map(layer => [layer.code, layer.index]), [[100, { n: 1.38, k: 0 }], [0, { label: 'Ti' }]], 'codes and indices');
    near(stack.layers[0].thicknessNm, 0.25 * 500 / 1.38, 1e-9, 'waves back to nm with the inline n');
    near(stack.layers[1].thicknessNm, 50, 1e-5, 'waves back to nm with the n(REF) the file stores');
    equal(stack.mic, { Ti: [[450, 2.4, 0.02], [650, 2.2, 0.01]] }, 'MIC table in nm');
    checks++;
    assert.throws(() => parseCodevMul('MUL\nMDA\n'), (err) => err.kind === 'notMul', 'command text is not a .mul');
    checks++;
    assert.throws(() => parseCodevMul([i10(7) + g20('0.0000000000E+00'), ...rows.slice(1)].join('\r\n')),
        (err) => err.kind === 'notMul', 'a format number other than 5 and 6, whose layout is not known');
    equal([fortranReal('0.6133314552-153'), fortranReal('1.5D+02'), fortranReal('-0.25E-01')], [0.6133314552e-153, 150, -0.025],
        'a Fortran real without its E, with D, and with E');
}

// ── 6. To TFStudio materials and layers ──────────────────────────────────────
{
    const stack = parseCodevSeq(seq(
        'MUL', 'MDA', 'PHT Y', 'WL 400 500', 'XYZ',
        'MIC', 'MWL 500 400', "'Ag' 0.05 0.17", "EXT 'Ag' 3.1 1.9", 'END',
        'COA 90 100 1.45', 'COA 60 7 2.2 0.001', 'COA 90 7 1.45', "COA 120 0 'Ag'", 'SUB 1.45',
    ));
    const design = codevStackToDesign(stack, { sourceName: 'mirror.seq' });
    const byKey = Object.fromEntries(design.materials.map(({ key, material }) => [key, material]));
    equal(design.materials.length, 4, 'air, 1.45 (shared by two layers and SUB), 2.2 with k, Ag');
    equal(design.layers.map(layer => byKey[layer.materialKey].name), ['n = 1.45', 'n = 2.2, k = 0.001', 'n = 1.45', 'Ag'],
        'constants named after their value, MIC materials after their label, incident side first');
    equal(byKey[design.substrateKey].name, 'n = 1.45', 'the substrate shares the layer material of equal index');
    equal(byKey[design.incidentKey].name, 'n = 1', 'the incident medium');
    equal(design.layers.map(layer => [layer.thickness, layer.locked]), [[90, true], [60, false], [90, false], [120, false]],
        'thickness in nm; code 100 locks a layer');
    const ag = design.materials.find(({ key }) => key === design.layers[3].materialKey).material;
    equal([ag.formulaNum, ag.tabData], [-1, [[400, 0.17, 1.9], [500, 0.05, 3.1]]], 'a MIC table becomes a table, sorted by wavelength');
    equal(design.warnings, [{ kind: 'unknownCommand', command: 'XYZ', line: 5 }, { kind: 'coupledLayers', count: 2 }],
        "the stack's warnings, then the layers whose coupling code is dropped");
}

console.log(`codev_coating_parse: ${checks} checks passed`);
