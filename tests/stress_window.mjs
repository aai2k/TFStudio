/**
 * The Stress window's model.
 *
 * The physics is checked in `tests/stress_model.mjs` against the papers and in
 * `tests/stress_analysis.mjs` against Essential Macleod's own table. What is
 * checked here is the assembly: that a TFStudio design, with its constants on
 * its materials and its temperatures on the design, reproduces that same table
 * through the window, and that every constant a material leaves out is named,
 * with the rows that need it blank or the terms that need it left out.
 *
 * The first case is the validation design of
 * `validation/macleod/Stress validation case/`, built as a TFStudio design and
 * run at the first of the three dialog settings (`tests/_stressValidation.mjs`).
 * It is the end-to-end check: layer order, which coating counts, the
 * temperature bookkeeping, the units the window prints and the numbering that
 * puts layer 1 at the substrate, all against numbers a different program
 * printed.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildEvalContext, resolveEvalMode } from '../src/utils/physics/optimizer.js';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';
import { stressForceNm } from '../src/utils/physics/stress/stackForce.js';
import { computeStress } from '../src/components/windows/analysis/stressAnalysis/model.js';
import { filmColumns, filmRows, wholeRows } from '../src/components/windows/analysis/stressAnalysis/tableModel.js';
import { localeSources } from '../src/constants/locales/index.js';
import { MATERIALS, OPTICS, validationBack, validationDesign } from './_stressValidation.mjs';

// The window's CSV writer and its notices sit in modules of React components.
globalThis.React = createRequire(import.meta.url)('react');
const { csvFromRows } = await import('../src/components/ui/ResultsSection.js');
const { stressNotices } = await import('../src/components/windows/analysis/stressAnalysis/StressControls.js');

// The table prints three figures, so a value is checked to half of the last
// place it showed or a twentieth of a percent, whichever is looser.
function close(actual, printed, message) {
    const expected = Number(printed);
    const decimals = (String(printed).split('.')[1] || '').length;
    const tolerance = Math.max(0.5 * 10 ** -decimals, Math.abs(expected) * 0.005);
    assert.ok(actual != null && Math.abs(actual - expected) <= tolerance,
        `${message}: ${actual} is not within ${tolerance} of ${expected}`);
}

const analyse = design => computeStress(design, resolveEvalMode(design));

// ── The Macleod table, through the window ────────────────────────────────────

{
    const design = validationDesign();
    const result = analyse(design);

    // The program's rows 1 to 4, from the medium inwards. TFStudio numbers from
    // the substrate, so its rows come back in the opposite order.
    const printed = [
        { stressGPa: '-4.05', energy: '18.4', delamination: '14.2', shearMPa: '6.84' },
        { stressGPa: '-0.955', energy: '2.7', delamination: '16.3', shearMPa: '8.18' },
        { stressGPa: '-4.05', energy: '27.7', delamination: '37.6', shearMPa: '18.4' },
        { stressGPa: '-0.955', energy: '4.32', delamination: '66.4', shearMPa: '20.6' },
    ];
    assert.equal(result.rows.length, 4, 'one row per film');
    assert.deepEqual(result.rows.map(row => row.layerNumber), [1, 2, 3, 4],
        'films are numbered 1 at the substrate');
    assert.equal(result.rows[0].materialName, 'TFS Stress L',
        'and row 1 is the layer next to the substrate, the program’s layer 4');

    printed.forEach((expected, index) => {
        const row = result.rows[result.rows.length - 1 - index];
        const where = `Macleod layer ${index + 1}`;
        close(row.stressMPa / 1000, expected.stressGPa, `${where}: stress`);
        close(row.strainEnergy, expected.energy, `${where}: strain energy`);
        close(row.delamination, expected.delamination, `${where}: delamination factor`);
        close(row.shearMPa, expected.shearMPa, `${where}: peak shear at the interface below it`);
    });

    close(result.whole.strainEnergy, '53.1', 'total strain energy');
    close(result.whole.radiusM, '1050', 'radius of curvature, m');
    close(result.whole.deflectionUm, '0.129', 'centre deflection, µm (0.000129 mm printed)');
    close(result.whole.cracking, '34.8', 'cracking parameter');
    assert.equal(result.missing.length, 0, 'the case states every constant the window reads');
}

// ── The force is the one the STR operand minimizes ───────────────────────────

{
    const design = validationDesign();
    const result = analyse(design);
    const ctx = buildEvalContext(design, designMaterialLookup(design));
    close(result.whole.forceNm, stressForceNm(ctx).toPrecision(6),
        'the window and the STR operand bend the substrate with the same force');
}

// ── What a missing constant does ─────────────────────────────────────────────

{
    // A design that states no temperatures carries the intrinsic stress alone,
    // which for these two materials is -300 and +150 MPa, and says so.
    const design = validationDesign({ stress: undefined });
    const result = analyse(design);
    assert.equal(result.run, null, 'no stress block means no run');
    close(result.rows[0].stressMPa, '150', 'the substrate-side low-index film keeps its own stress');
    close(result.rows[1].stressMPa, '-300', 'and the high-index film keeps its own');
}

{
    // A material with no mechanical block at all: its stress is unknown rather
    // than zero, so its row is blank and the notice names every field it lacks.
    const design = validationDesign({
        materials: { ...MATERIALS, 'user_m:L': { id: 'L', name: 'Unmeasured', ...OPTICS } },
    });
    const result = analyse(design);
    assert.equal(result.rows[0].stressMPa, null, 'an unmeasured film shows no stress');
    assert.equal(result.rows[0].strainEnergy, null, 'and no strain energy');
    assert.equal(result.whole.cracking, null, 'the cracking parameter needs every film, so it is withheld');
    assert.equal(result.rows[0].shearMPa, null,
        'and so is the shear, which sums the elastic constants of the whole stack');
    const entry = result.missing.find(item => item.name === 'Unmeasured');
    assert.ok(entry, 'the notice names the material');
    assert.equal(entry.fields.length, 6, 'and every constant the window reads off a film');
}

{
    // A fifth film on top whose material states every constant H does but its
    // intrinsic stress. Its stress is unknown, so its strain energy, every
    // delamination factor that sums that energy, the total strain energy and
    // the cracking parameter are blank, not partial sums that leave it out. The
    // force and the edge shear count it as carrying none, as the STR row does.
    const { intrinsicStressMPa, ...unstressed } = MATERIALS['user_m:H'].mechanical;
    assert.ok(Number.isFinite(intrinsicStressMPa), 'H states a stress the new material leaves out');
    const four = analyse(validationDesign());
    const design = validationDesign({
        materials: { ...MATERIALS, 'user_m:U': { id: 'U', name: 'No stress', ...OPTICS, mechanical: unstressed } },
        frontLayers: [{ id: 'F0', material: 'user_m:U', thickness: 300 }, ...validationDesign().frontLayers],
    });
    const result = analyse(design);
    const top = result.rows[4];
    assert.equal(top.materialName, 'No stress', 'the fifth film is on top');
    assert.equal(top.stressMPa, null, 'it shows no stress');
    assert.equal(top.strainEnergy, null, 'and no strain energy, which needs its stress');
    assert.deepEqual(result.rows.map(row => row.delamination), [null, null, null, null, null],
        'every delamination factor sums the films outside its interface, the top one among them');
    assert.equal(result.whole.strainEnergy, null, 'the total strain energy needs every film');
    assert.equal(result.whole.cracking, null, 'and so does the cracking parameter');
    assert.deepEqual(result.rows.slice(0, 4).map(row => row.strainEnergy), four.rows.map(row => row.strainEnergy),
        'the four films below keep their own strain energies');
    assert.equal(result.whole.forceNm, four.whole.forceNm, 'the force counts the fifth film as carrying none');
    assert.ok(result.rows.every(row => row.shearMPa != null), 'and so does the edge shear');
    assert.deepEqual(result.missing, [{ materialId: 'user_m:U', name: 'No stress', fields: ['intrinsicStressMPa'] }],
        'and the notice names the stress it lacks');

    // In every language, the notice's line says that the force and what follows
    // from it count the film as the STR row does.
    for (const [language, t] of Object.entries(localeSources)) {
        const line = t.stressAnalysis.noticeMissing(1);
        assert.ok(stressNotices(result, t).some(notice => notice.label === line),
            `${language}: the notice counts the material`);
        assert.ok(/\bSTR\b/.test(line), `${language}: and ties the force to the STR row: ${line}`);
    }
    const english = localeSources.en.stressAnalysis.noticeMissing(1);
    for (const quantity of ['film force', 'radius', 'deflection', 'edge shear']) {
        assert.ok(english.includes(quantity), `the English line names the ${quantity}: ${english}`);
    }
}

{
    // A missing thermal constant leaves its term out of the stress, as the STR
    // row does, rather than blanking the stress: the validation case at its
    // run, 20 °C deposited at 3000 °C, with one constant removed. With all
    // stated H carries -4049 MPa, L -955 MPa, the force is -3658 N/m and the
    // radius 1052 m. Rows 0 and 1 are the L and the H next to the substrate.
    const without = (id, field, overrides = {}) => {
        const { [field]: absent, ...mechanical } = MATERIALS[id].mechanical;
        assert.ok(Number.isFinite(absent), `${id} states the ${field} the case removes`);
        return validationDesign({ materials: { ...MATERIALS, [id]: { ...MATERIALS[id], mechanical } }, ...overrides });
    };
    const CASES = [
        // Read as measured at the deposition temperature: the expansion mismatch alone.
        ['H states no reference temperature', without('user_m:H', 'referenceTemperatureC'), ['-1889', '-955', '-2038', '1888']],
        // The intrinsic stress alone.
        ['H states no Young\'s modulus', without('user_m:H', 'youngsModulusGPa'), ['-300', '-955', '-846', '4548']],
        ['H states no expansion coefficient', without('user_m:H', 'linearExpansionPerK'), ['-300', '-955', '-846', '4548']],
        // Each film keeps its reference-temperature term and loses the mismatch.
        ['the substrate states no expansion coefficient', without('user_m:Sub', 'linearExpansionPerK'), ['-2460', '-2211', '-3282', '1172']],
    ];
    for (const [what, design, [h, l, force, radius]] of CASES) {
        const result = analyse(design);
        close(result.rows[1].stressMPa, h, `${what}: the stress of H`);
        close(result.rows[0].stressMPa, l, `${what}: the stress of L`);
        close(result.whole.forceNm, force, `${what}: the film force`);
        close(result.whole.radiusM, radius, `${what}: the radius`);
        close(result.whole.forceNm, stressForceNm(buildEvalContext(design, designMaterialLookup(design))).toPrecision(6),
            `${what}: the force is the STR row's`);
        assert.equal(result.missing.length, 1, `${what}: the notice names the constant`);
    }

    // With no temperatures set, a missing reference temperature or expansion
    // coefficient changes no number, though the notice still names it.
    const bare = analyse(validationDesign({ stress: undefined }));
    for (const [id, field] of [['user_m:H', 'referenceTemperatureC'], ['user_m:H', 'linearExpansionPerK'], ['user_m:Sub', 'linearExpansionPerK']]) {
        const result = analyse(without(id, field, { stress: undefined }));
        assert.deepEqual([result.rows, result.whole], [bare.rows, bare.whole], `with no run, ${id} without ${field} reads as with it`);
        assert.equal(result.missing.length, 1, `with no run, the notice still names ${id}'s ${field}`);
    }

    // In every language the notice names, as the Material Editor names them,
    // the thermal constants whose absence changes the stress, and ties them to
    // the STR row.
    for (const [language, t] of Object.entries(localeSources)) {
        const line = t.stressAnalysis.noticeMissing(1).toLowerCase();
        for (const field of ['referenceTemperatureC', 'youngsModulusGPa', 'poissonsRatio', 'linearExpansionPerK']) {
            const name = t.materialEditor.mechanicalFields[field].toLowerCase();
            assert.ok(line.includes(name), `${language}: the notice says what a missing ${name} does: ${line}`);
        }
    }
}

{
    // The manual's table of what each quantity needs has a row for every
    // quantity the Whole part table prints, in English and in Chinese.
    for (const [language, page] of [['en', 'analysis/stress.md'], ['zh', 'zh/analysis/stress.md']]) {
        const text = readFileSync(new URL(`../docs-site/src/content/docs/${page}`, import.meta.url), 'utf8');
        const named = new Set(text.split(/\r?\n/).filter(line => line.startsWith('| '))
            .map(line => line.split('|')[1].trim()));
        const t = localeSources[language];
        for (const row of wholeRows({}, t.stressAnalysis, t.units)) {
            assert.ok(named.has(row.quantity), `${language}: the manual says what the ${row.quantity} needs`);
        }
    }
}

{
    // Fused silica as the substrate and as two of the films, named by its bare
    // name and by its compound id: one material, which the notice counts once
    // with every constant it lacks.
    const design = validationDesign({
        substrate: { material: 'SiO2', thickness: 1 },
        frontLayers: [
            { id: 'F1', material: 'user_m:H', thickness: 100 },
            { id: 'F2', material: 'builtin:SiO2', thickness: 100 },
            { id: 'F3', material: 'SiO2', thickness: 100 },
        ],
    });
    const { missing } = analyse(design);
    assert.equal(missing.length, 1, `one material leaves constants out: ${JSON.stringify(missing)}`);
    assert.equal(missing[0].name, 'SiO2 (Fused Silica)', 'and it is the silica');
    assert.deepEqual(missing[0].fields, [
        'youngsModulusGPa', 'poissonsRatio', 'linearExpansionPerK',
        'intrinsicStressMPa', 'referenceTemperatureC', 'surfaceEnergyJm2',
    ], 'with every constant a film or the substrate reads');
}

{
    const design = validationDesign({ substrate: { material: 'user_m:Sub', thickness: 15 } });
    const result = analyse(design);
    assert.equal(result.whole.deflectionUm, null, 'no diameter, no centre deflection');
    assert.ok(result.whole.radiusM != null, 'the radius needs no diameter and is still shown');
}

{
    const design = validationDesign({
        materials: {
            ...MATERIALS,
            'user_m:Sub': { id: 'Sub', name: 'Bare glass', ...OPTICS },
        },
    });
    const result = analyse(design);
    assert.equal(result.whole.radiusM, null, 'a substrate with no modulus bends by no known amount');
    assert.ok(result.rows[0].stressMPa != null,
        'but the films still carry the stress their own constants give them');
    assert.ok(result.missing.some(item => item.name === 'Bare glass'),
        'and the substrate is named alongside the films');
}

{
    // A substrate that states its modulus but no Poisson's ratio. The radius
    // and the deflection need the ratio through the biaxial modulus, and the
    // edge shear needs it through k, so all three are blank. Read with a ratio
    // of 0, the shear of film 1 would be 22.75 MPa against 20.59.
    const { poissonsRatio, ...noRatio } = MATERIALS['user_m:Sub'].mechanical;
    assert.ok(Number.isFinite(poissonsRatio), 'the substrate states a ratio the new one leaves out');
    const design = validationDesign({
        materials: { ...MATERIALS, 'user_m:Sub': { ...MATERIALS['user_m:Sub'], mechanical: noRatio } },
    });
    const result = analyse(design);
    assert.equal(result.whole.radiusM, null, 'a substrate with no Poisson\'s ratio has no radius');
    assert.equal(result.whole.deflectionUm, null, 'and no centre deflection');
    assert.deepEqual(result.rows.map(row => row.shearMPa), [null, null, null, null],
        'and every edge shear, which needs the substrate\'s ratio as it needs the films\', is blank');
    assert.ok(result.rows.every(row => row.stressMPa != null && row.strainEnergy != null),
        'while the films keep their stresses and strain energies');
    assert.deepEqual(result.missing, [{ materialId: 'user_m:Sub', name: 'TFS Stress Sub', fields: ['poissonsRatio'] }],
        'and the notice names the ratio the substrate lacks');
}

// ── Which coatings count ─────────────────────────────────────────────────────

{
    const back = [{ id: 'B1', material: 'user_m:H', thickness: 300 }];
    const frontOnly = analyse(validationDesign({ backLayers: back }));
    assert.equal(frontOnly.rows.length, 4, 'with the other side ignored, the back coating is out');
    assert.ok(!frontOnly.bothSides);

    const total = analyse(validationDesign({ backLayers: back, mfEvalMode: 'total' }));
    assert.equal(total.rows.length, 5, 'in total mode both coatings are listed');
    assert.ok(total.bothSides, 'and the table earns its side column');
    assert.deepEqual(filmColumns({ colSide: 'Side' }, true)[0].key, 'sideLabel');
    assert.ok(Math.abs(total.whole.forceNm) < Math.abs(frontOnly.whole.forceNm),
        'the back coating pulls the other way, so it takes the bow down');
}

{
    const front = validationDesign().frontLayers;
    const design = validationDesign({
        surfaceMode: 'symmetric',
        backLayers: [...front].reverse().map(layer => ({ ...layer, id: 'B' + layer.id.slice(1) })),
    });
    const result = analyse(design);
    assert.equal(result.whole.forceNm, 0, 'a mirrored coating bends the substrate not at all');
    assert.equal(result.whole.radiusM, null, 'so a flat part has no radius');
    assert.equal(result.whole.deflectionUm, 0, 'and deflects by zero, which is a value rather than a blank');
    assert.ok(result.bothSides, 'both coatings are still listed');
    const single = analyse(validationDesign());
    close(result.whole.strainEnergy, (single.whole.strainEnergy * 2).toPrecision(6),
        'while the strain energy doubles, because energy does not cancel');
}

{
    // The mirrored design on a substrate of no stated diameter, as a new design
    // has. The deflection row is blank, so the badge line saying the coatings
    // pull equally names no deflection, in any language.
    const design = validationDesign({
        substrate: { material: 'user_m:Sub', thickness: 15 },
        surfaceMode: 'symmetric',
        backLayers: validationBack(),
    });
    const result = analyse(design);
    assert.equal(result.whole.forceNm, 0, 'a mirrored coating bends the substrate not at all');
    assert.equal(result.whole.deflectionUm, null, 'and with no diameter the deflection is blank');
    const DEFLECTION = { en: 'deflection', ru: 'прогиб', zh: '挠度', it: 'freccia' };
    for (const [language, t] of Object.entries(localeSources)) {
        const line = t.stressAnalysis.noticeBalanced;
        assert.ok(t.stressAnalysis.deflection.toLowerCase().includes(DEFLECTION[language]),
            `${language}: the word checked is the one the deflection row uses: ${t.stressAnalysis.deflection}`);
        assert.ok(stressNotices(result, t).some(notice => notice.label === line),
            `${language}: the badge says the coatings pull equally`);
        assert.ok(!line.toLowerCase().includes(DEFLECTION[language]),
            `${language}: and does not name the deflection, which the window shows blank: ${line}`);
    }
}

// ── A coating on one face alone reads the same on either face ────────────────
//
// The validation films moved to the back: on a back-only design, and on a
// two-sided design with its front bare scored on the whole part. The force,
// the radius and the deflection refer to the coated face, so each reads as the
// films do on the front, and Macleod's table holds on the back too.

{
    const front = analyse(validationDesign());
    const cases = {
        'back only': validationDesign({
            surfaceMode: 'back_only', frontLayers: [], backLayers: validationBack(),
        }),
        'both faces, the front bare': validationDesign({
            surfaceMode: 'both_independent', frontLayers: [], backLayers: validationBack(),
        }),
    };
    for (const [label, design] of Object.entries(cases)) {
        const result = analyse(design);
        assert.deepEqual(result.rows.map(row => row.side), ['back', 'back', 'back', 'back'],
            `${label}: the four films are on the back`);
        assert.deepEqual(result.rows.map(({ side, ...row }) => row), front.rows.map(({ side, ...row }) => row),
            `${label}: each film reads as it does on the front`);
        assert.deepEqual(result.whole, front.whole, `${label}: and so does the whole part`);
        close(result.whole.forceNm, '-3657.6', `${label}: a compressive coating gives a negative force`);
        close(result.whole.radiusM, '1050', `${label}: and a positive radius on its own face`);
        close(result.whole.deflectionUm, '0.129', `${label}: and a positive centre deflection`);
        const ctx = buildEvalContext(design, designMaterialLookup(design));
        close(stressForceNm(ctx), result.whole.forceNm.toPrecision(6),
            `${label}: the STR row reads the same force as the window`);
    }
}

// ── A face whose layers are all 0 nm is bare ─────────────────────────────────
//
// The validation films on the back of a two-sided design scored on the whole
// part, its front bare, holding one 0 nm layer, and holding one 1 nm layer.
// Only a layer thicker than 0 nm coats a face, so a 0 nm layer, which changes
// no spectrum, changes no stress either, and the Design Cleaner taking it out
// changes nothing. A 1 nm layer coats the front, which then is the reference.
// Each number is checked to half of the last place given.

{
    const asGiven = (actual, given, message) => {
        const decimals = (given.split('.')[1] || '').length;
        const tolerance = 0.5 * 10 ** -decimals;
        assert.ok(Math.abs(actual - Number(given)) <= tolerance,
            `${message}: ${actual} is not within ${tolerance} of ${given}`);
    };
    const front = thickness => [{ id: 'F1', material: 'user_m:L', thickness }];
    const table = [
        ['bare', [], '-3657.6', '1051.5', '0.1295'],
        ['one 0 nm layer', front(0), '-3657.6', '1051.5', '0.1295'],
        ['one 1 nm layer', front(1), '3656.7', '-1051.8', '-0.1294'],
    ];
    const wholes = {};
    for (const [label, frontLayers, force, radius, deflection] of table) {
        const design = validationDesign({
            surfaceMode: 'both_independent', frontLayers, backLayers: validationBack(),
        });
        const { whole } = analyse(design);
        asGiven(whole.forceNm, force, `front ${label}: the force`);
        asGiven(whole.radiusM, radius, `front ${label}: the radius, m`);
        asGiven(whole.deflectionUm, deflection, `front ${label}: the deflection, µm`);
        const ctx = buildEvalContext(design, designMaterialLookup(design));
        asGiven(stressForceNm(ctx), force, `front ${label}: the STR row`);
        wholes[label] = whole;
    }
    assert.deepEqual(wholes['one 0 nm layer'], wholes.bare,
        'a front holding only a 0 nm layer reads exactly as the bare front');
}

// ── What the tables print ────────────────────────────────────────────────────

{
    const sa = {
        filmForce: 'Film force', radius: 'Radius', deflection: 'Deflection',
        totalStrainEnergy: 'Total strain energy', crackingParameter: 'Cracking parameter',
    };
    const design = validationDesign({ substrate: { material: 'user_m:Sub', thickness: 15 } });
    const rows = wholeRows(analyse(design).whole, sa, { newtonPerM: 'N/m', m: 'm', um: 'µm', jPerM2: 'J/m²' });
    assert.equal(rows.length, 5, 'five whole-part rows');
    assert.equal(rows.find(row => row.quantity === 'Deflection').display, '—',
        'a quantity the design cannot support prints a dash, never a zero');
    assert.ok(/^-?\d/.test(rows.find(row => row.quantity === 'Film force').display),
        'and one it can prints a number');
}

// ── What Copy CSV writes ─────────────────────────────────────────────────────
//
// The per-film table in every language, on one face and with both counted: a
// spreadsheet reads as many fields in the heading as in each row, so every
// value sits under its own heading.

{
    const designs = {
        'one face': validationDesign(),
        'both faces': validationDesign({
            backLayers: [{ id: 'B1', material: 'user_m:H', thickness: 300 }], mfEvalMode: 'total',
        }),
    };
    for (const [language, t] of Object.entries(localeSources)) {
        const sa = t.stressAnalysis;
        for (const [label, design] of Object.entries(designs)) {
            const result = analyse(design);
            const columns = filmColumns(sa, result.bothSides);
            const [heading, ...lines] = csvFromRows(columns, filmRows(result.rows, sa)).split('\n');
            const fields = line => line.split(',').length;
            assert.equal(fields(heading), columns.length,
                `${language}, ${label}: the heading has one field per column: ${heading}`);
            assert.ok(lines.length > 0 && lines.every(line => fields(line) === columns.length),
                `${language}, ${label}: and so has each row`);
        }
    }
}

console.log('stress_window: ok');
