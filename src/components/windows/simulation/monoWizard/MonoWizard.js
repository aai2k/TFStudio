/**
 * Monochromatic Monitoring Wizard — 6-page modal wizard.
 *
 * The monochromatic counterpart of BBMWizard. The broadband and
 * monochromatic monitoring simulators are nearly identical experiments that
 * differ only in the cut rule, so this wizard intentionally reuses BBMWizard's
 * structure and visual style; only the Monitoring-System page and the run
 * engine differ:
 *
 *   Page 1  Deposition Rates       — per-material mean / RMS / correlation time
 *   Page 2  Parameters Deviation   — per-material index deviations, layers
 *                                     excluded from monitoring, shutter delay
 *   Page 3  Monitoring System      — measured quantity + AOI + scan interval,
 *                                     and a PER-LAYER table of monitoring
 *                                     wavelength + termination strategy
 *                                     (turning point / level / by time);
 *                                     ideal single-λ signal-vs-thickness preview
 *   Page 4  Signal Errors          — random noise + drift; noisy single-λ preview
 *   Page 5  Deposition Simulation  — ONE computational-manufacturing run, played
 *                                     back layer-by-layer with E/A/T bars + spectrum
 *   Page 6  Resulting Performance  — manufactured vs theory + error / thk / RI tables
 *
 * Engine: utils/monoSim.js `simulateRunMono` (single-wavelength turning/level/
 * time cut), which mirrors monitoringSim.simulateRun's cfg + return shape, so
 * pages 1/2/4/5/6 are shared with BBM. Spectra go through
 * depositionSpectrum.frontStackSpectrum → thinFilmMath, the validated path.
 *
 * Reference: Macleod, Thin-Film Optical Filters 5th ed., Ch. 12;
 *            Tikhonravov & Trubetskov, Appl. Opt. 44, 6877 (2005).
 */

import { useDesign }         from '../../../../state/DesignContext.js';
import { defaultMonoTable }  from '../../../../utils/monitoring/monoSim.js';
import { useWizardShell }    from '../wizardKit/useWizardShell.js';
import { ModalFrame }        from '../wizardKit/ModalFrame.js';
import { PageDeviations }    from '../wizardKit/PageDeviations.js';
import { PageResults }       from '../wizardKit/PageResults.js';
import { PageHead, resolveMat } from '../wizardShared.js';
import { PageRates }         from './PageRates.js';
import { PageMonoSystem }    from './PageMonoSystem.js';
import { PageSignalErrors }  from './PageSignalErrors.js';
import { PageSimulation }    from './PageSimulation.js';

const { createElement: h, useState, useEffect, useCallback } = React;

function makeInitialMonoState() {
    return {
        rates: {}, matDev: {}, layers: [], monTable: [],
        selMat: null, rateNonce: 0, rateYAt0: true,
        shutterMean: 0, shutterRms: 0,
        quantity: 'T', pol: 'avg', aoi: 0, scanInterval: 1.0, confirmScans: 2,
        lamMin: 400, lamMax: 800,                 // display band (spectrum pages)
        previewLayer: 1, monNonce: 0, sigNonce: 0,
        randomPct: 0.3, drift: 0, driftMeanTime: 5, driftRms: 1, yFixed: true,
        timeMult: 10, resultTab: 'spectral', seed: 0x300FCAFE,
    };
}

// Seed per-material rate/deviation state, per-layer exclude state and the
// per-layer monitor table from the design once it's known.
function seedWizardState(prev, { materialIds, layers, simDesign, ds, de }) {
    const rates = { ...prev.rates }, matDev = { ...prev.matDev };
    for (const id of materialIds) {
        if (!rates[id]) rates[id] = { meanA: 4, rmsA: 0.4, corr: 3 };
        if (!matDev[id]) matDev[id] = { reNSyst: 0, reNRand: 0, systInh: 0 };
    }
    const lyr = layers.map((l, i) => prev.layers[i] || { exclude: false, relThkErr: 0 });
    let monTable = prev.monTable;
    if (!monTable || monTable.length !== layers.length) {
        // Default to the design reference wavelength + turning where the
        // layer is ~quarter-wave (classic single-λ monitoring). The
        // "Auto λ" button re-picks the most-sensitive λ per layer.
        monTable = defaultMonoTable(simDesign, resolveMat, {
            autoPickLambda: false, theta: prev.aoi, pol: prev.pol, char: prev.quantity,
        });
    }
    return {
        ...prev, rates, matDev, layers: lyr, monTable,
        selMat: prev.selMat || materialIds[0] || null,
        lamMin: prev._bandInit ? prev.lamMin : (ds ?? prev.lamMin),
        lamMax: prev._bandInit ? prev.lamMax : (de ?? prev.lamMax),
        _bandInit: true,
    };
}

function useSeedMonoState({ setP, design, simDesign, layers, materialIds }) {
    useEffect(() => {
        if (!design) return;
        // Initial display band from the design's spectrum range when available.
        const ds = Number.isFinite(design.spectrumLambdaStart) ? design.spectrumLambdaStart : null;
        const de = Number.isFinite(design.spectrumLambdaEnd) ? design.spectrumLambdaEnd : null;
        setP(prev => seedWizardState(prev, { materialIds, layers, simDesign, ds, de }));
    }, [materialIds, layers, design, simDesign]);
}

function useCloseOnEscape(onClose) {
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);
}

function buildRunCfg(p, materialIds) {
    const rates = new Map();
    for (const id of materialIds) {
        const r = p.rates[id] || { meanA: 4, rmsA: 0.4, corr: 3 };
        rates.set(id, { mean: r.meanA / 10, sigma: r.rmsA / 10, corrTime: r.corr });   // Å/s → nm/s
    }
    const matDev = new Map();
    for (const id of materialIds) {
        const d = p.matDev[id] || {};
        matDev.set(id, { reNSyst: d.reNSyst || 0, reNRand: d.reNRand || 0, systInh: d.systInh || 0 });
    }
    const excludeLayers = new Set();
    const relThkErrByLayer = [];
    p.layers.forEach((l, i) => { if (l?.exclude) excludeLayers.add(i); relThkErrByLayer[i] = l?.relThkErr || 0; });
    const monTable = (p.monTable || []).map(m => ({
        lambda: m.lambda, strategy: m.strategy || 'turning', order: m.order || 1, sigmaRelPct: m.sigmaRelPct || 0,
    }));
    return {
        _seed: p.seed >>> 0,
        rates, matDev, perMaterial: true,
        shutterDelayMeanS: p.shutterMean, shutterDelayRmsS: p.shutterRms,
        excludeLayers, relThkErrByLayer,
        monTable,
        mon: { char: p.quantity, theta: p.aoi, polarization: p.pol, scanIntervalSec: p.scanInterval, confirmScans: Math.max(1, p.confirmScans | 0) },
        sig: { randomPct: p.randomPct, driftPctPer1000s: p.drift },
        recordTrajectory: true,
    };
}

function emptyBody(c, message) {
    return h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.textDim } }, message);
}

function buildWizardBody({ step, p, set, materialIds, layers, c, B, ctx, design, run, setRun, buildCfg }) {
    const pages = {
        1: () => h(PageRates,        { p, set, materialIds, c, B }),
        2: () => h(PageDeviations,   { p, set, materialIds, layers, c, B }),
        3: () => h(PageMonoSystem,   { p, set, layers, c, B, ctx, design }),
        4: () => h(PageSignalErrors, { p, set, layers, c, B, ctx, design }),
        5: () => h(PageSimulation,   { p, set, layers, c, B, ctx, run, setRun, buildCfg }),
        6: () => h(PageResults,      { p, set, layers, c, B, ctx, run }),
    };
    const titles = [B.p1Title, B.p2Title, B.p3Title, B.p4Title, B.p5Title, B.p6Title];
    const subs   = [B.p1Sub, B.p2Sub, B.p3Sub, B.p4Sub, B.p5Sub, B.p6Sub];
    return h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
        h(PageHead, { title: titles[step - 1], subtitle: subs[step - 1], c }),
        pages[step]());
}

export function MonoWizard({ c, t, onClose }) {
    const B = t.monoSim;
    const { design } = useDesign();
    const [step, setStep] = useState(1);
    const [run, setRun] = useState(null);

    const { simDesign, layers, materialIds, ctx } = useWizardShell(design);

    const [p, setP] = useState(makeInitialMonoState);
    const set = useCallback((key, val) => setP(prev => ({ ...prev, [key]: val })), []);

    useSeedMonoState({ setP, design, simDesign, layers, materialIds });
    useCloseOnEscape(onClose);

    const buildCfg = useCallback(() => buildRunCfg(p, materialIds), [p, materialIds]);

    if (!design) return h(ModalFrame, { c, B, step, setStep, onClose, design, t, helpAnchor: 'simulation/mono-simulator', body: emptyBody(c, B.noDesign) });
    if (!layers.length) return h(ModalFrame, { c, B, step, setStep, onClose, design, t, helpAnchor: 'simulation/mono-simulator', body: emptyBody(c, B.noLayers) });

    const body = buildWizardBody({ step, p, set, materialIds, layers, c, B, ctx, design, run, setRun, buildCfg });

    return h(ModalFrame, { c, B, step, setStep, onClose, design, t, helpAnchor: 'simulation/mono-simulator', body });
}
