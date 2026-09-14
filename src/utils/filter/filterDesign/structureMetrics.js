import { prototypePositions } from './prototypeLayers.js';

/** Count physical layers of a structure (mirrors + spacers). */
export function structureLayerCount(mirrors, spacers) {
    return mirrors.reduce((a, g) => a + g, 0) + spacers.length;
}

/**
 * Total physical thickness (nm) of a structure at λ₀. Each position's material
 * follows from its parity counted from the substrate, the same walk the layer
 * builder uses.
 */
export function structureThickness(mirrors, spacers, dH, dL) {
    let th = 0;
    for (const { tag, qw } of prototypePositions(mirrors, spacers)) th += qw * (tag === 'H' ? dH : dL);
    return th;
}

/** Apply symmetry constraints to a structure (returns NEW arrays). */
export function applySymmetry(mirrors, spacers, { symMirrors, symCavities }) {
    let m = mirrors.slice(), s = spacers.slice();
    if (symMirrors) {
        const N1 = m.length;
        for (let i = 0; i < Math.floor(N1 / 2); i++) m[N1 - 1 - i] = m[i];
    }
    if (symCavities) {
        const Ns = s.length;
        for (let i = 0; i < Math.floor(Ns / 2); i++) s[Ns - 1 - i] = s[i];
    }
    return { mirrors: m, spacers: s };
}
