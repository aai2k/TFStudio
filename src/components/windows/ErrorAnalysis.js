/**
 * Error Analysis — Monte Carlo simulation of manufacturing errors.
 *
 * Plots:
 *   • theoretical (unperturbed) spectrum
 *   • mathematical expectation  (sample mean across trials)
 *   • probability corridor  (mean ± k·σ, k = corridorSigma, default 1)
 *
 * Reference:
 *   • Macleod, *Thin-Film Optical Filters* 5th ed. §13.7 ("Tolerances")
 *     — Monte-Carlo as the established tolerance / yield method.
 *
 * The math is in `src/utils/errorAnalysis.js#runErrorAnalysisMC`; this file
 * is just the window UI.
 */

import { useDesign }              from '../../state/DesignContext.js';
import { EvalModeBadge }          from '../SurfaceModeBar.js';
import { getMaterialById }        from '../../utils/materials/catalogManager.js';
import { getMaterial }            from '../../utils/materials/materialDatabase.js';
import { runErrorAnalysisMC }     from '../../utils/physics/errorAnalysis.js';
import { DebouncedInput }         from '../ui/DebouncedInput.js';

const { createElement: h, useState, useEffect, useMemo, useCallback, useRef } = React;

function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// ── Per-design result cache ───────────────────────────────────────────────────
// Switching docking windows unmounts this component, which would discard an
// expensive Monte-Carlo run. Cache the inputs + last result per design.id so the
// user can leave and re-open the window to find the generated data intact (and
// re-run manually when they choose). Module-level Map → survives remounts;
// matches the `_scatterCache` pattern in RoughnessScattering.js.
const _eaCache = new Map();
function eaDefaults() {
    return {
        params: { lambdaStart: 400, lambdaEnd: 800, lambdaStep: 5, theta: 0, polarization: 'avg' },
        char: 'R', nTrials: 200, corridorSigma: 1.0,
        rmsAbsNm: 0, rmsRelPct: 1, rmsReN: 0, rmsImN: 0,
        distribution: 'gaussian',
        perMaterial: false, keepOPT: false, result: null,
    };
}
function eaSnapshot(design) {
    return (design && _eaCache.get(design.id)) || eaDefaults();
}

// ── Plotly envelope chart ─────────────────────────────────────────────────────

function ErrorChart({ result, char, c, corridorSigma = 1, showEnvelope = false }) {
    const divRef  = useRef(null);
    const initRef = useRef(false);

    const bgColor    = c.bg     || '#1e1e1e';
    const paperColor = c.panel  || '#252526';
    const gridColor  = c.border || '#3a3a3a';
    const textColor  = c.text   || '#cccccc';

    // Color the spectrum by characteristic to stay consistent with Optical Eval
    const charColor = char === 'T' ? '#4fc3f7' : char === 'R' ? '#ef5350' : '#66bb6a';

    const buildData = useCallback(() => {
        if (!result) return { data: [], layout: {} };
        const lam   = result.lambda;
        const toPct = arr => arr.map(v => v * 100);

        // Derive the corridor band live from mean ± k·σ so changing k re-draws
        // without re-running the Monte Carlo. Fall back to the engine's baked
        // lower/upper for results cached before stdev was returned.
        const k    = corridorSigma > 0 ? corridorSigma : 1;
        const mean = result.mean || [];
        const sd   = result.stdev || null;
        const lower = sd ? mean.map((m, i) => Math.max(0, m - k * sd[i])) : (result.lower || []);
        const upper = sd ? mean.map((m, i) => Math.min(1, m + k * sd[i])) : (result.upper || []);
        const kLabel = (Math.round(k * 100) / 100);

        const traces = [
            // Filled corridor — lower then upper with `fill: 'tonexty'`
            {
                x: lam, y: toPct(lower),
                type: 'scatter', mode: 'lines',
                line: { color: charColor, width: 0 },
                showlegend: false,
                hovertemplate: `%{x:.1f} nm<br>lower (−${kLabel}σ): %{y:.3f}%<extra></extra>`,
            },
            {
                x: lam, y: toPct(upper),
                type: 'scatter', mode: 'lines',
                fill: 'tonexty', fillcolor: charColor + '33',
                line: { color: charColor, width: 0 },
                name: `Corridor (±${kLabel}σ)`,
                hovertemplate: `%{x:.1f} nm<br>upper (+${kLabel}σ): %{y:.3f}%<extra></extra>`,
            },
            // Expectation
            {
                x: lam, y: toPct(result.mean),
                type: 'scatter', mode: 'lines',
                line: { color: charColor, width: 1.5, dash: 'dot' },
                name: 'Exp (mean)',
                hovertemplate: `%{x:.1f} nm<br>Exp: %{y:.3f}%<extra></extra>`,
            },
            // Theoretical
            {
                x: lam, y: toPct(result.theory),
                type: 'scatter', mode: 'lines',
                line: { color: charColor, width: 2 },
                name: `${char} theoretical`,
                hovertemplate: `%{x:.1f} nm<br>${char}: %{y:.3f}%<extra></extra>`,
            },
        ];

        // Realized min/max envelope overlay (added AFTER the corridor so the
        // `fill:'tonexty'` above still references the corridor lower trace).
        if (showEnvelope && result.envLower && result.envUpper) {
            traces.push({
                x: lam, y: toPct(result.envLower),
                type: 'scatter', mode: 'lines', opacity: 0.6,
                line: { color: charColor, width: 1, dash: 'dash' },
                showlegend: false,
                hovertemplate: `%{x:.1f} nm<br>min: %{y:.3f}%<extra></extra>`,
            });
            traces.push({
                x: lam, y: toPct(result.envUpper),
                type: 'scatter', mode: 'lines', opacity: 0.6,
                line: { color: charColor, width: 1, dash: 'dash' },
                name: 'Min/max envelope',
                hovertemplate: `%{x:.1f} nm<br>max: %{y:.3f}%<extra></extra>`,
            });
        }

        const layout = {
            paper_bgcolor: paperColor,
            plot_bgcolor:  bgColor,
            margin: { l: 52, r: 16, t: 16, b: 44 },
            font: { color: textColor, family: 'system-ui, -apple-system, sans-serif', size: 11 },
            xaxis: {
                title: { text: 'Wavelength (nm)', standoff: 8 },
                gridcolor: gridColor, zerolinecolor: gridColor,
                tickfont: { size: 10 }, color: textColor,
            },
            yaxis: {
                title: { text: `${char} (%)`, standoff: 8 },
                gridcolor: gridColor, zerolinecolor: gridColor,
                tickfont: { size: 10 }, color: textColor,
                rangemode: 'tozero',
            },
            legend: {
                x: 1, xanchor: 'right', y: 1, yanchor: 'top',
                bgcolor: paperColor + 'cc', bordercolor: gridColor, borderwidth: 1,
                font: { size: 10 },
            },
            hovermode: 'x unified',
        };
        return { data: traces, layout };
    }, [result, char, bgColor, paperColor, gridColor, textColor, charColor, corridorSigma, showEnvelope]);

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        const { data, layout } = buildData();
        const config = { responsive: true, displaylogo: false, displayModeBar: true };
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, data, layout, config);
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, data, layout, config);
        }
    }, [buildData]);

    useEffect(() => {
        const el = divRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el);
        return () => { ro.disconnect(); if (el) Plotly.purge(el); };  // purge on unmount (leak fix)
    }, []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: 200 } });
}

// ── Per-trial inspector modal ─────────────────────────────────────────────────
// Opens the recorded trials: a stats band (yield + worst-offending requirements
// and layers), a list of trials, and the per-layer Δd / Δn / Δk + spec result
// for the selected trial.

function TrialsModal({ result, design, c, t, corridorSigma, updateDesign, checkpoint, onClose }) {
    const ea = t.errorAnalysis || {};
    const trials = result.trials || [];
    const [sel, setSel] = useState(0);
    const [tab, setTab] = useState('stats'); // 'stats' | 'trials'
    const [loaded, setLoaded] = useState(null); // transient "loaded trial N" confirmation

    const front = design?.frontLayers || [];
    const back  = design?.backLayers  || [];

    // Apply a trial's perturbed thicknesses to the active design. Only the
    // thicknesses change — per-layer Δn/Δk are TMM material proxies, not part of
    // the stored design, so material assignments are untouched. Sides the chosen
    // analysis didn't perturb (dThk == null) keep their nominal thicknesses.
    // Undoable via a single checkpoint (Ctrl+Z restores the pre-load design).
    const loadThicknesses = useCallback((dThkF, dThkB, tagN) => {
        if (!updateDesign) return;
        const applySide = (layers, dThk) => layers.map((l, i) => {
            if (!dThk) return l;
            return { ...l, thickness: Math.max(0, (l.thickness || 0) + (dThk[i] || 0)) };
        });
        const patch = {};
        if (front.length) patch.frontLayers = applySide(front, dThkF);
        if (back.length)  patch.backLayers  = applySide(back,  dThkB);
        checkpoint?.();
        updateDesign(patch);
        setLoaded(tagN);
    }, [front, back, updateDesign, checkpoint]);
    // Which sides were actually perturbed (depends on the analyzed evalMode):
    // the engine records null for the side it didn't touch.
    const hasFront = trials[0]?.dThkF != null;
    const hasBack  = trials[0]?.dThkB != null;

    // Per-layer statistics across trials + failure correlation.
    const stats = useMemo(() => {
        const acc = [];
        const mk = (side, idx, l) => ({
            side, idx, label: side + (idx + 1), material: l.material, nominal: l.thickness || 0,
            sumSq: 0, sumAbsFail: 0, nFail: 0, sumAbsPass: 0, nPass: 0,
        });
        if (hasFront) front.forEach((l, i) => acc.push(mk('F', i, l)));
        if (hasBack)  back.forEach((l, i) => acc.push(mk('B', i, l)));
        let nFailTrials = 0, nPassTrials = 0;
        for (const trial of trials) {
            const hasSpec = !!trial.spec;
            const failed = hasSpec && trial.spec.allPass === false;
            if (hasSpec) { failed ? nFailTrials++ : nPassTrials++; }
            const dF = trial.dThkF || [], dB = trial.dThkB || [];
            for (const a of acc) {
                const d = a.side === 'F' ? (dF[a.idx] || 0) : (dB[a.idx] || 0);
                a.sumSq += d * d;
                if (hasSpec) {
                    if (failed) { a.sumAbsFail += Math.abs(d); a.nFail++; }
                    else        { a.sumAbsPass += Math.abs(d); a.nPass++; }
                }
            }
        }
        const n = trials.length || 1;
        for (const a of acc) {
            a.rms = Math.sqrt(a.sumSq / n);
            a.meanFail = a.nFail ? a.sumAbsFail / a.nFail : 0;
            a.meanPass = a.nPass ? a.sumAbsPass / a.nPass : 0;
            a.offender = a.meanFail - a.meanPass;   // >0 ⇒ moves more in failing trials
        }
        const byOffender = [...acc].sort((x, y) => y.offender - x.offender);
        const byRms      = [...acc].sort((x, y) => y.rms - x.rms);
        return { byOffender, byRms, nFailTrials, nPassTrials };
    }, [result, design]); // eslint-disable-line

    const qOffenders = useMemo(() => {
        const pq = (result.spec && result.spec.perQualifier) || [];
        return pq.filter(q => q.failRate > 0).sort((a, b) => b.failRate - a.failRate);
    }, [result]);

    // Spectral spread of the Monte-Carlo corridor (mean σ, peak σ and where).
    // Corridor width derived from mean ± k·σ (k = corridorSigma) so it tracks the
    // plot band, which is now computed in the UI rather than baked by the engine.
    const spread = useMemo(() => {
        const lam = result.lambda || [], sd = result.stdev || [], mean = result.mean || [];
        const k = corridorSigma > 0 ? corridorSigma : 1;
        const n = sd.length || 1;
        let sumSig = 0, sumWidth = 0, maxSig = -1, maxLam = null;
        for (let i = 0; i < sd.length; i++) {
            sumSig += sd[i];
            const lo = Math.max(0, (mean[i] ?? 0) - k * sd[i]);
            const hi = Math.min(1, (mean[i] ?? 0) + k * sd[i]);
            sumWidth += (hi - lo);
            if (sd[i] > maxSig) { maxSig = sd[i]; maxLam = lam[i]; }
        }
        return { meanSig: sumSig / n, meanWidth: sumWidth / n, maxSig: Math.max(0, maxSig), maxLam };
    }, [result, corridorSigma]);

    const tr = trials[sel] || null;

    const chip = (txt, color, tip, key) => h('span', {
        key, title: tip,
        style: {
            fontSize: 10, fontWeight: 600, color, padding: '1px 6px', borderRadius: 9,
            background: `${color}1a`, border: `1px solid ${color}55`, whiteSpace: 'nowrap',
        }
    }, txt);

    const sectionLbl = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: c.textDim, marginRight: 6 };
    // Material ids can be very long (e.g. "user_hr:SiO2_Silicon_dioxide…_m");
    // cull them for inline chips, full id stays on hover.
    const shortMat = (id, n = 16) => !id ? '—' : (id.length > n ? id.slice(0, n - 1) + '…' : id);

    // Layer rows for the selected trial
    const detailRows = [];
    if (hasFront) front.forEach((l, i) => detailRows.push({ label: 'F' + (i + 1), material: l.material, nominal: l.thickness || 0, dThk: tr?.dThkF?.[i] ?? 0, dn: tr?.dnF?.[i], dk: tr?.dkF?.[i] }));
    if (hasBack)  back.forEach((l, i)  => detailRows.push({ label: 'B' + (i + 1), material: l.material, nominal: l.thickness || 0, dThk: tr?.dThkB?.[i] ?? 0, dn: tr?.dnB?.[i], dk: tr?.dkB?.[i] }));
    const hasIdx = detailRows.some(r => r.dn != null || r.dk != null);

    const th = { padding: '3px 8px', fontWeight: 600, fontSize: 11, color: c.textDim, textAlign: 'right', position: 'sticky', top: 0, background: c.panel, borderBottom: `1px solid ${c.border}`, whiteSpace: 'nowrap' };
    const td = { padding: '2px 8px', fontSize: 11, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

    // Worst-layers ranking: by failure-correlation when there are failing trials,
    // otherwise by RMS Δd (which layers move the most).
    const haveFails  = stats.nFailTrials > 0;
    const worstLayers = (haveFails ? stats.byOffender : stats.byRms).slice(0, 12);
    const fmtPct = (v) => v == null ? '—' : (v * 100).toFixed(2) + '%';
    const tabBtn = (id, label) => h('button', {
        onClick: () => setTab(id),
        style: {
            padding: '5px 16px', fontSize: 12, cursor: 'pointer', border: 'none', outline: 'none',
            borderBottom: `2px solid ${tab === id ? c.accent : 'transparent'}`,
            background: 'transparent', color: tab === id ? c.accent : c.textDim,
            fontWeight: tab === id ? 600 : 400, fontFamily: 'inherit',
        }
    }, label);

    // ── Statistics tab ───────────────────────────────────────────────────────
    const statRow = (label, value, color) => h('div', {
        style: { display: 'flex', justifyContent: 'space-between', gap: 16, padding: '3px 0', borderBottom: `1px solid ${c.border}55` }
    },
        h('span', { style: { color: c.textDim, fontSize: 12 } }, label),
        h('span', { style: { color: color || c.text, fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' } }, value),
    );
    const blockLbl = { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: c.textDim, margin: '4px 0 2px' };

    const sp = result.spec;
    const yieldCol = !sp || sp.yield == null ? c.textDim : sp.yield >= 0.95 ? c.success : sp.yield >= 0.8 ? c.warning : c.error;

    const statsPanel = h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 14px' } },
        // Overview
        h('div', { style: blockLbl }, ea.statsOverview || 'Overview'),
        statRow(ea.trialsDone || 'Trials', String(result.nTrials)),
        statRow(ea.statCharacteristic || 'Characteristic', String(result.char)),
        corridorSigma != null && statRow(ea.statCorridor || 'Corridor', `±${corridorSigma}σ`),
        sp && statRow(ea.specYield || 'Spec yield',
            sp.yield == null ? '—' : `${(sp.yield * 100).toFixed(1)}%  (${sp.passCount}/${sp.evaluated})`, yieldCol),

        // Spectral spread
        h('div', { style: blockLbl }, ea.statsSpread || 'Spectral spread (Monte-Carlo σ)'),
        statRow(ea.statMeanSigma || 'Mean σ', fmtPct(spread.meanSig)),
        statRow(ea.statPeakSigma || 'Peak σ', `${fmtPct(spread.maxSig)}${spread.maxLam != null ? `  @ ${spread.maxLam} nm` : ''}`),
        statRow(ea.statCorridorWidth || `Mean corridor width (±${corridorSigma ?? 1}σ)`, fmtPct(spread.meanWidth)),

        // Worst requirements
        sp && h('div', { style: blockLbl }, ea.worstReqs || 'Worst requirements'),
        sp && (qOffenders.length === 0
            ? h('div', { style: { fontSize: 12, color: c.success, padding: '3px 0' } }, ea.allReqsPass || 'All requirements pass in every trial')
            : h('table', { style: { width: '100%', borderCollapse: 'collapse', marginTop: 2 } },
                h('thead', null, h('tr', null,
                    h('th', { style: { ...th, textAlign: 'left' } }, ea.colReq || 'Requirement'),
                    h('th', { style: th }, ea.colFailRate || 'Fail rate'),
                )),
                h('tbody', null, qOffenders.map((q, i) => h('tr', { key: i, style: { background: i % 2 ? c.panel + '44' : 'transparent' } },
                    h('td', { style: { ...td, textAlign: 'left', color: c.text } }, q.label),
                    h('td', { style: { ...td, color: '#ef5350', fontWeight: 600 } }, `${(q.failRate * 100).toFixed(0)}%`),
                ))),
            )),

        // Worst layers / offenders
        worstLayers.length > 0 && h('div', { style: blockLbl, title: haveFails ? (ea.worstLayersTip || 'Layers whose thickness deviates more in failing trials than passing ones — the likely culprits.') : (ea.worstLayersRmsTip || 'Layers with the largest RMS thickness deviation across all trials.') },
            haveFails ? (ea.worstLayers || 'Worst layers (failure-correlated)') : (ea.worstLayersRms || 'Most-perturbed layers (RMS Δd)')),
        worstLayers.length > 0 && h('table', { style: { width: '100%', borderCollapse: 'collapse', marginTop: 2 } },
            h('thead', null, h('tr', null,
                h('th', { style: { ...th, textAlign: 'left' } }, ea.colLayer || 'Layer'),
                h('th', { style: { ...th, textAlign: 'left' } }, ea.colMaterial || 'Material'),
                h('th', { style: th }, ea.colRmsD || 'RMS Δd'),
                haveFails && h('th', { style: th, title: ea.colFailDTip || 'Mean |Δd| in failing trials' }, ea.colFailD || 'Δ̄ fail'),
                haveFails && h('th', { style: th, title: ea.colPassDTip || 'Mean |Δd| in passing trials' }, ea.colPassD || 'Δ̄ pass'),
            )),
            h('tbody', null, worstLayers.map((a, i) => h('tr', { key: i, style: { background: i % 2 ? c.panel + '44' : 'transparent' } },
                h('td', { style: { ...td, textAlign: 'left', color: c.text } }, a.label),
                h('td', { style: { ...td, textAlign: 'left', color: c.textDim } },
                    h('span', { title: a.material || '', style: { display: 'inline-block', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' } }, a.material || '—')),
                h('td', { style: { ...td, color: c.text } }, `${a.rms.toFixed(2)} nm`),
                haveFails && h('td', { style: { ...td, color: a.offender > 1e-6 ? '#ffb74d' : c.textDim, fontWeight: a.offender > 1e-6 ? 600 : 400 } }, `${a.meanFail.toFixed(2)}`),
                haveFails && h('td', { style: { ...td, color: c.textDim } }, `${a.meanPass.toFixed(2)}`),
            ))),
        ),
    );

    // ── Trials tab (list + selected-trial detail) ─────────────────────────────
    const trialsPanel = h('div', { style: { flex: 1, minHeight: 0, display: 'flex' } },
        // Trials list
        h('div', { style: { width: 150, flexShrink: 0, borderRight: `1px solid ${c.border}`, overflowY: 'auto', background: c.panel + '55' } },
            trials.map((trial, i) => {
                const failed = trial.spec && trial.spec.allPass === false;
                const mark = !trial.spec ? '' : failed ? '✗' : '✓';
                const mc = !trial.spec ? c.textDim : failed ? c.error : c.success;
                return h('div', {
                    key: i, onClick: () => setSel(i),
                    style: {
                        padding: '4px 10px', cursor: 'pointer', fontSize: 12,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        background: i === sel ? (c.accent + '33') : 'transparent',
                        borderLeft: `2px solid ${i === sel ? c.accent : 'transparent'}`,
                    }
                },
                    h('span', null, `${ea.trialN || 'Trial'} ${trial.i}`),
                    h('span', { style: { color: mc, fontWeight: 700 } }, mark),
                );
            })
        ),
        // Detail
        h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
            // Toolbar: load this trial's thicknesses into the active design
            tr && h('div', { style: { padding: '6px 12px', borderBottom: `1px solid ${c.border}`, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 } },
                h('button', {
                    onClick: () => loadThicknesses(tr.dThkF, tr.dThkB, tr.i),
                    title: ea.loadTrialTip || 'Replace the active design\'s layer thicknesses with this trial\'s perturbed values (Δn/Δk are not applied — they are not stored on the design). Undoable with Ctrl+Z.',
                    style: { padding: '4px 12px', cursor: 'pointer', border: `1px solid ${c.accent}`, borderRadius: 3, background: c.accent + '22', color: c.accent, fontWeight: 600, fontSize: 12, fontFamily: 'inherit' },
                }, `↧ ${ea.loadTrial || 'Load thicknesses into design'}`),
                loaded === tr.i && h('span', { style: { color: c.success, fontSize: 11 } }, ea.loadedOk || 'Loaded — Ctrl+Z to undo'),
            ),
            tr && tr.spec && h('div', { style: { padding: '6px 12px', borderBottom: `1px solid ${c.border}`, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0 } },
                chip(tr.spec.allPass ? (ea.specAllPassShort || 'Spec PASS') : `${tr.spec.total - tr.spec.passing}/${tr.spec.total} ${(t.specification && t.specification.failSuffix) || 'fail'}`,
                     tr.spec.allPass ? c.success : c.error, null, 'v'),
                ...(tr.spec.results || []).filter(r => r.pass === false).map((r, i) =>
                    chip(`✗ ${r.label} = ${r.value ?? '—'}`, '#ef5350', null, i)),
            ),
            h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto' } },
                h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                    h('thead', null, h('tr', null,
                        h('th', { style: { ...th, textAlign: 'left' } }, ea.colLayer || 'Layer'),
                        h('th', { style: { ...th, textAlign: 'left' } }, ea.colMaterial || 'Material'),
                        h('th', { style: th }, ea.colNominal || 'd₀ (nm)'),
                        h('th', { style: th }, 'Δd (nm)'),
                        h('th', { style: th }, ea.colNew || 'd (nm)'),
                        hasIdx && h('th', { style: th }, 'Δn'),
                        hasIdx && h('th', { style: th }, 'Δk'),
                    )),
                    h('tbody', null,
                        detailRows.map((r, i) => {
                            const newD = Math.max(0, r.nominal + r.dThk);
                            const dCol = Math.abs(r.dThk) < 1e-9 ? c.textDim : (r.dThk > 0 ? '#4fc3f7' : '#ef9800');
                            return h('tr', { key: i, style: { background: i % 2 ? c.panel + '44' : 'transparent' } },
                                h('td', { style: { ...td, textAlign: 'left', color: c.text } }, r.label),
                                h('td', { style: { ...td, textAlign: 'left', color: c.textDim } },
                                    h('span', {
                                        title: r.material || '',
                                        style: { display: 'inline-block', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }
                                    }, r.material || '—')),
                                h('td', { style: { ...td, color: c.textDim } }, r.nominal.toFixed(2)),
                                h('td', { style: { ...td, color: dCol, fontWeight: 600 } }, (r.dThk >= 0 ? '+' : '') + r.dThk.toFixed(3)),
                                h('td', { style: { ...td, color: c.text } }, newD.toFixed(2)),
                                hasIdx && h('td', { style: { ...td, color: c.textDim } }, r.dn != null ? (r.dn >= 0 ? '+' : '') + r.dn.toFixed(4) : '—'),
                                hasIdx && h('td', { style: { ...td, color: c.textDim } }, r.dk != null ? (r.dk >= 0 ? '+' : '') + r.dk.toFixed(4) : '—'),
                            );
                        })
                    )
                )
            )
        )
    );

    return h('div', {
        onClick: onClose,
        style: {
            // Float over the whole app (not trapped inside the docked window).
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            // The custom title bar is a -webkit-app-region:drag strip; without an
            // explicit no-drag here the top ~32 px of this overlay becomes an OS
            // window-drag region and eats clicks (the ✕ was only clickable below
            // that band). Carve the whole modal out of the drag region.
            WebkitAppRegion: 'no-drag',
        }
    },
        h('div', {
            onClick: (e) => e.stopPropagation(),
            style: {
                // Compact: cap the size so it opens as a tidy dialog, not full-bleed.
                width: 'min(860px, 94vw)', height: 'min(600px, 88vh)',
                background: c.bg, color: c.text,
                border: `1px solid ${c.border}`, borderRadius: 6, overflow: 'hidden',
                display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
                fontFamily: 'system-ui, -apple-system, sans-serif',
            }
        },
            // Header
            h('div', { style: { display: 'flex', alignItems: 'center', padding: '6px 12px', borderBottom: `1px solid ${c.border}`, background: c.panel, flexShrink: 0 } },
                h('span', { style: { fontWeight: 600, fontSize: 13 } }, ea.trialInspector || 'Trial inspector'),
                h('span', { style: { marginLeft: 10, color: c.textDim, fontSize: 11 } },
                    `${trials.length} ${ea.trialsDone || 'trials'}${result.spec ? ` · ${ea.specYield || 'yield'} ${result.spec.yield == null ? '—' : (result.spec.yield * 100).toFixed(0) + '%'}` : ''}`),
                h('div', { style: { flex: 1 } }),
                h('button', { onClick: onClose, title: ea.close || 'Close', style: { padding: '2px 10px', cursor: 'pointer', border: `1px solid ${c.border}`, borderRadius: 3, background: c.inputBg || c.hover, color: c.text } }, '✕'),
            ),

            // Tab bar
            h('div', { style: { display: 'flex', alignItems: 'center', borderBottom: `1px solid ${c.border}`, background: c.panel, flexShrink: 0 } },
                tabBtn('stats', ea.tabStatistics || 'Statistics'),
                tabBtn('trials', `${ea.tabTrials || 'Trials'} (${trials.length})`),
            ),

            // Active tab
            tab === 'stats' ? statsPanel : trialsPanel,
        )
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ErrorAnalysis({ c, theme, t }) {
    const ea = t.errorAnalysis;
    const { design, evalMode, updateDesign, checkpoint } = useDesign();

    // ── Setup state (restored from the per-design cache on mount) ─────────────
    const snap0 = useMemo(() => eaSnapshot(design), []); // eslint-disable-line react-hooks/exhaustive-deps
    const [params, setParams] = useState(snap0.params);
    const [char,            setChar]            = useState(snap0.char); // T | R | A
    const [nTrials,         setNTrials]         = useState(snap0.nTrials);
    const [corridorSigma,   setCorridorSigma]   = useState(snap0.corridorSigma);
    const [rmsAbsNm,        setRmsAbsNm]        = useState(snap0.rmsAbsNm);
    const [rmsRelPct,       setRmsRelPct]       = useState(snap0.rmsRelPct);
    const [rmsReN,          setRmsReN]          = useState(snap0.rmsReN);
    const [rmsImN,          setRmsImN]          = useState(snap0.rmsImN);
    const [distribution,    setDistribution]    = useState(snap0.distribution || 'gaussian');
    const [perMaterial,     setPerMaterial]     = useState(snap0.perMaterial);
    const [keepOPT,         setKeepOPT]         = useState(snap0.keepOPT);

    const [result,   setResult]   = useState(snap0.result);
    const [running,  setRunning]  = useState(false);
    const [progress, setProgress] = useState({ i: 0, total: 0 });
    const [error,    setError]    = useState(null);
    const [showTrials, setShowTrials] = useState(false); // per-trial inspector modal
    const [showEnvelope, setShowEnvelope] = useState(false); // realized min/max overlay

    const cancelledRef = useRef(false);

    // M9: rehydrate ALL state from the per-design cache when the design changes.
    // Without this, state kept the previous design's values while the persist
    // effect (which also fires on id change) wrote them under the NEW design's
    // slot — corrupting B's cached setup/result so B kept showing A's corridor.
    // The persist effect's state deps then re-fire with the correct values.
    useEffect(() => {
        if (!design) return;
        const snap = eaSnapshot(design);
        setParams(snap.params);
        setChar(snap.char);
        setNTrials(snap.nTrials);
        setCorridorSigma(snap.corridorSigma);
        setRmsAbsNm(snap.rmsAbsNm);
        setRmsRelPct(snap.rmsRelPct);
        setRmsReN(snap.rmsReN);
        setRmsImN(snap.rmsImN);
        setDistribution(snap.distribution || 'gaussian');
        setPerMaterial(snap.perMaterial);
        setKeepOPT(snap.keepOPT);
        setResult(snap.result);
    }, [design?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Run ───────────────────────────────────────────────────────────────────
    const run = useCallback(async () => {
        // M11: mode-aware guard — 'back' needs back layers, 'front' needs front,
        // 'total' accepts either. (The MC compute path handles all three modes.)
        const hasFront = !!design?.frontLayers?.length;
        const hasBack  = !!design?.backLayers?.length;
        const hasLayers = evalMode === 'back' ? hasBack
                        : evalMode === 'front' ? hasFront
                        : (hasFront || hasBack);
        if (!hasLayers) {
            setError('No layers to perturb.');
            return;
        }
        setError(null);
        setRunning(true);
        setProgress({ i: 0, total: nTrials });
        cancelledRef.current = false;

        // Run synchronously in a microtask so the UI gets one paint before
        // the heavy loop. For very large trial counts the loop should
        // eventually move to a worker, but at ~20–100 trials × hundreds of
        // wavelengths it's plenty fast on the main thread (matches the rest
        // of the analysis windows, which are also synchronous).
        await new Promise(r => setTimeout(r, 0));

        try {
            const res = await runErrorAnalysisMC(design, params, resolveMat, {
                char,
                evalMode,
                nTrials,
                // M18: yield every few trials so the UI paints progress and a Stop
                // click is processed; shouldCancel breaks the loop early and
                // returns the partial corridor accumulated so far.
                yieldEvery: 4,
                onYield: () => new Promise(r => setTimeout(r, 0)),
                shouldCancel: () => cancelledRef.current,
                // corridorSigma is NOT passed: the corridor band is derived in the
                // UI from mean ± k·σ, so changing k re-draws without re-running MC.
                rmsAbsNm,
                rmsRelPct,
                rmsReN,
                rmsImN,
                distribution,
                perMaterialErrors: perMaterial,
                // "Keep n·d" only does anything when index errors are drawn —
                // it links Δd to Δn. With thickness errors alone it would force
                // Δd = 0 (nominal plot), so gate it on index errors being set.
                keepOpticalThickness: keepOPT && (rmsReN > 0 || rmsImN > 0),
                // Always evaluate the Specification when the design has
                // qualifiers, so the user always sees the yield / which tests fail.
                evaluateSpec: (design?.qualifiers?.length || 0) > 0,
                qualifiers: design?.qualifiers || [],
                recordTrials: true,
                onTrial: ({ i, total }) => {
                    setProgress({ i, total });
                },
            });
            setResult(res);
        } catch (e) {
            setError(e.message || String(e));
        }
        setRunning(false);
    }, [design, params, evalMode, char, nTrials,
        rmsAbsNm, rmsRelPct, rmsReN, rmsImN, distribution, perMaterial, keepOPT]);

    const stop = useCallback(() => {
        // M18: the MC loop checks cancelledRef between yields and breaks within a
        // few trials, returning the partial corridor; run() then clears running.
        cancelledRef.current = true;
        setRunning(false);
    }, []);

    // Auto-recompute when fundamentals (design/params/char) change, but only
    // if user has already run once — otherwise wait for explicit Run. Seed
    // hasRun from the cache (so a restored result keeps auto-updating on toggle)
    // and skip the very first effect fire on mount so re-opening the window
    // shows the cached result without immediately recomputing it.
    const hasRunRef  = useRef(!!snap0.result);
    const didMountRef = useRef(false);
    useEffect(() => {
        if (!didMountRef.current) { didMountRef.current = true; return; }
        if (hasRunRef.current && !running) run();
    }, [design?.id, char, params.theta, params.polarization, evalMode]); // eslint-disable-line

    // Persist inputs + result to the per-design cache on every change, so a
    // docking-window switch (which unmounts us) never loses generated data.
    useEffect(() => {
        if (!design) return;
        _eaCache.set(design.id, {
            params, char, nTrials, corridorSigma,
            rmsAbsNm, rmsRelPct, rmsReN, rmsImN, distribution,
            perMaterial, keepOPT, result,
        });
    }, [design?.id, params, char, nTrials, corridorSigma,
        rmsAbsNm, rmsRelPct, rmsReN, rmsImN, distribution, perMaterial, keepOPT, result]);

    const handleRun = useCallback(async () => {
        hasRunRef.current = true;
        await run();
    }, [run]);

    // ── Render guards ─────────────────────────────────────────────────────────
    const placeholder = (msg) => h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontStyle: 'italic',
            fontFamily: 'system-ui, -apple-system, sans-serif', padding: 16, textAlign: 'center',
        }
    }, msg);

    if (!design) return placeholder(ea.noDesign);
    // M11: mode-aware (see IntegralValues) — back_only/total designs with a
    // populated back stack must not be locked out.
    {
        const hasFront = !!design.frontLayers?.length;
        const hasBack  = !!design.backLayers?.length;
        const hasLayers = evalMode === 'back' ? hasBack
                        : evalMode === 'front' ? hasFront
                        : (hasFront || hasBack);
        if (!hasLayers) return placeholder(ea.noLayers);
    }

    // ── Styles ────────────────────────────────────────────────────────────────
    const labelStyle = {
        color: c.textDim, fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
        whiteSpace: 'nowrap',
    };
    // Gaussian: the entered value IS σ. Uniform/Truncated: it is a hard ± bound,
    // not a σ — relabel "σ …" → "± …" so the field never claims to be a std-dev.
    const lbl = (s) => (distribution === 'gaussian') ? s : (s || '').replace('σ', '±');

    // Free-editing number box (DebouncedInput): keeps a local string buffer so the
    // field can be cleared mid-edit; commits the parsed number on blur/Enter, and
    // an empty/invalid entry falls back to `fallback`. Replaces the old controlled
    // `parseFloat(e.target.value)||x` inputs that refused to go empty.
    const numBox = (value, onNum, opts = {}) => {
        const { width = 55, marginLeft = 6, fallback = 0, int = false, title } = opts;
        return h(DebouncedInput, {
            value: String(value),
            title,
            onChange: (v) => {
                const s = String(v).trim();
                if (s === '') { onNum(fallback); return; }
                const n = int ? parseInt(v, 10) : parseFloat(v);
                onNum(Number.isFinite(n) ? n : fallback);
            },
            style: { ...inputStyle, marginLeft, width },
        });
    };
    const inputStyle = {
        background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        padding: '1px 4px', fontSize: 12, width: 64,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    const segBtnStyle = (active) => ({
        padding: '2px 10px',
        background: active ? c.accent : (c.inputBg || c.hover),
        color: active ? '#fff' : c.text,
        border: `1px solid ${active ? c.accent : c.border}`,
        borderRadius: 3, cursor: 'pointer', fontSize: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    });
    const runBtnStyle = {
        padding: '3px 14px', fontSize: 12, cursor: 'pointer',
        border: `1px solid ${c.accent}`, borderRadius: 3,
        background: c.accent + '33', color: c.accent,
        outline: 'none', fontFamily: 'system-ui, -apple-system, sans-serif',
        fontWeight: 600,
    };

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text, overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
        }
    },
        // ── Top: setup row 1 — characteristic / λ / AOI / trials ──────────────
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                padding: '5px 10px', borderBottom: `1px solid ${c.border}`,
                background: c.panel, flexShrink: 0,
            }
        },
            // Evaluation target — read-only, set in the Design Editor.
            h(EvalModeBadge, { design, c, t }),
            h('div', { style: { width: 1, height: 20, background: c.border } }),
            h('div', { style: { display: 'flex', gap: 2 } },
                ['T', 'R', 'A'].map(ch => h('button', {
                    key: ch, onClick: () => setChar(ch), style: segBtnStyle(char === ch)
                }, ch))
            ),
            h('label', { style: labelStyle }, ea.lambdaRange,
                numBox(params.lambdaStart, v => setParams(p => ({ ...p, lambdaStart: v })), { width: 60, fallback: 100 }),
                h('span', { style: { margin: '0 4px', color: c.textDim } }, '–'),
                numBox(params.lambdaEnd, v => setParams(p => ({ ...p, lambdaEnd: v })), { width: 60, marginLeft: 0, fallback: 800 })
            ),
            h('label', { style: labelStyle }, ea.step,
                numBox(params.lambdaStep, v => setParams(p => ({ ...p, lambdaStep: v > 0 ? v : 5 })), { width: 50, fallback: 5 })
            ),
            h('label', { style: labelStyle }, ea.aoi,
                numBox(params.theta, v => setParams(p => ({ ...p, theta: v })), { width: 50, fallback: 0 })
            ),
            h('label', { style: labelStyle }, ea.pol,
                h('select', {
                    value: params.polarization,
                    onChange: e => setParams(p => ({ ...p, polarization: e.target.value })),
                    style: { ...inputStyle, marginLeft: 6, width: 70 }
                },
                    h('option', { value: 'avg' }, 'avg'),
                    h('option', { value: 's'   }, 's'),
                    h('option', { value: 'p'   }, 'p'),
                )
            ),
            h('div', { style: { width: 1, height: 20, background: c.border } }),
            h('label', { style: labelStyle }, ea.nTrials,
                numBox(nTrials, v => setNTrials(Math.max(1, v)), { width: 60, fallback: 1, int: true })
            ),
            h('label', { style: labelStyle, title: ea.corridorTip || 'Shaded band = mean ± k·σ of the spectrum across trials (k below). Display only — changing k re-draws the band without re-running the Monte Carlo, and does not affect the yield. k≈1 ≈ 68% only for Gaussian.' }, ea.corridor,
                numBox(corridorSigma, v => setCorridorSigma(v > 0 ? v : 1), { width: 50, fallback: 1 }),
                h('span', { style: { color: c.textDim, marginLeft: 2 } }, 'σ')
            ),
            // Distribution selector lives with the statistical-sampling controls
            // (trials / corridor / envelope), not with the error-magnitude row —
            // it governs HOW each layer's error is drawn, not its size.
            h('label', { style: { ...labelStyle, display: 'flex', alignItems: 'center', gap: 4 }, title: ea.distributionTip },
                ea.distribution,
                h('select', {
                    value: distribution,
                    onChange: e => {
                        const v = e.target.value;
                        setDistribution(v);
                        // Bounded distributions have realized hard bounds — surface
                        // them via the min/max envelope. We deliberately do NOT auto-
                        // set k: no fixed k·σ corridor equals the envelope, because the
                        // spectrum is ~Gaussian (central-limit over many layers) even
                        // when each layer's error is uniform/truncated.
                        if (v === 'uniform' || v === 'truncated') setShowEnvelope(true);
                    },
                    style: { ...inputStyle, marginLeft: 6, width: 120, cursor: 'pointer' },
                },
                    h('option', { value: 'gaussian'  }, ea.distGaussian),
                    h('option', { value: 'uniform'   }, ea.distUniform),
                    h('option', { value: 'truncated' }, ea.distTruncated),
                ),
            ),
            h('label', {
                style: { ...labelStyle, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' },
                title: ea.envelopeTip || 'Overlay the realized min/max envelope (the extreme spectra across all trials). For Uniform/Truncated this is the true hard bound; for Gaussian it has no fixed limit and widens with the number of trials.',
            },
                h('input', { type: 'checkbox', checked: showEnvelope, onChange: e => setShowEnvelope(e.target.checked), style: { cursor: 'pointer' } }),
                h('span', null, ea.envelope || 'min/max')
            ),
            h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } },
                running
                    ? h('button', { onClick: stop, style: { ...runBtnStyle, borderColor: '#ef5350', color: '#ef5350', background: '#ef535033' } }, ea.stop)
                    : h('button', { onClick: handleRun, style: runBtnStyle }, ea.run)
            )
        ),

        // ── Top: setup row 2 — RMS errors ─────────────────────────────────────
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                padding: '5px 10px', borderBottom: `1px solid ${c.border}`,
                background: c.panel + 'aa', flexShrink: 0,
            }
        },
            h('span', { style: { ...labelStyle, color: c.text, fontWeight: 600 } }, ea.thickness + ':'),
            h('label', { style: labelStyle, title: ea.rmsAbsTip || 'Standard deviation of the absolute thickness error (nm). Exact meaning depends on the distribution selector; for Gaussian ~68% of layers stay within ±this value.' }, lbl(ea.rmsAbs),
                numBox(rmsAbsNm, setRmsAbsNm, { width: 55, fallback: 0 }),
                h('span', { style: { color: c.textDim, marginLeft: 2 } }, 'nm')
            ),
            h('label', { style: labelStyle, title: ea.rmsRelTip || 'Relative thickness error (% of layer thickness d), added to σ abs. Exact meaning depends on the distribution selector; for Gaussian ~68% of layers stay within ±this value.' }, lbl(ea.rmsRel),
                numBox(rmsRelPct, setRmsRelPct, { width: 55, fallback: 0 }),
                h('span', { style: { color: c.textDim, marginLeft: 2 } }, '%')
            ),
            h('div', { style: { width: 1, height: 18, background: c.border } }),
            h('span', { style: { ...labelStyle, color: c.text, fontWeight: 600 } }, ea.indices + ':'),
            h('label', { style: labelStyle, title: ea.rmsReNTip || 'Error on the real part of the refractive index n. Exact meaning depends on the distribution selector; for Gaussian ~68% of layers stay within ±this value.' }, lbl(ea.rmsReN),
                numBox(rmsReN, setRmsReN, { width: 55, fallback: 0 })
            ),
            h('label', { style: labelStyle, title: ea.rmsImNTip || 'Error on the imaginary part of the refractive index k (extinction). Exact meaning depends on the distribution selector; for Gaussian ~68% of layers stay within ±this value.' }, lbl(ea.rmsImN),
                numBox(rmsImN, setRmsImN, { width: 55, fallback: 0 })
            ),
            h('label', {
                style: { display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: c.text, fontSize: 11 },
                title: ea.perMaterialTip,
            },
                h('input', {
                    type: 'checkbox', checked: perMaterial, onChange: e => setPerMaterial(e.target.checked),
                    style: { cursor: 'pointer', accentColor: c.accent }
                }),
                ea.perMaterial
            ),
            (() => {
                // Disable "Keep n·d" unless index errors are set — otherwise it
                // links Δd to Δn=0 and the plot collapses to nominal (confusing).
                const idxOn = (rmsReN > 0 || rmsImN > 0);
                return h('label', {
                    style: {
                        display: 'flex', alignItems: 'center', gap: 4,
                        cursor: idxOn ? 'pointer' : 'not-allowed',
                        color: idxOn ? c.text : c.textDim, opacity: idxOn ? 1 : 0.5, fontSize: 11,
                    },
                    title: idxOn ? ea.keepOPTTip
                        : (ea.keepOPTDisabledTip || 'Only affects index-error trials. Set σ Re(n) or σ Im(n) first — with thickness errors alone, keeping n·d constant cancels the perturbation (nominal plot).'),
                },
                    h('input', {
                        type: 'checkbox', checked: keepOPT && idxOn, disabled: !idxOn,
                        onChange: e => setKeepOPT(e.target.checked),
                        style: { cursor: idxOn ? 'pointer' : 'not-allowed', accentColor: c.accent }
                    }),
                    ea.keepOPT
                );
            })(),
        ),

        // ── Inline note: what σ / the bound means for the chosen distribution ──
        h('div', {
            style: {
                padding: '6px 10px', borderBottom: `1px solid ${c.border}`,
                background: c.panel + 'aa', flexShrink: 0,
                fontSize: 10.5, color: c.textDim, lineHeight: 1.4,
                borderLeft: `2px solid ${c.accent}`,
            }
        },
            distribution === 'uniform'
                ? (ea.sigmaNoteUniform || 'The value you enter is taken as the hard ± bound B (the largest possible deviation), NOT as σ: deviations are spread uniformly over [−B, +B], so none exceeds B and the realized RMS (effective σ) = B/√3 ≈ 0.58·B.')
                : distribution === 'truncated'
                    ? (ea.sigmaNoteTruncated || 'The value you enter is taken as the hard ± bound B = 3σ (so σ = B/3), NOT as σ directly: a Gaussian bell clipped so no deviation exceeds ±B; realized RMS ≈ B/3.')
                    : (ea.sigmaNoteGaussian || 'σ is one standard deviation: about 68% of layer deviations stay within ±σ and ~32% exceed it (Gaussian tails are unbounded). Thickness error per layer = σ abs + σ rel·d.')
        ),

        // ── Chart / placeholder ───────────────────────────────────────────────
        h('div', { style: { flex: 1, minHeight: 0, position: 'relative' } },
            error
                ? placeholder(`Error: ${error}`)
                : (result
                    ? h(ErrorChart, { result, char, c, corridorSigma, showEnvelope })
                    : placeholder(running ? ea.running : ea.clickRun))
        ),

        // ── Bottom status bar ─────────────────────────────────────────────────
        h('div', {
            style: {
                padding: '3px 10px', borderTop: `1px solid ${c.border}`,
                background: c.panel, flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                fontSize: 11, color: c.textDim,
            }
        },
            h('span', null, design.name),
            running && h('span', { style: { color: c.accent } },
                `${ea.running}: ${progress.i}/${progress.total}`),
            result && !running && h('span', null,
                `${result.nTrials} ${ea.trialsDone}, ${result.char}, ${corridorSigma}σ corridor`),
            result && result.trials && result.trials.length > 0 && !running && h('button', {
                onClick: () => setShowTrials(true),
                title: ea.viewTrialsTip || 'Inspect each trial — the per-layer Δd / Δn / Δk applied and whether the spec passed',
                style: {
                    padding: '1px 8px', fontSize: 11, cursor: 'pointer',
                    border: `1px solid ${c.accent}`, borderRadius: 3,
                    background: c.accent + '22', color: c.accent,
                },
            }, ea.viewTrials || 'View trials…'),
            result && result.spec && !running && (() => {
                const sp = result.spec;
                const y = sp.yield;
                const col = y == null ? c.textDim : y >= 0.95 ? c.success : y >= 0.8 ? c.warning : c.error;
                const fails = (sp.perQualifier || [])
                    .filter(q => q.failRate > 0).sort((a, b) => b.failRate - a.failRate);
                const chip = (txt, color, tip, key) => h('span', {
                    key, title: tip,
                    style: {
                        fontSize: 10, fontWeight: 600, color,
                        padding: '1px 6px', borderRadius: 9,
                        background: `${color}1a`, border: `1px solid ${color}55`,
                        whiteSpace: 'nowrap',
                    }
                }, txt);
                return h('span', {
                    style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }
                },
                    h('span', { style: { color: col, fontWeight: 600 } },
                        `${ea.specYield || 'Spec yield'}: ${y == null ? '—' : (y * 100).toFixed(0) + '%'}`),
                    ...fails.map((f, i) => chip(
                        `✗ ${f.label} ${(f.failRate * 100).toFixed(0)}%`, '#ef5350',
                        `${f.label}: fails ${(f.failRate * 100).toFixed(0)}% of trials`, i)),
                    fails.length === 0 && chip(ea.specAllPass || 'all pass', c.success, null, 'allpass'),
                );
            })(),
        ),

        // ── Progress bar (bottom strip) ────────────────────────────────────────
        running && h('div', {
            style: {
                height: 3, background: c.border, flexShrink: 0,
            }
        },
            h('div', {
                style: {
                    height: '100%', background: c.accent,
                    width: progress.total ? `${100 * progress.i / progress.total}%` : '0%',
                    transition: 'width 100ms linear',
                }
            })
        ),

        // ── Per-trial inspector modal ──────────────────────────────────────────
        showTrials && result && result.trials && h(TrialsModal, {
            result, design, c, t, corridorSigma, updateDesign, checkpoint,
            onClose: () => setShowTrials(false),
        })
    );
}
