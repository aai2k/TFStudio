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

console.log('angle_chips_limit: passed');
