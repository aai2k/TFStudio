import { rangeMaterials } from '../../../../utils/materials/materialRange.js';
import { useEnvironmentChoice } from '../chrome/environmentChoice.js';
import { buildMatColorMap, computeProfile } from './profileModel.js';
import { eFieldSession } from './sessionState.js';
import { offeredSides } from '../availableSide.js';
import { useWindowSession } from '../../windowSession.js';

const { useMemo } = React;

/**
 * The window's settings and what it draws: `profile`, the field in the
 * environment shown, the first under All, which also sets the layer colours;
 * and under All `sets`, each environment's `{ env, profile }` that has layers
 * to draw, `env` the environment, `{ number, label }`, null otherwise.
 */
export function useEFieldState(design) {
    const [session, setField] = useWindowSession(eFieldSession, design);
    const {
        lambda, theta, pol, side, showTable, quantity, component, xUnit,
        axisRefFromDesign, axisRefLambda,
    } = session;
    const environment = useEnvironmentChoice(design, { overlay: true });
    const { views, every } = environment;
    // The λ₀ the depth axis is measured at. Following the design means reading
    // its reference wavelength on every render, not a copy taken when the
    // design was selected, so editing λ₀ in the Design Editor moves the axis
    // and the box together. Null leaves the choice to computeProfile, which is
    // where the fallbacks for a design carrying no λ₀ live.
    const designRef = design?.referenceWavelength > 0 ? design.referenceWavelength : null;
    const refLambda = axisRefFromDesign ? designRef : axisRefLambda;

    const profiles = useMemo(
        () => views.map(view => computeProfile(view.design, { lambda, theta, pol, side, refLambda })),
        [views, lambda, theta, pol, side, refLambda],
    );
    const [profile] = profiles;
    const sets = useMemo(() => (every
        ? views.map((view, k) => ({ env: { number: view.number, label: view.label }, profile: profiles[k] }))
            .filter(set => set.profile)
        : null), [every, views, profiles]);
    const matColorMap = useMemo(
        () => (profile?.validLayers ? buildMatColorMap(views[0].design, profile.validLayers) : {}),
        [profile, views],
    );
    const materials = useMemo(() => views.flatMap(view => rangeMaterials(view.design, side)), [views, side]);

    return {
        lambda, theta, pol, side, showTable, profile, sets, matColorMap, sideOffered: offeredSides(design),
        environment, materials,
        // The box shows the λ₀ in force, so it never contradicts the axis title
        // next to it; it falls back to its own stored value only while the
        // design carries no λ₀ to read.
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
