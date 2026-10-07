/**
 * With no design open, a window that works on a design is not mounted.
 *
 * The provider hands every window a placeholder design while none is open, so a
 * window mounted then draws a bare BK7 substrate, takes edits that go nowhere
 * and reports tools applied to nothing. `ToolContent`, where every window is
 * mounted, docked or torn off, draws a request to open or create a design in
 * place of each window flagged `requiresDesign`, and mounts the window once a
 * design is open, on the controls its copy held. A window with work of its own
 * without a design is not flagged and mounts either way.
 *
 * Run: node tests/no_design_window_gate.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeDesignCtx, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
const { DesignContext } = await loadApp();

const [
    { ToolContent, FloatToolHost },
    { WINDOW_REGISTRY },
    { ErrorBoundary },
    { createWindowSession, useWindowSession },
    { useDesign },
] = await Promise.all([
    import('../src/components/docking/DockingLayout.js'),
    import('../src/components/docking/windowRegistry.js'),
    import('../src/components/ui/ErrorBoundary.js'),
    import('../src/components/windows/windowSession.js'),
    import('../src/state/DesignContext.js'),
]);

const c = makeTheme();
const t = makeLocale();
const h = React.createElement;
const OPEN_STATES = [false, true];

// Every element type in a tree as ToolContent builds it, without drawing any
// component: what is not in the tree is never mounted.
function typesIn(node, found = []) {
    if (Array.isArray(node)) node.forEach(child => typesIn(child, found));
    else if (node && typeof node === 'object' && node.type) {
        found.push(node.type);
        typesIn(node.props?.children, found);
    }
    return found;
}

const withContext = (element, hasActiveDesign) =>
    h(DesignContext.Provider, { value: { ...makeDesignCtx(), hasActiveDesign } }, element);

// ── The windows that work without a design ───────────────────────────────────
// Every window is either flagged or on this list, so a new window is decided on
// rather than left to compute from the placeholder by default.
const WORKS_WITHOUT_DESIGN = [
    'material-editor', 'coating-library', 'material-dispersion', 'zemax-coatings',
    'codev-coatings', 'report-gen', 'optimizer-benchmark', 'games',
];
const windows = Object.entries(WINDOW_REGISTRY).filter(([, entry]) => entry.component);
assert.deepEqual(
    windows.filter(([, entry]) => !entry.requiresDesign).map(([id]) => id).sort(),
    [...WORKS_WITHOUT_DESIGN].sort(),
    'every window that works on a design waits for one');

// ── Every registered window, with and without a design ───────────────────────
const gatedMarkup = renderToStaticMarkup(ToolContent({ toolId: 'optical-eval', c, t, hasActiveDesign: false }));
assert.ok(gatedMarkup.includes('No design selected. Open or create a design first.'),
    'the pane asks for a design');

for (const [toolId, entry] of windows) {
    for (const hasActiveDesign of OPEN_STATES) {
        const element = ToolContent({ toolId, copyId: `tab-${toolId}`, c, t, hasActiveDesign });
        const types = typesIn(element);
        if (entry.requiresDesign && !hasActiveDesign) {
            assert.ok(!types.includes(entry.component), `${toolId}: not mounted with no design open`);
            assert.ok(!types.includes(ErrorBoundary), `${toolId}: nothing of the window is built`);
            assert.equal(renderToStaticMarkup(element), gatedMarkup, `${toolId}: the shared pane is drawn instead`);
        } else {
            const boundary = element.props.children;
            assert.equal(boundary.type, ErrorBoundary, `${toolId}: mounted (design open: ${hasActiveDesign})`);
            assert.equal(boundary.props.children.type, entry.component, `${toolId}: its own component`);
        }
    }
}

// A window flagged both ways, with no design open, asks for the design: the
// placeholder's materials are not the user's to repair.
assert.equal(renderToStaticMarkup(ToolContent({
    toolId: 'optical-eval', c, t, hasActiveDesign: false, missingMaterialIds: ['user:gone'],
})), gatedMarkup, 'no design open comes before unavailable materials');

for (const code of ['en', 'ru', 'zh', 'it']) {
    const local = makeLocale(code);
    assert.ok(local.windowChrome.noDesign, `${code}: the pane has its text`);
    assert.ok(renderToStaticMarkup(ToolContent({ toolId: 'design-editor', c, t: local, hasActiveDesign: false }))
        .includes(local.windowChrome.noDesign), `${code}: and draws it`);
}

// ── Torn off, and back on its controls once a design opens ───────────────────
// A probe window that shows one value of its session store. The user set it
// while a design was open; the gate in between must neither drop nor reset it.
const probeSession = createWindowSession({ value: 'default' });
let probeDrawn = 0;
function GateProbe() {
    probeDrawn += 1;
    const { design } = useDesign();
    const [session] = useWindowSession(probeSession, design);
    return h('div', null, `probe ${session.value}`);
}
WINDOW_REGISTRY['gate-probe'] = { component: GateProbe, title: 'probe', label: 'probe', requiresDesign: true };
const copyId = 'tab-probe';
probeSession.write(null, { value: 'set by the user' }, copyId);

// A docked pane is told by the layout whether a design is open; a torn-off one
// reads it from the provider itself.
const drawProbe = (host, hasActiveDesign) => renderToStaticMarkup(withContext(h(host, {
    toolId: 'gate-probe', copyId, c, t, ...(host === ToolContent ? { hasActiveDesign } : {}),
}), hasActiveDesign));

for (const host of [ToolContent, FloatToolHost]) {
    probeDrawn = 0;
    const closed = drawProbe(host, false);
    assert.ok(closed.includes(t.windowChrome.noDesign), `${host.name}: no design open, the pane is drawn`);
    assert.equal(probeDrawn, 0, `${host.name}: and the window is never called`);

    const opened = drawProbe(host, true);
    assert.ok(opened.includes('probe set by the user'), `${host.name}: a design open, the window mounts on its controls`);
    assert.ok(!opened.includes(t.windowChrome.noDesign), `${host.name}: with no pane`);
}
delete WINDOW_REGISTRY['gate-probe'];

// The docked tree hands each pane the provider's state. Its panes are drawn by
// an effect a static render does not run, so the wiring is read from the source.
const layoutSrc = readFileSync(new URL('../src/components/docking/DockingLayout.js', import.meta.url), 'utf8');
assert.match(layoutSrc, /const \{[^}]*\bhasActiveDesign\b[^}]*\} = useDesign\(\);/, 'the layout reads it from the provider');
assert.match(layoutSrc, /const nodeCtx = \{[^}]*\bhasActiveDesign\b/, 'puts it where the tree renderer reads');
assert.match(layoutSrc, /h\(ToolContent, \{[^}]*hasActiveDesign: ctx\.hasActiveDesign/, 'and hands it to every pane');

console.log('no_design_window_gate: passed');
