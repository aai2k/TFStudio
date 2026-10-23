/**
 * Integral Values in collimated light: a design whose spectrum cannot be
 * computed, here one with a layer material that resolves nowhere, reports an
 * evaluation error instead of having no spectrum and no error, which left the
 * window showing "Computing…" for ever.
 *
 * Run: node tests/integral_values_unresolved_material.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { useIntegralValues } = await import('../src/components/windows/analysis/integralValues/useIntegralValues.js');

const design = {
    name: 'unresolved', incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
    substrate: { material: 'builtin:BK7', thickness: 1 },
    frontLayers: [{ material: 'user:NoSuchMaterial', thickness: 100 }], backLayers: [],
};
let model;
const Probe = () => { model = useIntegralValues(design, 'front'); return null; };
renderToStaticMarkup(React.createElement(Probe));

assert.equal(model.spectrum, null, 'no spectrum is computed');
assert.ok(model.evaluationError, 'and the window is told the evaluation failed');
assert.equal(model.coneActive, false, 'without a cone, so it names the spectrum, not the cone response');

console.log('PASS: integral_values_unresolved_material');
