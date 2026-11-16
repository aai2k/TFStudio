/**
 * The in-app tutorials (utils/samples/tutorials.js) and their text.
 *
 *   1. Every lesson has as many steps as its English text, and a lesson that
 *      loads a starter design names it in English (the i18n test then holds
 *      the other locales to the same shape).
 *   2. The first two lessons build different things: the first starts bare,
 *      the second loads one MgF2 quarter wave at 550 nm with no merit rows,
 *      so no target band shades the plot it asks the user to read.
 *   3. The refinement lesson's start, refined by the Refinement window's
 *      default method, ends below MF 0.001 with every layer inside its MNT
 *      and MXT limits, and the lesson's text names that default method in
 *      every locale.
 *   4. The synthesis lesson's setup leaves Gradual Evolution a pool of TiO2
 *      and SiO2 from the Built-in catalog, and the window opens on the
 *      lesson's design at its MNT 15 nm though another Min thickness is stored.
 *   5. Lessons are listed by level, as the browser groups them, so the lesson
 *      a last step offers next is the one shown after it.
 *   6. Every data-tour anchor a step points at is set somewhere in the
 *      components, so renaming a control's anchor cannot leave a step ringing
 *      nothing.
 *
 * Gradual Evolution's hook runs under the effect-running stand-in for React in
 * _effectRuntime.mjs, installed before any window module is imported.
 *
 * Run: node tests/tutorials.mjs
 */
import './_kernel.mjs';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { makeEffectRuntime } from './_effectRuntime.mjs';

shimBrowserGlobals();
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 1 }, configurable: true, writable: true });
const R = makeEffectRuntime(globalThis.React);
globalThis.React = R;

const { buildTutorials } = await import('../src/utils/samples/tutorials.js');
const { getLocale, availableLocales } = await import('../src/constants/locales/index.js');
const { initCatalogs, getMaterialById } = await import('../src/utils/materials/catalogManager.js');
const { getPoolMaterials } = await import('../src/components/windows/optimization/synthesisShared/catalogPool.js');
const { runRefinement } = await import('../src/utils/refinement/runRefinement.js');
const { InThreadOptimizerWorker } = await import('../src/utils/workers/inThreadOptimizerWorker.js');
const { DEFAULT_REFINE_METHOD } = await import('../src/utils/optimizers/index.js');
const { useGradualEvolution } = await import(
    '../src/components/windows/optimization/gradualEvolution/useGradualEvolution.js');

initCatalogs({});
const en = getLocale('en');
const lessons = buildTutorials();
const lesson = key => lessons.find(l => l.key === key);
const stepWith = (key, field) => lesson(key).steps.find(s => s[field]);

// ── 1. Structure and text agree ─────────────────────────────────────────────
for (const { key, steps } of lessons) {
    const text = en.tutorials.lessons[key];
    assert.ok(text, `${key}: has English text`);
    assert.equal(steps.length, text.steps.length, `${key}: ${steps.length} steps, English has ${text.steps.length}`);
    if (steps.some(s => s.loadDesign)) {
        assert.equal(typeof text.designName, 'string', `${key}: names its starter design`);
        assert.equal(stepWith(key, 'loadDesign').loadDesign(text.designName).name, text.designName,
            `${key}: the starter design takes that name`);
    }
}

// ── 2. The first two lessons build different things ─────────────────────────
{
    const first = stepWith('firstDesign', 'loadDesign').loadDesign('first');
    assert.equal(first.frontLayers.length, 0, 'the first lesson starts from a bare substrate');
    const ar = stepWith('singleAR', 'loadDesign').loadDesign('ar');
    assert.equal(ar.frontLayers.length, 1, 'the single-layer lesson loads one layer');
    const [layer] = ar.frontLayers;
    assert.equal(layer.material, 'MgF2');
    const n = getMaterialById('MgF2').getNK(550)[0];
    const qwot = 4 * n * layer.thickness / 550;
    assert.ok(Math.abs(qwot - 1) < 1e-3, `the MgF2 layer is a quarter wave at 550 nm (${qwot.toFixed(4)} QW)`);
    assert.equal(ar.meritOperands.length, 0, 'no merit rows, so no target band shades the plot');
}

// ── 3. The refinement start, refined by the default method ──────────────────
{
    const design = stepWith('refine', 'loadDesign').loadDesign('refine');
    const quiet = console.log;
    console.log = () => {};
    let result;
    try {
        result = await runRefinement(design, design.meritOperands, { method: DEFAULT_REFINE_METHOD },
            { makeWorker: () => new InThreadOptimizerWorker() });
    } finally { console.log = quiet; }
    assert.equal(result.completed, true, `the run completes (${result.stopReason})`);
    assert.ok(result.mf < 1e-3, `the default method ends below MF 0.001 (${result.mf})`);
    const limit = type => design.meritOperands.find(op => op.type === type).target;
    for (const { thickness } of result.frontLayers) {
        assert.ok(thickness >= limit('MNT') - 1e-6 && thickness <= limit('MXT') + 1e-6,
            `every layer stays within ${limit('MNT')}-${limit('MXT')} nm (${thickness.toFixed(2)})`);
    }
    // The lesson tells the user to keep the default method, by its name.
    const runStep = lesson('refine').steps.findIndex(s => s.tool === 'refinement');
    for (const { code } of availableLocales) {
        const t = getLocale(code);
        const label = t.refinement.methods[DEFAULT_REFINE_METHOD];
        assert.ok(t.tutorials.lessons.refine.steps[runStep].body.includes(label),
            `${code}: the run step names the default method, ${label}`);
    }
}

// ── 4. The synthesis lesson's Gradual Evolution setup ───────────────────────
{
    localStorage.setItem('tfstudio_ge_dMin', '1');
    localStorage.setItem('tfstudio_ge_selectedCats', JSON.stringify(['builtin', 'design']));
    stepWith('synthesize', 'prep').prep();
    const cats = new Set(JSON.parse(localStorage.getItem('tfstudio_ge_selectedCats')));
    const excluded = new Set(JSON.parse(localStorage.getItem('tfstudio_ge_selectedCats_excl')));
    const pool = getPoolMaterials(cats, { excluded }).map(p => p.id).sort();
    assert.deepEqual(pool, ['SiO2', 'TiO2'], `the pool is TiO2 and SiO2 (${pool.join(', ')})`);
    const design = stepWith('synthesize', 'loadDesign').loadDesign('synthesis');
    const noop = () => {};
    const ge = R.run(() => useGradualEvolution({
        design, updateDesign: noop, checkpoint: noop, beginOptimization: noop, endOptimization: noop,
        getDesignRevision: () => 0, t: en,
    }));
    assert.equal(ge.dMin, 15, `Gradual Evolution opens at the lesson's MNT 15 nm with 1 nm stored (${ge.dMin})`);
    R.unmount();
}

// ── 5. Listed by level ──────────────────────────────────────────────────────
{
    const LEVELS = ['beginner', 'intermediate', 'advanced'];
    const ranks = lessons.map(l => LEVELS.indexOf(l.level));
    assert.ok(ranks.every(r => r >= 0), 'every lesson has a known level');
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'lessons are listed beginner, intermediate, advanced');
}

// ── 6. Every anchor a step points at exists ─────────────────────────────────
{
    const sources = [];
    const walk = dir => readdirSync(dir, { withFileTypes: true }).forEach(entry => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith('.js')) sources.push(readFileSync(path, 'utf8'));
    });
    walk(fileURLToPath(new URL('../src/components', import.meta.url)));
    const text = sources.join('\n');
    // An anchor is set as `tour: 'name'` or `'data-tour': 'name'`; one built from
    // an id, such as `ribbon-button-${id}`, counts when the rest of the name is
    // a string the components hold, as the id 'stack-formula' is.
    const KEY = String.raw`(?:\btour|'data-tour')\s*:\s*`;
    const literal = new Set([...text.matchAll(new RegExp(`${KEY}'([^']+)'`, 'g'))].map(m => m[1]));
    const prefixes = [...text.matchAll(new RegExp(`${KEY}\`([a-z]+(?:-[a-z]+)*-)\\$\\{`, 'g'))].map(m => m[1]);
    const built = anchor => prefixes.some(prefix => anchor.startsWith(prefix)
        && text.includes(`'${anchor.slice(prefix.length)}'`));
    const anchors = new Set(lessons.flatMap(l => l.steps.flatMap(s => [s.selector].flat()))
        .flatMap(selector => [...String(selector ?? '').matchAll(/data-tour="([^"]+)"/g)].map(m => m[1])));
    for (const anchor of anchors) {
        assert.ok(literal.has(anchor) || built(anchor), `a component sets the data-tour anchor ${anchor}`);
    }
}

console.log(`tutorials: ${lessons.length} lessons, structure, starters, setups and anchors OK`);
