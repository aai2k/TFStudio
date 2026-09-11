/**
 * Explicit smooth fits for tabulated optical constants.
 *
 * Fits are material-owned data. They carry their validity range and residuals,
 * and are never generated or selected during a spectrum calculation.
 *
 * The metal model follows the Lorentz-Drude dielectric function in
 * A. D. Rakic et al., Applied Optics 37, 5271-5283 (1998),
 * https://doi.org/10.1364/AO.37.005271. Signs are conjugated for TFStudio's
 * n + ik and exp(-i omega t) convention.
 */

import {
    jetAdd,
    jetConstant,
    jetDivide,
    jetExp,
    jetMultiply,
    jetPower,
    jetScale,
    jetSqrt,
    jetSubtract,
} from '../../tmmcore.js';
import { levenbergMarquardt, solveLinear, sumSquares } from '../math/leastSquares.js';

const HC_EV_UM = 1.239841984;

// A term is kept only when it cuts the RMS residual by at least this much. Past
// that the extra freedom follows the rounding in the table rather than the
// material's dispersion, and the fit is chosen for the user rather than by them.
export const TERM_GAIN = 0.1;

// Most oscillators any metal fit is built from. Rakic's models of the coinage
// metals use five over the visible and near infrared.
const MAX_OSCILLATORS = 5;

function divideComplex(numerator, denominator) {
    const divisor = denominator[0] ** 2 + denominator[1] ** 2;
    return [
        (numerator[0] * denominator[0] + numerator[1] * denominator[1]) / divisor,
        (numerator[1] * denominator[0] - numerator[0] * denominator[1]) / divisor,
    ];
}

function sqrtComplexPositive(value) {
    const magnitude = Math.hypot(value[0], value[1]);
    return [
        Math.sqrt(Math.max(0, (magnitude + value[0]) / 2)),
        Math.sqrt(Math.max(0, (magnitude - value[0]) / 2)),
    ];
}

function dielectricAt(model, energyEv) {
    const energySquared = energyEv * energyEv;
    let epsilon = [model.epsilonInfinity, 0];
    const drude = divideComplex(
        [model.plasmaEnergyEv ** 2, 0],
        [energySquared, model.drudeDampingEv * energyEv],
    );
    epsilon = [epsilon[0] - drude[0], epsilon[1] - drude[1]];
    for (const oscillator of model.oscillators || []) {
        const lorentz = divideComplex(
            [oscillator.strengthEv2, 0],
            [oscillator.resonanceEv ** 2 - energySquared,
                -oscillator.dampingEv * energyEv],
        );
        epsilon = [epsilon[0] + lorentz[0], epsilon[1] + lorentz[1]];
    }
    return epsilon;
}

export function evaluateComplexDispersionModel(model, wavelengthNm) {
    return sqrtComplexPositive(dielectricAt(model, HC_EV_UM / (wavelengthNm / 1000)));
}

function evaluateComplexDispersionModelJets(model, wavelengthMicrometersJet) {
    const energy = jetDivide(jetConstant(HC_EV_UM), wavelengthMicrometersJet);
    const energySquared = jetMultiply(energy, energy);
    const drudeDenominator = jetAdd(
        energySquared,
        jetMultiply(jetConstant(0, model.drudeDampingEv), energy),
    );
    let epsilon = jetSubtract(
        jetConstant(model.epsilonInfinity),
        jetDivide(jetConstant(model.plasmaEnergyEv ** 2), drudeDenominator),
    );
    for (const oscillator of model.oscillators || []) {
        const denominator = jetAdd(
            jetSubtract(jetConstant(oscillator.resonanceEv ** 2), energySquared),
            jetMultiply(jetConstant(0, -oscillator.dampingEv), energy),
        );
        epsilon = jetAdd(epsilon, jetDivide(
            jetConstant(oscillator.strengthEv2),
            denominator,
        ));
    }
    const index = jetSqrt(epsilon);
    return {
        nJet: index.map(coefficient => [coefficient[0], 0]),
        kJet: index.map(coefficient => [coefficient[1], 0]),
    };
}

function linearLeastSquares(rows, featureAt, valueAt, parameterCount) {
    const normal = Array.from({ length: parameterCount }, () => Array(parameterCount).fill(0));
    const rhs = Array(parameterCount).fill(0);
    for (const row of rows) {
        const features = featureAt(row);
        const value = valueAt(row);
        for (let i = 0; i < parameterCount; i++) {
            rhs[i] += features[i] * value;
            for (let j = 0; j < parameterCount; j++) normal[i][j] += features[i] * features[j];
        }
    }
    return solveLinear(normal, rhs);
}

function residualSummary(rows, evaluator, valueIndex) {
    let sumSquared = 0;
    let maximum = 0;
    for (const row of rows) {
        const error = evaluator(row[0]) - row[valueIndex];
        sumSquared += error * error;
        maximum = Math.max(maximum, Math.abs(error));
    }
    return {
        rms: Math.sqrt(sumSquared / Math.max(1, rows.length)),
        max: maximum,
        points: rows.length,
    };
}

/**
 * Whether a model stays inside the values the table itself covers, sampled far
 * more finely than the table is.
 *
 * A residual taken at the tabulated points alone cannot see a resonance between
 * two of them: the fit is free to put a pole where nothing measures it, which is
 * how a transparent material came out with n above 12 halfway between two
 * samples. The width allowed outside the table's own range is the largest step
 * the table takes between neighbouring points, so curvature the data itself
 * shows is accepted while a pole is not.
 */
function staysWithinData(evaluate, rows, rangeNm, valueIndex) {
    const values = [...rows].sort((left, right) => left[0] - right[0]).map(row => row[valueIndex]);
    const step = Math.max(0, ...values.slice(1).map((value, index) => Math.abs(value - values[index])));
    const low = Math.min(...values) - step;
    const high = Math.max(...values) + step;
    const start = Math.min(...rangeNm);
    const end = Math.max(...rangeNm);
    const samples = Math.max(200, rows.length * 20);
    for (let index = 0; index <= samples; index++) {
        const value = evaluate(start + ((end - start) * index) / samples);
        if (!Number.isFinite(value) || value < low || value > high) return false;
    }
    return true;
}

/**
 * Narrowest oscillator the table can support, as an energy width.
 *
 * A resonance narrower than the spacing between neighbouring samples was
 * measured by nothing: it fits the points on either side of it while doing as it
 * likes in between. Damping is held at or above the median spacing, which is
 * small for a densely sampled metal and large for a dozen hand-entered rows.
 */
function minimumDampingEv(rows) {
    const energies = rows.map(row => HC_EV_UM / (row[0] / 1000)).sort((left, right) => left - right);
    const gaps = energies.slice(1).map((energy, index) => energy - energies[index]);
    if (gaps.length === 0) return 0;
    const sorted = gaps.sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)];
}

function validRows(rows, rangeNm) {
    const low = Math.min(...rangeNm);
    const high = Math.max(...rangeNm);
    return (rows || []).filter(row => row[0] >= low && row[0] <= high
        && Number.isFinite(row[0]) && Number.isFinite(row[1]) && Number.isFinite(row[2]));
}

function fitCauchy(rows, termCount) {
    const coefficients = linearLeastSquares(
        rows,
        row => Array.from({ length: termCount }, (_, order) => (row[0] / 1000) ** (-2 * order)),
        row => row[1],
        termCount,
    );
    if (!coefficients) throw new Error('Cauchy fit is singular for the selected data range.');
    return { kind: 'cauchy', coefficients };
}

function sellmeierValue(parameters, wavelengthMicrometers, terms, rangeSquared) {
    const wavelengthSquared = wavelengthMicrometers * wavelengthMicrometers;
    let nSquared = parameters[0];
    for (let term = 0; term < terms; term++) {
        const strength = parameters[1 + 2 * term];
        const pole = parameters[2 + 2 * term];
        if (rangeSquared && pole > rangeSquared[0] && pole < rangeSquared[1]) return NaN;
        nSquared += strength * wavelengthSquared / (wavelengthSquared - pole);
    }
    return nSquared > 0 ? Math.sqrt(nSquared) : NaN;
}

function initialSellmeier(rows, terms) {
    const wavelengths = rows.map(row => row[0] / 1000);
    const low = Math.min(...wavelengths);
    const high = Math.max(...wavelengths);
    const poles = [(0.7 * low) ** 2, (1.35 * high) ** 2, -((0.5 * (low + high)) ** 2)];
    while (poles.length < terms) poles.push(-(((poles.length + 1) * high) ** 2));
    const features = row => {
        const squared = (row[0] / 1000) ** 2;
        return [1, ...poles.slice(0, terms).map(pole => squared / (squared - pole))];
    };
    const linear = linearLeastSquares(rows, features, row => row[1] * row[1], terms + 1);
    const parameters = [linear?.[0] ?? 1];
    for (let term = 0; term < terms; term++) {
        parameters.push(linear?.[term + 1] ?? 0.1, poles[term]);
    }
    return parameters;
}

function sellmeierResiduals(parameters, rows, terms, rangeSquared) {
    return rows.map(row => {
        const predicted = sellmeierValue(parameters, row[0] / 1000, terms, rangeSquared);
        return Number.isFinite(predicted) ? predicted - row[1] : 1e6;
    });
}

function fitSellmeier(rows, termCount, rangeNm) {
    if (termCount === 1) return fitOneTermSellmeier(rows, rangeNm);
    const lowSquared = (Math.min(...rangeNm) / 1000) ** 2;
    const highSquared = (Math.max(...rangeNm) / 1000) ** 2;
    const rangeSquared = [lowSquared * (1 - 1e-9), highSquared * (1 + 1e-9)];
    const initial = initialSellmeier(rows, termCount);
    const coefficients = levenbergMarquardt(
        initial,
        parameters => sellmeierResiduals(parameters, rows, termCount, rangeSquared),
    );
    return { kind: 'sellmeier', coefficients, terms: termCount };
}

function oneTermAtPole(rows, pole) {
    const coefficients = linearLeastSquares(
        rows,
        row => {
            const squared = (row[0] / 1000) ** 2;
            return [1, squared / (squared - pole)];
        },
        row => row[1] * row[1],
        2,
    );
    if (!coefficients) return { cost: Infinity, coefficients: null };
    const cost = rows.reduce((sum, row) => {
        const predicted = sellmeierValue(
            [coefficients[0], coefficients[1], pole], row[0] / 1000, 1, null,
        );
        const error = predicted - row[1];
        return sum + error * error;
    }, 0);
    return { cost, coefficients: [coefficients[0], coefficients[1], pole] };
}

function goldenSectionMinimum(left, right, objective) {
    const ratio = (Math.sqrt(5) - 1) / 2;
    let c = right - ratio * (right - left);
    let d = left + ratio * (right - left);
    let fc = objective(c);
    let fd = objective(d);
    for (let iteration = 0; iteration < 100; iteration++) {
        if (fc < fd) {
            right = d;
            d = c;
            fd = fc;
            c = right - ratio * (right - left);
            fc = objective(c);
        } else {
            left = c;
            c = d;
            fc = fd;
            d = left + ratio * (right - left);
            fd = objective(d);
        }
    }
    return (left + right) / 2;
}

function fitOneTermSellmeier(rows, rangeNm) {
    const lowSquared = (Math.min(...rangeNm) / 1000) ** 2;
    const highSquared = (Math.max(...rangeNm) / 1000) ** 2;
    const candidates = [];
    const samples = 300;
    for (let index = 0; index <= samples; index++) {
        const fraction = index / samples;
        candidates.push(lowSquared * 0.999 * fraction ** 3);
        candidates.push(-highSquared * (10 ** (3 * fraction) - 1));
        candidates.push(highSquared * (1.001 + 10 ** (3 * fraction) - 1));
    }
    candidates.sort((left, right) => left - right);
    let bestIndex = 0;
    let best = oneTermAtPole(rows, candidates[0]);
    for (let index = 1; index < candidates.length; index++) {
        const current = oneTermAtPole(rows, candidates[index]);
        if (current.cost < best.cost) {
            best = current;
            bestIndex = index;
        }
    }
    const left = candidates[Math.max(0, bestIndex - 1)];
    const right = candidates[Math.min(candidates.length - 1, bestIndex + 1)];
    const pole = goldenSectionMinimum(left, right, value => oneTermAtPole(rows, value).cost);
    best = oneTermAtPole(rows, pole);
    return { kind: 'sellmeier', coefficients: best.coefficients, terms: 1 };
}

function fitUrbach(rows) {
    const positive = rows.filter(row => row[2] > 0);
    if (positive.length < 3) return { kind: 'zero', coefficients: [] };
    const logCoefficients = linearLeastSquares(
        positive,
        row => [1, 1 / (row[0] / 1000), row[0] / 1000],
        row => Math.log(Math.max(row[2], 1e-15)),
        3,
    );
    if (!logCoefficients) throw new Error('Urbach fit is singular for the selected data range.');
    return {
        kind: 'urbach',
        coefficients: [Math.exp(logCoefficients[0]), logCoefficients[1], logCoefficients[2]],
    };
}

function positiveParameter(value, maximum) {
    return Math.min(maximum, Math.exp(Math.max(-18, Math.min(18, value))));
}

/** The metal model as the log-parameter vector decodeMetalParameters reads. */
function encodeMetalParameters(model) {
    return [
        Math.log(model.epsilonInfinity),
        Math.log(model.plasmaEnergyEv),
        Math.log(model.drudeDampingEv),
        ...(model.oscillators || []).flatMap(oscillator => [
            Math.log(oscillator.strengthEv2),
            Math.log(oscillator.resonanceEv),
            Math.log(oscillator.dampingEv),
        ]),
    ];
}

function decodeMetalParameters(parameters, kind, oscillatorCount, minDampingEv = 0) {
    const model = {
        kind,
        epsilonInfinity: positiveParameter(parameters[0], 100),
        plasmaEnergyEv: positiveParameter(parameters[1], 50),
        drudeDampingEv: positiveParameter(parameters[2], 50),
        oscillators: [],
    };
    for (let index = 0; index < oscillatorCount; index++) {
        const offset = 3 + index * 3;
        model.oscillators.push({
            strengthEv2: positiveParameter(parameters[offset], 3000),
            resonanceEv: positiveParameter(parameters[offset + 1], 100),
            dampingEv: Math.max(minDampingEv, positiveParameter(parameters[offset + 2], 50)),
        });
    }
    return model;
}

function metalResiduals(parameters, rows, kind, oscillatorCount, minDampingEv) {
    const model = decodeMetalParameters(parameters, kind, oscillatorCount, minDampingEv);
    return rows.flatMap(row => {
        const predicted = evaluateComplexDispersionModel(model, row[0]);
        return predicted.every(Number.isFinite)
            ? [predicted[0] - row[1], predicted[1] - row[2]]
            : [1e6, 1e6];
    });
}

function multiplyComplex(left, right) {
    return [
        left[0] * right[0] - left[1] * right[1],
        left[0] * right[1] + left[1] * right[0],
    ];
}

/** d(decoded)/d(raw) of positiveParameter: the decoded value, or zero on a clamp. */
function positiveParameterSlope(value, maximum) {
    if (value <= -18 || value >= 18) return 0;
    const decoded = Math.exp(value);
    return decoded < maximum ? decoded : 0;
}

/**
 * n and k of the metal model at one energy, with ∂n/∂p and ∂k/∂p for every
 * log-parameter in the order decodeMetalParameters reads them.
 *
 * ε is a sum of terms that each hold one parameter set, so its derivatives are
 * closed form: ε∞ contributes itself, the Drude term −ωp²/(E² + iγE) and each
 * Lorentz term f/(ω0² − E² − iγE) differentiate term by term, and a logarithmic
 * parameter multiplies its term's derivative by its own value. The index then
 * follows from d√ε = dε/(2√ε). A parameter sitting on one of its clamps moves
 * nothing, as the clamp itself moves nothing, and a model that cannot be
 * evaluated has no derivative either, matching the residual it reports.
 */
function metalModelWithDerivatives(parameters, kind, oscillatorCount, minDampingEv, energyEv) {
    const model = decodeMetalParameters(parameters, kind, oscillatorCount, minDampingEv);
    const [n, k] = sqrtComplexPositive(dielectricAt(model, energyEv));
    const dn = Array(parameters.length).fill(0);
    const dk = Array(parameters.length).fill(0);
    if (!Number.isFinite(n) || !Number.isFinite(k) || n * n + k * k === 0) return { n, k, dn, dk };

    const energySquared = energyEv * energyEv;
    const twoRoot = [2 * n, 2 * k];
    const assign = (index, dEpsilon) => {
        const derivative = divideComplex(dEpsilon, twoRoot);
        dn[index] = derivative[0];
        dk[index] = derivative[1];
    };
    assign(0, [positiveParameterSlope(parameters[0], 100), 0]);
    const plasma = model.plasmaEnergyEv;
    const drudeDenominator = [energySquared, model.drudeDampingEv * energyEv];
    assign(1, divideComplex(
        [-2 * plasma * positiveParameterSlope(parameters[1], 50), 0], drudeDenominator));
    assign(2, divideComplex(
        [0, plasma * plasma * energyEv * positiveParameterSlope(parameters[2], 50)],
        multiplyComplex(drudeDenominator, drudeDenominator)));
    model.oscillators.forEach((oscillator, index) => {
        const offset = 3 + index * 3;
        const denominator = [oscillator.resonanceEv ** 2 - energySquared, -oscillator.dampingEv * energyEv];
        const squared = multiplyComplex(denominator, denominator);
        const dampingSlope = positiveParameter(parameters[offset + 2], 50) > minDampingEv
            ? positiveParameterSlope(parameters[offset + 2], 50)
            : 0;
        assign(offset, divideComplex([positiveParameterSlope(parameters[offset], 3000), 0], denominator));
        assign(offset + 1, divideComplex([
            -2 * oscillator.strengthEv2 * oscillator.resonanceEv
                * positiveParameterSlope(parameters[offset + 1], 100),
            0,
        ], squared));
        assign(offset + 2, divideComplex([0, oscillator.strengthEv2 * energyEv * dampingSlope], squared));
    });
    return { n, k, dn, dk };
}

/** The Jacobian of metalResiduals, two rows per tabulated point. */
function metalResidualJacobian(parameters, rows, kind, oscillatorCount, minDampingEv) {
    return rows.flatMap((row) => {
        const { dn, dk } = metalModelWithDerivatives(
            parameters, kind, oscillatorCount, minDampingEv, HC_EV_UM / (row[0] / 1000));
        return [dn, dk];
    });
}

function initialDrudeParameters(rows) {
    const row = rows.reduce((longest, current) => current[0] > longest[0] ? current : longest);
    const energy = HC_EV_UM / (row[0] / 1000);
    const epsilonReal = row[1] ** 2 - row[2] ** 2;
    const epsilonImaginary = 2 * row[1] * row[2];
    const epsilonInfinity = 1;
    const delta = Math.max(1e-3, epsilonInfinity - epsilonReal);
    const damping = Math.max(1e-3, Math.abs(energy * epsilonImaginary / delta));
    const plasma = Math.sqrt(Math.max(1e-6, delta * (energy ** 2 + damping ** 2)));
    return [Math.log(epsilonInfinity), Math.log(plasma), Math.log(damping)];
}

/**
 * The Drude term alone, then one more Lorentz oscillator at a time up to the
 * ceiling, each model seeded from the one before it.
 *
 * Every count is tried from five resonances spread across the table's energy
 * span and the best of them is kept, both as that count's model and as the
 * start for the next. Nothing here decides how many oscillators the table
 * supports: the caller judges each model on whichever residual it can see, and
 * stops reading when it has what it needs, so a chain cut short costs nothing.
 *
 * A chain already fitted to nearly the same rows can hand its models over as
 * `warmStart`, one per count. Each count then starts from that count's model
 * instead of from five fresh resonances, and reaches its answer in a fraction
 * of the work when the rows have barely moved. The floor under every count is
 * still the count below it with a silent oscillator added, so a warm start
 * that lands nowhere useful is dropped rather than carried.
 */
function* metalLadder(rows, kind, warmStart = []) {
    const minDamping = minimumDampingEv(rows);
    const fitAt = (start, count, iterations) => levenbergMarquardt(
        start,
        values => metalResiduals(values, rows, kind, count, minDamping),
        iterations,
        values => metalResidualJacobian(values, rows, kind, count, minDamping),
    );
    const costOf = (values, count) => sumSquares(metalResiduals(values, rows, kind, count, minDamping));
    const warmParameters = (count) => {
        const model = warmStart[count];
        return model && (model.oscillators || []).length === count ? encodeMetalParameters(model) : null;
    };

    let parameters = levenbergMarquardt(
        warmParameters(0) || initialDrudeParameters(rows),
        values => metalResiduals(values, rows, 'drude', 0, minDamping),
        160,
        values => metalResidualJacobian(values, rows, 'drude', 0, minDamping),
    );
    yield { model: decodeMetalParameters(parameters, kind, 0, minDamping), cost: costOf(parameters, 0) };
    if (kind === 'drude') return;

    const energies = rows.map(row => HC_EV_UM / (row[0] / 1000));
    const lowEnergy = Math.min(...energies);
    const highEnergy = Math.max(...energies);
    const energySpan = highEnergy - lowEnergy;
    const peakEpsilonImaginary = Math.max(...rows.map(row => 2 * row[1] * row[2]), 0.1);

    for (let count = 1; count <= MAX_OSCILLATORS; count++) {
        const damping = Math.max(minDamping, energySpan / (2 * count + 2));
        let best = [
            ...parameters,
            Math.log(1e-8), Math.log((lowEnergy + highEnergy) / 2), Math.log(damping),
        ];
        let bestCost = costOf(best, count);
        const warm = warmParameters(count);
        const starts = warm ? [warm] : [1, 2, 3, 4, 5].map((index) => {
            const resonance = lowEnergy + (index / 6) * energySpan;
            const strength = Math.max(
                1e-3,
                peakEpsilonImaginary * damping * resonance / (4 * count),
            );
            return [...parameters, Math.log(strength), Math.log(resonance), Math.log(damping)];
        });
        for (const start of starts) {
            const candidate = fitAt(start, count, 180);
            const candidateCost = costOf(candidate, count);
            if (candidateCost < bestCost) {
                best = candidate;
                bestCost = candidateCost;
            }
        }
        parameters = best;
        yield { model: decodeMetalParameters(best, kind, count, minDamping), cost: bestCost };
    }
}

/**
 * Fit the Drude term, then add Lorentz oscillators one at a time for as long as
 * each earns its place: it has to cut the residual by TERM_GAIN and leave a model
 * that still behaves between the tabulated points. The count is not asked for,
 * because the number of oscillators a table supports is a property of the table.
 */
function fitMetal(rows, kind, rangeNm) {
    let accepted = null;
    let acceptedCost = Infinity;
    for (const { model, cost } of metalLadder(rows, kind)) {
        // Cost is a sum of squares, so a TERM_GAIN cut in RMS is its square here.
        if (accepted && cost > acceptedCost * (1 - TERM_GAIN) ** 2) break;
        // An underfit intermediate model can overshoot the table's range.
        // Keep it only as the seed for the next oscillator, never as an
        // accepted result. Stopping here strands gold at a Drude-only fit:
        // its first Lorentz term overshoots, while later terms resolve it.
        if (accepted && !staysWithinData(nm => evaluateComplexDispersionModel(model, nm)[0], rows, rangeNm, 1)) continue;
        accepted = model;
        acceptedCost = cost;
    }
    return accepted;
}

export function evaluateFitComponent(component, wavelengthNm) {
    const wavelength = wavelengthNm / 1000;
    if (component.kind === 'zero') return 0;
    if (component.kind === 'urbach') {
        const [amplitude, inverseTerm, linearTerm] = component.coefficients;
        return amplitude * Math.exp(inverseTerm / wavelength + linearTerm * wavelength);
    }
    if (component.kind === 'cauchy') {
        return component.coefficients.reduce(
            (sum, coefficient, order) => sum + coefficient * wavelength ** (-2 * order), 0);
    }
    if (component.kind === 'sellmeier') {
        return sellmeierValue(
            component.coefficients,
            wavelength,
            component.terms,
            null,
        );
    }
    return NaN;
}

export function evaluateFitComponentJet(component, wavelengthMicrometersJet) {
    if (component.kind === 'zero') return jetConstant(0);
    if (component.kind === 'urbach') {
        const [amplitude, inverseTerm, linearTerm] = component.coefficients;
        return jetScale(jetExp(jetAdd(
            jetScale(jetDivide(jetConstant(1), wavelengthMicrometersJet), inverseTerm),
            jetScale(wavelengthMicrometersJet, linearTerm),
        )), amplitude);
    }
    if (component.kind === 'cauchy') {
        return component.coefficients.reduce((sum, coefficient, order) => jetAdd(
            sum,
            jetScale(jetPower(wavelengthMicrometersJet, -2 * order), coefficient),
        ), jetConstant(0));
    }
    if (component.kind === 'sellmeier') {
        const squared = jetMultiply(wavelengthMicrometersJet, wavelengthMicrometersJet);
        let nSquared = jetConstant(component.coefficients[0]);
        for (let term = 0; term < component.terms; term++) {
            const strength = component.coefficients[1 + 2 * term];
            const pole = component.coefficients[2 + 2 * term];
            nSquared = jetAdd(nSquared, jetDivide(
                jetScale(squared, strength),
                jetSubtract(squared, jetConstant(pole)),
            ));
        }
        return jetSqrt(nSquared);
    }
    return null;
}

export function evaluateDispersionFit(fit, wavelengthNm) {
    if (fit.complex) return evaluateComplexDispersionModel(fit.complex, wavelengthNm);
    return [
        evaluateFitComponent(fit.n, wavelengthNm),
        Math.max(0, evaluateFitComponent(fit.k, wavelengthNm)),
    ];
}

export function evaluateDispersionFitJets(fit, wavelengthMicrometersJet) {
    if (fit.complex) {
        return evaluateComplexDispersionModelJets(fit.complex, wavelengthMicrometersJet);
    }
    return {
        nJet: evaluateFitComponentJet(fit.n, wavelengthMicrometersJet),
        kJet: evaluateFitComponentJet(fit.k, wavelengthMicrometersJet),
    };
}

/** The term counts a model is fitted at when nothing asks for a particular one. */
export function indexModelTermRange(model) {
    return model === 'sellmeier' ? [1, 3] : [2, 6];
}

/**
 * The transparent-model fit with the terms the data supports: keep adding terms
 * while each cuts the residual by TERM_GAIN and leaves a curve that behaves
 * between the tabulated points. The first candidate is always returned, so a
 * table that suits no model still produces a fit with visible residuals rather
 * than an error.
 *
 * `forcedTerms` fits at one count and stops. Characterization uses it because
 * there the residual worth judging a term by is the one against the measured
 * spectrum, which this function cannot see.
 */
function fitIndexModel(rows, model, rangeNm, forcedTerms) {
    const [defaultFirst, defaultLast] = indexModelTermRange(model);
    const first = forcedTerms || defaultFirst;
    const last = forcedTerms || defaultLast;
    const parametersFor = terms => (model === 'sellmeier' ? 1 + 2 * terms : terms);
    let accepted = null;
    let acceptedRms = Infinity;
    for (let terms = first; terms <= last; terms++) {
        if (accepted && parametersFor(terms) >= rows.length) break;
        const candidate = model === 'sellmeier'
            ? fitSellmeier(rows, terms, rangeNm)
            : fitCauchy(rows, terms);
        const evaluate = wavelength => evaluateFitComponent(candidate, wavelength);
        const { rms } = residualSummary(rows, evaluate, 1);
        if (accepted && (!(rms < acceptedRms * (1 - TERM_GAIN))
            || !staysWithinData(evaluate, rows, rangeNm, 1))) break;
        accepted = candidate;
        acceptedRms = rms;
    }
    return accepted;
}

/** The rows inside the fitted range, or an error naming why they cannot be fitted. */
function rowsToFit(rows, options) {
    const wavelengths = rows.map(row => row[0]).filter(Number.isFinite);
    if (wavelengths.length < 4) throw new Error('At least four tabulated rows are required for a fit.');
    const rangeNm = options.rangeNm || [Math.min(...wavelengths), Math.max(...wavelengths)];
    const selected = validRows(rows, rangeNm);
    if (selected.length < 4) throw new Error('The selected fit range contains fewer than four rows.');
    return { selected, rangeNm };
}

function metalFit(selected, rangeNm, complex) {
    const fit = {
        active: true,
        rangeNm: [Math.min(...rangeNm), Math.max(...rangeNm)],
        complex,
        source: 'tabulated n/k',
        residuals: {},
    };
    fit.residuals.n = residualSummary(
        selected,
        wavelength => evaluateComplexDispersionModel(complex, wavelength)[0],
        1,
    );
    fit.residuals.k = residualSummary(
        selected,
        wavelength => evaluateComplexDispersionModel(complex, wavelength)[1],
        2,
    );
    return fit;
}

export function fitTabulatedMaterial(rows, options = {}) {
    const { selected, rangeNm } = rowsToFit(rows, options);
    const model = options.nModel || 'cauchy';
    if (model === 'drude' || model === 'drude-lorentz') {
        return metalFit(selected, rangeNm, fitMetal(selected, model, rangeNm));
    }
    const n = fitIndexModel(selected, model, rangeNm, options.nTerms);
    const k = fitUrbach(selected);
    const fit = {
        active: true,
        rangeNm: [Math.min(...rangeNm), Math.max(...rangeNm)],
        n,
        k,
        source: 'tabulated n/k',
        residuals: {},
    };
    fit.residuals.n = residualSummary(selected, wavelength => evaluateFitComponent(n, wavelength), 1);
    fit.residuals.k = residualSummary(selected, wavelength => evaluateFitComponent(k, wavelength), 2);
    return fit;
}

/**
 * The metal fits at every oscillator count, Drude first, for a caller that can
 * judge them on a better residual than the table's own.
 *
 * `fitTabulatedMaterial` keeps a count only while it pays on the tabulated rows
 * and stays inside them, which is the right test when the rows are all there
 * is. Film characterization fits the rows only as a starting point and then
 * refines each model against the measured spectrum, and the table's tests
 * applied there reject the wrong models: a count that overshoots the rows by a
 * step and is then refined can still be the right one, and the overshoot
 * allowance shrinks as the rows are sampled more finely, so the same film could
 * come back with Lorentz terms on one grid and with none on another.
 *
 * Every fit here is complete, with the residuals it leaves on the rows.
 * `options.warmStart`, a ladder fitted to nearly the same rows, makes each
 * count start from the corresponding fit in it; see metalLadder.
 */
export function fitMetalLadder(rows, options = {}) {
    const { selected, rangeNm } = rowsToFit(rows, options);
    const kind = options.nModel === 'drude' ? 'drude' : 'drude-lorentz';
    const warmStart = (options.warmStart || []).map(fit => fit.complex);
    return [...metalLadder(selected, kind, warmStart)].map(({ model }) => metalFit(selected, rangeNm, model));
}

/**
 * The fitted parameters, labelled, with the formula they belong to.
 *
 * A fit is stored as coefficients, so those coefficients are what the material
 * is computed from and what a user has to be able to read. Wavelength is in
 * micrometres throughout; the metal model is written in electronvolts.
 *
 * @returns {{ formula: string, parameters: Array<{ label: string, value: number }> }}
 */
export function dispersionFitParameters(fit) {
    if (!fit) return { formula: '', parameters: [] };
    if (fit.complex) {
        const model = fit.complex;
        const parameters = [
            { label: 'ε∞', value: model.epsilonInfinity },
            { label: 'ωp (eV)', value: model.plasmaEnergyEv },
            { label: 'γD (eV)', value: model.drudeDampingEv },
        ];
        model.oscillators.forEach((oscillator, index) => {
            parameters.push(
                { label: `f${index + 1} (eV²)`, value: oscillator.strengthEv2 },
                { label: `ω${index + 1} (eV)`, value: oscillator.resonanceEv },
                { label: `γ${index + 1} (eV)`, value: oscillator.dampingEv },
            );
        });
        return {
            formula: 'ε(E) = ε∞ − ωp² / (E² + iγD E) + Σ fj / (ωj² − E² − iγj E),  n + ik = √ε',
            parameters,
        };
    }
    const parameters = [];
    if (fit.n.kind === 'cauchy') {
        fit.n.coefficients.forEach((value, order) => {
            parameters.push({ label: order === 0 ? 'A0' : `A${order} (µm^${2 * order})`, value });
        });
    } else if (fit.n.kind === 'sellmeier') {
        parameters.push({ label: 'A', value: fit.n.coefficients[0] });
        for (let term = 0; term < fit.n.terms; term++) {
            parameters.push(
                { label: `B${term + 1}`, value: fit.n.coefficients[1 + 2 * term] },
                { label: `C${term + 1} (µm²)`, value: fit.n.coefficients[2 + 2 * term] },
            );
        }
    }
    if (fit.k.kind === 'urbach') {
        const [amplitude, inverseTerm, linearTerm] = fit.k.coefficients;
        parameters.push(
            { label: 'k0', value: amplitude },
            { label: 'kb (µm)', value: inverseTerm },
            { label: 'kc (1/µm)', value: linearTerm },
        );
    }
    const nFormula = fit.n.kind === 'cauchy'
        ? 'n(λ) = A0 + A1/λ² + A2/λ⁴ + …'
        : 'n²(λ) = A + Σ Bj λ² / (λ² − Cj)';
    const kFormula = fit.k.kind === 'urbach' ? ',  k(λ) = k0 exp(kb/λ + kc λ)' : ',  k = 0';
    return { formula: `${nFormula}${kFormula},  λ in µm`, parameters };
}

/**
 * A fit's coefficients as a flat parameter vector, and back again.
 *
 * Fitting a model to a table is linear enough to be done coefficient by
 * coefficient. Fitting one to a measured spectrum is not: the model has to move
 * as a whole while a transfer-matrix calculation stands between it and the
 * residual, so its coefficients have to be a vector an optimizer can step.
 *
 * Quantities that may not go negative travel as logarithms, the encoding the
 * metal fit already uses, so no step can produce a negative amplitude, damping
 * or resonance. Everything else travels as itself.
 *
 * The metal codec also carries `derivatives`: n and k at a wavelength together
 * with ∂n/∂p and ∂k/∂p for every parameter, in closed form. An optimizer that
 * knows how its residual depends on n and k can build its whole Jacobian from
 * them instead of moving eighteen parameters one at a time.
 *
 * @param {object} fit  a fit from fitTabulatedMaterial
 * @returns {{ encode:()=>number[], decode:(values:number[])=>object, labels:string[],
 *             derivatives?:(values:number[], wavelengthNm:number)=>{n:number,k:number,dn:number[],dk:number[]} }}
 */
export function dispersionFitCodec(fit) {
    if (fit.complex) {
        const model = fit.complex;
        const oscillatorCount = (model.oscillators || []).length;
        const labels = ['ln ε∞', 'ln ωp', 'ln γD'];
        for (let index = 0; index < oscillatorCount; index++) {
            labels.push(`ln f${index + 1}`, `ln ω${index + 1}`, `ln γ${index + 1}`);
        }
        return {
            labels,
            encode: () => encodeMetalParameters(model),
            decode: values => ({
                ...fit,
                complex: decodeMetalParameters(values, model.kind, oscillatorCount),
            }),
            derivatives: (values, wavelengthNm) => metalModelWithDerivatives(
                values, model.kind, oscillatorCount, 0, HC_EV_UM / (wavelengthNm / 1000)),
        };
    }

    const indexCount = fit.n.coefficients.length;
    const hasExtinction = fit.k.kind === 'urbach';
    const labels = fit.n.coefficients.map((_, index) => `n${index}`);
    if (hasExtinction) labels.push('ln k0', 'kb', 'kc');
    return {
        labels,
        encode: () => [
            ...fit.n.coefficients,
            ...(hasExtinction
                ? [Math.log(Math.max(1e-300, fit.k.coefficients[0])),
                    fit.k.coefficients[1], fit.k.coefficients[2]]
                : []),
        ],
        decode: values => ({
            ...fit,
            n: { ...fit.n, coefficients: values.slice(0, indexCount) },
            k: hasExtinction
                ? {
                    ...fit.k,
                    coefficients: [
                        Math.exp(values[indexCount]),
                        values[indexCount + 1],
                        values[indexCount + 2],
                    ],
                }
                : fit.k,
        }),
    };
}

// The index a dielectric film can have, the same bracket the pointwise solve
// holds its Newton steps inside and the one the diagnostics call out of range.
const INDEX_CEILING = 8;

// Points the fitted index is sampled at to see whether it stayed finite. A
// resonance makes itself felt over a wide span, so this only has to catch that
// the curve has left the values a film can take, not locate the pole.
const POLE_SAMPLES = 12;

/**
 * Whether a Sellmeier fit has put a resonance inside the wavelengths it is
 * meant to describe, where the model returns an infinite index.
 *
 * The table fit forbids this while it searches. A fit being refined against a
 * spectrum has to be checked as it moves, because nothing else stops a pole
 * drifting into the range.
 *
 * The coefficient is not enough to decide it. A pole parked immediately outside
 * the range still sends the index at the nearest measured wavelength through
 * the roof, and lands on it exactly often enough to return a non-finite index
 * there: a resonance at 0.15999947 µm² against a range starting at 400 nm, or
 * 0.16 µm², is outside by five parts in ten million and still not usable. So
 * the curve is judged as well as the coefficient, and an index that is not
 * finite or has left what a film can have counts as a pole in range.
 */
export function dispersionFitHasPoleInRange(fit, rangeNm) {
    if (fit.complex || fit.n.kind !== 'sellmeier') return false;
    const low = Math.min(...rangeNm);
    const high = Math.max(...rangeNm);
    const lowSquared = (low / 1000) ** 2;
    const highSquared = (high / 1000) ** 2;
    for (let term = 0; term < fit.n.terms; term++) {
        const pole = fit.n.coefficients[2 + 2 * term];
        if (pole >= lowSquared && pole <= highSquared) return true;
    }
    for (let sample = 0; sample <= POLE_SAMPLES; sample++) {
        const [index] = evaluateDispersionFit(fit, low + ((high - low) * sample) / POLE_SAMPLES);
        if (!Number.isFinite(index) || index <= 0 || index > INDEX_CEILING) return true;
    }
    return false;
}

export function dispersionFitModelName(fit) {
    if (!fit) return 'Unavailable';
    if (fit.complex) {
        // A Drude-Lorentz fit that took no oscillators is a Drude fit, and
        // saying so is more use than "0 oscillators": it reports that the
        // measurement found no absorption band in range.
        const oscillators = fit.complex.oscillators.length;
        const name = fit.complex.kind === 'drude' || oscillators === 0
            ? 'Drude'
            : `Drude-Lorentz (${oscillators} oscillators)`;
        return `Fit: ${name}, ${fit.rangeNm[0]}-${fit.rangeNm[1]} nm`;
    }
    const nName = fit.n.kind === 'sellmeier'
        ? `${fit.n.terms}-term Sellmeier`
        : `${fit.n.coefficients.length}-term Cauchy`;
    const kName = fit.k.kind === 'zero' ? 'k = 0' : 'Urbach k';
    return `Fit: ${nName}; ${kName}, ${fit.rangeNm[0]}-${fit.rangeNm[1]} nm`;
}
