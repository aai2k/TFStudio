/**
 * The controls over a window's plot are not selectable text, so quick clicks
 * on a switch or a tab do not highlight the words on them.
 *
 *   1. The control row every analysis window opens with, as Color Evaluation
 *      draws it with its T and R switch.
 *   2. The tab buttons, as Color Evaluation's diagram tabs draw them.
 *   3. The settings panel every window's Settings button opens, which is not
 *      selectable whatever row it hangs from.
 *   4. Labels and buttons anywhere in the app, by the stylesheet: a checkbox's
 *      words, as in Color Evaluation's Settings, and a button's caption.
 *
 * Run: node tests/window_controls_not_selectable.mjs
 */
import './_kernel.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { ControlRow } = await import('../src/components/windows/analysis/chrome/layout.js');
const { ColorControls, DiagramTabs } = await import('../src/components/windows/analysis/colorEvaluation/ColorControls.js');
const { TabBtn } = await import('../src/components/ui/tabBtn.js');

const c = makeTheme();
const t = makeLocale('en');
const ce = t.colorEval;
const state = {
    characteristic: 'R', pol: 'avg', angleMode: 'list', thetas: [0, 45], diagram: 'xy',
    setCharacteristic() {}, setPol() {}, setAngleMode() {}, setThetas() {}, setDiagram() {},
};

// ── 1. The control row ───────────────────────────────────────────────────────
{
    const row = ColorControls({ c, t, ce, state, notices: [], editor: { editMode: false, setEditMode() {} } });
    assert.equal(row.type, ControlRow, 'Color Evaluation puts its switches in the shared control row');
    assert.equal(ControlRow(row.props).props.style.userSelect, 'none', 'whose labels and switches are not selectable');
}

// ── 2. The tabs ──────────────────────────────────────────────────────────────
{
    const tabs = [].concat(DiagramTabs({ c, ce, state }).props.children);
    assert.ok(tabs.length > 1 && tabs.every(tab => tab.type === TabBtn), 'the diagrams are shared tab buttons');
    for (const tab of tabs) {
        assert.equal(TabBtn(tab.props).props.style.userSelect, 'none', `the ${tab.props.title} tab is not selectable`);
    }
}

// ── 3. The settings panel ────────────────────────────────────────────────────
{
    const { panelStyle } = await import('../src/components/windows/analysis/chrome/popover.js');
    assert.equal(panelStyle(c, 320).userSelect, 'none', 'a settings panel is not selectable');
}

// ── 4. Labels and buttons, by the stylesheet ─────────────────────────────────
{
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const rule = css.match(/^label,\s*button\s*\{([^}]*)\}/m);
    assert.ok(rule && /user-select:\s*none/.test(rule[1]), 'labels and buttons are not selectable');
}

console.log('window_controls_not_selectable: passed');
