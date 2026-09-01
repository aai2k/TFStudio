// Unit test for svgChart.js — the report's inline chart renderer.
//
// Covers the branches that shape the emitted SVG: entity escaping, the no-data
// placeholder, a degenerate (constant x and y) range, multi-series legends with
// dashes, staircase series, exponential tick formatting far from unity, and
// null/NaN gaps being dropped from the polyline rather than plotted as zero.
// Run: node tests/svgChart_characterization.mjs
import { escapeHtml, lineChartSVG, stepChartSVG } from '../src/utils/report/svgChart.js';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }
const points = (svg) => [...svg.matchAll(/<polyline[^>]*points="([^"]*)"/g)].map((m) => m[1]);

// ── escapeHtml ────────────────────────────────────────────────────────────────
ok('escapeHtml: full entity set', escapeHtml(`<b>"Tom's" & Jerry</b>`) === '&lt;b&gt;&quot;Tom&#39;s&quot; &amp; Jerry&lt;/b&gt;');
ok('escapeHtml: null -> ""', escapeHtml(null) === '');
ok('escapeHtml: number coerced', escapeHtml(42) === '42');

// ── lineChartSVG: no data -> "no data" placeholder (verbatim) ───────────────
{
  const svg = lineChartSVG({ series: [] });
  const expect = '<svg viewBox="0 0 720 320" class="tf-chart" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="720" height="320" fill="#fff"/><text x="360" y="160" text-anchor="middle" fill="#999" font-size="13">no data</text></svg>';
  ok('lineChartSVG no-data: verbatim', svg === expect);
}

// ── lineChartSVG: degenerate range (constant x, constant y) ──────────────────
// A zero-width range must not divide by zero: the axis is padded to ±0.5 and
// every sample lands on the same point.
{
  const svg = lineChartSVG({ series: [{ x: [500, 500, 500], y: [1, 1, 1], color: '#000', label: 'flat' }] });
  ok('lineChartSVG degenerate: axis padded around the constant x', svg.includes('>500.2<') && svg.includes('>500.8<'));
  ok('lineChartSVG degenerate: all samples collapse to one point',
     points(svg)[0] === '56.0,144.0 56.0,144.0 56.0,144.0');
}

// ── lineChartSVG: single series, auto x/y range, axis labels ─────────────────
{
  const svg = lineChartSVG({
    series: [{ x: [400, 450, 500, 550, 600], y: [0.1, 0.3, 0.9, 0.5, 0.2], color: '#1565c0', label: 'T' }],
    xLabel: 'Wavelength (nm)', yLabel: '(%)',
  });
  ok('lineChartSVG single-series: one polyline over all five samples',
     points(svg).length === 1 && points(svg)[0].split(' ').length === 5);
  ok('lineChartSVG single-series: axis labels emitted',
     svg.includes('Wavelength (nm)') && svg.includes('(%)'));
}

// ── lineChartSVG: multi-series, legend (incl. long label), dash, fixed range ─
{
  const svg = lineChartSVG({
    width: 720, height: 320,
    series: [
      { x: [400, 500, 600, 700], y: [10, 30, 90, 50], color: '#1565c0', label: 'T @0°' },
      { x: [400, 500, 600, 700], y: [5, 20, 40, 30], color: '#c62828', label: 'R @0°', dash: '4 3' },
      { x: [400, 500, 600, 700], y: [85, 50, 10, 40], color: '#2e7d32', label: 'A very long legend label indeed', dash: '1 3' },
    ],
    xLabel: 'Wavelength (nm)', yLabel: '(%)', yMin: 0, yMax: 100,
  });
  ok('lineChartSVG multi-series: one polyline per series', points(svg).length === 3);
  ok('lineChartSVG multi-series: every label reaches the legend',
     ['T @0°', 'R @0°', 'A very long legend label indeed'].every((l) => svg.includes(l)));
  ok('lineChartSVG multi-series: dashes appear on both the line and its legend swatch',
     [...svg.matchAll(/stroke-dasharray="([^"]*)"/g)].map((m) => m[1]).join('|') === '4 3|1 3|4 3|1 3');
}

// ── lineChartSVG: extreme values -> exponential tick formatting ─────────────
{
  const svg = lineChartSVG({ series: [{ x: [1e-5, 2e-5, 3e-5], y: [1e6, 2e6, 1.5e6], color: '#000', label: 'e' }] });
  const ticks = [...svg.matchAll(/font-size="10">([^<]*)</g)].map((m) => m[1]);
  ok('lineChartSVG extreme-values: ticks switch to exponential notation',
     ticks.length > 0 && ticks.every((t) => /^\d\.\de[+-]\d$/.test(t)));
}

// ── lineChartSVG: null/NaN y-values are skipped in the polyline ─────────────
{
  const svg = lineChartSVG({ series: [{ x: [1, 2, 3, 4], y: [1, null, NaN, 4], color: '#000', label: 'gap' }] });
  ok('lineChartSVG null-gaps: only the two finite samples are plotted',
     points(svg)[0] === '56.0,203.1 704.0,25.8');
}

// ── stepChartSVG wrapper ──────────────────────────────────────────────────────
{
  const svg = stepChartSVG({ z: [0, 50, 50, 100], n: [1.0, 1.0, 2.1, 2.1], label: 'n(z)' });
  ok('stepChartSVG: renders the staircase as a single polyline',
     points(svg)[0] === '56.0,262.2 380.0,262.2 380.0,25.8 704.0,25.8');
}

if (fail === 0) console.log(`PASS: svgChart_characterization (${pass} checks)`);
else { console.error(`\n${fail} test(s) failed, ${pass} passed.`); process.exit(1); }
