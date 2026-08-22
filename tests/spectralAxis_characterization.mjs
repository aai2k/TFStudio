// Characterization test for spectralAxis.js — locks current output of
// fromNm / toNm / spectralAxisOption so an internal refactor (complex-binary-
// expression cleanup) cannot change behavior.
// Run: node tests/spectralAxis_characterization.mjs
import {
    fromNm, toNm, spectralAxisOption, spectralRangeControl, SPECTRAL_UNIT_IDS,
} from '../src/utils/physics/spectralAxis.js';

let pass = 0, fail = 0;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

ok('SPECTRAL_UNIT_IDS order', JSON.stringify(SPECTRAL_UNIT_IDS) === JSON.stringify(['nm', 'um', 'cm1', 'THz', 'eV']));

// ── fromNm / toNm conversions ─────────────────────────────────────────────────
ok('fromNm 500 -> um', approx(fromNm(500, 'um'), 0.5));
ok('toNm 0.5 um -> nm', approx(toNm(0.5, 'um'), 500));
ok('fromNm 500 -> cm1', approx(fromNm(500, 'cm1'), 20000));
ok('fromNm 500 -> THz', approx(fromNm(500, 'THz'), 599.584916));
ok('fromNm 500 -> eV', approx(fromNm(500, 'eV'), 2.479683968));

// ── editable range display preserves the wavelength-backed physical range ───
{
    const nm = spectralRangeControl('nm', 400, 800);
    ok('range control nm values', nm.symbol === 'λ' && nm.start === 400 && nm.end === 800);

    const ev = spectralRangeControl('eV', 400, 800);
    ok('range control eV values', ev.symbol === 'E' && approx(ev.start, 3.0996, 1e-4) && approx(ev.end, 1.5498, 1e-4));
    ok('range control reciprocal order', ev.start > ev.end);
    ok('range control eV round-trip', approx(toNm(ev.start, 'eV'), 400, 0.01));

    const thz = spectralRangeControl('THz', 400, 800);
    ok('range control THz values', thz.symbol === 'f' && approx(thz.start, 749.48, 0.01) && approx(thz.end, 374.74, 0.01));
    ok('range control unknown unit fallback', spectralRangeControl('bogus', 400, 800).start === 400);
}

// ── Native axis options keep nanometres as data coordinates ──────────────────
{
    const p = spectralAxisOption('nm', 400, 700);
    ok('option nm: title', p.name === 'Wavelength (nm)');
    ok('option nm: physical range', p.min === 400 && p.max === 700);
    ok('option nm: 500 is not truncated to 5', p.axisLabel.formatter(500) === '500');
}

// ── Display formatters convert each native wavelength tick ───────────────────
{
    const p = spectralAxisOption('um', 400, 700);
    ok('option um: title', p.name === 'Wavelength (µm)');
    ok('option um: labels', [400, 450, 500, 700].map(p.axisLabel.formatter).join(',') === '0.4,0.45,0.5,0.7');
}

{
    const p = spectralAxisOption('cm1', 400, 700);
    ok('option cm1: title', p.name === 'Wavenumber (cm⁻¹)');
    ok('option cm1: reciprocal labels', p.axisLabel.formatter(500) === '20000');
}

{
    const p = spectralAxisOption('THz', 400, 2500);
    ok('option THz: title', p.name === 'Frequency (THz)');
    ok('option THz: compact label', p.axisLabel.formatter(500) === '599.6');
}

{
    const p = spectralAxisOption('eV', 300, 1000);
    ok('option eV: title', p.name === 'Photon energy (eV)');
    ok('option eV: compact label', p.axisLabel.formatter(500) === '2.48');
}

ok('option um: NaN range stays automatic', spectralAxisOption('um', NaN, 700).min === undefined);

// ── Unknown unit id falls back to nm ─────────────────────────────────────────
{
    const p = spectralAxisOption('bogus', 400, 700);
    ok('option unknown unit: title falls back to nm', p.name === 'Wavelength (nm)');
    ok('option unknown unit: labels stay nm', p.axisLabel.formatter(650) === '650');
}

if (fail === 0) console.log(`PASS: spectralAxis_characterization (${pass} checks)`);
else { console.error(`\n${fail} test(s) failed, ${pass} passed.`); process.exit(1); }
