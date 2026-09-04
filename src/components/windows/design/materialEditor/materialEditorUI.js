/**
 * Material Editor — shared presentational atoms.
 *
 * Small, self-contained building blocks (a KaTeX formula span, colored dots,
 * status badges, property rows, coefficient formatting, and button/tab styles)
 * used across the Material Editor's panels and forms.
 */

import { parseNumber } from '../../../../utils/misc/numberParsing.js';

const { createElement: h, useRef, useEffect, useState } = React;

/** Wavelength in nm for display: up to two decimals, trailing zeros dropped. */
export function formatNm(nm) {
    return String(Number((+nm).toFixed(2)));
}

/** Extinction coefficient for display: five decimals, or exponent form below 1e-4. */
export function formatK(k) {
    if (k === 0) return '0';
    return Math.abs(k) >= 1e-4 ? k.toFixed(5) : k.toExponential(3);
}

// n and k at one typed wavelength, read from a getNK(lambda_nm) function. A
// wavelength outside the material's stated range still evaluates the way the
// material always does beyond its data (clamped or extrapolated) and is marked.
export function NkProbe({ getNK, rangeNm, c, me }) {
    const [text, setText] = useState(() => {
        const [lo, hi] = rangeNm || [];
        const covers550 = lo == null || hi == null || (lo <= 550 && 550 <= hi);
        return covers550 ? '550' : formatNm((lo + hi) / 2);
    });
    const lam = parseNumber(text);
    let n = null, k = 0;
    if (getNK && Number.isFinite(lam) && lam > 0) {
        try {
            const nk = getNK(lam);
            if (Number.isFinite(nk?.[0])) { n = nk[0]; k = Number.isFinite(nk[1]) ? nk[1] : 0; }
        } catch (_) { n = null; }
    }
    const outside = !!rangeNm && Number.isFinite(lam) && lam > 0 && (lam < rangeNm[0] || lam > rangeNm[1]);
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, flexWrap: 'wrap' } },
        h('span', { style: { color: c.textDim, fontSize: 11, whiteSpace: 'nowrap' } }, me.nkAtLabel),
        h('input', {
            value: text,
            onChange: e => setText(e.target.value),
            style: { width: 84, height: 22, boxSizing: 'border-box', backgroundColor: c.bg, color: c.text,
                     border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 12, padding: '0 6px',
                     outline: 'none', fontFamily: 'monospace' },
        }),
        h('span', { style: { fontFamily: 'monospace', color: c.text } }, n == null ? '–' : `n = ${n.toFixed(5)}`),
        n != null && h('span', { style: { fontFamily: 'monospace', color: c.textDim } }, `k = ${formatK(k)}`),
        outside && h('span', { style: { fontSize: 11, color: '#e6a23c' } }, me.nkAtOutOfRange)
    );
}

// KaTeX formula renderer. Falls back to raw LaTeX text if KaTeX is unavailable
// or throws, so a malformed formula can never blank the panel.
export function KaTeXSpan({ latex, displayMode }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!ref.current || !window.katex) return;
        try {
            window.katex.render(latex, ref.current, { displayMode: !!displayMode, throwOnError: false, strict: false });
        } catch (_) { if (ref.current) ref.current.textContent = latex; }
    }, [latex, displayMode]);
    return h('span', { ref });
}

export function dotStyle(color, size = 10) {
    return { width: size, height: size, borderRadius: '50%', backgroundColor: color || '#888', flexShrink: 0, display: 'inline-block' };
}

export function statusBadge(status, t) {
    const colors = ['#5dade2','#58d68d','#ec7063','#f39c12','#a569bd'];
    return h('span', {
        style: { fontSize: 10, padding: '1px 5px', borderRadius: 3, backgroundColor: (colors[status] || '#888') + '33', color: colors[status] || '#888', fontWeight: 600 }
    }, t.materialEditor.status(status));
}

export function propRow(label, value, c) {
    return [
        h('span', { key: label + 'L', style: { color: c.textDim, whiteSpace: 'nowrap', paddingBottom: 2 } }, label),
        h('span', { key: label + 'V', style: { color: c.text, paddingBottom: 2 } }, value)
    ];
}

export function formatCoeff(v) {
    if (Math.abs(v) >= 0.001 && Math.abs(v) < 10000) return v.toPrecision(7).replace(/\.?0+$/, '');
    return v.toExponential(4);
}

export function catTabStyle(active, c) {
    return {
        padding: '2px 7px', fontSize: 11,
        border: `1px solid ${active ? c.accent : c.border}`, borderRadius: 3,
        backgroundColor: active ? c.accent + '33' : 'transparent',
        color: active ? c.accent : c.textDim,
        cursor: 'pointer', outline: 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif'
    };
}

export function smallBtn(c, extra) {
    return {
        padding: '2px 7px', fontSize: 11, border: `1px solid ${c.border}`, borderRadius: 3,
        backgroundColor: c.panel, color: c.text, cursor: 'pointer', outline: 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif', ...extra
    };
}
