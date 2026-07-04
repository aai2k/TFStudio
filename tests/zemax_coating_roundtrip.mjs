// Validate the Zemax OpticStudio COATING.DAT reader + writer:
//   • MATE parse + extinction sign flip (Zemax imag = −k  ↔  TFStudio k ≥ 0)
//   • COAT layer parse, absolute (µm) and relative (waves) thickness
//   • relative-thickness conversion  d = T·λ₀/n₀  (Help worked example)
//   • TFStudio layer ↔ COAT round-trip (absolute + relative)
//   • generate → parse text round-trip identity
//   • name sanitising, IDEAL/IDEAL2/ENCRYPTED/I. parse, warnings
// Run: node tests/zemax_coating_roundtrip.mjs
import {
    parseZemaxCoating, sanitizeZemaxName,
    mateToTfMaterial, tfMaterialToMate,
    coatToTfLayers, tfLayersToCoat,
    generateZemaxCoating, buildGrid,
} from '../src/utils/io/zemaxCoatingFile.js';

let pass = 0, fail = 0;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

// ── Sample COATING.DAT (MATE with absorber + non-absorber, COAT with both
//    thickness modes, an ideal coating, IDEAL/IDEAL2/ENCRYPTED, comments) ──────────
const SAMPLE =
`! TFStudio Zemax round-trip fixture
MATE SIO2
0.4  1.470  0
0.55 1.460  0
0.7  1.455  0
MATE AG
0.4  0.173  -1.95
0.55 0.124  -3.3327
0.7  0.142  -4.523
COAT AR1
SIO2 0.25 0
SIO2 137.0 1
COAT MIRROR
AG 0.05 1
COAT I.0.5
IDEAL IDEALAR 0.99 0.01
IDEAL2 FULL 0.1 0 0.2 0 0.3 0 0.4 0 1
ENCRYPTED SECRET.DAT
`;

const r = parseZemaxCoating(SAMPLE);

// ── MATE parsing ────────────────────────────────────────────────────────────────
ok('two materials parsed', r.materials.length === 2);
const sio2 = r.materials.find(m => m.name === 'SIO2');
const ag = r.materials.find(m => m.name === 'AG');
ok('SIO2 has 3 pts', sio2 && sio2.points.length === 3);
ok('SIO2 mid n', sio2 && approx(sio2.points[1][1], 1.460));
ok('AG stores negative imag (Zemax sign)', ag && ag.points[1][2] === -3.3327);

// ── MATE → TFStudio material (sign flip Zemax imag → k≥0) ───────────────────────
{
    const m = mateToTfMaterial(ag);
    ok('mate→tf formulaNum -1 (tabular)', m.formulaNum === -1);
    ok('mate→tf λ in nm', approx(m.tabData[1][0], 550)); // 0.55 µm → 550 nm
    ok('mate→tf k = −imag (>0)', approx(m.tabData[1][2], 3.3327)); // −(−3.3327)
    ok('mate→tf n preserved', approx(m.tabData[1][1], 0.124));
    const sm = mateToTfMaterial(sio2);
    ok('mate→tf dielectric k=0', sm.tabData.every(p => p[2] === 0));
}

// ── TFStudio material → MATE (k → −k sign restored) ─────────────────────────────
{
    const getNK = (lamNm) => (approx(lamNm, 550) ? [0.124, 3.3327] : [0.13, 3.0]);
    const grid = buildGrid(500, 600, 50); // 500,550,600
    const mate = tfMaterialToMate('Ag layer', getNK, grid);
    ok('tf→mate name sanitised', mate.name === 'AG_LAYER');
    const p550 = mate.points.find(p => approx(p[0], 0.55));
    ok('tf→mate λ in µm', !!p550);
    ok('tf→mate imag = −k (Zemax sign)', p550 && approx(p550[2], -3.3327));
    ok('tf→mate n preserved', p550 && approx(p550[1], 0.124));
}

// ── COAT parsing ────────────────────────────────────────────────────────────────
const ar1 = r.coatings.find(c => c.type === 'layers' && c.name === 'AR1');
ok('AR1 layers parsed', ar1 && ar1.layers.length === 2);
ok('AR1 L0 relative (isAbsolute 0)', ar1 && ar1.layers[0].isAbsolute === 0);
ok('AR1 L0 thickness=0.25 waves', ar1 && approx(ar1.layers[0].thickness, 0.25));
ok('AR1 L1 absolute (isAbsolute 1)', ar1 && ar1.layers[1].isAbsolute === 1);

const idealI = r.coatings.find(c => c.type === 'idealI');
ok('COAT I. parsed', idealI && approx(idealI.transmission, 0.5));
const ideal = r.coatings.find(c => c.type === 'ideal');
ok('IDEAL parsed', ideal && approx(ideal.T, 0.99) && approx(ideal.R, 0.01));
const ideal2 = r.coatings.find(c => c.type === 'ideal2');
ok('IDEAL2 9 values', ideal2 && ideal2.values.length === 9 && approx(ideal2.values[0], 0.1));
const enc = r.coatings.find(c => c.type === 'encrypted');
ok('ENCRYPTED parsed', enc && enc.name === 'SECRET.DAT');

// ── Relative-thickness conversion: Help worked example ──────────────────────────
//    d = T·λ₀/n₀ ;  T=0.25, λ₀=0.55 µm, n₀=1.4  → d = 0.0982142857 µm = 98.214 nm
{
    const coat = { name: 'WX', layers: [{ material: 'M', thickness: 0.25, isAbsolute: 0 }] };
    const { layers, warnings } = coatToTfLayers(coat, {
        materialId: () => 'm',
        realIndex: () => 1.4,
        refWavelengthUm: 0.55,
    });
    ok('rel-thk no warnings', warnings.length === 0);
    ok('rel-thk d = T·λ₀/n₀ = 98.214 nm', layers.length === 1 && approx(layers[0].thickness, 0.25 * 0.55 / 1.4 * 1000, 1e-4));
    ok('rel-thk numeric 98.214', approx(layers[0].thickness, 98.2142857, 1e-3));
}

// ── Absolute thickness passes through (µm → nm) ─────────────────────────────────
{
    const coat = { name: 'WX', layers: [{ material: 'M', thickness: 0.137, isAbsolute: 1 }] };
    const { layers } = coatToTfLayers(coat, { materialId: () => 'm', realIndex: () => 1.46 });
    ok('abs-thk µm→nm', approx(layers[0].thickness, 137.0));
}

// ── Missing material → skipped with warning (D6-adjacent robustness) ────────────
{
    const coat = { name: 'WX', layers: [{ material: 'UNKNOWN', thickness: 100, isAbsolute: 1 }] };
    const { layers, warnings } = coatToTfLayers(coat, { materialId: () => null, realIndex: () => 1 });
    ok('missing material skipped', layers.length === 0);
    ok('missing material warns', warnings.length === 1 && /not found/.test(warnings[0]));
}

// ── TFStudio layers → COAT → back, ABSOLUTE mode (lossless identity) ────────────
{
    const tfLayers = [
        { material: 'sio2', thickness: 98.2142857 },
        { material: 'tio2', thickness: 137.0 },
    ];
    const coat = tfLayersToCoat('STACK', tfLayers, {
        zemaxName: (id) => id.toUpperCase(),
        mode: 'absolute',
    });
    ok('abs round-trip isAbsolute=1', coat.layers.every(L => L.isAbsolute === 1));
    const back = coatToTfLayers(
        { name: coat.name, layers: coat.layers },
        { materialId: (z) => z.toLowerCase(), realIndex: () => 1.5 }
    );
    ok('abs round-trip thk[0]', approx(back.layers[0].thickness, 98.2142857, 1e-4));
    ok('abs round-trip thk[1]', approx(back.layers[1].thickness, 137.0, 1e-4));
    ok('abs round-trip material id', back.layers[0].material === 'sio2');
}

// ── TFStudio layers → COAT → back, RELATIVE mode (n₀ identity at λ₀) ────────────
{
    const n0 = 1.46;
    const refUm = 0.55;
    const dNm = 98.2142857;
    const realIndex = () => n0;
    const coat = tfLayersToCoat('STACK', [{ material: 'sio2', thickness: dNm }], {
        zemaxName: (id) => id.toUpperCase(),
        mode: 'relative', refWavelengthUm: refUm, realIndex,
    });
    // T = n₀·d/λ₀  then back d = T·λ₀/n₀ must recover dNm exactly.
    ok('rel round-trip T = n₀·d/λ₀', approx(coat.layers[0].thickness, n0 * (dNm / 1000) / refUm, 1e-9));
    const back = coatToTfLayers(
        { name: coat.name, layers: coat.layers.map(L => ({ ...L, isAbsolute: 0 })) },
        { materialId: (z) => z.toLowerCase(), realIndex, refWavelengthUm: refUm }
    );
    ok('rel round-trip recovers d', approx(back.layers[0].thickness, dNm, 1e-4));
}

// ── generate → parse text round-trip ────────────────────────────────────────────
{
    const doc = {
        materials: [
            { name: 'SIO2', points: [[0.4, 1.47, 0], [0.55, 1.46, 0], [0.7, 1.455, 0]] },
            { name: 'AG', points: [[0.55, 0.124, -3.3327]] },
        ],
        coatings: [
            { name: 'AR1', layers: [{ material: 'SIO2', thickness: 98.214, isAbsolute: 1 }] },
            { name: 'MIRROR', layers: [{ material: 'AG', thickness: 50, isAbsolute: 1 }] },
        ],
    };
    const text = generateZemaxCoating(doc);
    ok('generated has MATE', /MATE SIO2/.test(text));
    ok('generated has COAT', /COAT AR1/.test(text));
    ok('generated preserves −k sign', /-3\.3327/.test(text));
    const r2 = parseZemaxCoating(text);
    ok('rt materials=2', r2.materials.length === 2);
    ok('rt coatings=2', r2.coatings.filter(c => c.type === 'layers').length === 2);
    const ag2 = r2.materials.find(m => m.name === 'AG');
    ok('rt AG imag sign preserved', ag2 && approx(ag2.points[0][2], -3.3327));
    const ar = r2.coatings.find(c => c.name === 'AR1');
    ok('rt AR1 thickness', ar && approx(ar.layers[0].thickness, 98.214, 1e-3));
    ok('rt AR1 isAbsolute', ar && ar.layers[0].isAbsolute === 1);
}

// ── Name sanitising ─────────────────────────────────────────────────────────────
ok('sanitise spaces→_', sanitizeZemaxName('Ag layer') === 'AG_LAYER');
ok('sanitise upper', sanitizeZemaxName('sio2') === 'SIO2');
ok('sanitise strip special', sanitizeZemaxName('Nb2O5/H') === 'NB2O5_H');
ok('sanitise empty→fallback', sanitizeZemaxName('', 'MAT') === 'MAT');
ok('sanitise clamp 32', sanitizeZemaxName('A'.repeat(40)).length === 32);

// ── Robustness: blank / comment-only / junk input ───────────────────────────────
{
    const e = parseZemaxCoating('');
    ok('empty parses to empty doc', e.materials.length === 0 && e.coatings.length === 0);
    const j = parseZemaxCoating('1.0 2.0 3.0\n! only a stray data row above');
    ok('orphan data warns', j.warnings.length >= 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
