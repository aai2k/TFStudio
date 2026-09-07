import assert from 'node:assert/strict';
import { colorPalettes, parseHex } from '../src/constants/colorPalettes.js';
import { rowTintAlpha } from '../src/components/windows/optimization/meritFunctionEditor/mfTable/operandViewModel.js';

// WCAG relative luminance and contrast ratio.
const channel = value => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = hex => {
    const { r, g, b } = parseHex(hex);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a, b) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
};
// A translucent colour composited over an opaque surface.
const over = (rgb, alpha, base) => {
    const b = parseHex(base);
    return '#' + [b.r, b.g, b.b]
        .map((v, i) => Math.round(rgb[i] * alpha + v * (1 - alpha)).toString(16).padStart(2, '0'))
        .join('');
};

const palettes = Object.entries(colorPalettes).filter(([name]) => name !== 'High Contrast');
const light = palettes.filter(([, p]) => p.light);
const dark = palettes.filter(([, p]) => !p.light);
assert.ok(light.length >= 3 && dark.length >= 3);

// A divider on a light panel must be at least as visible as on a dark one. The
// light themes shipped at about 1.3:1 against white and the lines between two
// white panels could not be seen; the dark themes sit at about 1.6:1.
const darkBorder = Math.min(...dark.map(([, p]) => contrast(p.border, p.panel)));
const darkStrong = Math.min(...dark.map(([, p]) => contrast(p.borderStrong, p.panel)));
for (const [name, p] of light) {
    assert.ok(contrast(p.border, p.panel) >= darkBorder,
        `${name}: border ${p.border} on ${p.panel} is ${contrast(p.border, p.panel).toFixed(2)}:1, dark themes reach ${darkBorder.toFixed(2)}:1`);
    assert.ok(contrast(p.borderStrong, p.panel) >= darkStrong,
        `${name}: borderStrong ${p.borderStrong} on ${p.panel} is ${contrast(p.borderStrong, p.panel).toFixed(2)}:1, dark themes reach ${darkStrong.toFixed(2)}:1`);
    // The divider still has to read as a line, not as a second surface.
    assert.ok(contrast(p.border, p.panel) < contrast(p.textDim, p.panel), `${name}: border darker than dim text`);
}

// Operand row tints: the merit table colours each row by operand type with a
// translucent tint over the panel. The tint on a light theme must be at least
// as visible as on a dark one, for every type colour in use.
const typeColors = [[80, 150, 255], [50, 200, 100], [255, 130, 30], [180, 100, 255]];
const tintContrast = (p, alpha) => Math.min(...typeColors.map(rgb => contrast(over(rgb, alpha, p.panel), p.panel)));
const darkTint = Math.min(...dark.map(([, p]) => tintContrast(p, rowTintAlpha(false))));
for (const [name, p] of light) {
    const value = tintContrast(p, rowTintAlpha(true));
    assert.ok(value >= darkTint, `${name}: row tint ${value.toFixed(2)}:1, dark themes reach ${darkTint.toFixed(2)}:1`);
}

console.log(`palette contrast ok: ${light.length} light themes at or above the dark themes (border ${darkBorder.toFixed(2)}:1, tint ${darkTint.toFixed(2)}:1)`);
