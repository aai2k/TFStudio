// Characterization test for spectralAxis.js — locks current output of
// fromNm / toNm / spectralAxisProps so an internal refactor (complex-binary-
// expression cleanup) cannot change behavior.
// Run: node tests/spectralAxis_characterization.mjs
import { fromNm, toNm, spectralAxisProps, SPECTRAL_UNIT_IDS } from '../src/utils/physics/spectralAxis.js';

let pass = 0, fail = 0;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const arrApprox = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

ok('SPECTRAL_UNIT_IDS order', JSON.stringify(SPECTRAL_UNIT_IDS) === JSON.stringify(['nm', 'um', 'cm1', 'THz', 'eV']));

// ── fromNm / toNm conversions ─────────────────────────────────────────────────
ok('fromNm 500 -> um', approx(fromNm(500, 'um'), 0.5));
ok('toNm 0.5 um -> nm', approx(toNm(0.5, 'um'), 500));
ok('fromNm 500 -> cm1', approx(fromNm(500, 'cm1'), 20000));
ok('fromNm 500 -> THz', approx(fromNm(500, 'THz'), 599.584916));
ok('fromNm 500 -> eV', approx(fromNm(500, 'eV'), 2.479683968));

// ── spectralAxisProps: nm unit returns title only (no tick override) ─────────
{
    const p = spectralAxisProps('nm', 400, 700);
    ok('props nm: title only', p.title.text === 'Wavelength (nm)' && p.tickmode === undefined);
}

// ── spectralAxisProps: um — nice ticks at 0.05 µm step over [0.4, 0.7] ───────
{
    const p = spectralAxisProps('um', 400, 700);
    ok('props um: title', p.title.text === 'Wavelength (µm)');
    ok('props um: tickmode array', p.tickmode === 'array');
    ok('props um: tickvals (nm)', arrApprox(p.tickvals, [400, 450, 500, 550, 600, 650, 700], 1e-6));
    ok('props um: ticktext', JSON.stringify(p.ticktext) === JSON.stringify(['0.4', '0.45', '0.5', '0.55', '0.6', '0.65', '0.7']));
}

// ── spectralAxisProps: cm1 — reciprocal axis runs opposite to λ ──────────────
{
    const p = spectralAxisProps('cm1', 400, 700);
    ok('props cm1: title', p.title.text === 'Wavenumber (cm⁻¹)');
    ok('props cm1: tickvals (nm)', arrApprox(p.tickvals, [625, 555.5555555555555, 500, 454.54545454545456, 416.6666666666667], 1e-6));
    ok('props cm1: ticktext', JSON.stringify(p.ticktext) === JSON.stringify(['16000', '18000', '20000', '22000', '24000']));
}

// ── spectralAxisProps: THz ────────────────────────────────────────────────────
{
    const p = spectralAxisProps('THz', 400, 2500);
    ok('props THz: title', p.title.text === 'Frequency (THz)');
    ok('props THz: ticktext', JSON.stringify(p.ticktext) === JSON.stringify(['200', '300', '400', '500', '600', '700']));
}

// ── spectralAxisProps: eV ──────────────────────────────────────────────────────
{
    const p = spectralAxisProps('eV', 300, 1000);
    ok('props eV: title', p.title.text === 'Photon energy (eV)');
    ok('props eV: ticktext', JSON.stringify(p.ticktext) === JSON.stringify(['1.5', '2', '2.5', '3', '3.5', '4']));
}

// ── spectralAxisProps: missing/invalid range falls back to title-only ───────
ok('props um: NaN nmMin -> title only', spectralAxisProps('um', NaN, 700).tickmode === undefined);
ok('props um: nmMin=0 -> title only', spectralAxisProps('um', 0, 700).tickmode === undefined);

// ── spectralAxisProps: unknown unit id falls back to nm ──────────────────────
{
    const p = spectralAxisProps('bogus', 400, 700);
    ok('props unknown unit: title falls back to nm', p.title.text === 'Wavelength (nm)');
    ok('props unknown unit: ticktext in nm', JSON.stringify(p.ticktext) === JSON.stringify(['400', '450', '500', '550', '600', '650', '700']));
}

if (fail === 0) console.log(`PASS: spectralAxis_characterization (${pass} checks)`);
else { console.error(`\n${fail} test(s) failed, ${pass} passed.`); process.exit(1); }
