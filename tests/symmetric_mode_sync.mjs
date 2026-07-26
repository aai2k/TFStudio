/**
 * In symmetric mode the stored back stack must stay the mirror of the front.
 *
 * Optimizers derive the mirror on the fly, but save / report / export read the
 * STORED back layers. Ordinary mouse edits (add, remove, thickness, material,
 * move, duplicate) and stack replacements such as a Zemax import went through
 * one-sided mutations, so the two stacks drifted apart and different windows
 * evaluated different physical designs.
 *
 * Drives the real DesignProvider through the same context API the layer list
 * uses.
 *
 * Run: node tests/symmetric_mode_sync.mjs
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { DesignProvider, useDesign } = await import('../src/state/DesignContext.js');

let passed = 0;
function ok(condition, message) {
    if (!condition) throw new Error(message);
    passed++;
}

// Render the provider once and capture its context value, then drive the design
// through it. `designs` is controlled here, so every write lands in `store`.
const DESIGN_ID = 'sym-1';
const store = {
    [DESIGN_ID]: {
        id: DESIGN_ID, name: 'Symmetric', surfaceMode: 'symmetric',
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1 },
        frontLayers: [
            { id: 'f1', material: 'TiO2', thickness: 60, locked: false },
            { id: 'f2', material: 'SiO2', thickness: 95, locked: false },
        ],
        backLayers: [
            { id: 'b-f2', material: 'SiO2', thickness: 95, locked: false },
            { id: 'b-f1', material: 'TiO2', thickness: 60, locked: false },
        ],
    },
};

let api = null;
function Probe() {
    api = useDesign();
    return React.createElement('span');
}
renderToStaticMarkup(React.createElement(DesignProvider, {
    activeDesignId: DESIGN_ID,
    designs: store,
    onDesignChange: (id, design) => { store[id] = design; },
}, React.createElement(Probe)));

const design = () => store[DESIGN_ID];
const front = () => design().frontLayers;
const back = () => design().backLayers;

// The back stack a symmetric design must have: the front, reversed, since the
// back coating is illuminated from the substrate side.
function mirrorMatches() {
    const f = front(), b = back();
    if (!Array.isArray(b) || b.length !== f.length) return false;
    return f.every((layer, i) => {
        const other = b[f.length - 1 - i];
        return other.material === layer.material
            && other.thickness === layer.thickness
            && !!other.locked === !!layer.locked;
    });
}

ok(mirrorMatches(), 'the fixture starts mirrored');

// ── Every ordinary layer edit keeps the two sides identical ─────────────────
api.updateLayer('front', 'f1', { thickness: 123 });
ok(front()[0].thickness === 123, 'thickness edit reaches the front stack');
ok(mirrorMatches(), 'thickness edit mirrors to the back stack');

api.updateLayer('front', 'f2', { material: 'Nb2O5' });
ok(mirrorMatches(), 'material change mirrors');

api.updateLayer('front', 'f1', { locked: true });
ok(mirrorMatches(), 'lock toggle mirrors');

api.addLayer('front');
ok(front().length === 3, 'add reaches the front stack');
ok(mirrorMatches(), 'add mirrors');

api.duplicateLayer('front', 'f1');
ok(front().length === 4, 'duplicate reaches the front stack');
ok(mirrorMatches(), 'duplicate mirrors');

api.moveLayer('front', 'f1', 'down');
ok(mirrorMatches(), 'move mirrors');

api.removeLayer('front', 'f2');
ok(front().every(l => l.id !== 'f2'), 'remove reaches the front stack');
ok(mirrorMatches(), 'remove mirrors');

// ── A wholesale stack replacement (Zemax import, wizards) ───────────────────
api.updateDesign({
    frontLayers: [
        { id: 'z1', material: 'Ta2O5', thickness: 40, locked: false },
        { id: 'z2', material: 'MgF2', thickness: 88, locked: false },
        { id: 'z3', material: 'Ta2O5', thickness: 12, locked: false },
    ],
});
ok(front().length === 3 && back().length === 3, 'an imported stack replaces both sides');
ok(mirrorMatches(), 'an imported stack mirrors');

// A back stack handed in by a caller is replaced: in symmetric mode the back
// side is derived, not edited.
api.updateDesign({ backLayers: [{ id: 'junk', material: 'Air', thickness: 1 }] });
ok(mirrorMatches(), 'a back stack written directly is re-derived from the front');

// ── Other surface modes keep both sides independent ─────────────────────────
api.updateDesign({
    surfaceMode: 'both_independent',
    backLayers: [{ id: 'ib1', material: 'SiO2', thickness: 200, locked: false }],
});
api.updateLayer('front', 'z1', { thickness: 999 });
ok(back().length === 1 && back()[0].thickness === 200,
   'outside symmetric mode a front edit leaves the back stack alone');

// Switching back into symmetric mode re-derives the back stack.
api.updateDesign({ surfaceMode: 'symmetric' });
ok(mirrorMatches(), 'switching into symmetric mode mirrors the front');

console.log(`symmetric_mode_sync: ${passed} passed`);
