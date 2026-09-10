/**
 * One report block per builder, in isolation: the section element it emits,
 * its localized heading, that nothing unrendered leaks into the page, and the
 * error path. report_generation.mjs covers the assembled document.
 */

import assert from 'node:assert/strict';
import { loadApp, shimBrowserGlobals } from './_uiShim.mjs';
import { REPORT_TEST_DESIGN as design, REPORT_TEST_SETTINGS as settings } from './_reportFixture.mjs';

shimBrowserGlobals();
await loadApp();

const { buildBlock, buildComparisonBlock, hasComparisonForm, rendersOnce } = await import('../src/utils/report/sections.js');
const { gatherDesignData } = await import('../src/utils/report/reportData.js');
const { BLOCK_TYPES, newBlock } = await import('../src/utils/report/blocks.js');
const { getLocale } = await import('../src/constants/locales/index.js');

const loc = getLocale('en');
const tr = { ...loc.report, kinds: (loc.specification && loc.specification.kinds) || {} };
const blocks = BLOCK_TYPES.map(spec => newBlock(spec.type, settings[spec.type]));
const data = gatherDesignData(design, blocks);

// Every builder emits its own section element under its localized heading.
for (const block of blocks) {
  if (block.type === 'title') {
    assert.equal(buildBlock(block, { design, data, tr }), '', 'the title is page furniture, not a section');
    continue;
  }
  const html = buildBlock(block, { design, data, tr });
  assert.ok(html.startsWith(`<section class="tf-block tf-block-${block.type}`) && html.endsWith('</section>'),
    `${block.type}: wrapped in its own section element`);
  assert.ok(html.includes(`data-block="${block.type}"`), `${block.type}: carries its type`);
  if (block.type !== 'signatures') {
    assert.ok(html.includes(`<h2><span>${tr.sectionTitles[block.type]}</span>`), `${block.type}: localized heading`);
  }
  assert.ok(!/undefined|\[object Object\]|NaN/.test(html), `${block.type}: no unrendered placeholder`);
}

// A block rendered under a design's name carries it in the heading.
{
  const efield = blocks.find(b => b.type === 'efield');
  const html = buildBlock(efield, { design, data, tr, designName: 'Candidate B' });
  assert.ok(html.includes('<span class="tf-sub">Candidate B'), 'design name leads the subtitle');
}

// The error path renders a note and keeps the heading.
{
  const spectrum = blocks.find(b => b.type === 'spectrum');
  const badData = { ...data, blocks: { ...data.blocks, [spectrum.id]: { error: 'synthetic failure' } } };
  const html = buildBlock(spectrum, { design, data: badData, tr });
  assert.equal(html,
    `<section class="tf-block tf-block-spectrum" data-block="spectrum"><h2><span>${tr.sectionTitles.spectrum}</span></h2>`
    + '<p class="tf-note tf-err">synthetic failure</p></section>');
  const missing = buildBlock(spectrum, { design, data: { ...data, blocks: {} }, tr });
  assert.ok(missing.includes('not computed'), 'a block without data says so');
}

assert.equal(buildBlock({ id: 'x', type: 'nonexistent', on: true, settings: {} }, { design, data, tr }), '',
  'an unknown type renders nothing');

// Comparison forms exist for the blocks that read across designs, and only those.
const comparable = ['facts', 'layers', 'materials', 'spectrum', 'qualifiers', 'integrals', 'color'];
for (const spec of BLOCK_TYPES) {
  assert.equal(hasComparisonForm(spec.type), comparable.includes(spec.type), `${spec.type}: comparison form`);
}
assert.ok(rendersOnce('title') && rendersOnce('signatures') && !rendersOnce('facts'));
{
  const items = [
    { label: 'A', name: 'First candidate', color: '#c62828', design, data },
    { label: 'B', name: 'Second candidate', color: '#1565c0', design, data },
  ];
  const facts = blocks.find(b => b.type === 'facts');
  const html = buildComparisonBlock(facts, { designs: items, tr });
  assert.ok(html.includes('data-block="facts"') && html.includes('tf-chip') && html.includes('A</th>') && html.includes('B</th>'),
    'design headers carry a color chip and the design letter');
  assert.ok(!html.includes('First candidate'), 'the name stays in the key');
  assert.equal((html.match(/<\/th>/g) || []).length, 3, 'a column per design plus the row label');
  assert.equal(buildComparisonBlock(blocks.find(b => b.type === 'notes'), { designs: items, tr }), null,
    'a block without a comparison form returns null so it renders per design');
}

console.log('sections_characterization: ok');
