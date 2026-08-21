import { computeGdGddSpectrum } from './spectrum.js';
import { selectGdGddTargets } from './gdTargets.js';
import { gdGddSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';
import { useLiveDesign } from '../../../../state/useLiveDesign.js';

const { useEffect, useMemo, useState } = React;

export function useGDGDDState(design) {
    // Following the sampled design keeps a run from driving one full recompute
    // per optimizer progress message; `preview` drops to the coarse grid for
    // the duration, since the curve is being watched rather than read.
    const { design: liveDesign, preview } = useLiveDesign();
    const [session, setField, patch] = useWindowSession(gdGddSession, design);
    const [raw, setRaw] = useState(null);
    const {
        side, target, quantity, pol, lamStart, lamEnd, theta, refLam, showRef, showTargets,
        showTable, yAuto, yMin, yMax,
    } = session;

    useEffect(() => {
        const layers = side === 'back' ? liveDesign?.backLayers : liveDesign?.frontLayers;
        const layerCount = (layers || []).filter(layer => layer.material && layer.thickness > 0).length;
        if (!layerCount) {
            setRaw(null);
            return;
        }
        try {
            setRaw(computeGdGddSpectrum(liveDesign, {
                side, target, polarization: pol, thetaDeg: theta, preview,
                lambdaStart: Math.min(lamStart, lamEnd), lambdaEnd: Math.max(lamStart, lamEnd),
            }));
        } catch (error) {
            console.error('GD/GDD computation failed:', error);
            setRaw(null);
        }
    }, [liveDesign, preview, side, target, pol, lamStart, lamEnd, theta]);

    // Rebuilt only when the operands or the curve selection change: this array
    // is a chart input, and a fresh one on every render re-plots the whole
    // trace set.
    const targets = useMemo(() => selectGdGddTargets(liveDesign?.meritOperands, {
        side, target, quantity, polarization: pol, thetaDeg: theta,
        surfaceMode: liveDesign?.surfaceMode,
    }), [liveDesign?.meritOperands, liveDesign?.surfaceMode,
        side, target, quantity, pol, theta]);

    return {
        liveDesign,
        side, setSide: value => setField('side', value),
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
        targets, showTargets, setShowTargets: value => setField('showTargets', value), raw,
        showTable, setShowTable: value => setField('showTable', value),
        yAuto, setYAuto: value => setField('yAuto', value),
        yMin, setYMin: value => setField('yMin', value),
        yMax, setYMax: value => setField('yMax', value),
    };
}
