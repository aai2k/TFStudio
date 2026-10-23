/**
 * The headless API's materialDispersion (src/api/materialDispersion.js)
 * against the Material Dispersion window's own code and the material's n.
 *
 *   1. On four fixtures, materialDispersion is materialDispersionSpectrum and
 *      materialDispersionRows, the code the window plots and tabulates, with
 *      its own grid: a formula (SiO2, Sellmeier), a table with knots (TiO2),
 *      a table whose fit ends inside it (two more knots, where n steps) and a
 *      slab too thick to pass light (1 mm of Si below about 1 µm), whose
 *      masked wavelengths carry the window's reasons and thickness limit.
 *      Without options it takes the window's factory settings.
 *   2. On the corpus designs, every material each names, resolved through the
 *      design as the window's picker resolves it, gives the same numbers.
 *   3. The objects' CSV is the window's table through its Copy CSV
 *      (materialDispersionTable, csvFromRows), with its Outside data column
 *      when a row is outside the material's data; material.range is
 *      materialNK's.
 *   4. Cross-check: the group index is n − λ·dn/dλ, dn/dλ taken from
 *      materialNK by central differences, and GD is the group index times
 *      d/c.
 *   5. Refusals with their codes and fields.
 *
 * Run: node tests/api_material_dispersion.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { fixtureFile, manifest } from './_apiCorpus.mjs';

// The window's CSV writer sits in a module of React components.
globalThis.React = createRequire(import.meta.url)('react');
const api = await import('../src/api/index.js');
const objects = await import('../src/api/objects/index.js');
const { materialDispersionRows, materialDispersionSpectrum, materialDispersionTable } = await import('../src/utils/materials/materialDispersionSpectrum.js');
const { sessionDefaults } = await import('../src/constants/analysisDefaults.js');
const en = (await import('../src/constants/locales/en.js')).default;
const { resolveDesignMaterial, designMaterialIds } = await import('../src/utils/materials/designMaterials.js');
const { fitTabulatedMaterial } = await import('../src/utils/materials/dispersionFits.js');
const { C_NM_PER_FS } = await import('../src/utils/materials/materialDispersion.js');
const { csvFromRows } = await import('../src/components/ui/ResultsSection.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };
const same = (a, b) => isDeepStrictEqual(a, b);

// A data folder whose user catalog holds a table with a Cauchy fit over
// 405-795 nm, so n steps by the fit's residual at each end of the fit.
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-material-dispersion-'));
const table = [];
for (let nm = 300; nm <= 1000; nm += 10) table.push([nm, 2 + 30000 / nm ** 2 + 0.002 * Math.sin(nm / 37), 0]);
const ripple = { id: 'ripple', name: 'Rippled oxide', formulaNum: -1, coefficients: [], kTable: [], tabData: table,
    dispersionFit: fitTabulatedMaterial(table, { nModel: 'cauchy', rangeNm: [405, 795] }) };
fs.mkdirSync(path.join(WORK, 'Materials', 'user'), { recursive: true });
fs.writeFileSync(path.join(WORK, 'Materials', 'user', 'fixtures.catalog.json'),
    JSON.stringify({ id: 'fixtures', name: 'Fixtures', source: 'user', materials: { ripple } }));
await api.init({ dataDir: WORK });

// What the window shows for `id` resolved through `design`: its spectrum and
// rows, as the API names them.
function windowOf(id, from, to, thickness, design = null) {
    const { material } = resolveDesignMaterial(design || {}, id);
    const spectrum = materialDispersionSpectrum(material, from, to, thickness);
    const rows = materialDispersionRows(spectrum);
    const column = key => rows.map(row => row[key]);
    return {
        id, name: spectrum.materialName, thickness, wavelength: spectrum.lambda,
        phase: column('phase'), gd: column('gd'), gdd: column('gdd'), cdc: column('cdc'), tod: column('tod'), groupIndex: column('groupIndex'),
        outside: rows.map(row => row.outside || null),
        masked: spectrum.invalid.map(value => ({ wavelength: value.wavelengthNm, reason: value.reason,
            maximumThickness: Number.isFinite(value.maximumThicknessMm) ? value.maximumThicknessMm : null })),
        knots: spectrum.knotSamples.map(({ wavelengthNm, gd, gdd, tod, cdc }) => ({ wavelength: wavelengthNm, gd, gdd, tod, cdc })),
        model: spectrum.model,
    };
}

// ── 1. The fixtures ────────────────────────────────────────────────────────
const DEFAULTS = sessionDefaults('materialDispersion');
const FIXTURES = [
    ['a formula', 'SiO2', 400, 1100, 1],
    ['a table with knots', 'TiO2', 400, 1100, 1],
    ['a table whose fit ends inside it', 'fixtures:ripple', 300, 1000, 5],
    ['a slab too thick to pass light', 'Si', 400, 1100, 1],
];
const results = {};
for (const [what, id, from, to, thickness] of FIXTURES) {
    const got = api.materialDispersion(id, { from, to, thickness });
    results[id] = got;
    ok(`materialDispersion is the window's computation on ${what} (${id})`, same(got, windowOf(id, from, to, thickness)));
}
{
    const { SiO2, TiO2, Si } = results;
    const fit = results['fixtures:ripple'];
    ok('the formula has no knot, no masked wavelength and a Sellmeier n', SiO2.knots.length === 0 && SiO2.masked.length === 0 && /Sellmeier/.test(SiO2.model), SiO2.model);
    ok('the table has a sample on each knot in range, with its two one-sided values', TiO2.knots.length > 10
        && TiO2.knots.every(knot => TiO2.wavelength.includes(knot.wavelength) && knot.gdd[0] !== knot.gdd[1]), String(TiO2.knots.length));
    ok('the fit\'s two ends are knots', [405, 795].every(edge => fit.knots.some(knot => knot.wavelength === edge)), fit.knots.map(knot => knot.wavelength).join());
    const limit = Si.masked[0]?.maximumThickness;
    const masked = Si.masked.filter(m => /extinguished/.test(m.reason) && Number.isNaN(Si.gd[Si.wavelength.indexOf(m.wavelength)]));
    ok('the thick slab has no value where it absorbs, each wavelength masked with the window\'s reason and thickness limit',
        Si.masked.length > 100 && masked.length === Si.masked.length && limit > 0 && limit < 1, JSON.stringify(Si.masked[0]));
    ok('the grid is the window\'s, 2000 steps over the range never finer than 0.2 nm, with the knots',
        SiO2.wavelength.length === 2001 && SiO2.wavelength[0] === 400 && SiO2.wavelength.at(-1) === 1100
        && api.materialDispersion('SiO2', { from: 700, to: 900 }).wavelength.length === 1001, String(SiO2.wavelength.length));
    ok('without options it takes the window\'s factory settings', same(api.materialDispersion('TiO2'),
        windowOf('TiO2', DEFAULTS.start, DEFAULTS.end, DEFAULTS.thicknessMm)) && DEFAULTS.thicknessMm === 1);
}

// ── 2. The corpus ──────────────────────────────────────────────────────────
{
    const CORPUS = Object.entries(manifest.fixtures).filter(([, fixture]) => Object.keys(fixture.variants).join() === 'default').map(([name]) => name);
    const wrong = [];
    let count = 0;
    for (const name of CORPUS) {
        const design = api.openDesign(fixtureFile(name));
        for (const id of designMaterialIds(design)) {
            const { status } = resolveDesignMaterial(design, id);
            if (status === 'missing' || status === 'unset') continue;
            count++;
            if (!same(api.materialDispersion(id, { from: 450, to: 950, thickness: 0.5 }, design), windowOf(id, 450, 950, 0.5, design))) wrong.push(`${name}/${id}`);
        }
    }
    ok('on the corpus designs, each material they name gives the window\'s numbers, resolved through the design', count > 20 && wrong.length === 0, `${count} materials; ${wrong.join(', ')}`);
}

// ── 3. The objects ─────────────────────────────────────────────────────────
{
    const tf = await objects.start({ dataDir: WORK });
    const tio2 = tf.materials.get('TiO2');
    const d = tio2.dispersion(300, 1100, { thickness: 2 });
    const plain = api.materialDispersion('TiO2', { from: 300, to: 1100, thickness: 2 });
    const KEYS = ['phase', 'gd', 'gdd', 'cdc', 'tod', 'groupIndex'];
    ok('material.dispersion() gives what materialDispersion gives, its curves Curves',
        same([d.thickness, d.wavelength, d.outside, d.masked, d.knots, d.model, ...KEYS.map(key => [...d[key]])],
            [plain.thickness, plain.wavelength, plain.outside, plain.masked, plain.knots, plain.model, ...KEYS.map(key => plain[key])])
        && KEYS.every(key => d[key] instanceof objects.Curve && d[key].wavelength === d.wavelength));
    ok('and its defaults are the plain call\'s', same([...tio2.dispersion().gdd], api.materialDispersion('TiO2').gdd));
    ok('material.range is materialNK\'s range', same(tio2.range, api.materialNK('TiO2', [550]).rangeNm) && Array.isArray(tio2.range)
        && tf.materials.get('BK7').range[0] > 0, JSON.stringify(tio2.range));
    const file = path.join(WORK, 'dispersion.csv');
    d.saveCsv(file);
    const { material } = resolveDesignMaterial({}, 'TiO2');
    const table = materialDispersionTable(materialDispersionSpectrum(material, 300, 1100, 2), en.gdgdd, en.spectralAxis.lambdaShort, en.materialRange.outsideColumn);
    const written = fs.readFileSync(file, 'utf8');
    ok('saveCsv writes the window\'s table as its Copy CSV writes it, with its Outside data column', written === csvFromRows(table.columns, table.rows)
        && written.split('\n')[0] === 'λ (nm),Outside data,Phase φ (°),Group Delay (fs),GDD (fs²),CDC (fs/nm),TOD (fs³),nᵧ', written.split('\n')[0]);
    const inside = path.join(WORK, 'inside.csv');
    tf.materials.get('BK7').dispersion(700, 900).saveCsv(inside);
    ok('and without it when every row is inside the data', fs.readFileSync(inside, 'utf8').split('\n')[0] === 'λ (nm),Phase φ (°),Group Delay (fs),GDD (fs²),CDC (fs/nm),TOD (fs³),nᵧ');
    const shown = (await import('node:util')).inspect(d);
    ok('a MaterialDispersion prints what it holds', shown === `<MaterialDispersion TiO2, 2 mm, from 300 to 1100 nm, ${d.wavelength.length} points>`, shown);
    const WORDED = [
        [() => tio2.dispersion(400, 800, { from: 400 }), "dispersion: unknown option 'from'; the options are thickness"],
        [() => tio2.dispersion(800, 400), 'dispersion: start and end are wavelengths in nm, 0 < start < end'],
        [() => tio2.dispersion({ thickness: 0 }), 'dispersion: thickness is a thickness in mm from 1e-9 to 100000, not 0'],
        [() => tio2.dispersion(400, 800, 5), 'dispersion: takes start and end before its options object, not 3 values'],
    ];
    const worded = WORDED.map(([make]) => thrown(make)?.message);
    ok('its refusals are in the objects\' words', same(worded, WORDED.map(([, words]) => words)), worded.join('\n'));
}

// ── 4. Cross-check against n ───────────────────────────────────────────────
{
    const h = 0.01;
    const off = ['SiO2', 'BK7'].flatMap(id => {
        const d = api.materialDispersion(id, { thickness: 1 });
        return [100, 600, 1200, 1900].map(i => [id, i]).filter(([, i]) => {
            const wavelength = d.wavelength[i];
            const [below, at, above] = api.materialNK(id, [wavelength - h, wavelength, wavelength + h]).nk.map(point => point.n);
            const groupIndex = at - wavelength * (above - below) / (2 * h);
            const gd = groupIndex * 1e6 / C_NM_PER_FS;
            return Math.abs(d.groupIndex[i] - groupIndex) > 1e-8 || Math.abs(d.gd[i] - gd) > 1e-6 * gd;
        });
    });
    ok('the group index is n − λ·dn/dλ from materialNK, and GD is the group index times d/c', off.length === 0, off.join('; '));
}

// ── 5. Refusals ────────────────────────────────────────────────────────────
{
    const REFUSED = [
        ['an option it does not take', () => api.materialDispersion('BK7', { start: 400 }), 'unknownOption', { option: 'start' }, /unknown option 'start'; the options are from, to, thickness$/],
        ['a range that is not one', () => api.materialDispersion('BK7', { from: 800, to: 400 }), 'wavelengthRange', { from: 800, to: 400 }, /from and to are wavelengths in nm, 0 < from < to$/],
        ['a thickness of 0', () => api.materialDispersion('BK7', { thickness: 0 }), 'badValue', { option: 'thickness', value: 0 }, /thickness is a thickness in mm from 1e-9 to 100000, not 0$/],
        ['a thickness past the window\'s field', () => api.materialDispersion('BK7', { thickness: 2e5 }), 'badValue', { option: 'thickness', value: 2e5 }, /not 200000$/],
    ];
    for (const [what, make, code, fields, pattern] of REFUSED) {
        const err = thrown(make) ?? {};
        const given = Object.fromEntries(Object.keys({ call: 'materialDispersion', ...fields }).map(key => [key, err.fields?.[key]]));
        ok(`materialDispersion refuses ${what}`, same([err.code, given, pattern.test(err.message), String(err.message).startsWith('materialDispersion: ')], [code, { call: 'materialDispersion', ...fields }, true, true]),
            `${err.code} ${JSON.stringify(err.fields)} ${err.message}`);
    }
    const unknown = thrown(() => api.materialDispersion('Unobtainium'))?.message;
    ok('a material that resolves to nothing is refused, as materialNK refuses it', unknown === thrown(() => api.materialNK('Unobtainium', [550]))?.message && /Unknown material 'Unobtainium'/.test(unknown), unknown);
}

fs.rmSync(WORK, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
