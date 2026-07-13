import { computeEllipsometrySweep } from './spectrum.js';
import { sideHasLayers } from './model.js';

const { useEffect, useState } = React;

export function useEllipsometryEvaluation(design) {
    const [mode, setMode] = useState('spectral');
    const [side, setSide] = useState('front');
    const [lambdaStart, setLambdaStart] = useState(400);
    const [lambdaEnd, setLambdaEnd] = useState(800);
    const [lambdaStep, setLambdaStep] = useState(2);
    const [thetaDeg, setThetaDeg] = useState(65);
    const [lambdaNm, setLambdaNm] = useState(() => design?.referenceWavelength || 550);
    const [angleStart, setAngleStart] = useState(45);
    const [angleEnd, setAngleEnd] = useState(80);
    const [angleStep, setAngleStep] = useState(0.5);
    const [deltaConvention, setDeltaConvention] = useState('woollam');
    const [data, setData] = useState(null);

    useEffect(() => {
        if (design?.referenceWavelength) setLambdaNm(design.referenceWavelength);
    }, [design?.id]);

    useEffect(() => {
        if (!design) return;
        if (!sideHasLayers(design, side)) {
            if (side === 'front' && sideHasLayers(design, 'back')) setSide('back');
            else if (side === 'back' && sideHasLayers(design, 'front')) setSide('front');
        }
    }, [design?.id]);

    useEffect(() => {
        if (!design) { setData(null); return; }
        try {
            setData(computeEllipsometrySweep(design, {
                mode, side, lambdaStart, lambdaEnd, lambdaStep, thetaDeg,
                lambdaNm, angleStart, angleEnd, angleStep, deltaConvention,
            }));
        } catch (error) {
            console.error('Ellipsometry computation failed:', error);
            setData(null);
        }
    }, [design, mode, side, lambdaStart, lambdaEnd, lambdaStep, thetaDeg, lambdaNm, angleStart, angleEnd, angleStep, deltaConvention]);

    return {
        mode, setMode, side, setSide,
        lambdaStart, setLambdaStart, lambdaEnd, setLambdaEnd, lambdaStep, setLambdaStep,
        thetaDeg, setThetaDeg, lambdaNm, setLambdaNm,
        angleStart, setAngleStart, angleEnd, setAngleEnd, angleStep, setAngleStep,
        deltaConvention, setDeltaConvention, data,
    };
}
