import { makeGetNK } from './dispersion.js';

export const GROUP_COLORS = {
    'Ambient':      '#87CEEB',
    'Substrate':    '#d6eaf8',
    'Dielectric':   '#d5f5e3',
    'Semiconductor':'#bdc3c7',
    'Metal':        '#f1c40f',
    'TCO':          '#a9cce3',
    'Custom':       '#c39bd3',
};

export function catalogColor(catalogId) {
    let hash = 0;
    for (let i = 0; i < catalogId.length; i++) hash = (hash * 31 + catalogId.charCodeAt(i)) >>> 0;
    const hue = ((hash >> 4) & 0xfff) % 360;
    // Richer + a touch darker than the old (55%, 78%) pastel so the dot reads
    // clearly on dark themes (very pale chips washed out against dark panels)
    // while staying legible on light. Hue (the identity) is unchanged.
    return `hsl(${hue}, 60%, 66%)`;
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
    // Saturation rises with index; lightness lowered from 65%→58% and saturation
    // floor raised (55→63) so low-index (blue) dots stop looking dull/pale on
    // dark themes. Hue mapping (the n→colour identity) is unchanged.
    const sat = 63 + Math.round(17 * t);
    return `hsl(${hue}, ${sat}%, 58%)`;
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
