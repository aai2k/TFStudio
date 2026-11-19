/**
 * The built-in AM1.5G table is the ASTM G173-03 global-tilt spectrum.
 *
 * G173 points (NREL ASTMG173.csv, third column, before binning):
 *   300 nm 0.00102, 500 nm 1.545, 1000 nm 0.735 W/m^2/nm.
 * Each table row is the mean over its 5 nm bin, so a row sits near the point
 * value where the curve is smooth and well above it where it climbs steeply
 * (300 nm). The energy is kept: 280-2500 nm integrates to 992.6 W/m^2 and
 * 280-400 nm holds 4.6 % of it.
 */
import { AM1_5G_5NM, solarIrradianceAt } from '../src/utils/physics/solarSpectrum.js';
import { BUILTIN_WEIGHTINGS, computeIntegralValue } from '../src/utils/physics/integralValues.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const at = (lam) => AM1_5G_5NM.find(([l]) => l === lam)[1];

ok(AM1_5G_5NM[0][0] === 280 && AM1_5G_5NM.at(-1)[0] === 2500 && AM1_5G_5NM.length === 445,
    'one row per 5 nm from 280 to 2500 nm');

ok(at(300) > 0 && at(300) < 0.005, `300 nm is cut off by ozone (got ${at(300)}, G173 point 0.00102)`);
ok(Math.abs(at(500) / 1.545 - 1) < 0.02, `500 nm near the G173 point 1.545 (got ${at(500)})`);
ok(Math.abs(at(1000) / 0.735 - 1) < 0.02, `1000 nm near the G173 point 0.735 (got ${at(1000)})`);

let total = 0;
let uv = 0;
for (const [lam, e] of AM1_5G_5NM) {
    const width = lam === 280 ? 2.5 : 5;
    total += e * width;
    if (lam < 400) uv += e * width;
    else if (lam === 400) uv += e * 2.5;
}
ok(Math.abs(total - 992.6) < 1, `280-2500 nm integrates to 992.6 W/m^2 (got ${total.toFixed(2)})`);
ok(Math.abs(uv / total - 0.0465) < 0.002, `280-400 nm holds 4.6 % of the energy (got ${(100 * uv / total).toFixed(2)} %)`);

ok(solarIrradianceAt(552.5) === 0.5 * (at(550) + at(555)), 'interpolates linearly between rows');
ok(solarIrradianceAt(270) === 0 && solarIrradianceAt(2600) === 0, 'zero outside the table');

{
    const lambda = [];
    for (let l = 280; l <= 2500; l += 1) lambda.push(l);
    const T = lambda.map((l) => (l < 400 ? 0 : 1));
    const spec = { lambda, T, R: T.map((v) => 1 - v), A: lambda.map(() => 0) };
    const tsol = computeIntegralValue(spec, 'T', BUILTIN_WEIGHTINGS.solar).value;
    ok(Math.abs(tsol - 0.953) < 0.005, `Tsol of a coating that blocks below 400 nm is 0.95 (got ${tsol.toFixed(4)})`);
}

console.log(fails === 0 ? 'PASS: solar_spectrum_g173' : `${fails} assertion(s) failed`);
process.exit(fails === 0 ? 0 : 1);
