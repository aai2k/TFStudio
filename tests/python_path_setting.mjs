/**
 * The Python the Script Console runs Python scripts in, as Preferences >
 * Automation sets it.
 *
 *   1. settings.json holds it as pythonPath, '' when none is set; the
 *      settings hook saves it with the other settings once they are read.
 *   2. The Automation pane draws the row in every language: its name, its
 *      hint, the field with the path set and what an empty one means, and
 *      Browse. A path typed is taken, trimmed, when the field is left or
 *      Enter is pressed, and one chosen with Browse at once; the row then
 *      says which Python that is, or what is missing, as the console says it.
 *
 * Run: node tests/python_path_setting.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';
import { makeEffectRuntime } from './_effectRuntime.mjs';

shimBrowserGlobals();
document.documentElement.style.setProperty = () => {};
let stored = {};
const saved = [];
globalThis.electronAPI = {
    loadSettings: async () => ({ success: true, settings: stored }),
    loadPreferences: async () => ({ prefs: null }),
    saveSettings: async (values) => { saved.push(values); },
};
await loadApp();
const { readAppSettings } = await import('../src/utils/io/settingsFile.js');
const hooks = makeHookRuntime();
const { useAppSettings } = await importWithHookRuntime('../src/hooks/useAppSettings.js', hooks);
const { AutomationPane } = await import('../src/components/dialogs/settings/AutomationPane.js');
const RealReact = globalThis.React;
const effects = makeEffectRuntime(RealReact);
globalThis.React = effects;
const { AutomationPane: LivePane } = await import('../src/components/dialogs/settings/AutomationPane.js?effects');
globalThis.React = RealReact;

// ── 1. settings.json ────────────────────────────────────────────────────────
for (const [settings, path] of [[{}, ''], [{ pythonPath: 'C:\\Python312\\python.exe' }, 'C:\\Python312\\python.exe'], [{ pythonPath: 3 }, '']]) {
    stored = settings;
    assert.equal((await readAppSettings()).pythonPath, path, `settings.json ${JSON.stringify(settings)} reads as ${JSON.stringify(path)}`);
}
{
    const render = () => {
        globalThis.React = hooks.React;
        try { return hooks.render(() => useAppSettings(() => {})); } finally { globalThis.React = RealReact; }
    };
    const step = async () => {
        const out = render();
        hooks.pendingEffects().forEach(effect => effect());
        for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 0));
        return out;
    };
    stored = { pythonPath: 'D:\\py\\python.exe' };
    assert.equal((await step()).pythonPath, '', 'none until settings.json is read');
    const loaded = await step();
    assert.equal(loaded.pythonPath, 'D:\\py\\python.exe');
    assert.equal(saved.at(-1).pythonPath, 'D:\\py\\python.exe', 'the saved settings carry it');
    loaded.setPythonPath('E:\\other\\python.exe');
    await step();
    assert.equal(saved.at(-1).pythonPath, 'E:\\other\\python.exe', 'and a new one is saved');
}

// ── 2. The pane ─────────────────────────────────────────────────────────────
const c = makeTheme();
const text = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
for (const code of ['en', 'ru', 'zh', 'it']) {
    const t = makeLocale(code);
    const s = t.settings;
    const html = renderToStaticMarkup(React.createElement(AutomationPane, { c, t, pythonPath: 'C:\\Py\\python.exe', setPythonPath() {} }));
    for (const shown of [s.pythonPath, s.pythonPathHint]) assert.ok(html.includes(text(shown)), `${code}: ${shown}`);
    assert.ok(html.includes(`placeholder="${text(s.pythonPathPlaceholder)}"`), `${code}: what an empty field means`);
    assert.ok(html.includes('value="C:\\Py\\python.exe"'), `${code}: the path set`);
    assert.ok(html.includes(`>${text(s.folders.browse)}</button>`) && html.includes(`title="${text(s.pythonBrowseTip)}"`), `${code}: Browse`);
}

// The row as the pane draws it, under a React that runs effects, with the
// desktop app answering for the Python of each path from `pythons`.
{
    const t = makeLocale('en');
    const z = t.scriptConsole;
    const pythons = { '': { found: { path: 'C:\\Python312\\python.exe', version: '3.12.1' } } };
    const looked = [];
    globalThis.electronAPI.findPython = async (path) => { looked.push(path); return pythons[path] ?? { missing: { reason: 'setPath', path } }; };
    globalThis.electronAPI.choosePythonFile = async () => ({ path: 'F:\\chosen\\python.exe' });
    let pythonPath = '';
    const set = [];
    const setPythonPath = (path) => { set.push(path); pythonPath = path; };
    const find = (el, test) => {
        if (!el || typeof el !== 'object') return null;
        if (Array.isArray(el)) return el.reduce((hit, child) => hit || find(child, test), null);
        return test(el) ? el : find(el.props?.children, test);
    };
    let row;
    const draw = () => {
        globalThis.React = effects;
        try {
            row = effects.run(() => {
                const pane = LivePane({ c, t, pythonPath, setPythonPath });
                const element = find(pane, el => el.type?.name === 'PythonRow');
                return element.type(element.props);
            });
        } finally { globalThis.React = RealReact; }
    };
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const field = () => find(row, el => el.type === 'input');
    const status = () => find(row, el => el.props?.role === 'status');

    draw();
    await settle();
    draw();
    assert.deepEqual(looked, [''], 'the row asks for the Python of the path set');
    assert.equal(status().props.children, z.python.found('3.12.1', 'C:\\Python312\\python.exe'), 'and says which Python that is');
    assert.equal(status().props.style.color, c.textDim);

    field().props.onChange({ target: { value: '  D:\\gone\\python.exe ' } });
    draw();
    assert.deepEqual(set, [], 'a path being typed is not taken yet');
    field().props.onKeyDown({ key: 'Enter', currentTarget: { value: field().props.value } });
    assert.deepEqual(set, ['D:\\gone\\python.exe'], 'Enter takes it, trimmed');
    draw();
    await settle();
    draw();
    assert.equal(status().props.children, z.python.setPath('D:\\gone\\python.exe'), 'and the row says it does not run');
    assert.equal(status().props.style.color, c.error);

    field().props.onBlur({ target: { value: 'D:\\gone\\python.exe' } });
    assert.equal(set.length, 1, 'leaving the field with the path already taken takes nothing');
    field().props.onChange({ target: { value: '' } });
    draw();
    field().props.onBlur({ target: { value: '' } });
    assert.deepEqual(set.at(-1), '', 'leaving it emptied takes the empty path: Python from PATH');
    draw();

    await find(row, el => el.type === 'button').props.onClick();
    assert.equal(set.at(-1), 'F:\\chosen\\python.exe', 'Browse takes the file chosen');
    draw();
    assert.equal(field().props.value, 'F:\\chosen\\python.exe', 'and shows it');
    effects.unmount();
}

console.log('PASS: python_path_setting');
