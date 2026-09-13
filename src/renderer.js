// Renderer entry point: mounts the app shell into index.html.

import { getPalette } from './constants/colorPalettes.js';
import { getLocale, getCurrentLocale } from './constants/locales/index.js';
import { ErrorBoundary, AppFailedPage } from './components/ui/ErrorBoundary.js';
import { initialTheme } from './utils/theme/appearance.js';
import { App } from './App.js';

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
}, h(App, null)));
