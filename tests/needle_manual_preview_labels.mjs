/**
 * Needle Manual's insertion preview labels each figure for what it is: the
 * change in the optical merit reads "ΔOMF:", not the label of the full merit.
 *
 * Run: node tests/needle_manual_preview_labels.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { PreviewPanel } = await import('../src/components/windows/optimization/needleManual/PreviewPanel.js');

const t = makeLocale();
const html = renderToStaticMarkup(React.createElement(PreviewPanel, {
    selected: { materialId: 'builtin:SiO2', z: 40, intra: false }, hostInfo: { gapLabel: 'between 1 and 2' },
    dNew: 5, dRange: [1, 50], predictedOMF: 0.04, omf0: 0.05, predictedProvisional: false, omf0Provisional: false,
    evaluationBusy: false, picking: false, design: { frontLayers: [], backLayers: [] }, c: makeTheme(), t,
}));
assert.ok(html.includes(t.needleManual.omf0) && html.includes(t.needleManual.omfPred), 'both optical merits are shown');
assert.ok(html.includes(t.needleManual.dOMF), 'and their difference is labelled ΔOMF');
assert.ok(!html.includes('ΔMF:'), 'not ΔMF');
console.log('PASS needle_manual_preview_labels');
