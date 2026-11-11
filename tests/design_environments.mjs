/**
 * A design's environments: how each environment reads the design, the edits,
 * and how a .tfs file holds them.
 *
 *   - a design without environments has one, and computes as the design;
 *   - another environment replaces the media and the substrate fields it sets,
 *     scales the layers of a material by its factor and swaps a material;
 *   - the edits refuse what environment 1 cannot set, give fields back on
 *     null, and removing an environment removes its rows; with one left the
 *     design no longer lists environments;
 *   - a row scored in environment 2 or later is written switched off with its
 *     own switch beside it, and read back as it was; nothing is added to a
 *     design without environments, on save or on load;
 *   - a malformed environments list is refused when the file is read; no
 *     list or an empty one is a design with one environment;
 *   - the materials another environment names count as the design's, so a
 *     save embeds them and Replace Materials lists and replaces them, while a
 *     window computing environment 1 does not check their range.
 *
 * Run: node tests/design_environments.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import designFile from '../src/main/designFile.js';
import {
    BASE_ENVIRONMENT, environmentDesign, environmentsOf, hasEnvironments, isEnvironmentOn, rowsInEnvironment,
} from '../src/utils/environments/environments.js';
import { addEnvironment, removeEnvironment, setEnvironment } from '../src/utils/environments/environmentEdits.js';
import {
    computedMaterialIds, designMaterialIds, embedDesignMaterials, unresolvedMaterials,
} from '../src/utils/materials/designMaterials.js';
import { copyDesignWithFreshIds } from '../src/utils/io/designFiles.js';
import { shimBrowserGlobals } from './_uiShim.mjs';

const { readDesignFile, serializeDesign, validateDesign } = designFile;

const plain = () => ({
    id: 'design-1', name: 'Window AR',
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1, diameterMm: 25 },
    surfaceMode: 'front_only',
    frontLayers: [
        { id: 'l1', material: 'MgF2', thickness: 100 },
        { id: 'l2', material: 'builtin:Ta2O5', thickness: 60, locked: true },
        { id: 'l3', material: 'builtin:SiO2', thickness: 90 },
    ],
    backLayers: [],
    meritOperands: [
        { id: 'r1', type: 'RAV', enabled: true, lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 },
    ],
});

// ── One environment: the design itself ───────────────────────────────────────

{
    const design = plain();
    assert.deepEqual(environmentsOf(design).map(env => env.id), [BASE_ENVIRONMENT], 'a design without the key has environment 1 alone');
    assert.equal(hasEnvironments(design), false);
    assert.equal(environmentDesign(design), design, 'environment 1 computes the design object itself');
    assert.equal(environmentDesign(design, BASE_ENVIRONMENT), design);
    assert.throws(() => environmentDesign(design, 'env2'), /no environment env2/);
    assert.deepEqual(rowsInEnvironment(design, BASE_ENVIRONMENT).map(op => op.id), ['r1']);
}

// ── Another environment's view of the design ─────────────────────────────────

{
    let design = addEnvironment(plain(), {
        name: 'Under water', incidentMedium: 'builtin:H2O',
        substrate: { material: 'builtin:Al2O3' },
        thicknessFactors: { 'builtin:MgF2': 0.9, Ta2O5: 0.95 },
        materialSwaps: { SiO2: 'builtin:MgF2' },
    });
    assert.deepEqual(environmentsOf(design).map(env => env.id), ['base', 'env2'], 'environment 1 is listed first, then the new one');
    assert.equal(hasEnvironments(design), true);
    const water = environmentDesign(design, 'env2');
    assert.equal(water.incidentMedium, 'builtin:H2O');
    assert.equal(water.exitMedium, 'Air', 'a field the environment does not set follows environment 1');
    assert.deepEqual(water.substrate, { material: 'builtin:Al2O3', thickness: 1, diameterMm: 25 },
        'the substrate fields it sets replace those of environment 1, the rest stay');
    assert.deepEqual(water.frontLayers.map(layer => [layer.material, layer.thickness]), [
        ['MgF2', 90],
        ['builtin:Ta2O5', 57],
        ['builtin:MgF2', 90],
    ], 'a factor written under either form of a built-in id scales its layers, locked ones too; a swap replaces the material');
    assert.equal(design.frontLayers[0].thickness, 100, 'the design itself is unchanged');
    assert.equal(environmentDesign(design, BASE_ENVIRONMENT), design);

    design = { ...design, meritOperands: [...design.meritOperands, { id: 'r2', type: 'TAV', enabled: true, env: 'env2' }] };
    assert.deepEqual(rowsInEnvironment(design, 'env2').map(op => op.id), ['r1', 'r2'], 'environment 2 scores its own rows and the shared ones');
    assert.deepEqual(rowsInEnvironment(design, BASE_ENVIRONMENT).map(op => op.id), ['r1']);
}

// ── Edits ────────────────────────────────────────────────────────────────────

{
    let design = addEnvironment(plain(), { name: 'Sapphire', substrate: { material: 'builtin:Al2O3', thickness: 2 } });
    design = addEnvironment(design, { name: 'Dome edge', thicknessFactors: { 'builtin:MgF2': 0.95 } });
    assert.deepEqual(environmentsOf(design).map(env => env.id), ['base', 'env2', 'env3']);

    assert.throws(() => setEnvironment(design, BASE_ENVIRONMENT, { incidentMedium: 'builtin:H2O' }), /design's own fields/,
        "environment 1's media are the design's own fields");
    assert.throws(() => addEnvironment(design, { cone: 5 }), /no field cone/);
    assert.throws(() => setEnvironment(design, 'env9', { name: 'x' }), /no environment env9/);

    design = setEnvironment(design, BASE_ENVIRONMENT, { name: 'BK7', enabled: false });
    assert.deepEqual(environmentsOf(design)[0], { id: 'base', name: 'BK7', enabled: false });
    assert.equal(isEnvironmentOn(environmentsOf(design)[0]), false);
    design = setEnvironment(design, BASE_ENVIRONMENT, { enabled: true });
    assert.deepEqual(environmentsOf(design)[0], { id: 'base', name: 'BK7' }, 'switched on again, the switch is not written');

    design = setEnvironment(design, 'env2', { substrate: { thickness: null }, incidentMedium: 'builtin:H2O' });
    assert.deepEqual(environmentsOf(design)[1], {
        id: 'env2', name: 'Sapphire', substrate: { material: 'builtin:Al2O3' }, incidentMedium: 'builtin:H2O',
    }, 'null gives one substrate field back to environment 1');
    design = setEnvironment(design, 'env2', { substrate: { material: null }, incidentMedium: null });
    assert.deepEqual(environmentsOf(design)[1], { id: 'env2', name: 'Sapphire' }, 'an emptied substrate goes too');
    design = setEnvironment(design, 'env3', { thicknessFactors: { 'builtin:MgF2': null } });
    assert.deepEqual(environmentsOf(design)[2], { id: 'env3', name: 'Dome edge' });

    // Rows: one per environment, a shared one, and a math row reading env3's row.
    design = {
        ...design,
        meritOperands: [
            { id: 'r1', type: 'RAV', enabled: true },
            { id: 'r2', type: 'RAV', enabled: true, env: 'base' },
            { id: 'r3', type: 'RAV', enabled: true, env: 'env2' },
            { id: 'r4', type: 'RAV', enabled: true, env: 'env3' },
            { id: 'r5', type: 'OPGT', enabled: true, refId: 'r4' },
        ],
    };
    assert.throws(() => removeEnvironment(design, BASE_ENVIRONMENT), /cannot be removed/);
    const two = removeEnvironment(design, 'env3');
    assert.deepEqual(environmentsOf(two).map(env => env.id), ['base', 'env2']);
    assert.deepEqual(two.meritOperands.map(op => op.id), ['r1', 'r2', 'r3'], "its rows go, and the rows that read them");
    const one = removeEnvironment(two, 'env2');
    assert.equal('environments' in one, false, 'with one environment left the design lists none');
    assert.deepEqual(one.meritOperands, [{ id: 'r1', type: 'RAV', enabled: true }, { id: 'r2', type: 'RAV', enabled: true }],
        'and no row names an environment');
    assert.equal(design.environments.length, 3, 'the design the edits started from is unchanged');
}

// ── The file ─────────────────────────────────────────────────────────────────

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-environments-'));
const roundTrip = (design, name) => {
    const file = path.join(tmp, `${name}.tfs`);
    fs.writeFileSync(file, serializeDesign(design));
    return { written: JSON.parse(fs.readFileSync(file, 'utf8')), read: readDesignFile(fs, file) };
};

try {
    {
        const design = plain();
        const { written, read } = roundTrip(design, 'plain');
        assert.equal(written.tfs_version, '1.3');
        assert.deepEqual(Object.keys(written).filter(key => key !== 'tfs_version'), Object.keys(design),
            'a design with one environment is written with no new key');
        assert.deepEqual(read.design, design, 'and read back with none added');
    }

    {
        let design = addEnvironment(plain(), { name: 'Sapphire', substrate: { material: 'builtin:Al2O3' } });
        design = {
            ...design,
            meritOperands: [
                { id: 'r1', type: 'RAV', enabled: true },
                { id: 'r2', type: 'RAV', enabled: true, env: 'base' },
                { id: 'r3', type: 'RAV', enabled: true, env: 'env2' },
                { id: 'r4', type: 'RAV', enabled: false, env: 'env2' },
            ],
        };
        const { written, read } = roundTrip(design, 'two');
        assert.deepEqual(written.meritOperands.map(op => [op.id, op.enabled, op.envEnabled]), [
            ['r1', true, undefined],
            ['r2', true, undefined],
            ['r3', false, true],
            ['r4', false, false],
        ], "rows of environment 2 are written switched off, their own switch beside them; others as they are");
        assert.deepEqual(written.environments, design.environments);
        assert.deepEqual(read.design, design, 'read back, every row has its own switch again');
        assert.equal(design.meritOperands[2].enabled, true, 'writing does not change the design in memory');
    }

    {
        const refused = environments => validateDesign({ ...plain(), environments });
        assert.equal(refused(undefined), null);
        assert.equal(refused([{ id: 'base' }, { id: 'env2', name: 'x' }]), null);
        for (const bad of [{}, 'base', [{ id: 'env2' }], [{ id: 'base' }, { id: 'base' }], [{ id: 'base' }, 'env2'], [{ id: 'base' }, { id: 7 }]]) {
            assert.match(refused(bad), /environments are not a list of environments/, `refused: ${JSON.stringify(bad)}`);
        }
    }
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

// ── Materials another environment names ──────────────────────────────────────

{
    const record = { id: 'Sapphire', name: 'Sapphire (lab)', formulaNum: -1, tabData: [[400, 1.78, 0], [800, 1.76, 0]] };
    const design = addEnvironment({ ...plain(), materials: { 'user_lab:Sapphire': record } }, {
        name: 'Sapphire', substrate: { material: 'user_lab:Sapphire' }, materialSwaps: { 'builtin:SiO2': 'builtin:Al2O3' },
    });
    assert.ok(designMaterialIds(design).includes('user_lab:Sapphire') && designMaterialIds(design).includes('builtin:Al2O3'),
        "the design's materials include those another environment names");
    assert.ok(!computedMaterialIds(design).includes('user_lab:Sapphire'), 'environment 1 does not compute with them');
    assert.ok(computedMaterialIds(environmentDesign(design, 'env2')).includes('user_lab:Sapphire'), 'environment 2 does');
    assert.deepEqual(Object.keys(embedDesignMaterials(design).materials), ['user_lab:Sapphire'],
        'a save keeps the copy of a material only another environment names');
}

// ── A factor or a swap set under either spelling of a built-in id ────────────

{
    let design = addEnvironment(plain(), { name: 'Edge', thicknessFactors: { MgF2: 0.9 } });
    assert.equal(Object.isFrozen(design.environments[0]), false, 'the environment 1 entry a design gains is its own object');
    design = setEnvironment(design, 'env2', { thicknessFactors: { 'builtin:MgF2': 0.8 } });
    assert.deepEqual(design.environments[1].thicknessFactors, { 'builtin:MgF2': 0.8 }, 'one material, one factor');
    design = setEnvironment(design, 'env2', { thicknessFactors: { MgF2: null } });
    assert.equal('thicknessFactors' in design.environments[1], false, 'null under the other spelling removes it');
}

// ── A row that reads a row of another environment ────────────────────────────

{
    const tmpRead = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-environments-'));
    try {
        const design = {
            ...addEnvironment(plain(), { name: 'Sapphire', substrate: { material: 'builtin:Al2O3' } }),
            meritOperands: [
                { id: 'r1', type: 'RAV', enabled: true },
                { id: 'r2', type: 'RAV', enabled: true, env: 'env2' },
                { id: 'r3', type: 'OPGT', enabled: true, refId: 'r2' },
                { id: 'r4', type: 'DIFF', enabled: true, refId1: 'r1', refId2: 'r3' },
                { id: 'r5', type: 'OPGT', enabled: true, refId: 'r1' },
                { type: 'BLNK', enabled: true },
            ],
        };
        const file = path.join(tmpRead, 'reads.tfs');
        fs.writeFileSync(file, serializeDesign(design));
        const written = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepEqual(written.meritOperands.map(op => [op.enabled, op.envEnabled]), [
            [true, undefined], [false, true], [false, true], [false, true], [true, undefined], [true, undefined],
        ], 'a row reading a row of environment 2, directly or through another row, is written switched off too');
        assert.deepEqual(readDesignFile(fs, file).design, design, 'and read back as it was');
    } finally {
        fs.rmSync(tmpRead, { recursive: true, force: true });
    }
}

// ── No list, or an empty one, is one environment ─────────────────────────────

{
    for (const environments of [null, []]) {
        const design = { ...plain(), environments };
        assert.equal(validateDesign(design), null, `${JSON.stringify(environments)} opens`);
        assert.deepEqual(environmentsOf(design).map(env => env.id), ['base']);
        assert.deepEqual(environmentsOf(addEnvironment(design, { name: 'x' })).map(env => env.id), ['base', 'env2']);
    }
}

// ── Replace Materials reaches the other environments ─────────────────────────
//
// A material only environment 2 names, missing on this machine, holds up the
// design's calculations as any missing material does, so the dialog that
// repairs missing materials has to list it and replace it.

{
    shimBrowserGlobals();
    const { collectMaterials, replaceMaterialReferences } = await import('../src/components/dialogs/ReplaceMaterialsDialog.js');
    const design = addEnvironment(plain(), {
        name: 'Lab sapphire', substrate: { material: 'user_gone:Sapphire' },
        thicknessFactors: { 'builtin:SiO2': 0.95 }, materialSwaps: { 'builtin:Ta2O5': 'builtin:Nb2O5' },
    });
    assert.deepEqual(unresolvedMaterials(design), ['user_gone:Sapphire'], 'it is reported missing');
    assert.ok(collectMaterials(design).some(entry => entry.id === 'user_gone:Sapphire'), 'Replace Materials lists it');
    const repaired = replaceMaterialReferences(design, {
        'user_gone:Sapphire': 'builtin:Al2O3', 'builtin:SiO2': 'builtin:MgF2', 'builtin:Ta2O5': 'builtin:Nb2O5',
    });
    assert.deepEqual(unresolvedMaterials(repaired), [], 'and replacing it repairs the design');
    assert.deepEqual(repaired.environments[1], {
        id: 'env2', name: 'Lab sapphire', substrate: { material: 'builtin:Al2O3' }, thicknessFactors: { 'builtin:MgF2': 0.95 },
    }, "a factor follows its layers' new material; a swap left naming the material it replaces goes");
    assert.deepEqual(repaired.frontLayers.map(layer => layer.material), ['MgF2', 'builtin:Nb2O5', 'builtin:MgF2']);
}

// ── A copy keeps the environments ────────────────────────────────────────────

{
    const design = { ...addEnvironment(plain(), { name: 'Water', incidentMedium: 'builtin:H2O' }) };
    design.meritOperands = [...design.meritOperands, { id: 'r2', type: 'TAV', enabled: true, env: 'env2' }];
    const copy = copyDesignWithFreshIds(design, 'Window AR (copy)');
    assert.deepEqual(copy.environments, design.environments, 'Duplicate and Save As copy the environments');
    assert.deepEqual(copy.meritOperands, design.meritOperands, 'and the rows with their environments');
}

console.log('design_environments: passed');
