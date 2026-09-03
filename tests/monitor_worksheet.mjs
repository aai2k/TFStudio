/**
 * Optical monitoring worksheet: witness-chip model, swing bookkeeping and
 * termination error.
 *
 * The swing definitions are checked against closed-form single-layer optics
 * rather than against a stored baseline:
 *
 *   - a quarter-wave layer on a bare chip has its turning point at the cut, so
 *     the signal there is the one an admittance Y = n1^2/ns gives (Macleod,
 *     Thin-Film Optical Filters 5th ed., Ch. 4);
 *   - the same layer continued to a half wave is absentee, so the signal
 *     returns to the bare chip and the amplitude equals the swing in;
 *   - a layer too thin to turn borrows the turning point of the layer before it
 *     on the same chip (FilmStar MONITOR's last-two-turning-points rule);
 *   - a chip only sees the layers assigned to it;
 *   - the termination error follows dS/|dS/dd| on a level cut and
 *     sqrt(2 dS/|S''|) on a turning-point cut, so halving the monitor's signal
 *     error halves the first and divides the second by sqrt(2).
 *
 * Run: node tests/monitor_worksheet.mjs
 */
import {
    assignChips, autoChipLambdas, buildMonitorWorksheet,
} from '../src/utils/monitoring/monoSim.js';

const mk = (n, k = 0) => ({ name: `n${n}`, getNK: () => [n, k] });
const MATS = { Air: mk(1.0), BK7: mk(1.52), H: mk(2.30), L: mk(1.46) };
const resolveMat = (id) => MATS[id] || MATS.Air;

const REF = 550;
const NS = 1.52;
const qwot = (matId, lam = REF) => lam / (4 * resolveMat(matId).getNK(lam)[0]);

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail++; };
const close = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg} (${a} vs ${b})`);

// Transmittance of a lossless coating of admittance Y in air on this substrate.
const transmittanceOf = (Y) => 1 - ((1 - Y) / (1 + Y)) ** 2;

// The witness chip is a plane-parallel slab, so the monitor reads through its
// bare back face too: coated front (admittance Y), bare back, incoherent sum
// of the internal reflections (Macleod, Thin-Film Optical Filters 5th ed.,
// Ch. 2). A lossless coating reflects equally from both sides, so R_f' = R_f.
function slabT(Y, nsub = NS) {
    const Tf = transmittanceOf(Y);
    const Rb = ((nsub - 1) / (nsub + 1)) ** 2;
    return (Tf * (1 - Rb)) / (1 - (1 - Tf) * Rb);
}

function makeDesign(layers) {
    return {
        referenceWavelength: REF,
        incidentMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },
        exitMedium: 'Air',
        // Storage is air -> substrate, so the first layer deposited is last here.
        frontLayers: layers.slice().reverse(),
    };
}

// ── 1. Chip assignment ────────────────────────────────────────────────────────
ok(assignChips(7, 3).join(',') === '1,1,1,2,2,2,3', 'chips fill three layers at a time');
ok(assignChips(4, 1).join(',') === '1,2,3,4', 'one layer per chip gives one chip each');

// ── 2. Quarter-wave layer on a bare chip ──────────────────────────────────────
// Cut sits on the turning point: swing out ~ 0, and the signal there is the one
// the quarter-wave admittance Y = n1^2/ns gives.
const oneQW = makeDesign([{ material: 'H', thickness: qwot('H') }]);
const w1 = buildMonitorWorksheet(oneQW, resolveMat, { layersPerChip: 1 });
const r1 = w1.rows[0];
const nH = resolveMat('H').getNK(REF)[0];

ok(w1.rows.length === 1, 'one row per deposited layer');
ok(r1.chip === 1 && r1.onChip === 1 && r1.step === 1, 'first layer is layer 1 of chip 1');
close(r1.initialLevel, slabT(NS), 1e-9, 'initial level is the bare chip, back face included');
close(r1.signal, slabT(nH * nH / NS), 2e-4, 'signal at the cut is the quarter-wave value');
ok(r1.turningPoints === 1, 'the layer traverses one turning point');
ok(r1.strategy === 'turning', 'a quarter-wave layer is cut on the turn');
ok(r1.cutoffRatio < 0.01, `cutting on the turn gives a cutoff ratio near zero (${r1.cutoffRatio})`);

// A half wave is absentee, so the turning point after the cut is back at the
// bare-chip level and the amplitude equals the swing in.
close(r1.nextTurningSignal, slabT(NS), 2e-4, 'the next turning point is the absentee level');
close(r1.amplitude, r1.swingIn, 2e-4, 'amplitude equals swing in for the first layer on a chip');

// ── 3. The definitions the columns are read with ──────────────────────────────
const stack = makeDesign([
    { material: 'H', thickness: qwot('H') },
    { material: 'L', thickness: 1.2 * qwot('L') },
    { material: 'H', thickness: 0.55 * qwot('H') },
    { material: 'L', thickness: qwot('L') },
]);
const w2 = buildMonitorWorksheet(stack, resolveMat, { layersPerChip: 2 });
let defsHold = true;
for (const row of w2.rows) {
    if (Math.abs(row.swingIn - Math.abs(row.signalStart - row.referenceSignal)) > 1e-12) defsHold = false;
    if (Math.abs(row.swingOut - Math.abs(row.signal - row.referenceSignal)) > 1e-12) defsHold = false;
    if (row.amplitude != null
        && Math.abs(row.amplitude - Math.abs(row.nextTurningSignal - row.referenceSignal)) > 1e-12) defsHold = false;
    if (row.cutoffRatio != null
        && Math.abs(row.cutoffRatio - row.swingOut / row.amplitude) > 1e-12) defsHold = false;
}
ok(defsHold, 'swing in, swing out, amplitude and cutoff ratio follow their definitions');
ok(w2.rows.every(r => r.cutoffRatio == null || (r.cutoffRatio >= 0 && r.cutoffRatio <= 1.001)),
   'every cutoff ratio lands between the two turning points');

// ── 4. Deposition order and chip grouping ─────────────────────────────────────
ok(w2.rows[0].layerIndex === stack.frontLayers.length - 1,
   'the run starts at the substrate-adjacent layer');
ok(w2.rows.map(r => r.chip).join(',') === '1,1,2,2', 'two layers per chip');
ok(w2.rows.map(r => r.onChip).join(',') === '1,2,1,2', 'layer index restarts on each chip');
ok(w2.rows.filter(r => r.initialLevel != null).length === 2,
   'only the first layer of each chip carries an initial level');
close(w2.rows[2].initialLevel, slabT(NS), 1e-9, 'chip 2 starts from bare glass');
ok(w2.chips.length === 2 && w2.chips[1].steps.join(',') === '3,4', 'chips report the steps on them');

// ── 5. A chip only sees its own layers ────────────────────────────────────────
const solo = buildMonitorWorksheet(stack, resolveMat, { layersPerChip: 1 });
ok(solo.rows.every(r => Math.abs(r.signalStart - slabT(NS)) < 1e-9),
   'with one layer per chip every layer starts from bare glass');
close(solo.rows[0].signal, w1.rows[0].signal, 2e-4,
   'the same material and thickness on a bare chip gives the same cut signal');

// ── 6. A thin layer borrows the turning point before it ───────────────────────
const withThin = makeDesign([
    { material: 'H', thickness: qwot('H') },
    { material: 'L', thickness: 0.08 * qwot('L') },
]);
const w3 = buildMonitorWorksheet(withThin, resolveMat, { layersPerChip: 2 });
const thin = w3.rows[1];
ok(thin.turningPoints === 0, 'a very thin layer shows no turning point of its own');
ok(thin.referenceInEarlierLayer, 'it is read against the turning point in the layer before it');
ok(thin.swingIn > 0, 'its swing in is measured from that earlier turning point');

// ── 7. Termination error follows the rule the layer is cut with ───────────────
// The exact scaling law holds for the relative error alone, so the
// photometric floor is zeroed here; its own effect is pinned below.
const errAt = (signalErrorPct) => buildMonitorWorksheet(stack, resolveMat, {
    layersPerChip: 2, signalErrorPct, absSignalErrorPct: 0,
}).rows.map(r => r.terminationErrNm);
const eBase = errAt(0.4);
const eHalf = errAt(0.2);
const strategies = w2.rows.map(r => r.strategy);
ok(strategies.includes('turning') && strategies.includes('level'),
   `the stack exercises both cut rules (${strategies.join(', ')})`);

let scalingHolds = true;
for (let i = 0; i < eBase.length; i++) {
    const expected = strategies[i] === 'turning'
        ? eBase[i] / Math.SQRT2
        : eBase[i] / 2;
    if (Math.abs(eHalf[i] - expected) > 1e-6 * Math.max(1, expected)) scalingHolds = false;
}
ok(scalingHolds, 'halving the signal error halves a level cut and divides a turn by sqrt(2)');
ok(w2.rows.every(r => r.terminationErrNm > 0), 'every optically cut layer reports a termination error');

// The photometric floor does not shrink with the reading: at a near-zero
// relative error, a positive floor still costs thickness, which is what
// rules out a wavelength where the signal has died.
const floorRows = (absSignalErrorPct) => buildMonitorWorksheet(stack, resolveMat, {
    layersPerChip: 2, signalErrorPct: 0.001, absSignalErrorPct,
}).rows.map(r => r.terminationErrNm);
const eNoFloor = floorRows(0);
const eFloor = floorRows(0.2);
ok(eFloor.every((e, i) => e > eNoFloor[i]),
   'the absolute noise floor adds termination error the relative term cannot remove');

// ── 8. Witness ratio scales what the chip receives ────────────────────────────
const scaled = buildMonitorWorksheet(stack, resolveMat, { layersPerChip: 2, witnessRatio: 1.1 });
let ratioHolds = true;
for (let i = 0; i < scaled.rows.length; i++) {
    if (Math.abs(scaled.rows[i].thickness - 1.1 * w2.rows[i].partThickness) > 1e-9) ratioHolds = false;
    if (Math.abs(scaled.rows[i].partThickness - w2.rows[i].partThickness) > 1e-12) ratioHolds = false;
}
ok(ratioHolds, 'the witness grows thicker than the part, the part thickness is unchanged');

// ── 9. Flagging ───────────────────────────────────────────────────────────────
const strict = buildMonitorWorksheet(stack, resolveMat, { layersPerChip: 2, maxTerminationErrPct: 0 });
const loose = buildMonitorWorksheet(stack, resolveMat, { layersPerChip: 2, maxTerminationErrPct: 1e6 });
ok(strict.rows.every(r => r.poor), 'a zero tolerance flags every layer');
ok(loose.rows.every(r => !r.poor), 'a tolerance nothing can exceed flags none');
ok(strict.rows.every(r => r.crystalNm === r.partThickness),
   'a flagged layer reports the thickness the crystal has to run');
ok(loose.rows.every(r => r.crystalNm === r.partThickness),
   'an unflagged layer reports it too, so the run sheet is complete');

// ── 10. One monitoring wavelength per chip ────────────────────────────────────
const lambdas = autoChipLambdas(stack, resolveMat, { layersPerChip: 2 });
ok(lambdas.length === stack.frontLayers.length, 'one wavelength per deposition step');
ok(lambdas[0] === lambdas[1] && lambdas[2] === lambdas[3],
   `layers on one chip share a wavelength (${lambdas.join(', ')})`);
ok(lambdas.every(l => l >= REF * 0.7 - 1 && l <= REF * 1.3 + 1), 'the picks stay inside the band');

const picked = buildMonitorWorksheet(stack, resolveMat, { layersPerChip: 2, lambdaByStep: lambdas });
const worstPicked = Math.max(...picked.rows.map(r => r.terminationErrPct));
const worstRef = Math.max(...w2.rows.map(r => r.terminationErrPct));
console.log(`     worst termination error: ${worstRef.toFixed(3)} % at ${REF} nm, ` +
            `${worstPicked.toFixed(3)} % at the picked wavelengths`);
ok(worstPicked <= worstRef * 1.001, 'the picked wavelengths do not terminate worse than the reference');

// ── 11. A chip is a physical piece, not a position in the run ─────────────────
// Layers carrying the same chip number are on the same piece even when they are
// deposited out of sequence, which is what a multi-position witness allows.
{
    const interleaved = buildMonitorWorksheet(stack, resolveMat, { chipByStep: [1, 2, 1, 2] });
    ok(interleaved.chips.length === 2, 'a reused chip number is the same chip, not a new one');
    ok(interleaved.chips[0].steps.join(',') === '1,3'
        && interleaved.chips[1].steps.join(',') === '2,4',
       'each chip collects the steps assigned to it');
    ok(interleaved.rows.map(r => r.step).join(',') === '1,2,3,4',
       'the table stays in run order');
    ok(interleaved.rows.map(r => `${r.chip}-${r.onChip}`).join(' ') === '1-1 2-1 1-2 2-2',
       'and no two rows carry the same chip and position');
    ok(interleaved.rows[0].xStart === 0 && interleaved.rows[1].xStart === interleaved.rows[0].xCut,
       'the run axis follows deposition order, not the chip grouping');
    // Step 3 goes back onto chip 1, so it grows on what step 1 left there.
    close(interleaved.rows[2].signalStart, interleaved.rows[0].signal, 2e-4,
       'returning to a chip continues the stack already on it');
    close(interleaved.rows[1].signalStart, slabT(NS), 1e-9,
       'while its first layer starts from bare glass');
}

// ── 12. A wavelength belongs to the chip ──────────────────────────────────────
// The worksheet reads it off the chip's first layer, which is what makes the
// window write one wavelength across every row of a chip.
{
    const mixed = buildMonitorWorksheet(stack, resolveMat, {
        layersPerChip: 2, lambdaByStep: [520, 480, 600, 640],
    });
    ok(mixed.rows.map(r => r.lambda).join(',') === '520,520,600,600',
       'every layer on a chip is read at one wavelength');
}

// ── 13. Against a published FilmStar MONITOR worksheet ────────────────────────
// The worksheet the feature was requested from: 14 layers alternating n = 2.30
// and 1.46, each 1.100 quarter waves at 500 nm, on a 1.52 substrate, monitored
// in transmittance at 500 nm with every layer on one chip.
//
// FilmStar reads through the witness chip's back surface, and so does this
// model: bare glass reads 91.832 % there, against 95.742 % for the coated
// surface alone. Both the absolute level and the swing ratios are compared.
{
    const REF_LAM = 500;
    const filmstar = [
        // swing out / swing in, swing in / amplitude, swing out / amplitude
        [0.018, 1.000, 0.018], [0.066, 0.997, 0.066], [0.035, 0.962, 0.034],
        [0.168, 0.982, 0.165], [0.047, 0.863, 0.041], [0.253, 0.970, 0.245],
        [0.056, 0.773, 0.044], [0.306, 0.963, 0.294], [0.062, 0.716, 0.045],
        [0.335, 0.959, 0.321], [0.066, 0.685, 0.045], [0.350, 0.957, 0.335],
        [0.068, 0.668, 0.045], [0.359, 0.955, 0.343],
    ];
    const deposited = filmstar.map((_, i) => ({
        material: i % 2 === 0 ? 'H' : 'L',
        thickness: 1.1 * qwot(i % 2 === 0 ? 'H' : 'L', REF_LAM),
    }));
    const sheet = buildMonitorWorksheet(
        { ...makeDesign(deposited), referenceWavelength: REF_LAM },
        resolveMat, { layersPerChip: deposited.length });

    let worst = 0;
    for (let i = 0; i < filmstar.length; i++) {
        const row = sheet.rows[i];
        const mine = [row.swingOut / row.swingIn, row.swingIn / row.amplitude, row.cutoffRatio];
        for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(mine[k] - filmstar[i][k]));
    }
    close(sheet.rows[0].signalStart, 0.91832, 5e-5,
       "the bare chip reads FilmStar's published 91.832 %");
    console.log(`     worst disagreement with the published worksheet: ${worst.toFixed(4)}`);
    ok(worst < 0.004, 'swing and cutoff ratios reproduce the published worksheet');
    ok(sheet.rows.every(row => row.turningPoints === 1),
       'each layer traverses one turning point, as the published sheet reports');
    ok(sheet.rows.every(row => row.strategy === 'level'),
       'a layer 10 % past the quarter wave is cut on a level, not on the turn');
}

// ── 14. A layer with no thickness does not decide a chip's wavelength ─────────
{
    const withZero = makeDesign([
        { material: 'H', thickness: qwot('H') },
        { material: 'L', thickness: 0 },
    ]);
    const picked = autoChipLambdas(withZero, resolveMat, { layersPerChip: 2 });
    const plain = autoChipLambdas(makeDesign([{ material: 'H', thickness: qwot('H') }]),
                                  resolveMat, { layersPerChip: 2 });
    ok(picked[0] === plain[0],
       `a zero-thickness layer leaves the pick alone (${picked[0]} vs ${plain[0]})`);
    ok(autoChipLambdas(makeDesign([{ material: 'H', thickness: 0 }]), resolveMat, {})[0] === REF,
       'a chip with nothing to monitor keeps the reference wavelength');
}

// ── 15. Empty design ──────────────────────────────────────────────────────────
const empty = buildMonitorWorksheet(makeDesign([]), resolveMat, {});
ok(empty.rows.length === 0 && empty.chips.length === 0, 'a bare substrate produces no rows');

// ── 16. Chip glass ────────────────────────────────────────────────────────────
// The witness chip's glass is the design substrate unless overridden, and the
// override moves every level on the chip.
{
    const nL = resolveMat('L').getNK(REF)[0];
    const oneL = makeDesign([{ material: 'L', thickness: qwot('L') }]);
    const onH = buildMonitorWorksheet(oneL, resolveMat, { layersPerChip: 1, chipMaterial: 'H' });
    close(onH.rows[0].initialLevel, slabT(nH, nH), 1e-9,
       'a chip of another glass starts from that glass, both faces included');
    close(onH.rows[0].signal, slabT(nL * nL / nH, nH), 2e-4,
       'and the quarter-wave level follows the chip, not the design substrate');
    const followed = buildMonitorWorksheet(oneL, resolveMat, { layersPerChip: 1, chipMaterial: null });
    close(followed.rows[0].initialLevel, slabT(NS), 1e-9,
       'no override means the design substrate');
}

// ── 17. The chip is monitored in air ─────────────────────────────────────────
// A cemented filter is designed embedded in glass and carries a glass incident
// medium. The witness chip hangs in the chamber all the same, so its signal is
// the one a chip in air gives.
{
    const embedded = { ...stack, incidentMedium: 'BK7' };
    const inGlass = buildMonitorWorksheet(embedded, resolveMat, { layersPerChip: 2 });
    close(inGlass.rows[0].initialLevel, slabT(NS), 1e-9,
       'an embedded design still starts from a bare chip in air');
    ok(inGlass.rows.every((r, i) => Math.abs(r.signal - w2.rows[i].signal) < 1e-12),
       'and every level matches the same design in air');
}

// ── 18. A layer that leaves no signal ─────────────────────────────────────────
// Silica on a silica chip extends the chip: the signal stays exactly flat, and
// the arithmetic ripple on it is not a row of turning points. Both cut rules
// see it: the quarter wave would be cut on a turn, the 1.2 quarter waves on a
// level.
{
    const nL = resolveMat('L').getNK(REF)[0];
    const matched = makeDesign([
        { material: 'L', thickness: qwot('L') },
        { material: 'L', thickness: 1.2 * qwot('L') },
        { material: 'H', thickness: qwot('H') },
    ]);
    const onL = buildMonitorWorksheet(matched, resolveMat, { layersPerChip: 3, chipMaterial: 'L' });
    for (const row of onL.rows.slice(0, 2)) {
        ok(row.turningPoints === 0, `silica on a silica chip shows no turning point (${row.strategy} cut)`);
        ok(row.amplitude === null && row.cutoffRatio === null, 'it has no amplitude and no cutoff ratio');
        ok(row.terminationErrNm === Infinity, 'its termination error is infinite, not an arithmetic residue');
        ok(row.poor && row.crystalNm === row.partThickness, 'it is flagged and handed to the crystal');
        close(row.signal, slabT(nL, nL), 1e-9, 'the chip level does not move while it grows');
    }
    const after = onL.rows[2];
    ok(after.turningPoints === 1 && Number.isFinite(after.terminationErrNm),
       'the layer after them is read normally');

    // No wavelength can help a layer with no signal, so it does not decide the
    // chip's pick: the wavelength is the one the layer that can be monitored gets.
    const picked = autoChipLambdas(matched, resolveMat, { layersPerChip: 3, chipMaterial: 'L' });
    const alone = autoChipLambdas(makeDesign([{ material: 'H', thickness: qwot('H') }]),
                                  resolveMat, { layersPerChip: 3, chipMaterial: 'L' });
    ok(picked[0] === alone[0],
       `a layer with no signal does not decide the chip's wavelength (${picked[0]} vs ${alone[0]})`);
}

// ── 19. A swing below the monitor's own error is not a signal ─────────────────
// Deep in its own stopband a mirror still moves the reading by a millionth per
// layer: a real curve with real extrema, and nothing a monitor could see. Below
// the signal error the row reads as no signal; with the noise set to zero the
// same layer gets its numbers back.
{
    const mirror = makeDesign(Array.from({ length: 40 }, (_, i) => {
        const id = i % 2 ? 'L' : 'H';
        return { material: id, thickness: qwot(id) };
    }));
    const noisy = buildMonitorWorksheet(mirror, resolveMat, { layersPerChip: 40 });
    const first = noisy.rows[0];
    const deep = noisy.rows[noisy.rows.length - 1];
    ok(first.turningPoints === 1 && Number.isFinite(first.terminationErrNm),
       'the first layer of the mirror is monitored normally');
    ok(deep.turningPoints === 0 && deep.amplitude === null && deep.cutoffRatio === null,
       'the deepest layer shows no turning point, amplitude or cutoff ratio');
    ok(deep.terminationErrNm === Infinity && deep.poor, 'and an infinite error, flagged');
    const quiet = buildMonitorWorksheet(mirror, resolveMat,
        { layersPerChip: 40, signalErrorPct: 0, absSignalErrorPct: 0 });
    const deepQuiet = quiet.rows[quiet.rows.length - 1];
    ok(deepQuiet.turningPoints === 1 && Number.isFinite(deepQuiet.terminationErrNm),
       'a noiseless monitor would still see it turn');
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
