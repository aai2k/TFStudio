import assert from 'node:assert/strict';
import {
    buildDmfsComment, buildWizardBlock, editOperand, replaceOperandTail,
    addOperands, insertOperand, duplicateOperands, deleteOperands, moveOperand,
    wizardAppendRow, wizardGenerationRows,
} from '../src/components/windows/optimization/meritFunctionEditor/meritOperandModel.js';
import { reIdOperands } from '../src/components/windows/optimization/meritFunctionEditor/presetOperands.js';
import {
    DEFAULT_CONSTRAINT_LAST_LAYER, defaultFilterParams, makeOperand,
    rowRangeDomain, targetDomain,
} from '../src/utils/physics/optimizer.js';

let passed = 0;
function test(name, fn) {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
}

const labels = new Proxy({}, { get: (_, key) => ({ label: `Label ${String(key)}` }) });
const tw = { types: labels };
const common = { aoi: 0, aoiEnd: 0, aoiSteps: 3, pol: 'avg', targetMode: 'continuous', stepNm: 1 };

function comment(typeId, overrides = {}) {
    const params = { ...defaultFilterParams(typeId), ...(overrides.params || {}) };
    return buildDmfsComment({
        tw, typeId, params, common: { ...common, ...(overrides.common || {}) },
        constraintsEnabled: false, minThick: 40, maxThick: 1000,
        totalEnabled: false, maxTotal: 3000,
        ...overrides,
        params,
        common: { ...common, ...(overrides.common || {}) },
    });
}

test('DMFS comments cover every field shape', () => {
    const cases = [
        ['BBAR', 'Label BBAR, λ 400–700 nm'],
        ['LINEAR_RAMP', 'Label LINEAR_RAMP, λ 400–700 nm, T 0.00→1.00'],
        ['SOLAR_BLOCK', 'Label SOLAR_BLOCK, λ 300–2500 nm, T 0.00'],
        ['NEUTRAL_BS', 'Label NEUTRAL_BS, λ 400–700 nm, R=50%'],
        ['CUSTOM_BS', 'Label CUSTOM_BS, λ 400–700 nm, Rs=50% / Rp=50%'],
        ['V_COAT', 'Label V_COAT, λ₀=550 nm'],
        ['TRIPLE_AR', 'Label TRIPLE_AR, λ=450/550/650 nm'],
        ['DUAL_AR', 'Label DUAL_AR, λ=450/650 nm'],
        ['LONGPASS', 'Label LONGPASS, stop 400–600 nm, pass 700–1000 nm'],
        ['SHORTPASS', 'Label SHORTPASS, pass 400–600 nm, stop 700–1000 nm'],
        ['BANDPASS', 'Label BANDPASS, pass 500–600 nm, stop undefined–undefined nm'],
        ['NOTCH', 'Label NOTCH, pass 300–450 | stop 500–600 | pass 650–1000 nm'],
    ];
    for (const [typeId, prefix] of cases) {
        assert.ok(comment(typeId).startsWith(prefix), typeId);
    }
    assert.equal(buildDmfsComment({
        tw, typeId: 'LOW_STOP_SHAPE',
        filterTypes: { LOW_STOP_SHAPE: { fields: [{ key: 'lowStopStart' }] } },
        params: {
            lowStopStart: 300, lowStopEnd: 450, passStart: 500, passEnd: 600,
            highStopStart: 650, highStopEnd: 1000,
        },
        common, constraintsEnabled: false, minThick: 40, maxThick: 1000,
        totalEnabled: false, maxTotal: 3000,
    }), 'Label LOW_STOP_SHAPE, stop 300–450 | pass 500–600 | stop 650–1000 nm, AOI 0°, avg pol');
});

test('DMFS comments preserve AOI, target-mode, and constraint suffixes', () => {
    assert.equal(
        comment('BBAR', {
            common: { aoi: 5, aoiEnd: 25, aoiSteps: 7, pol: 'p', targetMode: 'discrete', stepNm: 2.5 },
            constraintsEnabled: true, minThick: 12, maxThick: 345,
            totalEnabled: true, maxTotal: 2345,
        }),
        'Label BBAR, λ 400–700 nm, AOI 5–25° (7 steps), p pol, discrete @2.5 nm; ≥12 nm, ≤345 nm; Σd ≤ 2345 nm',
    );
    assert.ok(comment('BBAR', { common: { aoi: 8, aoiEnd: null } }).includes('AOI 8°, avg pol, continuous target'));
    assert.ok(!comment('V_COAT').includes('continuous target'));
});

test('wizard builds DMFS, optical operands, all-layer constraints, and TT cap', () => {
    const block = buildWizardBlock({
        tw, typeId: 'V_COAT', params: defaultFilterParams('V_COAT'),
        aoi: '15', aoiEnd: '15', aoiSteps: 3, pol: 's', targetMode: 'continuous', stepNm: 1,
        constraintsEnabled: true, minThick: 0, maxThick: -2,
        totalEnabled: true, maxTotal: 0,
    });
    assert.deepEqual(block.map(op => op.type), ['DMFS', 'R', 'T', 'MNT', 'MXT', 'TT']);
    const allLayers = [1, DEFAULT_CONSTRAINT_LAST_LAYER, 0.01];
    assert.deepEqual(block.slice(3, 5).map(op => [op.lambdaStart, op.lambdaEnd, op.target]),
        [allLayers, allLayers]);
    assert.equal(block[5].cmp, 'le');
    assert.equal(block[5].target, 1);
    assert.equal(block[1].aoi, 15);
    assert.equal(block[1].pol, 's');
});

test('wizard can omit constraints while retaining optical generation', () => {
    const block = buildWizardBlock({
        tw, typeId: 'BBAR', params: defaultFilterParams('BBAR'),
        aoi: 0, aoiEnd: 0, aoiSteps: 3, pol: 'avg', targetMode: 'continuous', stepNm: 1,
        constraintsEnabled: false, minThick: 40, maxThick: 1000,
        totalEnabled: false, maxTotal: 3000,
    });
    assert.deepEqual(block.map(op => op.type), ['DMFS', 'RGT', 'TGT']);
});

test('wizard start row appends, normalizes, and advances by block length', () => {
    assert.equal(wizardAppendRow(0), 1);
    assert.equal(wizardAppendRow(7), 8);
    assert.deepEqual(wizardGenerationRows(4.6, 9), { startRow: 5, nextStartRow: 14 });
    assert.deepEqual(wizardGenerationRows(-3, 2), { startRow: 1, nextStartRow: 3 });
});

function op(id, type, extra = {}) {
    return makeOperand({ id, type, ...extra });
}

test('edits preserve patch behavior and target units', () => {
    const operands = [
        op('opt', 'R'),
        op('con', 'MNT'),
        op('tt', 'TT'),
        op('arg', 'MXWT'),
        op('math-opt', 'OPGT', { refId: 'opt' }),
        op('math-raw', 'OPGT', { refId: 'con' }),
        op('pair-opt', 'DIFF', { refId1: 'opt', refId2: 'opt' }),
        op('pair-mixed', 'DIFF', { refId1: 'opt', refId2: 'con' }),
        op('phase', 'GDDFLAT', { target: -40 }),
    ];
    const target = (id, value = '75') => editOperand(operands, id, 'target', value).find(item => item.id === id).target;
    assert.equal(target('opt'), 0.75);
    assert.equal(target('con'), 75);
    assert.equal(target('tt'), 75);
    assert.equal(target('arg'), 75);
    assert.equal(target('math-opt'), 0.75);
    assert.equal(target('math-raw'), 75);
    assert.equal(target('pair-opt'), 0.75);
    assert.equal(target('pair-mixed'), 75);
    assert.equal(target('phase', '-30'), -30);
    const patched = editOperand(operands, 'opt', '_patch', { target: 0.2, custom: { keep: true } });
    assert.deepEqual(patched[0].custom, { keep: true });
    assert.equal(patched[0].target, 0.2);
});

test('a type change reseeds the fields whose meaning changed with it', () => {
    // λ Start, λ End and the target are numbers whose unit comes from the type.
    // Carried across a type change they are wrong rather than merely unhelpful.
    const fresh = makeOperand({ id: 'fresh' });
    const changed = editOperand([fresh], fresh.id, 'type', 'GDD')[0];
    assert.equal(changed.type, 'GDD');
    assert.equal(changed.target, 0, 'a fraction is not a number of fs²');

    const userTarget = makeOperand({ id: 'custom', target: 0.25 });
    assert.equal(editOperand([userTarget], userTarget.id, 'type', 'GDD')[0].target, 0,
        'an explicit fraction is still a fraction, so it is reseeded too');

    const gdd = makeOperand({ id: 'gdd', type: 'GDDFLAT', target: -40 });
    const flat = editOperand([gdd], gdd.id, 'type', 'GDDTFLAT')[0];
    assert.equal(flat.target, -40, 'a target keeps its value when the unit does not change');
    assert.equal(flat.lambdaStart, gdd.lambdaStart);
    assert.equal(flat.lambdaEnd, gdd.lambdaEnd);

    assert.equal(makeOperand({ type: 'GDD' }).target, 0, 'an omitted phase target gets its default');
    assert.equal(makeOperand({ type: 'GDD', target: 0.99 }).target, 0.99,
        'an explicit target equal to the optical default remains explicit');
});

test('a row retyped to a thickness constraint gets layer defaults, not wavelengths', () => {
    // The λ Start / λ End columns become Layer 1 / Layer 2 for MNT and MXT.
    // Inheriting a 400-700 nm band would constrain layers 400 to 700, which do
    // not exist, and inheriting 0.99 would ask for a 0.99 nm minimum thickness.
    const spectral = makeOperand({ id: 'rav', type: 'RAV', lambdaStart: 600, lambdaEnd: 900 });
    const mnt = editOperand([spectral], spectral.id, 'type', 'MNT')[0];
    assert.equal(mnt.type, 'MNT');
    assert.equal(mnt.lambdaStart, 1);
    assert.equal(mnt.lambdaEnd, DEFAULT_CONSTRAINT_LAST_LAYER,
        'the range covers layers synthesis has not added yet');
    assert.equal(mnt.target, 10, 'the target is a thickness in nm');

    // Editing the layer range and then swapping MNT for MXT keeps it: both read
    // the columns the same way.
    const narrowed = editOperand([mnt], mnt.id, 'lambdaEnd', 12);
    const mxt = editOperand(narrowed, mnt.id, 'type', 'MXT')[0];
    assert.equal(mxt.lambdaStart, 1);
    assert.equal(mxt.lambdaEnd, 12);

    // Going back the other way, a layer number is not a wavelength.
    const back = editOperand([mxt], mxt.id, 'type', 'RAV')[0];
    assert.equal(back.lambdaStart, 400);
    assert.equal(back.lambdaEnd, 700);
    assert.equal(back.target, 0.99);
});

test('adding a constraint row directly gets the same layer defaults', () => {
    const added = addOperands([], { type: 'MXT' }, 0).operands[0];
    assert.equal(added.type, 'MXT');
    assert.equal(added.lambdaStart, 1);
    assert.equal(added.lambdaEnd, DEFAULT_CONSTRAINT_LAST_LAYER);
    const spectral = addOperands([], { type: 'RAV' }, 0).operands[0];
    assert.equal(spectral.lambdaStart, 400);
    assert.equal(spectral.lambdaEnd, 700);
});

test('rowRangeDomain and targetDomain separate the incompatible column meanings', () => {
    assert.equal(rowRangeDomain('RAV'), 'wavelength');
    assert.equal(rowRangeDomain('MNT'), 'layer');
    assert.equal(rowRangeDomain('MXT'), 'layer');
    assert.equal(rowRangeDomain('TIW'), 'preset');
    assert.equal(rowRangeDomain('TT'), 'comparison');
    assert.equal(rowRangeDomain('DIFF'), 'operandRef');
    assert.equal(rowRangeDomain('BLNK'), 'comment');
    assert.equal(rowRangeDomain('GDDFLAT'), 'wavelength');

    assert.equal(targetDomain('RAV'), 'fraction');
    assert.equal(targetDomain('TIW'), 'fraction');
    assert.equal(targetDomain('MNT'), 'nm');
    assert.equal(targetDomain('TT'), 'nm');
    assert.equal(targetDomain('MXWT'), 'wavelength');
    assert.equal(targetDomain('GDD'), 'phase');
    assert.equal(targetDomain('DIFF'), 'raw');
});

test('tail replacement uses clamped one-based start rows', () => {
    const base = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    assert.deepEqual(replaceOperandTail(base, [{ id: 'x' }], 2), {
        operands: [{ id: 'a' }, { id: 'x' }], selectedId: null,
    });
    assert.deepEqual(replaceOperandTail(base, [{ id: 'x' }], 99).operands, [...base, { id: 'x' }]);
    assert.deepEqual(replaceOperandTail(base, [{ id: 'x' }]).operands, [...base, { id: 'x' }]);
});

test('add and insert preserve positions and select the last new row', () => {
    let next = 0;
    const create = data => ({ ...data, id: `new-${++next}`, enabled: true });
    const base = [{ id: 'a' }, { id: 'b' }];
    const added = addOperands(base, [{ type: 'R' }, { type: 'T' }], 1, create);
    assert.deepEqual(added.operands.map(item => item.id), ['a', 'new-1', 'new-2', 'b']);
    assert.equal(added.selectedId, 'new-2');
    assert.equal(addOperands(base, [], 0, create), null);
    const bare = addOperands(base, null, null, create);
    assert.equal(bare.operands[2].type, 'BLNK');
    const inserted = insertOperand(base, -3, create);
    assert.deepEqual(inserted.operands.map(item => item.id), ['new-4', 'a', 'b']);
    assert.equal(inserted.operands[0].type, 'BLNK');
});

test('duplicate preserves all custom fields and stamps fresh IDs', () => {
    const custom = op('source', 'OPGT', {
        enabled: false, refId: 'ref', refId1: 'r1', refId2: 'r2',
        source: { id: 'D65', nested: { x: 1 } }, detector: { id: 'flat' },
        presetKey: 'custom', cmp: 'ge', customField: 42,
    });
    let n = 0;
    const result = duplicateOperands([custom, { id: 'tail' }], 'source', () => `copy-${++n}`);
    assert.deepEqual(result.operands[1], { ...custom, id: 'copy-1', enabled: false });
    assert.equal(result.selectedId, 'copy-1');
    assert.notEqual(result.operands[1].id, custom.id);
});

test('delete and move respect selection and boundaries', () => {
    const base = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    assert.deepEqual(deleteOperands(base, ['a', 'c']), { operands: [{ id: 'b' }], selectedId: null });
    assert.strictEqual(moveOperand(base, 'a', -1), base);
    assert.strictEqual(moveOperand(base, 'c', 1), base);
    assert.strictEqual(moveOperand(base, 'missing', 1), base);
    assert.deepEqual(moveOperand(base, 'b', -1).map(item => item.id), ['b', 'a', 'c']);
    assert.deepEqual(moveOperand(base, 'b', 1).map(item => item.id), ['a', 'c', 'b']);
});

test('deleting a referenced row also removes transitive math dependents', () => {
    const base = [
        { id: 'source', type: 'R' },
        { id: 'direct', type: 'OPGT', refId: 'source' },
        { id: 'transitive', type: 'ABSO', refId: 'direct' },
        { id: 'pair', type: 'DIFF', refId1: 'other', refId2: 'source' },
        { id: 'other', type: 'T' },
    ];
    assert.deepEqual(deleteOperands(base, 'source'), {
        operands: [{ id: 'other', type: 'T' }],
        selectedId: null,
    });
});

test('preset re-ID removes old IDs and preserves operand data', () => {
    let n = 0;
    const create = data => ({ id: `fresh-${++n}`, ...data });
    const source = [{ id: 'old-1', type: 'RIW', custom: { x: 1 } }, { id: 'old-2', type: 'TT', cmp: 'le' }];
    const fresh = reIdOperands(source, create);
    assert.deepEqual(fresh, [
        { id: 'fresh-1', type: 'RIW', custom: { x: 1 } },
        { id: 'fresh-2', type: 'TT', cmp: 'le' },
    ]);
});

test('preset re-ID rewrites references between the re-keyed rows', () => {
    let n = 0;
    const create = data => ({ id: `fresh-${++n}`, ...data });
    const source = [
        { id: 'base', type: 'TAV' },
        { id: 'other', type: 'RAV' },
        { id: 'derived', type: 'OPGT', refId: 'base' },
        { id: 'pair', type: 'DIFF', refId1: 'base', refId2: 'other' },
        { id: 'dangling', type: 'OPLT', refId: 'not-in-preset' },
    ];
    const fresh = reIdOperands(source, create);
    const byOldPosition = Object.fromEntries(source.map((op, i) => [op.id, fresh[i].id]));

    assert.equal(fresh[2].refId, byOldPosition.base, 'single reference follows the new id');
    assert.equal(fresh[3].refId1, byOldPosition.base, 'first of a pair follows the new id');
    assert.equal(fresh[3].refId2, byOldPosition.other, 'second of a pair follows the new id');
    assert.equal(fresh[4].refId, 'not-in-preset', 'a reference outside the preset is left alone');
    assert.ok(fresh.every(op => op.id !== 'base'), 'no operand keeps its old id');
});

console.log(`merit_function_editor_model: ${passed} passed`);
