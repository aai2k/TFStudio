/**
 * Ellipsometry Evaluation — Ψ(λ), Δ(λ)  (and Ψ, Δ vs angle of incidence).
 *
 * Physics: reflection ellipsometry, ρ = r_p / r_s = tan(Ψ)·exp(iΔ).
 * Reference: Macleod, Thin-Film Optical Filters 5th ed.,
 *   "Measurement of the Optical Properties" p. 553 and Eq. (16.2)
 *   Δ = φ_p − φ_s ± 180°.  See computeEllipsometry() in thinFilmMath.js
 *   for the full derivation and the Macleod→Fresnel sign-convention note.
 *
 * Spectral mode: Ψ,Δ vs wavelength;  Angular mode: Ψ,Δ vs incidence angle.
 */

import { useDesign }           from '../../state/DesignContext.js';
import { computeEllipsometry } from '../../utils/physics/thinFilmMath.js';
import { getMaterialById }     from '../../utils/materials/catalogManager.js';
import { getMaterial }         from '../../utils/materials/materialDatabase.js';
import { DataTablePanel }      from '../ui/DataTablePanel.js';

const { createElement: h, useState, useEffect, useCallback, useRef } = React;

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// ñ = n − ik convention used throughout thinFilmMath.js → store as [n, −k]
function nkAt(mat, lambda_nm) {
    const [nr, nk] = mat.getNK(lambda_nm);
    return [nr, -nk];
}

// Pick the layer stack + the two bounding media for the chosen side.
// Front: light enters from incidentMedium, hits frontLayers, then substrate.
// Back : light enters from exitMedium, hits backLayers (in reverse build
//        order so the deposition-order list reads outward→inward like the
//        front side), then substrate. Ellipsometry models a single coherent
//        reflection off one face of the part; substrate is treated as the
//        exit half-space (no incoherent backside contribution).
function sideLayersAt(design, side, lambda_nm) {
    const layers = side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
    const ordered = side === 'back' ? [...layers].reverse() : layers;
    return ordered
        .filter(l => l.material && l.thickness > 0)
        .map(l => ({ n: nkAt(resolveMaterial(l.material), lambda_nm), d: l.thickness }));
}

function sideMedia(design, side) {
    return side === 'back'
        ? { n0Id: design.exitMedium, nsId: design.substrate?.material }
        : { n0Id: design.incidentMedium, nsId: design.substrate?.material };
}

// ── Sweep computation ─────────────────────────────────────────────────────────

function computeSpectral(design, side, lamStart, lamEnd, lamStep, theta_deg) {
    const { n0Id, nsId } = sideMedia(design, side);
    const n0mat = resolveMaterial(n0Id);
    const nsmat = resolveMaterial(nsId);
    const x = [], psi = [], delta = [];
    for (let lam = lamStart; lam <= lamEnd + 1e-9; lam += lamStep) {
        const L = Math.round(lam * 1000) / 1000;
        const layers = sideLayersAt(design, side, L);
        const e = computeEllipsometry(L, theta_deg, nkAt(n0mat, L), nkAt(nsmat, L), layers);
        x.push(L); psi.push(e.psi); delta.push(e.delta);
    }
    return { x, psi, delta, xLabel: 'Wavelength (nm)' };
}

function computeAngular(design, side, lambda_nm, aoiStart, aoiEnd, aoiStep) {
    const { n0Id, nsId } = sideMedia(design, side);
    const n0mat = resolveMaterial(n0Id);
    const nsmat = resolveMaterial(nsId);
    const n0 = nkAt(n0mat, lambda_nm);
    const ns = nkAt(nsmat, lambda_nm);
    const layers = sideLayersAt(design, side, lambda_nm);
    const x = [], psi = [], delta = [];
    for (let a = aoiStart; a <= aoiEnd + 1e-9; a += aoiStep) {
        const A = Math.round(a * 1000) / 1000;
        const e = computeEllipsometry(lambda_nm, A, n0, ns, layers);
        x.push(A); psi.push(e.psi); delta.push(e.delta);
    }
    return { x, psi, delta, xLabel: 'Angle of incidence (°)' };
}

// ── Plotly dual-axis chart ────────────────────────────────────────────────────

function EllipsoChart({ data, c }) {
    const divRef  = useRef(null);
    const initRef = useRef(false);

    const bgColor    = c.bg     || '#1e1e1e';
    const paperColor = c.panel  || '#252526';
    const gridColor  = c.border || '#3a3a3a';
    const textColor  = c.text   || '#cccccc';

    const PSI_COLOR   = '#4fc3f7';   // Ψ — left axis
    const DELTA_COLOR = '#ef5350';   // Δ — right axis

    useEffect(() => {
        if (!divRef.current || !data) return;
        const traces = [
            {
                x: data.x, y: data.psi, type: 'scatter', mode: 'lines',
                name: 'Ψ', yaxis: 'y',
                line: { color: PSI_COLOR, width: 2 },
                hovertemplate: 'Ψ: %{y:.3f}°<br>%{x:.3f}<extra></extra>'
            },
            {
                x: data.x, y: data.delta, type: 'scatter', mode: 'lines',
                name: 'Δ', yaxis: 'y2',
                line: { color: DELTA_COLOR, width: 2 },
                hovertemplate: 'Δ: %{y:.3f}°<br>%{x:.3f}<extra></extra>'
            },
        ];
        const layout = {
            paper_bgcolor: paperColor,
            plot_bgcolor:  bgColor,
            margin: { l: 56, r: 56, t: 12, b: 46 },
            showlegend: true,
            legend: { x: 0.5, xanchor: 'center', y: 1.0, orientation: 'h',
                      font: { size: 11, color: textColor }, bgcolor: 'transparent' },
            xaxis: {
                title: { text: data.xLabel, font: { color: textColor, size: 12 } },
                color: textColor, gridcolor: gridColor, zerolinecolor: gridColor,
                tickfont: { color: textColor, size: 11 }
            },
            yaxis: {
                title: { text: 'Ψ (°)', font: { color: PSI_COLOR, size: 12 } },
                range: [0, 90], color: PSI_COLOR, gridcolor: gridColor,
                zerolinecolor: gridColor, tickfont: { color: PSI_COLOR, size: 11 }
            },
            yaxis2: {
                title: { text: 'Δ (°)', font: { color: DELTA_COLOR, size: 12 } },
                range: [0, 360], dtick: 60, overlaying: 'y', side: 'right',
                color: DELTA_COLOR, tickfont: { color: DELTA_COLOR, size: 11 },
                showgrid: false
            },
        };
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, traces, layout);
        }
    }, [data, bgColor, paperColor, gridColor, textColor]);

    useEffect(() => {
        const el = divRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el);
        return () => { ro.disconnect(); if (el) Plotly.purge(el); };  // purge on unmount (leak fix)
    }, []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}

// ── Commit-on-blur number input ───────────────────────────────────────────────
// Plain `<input type="number" value={n}>` forces a digit on every keystroke
// (clearing the box is rejected because parseFloat("") is NaN), which makes
// editing painful. This wrapper keeps a local string so the user can clear,
// type freely, and commit on blur / Enter; invalid text snaps back to the
// last committed value.
function NumInput({ value, setter, min, max, step, width, c }) {
    const [raw, setRaw] = useState(String(value));
    const editingRef = useRef(false);
    useEffect(() => {
        if (!editingRef.current) setRaw(String(value));
    }, [value]);
    const commit = () => {
        editingRef.current = false;
        const v = parseFloat(raw);
        if (isFinite(v)) {
            const clamped = Math.max(min, Math.min(max, v));
            setter(clamped);
            setRaw(String(clamped));
        } else {
            setRaw(String(value));
        }
    };
    return h('input', {
        type: 'text', inputMode: 'decimal', value: raw,
        onFocus: () => { editingRef.current = true; },
        onChange: e => setRaw(e.target.value),
        onBlur: commit,
        onKeyDown: e => {
            if (e.key === 'Enter') { e.target.blur(); }
            else if (e.key === 'Escape') { setRaw(String(value)); editingRef.current = false; e.target.blur(); }
        },
        style: {
            background: c.inputBg || c.hover, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 3,
            padding: '1px 4px', fontSize: 12, width: width || 58,
            marginLeft: 6,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            outline: 'none', textAlign: 'right',
            fontVariantNumeric: 'tabular-nums'
        }
    });
}

export function EllipsometryEvaluation({ c, theme, t }) {
    const el = t.ellipsometry;
    const { design } = useDesign();

    const [mode,     setMode]     = useState('spectral'); // 'spectral' | 'angular'
    const [side,     setSide]     = useState('front');    // 'front' | 'back'
    const [lamStart, setLamStart] = useState(400);
    const [lamEnd,   setLamEnd]   = useState(800);
    const [lamStep,  setLamStep]  = useState(2);
    const [theta,    setTheta]    = useState(65);  // common ellipsometer angle
    const [lambda,   setLambda]   = useState(() => design?.referenceWavelength || 550);
    const [aoiStart, setAoiStart] = useState(45);
    const [aoiEnd,   setAoiEnd]   = useState(80);
    const [aoiStep,  setAoiStep]  = useState(0.5);

    const [data, setData] = useState(null);

    useEffect(() => {
        if (design?.referenceWavelength) setLambda(design.referenceWavelength);
    }, [design?.id]);

    // If the active side has no layers, fall back to one that does, so the
    // plot doesn't go blank just because the user toggled to a bare side.
    useEffect(() => {
        if (!design) return;
        const has = (sd) => {
            const arr = sd === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
            return arr.some(l => l.material && l.thickness > 0);
        };
        if (!has(side)) {
            if (side === 'front' && has('back')) setSide('back');
            else if (side === 'back' && has('front')) setSide('front');
        }
    }, [design?.id]);

    useEffect(() => {
        if (!design) { setData(null); return; }
        try {
            if (mode === 'spectral') {
                const s = Math.max(1, Math.min(lamStep, Math.abs(lamEnd - lamStart) || 1));
                setData(computeSpectral(design, side, Math.min(lamStart, lamEnd),
                                        Math.max(lamStart, lamEnd), s, theta));
            } else {
                const s = Math.max(0.05, Math.min(aoiStep, Math.abs(aoiEnd - aoiStart) || 1));
                setData(computeAngular(design, side, lambda, Math.min(aoiStart, aoiEnd),
                                       Math.min(89.5, Math.max(aoiStart, aoiEnd)), s));
            }
        } catch (e) {
            console.error('Ellipsometry computation failed:', e);
            setData(null);
        }
    }, [design, mode, side, lamStart, lamEnd, lamStep, theta, lambda, aoiStart, aoiEnd, aoiStep]);

    // ── Empty states ──────────────────────────────────────────────────────────
    const centerBox = (msg) => h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontFamily: 'system-ui, -apple-system, sans-serif'
        }
    }, msg);

    if (!design) return centerBox(el.noDesign);
    const sideLayers = side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
    const validLayers = sideLayers.filter(l => l.material && l.thickness > 0);

    // ── Styles ────────────────────────────────────────────────────────────────
    const labelStyle = {
        color: c.textDim, fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
        whiteSpace: 'nowrap'
    };
    const tabBtn = (active) => ({
        padding: '2px 10px',
        background: active ? c.accent : (c.inputBg || c.hover),
        color: active ? '#fff' : c.text,
        border: `1px solid ${active ? c.accent : c.border}`,
        borderRadius: 3, cursor: 'pointer', fontSize: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif'
    });
    const segBtn = (active, position) => ({
        padding: '2px 10px', fontSize: 12, cursor: 'pointer', outline: 'none',
        border: `1px solid ${active ? c.accent : c.border}`,
        borderRadius: position === 'first' ? '3px 0 0 3px'
                    : position === 'last'  ? '0 3px 3px 0' : '0',
        marginLeft: position === 'first' ? 0 : -1,
        background: active ? c.accent + '33' : (c.inputBg || c.hover),
        color: active ? c.accent : c.text,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontWeight: active ? 600 : 400,
        position: 'relative', zIndex: active ? 1 : 0
    });
    const numField = (label, value, setter, min, max, step, width) =>
        h('label', { style: labelStyle }, label,
            h(NumInput, { value, setter, min, max, step, width, c })
        );

    const totalThk = validLayers.reduce((s, l) => s + l.thickness, 0);
    const layerCount = validLayers.length;

    // ── Data-table (text) columns + rows ───────────────────────────────────────
    // Column 1 is the swept variable: wavelength in spectral mode, AOI in
    // angular mode. Ψ and Δ are taken verbatim from the same arrays the plot
    // uses (display formatting only — values are never altered here).
    const xCol = mode === 'spectral'
        ? { key: 'x', label: 'λ (nm)',  align: 'left', fmt: v => v.toFixed(2) }
        : { key: 'x', label: 'AOI (°)', align: 'left', fmt: v => v.toFixed(2) };
    const tableColumns = [
        xCol,
        { key: 'psi',   label: 'Ψ (°)', fmt: v => v.toFixed(4) },
        { key: 'delta', label: 'Δ (°)', fmt: v => v.toFixed(4) },
    ];
    const tableRows = (data && data.x)
        ? data.x.map((xv, i) => ({ x: xv, psi: data.psi[i], delta: data.delta[i] }))
        : [];

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
            // Mode tabs
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } },
                h('span', { style: { ...labelStyle, marginRight: 3 } }, el.mode + ':'),
                h('button', { onClick: () => setMode('spectral'), style: tabBtn(mode === 'spectral') }, el.spectral),
                h('button', { onClick: () => setMode('angular'),  style: tabBtn(mode === 'angular')  }, el.angular)
            ),

            // Side selector (Front / Back). "Total" is not a standard
            // ellipsometric quantity — it requires incoherent backside
            // reflection modelling, which is left for a future addition.
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } },
                h('span', { style: { ...labelStyle, marginRight: 3 } }, (el.side || 'Side') + ':'),
                h('button', { onClick: () => setSide('front'),
                              style: tabBtn(side === 'front') }, el.modeFront || 'Front'),
                h('button', { onClick: () => setSide('back'),
                              style: tabBtn(side === 'back') }, el.modeBack || 'Back')
            ),

            // Mode-specific inputs
            mode === 'spectral'
                ? [
                    numField(el.lamStart, lamStart, setLamStart, 100, 30000, 10),
                    numField(el.lamEnd,   lamEnd,   setLamEnd,   100, 30000, 10),
                    numField(el.lamStep,  lamStep,  setLamStep,  0.1, 1000, 1, 46),
                    numField(el.aoi,      theta,    setTheta,    0,   89,   1, 46),
                  ]
                : [
                    numField(el.wavelength, lambda,   setLambda,   100, 30000, 10),
                    numField(el.aoiStart,   aoiStart, setAoiStart, 0,   89.5, 1, 46),
                    numField(el.aoiEnd,     aoiEnd,   setAoiEnd,   0,   89.5, 1, 46),
                    numField(el.aoiStep,    aoiStep,  setAoiStep,  0.05, 45, 0.5, 46),
                  ],

            // Readout
            h('span', { style: { ...labelStyle, marginLeft: 'auto', color: c.text } },
                `${el.layersLabel}: ${layerCount}  |  ${el.totalThk}: ${totalThk.toFixed(1)} nm`
            )
        ),

        // ── Chart + data-table (text) ─────────────────────────────────────────
        h('div', {
            style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
        },
            h('div', { style: { flex: 1, minHeight: 0, overflow: 'hidden' } },
                (validLayers.length && data && data.x.length)
                    ? h(EllipsoChart, { data, c })
                    : centerBox(el.noLayers)
            ),
            (validLayers.length && data && data.x.length)
                ? h(DataTablePanel, { columns: tableColumns, rows: tableRows, c, t })
                : null
        ),
    );
}
