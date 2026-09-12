import { buildMatColorMap, computeProfile } from './profileModel.js';
import { eFieldSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useEffect, useState } = React;

export function useEFieldState(design) {
    const [session, setField] = useWindowSession(eFieldSession, design);
    const {
        lambda, theta, pol, side, showTable, quantity, component, xUnit,
        axisRefFromDesign, axisRefLambda,
    } = session;
    const [profile, setProfile] = useState(null);
    const [matColorMap, setMatColorMap] = useState({});
    // The λ₀ the depth axis is measured at. Following the design means reading
    // its reference wavelength on every render, not a copy taken when the
    // design was selected, so editing λ₀ in the Design Editor moves the axis
    // and the box together. Null leaves the choice to computeProfile, which is
    // where the fallbacks for a design carrying no λ₀ live.
    const designRef = design?.referenceWavelength > 0 ? design.referenceWavelength : null;
    const refLambda = axisRefFromDesign ? designRef : axisRefLambda;

    useEffect(() => {
        if (!design) { setProfile(null); return; }
        const result = computeProfile(design, { lambda, theta, pol, side, refLambda });
        setProfile(result);
        if (result?.validLayers) setMatColorMap(buildMatColorMap(design, result.validLayers));
        else setMatColorMap({});
    }, [design, lambda, theta, pol, side, refLambda]);

    return {
        lambda, theta, pol, side, showTable, profile, matColorMap,
        // The box shows the λ₀ in force, so it never contradicts the axis title
        // next to it; it falls back to its own stored value only while there is
        // no design to read one from.
        axisRefFromDesign, axisRefLambda: refLambda ?? axisRefLambda,
        // What the two axes read and which component of the field they read,
        // travelling together since every curve, cell and axis title needs
        // all three.
        display: { quantity, component, xUnit },
        setLambda: value => setField('lambda', value),
        setTheta: value => setField('theta', value),
        setPol: value => setField('pol', value),
        setSide: value => setField('side', value),
        setShowTable: value => setField('showTable', value),
        setQuantity: value => setField('quantity', value),
        setComponent: value => setField('component', value),
        setXUnit: value => setField('xUnit', value),
        setAxisRefFromDesign: value => setField('axisRefFromDesign', value),
        setAxisRefLambda: value => setField('axisRefLambda', value),
    };
}
