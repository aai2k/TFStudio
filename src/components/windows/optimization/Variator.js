/**
 * Variator — slider-driven parameter exploration.
 *
 * Lets the user nudge layer thicknesses, substrate thickness, and material
 * n/k offsets and see the spectrum respond instantly.
 *
 * Scope (v1):
 *   - Layer thickness sliders (front + back): propagate to the design via
 *     updateDesign(patch, { transient: true }) so every other open window
 *     (Optical Evaluation, Admittance, E-field, …) re-renders live.
 *   - Substrate thickness slider: same transient propagation.
 *   - Material n/k offset sliders: one row per UNIQUE material in the stack.
 *     These stay LOCAL to the Variator — applied as offsets when this window
 *     computes its preview spectrum. Other windows see the unperturbed
 *     materials. (Full propagation needs a design-level material-override
 *     resolver chain.)
 *
 * Baseline handling:
 *   - On first slider move we push ONE undo checkpoint so a single Ctrl+Z
 *     reverts the entire Variator session.
 *   - Baseline thicknesses are captured in a module-scoped cache keyed by
 *     design.id, so docking switches preserve the reference for Revert.
 *   - The Revert button zeros every slider and restores the baseline
 *     (transient update — no extra checkpoint pushed).
 */

import { useDesign }            from '../../../state/DesignContext.js';
import { EvalModeBadge }        from '../../SurfaceModeBar.js';
import { Checkbox }             from '../../ui/Checkbox.js';
import { getMaterialById, resolveColor }      from '../../../utils/materials/catalogManager.js';
import { getMaterial }          from '../../../utils/materials/materialDatabase.js';
import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from '../../../utils/physics/thinFilmMath.js';
import { wrapMaterial, thicknessRangeNm } from '../../../utils/misc/variator.js';
import { buildTargetTraces, buildTargetShapes } from '../../../utils/physics/spectrumTargets.js';

const { createElement: h, useState, useEffect, useRef, useMemo, useCallback } = React;

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

function matLabel(mat) {
    if (!mat) return '—';
    return mat.name || mat.id || '?';
}

// Per-design baseline cache — survives docking-window unmount/remount so the
// Revert reference is still meaningful after switching tabs.
const _variatorCache = {};   // { [designId]: { baseFront, baseBack, baseSubstrateMm } }
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('tfstudio:design-evict', (e) => { if (e.detail?.id) delete _variatorCache[e.detail.id]; });
function _vc(id) {
    if (!id) return null;
    if (!_variatorCache[id]) _variatorCache[id] = { baseFront: null, baseBack: null, baseSubstrateMm: null };
    return _variatorCache[id];
}

// ── Spectrum plot (R/T overlay) ───────────────────────────────────────────────

function SpectrumPlot({ data, c, theme, targets, showTargets }) {
    const divRef = useRef(null);
    const initRef = useRef(false);

    const bgColor    = c.bg    || '#1e1e1e';
    const paperColor = c.panel || '#252526';
    const gridColor  = c.border || '#3a3a3a';
    const textColor  = c.text  || '#cccccc';

    const traces = useMemo(() => {
        if (!data?.lambda) return [];
        const out = [];
        if (data.T) out.push({
            x: data.lambda, y: data.T.map(v => v * 100),
            name: 'T', type: 'scatter', mode: 'lines',
            line: { color: '#4fc3f7', width: 1.6 },
            hovertemplate: '%{x:.1f} nm<br>T %{y:.3f}%<extra></extra>'
        });
        if (data.R) out.push({
            x: data.lambda, y: data.R.map(v => v * 100),
            name: 'R', type: 'scatter', mode: 'lines',
            line: { color: '#ef5350', width: 1.6 },
            hovertemplate: '%{x:.1f} nm<br>R %{y:.3f}%<extra></extra>'
        });
        if (data.Tbase) out.push({
            x: data.lambda, y: data.Tbase.map(v => v * 100),
            name: 'T (baseline)', type: 'scatter', mode: 'lines',
            line: { color: '#4fc3f7', width: 1, dash: 'dot' },
            opacity: 0.55,
            hovertemplate: '%{x:.1f} nm<br>T₀ %{y:.3f}%<extra></extra>'
        });
        if (data.Rbase) out.push({
            x: data.lambda, y: data.Rbase.map(v => v * 100),
            name: 'R (baseline)', type: 'scatter', mode: 'lines',
            line: { color: '#ef5350', width: 1, dash: 'dot' },
            opacity: 0.55,
            hovertemplate: '%{x:.1f} nm<br>R₀ %{y:.3f}%<extra></extra>'
        });
        if (showTargets) {
            for (const tr of buildTargetTraces(targets)) out.push(tr);
        }
        return out;
    }, [data, targets, showTargets]);

    const layout = useMemo(() => ({
        margin: { l: 52, r: 16, t: 16, b: 44 },
        paper_bgcolor: paperColor,
        plot_bgcolor: bgColor,
        font: { color: textColor, family: 'system-ui, -apple-system, sans-serif', size: 11 },
        xaxis: { title: { text: 'Wavelength (nm)', standoff: 8 }, gridcolor: gridColor, zerolinecolor: gridColor },
        yaxis: { title: { text: '(%)', standoff: 8 }, range: [0, 100], gridcolor: gridColor, zerolinecolor: gridColor },
        legend: { bgcolor: paperColor + 'cc', bordercolor: gridColor, borderwidth: 1, font: { size: 10 },
                  x: 1, xanchor: 'right', y: 1, yanchor: 'top' },
        hovermode: 'x unified',
        autosize: true,
        shapes: showTargets ? buildTargetShapes(targets) : [],
    }), [paperColor, bgColor, gridColor, textColor, targets, showTargets]);

    const config = { displaylogo: false, responsive: true, displayModeBar: true,
                     modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'] };

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        Plotly.newPlot(divRef.current, traces, layout, config);
        initRef.current = true;
        const ro = new ResizeObserver(() => {
            if (divRef.current && initRef.current) Plotly.Plots.resize(divRef.current);
        });
        ro.observe(divRef.current);
        return () => {
            ro.disconnect();
            if (divRef.current) Plotly.purge(divRef.current);
            initRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (!divRef.current || !initRef.current) return;
        Plotly.react(divRef.current, traces, layout, config);
    }, [traces, layout]);

    if (typeof Plotly === 'undefined') {
        return h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim } },
            'Plotly not loaded');
    }
    return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
}

// ── Slider row ────────────────────────────────────────────────────────────────

function SliderRow({ label, value, min, max, step, unit, color, onChange, c, displayPrecision = 2, resetTip }) {
    const dirty = Math.abs(value) > 1e-9;
    return h('div', {
        style: {
            display: 'grid',
            gridTemplateColumns: '110px 1fr 80px 18px',
            alignItems: 'center', gap: 8,
            padding: '4px 8px', borderBottom: `1px solid ${c.border}30`
        }
    },
        h('div', {
            title: label,
            style: {
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 11, color: c.text,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            }
        },
            color && h('span', { style: {
                width: 9, height: 9, borderRadius: 2,
                background: color, flexShrink: 0,
                border: `1px solid ${c.border}`
            }}),
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, label)
        ),
        h('input', {
            type: 'range', min, max, step, value,
            onChange: (e) => onChange(parseFloat(e.target.value)),
            // Double-click the rail to snap back to zero — quick keyboard-free reset.
            onDoubleClick: () => onChange(0),
            style: { width: '100%', accentColor: c.accent, cursor: 'pointer' }
        }),
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 3, justifySelf: 'end',
                fontSize: 11, fontVariantNumeric: 'tabular-nums', color: c.textDim
            }
        },
            h('span', { style: { color: dirty ? c.accent : c.textDim } },
                (value >= 0 ? '+' : '') + value.toFixed(displayPrecision)),
            h('span', null, unit || '')
        ),
        // Per-row reset (×) — only clickable when this slider is off-baseline.
        // Renders an empty cell when at baseline so the grid alignment stays.
        h('button', {
            onClick: () => onChange(0),
            disabled: !dirty,
            title: resetTip || 'Reset to baseline',
            style: {
                width: 16, height: 16, padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent',
                border: `1px solid ${dirty ? c.border : 'transparent'}`,
                borderRadius: 3,
                color: dirty ? c.textDim : 'transparent',
                cursor: dirty ? 'pointer' : 'default',
                fontSize: 11, lineHeight: 1,
                outline: 'none',
                transition: 'color 0.1s, border-color 0.1s',
            },
            onMouseEnter: (e) => { if (dirty) { e.currentTarget.style.color = c.accent; e.currentTarget.style.borderColor = c.accent; } },
            onMouseLeave: (e) => { if (dirty) { e.currentTarget.style.color = c.textDim; e.currentTarget.style.borderColor = c.border; } },
        }, '×')
    );
}

function SectionHeader({ label, c, count }) {
    return h('div', {
        style: {
            padding: '5px 10px 4px',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: c.textDim,
            background: c.panel,
            borderTop: `1px solid ${c.border}`, borderBottom: `1px solid ${c.border}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }
    },
        h('span', null, label),
        count != null && h('span', { style: { color: c.textDim, opacity: 0.7 } }, `${count}`)
    );
}

// ── Main component ───────────────────────────────────────────────────────────

export function Variator({ c, theme, t }) {
    const { design, updateDesign, checkpoint, evalMode } = useDesign();
    const v = t.variator || {};   // tolerate missing locale: fall through to defaults

    // Slider state — all relative to the baseline captured on first mount.
    // Layer thickness deltas are stored by layer ID so reordering does not
    // shift values around. Material n/k offsets are keyed by material id.
    const [dThkFront, setDThkFront] = useState({});  // { [layerId]: Δnm }
    const [dThkBack,  setDThkBack]  = useState({});
    const [dSubMm,    setDSubMm]    = useState(0);
    const [dN,        setDN]        = useState({});  // { [matId]: Δn }
    const [dK,        setDK]        = useState({});  // { [matId]: Δk }

    // One-shot checkpoint guard — fires the FIRST time any slider moves so
    // a single Ctrl+Z reverts the whole Variator session. Reset on Revert
    // and on design switch.
    const checkpointedRef = useRef(false);

    // View params
    const [params, setParams] = useState({
        lambdaStart: 400, lambdaEnd: 800, lambdaStep: 2, theta: 0, polarization: 'avg'
    });
    const [showBaseline, setShowBaseline] = useState(true);
    const [showTargets,  setShowTargets]  = useState(true);

    // Capture baseline thicknesses once per design id. We snapshot the
    // *current* thicknesses the first time we see this design — that
    // becomes the Revert reference for the rest of this Variator session
    // (including across docking switches via _variatorCache).
    useEffect(() => {
        if (!design) return;
        const cache = _vc(design.id);
        if (!cache.baseFront) {
            cache.baseFront = (design.frontLayers || []).map(l => ({ id: l.id, thickness: l.thickness }));
            cache.baseBack  = (design.backLayers  || []).map(l => ({ id: l.id, thickness: l.thickness }));
            cache.baseSubstrateMm = design.substrate?.thickness ?? 1.0;
        }
    }, [design?.id]);

    // Reset slider state when the active design changes — sliders are
    // baseline-relative and a different design has a different baseline.
    useEffect(() => {
        setDThkFront({}); setDThkBack({}); setDSubMm(0);
        setDN({}); setDK({});
        checkpointedRef.current = false;
    }, [design?.id]);

    // Convenience helpers for slider commits.
    const ensureCheckpoint = useCallback(() => {
        if (checkpointedRef.current) return;
        checkpointedRef.current = true;
        try { checkpoint(); } catch (_) {}
    }, [checkpoint]);

    // Apply slider state -> design (thicknesses only). Material n/k offsets
    // stay local; see notes at the top of the file.
    const applyThicknessesToDesign = useCallback((nextDF, nextDB, nextDSubMm) => {
        if (!design) return;
        const cache = _vc(design.id);
        if (!cache.baseFront) return;   // not initialised yet
        const baseFrontById = new Map(cache.baseFront.map(l => [l.id, l.thickness]));
        const baseBackById  = new Map(cache.baseBack.map(l => [l.id, l.thickness]));

        const front = (design.frontLayers || []).map(l => {
            const base = baseFrontById.has(l.id) ? baseFrontById.get(l.id) : l.thickness;
            const d = nextDF[l.id] || 0;
            const next = Math.max(0, base + d);
            return next === l.thickness ? l : { ...l, thickness: next };
        });
        const back = (design.backLayers || []).map(l => {
            const base = baseBackById.has(l.id) ? baseBackById.get(l.id) : l.thickness;
            const d = nextDB[l.id] || 0;
            const next = Math.max(0, base + d);
            return next === l.thickness ? l : { ...l, thickness: next };
        });
        const subBase = cache.baseSubstrateMm ?? 1.0;
        const nextSubMm = Math.max(0, subBase + (nextDSubMm || 0));
        const subPatch = (design.substrate?.thickness !== nextSubMm)
            ? { substrate: { ...design.substrate, thickness: nextSubMm } }
            : null;

        const patch = { frontLayers: front, backLayers: back, ...(subPatch || {}) };
        updateDesign(patch, { transient: true });
    }, [design, updateDesign]);

    // Push transient updates whenever a thickness slider changes.
    useEffect(() => {
        if (!design) return;
        applyThicknessesToDesign(dThkFront, dThkBack, dSubMm);
    }, [dThkFront, dThkBack, dSubMm, applyThicknessesToDesign, design?.id]);

    // ── Build material variation list (unique by material id) ────────────
    const uniqueMats = useMemo(() => {
        if (!design) return [];
        const ids = new Set();
        const out = [];
        const collect = (id) => {
            if (!id || ids.has(id)) return;
            ids.add(id);
            const m = resolveMat(id);
            out.push({ id, mat: m });
        };
        (design.frontLayers || []).forEach(l => collect(l.material));
        (design.backLayers  || []).forEach(l => collect(l.material));
        collect(design.incidentMedium);
        collect(design.substrate?.material);
        collect(design.exitMedium);
        return out;
    }, [design]);

    // ── Compute Variator preview spectrum ────────────────────────────────
    // Perturbed arm  = current (transiently-updated) `design` thicknesses
    //                  + materials wrapped with local Δn,Δk offsets.
    // Baseline arm   = ORIGINAL thicknesses from `_variatorCache[design.id]`
    //                  + raw materials (no Δn,Δk). That snapshot is taken
    //                  the first time the Variator sees this design and is
    //                  what Revert restores to — so the dotted curve stays
    //                  put regardless of which slider the user touches
    //                  (thickness AND n/k).
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    const compute = useCallback(() => {
        if (!design) return;
        try {
            const cache = _vc(design.id);
            const baseFrontById = new Map((cache.baseFront || []).map(l => [l.id, l.thickness]));
            const baseBackById  = new Map((cache.baseBack  || []).map(l => [l.id, l.thickness]));
            const baseSubMm     = cache.baseSubstrateMm ?? (design.substrate?.thickness ?? 1.0);

            const wrap = (id) => {
                const base = resolveMat(id);
                return wrapMaterial(base, dN[id] || 0, dK[id] || 0);
            };
            const incMat  = wrap(design.incidentMedium);
            const subMat  = wrap(design.substrate?.material);
            const exitMat = wrap(design.exitMedium);
            const subThick = design.substrate?.thickness ?? 1.0;

            const front = (design.frontLayers || [])
                .filter(l => l.thickness > 0)
                .map(l => ({ material: wrap(l.material), thickness: l.thickness }));
            const back = (design.backLayers || [])
                .filter(l => l.thickness > 0)
                .map(l => ({ material: wrap(l.material), thickness: l.thickness }));

            // Baseline arm — original snapshot thicknesses, raw materials.
            const incMatB  = resolveMat(design.incidentMedium);
            const subMatB  = resolveMat(design.substrate?.material);
            const exitMatB = resolveMat(design.exitMedium);
            const frontB = (design.frontLayers || []).map(l => {
                const t0 = baseFrontById.has(l.id) ? baseFrontById.get(l.id) : l.thickness;
                return { material: resolveMat(l.material), thickness: t0 };
            }).filter(l => l.thickness > 0);
            const backB = (design.backLayers || []).map(l => {
                const t0 = baseBackById.has(l.id) ? baseBackById.get(l.id) : l.thickness;
                return { material: resolveMat(l.material), thickness: t0 };
            }).filter(l => l.thickness > 0);
            const subThickB = baseSubMm;

            let result, baseline;
            if (evalMode === 'back') {
                result   = evaluateSpectrumBack({ ...params }, exitMat,  subMat,  back);
                baseline = evaluateSpectrumBack({ ...params }, exitMatB, subMatB, backB);
            } else if (evalMode === 'total') {
                result   = evaluateSpectrumTotal({ ...params }, incMat,  subMat,  exitMat,  front,  back,  subThick);
                baseline = evaluateSpectrumTotal({ ...params }, incMatB, subMatB, exitMatB, frontB, backB, subThickB);
            } else {
                result   = evaluateSpectrum({ ...params }, incMat,  subMat,  front);
                baseline = evaluateSpectrum({ ...params }, incMatB, subMatB, frontB);
            }
            result.Tbase = baseline.T;
            result.Rbase = baseline.R;
            setData(result);
            setError(null);
        } catch (e) {
            console.error('[Variator] compute error:', e);
            setError(e.message || 'Computation error');
        }
    }, [design, params, evalMode, dN, dK]);

    useEffect(() => { compute(); }, [compute]);

    // ── Revert ───────────────────────────────────────────────────────────
    const revert = useCallback(() => {
        setDThkFront({}); setDThkBack({}); setDSubMm(0);
        setDN({}); setDK({});
        // applyThicknessesToDesign will fire via the effect above with zeros,
        // restoring baseline thicknesses on this and every other open window.
    }, []);

    if (!design) {
        return h('div', {
            style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                     color: c.textDim, fontSize: 13, fontFamily: 'system-ui, -apple-system, sans-serif' }
        }, v.noDesign || 'No design selected. Open or create a design first.');
    }

    const cache = _vc(design.id);
    const baseFrontById = new Map((cache.baseFront || []).map(l => [l.id, l.thickness]));
    const baseBackById  = new Map((cache.baseBack  || []).map(l => [l.id, l.thickness]));
    const baseSubMm = cache.baseSubstrateMm ?? (design.substrate?.thickness ?? 1.0);

    const anyVaried =
        Object.values(dThkFront).some(x => Math.abs(x) > 1e-9) ||
        Object.values(dThkBack ).some(x => Math.abs(x) > 1e-9) ||
        Math.abs(dSubMm) > 1e-9 ||
        Object.values(dN).some(x => Math.abs(x) > 1e-9) ||
        Object.values(dK).some(x => Math.abs(x) > 1e-9);

    // Slider commit wrappers (capture the one-shot checkpoint).
    const setLayerFront = (lid, val) => {
        ensureCheckpoint();
        setDThkFront(prev => ({ ...prev, [lid]: val }));
    };
    const setLayerBack = (lid, val) => {
        ensureCheckpoint();
        setDThkBack(prev => ({ ...prev, [lid]: val }));
    };
    const setSub = (val) => {
        ensureCheckpoint();
        setDSubMm(val);
    };
    const setMatDN = (id, val) => {
        ensureCheckpoint();
        setDN(prev => ({ ...prev, [id]: val }));
    };
    const setMatDK = (id, val) => {
        ensureCheckpoint();
        setDK(prev => ({ ...prev, [id]: val }));
    };

    // Layer list for the sidebar — show baseline value next to each label.
    const renderLayerSliders = (layers, side) => layers.map((l, idx) => {
        const base = (side === 'front' ? baseFrontById : baseBackById).get(l.id) ?? l.thickness;
        const range = thicknessRangeNm(base);
        const mat = resolveMat(l.material);
        const value = (side === 'front' ? dThkFront : dThkBack)[l.id] || 0;
        const setter = side === 'front' ? setLayerFront : setLayerBack;
        const prefix = side === 'front' ? 'F' : 'B';
        return h(SliderRow, {
            key: l.id,
            label: `${prefix}${idx + 1} ${matLabel(mat)} (${base.toFixed(1)} nm)`,
            value, min: range.min, max: range.max, step: 0.1,
            unit: 'nm', color: mat ? resolveColor(mat) : undefined, c,
            onChange: (val) => setter(l.id, val),
            displayPrecision: 2,
            resetTip: v.resetRow,
        });
    });

    return h('div', {
        style: {
            display: 'flex', width: '100%', height: '100%',
            backgroundColor: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
            overflow: 'hidden'
        }
    },
        // ── Sidebar (sliders) ─────────────────────────────────────────────
        h('div', {
            style: {
                width: 380, minWidth: 320, flexShrink: 0,
                display: 'flex', flexDirection: 'column',
                borderRight: `1px solid ${c.border}`,
                backgroundColor: c.bg
            }
        },
            // Sidebar toolbar
            h('div', {
                style: {
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 10px', borderBottom: `1px solid ${c.border}`,
                    backgroundColor: c.panel, flexShrink: 0
                }
            },
                h('span', { style: { fontWeight: 600 } }, v.title || 'Variator'),
                h('span', { style: { color: c.textDim, fontSize: 11 } },
                    anyVaried ? (v.varied || 'modified') : (v.atBaseline || 'baseline')),
                h('button', {
                    onClick: revert,
                    disabled: !anyVaried,
                    title: v.revertTip || 'Reset all sliders to baseline',
                    style: {
                        marginLeft: 'auto',
                        padding: '3px 10px', fontSize: 11,
                        cursor: anyVaried ? 'pointer' : 'default',
                        border: `1px solid ${anyVaried ? c.accent : c.border}`,
                        borderRadius: 3,
                        backgroundColor: anyVaried ? c.accent + '22' : 'transparent',
                        color: anyVaried ? c.accent : c.textDim,
                        outline: 'none', opacity: anyVaried ? 1 : 0.5,
                    }
                }, v.revert || 'Revert')
            ),

            // Slider scroll area
            h('div', {
                style: { flex: 1, minHeight: 0, overflowY: 'auto' }
            },
                // Front layers
                (design.frontLayers || []).length > 0 && h('div', null,
                    h(SectionHeader, { label: v.frontLayers || 'Front layers', count: design.frontLayers.length, c }),
                    renderLayerSliders(design.frontLayers, 'front')
                ),

                // Back layers
                (design.backLayers || []).length > 0 && h('div', null,
                    h(SectionHeader, { label: v.backLayers || 'Back layers', count: design.backLayers.length, c }),
                    renderLayerSliders(design.backLayers, 'back')
                ),

                // Substrate thickness
                h('div', null,
                    h(SectionHeader, { label: v.substrate || 'Substrate', c }),
                    h(SliderRow, {
                        label: `${matLabel(resolveMat(design.substrate?.material))} (${baseSubMm.toFixed(3)} mm)`,
                        value: dSubMm,
                        min: -Math.max(0.5, baseSubMm * 0.5),
                        max:  Math.max(0.5, baseSubMm * 0.5),
                        step: 0.01,
                        unit: 'mm',
                        color: resolveColor(resolveMat(design.substrate?.material)), c,
                        onChange: setSub,
                        displayPrecision: 3,
                        resetTip: v.resetRow,
                    })
                ),

                // Material n/k offsets — one row per UNIQUE material id
                h('div', null,
                    h(SectionHeader, { label: v.materials || 'Material n/k offsets', count: uniqueMats.length, c }),
                    h('div', {
                        style: {
                            padding: '4px 10px 6px', fontSize: 10.5, color: c.textDim,
                            background: c.panel + '40', borderBottom: `1px solid ${c.border}30`
                        }
                    }, v.matNote || 'Δn, Δk applied as constant offsets to dispersive n(λ), k(λ). Local to the Variator preview — other windows show the unperturbed materials.'),
                    uniqueMats.map(({ id, mat }) => h('div', { key: id, style: { paddingBottom: 2, borderBottom: `1px solid ${c.border}30` } },
                        h(SliderRow, {
                            label: `${matLabel(mat)} · Δn`,
                            value: dN[id] || 0, min: -0.5, max: 0.5, step: 0.001,
                            unit: '', color: mat ? resolveColor(mat) : undefined, c,
                            onChange: (val) => setMatDN(id, val),
                            displayPrecision: 3,
                            resetTip: v.resetRow,
                        }),
                        h(SliderRow, {
                            label: `${matLabel(mat)} · Δk`,
                            value: dK[id] || 0, min: -0.1, max: 0.1, step: 0.0005,
                            unit: '', color: mat ? resolveColor(mat) : undefined, c,
                            onChange: (val) => setMatDK(id, val),
                            displayPrecision: 4,
                            resetTip: v.resetRow,
                        }),
                    ))
                )
            )
        ),

        // ── Main area: spectrum plot + controls ─────────────────────────
        h('div', {
            style: {
                flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column'
            }
        },
            // Top controls
            h('div', {
                style: {
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    padding: '5px 10px', borderBottom: `1px solid ${c.border}`,
                    backgroundColor: c.panel, flexShrink: 0
                }
            },
                h('span', { style: { fontWeight: 600, fontSize: 12 } }, v.preview || 'Preview'),
                // Evaluation target — read-only, set in the Design Editor.
                h(EvalModeBadge, { design, c, t }),
                h('div', { style: { width: 1, height: 18, background: c.border } }),
                h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: c.textDim } },
                    'λ',
                    h('input', {
                        type: 'number', value: params.lambdaStart,
                        onChange: (e) => setParams(p => ({ ...p, lambdaStart: parseFloat(e.target.value) || 0 })),
                        style: { width: 60, height: 22, marginLeft: 4, backgroundColor: c.bg, color: c.text,
                                 border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11, padding: '0 4px' }
                    }),
                    '–',
                    h('input', {
                        type: 'number', value: params.lambdaEnd,
                        onChange: (e) => setParams(p => ({ ...p, lambdaEnd: parseFloat(e.target.value) || 0 })),
                        style: { width: 60, height: 22, backgroundColor: c.bg, color: c.text,
                                 border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11, padding: '0 4px' }
                    }),
                    'nm'
                ),
                h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: c.textDim } },
                    'AOI',
                    h('input', {
                        type: 'number', value: params.theta, min: 0, max: 89,
                        onChange: (e) => setParams(p => ({ ...p, theta: parseFloat(e.target.value) || 0 })),
                        style: { width: 45, height: 22, marginLeft: 4, backgroundColor: c.bg, color: c.text,
                                 border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11, padding: '0 4px' }
                    }),
                    '°'
                ),
                // Targets toggle — disabled when the design has no operands.
                // Same yellow accent + dotted swatch as Optical Evaluation so
                // the two windows read the same.
                h('button', {
                    onClick: () => setShowTargets(p => !p),
                    disabled: !(design.meritOperands?.length),
                    title: design.meritOperands?.length
                        ? (v.targetsOn || 'Show merit function targets')
                        : (v.targetsNone || 'No merit function targets defined'),
                    style: {
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '2px 7px',
                        cursor: design.meritOperands?.length ? 'pointer' : 'default',
                        outline: 'none', marginLeft: 'auto',
                        border: `1px solid ${showTargets ? '#ffd54f' : c.border}`,
                        borderRadius: 3,
                        backgroundColor: showTargets ? '#ffd54f22' : 'transparent',
                        color: showTargets ? c.text : c.textDim,
                        fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
                        fontWeight: showTargets ? 600 : 400,
                        opacity: design.meritOperands?.length ? 1 : 0.4
                    }
                },
                    h('div', { style: { width: 14, height: 0, borderTop: `2px dotted ${showTargets ? '#ffd54f' : c.textDim}` } }),
                    v.targets || 'Targets'
                ),
                h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11,
                                       color: c.text, cursor: 'pointer' } },
                    h(Checkbox, {
                        c, checked: showBaseline,
                        onChange: (e) => setShowBaseline(e.target.checked),
                    }),
                    v.showBaseline || 'Show baseline overlay'
                )
            ),

            // Chart
            h('div', { style: { flex: 1, minHeight: 0, position: 'relative' } },
                error
                    ? h('div', {
                        style: { display: 'flex', alignItems: 'center', justifyContent: 'center',
                                 height: '100%', color: '#ef5350', fontSize: 12, padding: 16, textAlign: 'center' }
                    }, `Error: ${error}`)
                    : h(SpectrumPlot, {
                        data: showBaseline ? data : (data ? { lambda: data.lambda, T: data.T, R: data.R } : null),
                        c, theme,
                        targets: design.meritOperands,
                        showTargets,
                    })
            ),

            // Footer
            h('div', {
                style: {
                    padding: '3px 10px', borderTop: `1px solid ${c.border}`,
                    backgroundColor: c.panel, flexShrink: 0,
                    display: 'flex', alignItems: 'center', gap: 12,
                    fontSize: 11, color: c.textDim
                }
            },
                h('span', null, design.name),
                h('span', null, `${(design.frontLayers || []).length}F / ${(design.backLayers || []).length}B`),
                anyVaried && h('span', { style: { color: c.accent } },
                    v.modifiedTip || 'Live preview — Ctrl+Z reverts to baseline')
            )
        )
    );
}
