import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import {
    materialIndexFn, buildPrototypeLayers, coupledMirrors, recommendCavities,
    targetSpan, deriveSeed, hashSeed, angleWindowLow, invariantOf,
    buildFilterTarget, designReference,
} from '../../../../utils/filter/filterDesign.js';
import { presampleForSearch } from '../../../../utils/filter/filterDesignBuild.js';
import { getTmmWasmBytesForWorker } from '../../../../tmmcore.js';
import { FILTER_WORKER_URL as WORKER_URL } from '../../../../workerUrls.js';
import {
    candidateKey, couplingD, embeddedAoi, heldAoi, mergeCandidates, prototypeCandidate,
    searchTargetParams, shapeFactor, targetPointsOf, workingAoi,
} from './model.js';
import { AxisToggle, CheckField, IntField, NumField, StepHeader } from './ui.js';
import { SpectrumPlot } from './SpectrumPlot.js';

const { createElement: h, useState, useMemo, useEffect, useRef, useCallback } = React;

// ── Step 5: Global Integer Search ─────────────────────────────────────────────
// Global-search worker message router (tick / result / error) for step 5.
function handleSearchMessage(m, ctx) {
    const { applyRun, setStatus, setRunning, setIteration, workerRef, set, T } = ctx;
    if (m.type === 'tick') {
        setIteration(m.iteration || 0);
        setStatus(T.step5.found(applyRun(m.candidates).length));
    } else if (m.type === 'result') {
        const merged = applyRun(m.candidates);
        setStatus(T.step5.done(merged.length));
        setRunning(false);
        if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null; }
        if (merged[0]) set('selected', merged[0]);
    } else if (m.type === 'error') {
        setStatus('Error: ' + m.message); setRunning(false);
    }
}

// Wavelength range the worker needs the materials sampled on. The target reaches
// no further than 2·halfStop from λ₀; a design scored at an angle is asked for at
// shorter wavelengths too, as far down as its band moves at the largest angle
// scored, which is the working angle plus whatever the passband is held over.
function sampleWindow(p) {
    const win = targetSpan(p.passHalf_nm, p.stopHalf_nm) + 0.05;
    let lamLo = p.lambda0_nm - win;
    const widest = heldAoi(p);
    if (widest > 0) {
        const nAt = (id) => materialIndexFn(id, getMaterialById)(p.lambda0_nm)[0];
        const nLow = Math.min(nAt(p.matH), nAt(p.matL));
        lamLo = Math.min(lamLo, angleWindowLow({
            lambda0_nm: p.lambda0_nm, kappa: invariantOf(widest, nAt(p.incidentMedium)),
            nLow, halfPass: p.passHalf_nm, halfStop: p.stopHalf_nm,
        }) - 0.05);
    }
    return { lamLo, lamHi: p.lambda0_nm + win };
}

// Spawn the Global Integer Search worker, wire its handlers, and post the job.
function startFilterSearch(ctx) {
    const { p, N, set, T, stop, clearHistory, setStatus, setRunning, workerRef, seedMirrorsVec, seedSpacerVal, runRef, seedKey } = ctx;
    stop();
    if (p.clearHistoryOnStart) clearHistory();
    setStatus(T.step5.running); setRunning(true);
    const run = (runRef.current += 1);
    set('searchRun', run);
    // A fresh run drops a stale pick back to the step-4 prototype, which is
    // always buildable, rather than to nothing.
    set('selected', prototypeCandidate(p, N, p.seedMirror || 8, seedSpacerVal));
    let worker;
    try { worker = new Worker(WORKER_URL, { type: 'module' }); }
    catch (e) { setStatus('Worker failed: ' + e.message); setRunning(false); return; }
    workerRef.current = worker;
    // The search runs the TMM tens of millions of times, so hand the worker the
    // kernel the GUI is using rather than leaving it on the JS fallback.
    const wasmBytes = getTmmWasmBytesForWorker();
    if (wasmBytes) worker.postMessage({ type: 'wasmInit', wasmBytes });
    const tables = presampleForSearch({ matH: p.matH, matL: p.matL, substrateMaterial: p.substrateMaterial, ...sampleWindow(p), step: 0.05 });
    worker.onmessage = (e) => handleSearchMessage(e.data, ctx);
    worker.onerror = (ev) => { setStatus('Error: ' + (ev.message || 'worker')); setRunning(false); };
    worker.postMessage({
        lambda0: p.lambda0_nm,
        // The step-1 angle is an angle at the finished filter, while steps 1 to 5
        // evaluate it embedded in its substrate, so it is converted before it
        // gets here (45° in air is 27.8° in BK7). The target wavelengths stay put:
        // the merit moves the band onto them per design, and the build stretches
        // the reference afterwards so the band sits at λ₀ at that angle.
        targetParams: searchTargetParams(p),
        tables,
        search: {
            cavities: N,
            // seed the search from the coupled-cavity prototype (Thelen Eq. 10
            // inner mirrors) — a good flat-top start, not a uniform stack.
            seedMirrors: seedMirrorsVec,
            seedMirror: p.seedMirror || 8, seedSpacer: seedSpacerVal,
            symMirrors: p.symMirrors, symCavities: p.symCavities, restarts: p.restarts,
            // Seeded from the specification and the run number, so the same
            // design always gives the same answer and a second Start still
            // looks somewhere new.
            rngSeed: deriveSeed(hashSeed(seedKey), run),
        },
    });
}

// Engine layers for the step-5 preview: the selected candidate, or (before any
// search) the seed prototype from step 4.
//
// The search builds every candidate at λ₀ and moves the target onto its band
// instead, which off normal incidence sits tens of nanometres lower. The preview
// is drawn at the angle the filter will be used at, so it builds at the stretched
// reference the design will actually be deposited at and the band appears where
// the user is asking for it.
function buildSelectedSearchLayers(ctx) {
    const { p, seedMirrorsVec, seedSpacerVal, N } = ctx;
    const nH = materialIndexFn(p.matH, getMaterialById), nL = materialIndexFn(p.matL, getMaterialById);
    const nSub = materialIndexFn(p.substrateMaterial, getMaterialById);
    const mirrors = p.selected ? p.selected.mirrors : seedMirrorsVec;
    const spacers = p.selected ? p.selected.spacers : new Array(N).fill(seedSpacerVal);
    const buildAt = (reference_nm) => buildPrototypeLayers({ nH, nL, lambda0_nm: reference_nm, mirrors, spacers });
    const target = buildFilterTarget(searchTargetParams(p));
    return buildAt(designReference({ buildAt, target, nSub }));
}

// Step-5 left column: run/stop, status, history controls, search options.
function renderSearchControls(ctx) {
    const { running, stop, start, status, clearHistory, p, set, c, T } = ctx;
    const flatButton = { padding: '5px 10px', fontSize: 12, backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 4, cursor: 'pointer' };
    return h('div', { style: { width: 210, display: 'flex', flexDirection: 'column', gap: 10 } },
        h('button', { onClick: running ? stop : start,
            style: { padding: '10px', fontSize: 14, fontWeight: 600, backgroundColor: running ? (c.warning || '#ef6c00') : c.accent, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' } },
            running ? T.step5.stop : T.step5.start),
        h('div', { style: { fontSize: 11, color: c.textDim, minHeight: 16 } }, status),
        h(CheckField, { label: T.step5.clearOnStart, value: p.clearHistoryOnStart, c, onChange: (v) => set('clearHistoryOnStart', v) }),
        h('button', { onClick: clearHistory, style: flatButton }, T.step5.clearHistory),
        h(CheckField, { label: T.step5.symMirrors, value: p.symMirrors, c, onChange: (v) => set('symMirrors', v) }),
        h(CheckField, { label: T.step5.symCavities, value: p.symCavities, c, onChange: (v) => set('symCavities', v) }),
        h(IntField, { label: T.step5.restarts, value: p.restarts, min: 1, max: 60, c, onChange: (v) => set('restarts', v) }),
        h(NumField, { label: T.step5.holdPassband, value: p.holdPassbandDeg, min: 0, max: 80, step: 1, suffix: '°', width: 70, c,
            hint: T.step5.holdPassbandHint, onChange: (v) => set('holdPassbandDeg', Math.max(0, v)) }));
}

// One row of the candidate table. With the passband held over an extra angle the
// merit is shown as its two parts, at the working angle and at the held one; the
// list stays sorted on the pooled figure the search minimised.
function renderCandidateRow(cd, i, { selKey, set, c, T, held }) {
    const cell = (text, dim) => h('td', { style: { padding: '3px 8px', color: dim ? c.textDim : undefined } }, text);
    const seedTag = cd.isSeed && h('span', { style: { marginLeft: 5, fontSize: 9.5, color: c.accent, fontWeight: 600 } }, T.step5.seedTag || 'seed');
    const mf = held
        ? [h('td', { style: { padding: '3px 8px' } }, (cd.mf0 ?? cd.mf).toFixed(5), seedTag), cell(cd.mfTilt != null ? cd.mfTilt.toFixed(5) : '')]
        : [h('td', { style: { padding: '3px 8px' } }, cd.mf.toFixed(5), seedTag)];
    const sel = candidateKey(cd) === selKey;
    return h('tr', { key: i, onClick: () => set('selected', cd), style: { cursor: 'pointer', backgroundColor: sel ? c.accent + '33' : 'transparent' } },
        ...mf, cell(cd.layers, true), cell(cd.thicknessNm.toFixed(0), true));
}

// Step-5 candidate history: click-to-select MF / N / TT table + empty hint.
// The merit columns are labelled with the angles in the incident medium, the
// angles the user typed, not the substrate angles the engine scores at.
function renderCandidateTable(ctx) {
    const { candidates, c, T, held, working } = ctx;
    const cols = held ? [`MF ${working}°`, `MF ${held}°`, 'N', 'TT, nm'] : ['MF', 'N', 'TT, nm'];
    return h('div', { style: { width: held ? 310 : 250 } },
        h('div', { style: { maxHeight: 300, overflowY: 'auto', border: `1px solid ${c.border}`, borderRadius: 4 } },
            h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 11.5, color: c.text } },
                h('thead', {}, h('tr', { style: { backgroundColor: c.hover, position: 'sticky', top: 0 } },
                    cols.map((col, i) => h('th', { key: i, style: { textAlign: 'left', padding: '5px 8px', borderBottom: `1px solid ${c.border}`, fontWeight: 600 } }, col)))),
                h('tbody', {}, candidates.map((cd, i) => renderCandidateRow(cd, i, ctx))))),
        !candidates.length && h('div', { style: { fontSize: 11, color: c.textDim, marginTop: 6 } }, T.step5.empty));
}

// Step-5 embedded-response preview for the selected/seed design.
function renderSearchPreview(ctx) {
    const { selLayersFn, targetPoints, iteration, p, set, c, t, T } = ctx;
    return h('div', { style: { flex: 1 } },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
            h('div', { style: { fontSize: 11, color: c.textDim } }, `${T.step5.iteration}: ${iteration}`),
            h(AxisToggle, { value: p.logAxis, onChange: (v) => set('logAxis', v), c, t })),
        h(SpectrumPlot, { layersFn: selLayersFn, p, mode: 'embedded', c, height: 260, logAxis: p.logAxis, targetPoints,
            aoi: embeddedAoi(p, workingAoi(p)), pol: p.pol }),
        p.selected && h('div', { style: { fontSize: 11.5, color: c.textDim, marginTop: 4 } },
            `[${p.selected.mirrors.join(' ')}] / [${p.selected.spacers.join(' ')}]` +
            (p.selected.mf != null ? `  MF=${p.selected.mf.toFixed(5)}` : '') +
            `  N=${p.selected.layers}`));
}

export function StepSearch({ p, set, c, t }) {
    const T = t.filterDesign;
    const sf = shapeFactor(p);
    const N = p.cavities ?? recommendCavities({ shapeFactor: sf, Tpass: p.passLevel / 100, Tstop: p.stopLevel / 100 }).recommended;
    const [running, setRunning] = useState(false);
    const [status, setStatus] = useState('');
    const [iteration, setIteration] = useState(0);
    const workerRef = useRef(null);
    // The history and the run counter are kept in the wizard state so they
    // survive leaving step 5; the refs mirror them so the worker's message
    // handler can merge into the list without reading a stale closure.
    const candidates = p.candidateHistory || [];
    const historyRef = useRef(candidates);
    const runRef = useRef(p.searchRun || 0);

    const stop = useCallback(() => {
        if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null; }
        setRunning(false);
    }, []);
    useEffect(() => () => stop(), [stop]); // cleanup on unmount

    const clearHistory = useCallback(() => {
        historyRef.current = []; set('candidateHistory', []); setIteration(0);
    }, [set]);
    const applyRun = useCallback((incoming) => {
        historyRef.current = mergeCandidates(historyRef.current, incoming);
        set('candidateHistory', historyRef.current);
        return historyRef.current;
    }, [set]);

    // The coupled seed prototype (the step-4 design) — also the search seed.
    const seedMirrorsVec = useMemo(() => coupledMirrors(N, p.seedMirror || 8, couplingD(p)),
        [N, p.seedMirror, p.matH, p.matL, p.substrateMaterial, p.lambda0_nm]); // eslint-disable-line
    const seedSpacerVal = p.seedSpacer || 1;
    // Signature of every design-defining input, the specification the merit is
    // built from included. When it changes the history is for a DIFFERENT
    // filter, so it goes whatever the checkbox says.
    const seedKey = `${N}|${seedMirrorsVec.join(',')}|${seedSpacerVal}|${p.matH}|${p.matL}|${p.substrateMaterial}`
        + `|${p.lambda0_nm}|${p.passHalf_nm}|${p.stopHalf_nm}|${p.passLevel}`
        + `|${workingAoi(p)}|${p.pol}|${p.holdPassbandDeg}`;
    // The history records which filter it is for, so only an actual CHANGE
    // resets. Stepping away and back remounts this component, and a reset on
    // mount would throw away the candidate the user picked here and leave
    // Finish quietly building the step-4 prototype. The key lives beside the
    // history rather than in a ref because the change can happen on another
    // step, while this one is unmounted.
    useEffect(() => {
        if (p.historyKey === seedKey) return;
        stop(); clearHistory(); setStatus('');
        runRef.current = 0; set('searchRun', 0); set('historyKey', seedKey);
        set('selected', prototypeCandidate(p, N, p.seedMirror || 8, seedSpacerVal));
    }, [seedKey]); // eslint-disable-line

    const start = useCallback(() => startFilterSearch({
        p, N, set, T, stop, clearHistory, applyRun, setStatus, setRunning, setIteration,
        workerRef, seedMirrorsVec, seedSpacerVal, runRef, seedKey,
    }), [p, N, stop, set, T, clearHistory, applyRun, seedKey]); // eslint-disable-line

    const selKey = p.selected ? candidateKey(p.selected) : null;
    // Preview the selected candidate; before any search, show the SEED prototype
    // (the step-4 design) — never a stale plot from a previous filter.
    const selLayersFn = useCallback(() => buildSelectedSearchLayers({ p, seedMirrorsVec, seedSpacerVal, N }),
        [p.selected, seedMirrorsVec, seedSpacerVal, N, p.matH, p.matL, p.substrateMaterial, p.lambda0_nm,
            p.passHalf_nm, p.stopHalf_nm, p.oblique, p.aoi, p.pol, p.holdPassbandDeg]);
    const targetPoints = useMemo(() => targetPointsOf(p),
        [p.lambda0_nm, p.passHalf_nm, p.stopHalf_nm, p.passLevel]); // eslint-disable-line

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h(StepHeader, { step: 5, title: T.step5.title, c }),
        h('div', { style: { display: 'flex', gap: 16 } },
            renderSearchControls({ running, stop, start, status, clearHistory, p, set, c, T }),
            renderCandidateTable({
                candidates, selKey, set, c, T,
                working: workingAoi(p), held: heldAoi(p) > workingAoi(p) ? heldAoi(p) : 0,
            }),
            renderSearchPreview({ selLayersFn, targetPoints, iteration, p, set, c, t, T })));
}
