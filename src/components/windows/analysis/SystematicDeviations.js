/**
 * Systematic Deviations window — simulate the spectrum of a coating built
 * under a uniform thickness / index error and/or sweep one deviation
 * parameter over a range to visualize the corridor of possible outcomes.
 *
 * Two modes:
 *   - SINGLE  : apply current deviation values, overlay perturbed vs baseline
 *               T/R/A.
 *   - SWEEP   : vary one chosen parameter across [from, to] in N steps,
 *               render a 2-D heatmap (param value × λ → T/R/A). A line cut
 *               at user-selected λ shows the dependence directly.
 */

import { useDesign }       from '../../../state/DesignContext.js';
import { EvalModeBadge }   from '../../SurfaceModeBar.js';
import { getMaterialById } from '../../../utils/materials/catalogManager.js';
import { getMaterial }     from '../../../utils/materials/materialDatabase.js';
import {
    emptyDeviation, cloneDeviation, isIdentityDeviation,
    enumerateUniqueMaterials,
    computeDeviatedSpectrum, runDeviationSweep, paramLabel,
    deviatedDesignForSpec,
} from '../../../utils/physics/systematicDeviations.js';
import { SpecVerdict } from '../../SpecVerdict.js';
import { Checkbox } from '../../ui/Checkbox.js';
import { DebouncedInput } from '../../ui/DebouncedInput.js';

const { createElement: h, useState, useMemo, useEffect, useRef, useCallback } = React;

function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// ── Sweep range defaults ──────────────────────────────────────────────────────
// The from/to defaults are sized for a ×-scale (0.95–1.05). When the user
// switches the swept parameter, the meaningful range changes completely
// (an offset is in nm/QW, Δn/Δk are tiny dimensionless steps), so re-seed
// from/to with a sensible default for the new parameter kind. The field stays
// fully editable — this only replaces the stale ×-scale window.
function sweepParamKind(param) {
    if (param === 'globalThicknessScale'  || /:dScale$/.test(param))  return 'scale';
    if (param === 'globalThicknessOffset' || /:dOffset$/.test(param)) return 'offset';
    if (param === 'globalDeltaN' || /:dn$/.test(param)) return 'dn';
    if (param === 'globalDeltaK' || /:dk$/.test(param)) return 'dk';
    return 'scale';
}
// Returns { from, to } sized to the parameter (and, for offsets, its unit).
function defaultSweepRange(param, offsetUnit = 'nm') {
    switch (sweepParamKind(param)) {
        case 'scale': return { from: 0.95, to: 1.05 };
        case 'dn':    return { from: -0.05, to: 0.05 };
        case 'dk':    return { from: -0.01, to: 0.01 };
        case 'offset':
            // ±B in the offset's own unit: a few QW/FW are big optical excursions,
            // a few nm are typical physical/OT excursions.
            switch (offsetUnit) {
                case 'qw': return { from: -0.1, to: 0.1 };
                case 'fw': return { from: -0.05, to: 0.05 };
                case 'ot':
                case 'nm':
                default:   return { from: -10, to: 10 };
            }
        default: return { from: 0.95, to: 1.05 };
    }
}

// ── Per-design state + result cache ───────────────────────────────────────────
// Switching docking windows unmounts this component, which would discard the
// heavy sweep heatmap (and reset the deviation setup). Cache the deviation
// setup, view settings, and the sweep result per design.id so the user can
// leave and re-open the window to find the generated data intact and re-run it
// manually when they choose. Matches the `_scatterCache` pattern in
// RoughnessScattering.js.
const _sdCache = new Map();
function sdDefaults() {
    return {
        dev: emptyDeviation(),
        mode: 'single', channel: 'all', showBaseline: true,
        lambdaStart: 400, lambdaEnd: 800, lambdaStep: 5, aoi: 0, pol: 'avg',
        sweep: { param: 'globalThicknessScale', from: 0.95, to: 1.05, steps: 21, offsetUnit: 'nm' },
        sweepChannel: 'T', sweepResult: null,
    };
}
function sdSnapshot(design) {
    return (design && _sdCache.get(design.id)) || sdDefaults();
}

// ── Small UI primitives ──────────────────────────────────────────────────────

// DebouncedInput-backed so the field can be cleared mid-edit; commits the parsed
// value on blur/Enter, empty/invalid → 0. (step/min/max kept for call-site
// compatibility but unused — DebouncedInput is a text field.)
function NumberInput({ value, onChange, step = 0.001, min, max, width = 64, c }) {
    return h(DebouncedInput, {
        value: String(Number.isFinite(value) ? value : 0),
        onChange: (v) => {
            const s = String(v).trim();
            const n = s === '' ? 0 : parseFloat(v);
            onChange(Number.isFinite(n) ? n : 0);
        },
        style: {
            background: c.inputBg || c.hover, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 3,
            padding: '1px 4px', fontSize: 12, width,
            fontFamily: 'system-ui, -apple-system, sans-serif',
        }
    });
}

// Thickness-offset unit selector: nm (physical) / OT / QW / FW (optical units
// converted to physical nm per layer via n(λ₀), λ₀ = design reference wavelength).
function UnitSelect({ value, onChange, c, title }) {
    return h('select', {
        value, onChange: (e) => onChange(e.target.value), title,
        style: {
            background: c.inputBg || c.hover, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 3,
            padding: '1px 2px', fontSize: 11, cursor: 'pointer',
            fontFamily: 'system-ui, -apple-system, sans-serif',
        }
    },
        h('option', { value: 'nm' }, 'nm'),
        h('option', { value: 'ot' }, 'OT'),
        h('option', { value: 'qw' }, 'QW'),
        h('option', { value: 'fw' }, 'FW'),
    );
}

function SegBtn({ active, onClick, label, c, title }) {
    return h('button', {
        onClick, title,
        style: {
            padding: '2px 10px',
            background: active ? c.accent : (c.inputBg || c.hover),
            color: active ? '#fff' : c.text,
            border: `1px solid ${active ? c.accent : c.border}`,
            borderRadius: 3, cursor: 'pointer', fontSize: 12,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            whiteSpace: 'nowrap',
        }
    }, label);
}

// ── Spectrum plot (SINGLE mode) ──────────────────────────────────────────────

function SpectrumPlot({ baseline, deviated, channel, showBaseline, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);

    const traces = useMemo(() => {
        if (!deviated) return [];
        const cFor = { T: '#4fc3f7', R: '#ef5350', A: '#66bb6a' };
        const out = [];
        const wantedKeys = channel === 'all' ? ['T', 'R', 'A'] : [channel];

        // Spectra are stored as fractions [0,1]; render in percent to match the
        // rest of the app (OpticalEvaluation, Error/Monte-Carlo, Variator …).
        const pct = (arr) => arr.map(v => v * 100);
        for (const k of wantedKeys) {
            if (showBaseline && baseline) {
                out.push({
                    x: baseline.lambda, y: pct(baseline[k]),
                    type: 'scatter', mode: 'lines',
                    name: `${k} baseline`,
                    line: { color: cFor[k], dash: 'dot', width: 1.4 },
                    hoverinfo: 'skip',
                    opacity: 0.6,
                });
            }
            out.push({
                x: deviated.lambda, y: pct(deviated[k]),
                type: 'scatter', mode: 'lines',
                name: `${k} deviated`,
                line: { color: cFor[k], width: 2 },
                hovertemplate: `λ=%{x:.1f} nm<br>${k}=%{y:.3f}%<extra></extra>`,
            });
        }
        return out;
    }, [baseline, deviated, channel, showBaseline]);

    const layout = useMemo(() => ({
        paper_bgcolor: c.panel || '#252526',
        plot_bgcolor:  c.bg    || '#1e1e1e',
        margin: { l: 56, r: 16, t: 16, b: 44 },
        xaxis: {
            title: { text: 'λ (nm)', font: { color: c.text, size: 12 } },
            color: c.text, gridcolor: c.border, zerolinecolor: c.border,
            tickfont: { color: c.text, size: 10 },
        },
        yaxis: {
            title: { text: 'T / R / A (%)', font: { color: c.text, size: 12 } },
            color: c.text, gridcolor: c.border, zerolinecolor: c.border,
            tickfont: { color: c.text, size: 10 },
            range: [0, 102], fixedrange: false,
        },
        legend: {
            orientation: 'h', x: 0, y: 1.08,
            font: { color: c.text, size: 10 }, bgcolor: 'rgba(0,0,0,0)',
        },
        hovermode: 'x unified',
    }), [c]);

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, traces, layout);
        }
    }, [traces, layout]);

    useEffect(() => {
        const el = divRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el);
        return () => { ro.disconnect(); if (el) Plotly.purge(el); };  // purge on unmount (leak fix)
    }, []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}

// ── Sweep heatmap (SWEEP mode) ───────────────────────────────────────────────

// Dark→light colorscale per channel (blue T / red R / green A), so the heatmap
// hue matches the T/R/A colors used elsewhere in the app.
const sweepColorscale = (ch) => ch === 'R'
    ? [[0, '#1e1e1e'], [0.3, '#7a2222'], [0.6, '#d04545'], [1, '#fff5f5']]
    : ch === 'A'
    ? [[0, '#1e1e1e'], [0.3, '#2a5a2a'], [0.6, '#4caf50'], [1, '#e8f5e8']]
    : [[0, '#1e1e1e'], [0.3, '#1a3a5a'], [0.6, '#4fc3f7'], [1, '#e8f4fc']];

// 2-D arrays are fractions [0,1]; show in percent like the rest of the app.
const sweep2DPercent = (z2d) => z2d.map(row => row.map(v => v * 100));

// One heatmap trace per channel, stacked top-to-bottom on independent axes.
// `colors` bundles the theme values ({ text, border }) so the signature stays small.
function sweepHeatmapTraces(sweepData, chans, colors) {
    const n = chans.length;
    const Zof = (ch) => sweep2DPercent(ch === 'R' ? sweepData.R2D : ch === 'A' ? sweepData.A2D : sweepData.T2D);
    return chans.map((ch, i) => {
        const sfx = i === 0 ? '' : String(i + 1);
        const top = 1 - i / n, bot = 1 - (i + 1) / n;   // top-to-bottom rows
        return {
            x: sweepData.lambda,
            y: sweepData.paramValues,
            z: Zof(ch),
            type: 'heatmap',
            colorscale: sweepColorscale(ch),
            zmin: 0, zmax: 100,
            xaxis: 'x' + sfx,
            yaxis: 'y' + sfx,
            colorbar: {
                title: { text: `${ch} (%)`, font: { color: colors.text, size: 11 } },
                tickfont: { color: colors.text, size: 9 },
                outlinecolor: colors.border, bgcolor: 'rgba(0,0,0,0)',
                len: n > 1 ? (1 / n) * 0.82 : 0.85, thickness: 12,
                y: (top + bot) / 2, yanchor: 'middle',
            },
            hovertemplate: `λ=%{x:.1f} nm<br>param=%{y:.4g}<br>${ch}=%{z:.3f}%<extra></extra>`,
        };
    });
}

// Layout with one x/y axis pair per stacked channel row (independent grid when
// showing all three). `colors` bundles theme values ({ text, border, panel, bg }).
function sweepHeatmapLayout(sweepData, chans, colors) {
    const n = chans.length;
    const layout = {
        paper_bgcolor: colors.panel || '#252526',
        plot_bgcolor:  colors.bg    || '#1e1e1e',
        margin: { l: 64, r: 16, t: 16, b: 44 },
        grid: n > 1 ? { rows: n, columns: 1, pattern: 'independent', roworder: 'top to bottom' } : undefined,
    };
    chans.forEach((ch, i) => {
        const sfx = i === 0 ? '' : String(i + 1);
        layout['xaxis' + sfx] = {
            title: i === n - 1 ? { text: 'λ (nm)', font: { color: colors.text, size: 12 } } : undefined,
            color: colors.text, gridcolor: colors.border, zerolinecolor: colors.border,
            tickfont: { color: colors.text, size: 10 },
        };
        layout['yaxis' + sfx] = {
            title: { text: n > 1 ? ch : (sweepData.paramName || 'Parameter'), font: { color: colors.text, size: 12 } },
            color: colors.text, gridcolor: colors.border, zerolinecolor: colors.border,
            tickfont: { color: colors.text, size: 10 },
        };
    });
    return layout;
}

// Full Plotly figure for the sweep heatmap. A heatmap shows one scalar, so
// 'all' renders three stacked heatmaps (one row per channel); a single channel
// is one full-height map.
function buildSweepFigure(sweepData, channel, colors) {
    if (!sweepData?.lambda?.length) return { data: [], layout: {} };
    const chans = channel === 'all' ? ['T', 'R', 'A'] : [channel];
    return {
        data: sweepHeatmapTraces(sweepData, chans, colors),
        layout: sweepHeatmapLayout(sweepData, chans, colors),
    };
}

function SweepHeatmap({ sweepData, channel, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);

    const { data, layout } = useMemo(
        () => buildSweepFigure(sweepData, channel, { text: c.text, border: c.border, panel: c.panel, bg: c.bg }),
        [sweepData, channel, c]
    );

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, data, layout, { responsive: true, displayModeBar: false });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, data, layout);
        }
    }, [data, layout]);

    useEffect(() => {
        const el = divRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el);
        return () => { ro.disconnect(); if (el) Plotly.purge(el); };  // purge on unmount (leak fix)
    }, []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}

// ── Main window ──────────────────────────────────────────────────────────────

export function SystematicDeviations({ c, theme, t }) {
    const { design, evalMode } = useDesign();
    const sd = (t && t.systematicDeviations) || {};

    // State restored from the per-design cache on mount (see _sdCache).
    const snap0 = useMemo(() => sdSnapshot(design), []); // eslint-disable-line react-hooks/exhaustive-deps

    // Deviation state
    const [dev, setDev] = useState(() => cloneDeviation(snap0.dev));
    const [mode, setMode] = useState(snap0.mode); // 'single' | 'sweep'
    const [channel, setChannel] = useState(snap0.channel); // 'T' | 'R' | 'A' | 'all'
    const [showBaseline, setShowBaseline] = useState(snap0.showBaseline);

    // Spectrum params
    const [lambdaStart, setLambdaStart] = useState(snap0.lambdaStart);
    const [lambdaEnd,   setLambdaEnd]   = useState(snap0.lambdaEnd);
    const [lambdaStep,  setLambdaStep]  = useState(snap0.lambdaStep);
    const [aoi,         setAoi]         = useState(snap0.aoi);
    const [pol,         setPol]         = useState(snap0.pol);

    // Sweep state
    const [sweep, setSweep] = useState(snap0.sweep);
    const [sweepChannel, setSweepChannel] = useState(snap0.sweepChannel);
    const [sweepResult, setSweepResult] = useState(snap0.sweepResult);
    const [sweepRunning, setSweepRunning] = useState(false);

    const [error, setError] = useState(null);

    // M9: rehydrate ALL state from the cache when the design changes. Without
    // this the state kept the previous design's values while the persist effect
    // below (which also fires on id change) wrote them under the NEW design's
    // cache slot — corrupting B's saved setup/results and showing A's corridor.
    // The persist effect's state deps then re-fire and write the correct values.
    // (Mirrors the RoughnessScattering rehydrate pattern.)
    useEffect(() => {
        if (!design) return;
        const snap = sdSnapshot(design);
        setDev(cloneDeviation(snap.dev));
        setMode(snap.mode);
        setChannel(snap.channel);
        setShowBaseline(snap.showBaseline);
        setLambdaStart(snap.lambdaStart);
        setLambdaEnd(snap.lambdaEnd);
        setLambdaStep(snap.lambdaStep);
        setAoi(snap.aoi);
        setPol(snap.pol);
        setSweep(snap.sweep);
        setSweepChannel(snap.sweepChannel);
        setSweepResult(snap.sweepResult);
    }, [design?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const params = useMemo(() => ({
        lambdaStart, lambdaEnd, lambdaStep, theta: aoi, polarization: pol,
    }), [lambdaStart, lambdaEnd, lambdaStep, aoi, pol]);

    const uniqueMats = useMemo(() => enumerateUniqueMaterials(design), [design]);

    // Design + resolver with the current deviation baked in, for the live
    // Specification check (does the spec survive this systematic deviation?).
    const specDev = useMemo(
        () => deviatedDesignForSpec(design, dev, resolveMaterial),
        [design, dev]
    );

    // ── Compute single-mode spectra (baseline + deviated) ────────────────────
    // Return the error as memo DATA instead of calling setError during render
    // (render-phase setState warns and the error never cleared on success — same
    // class as the LayerSensitivity fix). `computeError` is derived below.
    const baselineM = useMemo(() => {
        if (!design?.frontLayers) return { s: null, error: null };
        try { return { s: computeDeviatedSpectrum(design, params, emptyDeviation(), evalMode, resolveMaterial), error: null }; }
        catch (e) { return { s: null, error: e.message }; }
    }, [design, params, evalMode]);

    const deviatedM = useMemo(() => {
        if (!design?.frontLayers) return { s: null, error: null };
        try { return { s: computeDeviatedSpectrum(design, params, dev, evalMode, resolveMaterial), error: null }; }
        catch (e) { return { s: null, error: e.message }; }
    }, [design, params, dev, evalMode]);

    const baseline = baselineM.s;
    const deviated = deviatedM.s;
    const computeError = deviatedM.error || baselineM.error;

    // ── Run sweep ───────────────────────────────────────────────────────────
    const runSweep = useCallback(() => {
        if (!design?.frontLayers) return;
        setSweepRunning(true);
        setError(null);
        // Defer to next tick so the UI gets a chance to re-render with the
        // "running" state on heavy sweeps (e.g. 100 steps × 81 λ).
        setTimeout(() => {
            try {
                // Sweep is self-contained: vary ONLY the chosen parameter starting
                // from the unperturbed design (no global / per-material baseline —
                // that's what Single mode is for). For an offset parameter we seed
                // the chosen unit so from/to are interpreted in nm/OT/QW/FW.
                const base = emptyDeviation();
                if (sweepParamKind(sweep.param) === 'offset') {
                    const u = sweep.offsetUnit || 'nm';
                    if (sweep.param === 'globalThicknessOffset') {
                        base.globalThicknessOffsetUnit = u;
                    } else {
                        const m = /^mat:(.+):dOffset$/.exec(sweep.param);
                        if (m) base.perMaterial[m[1]] = { dn: 0, dk: 0, dScale: 1, dOffset: 0, dOffsetUnit: u };
                    }
                }
                const r = runDeviationSweep(design, params, base, sweep, evalMode, resolveMaterial);
                // Tag the result with the swept-parameter label (+ unit for
                // offsets) so the heatmap axis matches the data even if the user
                // later changes the param selector without re-running.
                const unitSfx = sweepParamKind(sweep.param) === 'offset' ? ` (${sweep.offsetUnit || 'nm'})` : '';
                r.paramName = paramLabel(sweep.param) + unitSfx;
                setSweepResult(r);
            } catch (e) {
                setError(e.message || String(e));
            }
            setSweepRunning(false);
        }, 0);
    }, [design, params, sweep, evalMode]);

    // ── Reset deviation ──────────────────────────────────────────────────────
    const resetDeviation = useCallback(() => setDev(emptyDeviation()), []);

    // ── Update helpers ───────────────────────────────────────────────────────
    const updateGlobal = useCallback((field, v) => {
        setDev(prev => {
            const next = cloneDeviation(prev);
            next[field] = v;
            return next;
        });
    }, []);

    const updateMat = useCallback((id, field, v) => {
        setDev(prev => {
            const next = cloneDeviation(prev);
            next.perMaterial = next.perMaterial || {};
            next.perMaterial[id] = next.perMaterial[id] || { dn: 0, dk: 0, dScale: 1, dOffset: 0, dOffsetUnit: 'nm' };
            next.perMaterial[id][field] = v;
            return next;
        });
    }, []);

    // ── Persist setup + sweep result to the per-design cache ─────────────────
    // A docking-window switch unmounts us; this keeps the deviation setup, view
    // settings, and the computed sweep heatmap so re-opening restores them.
    useEffect(() => {
        if (!design) return;
        _sdCache.set(design.id, {
            dev: cloneDeviation(dev), mode, channel, showBaseline,
            lambdaStart, lambdaEnd, lambdaStep, aoi, pol,
            sweep, sweepChannel, sweepResult,
        });
    }, [design?.id, dev, mode, channel, showBaseline,
        lambdaStart, lambdaEnd, lambdaStep, aoi, pol,
        sweep, sweepChannel, sweepResult]);

    // ── Render guards ────────────────────────────────────────────────────────
    const placeholder = (msg) => h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontStyle: 'italic',
            fontFamily: 'system-ui, -apple-system, sans-serif', padding: 16, textAlign: 'center',
        }
    }, msg);

    if (!design) return placeholder(sd.noDesign || 'No design selected.');
    if (!design.frontLayers?.length && !design.backLayers?.length) {
        return placeholder(sd.noLayers || 'No layers in design.');
    }

    // ── Styles ──────────────────────────────────────────────────────────────
    const sectionTitle = {
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: 0.4, color: c.textDim, marginBottom: 4,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    const fieldRow = {
        display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center',
        gap: 6, marginBottom: 3,
    };
    // inline-flex + gap so the label text is visually separated from its
    // input(s) in the toolbar (the fieldRow grid already has its own gap).
    const lbl = { color: c.text, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5 };
    const unit = { color: c.textDim, fontSize: 11, minWidth: 16 };

    // ── Sidebar: deviation builder ──────────────────────────────────────────
    const globalSection = h('div', { style: { padding: '6px 8px 10px', borderBottom: `1px solid ${c.border}`, flexShrink: 0 } },
        h('div', { style: sectionTitle }, sd.globalSection || 'Global deviation'),
        h('div', { style: fieldRow },
            h('span', { style: lbl }, sd.thkScale || 'd × scale'),
            h(NumberInput, { value: dev.globalThicknessScale, step: 0.005, min: 0.5, max: 2.0,
                onChange: (v) => updateGlobal('globalThicknessScale', v), c }),
            h('span', { style: unit }, '×'),
        ),
        h('div', { style: fieldRow, title: sd.thkOffsetTip || 'Flat thickness offset added to every layer after the scale: d′ = d·scale + offset. Units: nm (physical), OT (optical thickness, nm), QW (quarter-waves) or FW (full-waves) at the design reference λ₀ — optical units convert to physical nm per layer via n(λ₀).' },
            h('span', { style: lbl }, sd.thkOffset || 'd + offset'),
            h(NumberInput, { value: dev.globalThicknessOffset || 0, step: 1,
                onChange: (v) => updateGlobal('globalThicknessOffset', v), c }),
            h(UnitSelect, { value: dev.globalThicknessOffsetUnit || 'nm',
                onChange: (u) => updateGlobal('globalThicknessOffsetUnit', u), c }),
        ),
        h('div', { style: fieldRow },
            h('span', { style: lbl }, 'Δn'),
            h(NumberInput, { value: dev.globalDeltaN, step: 0.005,
                onChange: (v) => updateGlobal('globalDeltaN', v), c }),
            h('span', { style: unit }, ''),
        ),
        h('div', { style: fieldRow },
            h('span', { style: lbl }, 'Δk'),
            h(NumberInput, { value: dev.globalDeltaK, step: 0.0005,
                onChange: (v) => updateGlobal('globalDeltaK', v), c }),
            h('span', { style: unit }, ''),
        ),
    );

    const perMatSection = h('div', {
        style: {
            padding: '6px 8px 10px', borderBottom: `1px solid ${c.border}`,
            // Fill the remaining sidebar height (scroll internally) instead of
            // a fixed cap that left dead space below.
            flex: 1, minHeight: 80, overflowY: 'auto',
        }
    },
        h('div', { style: sectionTitle }, sd.perMaterialSection || 'Per-material'),
        uniqueMats.length === 0
            ? h('div', { style: { color: c.textDim, fontSize: 11 } }, sd.noMaterials || 'No materials in design')
            : uniqueMats.map(({ id, source }) => {
                const pm = dev.perMaterial?.[id] || { dn: 0, dk: 0, dScale: 1, dOffset: 0, dOffsetUnit: 'nm' };
                return h('div', { key: id, style: { marginBottom: 8 } },
                    h('div', { style: { fontSize: 11, fontWeight: 600, color: c.text, marginBottom: 2 } },
                        id, h('span', { style: { fontWeight: 400, color: c.textDim, marginLeft: 4 } }, `(${source})`),
                    ),
                    // Field order mirrors the global section: thickness (scale,
                    // offset) first, then index (Δn, Δk).
                    h('div', { style: fieldRow },
                        h('span', { style: lbl }, 'd × scale'),
                        h(NumberInput, { value: pm.dScale ?? 1, step: 0.005, min: 0.5, max: 2.0,
                            onChange: (v) => updateMat(id, 'dScale', v), c }),
                        h('span', { style: unit }, '×'),
                    ),
                    h('div', { style: fieldRow, title: sd.thkOffsetTip || 'Flat thickness offset for this material, added after the scale (combines additively with the global offset). Units: nm / OT / QW / FW at the design reference λ₀.' },
                        h('span', { style: lbl }, sd.thkOffset || 'd + offset'),
                        h(NumberInput, { value: pm.dOffset || 0, step: 1,
                            onChange: (v) => updateMat(id, 'dOffset', v), c }),
                        h(UnitSelect, { value: pm.dOffsetUnit || 'nm',
                            onChange: (u) => updateMat(id, 'dOffsetUnit', u), c }),
                    ),
                    h('div', { style: fieldRow },
                        h('span', { style: lbl }, 'Δn'),
                        h(NumberInput, { value: pm.dn || 0, step: 0.005,
                            onChange: (v) => updateMat(id, 'dn', v), c }),
                        h('span', { style: unit }, ''),
                    ),
                    h('div', { style: fieldRow },
                        h('span', { style: lbl }, 'Δk'),
                        h(NumberInput, { value: pm.dk || 0, step: 0.0005,
                            onChange: (v) => updateMat(id, 'dk', v), c }),
                        h('span', { style: unit }, ''),
                    ),
                );
            })
    );

    // ── Sidebar: sweep config (only in sweep mode) ──────────────────────────
    const sweepOptions = [
        { value: 'globalThicknessScale',  label: sd.optThkScale  || 'Global d-scale' },
        { value: 'globalThicknessOffset', label: sd.optThkOffset || 'Global d-offset' },
        { value: 'globalDeltaN',          label: sd.optDeltaN    || 'Global Δn' },
        { value: 'globalDeltaK',          label: sd.optDeltaK    || 'Global Δk' },
        ...uniqueMats.flatMap(({ id }) => [
            { value: `mat:${id}:dScale`,  label: `${id}: d-scale` },
            { value: `mat:${id}:dOffset`, label: `${id}: d-offset` },
            { value: `mat:${id}:dn`,      label: `${id}: Δn` },
            { value: `mat:${id}:dk`,      label: `${id}: Δk` },
        ]),
    ];

    const sweepSection = h('div', {
        style: { padding: '6px 8px 10px', borderBottom: `1px solid ${c.border}`, flexShrink: 0 }
    },
        h('div', { style: sectionTitle }, sd.sweepSection || 'Parameter sweep'),
        h('div', { style: { marginBottom: 4 } },
            h('select', {
                value: sweep.param,
                onChange: (e) => {
                    const param = e.target.value;
                    // Re-seed from/to with a sensible range for the new param kind
                    // (a ×-scale window is meaningless for an nm offset or Δn).
                    setSweep(s => ({ ...s, param, ...defaultSweepRange(param, s.offsetUnit) }));
                },
                style: {
                    width: '100%', background: c.inputBg || c.hover, color: c.text,
                    border: `1px solid ${c.border}`, borderRadius: 3,
                    padding: '2px 4px', fontSize: 11,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                }
            }, sweepOptions.map(o => h('option', { key: o.value, value: o.value }, o.label)))
        ),
        // Offset params (Global / per-material d-offset) carry a unit — its
        // selector normally lives in the now-hidden deviation panels, so surface
        // it here. from/to are interpreted in this unit (and re-seeded on change).
        sweepParamKind(sweep.param) === 'offset' && h('div', {
            style: fieldRow, title: sd.sweepUnitTip || 'Unit for the swept offset range: nm / OT / QW / FW at the design reference λ₀.'
        },
            h('span', { style: lbl }, sd.sweepUnit || 'unit'),
            h(UnitSelect, { value: sweep.offsetUnit || 'nm',
                onChange: (u) => setSweep(s => ({ ...s, offsetUnit: u, ...defaultSweepRange(s.param, u) })), c }),
            h('span', { style: unit }, ''),
        ),
        h('div', { style: fieldRow },
            h('span', { style: lbl }, sd.from || 'from'),
            h(NumberInput, { value: sweep.from, step: 0.01,
                onChange: (v) => setSweep(s => ({ ...s, from: v })), c }),
            h('span', { style: unit }, ''),
        ),
        h('div', { style: fieldRow },
            h('span', { style: lbl }, sd.to || 'to'),
            h(NumberInput, { value: sweep.to, step: 0.01,
                onChange: (v) => setSweep(s => ({ ...s, to: v })), c }),
            h('span', { style: unit }, ''),
        ),
        h('div', { style: fieldRow },
            h('span', { style: lbl }, sd.steps || 'steps'),
            h(NumberInput, { value: sweep.steps, step: 1, min: 2, max: 200,
                onChange: (v) => setSweep(s => ({ ...s, steps: Math.max(2, Math.floor(v)) })), c }),
            h('span', { style: unit }, ''),
        ),
        h('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
            h('button', {
                onClick: runSweep, disabled: sweepRunning,
                style: {
                    flex: 1, padding: '4px 10px',
                    background: sweepRunning ? c.hover : c.accent,
                    color: '#fff', border: 'none', borderRadius: 3,
                    fontSize: 12, cursor: sweepRunning ? 'default' : 'pointer',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                }
            }, sweepRunning ? (sd.running || 'Running…') : (sd.runSweep || '▶ Run sweep')),
        ),
        h('div', {
            style: {
                marginTop: 8, fontSize: 10.5, lineHeight: 1.4, color: c.textDim,
                fontStyle: 'italic',
            }
        }, sd.sweepNote || 'Sweep varies only the parameter above, starting from the unperturbed design. To combine a fixed deviation with a sweep, set it up in Single mode.'),
    );

    // ── Top toolbar (params + mode) ─────────────────────────────────────────
    const toolbar = h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: '5px 10px', borderBottom: `1px solid ${c.border}`,
            background: c.panel, flexShrink: 0, fontSize: 11,
        }
    },
        h('div', { style: { display: 'flex', gap: 2 } },
            h(SegBtn, { active: mode === 'single', onClick: () => setMode('single'), label: sd.modeSingle || 'Single', c }),
            h(SegBtn, { active: mode === 'sweep',  onClick: () => setMode('sweep'),  label: sd.modeSweep  || 'Sweep',  c }),
        ),
        h('div', { style: { width: 1, height: 20, background: c.border } }),
        h('label', { style: lbl }, 'λ',
            h(NumberInput, { value: lambdaStart, step: 10, onChange: setLambdaStart, c, width: 56 }),
            h('span', { style: { margin: '0 2px' } }, '–'),
            h(NumberInput, { value: lambdaEnd, step: 10, onChange: setLambdaEnd, c, width: 56 }),
            h('span', { style: { margin: '0 4px', color: c.textDim } }, 'nm'),
        ),
        h('label', { style: lbl }, sd.step || 'step',
            h(NumberInput, { value: lambdaStep, step: 1, min: 0.5, max: 50, onChange: setLambdaStep, c, width: 48 }),
        ),
        h('label', { style: lbl }, 'AOI',
            h(NumberInput, { value: aoi, step: 5, min: 0, max: 89, onChange: setAoi, c, width: 48 }),
            h('span', { style: { color: c.textDim, marginLeft: 2 } }, '°'),
        ),
        h('label', { style: lbl }, 'pol',
            h('select', {
                value: pol, onChange: (e) => setPol(e.target.value),
                style: {
                    background: c.inputBg || c.hover, color: c.text,
                    border: `1px solid ${c.border}`, borderRadius: 3,
                    padding: '1px 4px', fontSize: 11, marginLeft: 4,
                }
            }, ['avg', 's', 'p'].map(p => h('option', { key: p, value: p }, p)))
        ),
        h('div', { style: { width: 1, height: 20, background: c.border } }),
        mode === 'single' && h('div', { style: { display: 'flex', gap: 2 } },
            h(SegBtn, { active: channel === 'all', onClick: () => setChannel('all'), label: 'T+R+A', c }),
            h(SegBtn, { active: channel === 'T',   onClick: () => setChannel('T'),   label: 'T',     c }),
            h(SegBtn, { active: channel === 'R',   onClick: () => setChannel('R'),   label: 'R',     c }),
            h(SegBtn, { active: channel === 'A',   onClick: () => setChannel('A'),   label: 'A',     c }),
        ),
        mode === 'sweep' && h('div', { style: { display: 'flex', gap: 2 } },
            h(SegBtn, { active: sweepChannel === 'all', onClick: () => setSweepChannel('all'), label: 'T+R+A', c }),
            h(SegBtn, { active: sweepChannel === 'T', onClick: () => setSweepChannel('T'), label: 'T', c }),
            h(SegBtn, { active: sweepChannel === 'R', onClick: () => setSweepChannel('R'), label: 'R', c }),
            h(SegBtn, { active: sweepChannel === 'A', onClick: () => setSweepChannel('A'), label: 'A', c }),
        ),
        mode === 'single' && h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: c.text, fontSize: 11 } },
            h(Checkbox, {
                c, checked: showBaseline,
                onChange: (e) => setShowBaseline(e.target.checked),
            }),
            sd.baseline || 'baseline'
        ),
        mode === 'single' && h('button', {
            onClick: resetDeviation, disabled: isIdentityDeviation(dev),
            style: {
                padding: '2px 8px',
                background: c.inputBg || c.hover, color: c.text,
                border: `1px solid ${c.border}`, borderRadius: 3,
                fontSize: 11, cursor: isIdentityDeviation(dev) ? 'default' : 'pointer',
                opacity: isIdentityDeviation(dev) ? 0.4 : 1,
            }
        }, sd.reset || 'Reset deviations'),
        // Evaluation target — read-only, set in the Design Editor.
        h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 } },
            h(EvalModeBadge, { design, c, t }),
        ),
    );

    // ── Layout: sidebar + main panel ────────────────────────────────────────
    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text, overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
        }
    },
        toolbar,
        // Live Specification check on the deviated design (single mode only —
        // sweep doesn't apply `dev`, so its verdict would be misleading there).
        mode === 'single' && (design?.qualifiers?.length > 0) && h('div', {
            style: {
                padding: '4px 10px', borderBottom: `1px solid ${c.border}`,
                background: c.panel, display: 'flex', alignItems: 'center', gap: 8,
                flexShrink: 0, flexWrap: 'wrap',
            }
        },
            h(SpecVerdict, {
                design: specDev.design, resolveMat: specDev.resolve, c, t,
                label: (t.specification && t.specification.specLabel) || 'Spec:',
            })
        ),
        h('div', {
            style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' }
        },
            // Sidebar
            h('div', {
                style: {
                    width: 260, flexShrink: 0, borderRight: `1px solid ${c.border}`,
                    background: c.panel, overflow: 'hidden',
                    display: 'flex', flexDirection: 'column',
                }
            },
                // Single mode = build a fixed deviation (global + per-material).
                // Sweep mode = vary ONE parameter from the unperturbed design, so
                // the deviation-builder panels are hidden to avoid implying they
                // feed the sweep (they don't).
                mode === 'sweep' && sweepSection,
                mode === 'single' && globalSection,
                mode === 'single' && perMatSection,
            ),
            // Main panel
            h('div', { style: { flex: 1, minHeight: 0, position: 'relative' } },
                (computeError || error) && h('div', {
                    style: {
                        position: 'absolute', top: 8, left: 8, right: 8,
                        padding: '6px 10px', background: '#5a1a1a', color: '#fff',
                        border: '1px solid #a33', borderRadius: 4, fontSize: 11, zIndex: 5,
                    }
                }, computeError || error),
                mode === 'single'
                    ? h(SpectrumPlot, { baseline, deviated, channel, showBaseline, c })
                    : (sweepResult
                        ? h(SweepHeatmap, { sweepData: sweepResult, channel: sweepChannel, c })
                        : h('div', {
                            style: {
                                width: '100%', height: '100%', display: 'flex',
                                alignItems: 'center', justifyContent: 'center',
                                color: c.textDim, fontSize: 13, fontStyle: 'italic',
                                padding: 16, textAlign: 'center',
                            }
                        }, sweepRunning ? (sd.runningMsg || 'Computing sweep…')
                                        : (sd.sweepHint || `Choose a parameter, set range and click "Run sweep". Label: ${paramLabel(sweep.param)}`))
                    )
            ),
        )
    );
}
