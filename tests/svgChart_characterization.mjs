// Characterization test for svgChart.js — locks the exact byte output of
// escapeHtml / lineChartSVG / stepChartSVG so decomposing lineChartSVG into
// phase-helpers (axes/ticks/series/legend, cx83 -> cleared) cannot change a
// single emitted byte. Large SVG strings are compared via SHA-256 (any byte
// change flips the hash); two small ones are compared verbatim for a more
// readable diff on failure.
// Run: node tests/svgChart_characterization.mjs
import { createHash } from 'node:crypto';
import { escapeHtml, lineChartSVG, stepChartSVG } from '../src/utils/report/svgChart.js';

let pass = 0, fail = 0;
const sha = (s) => createHash('sha256').update(s).digest('hex');
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }
function okHash(name, svg, expectHash, expectLen) {
  ok(`${name}: length`, svg.length === expectLen);
  ok(`${name}: sha256`, sha(svg) === expectHash);
}

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

// ── lineChartSVG: degenerate range (constant x, constant y) — verbatim ──────
{
  const svg = lineChartSVG({ series: [{ x: [500, 500, 500], y: [1, 1, 1], color: '#000', label: 'flat' }] });
  const expect = '<svg viewBox="0 0 720 320" class="tf-chart" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="720" height="320" fill="#ffffff"/><rect x="56" y="14" width="648" height="260" fill="#ffffff" stroke="#888" stroke-width="1"/><line x1="56.0" y1="14" x2="56.0" y2="274" stroke="#e6e6e6" stroke-width="1"/><text x="56.0" y="290" text-anchor="middle" fill="#444" font-size="10">500</text><line x1="185.6" y1="14" x2="185.6" y2="274" stroke="#e6e6e6" stroke-width="1"/><text x="185.6" y="290" text-anchor="middle" fill="#444" font-size="10">500.2</text><line x1="315.2" y1="14" x2="315.2" y2="274" stroke="#e6e6e6" stroke-width="1"/><text x="315.2" y="290" text-anchor="middle" fill="#444" font-size="10">500.4</text><line x1="444.8" y1="14" x2="444.8" y2="274" stroke="#e6e6e6" stroke-width="1"/><text x="444.8" y="290" text-anchor="middle" fill="#444" font-size="10">500.6</text><line x1="574.4" y1="14" x2="574.4" y2="274" stroke="#e6e6e6" stroke-width="1"/><text x="574.4" y="290" text-anchor="middle" fill="#444" font-size="10">500.8</text><line x1="704.0" y1="14" x2="704.0" y2="274" stroke="#e6e6e6" stroke-width="1"/><text x="704.0" y="290" text-anchor="middle" fill="#444" font-size="10">501</text><line x1="56" y1="262.2" x2="704" y2="262.2" stroke="#e6e6e6" stroke-width="1"/><text x="50" y="265.2" text-anchor="end" fill="#444" font-size="10">0</text><line x1="56" y1="144.0" x2="704" y2="144.0" stroke="#e6e6e6" stroke-width="1"/><text x="50" y="147.0" text-anchor="end" fill="#444" font-size="10">1</text><line x1="56" y1="25.8" x2="704" y2="25.8" stroke="#e6e6e6" stroke-width="1"/><text x="50" y="28.8" text-anchor="end" fill="#444" font-size="10">2</text><polyline fill="none" stroke="#000" stroke-width="1.4" points="56.0,144.0 56.0,144.0 56.0,144.0"/></svg>';
  ok('lineChartSVG degenerate: verbatim', svg === expect);
}

// ── lineChartSVG: single series, auto x/y range, axis labels, no legend ─────
okHash('lineChartSVG single-series',
  lineChartSVG({
    series: [{ x: [400, 450, 500, 550, 600], y: [0.1, 0.3, 0.9, 0.5, 0.2], color: '#1565c0', label: 'T' }],
    xLabel: 'Wavelength (nm)', yLabel: '(%)',
  }),
  'e1c99e1ba94b80df0e09476ec2d347fd4f596ae6c1358eff3529dffe2d3e1261', 2000);

// ── lineChartSVG: multi-series, legend (incl. long label), dash, fixed range ─
okHash('lineChartSVG multi-series+legend',
  lineChartSVG({
    width: 720, height: 320,
    series: [
      { x: [400, 500, 600, 700], y: [10, 30, 90, 50], color: '#1565c0', label: 'T @0°' },
      { x: [400, 500, 600, 700], y: [5, 20, 40, 30], color: '#c62828', label: 'R @0°', dash: '4 3' },
      { x: [400, 500, 600, 700], y: [85, 50, 10, 40], color: '#2e7d32', label: 'A very long legend label indeed', dash: '1 3' },
    ],
    xLabel: 'Wavelength (nm)', yLabel: '(%)', yMin: 0, yMax: 100,
  }),
  '56978e4fbda1fa26f1af8735f0ab10bed7388b175ca68cd7f73ca1c603bd72e0', 3093);

// ── lineChartSVG: step (staircase) series ────────────────────────────────────
okHash('lineChartSVG step-series',
  lineChartSVG({
    width: 720, height: 260,
    series: [{ x: [0, 10, 10, 40, 40, 90], y: [1.0, 1.0, 2.35, 2.35, 1.46, 1.46], color: '#6a1b9a', label: 'n', step: true }],
    xLabel: 'Depth z (nm)', yLabel: 'n',
  }),
  '5f06398e6a2431401dd2180d4ddd562da6ca67b43aeb186a1572fc0112be3d14', 1896);

// ── lineChartSVG: extreme values -> exponential tick formatting ─────────────
okHash('lineChartSVG extreme-values',
  lineChartSVG({ series: [{ x: [1e-5, 2e-5, 3e-5], y: [1e6, 2e6, 1.5e6], color: '#000', label: 'e' }] }),
  '782fed7c16f1cb05693bf39838b979a67a170a5c2ff4008caf72f295dc56a01c', 1475);

// ── lineChartSVG: null/NaN y-values are skipped in the polyline ─────────────
okHash('lineChartSVG null-gaps',
  lineChartSVG({ series: [{ x: [1, 2, 3, 4], y: [1, null, NaN, 4], color: '#000', label: 'gap' }] }),
  '88123b55ae649b803ae795cc14afc674b0fd05d357467085f74dba67e9f794df', 1734);

// ── stepChartSVG wrapper ──────────────────────────────────────────────────────
okHash('stepChartSVG',
  stepChartSVG({ z: [0, 50, 50, 100], n: [1.0, 1.0, 2.1, 2.1], label: 'n(z)' }),
  '476bfb2d41d68ee867872ea5ba159cbc208fc997e84078ecb1d6d89d05d37325', 1779);

if (fail === 0) console.log(`PASS: svgChart_characterization (${pass} checks)`);
else { console.error(`\n${fail} test(s) failed, ${pass} passed.`); process.exit(1); }
