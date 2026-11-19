/**
 * Smart starting design on a design coated on the back: the antireflection
 * templates are front stacks, air to substrate, and a back stack runs
 * substrate to exit.
 *   1. On a back-only design every template goes on the back, reversed, and
 *      the front coating is kept as it is.
 *   2. On any other design the template stays the front stack.
 *   3. Structural's seed on the back puts a template in reversed, as a back
 *      stack is stored, and the layers of the current design as they are.
 *
 * Run: node tests/smart_seed_back_stack.mjs
 */
import './_kernel.mjs';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { buildARSeedCandidates } from '../src/components/windows/optimization/synthesisShared/synthesisMath.js';
import { generateARSeeds } from '../src/utils/synthesis/seedGenerator/generate.js';
import { smartSeedDesign } from '../src/utils/structural/baseline.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const shape = layers => layers.map(l => [l.material, l.thickness]);

const pool = ['TiO2', 'SiO2', 'MgF2'].map(id => ({ id, name: id, mat: getMaterial(id) }));
const front = [{ id: 'F1', material: 'TiO2', thickness: 300, locked: false }];
const back = [{ id: 'B1', material: 'TiO2', thickness: 300, locked: false }];
const base = {
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: front, backLayers: back,
};

const seeds = generateARSeeds({ pool, lambda0: 550, baseDesign: base });
const thick = seeds.find(s => s.frontLayers.length > 1);
ok(thick, 'the pool gives a template of more than one layer');

const backOnly = buildARSeedCandidates({ design: { ...base, surfaceMode: 'back_only' }, pool });
ok(backOnly.length === seeds.length + 1 && backOnly[0].name === 'current', 'the current design and every template are candidates');
for (const [i, cand] of backOnly.slice(1).entries()) {
    ok(same(cand.frontLayers, front), `back-only: template ${i} keeps the front coating`);
    ok(same(shape(cand.backLayers), shape([...seeds[i].frontLayers].reverse())), `back-only: template ${i} is the reversed stack on the back`);
}

const frontOnly = buildARSeedCandidates({ design: { ...base, surfaceMode: 'front_only' }, pool });
ok(frontOnly.slice(1).every((cand, i) => same(shape(cand.frontLayers), shape(seeds[i].frontLayers))), 'front-only: the template is the front stack');
ok(frontOnly.slice(1).every(cand => same(cand.backLayers, back)), 'front-only: a template keeps the back coating of the design');

const S = { layerKey: 'backLayers', otherKey: 'frontLayers', media: {}, surfaceMode: 'both_independent', curDes: base };
const seeded = smartSeedDesign(S, { name: 'tpl', frontLayers: thick.frontLayers, backLayers: back });
ok(same(seeded.backLayers.map(l => l.material), [...thick.frontLayers].reverse().map(l => l.material)),
    'structural: a template on the back is reversed, substrate side first');
ok(seeded.frontLayers.length === front.length, 'and the other side is the design\'s own');

if (fails === 0) { console.log('PASS: smart seed on the back stack'); process.exit(0); }
console.error(`\n${fails} assertion(s) failed`);
process.exit(1);
