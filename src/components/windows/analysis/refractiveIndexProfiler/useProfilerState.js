import { rangeMaterials } from '../../../../utils/materials/materialRange.js';
import { useEnvironmentChoice } from '../chrome/environmentChoice.js';
import { buildMatColorMap, computeProfileForSide, computeTotalRegions } from './profileModel.js';
import { offeredSides, resolveAvailableSide } from '../availableSide.js';
import { profilerSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useEffect, useMemo } = React;

const NO_REGIONS = [];

// Each environment shown, `{ env, profile }` for one side or `{ env, regions }`
// for the whole part, `env` the environment, `{ number, label }`.
function environmentProfiles(views, side, lambda, rp) {
    return views.map(view => {
        const env = { number: view.number, label: view.label };
        return side === 'total'
            ? { env, regions: computeTotalRegions(view.design, lambda, rp) }
            : { env, profile: computeProfileForSide(view.design, lambda, side) };
    });
}

/**
 * The window's settings and what it draws: `profile` or `regions`, those of
 * the environment shown, the first under All, which also sets the layer
 * colours; and under All `sets`, every environment's (environmentProfiles)
 * that has layers to draw, null otherwise.
 */
export function useProfilerState(design, rp) {
    const [session, setField] = useWindowSession(profilerSession, design);
    const { lambda, quantity, side, showTable } = session;
    const environment = useEnvironmentChoice(design, { overlay: true });
    const { views, every } = environment;
    const setSide = value => setField('side', value);

    const hasFront = (design?.frontLayers?.length ?? 0) > 0;
    const hasBack = (design?.backLayers?.length ?? 0) > 0;
    const availableSide = resolveAvailableSide(side, hasFront, hasBack);

    // Follows edits to the design, not just a change of design: emptying a side
    // while it is showing has to move the view to one that still has layers.
    useEffect(() => {
        if (availableSide !== side) setSide(availableSide);
    }, [availableSide, side]);

    const total = side === 'total';
    const shown = useMemo(() => environmentProfiles(views, side, lambda, rp), [views, side, lambda, rp]);
    const profile = total ? null : shown[0].profile;
    const regions = total ? shown[0].regions : NO_REGIONS;
    const sets = useMemo(
        () => (every ? shown.filter(set => (total ? set.regions.length : set.profile)) : null),
        [every, shown, total],
    );
    const matColorMap = useMemo(() => {
        const layers = total ? regions.flatMap(r => r.validLayers || []) : profile?.validLayers || [];
        return layers.length ? buildMatColorMap(views[0].design, layers) : {};
    }, [total, regions, profile, views]);
    const materials = useMemo(() => views.flatMap(view => rangeMaterials(view.design, side)), [views, side]);
    const sideOffered = offeredSides(design);

    return {
        lambda, quantity, side, showTable, profile, regions, sets, matColorMap, sideOffered,
        environment, materials,
        setLambda: value => setField('lambda', value),
        setQuantity: value => setField('quantity', value),
        setShowTable: value => setField('showTable', value),
        setSide,
    };
}
