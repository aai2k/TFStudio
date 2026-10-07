/**
 * With no design selected there is nothing to put a coating into: Apply in the
 * Coating Library is off and says a design is needed. The action behind the
 * button, called anyway, writes nothing, pushes no undo step and reports why.
 * With a design open the same button is on and the same action goes through.
 * Nor is there a coating of the design to save, so Save current coating is off
 * the same way.
 *
 * The Coating Library stays mounted with no design open, because browsing the
 * coatings needs none; the windows that only work on a design are not mounted
 * at all then (tests/no_design_window_gate.mjs).
 *
 * The window runs here as its hooks run in the app, through the hook harness,
 * so an action can be taken and the window drawn again afterwards.
 * Run: node tests/no_design_apply_refused.mjs
 */
import assert from 'node:assert/strict';
import RealReact from 'react';
import { makeHookRuntime } from './_hookHarness.mjs';
import { loadApp, makeDesignCtx, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();

// Every window module reads its hooks off the global React as it loads, so the
// global delegates to whichever harness is drawing.
let drawing = null;
let designCtx = null;
let DesignContext = null;
const delegate = name => (...args) => drawing.React[name](...args);
globalThis.React = {
    ...RealReact,
    useState: delegate('useState'), useRef: delegate('useRef'), useMemo: delegate('useMemo'),
    useCallback: delegate('useCallback'), useEffect: delegate('useEffect'), useLayoutEffect: delegate('useLayoutEffect'),
    useContext: context => (context === DesignContext ? designCtx : context._currentValue),
};
({ DesignContext } = await loadApp());

const { CoatingLibrary } = await import('../src/components/windows/design/coatingLibrary/CoatingLibrary.js');
const { coatingLibrarySession } = await import('../src/components/windows/design/coatingLibrary/sessionState.js');
const { BUILTIN_COATINGS } = await import('../src/utils/coatingLibrary/builtin/index.js');

const c = makeTheme();
const t = makeLocale();
const OPEN_STATES = [false, true];

/** The active design as the window sees it, and every write and undo step that reaches it. */
function openDesign(hasActiveDesign) {
    const writes = [];
    designCtx = {
        ...makeDesignCtx(makeSampleDesign()),
        hasActiveDesign,
        updateDesign: patch => writes.push(['update', patch]),
        checkpoint: () => writes.push(['checkpoint']),
    };
    return writes;
}

// Every element of a window's tree, the components named in `open` drawn by
// calling them.
const elements = (node, open, found = []) => {
    if (Array.isArray(node)) node.forEach(child => elements(child, open, found));
    else if (node && typeof node === 'object' && node.props) {
        found.push(node);
        if (open.includes(node.type?.name)) elements(node.type(node.props), open, found);
        else elements(node.props.children, open, found);
    }
    return found;
};

function draw(runtime, Window, open) {
    drawing = runtime;
    return elements(runtime.render(() => Window({ c, t, setInputDialog: () => {} })), open);
}

const component = (found, name) => found.find(node => node.type?.name === name);
const button = (found, label) => found.find(node => node.type === 'button' && node.props.children === label);
// Whether a button is off, and what it says when hovered.
const state = node => [!!node.props.disabled, node.props.title];

// ── Coating Library: Apply ───────────────────────────────────────────────────
{
    const ts = t.coatingLibrary;
    const entry = BUILTIN_COATINGS[0];
    const show = runtime => {
        const found = draw(runtime, CoatingLibrary, ['ApplyBar']);
        return { bar: component(found, 'ApplyBar'), apply: button(found, ts.apply) };
    };
    for (const hasActiveDesign of OPEN_STATES) {
        coatingLibrarySession.reset();
        coatingLibrarySession.write(null, { selectedId: entry.id });
        const writes = openDesign(hasActiveDesign);
        const runtime = makeHookRuntime();
        const shown = show(runtime);
        shown.bar.props.onApply();
        const message = show(runtime).bar.props.message;
        if (!hasActiveDesign) {
            assert.deepEqual(state(shown.apply), [true, ts.applyNoDesign], 'no design: Apply is off and says why');
            assert.deepEqual(writes, [], 'no design: applying writes nothing and pushes no undo step');
            assert.equal(message, ts.applyNoDesign, 'no design: the bar says a design is needed');
        } else {
            assert.deepEqual(state(shown.apply), [false, undefined], 'a design open: Apply is on');
            assert.deepEqual(writes.map(([kind]) => kind), ['checkpoint', 'update'], 'one undo step, then the stack');
            assert.equal(writes[1][1].frontLayers.length, entry.layers.length, 'the coating goes on the front');
            assert.ok(message.startsWith(ts.applied(entry.layers.length, ts.sideFront.toLowerCase())),
                'and the bar reports it');
        }
    }
    coatingLibrarySession.reset();
}

// ── Coating Library: Save current coating ────────────────────────────────────
// It saves a side of the open design. With none open the only design is the
// placeholder, so the button is off and says a design is needed.
{
    const ts = t.coatingLibrary;
    for (const hasActiveDesign of OPEN_STATES) {
        coatingLibrarySession.reset();
        openDesign(hasActiveDesign);
        const save = button(draw(makeHookRuntime(), CoatingLibrary, ['FilterBar']), ts.saveCurrent);
        assert.deepEqual(state(save), hasActiveDesign ? [false, ts.saveCurrentTip] : [true, t.windowChrome.noDesign],
            `design open: ${hasActiveDesign}`);
    }
    coatingLibrarySession.reset();
}

console.log('no_design_apply_refused: passed');
