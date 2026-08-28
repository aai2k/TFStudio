/**
 * Turning the window's settings into a characterization run, and its result
 * into a material.
 *
 * Everything here is pure. The physics lives in
 * utils/materials/characterization/.
 */

import { measuredCurveData } from '../../../../utils/io/spectrumTable.js';
import { resolveDesignMaterial } from '../../../../utils/materials/designMaterials.js';
import { characterizeFilm } from '../../../../utils/materials/characterization/nkFit.js';
import { evaluateDispersionFit } from '../../../../utils/materials/dispersionFits.js';
import { resolveEvalMode } from '../../../../utils/physics/optimizer/evalCore.js';

/** Curves on the design that a characterization can be run against. */
export function characterizableCurves(design) {
    return (design?.measuredCurves || [])
        .filter(curve => curve.quantity === 'T' || curve.quantity === 'R')
        .filter(curve => (curve.x?.length || 0) >= 8);
}

export function curveById(design, id) {
    return characterizableCurves(design).find(curve => curve.id === id) || null;
}

/**
 * The curves a fresh window should start with: one transmittance and one
 * reflectance if the design holds both, because that pair is the only
 * combination that solves n and k at a wavelength rather than assuming one.
 */
export function defaultCurveSelection(design) {
    const curves = characterizableCurves(design);
    return {
        transmittanceId: curves.find(curve => curve.quantity === 'T')?.id || '',
        reflectanceId: curves.find(curve => curve.quantity === 'R')?.id || '',
    };
}

function channelOf(curve) {
    const { x, y } = measuredCurveData(curve);
    return {
        quantity: curve.quantity,
        lambdas: x,
        values: y,
        aoi: curve.aoi ?? 0,
        pol: curve.pol ?? 'avg',
        side: curve.side ?? 'front',
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
        geometry: settings.geometry || defaultSampleGeometry(design),
        substrateId,
    };
}

/**
 * Run the extraction for the window's current settings.
 *
 * @returns the characterization result, or `{ error }` naming what stopped it.
 */
export function runCharacterization(design, settings) {
    const chosen = [
        curveById(design, settings.transmittanceId),
        curveById(design, settings.reflectanceId),
    ].filter(Boolean);
    if (chosen.length === 0) return { error: 'noCurves' };

    const range = [Number(settings.lambdaStart), Number(settings.lambdaEnd)];
    return characterizeFilm({
        channels: chosen.map(channelOf),
        sample: sampleFor(design, settings),
        indexModel: settings.indexModel,
        thicknessNm: thicknessSettingNm(design, settings),
        fixThickness: !!settings.fixThickness,
        rangeNm: range.every(Number.isFinite) && range[1] > range[0] ? range : null,
    });
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
