/**
 * The headless API's environment calls (src/api/designEnvironments.js):
 *
 *   1. environments() lists environment 1 alone for a design without
 *      environments, and for one with two more each environment's own fields
 *      or environment 1's, its own factors and swaps, and what it follows.
 *   2. addEnvironment stores the options in the module's shape, substrate
 *      and substrateThicknessMm in its substrate; an option given as
 *      undefined is no option and one given as null follows environment 1.
 *   3. setEnvironment takes an environment by number or id; null gives a
 *      field back to environment 1, a material given null inside a map gives
 *      its factor or swap back and the materials left out keep theirs, and
 *      environment 1 takes a name and a switch.
 *   4. removeEnvironment takes the environment's rows and the rows that read
 *      them with it, and the last one gone leaves a design without
 *      environments.
 *   5. Every name and value they cannot use is refused with the code and
 *      fields an object layer words it from; a material that resolves to
 *      nothing is refused unless it is given null.
 *   6. A design saved with saveDesign and read with openDesign keeps its
 *      environments.
 *   7. designDifferences compares the environments.
 *   8. setMerit takes `env` by number or id and holds the id, and refuses it
 *      on a design with one environment and for an environment the design
 *      does not have; merit gives each environment's merit, the total their
 *      root mean square, and each row's env and values; refine scores every
 *      environment.
 *   9. A synthesis run fits environment 1, so an MNT row of environment 2
 *      sets no thickness floor for it.
 *
 * Run: node tests/api_environments.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const api = await import('../src/api/index.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const thrown = fn => { try { fn(); return null; } catch (err) { return err; } };
const same = (a, b) => isDeepStrictEqual(a, b);

await api.init();
const plain = () => api.stackFromFormula(api.newDesign({ name: 'Window AR', substrateThicknessMm: 2 }), { formula: '(HL)^2' });
const BASE_ENTRY = {
    number: 1, id: 'base', name: null, enabled: true, incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 2 }, thicknessFactors: {}, materialSwaps: {}, follows: [],
};

// ── 1. The list ────────────────────────────────────────────────────────────
{
    const design = plain();
    ok('a design without environments lists environment 1, the design\'s own fields', same(api.environments(design), [BASE_ENTRY]),
        JSON.stringify(api.environments(design)));

    let three = api.addEnvironment(design, { name: 'Under water', incidentMedium: 'H2O', substrateThicknessMm: 3, thicknessFactors: { TiO2: 0.95 } });
    three = api.addEnvironment(three, { name: 'Sapphire', enabled: false, exitMedium: 'SiO2', substrate: 'Al2O3', materialSwaps: { 'builtin:SiO2': 'MgF2' } });
    const listed = api.environments(three);
    ok('each environment lists its own fields or environment 1\'s, its own factors and swaps, and the options it follows', same(listed, [
        BASE_ENTRY,
        {
            number: 2, id: 'env2', name: 'Under water', enabled: true, incidentMedium: 'H2O', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 3 }, thicknessFactors: { TiO2: 0.95 }, materialSwaps: {}, follows: ['exitMedium', 'substrate'],
        },
        {
            number: 3, id: 'env3', name: 'Sapphire', enabled: false, incidentMedium: 'Air', exitMedium: 'SiO2',
            substrate: { material: 'Al2O3', thickness: 2 }, thicknessFactors: {}, materialSwaps: { 'builtin:SiO2': 'MgF2' }, follows: ['incidentMedium', 'substrateThicknessMm'],
        },
    ]), JSON.stringify(listed));
    listed[1].thicknessFactors.TiO2 = 2;
    ok('the maps it lists are copies', api.environments(three)[1].thicknessFactors.TiO2 === 0.95 && three.environments[1].thicknessFactors.TiO2 === 0.95);
    const moved = api.setDesignSetup(three, { incidentMedium: 'MgF2', substrateThicknessMm: 5 });
    ok('an environment that follows environment 1 lists environment 1\'s fields as they are now',
        same([api.environments(moved)[1].incidentMedium, api.environments(moved)[1].substrate.thickness, api.environments(moved)[2].incidentMedium, api.environments(moved)[2].substrate.thickness],
            ['H2O', 3, 'MgF2', 5]));
}

// ── 2. addEnvironment ──────────────────────────────────────────────────────
{
    const design = plain();
    const added = api.addEnvironment(design, {
        name: 'Edge', incidentMedium: 'H2O', exitMedium: 'BK7', substrate: 'SiO2', substrateThicknessMm: 4,
        thicknessFactors: { TiO2: 0.9, 'builtin:SiO2': 0.95 }, materialSwaps: { TiO2: 'Ta2O5' },
    });
    ok('the options are stored in the environment\'s shape, the substrate options in its substrate', same(added.environments, [
        { id: 'base' },
        {
            id: 'env2', name: 'Edge', incidentMedium: 'H2O', exitMedium: 'BK7', substrate: { material: 'SiO2', thickness: 4 },
            thicknessFactors: { TiO2: 0.9, 'builtin:SiO2': 0.95 }, materialSwaps: { TiO2: 'Ta2O5' },
        },
    ]), JSON.stringify(added.environments));
    ok('and the design given is left as it was', !('environments' in design));
    ok('the substrate thickness alone goes in the substrate alone', same(api.addEnvironment(design, { substrateThicknessMm: 6 }).environments[1], { id: 'env2', substrate: { thickness: 6 } }));
    ok('options given as undefined are no options, and null and a switch left on follow environment 1',
        same(api.addEnvironment(design, { name: undefined, incidentMedium: null, substrate: null, enabled: true, thicknessFactors: { TiO2: null } }).environments[1], { id: 'env2' })
        && same(api.addEnvironment(design).environments[1], { id: 'env2' }));
    ok('a switch written off is stored', same(api.addEnvironment(design, { enabled: false }).environments[1], { id: 'env2', enabled: false }));
}

// ── 3. setEnvironment ──────────────────────────────────────────────────────
{
    let design = api.addEnvironment(plain(), {
        name: 'Under water', incidentMedium: 'H2O', substrate: 'Al2O3', substrateThicknessMm: 3,
        thicknessFactors: { TiO2: 0.9, SiO2: 0.95 }, materialSwaps: { TiO2: 'Ta2O5', SiO2: 'MgF2' },
    });
    const byNumber = api.setEnvironment(design, 2, { exitMedium: 'BK7' });
    ok('an environment is taken by its number or its id', same(byNumber, api.setEnvironment(design, 'env2', { exitMedium: 'BK7' }))
        && byNumber.environments[1].exitMedium === 'BK7');

    design = api.setEnvironment(design, 2, { incidentMedium: null, substrate: null });
    ok('null gives a field back to environment 1, the substrate material apart from its thickness', same(design.environments[1], {
        id: 'env2', name: 'Under water', substrate: { thickness: 3 }, thicknessFactors: { TiO2: 0.9, SiO2: 0.95 }, materialSwaps: { TiO2: 'Ta2O5', SiO2: 'MgF2' },
    }) && same(api.environments(design)[1].follows, ['incidentMedium', 'exitMedium', 'substrate']), JSON.stringify(design.environments[1]));

    design = api.setEnvironment(design, 'env2', { thicknessFactors: { TiO2: null, MgF2: 1.1 }, materialSwaps: { 'builtin:SiO2': null } });
    ok('a material given null inside a map gives it back, under either form of its id, and the materials left out keep theirs',
        same(design.environments[1].thicknessFactors, { SiO2: 0.95, MgF2: 1.1 }) && same(design.environments[1].materialSwaps, { TiO2: 'Ta2O5' }),
        JSON.stringify(design.environments[1]));

    design = api.setEnvironment(design, 2, { substrateThicknessMm: null, thicknessFactors: null, name: null });
    ok('null on a map drops it whole, and null on the name clears it', same(design.environments[1], { id: 'env2', materialSwaps: { TiO2: 'Ta2O5' } }),
        JSON.stringify(design.environments[1]));

    design = api.setEnvironment(design, 1, { name: 'In air', enabled: false });
    ok('environment 1 takes a name and a switch', same(design.environments[0], { id: 'base', name: 'In air', enabled: false })
        && same(api.environments(design)[0], { ...BASE_ENTRY, name: 'In air', enabled: false }));
    design = api.setEnvironment(design, 'base', { enabled: true, incidentMedium: undefined });
    ok('switched on again it is not written, and an option given as undefined is no option', same(design.environments[0], { id: 'base', name: 'In air' }));

    const gone = api.addEnvironment({ ...plain(), materials: {} }, { thicknessFactors: { TiO2: 0.9 } });
    const kept = { ...gone, environments: [gone.environments[0], { ...gone.environments[1], thicknessFactors: { 'user_gone:Film': 0.9 } }] };
    ok('a material that resolves to nothing can still be given null to take it out',
        same(api.setEnvironment(kept, 2, { thicknessFactors: { 'user_gone:Film': null } }).environments[1], { id: 'env2' }));
}

// ── 4. removeEnvironment ───────────────────────────────────────────────────
{
    let design = api.addEnvironment(plain(), { name: 'Under water', incidentMedium: 'H2O' });
    design = api.addEnvironment(design, { name: 'Sapphire', substrate: 'Al2O3' });
    design = {
        ...design,
        meritOperands: [
            { id: 'r1', type: 'RAV', enabled: true },
            { id: 'r2', type: 'RAV', enabled: true, env: 'env2' },
            { id: 'r3', type: 'RAV', enabled: true, env: 'env3' },
            { id: 'r4', type: 'OPGT', enabled: true, refId: 'r2' },
        ],
    };
    const two = api.removeEnvironment(design, 2);
    ok('removing an environment takes its rows and the rows that read them with it, and the later ones move down',
        same(two.meritOperands.map(op => op.id), ['r1', 'r3']) && same(api.environments(two).map(env => [env.number, env.id, env.name]), [[1, 'base', null], [2, 'env3', 'Sapphire']]),
        JSON.stringify(two.meritOperands));
    ok('by its id as by its number', same(api.removeEnvironment(design, 'env2'), two));
    const one = api.removeEnvironment(two, 'env3');
    ok('with the last one gone the design lists no environments, and no row names one',
        !('environments' in one) && same(one.meritOperands, [{ id: 'r1', type: 'RAV', enabled: true }]) && same(api.environments(one), [BASE_ENTRY]),
        JSON.stringify(one));
}

// ── 5. Refusals ────────────────────────────────────────────────────────────
{
    const design = api.addEnvironment(plain(), { name: 'Under water', incidentMedium: 'H2O' });
    const FOLLOW = 'or null to follow environment 1';
    const MAP = what => `a map of material id to ${what}, or to null to follow environment 1; or null for none`;
    const ENVIRONMENT = 'environment is one of the design\'s environments by its number, 1 to 2, or its id, base or env2';
    const cases = [
        [() => api.addEnvironment(design, { colour: 'red' }), 'unknownOption', { call: 'addEnvironment', option: 'colour' }, /^addEnvironment: unknown option 'colour'; the options are name, enabled, incidentMedium, exitMedium, substrate, substrateThicknessMm, thicknessFactors, materialSwaps$/],
        [() => api.setEnvironment(design, 2, { substrateThickness: 3 }), 'unknownOption', { call: 'setEnvironment', option: 'substrateThickness' }, /^setEnvironment: unknown option 'substrateThickness'/],
        [() => api.addEnvironment(design, { name: '' }), 'badValue', { option: 'name', value: '', takes: 'a name, or null for none' }, /^addEnvironment: name is a name, or null for none, not ""$/],
        [() => api.setEnvironment(design, 2, { name: 7 }), 'badValue', { option: 'name', value: 7 }, /^setEnvironment: name is a name, or null for none, not 7$/],
        [() => api.addEnvironment(design, { enabled: 'yes' }), 'badValue', { option: 'enabled', value: 'yes', takes: 'true or false' }, /^addEnvironment: enabled is true or false, not "yes"$/],
        [() => api.setEnvironment(design, 1, { enabled: null }), 'badValue', { option: 'enabled', value: null }, /enabled is true or false, not null$/],
        [() => api.addEnvironment(design, { incidentMedium: 5 }), 'badValue', { option: 'incidentMedium', value: 5, takes: `a material id, ${FOLLOW}` }, /^addEnvironment: incidentMedium is a material id, or null to follow environment 1, not 5$/],
        [() => api.addEnvironment(design, { exitMedium: '' }), 'badValue', { option: 'exitMedium', value: '' }, /exitMedium is a material id/],
        [() => api.addEnvironment(design, { substrate: ['SiO2'] }), 'badValue', { option: 'substrate' }, /substrate is a material id/],
        [() => api.addEnvironment(design, { substrateThicknessMm: 0 }), 'badValue', { option: 'substrateThicknessMm', value: 0, takes: `a thickness in mm above 0, ${FOLLOW}` }, /^addEnvironment: substrateThicknessMm is a thickness in mm above 0, or null to follow environment 1, not 0$/],
        [() => api.setEnvironment(design, 2, { substrateThicknessMm: Infinity }), 'badValue', { option: 'substrateThicknessMm', value: Infinity }, /not Infinity$/],
        [() => api.addEnvironment(design, { thicknessFactors: { TiO2: 0 } }), 'badValue', { option: 'thicknessFactors', value: { TiO2: 0 }, takes: MAP('a factor above 0') }, /^addEnvironment: thicknessFactors is a map of material id to a factor above 0, or to null to follow environment 1; or null for none, not \{"TiO2":0\}$/],
        [() => api.addEnvironment(design, { thicknessFactors: { TiO2: NaN } }), 'badValue', { option: 'thicknessFactors' }, /thicknessFactors is a map/],
        [() => api.addEnvironment(design, { thicknessFactors: [0.9] }), 'badValue', { option: 'thicknessFactors', value: [0.9] }, /thicknessFactors is a map/],
        [() => api.addEnvironment(design, { thicknessFactors: 0.9 }), 'badValue', { option: 'thicknessFactors', value: 0.9 }, /thicknessFactors is a map/],
        [() => api.addEnvironment(design, { materialSwaps: { TiO2: 5 } }), 'badValue', { option: 'materialSwaps', value: { TiO2: 5 }, takes: MAP('the material id that replaces it') }, /^addEnvironment: materialSwaps is a map of material id to the material id that replaces it/],
        [() => api.setEnvironment(design, 5, { name: 'x' }), 'unknownEnvironment', { call: 'setEnvironment', environment: 5, numbers: [1, 2], ids: ['base', 'env2'] }, new RegExp(`^setEnvironment: ${ENVIRONMENT}; not 5$`)],
        [() => api.setEnvironment(design, 0, {}), 'unknownEnvironment', { environment: 0 }, /not 0$/],
        [() => api.setEnvironment(design, 1.5, {}), 'unknownEnvironment', { environment: 1.5 }, /not 1.5$/],
        [() => api.setEnvironment(design, '2', {}), 'unknownEnvironment', { environment: '2' }, /not "2"$/],
        [() => api.removeEnvironment(design, 'env9'), 'unknownEnvironment', { call: 'removeEnvironment', environment: 'env9', numbers: [1, 2], ids: ['base', 'env2'] }, new RegExp(`^removeEnvironment: ${ENVIRONMENT}; not "env9"$`)],
        [() => api.removeEnvironment(design, true), 'unknownEnvironment', { environment: true }, /not true$/],
        [() => api.removeEnvironment(plain(), 2), 'unknownEnvironment', { numbers: [1], ids: ['base'] }, /^removeEnvironment: environment is one of the design's environments by its number, 1, or its id, base; not 2$/],
        [() => api.setEnvironment(design, 1, { incidentMedium: 'H2O' }), 'baseEnvironment', { call: 'setEnvironment', option: 'incidentMedium' }, /^setEnvironment: environment 1 is the design itself and takes name and enabled alone, not incidentMedium; setDesignSetup changes the design's own media and substrate$/],
        [() => api.setEnvironment(design, 'base', { name: 'x', thicknessFactors: {} }), 'baseEnvironment', { option: 'thicknessFactors' }, /not thicknessFactors; setDesignSetup/],
        [() => api.removeEnvironment(design, 1), 'baseEnvironment', { call: 'removeEnvironment' }, /^removeEnvironment: environment 1 is the design itself and cannot be removed$/],
        [() => api.removeEnvironment(design, 'base'), 'baseEnvironment', { call: 'removeEnvironment' }, /cannot be removed$/],
        [() => api.setEnvironment(plain(), 1, { name: 'In air' }), 'oneEnvironment', { call: 'setEnvironment', option: 'name' }, /^setEnvironment: a design with one environment holds no name for it; add another environment first$/],
        [() => api.setEnvironment(plain(), 'base', { enabled: false }), 'oneEnvironment', { option: 'enabled' }, /holds no enabled for it; add another environment first$/],
    ];
    for (const [make, code, fields, pattern] of cases) {
        const err = thrown(make) ?? {};
        const fieldsMatch = Object.entries(fields).every(([key, value]) => isDeepStrictEqual(err.fields?.[key], value));
        ok(`${code} ${JSON.stringify(fields)} is refused with its code and fields`, err.code === code && fieldsMatch && pattern.test(err.message), `${err.code} ${JSON.stringify(err.fields)} ${err.message}`);
    }
    ok('a refused base option says so before any value is checked', thrown(() => api.setEnvironment(design, 1, { substrate: 'Nope' }))?.code === 'baseEnvironment');
    ok('no option on environment 1 of a design with one environment leaves the design as it was',
        api.setEnvironment(plain(), 1, {}) !== undefined && !('environments' in api.setEnvironment(plain(), 1, {})));
    ok('an unknown option is refused before the environment is looked for', thrown(() => api.setEnvironment(design, 9, { colour: 1 }))?.code === 'unknownOption');

    const unknown = make => thrown(make)?.message ?? '';
    const materialRefusals = [
        unknown(() => api.addEnvironment(design, { incidentMedium: 'Unobtainium' })),
        unknown(() => api.setEnvironment(design, 2, { substrate: 'Unobtainium' })),
        unknown(() => api.addEnvironment(design, { thicknessFactors: { Unobtainium: 0.9 } })),
        unknown(() => api.addEnvironment(design, { materialSwaps: { Unobtainium: 'TiO2' } })),
        unknown(() => api.addEnvironment(design, { materialSwaps: { TiO2: 'Unobtainium' } })),
    ];
    ok('a material id that resolves to nothing is refused, a medium, a substrate, a factor\'s, a swap\'s and its target',
        materialRefusals.every(message => /^Unknown material 'Unobtainium'\. Close matches: /.test(message)), materialRefusals.join(' | '));
    ok('and a refusal leaves the design as it was', same(design.environments, [{ id: 'base' }, { id: 'env2', name: 'Under water', incidentMedium: 'H2O' }]));
}

// ── 6. Saved and read again ────────────────────────────────────────────────
{
    const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-api-environments-'));
    try {
        let design = api.addEnvironment(plain(), { name: 'Under water', incidentMedium: 'H2O', thicknessFactors: { TiO2: 0.95 } });
        design = api.addEnvironment(design, { name: 'Sapphire', enabled: false, substrate: 'Al2O3', substrateThicknessMm: 3, materialSwaps: { SiO2: 'MgF2' } });
        design = api.setEnvironment(design, 1, { name: 'In air' });
        const file = path.join(TEMP, 'environments.tfs');
        api.saveDesign(design, file);
        const opened = api.openDesign(file);
        ok('a design saved and opened again keeps its environments', same(opened.environments, design.environments)
            && same(api.environments(opened), api.environments(design)), JSON.stringify(opened.environments));
    } finally {
        fs.rmSync(TEMP, { recursive: true, force: true });
    }
}

// ── 7. designDifferences compares the environments ─────────────────────────
{
    const water = api.addEnvironment(plain(), { name: 'Under water', incidentMedium: 'H2O' });
    const renamed = api.setEnvironment(water, 2, { name: 'Sea water' });
    const glass = api.setDesignSetup(water, { substrate: 'SiO2' });
    const found = [
        api.designDifferences(plain(), water),
        api.designDifferences(water, renamed),
        api.designDifferences(water, glass),
        api.designDifferences(water, structuredClone(water)),
    ];
    ok('a design with another environment differs from one without, by that environment\'s number', found[0].same === false && same(found[0].environments, [2]),
        JSON.stringify(found[0]));
    ok('a renamed environment differs', found[1].same === false && same(found[1].environments, [2]));
    ok('a substrate environment 2 takes from environment 1 is compared once, in the setup', same(found[2].environments, []) && found[2].setup.length === 1);
    ok('and a design is the same as its copy', found[3].same === true && same(found[3].environments, []));
}

// ── 8. Merit rows scored in one environment ────────────────────────────────
{
    const wet = api.addEnvironment(plain(), { name: 'Under water', incidentMedium: 'H2O', thicknessFactors: { TiO2: 0.95 } });
    // The band row reads a 1 nm grid, so it samples the same wavelengths on
    // every design below whatever their fringes.
    const rows = [
        { type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, flag: 1 },
        { type: 'R', lambdaStart: 550, target: 0, env: 2 },
        { type: 'R', lambdaStart: 600, target: 0, env: 'base' },
        { type: 'T', lambdaStart: 500, target: 1, env: null },
    ];
    const design = api.setMerit(wet, rows);
    ok('setMerit takes env by number or id and holds the id; null or none is every environment',
        same(design.meritOperands.map(op => op.env), [undefined, 'env2', 'base', undefined])
        && !('env' in design.meritOperands[0]) && !('env' in design.meritOperands[3]), JSON.stringify(design.meritOperands.map(op => op.env)));

    // Each environment as a design of its own, with the rows scored there.
    // eslint-disable-next-line no-unused-vars
    const rowsIn = env => rows.filter(r => r.env == null || r.env === env).map(({ env: _, ...r }) => r);
    const thin = plain();
    const underWater = { ...thin, incidentMedium: 'H2O', frontLayers: thin.frontLayers.map(l => (/TiO2/.test(l.material) ? { ...l, thickness: l.thickness * 0.95 } : l)) };
    const base = api.merit(api.setMerit(plain(), rowsIn('base')));
    const water = api.merit(api.setMerit(underWater, rowsIn(2)));
    const m = api.merit(design);
    ok('merit lists each environment the total counts with its own merit, and the total is their root mean square',
        same(m.environments.map(e => [e.number, e.id, e.name]), [[1, 'base', null], [2, 'env2', 'Under water']])
        && Math.abs(m.environments[0].total - base.total) <= 1e-12 * base.total && Math.abs(m.environments[1].total - water.total) <= 1e-12 * water.total
        && Math.abs(m.total - Math.sqrt((base.total ** 2 + water.total ** 2) / 2)) <= 1e-12 * m.total, JSON.stringify(m.environments));
    ok('each row gives its env and its value in each environment it is scored in',
        same(m.rows.map(r => r.env), [null, 'env2', 'base', null])
        && same(m.rows.map(r => r.values.map(v => v.number)), [[1, 2], [2], [1], [1, 2]])
        && m.rows[1].value === m.rows[1].values[0].value && m.rows[0].value === m.rows[0].values[0].value
        && m.rows[0].values[0].value !== m.rows[0].values[1].value && m.rows.every(r => r.values.every(v => v.error === null)),
        JSON.stringify(m.rows.map(r => r.values)));
    const one = api.merit(api.setMerit(plain(), [rows[0]]));
    ok('a design with one environment lists environment 1 with its merit, and its rows env null and no values',
        same(one.environments, [{ number: 1, id: 'base', name: null, total: one.total, optical: one.optical }]) && one.rows[0].env === null && !('values' in one.rows[0]));
    const off = api.merit(api.setEnvironment(design, 2, { enabled: false }));
    ok('an environment switched off is not in the total, and its own row has no value and no values',
        same(off.environments.map(e => e.id), ['base']) && Math.abs(off.total - base.total) <= 1e-12 * base.total
        && off.rows[1].value === null && same(off.rows[1].values, []));

    const cases = [
        [() => api.setMerit(plain(), [rows[1]]), 'oneEnvironment', { call: 'setMerit', row: 0, option: 'env' }, /^setMerit: row 0: the design has one environment, so a row takes no env; add another environment first$/],
        [() => api.setMerit(wet, [rows[0], { ...rows[1], env: 3 }]), 'unknownEnvironment', { call: 'setMerit', row: 1, environment: 3, numbers: [1, 2], ids: ['base', 'env2'] },
            /^setMerit: row 1: env is one of the design's environments by its number, 1 to 2, or its id, base or env2; not 3$/],
        [() => api.setMerit(wet, [{ ...rows[1], env: 'env9' }]), 'unknownEnvironment', { environment: 'env9' }, /not "env9"$/],
    ];
    for (const [make, code, fields, pattern] of cases) {
        const err = thrown(make) ?? {};
        const fieldsMatch = Object.entries(fields).every(([key, value]) => isDeepStrictEqual(err.fields?.[key], value));
        ok(`setMerit refuses ${code} ${JSON.stringify(fields)} with its code and fields`, err.code === code && fieldsMatch && pattern.test(err.message), `${err.code} ${JSON.stringify(err.fields)} ${err.message}`);
    }

    const { result, design: refined } = await api.refine(design, { method: 'dls', maxIter: 8 });
    const after = api.merit(refined);
    ok('refine scores every environment: its start is merit\'s total and the answer lowers it',
        Math.abs(result.mfInitial - m.total) <= 1e-9 * m.total && after.total < m.total && Math.abs(result.mf - after.total) <= 1e-9 * after.total,
        `${result.mfInitial} ${m.total} ${result.mf} ${after.total}`);
}

// ── 9. A synthesis run's thickness floor ───────────────────────────────────
{
    let design = api.addEnvironment(plain(), { name: 'Dome edge', thicknessFactors: { TiO2: 0.9 } });
    design = api.setMerit(design, [
        { type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, env: 1 },
        { type: 'MNT', target: 300, env: 2 },
    ]);
    const { result, design: grown } = await api.synthesize(design, { method: 'ge', pool: ['TiO2', 'SiO2'], settings: { maxLayers: 6, maxGeCycles: 1 } });
    const thinnest = Math.min(...grown.frontLayers.map(l => l.thickness));
    ok('an MNT row of environment 2 sets no floor for a run that fits environment 1', result.completed && thinnest < 300, `${result.stopReason} ${thinnest}`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
