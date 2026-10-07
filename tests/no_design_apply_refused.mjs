/**
 * With no design selected there is nothing to put a coating, a preset or a
 * saved merit function into: Apply in the Coating Library, Apply and Load of a
 * preset in Specification, and Load MF and the wizard's Generate in the Merit
 * Function Editor are off and say a design is needed. The action behind each
 * button, called anyway, writes nothing, pushes no undo step, reads no file,
 * moves the wizard's Start at row nowhere and reports why. With a design open
 * the same buttons are on and the same actions go through.
 *
 * The windows run here as their hooks run in the app, through the hook
 * harness, so an action can be taken and the window drawn again afterwards.
 * Run: node tests/no_design_apply_refused.mjs
 */
import assert from 'node:assert/strict';
import RealReact from 'react';
import { makeHookRuntime } from './_hookHarness.mjs';
import { loadApp, makeDesignCtx, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();

// Every window module reads its hooks off the global React as it loads, so the
// global delegates to whichever harness is drawing, one per window.
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

// The saved preset files the windows read, with a record of every read.
const fileReads = [];
const savedFiles = {
    loadQualifierPreset: async name => {
        fileReads.push(name);
        return { success: true, preset: { qualifiers: [{ kind: 'T_AVG', cmp: 'ge', target: 99 }] } };
    },
    loadMFPreset: async name => {
        fileReads.push(name);
        return { success: true, preset: { operands: [{ id: 'o1', type: 'TAVE', target: 99, weight: 1 }] } };
    },
};
globalThis.electronAPI = new Proxy(savedFiles, {
    get: (files, key) => files[key] || (() => Promise.resolve(null)),
});

const { CoatingLibrary } = await import('../src/components/windows/design/coatingLibrary/CoatingLibrary.js');
const { coatingLibrarySession } = await import('../src/components/windows/design/coatingLibrary/sessionState.js');
const { BUILTIN_COATINGS } = await import('../src/utils/coatingLibrary/builtin/index.js');
const { Specification } = await import('../src/components/windows/design/specification/Specification.js');
const { QUALIFIER_PRESETS } = await import('../src/utils/synthesis/qualifierPresets.js');
const { MeritFunctionEditor } = await import(
    '../src/components/windows/optimization/meritFunctionEditor/MeritFunctionEditor.js');
const { meritWizardSession } = await import('../src/components/windows/optimization/meritFunctionEditor/sessionState.js');

const c = makeTheme();
const t = makeLocale();
const OPEN_STATES = [false, true];

/** The active design as the windows see it, and every write and undo step that reaches it. */
function openDesign(hasActiveDesign) {
    const writes = [];
    designCtx = {
        ...makeDesignCtx(makeSampleDesign()),
        hasActiveDesign,
        updateDesign: patch => writes.push(['update', patch]),
        checkpoint: () => writes.push(['checkpoint']),
    };
    fileReads.length = 0;
    return writes;
}

// Every element of a window's tree, the components named in `open` drawn by
// calling them; a table's toolbar slot is walked as its children are.
const elements = (node, open, found = []) => {
    if (Array.isArray(node)) node.forEach(child => elements(child, open, found));
    else if (node && typeof node === 'object' && node.props) {
        found.push(node);
        if (open.includes(node.type?.name)) elements(node.type(node.props), open, found);
        else elements([node.props.children, node.props.toolbarStart], open, found);
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

// ── Specification: Apply of a built-in preset, Load of a saved one ───────────
{
    const ts = t.specification;
    const preset = QUALIFIER_PRESETS[0].id;
    const show = runtime => {
        const found = draw(runtime, Specification, ['Toolbar']);
        const picker = title => found.find(node => node.type === 'select' && node.props.title === title);
        return {
            toolbar: component(found, 'Toolbar'), builtin: picker(ts.presetTip), saved: picker(ts.diskTip),
            apply: button(found, ts.apply), load: button(found, ts.load),
        };
    };
    for (const hasActiveDesign of OPEN_STATES) {
        const writes = openDesign(hasActiveDesign);
        const runtime = makeHookRuntime();
        // Both presets picked, so the design is the only thing that can hold a button off.
        const picking = show(runtime);
        picking.builtin.props.onChange({ target: { value: preset } });
        picking.saved.props.onChange({ target: { value: 'My spec' } });
        const shown = show(runtime);
        shown.toolbar.props.onApplyBuiltinPreset(preset, 'replace');
        const afterApply = writes.map(([kind]) => kind);
        await shown.toolbar.props.onLoadDiskPreset('My spec', 'replace');
        const message = show(runtime).toolbar.props.diskMsg;
        if (!hasActiveDesign) {
            assert.deepEqual(state(shown.apply), [true, ts.noDesign], 'no design: Apply is off and says why');
            assert.deepEqual(state(shown.load), [true, ts.noDesign], 'no design: Load is off and says why');
            assert.deepEqual(writes, [], 'no design: neither preset writes or pushes an undo step');
            assert.deepEqual(fileReads, [], 'and the saved preset is not read');
            assert.equal(message, ts.noDesign, 'the bar says a design is needed');
        } else {
            assert.deepEqual(state(shown.apply), [false, undefined], 'a design open: Apply is on');
            assert.deepEqual(state(shown.load), [false, undefined], 'and Load is on');
            assert.deepEqual(afterApply, ['checkpoint', 'update'], 'the built-in preset goes in as one undo step');
            assert.deepEqual(writes.map(([kind]) => kind), ['checkpoint', 'update', 'checkpoint', 'update'],
                'and so does the saved one');
            assert.deepEqual(fileReads, ['My spec'], 'which is read from its file');
            assert.equal(writes[3][1].qualifiers[0].target, 99, 'and replaces the list');
            assert.equal(message, `${ts.loaded} My spec`, 'the bar reports the load');
        }
    }
}

// ── Merit Function Editor: Load MF, and the wizard's Generate ────────────────
{
    const te = t.meritFunctionEditor;
    const tw = te.wizard;
    meritWizardSession.reset();
    meritWizardSession.write(null, { open: true });
    const show = runtime => {
        const found = draw(runtime, MeritFunctionEditor, ['DMFWizard', 'SavedMfMenu']);
        // The field after the Start at row label.
        const startRowAt = found.findIndex(node => node.props.title === tw.startRowTip);
        return {
            found,
            menu: component(found, 'SavedMfMenu'),
            load: found.find(node => node.type?.name === 'TblBtn' && node.props.label?.props?.children?.[0] === te.loadMf),
            generate: button(found, tw.generate),
            startRow: found.slice(startRowAt).find(node => node.type?.name === 'NumInput').props.value,
        };
    };
    for (const hasActiveDesign of OPEN_STATES) {
        const writes = openDesign(hasActiveDesign);
        const runtime = makeHookRuntime();
        const shown = show(runtime);
        const saysWhy = shown.found.some(node => node.type === 'span' && node.props.children === te.noDesign);
        shown.generate.props.onClick();
        const generated = writes.map(([kind]) => kind);
        const afterGenerate = show(runtime);
        await shown.menu.props.onLoadDiskPreset('Saved MF', 'replace');
        const message = show(runtime).menu.props.diskMsg;
        if (!hasActiveDesign) {
            assert.deepEqual(state(shown.load), [true, te.noDesign], 'no design: Load MF is off and says why');
            assert.deepEqual(state(shown.generate), [true, te.noDesign], 'no design: Generate is off and says why');
            assert.ok(saysWhy, 'and the line under the wizard says so');
            assert.deepEqual(writes, [], 'no design: neither generating nor loading writes or pushes an undo step');
            assert.equal(afterGenerate.startRow, shown.startRow, 'Start at row stays where it was');
            assert.deepEqual(fileReads, [], 'the saved merit function is not read');
            assert.equal(message, te.noDesign, 'the bar says a design is needed');
        } else {
            assert.deepEqual(state(shown.load), [false, te.diskTip], 'a design open: Load MF is on');
            assert.deepEqual(state(shown.generate), [false, tw.willReplace], 'and Generate is on');
            assert.ok(!saysWhy, 'and nothing asks for a design');
            assert.deepEqual(generated, ['update'], 'Generate writes the block into the table');
            const block = writes[0][1].meritOperands;
            assert.ok(block.length > 0, 'a block of rows');
            assert.equal(afterGenerate.startRow, shown.startRow + block.length, 'and Start at row moves past it');
            assert.deepEqual(writes.slice(1).map(([kind]) => kind), ['checkpoint', 'update'], 'the load is one undo step');
            assert.deepEqual(fileReads, ['Saved MF'], 'read from its file');
            assert.equal(message, `${te.loaded} Saved MF`, 'the bar reports the load');
        }
    }
    meritWizardSession.reset();
}

console.log('no_design_apply_refused: passed');
