import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import {
    materialIndexFn, buildPrototypeLayers, coupledMirrors, oddUp, recommendCavities,
} from '../../../../utils/filter/filterDesign.js';
import { presampleForSearch } from '../../../../utils/filter/filterDesignBuild.js';
import { FILTER_WORKER_URL as WORKER_URL } from '../../../../workerUrls.js';
import { couplingD, shapeFactor } from './model.js';
import { CheckField, IntField, StepHeader } from './ui.js';
import { SpectrumPlot } from './SpectrumPlot.js';

const { createElement: h, useState, useMemo, useEffect, useRef, useCallback } = React;

// ── Step 5: Global Integer Search ─────────────────────────────────────────────
// Global-search worker message router (tick / result / error) for step 5.
function handleSearchMessage(m, ctx) {
    const { setCandidates, setStatus, setRunning, workerRef, set, T } = ctx;
    if (m.type === 'tick') { setCandidates(m.candidates); setStatus(T.step5.found(m.candidates.length)); }
    else if (m.type === 'result') { setCandidates(m.candidates); setStatus(T.step5.done(m.candidates.length)); setRunning(false); if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null; } if (m.candidates[0]) set('selected', m.candidates[0]); }
    else if (m.type === 'error') { setStatus('Error: ' + m.message); setRunning(false); }
}

// Spawn the Global Integer Search worker, wire its handlers, and post the job.
function startFilterSearch(ctx) {
    const { p, N, set, T, stop, setCandidates, setStatus, setRunning, workerRef, seedMirrorsVec, seedSpacerVal } = ctx;
    stop();
    setCandidates([]); setStatus(T.step5.running); setRunning(true);
    if (p.selected != null) set('selected', null);   // fresh run clears stale pick
    let worker;
    try { worker = new Worker(WORKER_URL, { type: 'module' }); }
    catch (e) { setStatus('Worker failed: ' + e.message); setRunning(false); return; }
    workerRef.current = worker;
    const win = Math.max(p.stopHalf_nm * 3, p.stopHalf_nm + 6 * p.passHalf_nm);
    const tables = presampleForSearch({ matH: p.matH, matL: p.matL, substrateMaterial: p.substrateMaterial, lamLo: p.lambda0_nm - win, lamHi: p.lambda0_nm + win, step: 0.05 });
    worker.onmessage = (e) => handleSearchMessage(e.data, { setCandidates, setStatus, setRunning, workerRef, set, T });
    worker.onerror = (ev) => { setStatus('Error: ' + (ev.message || 'worker')); setRunning(false); };
    worker.postMessage({
        lambda0: p.lambda0_nm,
        targetParams: { lambda0_nm: p.lambda0_nm, halfPass: p.passHalf_nm, halfStop: p.stopHalf_nm },
        tables,
        search: {
            cavities: N,
            // seed the search from the coupled-cavity prototype (Thelen Eq. 10
            // inner mirrors) — a good flat-top start, not a uniform stack.
            seedMirrors: seedMirrorsVec,
            seedMirror: oddUp(p.seedMirror || 8), seedSpacer: seedSpacerVal,
            spacerKind: p.spacerKind === 'H' ? 'H' : 'L',
            symMirrors: p.symMirrors, symCavities: p.symCavities, restarts: p.restarts,
        },
    });
}

// Engine layers for the step-5 preview: the selected candidate, or (before any
// search) the seed prototype from step 4.
function buildSelectedSearchLayers(ctx) {
    const { p, seedMirrorsVec, seedSpacerVal, N } = ctx;
    const nH = materialIndexFn(p.matH, getMaterialById), nL = materialIndexFn(p.matL, getMaterialById);
    const mirrors = p.selected ? p.selected.mirrors : seedMirrorsVec;
    const spacers = p.selected ? p.selected.spacers : new Array(N).fill(seedSpacerVal);
    return buildPrototypeLayers({ nH, nL, lambda0_nm: p.lambda0_nm, mirrors, spacers, spacerKind: p.spacerKind === 'H' ? 'H' : 'L' });
}

// Step-5 left column: run/stop button, status, symmetry + restart controls.
function renderSearchControls(ctx) {
    const { running, stop, start, status, p, set, c, T } = ctx;
    return h('div', { style: { width: 210, display: 'flex', flexDirection: 'column', gap: 10 } },
        h('button', { onClick: running ? stop : start,
            style: { padding: '10px', fontSize: 14, fontWeight: 600, backgroundColor: running ? (c.warning || '#ef6c00') : c.accent, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' } },
            running ? T.step5.stop : T.step5.start),
        h('div', { style: { fontSize: 11, color: c.textDim, minHeight: 16 } }, status),
        h(CheckField, { label: T.step5.symMirrors, value: p.symMirrors, c, onChange: (v) => set('symMirrors', v) }),
        h(CheckField, { label: T.step5.symCavities, value: p.symCavities, c, onChange: (v) => set('symCavities', v) }),
        h(IntField, { label: T.step5.restarts, value: p.restarts, min: 1, max: 60, c, onChange: (v) => set('restarts', v) }));
}

// Step-5 candidate list: click-to-select MF / N / Th table + empty hint.
function renderCandidateTable(ctx) {
    const { candidates, selKey, set, c, T } = ctx;
    return h('div', { style: { width: 250 } },
        h('div', { style: { maxHeight: 260, overflowY: 'auto', border: `1px solid ${c.border}`, borderRadius: 4 } },
            h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 11.5, color: c.text } },
                h('thead', {}, h('tr', { style: { backgroundColor: c.hover, position: 'sticky', top: 0 } },
                    ['MF', 'N', 'Th'].map((col, i) => h('th', { key: i, style: { textAlign: 'left', padding: '5px 8px', borderBottom: `1px solid ${c.border}`, fontWeight: 600 } }, col)))),
                h('tbody', {}, candidates.map((cd, i) => {
                    const key = cd.mirrors.join(',') + '|' + cd.spacers.join(',');
                    const sel = key === selKey;
                    return h('tr', { key: i, onClick: () => set('selected', cd), style: { cursor: 'pointer', backgroundColor: sel ? c.accent + '33' : 'transparent' } },
                        h('td', { style: { padding: '3px 8px' } }, cd.mf.toFixed(5),
                            cd.isSeed && h('span', { style: { marginLeft: 5, fontSize: 9.5, color: c.accent, fontWeight: 600 } }, T.step5.seedTag || 'seed')),
                        h('td', { style: { padding: '3px 8px', color: c.textDim } }, cd.layers),
                        h('td', { style: { padding: '3px 8px', color: c.textDim } }, cd.thicknessNm.toFixed(0)));
                })))),
        !candidates.length && h('div', { style: { fontSize: 11, color: c.textDim, marginTop: 6 } }, T.step5.empty));
}

// Step-5 embedded-response preview for the selected/seed design.
function renderSearchPreview(ctx) {
    const { selLayersFn, p, c } = ctx;
    return h('div', { style: { flex: 1 } },
        h(SpectrumPlot, { layersFn: selLayersFn, p, mode: 'embedded', c, height: 260 }),
        p.selected && h('div', { style: { fontSize: 11.5, color: c.textDim, marginTop: 4 } },
            `[${p.selected.mirrors.join(' ')}] / [${p.selected.spacers.join(' ')}]  MF=${p.selected.mf.toFixed(5)}  N=${p.selected.layers}`));
}

export function StepSearch({ p, set, c, t }) {
    const T = t.filterDesign;
    const sf = shapeFactor(p);
    const N = p.cavities ?? recommendCavities({ shapeFactor: sf, Tpass: p.passLevel / 100, Tstop: p.stopLevel / 100 }).recommended;
    const [running, setRunning] = useState(false);
    const [candidates, setCandidates] = useState([]);
    const [status, setStatus] = useState('');
    const workerRef = useRef(null);

    const stop = useCallback(() => {
        if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null; }
        setRunning(false);
    }, []);
    useEffect(() => () => stop(), [stop]); // cleanup on unmount

    // The coupled seed prototype (the step-4 design) — also the search seed.
    const seedMirrorsVec = useMemo(() => coupledMirrors(N, p.seedMirror || 8, couplingD(p)),
        [N, p.seedMirror, p.matH, p.matL, p.substrateMaterial, p.lambda0_nm]); // eslint-disable-line
    const seedSpacerVal = p.seedSpacer || 1;
    // Signature of every design-defining input. When it changes, drop stale
    // candidates + selection so step 5 never shows a plot from a PREVIOUS filter.
    const seedKey = `${N}|${seedMirrorsVec.join(',')}|${seedSpacerVal}|${p.spacerKind}|${p.matH}|${p.matL}|${p.substrateMaterial}|${p.lambda0_nm}|${p.passHalf_nm}|${p.stopHalf_nm}`;
    useEffect(() => {
        stop();
        setCandidates([]); setStatus('');
        if (p.selected != null) set('selected', null);
    }, [seedKey]); // eslint-disable-line

    const start = useCallback(() => startFilterSearch({ p, N, set, T, stop, setCandidates, setStatus, setRunning, workerRef, seedMirrorsVec, seedSpacerVal }),
        [p, N, stop, set, T]); // eslint-disable-line

    const selKey = p.selected ? p.selected.mirrors.join(',') + '|' + p.selected.spacers.join(',') : null;
    // Preview the selected candidate; before any search, show the SEED prototype
    // (the step-4 design) — never a stale plot from a previous filter.
    const selLayersFn = useCallback(() => buildSelectedSearchLayers({ p, seedMirrorsVec, seedSpacerVal, N }),
        [p.selected, seedMirrorsVec, seedSpacerVal, N, p.matH, p.matL, p.lambda0_nm, p.spacerKind]);

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h(StepHeader, { step: 5, title: T.step5.title, c }),
        h('div', { style: { display: 'flex', gap: 16 } },
            renderSearchControls({ running, stop, start, status, p, set, c, T }),
            renderCandidateTable({ candidates, selKey, set, c, T }),
            renderSearchPreview({ selLayersFn, p, c })));
}
