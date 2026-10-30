/**
 * The headless API's inhomogeneities (src/api/inhomogeneities.js) against the
 * Inhomogeneities window's own code.
 *
 *   1. On the corpus designs whose materials resolve, the two spectra are
 *      computeInhomogeneitySpectra's with the rows in the window's numbering,
 *      an interlayer at every interface of each side computed, each of the
 *      five profiles in turn, at 0 and 45 degrees, on the front, the back and
 *      the whole part. Interface k is the window's row whose label has layer k
 *      below it, and its materials are the two that meet there, in the order
 *      the window grades them.
 *   2. The verdict is the analysis worker's 'specification' pass with the
 *      interlayers, as the badge under the window's chart shows it, on the
 *      corpus designs that carry checks and on two given some.
 *   3. Cross-checks: homogeneous is spectrum on every corpus design at 30
 *      degrees, a design under a cone included; a TiO2 layer of the QW mirror
 *      split in halves with a 10 nm sigmoid interlayer of 7 slices between them
 *      is the layer 10 nm thicker through setLayer and spectrum; an interlayer
 *      of 0 nm changes nothing.
 *   4. The objects' CSV is the window's table with every curve through its
 *      Copy CSV.
 *   5. Refusals with their codes and fields.
 *
 * Run: node tests/api_inhomogeneities.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { inspect, isDeepStrictEqual } from 'node:util';
import { fixtureFile, manifest } from './_apiCorpus.mjs';

// The window's CSV writer sits in a module of React components.
globalThis.React = createRequire(import.meta.url)('react');
const api = await import('../src/api/index.js');
const objects = await import('../src/api/objects/index.js');
const { activeDesignSides, inhomogeneitySpectraState, NEW_INTERLAYER } = await import('../src/components/windows/analysis/inhomogeneities/model.js');
const { OVERLAY_CURVES } = await import('../src/components/windows/analysis/inhomogeneities/figure.js');
const { overlayColumns, overlayRows } = await import('../src/components/windows/analysis/inhomogeneities/tableModel.js');
const { designInterfaces } = await import('../src/components/windows/analysis/designInterfaces.js');
const { csvFromRows } = await import('../src/components/ui/ResultsSection.js');
const { embedDesignMaterials, withHerpinRecords } = await import('../src/utils/materials/designMaterials.js');
const { PROFILE_IDS } = await import('../src/utils/physics/inhomogeneity.js');
const { makeConeSpec, coneIsActive, resolveEvalMode } = await import('../src/utils/physics/optimizer.js');
const { dispatchAnalysisEvaluation } = await import('../src/utils/workers/analysisEvaluationWorker.js');
const en = (await import('../src/constants/locales/en.js')).default;

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };
const same = (a, b) => isDeepStrictEqual(a, b);

await api.init();
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-interlayers-'));
const QUANTITIES = ['R', 'T', 'A', 'Rs', 'Rp', 'Ts', 'Tp', 'As', 'Ap'];
const RANGE = { start: 400, end: 800, step: 5 };

// ── The designs ────────────────────────────────────────────────────────────
const CORPUS = Object.entries(manifest.fixtures).filter(([, fixture]) => Object.keys(fixture.variants).join() === 'default').map(([name]) => name);
const opened = CORPUS.map(name => [name, api.openDesign(fixtureFile(name))]);
const resolves = design => !thrown(() => api.spectrum(design, { from: 500, to: 501 }))?.message?.includes('resolve to nothing');
const corpus = opened.filter(([, design]) => resolves(design));
const unresolved = opened.filter(([, design]) => !resolves(design));
const mirror = api.stackFromFormula(api.newDesign({ name: 'Mirror' }), { formula: '(HL)^4 H' });
const twoSided = api.stackFromFormula(api.stackFromFormula(api.newDesign({ name: 'Two sides', surfaceMode: 'both_independent' }), { formula: '(HL)^2 H' }),
    { formula: 'HL', side: 'back' });

// The layers of a side counted from the substrate, as the Design Editor
// numbers them: the front is stored air side first, the back substrate first.
const fromSubstrate = (design, side) => (side === 'back' ? [...(design.backLayers || [])] : [...(design.frontLayers || [])].reverse());
// The materials that meet at interface k, in the order the window grades
// them: on the front from the material farther from the substrate to the
// nearer one, on the back from the nearer to the farther.
function meeting(design, side, k) {
    const layers = fromSubstrate(design, side);
    const below = k > 0 ? layers[k - 1].material : design.substrate.material;
    const above = k < layers.length ? layers[k].material : (side === 'back' ? design.exitMedium : design.incidentMedium);
    return side === 'back' ? [below, above] : [above, below];
}
// The window's list for the API's rows: on the front afterIndex N - 1 - k, on
// the back k - 1, each row as the hook adds one and then edits it.
function windowLists(design, rows) {
    const inh = { interlayers: [], backInterlayers: [] };
    for (const row of rows) {
        const n = fromSubstrate(design, row.side).length;
        const afterIndex = row.side === 'back' ? row.interface - 1 : n - 1 - row.interface;
        (row.side === 'back' ? inh.backInterlayers : inh.interlayers)
            .push({ afterIndex, ...NEW_INTERLAYER, thickness: row.thickness, profile: row.profile, slices: row.slices });
    }
    return inh;
}
// The window's two spectra for `design` scored as `mode`: the hook's request,
// computed by the analysis worker on the design with its materials embedded
// under a cone, as the window hands it over.
function windowSpectra(design, mode, rows, angle) {
    const shown = withHerpinRecords(design);
    const coned = coneIsActive(makeConeSpec(shown.cone || {}));
    const r = inhomogeneitySpectraState({
        design: coned ? embedDesignMaterials(shown) : shown,
        params: { lambdaStart: RANGE.start, lambdaEnd: RANGE.end, lambdaStep: RANGE.step, theta: angle, polarization: 'avg' },
        inh: windowLists(shown, rows), evalMode: mode,
    });
    const curves = spectrum => Object.fromEntries(QUANTITIES.map(q => [q, Array.from(spectrum[q])]));
    return { wavelength: Array.from(r.perturbed.lambda), homogeneous: curves(r.baseline), graded: curves(r.perturbed) };
}
// An interlayer at every interface of each side computed that has layers, the
// profile given and the thickness and slices varied from one to the next.
function everyInterface(design, mode, profile) {
    const sides = activeDesignSides(design, mode);
    return sides.flatMap(side => {
        const n = fromSubstrate(design, side).length;
        if (!n) return [];
        return Array.from({ length: n + 1 }, (_, k) => ({
            ...(sides.length > 1 ? { side } : {}), interface: k, thickness: 1 + (k % 4) * 1.5, profile, slices: 2 + ((3 * k) % 9),
        }));
    });
}

// ── 1. The window's numbers ────────────────────────────────────────────────
{
    const wrong = [];
    const labels = [];
    let cases = 0, rowsChecked = 0;
    const profiles = new Set();
    corpus.forEach(([name, design], i) => {
        const interfaces = designInterfaces(design, en.inhomogeneities);
        ['front', 'back', 'total'].forEach((side, j) => [0, 45].forEach((angle, a) => {
            const profile = PROFILE_IDS[(i + 2 * j + a) % PROFILE_IDS.length];
            profiles.add(profile);
            const given = everyInterface(design, side, profile);
            const r = api.inhomogeneities(design, { interlayers: given, ...RANGE, angle, side });
            const expected = windowSpectra(design, side, r.interlayers, angle);
            cases++;
            if (r.mode !== side || r.angle !== angle || r.interlayers.length !== given.length
                || !same([r.wavelength, r.homogeneous, r.graded], [expected.wavelength, expected.homogeneous, expected.graded])) {
                wrong.push(`${name} ${side} ${angle} ${profile}`);
            }
            for (const row of r.interlayers) {
                rowsChecked++;
                const n = fromSubstrate(design, row.side).length;
                const afterIndex = row.side === 'back' ? row.interface - 1 : n - 1 - row.interface;
                const [upper, lower] = interfaces[row.side].find(entry => entry.afterIndex === afterIndex).label.split(' → ');
                // On the front the window's label runs from the medium side to
                // the substrate, so layer k is the second name; on the back
                // from the substrate, so layer k is the first.
                const [nearer, farther] = row.side === 'back' ? [upper, lower] : [lower, upper];
                const layerNamed = (text, number) => (number >= 1 && number <= n ? text === `L${number}` : !/^L\d+$/.test(text));
                if (!layerNamed(nearer, row.interface) || !layerNamed(farther, row.interface + 1) || !same(row.materials, meeting(design, row.side, row.interface))) {
                    labels.push(`${name} ${row.side} ${row.interface}: ${upper} → ${lower} ${row.materials.join(' to ')}`);
                }
            }
        }));
    });
    ok(`on ${corpus.length} designs, the spectra are computeInhomogeneitySpectra's with an interlayer at every interface, on the front, the back and the whole part at 0 and 45 degrees (${cases} cases, every profile)`,
        corpus.length === 16 && cases === 96 && profiles.size === PROFILE_IDS.length && wrong.length === 0, wrong.slice(0, 4).join('\n'));
    ok(`interface k is the window's row with layer k below it, and its materials are the two that meet there in the window's order (${rowsChecked} rows)`,
        rowsChecked > 200 && labels.length === 0, labels.slice(0, 4).join('\n'));
}
{
    // The defaults: the window's opening range and angle, the scored side, and
    // a new row of 5 nm, linear, 10 slices.
    const r = api.inhomogeneities(mirror, { interlayers: [{ interface: 3 }] });
    ok('without options it computes from 400 to 800 nm in steps of 0.5 at 0 degrees on the side scored, and a row takes 5 nm, linear and 10 slices',
        same([r.mode, r.angle, r.wavelength[0], r.wavelength.at(-1), r.wavelength.length, r.interlayers, r.addedThickness],
            ['front', 0, 400, 800, 801, [{ side: 'front', interface: 3, thickness: 5, profile: 'linear', slices: 10, materials: ['builtin:SiO2', 'builtin:TiO2'] }], 5]),
        JSON.stringify(r.interlayers));
    const both = api.inhomogeneities(twoSided, { interlayers: [{ side: 'back', interface: 2, thickness: 3 }, { side: 'front', interface: 0, thickness: 2.5 }], ...RANGE });
    ok('on a part coated on both sides it computes the whole part, rows given with their side, and adds up both sides',
        both.mode === 'total' && both.addedThickness === 5.5 && same(both.interlayers.map(row => [row.side, row.interface]), [['back', 2], ['front', 0]]));
    const bare = api.inhomogeneities(mirror, { side: 'back', ...RANGE });
    ok('a side with no layers takes no row and gives its bare surface', bare.mode === 'back' && same(bare.homogeneous, bare.graded) && same(bare.homogeneous, windowSpectra(mirror, 'back', [], 0).homogeneous));
}

// ── 2. The verdict ─────────────────────────────────────────────────────────
{
    // The badge: the worker's 'specification' pass with the window's lists.
    const badge = (design, rows) => dispatchAnalysisEvaluation('specification', { designs: [withHerpinRecords(design)], interlayers: windowLists(withHerpinRecords(design), rows) })[0];
    const said = report => [report.passed, report.passing, report.total, report.rows.map(row => [row.value, row.passed, row.reason])];
    const fromBadge = results => {
        const counted = results.filter(result => result.pass !== null);
        const passing = counted.filter(result => result.pass === true).length;
        return [counted.length > 0 && passing === counted.length, passing, counted.length,
            results.map(result => [Number.isFinite(result.value) ? result.value : null, result.pass, result.summaryKey ?? null])];
    };
    const checked = corpus.filter(([, design]) => design.qualifiers?.length).map(([name, design]) => [name, design]);
    const given = [
        ['QW mirror', api.setSpecification(mirror, [{ kind: 'R_AVG', lambdaStart: 520, lambdaEnd: 580, cmp: 'ge', target: 0.98 }, { kind: 'THICKNESS_BUDGET', side: 'front' }])],
        ['two sides', api.setSpecification(twoSided, [{ kind: 'T_AT', lambda: 600, aoi: 20, pol: 'p' }, { kind: 'LAYER_COUNT', side: 'both' }])],
    ];
    const wrong = [...checked, ...given].filter(([, design]) => {
        const rows = everyInterface(design, resolveEvalMode(design), 'sigmoid');
        const r = api.inhomogeneities(design, { interlayers: rows, ...RANGE });
        return !same(said(r.specification), fromBadge(badge(design, r.interlayers)));
    }).map(([name]) => name);
    ok(`the verdict is the worker's specification pass with the interlayers, as the badge shows it, on ${checked.length} corpus design and two given checks`,
        checked.length >= 1 && wrong.length === 0, wrong.join(', '));
    const [, qw] = given[0];
    const plain = api.inhomogeneities(qw, RANGE).specification;
    const thicker = api.inhomogeneities(qw, { interlayers: [{ interface: 4, thickness: 10 }], ...RANGE }).specification;
    ok('without interlayers the verdict is checkSpecification\'s, and with them the thickness budget counts what they add',
        same(plain, api.checkSpecification(qw)) && Math.abs(thicker.rows[1].value - plain.rows[1].value - 10) < 1e-9, `${plain.rows[1].value} / ${thicker.rows[1].value}`);
    ok('a design with no specification has none', api.inhomogeneities(mirror, RANGE).specification === null);
}

// ── 3. Cross-checks ────────────────────────────────────────────────────────
{
    const off = corpus.filter(([, design]) => {
        const r = api.inhomogeneities(design, { ...RANGE, angle: 30 });
        const s = api.spectrum(design, { from: RANGE.start, to: RANGE.end, step: RANGE.step, angles: [30] });
        return !same([r.mode, r.wavelength, r.homogeneous], [s.evalMode, s.lambda, Object.fromEntries(QUANTITIES.map(q => [q, Array.from(s.angles[30][q])]))]);
    }).map(([name]) => name);
    const coned = corpus.find(([name]) => name === 'cone-user-distribution')?.[1];
    const withoutCone = api.inhomogeneities({ ...coned, cone: undefined }, { ...RANGE, angle: 30 }).homogeneous.R;
    ok('homogeneous is spectrum on every corpus design at 30 degrees, averaged over the cone on the one under a cone',
        off.length === 0 && !!coned && !same(api.inhomogeneities(coned, { ...RANGE, angle: 30 }).homogeneous.R, withoutCone), off.join(', '));
}
{
    // The QW mirror's outermost TiO2 layer cut in two halves, a 10 nm sigmoid
    // interlayer of 7 slices between them: TiO2 graded into TiO2 is TiO2.
    const qw = corpus.find(([name]) => name === 'builtin-bare-ids-qw-mirror')?.[1];
    const j = qw.frontLayers.findIndex(layer => /TiO2/.test(layer.material));
    const { material, thickness } = qw.frontLayers[j];
    const n = qw.frontLayers.length;
    const split = api.insertLayer(api.setLayer(qw, { index: j, thickness: thickness / 2 }), { index: j, material, thickness: thickness / 2 });
    // The two halves are stored at j and j + 1; the lower one is layer n - j
    // counted from the substrate, and the interface between them its top.
    const r = api.inhomogeneities(split, { interlayers: [{ interface: n - j, thickness: 10, profile: 'sigmoid', slices: 7 }], ...RANGE, angle: 30 });
    const s = api.spectrum(api.setLayer(qw, { index: j, thickness: thickness + 10 }), { from: RANGE.start, to: RANGE.end, step: RANGE.step, angles: [30] }).angles[30];
    const worst = Math.max(...QUANTITIES.flatMap(q => r.graded[q].map((v, i) => Math.abs(v - s[q][i]))));
    ok(`a TiO2 layer of the QW mirror (${thickness.toFixed(2)} nm) split in halves with a 10 nm sigmoid interlayer of 7 slices between them is the layer 10 nm thicker`,
        thickness.toFixed(2) === '57.30' && same(r.interlayers[0].materials, [material, material]) && worst < 1e-12, `${worst}`);
    const zero = api.inhomogeneities(qw, { interlayers: [{ interface: 2, thickness: 0 }], ...RANGE });
    ok('an interlayer of 0 nm changes nothing', zero.addedThickness === 0 && same(zero.graded, zero.homogeneous));
}
{
    // A layer of 0 nm, as a .tfs file can hold one, keeps its number and its
    // interfaces.
    const hlh = api.stackFromFormula(api.newDesign({ name: 'HLH' }), { formula: 'HLH' });
    const thin = { ...hlh, frontLayers: hlh.frontLayers.map((layer, i) => (i === 1 ? { ...layer, thickness: 0 } : layer)) };
    const r = api.inhomogeneities(thin, { interlayers: [{ interface: 1 }, { interface: 2 }], ...RANGE });
    ok('a layer of 0 nm keeps its interfaces, graded into its material as the window\'s row names it',
        same(r.interlayers.map(row => row.materials), [['builtin:SiO2', 'builtin:TiO2'], ['builtin:TiO2', 'builtin:SiO2']])
        && same(r.graded, windowSpectra(thin, 'front', r.interlayers, 0).graded));
}

// ── 4. The objects ─────────────────────────────────────────────────────────
{
    const every = Object.fromEntries(OVERLAY_CURVES.map(key => [key, true]));
    const cases = [['mirror', mirror, { interlayers: [{ interface: 4, thickness: 3, profile: 'exponential' }], ...RANGE }],
        ['two sides', twoSided, { interlayers: [{ side: 'back', interface: 1 }], ...RANGE, angle: 20 }]];
    const wrong = cases.filter(([, design, options], i) => {
        const file = path.join(WORK, `${i}.csv`);
        new objects.Design(design).inhomogeneities(options).saveCsv(file);
        const r = api.inhomogeneities(design, options);
        const rows = overlayRows({ lambda: r.wavelength, ...r.homogeneous }, { lambda: r.wavelength, ...r.graded }, every);
        return fs.readFileSync(file, 'utf8') !== csvFromRows(overlayColumns(en, every), rows);
    }).map(([what]) => what);
    ok('the CSV is the window\'s table with every curve through its Copy CSV', wrong.length === 0, wrong.join(', '));
    const r = new objects.Design(mirror).inhomogeneities({ interlayers: [{ interface: 4, thickness: 3 }], ...RANGE });
    const plain = api.inhomogeneities(mirror, { interlayers: [{ interface: 4, thickness: 3 }], ...RANGE });
    ok('the object\'s curves are the call\'s', r.homogeneous.R.at(550) === plain.homogeneous.R[plain.wavelength.indexOf(550)]
        && same([...r.graded.Tp], plain.graded.Tp) && r.addedThickness === 3);
    const shown = inspect(r);
    ok('it prints its side, angle, range and rows', shown === '<Inhomogeneities front at 0 degrees from 400 to 800 nm, 81 points, 1 interlayer>', shown);
}

// ── 5. Refusals ────────────────────────────────────────────────────────────
{
    const REFUSED = [
        ['an option it does not take', () => api.inhomogeneities(mirror, { interlayer: [] }), 'unknownOption', { option: 'interlayer' },
            /^inhomogeneities: unknown option 'interlayer'; the options are interlayers, start, end, step, angle, side$/],
        ['interlayers that are not a list', () => api.inhomogeneities(mirror, { interlayers: { interface: 1 } }), 'badValue', { option: 'interlayers' },
            /interlayers is a list of rows, each \{ side, interface, thickness, profile, slices \}, not /],
        ['a row that is not a record', () => api.inhomogeneities(mirror, { interlayers: [5] }), 'badValue', { option: 'interlayers[0]', value: 5 },
            /interlayers\[0\] is a row \{ side, interface, thickness, profile, slices \}, not 5$/],
        ['a field a row does not have', () => api.inhomogeneities(mirror, { interlayers: [{ interface: 1, sigma: 2 }] }), 'unknownOption', { option: 'interlayers[0].sigma' },
            /unknown option 'interlayers\[0\]\.sigma'; the options are side, interface, thickness, profile, slices$/],
        ['a row for a side not computed', () => api.inhomogeneities(mirror, { interlayers: [{ side: 'back', interface: 0 }] }), 'badValue', { option: 'interlayers[0].side', value: 'back' },
            /interlayers\[0\]\.side is 'front', the side computed, not "back"$/],
        ['a row with no side on the whole part', () => api.inhomogeneities(twoSided, { interlayers: [{ interface: 0 }] }), 'badValue', { option: 'interlayers[0].side' },
            /interlayers\[0\]\.side is 'front' or 'back', given on each row of the whole part, not undefined$/],
        ['an interface past the side\'s count', () => api.inhomogeneities(mirror, { interlayers: [{ interface: 10 }] }), 'badValue', { option: 'interlayers[0].interface', value: 10 },
            /interlayers\[0\]\.interface is a whole number from 0, the substrate's surface, to 9, the front's layer count, not 10$/],
        ['an interface that is not whole', () => api.inhomogeneities(mirror, { interlayers: [{ interface: 2.5 }] }), 'badValue', { option: 'interlayers[0].interface', value: 2.5 }, /not 2\.5$/],
        ['one interface given twice', () => api.inhomogeneities(mirror, { interlayers: [{ interface: 3 }, { interface: 3, thickness: 2 }] }), 'badValue', { option: 'interlayers[1].interface', value: 3 },
            /interlayers\[1\]\.interface is an interface no other row of the front names, not 3$/],
        ['a thickness below 0', () => api.inhomogeneities(mirror, { interlayers: [{ interface: 3, thickness: -1 }] }), 'badValue', { option: 'interlayers[0].thickness', value: -1 },
            /interlayers\[0\]\.thickness is a thickness in nm, 0 or more, not -1$/],
        ['a profile it does not have', () => api.inhomogeneities(mirror, { interlayers: [{ interface: 3, profile: 'gaussian' }] }), 'badValue', { option: 'interlayers[0].profile', value: 'gaussian' },
            /interlayers\[0\]\.profile is 'linear', 'parabolic', 'invParabolic', 'exponential' or 'sigmoid', not "gaussian"$/],
        ['one slice', () => api.inhomogeneities(mirror, { interlayers: [{ interface: 3, slices: 1 }] }), 'badValue', { option: 'interlayers[0].slices', value: 1 },
            /interlayers\[0\]\.slices is a whole number of slices, 2 or more, not 1$/],
        ['a fraction of a slice', () => api.inhomogeneities(mirror, { interlayers: [{ interface: 3, slices: 6.5 }] }), 'badValue', { option: 'interlayers[0].slices', value: 6.5 }, /not 6\.5$/],
        ['a row on a side with no layers', () => api.inhomogeneities(mirror, { side: 'back', interlayers: [{ interface: 0 }] }), 'emptySide', { side: 'back' },
            /^inhomogeneities: the back has no layers$/],
        ['an angle of 90', () => api.inhomogeneities(mirror, { angle: 90 }), 'badValue', { option: 'angle', value: 90 }, /angle is an angle of incidence in degrees, 0 <= angle < 90, not 90$/],
        ['a range that runs down', () => api.inhomogeneities(mirror, { start: 800, end: 400 }), 'wavelengthRange', { from: 800, to: 400 }, /start and end are wavelengths in nm, 0 < start < end$/],
        ['a side it does not have', () => api.inhomogeneities(mirror, { side: 'whole' }), 'badValue', { option: 'side', value: 'whole' }, /side is 'front', 'back' or 'total', not "whole"$/],
    ];
    for (const [what, make, code, fields, pattern] of REFUSED) {
        const err = thrown(make) ?? {};
        const given = Object.fromEntries(Object.keys({ call: 'inhomogeneities', ...fields }).map(key => [key, err.fields?.[key]]));
        ok(`inhomogeneities refuses ${what}`, same([err.code, given, pattern.test(err.message), String(err.message).startsWith('inhomogeneities: ')],
            [code, { call: 'inhomogeneities', ...fields }, true, true]), `${err.code} ${JSON.stringify(err.fields)} ${err.message}`);
    }
    const [[name, lost] = []] = unresolved;
    const messages = ['inhomogeneities', 'spectrum'].map(call => thrown(() => api[call](lost, call === 'spectrum' ? { from: 500, to: 600 } : undefined))?.message?.replace(/^\w+: /, ''));
    ok(`a design whose materials resolve to nothing (${name}) is refused, as spectrum refuses it`, !!lost && new Set(messages).size === 1 && /resolve to nothing/.test(messages[0]), messages.join(' / '));
    const objectError = thrown(() => new objects.Design(mirror).inhomogeneities({ interlayers: [{ interface: 12 }] }));
    ok('the object words a refusal as its own method', /^inhomogeneities: interlayers\[0\]\.interface is a whole number from 0, the substrate's surface, to 9, the front's layer count, not 12$/.test(objectError?.message ?? ''),
        objectError?.message);
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
