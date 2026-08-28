import { buildJcampDx } from '../../../../utils/io/jcampDx.js';
import { designSpectrumColumns } from '../../../../utils/io/designSpectrum.js';
import {
    curvesToCsv, makeMeasuredCurve, measuredCurveData, measuredCurveSpacing, nmToX,
    sampleMeasuredCurve, tableToCsv, X_UNITS,
} from '../../../../utils/io/spectrumTable.js';
import { designRangeCoverage } from '../../../../utils/materials/materialRange.js';
import {
    DEFAULT_CONSTRAINT_LAST_LAYER, isMeasuredCurve, makeConstraintOperand,
    makeMeasuredCurveOperand, resolveEvalMode,
} from '../../../../utils/physics/optimizer.js';

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
        constraintsEnabled: false,
        minThicknessNm: 10,
        maxThicknessNm: 1000,
        constraintWeight: 1,
    };
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
    const safeRange = coverage.offenders.length ? coverage.covered : null;
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

/**
 * Fit blocks whose curve is not on this design.
 *
 * A merit function saved as a preset carries its measured blocks but not the
 * curves they were generated from, so loading one into another design leaves
 * blocks that still score correctly, from their own snapshot, with nothing in
 * the curve list to look at. Deleting a curve and keeping its block does the
 * same. Each block holds everything a curve needs, so it can be given back.
 */
export function orphanFitBlocks(design) {
    const known = new Set((design?.measuredCurves || []).map(curve => curve.id));
    return (design?.meritOperands || []).filter(
        operand => isMeasuredCurve(operand.type)
            && operand.sampleLambdas?.length
            && !known.has(operand.curveId),
    );
}

/** The curve a fit block was generated from, rebuilt from its snapshot. */
export function curveFromFitBlock(block) {
    return makeMeasuredCurve({
        name: block.curveName || 'Measured curve',
        x: block.sampleLambdas,
        xUnit: X_UNITS.NM,
        y: block.sampleTargets,
        quantity: block.quantity || 'R',
        aoi: block.aoi ?? 0,
        pol: block.pol || 'avg',
        side: block.side || 'front',
        source: 'fit target',
    });
}

/**
 * Restore the curves for every orphaned block, and point each block at the
 * curve it now has, so restoring twice cannot make a second copy.
 */
export function restoredFitCurves(design) {
    const orphans = orphanFitBlocks(design);
    if (!orphans.length) return null;
    const curveByBlockId = new Map(orphans.map(block => [block.id, curveFromFitBlock(block)]));
    return {
        measuredCurves: [...(design.measuredCurves || []), ...curveByBlockId.values()],
        meritOperands: (design.meritOperands || []).map(operand => (
            curveByBlockId.has(operand.id)
                ? { ...operand, curveId: curveByBlockId.get(operand.id).id }
                : operand
        )),
    };
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

/** Apply dialog output policy and optional thickness constraints as one block. */
export function measuredFitMeritOperands(existing, measuredOperand, config = {}) {
    if (!measuredOperand) return Array.isArray(existing) ? existing : [];
    const generated = [measuredOperand];
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
    return {
        text: curvesToCsv(list, { xUnit, asPercent }),
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
    return { text: tableToCsv(columns), fileName: `${base}_spectrum.csv` };
}
