/**
 * The current environment in the Design Editor's Settings.
 *
 *   1. A design with one environment draws no droplist, no arrows and no
 *      field tags.
 *   2. With environments, a droplist of them sits between a previous and a
 *      next arrow, each arrow off at its end of the list.
 *   3. The pickers, the substrate thickness, the layer list's substrate and
 *      medium lines and the stack diagram show the current environment's
 *      media and substrate, and in environment 2 or later each field carries
 *      a tag: the environment's number and a cross when it sets the field, a
 *      note when it follows environment 1.
 *   4. An edit in environment 1 changes the design's own field, as before; in
 *      environment 2 it sets that environment's field and leaves the design's
 *      own alone, and the cross gives the field back.
 *   5. Making another environment current changes no design, asks for no
 *      undo step and is not written to the file.
 *
 * Run: node tests/design_editor_environments.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeDesignCtx, makeLocale, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
const { DesignContext } = await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { oneEnvironmentDesign, threeEnvironmentDesign } = await import('./_environmentDesign.mjs');
const { DesignEditor } = await import('../src/components/windows/design/designEditor/DesignEditor.js');
const { StackSettingsFields } = await import('../src/components/windows/design/designEditor/StackGeometryPanel.js');
const { FieldTag } = await import('../src/components/windows/design/designEditor/EnvironmentRow.js');
const { MediaCol } = await import('../src/components/windows/design/designEditor/ui.js');
const { DebouncedInput } = await import('../src/components/ui/DebouncedInput.js');
const {
    currentEnvironmentOf, currentEnvironmentSession, useCurrentEnvironment,
} = await import('../src/components/windows/design/environments/currentEnvironment.js');
const { environmentMedia } = await import('../src/utils/environments/environments.js');
const { designMaterialName } = await import('../src/utils/materials/designMaterials.js');
const { designsEqual } = await import('../src/utils/io/projectPersistence.js');
const designFile = (await import('../src/main/designFile.js')).default;

const h = React.createElement;
const c = makeTheme();
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const tagsWith = (html, attribute) => (html.match(/<[a-z]+ [^>]*>/g) || []).filter(tag => tag.includes(attribute));
const render = (design, t, current = 'base') => {
    currentEnvironmentSession.write(design, { current });
    const html = renderToStaticMarkup(withDesign(h(DesignEditor, { c, t }), design));
    currentEnvironmentSession.write(design, { current: 'base' });
    return html;
};
function* walk(node) {
    if (node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const child of node) yield* walk(child); return; }
    yield node;
    yield* walk(node.props?.children);
}
const LEFT = 'M15 6l-6 6l6 6';
const RIGHT = 'M9 6l6 6l-6 6';

// ── 1. One environment ───────────────────────────────────────────────────────
for (const code of ['en', 'ru', 'zh', 'it']) {
    const t = makeLocale(code);
    const te = t.environments;
    const html = render(oneEnvironmentDesign(), t);
    assert.ok(!html.includes(LEFT) && !html.includes(RIGHT), `${code}: no arrows`);
    assert.ok(!html.includes(`title="${esc(te.currentTip)}"`), `${code}: no droplist`);
    assert.ok(!html.includes(esc(te.followsTip)) && !html.includes(esc(te.ownTip(1))), `${code}: no field tags`);
}

// ── 2. The droplist and its arrows ───────────────────────────────────────────
const design = threeEnvironmentDesign();
for (const code of ['en', 'ru', 'zh', 'it']) {
    const t = makeLocale(code);
    const te = t.environments;
    const html = render(design, t);
    const select = html.match(new RegExp(`<select[^>]*title="${esc(te.currentTip)}"[^>]*>(.*?)</select>`))?.[1];
    assert.ok(select, `${code}: the droplist`);
    assert.deepEqual([...select.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(match => match[1]), ['1 · BK7', '2 · Sapphire', '3'],
        `${code}: every environment, by number and name`);
    const arrows = [te.previous, te.next].map(title => tagsWith(html, `title="${esc(title)}"`)[0]);
    assert.deepEqual(arrows.map(tag => tag.includes('disabled=""')), [true, false], `${code}: environment 1 has no previous`);
    assert.ok(!html.includes(esc(te.followsTip)), `${code}: environment 1 draws no tags: its fields are the design's own`);
}
{
    const t = makeLocale('en');
    const html = render(design, t, 'env3');
    const arrows = [t.environments.previous, t.environments.next].map(title => tagsWith(html, `title="${esc(title)}"`)[0]);
    assert.deepEqual(arrows.map(tag => tag.includes('disabled=""')), [false, true], 'environment 3, the last, has no next');
}

// ── 3. Environment 2's media and substrate, with their tags ──────────────────
{
    const t = makeLocale('en');
    const te = t.environments;
    const de = t.designEditor;
    const sapphire = designMaterialName(design, 'builtin:Al2O3');
    const before = render(design, t);
    const html = render(design, t, 'env2');
    assert.ok(!before.includes(esc(de.substrateTopLabel(sapphire))), 'environment 1 is on BK7');
    assert.ok(html.includes(esc(de.substrateTopLabel(sapphire))), 'the layer list names environment 2\'s substrate');
    assert.ok(html.includes(`title="${esc(sapphire)}"`), 'the stack diagram draws it');
    assert.ok(html.includes(`>${esc(sapphire)}</span>`), 'the substrate picker shows it');
    assert.equal(tagsWith(html, `title="${esc(te.ownTip(2))}"`).length, 1, 'the substrate, which environment 2 sets, carries its tag');
    assert.ok(html.includes(`>${esc(te.own(2))}<svg`), 'the tag is the environment\'s number with a cross');
    assert.equal((html.match(new RegExp(`title="${esc(te.followsTip)}"`, 'g')) || []).length, 3,
        'the incident medium, the exit medium and the substrate thickness follow environment 1');
    // Environment 3 grows its TiO2 0.95 times as thick; the layer list is the
    // recipe and reads the same in every environment.
    const thinner = render(design, t, 'env3');
    assert.ok(before.includes('11.92') && thinner.includes('11.92') && !thinner.includes((11.92 * 0.95).toFixed(2)),
        'the layer list shows the recipe\'s thicknesses');
}

// ── 4. Edits ─────────────────────────────────────────────────────────────────
{
    const t = makeLocale('en');
    const de = t.designEditor;
    const edits = [];
    const fields = currentId => StackSettingsFields({
        design, media: environmentMedia(design, currentId), current: currentEnvironmentOf(design, currentId),
        updateDesign: patch => edits.push(patch), refLambda: 550, c, t,
    });
    const picker = (tree, label) => [...walk(tree)].find(node => node.type === MediaCol && node.props.label === label);
    const apply = patch => ({ ...design, ...patch });

    picker(fields('base'), de.substrate).props.onChange('builtin:SiO2');
    assert.deepEqual(edits.pop(), { substrate: { material: 'builtin:SiO2', thickness: 1 } },
        'in environment 1 the design\'s own substrate, as before');
    picker(fields('base'), de.incidentMedium).props.onChange('builtin:H2O');
    assert.deepEqual(edits.pop(), { incidentMedium: 'builtin:H2O' });

    const second = fields('env2');
    picker(second, de.incidentMedium).props.onChange('builtin:H2O');
    const water = apply(edits.pop());
    assert.equal(water.incidentMedium, 'builtin:Air', 'the design\'s own medium stays');
    assert.equal(water.environments[1].incidentMedium, 'builtin:H2O', 'environment 2 sets its own');
    assert.equal(water.environments[2].incidentMedium, undefined, 'environment 3 is untouched');
    [...walk(second)].find(node => node.type === DebouncedInput).props.onChange('2.5');
    assert.deepEqual(apply(edits.pop()).environments[1].substrate, { material: 'builtin:Al2O3', thickness: 2.5 },
        'the substrate thickness of environment 2 alone');
    assert.equal(design.substrate.thickness, 1);

    const tag = picker(second, de.substrate).props.tag;
    assert.equal(tag.type, FieldTag);
    assert.equal(tag.props.own, true);
    tag.props.onReset();
    assert.equal(apply(edits.pop()).environments[1].substrate, undefined, 'the cross gives the substrate back to environment 1');
    assert.equal(picker(second, de.exitMedium).props.tag.props.own, false, 'a field environment 2 does not set follows');
    assert.equal(picker(fields('base'), de.substrate).props.tag, false, 'environment 1 has no tag');
}

// ── 5. The current environment is not the design's ──────────────────────────
{
    const stored = threeEnvironmentDesign();
    const copy = JSON.parse(JSON.stringify(stored));
    const calls = [];
    const ctx = {
        ...makeDesignCtx(stored),
        updateDesign: () => calls.push('updateDesign'), checkpoint: () => calls.push('checkpoint'),
    };
    let current = null;
    const Probe = () => { current = useCurrentEnvironment(stored); return null; };
    const draw = () => renderToStaticMarkup(h(DesignContext.Provider, { value: ctx }, h(Probe)));
    draw();
    assert.equal(current.id, 'base', 'a session starts on environment 1');
    current.select('env2');
    draw();
    assert.equal(current.number, 2, 'the droplist made environment 2 current');
    current.step(1);
    draw();
    assert.equal(current.id, 'env3', 'next');
    current.step(1);
    draw();
    assert.equal(current.id, 'env3', 'and no further than the last');
    current.step(-2);
    draw();
    assert.equal(current.id, 'base', 'previous, down to environment 1');
    current.step(-1);
    draw();
    assert.equal(current.id, 'base', 'and no further');
    assert.deepEqual(calls, [], 'no change to the design and no undo step');
    assert.deepEqual(stored, copy, 'the design object is as it was');
    assert.ok(designsEqual(stored, copy), 'so it is not marked changed');
    current.select('env2');
    assert.ok(!designFile.serializeDesign(stored).includes('"current"'), 'the file does not hold it');
    assert.equal(currentEnvironmentOf({ ...stored, environments: stored.environments.slice(0, 1) }, 'env2').id, 'base',
        'an environment the design no longer has reads as environment 1');
    current.select('base');
}

console.log('PASS design_editor_environments');
