import { computeGdGddSpectrum } from './spectrum.js';

const { useEffect, useState } = React;

export function useGDGDDState(design) {
    const [side, setSide] = useState('front');
    const [target, setTarget] = useState('R');
    const [quantity, setQuantity] = useState('gd');
    const [pol, setPol] = useState('s');
    const [lamStart, setLamStart] = useState(400);
    const [lamEnd, setLamEnd] = useState(800);
    const [lamStep, setLamStep] = useState(1);
    const [theta, setTheta] = useState(0);
    const [refLam, setRefLam] = useState(() => design?.referenceWavelength || 550);
    const [showRef, setShowRef] = useState(true);
    const [raw, setRaw] = useState(null);

    useEffect(() => {
        if (design?.referenceWavelength) setRefLam(design.referenceWavelength);
    }, [design?.id]);

    useEffect(() => {
        const frontCount = (design?.frontLayers || []).filter(layer => layer.material && layer.thickness > 0).length;
        const backCount = (design?.backLayers || []).filter(layer => layer.material && layer.thickness > 0).length;
        if (frontCount === 0 && backCount > 0) setSide('back');
        else setSide('front');
    }, [design?.id]);

    useEffect(() => {
        const layers = (side === 'back' ? design?.backLayers : design?.frontLayers) || [];
        const layerCount = layers.filter(layer => layer.material && layer.thickness > 0).length;
        if (!layerCount) {
            setRaw(null);
            return;
        }
        try {
            const step = Math.max(0.05, Math.min(lamStep, Math.abs(lamEnd - lamStart) || 1));
            setRaw(computeGdGddSpectrum(design, {
                side, target, polarization: pol, thetaDeg: theta, lambdaStep: step,
                lambdaStart: Math.min(lamStart, lamEnd), lambdaEnd: Math.max(lamStart, lamEnd),
            }));
        } catch (error) {
            console.error('GD/GDD computation failed:', error);
            setRaw(null);
        }
    }, [design, side, target, pol, lamStart, lamEnd, lamStep, theta, quantity]);

    return {
        side, setSide, target, setTarget, quantity, setQuantity, pol, setPol,
        lamStart, setLamStart, lamEnd, setLamEnd, lamStep, setLamStep,
        theta, setTheta, refLam, setRefLam, showRef, setShowRef, raw,
    };
}
