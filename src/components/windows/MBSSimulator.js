/**
 * Monochromatic Monitoring Simulator — window UI.
 *
 * Follows the same layout as BBMSimulator (sidebar + tabs + footer). The key
 * difference is the per-layer monitor-strategy table: every layer chooses one
 * of 'turning' / 'level' / 'time' with its own monitor λ. The other tools
 * (rates, deviations, signal errors, MC controls) mirror BBM exactly so users
 * can compare apples-to-apples.
 *
 * Math is in src/utils/monoMonitoringSim.js. This file is UI + glue.
 */

import { useDesign }              from '../../state/DesignContext.js';
import { getMaterialById }        from '../../utils/materials/catalogManager.js';
import { getMaterial }            from '../../utils/materials/materialDatabase.js';
import {
    runMonteCarloMMS,
    runMonteCarloMMSParallel,
    defaultMonitorTable,
    previewMonoSignal,
    monitorSignalQuality,
    pickSensitiveLambda,
}                                 from '../../utils/monitoring/monoMonitoringSim.js';
import { WorkerPool }             from '../../utils/workers/workerPool.js';
import { MC_WORKER_URL }          from '../../workerUrls.js';
import { DebouncedInput }         from '../ui/DebouncedInput.js';

const { createElement: h, useState, useEffect, useMemo, useCallback, useRef } = React;

function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// ── Charts (reuse the BBM components' shape) ─────────────────────────────────

function SpectralChart({ result, char, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const charColor = char === 'T' ? '#4fc3f7' : char === 'R' ? '#ef5350' : '#66bb6a';
    const buildData = useCallback(() => {
        if (!result) return { data: [], layout: {} };
        const lam = result.lambda;
        const toPct = arr => arr.map(v => v * 100);
        const data = [
            { x: lam, y: toPct(result.lower), type:'scatter', mode:'lines',
              line:{ color: charColor, width: 0 }, showlegend: false, hoverinfo:'skip' },
            { x: lam, y: toPct(result.upper), type:'scatter', mode:'lines',
              fill:'tonexty', fillcolor: charColor + '33',
              line:{ color: charColor, width: 0 }, name:'Exp ± kσ',
              hovertemplate:`%{x:.1f} nm<br>upper: %{y:.3f}%<extra></extra>` },
            { x: lam, y: toPct(result.mean), type:'scatter', mode:'lines',
              line:{ color: charColor, width: 1.5, dash:'dot' }, name:'Exp (mean as-built)',
              hovertemplate:`%{x:.1f} nm<br>Exp: %{y:.3f}%<extra></extra>` },
            { x: lam, y: toPct(result.theory), type:'scatter', mode:'lines',
              line:{ color: charColor, width: 2 }, name:`${char} theoretical`,
              hovertemplate:`%{x:.1f} nm<br>${char}: %{y:.3f}%<extra></extra>` },
        ];
        const layout = {
            paper_bgcolor: c.panel, plot_bgcolor: c.bg,
            margin: { l: 52, r: 16, t: 16, b: 44 },
            font: { color: c.text, family:'system-ui, -apple-system, sans-serif', size: 11 },
            xaxis: { title:{ text:'Wavelength (nm)', standoff: 8 }, gridcolor: c.border, color: c.text, tickfont:{ size:10 } },
            yaxis: { title:{ text:`${char} (%)`, standoff: 8 }, gridcolor: c.border, color: c.text, tickfont:{ size:10 }, rangemode:'tozero' },
            legend: { x: 1, xanchor:'right', y: 1, yanchor:'top',
                      bgcolor: c.panel + 'cc', bordercolor: c.border, borderwidth: 1, font:{ size:10 } },
            hovermode: 'x unified',
        };
        return { data, layout };
    }, [result, char, c]);
    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        const { data, layout } = buildData();
        const cfg = { responsive: true, displaylogo: false, displayModeBar: true };
        if (!initRef.current) { Plotly.newPlot(divRef.current, data, layout, cfg); initRef.current = true; }
        else Plotly.react(divRef.current, data, layout, cfg);
    }, [buildData]);
    useEffect(() => {
        const el = divRef.current; if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el); return () => ro.disconnect();
    }, []);
    return h('div', { ref: divRef, style: { width:'100%', height:'100%', minHeight: 200 } });
}

function ThicknessChart({ perLayer, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const buildData = useCallback(() => {
        if (!perLayer) return { data: [], layout: {} };
        const idx = perLayer.target.map((_, i) => `L${i + 1}`);
        const traces = [
            { x: idx, y: perLayer.target, type:'bar', name:'Target', marker:{ color: '#888', opacity: 0.45 } },
            { x: idx, y: perLayer.mean, type:'bar', name:'Mean as-built',
              marker:{ color: '#4fc3f7' },
              error_y: { type:'data', array: perLayer.stdev, color: '#cccccc', thickness: 1.2, width: 4 } },
        ];
        const layout = {
            paper_bgcolor: c.panel, plot_bgcolor: c.bg,
            margin: { l: 56, r: 16, t: 16, b: 44 },
            font: { color: c.text, family:'system-ui, -apple-system, sans-serif', size: 11 },
            barmode: 'group',
            xaxis: { title:{ text:'Layer', standoff: 6 }, gridcolor: c.border, color: c.text, tickfont:{ size:10 } },
            yaxis: { title:{ text:'Thickness (nm)', standoff: 8 }, gridcolor: c.border, color: c.text, tickfont:{ size:10 } },
            legend: { x: 0, xanchor:'left', y: 1, yanchor:'top',
                      bgcolor: c.panel + 'cc', bordercolor: c.border, borderwidth: 1, font:{ size:10 } },
        };
        return { data: traces, layout };
    }, [perLayer, c]);
    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        const { data, layout } = buildData();
        const cfg = { responsive: true, displaylogo: false, displayModeBar: true };
        if (!initRef.current) { Plotly.newPlot(divRef.current, data, layout, cfg); initRef.current = true; }
        else Plotly.react(divRef.current, data, layout, cfg);
    }, [buildData]);
    useEffect(() => {
        const el = divRef.current; if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el); return () => ro.disconnect();
    }, []);
    return h('div', { ref: divRef, style: { width:'100%', height:'100%', minHeight: 200 } });
}

function YieldPanel({ yieldDetails, yieldFrac, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const buildData = useCallback(() => {
        if (!yieldDetails) return { data: [], layout: {} };
        const traces = [
            { x: yieldDetails.mfRuns, type:'histogram',
              nbinsx: Math.max(5, Math.min(20, Math.floor(yieldDetails.mfRuns.length / 2))),
              marker:{ color:'#4fc3f7', line:{ color:'#222', width: 1 } }, name:'OMF distribution',
              hovertemplate:'OMF %{x:.4f}<br>count %{y}<extra></extra>' },
        ];
        const layout = {
            paper_bgcolor: c.panel, plot_bgcolor: c.bg,
            margin: { l: 50, r: 16, t: 16, b: 44 },
            font: { color: c.text, family:'system-ui, -apple-system, sans-serif', size: 11 },
            xaxis: { title:{ text:'Optical merit function', standoff: 6 }, gridcolor: c.border, color: c.text, tickfont:{ size:10 } },
            yaxis: { title:{ text:'# of runs', standoff: 8 }, gridcolor: c.border, color: c.text, tickfont:{ size:10 } },
            shapes: [
                { type:'line', x0: yieldDetails.tol, x1: yieldDetails.tol, y0: 0, y1: 1, yref:'paper',
                  line:{ color:'#ef5350', width: 2, dash:'dot' } },
                { type:'line', x0: yieldDetails.mfTheory, x1: yieldDetails.mfTheory, y0: 0, y1: 1, yref:'paper',
                  line:{ color:'#888', width: 1.4, dash:'dash' } },
            ],
            annotations: [
                { x: yieldDetails.tol, y: 1, yref:'paper', yanchor:'bottom', xanchor:'left',
                  text:` tol = ${yieldDetails.tol.toFixed(4)}`, showarrow: false, font:{ color:'#ef5350', size: 10 } },
                { x: yieldDetails.mfTheory, y: 1, yref:'paper', yanchor:'bottom', xanchor:'right',
                  text:`theory ${yieldDetails.mfTheory.toFixed(4)} `, showarrow: false, font:{ color:'#aaa', size: 10 } },
            ],
        };
        return { data: traces, layout };
    }, [yieldDetails, c]);
    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        const { data, layout } = buildData();
        const cfg = { responsive: true, displaylogo: false, displayModeBar: true };
        if (!initRef.current) { Plotly.newPlot(divRef.current, data, layout, cfg); initRef.current = true; }
        else Plotly.react(divRef.current, data, layout, cfg);
    }, [buildData]);
    useEffect(() => {
        const el = divRef.current; if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el); return () => ro.disconnect();
    }, []);
    if (!yieldDetails || yieldDetails.total === 0) {
        return h('div', { style: { display:'flex', alignItems:'center', justifyContent:'center',
            height:'100%', color: c.textDim, fontSize: 12, padding: 16, textAlign: 'center' } },
            'Define merit operands in the Merit Function Editor to compute yield.');
    }
    // Same MF distribution readout as BBM — keeps the two windows visually
    // and informationally consistent so the user can compare yield numbers.
    const sorted = [...yieldDetails.mfRuns].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const mx = sorted[sorted.length - 1];
    const stat = (label, val, color) => h('span', {
        style: { display: 'inline-flex', gap: 4, alignItems: 'baseline',
                 color: c.textDim, fontSize: 11 }
    },
        h('span', null, label),
        h('span', { style: { color: color || c.text, fontWeight: 600, fontFamily: 'ui-monospace, monospace' } }, val),
    );
    const passColor = yieldFrac >= 0.9 ? c.success
                    : yieldFrac >= 0.5 ? c.warning
                    : c.error;
    return h('div', { style: { display:'flex', flexDirection:'column', height:'100%' } },
        h('div', {
            style: { padding:'8px 14px', background: c.panel, borderBottom: `1px solid ${c.border}`,
                flexShrink: 0, display:'flex', gap: 18, alignItems:'center', fontSize: 12, flexWrap: 'wrap' }
        },
            h('span', { style:{ color: passColor, fontWeight: 700, fontSize: 14 } },
                `Yield: ${(yieldFrac * 100).toFixed(1)}%`),
            h('span', { style:{ color: c.textDim, fontSize: 11 } },
                `${yieldDetails.pass} / ${yieldDetails.total} runs ≤ tol`),
            h('span', { style: { width: 1, alignSelf: 'stretch', background: c.border, opacity: 0.5 } }),
            stat('OMF₀', yieldDetails.mfTheory.toFixed(4), '#aaa'),
            stat('median', median.toFixed(4)),
            stat('max', mx.toFixed(4)),
            stat('tol', yieldDetails.tol.toFixed(4), '#ef5350'),
        ),
        h('div', { ref: divRef, style:{ flex: 1, minHeight: 0 } })
    );
}

// ── Per-layer monitor-signal preview chart ────────────────────────────────────

function MonitorSignalsChart({ design, monTable, common, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);
    const front = design?.frontLayers || [];

    const buildData = useCallback(() => {
        if (!front.length) return { data: [], layout: {} };
        const traces = [];
        const palette = ['#4fc3f7','#ef5350','#66bb6a','#ffa726','#ab47bc',
                         '#26a69a','#ffca28','#5c6bc0','#ec407a','#26c6da'];
        for (let i = 0; i < front.length; i++) {
            const row = monTable[i] || {};
            if ((row.strategy || 'time') === 'time') continue;
            const prev = previewMonoSignal(design, resolveMat, i, row, common);
            traces.push({
                x: prev.d, y: prev.signal.map(v => v * 100),
                type:'scatter', mode:'lines',
                line:{ color: palette[i % palette.length], width: 1.5 },
                name: `L${i+1} ${row.strategy || 'time'} @ ${(row.lambda || 550).toFixed(0)} nm`,
                hovertemplate: `L${i+1}: %{x:.2f} nm → %{y:.3f}%<extra></extra>`,
            });
            traces.push({
                x: [prev.dTarget, prev.dTarget], y: [0, 100],
                type:'scatter', mode:'lines',
                line:{ color: palette[i % palette.length], width: 1, dash:'dash' },
                showlegend: false, hoverinfo: 'skip',
            });
        }
        const layout = {
            paper_bgcolor: c.panel, plot_bgcolor: c.bg,
            margin: { l: 50, r: 16, t: 16, b: 44 },
            font: { color: c.text, family:'system-ui, -apple-system, sans-serif', size: 11 },
            xaxis: { title:{ text:'Growing thickness d (nm)', standoff: 6 }, gridcolor: c.border, color: c.text, tickfont:{ size:10 } },
            yaxis: { title:{ text:`${common.char || 'T'} (%)`, standoff: 8 }, gridcolor: c.border, color: c.text, tickfont:{ size:10 }, rangemode:'tozero' },
            legend: { x: 1, xanchor:'right', y: 1, yanchor:'top',
                      bgcolor: c.panel + 'cc', bordercolor: c.border, borderwidth: 1, font:{ size:9 } },
            hovermode: 'closest',
        };
        return { data: traces, layout };
    }, [design, monTable, common, c, front.length]);

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        const { data, layout } = buildData();
        const cfg = { responsive: true, displaylogo: false, displayModeBar: true };
        if (!initRef.current) { Plotly.newPlot(divRef.current, data, layout, cfg); initRef.current = true; }
        else Plotly.react(divRef.current, data, layout, cfg);
    }, [buildData]);
    useEffect(() => {
        const el = divRef.current; if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el); return () => ro.disconnect();
    }, []);
    return h('div', { ref: divRef, style: { width:'100%', height:'100%', minHeight: 200 } });
}

// ── Reusable form atoms (same as BBM) ─────────────────────────────────────────

function makeAtoms(c) {
    const label = { color: c.textDim, fontSize: 11,
        fontFamily: 'system-ui, -apple-system, sans-serif', whiteSpace: 'nowrap' };
    const input = { background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3, padding: '2px 5px', fontSize: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif', boxSizing: 'border-box' };
    const segBtn = (active) => ({
        padding: '3px 12px', background: active ? c.accent : (c.inputBg || c.hover),
        color: active ? '#fff' : c.text, border: `1px solid ${active ? c.accent : c.border}`,
        borderRadius: 3, cursor: 'pointer', fontSize: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif' });
    // Tab pill — text-color picks the accent for active and full text-color for
    // inactive (was c.textDim, which often disappears on dark themes). All
    // border sides declared as longhand to avoid React's
    // shorthand/longhand mixing warning that was eating the tab labels.
    const tabBtn = (active) => ({
        padding: '6px 18px', fontSize: 12,
        fontWeight: active ? 600 : 500,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        background: active ? c.bg : 'transparent',
        color: active ? (c.accent || c.text) : c.text,
        cursor: 'pointer', outline: 'none',
        borderTopWidth: 0, borderRightWidth: 0, borderLeftWidth: 0,
        borderTopStyle: 'none', borderRightStyle: 'none', borderLeftStyle: 'none',
        borderTopColor: 'transparent', borderRightColor: 'transparent', borderLeftColor: 'transparent',
        borderBottomWidth: 2, borderBottomStyle: 'solid',
        borderBottomColor: active ? c.accent : 'transparent',
        borderRadius: '3px 3px 0 0',
        transition: 'color 100ms ease, background 100ms ease',
    });
    const runBtn = { padding: '5px 16px', fontSize: 12, cursor: 'pointer',
        border: `1px solid ${c.accent}`, borderRadius: 3, background: c.accent + '33',
        color: c.accent, outline: 'none', fontFamily: 'system-ui, -apple-system, sans-serif',
        fontWeight: 600, minWidth: 80 };
    // Use the `border` shorthand (not borderColor longhand) so React doesn't
    // warn about mixing shorthand+longhand on rerender.
    const stopBtn = { ...runBtn, border: `1px solid #ef5350`, color: '#ef5350', background: '#ef535033' };
    return { label, input, segBtn, tabBtn, runBtn, stopBtn };
}

function field(c, atoms, labelTxt, inputEl) {
    return h('div', {
        style: { display:'flex', alignItems:'center', gap: 8, padding: '2px 0', minHeight: 24 }
    },
        h('div', { style: { ...atoms.label, flex: '0 0 86px' } }, labelTxt),
        h('div', { style: { flex: 1, display:'flex', alignItems:'center', gap: 4 } }, inputEl),
    );
}

function SectionCard({ c, title, defaultOpen = true, children }) {
    const [open, setOpen] = useState(defaultOpen);
    return h('div', {
        style: { border: `1px solid ${c.border}`, borderRadius: 4,
            marginBottom: 8, background: c.panel + '88', overflow: 'hidden' }
    },
        h('button', {
            onClick: () => setOpen(o => !o),
            style: { width: '100%', padding: '6px 10px', background: c.panel, color: c.text,
                fontWeight: 600, border: 'none',
                borderBottom: open ? `1px solid ${c.border}` : 'none', cursor: 'pointer',
                textAlign: 'left', display:'flex', alignItems:'center', justifyContent: 'space-between',
                fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 11,
                textTransform: 'uppercase', letterSpacing: '0.04em' }
        },
            h('span', null, title),
            h('span', { style:{ color: c.textDim, fontSize: 10, fontWeight: 400 } }, open ? '▾' : '▸'),
        ),
        open && h('div', { style: { padding: '8px 10px' } }, children),
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MBSSimulator({ c, theme, t }) {
    const mm = t.mmsSim || {};
    const { design } = useDesign();
    const atoms = useMemo(() => makeAtoms(c), [c]);

    const materialIds = useMemo(() => {
        if (!design?.frontLayers) return [];
        const ids = new Set();
        for (const l of design.frontLayers) ids.add(l.material);
        return Array.from(ids);
    }, [design?.frontLayers]);

    const [rates, setRates] = useState(() => {
        const m = new Map();
        for (const id of materialIds) m.set(id, { mean: 0.5, sigma: 0 });
        return m;
    });
    useEffect(() => {
        setRates(prev => {
            const m = new Map();
            for (const id of materialIds) m.set(id, prev.get(id) || { mean: 0.5, sigma: 0 });
            return m;
        });
    }, [materialIds]);
    const setRate = (id, key, val) => {
        setRates(prev => {
            const m = new Map(prev);
            const cur = m.get(id) || { mean: 0.5, sigma: 0 };
            m.set(id, { ...cur, [key]: val });
            return m;
        });
    };

    // Per-layer monitor table — auto-built when design changes; user-editable
    const [monTable, setMonTable] = useState([]);
    useEffect(() => {
        if (!design?.frontLayers) { setMonTable([]); return; }
        // Rebuild table when layer count or materials change; preserve existing
        // rows so an unchanged layer keeps its user choice.
        setMonTable(prev => {
            // Initial table: auto-pick the most-sensitive wavelength per
            // layer. Without this, AR designs land on
            // the reference wavelength where signal slope ≈ 0 → 0% yield
            // even at zero noise. The user can still override per row.
            const fresh = defaultMonitorTable(design, resolveMat, { autoPickLambda: true });
            return fresh.map((row, i) => {
                const old = prev[i];
                if (!old) return row;
                return { ...row, ...old };
            });
        });
    }, [design?.id, design?.frontLayers?.length,
        // Re-derive when the materials sequence changes (auto-strategy depends on n)
        (design?.frontLayers || []).map(l => l.material).join('|')]);

    const setMon = (i, key, val) => {
        setMonTable(prev => {
            const next = prev.slice();
            next[i] = { ...(next[i] || {}), [key]: val };
            return next;
        });
    };

    // Common monitoring parameters
    const [theta,   setTheta]   = useState(0);
    const [pol,     setPol]     = useState('avg');
    const [char,    setChar]    = useState('T');
    const [scanInt, setScanInt] = useState(0.5);
    const [confirm, setConfirm] = useState(2);

    // Deviations
    const [sigmaReN, setSigmaReN]   = useState(0);
    const [sigmaImN, setSigmaImN]   = useState(0);
    const [perMaterial, setPerMaterial] = useState(true);
    const [shutterMs, setShutterMs] = useState(0);
    const [shutterRmsMs, setShutterRmsMs] = useState(0);

    // Signal errors
    const [sigRandom, setSigRandom] = useState(0.3);
    const [sigDrift,  setSigDrift]  = useState(0);

    // MC
    const [nRuns,         setNRuns]         = useState(10);
    const [corridorSigma, setCorridorSigma] = useState(1.0);
    const [yieldTolMult,  setYieldTolMult]  = useState(2.0);
    const [useWorkers,    setUseWorkers]    = useState(true);
    // Yield-tolerance mode (same UX as BBM): a × MF₀ multiplier is unusable
    // when MF₀ ≈ 0 (well-tuned design), so we let the user switch to an
    // absolute MF threshold or auto-pick one from the run distribution.
    const [yieldMode,   setYieldMode]   = useState('mul');  // 'mul' | 'abs'
    const [yieldAbsTol, setYieldAbsTol] = useState(0);

    // Display grid: reuse the design's spectrum range if available
    const spectrumParams = useMemo(() => {
        const lA = 400, lB = 800;
        return {
            lambdaStart: lA, lambdaEnd: lB,
            lambdaStep: Math.max(1, Math.round((lB - lA) / 60)),
            theta, polarization: pol,
        };
    }, [theta, pol]);

    const common = useMemo(() => ({
        thetaDeg: theta, pol, char,
        scanIntervalSec: scanInt, confirmScans: confirm,
    }), [theta, pol, char, scanInt, confirm]);

    const [result,   setResult]   = useState(null);
    const [running,  setRunning]  = useState(false);
    const [progress, setProgress] = useState({ i: 0, total: 0 });
    const [error,    setError]    = useState(null);
    const [tab,      setTab]      = useState('spectral');
    const cancelledRef = useRef(false);
    const poolRef      = useRef(null);

    // Design-guard: a Monte-Carlo result belongs to the design it was run on.
    // Clear it (and any error) when the active design changes so design B never
    // shows design A's yield/corridor.
    useEffect(() => { setResult(null); setError(null); }, [design?.id]);

    useEffect(() => () => {
        if (poolRef.current) { poolRef.current.terminate(); poolRef.current = null; }
    }, []);

    const run = useCallback(async () => {
        if (!design?.frontLayers?.length) { setError(mm.noLayers || 'No layers in design.'); return; }
        setError(null);
        setRunning(true);
        setProgress({ i: 0, total: nRuns });
        cancelledRef.current = false;
        await new Promise(r => setTimeout(r, 0));

        try {
            const cfg = {
                rates, monTable, common,
                sigmaReN, sigmaImN, perMaterial,
                shutter: { meanMs: shutterMs, sigmaMs: shutterRmsMs },
                sig: { randomPct: sigRandom, driftPctPer1000s: sigDrift },
                nRuns,
                corridorSigma,
                char,
                spectrumParams,
                seed: 0xC0FFEE,
                onProgress: ({ i, total }) => setProgress({ i, total }),
                shouldCancel: () => cancelledRef.current,
            };

            let res;
            const canWorker = useWorkers && typeof Worker !== 'undefined' && typeof URL !== 'undefined';
            if (canWorker) {
                const cores = (navigator?.hardwareConcurrency || 4);
                const K = Math.max(2, Math.min(8, cores - 1, nRuns));
                // H9: use the central registry (not a literal `new URL(...)` here),
                // which esbuild would rewrite to a wrong packaged path → 404.
                const url = MC_WORKER_URL;
                let pool = null;
                try {
                    pool = new WorkerPool(url, K);
                    poolRef.current = pool;
                    res = await runMonteCarloMMSParallel(design, resolveMat, cfg, pool);
                } finally {
                    if (pool) { pool.terminate(); }
                    if (poolRef.current === pool) poolRef.current = null;
                }
            } else {
                res = await runMonteCarloMMS(design, resolveMat, cfg);
            }

            if (res.yieldDetails && res.yieldDetails.mfRuns.length > 0) {
                const mfTheory = res.yieldDetails.mfTheory;
                const tol = (yieldMode === 'abs' && yieldAbsTol > 0)
                    ? yieldAbsTol
                    : mfTheory * yieldTolMult;
                let pass = 0;
                for (const mf of res.yieldDetails.mfRuns) if (mf <= tol) pass++;
                res.yieldDetails = { ...res.yieldDetails, tol, pass };
                res.yield = pass / res.yieldDetails.mfRuns.length;
            }
            if (!cancelledRef.current) setResult(res);
        } catch (e) {
            setError(e.message || String(e));
        }
        setRunning(false);
    }, [design, rates, monTable, common, sigmaReN, sigmaImN, perMaterial,
        shutterMs, shutterRmsMs, sigRandom, sigDrift,
        nRuns, corridorSigma, yieldTolMult, yieldMode, yieldAbsTol,
        useWorkers, char, spectrumParams,
        mm.noLayers]);

    const setTolFromRuns = useCallback(() => {
        const mfs = result?.yieldDetails?.mfRuns;
        if (!mfs || !mfs.length) return;
        const sorted = [...mfs].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const mean = mfs.reduce((s, v) => s + v, 0) / mfs.length;
        const variance = mfs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / mfs.length;
        const sigma = Math.sqrt(variance);
        const suggested = median + 2 * sigma;
        setYieldMode('abs');
        setYieldAbsTol(parseFloat(suggested.toPrecision(3)));
    }, [result]);

    const stop = useCallback(() => {
        cancelledRef.current = true;
        if (poolRef.current) { poolRef.current.terminate(); poolRef.current = null; }
    }, []);

    const placeholder = (msg) => h('div', {
        style: { flex: 1, display:'flex', alignItems:'center', justifyContent:'center',
            color: c.textDim, fontSize: 13, fontStyle:'italic',
            fontFamily:'system-ui, -apple-system, sans-serif', padding: 16, textAlign:'center' }
    }, msg);

    if (!design) return placeholder(mm.noDesign || 'No design selected.');
    if (!design.frontLayers?.length) return placeholder(mm.noLayers || 'No layers in design.');

    // DebouncedInput-backed: freely editable (can clear / type 0 / type
    // intermediate values), commits on blur/Enter — instead of the old
    // parseFloat(e.target.value)||fallback that clamped on every keystroke and
    // couldn't represent 0 or an empty field.
    const numInput = (value, onChange, opts = {}) => h(DebouncedInput, {
        value: String(value),
        onChange: (v) => { const s = String(v).trim(); const x = parseFloat(v); onChange(s === '' ? (opts.fallback ?? 0) : (Number.isFinite(x) ? x : (opts.fallback ?? 0))); },
        style: { ...atoms.input, width: opts.width || 64 }, title: opts.title,
    });
    const numInputInt = (value, onChange, opts = {}) => h(DebouncedInput, {
        value: String(value),
        onChange: (v) => { const s = String(v).trim(); const x = parseInt(v, 10); onChange(s === '' ? (opts.fallback ?? 1) : (Number.isFinite(x) ? x : (opts.fallback ?? 1))); },
        style: { ...atoms.input, width: opts.width || 60 }, title: opts.title,
    });

    const sidebarWidth = 320;

    // ── Sections ──────────────────────────────────────────────────────────────

    const commonSection = h(SectionCard, { c, title: mm.commonSection || 'Common' },
        field(c, atoms, mm.charLabel || 'Characteristic',
            h('div', { style: { display:'flex', gap: 4 } },
                ['T', 'R'].map(ch => h('button', {
                    key: ch, onClick: () => setChar(ch),
                    style: atoms.segBtn(char === ch),
                }, ch)))),
        field(c, atoms, mm.aoi || 'AOI',
            [numInput(theta, setTheta, { min: 0, max: 89, step: 1, width: 60 }),
             h('span', { style:{ color: c.textDim, fontSize: 11 } }, '°')]),
        field(c, atoms, mm.pol || 'pol',
            h('select', { value: pol, onChange: e => setPol(e.target.value), style: { ...atoms.input, width: 80 } },
                h('option', { value:'avg' }, 'avg'),
                h('option', { value:'s' }, 's'),
                h('option', { value:'p' }, 'p'))),
        field(c, atoms, mm.scanInt || 'scan',
            [numInput(scanInt, setScanInt, { min: 0.05, max: 60, step: 0.1, width: 60, fallback: 0.5 }),
             h('span', { style:{ color: c.textDim, fontSize: 11 } }, 's')]),
        field(c, atoms, mm.confirm || 'confirm',
            numInputInt(confirm, setConfirm, { min: 1, max: 10, width: 50, fallback: 2 })),
    );

    // Per-layer signal-quality (EV / final-swing) at the currently chosen
    // monitor λ. Recomputed when design or table changes; cheap (~60 TMMs per
    // layer at one λ). Shown next to each row so a user can immediately see
    // which layer is unmonitorable.
    const monQuality = useMemo(() => {
        if (!design?.frontLayers?.length || !monTable.length) return [];
        return design.frontLayers.map((_, i) => {
            // Default strategy 'time' — consistent with the row UI and the
            // strategy guards elsewhere (a missing row means "not monitored").
            const row = monTable[i] || { lambda: design.referenceWavelength || 550, strategy: 'time' };
            try {
                return monitorSignalQuality(design, resolveMat, i, row.lambda,
                    theta, pol, char, row.strategy || 'time');
            } catch (_) { return { ev: 0, finalSwing: 0, ok: false }; }
        });
    }, [design, monTable, theta, pol, char]);

    // "Auto λ" — apply Strategy 1 (most-sensitive wavelength per layer) to
    // every row. Uses the design's spectrum range as the candidate grid.
    const autoPickAllLambdas = useCallback(() => {
        if (!design?.frontLayers?.length) return;
        const lamA = Number.isFinite(design.spectrumLambdaStart) ? design.spectrumLambdaStart : 400;
        const lamB = Number.isFinite(design.spectrumLambdaEnd)   ? design.spectrumLambdaEnd   : 1000;
        const step = Math.max(5, Math.round((lamB - lamA) / 40));
        const grid = [];
        for (let lam = lamA; lam <= lamB + 1e-6; lam += step) grid.push(lam);
        setMonTable(prev => prev.map((row, i) => ({
            ...row,
            lambda: pickSensitiveLambda(design, resolveMat, i, grid, theta, pol, char),
        })));
    }, [design, theta, pol, char]);

    const monitorRow = (i) => {
        const row = monTable[i] || { strategy: 'time', lambda: 550 };
        const layer = design.frontLayers[i];
        const q = monQuality[i] || { ev: 0, finalSwing: 0, ok: false };
        // Color a row red if signal quality doesn't meet the thresholds
        // for the chosen strategy: level needs mid-slope (swing 0.2–0.8);
        // turning needs cut at an extremum (swing ≤ 0.15 or ≥ 0.85); time is
        // signal-blind and always OK. EV ≥ 4% required for any signal cut.
        const badQuality = !q.ok;
        const expect = row.strategy === 'turning'
            ? 'OK if EV≥4% AND swing ≤15% or ≥85% (cut should land on extremum)'
            : row.strategy === 'time'
                ? 'time mode: no signal needed'
                : 'OK if EV≥4% AND 20%≤swing≤80% (cut should land mid-slope)';
        const qTip = `EV=${(q.ev*100).toFixed(1)}%, swing=${(q.finalSwing*100).toFixed(0)}% — ` +
            (q.ok ? `OK — ${expect}` : `POOR — ${expect}`);
        return h('div', {
            key: layer.id || i,
            title: row.strategy !== 'time' ? qTip : undefined,
            style: { display:'grid',
                gridTemplateColumns: '28px 64px 56px 38px 38px', gap: 4, alignItems:'center',
                padding: '2px 0', borderBottom: `1px dashed ${c.border}`, fontSize: 11,
                background: badQuality ? '#ef535022' : 'transparent' }
        },
            h('span', { style: { color: c.text, fontWeight: 600 } }, `L${i+1}`),
            h('select', {
                value: row.strategy || 'time',
                onChange: e => setMon(i, 'strategy', e.target.value),
                style: { ...atoms.input, width: '100%' },
                title: mm.stratTip || 'turning = extremum cut; level = target-level cut; time = no signal',
            },
                h('option', { value:'turning' }, 'turning'),
                h('option', { value:'level' },   'level'),
                h('option', { value:'time' },    'time')),
            numInput(row.lambda ?? (design.referenceWavelength || 550),
                v => setMon(i, 'lambda', v),
                { min: 100, max: 20000, step: 1, width: '100%', title: mm.lamTip || 'Monitor wavelength (nm)' }),
            // EV (Entry Variation) – green if ≥ 4 %, red otherwise
            h('span', {
                style: {
                    fontFamily: 'ui-monospace, monospace', fontSize: 10,
                    color: row.strategy === 'time' ? c.textDim
                          : (q.ev >= 0.04 ? c.success : c.error),
                    textAlign: 'right',
                },
                title: 'Entry Variation — ≥ 4 % required for reliable cut detection',
            }, row.strategy === 'time' ? '—' : `${(q.ev * 100).toFixed(1)}%`),
            // Final-swing fraction — coloring depends on strategy. level
            // wants mid-slope (0.2–0.8); turning wants near-extremum
            // (≤0.15 or ≥0.85); time mode has no signal so is shown dim.
            h('span', {
                style: {
                    fontFamily: 'ui-monospace, monospace', fontSize: 10,
                    color: row.strategy === 'time'
                        ? c.textDim
                        : row.strategy === 'turning'
                            ? ((q.finalSwing <= 0.15 || q.finalSwing >= 0.85) ? c.success : c.error)
                            : ((q.finalSwing >= 0.2 && q.finalSwing <= 0.8)   ? c.success : c.error),
                    textAlign: 'right',
                },
                title: row.strategy === 'turning'
                    ? 'Final Swing — cut should land near extremum (≤15% or ≥85%)'
                    : 'Final Swing — cut should sit mid-slope (20%–80%)',
            }, row.strategy === 'time' ? '—' : `${(q.finalSwing * 100).toFixed(0)}%`),
        );
    };
    const badCount = monQuality.filter((q, i) => monTable[i]?.strategy !== 'time' && !q?.ok).length;
    const monTableSection = h(SectionCard, { c, title: mm.monTableSection || 'Per-layer monitor' },
        // Section toolbar: Auto-λ + quality summary. The summary is the
        // single most useful piece of info on this page — "5 of 6 layers
        // can't be monitored at the current λ" tells you instantly why
        // yield is 0%.
        h('div', {
            style: { display:'flex', alignItems:'center', gap: 8,
                     paddingBottom: 6, borderBottom: `1px solid ${c.border}`,
                     marginBottom: 4 }
        },
            h('button', {
                onClick: autoPickAllLambdas,
                style: { ...atoms.segBtn(false), padding: '3px 10px', fontSize: 11 },
                title: 'Pick the most sensitive monitoring wavelength per layer (Tikhonravov 2006).',
            }, 'Auto λ'),
            badCount > 0
                ? h('span', { style: { color: '#ef5350', fontSize: 11 } },
                    `⚠ ${badCount} / ${monQuality.length} layers unmonitorable at chosen λ`)
                : h('span', { style: { color: c.success, fontSize: 11 } },
                    `✓ all ${monQuality.length} optical layers have OK signal`),
        ),
        h('div', { style: { display:'grid',
            gridTemplateColumns:'28px 64px 56px 38px 38px', gap: 4,
            padding: '2px 0 4px 0', borderBottom: `1px solid ${c.border}`,
            color: c.textDim, fontSize: 10, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.04em' } },
            h('span', null, '#'),
            h('span', null, mm.stratHeader || 'strategy'),
            h('span', null, 'λ_mon'),
            h('span', { title: 'Entry Variation: signal change from layer start to nearest extremum, ≥ 4 % required.' }, 'EV'),
            h('span', { title: 'Final Swing fraction: cut should sit mid-slope (20–80 %).' }, 'swing'),
        ),
        h('div', { style: { maxHeight: 240, overflowY: 'auto' } },
            ...design.frontLayers.map((_, i) => monitorRow(i)),
        ),
    );

    const ratesSection = h(SectionCard, { c, title: mm.ratesSection || 'Rates' },
        h('div', { style: { fontSize: 10, color: c.textDim, marginBottom: 6 } },
            mm.ratesHint || 'mean ± σ rate per material'),
        ...materialIds.map(id => h('div', { key: id,
            style: { display:'flex', alignItems:'center', gap: 4, padding: '3px 0',
                borderBottom: `1px dashed ${c.border}`, fontSize: 11 } },
            h('span', { style: { ...atoms.label, flex: '0 0 60px', color: c.text, fontWeight: 600 } }, id),
            numInput(rates.get(id)?.mean ?? 0.5, v => setRate(id, 'mean', v),
                { min: 0.001, max: 100, step: 0.05, width: 50 }),
            h('span', { style:{ color: c.textDim } }, 'nm/s'),
            h('span', { style:{ color: c.textDim, marginLeft: 4 } }, '±'),
            numInput(rates.get(id)?.sigma ?? 0, v => setRate(id, 'sigma', v),
                { min: 0, max: 50, step: 0.01, width: 50 }),
        )),
    );

    const devsSection = h(SectionCard, { c, title: mm.devsSection || 'Deviations', defaultOpen: true },
        field(c, atoms, mm.sigmaReN || 'σ Re(n)',
            numInput(sigmaReN, setSigmaReN, { min: 0, max: 1, step: 0.001, width: 70 })),
        field(c, atoms, mm.sigmaImN || 'σ Im(n)',
            numInput(sigmaImN, setSigmaImN, { min: 0, max: 1, step: 0.0001, width: 70 })),
        h('label', { style: { display:'flex', alignItems:'center', gap: 5,
                padding: '2px 0', cursor: 'pointer', color: c.text, fontSize: 11 } },
            h('input', { type:'checkbox', checked: perMaterial,
                onChange: e => setPerMaterial(e.target.checked),
                style:{ cursor:'pointer', accentColor: c.accent } }),
            mm.perMaterial || 'per-material'),
        h('div', { style: { height: 1, background: c.border, margin: '6px 0' } }),
        field(c, atoms, mm.shutterMean || 'shutter μ',
            [numInput(shutterMs, setShutterMs, { min: 0, max: 1000, step: 10, width: 60, title: mm.shutterMeanTip || 'Mean shutter close delay (ms)' }),
             h('span', { style:{ color: c.textDim, fontSize: 11 } }, 'ms')]),
        field(c, atoms, mm.shutterRms || 'shutter σ',
            [numInput(shutterRmsMs, setShutterRmsMs, { min: 0, max: 1000, step: 10, width: 60, title: mm.shutterRmsTip || 'RMS shutter delay (ms)' }),
             h('span', { style:{ color: c.textDim, fontSize: 11 } }, 'ms')]),
    );

    const signalSection = h(SectionCard, { c, title: mm.signalSection || 'Signal' },
        field(c, atoms, mm.randomNoise || 'random',
            [numInput(sigRandom, setSigRandom, { min: 0, max: 20, step: 0.1, width: 64 }),
             h('span', { style:{ color: c.textDim, fontSize: 11 } }, '%')]),
        field(c, atoms, mm.drift || 'drift',
            [numInput(sigDrift, setSigDrift, { min: 0, max: 50, step: 0.1, width: 64 }),
             h('span', { style:{ color: c.textDim, fontSize: 10 } }, '%/1000s')]),
    );

    const mcSection = h(SectionCard, { c, title: mm.mcSection || 'Monte Carlo' },
        field(c, atoms, mm.nRuns || '#runs',
            numInputInt(nRuns, setNRuns, { min: 1, max: 500, width: 64, fallback: 10 })),
        field(c, atoms, mm.corridor || 'corridor',
            [numInput(corridorSigma, setCorridorSigma, { min: 0.1, max: 5, step: 0.1, width: 50 }),
             h('span', { style:{ color: c.textDim, fontSize: 11 } }, 'σ')]),
        // Yield-tolerance mode: '× MF₀' vs absolute MF threshold. Same UX
        // as BBM — when MF₀ ≈ 0 (well-tuned designs) the multiplier mode is
        // unusable, so switching to absolute is the practical workaround.
        field(c, atoms, mm.yieldMode || 'mode',
            h('div', { style: { display: 'flex', gap: 4 } },
                h('button', { onClick: () => setYieldMode('mul'),
                    style: atoms.segBtn(yieldMode === 'mul'),
                    title: mm.yieldTolTip }, mm.yieldModeMul || '× MF₀'),
                h('button', { onClick: () => setYieldMode('abs'),
                    style: atoms.segBtn(yieldMode === 'abs'),
                    title: mm.yieldAbsTolTip }, mm.yieldModeAbs || 'abs'),
            )),
        yieldMode === 'mul' && field(c, atoms, mm.yieldTol || 'yield tol',
            [numInput(yieldTolMult, setYieldTolMult, { min: 0.5, max: 1000, step: 0.1, width: 64, title: mm.yieldTolTip }),
             h('span', { style:{ color: c.textDim, fontSize: 10 } }, '× OMF₀')]),
        yieldMode === 'abs' && field(c, atoms, mm.yieldAbsTol || 'OMF abs',
            [
                numInput(yieldAbsTol, setYieldAbsTol,
                    { min: 0, max: 100, step: 0.001, width: 80, title: mm.yieldAbsTolTip }),
                h('button', {
                    onClick: setTolFromRuns,
                    disabled: !result?.yieldDetails?.mfRuns?.length,
                    style: {
                        ...atoms.segBtn(false),
                        padding: '3px 8px', fontSize: 10,
                        opacity: result?.yieldDetails?.mfRuns?.length ? 1 : 0.4,
                        cursor: result?.yieldDetails?.mfRuns?.length ? 'pointer' : 'default',
                    },
                    title: mm.yieldAutoTip,
                }, mm.yieldAuto || 'auto'),
            ]),
        h('label', { style: { display:'flex', alignItems:'center', gap: 5,
                padding: '2px 0', cursor: 'pointer', color: c.text, fontSize: 11 } },
            h('input', { type:'checkbox', checked: useWorkers,
                onChange: e => setUseWorkers(e.target.checked),
                style:{ cursor:'pointer', accentColor: c.accent } }),
            mm.useWorkers || 'Use worker pool'),
    );

    const anyRateSigma = Array.from(rates.values()).some(r => (r?.sigma || 0) > 0);
    const anyMonSigma = monTable.some(m => (m?.sigmaRelPct || 0) > 0);
    const noPerturbation = !anyRateSigma && !anyMonSigma
        && sigmaReN === 0 && sigmaImN === 0
        && shutterMs === 0 && shutterRmsMs === 0
        && sigRandom === 0 && sigDrift === 0;

    return h('div', {
        style: { display:'flex', flexDirection:'column', height:'100%',
            background: c.bg, color: c.text, overflow:'hidden',
            fontFamily:'system-ui, -apple-system, sans-serif', fontSize: 12 }
    },
        h('div', {
            style: { display:'flex', alignItems:'center', gap: 12, padding: '6px 12px',
                borderBottom: `1px solid ${c.border}`, background: c.panel, flexShrink: 0 }
        },
            running
                ? h('button', { onClick: stop, style: atoms.stopBtn }, mm.stop || '■ Stop')
                : h('button', { onClick: run, style: atoms.runBtn }, mm.run || '▶ Run'),
            running && h('div', {
                style: { display:'flex', alignItems:'center', gap: 8, color: c.accent, fontWeight: 500 }
            },
                h('span', null, `${mm.running || 'Running'}: ${progress.i}/${progress.total}`),
                h('div', { style: { width: 120, height: 6, background: c.border, borderRadius: 3, overflow: 'hidden' } },
                    h('div', { style: {
                        height: '100%', background: c.accent,
                        width: progress.total ? `${100 * progress.i / progress.total}%` : '0%',
                        transition: 'width 100ms linear',
                    } })
                )
            ),
            result && !running && h('span', { style:{ color: c.textDim, marginLeft: 4 } },
                `${result.nRuns} ${mm.runsDone || 'runs'}, ${char}`
                + (result.yield != null ? ` · yield ${(result.yield * 100).toFixed(1)}%` : ''),
            ),
            error && h('span', { style:{ color: '#ef5350', marginLeft: 8 } }, error),
        ),

        noPerturbation && h('div', {
            style: { padding:'4px 12px', background: '#ffa72611',
                     borderBottom:`1px solid ${c.border}`, color:'#ffa726',
                     fontSize: 11, flexShrink: 0,
                     fontFamily:'system-ui, -apple-system, sans-serif' }
        }, '⚠ ' + (mm.noPerturbHint || 'No deviations enabled — corridor and yield will collapse to theory. Turn on rate σ, σ Re(n), or σ thk to see real spread.')),

        h('div', { style: { display:'flex', flex: 1, minHeight: 0, overflow: 'hidden' } },
            h('div', {
                style: { width: sidebarWidth, flexShrink: 0,
                    borderRight: `1px solid ${c.border}`, background: c.bg,
                    overflowY: 'auto', overflowX: 'hidden', padding: 8 }
            },
                commonSection,
                monTableSection,
                ratesSection,
                signalSection,
                devsSection,
                mcSection,
            ),
            h('div', { style: { flex: 1, minWidth: 0, display:'flex', flexDirection:'column' } },
                h('div', {
                    style: { display:'flex', alignItems:'flex-end', gap: 0,
                        borderBottom:`1px solid ${c.border}`, background: c.panel, paddingLeft: 4, flexShrink: 0 }
                },
                    h('button', { onClick: () => setTab('spectral'),
                        style: atoms.tabBtn(tab === 'spectral') }, mm.tabSpectral || 'Spectral corridor'),
                    h('button', { onClick: () => setTab('thicknesses'),
                        style: atoms.tabBtn(tab === 'thicknesses') }, mm.tabThicknesses || 'Thicknesses'),
                    h('button', { onClick: () => setTab('yield'),
                        style: atoms.tabBtn(tab === 'yield') }, mm.tabYield || 'Yield'),
                    h('button', { onClick: () => setTab('signals'),
                        style: atoms.tabBtn(tab === 'signals') }, mm.tabSignals || 'Monitor signals'),
                ),
                h('div', { style: { flex: 1, minHeight: 0, position:'relative' } },
                    tab === 'signals'
                        ? h(MonitorSignalsChart, { design, monTable, common, c })
                        : (result
                            ? (tab === 'spectral'    ? h(SpectralChart,  { result, char, c })
                             : tab === 'thicknesses' ? h(ThicknessChart, { perLayer: result.perLayer, c })
                             : tab === 'yield'       ? h(YieldPanel,     { yieldDetails: result.yieldDetails, yieldFrac: result.yield, c })
                             : null)
                            : placeholder(running ? (mm.running || 'Running') + '…' : (mm.clickRun || 'Click Run to start MMS Monte Carlo.')))
                ),
            ),
        ),

        h('div', {
            style: { padding:'4px 12px', borderTop:`1px solid ${c.border}`,
                background: c.panel, flexShrink: 0, display:'flex',
                alignItems:'center', gap: 12, fontSize: 11, color: c.textDim }
        },
            h('span', null, design.name),
            h('span', { style: { color: c.textDim } }, '·'),
            h('span', null, `${design.frontLayers.length} layer${design.frontLayers.length === 1 ? '' : 's'}`),
            result && h('span', { style: { color: c.textDim } }, '·'),
            result && h('span', null, `OMF₀ = ${result.yieldDetails.mfTheory.toFixed(4)}`,
                result.yieldDetails.tol > 0 && `, tol = ${result.yieldDetails.tol.toFixed(4)}`),
        ),
    );
}
