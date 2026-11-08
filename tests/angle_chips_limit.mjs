/**
 * The angle chips hold angles in 0.1° steps from 0 to 89.9°, and so do the
 * saved angle lists of the windows that use them.
 *
 *   1. A typed angle rounds to 0.1°. One that rounds past 89.9° is refused, so
 *      89.95° to 89.999° never make a 90° chip, which is grazing incidence.
 *   2. The up arrow stops at 89.9°.
 *   3. The add button's tooltip names the top, with the language's decimal mark.
 *   4. A saved list holding 89.9° survives a reload; one holding 90° falls back
 *      to the shipped list.
 *   5. Color Evaluation's range of angles runs to the same top.
 *   6. Settings keeps a typed angle list the way the chips do: each angle
 *      rounded to 0.1°, one past the top refused, a repeat after rounding
 *      dropped.
 *   7. So does the report's angle list, so 89.95° is not made 90° there.
 *   8. The report's color block, which copies the window's first angle, takes
 *      an angle up to the top.
 *   9. The one angle Color Evaluation saved in 2.0.0 opens as a list of that
 *      angle.
 *
 * Run: node tests/angle_chips_limit.mjs
 */
import assert from 'node:assert/strict';
import { mount } from './_typeIntoField.mjs';

const { getLocale } = await import('../src/constants/locales/index.js');
const { AoiChips } = await import('../src/components/windows/analysis/opticalEvaluation/AoiChips.js');
const { ANALYSIS_DEFAULTS } = await import('../src/constants/analysisDefaults.js');
const { resolvedWindowValues } = await import('../src/utils/analysisSettings.js');

const oe = getLocale('en').opticalEval;
const c = { bg: '#000', panel: '#111', field: '#111', text: '#eee', textDim: '#999', border: '#333', accent: '#39f' };
const TOP = 89.9;

// The first node of a rendered tree that `test` accepts.
function nodeWhere(node, test) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) return node.map(child => nodeWhere(child, test)).find(Boolean) ?? null;
    if (test(node)) return node;
    return nodeWhere([node.props?.children].flat(Infinity), test);
}
const addButton = node => node.type === 'button' && !!node.props.title;
const chipLabel = node => node.type === 'span' && node.props.title === oe.editAoiTooltip;

// The chips over `values`, with the add box or a chip's box opened by `open`.
function chips(values, open) {
    const changes = [];
    const field = mount(AoiChips, { values, onChange: next => changes.push(next), c, oe });
    nodeWhere(field.render(), open).props.onClick();
    return { changes, field };
}

// ── 1. A typed angle rounds to 0.1°, and none rounds to 90° ──────────────────
{
    const added = text => {
        const { changes, field } = chips([0], addButton);
        field.type(text).press('Enter');
        return changes;
    };
    assert.deepEqual(added('89,94'), [[0, 89.9]], 'an angle rounds to 0.1°');
    assert.deepEqual(added('89.9'), [[0, TOP]], 'the top is taken');
    for (const text of ['89.95', '89,999', '90']) {
        assert.deepEqual(added(text), [], `${text}° is refused, not made a 90° chip`);
    }
    const { changes, field } = chips([10, 45], chipLabel);
    field.type('89.97').press('Enter');
    assert.deepEqual(changes, [], 'an angle edited past the top is refused too');
}

// ── 2. The up arrow stops at the top ─────────────────────────────────────────
{
    const { field } = chips([0], addButton);
    field.type('89').press('ArrowUp');
    assert.equal(field.shown, String(TOP), 'one step up from 89° is the top');
    field.press('ArrowUp');
    assert.equal(field.shown, String(TOP), 'and no further');
}

// ── 3. The tooltip names the top ─────────────────────────────────────────────
{
    const { field } = chips([0], chipLabel);
    const title = nodeWhere(field.render(), addButton).props.title;
    assert.equal(title, oe.addAoiTooltip(6, TOP));
    assert.ok(title.includes('89.9°'), title);
    assert.ok(getLocale('ru').opticalEval.addAoiTooltip(6, TOP).includes('89,9°'), 'Russian writes 89,9');
}

// ── 4. A saved list keeps an angle up to the top ─────────────────────────────
for (const windowId of ['opticalEvaluation', 'colorEvaluation']) {
    assert.equal(ANALYSIS_DEFAULTS[windowId].lists.thetas.max, TOP, windowId);
    const reloaded = thetas => resolvedWindowValues(windowId, { [windowId]: { lists: { thetas } } }).thetas;
    assert.deepEqual(reloaded([0, TOP]), [0, TOP], `${windowId}: a list holding ${TOP}° survives a reload`);
    assert.deepEqual(reloaded([0, 90]), [0], `${windowId}: one holding 90° falls back to the shipped list`);
}

// ── 5. Color Evaluation's range runs to the same top ─────────────────────────
{
    const { angleStart, angleEnd } = ANALYSIS_DEFAULTS.colorEvaluation.numbers;
    assert.deepEqual([angleStart.max, angleEnd.max], [TOP, TOP]);
}

// ── 6. Settings keeps a list as the chips do ─────────────────────────────────
{
    const { ListRow } = await import('../src/components/dialogs/settings/analysis/FieldRows.js');
    const changes = [];
    mount(ListRow, {
        c, label: '', value: [0], spec: ANALYSIS_DEFAULTS.opticalEvaluation.lists.thetas,
        onChange: next => changes.push(next),
    }).type('45.37, 45.4, 89.95, 30').press('Enter');
    assert.deepEqual(changes, [[45.4, 30]], 'rounded to 0.1°, 89.95° refused, the second 45.4° dropped');
}

// ── 7. So does the report's angle list ───────────────────────────────────────
{
    const { AngleListField } = await import('../src/components/windows/information/report/controls.js');
    const changes = [];
    mount(AngleListField, { value: [65], onChange: next => changes.push(next), c })
        .type('89.95, 89.94, 45').press('Enter');
    assert.deepEqual(changes, [[TOP, 45]], '89.95° is refused rather than made 90°');
}

// ── 8. The report's color block takes an angle up to the top ────────────────
{
    const { BlockSettingsPanel } = await import('../src/components/windows/information/report/BlockSettings.js');
    const { newBlock } = await import('../src/utils/report/blocks.js');
    const en = getLocale('en');
    const changes = [];
    const field = mount(BlockSettingsPanel, {
        c, W: en.report.window, t: en, block: newBlock('color', { theta: 89 }), index: 0, count: 1, design: null,
        onChange: (id, change) => changes.push(change), onMove() {}, onRemove() {}, onClose() {},
    });
    field.type('89.5').press('Enter');
    assert.deepEqual(changes, [{ theta: 89.5 }], 'an angle above 89° is kept');
    field.type('89.5').press('ArrowUp');
    assert.deepEqual(changes.at(-1), { theta: TOP }, 'and the up arrow raises it to the top, not back to 89°');
}

// ── 9. Color Evaluation's angle saved by 2.0.0 opens as a list ──────────────
{
    const { sanitizeAnalysisOverrides } = await import('../src/utils/analysisSettings.js');
    const saved = { colorEvaluation: { numbers: { theta: 45, step: 1 } } };
    assert.deepEqual(resolvedWindowValues('colorEvaluation', saved).thetas, [45], 'the saved angle is the list');
    assert.deepEqual(sanitizeAnalysisOverrides(saved), { colorEvaluation: { numbers: { step: 1 }, lists: { thetas: [45] } } },
        'and is kept as a list at the next save');
    const listed = { colorEvaluation: { numbers: { theta: 45 }, lists: { thetas: [10, 20] } } };
    assert.deepEqual(resolvedWindowValues('colorEvaluation', listed).thetas, [10, 20], 'a saved list wins over it');
    const grazing = { colorEvaluation: { numbers: { theta: 89.97 } } };
    assert.deepEqual(resolvedWindowValues('colorEvaluation', grazing).thetas, [0], 'an angle the list would refuse is not carried');
}

console.log('angle_chips_limit: passed');
