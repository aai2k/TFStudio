/**
 * BBM and Mono Resulting Performance: the design curve reads on every theme.
 *
 * The page draws the design's spectrum and the manufactured one over each other
 * on the plot background. The design curve must stand out from that background
 * on every built-in palette, light and dark, by the 3:1 contrast WCAG 2.1
 * (success criterion 1.4.11, non-text contrast) asks of a graphical object that
 * carries information.
 *
 * Run: node tests/monitoring_design_curve_theme.mjs
 */
import assert from 'node:assert/strict';
import { colorPalettes, parseHex } from '../src/constants/colorPalettes.js';

// The page reads React from the global scope. Elements are kept as plain
// objects so the chart's props can be read back, and the spectra the page would
// compute are handed in through useMemo.
const spectra = {
    theory: { lambda: [400, 500, 600], values: [0.9, 0.95, 0.9] },
    manuf: { lambda: [400, 500, 600], values: [0.88, 0.94, 0.91] },
};
globalThis.React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useRef: () => ({ current: null }),
    useEffect: () => {},
    useState: value => [value, () => {}],
    useMemo: () => spectra,
    useCallback: fn => fn,
};

const { PageResults } = await import('../src/components/windows/simulation/wizardKit/PageResults.js');
const { Chart } = await import('../src/components/windows/simulation/wizardShared.js');

function findElement(node, type) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
        for (const child of node) {
            const found = findElement(child, type);
            if (found) return found;
        }
        return null;
    }
    if (node.type === type) return node;
    return findElement(node.children, type);
}

// Relative luminance and contrast ratio, WCAG 2.1 definitions.
function luminance(hex) {
    const channel = value => {
        const s = value / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const { r, g, b } = parseHex(hex);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

const layers = [{ material: 'TiO2', thickness: 50 }];
const run = { targetFront: [50], asBuiltFront: [51], matDeltas: [{ dn: 0, inh: 0 }] };
const ctx = {
    design: { referenceWavelength: 550 },
    resolveMat: () => ({ name: 'TiO2', getNK: () => [2.3, 0] }),
};
const p = { quantity: 'T', pol: 'avg', lamMin: 400, lamMax: 600, yFixed: false };

for (const [name, palette] of Object.entries(colorPalettes)) {
    const page = PageResults({ p, set: () => {}, layers, c: palette, B: {}, ctx, run });
    const chart = findElement(page, Chart);
    assert.ok(chart, `${name}: the spectral tab draws its chart`);
    const design = chart.props.series[0].lineStyle.color;
    const ratio = contrast(design, palette.bg);
    assert.ok(ratio >= 3,
        `${name}: the design curve ${design} on the plot background ${palette.bg} has contrast ${ratio.toFixed(2)}:1`);
}

console.log('monitoring_design_curve_theme passed.');
