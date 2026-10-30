/**
 * The Stress window's model.
 *
 * The physics is checked in `tests/stress_model.mjs` against the papers and in
 * `tests/stress_analysis.mjs` against Essential Macleod's own table. What is
 * checked here is the assembly: that a TFStudio design, with its constants on
 * its materials and its temperatures on the design, reproduces that same table
 * through the window, and that everything the window refuses to guess stays
 * blank with a reason attached.
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
import { buildEvalContext, resolveEvalMode } from '../src/utils/physics/optimizer.js';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';
import { stressForceNm } from '../src/utils/physics/stress/stackForce.js';
import { computeStress } from '../src/components/windows/analysis/stressAnalysis/model.js';
import { filmColumns, wholeRows } from '../src/components/windows/analysis/stressAnalysis/tableModel.js';
import { MATERIALS, OPTICS, validationBack, validationDesign } from './_stressValidation.mjs';

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

// ── Nothing is substituted ───────────────────────────────────────────────────

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

console.log('stress_window: ok');
