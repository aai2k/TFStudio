/**
 * The headless API's stress (src/api/stress.js) against the Stress window's
 * own code, and the three options of newDesign and setDesignSetup that set
 * what the window's fields set.
 *
 *   1. The call is computeStress in the API's names on the stress fixture and
 *      on the Macleod validation case on the front, the back, both faces with
 *      the front bare, both faces coated, symmetric, with no run and with the
 *      deposition temperature alone. On each face the case gives Macleod's
 *      printed table.
 *   2. Cross-check: the force is the STR row of merit.
 *   3. On the corpus every force is 0 and every material is missing, since the
 *      built-in materials state no constants.
 *   4. The options: set and unset as the window's fields write the design,
 *      kept through saveDesign and openDesign, compared by designDifferences.
 *   5. The objects, and the CSV through the window's Copy CSV.
 *   6. Refusals with their codes and fields.
 *
 * Run: node tests/api_stress.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { inspect, isDeepStrictEqual } from 'node:util';
import { fixtureFile, manifest } from './_apiCorpus.mjs';
import { validationBack, validationDesign } from './_stressValidation.mjs';

// The window's CSV writer sits in a module of React components.
globalThis.React = createRequire(import.meta.url)('react');
const api = await import('../src/api/index.js');
const objects = await import('../src/api/objects/index.js');
const { computeStress, stressBlockWith } = await import('../src/components/windows/analysis/stressAnalysis/model.js');
const { filmColumns, filmRows } = await import('../src/components/windows/analysis/stressAnalysis/tableModel.js');
const { csvFromRows } = await import('../src/components/ui/ResultsSection.js');
const { resolveEvalMode } = await import('../src/utils/physics/optimizer.js');
const en = (await import('../src/constants/locales/en.js')).default;

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };
const same = (a, b) => isDeepStrictEqual(a, b);
// Within a twentieth of a percent of a printed value, or half its last place,
// as stress_window.mjs reads Macleod's table.
const near = (actual, printed) => {
    const expected = Number(printed);
    const decimals = (String(printed).split('.')[1] || '').length;
    return actual != null && Math.abs(actual - expected) <= Math.max(0.5 * 10 ** -decimals, Math.abs(expected) * 0.005);
};
const relativelyEqual = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));

await api.init();
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-stress-'));

// The window's result for `design`, in the call's names.
function asCall(design) {
    const mode = resolveEvalMode(design);
    const { run, rows, whole, missing } = computeStress(design, mode);
    return {
        mode,
        run: run && { temperature: run.temperatureC, depositionTemperature: run.depositionTemperatureC },
        substrate: { material: design.substrate.material, thickness: design.substrate.thickness, diameter: design.substrate.diameterMm ?? null },
        whole: { force: whole.forceNm, radius: whole.radiusM, deflection: whole.deflectionUm, strainEnergy: whole.strainEnergy, cracking: whole.cracking },
        films: rows.map(row => ({
            side: row.side, number: row.layerNumber, material: row.materialId, name: row.materialName, thickness: row.thicknessNm,
            stress: row.stressMPa, strainEnergy: row.strainEnergy, delamination: row.delamination, shear: row.shearMPa,
        })),
        missing: missing.map(({ materialId, name, fields }) => ({ material: materialId, name, fields })),
    };
}
const strOf = design => api.merit(api.setMerit(design, [{ type: 'STR', target: 0 }])).rows[0].value;

// ── The designs ────────────────────────────────────────────────────────────
const fixture = api.openDesign(fixtureFile('stress-mechanical-diameter'));
const front = validationDesign();
const CASES = {
    'the front': front,
    'the back': validationDesign({ surfaceMode: 'back_only', frontLayers: [], backLayers: validationBack() }),
    'both faces, the front bare': validationDesign({ surfaceMode: 'both_independent', frontLayers: [], backLayers: validationBack() }),
    'both faces coated': validationDesign({ backLayers: [{ id: 'B1', material: 'user_m:H', thickness: 300 }], mfEvalMode: 'total' }),
    symmetric: api.setDesignSetup(front, { surfaceMode: 'symmetric' }),
    'no run': validationDesign({ stress: undefined }),
    'the deposition temperature alone': api.setDesignSetup(validationDesign({ stress: undefined }), { depositionTemperatureC: 3000 }),
};

// ── 1. The window's numbers ────────────────────────────────────────────────
{
    const wrong = Object.entries({ 'the stress fixture': fixture, ...CASES }).filter(([, design]) => !same(api.stress(design), asCall(design))).map(([name]) => name);
    ok(`the call is computeStress on the stress fixture and on the validation case on ${Object.keys(CASES).join(', ')}`, wrong.length === 0, wrong.join(', '));
}
{
    const s = api.stress(fixture);
    ok('the fixture reads its film force of 3.3946 N/m, nine films numbered from the substrate, and the constants its materials leave out',
        near(s.whole.force, '3.3946') && same([s.mode, s.films.map(f => f.number), s.run, s.substrate.diameter], ['front', [1, 2, 3, 4, 5, 6, 7, 8, 9], { temperature: 20, depositionTemperature: 250 }, 25.4])
        && s.missing.some(m => m.material === 'builtin:SiO2' && m.fields.includes('intrinsicStressMPa')), JSON.stringify(s.whole));
}
{
    // Macleod's table, on whichever face the four films are.
    const faces = ['the front', 'the back', 'both faces, the front bare'];
    const PRINTED = { force: '-3657.6', radius: '1050', deflection: '0.129', strainEnergy: '53.1', cracking: '34.8' };
    const off = faces.filter(face => {
        const { whole } = api.stress(CASES[face]);
        return !Object.entries(PRINTED).every(([key, printed]) => near(whole[key], printed));
    });
    ok('the validation case gives Macleod\'s radius, deflection, strain energy and cracking parameter on the front, the back, and the back of a part with its front bare', off.length === 0, off.join(', '));
    const onFront = api.stress(CASES['the front']);
    const moved = faces.slice(1).map(face => api.stress(CASES[face]));
    ok('on the back the films and the whole part read as on the front, the films on the back',
        moved.every(s => same(s.whole, onFront.whole) && s.films.every(f => f.side === 'back')
            && same(s.films.map(({ side, ...film }) => film), onFront.films.map(({ side, ...film }) => film)))
        && same(moved.map(s => s.mode), ['back', 'total']));
}
{
    const sym = api.stress(CASES.symmetric);
    const single = api.stress(CASES['the front']);
    ok('a symmetric part counts both coatings, bends not at all and has no radius, its strain energy doubled',
        same([sym.mode, sym.films.length, sym.whole.force, sym.whole.radius, sym.whole.deflection], ['total', 8, 0, null, 0])
        && relativelyEqual(sym.whole.strainEnergy, 2 * single.whole.strainEnergy), JSON.stringify(sym.whole));
    const both = api.stress(CASES['both faces coated']);
    ok('with both faces coated the force is the front\'s less the back\'s', both.mode === 'total' && both.films.length === 5
        && Math.abs(both.whole.force) < Math.abs(single.whole.force) && same(both.films.map(f => f.side), ['front', 'front', 'front', 'front', 'back']));
    const bare = api.stress(CASES['no run']);
    ok('with no run each film carries its intrinsic stress', bare.run === null && same(bare.films.map(f => f.stress), [150, -300, 150, -300]), JSON.stringify(bare.films.map(f => f.stress)));
    const deposited = api.stress(CASES['the deposition temperature alone']);
    ok('the deposition temperature alone reads the other as 20 °C', same([deposited.run, deposited.whole, deposited.films], [{ temperature: 20, depositionTemperature: 3000 }, single.whole, single.films]));
}

// ── 2. Cross-check: the force is the STR row ───────────────────────────────
{
    const designs = { 'the stress fixture': fixture, ...CASES };
    const off = Object.entries(designs).filter(([, design]) => !relativelyEqual(api.stress(design).whole.force, strOf(design))).map(([name]) => name);
    const fileRow = api.merit(fixture).rows.find(row => row.type === 'STR');
    ok('the force is the STR row of merit on the fixture and on every validation case, and the fixture\'s own STR row reads it',
        off.length === 0 && relativelyEqual(fileRow?.value, api.stress(fixture).whole.force), off.join(', '));
}

// ── 3. The corpus ──────────────────────────────────────────────────────────
{
    const CORPUS = Object.entries(manifest.fixtures).filter(([, fixture]) => Object.keys(fixture.variants).join() === 'default').map(([name]) => name);
    const opened = CORPUS.map(name => [name, api.openDesign(fixtureFile(name))]);
    const resolves = design => !thrown(() => api.spectrum(design, { from: 500, to: 501 }))?.message?.includes('resolve to nothing');
    const corpus = opened.filter(([, design]) => resolves(design));
    const wrong = corpus.filter(([, design]) => {
        const s = api.stress(design);
        const named = new Set(s.missing.map(m => m.material));
        return !same(s, asCall(design)) || s.whole.force !== 0
            || !s.films.every(f => named.has(f.material)) || !named.has(s.substrate.material);
    }).map(([name]) => name);
    ok(`on ${corpus.length} corpus designs the call is computeStress, every force is 0 and every material, the substrate's included, is missing`,
        corpus.length === 16 && wrong.length === 0, wrong.join(', '));
    const [[name, lost] = []] = opened.filter(([, design]) => !resolves(design));
    const messages = ['stress', 'spectrum'].map(call => thrown(() => api[call](lost, call === 'spectrum' ? { from: 500, to: 600 } : undefined))?.message?.replace(/^\w+: /, ''));
    ok(`a design whose materials resolve to nothing (${name}) is refused, as spectrum refuses it`, !!lost && new Set(messages).size === 1 && /resolve to nothing/.test(messages[0]), messages.join(' / '));
}

// ── 4. The options ─────────────────────────────────────────────────────────
{
    const made = api.newDesign({ stressTemperatureC: 60, depositionTemperatureC: 250, substrateDiameterMm: 50 });
    ok('newDesign sets the two temperatures and the diameter', same([made.stress, made.substrate.diameterMm], [{ temperatureC: 60, depositionTemperatureC: 250 }, 50]));
    const plain = api.newDesign();
    ok('without them a design has no stress block and no diameter', !('stress' in plain) && !('diameterMm' in plain.substrate));
    const kept = api.setDesignSetup(made, { name: 'Renamed', substrateThicknessMm: 2 });
    ok('an option left out keeps its value', same([kept.stress, kept.substrate.diameterMm], [made.stress, 50]));

    // The window's fields, one change at a time, as the hook writes them.
    const steps = [['stressTemperatureC', 'temperatureC', 60], ['depositionTemperatureC', 'depositionTemperatureC', 250],
        ['stressTemperatureC', 'temperatureC', null], ['stressTemperatureC', 'temperatureC', -40], ['depositionTemperatureC', 'depositionTemperatureC', null],
        ['stressTemperatureC', 'temperatureC', null]];
    let design = api.newDesign();
    let block;
    const differ = [];
    steps.forEach(([option, field, value], i) => {
        design = api.setDesignSetup(design, { [option]: value });
        block = stressBlockWith(block, { [field]: value });
        if (!same(design.stress, block) || ('stress' in design) !== (block !== undefined)) differ.push(i);
    });
    ok('each temperature set and unset leaves the block the window\'s fields leave, and the last one unset removes it', differ.length === 0 && !('stress' in design), differ.join(', '));
    const cleared = api.setDesignSetup(made, { substrateDiameterMm: null });
    ok('a diameter given as null is unset, as the window\'s field writes it', cleared.substrate.diameterMm === null && api.stress(cleared).substrate.diameter === null);

    // Each value set, and each one unset, kept through a file.
    const states = {
        set: made,
        'one temperature unset': api.setDesignSetup(made, { stressTemperatureC: null }),
        'all unset': api.setDesignSetup(made, { stressTemperatureC: null, depositionTemperatureC: null, substrateDiameterMm: null }),
    };
    const lostInFile = Object.entries(states).filter(([what, state], i) => {
        const file = path.join(WORK, `options-${i}.tfs`);
        api.saveDesign(state, file);
        const back = api.openDesign(file);
        return !same([back.stress, back.substrate.diameterMm ?? null], [state.stress, state.substrate.diameterMm ?? null])
            || ('stress' in back) !== ('stress' in state) || !api.designDifferences(state, back).same;
    }).map(([what]) => what);
    ok('each option set and unset survives saveDesign and openDesign', lostInFile.length === 0, lostInFile.join(', '));

    const found = api.designDifferences(plain, made).setup.filter(row => /Temperature|Diameter/.test(row.setting));
    ok('designDifferences compares the three as setDesignSetup sets them', same(found, [
        { setting: 'stressTemperatureC', before: null, after: 60 }, { setting: 'depositionTemperatureC', before: null, after: 250 },
        { setting: 'substrateDiameterMm', before: null, after: 50 }]), JSON.stringify(found));
}

// ── 5. The objects ─────────────────────────────────────────────────────────
{
    const design = new objects.Design(api.newDesign({ name: 'Plate' }));
    design.stressTemperature = 60;
    design.depositionTemperature = 250;
    design.substrate.diameter = 25.4;
    const set = [design.stressTemperature, design.depositionTemperature, design.substrate.diameter, design._data.stress];
    design.stressTemperature = null;
    design.depositionTemperature = null;
    design.substrate.diameter = null;
    ok('the three attributes set and unset what the options do', same(set, [60, 250, 25.4, { temperatureC: 60, depositionTemperatureC: 250 }])
        && same([design.stressTemperature, design.depositionTemperature, design.substrate.diameter, 'stress' in design._data], [null, null, null, false]));
    const other = design.copy();
    other.depositionTemperature = 120;
    other.substrate.diameter = 30;
    ok('differences() names them as the attributes are named', same(design.differences(other).setup, [
        { setting: 'depositionTemperature', before: null, after: 120 }, { setting: 'substrate.diameter', before: null, after: 30 }]),
    JSON.stringify(design.differences(other).setup));

    const s = new objects.Design(fixture).stress();
    const plain = api.stress(fixture);
    ok('the object reads what the call reads', same([s.mode, s.run, s.substrate, s.whole, s.films, s.missing], [plain.mode, plain.run, plain.substrate, plain.whole, plain.films, plain.missing]));
    const shown = inspect(s);
    ok('it prints its coatings, films, force and missing materials', shown === `<Stress front: 9 films, force ${plain.whole.force} N/m, 3 materials missing constants>`, shown);

    // The window's Copy CSV, with and without the side column.
    const written = [['the fixture', fixture], ['both faces coated', CASES['both faces coated']]].map(([what, shownDesign], i) => {
        const file = path.join(WORK, `${i}.csv`);
        new objects.Design(shownDesign).stress().saveCsv(file);
        const result = computeStress(shownDesign, resolveEvalMode(shownDesign));
        const columns = filmColumns(en.stressAnalysis, result.bothSides);
        return { what, text: fs.readFileSync(file, 'utf8'), columns, window: csvFromRows(columns, filmRows(result.rows, en.stressAnalysis)) };
    });
    const wrong = written.filter(file => file.text !== file.window).map(file => file.what);
    ok('the CSV is the window\'s per-film table through its Copy CSV, with the side column when both faces count', wrong.length === 0, wrong.join(', '));
    const split = written.filter(file => !file.text.split('\n').every(line => line.split(',').length === file.columns.length)).map(file => file.what);
    ok('its heading has as many fields as each row', split.length === 0, `${split.join(', ')}: ${written[0].text.split('\n')[0]}`);
}

// ── 6. Refusals ────────────────────────────────────────────────────────────
{
    const blank = api.newDesign();
    const TEMPERATURE = /is a temperature in °C above -273\.15, or null to unset it, not /;
    const REFUSED = [
        ['a temperature at absolute zero', () => api.setDesignSetup(blank, { stressTemperatureC: -273.15 }), { call: 'setDesignSetup', option: 'stressTemperatureC', value: -273.15 }, TEMPERATURE],
        ['a deposition temperature given as text', () => api.setDesignSetup(blank, { depositionTemperatureC: '250' }), { call: 'setDesignSetup', option: 'depositionTemperatureC', value: '250' }, TEMPERATURE],
        ['a temperature that is not finite', () => api.newDesign({ stressTemperatureC: Infinity }), { call: 'newDesign', option: 'stressTemperatureC', value: Infinity }, TEMPERATURE],
        ['a diameter of 0', () => api.setDesignSetup(blank, { substrateDiameterMm: 0 }), { call: 'setDesignSetup', option: 'substrateDiameterMm', value: 0 },
            /substrateDiameterMm is a diameter in mm above 0, or null to unset it, not 0$/],
        ['a diameter that is not a number', () => api.newDesign({ substrateDiameterMm: NaN }), { call: 'newDesign', option: 'substrateDiameterMm', value: NaN }, /not NaN$/],
    ];
    for (const [what, make, fields, pattern] of REFUSED) {
        const err = thrown(make) ?? {};
        const given = Object.fromEntries(Object.keys(fields).map(key => [key, err.fields?.[key]]));
        ok(`${fields.call} refuses ${what}`, same([err.code, given, pattern.test(err.message), String(err.message).startsWith(`${fields.call}: `)], ['badValue', fields, true, true]),
            `${err.code} ${JSON.stringify(err.fields)} ${err.message}`);
    }
    const design = new objects.Design(blank);
    const worded = [() => { design.stressTemperature = -300; }, () => { design.depositionTemperature = -300; }, () => { design.substrate.diameter = -1; }]
        .map(make => thrown(make)?.message);
    ok('the objects word a refusal by the attribute\'s name', same(worded, [
        'stressTemperature is a temperature in °C above -273.15, or null to unset it, not -300',
        'depositionTemperature is a temperature in °C above -273.15, or null to unset it, not -300',
        'substrate.diameter is a diameter in mm above 0, or null to unset it, not -1']), JSON.stringify(worded));
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
