/**
 * The row under the plot (chrome/badgeRow.js) in the analysis windows that
 * show the Eval badge: the badge sits in that row, directly over the window's
 * first strip, and on no strip; the Cone badge joins it in the windows that
 * average over the cone, and in no other; the Export control stays on the
 * Results strip. A window with no environment choice draws the row without a
 * droplist.
 *
 * Optical Evaluation's row, with its droplist, is checked in
 * optical_evaluation_environments.mjs.
 *
 * Run: node tests/analysis_badge_row.mjs
 */
import assert from 'node:assert/strict';
import './_kernel.mjs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});

const DIR = '../src/components/windows/analysis';
// Each window, and whether it averages over the cone and so shows its badge.
const WINDOWS = [
    { name: 'WavelengthAngleMap', path: 'wavelengthAngleMap/WavelengthAngleMap.js', cone: false },
    { name: 'SystematicDeviations', path: 'systematicDeviations/SystematicDeviations.js', cone: false },
    { name: 'Inhomogeneities', path: 'inhomogeneities/Inhomogeneities.js', cone: false },
    { name: 'StressAnalysis', path: 'stressAnalysis/StressAnalysis.js', cone: false },
    { name: 'RoughnessScattering', path: 'roughnessScattering/RoughnessScattering.js', cone: false },
    { name: 'IntegralValues', path: 'integralValues/IntegralValues.js', cone: true },
    { name: 'ColorEvaluation', path: 'colorEvaluation/ColorEvaluation.js', cone: true },
    { name: 'ErrorAnalysis', path: 'errorAnalysis/ErrorAnalysis.js', cone: false },
];

const h = React.createElement;
const c = makeTheme();
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const count = (html, text) => html.split(text).length - 1;

// The design every window renders, under a cone or not.
const CONE = { enabled: true, halfAngleDeg: 4, distribution: 'uniform', gridPoints: 2 };
const designWith = cone => ({ ...makeSampleDesign(), ...(cone ? { cone: CONE } : {}) });

for (const code of ['en', 'ru']) {
    const t = makeLocale(code);
    const evalTip = `<span title="${esc(t.modeBar.evalBadgeTip)}"`;
    const coneTip = `<span title="${esc(t.designEditor.cone.enableTip)}"`;
    for (const { name, path, cone } of WINDOWS) {
        const Window = (await import(`${DIR}/${path}`))[name];
        for (const coned of [false, true]) {
            const html = renderToStaticMarkup(withDesign(h(Window, { c, theme: c, t }), designWith(coned)));
            const strip = html.indexOf('<section');
            const at = html.indexOf(evalTip);
            assert.ok(strip > 0, `${code} ${name}: the window draws its strips`);
            assert.equal(count(html, evalTip), 1, `${code} ${name}: one Eval badge`);
            assert.ok(at > 0 && at < strip, `${code} ${name}: the Eval badge above the first strip, on none of them`);
            // Between the badges and the first strip only the row's closing tags.
            const tail = html.slice(at, strip).replace(/<span title="[^"]*" style="[^"]*">[^<]*<\/span>/g, '');
            assert.equal(tail, '</div></div>', `${code} ${name}: in the row directly over the first strip`);
            const badges = count(html.slice(at, strip), coneTip);
            assert.equal(badges, cone && coned ? 1 : 0,
                `${code} ${name}: ${cone ? 'the Cone badge beside it while a cone is on' : 'no Cone badge'}`);
            assert.equal(count(html, coneTip), badges, `${code} ${name}: and no Cone badge elsewhere`);
            assert.ok(!html.includes(esc(t.analysisChrome.environmentTip)), `${code} ${name}: no environment droplist`);
            assert.ok(html.indexOf(`>${esc(t.dataTable.export)}<`) > strip, `${code} ${name}: Export stays on a strip`);
        }
    }
}

console.log('PASS analysis_badge_row');
