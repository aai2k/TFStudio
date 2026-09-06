/**
 * Report engine, end to end without Electron or React:
 *   reportData.gatherDesignData → sections.buildBlock → template.composeReport
 *
 * Every block type is computed on a real design, the composed document is
 * well-formed and carries every block, a block whose data failed degrades to a
 * note instead of throwing, and the locales drive the headings.
 */

import assert from 'node:assert/strict';
import { loadApp, shimBrowserGlobals } from './_uiShim.mjs';
import { REPORT_TEST_DESIGN as design, REPORT_TEST_SETTINGS as settings } from './_reportFixture.mjs';

shimBrowserGlobals();
await loadApp();

const { gatherDesignData } = await import('../src/utils/report/reportData.js');
const { composeReport } = await import('../src/utils/report/template.js');
const { BLOCK_TYPES, newBlock } = await import('../src/utils/report/blocks.js');
const { getLocale } = await import('../src/constants/locales.js');

const blocks = BLOCK_TYPES.map(spec => newBlock(spec.type, settings[spec.type]));
const idOf = type => blocks.find(b => b.type === type).id;

const data = gatherDesignData(design, blocks);
const of = type => data.blocks[idOf(type)];

// ── Every block's numbers ────────────────────────────────────────────────────
assert.equal(data.summary.frontCount, 3);
assert.ok(Math.abs(data.summary.totalThickness - (116.7 + 187.3 + 90)) < 1e-6, 'total thickness summed');
assert.equal(data.summary.front[0].index, 1);
assert.equal(data.summary.front[0].thickness, 90, 'layer 1 is the layer next to the substrate');
assert.equal(data.summary.front[0].locked, true);
const l0 = data.summary.front[0];
assert.ok(isFinite(l0.n) && l0.n > 1, 'layer has refractive index at λref');
assert.ok(Math.abs(l0.ot - l0.n * l0.thickness) < 1e-6, 'layer OT = n·d');
assert.ok(Math.abs(l0.qwot - l0.ot / (data.summary.referenceWavelength / 4)) < 1e-6, 'layer QWOT = OT/(λref/4)');
assert.ok(isFinite(data.summary.materials[0].n) && isFinite(data.summary.materials[0].k), 'materials carry n,k at λref');
assert.ok(data.summary.materials[0].color, 'materials carry the display color');

assert.equal(of('spectrum').series.length, 2, 'spectrum has one series per angle');
assert.ok(of('spectrum').lambda.length > 10);
assert.ok(isFinite(of('color').report.Lab.L), 'color Lab computed');
assert.ok(isFinite(of('integrals').values.Tvis.value), 'Tvis integral computed');
assert.equal(of('qualifiers').results.length, 1);
assert.equal(typeof of('qualifiers').results[0].pass, 'boolean');
assert.equal(of('merit').length, 1);
assert.ok(of('riProfile').z.length > 0, 'RI profile computed');
assert.ok(of('efield').z.length > 0, 'E-field profile computed');
assert.equal(of('ellipsometry').series.length, 2);
assert.equal(of('ellipsometry').series[0].psi.length, of('ellipsometry').lambda.length);
assert.ok(of('ellipsometry').series[0].psi.every(v => v >= 0 && v <= 90), 'Ψ in [0, 90]°');
for (const type of ['title', 'facts', 'layers', 'materials', 'notes', 'signatures']) {
  assert.equal(of(type), undefined, `${type} needs no computation`);
}

// ── The document ─────────────────────────────────────────────────────────────
const html = composeReport({
  lang: 'en', tr: getLocale('en').report, blocks,
  doc: { title: 'AR Coating Report', customer: 'Acme Optics', designer: 'TFS', date: '2026-05-31' },
  brand: { company: 'Acme' },
  designs: [{ design, data }],
  meta: { appName: 'TFStudio', version: '1.0.0', generatedAt: '2026-05-31' },
});
assert.ok(html.startsWith('<!DOCTYPE html>'));
assert.equal((html.match(/<html/g) || []).length, 1);
assert.equal((html.match(/<body/g) || []).length, 1);
for (const spec of BLOCK_TYPES) {
  if (spec.type === 'title') continue;
  assert.ok(html.includes(`data-block="${spec.type}"`), `${spec.type} block present`);
}
assert.equal((html.match(/<section/g) || []).length, (html.match(/<\/section>/g) || []).length, 'balanced sections');
assert.ok(html.includes('<svg'), 'inline SVG plots');
assert.ok(html.includes('tf-masthead') && html.includes('AR Coating Report') && html.includes('Acme Optics'));
assert.ok(html.includes('QWOT') && html.includes('FWOT'), 'extended layer columns');
assert.ok(html.includes('Sample design for report test.'));
assert.ok(!/page-break-after:\s*always/.test(html), 'no forced page break after the masthead');

// A block whose data failed degrades to a note.
const badData = { ...data, blocks: { ...data.blocks, [idOf('spectrum')]: { error: 'synthetic failure' } } };
const badHtml = composeReport({ lang: 'en', tr: {}, blocks, designs: [{ design, data: badData }] });
assert.ok(badHtml.includes('synthetic failure'), 'a failed block renders its error and the document still composes');

// ── Locales drive the headings ───────────────────────────────────────────────
for (const code of ['en', 'ru', 'zh']) {
  const loc = getLocale(code);
  assert.ok(loc.report.sectionTitles.spectrum, `${code} block headings present`);
  assert.ok(loc.report.window.export, `${code} window strings present`);
  assert.ok(loc.toolbar.buttons['report-gen'], `${code} ribbon label present`);
  const tr = { ...loc.report, kinds: (loc.specification && loc.specification.kinds) || {} };
  const doc = composeReport({ lang: code, tr, blocks, designs: [{ design, data }] });
  assert.ok(doc.includes(loc.report.sectionTitles.spectrum), `${code} localized spectrum heading in output`);
  assert.ok(doc.includes(`<html lang="${code}"`));
}
assert.notEqual(getLocale('en').report.sectionTitles.qualifiers, getLocale('ru').report.sectionTitles.qualifiers,
  'EN and RU headings differ');

console.log('report_generation: ok');
