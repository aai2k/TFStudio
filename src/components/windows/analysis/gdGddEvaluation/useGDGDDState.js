import { computeGdGddSpectrum } from './spectrum.js';
import { selectGdGddTargets } from './gdTargets.js';
import { readGDGDDSession, writeGDGDDSession } from './sessionState.js';

const { useEffect, useState } = React;

export function useGDGDDState(design) {
    const [session, setSession] = useState(() => readGDGDDSession(design));
    const [raw, setRaw] = useState(null);
    const {
        side, target, quantity, pol, lamStart, lamEnd, theta, refLam, showRef, showTargets,
        showTable, yAuto, yMin, yMax,
    } = session;

    const setField = (key, value) => setSession(current => writeGDGDDSession({
        [key]: typeof value === 'function' ? value(current[key]) : value,
    }));

    useEffect(() => {
        setSession(readGDGDDSession(design));
    }, [design?.id]);

    useEffect(() => {
        const layers = side === 'back' ? design?.backLayers : design?.frontLayers;
        const layerCount = (layers || []).filter(layer => layer.material && layer.thickness > 0).length;
        if (side !== 'total' && !layerCount) {
            setRaw(null);
            return;
        }
        try {
            setRaw(computeGdGddSpectrum(design, {
                side, target, polarization: pol, thetaDeg: theta,
                lambdaStart: Math.min(lamStart, lamEnd), lambdaEnd: Math.max(lamStart, lamEnd),
            }));
        } catch (error) {
            console.error('GD/GDD computation failed:', error);
            setRaw(null);
        }
    }, [design, side, target, pol, lamStart, lamEnd, theta]);

    const targets = selectGdGddTargets(design?.meritOperands, {
        side, target, quantity, polarization: pol, thetaDeg: theta,
        surfaceMode: design?.surfaceMode,
    });

    return {
        side, setSide: value => setField('side', value), target,
        setTarget: value => {
            setSession(current => writeGDGDDSession({
                target: value,
                side: value === 'R' && current.side === 'total' ? 'front' : current.side,
            }));
        },
        quantity,
        // Changing quantity changes the unit, so any manual bounds are dropped
        // rather than carried from fs into fs^3.
        setQuantity: value => setSession(() => writeGDGDDSession({
            quantity: value, yMin: null, yMax: null,
        })),
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
