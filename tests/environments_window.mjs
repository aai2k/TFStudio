/**
 * The Environments window: one column per environment, environment 1 first.
 *
 *   1. A design with one environment shows environment 1 alone, with Add on
 *      and Delete, the name and the switch off.
 *   2. With three environments, each column's head carries the current
 *      radio, the switch and the name; a field an environment sets is a
 *      control with a cross, one it does not set is environment 1's value,
 *      dimmed, and environment 1 has no factor or swap.
 *   3. Each row kind edits the right field: in environment 1 the design's
 *      own, in another that environment's, a cross giving it back.
 *   4. Add, Duplicate and Delete: Delete takes the environment's rows with it
 *      in one change to the design, which is one undo step; deleting the last
 *      other environment leaves a design written without environments.
 *   5. Each environment's MF, its part of MF² and the total are the ones the
 *      merit tables read (meritTable).
 *   6. Its help page exists in English and Chinese, with its ribbon icon.
 *
 * Run: node tests/environments_window.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './_kernel.mjs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { oneEnvironmentDesign, threeEnvironmentDesign } = await import('./_environmentDesign.mjs');
const { Environments, EnvironmentBar } = await import('../src/components/windows/design/environments/Environments.js');
const { FieldCell, HeadCell } = await import('../src/components/windows/design/environments/EnvironmentCells.js');
const { fieldEdit, fieldValue, MEDIA_FIELDS } = await import('../src/components/windows/design/environments/environmentFields.js');
const { currentEnvironmentOf, currentEnvironmentSession } = await import('../src/components/windows/design/environments/currentEnvironment.js');
const { meritTable } = await import('../src/utils/physics/meritDisplay.js');
const { hasEnvironments, environmentById } = await import('../src/utils/environments/environments.js');
const designFile = (await import('../src/main/designFile.js')).default;

const h = React.createElement;
const c = makeTheme();
const t = makeLocale('en');
const te = t.environments;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const render = design => renderToStaticMarkup(withDesign(h(Environments, { c, t }), design));
// The opening tags of `html` that carry `attribute`, whatever the order of
// their attributes.
const tagsWith = (html, attribute) => (html.match(/<[a-z]+ [^>]*>/g) || []).filter(tag => tag.includes(attribute));
const isOff = (html, attribute) => tagsWith(html, attribute).every(tag => tag.includes('disabled=""')) && tagsWith(html, attribute).length > 0;

// Every element under `node`, the components left as elements, not rendered.
function* walk(node) {
    if (node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const child of node) yield* walk(child); return; }
    yield node;
    yield* walk(node.props?.children);
}
const find = (node, test) => [...walk(node)].find(test);

// The window's context with recording stand-ins for the design's edits and
// the current environment.
function context(design, currentId = 'base') {
    const calls = { updates: [], selected: [] };
    const current = { ...currentEnvironmentOf(design, currentId), select: id => calls.selected.push(id), step() {} };
    const ctx = {
        design, current, c, t, many: hasEnvironments(design), calls,
        updateDesign: patch => calls.updates.push(patch),
        edit: (id, field, value) => calls.updates.push(fieldEdit(design, id, field, value)),
    };
    return ctx;
}
const apply = (design, patch) => ({ ...design, ...patch });

// ── 1. One environment ───────────────────────────────────────────────────────
{
    const html = render(oneEnvironmentDesign());
    assert.equal((html.match(/type="radio"/g) || []).length, 1, 'one column, environment 1');
    assert.ok(html.includes(esc(te.hintOne)), 'the hint says how to add another');
    assert.ok(isOff(html, `title="${esc(te.deleteTip(1))}"`), 'Delete is off on environment 1');
    assert.ok(!isOff(html, `title="${esc(te.addTip)}"`), 'Add is on');
    assert.ok(isOff(html, `aria-label="${esc(te.nameOf(1))}"`), 'the name is off');
    assert.ok(isOff(html, 'type="checkbox"'), 'the switch is off');
    assert.ok(!html.includes(esc(te.resetTip)), 'environment 1 has no cross: its fields are the design\'s own');
}

// ── 2. Three environments ────────────────────────────────────────────────────
{
    const design = threeEnvironmentDesign();
    currentEnvironmentSession.write(design, { current: 'env2' });
    const html = render(design);
    currentEnvironmentSession.write(design, { current: 'base' });
    assert.equal((html.match(/type="radio"/g) || []).length, 3, 'a column per environment');
    assert.ok(tagsWith(html, `aria-label="${esc(te.makeCurrent(2))}"`)[0].includes('checked=""'), 'environment 2 is the current one');
    assert.ok(!tagsWith(html, `aria-label="${esc(te.makeCurrent(1))}"`)[0].includes('checked=""'), 'environment 1 is not');
    assert.match(html, /value="Sapphire"/, 'the name of environment 2');
    assert.ok(html.includes(esc(te.hint)), 'the hint on dim values');
    assert.ok(!isOff(html, `title="${esc(te.deleteTip(2))}"`), 'Delete is on in environment 2');
    const switches = tagsWith(html, 'type="checkbox"');
    assert.deepEqual(switches.map(tag => tag.includes('checked=""')), [true, true, false], 'environment 3 is off');
    assert.ok(switches.every(tag => !tag.includes('disabled=""')), 'every switch takes a click');
    assert.ok(html.includes(esc(te.factorOf('TiO2'))) && html.includes(esc(te.swapOf('MgF2'))), 'a factor and a swap row per layer material');
    assert.equal((html.match(new RegExp(`title="${esc(te.baseHasNoLayerFields)}"`, 'g')) || []).length, 4,
        'environment 1 has no factor or swap: four fixed cells');
}

// ── 3. Each row kind edits its field ─────────────────────────────────────────
{
    const design = threeEnvironmentDesign();
    const rows = {
        incident: { field: MEDIA_FIELDS[0], kind: 'material' },
        substrate: { field: MEDIA_FIELDS[1], kind: 'material' },
        thickness: { field: MEDIA_FIELDS[2], kind: 'thickness' },
        exit: { field: MEDIA_FIELDS[3], kind: 'material' },
        factor: { field: { key: 'factor', material: 'builtin:TiO2' }, kind: 'factor' },
        swap: { field: { key: 'swap', material: 'builtin:MgF2' }, kind: 'material' },
    };
    const env = id => environmentById(design, id);

    // Environment 1: the design's own fields.
    assert.deepEqual(fieldEdit(design, 'base', rows.incident.field, 'builtin:H2O'), { incidentMedium: 'builtin:H2O' });
    assert.deepEqual(fieldEdit(design, 'base', rows.substrate.field, 'builtin:SiO2'), { substrate: { material: 'builtin:SiO2', thickness: 1 } });
    assert.deepEqual(fieldEdit(design, 'base', rows.thickness.field, 3), { substrate: { material: 'builtin:BK7', thickness: 3 } });
    assert.deepEqual(fieldEdit(design, 'base', rows.exit.field, 'builtin:H2O'), { exitMedium: 'builtin:H2O' });
    assert.deepEqual(fieldValue(design, 'base', rows.factor.field), { value: 1, own: false, fixed: true });

    // Environment 2 follows environment 1 until a field is set, and a set
    // field is its own: only environment 2 changes.
    const second = (field, value) => apply(design, fieldEdit(design, 'env2', field, value));
    assert.deepEqual(fieldValue(design, 'env2', rows.incident.field), { value: 'builtin:Air', own: false, fixed: false });
    assert.equal(environmentById(second(rows.incident.field, 'builtin:H2O'), 'env2').incidentMedium, 'builtin:H2O');
    assert.deepEqual(environmentById(second(rows.thickness.field, 2), 'env2').substrate, { material: 'builtin:Al2O3', thickness: 2 });
    assert.equal(environmentById(second(rows.exit.field, 'builtin:EVA'), 'env2').exitMedium, 'builtin:EVA');
    assert.deepEqual(environmentById(second(rows.factor.field, 1.05), 'env2').thicknessFactors, { 'builtin:TiO2': 1.05 });
    assert.deepEqual(environmentById(second(rows.swap.field, 'builtin:SiO2'), 'env2').materialSwaps, { 'builtin:MgF2': 'builtin:SiO2' });
    assert.equal(second(rows.substrate.field, null).environments[1].substrate, undefined, 'null gives the substrate back');
    for (const field of Object.values(rows).map(row => row.field)) {
        const edited = second(field, field.key === 'substrateThickness' || field.key === 'factor' ? 2 : 'builtin:SiO2');
        assert.equal(edited.substrate, design.substrate, `${field.key}: the design's own substrate is untouched`);
        assert.equal(edited.incidentMedium, design.incidentMedium, `${field.key}: the design's own medium is untouched`);
    }

    // The cells: a dim value sets itself for its environment when clicked; a
    // set field's cross gives it back; environment 1's factor is fixed.
    const ctx = context(design, 'env2');
    const follows = FieldCell({ ctx, env: env('env2'), row: rows.incident });
    assert.equal(follows.type, 'button');
    assert.equal(follows.props.title, te.followsCellTip);
    follows.props.onClick();
    assert.equal(apply(design, ctx.calls.updates.pop()).environments[1].incidentMedium, 'builtin:Air',
        'a click on a dim value sets it for that environment');
    const own = FieldCell({ ctx, env: env('env2'), row: rows.substrate });
    find(own, node => node.props?.title === te.resetTip).props.onClick();
    assert.equal(apply(design, ctx.calls.updates.pop()).environments[1].substrate, undefined, 'the cross gives it back');
    const factor = FieldCell({ ctx, env: env('env3'), row: rows.factor });
    find(factor, node => node.props?.onChange && node.props.value === 0.95).props.onChange(0.9);
    assert.deepEqual(apply(design, ctx.calls.updates.pop()).environments[2].thicknessFactors, { 'builtin:TiO2': 0.9 });
    assert.equal(FieldCell({ ctx, env: env('base'), row: rows.swap }).props.title, te.baseHasNoLayerFields);

    // The head: current, on and name.
    const head = HeadCell({ ctx, env: env('env3'), index: 2 });
    find(head, node => node.props?.type === 'radio').props.onChange();
    assert.deepEqual(ctx.calls.selected, ['env3'], 'the radio makes the environment current');
    find(head, node => node.props?.type !== 'radio' && node.props?.checked === false && node.props?.onChange)
        .props.onChange({ target: { checked: true } });
    assert.equal(apply(design, ctx.calls.updates.pop()).environments[2].enabled, undefined, 'switched on, written as on');
    find(head, node => node.props?.['aria-label'] === te.nameOf(3)).props.onChange('  Dome edge ');
    assert.equal(apply(design, ctx.calls.updates.pop()).environments[2].name, 'Dome edge');
}

// ── 4. Add, Duplicate, Delete ────────────────────────────────────────────────
{
    const press = (ctx, title) => find(EnvironmentBar({ ctx }), node => node.props?.title === title).props.onClick();

    const one = oneEnvironmentDesign();
    const adding = context(one);
    press(adding, te.addTip);
    assert.equal(adding.calls.updates.length, 1, 'Add is one change');
    const added = apply(one, adding.calls.updates[0]);
    assert.deepEqual(added.environments.map(env => env.id), ['base', 'env2'], 'the first Add makes a design with environments');
    assert.deepEqual(adding.calls.selected, ['env2'], 'and makes the new environment current');

    const design = threeEnvironmentDesign();
    const copying = context(design, 'env2');
    press(copying, te.duplicateTip(2));
    const copy = apply(design, copying.calls.updates[0]).environments[3];
    assert.deepEqual(copy, { id: 'env4', name: t.explorer.duplicateName('Sapphire'), substrate: { material: 'builtin:Al2O3' } });

    const deleting = context(design, 'env2');
    press(deleting, te.deleteTip(2));
    assert.equal(deleting.calls.updates.length, 1, 'Delete is one change, so one undo step');
    const deleted = apply(design, deleting.calls.updates[0]);
    assert.deepEqual(deleted.environments.map(env => env.id), ['base', 'env3']);
    assert.ok(!deleted.meritOperands.some(op => op.id === 'r2'), 'the rows scored in it alone go with it');
    assert.equal(deleted.meritOperands.length, design.meritOperands.length - 1, 'and no other row');
    assert.deepEqual(deleting.calls.selected, ['base'], 'environment 1 is current after it');

    const two = { ...design, environments: design.environments.slice(0, 2) };
    const last = context(two, 'env2');
    press(last, te.deleteTip(2));
    const back = apply(two, last.calls.updates[0]);
    assert.ok(!hasEnvironments(back) && !back.meritOperands.some(op => 'env' in op), 'one environment left: no environments, no env');
    const written = JSON.parse(designFile.serializeDesign(back));
    assert.ok(!('environments' in written), 'the file holds no environments key');
}

// ── 5. The merit under the grid ──────────────────────────────────────────────
{
    const design = threeEnvironmentDesign();
    const html = render(design);
    const table = meritTable(design, design.meritOperands);
    const mf = id => table.environments.find(group => group.id === id).mf;
    const cells = label => {
        const at = html.indexOf(`title="${esc(label)}"`);
        return [...html.slice(at).split('</tr>')[0].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(match => match[1]);
    };
    assert.deepEqual(cells(te.meritOf), [mf('base').toFixed(6), mf('env2').toFixed(6), te.off],
        'each environment\'s MF is the merit table\'s; environment 3 is off');
    const sum = mf('base') ** 2 + mf('env2') ** 2;
    const percent = value => `${(value * 100).toFixed(1)}%`;
    assert.deepEqual(cells(te.partOf), [percent(mf('base') ** 2 / sum), percent(mf('env2') ** 2 / sum), ''],
        'each environment\'s part of MF² is MF_k² over the sum');
    assert.deepEqual(cells(te.rowsScored), ['2', '3', '2'], 'the rows scored in each, the header and the constant left out');
    assert.ok(html.includes(`<b style="color:${c.text}">${table.mf.toFixed(6)}</b>`), 'the total is the merit table\'s MF');
    assert.ok(Math.abs(table.mf - Math.sqrt(sum / 2)) < 1e-12, 'the mean of the two environments that count');
}

// ── 6. Its help page ─────────────────────────────────────────────────────────
{
    const { WINDOW_REGISTRY } = await import('../src/components/docking/windowRegistry.js');
    const slug = WINDOW_REGISTRY.environments.help;
    for (const root of ['', 'zh/']) {
        const page = new URL(`../docs-site/src/content/docs/${root}${slug}.md`, import.meta.url);
        assert.match(readFileSync(page, 'utf8'), /^ribbonIcon: environments$/m, `${root}${slug} shows the ribbon icon`);
    }
}

console.log('PASS environments_window');
