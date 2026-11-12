import { computeGdGddSpectrum } from './spectrum.js';
import { selectGdGddTargets } from './gdTargets.js';
import { gdGddSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';
import { useLiveDesign } from '../../../../state/useLiveDesign.js';
import { offeredSides } from '../availableSide.js';
import { rowsShown, useEnvironmentChoice } from '../chrome/environmentChoice.js';
import { rangeMaterials } from '../../../../utils/materials/materialRange.js';

const { useMemo } = React;

// The spectrum of each environment shown, `{ env, raw }` with `env` its
// `{ number, label }`, each from the design that environment computes; null
// when the side has no layers or the computation failed.
function computeSpectra(liveDesign, views, options) {
    const layers = options.side === 'back' ? liveDesign?.backLayers : liveDesign?.frontLayers;
    const layerCount = (layers || []).filter(layer => layer.material && layer.thickness > 0).length;
    if (!layerCount) return null;
    try {
        return views.map(view => ({
            env: { number: view.number, label: view.label },
            raw: computeGdGddSpectrum(view.design, options),
        }));
    } catch (error) {
        console.error('GD/GDD computation failed:', error);
        return null;
    }
}

export function useGDGDDState(design) {
    // Following the sampled design keeps a run from driving one full recompute
    // per optimizer progress message; `preview` drops to the coarse grid for
    // the duration, since the curve is being watched rather than read.
    const { design: liveDesign, preview } = useLiveDesign();
    // The environments the Environment droplist names, each seen in the
    // sampled design; environment 1's design is the sampled design itself.
    const environment = useEnvironmentChoice(liveDesign, { overlay: true });
    const { views, every } = environment;
    const [session, setField, patch] = useWindowSession(gdGddSession, design);
    const {
        side, target, quantity, pol, lamStart, lamEnd, theta, refLam, showRef, showTargets,
        showTable, yAuto, yMin, yMax,
    } = session;

    // Computed in the same render as the views they belong to, so the curves,
    // the legend and the table never name different environments.
    const spectra = useMemo(() => computeSpectra(liveDesign, views, {
        side, target, polarization: pol, thetaDeg: theta, preview,
        lambdaStart: Math.min(lamStart, lamEnd), lambdaEnd: Math.max(lamStart, lamEnd),
    }), [liveDesign, views, preview, side, target, pol, lamStart, lamEnd, theta]);
    // The materials the range notice and the shaded bands read: those of the
    // side computed, in every environment shown.
    const materials = useMemo(() => views.flatMap(view => rangeMaterials(view.design, side)), [views, side]);

    // Rebuilt only when the operands or the curve selection change: this array
    // is a chart input, and a fresh one on every render re-plots the whole
    // trace set. The rows are those scored in the environment shown, every row
    // under All.
    const shownRows = useMemo(() => rowsShown(liveDesign, every, views), [liveDesign, every, views]);
    const targets = useMemo(() => selectGdGddTargets(shownRows, {
        side, target, quantity, polarization: pol, thetaDeg: theta,
        surfaceMode: liveDesign?.surfaceMode,
    }), [shownRows, liveDesign?.surfaceMode,
        side, target, quantity, pol, theta]);

    return {
        liveDesign, environment, materials,
        side, setSide: value => setField('side', value), sideOffered: offeredSides(liveDesign || design),
        target, setTarget: value => setField('target', value),
        quantity,
        // Changing quantity changes the unit, so any manual bounds are dropped
        // rather than carried from fs into fs^3.
        setQuantity: value => patch({ quantity: value, yMin: null, yMax: null }),
        pol, setPol: value => setField('pol', value),
        lamStart, setLamStart: value => setField('lamStart', value),
        lamEnd, setLamEnd: value => setField('lamEnd', value),
        theta, setTheta: value => setField('theta', value),
        refLam, setRefLam: value => setField('refLam', value),
        showRef, setShowRef: value => setField('showRef', value),
        targets, showTargets, setShowTargets: value => setField('showTargets', value),
        // The first environment's spectrum, and under All every environment's.
        raw: spectra ? spectra[0].raw : null,
        sets: every ? spectra : null,
        showTable, setShowTable: value => setField('showTable', value),
        yAuto, setYAuto: value => setField('yAuto', value),
        yMin, setYMin: value => setField('yMin', value),
        yMax, setYMax: value => setField('yMax', value),
    };
}
