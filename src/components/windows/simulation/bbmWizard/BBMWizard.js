/**
 * Broadband Monitoring Wizard — 6-page modal wizard.
 *
 * Replaces the old docked BBMSimulator window. A "Broadband Monitoring
 * Simulation" 6-step dialog presented as a modal in the same visual style as
 * the Filter Design Wizard:
 *
 *   Page 1  Deposition Rates       — per-material mean / RMS / correlation time
 *                                     (OU process), live rate-vs-time preview
 *   Page 2  Parameters Deviation   — per-material Re(n) syst/random dev + syst
 *                                     inhomogeneity; exclude layers from
 *                                     monitoring (+ rel. thickness error);
 *                                     shutter delay mean + RMS
 *   Page 3  Monitoring System      — quantity (T/R) + pol, AOI, scan interval,
 *                                     band (λ min/max, points); ideal per-layer
 *                                     monitoring-signal preview (layer tabs)
 *   Page 4  Signal Errors          — random noise %, drift; noisy signal preview
 *   Page 5  Deposition Simulation  — ONE computational-manufacturing run, played
 *                                     back layer-by-layer with E/A/T bars and a
 *                                     live spectrum (theory + 80/90% + actual)
 *   Page 6  Resulting Performance  — manufactured vs theory spectrum + relative
 *                                     / absolute error bars + thickness & RI tables
 *
 * The single-run experiment, OU correlated rates, shutter delay, per-material
 * deviations and exclude-layers all live in utils/monitoringSim.js
 * (`simulateRun`, `sampleOURatePath`, `makeShiftedMaterial`). Spectra go through
 * utils/depositionSpectrum.js (`frontStackSpectrum`) → thinFilmMath
 * `evaluateSpectrumTotal`, the same validated path the Process Simulator uses.
 *
 * Reference: Tikhonravov & Trubetskov, Appl. Opt. 44, 6877 (2005);
 *            Macleod, Thin-Film Optical Filters, 5th ed., Ch. 12.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { useWizardShell } from '../wizardKit/useWizardShell.js';
import { ModalFrame } from '../wizardKit/ModalFrame.js';
import { PageDeviations } from '../wizardKit/PageDeviations.js';
import { PageResults } from '../wizardKit/PageResults.js';
import { mulberry32 } from '../../../../utils/monitoring/monitoringSim.js';
import { resolveMat, medId, PageHead } from '../wizardShared.js';
import { PageRates } from './PageRates.js';
import { PageMonSystem } from './PageMonSystem.js';
import { PageSignalErrors } from './PageSignalErrors.js';
import { PageSimulation } from './PageSimulation.js';

const { createElement: h, useState, useEffect, useCallback } = React;

// Seed per-material + per-layer wizard state from the design once it's known.
function seedWizardParams(prev, materialIds, layers) {
    const rates = { ...prev.rates }, matDev = { ...prev.matDev };
    for (const id of materialIds) {
        if (!rates[id]) rates[id] = { meanA: 4, rmsA: 0.4, corr: 3 };
        if (!matDev[id]) matDev[id] = { reNSyst: 0, reNRand: 0, systInh: 0 };
    }
    const lyr = layers.map((l, i) => prev.layers[i] || { exclude: false, relThkErr: 0 });
    return { ...prev, rates, matDev, layers: lyr, selMat: prev.selMat || materialIds[0] || null };
}

// Closes the wizard on Escape, mirroring the other modal windows.
function useEscapeToClose(onClose) {
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);
}

// Builds the simulateRun cfg from the wizard params (Å→nm: rate/10).
function buildRunCfg({ p, materialIds, recordTrajectory }) {
    const rates = new Map();
    for (const id of materialIds) {
        const r = p.rates[id] || { meanA: 4, rmsA: 0.4, corr: 3 };
        rates.set(id, { mean: r.meanA / 10, sigma: r.rmsA / 10, corrTime: r.corr });
    }
    const matDev = new Map();
    for (const id of materialIds) {
        const d = p.matDev[id] || {};
        matDev.set(id, { reNSyst: d.reNSyst || 0, reNRand: d.reNRand || 0, systInh: d.systInh || 0 });
    }
    const excludeLayers = new Set();
    const relThkErrByLayer = [];
    p.layers.forEach((l, i) => { if (l?.exclude) excludeLayers.add(i); relThkErrByLayer[i] = l?.relThkErr || 0; });
    return {
        _seed: p.seed >>> 0,
        rng: mulberry32(p.seed),
        rates, matDev, perMaterial: true,
        shutterDelayMeanS: p.shutterMean, shutterDelayRmsS: p.shutterRms,
        excludeLayers, relThkErrByLayer,
        mon: { char: p.quantity, theta: p.aoi, polarization: p.pol,
               lambdaStart: p.lamMin, lambdaEnd: p.lamMax, nPoints: p.points, scanIntervalSec: p.scanInterval, confirmScans: 2 },
        sig: { randomPct: p.randomPct, driftPctPer1000s: p.drift },
        // Cheaper fit for the live single run (Monte-Carlo path is untouched).
        fitStartFrac: 0.82, fitMaxIter: 8,
        recordTrajectory,
    };
}

// Pre-samples every referenced material's [n,k] on the monitor scan λ grid so
// the run can execute in a Web Worker (Approach A). simulateRun only samples
// on this grid, so the worker result matches the main-thread path.
function presampleMaterialsFor({ design, simDesign, materialIds, p }) {
    const nP = Math.max(3, p.points | 0);
    const step = (p.lamMax - p.lamMin) / (nP - 1);
    const scanL = []; for (let i = 0; i < nP; i++) scanL.push(p.lamMin + i * step);
    // Incident medium of the active run (the exit medium in back mode).
    const incId = medId(simDesign.incidentMedium);
    const subId = design.substrate?.material ?? 'BK7';
    const ids = new Set([incId, subId]); for (const id of materialIds) ids.add(id);
    const materials = {};
    for (const id of ids) {
        const m = resolveMat(id); const n = [], k = [];
        for (const lam of scanL) { const nk = m.getNK(lam); n.push(nk[0]); k.push(nk[1]); }
        materials[id] = { lambdas: scanL.slice(), n, k };
    }
    return materials;
}

export function BBMWizard({ c, t, onClose }) {
    const B = t.bbmSim;
    const { design } = useDesign();
    const [step, setStep] = useState(1);
    const [run, setRun] = useState(null);   // captured single-experiment trajectory

    const { simDesign, layers, materialIds, ctx } = useWizardShell(design);

    const [p, setP] = useState(() => ({
        rates: {}, matDev: {}, layers: [],
        selMat: null, rateNonce: 0, rateYAt0: true,
        shutterMean: 0, shutterRms: 0,
        // scanInterval/points kept modest: the monitoring fit runs a TMM sweep
        // per scan per golden-section step, so 30 pts @ 3 s scans makes a full
        // run finish in ~1 s instead of stalling for many seconds.
        quantity: 'T', pol: 'avg', aoi: 0, scanInterval: 3.0, lamMin: 400, lamMax: 800, points: 30,
        previewLayer: 1, monNonce: 0, sigNonce: 0,
        randomPct: 0.3, drift: 0, driftMeanTime: 5, driftRms: 1, yFixed: true,
        timeMult: 10, resultTab: 'spectral', seed: 0xBBADCAFE,
    }));
    const set = useCallback((key, val) => setP(prev => ({ ...prev, [key]: val })), []);

    // Seed per-material + per-layer state from the design once it's known.
    useEffect(() => { setP(prev => seedWizardParams(prev, materialIds, layers)); }, [materialIds, layers]);

    useEscapeToClose(onClose);

    const buildCfg = useCallback((recordTrajectory) => buildRunCfg({ p, materialIds, recordTrajectory }), [p, materialIds]);
    const presampleMaterials = useCallback(() => presampleMaterialsFor({ design, simDesign, materialIds, p }),
        [design, simDesign, materialIds, p.points, p.lamMin, p.lamMax]);

    if (!design) return h(ModalFrame, { c, B, step, setStep, onClose, design, t, helpAnchor: 'simulation/bbm-simulator',
        body: h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.textDim } }, B.noDesign) });
    if (!layers.length) return h(ModalFrame, { c, B, step, setStep, onClose, design, t, helpAnchor: 'simulation/bbm-simulator',
        body: h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.textDim } }, B.noLayers) });

    const pages = {
        1: () => h(PageRates,        { p, set, materialIds, c, B }),
        2: () => h(PageDeviations,   { p, set, materialIds, layers, c, B }),
        3: () => h(PageMonSystem,    { p, set, layers, c, B, ctx }),
        4: () => h(PageSignalErrors, { p, set, layers, c, B, ctx }),
        5: () => h(PageSimulation,   { p, set, layers, c, B, ctx, run, setRun, buildCfg, presampleMaterials }),
        6: () => h(PageResults,      { p, set, layers, c, B, ctx, run, showDeferredActions: true }),
    };

    const titles = [B.p1Title, B.p2Title, B.p3Title, B.p4Title, B.p5Title, B.p6Title];
    const subs   = [B.p1Sub, B.p2Sub, B.p3Sub, B.p4Sub, B.p5Sub, B.p6Sub];

    const body = h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
        h(PageHead, { title: titles[step - 1], subtitle: subs[step - 1], c }),
        pages[step]());

    return h(ModalFrame, { c, B, step, setStep, onClose, design, t, helpAnchor: 'simulation/bbm-simulator', body });
}
