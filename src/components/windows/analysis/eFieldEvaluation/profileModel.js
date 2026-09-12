import { computeEFieldProfile } from '../../../../utils/physics/thinFilmMath.js';
import { resolveColor } from '../../../../utils/materials/catalogManager.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';

const NPTS = 60;

export function buildMatColorMap(design, layers) {
    const resolveMaterial = designMaterialLookup(design);
    const map = {};
    for (const l of layers) {
        const key = l.materialId || l.material;
        if (key && !map[key]) {
            const mat = resolveMaterial(key);
            map[key] = mat ? resolveColor(mat) : '#555555';
        }
    }
    return map;
}

// `nRef` is the index at the design's reference wavelength, which is what the
// depth axis measures optical distance with; see xScale.js.
function sampleLayer(resolveMaterial, layer, lambda_nm, ref_nm) {
    const mat = resolveMaterial(layer.material);
    const [nr, nk] = mat.getNK(lambda_nm);
    return { n: [nr, nk], nRef: mat.getNK(ref_nm)[0], d: layer.thickness, materialId: layer.material };
}

/**
 * The λ₀ the depth axis measures optical distance at. `refLambda_nm` is the one
 * the window was given; falling through it are the design's own reference
 * wavelength and, for a design that carries none, the wavelength the field is
 * computed at, so there is always a wavelength to read an index at.
 */
function axisRefLambda(design, lambda_nm, refLambda_nm) {
    if (refLambda_nm > 0) return refLambda_nm;
    return design.referenceWavelength > 0 ? design.referenceWavelength : lambda_nm;
}

/**
 * The field through one side's stack.
 *
 * `params` is `{ lambda, theta, pol, side, refLambda }`: the wavelength and
 * angle the field is computed at, the polarization, which coating, and the λ₀
 * the depth axis is read at. Back layers are stored substrate-to-exit and are
 * reversed into propagation order.
 */
export function computeProfile(design, params) {
    if (!design) return null;
    const { lambda: lambda_nm, theta: theta_deg, pol, side = 'front', refLambda = null } = params;
    const srcLayers = side === 'back' ? design.backLayers : design.frontLayers;
    if (!srcLayers?.length) return null;

    const refLambda_nm = axisRefLambda(design, lambda_nm, refLambda);
    const incidentId = side === 'back' ? design.exitMedium : design.incidentMedium;
    const resolveMaterial = designMaterialLookup(design);
    const n0mat = resolveMaterial(incidentId);
    const nsmat = resolveMaterial(design.substrate?.material);
    const n0raw = n0mat.getNK(lambda_nm);
    const nsraw = nsmat.getNK(lambda_nm);
    // The physics engine uses n + ik with nonnegative k for passive absorption.
    const n0 = [n0raw[0], n0raw[1]];
    const ns = [nsraw[0], nsraw[1]];
    const ordered = side === 'back' ? [...srcLayers].reverse() : srcLayers;
    const validLayers = ordered
        .filter(l => l.material && l.thickness > 0)
        .map(layer => sampleLayer(resolveMaterial, layer, lambda_nm, refLambda_nm));
    if (!validLayers.length) return null;

    const layerInput = validLayers.map(({ n, d }) => ({ n, d }));
    // The incident index sets the absolute scale of the field: a beam of a
    // given irradiance carries amplitude 1/sqrt(n) of what it would in vacuum.
    const incidentIndex = n0[0];
    const common = { validLayers, side, incidentIndex, refLambda: refLambda_nm };
    if (pol === 'avg') {
        const s = computeEFieldProfile(lambda_nm, theta_deg, 's', n0, ns, layerInput, NPTS);
        const p = computeEFieldProfile(lambda_nm, theta_deg, 'p', n0, ns, layerInput, NPTS);
        return { s, p, avg: averagePolarizations(s, p), ...common };
    }
    const result = computeEFieldProfile(lambda_nm, theta_deg, pol, n0, ns, layerInput, NPTS);
    return { [pol]: result, ...common };
}

// The unpolarized curve is the mean of the two polarizations, taken component
// by component so a component read on its own is the mean of that component.
function averagePolarizations(s, p) {
    const mean = key => s[key].map((value, index) => (value + p[key][index]) / 2);
    return {
        ...s,
        e2: mean('e2'),
        e2Tangential: mean('e2Tangential'),
        e2Normal: mean('e2Normal'),
    };
}
