import { computeEFieldProfile } from '../../../../utils/physics/thinFilmMath.js';
import { getMaterialById, resolveColor } from '../../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';

const NPTS = 60;

function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

export function buildMatColorMap(layers) {
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

function sampleLayer(layer, lambda_nm) {
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
        .map(layer => sampleLayer(layer, lambda_nm));
    if (!validLayers.length) return null;

    const layerInput = validLayers.map(({ n, d }) => ({ n, d }));
    if (pol === 'avg') {
        const s = computeEFieldProfile(lambda_nm, theta_deg, 's', n0, ns, layerInput, NPTS);
        const p = computeEFieldProfile(lambda_nm, theta_deg, 'p', n0, ns, layerInput, NPTS);
        const e2avg = s.e2.map((v, i) => (v + p.e2[i]) / 2);
        return { s, p, avg: { ...s, e2: e2avg }, validLayers, side };
    }
    const result = computeEFieldProfile(lambda_nm, theta_deg, pol, n0, ns, layerInput, NPTS);
    return { [pol]: result, validLayers, side };
}
