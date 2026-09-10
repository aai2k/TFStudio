/**
 * Report document: blocks, templates and the composed HTML.
 *
 * The layer table flows into side-by-side columns once it is long enough to
 * save height, groups only periods that are identical at the printed
 * precision, and numbers layers from the substrate the way the Design Editor
 * does. Several designs render as a comparison, not as one report per design.
 */

import assert from 'node:assert/strict';
import { loadApp, makeLocale, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const {
  BLOCK_TYPES, BUILTIN_TEMPLATES, BUILTIN_TYPES, blocksFromTemplate, newBlock, convertLegacyPreset,
  normalizeTemplate, templateFromBlocks, withDefaults,
} = await import('../src/utils/report/blocks.js');
const { getLocale } = await import('../src/constants/locales/index.js');
const { gatherDesignData } = await import('../src/utils/report/reportData.js');
const { composeReport, pdfHeaderTemplate, pdfFooterTemplate, reportFileBase } =
  await import('../src/utils/report/template.js');
const { layerColumnCount } = await import('../src/utils/report/sections/layers.js');
const { groupPeriods } = await import('../src/utils/report/sections/layerGroups.js');
const { stepIndices } = await import('../src/utils/report/sections/spectrum.js');

const tr = makeLocale('en').report;

// Front layers are stored incident-side first. Layer numbering in the report
// must run from the substrate, so the last stored layer prints as layer 1.
function design(count, { name = 'Test', jitter = 0, back = 0 } = {}) {
  const front = [];
  for (let i = 0; i < count; i++) {
    const high = i % 2 === 0;
    const d = (high ? 74.47 : 119.86) * (1 + jitter * ((i % 7) - 3) / 100);
    front.push({ id: `f${i}`, material: high ? 'TiO2' : 'SiO2', thickness: Math.round(d * 100) / 100, locked: i === 0 });
  }
  const backLayers = [];
  for (let i = 0; i < back; i++) backLayers.push({ id: `b${i}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness: 50 + i, locked: false });
  return {
    id: name, name, incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 }, referenceWavelength: 700,
    frontLayers: front, backLayers, surfaceMode: back ? 'both_independent' : 'front_only',
    notes: 'Sample notes.',
  };
}

const count = (html, needle) => html.split(needle).length - 1;
function section(html, type) {
  const m = html.match(new RegExp(`<section class="tf-block tf-block-${type}[^"]*" data-block="${type}">([\\s\\S]*?)</section>`));
  return m ? m[1] : null;
}
function render(designs, blocks, extra = {}) {
  const items = designs.map(d => ({ design: d, data: gatherDesignData(d, blocks) }));
  return composeReport({ tr, blocks, designs: items, doc: { title: 'Unit report', docNo: 'D-1', revision: 'B', date: '2026-09-05' },
    brand: { company: 'Coating shop', accent: '#123456', footer: 'Internal' }, meta: { appName: 'TFStudio', version: '1.7.2' }, ...extra });
}

// ── Column flow ──────────────────────────────────────────────────────────────
assert.equal(layerColumnCount(7, false), 1, 'a short stack is one column');
assert.equal(layerColumnCount(35, false), 2, 'past one column of rows the table flows into two');
assert.equal(layerColumnCount(98, false), 3, 'a long stack fills three columns');
assert.equal(layerColumnCount(400, false), 3, 'three columns is the most the four-field table gets');
assert.equal(layerColumnCount(98, true), 2, 'the extended table gets at most two columns');
assert.equal(layerColumnCount(98, false, 1), 1, 'an explicit column count wins');
assert.equal(layerColumnCount(5, false, 4), 4, 'an explicit column count wins even for a short stack');

// ── Period grouping ──────────────────────────────────────────────────────────
{
  const rows = [];
  for (let i = 0; i < 49; i++) rows.push({ index: i + 1, material: i % 2 ? 'SiO2' : 'TiO2', thickness: i % 2 ? 119.86 : 74.47 });
  rows.push({ index: 50, material: 'SiO2', thickness: 59.93 });
  const groups = groupPeriods(rows, 2);
  assert.equal(groups.length, 3, 'a (HL)^24 H L stack groups into a period, a leftover layer and the odd last layer');
  assert.deepEqual([groups[0].from, groups[0].to, groups[0].repeats, groups[0].period.length], [1, 48, 24, 2]);
  assert.deepEqual([groups[1].from, groups[1].to, groups[1].repeats], [49, 49, 1]);
  assert.deepEqual([groups[2].from, groups[2].to], [50, 50]);
}
{
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push({ index: i + 1, material: i % 2 ? 'SiO2' : 'TiO2', thickness: (i % 2 ? 119.86 : 74.47) - 0.02 * i });
  assert.equal(groupPeriods(rows, 2).length, 12, 'rows that differ at the printed precision never merge');
  assert.equal(groupPeriods(rows, 0).length, 1, 'the same rows merge once the precision hides the difference');
}
{
  const rows = [1, 2, 3].map(i => ({ index: i, material: 'TiO2', thickness: 74.47 }));
  assert.equal(groupPeriods(rows, 2).length, 3, 'fewer than four covered layers is not worth a group row');
}

// ── Templates ────────────────────────────────────────────────────────────────
{
  const blocks = blocksFromTemplate(BUILTIN_TEMPLATES['customer']);
  for (const type of BUILTIN_TYPES) assert.ok(blocks.some(b => b.type === type), `built-in block ${type} is present`);
  assert.equal(blocks.find(b => b.type === 'layers').on, false, 'the customer template switches the recipe off');
  assert.ok(blocks.every(b => b.id), 'every block has an id');
  assert.ok(new Set(blocks.map(b => b.id)).size === blocks.length, 'ids are unique');
  const back = templateFromBlocks('mine', blocks, { paper: 'Letter', lang: 'ru' });
  assert.equal(back.ver, 2);
  assert.equal(back.paper, 'Letter');
  assert.equal(back.blocks.length, blocks.length);
  assert.ok(!('id' in back.blocks[0]), 'a template carries no block ids');
}
{
  const legacy = {
    ver: 1, name: 'old', lang: 'ru', format: 'pdf',
    sections: [{ id: 'cover', on: true }, { id: 'design-summary', on: true }, { id: 'optical-eval', on: true }, { id: 'color-eval', on: false }, { id: 'notes', on: true }],
    perSection: {
      'design-summary': { optical: true, materialsTable: true },
      'optical-eval': { curves: ['T'], includeTable: true, lambdaStart: 380, lambdaEnd: 780, lambdaStep: 5, thetas: [0, 45] },
      'notes': { text: 'Kept from the preset.' },
    },
    cover: { title: 'Old title', subtitle: 'Sub', customer: 'Acme', project: 'P-1', designer: 'D', date: '2025-01-02' },
  };
  const t = normalizeTemplate(legacy);
  assert.equal(t.ver, 2);
  const types = t.blocks.map(b => b.type);
  assert.deepEqual(types, ['title', 'facts', 'layers', 'materials', 'spectrum', 'color', 'notes']);
  assert.equal(t.blocks[6].settings.text, 'Kept from the preset.', 'the notes text carries over');
  assert.deepEqual(t.doc, { title: 'Old title', customer: 'Acme', designer: 'D', date: '2025-01-02' },
    'the cover fields with a place in the document carry over');
  assert.equal(t.blocks[2].settings.extended, true, 'the optical-columns option becomes the extended layer table');
  assert.equal(t.blocks[3].settings.table, true, 'the materials-table option carries over');
  const sp = withDefaults('spectrum', t.blocks[4].settings);
  assert.deepEqual(sp.curves, { T: true, R: false, A: false, Ts: false, Rs: false, Tp: false, Rp: false });
  assert.equal(sp.tableStep, 10);
  assert.deepEqual(sp.thetas, [0, 45]);
  assert.equal(t.blocks[5].on, false);
  assert.equal(normalizeTemplate(t), t, 'a current template passes through');
  assert.equal(convertLegacyPreset({ sections: [] }).blocks.length, 0);
}

// ── One design ───────────────────────────────────────────────────────────────
{
  const d = design(98, { back: 4 });
  const blocks = blocksFromTemplate(BUILTIN_TEMPLATES['design-record']);
  const html = render([d], blocks);

  assert.ok(html.includes('<header class="tf-masthead">'), 'the title block renders the masthead');
  assert.ok(html.includes('Unit report') && html.includes('D-1') && html.includes('Coating shop'));
  assert.ok(html.includes('--tf-accent: #123456'), 'the brand accent reaches the stylesheet');
  assert.ok(!html.includes('—'), 'no em dashes in the document');

  const layers = section(html, 'layers');
  assert.ok(layers, 'layer block present');
  assert.equal(count(layers, '<div class="tf-flow">'), 1, 'the 98-layer front coating flows; the 4-layer back does not');
  const flowHtml = layers.slice(layers.indexOf('<div class="tf-flow">'));
  assert.equal(count(flowHtml.slice(0, flowHtml.indexOf('</div>')), '<table'), 3, 'three side-by-side tables');
  assert.ok(layers.includes(tr.orderNote), 'the numbering convention is printed');
  assert.ok(layers.includes('QWOT') && !layers.includes('FWOT'), 'essential columns by default');
  const firstRow = layers.match(/<tbody><tr><td class="r">1<\/td><td>(.*?)<\/td>/);
  assert.ok(firstRow, 'layer 1 is the first row');
  const substrateSide = d.frontLayers[d.frontLayers.length - 1].material;
  assert.ok(firstRow[1].includes(substrateSide), 'layer 1 is the layer next to the substrate');
  assert.ok(layers.includes('tf-lock'), 'a locked layer carries the padlock');

  const facts = section(html, 'facts');
  assert.ok(facts.includes('98 + 4'), 'facts count both coatings');
  assert.ok(facts.includes('<svg class="tf-stack"'), 'stack diagram drawn');
  assert.ok(facts.includes('>+82<'), 'the long front coating is elided in the diagram');

  const materials = section(html, 'materials');
  assert.ok(materials.includes('tf-legend') && materials.includes('TiO2') && materials.includes('SiO2'), 'materials render as a legend line');
  assert.ok(materials.includes('n 2.'), 'legend carries n at the reference wavelength');

  const spectrum = section(html, 'spectrum');
  assert.ok(spectrum.includes('<svg'), 'spectrum plot present');
  assert.ok(spectrum.includes('<table'), 'spectrum table present by default');
  assert.ok(!html.includes('data-block="integrals"'), 'a block switched off does not render');
  assert.ok(section(html, 'notes').includes('Sample notes.'));
  assert.ok(html.includes('Generated by TFStudio 1.7.2'));
}

// Extended columns, grouped periods, plot sizes.
{
  const d = design(52);
  const blocks = [newBlock('layers', { extended: true }), newBlock('spectrum', { plot: 'none', tableStep: 0 })];
  const html = render([d], blocks);
  const layers = section(html, 'layers');
  assert.ok(layers.includes('OT, nm') && layers.includes('FWOT'), 'extended columns present');
  assert.equal(count(layers, '<table'), 2, '52 extended rows flow into two columns');
  const spectrum = section(html, 'spectrum');
  assert.ok(!spectrum.includes('<svg') && !spectrum.includes('<table'), 'plot off and no table leaves the caption only');
  const profiles = render([d], [newBlock('efield', { plot: 'none' }), newBlock('riProfile', { plot: 'none' })]);
  assert.ok(!section(profiles, 'efield').includes('<svg') && !section(profiles, 'riProfile').includes('<svg'),
    'a profile block with its plot switched off draws none');

  const grouped = render([d], [newBlock('layers', { groupPeriods: true })]);
  const g = section(grouped, 'layers');
  assert.ok(g.includes('× 26'), 'exact quarter-wave periods group');
  assert.ok(g.includes(tr.groupedNote));
  const jittered = render([design(52, { jitter: 1 })], [newBlock('layers', { groupPeriods: true })]);
  assert.ok(!section(jittered, 'layers').includes(' × '), 'a refined stack prints every layer');
}

// Group delay, monitoring worksheet and Monte-Carlo blocks.
{
  const d = design(12);
  const blocks = [
    newBlock('gdGdd', { lambdaStep: 5, quantities: { phase: true, gd: true, gdd: true, tod: true }, tableStep: 50 }),
    newBlock('worksheet'),
    newBlock('monteCarlo'),
  ];
  const html = render([d], blocks);
  const gd = section(html, 'gdGdd');
  assert.equal(count(gd, '<svg'), 4, 'one plot per chosen dispersion quantity');
  assert.ok(gd.includes('GDD, fs²') && gd.includes('TOD, fs³') && gd.includes('<table'), 'axis units and the stepped table');
  const badStep = gatherDesignData(d, [newBlock('gdGdd', { lambdaStep: 0 })]);
  assert.match(Object.values(badStep.blocks)[0].error, /step/i, 'a step of zero is refused instead of looping');
  const ws = section(html, 'worksheet');
  assert.equal(count(ws, '<tr>'), 13, 'one worksheet row per deposited layer plus the header');
  assert.ok(ws.includes('1-1') && ws.includes('4-1'), 'chips of three layers, numbered chip-position');
  assert.ok(ws.includes(tr.worksheetOrder));
  assert.equal(count(ws, '</th>'), 13, 'every column of the window by default');
  assert.ok(ws.includes('tf-dense'), 'the full table is set small so it fits the page');
  assert.ok(section(html, 'monteCarlo').includes(tr.mcNoRun), 'without a run the block says where to make one');

  // The worksheet prints the chip plan and the wavelengths the Monitor
  // Worksheet window holds, handed in from outside; the block carries none of them.
  const plan = { layersPerChip: 4, lambdaByStep: new Array(12).fill(523) };
  const planned = section(composeReport({
    tr, blocks, designs: [{ design: d, data: gatherDesignData(d, blocks, { worksheet: () => plan }) }],
  }), 'worksheet');
  assert.ok(planned.includes('3-4') && !planned.includes('4-1'), 'chips of four, as the window plans them');
  assert.equal(count(planned, '>523<'), 12, 'every row monitors at the wavelength typed in the window');

  const lambda = [400, 500, 600, 700, 800];
  const result = {
    lambda, theory: [0.02, 0.01, 0.005, 0.01, 0.02], mean: [0.022, 0.011, 0.006, 0.011, 0.021],
    stdev: [0.004, 0.003, 0.002, 0.003, 0.004], lower: [0.018, 0.008, 0.004, 0.008, 0.017], upper: [0.026, 0.014, 0.008, 0.014, 0.025],
    envLower: [0.015, 0.006, 0.003, 0.006, 0.014], envUpper: [0.03, 0.02, 0.01, 0.02, 0.03], nTrials: 200, char: 'R',
    spec: { nTrials: 200, evaluated: 200, passCount: 190, yield: 0.95, perQualifier: [{ label: 'R avg 420-680', failRate: 0.05 }] },
  };
  const external = { monteCarlo: () => ({ result, settings: { corridorSigma: 2, rmsRelPct: 1, rmsAbsNm: 0, rmsReN: 0, rmsImN: 0, distribution: 'gaussian', theta: 0, polarization: 'avg' } }) };
  const items = [{ design: d, data: gatherDesignData(d, blocks, external) }];
  const withRun = composeReport({ tr, blocks, designs: items });
  const mc = section(withRun, 'monteCarlo');
  assert.ok(mc.includes('<svg') && mc.includes('<table'), 'a run gives a plot and a table');
  assert.ok(mc.includes(tr.mcTrials(200)) && mc.includes('−2σ'), 'the run facts and the corridor width come from the window');
  assert.ok(mc.includes(tr.mcYield(190, 200, '95.0')) && mc.includes('R avg 420-680'), 'the specification yield and the failing requirement are printed');
  assert.ok(mc.includes('tf-verdict tf-pass'), 'a yield at the window\'s pass threshold is marked as passing');
  const warnRun = { ...result, spec: { ...result.spec, passCount: 170, yield: 0.85 } };
  const warnItems = [{ design: d, data: gatherDesignData(d, blocks, { monteCarlo: () => ({ result: warnRun, settings: external.monteCarlo().settings }) }) }];
  assert.ok(section(composeReport({ tr, blocks, designs: warnItems }), 'monteCarlo').includes('tf-verdict tf-warn'),
    'a yield between the window\'s two thresholds is marked amber, as the window marks it');
}

// The spectrum block reads as Optical Evaluation does: its unit, its vertical
// scale and the s and p components.
{
  const d = design(12);
  const ev = render([d], [newBlock('spectrum', {
    spectralUnit: 'eV', yScale: 'dB', curves: { T: true, R: false, A: false, Ts: true, Rs: false, Tp: true, Rp: false }, tableStep: 100,
  })]);
  const sp = section(ev, 'spectrum');
  assert.ok(sp.includes('E, eV') && sp.includes(tr.spectralAxis.eV), 'the axis follows the unit in the table header and the plot title');
  assert.ok(sp.includes('T, dB') && sp.includes('Ts, dB') && sp.includes('Tp, dB'), 'the scale reaches the columns, s and p components included');
  assert.ok(sp.includes('1.55-3.1 eV'), 'the range reads low to high in the unit');
  const od = section(render([d], [newBlock('spectrum', { yScale: 'OD', curves: { T: true, R: true }, tableStep: 100 })]), 'spectrum');
  assert.ok(od.includes('T, OD') && !od.includes('R, OD'), 'optical density reads transmittance only');
  const fraction = section(render([d], [newBlock('spectrum', { yScale: 'fraction', tableStep: 400 })]), 'spectrum');
  assert.ok(/<td class="r">0\.\d{4}<\/td>/.test(fraction), 'a fraction prints with four decimals');
}

// Spectral table step.
{
  const lambda = [];
  for (let l = 400; l <= 800; l += 2) lambda.push(l);
  assert.equal(stepIndices(lambda, 10).length, 41, 'every 10 nm over 400-800 nm is 41 rows');
  assert.equal(stepIndices(lambda, 0).length, lambda.length, 'a zero step keeps every sample');
  assert.equal(stepIndices([550], 10).length, 1);
}

// ── Several designs ──────────────────────────────────────────────────────────
{
  const a = design(7, { name: 'Alpha' });
  const b = design(9, { name: 'Beta with a very long descriptive name that would never fit in a column' });
  const blocks = blocksFromTemplate(BUILTIN_TEMPLATES['comparison']);
  blocks.push(newBlock('efield'));
  const html = render([a, b], blocks);
  const key = section(html, 'designs');
  assert.ok(key, 'a key of the designs follows the masthead');
  assert.ok(key.includes('>A</th>') === false && key.includes('Alpha') && key.includes(b.name), 'the key carries letter and full name');
  assert.equal(count(html, 'data-block="facts"'), 1, 'facts render once as a table across designs');
  const facts = section(html, 'facts');
  assert.equal(count(facts, '</th>'), 3, 'one column per design plus the row label');
  assert.ok(facts.includes('A</th>') && facts.includes('B</th>'), 'columns are headed by the letters');
  assert.ok(!facts.includes('Alpha') && !facts.includes(b.name), 'no name widens a column');
  assert.equal(count(html, 'data-block="spectrum"'), 1, 'one overlaid spectrum');
  assert.ok(section(html, 'spectrum').includes('T A') && section(html, 'spectrum').includes('R B'), 'legend uses the letters');
  assert.equal(count(html, 'data-block="layers"'), 1, 'recipes side by side in one block');
  assert.ok(section(html, 'layers').includes('tf-grid'));
  assert.equal(count(html, 'data-block="efield"'), 2, 'a block with no comparison form renders per design');
  const efields = html.split('data-block="efield"');
  assert.ok(efields[1].includes('<b>A</b>') && efields[2].includes('<b>B</b>'), 'per-design blocks carry the letter in their heading');
  assert.ok(html.includes(tr.designsCount(2)), 'the masthead counts the designs instead of listing them');
  assert.ok(!html.includes('Alpha, Beta'));

  // The block settings reach the comparison forms.
  const opted = render([a, b], [newBlock('facts', { stackDiagram: true }), newBlock('layers', { extended: true }), newBlock('materials', { table: true })]);
  assert.equal(count(section(opted, 'facts'), '<svg class="tf-stack"'), 2, 'the stack diagram is drawn per design');
  assert.ok(section(opted, 'layers').includes('FWOT'), 'the optical columns reach the side-by-side recipes');
  assert.equal(count(section(opted, 'materials'), '<table'), 2, 'the materials table is drawn per design');
  const groupedPair = render([design(52, { name: 'P' }), design(52, { name: 'Q' })], [newBlock('layers', { groupPeriods: true })]);
  assert.equal(count(section(groupedPair, 'layers'), '× 26'), 2, 'period grouping reaches both recipes');
}

// No em dashes in a document of any language.
for (const code of ['ru', 'zh']) {
  const loc = getLocale(code);
  const trLoc = { ...loc.report, kinds: loc.specification?.kinds || {}, mw: loc.monitorWorksheet || {} };
  const blocks = BLOCK_TYPES.map(spec => newBlock(spec.type));
  const d = design(12);
  const html = composeReport({ tr: trLoc, lang: code, blocks, designs: [{ design: d, data: gatherDesignData(d, blocks) }] });
  assert.ok(!html.includes('—'), `no em dashes in the ${code} document`);
}

// Many designs: the comparison tables split into groups of columns.
{
  const many = Array.from({ length: 8 }, (_, i) => design(5 + i, { name: `Candidate number ${i + 1} with a long name` }));
  const html = render(many, blocksFromTemplate(BUILTIN_TEMPLATES['comparison']));
  const facts = section(html, 'facts');
  assert.equal(count(facts, '<table'), 2, 'eight designs become two tables of at most six columns');
  assert.equal(count(facts, '</th>'), 7 + 3, 'six plus two design columns, each table with its label column');
  assert.ok(facts.includes('H</th>') && !facts.includes('Candidate'), 'the eighth design is H and no name appears');
  assert.equal(count(section(html, 'designs'), '<tr>'), 9, 'the key lists all eight');
}

// ── PDF furniture ────────────────────────────────────────────────────────────
{
  const header = pdfHeaderTemplate({ tr, doc: { title: 'Unit report', docNo: 'D-1', revision: 'B', date: '2026-09-05' }, designs: [] });
  assert.ok(header.includes('Unit report') && header.includes('D-1') && header.includes('2026-09-05'));
  const footer = pdfFooterTemplate({ tr, brand: { footer: 'Internal' }, meta: { appName: 'TFStudio', version: '1.7.2' }, designs: [{ name: 'Alpha' }] });
  assert.ok(footer.includes('class="pageNumber"') && footer.includes('class="totalPages"'), 'page N of M');
  assert.ok(footer.includes('Internal') && footer.includes('Alpha'));
  assert.ok(pdfFooterTemplate({ tr: getLocale('zh').report, designs: [] }).includes('页，共 <span class="totalPages"></span> 页'),
    'the Chinese footer closes with its own word order');
  assert.equal(reportFileBase({ title: 'AR coating / rev 2' }, []), 'AR_coating_rev_2');
  assert.equal(reportFileBase({}, [{ design: { name: 'LWP 650' } }]), 'LWP_650');
  assert.equal(reportFileBase({ title: 'Просветляющее покрытие' }, []), 'Просветляющее_покрытие', 'a Cyrillic title keeps its letters');
  assert.equal(reportFileBase({ title: '增透膜报告' }, []), '增透膜报告', 'so does a Chinese one');
}

console.log('report_document: ok');
