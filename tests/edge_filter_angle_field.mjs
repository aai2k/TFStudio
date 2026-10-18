/**
 * The Edge Filter's angle box takes 0°, so the search can say why there is
 * nothing to find at normal incidence: s and p are the same wave there.
 *
 *   1. 0 typed into the angle box reaches the window; a negative angle is held
 *      at 0.
 *   2. A search at 0° is refused with the message that says why.
 *
 * Run: node tests/edge_filter_angle_field.mjs
 */
import assert from 'node:assert/strict';
import { mount } from './_typeIntoField.mjs';

const { InputsPanel } = await import('../src/components/windows/design/edgeFilter/InputsPanel.js');
const { edgeSearchError } = await import('../src/utils/synthesis/edgeFilter.js');
const { getLocale } = await import('../src/constants/locales/index.js');

const t = getLocale('en');
const ef = t.edgeFilter;
const c = { bg: '#000', panel: '#111', field: '#111', text: '#eee', textDim: '#999', border: '#333', accent: '#39f', hover: '#222' };
const design = { frontLayers: [], backLayers: [] };

// ── 1. The angle box ─────────────────────────────────────────────────────────
for (const [typed, expected] of [['0', 0], ['-5', 0]]) {
    const set = [];
    const state = {
        inputs: { pass: 'short', edgeLambda: 510, angle: 45, periods: 19, lower: 0.1, upper: 1, step: 0.05,
                  incidentMat: 'builtin:Air', substrateMat: 'builtin:BK7', matA: 'builtin:SiO2', matB: 'builtin:TiO2' },
        setInput: (key, value) => set.push([key, value]),
        running: false, progress: null, prepared: { absorbing: [] }, search() {}, stop() {},
    };
    // The box that shows 45 before anything is typed, found again by its place.
    let at = -1;
    const angleBox = (inputs) => {
        if (at < 0) at = inputs.findIndex(input => input.props.value === '45');
        return inputs[at];
    };
    mount(InputsPanel, { state, c, t, ef, design }, angleBox).type(typed).leave();
    assert.deepEqual(set, [['angle', expected]], `the angle box takes ${typed} as ${expected}°`);
}

// ── 2. A search at 0° ────────────────────────────────────────────────────────
{
    const request = { pass: 'short', edgeLambda: 510, nIncident: 1, angleDeg: 0, nA: 1.46, nB: 2.4, lower: 0.1, upper: 1, step: 0.05 };
    assert.equal(edgeSearchError(request), 'angle', 'a search at normal incidence is refused');
    assert.match(ef.errors.angle, /normal incidence/, 'with the message that says why');
}

console.log('edge_filter_angle_field: passed');
