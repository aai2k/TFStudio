// Characterization test for reportData.js — locks the exact numeric output of
// designSummary / buildSpectrum / computeRiProfile / computeEField /
// computeEllipsometrySpectrum so splitting the file into sibling modules
// (reportData/) cannot change a single computed value. These reuse the same
// validated TMM/colorimetry engines as the analysis windows, so golden values
// were captured by running the UNMODIFIED file, not hand-derived.
// Run: node tests/reportData_characterization.mjs
import {
  designSummary, buildSpectrum, computeRiProfile, computeEField, computeEllipsometrySpectrum,
} from '../src/utils/report/reportData.js';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

const design = {
  id: 'd1', name: 'AR Test Stack',
  incidentMedium: 'Air',
  substrate: { material: 'BK7', thickness: 1.0 },
  exitMedium: 'Air',
  surfaceMode: 'front_only', mfEvalMode: 'side',
  referenceWavelength: 550,
  frontLayers: [
    { id: 'l1', material: 'TiO2', thickness: 116.7, locked: false },
    { id: 'l2', material: 'SiO2', thickness: 187.3, locked: false },
    { id: 'l3', material: 'TiO2', thickness: 90.0,  locked: true  },
  ],
  backLayers: [],
  notes: 'Sample design for report test.\nSecond line.',
  qualifiers: [],
  meritOperands: [],
};

// ── designSummary: layer table, totals, optical-thickness family, materials ─
console.log('— designSummary —');
{
  const ds = designSummary(design);
  const expect = {
    name: 'AR Test Stack', incidentMedium: 'Air', substrate: 'BK7 (Schott)',
    substrateThickness: 1, exitMedium: 'Air', referenceWavelength: 550, surfaceMode: 'front_only',
    frontCount: 3, backCount: 0, frontThickness: 394, backThickness: 0, totalThickness: 394,
    front: [
      { index: 1, material: 'TiO2 (anatase)', thickness: 116.7, locked: false,
        n: 2.5166031978319783, ot: 293.6875931869919, qwot: 2.135909768632668, fwot: 0.533977442158167 },
      { index: 2, material: 'SiO2 (Fused Silica)', thickness: 187.3, locked: false,
        n: 1.4599108864687285, ot: 273.44130903559284, qwot: 1.9886640657134025, fwot: 0.4971660164283506 },
      { index: 3, material: 'TiO2 (anatase)', thickness: 90, locked: true,
        n: 2.5166031978319783, ot: 226.49428780487804, qwot: 1.6472311840354767, fwot: 0.4118077960088692 },
    ],
    materials: [
      { id: 'TiO2', name: 'TiO2 (anatase)', n: 2.5166031978319783, k: 0 },
      { id: 'SiO2', name: 'SiO2 (Fused Silica)', n: 1.4599108864687285, k: 0 },
    ],
  };
  const got = {
    name: ds.name, incidentMedium: ds.incidentMedium, substrate: ds.substrate,
    substrateThickness: ds.substrateThickness, exitMedium: ds.exitMedium,
    referenceWavelength: ds.referenceWavelength, surfaceMode: ds.surfaceMode,
    frontCount: ds.frontCount, backCount: ds.backCount,
    frontThickness: ds.frontThickness, backThickness: ds.backThickness, totalThickness: ds.totalThickness,
    front: ds.front, materials: ds.materials,
  };
  ok('designSummary matches golden snapshot', JSON.stringify(got) === JSON.stringify(expect));
}

// ── buildSpectrum: multi-AOI TMM sweep (R/T/A + s/p components) ─────────────
console.log('— buildSpectrum —');
{
  const sp = buildSpectrum(design, { lambdaStart: 400, lambdaEnd: 700, lambdaStep: 100, thetas: [0, 30] });
  const expect = {"lambda":[400,500,600,700],"series":[{"theta":0,"R":[0.645392387287142,0.13058920697390314,0.2649011523426334,0.011939028880984475],"T":[0.35460761271285757,0.8694107930260973,0.7350988476573669,0.9880609711190156],"A":[4.440892098500626e-16,0,0,0],"Rs":[0.645392387287142,0.13058920697390314,0.2649011523426334,0.011939028880984475],"Ts":[0.35460761271285757,0.8694107930260973,0.7350988476573669,0.9880609711190156],"As":[4.440892098500626e-16,0,0,0],"Rp":[0.645392387287142,0.13058920697390314,0.2649011523426334,0.011939028880984475],"Tp":[0.35460761271285757,0.8694107930260973,0.7350988476573669,0.9880609711190156],"Ap":[4.440892098500626e-16,0,0,0]},{"theta":30,"R":[0.5162826582644658,0.07336845772261025,0.24528583024987713,0.015302734473757119],"T":[0.4837173417355342,0.9266315422773899,0.7547141697501231,0.9846972655262428],"A":[5.551115123125783e-17,0,0,5.551115123125783e-17],"Rs":[0.5869768109758822,0.09588799121930097,0.29479789500276116,0.018950664737143682],"Ts":[0.41302318902411805,0.9041120087806992,0.705202104997239,0.9810493352628562],"As":[0,0,0,1.1102230246251565e-16],"Rp":[0.4455885055530496,0.05084892422591954,0.1957737654969931,0.011654804210370556],"Tp":[0.5544114944469504,0.9491510757740805,0.8042262345030071,0.9883451957896294],"Ap":[1.1102230246251565e-16,0,0,0]}],"evalMode":"front"};
  ok('buildSpectrum matches golden snapshot', JSON.stringify(sp) === JSON.stringify(expect));
}

// ── computeRiProfile: n(z) staircase (layer boundaries + refractive index) ──
console.log('— computeRiProfile —');
{
  const rp = computeRiProfile(design);
  ok('riProfile lambda = design referenceWavelength', rp.lambda === 550);
  ok('riProfile z length', rp.z.length === 6);
  ok('riProfile n[0..2]', rp.n[0] === 1 && rp.n[1] === 2.5166031978319783 && rp.n[2] === 1.4599108864687285);
  ok('riProfile layerBounds', JSON.stringify(rp.layerBounds) === JSON.stringify([0, 116.7, 304, 394]));
}

// ── computeEField: |E(z)|^2 profile at a fixed lambda/theta/pol ─────────────
console.log('— computeEField —');
{
  const ef = computeEField(design, { lambda: 550, theta: 0, pol: 's' });
  ok('eField lambda/theta/pol', ef.lambda === 550 && ef.theta === 0 && ef.pol === 's');
  ok('eField z length', ef.z.length === 151);
  ok('eField e2[0..2]', Math.abs(ef.e2[0] - 0.5386226399888933) < 1e-12
    && Math.abs(ef.e2[1] - 0.5217301960393981) < 1e-12
    && Math.abs(ef.e2[2] - 0.5026589147051764) < 1e-12);
}

// ── computeEllipsometrySpectrum: Psi/Delta(lambda) per AOI ──────────────────
console.log('— computeEllipsometrySpectrum —');
{
  const es = computeEllipsometrySpectrum(design, { lambdaStart: 400, lambdaEnd: 600, lambdaStep: 100, thetas: [65] });
  const expect = {"lambda":[400,500,600],"series":[{"theta":65,"psi":[10.829103812350539,2.32415936247395,30.833526829413355],"delta":[219.75375095453933,177.67038823488747,79.13955845275285]}]};
  ok('ellipsometrySpectrum matches golden snapshot', JSON.stringify(es) === JSON.stringify(expect));
}

if (fail === 0) console.log(`PASS: reportData_characterization (${pass} checks)`);
else { console.error(`\n${fail} test(s) failed, ${pass} passed.`); process.exit(1); }
