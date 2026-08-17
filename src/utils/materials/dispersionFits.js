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

const HC_EV_UM = 1.239841984;

// A term is kept only when it cuts the RMS residual by at least this much. Past
// that the extra freedom follows the rounding in the table rather than the
// material's dispersion, and the fit is chosen for the user rather than by them.
const TERM_GAIN = 0.1;

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

function solveLinear(matrix, vector) {
    const size = vector.length;
    const augmented = matrix.map((row, index) => [...row, vector[index]]);
    for (let column = 0; column < size; column++) {
        let pivot = column;
        for (let row = column + 1; row < size; row++) {
            if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
        }
        if (Math.abs(augmented[pivot][column]) < 1e-20) return null;
        [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
        const divisor = augmented[column][column];
        for (let item = column; item <= size; item++) augmented[column][item] /= divisor;
        for (let row = 0; row < size; row++) {
            if (row === column) continue;
            const factor = augmented[row][column];
            for (let item = column; item <= size; item++) {
                augmented[row][item] -= factor * augmented[column][item];
            }
        }
    }
    return augmented.map(row => row[size]);
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

function sumSquares(values) {
    return values.reduce((sum, value) => sum + value * value, 0);
}

function sellmeierResiduals(parameters, rows, terms, rangeSquared) {
    return rows.map(row => {
        const predicted = sellmeierValue(parameters, row[0] / 1000, terms, rangeSquared);
        return Number.isFinite(predicted) ? predicted - row[1] : 1e6;
    });
}

function levenbergMarquardt(initial, residualAt, iterations = 80) {
    let parameters = initial.slice();
    let residual = residualAt(parameters);
    let cost = sumSquares(residual);
    let damping = 1e-6;
    for (let iteration = 0; iteration < iterations; iteration++) {
        const jacobian = residual.map(() => Array(parameters.length).fill(0));
        for (let parameter = 0; parameter < parameters.length; parameter++) {
            const delta = 1e-6 * Math.max(1, Math.abs(parameters[parameter]));
            const shifted = parameters.slice();
            shifted[parameter] += delta;
            const next = residualAt(shifted);
            for (let row = 0; row < residual.length; row++) {
                jacobian[row][parameter] = (next[row] - residual[row]) / delta;
            }
        }
        const normal = Array.from({ length: parameters.length }, () => Array(parameters.length).fill(0));
        const rhs = Array(parameters.length).fill(0);
        for (let row = 0; row < residual.length; row++) {
            for (let i = 0; i < parameters.length; i++) {
                rhs[i] -= jacobian[row][i] * residual[row];
                for (let j = 0; j < parameters.length; j++) {
                    normal[i][j] += jacobian[row][i] * jacobian[row][j];
                }
            }
        }
        for (let index = 0; index < parameters.length; index++) {
            normal[index][index] += damping * Math.max(1e-12, normal[index][index]);
        }
        const step = solveLinear(normal, rhs);
        if (!step) break;
        const candidate = parameters.map((value, index) => value + step[index]);
        const candidateResidual = residualAt(candidate);
        const candidateCost = sumSquares(candidateResidual);
        if (candidateCost < cost) {
            parameters = candidate;
            residual = candidateResidual;
            if (Math.abs(cost - candidateCost) <= 1e-14 * Math.max(1, cost)) break;
            cost = candidateCost;
            damping = Math.max(1e-12, damping / 3);
        } else {
            damping = Math.min(1e12, damping * 10);
        }
    }
    return parameters;
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
 * Fit the Drude term, then add Lorentz oscillators one at a time for as long as
 * each earns its place: it has to cut the residual by TERM_GAIN and leave a model
 * that still behaves between the tabulated points. The count is not asked for,
 * because the number of oscillators a table supports is a property of the table.
 */
function fitMetal(rows, kind, rangeNm) {
    const minDamping = minimumDampingEv(rows);
    const fitAt = (start, count, iterations) => levenbergMarquardt(
        start,
        values => metalResiduals(values, rows, kind, count, minDamping),
        iterations,
    );
    const costOf = (values, count) => sumSquares(metalResiduals(values, rows, kind, count, minDamping));

    let parameters = levenbergMarquardt(
        initialDrudeParameters(rows),
        values => metalResiduals(values, rows, 'drude', 0, minDamping),
        160,
    );
    if (kind === 'drude') return decodeMetalParameters(parameters, kind, 0, minDamping);

    let accepted = decodeMetalParameters(parameters, kind, 0, minDamping);
    let acceptedCost = costOf(parameters, 0);

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
        for (let index = 1; index <= 5; index++) {
            const resonance = lowEnergy + (index / 6) * energySpan;
            const strength = Math.max(
                1e-3,
                peakEpsilonImaginary * damping * resonance / (4 * count),
            );
            const candidate = fitAt(
                [...parameters, Math.log(strength), Math.log(resonance), Math.log(damping)],
                count,
                180,
            );
            const candidateCost = costOf(candidate, count);
            if (candidateCost < bestCost) {
                best = candidate;
                bestCost = candidateCost;
            }
        }
        // Cost is a sum of squares, so a TERM_GAIN cut in RMS is its square here.
        if (bestCost > acceptedCost * (1 - TERM_GAIN) ** 2) break;
        const model = decodeMetalParameters(best, kind, count, minDamping);
        if (!staysWithinData(nm => evaluateComplexDispersionModel(model, nm)[0], rows, rangeNm, 1)) break;
        parameters = best;
        accepted = model;
        acceptedCost = bestCost;
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

/**
 * The transparent-model fit with the terms the data supports: keep adding terms
 * while each cuts the residual by TERM_GAIN and leaves a curve that behaves
 * between the tabulated points. The first candidate is always returned, so a
 * table that suits no model still produces a fit with visible residuals rather
 * than an error.
 */
function fitIndexModel(rows, model, rangeNm) {
    const first = model === 'sellmeier' ? 1 : 2;
    const last = model === 'sellmeier' ? 3 : 6;
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

export function fitTabulatedMaterial(rows, options = {}) {
    const wavelengths = rows.map(row => row[0]).filter(Number.isFinite);
    if (wavelengths.length < 4) throw new Error('At least four tabulated rows are required for a fit.');
    const rangeNm = options.rangeNm || [Math.min(...wavelengths), Math.max(...wavelengths)];
    const selected = validRows(rows, rangeNm);
    if (selected.length < 4) throw new Error('The selected fit range contains fewer than four rows.');
    const model = options.nModel || 'cauchy';
    if (model === 'drude' || model === 'drude-lorentz') {
        const complex = fitMetal(selected, model, rangeNm);
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
    const n = fitIndexModel(selected, model, rangeNm);
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

export function dispersionFitModelName(fit) {
    if (!fit) return 'Unavailable';
    if (fit.complex) {
        const name = fit.complex.kind === 'drude'
            ? 'Drude'
            : `Drude-Lorentz (${fit.complex.oscillators.length} oscillators)`;
        return `Fit: ${name}, ${fit.rangeNm[0]}-${fit.rangeNm[1]} nm`;
    }
    const nName = fit.n.kind === 'sellmeier'
        ? `${fit.n.terms}-term Sellmeier`
        : `${fit.n.coefficients.length}-term Cauchy`;
    const kName = fit.k.kind === 'zero' ? 'k = 0' : 'Urbach k';
    return `Fit: ${nName}; ${kName}, ${fit.rangeNm[0]}-${fit.rangeNm[1]} nm`;
}
