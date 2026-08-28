// thinFilmMath uses n + ik with nonnegative k for passive absorption.
export function nkAt(material, lambdaNm) {
    const [nr, nk] = material.getNK(lambdaNm);
    return [nr, nk];
}

// Back-side deposition order is reversed so both side lists run from the
// incident medium toward the substrate.
export function sideStack(resolveMaterial, design, side) {
    const layers = side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
    const ordered = side === 'back' ? [...layers].reverse() : layers;
    return ordered
        .filter(layer => layer.material && layer.thickness > 0)
        .map(layer => ({ material: resolveMaterial(layer.material), thickness: layer.thickness }));
}

// The same stack sampled at one wavelength, as the point evaluators take it.
export function sideLayersAt(resolveMaterial, design, side, lambdaNm) {
    return sideStack(resolveMaterial, design, side)
        .map(layer => ({ n: nkAt(layer.material, lambdaNm), d: layer.thickness }));
}

export function sideMedia(design, side) {
    return side === 'back'
        ? { n0Id: design.exitMedium, nsId: design.substrate?.material }
        : { n0Id: design.incidentMedium, nsId: design.substrate?.material };
}

export function sideHasLayers(design, side) {
    const layers = side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
    return layers.some(layer => layer.material && layer.thickness > 0);
}

export function sideSummary(design, side) {
    const sideLayers = side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
    const validLayers = sideLayers.filter(layer => layer.material && layer.thickness > 0);
    return {
        validLayers,
        totalThickness: validLayers.reduce((sum, layer) => sum + layer.thickness, 0),
    };
}

// computeEllipsometry returns Delta = arg(r_p/r_s) in this codebase's exp(-iwt),
// n + ik convention. Azzam-Bashara is its conjugate, 360 - Delta, and is what an
// ellipsometer writes: checked against a J.A. Woollam WVASE export of a known
// 20 nm PNIPAM / 2 nm SiO2 / Si sample, which the conjugate reproduces to 0.7
// deg in Delta while the unconjugated value is out by 63 deg. Psi is the same
// either way, being a magnitude ratio.
export function toDeltaConvention(delta, convention) {
    if (convention !== 'azzam') return delta;
    return delta.map(value => (((360 - value) % 360) + 360) % 360);
}
