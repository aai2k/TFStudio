import { makeGetNK } from './dispersion.js';

/**
 * Lightness (%) that makes a fully saturated hue carry the same visual weight
 * as any other. HSL brightness is strongly hue-dependent — yellows near 60°
 * read far lighter than blues near 240° at equal L — so without this a single
 * flat lightness yields a ramp that looks washed out at one end and muddy at
 * the other. Chosen to keep every dot legible on both light and dark themes.
 */
function lightnessForHue(hue) {
    return 50 - 9 * Math.cos((hue - 55) * Math.PI / 180);
}

/**
 * Derive a material dot color from nd (refractive index at d-line).
 * Follows the thin-film convention: low-n = blue, high-n = orange/red.
 */
export function ndColor(nd) {
    if (!nd || nd <= 0) return '#aaa';
    // Map nd 1.3..3.5 → hue 220..0 (blue→red)
    const t = Math.max(0, Math.min(1, (nd - 1.3) / (3.5 - 1.3)));
    const hue = Math.round(220 * (1 - t));
    // Saturation is high throughout and rises further with index, so the ramp
    // reads as a set of strong, clearly separable colors rather than pastels.
    const sat = 88 + Math.round(7 * t);
    return `hsl(${hue}, ${sat}%, ${lightnessForHue(hue).toFixed(1)}%)`;
}

// Reference wavelength for deriving an automatic color when a material has no
// stored `nd` (RII/AGF/library/user materials) — uses the refractive index at
// this λ so every material gets a meaningful color from its own dispersion.
const AUTOCOLOR_REF_NM = 550;

// The index-derived ("automatic") color for a material: ndColor of its `nd`,
// or — when nd is absent — of n sampled from getNK at the reference wavelength.
export function materialAutoColor(mat) {
    if (!mat) return ndColor(null);
    let nd = mat.nd;
    if (!(nd > 0)) {
        const fn = mat.getNK || makeGetNK(mat);
        try {
            const nk = typeof fn === 'function' ? fn(AUTOCOLOR_REF_NM) : null;
            nd = Array.isArray(nk) ? nk[0] : (nk && nk.n);
        } catch (_) { nd = null; }
    }
    return ndColor(nd);
}

// THE display color for a material. An explicit `color` (a preset/picked hex)
// wins; otherwise — no color, or the explicit `'auto'` sentinel — the color is
// derived from the refractive index. Imported materials (RII/library/AGF)
// carry no color and so are automatic by default; user materials may store
// 'auto' to opt in. This is the single source of truth for material color
// across the app (Material Editor, Design Editor, analysis windows, synthesis).
export function resolveColor(mat) {
    if (mat && mat.color && mat.color !== 'auto') return mat.color;
    return materialAutoColor(mat);
}
