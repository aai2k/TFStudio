/**
 * Filter Design wizard step render test.
 *
 * The window smoke test renders the wizard shell, which only ever shows step 1.
 * This renders all six steps, in every locale, so a missing string or a dropped
 * prop in a later step is caught here rather than by clicking through to it.
 *
 * `useEffect` does not run under server render, so chart init and worker wiring
 * stay out of scope; what this locks down is that each step RENDERS.
 *
 * Run: node tests/filter_design_wizard_steps.mjs
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { shimBrowserGlobals, loadApp, makeTheme, makeLocale } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { DEFAULTS, prototypeCandidate } =
    await import('../src/components/windows/optimization/filterDesignWizard/model.js');
const { StepMaterials } = await import('../src/components/windows/optimization/filterDesignWizard/StepMaterials.js');
const { StepParams } = await import('../src/components/windows/optimization/filterDesignWizard/StepParams.js');
const { StepCavities } = await import('../src/components/windows/optimization/filterDesignWizard/StepCavities.js');
const { StepPrototype } = await import('../src/components/windows/optimization/filterDesignWizard/StepPrototype.js');
const { StepSearch } = await import('../src/components/windows/optimization/filterDesignWizard/StepSearch.js');
const { StepAdjust } = await import('../src/components/windows/optimization/filterDesignWizard/StepAdjust.js');

let fails = 0;
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); fails++; } };

/** Render one step on both axis settings, reporting a throw as a failure. */
function renderStep(label, Step, props) {
    for (const logAxis of [false, true]) {
        try {
            const html = renderToStaticMarkup(React.createElement(Step, { ...props, p: { ...props.p, logAxis } }));
            ok(html.length > 0, `${label}: rendered nothing`);
        } catch (e) {
            console.error(`FAIL: ${label} threw: ${e && e.message ? e.message : e}`);
            fails++;
        }
    }
}

const STEPS = [
    ['StepMaterials', StepMaterials], ['StepParams', StepParams], ['StepCavities', StepCavities],
    ['StepPrototype', StepPrototype], ['StepSearch', StepSearch], ['StepAdjust', StepAdjust],
];
const c = makeTheme();

for (const locale of ['en', 'ru', 'zh', 'it']) {
    const t = makeLocale(locale);
    if (!t?.filterDesign) { console.error(`FAIL: locale ${locale} has no filterDesign block`); fails++; continue; }
    // A design is selected from step 4 on, so steps 5 and 6 render a real one.
    const p = { ...DEFAULTS, seedMirror: 8, seedSpacer: 1 };
    p.selected = prototypeCandidate(p, 4, 8, 1);
    for (const [name, Step] of STEPS) renderStep(`${locale}/${name}`, Step, { p, set: () => {}, c, t });
    // Holding the passband to an angle changes the step-5 table's columns.
    renderStep(`${locale}/StepSearch at 15°`, StepSearch, { p: { ...p, holdPassbandDeg: 15 }, set: () => {}, c, t });
    // Every string the steps reach for has to exist in this locale, or the UI
    // shows "undefined" rather than throwing.
    const T = t.filterDesign;
    for (const key of ['axisLinear', 'axisLog']) ok(typeof T[key] === 'string', `${locale}: filterDesign.${key} missing`);
    for (const key of ['clearOnStart', 'clearHistory', 'iteration', 'start', 'stop', 'empty', 'restarts', 'holdPassband', 'holdPassbandHint']) {
        ok(typeof T.step5[key] === 'string', `${locale}: filterDesign.step5.${key} missing`);
    }
    for (const key of ['tableHeader', 'spacerMat', 'spacerAny', 'extMirror', 'spacerOrder']) {
        ok(typeof T.step4[key] === 'string', `${locale}: filterDesign.step4.${key} missing`);
    }
    ok(T.step4.colWidth === undefined, `${locale}: filterDesign.step4.colWidth is orphaned and should be gone`);
}

if (fails === 0) console.log('All filter-design wizard steps render.');
else { console.error(`\n${fails} failure(s).`); process.exit(1); }
