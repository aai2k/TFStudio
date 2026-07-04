// Validate the JCAMP-DX parser + writer (ASDF decode, LDR
// headers, XYDATA/XYPOINTS, round-trip). Run: node tests/jcamp_dx.mjs
import { parseJcampDx, buildJcampDx } from '../src/utils/io/jcampDx.js';
import { X_UNITS } from '../src/utils/io/spectrumTable.js';

let pass = 0, fail = 0;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const arrApprox = (a, b, eps = 1e-4) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

// Header shared by the small ASDF decode cases below. 7 points, FIRSTX 100 step 1.
const HEAD = (xydata) =>
`##TITLE=t\n##JCAMP-DX=4.24\n##DATA TYPE=UV/VIS SPECTRUM\n##XUNITS=NANOMETERS\n##YUNITS=TRANSMITTANCE\n##XFACTOR=1.0\n##YFACTOR=1.0\n##FIRSTX=100\n##LASTX=106\n##NPOINTS=7\n##DELTAX=1\n##XYDATA=(X++(Y..Y))\n${xydata}\n##END=`;

const EXPECT = [10, 12, 14, 16, 16, 16, 13];

// ── AFFN: plain numbers, X then 7 Y on one line ─────────────────────────────────
{
    const r = parseJcampDx(HEAD('100 10 12 14 16 16 16 13'));
    ok('affn ok', r.ok);
    ok('affn y', arrApprox(r.spectra[0].y, EXPECT));
    ok('affn x0', approx(r.spectra[0].x[0], 100));
    ok('affn x6', approx(r.spectra[0].x[6], 106));
    ok('affn xUnit nm', r.spectra[0].xUnit === X_UNITS.NM);
    ok('affn quantity T', r.spectra[0].quantity === 'T');
}

// ── PAC: +/- as delimiter ───────────────────────────────────────────────────────
{
    const r = parseJcampDx(HEAD('100+10+12+14+16+16+16+13'));
    ok('pac y', arrApprox(r.spectra[0].y, EXPECT));
}

// ── SQZ: leading pseudo-digit, no delimiter ─────────────────────────────────────
// 10→A0 12→A2 14→A4 16→A6 13→A3
{
    const r = parseJcampDx(HEAD('100A0A2A4A6A6A6A3'));
    ok('sqz y', arrApprox(r.spectra[0].y, EXPECT));
}

// ── DIF: differences. start 10 then +2,+2,+2,0,0,-3 ─────────────────────────────
// DIF pseudo-digits encode the LEADING digit+sign: K=+2, %=0, l=-3.
// A0(10) K(+2→12) K(14) K(16) %(0→16) %(16) l(-3→13)
{
    const r = parseJcampDx(HEAD('100A0KKK%%l'));
    ok('dif y', arrApprox(r.spectra[0].y, EXPECT));
}

// ── DUP: duplicate. 10,12,14,16,16,16,13 → 16 repeated 3× via DUP ───────────────
// A0(10) A2(12) A4(14) A6(16) then DUP 'U'=3 (two more 16s) then A3(13)
{
    const r = parseJcampDx(HEAD('100A0A2A4A6UA3'));
    ok('dup y', arrApprox(r.spectra[0].y, EXPECT));
}

// ── DIF + DUP combined: duplicate a difference ──────────────────────────────────
// A0(10) K(+2→12) K(14) T(dup=2 → repeat +2 once: →16) %(16) %(16) l(13)
{
    const r = parseJcampDx(HEAD('100A0KKT%%l'));
    ok('dif+dup y', arrApprox(r.spectra[0].y, EXPECT));
}

// ── DIF multi-line with Y check-value duplicate ─────────────────────────────────
// Line1: 100  A0 K K  → 10,12,14   (ends in DIF, lastY=14)
// Line2: 102  A4 K j  → check 14(drop) then +2→16, -1→15
//   expected total: 10,12,14,16,15
{
    const txt =
`##TITLE=t\n##JCAMP-DX=4.24\n##XUNITS=NANOMETERS\n##YUNITS=TRANSMITTANCE\n##XFACTOR=1.0\n##YFACTOR=1.0\n##FIRSTX=100\n##LASTX=104\n##NPOINTS=5\n##DELTAX=1\n##XYDATA=(X++(Y..Y))\n100A0KK\n102A4Kj\n##END=`;
    const r = parseJcampDx(txt);
    ok('dif multiline y', arrApprox(r.spectra[0].y, [10, 12, 14, 16, 15]));
    ok('dif multiline n', r.spectra[0].y.length === 5);
    ok('dif multiline x', approx(r.spectra[0].x[4], 104));
}

// ── YFACTOR scaling ─────────────────────────────────────────────────────────────
{
    const txt = HEAD('100 100 120 140 160 160 160 130').replace('##YFACTOR=1.0', '##YFACTOR=0.1');
    const r = parseJcampDx(txt);
    ok('yfactor scale', arrApprox(r.spectra[0].y, EXPECT));
}

// ── XYPOINTS explicit pairs, cm-1 units, absorbance ─────────────────────────────
{
    const txt =
`##TITLE=ir\n##JCAMP-DX=4.24\n##DATA TYPE=INFRARED SPECTRUM\n##XUNITS=1/CM\n##YUNITS=ABSORBANCE\n##XFACTOR=1.0\n##YFACTOR=1.0\n##NPOINTS=3\n##XYPOINTS=(XY..XY)\n4000,0.1 3000,0.5 2000,0.9\n##END=`;
    const r = parseJcampDx(txt);
    ok('xypoints ok', r.ok);
    ok('xypoints x', arrApprox(r.spectra[0].x, [4000, 3000, 2000], 1e-6));
    ok('xypoints y', arrApprox(r.spectra[0].y, [0.1, 0.5, 0.9], 1e-9));
    ok('xypoints cm-1', r.spectra[0].xUnit === X_UNITS.CM1);
    ok('xypoints A', r.spectra[0].quantity === 'A' && r.spectra[0].isAbsorbance);
}

// ── reflectance units ───────────────────────────────────────────────────────────
{
    const r = parseJcampDx(HEAD('100 10 12 14 16 16 16 13').replace('TRANSMITTANCE', 'REFLECTANCE'));
    ok('reflectance R', r.spectra[0].quantity === 'R');
}

// ── not-a-jcamp guard ───────────────────────────────────────────────────────────
ok('reject csv', parseJcampDx('400,90\n500,92').ok === false);
ok('reject empty', parseJcampDx('').ok === false);

// ── Writer: single block round-trip (uniform → XYDATA) ──────────────────────────
{
    const spec = { title: 'AR', xUnit: X_UNITS.NM, quantity: 'T', x: [400, 410, 420, 430], y: [0.90, 0.92, 0.94, 0.93] };
    const txt = buildJcampDx([spec]);
    ok('writer has XYDATA', /##XYDATA=\(X\+\+\(Y\.\.Y\)\)/.test(txt));
    ok('writer has END', /##END=/.test(txt));
    const r = parseJcampDx(txt);
    ok('rt ok', r.ok && r.spectra.length === 1);
    ok('rt x', arrApprox(r.spectra[0].x, [400, 410, 420, 430], 1e-3));
    ok('rt y', arrApprox(r.spectra[0].y, [0.90, 0.92, 0.94, 0.93], 1e-5));
    ok('rt quantity T', r.spectra[0].quantity === 'T');
}

// ── Writer: non-uniform grid → XYPOINTS ─────────────────────────────────────────
{
    const spec = { title: 'meas', xUnit: X_UNITS.NM, quantity: 'R', x: [400, 405, 420, 460], y: [0.08, 0.06, 0.05, 0.04] };
    const txt = buildJcampDx([spec]);
    ok('writer XYPOINTS for nonuniform', /##XYPOINTS=\(XY\.\.XY\)/.test(txt));
    const r = parseJcampDx(txt);
    ok('rt nonuniform x', arrApprox(r.spectra[0].x, [400, 405, 420, 460], 1e-3));
    ok('rt nonuniform y', arrApprox(r.spectra[0].y, [0.08, 0.06, 0.05, 0.04], 1e-5));
}

// ── Writer: LINK of multiple blocks ─────────────────────────────────────────────
{
    const a = { title: 'T', xUnit: X_UNITS.NM, quantity: 'T', x: [400, 410, 420], y: [0.9, 0.91, 0.92] };
    const b = { title: 'R', xUnit: X_UNITS.NM, quantity: 'R', x: [400, 410, 420], y: [0.08, 0.07, 0.06] };
    const txt = buildJcampDx([a, b], { title: 'design' });
    ok('link has LINK', /##DATA TYPE=LINK/.test(txt));
    ok('link blocks=2', /##BLOCKS=2/.test(txt));
    const r = parseJcampDx(txt);
    ok('link parses 2', r.spectra.length === 2);
    ok('link block0 T', r.spectra[0].quantity === 'T' && arrApprox(r.spectra[0].y, [0.9, 0.91, 0.92], 1e-5));
    ok('link block1 R', r.spectra[1].quantity === 'R' && arrApprox(r.spectra[1].y, [0.08, 0.07, 0.06], 1e-5));
}

// ── $$ comments + whitespace tolerance ──────────────────────────────────────────
{
    const txt = HEAD('100 10 12 14 16 16 16 13').replace('##XYDATA=(X++(Y..Y))', '##XYDATA=(X++(Y..Y)) $$ data follows');
    const r = parseJcampDx(txt);
    ok('comment tolerated', arrApprox(r.spectra[0].y, EXPECT));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
