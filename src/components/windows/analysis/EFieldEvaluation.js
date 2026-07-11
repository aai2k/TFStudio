/**
 * Electric Field Profile — |E(z)|² vs depth.
 *
 * Physics: left-partial transfer matrix method.
 * Reference: Macleod, Thin-Film Optical Filters §3, Eqs. 3.5–3.6.
 *
 * Normalization: |E_inc|² = 1.0 = 100%.  HR stacks can reach 400% in the
 * incident medium because |1 + r|² ≤ 4 when |r| → 1.
 */

import { useDesign }           from '../../../state/DesignContext.js';
import { computeEFieldProfile } from '../../../utils/physics/thinFilmMath.js';
import { getMaterialById, resolveColor }     from '../../../utils/materials/catalogManager.js';
import { getMaterial }         from '../../../utils/materials/materialDatabase.js';
import { DataTablePanel }      from '../../ui/DataTablePanel.js';

const { createElement: h, useState, useEffect, useRef } = React;

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

function buildMatColorMap(layers) {
    const map = {};
    for (const l of layers) {
        const key = l.materialId || l.material;
        if (key && !map[key]) {
            const mat = resolveMaterial(key);
            map[key] = mat ? resolveColor(mat) : '#555555';
        }
    }
    return map;
}

// ── E-field computation ───────────────────────────────────────────────────────

const NPTS = 60; // sample points per layer

// Build a single-side |E|² profile.
//
//   side === 'front': light enters from the incident medium, propagates through
//     the front stack in stored order, exits into the substrate.
//       n0 = incidentMedium, ns = substrate, layers = frontLayers (stored order)
//
//   side === 'back':  light enters from the exit medium, propagates through the
//     back stack toward the substrate. The back stack is stored substrate→exit,
//     so it must be reversed so the exit medium is first (Ellipsometry/Tolerance
//     per-side convention).
//       n0 = exitMedium, ns = substrate, layers = backLayers reversed
//
// Indices are fed as ñ = n + ik (k ≥ 0 absorbing), matching thinFilmMath.js, so
// the field decays through absorbing layers (a negated k would make it grow).
function computeProfile(design, lambda_nm, theta_deg, pol, side = 'front') {
    if (!design) return null;

    const srcLayers = side === 'back' ? design.backLayers : design.frontLayers;
    if (!srcLayers?.length) return null;

    const incidentId = side === 'back' ? design.exitMedium : design.incidentMedium;
    const n0mat = resolveMaterial(incidentId);
    const nsmat = resolveMaterial(design.substrate?.material);

    const n0raw = n0mat.getNK(lambda_nm);
    const nsraw = nsmat.getNK(lambda_nm);
    const n0 = [n0raw[0], n0raw[1]];  // ñ = n + ik (absorbing, k ≥ 0)
    const ns = [nsraw[0], nsraw[1]];

    // Back stack is stored substrate→exit; reverse so the exit (incident) medium
    // is first, matching the propagation order computeEFieldProfile expects.
    const ordered = side === 'back' ? [...srcLayers].reverse() : srcLayers;

    const validLayers = ordered
        .filter(l => l.material && l.thickness > 0)
        .map(l => {
            const mat = resolveMaterial(l.material);
            const [nr, nk] = mat.getNK(lambda_nm);
            return { n: [nr, nk], d: l.thickness, materialId: l.material };
        });

    if (!validLayers.length) return null;

    const layerInput = validLayers.map(({ n, d }) => ({ n, d }));

    if (pol === 'avg') {
        const s = computeEFieldProfile(lambda_nm, theta_deg, 's', n0, ns, layerInput, NPTS);
        const p = computeEFieldProfile(lambda_nm, theta_deg, 'p', n0, ns, layerInput, NPTS);
        // average pointwise (same z grid because same layers + NPTS)
        const e2avg = s.e2.map((v, i) => (v + p.e2[i]) / 2);
        return { s, p, avg: { ...s, e2: e2avg }, validLayers, side };
    }

    const result = computeEFieldProfile(lambda_nm, theta_deg, pol, n0, ns, layerInput, NPTS);
    return { [pol]: result, validLayers, side };
}

// ── Plotted-curve selection (shared by chart + data table) ──────────────────────
// Mirrors EFieldChart.buildTraces / addCurve: each curve carries the z grid and
// the |E|² values exactly as plotted (e2 * 100, in %). Display-only.
function selectPlottedCurves(profileData, pol) {
    if (!profileData) return [];
    const curves = [];
    const push = (e2arr, z, label) => {
        if (!e2arr || !z) return;
        curves.push({ label, z, y: e2arr.map(v => v * 100) });
    };
    if (pol === 'avg' && profileData.avg) {
        push(profileData.avg.e2, profileData.avg.z, '|E|² (avg)');
        push(profileData.s.e2,   profileData.s.z,   '|E|² (s)');
        push(profileData.p.e2,   profileData.p.z,   '|E|² (p)');
    } else if (pol === 's' && profileData.s) {
        push(profileData.s.e2, profileData.s.z, '|E|² (s)');
    } else if (pol === 'p' && profileData.p) {
        push(profileData.p.e2, profileData.p.z, '|E|² (p)');
    }
    return curves;
}

// ── Plotly chart ──────────────────────────────────────────────────────────────

function efieldTraces(profileData, pol) {
    if (!profileData) return [];
    const traces = [];

    const addCurve = (e2arr, z, label, color, dash) => {
        traces.push({
            x: z,
            y: e2arr.map(v => v * 100), // normalize to %
            type: 'scatter',
            mode: 'lines',
            name: label,
            line: { color, width: 2, dash: dash || 'solid' },
            hovertemplate: `${label}<br>z: %{x:.1f} nm<br>|E|²: %{y:.1f}%<extra></extra>`
        });
    };

    if (pol === 'avg' && profileData.avg) {
        addCurve(profileData.avg.e2, profileData.avg.z, '|E|² (avg)', '#66bb6a');
        addCurve(profileData.s.e2, profileData.s.z, '|E|² (s)', '#4fc3f7', 'dot');
        addCurve(profileData.p.e2, profileData.p.z, '|E|² (p)', '#ef5350', 'dash');
    } else if (pol === 's' && profileData.s) {
        addCurve(profileData.s.e2, profileData.s.z, '|E|² (s)', '#4fc3f7');
    } else if (pol === 'p' && profileData.p) {
        addCurve(profileData.p.e2, profileData.p.z, '|E|² (p)', '#ef5350');
    }

    // Layer boundary vertical lines are drawn as layout shapes, not traces.
    return traces;
}

function efieldLayout(profileData, pol, matColorMap, colors) {
    const { bgColor, paperColor, gridColor, textColor, accentColor } = colors;
    const profileRef = pol === 'avg' ? profileData?.avg : profileData?.[pol];
    const bounds = profileRef?.layerBounds || [];
    const totalZ  = bounds.length > 1 ? bounds[bounds.length - 1] : 0;
    const shapes = bounds.slice(1, -1).map(b => ({
        type: 'line',
        x0: b, x1: b,
        y0: 0, y1: 1,
        yref: 'paper',
        line: { color: gridColor, width: 1, dash: 'dot' }
    }));
    // 100% reference line
    shapes.push({
        type: 'line',
        x0: 0, x1: 1, xref: 'paper',
        y0: 100, y1: 100,
        line: { color: accentColor + '88', width: 1, dash: 'dot' }
    });
    // Translucent layer bands drawn behind the E-field curve
    const validLayers = profileData?.validLayers || [];
    for (let k = 0; k < validLayers.length && k + 1 < bounds.length; k++) {
        const color = matColorMap[validLayers[k]?.materialId] || '#555555';
        shapes.push({
            type: 'rect',
            x0: bounds[k], x1: bounds[k + 1],
            xref: 'x',
            y0: 0, y1: 1,
            yref: 'paper',
            fillcolor: color,
            opacity: 0.13,
            layer: 'below',
            line: { width: 0 }
        });
    }

    return {
        paper_bgcolor: paperColor,
        plot_bgcolor:  bgColor,
        margin: { l: 55, r: 16, t: 10, b: 45 },
        showlegend: true,
        legend: { x: 1, xanchor: 'right', y: 1, font: { size: 11, color: textColor }, bgcolor: 'transparent' },
        xaxis: {
            range: totalZ > 0 ? [0, totalZ] : undefined,
            autorange: totalZ <= 0,
            title: { text: 'Depth (nm)', font: { color: textColor, size: 12 } },
            color: textColor, gridcolor: gridColor, zerolinecolor: gridColor,
            tickfont: { color: textColor, size: 11 }
        },
        yaxis: {
            title: { text: '|E|² (%)', font: { color: textColor, size: 12 } },
            color: textColor, gridcolor: gridColor, zerolinecolor: gridColor,
            tickfont: { color: textColor, size: 11 },
            rangemode: 'tozero'
        },
        shapes,
    };
}

function EFieldChart({ profileData, pol, matColorMap, c }) {
    const divRef  = useRef(null);
    const initRef = useRef(false);

    const colors = {
        bgColor:     c.bg     || '#1e1e1e',
        paperColor:  c.panel  || '#252526',
        gridColor:   c.border || '#3a3a3a',
        textColor:   c.text   || '#cccccc',
        accentColor: c.accent || '#007acc',
    };

    useEffect(() => {
        if (!divRef.current) return;
        const traces = efieldTraces(profileData, pol);
        const layout = efieldLayout(profileData, pol, matColorMap, colors);
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, traces, layout);
        }
    }, [profileData, pol, matColorMap, c]);   // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const el = divRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el);
        return () => { ro.disconnect(); if (el) Plotly.purge(el); };  // purge on unmount (leak fix)
    }, []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}

// ── Main component ────────────────────────────────────────────────────────────

export function EFieldEvaluation({ c, theme, t }) {
    const ef = t.eField;
    const { design } = useDesign();

    const [lambda,    setLambda]    = useState(() => design?.referenceWavelength || 550);
    const [lambdaStr, setLambdaStr] = useState(() => String(design?.referenceWavelength || 550));
    const [theta,     setTheta]     = useState(0);
    const [pol,       setPol]       = useState('avg');
    // Local Front/Back switch — which coherent stack's |E|² profile to compute.
    const [side,      setSide]      = useState('front');

    // Sync wavelength when active design changes
    useEffect(() => {
        if (design?.referenceWavelength) {
            setLambda(design.referenceWavelength);
            setLambdaStr(String(design.referenceWavelength));
        }
    }, [design?.id]);

    // On design change, default to 'back' when the front stack is empty but the
    // back stack has layers (so the window shows something useful on mount).
    useEffect(() => {
        if (!design) return;
        const hasFront = !!design.frontLayers?.length;
        const hasBack  = !!design.backLayers?.length;
        if (!hasFront && hasBack) setSide('back');
        else if (hasFront)        setSide('front');
    }, [design?.id]);

    const [profile,  setProfile]  = useState(null);
    const [matColorMap, setMatColorMap] = useState({});

    // Recompute on any parameter, design, or Front/Back side change.
    //  - 'front' → |E(z)|² through the front stack only
    //  - 'back'  → |E(z)|² through the back stack only (light from exit medium)
    useEffect(() => {
        if (!design) { setProfile(null); return; }
        const result = computeProfile(design, lambda, theta, pol, side);
        setProfile(result);
        if (result?.validLayers) {
            setMatColorMap(buildMatColorMap(result.validLayers));
        } else {
            setMatColorMap({});
        }
    }, [design, lambda, theta, pol, side]);

    // ── Info readouts ─────────────────────────────────────────────────────────
    const profileForInfo = profile
        ? (pol === 'avg' ? profile.avg : profile[pol])
        : null;
    const maxE2pct = profileForInfo
        ? (Math.max(...profileForInfo.e2) * 100).toFixed(1)
        : '—';
    const totalThkNm = profileForInfo?.layerBounds
        ? profileForInfo.layerBounds[profileForInfo.layerBounds.length - 1].toFixed(1)
        : '—';
    const layerCount = profile?.validLayers?.length ?? 0;

    // ── Render ────────────────────────────────────────────────────────────────
    if (!design) {
        return h('div', {
            style: {
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: c.textDim, fontSize: 13, fontFamily: 'system-ui, -apple-system, sans-serif'
            }
        }, ef.noDesign);
    }

    // NOTE: do NOT early-return when the selected side has no layers — that would
    // remove the controls bar (including the Side switch) and trap the user on an
    // empty side. The controls always render; computeProfile returns null for an
    // empty side and the chart area below shows the no-layers placeholder instead.

    const labelStyle = {
        color: c.textDim, fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
        whiteSpace: 'nowrap'
    };
    const inputStyle = {
        background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        padding: '1px 4px', fontSize: 12, width: 64,
        fontFamily: 'system-ui, -apple-system, sans-serif'
    };
    const polBtnStyle = (active) => ({
        padding: '2px 10px',
        background: active ? c.accent : (c.inputBg || c.hover),
        color: active ? '#fff' : c.text,
        border: `1px solid ${active ? c.accent : c.border}`,
        borderRadius: 3, cursor: 'pointer', fontSize: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif'
    });

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column',
            width: '100%', height: '100%', overflow: 'hidden',
            backgroundColor: c.bg, color: c.text
        }
    },
        // ── Controls bar ───────────────────────────────────────────────────────
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
                padding: '5px 8px', borderBottom: `1px solid ${c.border}`,
                backgroundColor: c.panel, flexWrap: 'wrap'
            }
        },
            // Wavelength
            h('label', { style: labelStyle }, ef.wavelength,
                h('input', {
                    type: 'number', min: 100, max: 10000, step: 10,
                    value: lambdaStr,
                    onChange: e => setLambdaStr(e.target.value),
                    onBlur: e => {
                        const v = parseFloat(e.target.value);
                        const clamped = isNaN(v) ? lambda : Math.max(100, Math.min(10000, v));
                        setLambda(clamped);
                        setLambdaStr(String(clamped));
                    },
                    onKeyDown: e => { if (e.key === 'Enter') e.target.blur(); },
                    style: { ...inputStyle, marginLeft: 6 }
                })
            ),
            // AOI
            h('label', { style: labelStyle }, ef.aoi,
                h('input', {
                    type: 'number', min: 0, max: 89, step: 1,
                    value: theta,
                    onChange: e => setTheta(Math.max(0, Math.min(89, parseFloat(e.target.value) || 0))),
                    style: { ...inputStyle, width: 48, marginLeft: 6 }
                })
            ),
            // Polarization buttons — label and buttons stay together on wrap
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } },
                h('span', { style: { ...labelStyle, marginRight: 3 } }, ef.polarization + ':'),
                ['s', 'p', 'avg'].map(p =>
                    h('button', { key: p, onClick: () => setPol(p), style: polBtnStyle(pol === p) },
                        p === 's' ? ef.polS : p === 'p' ? ef.polP : ef.polAvg
                    )
                )
            ),
            // Front/Back side switch — local to this window
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } },
                h('span', { style: { ...labelStyle, marginRight: 3 } }, (ef.side || 'Side') + ':'),
                [['front', ef.front || 'Front'], ['back', ef.back || 'Back']].map(([s, lbl]) =>
                    h('button', { key: s, onClick: () => setSide(s), style: polBtnStyle(side === s) }, lbl)
                )
            ),
            // Readouts
            h('span', { style: { ...labelStyle, marginLeft: 'auto', color: c.text } },
                `${ef.maxLabel}: ${maxE2pct}%  |  ${ef.layersLabel}: ${layerCount}  |  ${ef.totalThk}: ${totalThkNm} nm`
            )
        ),

        // ── Chart + data panel ──────────────────────────────────────────────────
        h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
            h('div', { style: { flex: 1, minHeight: 0, overflow: 'hidden' } },
                profile
                    ? h(EFieldChart, { profileData: profile, pol, matColorMap, c })
                    : h('div', {
                        style: {
                            width: '100%', height: '100%',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: c.textDim, fontSize: 13,
                            fontFamily: 'system-ui, -apple-system, sans-serif'
                        }
                    }, ef.noLayers)
            ),
            profile && (() => {
                const curves = selectPlottedCurves(profile, pol);
                if (!curves.length) return null;
                const zArr = curves[0].z;
                const columns = [
                    { key: 'z', label: 'z (nm)', align: 'left', fmt: v => v.toFixed(1) },
                    ...curves.map((cv, i) => ({ key: 'c' + i, label: cv.label, fmt: v => (v == null ? '' : v.toFixed(4)) })),
                ];
                const rows = zArr.map((z, i) => {
                    const row = { z };
                    curves.forEach((cv, j) => { row['c' + j] = cv.y[i]; });
                    return row;
                });
                return h(DataTablePanel, { columns, rows, c, t });
            })()
        ),

    );
}
