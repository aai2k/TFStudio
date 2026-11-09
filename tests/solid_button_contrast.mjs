/**
 * A solid button's white label reads at 4.5:1 or better on every built-in
 * theme: its fill is the theme's colour darkened just as far as that needs.
 *
 * Run: node tests/solid_button_contrast.mjs
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { contrastRatio, fillForWhiteText, getPalette, getPaletteNames } = await import('../src/constants/colorPalettes.js');
const { SolidButton } = await import('../src/components/windows/analysis/chrome/controls.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};

// The ratio itself, against the WCAG 2.1 end points.
ok('black on white is 21:1', Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 1e-9);
ok('a colour on itself is 1:1', Math.abs(contrastRatio('#3fb950', '#3fb950') - 1) < 1e-9);

for (const name of getPaletteNames()) {
    const c = getPalette(name);
    for (const key of ['success', 'error']) {
        const fill = fillForWhiteText(c[key]);
        ok(`${name}: white reads on the ${key} fill`, contrastRatio(fill, '#ffffff') >= 4.5,
            `${c[key]} -> ${fill}: ${contrastRatio(fill, '#ffffff').toFixed(2)}:1`);
    }
}
ok('a fill white already reads on is kept', fillForWhiteText('#1f2329') === '#1f2329');
ok('the dark theme green is darkened', fillForWhiteText('#3fb950') !== '#3fb950');

// The button draws the darkened fill, not the theme colour.
const c = makeTheme();
const html = renderToStaticMarkup(React.createElement(SolidButton, { c, color: '#3fb950', label: 'Run', onClick() {} }));
const shown = fillForWhiteText('#3fb950');
const rgb = [1, 3, 5].map(i => parseInt(shown.slice(i, i + 2), 16)).join(', ');
ok('the button is filled with the darkened colour', html.includes(`background-color:${shown}`) || html.includes(`background-color:rgb(${rgb})`), html);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
