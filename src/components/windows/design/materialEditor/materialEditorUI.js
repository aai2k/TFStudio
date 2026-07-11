/**
 * Material Editor — shared presentational atoms.
 *
 * Small, self-contained building blocks (a KaTeX formula span, colored dots,
 * status badges, property rows, coefficient formatting, and button/tab styles)
 * used across the Material Editor's panels and forms.
 */

const { createElement: h, useRef, useEffect } = React;

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
