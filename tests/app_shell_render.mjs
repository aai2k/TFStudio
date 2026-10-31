/**
 * The app shell renders.
 *
 * `renderer.js` mounts the shell into the page, which a test cannot do, so the
 * shell itself is `src/App.js` and this renders that to static markup. It
 * exercises the whole initial render: every hook the shell calls, in order, and
 * every prop the title bar, the ribbon, the project explorer and the docking
 * workspace are handed. A hook that lost a value it returns, a prop with no
 * owner left, or a module that fails to load turns up here as what the user
 * would see, a blank window.
 *
 * `useEffect` does not run under a server render, so the startup reads
 * (settings, project tree, catalogs) are out of scope, as they are in
 * ui_window_render. What this locks down is that the shell BUILDS.
 *
 * Run: node tests/app_shell_render.mjs
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { shimBrowserGlobals, loadApp, makeLocale } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

let passed = 0;
function ok(condition, message) {
    if (!condition) throw new Error(message);
    passed++;
}

const { App } = await import('../src/App.js');
ok(typeof App === 'function', 'App is exported from src/App.js');

const html = renderToStaticMarkup(React.createElement(App));
ok(typeof html === 'string' && html.length > 1000, `the shell renders (${html.length} chars)`);

// Its own frame: the column the title bar, the ribbon and the workspace sit in.
ok(html.includes('height:100vh'), 'the shell fills the window');

// Nothing is open on a first run, so the workspace draws its empty state, in the
// real locale, which is also what proves the shell reached the docking layer
// with a `t` it could read.
const t = makeLocale();
ok(html.includes(t.docking.empty.createProject),
   'the empty workspace offers to create a project');

// The explorer is beside it, drawn from the same locale.
ok(html.includes(t.explorer.searchPlaceholder), 'the project explorer is drawn');

// The notices on screen are drawn together, in the order they were raised, the
// latest on top. Each is keyed by its own id, so it keeps its own timers while
// the others come and go, keeps its duration, so one the user has to close does
// not close itself after a few seconds, and closes only itself.
{
    const { AppModals } = await import('../src/components/AppModals.js');
    const { MessageNotification } = await import('../src/components/ui/MessageNotification.js');
    const closed = [];
    const modals = AppModals({
        c: {}, t, settings: {}, dialogs: {}, welcome: {}, project: {},
        messageNotifications: [
            { id: 7, type: 'warning', message: 'Data folder', duration: 0 },
            { id: 9, type: 'error', message: 'Save failed' },
        ],
        onDismissMessage: id => closed.push(id),
    });
    const stack = [].concat(modals.props.children).find(el => el?.props?.style?.flexDirection === 'column-reverse');
    const shown = [].concat(stack?.props.children || []).filter(el => el?.type === MessageNotification);
    ok(shown.map(el => el.key).join() === '7,9', `both notices are drawn, keyed by id, got: ${shown.map(el => el.key)}`);
    ok(shown[0].props.duration === 0 && shown[1].props.duration === undefined,
        `each keeps its own duration, got: ${shown.map(el => el.props.duration)}`);
    shown[1].props.onClose();
    ok(closed.join() === '9', `closing one closes only that one, got: ${closed}`);
}

// The live link's dialogs are part of the shell, and the ribbon's Interactive
// reaches the desktop app.
{
    const { LiveDialogs } = await import('../src/components/live/LiveDialogs.js');
    const { Toolbar } = await import('../src/components/Toolbar.js');
    const walk = function* walk(node) {
        if (Array.isArray(node)) { for (const child of node) yield* walk(child); return; }
        if (!node || typeof node !== 'object' || !node.props) return;
        yield node;
        yield* walk(node.props.children);
    };
    let tree = null;
    function Probe() { tree = App({ kernelStartup: Promise.resolve(null) }); return null; }
    renderToStaticMarkup(React.createElement(Probe));
    const drawn = [...walk(tree)];
    ok(drawn.some(el => el.type === LiveDialogs), 'the shell draws the live link\'s dialogs');
    let asked = 0;
    const desktop = globalThis.electronAPI;
    globalThis.electronAPI = { startInteractive: async () => { asked++; return { open: true }; } };
    drawn.find(el => el.type === Toolbar).props.onToolAction('interactive');
    globalThis.electronAPI = desktop;
    ok(asked === 1, 'the ribbon\'s Interactive asks the desktop app to start listening');
}

console.log(`app_shell_render: ${passed} passed`);
