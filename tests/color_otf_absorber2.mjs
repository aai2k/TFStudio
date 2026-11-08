/**
 * The Color Evaluation window against OTF Studio, on the design its colour
 * demonstration evaluates: Absorber2, light from air on 20 nm of Au over 90 nm
 * of ZnO over 140 nm of Al, reflectance for s light, CIE 1931 2° observer, 5 nm
 * integration step. The numbers are read off the Table view of that
 * demonstration, the OTF Studio video "Color Evaluation Features" presented by
 * Dr. Tatiana Amochkina, at about 3:35 and 4:00.
 *
 * Its three materials are refractiveindex.info pages: the n, k its material
 * panel lists are theirs at 500 nm, Ordal's Al held at its first row, 667 nm,
 * which is as far down as the page goes. The rows across 380-780 nm are copied
 * below (CC0). Read between rows on straight lines: a cubic moves Y by 0.02.
 *
 * Its table header gives no light source, and its x, y and Y are those of an
 * equal-energy source, CIE illuminant E. Its a* and b* are those values taken
 * against a D65 white, so they are checked that way too; the window itself
 * takes the white from the illuminant it computes under.
 *
 * Run: node tests/color_otf_absorber2.mjs
 */

import './_kernel.mjs';
import assert from 'node:assert/strict';
import { initCatalogs } from '../src/utils/materials/catalogManager.js';
import { computeColorReports } from '../src/components/windows/analysis/colorEvaluation/colorModel.js';
import { lab, whitePoint } from '../src/utils/physics/colorimetry.js';

initCatalogs({});

let failures = 0;
function check(name, fn) {
    try {
        fn();
        console.log('  ok', name);
    } catch (error) {
        failures++;
        console.error('FAIL', name, '\n    ', error.message);
    }
}

const table = (name, rows) => ({ id: name, name, formulaNum: -1, interp: 'linear', tabData: rows });

// M. A. Ordal et al., Appl. Opt. 27, 1203 (1988); refractiveindex.info main/Al/nk/Ordal.
const AL = table('Al', [
    [667, 1.6232262, 8.0797904], [714, 2.0208103, 8.5523233], [769, 2.6528613, 8.7156916], [833, 2.7846191, 8.3634734],
]);

// D. I. Yakubovsky et al., Opt. Express 25, 25574 (2017), 25 nm film;
// refractiveindex.info main/Au/nk/Yakubovsky-25nm.
const AU = table('Au', [
    [370, 1.61569793, 1.95201259], [380, 1.60767985, 1.97413747], [390, 1.60518794, 1.99180722], [400, 1.59915947, 1.99984804],
    [410, 1.58698287, 2.00174335], [420, 1.56953206, 2.00233117], [430, 1.54514587, 1.99683745], [440, 1.51356155, 1.9862035],
    [450, 1.47044934, 1.96776892], [460, 1.41125099, 1.94435033], [470, 1.32913574, 1.91877424], [480, 1.21296262, 1.9001494],
    [490, 1.06656637, 1.90987639], [500, 0.906704742, 1.96228634], [510, 0.761291669, 2.06346006], [520, 0.639418671, 2.19935212],
    [530, 0.554638906, 2.33304055], [540, 0.487291101, 2.46412886], [550, 0.434403561, 2.59213465], [560, 0.391020095, 2.71722435],
    [570, 0.355549579, 2.83576007], [580, 0.325333725, 2.95416074], [590, 0.298993077, 3.0684205], [600, 0.277677889, 3.18419893],
    [610, 0.258734449, 3.29545101], [620, 0.24134197, 3.40146254], [630, 0.226579103, 3.50765886], [640, 0.215667805, 3.6145369],
    [650, 0.204666045, 3.7188903], [660, 0.19636131, 3.82142006], [670, 0.189107572, 3.92236834], [680, 0.184643121, 4.02355566],
    [690, 0.178887146, 4.12044518], [700, 0.17674719, 4.21775367], [710, 0.175831732, 4.31214755], [720, 0.175549525, 4.40493828],
    [730, 0.176358218, 4.49879233], [740, 0.1777416, 4.58950938], [750, 0.179043511, 4.68265772], [760, 0.180860178, 4.7718728],
    [770, 0.181949436, 4.85748775], [780, 0.185046347, 4.94759841], [790, 0.185339889, 5.03345022],
]);

// O. Aguilar et al., Opt. Mater. Express 9, 3638 (2019); refractiveindex.info
// main/ZnO/nk/Aguilar.
const ZNO = table('ZnO', [
    [375, 1.9096, 0.17108], [380, 1.9074, 0.15440], [385, 1.9027, 0.13971], [390, 1.8964, 0.12725],
    [395, 1.8894, 0.11698], [400, 1.8821, 0.10866], [405, 1.8749, 0.10200], [410, 1.8681, 0.096667],
    [415, 1.8619, 0.092362], [420, 1.8562, 0.088828], [425, 1.8510, 0.085860], [430, 1.8463, 0.083303],
    [435, 1.8421, 0.081043], [440, 1.8383, 0.078999], [445, 1.8347, 0.077117], [450, 1.8315, 0.075357],
    [455, 1.8285, 0.073695], [460, 1.8257, 0.072114], [465, 1.8231, 0.070603], [470, 1.8206, 0.069153],
    [475, 1.8182, 0.067759], [480, 1.8160, 0.066416], [485, 1.8139, 0.065123], [490, 1.8119, 0.063875],
    [495, 1.8099, 0.062671], [500, 1.8081, 0.061508], [505, 1.8063, 0.060384], [510, 1.8046, 0.059299],
    [515, 1.8029, 0.058250], [520, 1.8013, 0.057235], [525, 1.7998, 0.056254], [530, 1.7983, 0.055304],
    [535, 1.7969, 0.054385], [540, 1.7955, 0.053495], [545, 1.7942, 0.052632], [550, 1.7929, 0.051797],
    [555, 1.7916, 0.050988], [560, 1.7904, 0.050203], [565, 1.7892, 0.049442], [570, 1.7881, 0.048704],
    [575, 1.7870, 0.047987], [580, 1.7859, 0.047292], [585, 1.7848, 0.046617], [590, 1.7838, 0.045961],
    [595, 1.7828, 0.045324], [600, 1.7818, 0.044705], [605, 1.7809, 0.044104], [610, 1.7800, 0.043519],
    [615, 1.7791, 0.042950], [620, 1.7782, 0.042397], [625, 1.7773, 0.041858], [630, 1.7765, 0.041334],
    [635, 1.7757, 0.040824], [640, 1.7749, 0.040327], [645, 1.7741, 0.039843], [650, 1.7734, 0.039372],
    [655, 1.7727, 0.038913], [660, 1.7719, 0.038465], [665, 1.7712, 0.038029], [670, 1.7706, 0.037603],
    [675, 1.7699, 0.037188], [680, 1.7692, 0.036783], [685, 1.7686, 0.036388], [690, 1.7680, 0.036002],
    [695, 1.7674, 0.035626], [700, 1.7668, 0.035259], [705, 1.7662, 0.034900], [710, 1.7656, 0.034549],
    [715, 1.7651, 0.034207], [720, 1.7645, 0.033872], [725, 1.7640, 0.033545], [730, 1.7635, 0.033226],
    [735, 1.7629, 0.032913], [740, 1.7624, 0.032608], [745, 1.7619, 0.032309], [750, 1.7615, 0.032017],
    [755, 1.7610, 0.031731], [760, 1.7605, 0.031451], [765, 1.7601, 0.031177], [770, 1.7596, 0.030909],
    [775, 1.7592, 0.030647], [780, 1.7588, 0.030390], [785, 1.7583, 0.030139],
]);

// Front layers are listed from the incident medium inward. Al is opaque at
// 140 nm, so the substrate behind it does not show.
const absorber = auNm => ({
    id: `absorber2-${auNm}`, name: 'Absorber2', referenceWavelength: 550, surfaceMode: 'front_only',
    incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air', substrate: { material: 'builtin:BK7', thickness: 1 },
    frontLayers: [
        { id: 'au', material: 'user_otf:Au', thickness: auNm },
        { id: 'zno', material: 'user_otf:ZnO', thickness: 90 },
        { id: 'al', material: 'user_otf:Al', thickness: 140 },
    ],
    backLayers: [],
    materials: { 'user_otf:Al': AL, 'user_otf:Au': AU, 'user_otf:ZnO': ZNO },
});

const colours = (auNm, pol, thetas) => computeColorReports({
    design: absorber(auNm), evalMode: 'front', characteristic: 'R', pol, thetas,
    observer: '2', illuminant: 'E', step: 5,
    setError: error => { if (error) throw new Error(error); },
});

const within = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol, `${what}: ${got} against ${want}`);
const D65 = whitePoint(Array.from({ length: 81 }, (_, i) => 380 + 5 * i), '2', 'D65');

check('Rs at 0, 6, 12 and 18 degrees: x, y to 1e-4, Y to 1e-3, L* to 2e-3, a* and b* against D65 to 0.05', () => {
    const otf = [
        { theta: 0, x: 0.40116, y: 0.23463, Y: 28.67464, a: 71.281, b: -16.543, L: 60.493 },
        { theta: 6, x: 0.40246, y: 0.23632, Y: 28.95420, a: 70.980, b: -15.832, L: 60.741 },
        { theta: 12, x: 0.40616, y: 0.24141, Y: 29.80665, a: 70.028, b: -13.713, L: 61.487 },
        { theta: 18, x: 0.41167, y: 0.24986, Y: 31.26824, a: 68.302, b: -10.246, L: 62.733 },
    ];
    const ours = colours(20, 's', otf.map(row => row.theta));
    otf.forEach((row, i) => {
        const { report } = ours[i];
        const againstD65 = lab(report.XYZ, D65);
        within(report.xy.x, row.x, 1e-4, `${row.theta}° x`);
        within(report.xy.y, row.y, 1e-4, `${row.theta}° y`);
        within(report.XYZ.Y, row.Y, 1e-3, `${row.theta}° Y`);
        within(report.Lab.L, row.L, 2e-3, `${row.theta}° L*`);
        within(againstD65.a, row.a, 0.05, `${row.theta}° a*`);
        within(againstD65.b, row.b, 0.05, `${row.theta}° b*`);
    });
});

check('Rs L* from 24 to 54 degrees to 2e-3', () => {
    const otf = [[24, 64.471], [30, 66.665], [36, 69.255], [42, 72.157], [48, 75.282], [54, 78.547]];
    const ours = colours(20, 's', otf.map(([theta]) => theta));
    otf.forEach(([theta, L], i) => within(ours[i].report.Lab.L, L, 2e-3, `${theta}° L*`));
});

check('R at 0 degrees with 17 nm and 22 nm of Au', () => {
    for (const [auNm, x, y, Y] of [[17, 0.39070, 0.21805, 24.27131], [22, 0.40439, 0.24598, 31.92143]]) {
        const [{ report }] = colours(auNm, 'avg', [0]);
        within(report.xy.x, x, 1e-4, `Au ${auNm} nm x`);
        within(report.xy.y, y, 1e-4, `Au ${auNm} nm y`);
        within(report.XYZ.Y, Y, 1e-3, `Au ${auNm} nm Y`);
    }
});

if (failures) {
    console.error(`\ncolor_otf_absorber2: ${failures} check(s) failed`);
    process.exit(1);
}
console.log('\ncolor_otf_absorber2: passed');
