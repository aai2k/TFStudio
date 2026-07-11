/**
 * Group Delay & GDD Evaluation — φ(λ), GD(λ), GDD(λ), TOD(λ).
 *
 * Physics: phase change on reflection / transmission and its frequency
 * derivatives. Reference: H. A. Macleod, Thin-Film Optical Filters 5th ed.,
 * Chapter 11 "Ultrafast Coatings", Eq. (11.17):
 *     GD  = −dφ/dω   (fs)      GDD = −d²φ/dω²  (fs²)     TOD = −d³φ/dω³  (fs³)
 * φ = arg(r) or arg(t), ω = 2πc/λ.  See computeGroupDelaySpectrum() in
 * thinFilmMath.js for the numerical scheme and sign convention.
 */

import { useDesign }                from '../../../state/DesignContext.js';
import { tmmWithAdmittances,
         computeGroupDelaySpectrum } from '../../../utils/physics/thinFilmMath.js';
import { getMaterialById }          from '../../../utils/materials/catalogManager.js';
import { getMaterial }              from '../../../utils/materials/materialDatabase.js';
import { DataTablePanel }           from '../../ui/DataTablePanel.js';
import { DebouncedInput }           from '../../ui/DebouncedInput.js';
import { Checkbox }                  from '../../ui/Checkbox.js';

const { createElement: h, useState, useEffect, useRef } = React;

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// thinFilmMath.js uses ñ = n + ik (k ≥ 0 absorbing); feed k with its native
// positive sign so absorbing stacks conserve energy (a negated k would make the
// TMM report gain). computeGroupDelaySpectrum handles the phase sign internally.
function nkAt(mat, lambda_nm) {
    const [nr, nk] = mat.getNK(lambda_nm);
    return [nr, nk];
}

// Quantity metadata: which array, axis label, hover unit, decimals.
function quantityMeta(q, t) {
    switch (q) {
        case 'phase': return { key: 'phaseDeg', label: t.phaseAxis, unit: '°',   dp: 2, color: '#ab47bc' };
        case 'gd':    return { key: 'gd',       label: t.gdAxis,    unit: 'fs',  dp: 3, color: '#4fc3f7' };
        case 'gdd':   return { key: 'gdd',      label: t.gddAxis,   unit: 'fs²', dp: 3, color: '#ef5350' };
        case 'tod':   return { key: 'tod',      label: t.todAxis,   unit: 'fs³', dp: 3, color: '#66bb6a' };
        default:      return { key: 'gd',       label: t.gdAxis,    unit: 'fs',  dp: 3, color: '#4fc3f7' };
    }
}

// ── Per-side stack helpers (proven convention from EllipsometryEvaluation.js) ──
// Front side: incidentMedium as n0 + frontLayers (stored order).
// Back  side: exitMedium as n0 + [...backLayers].reverse() (substrate→exit order).
// Substrate (ns) is design.substrate.material for both sides.

function sideLayersAt(design, side, lambda_nm) {
    const layers = side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
    const ordered = side === 'back' ? [...layers].reverse() : layers;
    return ordered
        .filter(l => l.material && l.thickness > 0)
        .map(l => ({ n: nkAt(resolveMaterial(l.material), lambda_nm), d: l.thickness }));
}

function sideMedia(design, side) {
    return side === 'back'
        ? { n0Id: design.exitMedium,     nsId: design.substrate?.material }
        : { n0Id: design.incidentMedium, nsId: design.substrate?.material };
}

// ── Spectral computation ──────────────────────────────────────────────────────

// Computes φ/GD/GDD/TOD for ONE side. computeGroupDelaySpectrum is side-agnostic
// — it operates on r or t of whichever side's TMM the sampler returns.
function computeSpectral(design, side, lamStart, lamEnd, lamStep, theta_deg, pol, target) {
    const { n0Id, nsId } = sideMedia(design, side);
    const n0mat = resolveMaterial(n0Id);
    const nsmat = resolveMaterial(nsId);

    // Sampler: complex r (reflection) or t (transmission) at one wavelength.
    const coeffAtLambda = (lambda_nm) => {
        const L = Math.round(lambda_nm * 1000) / 1000;
        const layers = sideLayersAt(design, side, L);
        const res = tmmWithAdmittances(
            L, theta_deg, pol, nkAt(n0mat, L), nkAt(nsmat, L), layers);
        return target === 'T' ? res.t : res.r;
    };

    const span = Math.abs(lamEnd - lamStart);
    const nPts = Math.max(5, Math.round(span / Math.max(lamStep, 1e-6)) + 1);
    return computeGroupDelaySpectrum(coeffAtLambda, lamStart, lamEnd, nPts);
}

// ── Plotly chart ──────────────────────────────────────────────────────────────

// Single dataset { lambda, y } for the currently selected surface side.
function GDChart({ data, meta, refLambda, showRef, c }) {
    const divRef  = useRef(null);
    const initRef = useRef(false);

    const bgColor    = c.bg     || '#1e1e1e';
    const paperColor = c.panel  || '#252526';
    const gridColor  = c.border || '#3a3a3a';
    const textColor  = c.text   || '#cccccc';

    useEffect(() => {
        if (!divRef.current || !data) return;
        const traces = [{
            x: data.lambda, y: data.y, type: 'scatter', mode: 'lines',
            name: meta.label, line: { color: meta.color, width: 2 },
            hovertemplate: `%{y:.${meta.dp}f} ${meta.unit}<br>%{x:.2f} nm<extra></extra>`
        }];
        const shapes = [];
        if (showRef && refLambda >= Math.min(...data.lambda) &&
            refLambda <= Math.max(...data.lambda)) {
            shapes.push({
                type: 'line', x0: refLambda, x1: refLambda, yref: 'paper',
                y0: 0, y1: 1, line: { color: textColor, width: 1, dash: 'dot' }
            });
        }
        const layout = {
            paper_bgcolor: paperColor,
            plot_bgcolor:  bgColor,
            margin: { l: 64, r: 16, t: 12, b: 46 },
            showlegend: false,
            shapes,
            xaxis: {
                title: { text: 'Wavelength (nm)', font: { color: textColor, size: 12 } },
                color: textColor, gridcolor: gridColor, zerolinecolor: gridColor,
                tickfont: { color: textColor, size: 11 }
            },
            yaxis: {
                title: { text: meta.label, font: { color: meta.color, size: 12 } },
                color: meta.color, gridcolor: gridColor, zerolinecolor: gridColor,
                tickfont: { color: meta.color, size: 11 }
            },
        };
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, traces, layout,
                           { responsive: true, displayModeBar: false });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, traces, layout);
        }
    }, [data, meta, refLambda, showRef, bgColor, paperColor, gridColor, textColor]);

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

export function GDGDDEvaluation({ c, theme, t }) {
    const g = t.gdgdd;
    const { design } = useDesign();

    // This window has its OWN local side switch (decoupled from design eval mode).
    const [side,     setSide]     = useState('front');      // 'front' | 'back'
    const [target,   setTarget]   = useState('R');         // 'R' | 'T'
    const [quantity, setQuantity] = useState('gd');         // phase|gd|gdd|tod
    const [pol,      setPol]      = useState('s');           // 's' | 'p'
    const [lamStart, setLamStart] = useState(400);
    const [lamEnd,   setLamEnd]   = useState(800);
    const [lamStep,  setLamStep]  = useState(1);
    const [theta,    setTheta]    = useState(0);
    const [refLam,   setRefLam]   = useState(() => design?.referenceWavelength || 550);
    const [showRef,  setShowRef]  = useState(true);

    // raw = a single computeGroupDelaySpectrum result for the selected side, or null.
    const [raw, setRaw] = useState(null);

    useEffect(() => {
        if (design?.referenceWavelength) setRefLam(design.referenceWavelength);
    }, [design?.id]);

    // On mount / design change: if front is empty but back has layers, default to
    // back so a back-only design isn't blank.
    useEffect(() => {
        const frontN = (design?.frontLayers || []).filter(l => l.material && l.thickness > 0).length;
        const backN  = (design?.backLayers  || []).filter(l => l.material && l.thickness > 0).length;
        if (frontN === 0 && backN > 0) setSide('back');
        else setSide('front');
    }, [design?.id]);

    useEffect(() => {
        const layers = (side === 'back' ? design?.backLayers : design?.frontLayers) || [];
        const n = layers.filter(l => l.material && l.thickness > 0).length;
        if (!n) { setRaw(null); return; }
        try {
            const s   = Math.max(0.05, Math.min(lamStep, Math.abs(lamEnd - lamStart) || 1));
            const lo  = Math.min(lamStart, lamEnd);
            const hi  = Math.max(lamStart, lamEnd);
            setRaw(computeSpectral(design, side, lo, hi, s, theta, pol, target));
        } catch (e) {
            console.error('GD/GDD computation failed:', e);
            setRaw(null);
        }
    }, [design, side, target, pol, lamStart, lamEnd, lamStep, theta, quantity]);

    const centerBox = (msg) => h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontFamily: 'system-ui, -apple-system, sans-serif'
        }
    }, msg);

    if (!design) return centerBox(g.noDesign);

    // Per-side layer count for the readout. Do NOT early-return when the selected
    // side is empty — that removes the controls (incl. the Side switch) and traps
    // the user. The chart area below shows the no-layers placeholder instead.
    const selLayers = (side === 'back' ? design.backLayers : design.frontLayers) || [];
    const selCount  = selLayers.filter(l => l.material && l.thickness > 0).length;

    const meta = quantityMeta(quantity, g);

    // Reference-phase subtraction: only meaningful for the phase plot — zero
    // φ at the reference wavelength (a constant offset; GD/GDD/TOD are
    // derivatives and are unaffected, matching Macleod Eq. 11.17).
    let plotData = null;
    if (raw && raw.lambda.length) {
        let y = raw[meta.key];
        if (quantity === 'phase' && showRef) {
            let kBest = 0, dBest = Infinity;
            for (let i = 0; i < raw.lambda.length; i++) {
                const dd = Math.abs(raw.lambda[i] - refLam);
                if (dd < dBest) { dBest = dd; kBest = i; }
            }
            const off = y[kBest];
            y = y.map(v => v - off);
        }
        plotData = { lambda: raw.lambda, y };
    }

    // ── Data-table (text) rows — mirror the arrays the plot consumes ───────────
    // Same `raw` arrays as the chart; rows aligned by lambda index. Units match
    // the axis labels in quantityMeta(): phase °, GD fs, GDD fs², TOD fs³.
    const tableColumns = [];
    const tableRows = [];
    if (raw && raw.lambda && raw.lambda.length) {
        const hasPhase = Array.isArray(raw.phaseDeg);
        const hasGd    = Array.isArray(raw.gd);
        const hasGdd   = Array.isArray(raw.gdd);
        const hasTod   = Array.isArray(raw.tod);

        tableColumns.push({ key: 'lambda', label: 'λ (nm)', align: 'left', fmt: v => v.toFixed(1) });
        if (hasGd)    tableColumns.push({ key: 'gd',    label: 'GD (fs)',   fmt: v => v.toFixed(3) });
        if (hasGdd)   tableColumns.push({ key: 'gdd',   label: 'GDD (fs²)', fmt: v => v.toFixed(3) });
        if (hasPhase) tableColumns.push({ key: 'phase', label: 'Phase (°)', fmt: v => v.toFixed(2) });
        if (hasTod)   tableColumns.push({ key: 'tod',   label: 'TOD (fs³)', fmt: v => v.toFixed(3) });

        for (let i = 0; i < raw.lambda.length; i++) {
            const row = { lambda: raw.lambda[i] };
            if (hasGd)    row.gd    = raw.gd[i];
            if (hasGdd)   row.gdd   = raw.gdd[i];
            if (hasPhase) row.phase = raw.phaseDeg[i];
            if (hasTod)   row.tod   = raw.tod[i];
            tableRows.push(row);
        }
    }

    // ── Styles ────────────────────────────────────────────────────────────────
    const labelStyle = {
        color: c.textDim, fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
        whiteSpace: 'nowrap'
    };
    const inputStyle = {
        background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        padding: '1px 4px', fontSize: 12, width: 58,
        fontFamily: 'system-ui, -apple-system, sans-serif'
    };
    const tabBtn = (active) => ({
        padding: '2px 10px',
        background: active ? c.accent : (c.inputBg || c.hover),
        color: active ? '#fff' : c.text,
        border: `1px solid ${active ? c.accent : c.border}`,
        borderRadius: 3, cursor: 'pointer', fontSize: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif'
    });
    // DebouncedInput-backed: the field stays freely editable (you can clear it,
    // type intermediate values, etc.) and only commits the clamped value on
    // blur / Enter — instead of clamping on every keystroke, which made these
    // boxes painful to edit.
    const numField = (label, value, setter, min, max, step, width) =>
        h('label', { style: labelStyle }, label,
            h(DebouncedInput, {
                value: String(value),
                onChange: (v) => {
                    const x = parseFloat(v);
                    if (!isNaN(x)) setter(Math.max(min, Math.min(max, x)));
                },
                style: { ...inputStyle, width: width || 58, marginLeft: 6 }
            })
        );

    // Readout reflects the selected surface side.
    const readoutLayers = selLayers.filter(l => l.material && l.thickness > 0);
    const layerCount = readoutLayers.length;
    const totalThk = readoutLayers.reduce((s, l) => s + l.thickness, 0);

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
            // Surface side — local to this window (Front / Back).
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } },
                h('span', { style: { ...labelStyle, marginRight: 3 } }, (g.side || 'Side') + ':'),
                h('button', { onClick: () => setSide('front'), style: tabBtn(side === 'front') }, g.front || 'Front'),
                h('button', { onClick: () => setSide('back'),  style: tabBtn(side === 'back')  }, g.back  || 'Back')
            ),

            // Quantity selector
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } },
                h('span', { style: { ...labelStyle, marginRight: 3 } }, g.quantity + ':'),
                h('button', { onClick: () => setQuantity('phase'), style: tabBtn(quantity === 'phase') }, g.phase),
                h('button', { onClick: () => setQuantity('gd'),    style: tabBtn(quantity === 'gd')    }, 'GD'),
                h('button', { onClick: () => setQuantity('gdd'),   style: tabBtn(quantity === 'gdd')   }, 'GDD'),
                h('button', { onClick: () => setQuantity('tod'),   style: tabBtn(quantity === 'tod')   }, 'TOD')
            ),

            // Reflection / Transmission
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } },
                h('button', { onClick: () => setTarget('R'), style: tabBtn(target === 'R') }, g.reflection),
                h('button', { onClick: () => setTarget('T'), style: tabBtn(target === 'T') }, g.transmission)
            ),

            // Polarization
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } },
                h('span', { style: { ...labelStyle, marginRight: 3 } }, g.pol + ':'),
                h('button', { onClick: () => setPol('s'), style: tabBtn(pol === 's') }, 's'),
                h('button', { onClick: () => setPol('p'), style: tabBtn(pol === 'p') }, 'p')
            ),

            numField(g.lamStart, lamStart, setLamStart, 100, 30000, 10),
            numField(g.lamEnd,   lamEnd,   setLamEnd,   100, 30000, 10),
            numField(g.lamStep,  lamStep,  setLamStep,  0.05, 1000, 0.5, 50),
            numField(g.aoi,      theta,    setTheta,    0,   89,   1,   46),

            // Reference wavelength (φ-subtraction marker)
            h('label', { style: { ...labelStyle, display: 'flex', alignItems: 'center', gap: 4 } },
                h(Checkbox, {
                    c, checked: showRef,
                    onChange: e => setShowRef(e.target.checked)
                }),
                g.refLam
            ),
            numField('', refLam, setRefLam, 100, 30000, 10, 56),

            // Readout
            h('span', { style: { ...labelStyle, marginLeft: 'auto', color: c.text } },
                `${g.layersLabel}: ${layerCount}  |  ${g.totalThk}: ${totalThk.toFixed(1)} nm`
            )
        ),

        // ── Chart + data-table (text) ───────────────────────────────────────────
        h('div', {
            style: {
                flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
                overflow: 'hidden'
            }
        },
            h('div', { style: { flex: 1, minHeight: 0, overflow: 'hidden' } },
                plotData && plotData.lambda.length
                    ? h(GDChart, { data: plotData, meta, refLambda: refLam, showRef, c })
                    : centerBox(g.noLayers)
            ),
            h(DataTablePanel, { columns: tableColumns, rows: tableRows, c, t })
        ),
    );
}
