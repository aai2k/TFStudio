/**
 * Turning the window's settings into a characterization run, and its result
 * into a material.
 *
 * Everything here is pure. The physics lives in
 * utils/materials/characterization/.
 */

import { measuredCurveData } from '../../../../utils/io/spectrumTable.js';
import { ellipsometryCurves } from '../measuredEllipsometry/model.js';
import { resolveDesignMaterial } from '../../../../utils/materials/designMaterials.js';
import { characterizeFilm } from '../../../../utils/materials/characterization/nkFit.js';
import {
    portableSample, sampleFromPortable,
} from '../../../../utils/materials/characterization/portableSample.js';
import { evaluateDispersionFit } from '../../../../utils/materials/dispersionFits.js';
import { resolveEvalMode } from '../../../../utils/physics/optimizer/evalCore.js';

const ENOUGH_POINTS = 8;

/**
 * Curves a characterization can run against, for one kind of measurement.
 *
 * The two kinds live in separate lists on the design because they are imported
 * by separate windows from separate instruments. Photometry never sees a Ψ/Δ
 * pair and ellipsometry never sees a spectrum, so neither mode can be handed
 * the wrong measurement by mistake.
 */
export function characterizableCurves(design, measurementMode = 'photometry') {
    const list = measurementMode === 'ellipsometry'
        ? ellipsometryCurves(design)
        : (design?.measuredCurves || []);
    const wanted = measurementMode === 'ellipsometry' ? ['PSI', 'DEL'] : ['T', 'R'];
    return list
        .filter(curve => wanted.includes(curve.quantity))
        .filter(curve => (curve.x?.length || 0) >= ENOUGH_POINTS);
}

export function curveById(design, id, measurementMode = 'photometry') {
    return characterizableCurves(design, measurementMode).find(curve => curve.id === id) || null;
}

/**
 * The curves a fresh window should start with: one transmittance and one
 * reflectance if the design holds both, because that pair is the only
 * combination that solves n and k at a wavelength rather than assuming one.
 */
export function defaultCurveSelection(design) {
    const photometric = characterizableCurves(design, 'photometry');
    const angular = characterizableCurves(design, 'ellipsometry');
    return {
        transmittanceId: photometric.find(curve => curve.quantity === 'T')?.id || '',
        reflectanceId: photometric.find(curve => curve.quantity === 'R')?.id || '',
        psiId: angular.find(curve => curve.quantity === 'PSI')?.id || '',
        deltaId: angular.find(curve => curve.quantity === 'DEL')?.id || '',
    };
}

export function defaultMeasurementMode(design) {
    const defaults = defaultCurveSelection(design);
    return (defaults.transmittanceId || defaults.reflectanceId) ? 'photometry' : 'ellipsometry';
}

function channelOf(curve, settings) {
    const { x, y } = measuredCurveData(curve);
    return {
        quantity: curve.quantity,
        lambdas: x,
        values: y,
        aoi: curve.aoi ?? 0,
        pol: curve.pol ?? 'avg',
        side: curve.side ?? 'front',
        deltaConvention: settings.deltaConvention || curve.deltaConvention || 'azzam',
    };
}

/** The sample the film sits on, taken from the design unless overridden. */
export function defaultSampleGeometry(design) {
    return resolveEvalMode(design) === 'total' ? 'slab' : 'coating';
}

/**
 * The approximate film thickness the settings start at.
 *
 * A witness sample is often opened next to a design that already models it, so a
 * design carrying a single film is taken to be that film. With nothing to read,
 * the field falls back to the thickness a new layer gets in the Design Editor,
 * which is also the right order of magnitude for the only case that uses this
 * number: a spectrum with no fringes, which a film has only while it is thinner
 * than about a quarter wave.
 */
export const FALLBACK_THICKNESS_NM = 100;

export function defaultThicknessNm(design) {
    const layers = (design?.frontLayers || []).filter(layer => layer.thickness > 0);
    return layers.length === 1 ? Math.round(layers[0].thickness) : FALLBACK_THICKNESS_NM;
}

/**
 * The thickness a run uses: what the operator typed, or the default while the
 * field has never been set. An explicit zero is kept, so clearing the field
 * still reaches the errors that say the measurement determines no thickness.
 */
export function thicknessSettingNm(design, settings) {
    const entered = Number(settings.thicknessNm);
    return settings.thicknessNm !== '' && settings.thicknessNm != null && Number.isFinite(entered)
        ? entered
        : defaultThicknessNm(design);
}

export function sampleFor(design, settings) {
    const resolve = id => resolveDesignMaterial(design, id).material;
    const substrateId = settings.substrateId || design?.substrate?.material || 'BK7';
    return {
        incident: resolve(design?.incidentMedium || 'Air'),
        substrate: resolve(substrateId),
        exit: resolve(design?.exitMedium || 'Air'),
        substrateThicknessMm: Number(settings.substrateThicknessMm) > 0
            ? Number(settings.substrateThicknessMm)
            : (design?.substrate?.thickness ?? 1.0),
        // CSV spectra do not carry sample geometry. Follow the same design-wide
        // evaluation mode that produced an Optical Evaluation export; an
        // instrument measurement can override this to "slab" in Settings.
        geometry: settings.measurementMode === 'ellipsometry'
            ? 'coating'
            : (settings.geometry || defaultSampleGeometry(design)),
        substrateId,
    };
}

/**
 * The extraction the window's current settings ask for, as data.
 *
 * Built here rather than inside the run so the same request can be handed to a
 * worker: materials resolve on this thread, where the catalogs are, and cross
 * as sampled tables.
 *
 * @returns `{ request, measurementMode }`, or `{ error }` naming what stopped it.
 */
export function characterizationRequest(design, settings) {
    const measurementMode = settings.measurementMode || defaultMeasurementMode(design);
    const ids = measurementMode === 'ellipsometry'
        ? [settings.psiId, settings.deltaId]
        : [settings.transmittanceId, settings.reflectanceId];
    const chosen = ids.map(id => curveById(design, id, measurementMode)).filter(Boolean);
    if (chosen.length === 0) return { error: 'noCurves' };
    if (measurementMode === 'ellipsometry' && chosen.length < 2) {
        return { error: 'ellipsometryPair' };
    }

    const range = [Number(settings.lambdaStart), Number(settings.lambdaEnd)];
    const channels = chosen.map(curve => channelOf(curve, settings));
    return {
        measurementMode,
        request: {
            channels,
            sample: portableSample(sampleFor(design, { ...settings, measurementMode }), channels),
            indexModel: settings.indexModel,
            thicknessNm: thicknessSettingNm(design, settings),
            fixThickness: !!settings.fixThickness,
            rangeNm: range.every(Number.isFinite) && range[1] > range[0] ? range : null,
        },
    };
}

/**
 * Run the extraction on this thread.
 *
 * The window runs it in a worker instead, because a spectroscopic grid takes
 * tens of seconds. This is the same computation without the plumbing, for tests
 * and for any caller that is not a rendering thread.
 *
 * @returns the characterization result, or `{ error }` naming what stopped it.
 */
export function runCharacterization(design, settings) {
    const prepared = characterizationRequest(design, settings);
    if (prepared.error) return prepared;
    const result = characterizeFilm({
        ...prepared.request,
        sample: sampleFromPortable(prepared.request.sample),
    });
    return result.error ? result : { ...result, measurementMode: prepared.measurementMode };
}

/**
 * Sample the fitted model onto a table, so the material carries usable values
 * outside the wavelengths it was fitted over as well as inside them.
 */
function fitTable(fit, points = 200) {
    const [low, high] = fit.rangeNm;
    const rows = [];
    for (let index = 0; index <= points; index++) {
        const lambda = low + ((high - low) * index) / points;
        const [n, k] = evaluateDispersionFit(fit, lambda);
        rows.push([
            Number(lambda.toFixed(3)),
            Number(n.toFixed(6)),
            Number(Math.max(0, k).toFixed(9)),
        ]);
    }
    return rows;
}

/**
 * The result as a user-catalog material.
 *
 * It is stored the way a fitted tabular material is stored: the model on
 * `dispersionFit`, and a sampled table behind it. Nothing downstream then needs
 * to know the material came from a measurement rather than from a data sheet.
 * The thickness is not part of it, because that belongs to the run rather than
 * to the material, so it is written into the comment where a reader will find it.
 */
export function characterizedMaterial(result, { id, name, color }) {
    const rows = fitTable(result.fit);
    return {
        id,
        name: name || id,
        formulaNum: -1,
        tabData: rows,
        lambdaMin: result.fit.rangeNm[0] / 1000,
        lambdaMax: result.fit.rangeNm[1] / 1000,
        coefficients: [],
        kTable: [],
        dispersionFit: { ...result.fit, active: true },
        color: color || 'auto',
        group: 'User',
        comment: `Characterized from measured ${Object.keys(result.measured).join(' and ')}`
            + `, film thickness ${result.thicknessNm.toFixed(1)} nm`,
        nd: null, vd: null, density: null,
    };
}
