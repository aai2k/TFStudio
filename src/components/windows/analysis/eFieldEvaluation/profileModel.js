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

function sampleLayer(resolveMaterial, layer, lambda_nm) {
    const mat = resolveMaterial(layer.material);
    const [nr, nk] = mat.getNK(lambda_nm);
    return { n: [nr, nk], d: layer.thickness, materialId: layer.material };
}

// Back layers are stored substrate-to-exit and are reversed into propagation order.
export function computeProfile(design, lambda_nm, theta_deg, pol, side = 'front') {
    if (!design) return null;
    const srcLayers = side === 'back' ? design.backLayers : design.frontLayers;
    if (!srcLayers?.length) return null;

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
        .map(layer => sampleLayer(resolveMaterial, layer, lambda_nm));
    if (!validLayers.length) return null;

    const layerInput = validLayers.map(({ n, d }) => ({ n, d }));
    // The incident index sets the absolute scale of the field: a beam of a
    // given irradiance carries amplitude 1/sqrt(n) of what it would in vacuum.
    const incidentIndex = n0[0];
    if (pol === 'avg') {
        const s = computeEFieldProfile(lambda_nm, theta_deg, 's', n0, ns, layerInput, NPTS);
        const p = computeEFieldProfile(lambda_nm, theta_deg, 'p', n0, ns, layerInput, NPTS);
        return { s, p, avg: averagePolarizations(s, p), validLayers, side, incidentIndex };
    }
    const result = computeEFieldProfile(lambda_nm, theta_deg, pol, n0, ns, layerInput, NPTS);
    return { [pol]: result, validLayers, side, incidentIndex };
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
