import { buildJcampDx } from '../../../../utils/io/jcampDx.js';
import { designSpectrumColumns } from '../../../../utils/io/designSpectrum.js';
import {
    curvesToCsv, measuredCurveData, measuredCurveSpacing, nmToX,
    sampleMeasuredCurve, tableToCsv, X_UNITS,
} from '../../../../utils/io/spectrumTable.js';
import { clampToCovered, designRangeCoverage } from '../../../../utils/materials/materialRange.js';
import {
    DEFAULT_CONSTRAINT_LAST_LAYER, isEllipsometricMeasuredCurve, makeConstraintOperand,
    makeMeasuredCurveOperand, resolveEvalMode,
} from '../../../../utils/physics/optimizer.js';
import { orphanFitBlocksIn, restoredFitCurvesIn } from '../fitTargetCurves.js';

export function delimiterName(delimiter, sx) {
    if (delimiter === ',') return sx.delimComma;
    if (delimiter === ';') return sx.delimSemicolon;
    if (delimiter === '\t') return sx.delimTab;
    return sx.delimWhitespace;
}

export function isJcampText(text) {
    return /##\s*(TITLE|JCAMP)/i.test(text);
}

export function defaultMeasuredFitOptions(curve) {
    const data = measuredCurveData(curve);
    const spacing = measuredCurveSpacing(curve) || 1;
    return {
        mode: 'measured',
        rangeMin: data.x[0] ?? 400,
        rangeMax: data.x[data.x.length - 1] ?? 800,
        thinEvery: 2,
        stepNm: spacing,
        weight: 1,
        outputMode: 'append',
        clipToCoverage: true,
        constraintsEnabled: false,
        minThicknessNm: 10,
        maxThicknessNm: 1000,
        constraintWeight: 1,
    };
}

/**
 * The fit range as the dialog shows and uses it: clamped to the span every
 * design material has optical data for while the clip is switched on, so the
 * range fields state the range the target will actually cover instead of the
 * one that was asked for.
 *
 * The stored range is left untouched, so switching the clip off puts the user's
 * own bounds straight back.
 */
export function clampedFitRange(design, config) {
    if (!design || !config || config.clipToCoverage === false) return config;
    const requested = [config.rangeMin, config.rangeMax];
    const { covered } = designRangeCoverage(design, requested);
    const clamped = clampToCovered(covered, requested);
    if (!clamped) return config;
    return { ...config, rangeMin: clamped[0], rangeMax: clamped[1] };
}

// Which side of the sample the merit function illuminates. A whole-sample
// evaluation is lit from the front, so only a back-only design expects a
// back-side measurement.
export function evaluatedMeasurementSide(design) {
    return resolveEvalMode(design) === 'back' ? 'back' : 'front';
}

/** Build an immutable measured-target snapshot, clipped to declared material coverage. */
export function measuredFitSnapshot(design, curve, options = {}) {
    if (!curve) return { operand: null, error: 'empty' };
    const evaluatedSide = evaluatedMeasurementSide(design);
    if ((curve.side || 'front') !== evaluatedSide) {
        return { operand: null, error: 'side', evaluatedSide };
    }
    const defaults = defaultMeasuredFitOptions(curve);
    const config = { ...defaults, ...options };
    const requestedRange = [config.rangeMin, config.rangeMax];
    const coverage = designRangeCoverage(design, requestedRange);
    // Residuals outside the materials' declared data would be scored against an
    // extrapolated n and k. Clipping them away is the default; the caller can
    // keep them, and the dialog says so when it does.
    const safeRange = config.clipToCoverage !== false && coverage.offenders.length
        ? coverage.covered
        : null;
    const sampled = sampleMeasuredCurve(curve, { ...config, safeRange });
    if (sampled.error || !sampled.lambdas.length) {
        return {
            operand: null, error: sampled.error || 'range', sampled, coverage, evaluatedSide,
        };
    }
    const operand = makeMeasuredCurveOperand({
        curveId: curve.id || null,
        curveName: curve.name || 'Measured curve',
        quantity: curve.quantity || 'R',
        aoi: curve.aoi ?? 0,
        pol: curve.pol || 'avg',
        side: curve.side || 'front',
        gridMode: config.mode,
        sourceSpacingNm: sampled.spacingNm,
        sampleLambdas: sampled.lambdas,
        sampleTargets: sampled.targets,
        weight: Number.isFinite(config.weight) && config.weight >= 0 ? config.weight : 1,
    });
    return { operand, sampled, coverage, evaluatedSide, error: null };
}

// The blocks this window owns: a Ψ/Δ block belongs to Measured Ellipsometry.
const photometric = operand => !isEllipsometricMeasuredCurve(operand);

/** Fit blocks whose spectrum is not on this design; see fitTargetCurves.js. */
export function orphanFitBlocks(design) {
    return orphanFitBlocksIn(design, 'measuredCurves', photometric);
}

/** The spectra for every orphaned block, with the blocks pointed at them. */
export function restoredFitCurves(design) {
    return restoredFitCurvesIn(design, 'measuredCurves', photometric);
}

/**
 * Are the dialog's thickness-constraint fields unusable as written?
 *
 * False when the constraints are switched off: there is nothing to be wrong.
 */
export function measuredFitConstraintsInvalid(config) {
    if (!config.constraintsEnabled) return false;
    const { minThicknessNm: min, maxThicknessNm: max, constraintWeight: weight } = config;
    if (!Number.isFinite(min) || min <= 0) return true;
    if (!Number.isFinite(max) || max < min) return true;
    return !Number.isFinite(weight) || weight < 0;
}

/**
 * Apply dialog output policy and optional thickness constraints as one block.
 * `measured` is one snapshot operand, or the two halves of a Ψ/Δ pair.
 */
export function measuredFitMeritOperands(existing, measured, config = {}) {
    const generated = [].concat(measured || []).filter(Boolean);
    if (!generated.length) return Array.isArray(existing) ? existing : [];
    if (config.constraintsEnabled) {
        const constraintBase = {
            lambdaStart: 1,
            lambdaEnd: DEFAULT_CONSTRAINT_LAST_LAYER,
            weight: config.constraintWeight,
        };
        generated.push(
            makeConstraintOperand({
                ...constraintBase, type: 'MNT', target: config.minThicknessNm,
            }),
            makeConstraintOperand({
                ...constraintBase, type: 'MXT', target: config.maxThicknessNm,
            }),
        );
    }
    return config.outputMode === 'replace'
        ? generated
        : [...(existing || []), ...generated];
}

const POLARIZATION_LABEL = { avg: 'average', s: 's', p: 'p' };

/**
 * The conditions a spectrum was taken under, as header lines above the column
 * names. Without them a file exported from TFStudio comes back carrying
 * whatever conditions the import panel happened to be set to, and a spectrum
 * read at the wrong angle does not lie on the design it came from.
 *
 * The shape matches the calculated Psi/Delta export. A condition the columns do
 * not agree on is left out rather than guessed: one header line cannot describe
 * columns taken at different angles or polarizations.
 */
export function spectrumConditionLines({ name, aoi, pol, side }) {
    const conditions = [];
    if (Number.isFinite(aoi)) conditions.push(`AOI ${aoi} deg`);
    if (side) conditions.push(`${side} side`);
    const lines = [`# ${name || 'design'}`];
    if (conditions.length) lines.push(`# ${conditions.join(', ')}`);
    lines.push(`# Polarization: ${POLARIZATION_LABEL[pol] || 'per column'}`);
    return lines;
}

/** The one value every curve shares, or null when they differ. */
function sharedValue(values) {
    const [first] = values;
    return values.length && values.every(value => value === first) ? first : null;
}

export function measuredExportDocument(design, expFormat, options = {}) {
    const list = options.curves || design.measuredCurves || [];
    const xUnit = options.xUnit || X_UNITS.NM;
    const asPercent = options.asPercent !== false;
    const base = (design.name || 'spectrum').replace(/[^\w.-]+/g, '_');
    if (expFormat === 'jcamp') {
        const spectra = list.map((curve) => {
            const data = measuredCurveData(curve);
            return {
                title: curve.name,
                xUnit,
                quantity: curve.quantity,
                isAbsorbance: false,
                isPercent: asPercent,
                x: data.x.map(value => nmToX(value, xUnit)),
                y: data.y.map(value => asPercent ? value * 100 : value),
            };
        });
        return {
            text: buildJcampDx(spectra, { title: `${design.name || 'spectra'} (measured)` }),
            fileName: `${base}_measured.dx`,
        };
    }
    const headerLines = spectrumConditionLines({
        name: design.name,
        aoi: sharedValue(list.map(curve => curve.aoi ?? 0)),
        pol: sharedValue(list.map(curve => curve.pol || 'avg')),
        side: sharedValue(list.map(curve => curve.side || 'front')),
    });
    return {
        text: curvesToCsv(list, { xUnit, asPercent, headerLines }),
        fileName: `${base}_measured.csv`,
    };
}

export function designExportSelection(dAoi, dQ) {
    const thetas = String(dAoi).split(',').map((value) => parseFloat(value.trim())).filter(Number.isFinite);
    return {
        thetas: thetas.length ? thetas : [0],
        quantities: ['T', 'R', 'A'].filter((quantity) => dQ[quantity]),
    };
}

export function designExportBaseName(design) {
    return (design.name || 'design').replace(/[^\w.-]+/g, '_');
}

function jcampDesignSpectra(spec, design, quantities, includeSP) {
    const pols = includeSP ? ['avg', 's', 'p'] : ['avg'];
    const polKey = {
        avg: { T: 'T', R: 'R', A: 'A' },
        s: { T: 'Ts', R: 'Rs' },
        p: { T: 'Tp', R: 'Rp' },
    };
    const multi = spec.series.length > 1;
    const spectra = [];
    spec.series.forEach((series) => {
        const suffix = multi ? ` @${Number.isInteger(series.theta) ? series.theta : series.theta.toFixed(1)}°` : '';
        pols.forEach((pol) => quantities.forEach((quantity) => {
            const key = polKey[pol]?.[quantity];
            if (!key || !series[key]) return;
            const polLabel = pol === 'avg' ? '' : ` ${pol}`;
            spectra.push({
                title: `${design.name || 'design'} ${quantity}${polLabel}${suffix}`,
                xUnit: X_UNITS.NM,
                quantity,
                isAbsorbance: false,
                x: spec.lambda,
                y: series[key],
            });
        }));
    });
    return spectra;
}

export function designExportDocument({ spec, design, quantities, includeSP, expFormat, base }) {
    if (expFormat === 'jcamp') {
        const spectra = jcampDesignSpectra(spec, design, quantities, includeSP);
        return {
            text: buildJcampDx(spectra, { title: `${design.name || 'design'} spectrum` }),
            fileName: `${base}_spectrum.dx`,
        };
    }
    const columns = designSpectrumColumns(spec, {
        quantities,
        pols: includeSP ? ['avg', 's', 'p'] : ['avg'],
    });
    // A multi-angle export names each column for its own angle, so the file has
    // no single angle to declare.
    const headerLines = spectrumConditionLines({
        name: design.name,
        aoi: spec.series.length === 1 ? spec.series[0].theta : null,
        pol: includeSP ? null : 'avg',
        side: evaluatedMeasurementSide(design),
    });
    return { text: tableToCsv(columns, { headerLines }), fileName: `${base}_spectrum.csv` };
}
