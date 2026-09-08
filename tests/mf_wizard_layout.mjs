/**
 * The merit-function wizard's three boxes.
 *
 * They sit in one row while the pane is wide enough and wrap when it is not, so
 * two things have to hold: the row has to fit a pane of a reasonable width, and
 * a box that wraps must not turn into a full-width panel with its controls
 * stranded at one end and empty rows below them.
 * Run: node tests/mf_wizard_layout.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { DMFWizard } = await import(
    '../src/components/windows/optimization/meritFunctionEditor/DMFWizard.js');

// The wizard sits above the table in a docked window, which is regularly parked
// beside a plot. Three boxes have to fit the half of a 1440-wide screen that is
// left once a plot has the other half, or the row wraps in ordinary use.
const PANE_BUDGET = 710;
const WIZARD_PADDING = 20;  // the form's own left and right padding
const BOX_GAP = 8;

const c = makeTheme();
const t = makeLocale();
const design = { id: 'wizard', name: 'Wizard', frontLayers: [], backLayers: [] };

const html = renderToStaticMarkup(React.createElement(DMFWizard, {
    design, onGenerate: () => {}, operandCount: 0,
    mf: 0.5, omf: 0.5, busy: false, c, t,
}));

// ── The three boxes fit one row of a pane a user is likely to have ───────────
{
    const declared = [...html.matchAll(/min-width:(\d+)px/g)].map(match => Number(match[1]));
    assert.equal(declared.length, 3, 'the row is the three boxes and nothing else');
    const row = declared.reduce((sum, width) => sum + width, 0)
        + BOX_GAP * (declared.length - 1) + WIZARD_PADDING;
    assert.ok(row <= PANE_BUDGET,
        `the three boxes need ${row}px, which must fit ${PANE_BUDGET}px`);
}

// ── A box with only fixed-width controls does not take spare room ────────────
// Thickness limits holds three number fields and two checkboxes. Letting it
// grow is what made it span the pane once it wrapped.
{
    const limits = [...html.matchAll(/flex:(\d) (\d) (\d+)px/g)].map(match => match[0]);
    assert.ok(limits.some(rule => rule.startsWith('flex:0 0')),
        'the fixed-width box neither grows nor shrinks');
    assert.ok(limits.some(rule => rule.startsWith('flex:1 1')),
        'a box whose controls can use the room still grows');
}

// ── A folded wizard builds no operands ───────────────────────────────────────
// The block a preset amounts to runs to thousands of operands for an
// angle-swept discrete target, and only the Generate line needs it. Building it
// for a wizard nobody has open costs that on every render of the window.
{
    const { meritWizardSession } = await import(
        '../src/components/windows/optimization/meritFunctionEditor/sessionState.js');
    meritWizardSession.write(null, { open: false });
    const folded = renderToStaticMarkup(React.createElement(DMFWizard, {
        design, onGenerate: () => {}, operandCount: 0, mf: 0.5, omf: 0.5, busy: false, c, t,
    }));
    meritWizardSession.write(null, { open: true });
    const tw = t.meritFunctionEditor.wizard;
    assert.ok(!folded.includes(tw.generate),
        'a folded wizard renders no Generate button, so it built no block to generate');
    assert.equal([...folded.matchAll(/min-width:(\d+)px/g)].length, 0, 'and none of the three boxes');
    assert.ok(folded.includes(tw.title), 'the bar it folds into stays');
}

console.log('mf_wizard_layout: passed');
