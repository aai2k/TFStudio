/**
 * The notice strips above the merit table read on every theme.
 *
 * A strip says something about the table as a whole, such as targets that reach
 * past a material's data. It lies on the window background in the Merit
 * Function Editor and on the panel in Refinement. On every built-in palette its
 * words must reach the 4.5:1 contrast WCAG 2.1 (success criterion 1.4.3) asks of
 * text, against the strip's tint over either surface.
 *
 * Run: node tests/mf_table_notice_contrast.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, shimBrowserGlobals } from './_uiShim.mjs';
import { colorPalettes } from '../src/constants/colorPalettes.js';

shimBrowserGlobals();
await loadApp();
const { MFTable } = await import('../src/components/windows/optimization/meritFunctionEditor/mfTable/MFTable.js');

// A '#rrggbb' or '#rrggbbaa' colour as channels and an alpha from 0 to 1.
function rgba(hex) {
    const [r, g, b, a = 255] = hex.slice(1).match(/../g).map(pair => parseInt(pair, 16));
    return { r, g, b, a: a / 255 };
}

// `top` laid over the opaque colour `base`, at its own alpha times `opacity`.
function over(top, base, opacity = 1) {
    const a = top.a * opacity;
    const blend = key => top[key] * a + base[key] * (1 - a);
    return { r: blend('r'), g: blend('g'), b: blend('b'), a: 1 };
}

// Relative luminance and contrast ratio, WCAG 2.1 definitions.
function luminance({ r, g, b }) {
    const channel = value => {
        const s = value / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

// The declarations of an element's inline style, by property name.
function inlineStyle(attributes) {
    const css = attributes.match(/style="([^"]*)"/)?.[1] || '';
    return Object.fromEntries(css.split(';').filter(Boolean).map(rule => {
        const at = rule.indexOf(':');
        return [rule.slice(0, at), rule.slice(at + 1)];
    }));
}

// Each run of text in the markup with the inline styles of the elements it sits
// in, outermost first. React writes a closing tag for every element but the void
// ones, such as `<col/>`, which end in `/>`.
function textRuns(html) {
    const runs = [];
    const open = [];
    for (const [, closing, attributes, text] of html.matchAll(/<(\/?)[a-z][^\s/>]*([^>]*)>|([^<]+)/g)) {
        if (text) runs.push({ text, styles: [...open] });
        else if (closing) open.pop();
        else if (!attributes.endsWith('/')) open.push(inlineStyle(attributes));
    }
    return runs;
}

// The colour a run is drawn in and the colour behind it, with the table lying on
// `surface`. Opacity fades the words into what is behind them.
function drawn(run, surface) {
    let back = rgba(surface);
    let ink = null;
    let opacity = 1;
    for (const style of run.styles) {
        const fill = style.background || style['background-color'];
        if (fill) back = over(rgba(fill), back);
        if (style.color) ink = rgba(style.color);
        if (style.opacity) opacity *= Number(style.opacity);
    }
    return { ink: over(ink, back, opacity), back };
}

const t = makeLocale();
const noop = () => {};
const scope = 'Total merit mode: phase operands score the front coating only.';
const range = 'Targets at 950-1000 nm reach outside the data range of 1 material';
const lines = 'TiO2: 370.1-826.6 nm\nZnS: 400-14000 nm';
const tableOn = c => renderToStaticMarkup(React.createElement(MFTable, {
    operands: [], computed: [], selectedId: null, noOperandsMsg: '',
    notices: [{ label: scope }, { label: range, detail: lines }],
    onSelect: noop, onEdit: noop, onAdd: noop, onInsertAt: noop, onDuplicate: noop,
    onDelete: noop, onClear: noop, onMoveUp: noop, onMoveDown: noop, c, t,
}));

for (const [name, c] of Object.entries(colorPalettes)) {
    const runs = textRuns(tableOn(c));
    for (const words of [scope, range, lines]) {
        const run = runs.find(candidate => candidate.text === words);
        assert.ok(run, `${name}: a strip shows "${words}"`);
        // The Merit Function Editor lays the table on the window background,
        // Refinement on the panel.
        for (const surface of ['bg', 'panel']) {
            const { ink, back } = drawn(run, c[surface]);
            const ratio = contrast(ink, back);
            assert.ok(ratio >= 4.5,
                `${name}: "${words.split('\n')[0]}" over the ${surface} reads at ${ratio.toFixed(2)}:1`);
        }
    }
}

console.log(`mf_table_notice_contrast: passed on ${Object.keys(colorPalettes).length} palettes`);
