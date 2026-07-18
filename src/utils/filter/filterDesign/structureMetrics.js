/** Count physical layers of a structure (mirrors + spacers). */
export function structureLayerCount(mirrors, spacers) {
    return mirrors.reduce((a, g) => a + g, 0) + spacers.length;
}

/** Total physical thickness (nm) of a structure at λ₀ (QW-based). */
export function structureThickness(mirrors, spacers, dH, dL, spacerIsL) {
    let th = 0;
    // mirror layers alternate face(H for L-spacer); their QW thicknesses:
    const faceD = spacerIsL ? dH : dL, otherD = spacerIsL ? dL : dH;
    for (const g of mirrors) for (let i = 0; i < g; i++) th += (i % 2 === 0) ? faceD : otherD;
    const spD = spacerIsL ? dL : dH;
    for (const s of spacers) th += 2 * s * spD;
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
