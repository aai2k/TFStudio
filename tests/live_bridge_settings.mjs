/**
 * The switch that lets AI agents work on the open design (Preferences >
 * Automation).
 *
 *   1. It is off unless settings.json holds true for it.
 *   2. The settings hook (useAppSettings) saves it with the other settings,
 *      and asks the desktop app to open or close the live link once the saved
 *      value is known and on every change after, never before; the answer is
 *      the status the Settings row shows. Without the desktop app's link, as in
 *      the web demo, it asks nothing.
 *   3. The Automation pane draws the switch, its hint and its status in every
 *      language, and the category is offered only where the link exists.
 *
 * Run: node tests/live_bridge_settings.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';

shimBrowserGlobals();
document.documentElement.style.setProperty = () => {};
let stored = {};
const saved = [];
const switched = [];
const desktop = {
    loadSettings: async () => ({ success: true, settings: stored }),
    loadPreferences: async () => ({ prefs: null }),
    saveSettings: async (values) => { saved.push(values); },
    setLiveBridge: async (on) => { switched.push(on); return { open: on }; },
};
globalThis.electronAPI = { ...desktop };
await loadApp();
const { readAppSettings } = await import('../src/utils/io/settingsFile.js');
const runtime = makeHookRuntime();
const { useAppSettings } = await importWithHookRuntime('../src/hooks/useAppSettings.js', runtime);
const { AutomationPane } = await import('../src/components/dialogs/settings/AutomationPane.js');
const { SettingsModal } = await import('../src/components/dialogs/settings/SettingsModal.js');

// ── 1. Opt-in ───────────────────────────────────────────────────────────────
for (const [settings, on] of [[{}, false], [{ liveBridge: true }, true], [{ liveBridge: 'yes' }, false], [{ liveBridge: 1 }, false]]) {
    stored = settings;
    assert.equal((await readAppSettings()).liveBridge, on, `settings.json ${JSON.stringify(settings)} reads as ${on ? 'on' : 'off'}`);
}

// ── 2. The hook ─────────────────────────────────────────────────────────────
const render = () => {
    const real = globalThis.React;
    globalThis.React = runtime.React;
    try { return runtime.render(() => useAppSettings(() => {})); } finally { globalThis.React = real; }
};
// One render with its effects run, and what they set going finished.
const step = async () => {
    const out = render();
    runtime.pendingEffects().forEach(effect => effect());
    for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 0));
    return out;
};
{
    stored = { liveBridge: true };
    const first = await step();
    assert.equal(first.liveBridge, false, 'off until settings.json is read');
    assert.deepEqual(switched, [], 'and the link is not touched before');
    const loaded = await step();
    assert.equal(loaded.liveBridge, true);
    assert.equal(saved.at(-1).liveBridge, true, 'the saved settings carry the switch');
    assert.deepEqual(switched, [true], 'once read, the link is opened');
    assert.deepEqual(render().liveBridgeStatus, { open: true }, 'and the answer is the row\'s status');
    loaded.setLiveBridge(false);
    await step();
    assert.equal(saved.at(-1).liveBridge, false, 'turned off, it is saved off');
    assert.deepEqual(switched, [true, false], 'and the link is closed');
    assert.deepEqual(render().liveBridgeStatus, { open: false });
}
{
    runtime.reset();
    stored = {};
    switched.length = 0;
    await step();
    await step();
    assert.deepEqual(switched, [false], 'a fresh profile leaves the link closed');
    runtime.reset();
    delete globalThis.electronAPI.setLiveBridge;
    switched.length = 0;
    await step();
    const demo = await step();
    assert.deepEqual([switched, demo.liveBridgeStatus], [[], null], 'without the desktop app\'s link nothing is asked');
}

// ── 3. The pane ─────────────────────────────────────────────────────────────
const c = makeTheme();
const text = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const pane = (t, props) => renderToStaticMarkup(React.createElement(AutomationPane, { c, t, setLiveBridge() {}, ...props }));
const modal = t => renderToStaticMarkup(React.createElement(SettingsModal, { c, t, theme: 'Light', ribbonStyle: 'minimalist', onClose() {} }));
for (const code of ['en', 'ru', 'zh', 'it']) {
    const t = makeLocale(code);
    const s = t.settings;
    const on = pane(t, { liveBridge: true, liveBridgeStatus: { open: true } });
    for (const shown of [s.liveBridge, s.liveBridgeHint, s.liveBridgeOn]) assert.ok(on.includes(text(shown)), `${code}: ${shown}`);
    assert.ok(on.includes('checked=""'), `${code}: the box is ticked`);
    assert.ok(pane(t, { liveBridge: true, liveBridgeStatus: { open: false, error: 'EACCES' } }).includes(text(s.liveBridgeFailed('EACCES'))), `${code}: why it could not open`);
    const off = pane(t, { liveBridge: false, liveBridgeStatus: { open: false } });
    assert.ok(!off.includes(text(s.liveBridgeOn)) && !off.includes('checked=""'), `${code}: off, with no status line`);
    assert.ok(!pane(t, { liveBridge: true, liveBridgeStatus: null }).includes('role="status"'), `${code}: nothing while it opens`);
    globalThis.electronAPI.setLiveBridge = desktop.setLiveBridge;
    assert.ok(modal(t).includes(`>${text(s.categories.automation)}</button>`), `${code}: the desktop app offers the Automation category`);
    delete globalThis.electronAPI.setLiveBridge;
    assert.ok(!modal(t).includes(text(s.categories.automation)), `${code}: the web demo does not`);
}

console.log('PASS: live_bridge_settings');
