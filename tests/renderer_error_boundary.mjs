/**
 * A tool window that throws is replaced by its own pane, not by a blank app.
 *
 * The renderer had no error boundary anywhere, so React unmounted the whole
 * tree whenever a window threw while rendering and the app became a white page
 * with nothing on it. Two unrelated faults did it in two days.
 *
 * `ToolContent` is the single mount point for every window, docked or torn off
 * (a popout is a portal into the same tree), so the boundary lives there and
 * covering `ToolContent` covers both paths. The app shell carries its own
 * boundary in `renderer.js`, which cannot be imported here because it mounts a
 * root on load, so that wiring is read from the source.
 *
 * Run: node tests/renderer_error_boundary.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const [
    { ErrorBoundary, WindowFailedPane, AppFailedPage },
    { ToolContent },
    { WINDOW_REGISTRY },
] = await Promise.all([
    import('../src/components/ui/ErrorBoundary.js'),
    import('../src/components/docking/DockingLayout.js'),
    import('../src/components/docking/windowRegistry.js'),
]);

const t = makeLocale();
const c = makeTheme();

// Every string a pane draws, flattened, so a title or a message can be looked
// for without knowing which element holds it. Nothing in these panes holds
// state, so a function component is drawn by calling it.
function textOf(node) {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join(' ');
    if (typeof node === 'object' && node.props) {
        return typeof node.type === 'function'
            ? textOf(node.type(node.props))
            : textOf(node.props.children);
    }
    return '';
}

// The first click handler in a pane. The reopen button is the only control the
// panes carry, and it is what makes a failed window recoverable, so the test
// presses it rather than trusting that the label implies a working button.
function findOnClick(node) {
    if (node == null || typeof node !== 'object') return null;
    if (Array.isArray(node)) return node.reduce((hit, child) => hit || findOnClick(child), null);
    if (!node.props) return null;
    return node.props.onClick || (typeof node.type === 'function'
        ? findOnClick(node.type(node.props))
        : findOnClick(node.props.children));
}

let passed = 0;
function ok(condition, message) {
    assert.ok(condition, message);
    passed++;
}

// A boundary instance driven by hand: React is not rendering here, so `setState`
// is applied directly.
function standaloneBoundary(fallback) {
    const boundary = new ErrorBoundary({ children: { type: 'div', props: {}, key: null }, fallback });
    boundary.setState = (update) => { boundary.state = { ...boundary.state, ...update(boundary.state) }; };
    return boundary;
}

// ── The class opts into catching, and recovers on retry ──────────────────────

const thrown = new Error('reading \'nm\' of undefined');
assert.deepEqual(ErrorBoundary.getDerivedStateFromError(thrown), { hasError: true, error: thrown },
    'a throw below the boundary becomes its error state');
passed++;

{
    const boundary = standaloneBoundary((error, retry) => ({ error, retry }));
    const children = boundary.props.children;

    const healthy = boundary.render();
    ok(healthy.props.children === children, 'with no error the children are drawn untouched');
    const firstKey = healthy.key;

    boundary.state = { ...boundary.state, ...ErrorBoundary.getDerivedStateFromError(thrown) };
    ok(boundary.render().error === thrown, 'once it has an error the fallback is drawn instead');

    boundary.retry();
    ok(boundary.state.hasError === false, 'retrying clears the error');
    ok(boundary.render().key !== firstKey,
        'and re-keys the children, so nothing from the failed attempt survives the rebuild');
}

// A falsy thrown value is still a failure. Gating the fallback on the value
// itself would draw the children again, throw again, and blank the app.
for (const falsy of [undefined, null, 0, '']) {
    const boundary = standaloneBoundary(() => 'fallback');
    boundary.state = { ...boundary.state, ...ErrorBoundary.getDerivedStateFromError(falsy) };
    assert.equal(boundary.render(), 'fallback', `a thrown ${String(falsy)} reaches the fallback`);
    passed++;
}

// ── Every registered window is mounted behind a boundary ─────────────────────

const windows = Object.entries(WINDOW_REGISTRY).filter(([, entry]) => entry.component);
ok(windows.length > 0, 'the registry has windows to check');

for (const [toolId, entry] of windows) {
    const mounted = ToolContent({ toolId, c, t });
    assert.equal(mounted.type, ErrorBoundary, `${toolId} is mounted behind a boundary`);
    assert.equal(mounted.props.children.type, entry.component,
        `${toolId}'s own component is what the boundary wraps`);
    passed++;
}

// Two tabs can hold the same tool, so what separates one mounted window from
// another is the tab. A group draws whichever of its tabs is active, at one
// position in the tree: keyed by the tool instead, the two would share a
// boundary and one tab's failure would show on the other.
const layoutSrc = readFileSync(
    new URL('../src/components/docking/DockingLayout.js', import.meta.url), 'utf8');
ok(/renderContent:\s*\(tab\) => h\(ToolContent, \{\s*\n\s*key: tab\.id,/.test(layoutSrc),
    'a pane keys its content by the tab it is drawing');

// A window blocked on unavailable materials is replaced before it is mounted, so
// that path is unchanged.
ok(ToolContent({
    toolId: 'optical-eval', c, t, missingMaterialIds: ['user:mystery'],
}).type !== ErrorBoundary, 'the unavailable-materials notice still replaces the window outright');

// ── The pane names the window and shows what it threw ────────────────────────

{
    const mounted = ToolContent({ toolId: 'optical-eval', c, t });
    const drawn = textOf(mounted.props.fallback(thrown, () => {}));
    ok(drawn.includes(t.windowTitles['optical-eval']),
        'the pane says which window failed, by its localized title');
    ok(drawn.includes(thrown.message), 'and shows the error text, not a bare "something broke"');
    ok(drawn.includes(t.windowError.reopen), 'and offers to reopen it');
}

// ── Reopening actually reopens ───────────────────────────────────────────────

{
    const boundary = standaloneBoundary((error, retry) => ({
        type: WindowFailedPane,
        props: { error, onReopen: retry, title: t.windowTitles['optical-eval'], c, t },
    }));
    boundary.state = { ...boundary.state, ...ErrorBoundary.getDerivedStateFromError(thrown) };

    const reopen = findOnClick(boundary.render());
    ok(typeof reopen === 'function', 'the pane carries a button, not just the word');
    reopen();
    ok(boundary.state.hasError === false && boundary.state.error === null,
        'pressing it clears the boundary, so the window is built again');
}

// A non-Error throw still prints as something.
ok(textOf({
    type: WindowFailedPane,
    props: { error: 'not an Error', title: 'Report', c, t },
}).includes('not an Error'), 'a thrown value that is not an Error still reaches the pane');

// ── The app shell is the last resort ─────────────────────────────────────────

ok(textOf({ type: AppFailedPage, props: { error: thrown, c, t } })
    .includes(t.windowError.reload), 'the shell page offers a reload, the only action left');

const rendererSrc = readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');
ok(/root\.render\(h\(ErrorBoundary, \{/.test(rendererSrc),
    'the root render wraps App in a boundary');
ok(/fallback: \(error\) => h\(AppFailedPage/.test(rendererSrc),
    'and draws the shell page when App itself throws');

console.log(`renderer_error_boundary: ${passed} passed`);
