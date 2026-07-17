import { getMaterialById, resolveColor } from '../../../../utils/materials/catalogManager.js';
import { matDisplayName } from './materialNames.js';

// ── Shared "blocking warning" badge ─────────────────────────────────────────────
// Used by every optimizer/synthesis window (Refinement, Needle, Gradual
// Evolution, Structural, Needle Manual) so a blocking message — e.g. an empty
// merit function — looks IDENTICAL everywhere. Amber text on a faint amber wash
// reads clearly on all (dark) theme panels, unlike the old brown-on-brown
// reason pill. Spread it and add positioning (marginLeft) at the call site.
export const WARN_BADGE_STYLE = {
    fontSize: 11, padding: '2px 9px', borderRadius: 4,
    background: '#ffb74d22', color: '#ffb74d', border: '1px solid #ffb74d66',
    fontWeight: 600, fontStyle: 'normal', whiteSpace: 'nowrap',
};

export const MAT_COLORS = {
    TiO2: '#e53935', SiO2: '#1e88e5', Ta2O5: '#8e24aa', Nb2O5: '#43a047',
    HfO2: '#fb8c00', Al2O3: '#00acc1', ZnS:   '#fdd835', ZnSe:  '#f06292',
    Si:   '#546e7a', Ge:    '#78909c', MgF2:  '#80cbc4', ITO:   '#aed581',
    Au:   '#ffd54f', Ag:    '#b0bec5', Cr:    '#8d6e63', BK7:   '#ab47bc',
};

// HSL → "#rrggbb" for the hashed fallback (used only when a material is no
// longer in any catalog).
function hslToHex(hDeg, s, l) {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
        const k = (n + hDeg / 30) % 12;
        const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(255 * v).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

// THE material's display color — the SAME one shown in the Material Editor and
// Design Editor: the user-chosen `color`, else an index-derived `ndColor(nd)`.
// Synthesis history/pool now share this so a material looks identical everywhere.
// Falls back to the old built-in palette / id-hash only for a material that is
// no longer in any catalog (can't resolve a real color).
export function matColor(id) {
    const mat = getMaterialById(id);
    if (mat) return resolveColor(mat);
    const name = matDisplayName(id);
    if (MAT_COLORS[name]) return MAT_COLORS[name];
    let h = 0;
    for (let i = 0; i < (id || '').length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return hslToHex((h * 137) % 360, 65, 55);
}

// Translucent wash of a material's color for the history badge background.
// Must accept ANY CSS color the editor can produce — hex (#rgb / #rrggbb), the
// hsl() that ndColor returns, or a named color — so it parses to rgba/hsla with
// the given alpha instead of the old (fragile, hex-only) `${color}44` trick.
export function matColorAlpha(id, alpha = 0.27) {
    const color = matColor(id);
    let m = /^#([0-9a-f]{3})$/i.exec(color);
    if (m) {
        const [r, g, b] = [...m[1]].map(ch => parseInt(ch + ch, 16));
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    m = /^#([0-9a-f]{6})$/i.exec(color);
    if (m) {
        const h = m[1];
        const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    m = /^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i.exec(color);
    if (m) return `hsla(${m[1]}, ${m[2]}%, ${m[3]}%, ${alpha})`;
    return color;   // unknown format → solid color (still visible)
}
