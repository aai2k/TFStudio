// Renderer entry point: starts loading the WASM kernel, then mounts the app
// shell into index.html.

import { bootstrapTmmWasm } from './utils/physics/tmmWasmBootstrap.js';

// The kernel loads while the app's own modules do, and the app mounts once it
// is in, so the first calculation of a design shown at startup runs on it.
// Started here, in the shipped build, it was in 0.15 s after the window's code
// started, some 30 ms after the app's modules. A kernel still loading after
// KERNEL_WAIT_MS holds the window no longer: the app mounts without it, a
// calculation fails until it lands, and the app gets the load itself
// (kernelStartup) to tell the user when the load fails.
// The wait is four times the slowest load measured (0.5 s, started after the
// app had mounted), so a normal start never reaches it.
const KERNEL_WAIT_MS = 2000;
const kernelStartup = bootstrapTmmWasm();
const kernelLoaded = Promise.race([
    kernelStartup,
    new Promise(resolve => setTimeout(resolve, KERNEL_WAIT_MS)),
]);

const [{ getPalette }, { getLocale, getCurrentLocale }, { ErrorBoundary, AppFailedPage }, { initialTheme }, { App }] = await Promise.all([
    import('./constants/colorPalettes.js'),
    import('./constants/locales/index.js'),
    import('./components/ui/ErrorBoundary.js'),
    import('./utils/theme/appearance.js'),
    import('./App.js'),
]);
await kernelLoaded;

const { createElement: h } = React;

const root = ReactDOM.createRoot(document.getElementById('root'));
// A throw outside any window still blanks the page, so the shell gets a boundary
// of its own. Its theme and language come from the same cached preferences the
// first paint uses, because App's state is gone by the time this draws. Both are
// resolved here rather than inside the fallback: reading them registers the
// imported themes, which is not work to repeat while rendering.
const shellPalette = getPalette(initialTheme());
const shellLocale = getLocale(getCurrentLocale());
root.render(h(ErrorBoundary, {
    label: 'app',
    fallback: (error) => h(AppFailedPage, { error, c: shellPalette, t: shellLocale }),
}, h(App, { kernelStartup })));
