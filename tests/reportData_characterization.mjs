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
        n: 2.5165803324330853, ot: 293.6849247949411, qwot: 2.1358903621450263, fwot: 0.5339725905362566 },
      { index: 2, material: 'SiO2 (Fused Silica)', thickness: 187.3, locked: false,
        n: 1.4599108864687285, ot: 273.44130903559284, qwot: 1.9886640657134025, fwot: 0.4971660164283506 },
      { index: 3, material: 'TiO2 (anatase)', thickness: 90, locked: true,
        n: 2.5165803324330853, ot: 226.49222991897767, qwot: 1.6472162175925649, fwot: 0.4118040543981412 },
    ],
    materials: [
      { id: 'TiO2', name: 'TiO2 (anatase)', n: 2.5165803324330853, k: 0 },
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
  const expect = {"lambda":[400,500,600,700],"series":[{"theta":0,"R":[0.6452385763004351,0.1305430673859529,0.2649012516417473,0.011938431223090212],"T":[0.3547614236995649,0.8694569326140474,0.7350987483582527,0.9880615687769101],"A":[0,0,0,0],"Rs":[0.6452385763004351,0.1305430673859529,0.2649012516417473,0.011938431223090212],"Ts":[0.3547614236995649,0.8694569326140474,0.7350987483582527,0.9880615687769101],"As":[0,0,0,0],"Rp":[0.6452385763004351,0.1305430673859529,0.2649012516417473,0.011938431223090212],"Tp":[0.3547614236995649,0.8694569326140474,0.7350987483582527,0.9880615687769101],"Ap":[0,0,0,0]},{"theta":30,"R":[0.5160533952445457,0.07333473309267519,0.2452834308319347,0.015303358194929242],"T":[0.48394660475545437,0.926665266907325,0.7547165691680653,0.9846966418050708],"A":[2.7755575615628914e-17,0,5.551115123125783e-17,0],"Rs":[0.5867509720465635,0.09584751527104711,0.2947951791923755,0.018951517322627252],"Ts":[0.4132490279534365,0.9041524847289533,0.7052048208076244,0.9810484826773728],"As":[5.551115123125783e-17,0,1.1102230246251565e-16,0],"Rp":[0.4453558184425281,0.05082195091430328,0.1957716824714939,0.011655199067231233],"Tp":[0.5546441815574723,0.9491780490856968,0.8042283175285062,0.9883448009327688],"Ap":[0,0,0,0]}],"evalMode":"front"};
  ok('buildSpectrum matches golden snapshot', JSON.stringify(sp) === JSON.stringify(expect));
}

// ── computeRiProfile: n(z) staircase (layer boundaries + refractive index) ──
console.log('— computeRiProfile —');
{
  const rp = computeRiProfile(design);
  ok('riProfile lambda = design referenceWavelength', rp.lambda === 550);
  ok('riProfile z length', rp.z.length === 6);
  ok('riProfile n[0..2]', rp.n[0] === 1 && rp.n[1] === 2.5165803324330853 && rp.n[2] === 1.4599108864687285);
  ok('riProfile layerBounds', JSON.stringify(rp.layerBounds) === JSON.stringify([0, 116.7, 304, 394]));
}

// ── computeEField: |E(z)|^2 profile at a fixed lambda/theta/pol ─────────────
console.log('— computeEField —');
{
  const ef = computeEField(design, { lambda: 550, theta: 0, pol: 's' });
  ok('eField lambda/theta/pol', ef.lambda === 550 && ef.theta === 0 && ef.pol === 's');
  ok('eField z length', ef.z.length === 151);
  ok('eField e2[0..2]', Math.abs(ef.e2[0] - 0.5386020090182037) < 1e-12
    && Math.abs(ef.e2[1] - 0.5217082645651081) < 1e-12
    && Math.abs(ef.e2[2] - 0.5026360423126467) < 1e-12);
}

// ── computeEllipsometrySpectrum: Psi/Delta(lambda) per AOI ──────────────────
console.log('— computeEllipsometrySpectrum —');
{
  const es = computeEllipsometrySpectrum(design, { lambdaStart: 400, lambdaEnd: 600, lambdaStep: 100, thetas: [65] });
  const expect = {"lambda":[400,500,600],"series":[{"theta":65,"psi":[10.837680537057055,2.3249796157215177,30.834582324941227],"delta":[219.71230565871156,177.70390963211264,79.1376485199657]}]};
  ok('ellipsometrySpectrum matches golden snapshot', JSON.stringify(es) === JSON.stringify(expect));
}

if (fail === 0) console.log(`PASS: reportData_characterization (${pass} checks)`);
else { console.error(`\n${fail} test(s) failed, ${pass} passed.`); process.exit(1); }
