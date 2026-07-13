import { computeRIProfile } from '../../../../utils/physics/thinFilmMath.js';
import { getMaterialById, resolveColor } from '../../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../../utils/materials/materialDatabase.js';

function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

export function buildMatColorMap(layers) {
    const map = {};
    for (const l of layers) {
        const key = l.materialId;
        if (key && !map[key]) {
            const mat = resolveMaterial(key);
            map[key] = mat ? resolveColor(mat) : '#555555';
        }
    }
    return map;
}

// Profiles always run from the incident medium through the coating to the substrate.
export function computeProfileForSide(design, lambda_nm, side) {
    const rawLayers = side === 'back'
        ? (design?.backLayers || [])
        : (design?.frontLayers || []);
    if (!rawLayers.length) return null;

    const n0Id = side === 'back' ? design.exitMedium : design.incidentMedium;
    const n0mat = resolveMaterial(n0Id);
    const nsmat = resolveMaterial(design.substrate?.material);
    const [n0n, n0k] = n0mat.getNK(lambda_nm);
    const [nsn, nsk] = nsmat.getNK(lambda_nm);

    const ordered = side === 'back' ? [...rawLayers].reverse() : rawLayers;
    const layers = ordered
        .filter(l => l.material && l.thickness > 0)
        .map(l => {
            const mat = resolveMaterial(l.material);
            const [nr, nk] = mat.getNK(lambda_nm);
            return {
                n: nr, k: nk, d: l.thickness,
                materialId: l.material,
                name: mat?.name || l.material,
            };
        });

    if (!layers.length) return null;
    return computeRIProfile({ n: n0n, k: n0k }, { n: nsn, k: nsk }, layers);
}

// Region coordinates are local and use left-hand Plotly "hv" step nodes.
export function buildRegionProfile(layers) {
    if (!layers?.length) return null;
    const z = [0];
    const n = [layers[0].n];
    const k = [layers[0].k];
    let acc = 0;
    const layerBounds = [0];
    for (let i = 0; i < layers.length; i++) {
        acc += layers[i].d;
        layerBounds.push(acc);
        const next = layers[i + 1] || layers[i];
        z.push(acc);
        n.push(next.n);
        k.push(next.k);
    }
    return { z, n, k, layerBounds, validLayers: layers, totalThk: acc };
}

export function computeTotalRegions(design, lambda_nm, rp) {
    const sampleLayers = (rawLayers) => (rawLayers || [])
        .filter(l => l.material && l.thickness > 0)
        .map(l => {
            const mat = resolveMaterial(l.material);
            const [nr, nk] = mat.getNK(lambda_nm);
            return { n: nr, k: nk, d: l.thickness, materialId: l.material,
                     name: mat?.name || l.material };
        });

    const regions = [];
    const frontLayers = sampleLayers(design?.frontLayers);
    if (frontLayers.length) {
        const prof = buildRegionProfile(frontLayers);
        regions.push({
            key: 'front',
            label: rp?.front || 'Front',
            unit: 'nm',
            title: `${rp?.front || 'Front'} (nm)`,
            ...prof,
        });
    }

    const subThkMm = design?.substrate?.thickness;
    if (subThkMm && subThkMm > 0) {
        const subMat = resolveMaterial(design?.substrate?.material);
        const [sn, sk] = subMat.getNK(lambda_nm);
        const subThkNm = subThkMm * 1e6;
        regions.push({
            key: 'substrate',
            label: rp?.substrate || 'Substrate',
            unit: 'mm',
            title: `${rp?.substrate || 'Substrate'} (mm)`,
            z: [0, subThkMm],
            n: [sn, sn],
            k: [sk, sk],
            layerBounds: [0, subThkMm],
            validLayers: [{ n: sn, k: sk, d: subThkNm,
                            materialId: design?.substrate?.material,
                            name: subMat?.name || design?.substrate?.material }],
            totalThk: subThkMm,
        });
    }

    const backLayers = sampleLayers(design?.backLayers);
    if (backLayers.length) {
        const prof = buildRegionProfile(backLayers);
        regions.push({
            key: 'back',
            label: rp?.back || 'Back',
            unit: 'nm',
            title: `${rp?.back || 'Back'} (nm)`,
            ...prof,
        });
    }

    return regions;
}
