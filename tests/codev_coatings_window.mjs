/**
 * CODE V Coatings window, Export tab: the .seq it writes for each side of a
 * design, and the messages it shows.
 *
 * CODE V enters a stack from the incident medium to the substrate, and on a
 * glass/air surface wants air as the incident medium and the glass as the
 * substrate whichever face of the element it is. The front of a design is
 * therefore written as stored (frontLayers run incident side first) and the
 * back reversed (backLayers run substrate side first), with the exit medium as
 * INC. Every material is resolved through the design, a locked layer is frozen
 * (code 100), and what the writer reports comes out as the locale's sentence.
 *
 * Run: node tests/codev_coatings_window.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';

const require = createRequire(import.meta.url);
globalThis.React = require('react');
globalThis.window = globalThis;
globalThis.electronAPI = { saveCatalog: async () => ({ success: true }), deleteCatalog: async () => ({ success: true }) };

const cm = await import('../src/utils/materials/catalogManager.js');
const { getLocale } = await import('../src/constants/locales/index.js');
const { CodevExportError, CodevParseError, CODEV_LIMITS } = await import('../src/utils/io/codevCoatingFile.js');
const { buildGrid } = await import('../src/utils/io/zemaxCoatingFile.js');
const { analysisWavelengths, sideStack } = await import('../src/components/windows/dataExchange/codevCoatings/exportModel.js');
const messages = await import('../src/components/windows/dataExchange/codevCoatings/messages.js');
const runtime = makeHookRuntime();
const { useGenerateAction, useSaveAction } = await importWithHookRuntime(
    '../src/components/windows/dataExchange/codevCoatings/useExportActions.js', runtime);
const z = getLocale('en').codevCoatings;

cm.initCatalogs({});
cm.addCatalog({
    id: 'user_lab_00000001', name: 'Lab', source: 'user',
    materials: { Water: { id: 'Water', name: 'Water', formulaNum: -1, tabData: [[300, 1.33, 0], [1000, 1.33, 0]] } },
});

const design = {
    id: 'd1', name: 'Two sides',
    incidentMedium: 'user_lab_00000001:Water', exitMedium: 'builtin:Air',
    substrate: { material: 'builtin:BK7', thickness: 1 },
    referenceWavelength: 550,
    // Incident side first.
    frontLayers: [
        { id: 'f1', material: 'builtin:TiO2', thickness: 100, locked: true },
        { id: 'f2', material: 'builtin:SiO2', thickness: 90, locked: false },
    ],
    // Substrate side first.
    backLayers: [
        { id: 'b1', material: 'builtin:MgF2', thickness: 50, locked: false },
        { id: 'b2', material: 'builtin:SiO2', thickness: 30, locked: true },
    ],
};

const BASE = {
    side: 'front', title: 'Two sides', saveName: 'two_sides',
    gStart: 400, gEnd: 700, gStep: 50, anglesDeg: [0, 30], refNm: 550,
};

function generate(d, overrides = {}) {
    const out = { preview: null, warnings: null, flashes: [] };
    runtime.reset();
    const run = runtime.render(() => useGenerateAction({
        ...BASE, ...overrides, z, design: d,
        flash: (type, message) => out.flashes.push([type, message]),
        setExport: (preview, warnings) => { out.preview = preview; out.warnings = warnings; },
    }));
    run();
    out.last = out.flashes.at(-1);
    return out;
}

const lines = (text) => text.split('\r\n');
const command = (text, name) => lines(text).filter(line => line.startsWith(`${name} `));
// The COA lines as [thickness, code, index text].
const coa = (text) => command(text, 'COA').map(line => {
    const [, thickness, code, index] = /^COA (\S+) (\S+) (.+)$/.exec(line);
    return [Number(thickness), Number(code), index];
});

// ── Front: as stored, the design's incident medium, the substrate ─────────────
{
    const { preview, flashes, last } = generate(design);
    assert.equal(last[0], 'success', `front export goes through: ${last[1]}`);
    assert.equal(last[1], z.generated(2, 0));
    assert.equal(flashes.length, 1);
    assert.deepEqual(command(preview, 'INC'), ['INC 1.33'], 'INC is the incident medium, a constant n');
    const layers = coa(preview);
    assert.deepEqual(layers.map(([d, code]) => [d, code]), [[100, 100], [90, 0]],
        'frontLayers in stored order, the locked one frozen');
    assert.match(layers[0][2], /^'TiO2/, 'the first COA is the incident-side layer');
    assert.match(layers[1][2], /^'SiO2/);
    assert.match(command(preview, 'SUB')[0], /^SUB 'BK7/, 'SUB is the substrate, sampled into MIC');
    assert.deepEqual(command(preview, 'ANG'), ['ANG 0 30']);
    assert.deepEqual(command(preview, 'REF'), ['REF 550']);
    assert.deepEqual(command(preview, 'SAV'), ['SAV two_sides']);
    assert.deepEqual(command(preview, 'TIT'), ["TIT 'Two sides'"]);
    assert.equal(command(preview, 'WL')[0], 'WL 400 450 500 550 600 650 700');
    assert.equal(lines(preview).filter(line => line === 'PHT Y').length, 1, 'thicknesses are physical nm');
}

// ── Back: the exit medium as INC, backLayers reversed, the same substrate ─────
{
    const { preview, last } = generate(design, { side: 'back' });
    assert.equal(last[0], 'success', `back export goes through: ${last[1]}`);
    assert.deepEqual(command(preview, 'INC'), ['INC 1'], 'INC is the exit medium (air)');
    const layers = coa(preview);
    assert.deepEqual(layers.map(([d, code]) => [d, code]), [[30, 100], [50, 0]],
        'the exit-side layer first, the substrate-side layer last');
    assert.match(layers[0][2], /^'SiO2/);
    assert.match(layers[1][2], /^'MgF2/);
    assert.match(command(preview, 'SUB')[0], /^SUB 'BK7/);
    assert.deepEqual(sideStack(design, 'back').layers.map(layer => layer.material),
        ['builtin:SiO2', 'builtin:MgF2']);
}

// A built-in stored bare, as synthesis inserts it, is the same MIC entry as
// its prefixed id: one label for both layers.
{
    const bare = { ...design, frontLayers: [
        { id: 'a', material: 'SiO2', thickness: 20 }, { id: 'b', material: 'builtin:SiO2', thickness: 40 },
    ] };
    const { preview, last } = generate(bare);
    assert.equal(last[0], 'success', last[1]);
    const [first, second] = coa(preview);
    assert.equal(first[2], second[2], 'SiO2 bare and prefixed share one label');
}

// ── Warnings come out as the locale's sentences ───────────────────────────────
{
    // An absorbing substrate: CODE V takes no k for SUB.
    const metal = { ...design, substrate: { material: 'builtin:Ag', thickness: 1 } };
    const { warnings, last } = generate(metal);
    const absorbs = warnings.find(w => w.kind === 'mediumAbsorbs');
    assert.ok(absorbs, `the k of the substrate is reported: ${JSON.stringify(warnings)}`);
    assert.equal(absorbs.role, 'substrate');
    assert.equal(messages.warningText(z, absorbs), z.warnSubstrateAbsorbs(absorbs.material));
    assert.equal(last[1], z.generated(2, warnings.length));
}
{
    // 31 wavelengths of a dispersive material: its MIC table is cut to 21.
    const { warnings, last } = generate(design, { gStep: 10 });
    assert.equal(last[0], 'success', last[1]);
    const resampled = warnings.find(w => w.kind === 'resampled');
    assert.ok(resampled, 'a dispersive material over 31 wavelengths is resampled');
    assert.equal(resampled.from, 31);
    assert.equal(resampled.to, CODEV_LIMITS.micPoints);
    assert.equal(messages.warningText(z, resampled), z.warnResampled(resampled.material, 31, 21));
    assert.equal(messages.warningText(z, { kind: 'unknownCommand', command: 'MAN', line: 12 }), z.warnUnknownCommand('MAN', 12));
    assert.equal(messages.warningText(z, { kind: 'extraValues', command: 'WL', line: 3, count: 20, limit: 21 }), z.warnExtraValues('WL', 3, 20, 21));
    assert.equal(messages.warningText(z, { kind: 'refOutsideTable', label: 'Ag' }), z.warnRefOutsideTable('Ag'));
    assert.equal(messages.warningText(z, { kind: 'coupledLayers', count: 4 }), z.warnCoupledLayers(4));
    assert.equal(messages.warningText(z, { kind: 'somethingNew' }), z.warnOther('somethingNew'));
}

// ── Refusals: each limit of the MUL option, with its numbers ──────────────────
{
    const { preview, last } = generate(design, { gStep: 1 });
    assert.deepEqual(last, ['error', z.errTooManyWavelengths(301, CODEV_LIMITS.wavelengths)]);
    assert.equal(preview, '', 'no preview is left to save');
}
{
    const many = { ...design, frontLayers: Array.from({ length: 1001 }, (_, i) => ({ id: `m${i}`, material: 'builtin:SiO2', thickness: 10 })) };
    const { last } = generate(many);
    assert.deepEqual(last, ['error', z.errTooManyLayers(1001, CODEV_LIMITS.layers)]);
}
{
    const { last } = generate(design, { anglesDeg: [0, 10, 20, 30, 40, 50] });
    assert.deepEqual(last, ['error', z.errTooManyAngles(6, CODEV_LIMITS.angles)]);
}
{
    const { last } = generate({ ...design, backLayers: [] }, { side: 'back' });
    assert.deepEqual(last, ['error', z.nothingToExportBack]);
    const front = generate({ ...design, frontLayers: [{ id: 'z', material: 'builtin:SiO2', thickness: 0 }] });
    assert.deepEqual(front.last, ['error', z.nothingToExportFront], 'a zero-thickness layer is no layer');
}

// An id that resolves nowhere is refused with its name, never written as air.
{
    const broken = { ...design, frontLayers: [...design.frontLayers, { id: 'x', material: 'user_gone_12345678:X', thickness: 10 }] };
    const { preview, last } = generate(broken);
    assert.deepEqual(last, ['error', z.exportUnresolved('user_gone_12345678:X')]);
    assert.equal(preview, '');
}

// ── The wavelength count matches the grid that would be built ─────────────────
for (const [a, b, step] of [[400, 700, 50], [400, 800, 10], [400, 403, 0.03], [700, 400, 25], [300, 2500, 3], [400, 800, 4.04]]) {
    const { count, wavelengthsNm } = analysisWavelengths(a, b, step);
    assert.equal(count, buildGrid(a, b, step).length, `count for ${a} to ${b} step ${step}`);
    if (wavelengthsNm) assert.deepEqual(wavelengthsNm, buildGrid(a, b, step));
    else assert.ok(count > CODEV_LIMITS.wavelengths, 'only a count past the limit leaves the list unbuilt');
}

// ── Error texts for every kind the reader and the writer raise ────────────────
{
    const parse = (kind, detail) => messages.parseErrorText(z, new CodevParseError(kind, detail));
    assert.equal(parse('noStack'), z.errNoStack);
    assert.equal(parse('unknownGroup', { label: 'a' }), z.errUnknownGroup('a'));
    assert.equal(parse('unknownMaterial', { label: 'SILVER' }), z.errUnknownMaterial('SILVER'));
    assert.equal(parse('badNumber', { line: 7, text: '1.2.3' }), z.errBadNumber(7, '1.2.3'));
    assert.equal(parse('notMul'), z.errNotMul);
    assert.equal(parse('missingCommand', { command: 'SUB' }), z.errMissingCommand('SUB'));
    assert.equal(parse('micMismatch', { label: 'Ag', line: 9 }), z.errMicMismatch('Ag', 9));
    assert.equal(parse('brandNew'), z.errParse('brandNew'));

    const write = (kind, detail) => messages.exportErrorText(z, new CodevExportError(kind, detail));
    assert.equal(write('layers', { count: 1200, limit: 1000 }), z.errTooManyLayers(1200, 1000));
    assert.equal(write('wavelengths', { count: 0, limit: 100 }), z.errNoWavelengths);
    assert.equal(write('angles', { count: 7, limit: 5 }), z.errTooManyAngles(7, 5));
    assert.equal(write('noIndex', { material: 'Ge' }), z.errNoIndex('Ge'));
}

// ── Save offers the .seq under the name SAV gives the .mul ────────────────────
{
    const flashes = [];
    const calls = [];
    runtime.reset();
    const save = runtime.render(() => useSaveAction({
        z, flash: (type, message) => flashes.push([type, message]),
        preview: 'MUL\r\nMDA\r\nSAV two_sides\r\nMEX\r\n',
    }));
    window.electronAPI = {
        codevSaveCoatingFile: async (text, name) => { calls.push([text, name]); return { success: true, filePath: 'C:\\out\\two_sides.seq' }; },
    };
    await save();
    assert.equal(calls[0][1], 'two_sides.seq');
    assert.deepEqual(flashes.at(-1), ['success', z.savedFile('C:\\out\\two_sides.seq')]);

    window.electronAPI = { codevSaveCoatingFile: async () => ({ success: false, canceled: true }) };
    await save();
    assert.equal(flashes.length, 1, 'a cancelled dialog says nothing');

    window.electronAPI = { codevSaveCoatingFile: async () => ({ success: false, error: 'disk full' }) };
    await save();
    assert.deepEqual(flashes.at(-1), ['error', z.errSave('disk full')]);
}

console.log('PASS: codev_coatings_window');
