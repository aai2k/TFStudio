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

console.log(`app_shell_render: ${passed} passed`);
