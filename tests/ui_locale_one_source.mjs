/**
 * The UI language is one value, whichever way it was set.
 *
 * The shell's settings hook holds the language the windows render in, and code
 * outside React (Report's "app" language, the wizards' Help buttons, the chart
 * toolbox tooltip) asks getCurrentLocale(). On a fresh profile the language
 * comes from settings.json alone, so a value read there has to reach both
 * readers, as a change made in Settings does.
 *
 *   1. settings.json names zh on a fresh profile: the hook, getCurrentLocale()
 *      and Report's Language box all read zh.
 *   2. A language picked in Settings reaches getCurrentLocale() and is kept for
 *      the next launch's first frame.
 *
 * Run: node tests/ui_locale_one_source.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeTheme, makeSampleDesign, shimBrowserGlobals, withDesign } from './_uiShim.mjs';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';

// A fresh profile: nothing cached in localStorage, the language in settings.json.
shimBrowserGlobals();
globalThis.electronAPI = {
    loadSettings: async () => ({ success: true, settings: { locale: 'zh' } }),
    loadPreferences: async () => ({ prefs: null }),
};
await loadApp();

const runtime = makeHookRuntime();
const { useAppSettings } = await importWithHookRuntime('../src/hooks/useAppSettings.js', runtime);
const { getLocale, getCurrentLocale, availableLocales } = await import('../src/constants/locales/index.js');
const { ReportWindow } = await import('../src/components/windows/information/report/ReportWindow.js');

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
// The hook calls React.useMemo off the global, so the harness stands in for
// React while it runs.
const render = () => {
    const real = globalThis.React;
    globalThis.React = runtime.React;
    try { return runtime.render(() => useAppSettings(() => {})); }
    finally { globalThis.React = real; }
};
const nameOf = code => availableLocales.find(l => l.code === code).name;
// Report's Language box, read off the page as it renders with the shell's `t`.
const reportLanguageBox = t => {
    const html = renderToStaticMarkup(withDesign(React.createElement(ReportWindow, { c: makeTheme(), t }), makeSampleDesign()));
    const codes = availableLocales.map(l => l.code).join('|');
    return [...html.matchAll(new RegExp(`<option value="(${codes})" selected=""`, 'g'))].map(m => m[1]);
};

// ── 1. The language read from settings.json ──────────────────────────────────
render();
assert.equal(getCurrentLocale(), 'en', 'a fresh profile starts in English');
// The mount effect is the first the hook schedules: it reads settings.json.
runtime.pendingEffects()[0]();
await tick();
const loaded = render();
assert.equal(loaded.locale, 'zh', 'the shell renders in the language settings.json names');
assert.equal(loaded.t, getLocale('zh'));
assert.equal(getCurrentLocale(), 'zh', 'code outside React reads the same language the shell renders in');
assert.deepEqual(reportLanguageBox(loaded.t), ['zh'], `Report's "app" language is ${nameOf('zh')}`);

// ── 2. A language picked in Settings ─────────────────────────────────────────
loaded.setLocale('ru');
const picked = render();
assert.equal(picked.locale, 'ru');
assert.equal(getCurrentLocale(), 'ru', 'a language picked in Settings reaches code outside React');
assert.equal(localStorage.getItem('locale'), 'ru', 'and is kept for the first frame of the next launch');

console.log('ui_locale_one_source: ok');
