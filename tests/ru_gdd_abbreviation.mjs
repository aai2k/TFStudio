/**
 * The Russian UI writes the dispersion quantities in Cyrillic: ГЗ, ДГЗ, КХД and
 * ДТП (дисперсия третьего порядка), never GD, GDD, CDC or TOD, and never ГГЗ or
 * Д3П, which expand to nothing. That holds in the GD/GDD and Material
 * Dispersion buttons, the report's axes and its block settings, the status-bar
 * monitors and the merit operand list, whose rows keep the operand's code in
 * front.
 *
 * Run: node tests/ru_gdd_abbreviation.mjs
 */
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
const { getLocale } = await loadApp();
const ru = getLocale('ru');
const h = React.createElement;
const c = makeTheme();

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

// The source text, so a string inside any branch of a locale function counts.
// A merit operand row starts with its code ('GDDT: ...'), which stays Latin.
const source = readFileSync(new URL('../src/constants/locales/ru.js', import.meta.url), 'utf-8');
const literal = /'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`|"((?:[^"\\]|\\.)*)"/g;
source.split('\n').forEach((line, i) => {
    if (/ГГЗ|Д3П/.test(line)) failures.push(`ru.js:${i + 1} writes ГГЗ or Д3П`);
    for (const match of line.matchAll(literal)) {
        const text = (match[1] ?? match[2] ?? match[3]).replace(/^[A-Z]+: /, '');
        if (/\b(GD|GDD|CDC|TOD)\b/.test(text)) failures.push(`ru.js:${i + 1} writes Latin "${text}"`);
    }
});

const latin = /\b(GD|GDD|CDC|TOD)\b/;
const cyrillic = ['ГЗ', 'ДГЗ', 'КХД', 'ДТП'];

// GD/GDD toolbar, as the window renders it.
const { GDControls } = await import('../src/components/windows/analysis/gdGddEvaluation/GDControls.js');
const noop = () => {};
const toolbar = renderToStaticMarkup(h(GDControls, {
    c, t: ru, text: ru.gdgdd, raw: null, autoRange: null, notices: [],
    state: { targets: [], target: 'R', quantity: 'gd', pol: 'avg', setQuantity: noop, setTarget: noop, setPol: noop },
    editor: { editBlocker: null, editMode: false, setEditMode: noop },
})).replace(/<[^>]*>/g, '\n');
expect(!latin.test(toolbar), 'the GD/GDD toolbar shows a Latin quantity button');
expect(cyrillic.every(name => toolbar.split('\n').includes(name)), 'the GD/GDD toolbar does not offer ГЗ, ДГЗ, КХД and ДТП');

// Material Dispersion builds the same buttons from the same strings.
const dispersionSource = readFileSync(new URL(
    '../src/components/windows/analysis/materialDispersion/MaterialDispersionEvaluation.js', import.meta.url), 'utf-8');
expect(!/['"`](GD|GDD|CDC|TOD)['"`]/.test(dispersionSource), 'Material Dispersion hard-codes a quantity button');

// Report: the document's axes and table headers, and the block's settings line.
const { QUANTITIES } = await import('../src/utils/report/sections/dispersion.js');
const axes = QUANTITIES.filter(q => q.key !== 'phase').map(q => q.label(ru.report));
expect(axes.join() === 'ГЗ, фс,ДГЗ, фс²,КХД, фс/нм,ДТП, фс³', `the report's axes read ${axes.join(' | ')}`);
const { blockSummary } = await import('../src/components/windows/information/report/blockText.js');
const { newBlock } = await import('../src/utils/report/blocks.js');
const block = newBlock('gdGdd', { quantities: { gd: true, gdd: true, cdc: true, tod: true } });
const summary = blockSummary(ru.report.window, block);
expect(summary.includes(cyrillic.join(' ')) && !latin.test(summary), `the report block reads ${summary}`);
const { BlockSettingsPanel } = await import('../src/components/windows/information/report/BlockSettings.js');
const settings = renderToStaticMarkup(h('div', null, BlockSettingsPanel({
    c, W: ru.report.window, t: ru, block, index: 0, count: 1, design: null,
    onChange: noop, onMove: noop, onRemove: noop, onClose: noop,
}))).replace(/<[^>]*>/g, '\n').split('\n');
expect(cyrillic.every(name => settings.includes(name)) && !settings.some(line => latin.test(line)),
    'the report block settings do not offer ГЗ, ДГЗ, КХД and ДТП');

if (failures.length) {
    console.error(`ru_gdd_abbreviation: ${failures.length} failed`);
    for (const failure of failures) console.error(`  FAIL ${failure}`);
    process.exit(1);
}
console.log('ru_gdd_abbreviation: passed');
