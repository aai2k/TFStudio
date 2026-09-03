/**
 * The headline numbers of a coating library entry, chosen by family.
 *
 * An antireflection coating is judged by its average and maximum R, a mirror
 * by its minimum R and its loss, a band-pass by its peak, centre and width, a
 * polarizer by Ts, Tp and their ratio. `PROPERTY_SETS` says which for each
 * family; `entryMetrics` computes them at the entry's own angle through the
 * same operands and qualifiers the merit function and the Specification
 * window use, so a number shown in the library is the number the optimizer
 * would see.
 */
import { designMaterialLookup } from '../materials/designMaterials.js';
import { evaluateSpectrum } from '../physics/thinFilmMath.js';
import { buildEvalContext, evaluateOperands, makeOperand } from '../physics/optimizer.js';
import { evaluateQualifier, makeQualifier } from '../synthesis/qualifiers.js';
import { entryDesign, totalThickness } from './entryModel.js';

/**
 * What an engineer reads off each family, as [channel, statistic] pairs.
 * Band statistics (avg, min, max) are reported per design band. The rest
 * describe the whole coating: `center` and `fwhm` of the peak inside the band
 * where the channel peaks, with the half-maximum points found outside it;
 * `notch-center` and `notch-width` of the dip, from the wavelengths where T
 * crosses 50%; `edge` where T crosses half its peak over the whole band
 * envelope; `extinction` the ratio of p to s transmittance. Centres and
 * widths are read off a fine grid around the feature, so they can differ
 * from a claim's own scan in the last digit.
 */
export const PROPERTY_SETS = {
    ar: [['R', 'avg'], ['R', 'max'], ['T', 'avg']],
    mirror: [['R', 'min'], ['R', 'avg'], ['A', 'avg']],
    edge: [['T', 'avg'], ['T', 'min'], ['T', 'max'], ['T', 'edge']],
    bandpass: [['T', 'max'], ['T', 'avg'], ['T', 'center'], ['T', 'fwhm']],
    notch: [['T', 'min'], ['T', 'avg'], ['T', 'notch-center'], ['T', 'notch-width']],
    beamsplitter: [['R', 'avg'], ['T', 'avg'], ['A', 'avg']],
    polarizer: [['T', 'avg'], ['R', 'avg'], ['T', 'extinction']],
    dichroic: [['R', 'avg'], ['R', 'min'], ['T', 'avg'], ['T', 'min'], ['T', 'edge']],
    lowE: [['T', 'avg'], ['R', 'avg'], ['A', 'avg']],
    chirped: [['R', 'min'], ['R', 'avg']],
    nd: [['T', 'avg'], ['R', 'avg'], ['A', 'avg']],
    other: [['T', 'avg'], ['R', 'avg'], ['A', 'avg']],
};

const BAND_STATS = { avg: 'AV', min: 'MN', max: 'MX' };
const NOTCH_LEVEL = 0.5;

function propertySet(entry) {
    return PROPERTY_SETS[entry.type] || PROPERTY_SETS.other;
}

// At an angle a coating is specified by s and p, so each band statistic of R
// or T is reported for s, p and their average; absorptance stays averaged.
function polarizationsFor(entry, channel) {
    if (entry.aoi > 0 && channel !== 'A') return ['s', 'p', 'avg'];
    return [entry.polarization];
}

function bandStatRows(entry, ctx) {
    const rows = [];
    const operands = [];
    for (const [channel, stat] of propertySet(entry)) {
        if (!BAND_STATS[stat]) continue;
        for (const pol of polarizationsFor(entry, channel)) {
            rows.push({ channel, pol, stat, unit: '%', values: [] });
            for (const [lambdaStart, lambdaEnd] of entry.bands) {
                operands.push(makeOperand({
                    type: channel + BAND_STATS[stat], lambdaStart, lambdaEnd, aoi: entry.aoi, pol, target: 0, weight: 1,
                }));
            }
        }
    }
    const values = evaluateOperands(operands, ctx);
    rows.forEach((row, r) => { row.values = entry.bands.map((_, b) => values[r * entry.bands.length + b]); });
    return rows;
}

// The band where a channel peaks (or dips), judged by the band extremes
// already computed, so a centre or width is measured where the feature is.
function featureBand(entry, rows, channel, dip) {
    const pol = entry.aoi > 0 ? 'avg' : entry.polarization;
    const row = rows.find(r => r.channel === channel && r.stat === (dip ? 'min' : 'max') && r.pol === pol);
    if (!row) return entry.bands[0];
    let best = 0;
    row.values.forEach((value, i) => {
        if (dip ? value < row.values[best] : value > row.values[best]) best = i;
    });
    return entry.bands[best];
}

// Scan density for the centre, width and edge searches: fine enough to place
// a crossing to a fraction of a nanometre on a sub-nanometre DWDM passband.
const SCAN_POINTS = 801;

function qualifierValue(entry, design, resolve, overrides) {
    const qualifier = makeQualifier({
        aoi: entry.aoi, pol: entry.polarization, level: 0.5, bandPoints: SCAN_POINTS, ...overrides,
    });
    const value = evaluateQualifier(qualifier, design, resolve).value;
    return Number.isFinite(value) ? value : null;
}

// A stated band widened by three times its own width on each side. The band an
// entry states is the passband or the rejection band itself; the half-maximum
// or 50% crossings that give a centre and a width lie outside it.
function widened(band) {
    const width = band[1] - band[0];
    return [Math.max(1, band[0] - 3 * width), band[1] + 3 * width];
}

// Wavelength where T crosses `level`, walking outward from sample `start` in
// direction `step`: rising through it away from a dip, falling through it
// away from a peak. `scan` is the sampled `{ lambda, T }`.
function crossingFrom(scan, start, step, level, rising) {
    const { lambda, T } = scan;
    for (let i = start; i + step >= 0 && i + step < T.length; i += step) {
        const a = T[i];
        const b = T[i + step];
        const crossed = rising ? (a < level && b >= level) : (a >= level && b < level);
        if (crossed) return lambda[i] + (lambda[i + step] - lambda[i]) * (level - a) / (b - a);
    }
    return null;
}

// Centre and width of a passband or a notch. The extreme is located inside
// the stated band, which is the passband or the rejection band itself, and
// the crossings are found walking outward from it over the widened window: a
// peak's half-maximum points, a dip's 50% points. A peak's centre is where it
// peaks; a notch's centre is halfway between its crossings, since its floor
// is flat.
function featureCrossings({ entry, design, resolve }, band, dip) {
    const [lambdaStart, lambdaEnd] = widened(band);
    const params = {
        lambdaStart, lambdaEnd, lambdaStep: (lambdaEnd - lambdaStart) / (SCAN_POINTS - 1),
        theta: entry.aoi, polarization: entry.polarization,
    };
    const scan = evaluateSpectrum(params, resolve(design.incidentMedium), resolve(design.substrate.material),
        design.frontLayers.map(layer => ({ material: resolve(layer.material), thickness: layer.thickness })));
    const { lambda, T } = scan;
    let at = -1;
    lambda.forEach((lam, i) => {
        if (lam < band[0] || lam > band[1]) return;
        if (at < 0 || (dip ? T[i] < T[at] : T[i] > T[at])) at = i;
    });
    if (at < 0) return { center: null, width: null };
    const level = dip ? NOTCH_LEVEL : T[at] / 2;
    const left = crossingFrom(scan, at, -1, level, dip);
    const right = crossingFrom(scan, at, 1, level, dip);
    if (left == null || right == null) return { center: dip ? null : lambda[at], width: null };
    return { center: dip ? (left + right) / 2 : lambda[at], width: right - left };
}

function extinctionRow(bandRows) {
    const p = bandRows.find(r => r.channel === 'T' && r.stat === 'avg' && r.pol === 'p');
    const s = bandRows.find(r => r.channel === 'T' && r.stat === 'avg' && r.pol === 's');
    const value = p && s && s.values[0] > 0 ? p.values[0] / s.values[0] : null;
    return { channel: 'T', pol: 'avg', stat: 'extinction', unit: 'ratio', value };
}

// One whole-coating figure. `scope` carries the entry, its evaluation design,
// the material resolver and the band rows already computed.
function shapeRow(scope, channel, stat) {
    const { entry, design, resolve, bandRows } = scope;
    const pol = entry.polarization;
    if (stat === 'extinction') return extinctionRow(bandRows);
    if (stat === 'edge') {
        // An edge lies between the stated bands, so it is searched over the
        // whole envelope with the edge qualifier the claims use.
        const [lambdaStart, lambdaEnd] = entry.band;
        const value = qualifierValue(entry, design, resolve, {
            kind: 'EDGE_LAMBDA', channel, direction: 'max', lambdaStart, lambdaEnd, pol,
        });
        return { channel, pol, stat, unit: 'nm', value };
    }
    const dip = stat.startsWith('notch');
    const feature = featureCrossings(scope, featureBand(entry, bandRows, channel, dip), dip);
    const value = stat === 'center' || stat === 'notch-center' ? feature.center : feature.width;
    return { channel, pol, stat, unit: 'nm', value };
}

/**
 * The family's properties for an entry: `rows` hold one value per design
 * band (fractions), `shape` one value for the whole coating (nm, or a ratio),
 * plus layer count and total thickness (nm). Returns `{ error }` when a
 * material cannot be resolved.
 */
export function entryMetrics(entry) {
    const design = entryDesign(entry);
    try {
        const resolve = designMaterialLookup(design);
        const rows = bandStatRows(entry, buildEvalContext(design, resolve));
        const scope = { entry, design, resolve, bandRows: rows };
        const shape = propertySet(entry)
            .filter(([, stat]) => !BAND_STATS[stat])
            .map(([channel, stat]) => shapeRow(scope, channel, stat));
        return { layerCount: entry.layers.length, totalThickness: totalThickness(entry), bands: entry.bands, rows, shape };
    } catch (err) {
        return { error: err.message };
    }
}
