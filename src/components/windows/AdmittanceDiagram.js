/**
 * Admittance Diagram — complex admittance locus in the Y-plane.
 *
 * Theory: Macleod §2.4, §4.1.
 * For each layer k the admittance traces an arc (or spiral for absorbing media)
 * from Y[k+1] (substrate side) to Y[k] (air side) using the exact transfer formula:
 *
 *   Y(φ) = η·(Y_R·cos(φ) − i·η·sin(φ)) / (η·cos(φ) − i·Y_R·sin(φ))
 *
 * where φ ∈ [0, δ_k] is the accumulated phase, η the layer admittance, Y_R the
 * right-boundary admittance.  All quantities are complex to handle absorbing layers.
 */

import { useDesign } from '../../state/DesignContext.js';
import { getMaterialById } from '../../utils/materials/catalogManager.js';
import { getMaterial } from '../../utils/materials/materialDatabase.js';
import { tmmWithAdmittances } from '../../utils/physics/thinFilmMath.js';
import { DataTablePanel } from '../ui/DataTablePanel.js';

const { createElement: h, useState, useEffect, useCallback, useRef, useMemo } = React;

// ── Complex arithmetic (mirrors thinFilmMath.js private helpers) ──────────────

function cadd([ar, ai], [br, bi]) { return [ar + br, ai + bi]; }
function csub([ar, ai], [br, bi]) { return [ar - br, ai - bi]; }
function cmul([ar, ai], [br, bi]) { return [ar * br - ai * bi, ar * bi + ai * br]; }
function cdiv([ar, ai], [br, bi]) {
    const d = br * br + bi * bi || 1e-300;
    return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d];
}
function csqrt([ar, ai]) {
    const r = Math.sqrt(Math.sqrt(ar * ar + ai * ai));
    const theta = Math.atan2(ai, ar) / 2;
    return [r * Math.cos(theta), r * Math.sin(theta)];
}
function ccos([ar, ai]) { return [Math.cos(ar) * Math.cosh(ai), -Math.sin(ar) * Math.sinh(ai)]; }
function csin([ar, ai]) { return [Math.sin(ar) * Math.cosh(ai),  Math.cos(ar) * Math.sinh(ai)]; }

// ── Layer admittance and phase helpers ────────────────────────────────────────

// Snell's law: cos(θ_j) given n0, sinθ0 (complex), nj (complex)
function snellCos(n0, sinTheta0c, nj) {
    const sinThetaJ = cdiv(cmul(n0, sinTheta0c), nj);
    return csqrt(csub([1, 0], cmul(sinThetaJ, sinThetaJ)));
}

// Characteristic admittance η for a layer
function layerEta(nj, cosThJ, pol) {
    return pol === 's' ? cmul(nj, cosThJ) : cdiv(nj, cosThJ);
}

// Phase thickness δ = (2π/λ) · n · d · cosθ  (complex)
function layerDelta(nj, d_nm, lambda_nm, cosThJ) {
    const k0 = 2 * Math.PI / lambda_nm;
    return cmul(cmul(nj, [k0 * d_nm, 0]), cosThJ);
}

// Transfer formula: trace admittance from Y_R (right/substrate side) by phase φ
// Y(φ) = η·(Y_R·cos(φ) − i·η·sin(φ)) / (η·cos(φ) − i·Y_R·sin(φ))
function transferAdmittance(Y_R, eta, phi) {
    const cosP = ccos(phi);
    const sinP = csin(phi);
    const num = csub(cmul(Y_R, cosP), cmul([0, 1], cmul(eta, sinP)));
    const den = csub(cmul(eta, cosP), cmul([0, 1], cmul(Y_R, sinP)));
    return cmul(eta, cdiv(num, den));
}

// ── Material helpers ──────────────────────────────────────────────────────────

function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// Stable per-material color assignment (consistent within a render)
const MAT_PALETTE = [
    '#4fc3f7', '#ef5350', '#66bb6a', '#ffca28',
    '#ab47bc', '#26c6da', '#ff7043', '#ec407a',
    '#78909c', '#8d6e63',
];

function buildMatColorMap(layers) {
    const map = {};
    let idx = 0;
    for (const l of layers) {
        if (l.material && !map[l.material]) {
            map[l.material] = MAT_PALETTE[idx % MAT_PALETTE.length];
            idx++;
        }
    }
    return map;
}

// ── Diagram data builder ──────────────────────────────────────────────────────

// ── Adaptive arc sampling ─────────────────────────────────────────────────────
// For a homogeneous layer the admittance locus Y(φ), φ∈[0,δ] is (for a lossless
// layer) a CIRCULAR ARC, and a logarithmic spiral when absorbing. Sampling
// uniformly in φ bunches points unevenly around the circle, so the fast-moving
// part renders as long straight chords — visibly jagged when zoomed out.
//
// Instead we sample ADAPTIVELY by geometric flatness: recursively bisect a φ
// segment only while its midpoint deviates from the chord by more than FLAT× the
// chord length. This places points where the curve actually bends, yielding a
// true smooth curve at any zoom for a cost proportional to curvature (~tens of
// points for a gentle arc, more only where needed) rather than a fixed count.
const ARC_FLAT     = 0.0015; // max midpoint-deviation / chord (smaller = smoother)
const ARC_SEED     = 8;      // initial uniform splits (catches near-closed loops)
const ARC_MAXDEPTH = 9;      // per-seed recursion cap (≤512 pts/segment safety)

// Perpendicular distance from point P to the line through A,B (chord).
function segDeviation(P, A, B) {
    const bx = B[0] - A[0], by = B[1] - A[1];
    const len = Math.hypot(bx, by);
    if (len < 1e-12) return Math.hypot(P[0] - A[0], P[1] - A[1]);
    return Math.abs(bx * (A[1] - P[1]) - (A[0] - P[0]) * by) / len;
}

function sampleArcAdaptive(Y_R, eta, delta) {
    const Yat = (frac) => transferAdmittance(Y_R, eta, [delta[0] * frac, delta[1] * frac]);
    const re = [], im = [];
    const push = (Y) => { re.push(Y[0]); im.push(Y[1]); };

    function refine(f0, Y0, f1, Y1, depth) {
        if (depth < ARC_MAXDEPTH) {
            const fm = (f0 + f1) / 2;
            const Ym = Yat(fm);
            const chord = Math.hypot(Y1[0] - Y0[0], Y1[1] - Y0[1]);
            const dev = segDeviation(Ym, Y0, Y1);
            if (dev > ARC_FLAT * chord && dev > 1e-9) {
                refine(f0, Y0, fm, Ym, depth + 1);
                refine(fm, Ym, f1, Y1, depth + 1);
                return;
            }
        }
        push(Y1); // segment flat enough — emit its endpoint
    }

    let prevF = 0, prevY = Yat(0);
    push(prevY);
    for (let s = 1; s <= ARC_SEED; s++) {
        const f = s / ARC_SEED, Y = Yat(f);
        refine(prevF, prevY, f, Y, 0);
        prevF = f; prevY = Y;
    }
    return { re, im };
}

// Pick incident medium + ordered layer list for a given side.
// Front: light enters from incidentMedium, hits frontLayers in stored order.
// Back : light enters from exitMedium, hits backLayers in REVERSE build order
//        (so the deposition-order list reads outward→inward like the front side).
// Substrate is the right-hand half-space (ns) for both sides.
// Same convention as EllipsometryEvaluation.sideLayersAt / sideMedia.
function sideStackLayers(design, side) {
    const layers = side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
    return side === 'back' ? [...layers].reverse() : layers;
}

function buildOnePol(design, lambda_nm, theta_deg, pol, side = 'front') {
    const n0mat = resolveMaterial(side === 'back' ? design.exitMedium : design.incidentMedium);
    const nsmat = resolveMaterial(design.substrate?.material);

    // Feed ñ = n + ik (k ≥ 0 absorbing), matching thinFilmMath.js, so absorbing
    // layers give a decaying (energy-conserving) admittance locus. The resulting
    // Y is the complex conjugate of Macleod's; Im(Y) is negated for display below
    // (negateImY) so the plotted diagram keeps Macleod's textbook orientation.
    const [n0r, n0k] = n0mat.getNK(lambda_nm);
    const n0 = [n0r, n0k];
    const [nsr, nsk] = nsmat.getNK(lambda_nm);
    const ns = [nsr, nsk];

    const allLayers = sideStackLayers(design, side).map(layer => {
        const mat = resolveMaterial(layer.material);
        const [nr, nk] = mat.getNK(lambda_nm);
        return { n: [nr, nk], d: layer.thickness, material: layer.material, id: layer.id };
    });

    const result = tmmWithAdmittances(lambda_nm, theta_deg, pol, n0, ns, allLayers);
    const { Y, N } = result;

    const sinTheta0 = Math.sin(theta_deg * Math.PI / 180);
    const sinTheta0c = [sinTheta0, 0];

    const valid = allLayers.filter(l => l.d > 0);

    // Per-layer arcs in substrate→air order (k = N-1 down to 0)
    const arcs = [];
    for (let k = N - 1; k >= 0; k--) {
        const lyr = valid[k];
        const cosThJ = snellCos(n0, sinTheta0c, lyr.n);
        const eta    = layerEta(lyr.n, cosThJ, pol);
        const delta  = layerDelta(lyr.n, lyr.d, lambda_nm, cosThJ);  // lyr.d = layer.thickness

        const Y_R = Y[k + 1];
        const { re, im } = sampleArcAdaptive(Y_R, eta, delta);
        arcs.push({ k, layerNum: k + 1, material: lyr.material, re, im });
    }

    // eta0 (characteristic admittance of incident medium)
    const cosTheta0 = csqrt(csub([1, 0], cmul(sinTheta0c, sinTheta0c)));
    const eta0 = layerEta(n0, cosTheta0, pol);

    // Our engine's admittance is the complex conjugate of Macleod's (ñ = n + ik,
    // −i off-diagonals). Negate Im(Y) for the whole diagram so the plotted locus
    // matches Macleod's textbook orientation. This is a pure vertical mirror of
    // the Y-plane: arc shapes and the endpoint reflectance are unchanged.
    const flipY = (p) => [p[0], -p[1]];
    const dArcs = arcs.map(a => ({ ...a, im: a.im.map(v => -v) }));
    const dY = Y.map(flipY);
    return { pol, side, Y: dY, N, arcs: dArcs, eta0: flipY(eta0), etaS: dY[N] };
}

// Does the chosen side have any layers to trace?
function sideHasLayers(design, side) {
    return side === 'back'
        ? !!(design?.backLayers?.length)
        : !!(design?.frontLayers?.length);
}

// Trace the admittance locus for the single chosen side only.
function buildDiagramData(design, lambda_nm, theta_deg, pol, side = 'front') {
    if (!sideHasLayers(design, side)) return null;
    const pols = pol === 'avg' ? ['s', 'p'] : [pol];
    return pols.map(p => buildOnePol(design, lambda_nm, theta_deg, p, side));
}

// ── Robust default view range ─────────────────────────────────────────────────
// A quarter-wave / high-reflector stack drives the admittance locus to extreme
// values at its stopband — Re(Y) can reach thousands. Letting Plotly autorange to
// that single excursion squashes the entire meaningful diagram into a dot at the
// origin. Instead we frame the BULK of the locus (percentile-clipped), always
// keeping the key markers (η₀ incident, η_s substrate, Y₀ final) in view. The rare
// spike is simply clipped at the axis edge; the modebar "Autoscale" still recovers
// the full data extent on demand.
function pctl(sortedAsc, p) {
    if (!sortedAsc.length) return 0;
    const i = Math.min(sortedAsc.length - 1, Math.max(0, Math.round(p * (sortedAsc.length - 1))));
    return sortedAsc[i];
}

function computeRobustRange(series) {
    if (!series || !series.length) return null;
    const re = [], im = [], must = [];
    for (const s of series) {
        for (const arc of s.arcs) {
            for (let i = 0; i < arc.re.length; i++) { re.push(arc.re[i]); im.push(arc.im[i]); }
        }
        if (s.etaS) must.push(s.etaS);
        if (s.eta0) must.push(s.eta0);
        if (s.Y && s.Y[0]) must.push(s.Y[0]);
    }
    if (!re.length) return null;
    const reS = re.slice().sort((a, b) => a - b);
    const imS = im.slice().sort((a, b) => a - b);
    // Clip the extreme tails so a stopband spike can't define the frame.
    let reLo = pctl(reS, 0.02), reHi = pctl(reS, 0.95);
    let imLo = pctl(imS, 0.025), imHi = pctl(imS, 0.975);
    // The physically meaningful endpoints must always be visible.
    for (const [r, i] of must) {
        reLo = Math.min(reLo, r); reHi = Math.max(reHi, r);
        imLo = Math.min(imLo, i); imHi = Math.max(imHi, i);
    }
    // Square window centred on the bulk (keeps equal aspect / circular arcs).
    const cx = (reLo + reHi) / 2, cy = (imLo + imHi) / 2;
    let half = Math.max((reHi - reLo) / 2, (imHi - imLo) / 2, 1.0) * 1.12;
    return { xrange: [cx - half, cx + half], yrange: [cy - half, cy + half] };
}

// ── Plotly chart ──────────────────────────────────────────────────────────────

function AdmittanceChart({ series, matColorMap, c, theme, t }) {
    const divRef = useRef(null);
    const initializedRef = useRef(false);

    const bgColor    = c.bg     || '#1e1e1e';
    const paperColor = c.panel  || '#252526';
    const gridColor  = c.border || '#3a3a3a';
    const textColor  = c.text   || '#cccccc';

    const buildTraces = useCallback(() => {
        if (!series?.length) return [];
        const traces = [];
        const isMultiPol = series.length > 1;

        for (const s of series) {
            const dash = s.pol === 'p' ? 'dash' : 'solid';
            const polLabel = isMultiPol ? ` (${s.pol})` : '';

            // Layer arcs — substrate to air order
            for (const arc of s.arcs) {
                const color = matColorMap[arc.material] || '#aaaaaa';
                traces.push({
                    x: arc.re, y: arc.im,
                    type: 'scatter', mode: 'lines',
                    name: `L${arc.layerNum}${polLabel}`,
                    legendgroup: `L${arc.layerNum}`,
                    showlegend: true,
                    line: { color, width: 2, dash },
                    hovertemplate: `Layer ${arc.layerNum}${polLabel}<br>Re(Y): %{x:.5f}<br>Im(Y): %{y:.5f}<extra></extra>`
                });
                // Dot at the air-side endpoint of the arc (Y[k])
                const Y_L_re = arc.re[arc.re.length - 1];
                const Y_L_im = arc.im[arc.im.length - 1];
                traces.push({
                    x: [Y_L_re], y: [Y_L_im],
                    type: 'scatter', mode: 'markers',
                    showlegend: false,
                    legendgroup: `L${arc.layerNum}`,
                    marker: { symbol: 'circle', size: 6, color, line: { color: textColor, width: 1 } },
                    hovertemplate: `L${arc.layerNum} air side${polLabel}<br>Re(Y): %{x:.5f}<br>Im(Y): %{y:.5f}<extra></extra>`
                });
            }

            // η_s — substrate admittance (start of diagram)
            traces.push({
                x: [s.etaS[0]], y: [s.etaS[1]],
                type: 'scatter', mode: 'markers+text',
                name: `η_s${polLabel}`,
                showlegend: false,
                marker: { symbol: 'square', size: 10, color: '#ffca28', line: { color: textColor, width: 1 } },
                text: [s.pol === 'p' && isMultiPol ? '' : 'η_s'],
                textposition: 'top center',
                textfont: { color: '#ffca28', size: 11 },
                hovertemplate: `Substrate η_s${polLabel}<br>Re: %{x:.5f}<br>Im: %{y:.5f}<extra></extra>`
            });

            // Y[0] — final admittance (end of diagram)
            const Y0 = s.Y[0];
            traces.push({
                x: [Y0[0]], y: [Y0[1]],
                type: 'scatter', mode: 'markers+text',
                name: `Y₀${polLabel}`,
                showlegend: false,
                marker: { symbol: 'diamond', size: 10, color: '#66bb6a', line: { color: textColor, width: 1 } },
                text: [s.pol === 'p' && isMultiPol ? '' : 'Y₀'],
                textposition: 'top right',
                textfont: { color: '#66bb6a', size: 11 },
                hovertemplate: `Final Y₀${polLabel}<br>Re: %{x:.5f}<br>Im: %{y:.5f}<extra></extra>`
            });

            // η₀ — incident medium admittance (AR target)
            traces.push({
                x: [s.eta0[0]], y: [s.eta0[1]],
                type: 'scatter', mode: 'markers+text',
                name: `η₀${polLabel}`,
                showlegend: false,
                marker: { symbol: 'cross', size: 12, color: '#ef5350', line: { color: '#ef5350', width: 2 } },
                text: [s.pol === 'p' && isMultiPol ? '' : 'η₀'],
                textposition: 'bottom right',
                textfont: { color: '#ef5350', size: 11 },
                hovertemplate: `Incident medium η₀${polLabel}<br>Re: %{x:.5f}<br>Im: %{y:.5f}<extra></extra>`
            });
        }
        return traces;
    }, [series, matColorMap, textColor]);

    const rr = computeRobustRange(series);
    const layout = {
        margin: { l: 56, r: 16, t: 24, b: 48 },
        paper_bgcolor: paperColor,
        plot_bgcolor:  bgColor,
        font: { color: textColor, family: 'system-ui, -apple-system, sans-serif', size: 11 },
        xaxis: {
            title: { text: 'Re(Y)', standoff: 8 },
            gridcolor: gridColor, gridwidth: 1,
            zerolinecolor: gridColor, zeroline: true,
            tickfont: { size: 10 },
            scaleanchor: 'y', scaleratio: 1,
            // Robust default frame (see computeRobustRange) so a stopband spike
            // can't squash the diagram; modebar Autoscale still shows full extent.
            ...(rr ? { range: rr.xrange, autorange: false } : {})
        },
        yaxis: {
            title: { text: 'Im(Y)', standoff: 8 },
            gridcolor: gridColor, gridwidth: 1,
            zerolinecolor: gridColor, zeroline: true,
            tickfont: { size: 10 },
            ...(rr ? { range: rr.yrange, autorange: false } : {})
        },
        legend: {
            bgcolor: paperColor + 'cc', bordercolor: gridColor, borderwidth: 1,
            font: { size: 10 }, x: 1, xanchor: 'right', y: 1, yanchor: 'top',
            tracegroupgap: 2
        },
        hovermode: 'closest',
        autosize: true
    };

    const config = {
        displaylogo: false, responsive: true, displayModeBar: true,
        modeBarButtonsToRemove: ['select2d', 'lasso2d'],
        toImageButtonOptions: { format: 'png', filename: 'TFStudio_admittance', scale: 2 }
    };

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        Plotly.newPlot(divRef.current, buildTraces(), layout, config);
        initializedRef.current = true;
        const ro = new ResizeObserver(() => {
            if (divRef.current && initializedRef.current) Plotly.Plots.resize(divRef.current);
        });
        ro.observe(divRef.current);
        return () => {
            ro.disconnect();
            if (divRef.current) { Plotly.purge(divRef.current); }
            initializedRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (!divRef.current || !initializedRef.current || typeof Plotly === 'undefined') return;
        Plotly.react(divRef.current, buildTraces(), layout, config);
    }, [series, matColorMap, buildTraces]);

    useEffect(() => {
        if (!divRef.current || !initializedRef.current || typeof Plotly === 'undefined') return;
        Plotly.relayout(divRef.current, {
            paper_bgcolor: paperColor, plot_bgcolor: bgColor,
            'font.color': textColor,
            'xaxis.gridcolor': gridColor, 'yaxis.gridcolor': gridColor,
            'legend.bgcolor': paperColor + 'cc', 'legend.bordercolor': gridColor
        });
    }, [bgColor, paperColor, gridColor, textColor]);

    if (typeof Plotly === 'undefined') {
        return h('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim }
        }, 'Plotly not loaded — check index.html');
    }
    return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
}

// ── Control helpers ───────────────────────────────────────────────────────────

function NumInput({ value, onChange, min, max, step = 1, c, width = 68 }) {
    const [raw, setRaw] = useState(String(value));
    useEffect(() => { setRaw(String(value)); }, [value]);
    const commit = () => {
        const v = parseFloat(raw);
        if (!isNaN(v)) onChange(Math.min(Math.max(v, min ?? -Infinity), max ?? Infinity));
        else setRaw(String(value));
    };
    return h('input', {
        type: 'number', value: raw, min, max, step,
        onChange: e => setRaw(e.target.value),
        onBlur: commit,
        onKeyDown: e => { if (e.key === 'Enter') commit(); },
        style: {
            width, height: 22, backgroundColor: c.panel, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 3,
            fontSize: 12, padding: '0 4px', outline: 'none', textAlign: 'right',
            fontFamily: 'system-ui, -apple-system, sans-serif'
        }
    });
}

function PolBtn({ label, active, onClick, c }) {
    return h('button', {
        onClick,
        style: {
            padding: '2px 8px', fontSize: 11, cursor: 'pointer', outline: 'none',
            border: `1px solid ${active ? c.accent : c.border}`,
            borderRadius: 3, backgroundColor: active ? c.accent + '33' : 'transparent',
            color: active ? c.accent : c.textDim, userSelect: 'none',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: active ? 600 : 400, flexShrink: 0
        }
    }, label);
}

// ── Main export ───────────────────────────────────────────────────────────────

export function AdmittanceDiagram({ c, theme, t }) {
    const { design } = useDesign();

    const [lambda, setLambda] = useState(() => design?.referenceWavelength || 550);
    const [theta, setTheta]   = useState(0);
    const [pol, setPol]       = useState('avg');
    // Local Front/Back switch — this window picks which side's locus to trace,
    // independent of the design's evaluation mode. Default to 'front'.
    const [side, setSide]     = useState('front');

    // Side labels (localized, English fallback — no locales.js keys added).
    const frontLbl = (t && t.admittance && t.admittance.front) || 'Front';
    const backLbl  = (t && t.admittance && t.admittance.back)  || 'Back';

    // On mount / design switch: if the chosen front side is empty but the back
    // side has layers, default to 'back' so something is plotted.
    useEffect(() => {
        const hasFront = !!(design?.frontLayers?.length);
        const hasBack  = !!(design?.backLayers?.length);
        if (side === 'front' && !hasFront && hasBack) setSide('back');
    }, [design?.id]);

    const hasData = sideHasLayers(design, side);

    // Sync default wavelength when active design changes
    useEffect(() => {
        if (design?.referenceWavelength) setLambda(design.referenceWavelength);
    }, [design?.id]);

    // Build color map (stable per material set) for the chosen side's stack.
    const colorLayers = useMemo(
        () => sideStackLayers(design, side),
        [design, side]
    );
    const matColorMap = useMemo(
        () => buildMatColorMap(colorLayers),
        [colorLayers.map(l => l.material).join(',')]
    );

    // Compute admittance series
    const [series, setSeries] = useState(null);
    const [error, setError]   = useState(null);

    useEffect(() => {
        if (!hasData) { setSeries(null); setError(null); return; }
        try {
            const s = buildDiagramData(design, lambda, theta, pol, side);
            setSeries(s);
            setError(null);
        } catch (e) {
            setSeries(null);
            setError(e.message);
        }
    }, [design, lambda, theta, pol, side]);

    // Sidebar
    const sideW = 176;
    const sideStyle = {
        width: sideW, minWidth: 140, flexShrink: 0,
        borderRight: `1px solid ${c.border}`,
        display: 'flex', flexDirection: 'column', gap: 10,
        padding: '10px 10px', overflowY: 'auto',
        backgroundColor: c.panel,
        fontFamily: 'system-ui, -apple-system, sans-serif'
    };
    const secHead = {
        fontSize: 10, fontWeight: 700, color: c.textDim,
        textTransform: 'uppercase', letterSpacing: '0.06em',
        marginBottom: 2, userSelect: 'none'
    };
    const row = (label, children) => h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('div', { style: secHead }, label),
        children
    );

    // Valid layers (non-zero) for legend — drawn from whichever side(s) are active.
    const validLayers = colorLayers.filter(l => l.thickness > 0);
    // Gather material names
    const matName = {};
    for (const l of validLayers) {
        if (l.material && !matName[l.material]) {
            const m = resolveMaterial(l.material);
            matName[l.material] = m?.name || l.material;
        }
    }

    // Y₀ info from first polarization series
    const Y0 = series?.[0]?.Y?.[0];
    const etaS = series?.[0]?.etaS;

    // Tabular data — the admittance locus, one row per sampled arc point, built
    // from the SAME arc.re/arc.im arrays that AdmittanceChart plots as traces.
    const tableRows = useMemo(() => {
        if (!series?.length) return [];
        const isMultiPol = series.length > 1;
        const rows = [];
        for (const s of series) {
            const polLabel = isMultiPol ? ` (${s.pol})` : '';
            for (const arc of s.arcs) {
                const layerLabel = `L${arc.layerNum}${polLabel}`;
                const mat = matName[arc.material] || arc.material || '—';
                const len = Math.min(arc.re.length, arc.im.length);
                for (let j = 0; j < len; j++) {
                    rows.push({
                        layer: layerLabel,
                        material: mat,
                        re: arc.re[j],
                        im: arc.im[j],
                    });
                }
            }
        }
        return rows;
    }, [series]);

    const tableColumns = [
        { key: 'layer',    label: 'Layer',    align: 'left' },
        { key: 'material', label: 'Material', align: 'left' },
        { key: 're',       label: 'Re(Y)',    fmt: v => v.toFixed(5) },
        { key: 'im',       label: 'Im(Y)',    fmt: v => v.toFixed(5) },
    ];

    return h('div', { style: { display: 'flex', height: '100%', overflow: 'hidden', backgroundColor: c.bg } },

        // ── Sidebar ────────────────────────────────────────────────────────────
        h('div', { style: sideStyle },
            row('Side',
                h('div', { style: { display: 'flex', gap: 4 } },
                    h(PolBtn, { label: frontLbl, active: side === 'front', onClick: () => setSide('front'), c }),
                    h(PolBtn, { label: backLbl,  active: side === 'back',  onClick: () => setSide('back'),  c })
                )
            ),
            row('Wavelength',
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
                    h(NumInput, { value: lambda, onChange: setLambda, min: 100, max: 30000, step: 1, c }),
                    h('span', { style: { fontSize: 11, color: c.textDim } }, 'nm')
                )
            ),
            row('AOI',
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
                    h(NumInput, { value: theta, onChange: setTheta, min: 0, max: 89, step: 0.5, c }),
                    h('span', { style: { fontSize: 11, color: c.textDim } }, '°')
                )
            ),
            row('Polarization',
                h('div', { style: { display: 'flex', gap: 4 } },
                    h(PolBtn, { label: 'avg', active: pol === 'avg', onClick: () => setPol('avg'), c }),
                    h(PolBtn, { label: 's',   active: pol === 's',   onClick: () => setPol('s'),   c }),
                    h(PolBtn, { label: 'p',   active: pol === 'p',   onClick: () => setPol('p'),   c })
                )
            ),

            h('div', { style: { borderTop: `1px solid ${c.border}` } }),

            row('Layers',
                validLayers.length === 0
                    ? h('div', { style: { fontSize: 11, color: c.textDim } }, 'No layers')
                    : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
                        validLayers.map((l, i) =>
                            h('div', {
                                key: l.id || i,
                                style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }
                            },
                                h('div', {
                                    style: {
                                        width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                                        backgroundColor: matColorMap[l.material] || '#888',
                                        border: `1px solid ${c.border}`
                                    }
                                }),
                                h('span', { style: { color: c.textDim, minWidth: 18, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, i + 1),
                                h('span', { style: { color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 } },
                                    matName[l.material] || '—'
                                )
                            )
                        )
                    )
            ),

            h('div', { style: { borderTop: `1px solid ${c.border}` } }),

            // Numerical readout
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                h('div', { style: secHead }, 'Admittance'),
                Y0
                    ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                        h('div', { style: { fontSize: 10, color: c.textDim } }, 'Y₀ (final)'),
                        h('div', { style: { fontSize: 11, color: c.text, fontVariantNumeric: 'tabular-nums' } },
                            `${Y0[0].toFixed(4)} ${Y0[1] >= 0 ? '+' : '−'} ${Math.abs(Y0[1]).toFixed(4)}i`),
                        h('div', { style: { fontSize: 10, color: c.textDim, marginTop: 3 } }, 'η_s (substrate)'),
                        h('div', { style: { fontSize: 11, color: c.text, fontVariantNumeric: 'tabular-nums' } },
                            etaS
                                ? `${etaS[0].toFixed(4)} ${etaS[1] >= 0 ? '+' : '−'} ${Math.abs(etaS[1]).toFixed(4)}i`
                                : '—'
                        )
                    )
                    : h('div', { style: { fontSize: 11, color: c.textDim } }, '—')
            )
        ),

        // ── Chart + data panel (flex column) ─────────────────────────────────────
        h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
            // Chart fills the available area; flex:1 so Plotly autosize/resize keeps working
            h('div', { style: { flex: 1, position: 'relative', overflow: 'hidden', minHeight: 0 } },
                error
                    ? h('div', {
                        style: {
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            height: '100%', color: c.textDim, padding: 20, textAlign: 'center', fontSize: 13
                        }
                    }, `Calculation error: ${error}`)
                    : !hasData
                    ? h('div', {
                        style: {
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            height: '100%', color: c.textDim, fontSize: 13
                        }
                    }, side === 'back'
                        ? ((t && t.admittance && t.admittance.noBackLayers) || 'No back-side layers in active design')
                        : ((t && t.admittance && t.admittance.noLayers) || 'No layers in active design'))
                    : h(AdmittanceChart, { series, matColorMap, c, theme, t })
            ),
            // Collapsible "Data (text)" panel below the plot
            tableRows.length > 0 && h(DataTablePanel, { columns: tableColumns, rows: tableRows, c, t })
        )
    );
}
