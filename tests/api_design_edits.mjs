/**
 * The headless API's design edits (src/api/designEdits.js) against the
 * Design Editor's own dialogs and buttons; api_design_edits_checks.mjs checks
 * them on designs made by hand and against other parts of the app.
 *
 *   1. quantize gives what the Round / quantize dialog's Apply hands on, the
 *      dialog mounted and its method chosen and value typed as a person does:
 *      with the dialog's opening values when given none, and in each mode at
 *      a spread of values, on the corpus designs, each with a locked layer
 *      made in, on every side the Design Editor lets you edit.
 *   2. perturb gives what the Perturb dialog's Apply hands on when the
 *      dialog's draws come from the seed's stream, at its opening kick and a
 *      typed one; the same seed repeats, another differs, and the seed a call
 *      without one reports repeats its result.
 *   3. flipLayers and copySide give the design the Invert and Copy to
 *      back / front buttons update to; a copy's layers have new ids.
 *   4. The side edited by default is the front, or the back of a design
 *      coated on the back alone; the side refused is the side the Design
 *      Editor disables, in every surface mode, each scored on its side and on
 *      the whole part.
 *
 * Run: node tests/api_design_edits.mjs
 */
import { isDeepStrictEqual } from 'node:util';
import { mount } from './_typeIntoField.mjs';
import { fixtureFile, manifest } from './_apiCorpus.mjs';

const api = await import('../src/api/index.js');
const { QuantizeDialog, PerturbDialog } = await import('../src/components/windows/design/designEditor/LayerToolDialogs.js');
const { copyToOther, invertActiveSide } = await import('../src/components/windows/design/designEditor/layerActions.js');
const { QUANTIZE_DEFAULTS, PERTURB_DEFAULT_PERCENT } = await import('../src/components/windows/design/designEditor/layerTools.js');
const { mirrorLayers } = await import('../src/utils/physics/optimizer.js');
const { mulberry32 } = await import('../src/utils/monitoring/monitoringSim/rng.js');
const { getLocale } = await import('../src/constants/locales/index.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const all = conditions => conditions.every(Boolean);
const refusedCode = fn => { try { fn(); return null; } catch (err) { return err.code; } };

await api.init();
const t = getLocale('en');
const c = { text: '#eee', textDim: '#999', border: '#333', bg: '#000', panel: '#111', accent: '#39f', error: '#f33', success: '#3f3' };

// The side the Design Editor's tab disables (DesignEditor.js), restated.
const DISABLED = { symmetric: { side: 'back', total: 'back' }, front_only: { side: 'back', total: null }, back_only: { side: 'front', total: null } };
const disabledSide = design => DISABLED[design.surfaceMode || 'front_only']?.[design.mfEvalMode || 'side'] ?? null;
const keyOf = side => (side === 'front' ? 'frontLayers' : 'backLayers');

// A corpus design with its second layer from the substrate on each side
// locked, a symmetric back kept the mirror of its front.
function withLock(design) {
    const lock = (layers, at) => layers.map((layer, i) => (i === at ? { ...layer, locked: true } : layer));
    const front = lock(design.frontLayers, design.frontLayers.length - 2);
    const back = design.surfaceMode === 'symmetric' ? mirrorLayers(front) : lock(design.backLayers, 1);
    return { ...design, frontLayers: front, backLayers: back };
}
const CORPUS = Object.entries(manifest.fixtures).filter(([, fixture]) => Object.keys(fixture.variants).join() === 'default').map(([name]) => name);
const DESIGNS = CORPUS.map(name => ({ name, design: withLock(api.openDesign(fixtureFile(name))) }));
const CASES = DESIGNS.flatMap(({ name, design }) => ['front', 'back']
    .filter(side => side !== disabledSide(design) && design[keyOf(side)].length)
    .map(side => ({ name, design, side })));
ok('the corpus gives designs to edit on the front and on the back', all([CASES.some(k => k.side === 'front'), CASES.some(k => k.side === 'back')]), `${CASES.length}`);

// Every node of `type` in a rendered tree, in the order they are drawn.
function found(node, type, out = []) {
    if (!node || typeof node !== 'object') return out;
    if (node.type === type) out.push(node);
    [node.props?.children].flat(Infinity).forEach(child => found(child, type, out));
    return out;
}
// What a dialog's Apply hands on after `act` on the mounted dialog.
function applied(Dialog, design, side, act = () => {}) {
    const designs = [];
    const dialog = mount(Dialog, { design, side, c, t, onApply: next => designs.push(next), onClose() {} });
    act(dialog);
    found(dialog.render(), 'button').at(-1).props.onClick();
    return designs[0];
}
const choose = mode => dialog => found(dialog.render(), 'select')[0].props.onChange({ target: { value: mode } });
// The labels of the pairs [label, got, expected] whose two differ.
const differing = pairs => pairs.filter(([, got, expected]) => !isDeepStrictEqual(got, expected)).map(([label]) => label);

// ── 1. quantize is the Round / quantize dialog ─────────────────────────────
{
    const SETTINGS = [
        { mode: 'decimals', value: 0 }, { mode: 'decimals', value: 3 }, { mode: 'step', value: 0.5 },
        { mode: 'step', value: 2.3 }, { mode: 'qwot', value: 1 }, { mode: 'qwot', value: 0.25 },
    ];
    const typed = (mode, value) => dialog => { choose(mode)(dialog); dialog.type(String(value)); };
    const wrong = differing(CASES.flatMap(({ name, design, side }) => [
        [`${name} ${side} opening`, api.quantize(design, { side }), applied(QuantizeDialog, design, side)],
        ...SETTINGS.map(({ mode, value }) => [`${name} ${side} ${mode} ${value}`, api.quantize(design, { mode, value, side }), applied(QuantizeDialog, design, side, typed(mode, value))]),
    ]));
    ok(`on ${CASES.length} corpus sides, quantize gives the Round dialog's Apply, at its opening values and in each mode`, !wrong.length, wrong.slice(0, 5).join(', '));
    const { design } = DESIGNS[0];
    ok('a mode given without a value takes the value the dialog opens it with', all([QUANTIZE_DEFAULTS.value.decimals === 2,
        isDeepStrictEqual(api.quantize(design, { mode: 'decimals' }), applied(QuantizeDialog, design, 'front', choose('decimals')))]));
    const thin = { ...api.newDesign({ name: 'Thin' }), frontLayers: [{ id: 'a', material: 'SiO2', thickness: 0.04, locked: false }] };
    ok('a layer thinner than half a step rounds to 0 nm, as in the dialog', all([api.quantize(thin).frontLayers[0].thickness === 0,
        isDeepStrictEqual(api.quantize(thin), applied(QuantizeDialog, thin, 'front'))]));
}

// ── 2. perturb is the Perturb dialog ───────────────────────────────────────
{
    const random = Math.random;
    // The Perturb dialog's Apply with its draws from the seed's stream.
    const seeded = (design, side, seed, act) => {
        Math.random = mulberry32(seed);
        try { return applied(PerturbDialog, design, side, act); } finally { Math.random = random; }
    };
    const wrong = differing(CASES.flatMap(({ name, design, side }, i) => [
        [`${name} ${side}`, api.perturb(design, { side, seed: 1000 + i }), { design: seeded(design, side, 1000 + i), seed: 1000 + i }],
        [`${name} ${side} 7.5`, api.perturb(design, { side, seed: i + 1, percent: 7.5 }).design, seeded(design, side, i + 1, dialog => dialog.type('7.5'))],
    ]));
    ok(`on ${CASES.length} corpus sides, perturb gives the Perturb dialog's Apply when its draws come from the seed, at its opening kick and a typed one`,
        all([!wrong.length, PERTURB_DEFAULT_PERCENT === 2]), wrong.slice(0, 5).join(', '));
    const { design } = DESIGNS[0];
    const fresh = api.perturb(design);
    ok('the same seed repeats, another differs, and a fresh seed is reported and repeats', all([
        isDeepStrictEqual(api.perturb(design, { seed: 9 }), api.perturb(design, { seed: 9 })),
        !isDeepStrictEqual(api.perturb(design, { seed: 9 }).design, api.perturb(design, { seed: 10 }).design),
        Number.isInteger(fresh.seed), isDeepStrictEqual(api.perturb(design, { seed: fresh.seed }), fresh),
    ]), String(fresh.seed));
    ok('null takes a fresh seed, as monteCarlo does', Number.isInteger(api.perturb(design, { seed: null }).seed));
}

// ── 3. flipLayers and copySide are the Invert and Copy buttons ─────────────
{
    // The design the button `action` updates `design` to.
    const pressed = (action, design, side) => {
        let patch = null;
        action(design, next => { patch = next; }, side);
        return { ...design, ...patch };
    };
    const noIds = d => ({ ...d, frontLayers: d.frontLayers.map(({ id, ...layer }) => layer), backLayers: d.backLayers.map(({ id, ...layer }) => layer) });
    const flipWrong = differing(CASES.map(({ name, design, side }) => [`${name} ${side}`, api.flipLayers(design, { side }), pressed(invertActiveSide, design, side)]));
    ok(`on ${CASES.length} corpus sides, flipLayers gives the design Invert updates to`, !flipWrong.length, flipWrong.join(', '));
    const copies = CASES.map(({ name, design, side }) => ({ name, design, side, copied: api.copySide(design, { from: side }) }));
    const copyWrong = differing(copies.map(({ name, design, side, copied }) => [`${name} ${side}`, noIds(copied), noIds(pressed(copyToOther, design, side))]));
    const newIds = copies.every(({ design, side, copied }) => {
        const ids = copied[keyOf(side === 'front' ? 'back' : 'front')].map(layer => layer.id);
        const old = new Set([...design.frontLayers, ...design.backLayers].map(layer => layer.id));
        return new Set(ids).size === ids.length && ids.every(id => !old.has(id));
    });
    ok('and copySide the design Copy to back or Copy to front updates to, each copied layer with a new id of its own', all([!copyWrong.length, newIds]), copyWrong.join(', '));
    const front = api.stackFromFormula(api.newDesign({ name: 'Copy' }), { formula: 'H L M' });
    const both = api.copySide(front, { from: 'front' });
    ok('a copy keeps the stack outward from the substrate and leaves the surface mode', all([both.surfaceMode === front.surfaceMode,
        isDeepStrictEqual(both.backLayers.map(l => l.material), [...front.frontLayers].reverse().map(l => l.material))]));
}

// ── 4. The side edited ─────────────────────────────────────────────────────
{
    const stack = api.stackFromFormula(api.newDesign({ name: 'Sides' }), { formula: '(HL)^2' });
    const backOf = surfaceMode => (surfaceMode === 'symmetric' ? mirrorLayers(stack.frontLayers) : stack.frontLayers.map(l => ({ ...l, id: `b${l.id}` })));
    const designs = ['front_only', 'back_only', 'both_independent', 'symmetric'].flatMap(surfaceMode => ['side', 'total']
        .map(mfEvalMode => ({ ...stack, surfaceMode, mfEvalMode, backLayers: backOf(surfaceMode) })));
    const edits = [
        (design, side) => api.scaleThicknesses(design, { factor: 2, side }), (design, side) => api.quantize(design, { side }),
        (design, side) => api.perturb(design, { side, seed: 1 }), (design, side) => api.flipLayers(design, { side }),
        (design, side) => api.copySide(design, { from: side }),
    ];
    const wrongRefusals = designs.flatMap(design => ['front', 'back'].map(side => ({ design, side })))
        .filter(({ design, side }) => edits.some(edit => (refusedCode(() => edit(design, side)) === 'closedSide') !== (side === disabledSide(design))))
        .map(({ design, side }) => `${design.surfaceMode} ${design.mfEvalMode} ${side}`);
    const wrongDefaults = designs.filter(design => !isDeepStrictEqual(api.flipLayers(design), api.flipLayers(design, { side: design.surfaceMode === 'back_only' ? 'back' : 'front' })))
        .map(design => `${design.surfaceMode} ${design.mfEvalMode}`);
    ok('each edit refuses exactly the side the Design Editor disables, in every surface mode scored on its side and on the whole part, and edits the front, or the back of a back_only design, by default',
        all([!wrongRefusals.length, !wrongDefaults.length]), [...wrongRefusals, ...wrongDefaults].join('; '));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
