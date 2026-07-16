/**
 * Report Generator — characterization test for the pure model layer
 * (src/components/windows/information/reportGenerator/model.js).
 *
 * Locks the window-local contracts the report-engine tests don't cover:
 * AOI-list parsing, the initial section / per-section / cover defaults, and
 * the preset payload shape (logo intentionally dropped from a saved preset).
 *
 * Run: node tests/report_generator_characterization.mjs
 */
import './_uiShim.mjs';
import assert from 'node:assert/strict';
import {
    parseAoiList, initialSections, initialPerSection, initialCover, presetPayload, todayISO,
} from '../src/components/windows/information/reportGenerator/model.js';
import { REPORT_SECTIONS } from '../src/utils/report/sections.js';

console.log('— parseAoiList —');
assert.deepEqual(parseAoiList('0, 30, 45'), [0, 30, 45], 'comma+space separated');
assert.deepEqual(parseAoiList('0 30 45'), [0, 30, 45], 'space separated');
assert.deepEqual(parseAoiList('30, 30, 30'), [30], 'dedup');
assert.deepEqual(parseAoiList(''), [0], 'empty → default fallback 0');
assert.deepEqual(parseAoiList('', 15), [15], 'empty → explicit fallback');
assert.deepEqual(parseAoiList('90, 120, -5, 45'), [45], 'out-of-range (>=90, <0) dropped');
assert.deepEqual(parseAoiList('12.34'), [12.3], 'rounded to 0.1°');
assert.deepEqual(parseAoiList('foo, 20, bar'), [20], 'non-numeric tokens dropped');

console.log('— initialSections —');
const secs = initialSections();
assert.deepEqual(secs.map(s => s.id), REPORT_SECTIONS.map(s => s.id), 'order matches catalogue');
assert.deepEqual(secs.map(s => s.on), REPORT_SECTIONS.map(s => s.defaultOn), 'on-state honors defaultOn');

console.log('— initialPerSection —');
const per = initialPerSection();
assert.deepEqual(per['optical-eval'].curves, ['T', 'R'], 'optical default curves');
assert.equal(per['optical-eval'].lambdaStart, 400);
assert.equal(per['optical-eval'].lambdaEnd, 800);
assert.equal(per['color-eval'].illuminant, 'D65');
assert.deepEqual(per['ellipsometry'].thetas, [65]);

console.log('— initialCover —');
const cov = initialCover('My Folder');
assert.equal(cov.project, 'My Folder', 'folderName → project');
assert.equal(cov.logoDataUrl, null);
assert.match(cov.date, /^\d{4}-\d{2}-\d{2}$/, 'date is ISO yyyy-mm-dd');
assert.equal(initialCover().project, '', 'no folder → empty project');
assert.equal(todayISO(), cov.date, 'cover date == todayISO');

console.log('— presetPayload —');
const pp = presetPayload({
    presetName: '  My Preset  ', sections: [{ id: 'notes', on: true }],
    perSection: { notes: {} }, lang: 'en', format: 'html',
    cover: { title: 'T', logoDataUrl: 'data:image/png;base64,AAAA' },
});
assert.equal(pp.name, 'My Preset', 'name trimmed');
assert.equal(pp.lang, 'en');
assert.equal(pp.format, 'html');
assert.equal(pp.cover.logoDataUrl, undefined, 'logo stripped from saved preset');
assert.equal(pp.cover.title, 'T', 'other cover fields kept');

console.log('\nAll report generator characterization tests passed.');
