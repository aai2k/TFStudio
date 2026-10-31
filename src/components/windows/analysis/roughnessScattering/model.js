import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { runSpectrum } from '../../../../utils/physics/plotQuantities/spectrumRunner.js';
import { makeConeSpec } from '../../../../utils/physics/optimizer/coneAngle.js';
import {
    countInterfaces, extrapolateSlicing, GRADED_SLICES, resolveRanges, resolveSigmas,
    roughenBackStack, roughenFrontStack,
} from '../../../../utils/physics/scattering.js';

export function getRoughnessContext(design, evalMode) {
    const hasBack = (design?.backLayers?.length || 0) > 0;
    const activeSides = evalMode === 'back'
        ? ['back']
        : evalMode === 'total'
            ? (hasBack ? ['front', 'back'] : ['front'])
            : ['front'];
    const frontN = countInterfaces(design?.frontLayers?.length || 0);
    const backN = hasBack ? countInterfaces(design.backLayers.length) : 0;
    const nIfaces = activeSides.reduce((sum, side) => sum + (side === 'back' ? backN : frontN), 0);
    return { hasBack, activeSides, frontN, backN, nIfaces };
}

/** σ and roughness kind for every interface of one side, in the editor's order. */
function sideRoughness(rough, side, count) {
    const back = side === 'back';
    const spec = {
        mode: rough.mode, sigma: rough.sigma, range: rough.range,
        sigmas: back ? rough.backSigmas : rough.sigmas,
        ranges: back ? rough.backRanges : rough.ranges,
    };
    return { sigmas: resolveSigmas(spec, count), ranges: resolveRanges(spec, count) };
}

const hasShortRange = ({ sigmas, ranges }) => sigmas.some((s, i) => s > 0 && ranges[i] === 'short');
const hasLongRange = ({ sigmas, ranges }) => sigmas.some((s, i) => s > 0 && ranges[i] === 'long');

/** Materials and layer lists of the design, resolved once for every evaluation. */
function resolveSetup(design, params, evalMode) {
    const resolveMaterial = designMaterialLookup(design);
    // Every layer is kept, zero-thickness ones included, so interface i here
    // is interface i in the editor; the TMM skips empty layers.
    const resolveLayers = layers => (layers || [])
        .map(layer => ({ material: resolveMaterial(layer.material), thickness: layer.thickness }));
    return {
        params, evalMode,
        media: {
            inc: resolveMaterial(design.incidentMedium),
            sub: resolveMaterial(design.substrate?.material),
            exit: resolveMaterial(design.exitMedium),
        },
        front: resolveLayers(design.frontLayers),
        back: resolveLayers(design.backLayers),
        subThk: design.substrate?.thickness ?? 1.0,
        cone: makeConeSpec(design.cone || {}),
    };
}

/**
 * The design's spectrum for the evaluation mode, averaged over the design's
 * cone of incidence as Optical Evaluation averages its spectrum, with
 * `roughen(side, layers)` giving the layer list to evaluate for each stack
 * that mode includes.
 */
function evaluateMode({ params, evalMode, media, front, back, subThk, cone }, roughen) {
    return runSpectrum(evalMode, params, {
        incMat: media.inc, subMat: media.sub, exitMat: media.exit, subThickness_mm: subThk, cone,
        frontLayers: evalMode === 'back' ? [] : roughen('front', front),
        backLayers: evalMode === 'back' || evalMode === 'total' ? roughen('back', back) : [],
    });
}

/**
 * The rough design's spectrum with `slices` graded sub-layers per short-range
 * interface. Layers set to zero thickness are recorded in `thinned`. A side
 * with no layers has no rough interface and keeps its bare surface.
 */
function roughSpectrum(setup, { sides, thinned }, slices) {
    const { inc, sub, exit } = setup.media;
    return evaluateMode(setup, (side, layers) => {
        if (!layers.length) return layers;
        const result = side === 'back'
            ? roughenBackStack(layers, { substrate: sub, exit }, sides.back, slices)
            : roughenFrontStack(layers, { incident: inc, substrate: sub }, sides.front, slices);
        thinned[side] = result.thinned;
        return result.layers;
    });
}

/** The R and T curves both spectra carry, keyed as the curve switches are. */
function pairCurves(smooth, withRoughness) {
    const ideal = {};
    const specular = {};
    for (const key of ['R', 'T', 'Rs', 'Ts', 'Rp', 'Tp']) {
        if (!smooth[key] || !withRoughness[key]) continue;
        ideal[key] = smooth[key];
        specular[key] = withRoughness[key];
    }
    return { ideal, specular };
}

/**
 * Specular R and T of the design with and without interface roughness.
 *
 * Every rough interface becomes a transition layer (see scattering.js), and the
 * rough design is evaluated by the same characteristic-matrix code as the
 * smooth one, so polarization, angle, absorbing layers and the substrate in
 * Total mode are all handled as they are everywhere else. `loss` is the
 * averaged-polarization specular loss, smooth (R + T) minus rough (R + T).
 *
 * Plain inputs, no React: a script can call it with a design read from a .tfs
 * file, e.g. { rough: { mode: 'uniform', sigma: 5, range: 'long' },
 * params: { lambdaStart, lambdaEnd, lambdaStep, theta }, evalMode: 'front' }.
 */
export function calculateRoughness({
    design, params, rough, evalMode = 'front', context = getRoughnessContext(design, evalMode),
}) {
    if (!design?.frontLayers) return { data: null, error: null };
    try {
        const setup = resolveSetup(design, params, evalMode);
        const sides = {
            front: sideRoughness(rough, 'front', context.frontN),
            back: sideRoughness(rough, 'back', context.hasBack ? context.backN : 0),
        };
        const active = context.activeSides.map(side => sides[side]);
        const thinned = { front: [], back: [] };
        const roughAt = slices => roughSpectrum(setup, { sides, thinned }, slices);

        const smooth = evaluateMode(setup, (side, layers) => layers);
        const coarse = roughAt(GRADED_SLICES);
        const withRoughness = active.some(hasShortRange)
            ? extrapolateSlicing(coarse, roughAt(2 * GRADED_SLICES))
            : coarse;
        const loss = smooth.lambda.map((_, i) =>
            (smooth.R[i] + smooth.T[i]) - (withRoughness.R[i] + withRoughness.T[i]));

        return { data: {
            lambda: smooth.lambda,
            ...pairCurves(smooth, withRoughness),
            loss,
            thinned,
            hasLongRange: active.some(hasLongRange),
        }, error: null };
    } catch (error) {
        return { data: null, error: error.message || String(error) };
    }
}
