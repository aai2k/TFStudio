/**
 * The three worked examples of CODE V Multilayer Design Reference Manual,
 * Description of Output: each input read with parseCodevSeq, turned into
 * TFStudio materials and layers with codevStackToDesign, and computed with the
 * TFStudio transfer-matrix kernel, against the MAN table CODE V printed.
 *
 *  Example 1: Al mirror from a MIC table under ZnS/MgF2 quarter waves.
 *  Example 2: 7-layer quarter-wave stack from a GRO group, at 0° and 30°.
 *  Example 3: Al mirror under a half wave of SiO2, with the phase table.
 *
 * R and T agree to one unit in the sixth decimal CODE V prints; CODE V's
 * numbers are single precision (its .mul files hold float32 values). Phase:
 * CODE V's reflection phase of s is the phase in Macleod's convention, which
 * TFStudio reports; its p phase is 180° from that, the p sign convention in
 * which r_p = −r_s at normal incidence (Macleod has r_p = r_s there).
 * Example 3 prints phases at normal incidence only, so the 180° is confirmed
 * there. Its transmission phases are not compared: the transmitted amplitude
 * through 10 waves of Al is near 1e-220, CODE V prints its phase at three
 * wavelengths and "----" at two, and the printed values differ from
 * TFStudio's.
 *
 * Run: node tests/codev_coating_examples.mjs
 */
import assert from 'node:assert/strict';
import { parseCodevSeq, codevStackToDesign } from '../src/utils/io/codevCoatingFile.js';
import { makeGetNK } from '../src/utils/materials/catalogManager/dispersion.js';
import { tmm, tmmPhaseDispersion, jetConstant } from '../src/tmmcore.js';

const RT_TOLERANCE = 1.5e-6;
const PHASE_TOLERANCE_DEG = 1.5e-4;

let checks = 0;
const near = (actual, expected, tolerance, message) => {
    checks++;
    assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
};
const wrapDeg = (deg) => ((deg % 360) + 540) % 360 - 180;

// The design's stack at one wavelength, as tmm takes it.
function stackAt(design, lam) {
    const getNK = Object.fromEntries(design.materials.map(({ key, material }) => [key, makeGetNK(material)]));
    const index = (key) => getNK[key](lam);
    return {
        n0: index(design.incidentKey),
        ns: index(design.substrateKey),
        layers: design.layers.map(layer => ({ n: index(layer.materialKey), d: layer.thickness })),
    };
}

function reflectionPhaseDeg(stack, lam, angle, pol) {
    const layers = stack.layers.map(layer => ({ nJet: jetConstant(...layer.n), d: layer.d }));
    return tmmPhaseDispersion(lam, angle, pol, jetConstant(...stack.n0), jetConstant(...stack.ns), layers).r.phaseDeg;
}

// Rows: [angle, λ, Rs, Rp, Ts, Tp], and for Example 3 the phases [Rs°, Rp°].
function checkTable(name, text, rows, phases = null) {
    const stack = parseCodevSeq(text);
    const design = codevStackToDesign(stack, { sourceName: name });
    rows.forEach(([angle, lam, Rs, Rp, Ts, Tp], i) => {
        const at = stackAt(design, lam);
        const s = tmm(lam, angle, 's', at.n0, at.ns, at.layers);
        const p = tmm(lam, angle, 'p', at.n0, at.ns, at.layers);
        const where = `${name}, ${angle}°, ${lam} nm`;
        near(s.R, Rs, RT_TOLERANCE, `${where}: Rs`);
        near(p.R, Rp, RT_TOLERANCE, `${where}: Rp`);
        near(s.T, Ts, RT_TOLERANCE, `${where}: Ts`);
        near(p.T, Tp, RT_TOLERANCE, `${where}: Tp`);
        if (!phases) return;
        const [phaseS, phaseP] = phases[i];
        near(wrapDeg(reflectionPhaseDeg(at, lam, angle, 's') - phaseS), 0, PHASE_TOLERANCE_DEG, `${where}: s reflection phase`);
        near(wrapDeg(reflectionPhaseDeg(at, lam, angle, 'p') + 180 - phaseP), 0, PHASE_TOLERANCE_DEG, `${where}: p reflection phase`);
    });
}

// CODE V Multilayer Design Reference Manual, Description of Output, Example 1
checkTable('Example 1', `MUL		!  Enter an Al mirror overcoated
MDA		!    with an (HLHL) stack
     MIC		!  Define the material properties of Al
          MWL  450  500  550  600  650  700  750
          'Al'  0.49  0.62  0.76  0.97  1.24  1.55  1.80
          EXT  'Al'  5.47 6.08 6.90 7.26 7.79 8.31 8.62
          END
     TIT	'Overcoated Al mirror'
     INC	1.00
     COA	0.25  100  2.35			!  ZnS
     COA	0.25  100  1.38			!  MgF2
     COA	0.25  100  2.35
     COA	0.25  100  1.38
     COA	5.00  100  'Al'
     SUB	1.62	!  A substrate is needed
     WL	450  500  550  600  650  700  750
     REF	600
MAN
    MPL
     RFL
     AVE
     SPA	450  750
     GO`, [
    [0, 450, 0.752988, 0.752988, 0, 0],
    [0, 500, 0.971256, 0.971256, 0, 0],
    [0, 550, 0.989925, 0.989925, 0, 0],
    [0, 600, 0.991439, 0.991439, 0, 0],
    [0, 650, 0.990193, 0.990193, 0, 0],
    [0, 700, 0.986307, 0.986307, 0, 0],
    [0, 750, 0.978234, 0.978234, 0, 0],
]);

// CODE V Multilayer Design Reference Manual, Description of Output, Example 2
checkTable('Example 2', `MUL
  MDA			!  Choose the Data entry sub-option
TIT   '7 Layer Quarter-wave Stack'
COA	0.25  0  2.3		!  First layer
Group  'A'			!  Define a 2-layer grouping AND
  COA  0.25  0  1.38			!    enter this group
  COA  0.25  0  2.3
END			!  End of Group definition
COA  'A'			!  Repeat the group
COA  'A'			!    2 more times.
SUB  1.52			!  Define the index of the substrate
WLG  400  750  50
REF  550
ANG  0  30			!  2 angles of incidence for analysis
STL  1  2			!  Specify line styles
  MAN			!  List the performance data for the stack
GO
  MPL			!  Plot the reflectance of the stack
RFL
GO`, [
    [0, 400, 0.253488, 0.253488, 0.746511, 0.746511],
    [0, 450, 0.528278, 0.528278, 0.471722, 0.471722],
    [0, 500, 0.920484, 0.920484, 0.079516, 0.079516],
    [0, 550, 0.947786, 0.947786, 0.052214, 0.052214],
    [0, 600, 0.930235, 0.930235, 0.069765, 0.069765],
    [0, 650, 0.853855, 0.853855, 0.146145, 0.146145],
    [0, 700, 0.593479, 0.593479, 0.406521, 0.406521],
    [0, 750, 0.093620, 0.093620, 0.906380, 0.906380],
    [30, 400, 0.058521, 0.067864, 0.941479, 0.932136],
    [30, 450, 0.881649, 0.736083, 0.118351, 0.263917],
    [30, 500, 0.961738, 0.911747, 0.038263, 0.088253],
    [30, 550, 0.962736, 0.913986, 0.037264, 0.086014],
    [30, 600, 0.933938, 0.847887, 0.066062, 0.152113],
    [30, 650, 0.820570, 0.616881, 0.179430, 0.383119],
    [30, 700, 0.402628, 0.135968, 0.597373, 0.864032],
    [30, 750, 0.025979, 0.035899, 0.974021, 0.964101],
]);

// CODE V Multilayer Design Reference Manual, Description of Output, Example 3
checkTable('Example 3', `MUL
  MDA
    TIT   'SiO2 Overcoated Al  Mirror For Visible'
    COA .5 100 1.45		! SiO2
    COA 10 100 'AL'		! Al - 10 waves thick
    INC 1.0		! Incident medium - Air
    SUB 1.517		! Substrate (index doesn't matter)
    MIC
      MWL   350  400  450  550  650  700   750
      'AL'  .31  .40  .51  .83  1.3  1.55  1.8
      EXT 'AL'  4.24  4.86  5.47  6.69  7.79  8.31  8.62
      END
    WL 350 450 550 650 750
    REF 550
    ANG 0
  MAN		! List performance
  MPL		! Plot performance
    RFL
    AVE
    SPA 350 750
  SAV SIO2_Overcoated_Al ! Save to a .MUL file
  MEX`, [
    [0, 350, 0.905576, 0.905576, 0, 0],
    [0, 450, 0.907364, 0.907364, 0, 0],
    [0, 550, 0.930984, 0.930984, 0, 0],
    [0, 650, 0.918779, 0.918779, 0, 0],
    [0, 750, 0.892240, 0.892240, 0, 0],
], [
    [-83.6113, 96.3887],
    [91.4632, -88.5368],
    [163.2458, -16.7542],
    [-155.5930, 24.4070],
    [-121.9598, 58.0402],
]);

console.log(`codev_coating_examples: ${checks} checks passed`);
