/**
 * ProcessSimulator — interactive layer-by-layer deposition simulator + .res
 * export for in-chamber spectrophotometric monitoring.
 *
 * Models the spectrum a spectrophotometer aimed through the chamber sees while
 * the active coating builds up. The user picks the active side (front/back),
 * the opposite-side state (bare/coated), the measured quantity (R/T/A), AOI,
 * polarization, and the spectral grid. A timeline scrubs through the
 * deposition; the chart shows:
 *   • the baseline (uncoated) curve (dim)
 *   • one curve per layer-completion step (color-graded by deposition order)
 *   • the LIVE curve at the current scrubber position (bold)
 *
 * Layer-numbering convention (matches chamber deposition order):
 *   Layer 1 = first deposited = layer touching substrate.
 *
 * TFStudio storage convention:
 *   frontLayers — top→substrate (last entry touches substrate; deposited first)
 *   backLayers  — substrate→exit (first entry touches substrate; deposited first)
 *
 * Optional per-material deposition rates (nm/s) shape the time axis only —
 * spectral evaluation depends solely on the geometric state.
 *
 * The .res export reuses utils/processFileExport.js (one file per completed
 * deposition step) so the format matches the reference files the existing
 * monitoring software expects.
 */

import { useDesign }              from '../../state/DesignContext.js';
import { evaluateSpectrumTotal }  from '../../utils/physics/thinFilmMath.js';
import { getMaterialById }        from '../../utils/materials/catalogManager.js';
import { getMaterial }            from '../../utils/materials/materialDatabase.js';
import { buildAllProcessFiles }   from '../../utils/io/processFileExport.js';
import { Checkbox }               from '../ui/Checkbox.js';

const { createElement: h, useState, useEffect, useMemo, useCallback, useRef } = React;

function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// ── localStorage helpers ──────────────────────────────────────────────────────
// Persisted: per-material deposition rates and the most-recent setup choices.
// All keyed under one root so a single read/write round-trip covers them.

const PERSIST_KEY = 'tfstudio-process-sim-v1';

function loadPersist() {
    try {
        const raw = localStorage.getItem(PERSIST_KEY);
        if (!raw) return {};
        const obj = JSON.parse(raw);
        return obj && typeof obj === 'object' ? obj : {};
    } catch (_) { return {}; }
}

function savePersist(patch) {
    try {
        const prev = loadPersist();
        localStorage.setItem(PERSIST_KEY, JSON.stringify({ ...prev, ...patch }));
    } catch (_) {}
}

// ── Color helpers ─────────────────────────────────────────────────────────────
// Sequential HSL ramp for the N step-curves: 220° (blue) → 0° (red) so that
// "step 1" is cold and "step N" is hot, reading deposition order at a glance.

function stepColor(i, N, alpha = 0.55) {
    const h0 = N <= 1 ? 200 : 220 - (i / (N - 1)) * 220;
    return `hsla(${h0}, 70%, 55%, ${alpha})`;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtNum(n, decimals = 1) {
    if (!isFinite(n)) return '—';
    return n.toFixed(decimals);
}

// Long material names/ids overflow the narrow sequence/rate tables — cull to
// `max` chars with an ellipsis; the full name stays available as a tooltip.
function cullName(name, max = 18) {
    if (!name) return '';
    return name.length > max ? name.slice(0, max - 1) + '…' : name;
}
function matDisplay(id) {
    const m = resolveMat(id);
    return (m && m.name) || id || '';
}

// ── Spectrum computation ──────────────────────────────────────────────────────
//
// computeSpectrum builds a partial deposition state and runs the total-system
// TMM (front + substrate + back, incoherent substrate). Active layers are
// passed in DEPOSITION order (substrate-side first) and converted to the
// renderer's storage order inside the function. layerIdx = 0 means "before any
// deposition" (baseline / uncoated active side).
//
// Returns { lambda: [nm], values: [0..1] }  — `values` is the chosen quantity.

function computeSpectrum({
    activeDep, otherDep, activeSide, secondSurface,
    layerIdx, frac, quantity, aoi, polarization,
    lambdaStart, lambdaEnd, lambdaStep,
    incidentMat, substrateMat, exitMat, substrateThk,
}) {
    const N = activeDep.length;
    const state = activeDep.map((l, i) => {
        const dep = i + 1;
        if (dep < layerIdx) return { material: l.matObj, thickness: l.thickness };
        if (dep === layerIdx) return { material: l.matObj, thickness: l.thickness * Math.max(0, Math.min(1, frac)) };
        return { material: l.matObj, thickness: 0 };
    });

    // To TFStudio storage order
    let frontStored, backStored;
    if (activeSide === 'front') {
        frontStored = [...state].reverse();
        backStored  = secondSurface === 'coated'
            ? otherDep.map(l => ({ material: l.matObj, thickness: l.thickness }))
            : [];
    } else {
        backStored  = state;
        frontStored = secondSurface === 'coated'
            ? [...otherDep].reverse().map(l => ({ material: l.matObj, thickness: l.thickness }))
            : [];
    }

    const spec = evaluateSpectrumTotal(
        { lambdaStart, lambdaEnd, lambdaStep, theta: aoi, polarization },
        incidentMat, substrateMat, exitMat,
        frontStored, backStored, substrateThk,
    );

    const values = (quantity === 'R') ? spec.R : (quantity === 'A') ? spec.A : spec.T;
    return { lambda: spec.lambda, values };
}

// ── Plot ──────────────────────────────────────────────────────────────────────

function SpectraChart({
    c, lambdas, baseline, stepCurves, liveCurve, currentStep, showSteps,
    quantity, t,
}) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const sp = t.processSim;

    const bgColor    = c.bg    || '#1e1e1e';
    const paperColor = c.panel || '#252526';
    const gridColor  = c.border|| '#3a3a3a';
    const textColor  = c.text  || '#cccccc';
    const accent     = c.accent|| '#3aafff';

    const buildTraces = useCallback(() => {
        const traces = [];
        if (baseline) {
            traces.push({
                x: lambdas, y: baseline.map(v => v * 100),
                name: sp.legendBaseline,
                type: 'scatter', mode: 'lines',
                line: { color: textColor, width: 1, dash: 'dot' },
                opacity: 0.55,
                hovertemplate: `%{x:.1f} nm<br>${quantity}: %{y:.3f}%<extra>${sp.legendBaseline}</extra>`,
            });
        }
        if (showSteps && stepCurves) {
            const N = stepCurves.length;
            for (let i = 0; i < N; i++) {
                const isCurrent = (i + 1) === currentStep;
                traces.push({
                    x: lambdas, y: stepCurves[i].map(v => v * 100),
                    name: sp.legendStep(i + 1),
                    type: 'scatter', mode: 'lines',
                    line: {
                        color: stepColor(i, N, isCurrent ? 0.95 : 0.45),
                        width: isCurrent ? 2 : 1.1,
                    },
                    hovertemplate: `%{x:.1f} nm<br>${quantity}: %{y:.3f}%<extra>${sp.legendStep(i + 1)}</extra>`,
                });
            }
        }
        if (liveCurve) {
            traces.push({
                x: lambdas, y: liveCurve.map(v => v * 100),
                name: sp.legendLive,
                type: 'scatter', mode: 'lines',
                line: { color: accent, width: 2.6 },
                hovertemplate: `%{x:.1f} nm<br>${quantity}: %{y:.3f}%<extra>${sp.legendLive}</extra>`,
            });
        }
        return traces;
    }, [lambdas, baseline, stepCurves, liveCurve, currentStep, showSteps, quantity, accent, textColor, sp]);

    const layout = useMemo(() => ({
        margin: { l: 52, r: 16, t: 12, b: 42 },
        paper_bgcolor: paperColor,
        plot_bgcolor: bgColor,
        font: { color: textColor, family: 'system-ui, -apple-system, sans-serif', size: 11 },
        xaxis: {
            title: { text: 'Wavelength (nm)', standoff: 6 },
            gridcolor: gridColor, gridwidth: 1, zerolinecolor: gridColor,
            tickfont: { size: 10 },
        },
        yaxis: {
            title: { text: `${quantity} (%)`, standoff: 6 },
            range: [0, 100],
            gridcolor: gridColor, gridwidth: 1, zerolinecolor: gridColor,
            tickfont: { size: 10 },
        },
        legend: {
            bgcolor: paperColor + 'cc', bordercolor: gridColor, borderwidth: 1,
            font: { size: 10 }, x: 1, xanchor: 'right', y: 1, yanchor: 'top',
        },
        hovermode: 'x unified',
        autosize: true,
    }), [paperColor, bgColor, gridColor, textColor, quantity]);

    const config = {
        displaylogo: false, responsive: true, displayModeBar: true,
        modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'],
        toImageButtonOptions: { format: 'png', filename: 'TFStudio_process', scale: 2 },
    };

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        const traces = buildTraces();
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, traces, layout, config);
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, traces, layout, config);
        }
    }, [buildTraces, layout]);

    useEffect(() => {
        const el = divRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el);
        return () => {
            ro.disconnect();
            if (el && initRef.current) {
                try { Plotly.purge(el); } catch (_) {}
                initRef.current = false;
            }
        };
    }, []);

    if (typeof Plotly === 'undefined') {
        return h('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim },
        }, 'Plotly not loaded');
    }
    return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
}

// ── UI primitives ─────────────────────────────────────────────────────────────

function SegBtn({ active, onClick, c, position, children, disabled, flex }) {
    const radius = position === 'first' ? '4px 0 0 4px'
                 : position === 'last'  ? '0 4px 4px 0'
                 : '0';
    return h('button', {
        onClick, disabled,
        style: {
            padding: '4px 10px', fontSize: 11, cursor: disabled ? 'not-allowed' : 'pointer', outline: 'none',
            border: `1px solid ${active ? c.accent : c.border}`,
            borderRadius: radius,
            marginLeft: position === 'first' ? 0 : -1,
            backgroundColor: active ? c.accent + '33' : 'transparent',
            color: active ? c.accent : (disabled ? c.textDim : c.text),
            fontWeight: active ? 600 : 400, flexShrink: 0,
            position: 'relative', zIndex: active ? 1 : 0,
            flex: flex || 'unset',
            opacity: disabled ? 0.5 : 1,
            whiteSpace: 'nowrap',
        },
    }, children);
}

function NumInput({ value, onChange, min, max, step = 1, c, width = 70 }) {
    const [raw, setRaw] = useState(String(value));
    useEffect(() => { setRaw(String(value)); }, [value]);
    const commit = () => {
        const v = parseFloat(raw);
        if (!isNaN(v)) {
            const clamped = Math.min(Math.max(v, min ?? -Infinity), max ?? Infinity);
            onChange(clamped);
            setRaw(String(clamped));
        } else {
            setRaw(String(value));
        }
    };
    return h('input', {
        type: 'number', value: raw, min, max, step,
        onChange: (e) => setRaw(e.target.value),
        onBlur: commit,
        onKeyDown: (e) => { if (e.key === 'Enter') e.currentTarget.blur(); },
        style: {
            width, height: 24,
            backgroundColor: c.bg, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 3,
            fontSize: 11, padding: '0 5px', outline: 'none', textAlign: 'right',
        },
    });
}

function FieldLabel({ children, c }) {
    return h('span', {
        style: {
            fontSize: 10, color: c.textDim, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.4px',
            whiteSpace: 'nowrap', flexShrink: 0,
        },
    }, children);
}

function Divider({ c }) {
    return h('div', {
        style: { width: 1, height: 18, background: c.border, flexShrink: 0, margin: '0 6px' },
    });
}

// ── Main component ───────────────────────────────────────────────────────────

export function ProcessSimulator({ c, theme, t }) {
    const { design } = useDesign();
    const sp = t.processSim;

    const persisted = useRef(loadPersist()).current;

    // ── Setup state (persisted across mounts) ─────────────────────────────────
    const [activeSide,    setActiveSide]    = useState(persisted.activeSide    || 'front');
    const [secondSurface, setSecondSurface] = useState(persisted.secondSurface || 'bare');
    const [quantity,      setQuantity]      = useState(persisted.quantity      || 'T');
    const [aoi,           setAoi]           = useState(persisted.aoi != null ? persisted.aoi : 0);
    const [polarization,  setPolarization]  = useState(persisted.polarization  || 'avg');
    const [lambdaStart,   setLambdaStart]   = useState(persisted.lambdaStart   || 400);
    const [lambdaEnd,     setLambdaEnd]     = useState(persisted.lambdaEnd     || 1100);
    // Default a coarser step than the export grid so scrubbing is interactive;
    // export grid (below) is independent and matches typical spectrophotometers.
    const [lambdaStep,    setLambdaStep]    = useState(persisted.lambdaStep    || 2);
    const [exportStep,    setExportStep]    = useState(persisted.exportStep    || 0.4375);
    const [showSteps,     setShowSteps]     = useState(persisted.showSteps !== false);
    const [rates,         setRates]         = useState(persisted.rates || {}); // { materialId: nm/s }
    const [playSpeed,     setPlaySpeed]     = useState(persisted.playSpeed     || 1);

    // Persist on change (cheap localStorage write, debounced via effect)
    useEffect(() => {
        savePersist({
            activeSide, secondSurface, quantity, aoi, polarization,
            lambdaStart, lambdaEnd, lambdaStep, exportStep, showSteps,
            rates, playSpeed,
        });
    }, [activeSide, secondSurface, quantity, aoi, polarization, lambdaStart, lambdaEnd, lambdaStep, exportStep, showSteps, rates, playSpeed]);

    // ── Resolve materials & deposition-order arrays ───────────────────────────
    const { activeDep, otherDep, materials, incidentMat, substrateMat, exitMat, substrateThk } = useMemo(() => {
        if (!design) {
            return { activeDep: [], otherDep: [], materials: [],
                     incidentMat: getMaterial('Air'), substrateMat: getMaterial('BK7'),
                     exitMat: getMaterial('Air'), substrateThk: 1.0 };
        }
        const frontStored = (design.frontLayers || []).filter(l => l && l.thickness > 0);
        const backStored  = (design.backLayers  || []).filter(l => l && l.thickness > 0);

        // To deposition order (substrate-side first):
        //   front storage is top→sub  → reverse
        //   back  storage is sub→exit → as-is
        const frontDep = [...frontStored].reverse();
        const backDep  = backStored.slice();

        const activeArr = activeSide === 'front' ? frontDep : backDep;
        const otherArr  = activeSide === 'front' ? backDep  : frontDep;

        const toResolved = (arr) => arr.map((l, i) => ({
            id:         `${l.id || i}-${l.material}`,
            materialId: l.material,
            thickness:  l.thickness,
            matObj:     resolveMat(l.material),
        }));

        const resolvedActive = toResolved(activeArr);
        const resolvedOther  = toResolved(otherArr);

        const mset = new Set();
        for (const l of [...resolvedActive, ...resolvedOther]) mset.add(l.materialId);

        return {
            activeDep:    resolvedActive,
            otherDep:     resolvedOther,
            materials:    Array.from(mset),
            incidentMat:  resolveMat(design.incidentMedium),
            substrateMat: resolveMat(design.substrate?.material),
            exitMat:      resolveMat(design.exitMedium),
            substrateThk: design.substrate?.thickness || 1.0,
        };
    }, [design, activeSide]);

    const N = activeDep.length;

    // ── Deposition-rate helpers ───────────────────────────────────────────────
    const effRate = useCallback((matId) => {
        const r = parseFloat(rates[matId]);
        return (isFinite(r) && r > 0) ? r : 1.0;
    }, [rates]);

    const layerTimes = useMemo(() =>
        activeDep.map(l => l.thickness / effRate(l.materialId)),
    [activeDep, effRate]);

    const totalTime = useMemo(() => layerTimes.reduce((a, b) => a + b, 0), [layerTimes]);

    // Cumulative time at the END of each layer (length N+1; cum[0] = 0)
    const cumTimes = useMemo(() => {
        const out = [0];
        for (const t of layerTimes) out.push(out[out.length - 1] + t);
        return out;
    }, [layerTimes]);

    // ── Scrubber: progress is the single source of truth ──────────────────────
    const [progress, setProgress] = useState(0);
    const [playing,  setPlaying]  = useState(false);

    // Reset progress when totalTime collapses or grows beyond range
    useEffect(() => {
        setProgress((p) => Math.min(p, totalTime));
        if (totalTime === 0) setPlaying(false);
    }, [totalTime]);

    // Derive (layerIdx, frac) from progress
    const { layerIdx, frac, completedSteps } = useMemo(() => {
        if (N === 0) return { layerIdx: 0, frac: 0, completedSteps: 0 };
        // Find the first layer whose cumulative end-time exceeds progress
        for (let i = 0; i < N; i++) {
            if (progress < cumTimes[i + 1] - 1e-12) {
                const tStart = cumTimes[i];
                const dT = layerTimes[i];
                const fr = dT > 0 ? Math.max(0, Math.min(1, (progress - tStart) / dT)) : 1;
                return { layerIdx: i + 1, frac: fr, completedSteps: i };
            }
        }
        return { layerIdx: N, frac: 1, completedSteps: N };
    }, [progress, cumTimes, layerTimes, N]);

    // ── Animation ─────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!playing || N === 0 || totalTime <= 0) return;
        let raf, last;
        const tick = (now) => {
            if (last == null) last = now;
            const dt = (now - last) / 1000;  // real seconds
            last = now;
            setProgress(p => {
                const np = p + dt * playSpeed;
                if (np >= totalTime) {
                    setPlaying(false);
                    return totalTime;
                }
                return np;
            });
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [playing, N, totalTime, playSpeed]);

    // ── Spectra ───────────────────────────────────────────────────────────────
    const specParamsKey = useMemo(() => JSON.stringify({
        activeSide, secondSurface, quantity, aoi, polarization,
        lambdaStart, lambdaEnd, lambdaStep,
        designId: design?.id, N,
        // Material objects identity stays stable through resolveMat, so we key
        // on the layer thicknesses + material IDs which capture all spectral input.
        active: activeDep.map(l => `${l.materialId}@${l.thickness}`),
        other:  otherDep .map(l => `${l.materialId}@${l.thickness}`),
        subId:  design?.substrate?.material,
        subThk: design?.substrate?.thickness,
        inc:    design?.incidentMedium,
        exit:   design?.exitMedium,
    }), [activeSide, secondSurface, quantity, aoi, polarization,
         lambdaStart, lambdaEnd, lambdaStep, activeDep, otherDep, design, N]);

    const specCommon = {
        activeDep, otherDep, activeSide, secondSurface, quantity, aoi, polarization,
        lambdaStart, lambdaEnd, lambdaStep,
        incidentMat, substrateMat, exitMat, substrateThk,
    };

    // Baseline (layerIdx = 0, before any deposition)
    const baselineSpec = useMemo(() => {
        if (!(lambdaEnd > lambdaStart) || !(lambdaStep > 0)) return null;
        return computeSpectrum({ ...specCommon, layerIdx: 0, frac: 0 });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [specParamsKey]);

    // Per-step end-state spectra (one per completed layer, N curves)
    const stepSpectra = useMemo(() => {
        if (!(lambdaEnd > lambdaStart) || !(lambdaStep > 0)) return null;
        if (N === 0) return [];
        const out = [];
        for (let k = 1; k <= N; k++) {
            out.push(computeSpectrum({ ...specCommon, layerIdx: k, frac: 1 }));
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [specParamsKey]);

    // Live spectrum at the current scrubber position
    const liveSpec = useMemo(() => {
        if (!(lambdaEnd > lambdaStart) || !(lambdaStep > 0)) return null;
        if (N === 0) return baselineSpec;
        return computeSpectrum({ ...specCommon, layerIdx, frac });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [specParamsKey, layerIdx, frac, baselineSpec]);

    const lambdas = baselineSpec?.lambda || [];

    // ── Save .res files ───────────────────────────────────────────────────────
    const [saving,    setSaving]    = useState(false);
    const [statusMsg, setStatusMsg] = useState(null); // { type, message }

    const handleSave = useCallback(async () => {
        if (!design || N === 0 || saving) return;
        setSaving(true);
        try {
            // Pick the destination first so we can stamp its real path inside
            // each .res header (and so the user gets the picker immediately
            // rather than after the build).
            const pick = await window.electronAPI.pickProcessSaveDir();
            if (pick?.canceled) { setSaving(false); return; }
            const dir = pick?.dir;
            if (!dir) {
                setStatusMsg({ type: 'error', message: sp.errSave(pick?.error || 'no folder') });
                setSaving(false);
                return;
            }

            const appVersion = await window.electronAPI.getAppVersion().catch(() => '');

            const files = buildAllProcessFiles(design, {
                activeSide, secondSurface, quantity, aoi, polarization,
                lambdaStart, lambdaEnd, lambdaStep: exportStep,
                outputDir: dir,
                appVersion,
                projectLabel: design.name,
            });
            if (!files.length) {
                setStatusMsg({ type: 'error', message: sp.errNoLayers });
                setSaving(false);
                return;
            }
            const res = await window.electronAPI.saveProcessFiles(files, dir);
            if (!res?.success) {
                setStatusMsg({ type: 'error', message: sp.errSave(res?.error || 'unknown') });
                setSaving(false);
                return;
            }
            setStatusMsg({ type: 'success', message: sp.successMsg(files.length, res.dir) });
            setSaving(false);
        } catch (err) {
            setStatusMsg({ type: 'error', message: sp.errSave(err.message || String(err)) });
            setSaving(false);
        }
    }, [design, N, saving, activeSide, secondSurface, quantity, aoi, polarization, lambdaStart, lambdaEnd, exportStep, sp]);

    // Auto-clear status banner after a short delay so it doesn't linger forever.
    useEffect(() => {
        if (!statusMsg) return;
        const t = setTimeout(() => setStatusMsg(null), 6000);
        return () => clearTimeout(t);
    }, [statusMsg]);

    // ── Timeline interaction ──────────────────────────────────────────────────
    const onTimelineChange = (val) => {
        setPlaying(false);
        setProgress(val);
    };

    const handleReset = () => { setPlaying(false); setProgress(0); };
    const handlePlayPause = () => {
        if (totalTime <= 0) return;
        if (progress >= totalTime - 1e-9) setProgress(0);
        setPlaying(p => !p);
    };

    // Compose a sticky banner if no layers in the active coating.
    const hasActive    = N > 0;
    const showOtherHint = secondSurface === 'coated' && otherDep.length === 0;

    // ── Render ────────────────────────────────────────────────────────────────
    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            backgroundColor: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            overflow: 'hidden',
        },
    },
        // ── Top toolbar (setup) ─────────────────────────────────────────────
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 10px',
                backgroundColor: c.panel,
                borderBottom: `1px solid ${c.border}`,
                flexWrap: 'wrap', flexShrink: 0,
            },
        },
            h(FieldLabel, { c }, sp.activeSide),
            h('div', { style: { display: 'flex' } },
                h(SegBtn, { active: activeSide === 'front', onClick: () => setActiveSide('front'), c, position: 'first' }, sp.front),
                h(SegBtn, { active: activeSide === 'back',  onClick: () => setActiveSide('back'),  c, position: 'last'  }, sp.back),
            ),

            h(Divider, { c }),
            h(FieldLabel, { c }, sp.secondSurface),
            h('div', { style: { display: 'flex' } },
                h(SegBtn, { active: secondSurface === 'bare',   onClick: () => setSecondSurface('bare'),   c, position: 'first' }, sp.bare),
                h(SegBtn, { active: secondSurface === 'coated', onClick: () => setSecondSurface('coated'), c, position: 'last'  }, sp.coated),
            ),

            h(Divider, { c }),
            h(FieldLabel, { c }, sp.quantity),
            h('div', { style: { display: 'flex' } },
                h(SegBtn, { active: quantity === 'T', onClick: () => setQuantity('T'), c, position: 'first' }, 'T'),
                h(SegBtn, { active: quantity === 'R', onClick: () => setQuantity('R'), c },                    'R'),
                h(SegBtn, { active: quantity === 'A', onClick: () => setQuantity('A'), c, position: 'last'  }, 'A'),
            ),

            h(Divider, { c }),
            h(FieldLabel, { c }, sp.aoi),
            h(NumInput, { value: aoi, onChange: setAoi, min: 0, max: 89, step: 1, c, width: 56 }),

            h(Divider, { c }),
            h(FieldLabel, { c }, sp.polarization),
            h('div', { style: { display: 'flex' } },
                h(SegBtn, { active: polarization === 'avg', onClick: () => setPolarization('avg'), c, position: 'first' }, sp.polAvg),
                h(SegBtn, { active: polarization === 's',   onClick: () => setPolarization('s'),   c                  }, 's'),
                h(SegBtn, { active: polarization === 'p',   onClick: () => setPolarization('p'),   c, position: 'last'  }, 'p'),
            ),

            // Spacer pushes the save button to the right
            h('div', { style: { flex: 1 } }),

            h('button', {
                onClick: handleSave, disabled: !hasActive || saving,
                title: sp.saveBtn,
                style: {
                    padding: '5px 12px', fontSize: 12,
                    border: 'none', borderRadius: 4,
                    backgroundColor: hasActive ? c.accent : c.border,
                    color: hasActive ? '#fff' : c.textDim,
                    cursor: hasActive ? 'pointer' : 'not-allowed',
                    opacity: saving ? 0.6 : 1,
                    fontWeight: 600, whiteSpace: 'nowrap',
                },
            }, saving ? sp.saving : sp.saveBtn),
        ),

        // ── Second toolbar row (spectral range + show-curves + status) ─────
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px',
                backgroundColor: c.panel,
                borderBottom: `1px solid ${c.border}`,
                flexWrap: 'wrap', flexShrink: 0,
            },
        },
            h(FieldLabel, { c }, sp.spectralRange),
            h(NumInput, { value: lambdaStart, onChange: setLambdaStart, min: 100, max: 50000, step: 10, c, width: 64 }),
            h('span', { style: { fontSize: 11, color: c.textDim } }, sp.to),
            h(NumInput, { value: lambdaEnd, onChange: setLambdaEnd, min: 100, max: 50000, step: 10, c, width: 64 }),
            h('span', { style: { fontSize: 11, color: c.textDim } }, sp.step),
            h(NumInput, { value: lambdaStep, onChange: setLambdaStep, min: 0.1, max: 100, step: 0.5, c, width: 60 }),
            h('span', { style: { fontSize: 11, color: c.textDim } }, 'nm'),

            h(Divider, { c }),
            h('label', {
                style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: c.text, cursor: 'pointer' },
            },
                h(Checkbox, {
                    c, checked: showSteps,
                    onChange: (e) => setShowSteps(e.target.checked),
                }),
                sp.showStepCurves,
            ),

            h(Divider, { c }),
            h(FieldLabel, { c }, 'Export step (nm)'),
            h(NumInput, { value: exportStep, onChange: setExportStep, min: 0.01, max: 100, step: 0.1, c, width: 70 }),

            statusMsg && h('div', {
                style: {
                    fontSize: 11, padding: '4px 10px', borderRadius: 4,
                    backgroundColor: statusMsg.type === 'error' ? '#c0392b22' : '#27ae6022',
                    color: statusMsg.type === 'error' ? '#e57373' : '#81c784',
                    border: `1px solid ${statusMsg.type === 'error' ? '#c0392b' : '#27ae60'}`,
                    marginLeft: 8, maxWidth: '40%',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                },
                title: statusMsg.message,
            }, statusMsg.message),
        ),

        showOtherHint && h('div', {
            style: {
                padding: '4px 12px', fontSize: 11, color: c.textDim,
                backgroundColor: c.panel,
                borderBottom: `1px solid ${c.border}`,
            },
        }, sp.hintNoOtherLayers),

        // ── Body: left = sequence + rates, right = chart ───────────────────
        h('div', { style: { display: 'flex', flex: 1, overflow: 'hidden' } },

            // ── Left sidebar ────────────────────────────────────────────────
            h('div', {
                style: {
                    width: 340, minWidth: 240,
                    borderRight: `1px solid ${c.border}`,
                    backgroundColor: c.panel,
                    overflowY: 'auto', flexShrink: 0,
                    fontSize: 11,
                },
            },
                // ── Deposition sequence table ─────────────────────────────
                h('div', { style: { padding: '8px 10px' } },
                    h('div', {
                        style: {
                            fontSize: 10, fontWeight: 700, color: c.textDim,
                            textTransform: 'uppercase', letterSpacing: '0.4px',
                            marginBottom: 6,
                        },
                    }, sp.sectionSequence),
                    !hasActive
                        ? h('div', { style: { color: c.textDim, padding: '8px 0' } }, sp.noLayers)
                        : h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 11 } },
                            h('thead', null,
                                h('tr', { style: { color: c.textDim } },
                                    h('th', { style: { textAlign: 'left',  padding: '4px 4px' } }, sp.layerNum),
                                    h('th', { style: { textAlign: 'left',  padding: '4px 4px' } }, sp.layerMat),
                                    h('th', { style: { textAlign: 'right', padding: '4px 4px' } }, sp.layerThk),
                                    h('th', { style: { textAlign: 'right', padding: '4px 4px' } }, sp.layerTime),
                                ),
                            ),
                            h('tbody', null,
                                activeDep.map((l, i) => {
                                    const dep = i + 1;
                                    const isCurrent = dep === layerIdx;
                                    const isDone    = dep <= completedSteps;
                                    return h('tr', {
                                        key: l.id,
                                        style: {
                                            backgroundColor: isCurrent ? c.accent + '22' : 'transparent',
                                            color: isDone ? c.text : (isCurrent ? c.accent : c.textDim),
                                            fontWeight: isCurrent ? 600 : 400,
                                            borderBottom: `1px solid ${c.border}33`,
                                        },
                                    },
                                        h('td', { style: { padding: '4px 4px' } }, dep),
                                        h('td', { style: { padding: '4px 4px', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: matDisplay(l.materialId) }, cullName(matDisplay(l.materialId))),
                                        h('td', { style: { padding: '4px 4px', textAlign: 'right' } }, fmtNum(l.thickness, 2)),
                                        h('td', { style: { padding: '4px 4px', textAlign: 'right' } }, fmtNum(layerTimes[i], 1)),
                                    );
                                }),
                                hasActive && h('tr', {
                                    style: {
                                        color: c.textDim, fontSize: 10,
                                        borderTop: `1px solid ${c.border}`,
                                    },
                                },
                                    h('td', { colSpan: 3, style: { padding: '6px 4px', textAlign: 'right' } }, sp.totalTime),
                                    h('td', { style: { padding: '6px 4px', textAlign: 'right' } }, fmtNum(totalTime, 1) + ' s'),
                                ),
                            ),
                        ),
                ),

                // ── Deposition rates ──────────────────────────────────────
                h('div', { style: { padding: '8px 10px', borderTop: `1px solid ${c.border}` } },
                    h('div', {
                        style: {
                            fontSize: 10, fontWeight: 700, color: c.textDim,
                            textTransform: 'uppercase', letterSpacing: '0.4px',
                            marginBottom: 6,
                        },
                    }, sp.sectionRates),
                    h('div', { style: { color: c.textDim, fontSize: 10, marginBottom: 6, lineHeight: 1.4 } },
                        sp.rateHint),
                    materials.length === 0
                        ? h('div', { style: { color: c.textDim, fontSize: 11 } }, '—')
                        : h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 11 } },
                            h('thead', null,
                                h('tr', { style: { color: c.textDim } },
                                    h('th', { style: { textAlign: 'left',  padding: '4px 4px' } }, sp.layerMat),
                                    h('th', { style: { textAlign: 'right', padding: '4px 4px' } }, sp.rateNmS),
                                ),
                            ),
                            h('tbody', null,
                                materials.map((mid) => h('tr', { key: mid },
                                    h('td', { style: { padding: '4px 4px', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: matDisplay(mid) }, cullName(matDisplay(mid))),
                                    h('td', { style: { padding: '4px 4px', textAlign: 'right' } },
                                        h(NumInput, {
                                            value: rates[mid] != null ? rates[mid] : 1.0,
                                            onChange: (v) => setRates(prev => ({ ...prev, [mid]: v })),
                                            min: 0.001, max: 1000, step: 0.1,
                                            c, width: 78,
                                        }),
                                    ),
                                )),
                            ),
                        ),
                ),
            ),

            // ── Right pane: chart ───────────────────────────────────────────
            h('div', { style: { flex: 1, position: 'relative', minWidth: 0, overflow: 'hidden' } },
                h(SpectraChart, {
                    c, lambdas,
                    baseline:    baselineSpec?.values,
                    stepCurves:  stepSpectra?.map(s => s.values),
                    liveCurve:   liveSpec?.values,
                    currentStep: layerIdx,
                    showSteps,
                    quantity, t,
                }),
            ),
        ),

        // ── Bottom: timeline scrubber ──────────────────────────────────────
        h('div', {
            style: {
                display: 'flex', flexDirection: 'column', gap: 4,
                padding: '8px 12px',
                backgroundColor: c.panel,
                borderTop: `1px solid ${c.border}`,
                flexShrink: 0,
            },
        },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                h('button', {
                    onClick: handlePlayPause, disabled: !hasActive,
                    style: {
                        padding: '4px 12px', fontSize: 12,
                        border: `1px solid ${c.border}`, borderRadius: 4,
                        backgroundColor: c.bg, color: c.text,
                        cursor: hasActive ? 'pointer' : 'not-allowed',
                        opacity: hasActive ? 1 : 0.5,
                        fontWeight: 600, minWidth: 86,
                    },
                }, playing ? sp.pause : sp.play),

                h('button', {
                    onClick: handleReset, disabled: !hasActive,
                    style: {
                        padding: '4px 10px', fontSize: 12,
                        border: `1px solid ${c.border}`, borderRadius: 4,
                        backgroundColor: c.bg, color: c.text,
                        cursor: hasActive ? 'pointer' : 'not-allowed',
                        opacity: hasActive ? 1 : 0.5,
                    },
                }, sp.reset),

                h(FieldLabel, { c }, sp.speed),
                h('div', { style: { display: 'flex' } },
                    [0.5, 1, 2, 5, 10].map((s, i, arr) =>
                        h(SegBtn, {
                            key: s,
                            active: playSpeed === s,
                            onClick: () => setPlaySpeed(s),
                            c,
                            position: i === 0 ? 'first' : i === arr.length - 1 ? 'last' : null,
                        }, sp.speedX(s)),
                    ),
                ),

                h('div', { style: { flex: 1 } }),

                h('div', { style: { fontSize: 11, color: c.text, fontVariantNumeric: 'tabular-nums' } },
                    sp.currentStep(layerIdx, N || 0)),
                h('div', { style: { fontSize: 11, color: c.textDim, fontVariantNumeric: 'tabular-nums' } },
                    sp.currentTime(progress, totalTime)),
            ),

            // Slider
            h('div', { style: { position: 'relative' } },
                h('input', {
                    type: 'range',
                    min: 0,
                    max: Math.max(totalTime, 0.001),
                    step: Math.max(totalTime / 1000, 0.001),
                    value: Math.min(progress, totalTime),
                    onChange: (e) => onTimelineChange(parseFloat(e.target.value)),
                    disabled: !hasActive,
                    style: {
                        width: '100%', accentColor: c.accent,
                        opacity: hasActive ? 1 : 0.4,
                    },
                }),
                // Tick marks at each layer boundary
                hasActive && h('div', {
                    style: {
                        position: 'relative', height: 14, marginTop: -2,
                        fontSize: 9, color: c.textDim, userSelect: 'none',
                    },
                },
                    cumTimes.map((t, i) => {
                        const pct = totalTime > 0 ? (t / totalTime) * 100 : 0;
                        return h('div', {
                            key: i,
                            style: {
                                position: 'absolute', left: `${pct}%`,
                                transform: 'translateX(-50%)',
                                display: 'flex', flexDirection: 'column',
                                alignItems: 'center', lineHeight: 1,
                            },
                        },
                            h('div', { style: { width: 1, height: 4, background: c.border } }),
                            i > 0 && h('span', null, i),
                        );
                    }),
                ),
            ),
        ),
    );
}
