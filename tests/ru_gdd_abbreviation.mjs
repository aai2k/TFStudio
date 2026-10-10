/**
 * Where the Russian UI abbreviates group delay dispersion in Cyrillic, it writes
 * ДГЗ (дисперсия групповой задержки): the GD/GDD window, Pulse analysis, the
 * ribbon, the status-bar monitors and the report. ГГЗ expands to nothing.
 *
 * Run: node tests/ru_gdd_abbreviation.mjs
 */
import { readFileSync } from 'node:fs';
import ru from '../src/constants/locales/ru.js';

// The source text, so a string inside any branch of a locale function counts.
const source = readFileSync(new URL('../src/constants/locales/ru.js', import.meta.url), 'utf-8');
const wrong = source.split('\n').flatMap((line, i) => (line.includes('ГГЗ') ? [`ru.js:${i + 1}`] : []));
if (wrong.length) throw new Error(`ГГЗ instead of ДГЗ at ${wrong.join(', ')}`);

const gddLabels = [ru.toolbar.buttons['gd-gdd'], ru.gdgdd.gddAxis, ru.pulseAnalysis.gdd];
if (!gddLabels.every(text => text.includes('ДГЗ'))) {
  throw new Error(`GDD labels without ДГЗ: ${gddLabels.join(' | ')}`);
}

console.log('ru_gdd_abbreviation: passed');
