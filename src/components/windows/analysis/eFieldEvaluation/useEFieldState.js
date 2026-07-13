import { buildMatColorMap, computeProfile } from './profileModel.js';

const { useEffect, useState } = React;

export function useEFieldState(design) {
    const [lambda, setLambda] = useState(() => design?.referenceWavelength || 550);
    const [lambdaStr, setLambdaStr] = useState(() => String(design?.referenceWavelength || 550));
    const [theta, setTheta] = useState(0);
    const [pol, setPol] = useState('avg');
    const [side, setSide] = useState('front');
    const [profile, setProfile] = useState(null);
    const [matColorMap, setMatColorMap] = useState({});

    useEffect(() => {
        if (design?.referenceWavelength) {
            setLambda(design.referenceWavelength);
            setLambdaStr(String(design.referenceWavelength));
        }
    }, [design?.id]);

    useEffect(() => {
        if (!design) return;
        const hasFront = !!design.frontLayers?.length;
        const hasBack = !!design.backLayers?.length;
        if (!hasFront && hasBack) setSide('back');
        else if (hasFront) setSide('front');
    }, [design?.id]);

    useEffect(() => {
        if (!design) { setProfile(null); return; }
        const result = computeProfile(design, lambda, theta, pol, side);
        setProfile(result);
        if (result?.validLayers) setMatColorMap(buildMatColorMap(result.validLayers));
        else setMatColorMap({});
    }, [design, lambda, theta, pol, side]);

    return {
        lambda, lambdaStr, theta, pol, side, profile, matColorMap,
        setLambda, setLambdaStr, setTheta, setPol, setSide,
    };
}
