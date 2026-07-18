// Characterization test for resolveSourceSpec / resolveDetectorSpec branches
// not exercised by tests/integral_values.mjs (D50, A, blackbody, null/unknown
// fallbacks) — locks current output so an internal refactor (many-returns
// cleanup) cannot change behavior.
// Run: node tests/spectralWeightings_branches_characterization.mjs
import { resolveSourceSpec, resolveDetectorSpec } from '../src/utils/physics/spectralWeightings.js';

let pass = 0, fail = 0;
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

// ── resolveSourceSpec: D50 ────────────────────────────────────────────────────
{
    const d50 = resolveSourceSpec({ id: 'D50' });
    ok('D50 lamMin', d50.lamMin === 380);
    ok('D50 lamMax', d50.lamMax === 780);
    ok('D50 label', d50.label === 'D50 (daylight 5003 K)');
    ok('D50 sampler(560)', approx(d50.sampler(560), 100));
}

// ── resolveSourceSpec: A (incandescent) ───────────────────────────────────────
{
    const a = resolveSourceSpec({ id: 'A' });
    ok('A lamMin', a.lamMin === 200);
    ok('A lamMax', a.lamMax === 4000);
    ok('A label', a.label === 'A (incandescent 2856 K)');
    ok('A sampler(560)', approx(a.sampler(560), 100));
}

// ── resolveSourceSpec: blackbody with user T and default T ───────────────────
{
    const bb = resolveSourceSpec({ id: 'blackbody', T: 3000 });
    ok('blackbody lamMin', bb.lamMin === 0);
    ok('blackbody lamMax', bb.lamMax === 1e9);
    ok('blackbody label', bb.label === 'Blackbody 3000 K');
    ok('blackbody sampler(1000)', approx(bb.sampler(1000), 8.331573521906399e-18, 1e-24));

    const bbDefault = resolveSourceSpec({ id: 'blackbody' });
    ok('blackbody default T=5778', bbDefault.label === 'Blackbody 5778 K');
}

// ── resolveSourceSpec: null/missing spec and unknown id fall back to E ──────
{
    const nullS = resolveSourceSpec(null);
    ok('null source -> E label', nullS.label === 'E (equal energy)');
    ok('null source -> E sampler', approx(nullS.sampler(500), 100));

    const unknownS = resolveSourceSpec({ id: 'bogus' });
    ok('unknown source -> E label', unknownS.label === 'E (equal energy)');

    const emptyCustomS = resolveSourceSpec({ id: 'custom' });
    ok('empty custom source -> E label', emptyCustomS.label === 'E (equal energy)');
}

// ── resolveDetectorSpec: null/missing spec and unknown id fall back to flat ──
{
    const nullD = resolveDetectorSpec(null);
    ok('null detector -> flat label', nullD.label === 'Flat (unity)');
    ok('null detector -> flat sampler', nullD.sampler(500) === 1);

    const unknownD = resolveDetectorSpec({ id: 'bogus' });
    ok('unknown detector -> flat label', unknownD.label === 'Flat (unity)');

    const emptyCustomD = resolveDetectorSpec({ id: 'custom' });
    ok('empty custom detector -> flat label', emptyCustomD.label === 'Flat (unity)');
}

if (fail === 0) console.log(`PASS: spectralWeightings_branches_characterization (${pass} checks)`);
else { console.error(`\n${fail} test(s) failed, ${pass} passed.`); process.exit(1); }
