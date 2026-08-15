import { computeGdGddSpectrum } from './spectrum.js';
import { selectGdGddTargets } from './gdTargets.js';

const { useEffect, useState } = React;

export function useGDGDDState(design) {
    const [side, setSide] = useState('front');
    const [target, setTarget] = useState('R');
    const [quantity, setQuantity] = useState('gd');
    const [pol, setPol] = useState('avg');
    const [lamStart, setLamStart] = useState(400);
    const [lamEnd, setLamEnd] = useState(800);
    const [theta, setTheta] = useState(0);
    const [refLam, setRefLam] = useState(() => design?.referenceWavelength || 550);
    const [showRef, setShowRef] = useState(true);
    const [showTargets, setShowTargets] = useState(true);
    const [raw, setRaw] = useState(null);

    useEffect(() => {
        if (design?.referenceWavelength) setRefLam(design.referenceWavelength);
    }, [design?.id]);

    useEffect(() => {
        if (target === 'R' && side === 'total') setSide('front');
    }, [target, side]);

    useEffect(() => {
        const frontCount = (design?.frontLayers || []).filter(layer => layer.material && layer.thickness > 0).length;
        const backCount = (design?.backLayers || []).filter(layer => layer.material && layer.thickness > 0).length;
        if (frontCount === 0 && backCount > 0) setSide('back');
        else setSide('front');
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
        side, setSide, target,
        setTarget: value => {
            setTarget(value);
            if (value === 'R' && side === 'total') setSide('front');
        },
        quantity, setQuantity, pol, setPol,
        lamStart, setLamStart, lamEnd, setLamEnd,
        theta, setTheta, refLam, setRefLam, showRef, setShowRef,
        targets, showTargets, setShowTargets, raw,
    };
}
