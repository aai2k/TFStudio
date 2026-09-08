import assert from 'node:assert/strict';
import {
    blockSummary, fieldDef, fieldRows, hasTargetMode, polIsFixed, wizardSummary,
} from '../src/components/windows/optimization/meritFunctionEditor/wizardModel.js';
import { buildWizardBlock } from '../src/components/windows/optimization/meritFunctionEditor/meritOperandModel.js';
import { FILTER_TYPES } from '../src/utils/physics/optimizer/filterCatalog.js';
import { FILTER_CATEGORIES, defaultFilterParams } from '../src/utils/physics/optimizer.js';

// The Preset box has five rows: the two dropdowns and at most three field rows,
// so switching type never changes the box's height. Every field of every type
// must land on exactly one row, and the λ range always comes first.
for (const [typeId, def] of Object.entries(FILTER_TYPES)) {
    const rows = fieldRows(typeId);
    assert.ok(rows.length <= 3, `${typeId} needs ${rows.length} rows`);
    const keys = rows.flatMap(row => row.keys).sort();
    assert.deepEqual(keys, def.fields.map(field => field.key).sort(), `${typeId} fields`);
    if (keys.includes('lamStart')) assert.equal(rows[0].label, 'lam', `${typeId} λ first`);
    for (const key of keys) assert.ok(fieldDef(typeId, key), `${typeId}.${key}`);
}
assert.deepEqual(fieldRows('CUSTOM_BS').map(row => row.label), ['lam', 'rsRp']);
assert.deepEqual(fieldRows('BANDPASS').map(row => row.label), ['lowStop', 'pass', 'highStop']);
assert.deepEqual(fieldRows('CUSTOM_TARGET').map(row => [row.kind, row.label]), [['pair', 'lam'], ['statement', 'statement']]);
assert.deepEqual(fieldRows('TRIPLE_AR').map(row => row.kind), ['single', 'single', 'single']);
assert.deepEqual(fieldRows('not-a-type'), []);
assert.equal(fieldDef('BBAR', 'nope'), null);

// Only the polarizing beamsplitter fixes polarization; the Pol control is
// absent for it and the DMFS text carries no pol clause.
assert.equal(polIsFixed('CUSTOM_BS'), true);
assert.equal(polIsFixed('NEUTRAL_BS'), false);
assert.equal(hasTargetMode('BBAR'), true);
assert.equal(hasTargetMode('V_COAT'), false);

const tw = { types: {} };
const pbs = buildWizardBlock({
    tw, typeId: 'CUSTOM_BS', params: { lamStart: 1565, lamEnd: 1630, rsPct: 100, rpPct: 0 },
    aoi: 44.5, aoiEnd: 45.5, aoiSteps: 3, pol: 'avg', targetMode: 'continuous', stepNm: 1,
    constraintsEnabled: true, minThick: 40, maxThick: 1000, totalEnabled: false, maxTotal: 3000,
});
assert.ok(!pbs[0].comment.includes('pol'), pbs[0].comment);
assert.deepEqual(blockSummary(pbs), { count: 14, types: ['RGT', 'TGT', 'MNT', 'MXT'] });

const ar = buildWizardBlock({
    tw, typeId: 'BBAR', params: { lamStart: 400, lamEnd: 700 },
    aoi: 0, aoiEnd: 0, aoiSteps: 1, pol: 's', targetMode: 'continuous', stepNm: 1,
    constraintsEnabled: false, totalEnabled: false,
});
assert.ok(ar[0].comment.includes('s pol'), ar[0].comment);
assert.deepEqual(blockSummary(ar), { count: 2, types: ['RGT', 'TGT'] });

assert.equal(
    wizardSummary({ typeLabel: 'Polarizing (Rs/Rp)', params: { lamStart: 1565, lamEnd: 1630 }, aoi: 44.5, aoiEnd: 45.5 }),
    'Polarizing (Rs/Rp) · 1565–1630 nm · 44.5–45.5°',
);
assert.equal(wizardSummary({ typeLabel: 'V-coat', params: { lam0: 550 }, aoi: 0, aoiEnd: 0 }), 'V-coat · 0°');

// The DMFS header names the bands the preset was built from. Every type must
// name its own: a three-band filter carries a passStart like the two-band ones,
// so reading it as a plain pass-and-stop pair left its stop edges blank.
for (const cat of FILTER_CATEGORIES) {
    for (const id of cat.types) {
        const header = buildWizardBlock({
            tw, typeId: id, params: defaultFilterParams(id), aoi: 0, aoiEnd: 0, aoiSteps: 1,
            pol: 'avg', targetMode: 'continuous', stepNm: 1,
            constraintsEnabled: false, totalEnabled: false,
        })[0].comment;
        assert.ok(!/undefined|NaN/.test(header), `${id} header names a field it does not have: ${header}`);
    }
}
assert.match(buildWizardBlock({
    tw, typeId: 'BANDPASS', params: defaultFilterParams('BANDPASS'), aoi: 0, aoiEnd: 0, aoiSteps: 1,
    pol: 'avg', targetMode: 'continuous', stepNm: 1, constraintsEnabled: false, totalEnabled: false,
})[0].comment, /stop 300–450 \| pass 500–600 \| stop 650–1000 nm/,
'a bandpass names its low stop, its pass and its high stop');

console.log('wizard model ok');
