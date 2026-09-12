import { buildMatColorMap, computeProfile } from './profileModel.js';
import { eFieldSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useEffect, useState } = React;

export function useEFieldState(design) {
    const [session, setField] = useWindowSession(eFieldSession, design);
    const { lambda, theta, pol, side, showTable, quantity, component } = session;
    const [profile, setProfile] = useState(null);
    const [matColorMap, setMatColorMap] = useState({});

    useEffect(() => {
        if (!design) { setProfile(null); return; }
        const result = computeProfile(design, lambda, theta, pol, side);
        setProfile(result);
        if (result?.validLayers) setMatColorMap(buildMatColorMap(design, result.validLayers));
        else setMatColorMap({});
    }, [design, lambda, theta, pol, side]);

    return {
        lambda, theta, pol, side, showTable, profile, matColorMap,
        // What the vertical axis reads and which component of the field it
        // reads, travelling together since every curve, cell and axis title
        // needs both.
        display: { quantity, component },
        setLambda: value => setField('lambda', value),
        setTheta: value => setField('theta', value),
        setPol: value => setField('pol', value),
        setSide: value => setField('side', value),
        setShowTable: value => setField('showTable', value),
        setQuantity: value => setField('quantity', value),
        setComponent: value => setField('component', value),
    };
}
