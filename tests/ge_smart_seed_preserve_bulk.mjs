/**
 * Gradual Evolution's Smart starting design under Preserve bulk.
 *
 * The seed phase skips the smart starting design while Thick-seed handling is
 * Preserve bulk, which is the default, so the box was ticked out of the box and
 * did nothing. It is now unavailable while Preserve bulk is chosen, with a
 * tooltip that names the setting it needs, and available again, with its own
 * tooltip and the value it had, under Refine seed.
 *
 *   1. Preserve bulk: the box is disabled and the tooltip names Refine seed.
 *   2. Refine seed: the box is enabled with its help text.
 *   3. Changing Thick-seed handling in the open window changes the box, both
 *      ways, with no remount.
 *   4. A run in progress still disables it under Refine seed.
 *
 * Run: node tests/ge_smart_seed_preserve_bulk.mjs
 */
import { shimBrowserGlobals, loadApp, makeLocale, makeTheme } from './_uiShim.mjs';
import { makeHookRuntime } from './_hookHarness.mjs';

shimBrowserGlobals();
await loadApp();

const { LeftSidebar } = await import('../src/components/windows/optimization/gradualEvolution/gePanels.js');
const { Checkbox } = await import('../src/components/ui/Checkbox.js');
const { setSynthesisSeedMode, getSynthesisSeedMode } = await import('../src/utils/synthesis/synthesisConfig.js');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

const realReact = globalThis.React;
const runtime = makeHookRuntime();
const noop = () => {};
const t = makeLocale('en');
const c = makeTheme();
const props = (running = false) => ({
    catalogs: [], selectedCats: new Set(), excludedMats: new Set(),
    onToggleCat: noop, onSelectAllCats: noop, onClearCats: noop, onToggleMat: noop,
    operands: [], maxLayers: 60, maxGeCycles: 30, targetMF: 5e-4, dlsIter: 60, dMin: 1, maxMNT: 0,
    deepSearch: 0, onMaxLayers: noop, onMaxGeCycles: noop, onTargetMF: noop, onDlsIter: noop, onDMin: noop,
    onDeepSearch: noop, running, c, t,
});

// One render of the sidebar with the harness's useState in place of React's.
const render = (running) => {
    globalThis.React = { ...realReact, useState: runtime.React.useState };
    try { return runtime.render(() => LeftSidebar(props(running))); } finally { globalThis.React = realReact; }
};

const walk = (node, visit) => {
    if (Array.isArray(node)) { node.forEach(child => walk(child, visit)); return; }
    if (!node || typeof node !== 'object' || !node.props) return;
    visit(node);
    for (const key of ['children', 'everyday', 'advanced']) walk(node.props[key], visit);
};
const find = (tree, pred) => { let hit = null; walk(tree, n => { if (!hit && pred(n)) hit = n; }); return hit; };
const smartSeedBox = (tree) => {
    const label = find(tree, n => n.type === 'label' && find(n, m => m.type === 'span' && m.props.children === t.gradualEvolution.smartSeed));
    return { label, box: find(label, n => n.type === Checkbox) };
};
const seedSelect = (tree) => find(tree, n => n.type === 'select'
    && [].concat(n.props.children).some(o => o?.props?.value === 'preserve-bulk'));

const refineOnly = t.gradualEvolution.smartSeedRefineOnly(t.settings.synthSeedMode, t.settings.synthSeedRefine);

try {
    setSynthesisSeedMode('preserve-bulk');
    runtime.reset();
    let tree = render(false);
    let { label, box } = smartSeedBox(tree);
    ok(box.props.disabled === true, 'Preserve bulk: the box is disabled');
    ok(label.props.title === refineOnly && refineOnly.includes(t.settings.synthSeedRefine),
        `Preserve bulk: the tooltip names Refine seed (got "${label.props.title}")`);

    const select = seedSelect(tree);
    ok(!!select, 'the thick-seed select is among the advanced rows');
    select.props.onChange({ target: { value: 'refine' } });
    ok(getSynthesisSeedMode() === 'refine', 'the select still stores the mode');
    tree = render(false);
    ({ label, box } = smartSeedBox(tree));
    ok(box.props.disabled === false, 'Refine seed: the box is enabled without a remount');
    ok(label.props.title === t.gradualEvolution.smartSeedHelp, 'Refine seed: the help text is the tooltip');

    ({ box } = smartSeedBox(render(true)));
    ok(box.props.disabled === true, 'a run in progress disables the box under Refine seed');

    seedSelect(tree).props.onChange({ target: { value: 'preserve-bulk' } });
    ({ box } = smartSeedBox(render(false)));
    ok(box.props.disabled === true, 'back to Preserve bulk: the box is disabled again');

    setSynthesisSeedMode('refine');
    runtime.reset();
    ({ box } = smartSeedBox(render(false)));
    ok(box.props.disabled === false, 'a window opened under Refine seed has the box enabled');
} finally {
    globalThis.React = realReact;
}

console.log(fails === 0 ? 'PASS: ge_smart_seed_preserve_bulk' : `${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
