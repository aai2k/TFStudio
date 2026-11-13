import { buildMatColorMap, computeThicknessRows } from './thicknessModel.js';
import { offeredSides, resolveAvailableSide } from '../availableSide.js';
import { useEnvironmentChoice } from '../chrome/environmentChoice.js';
import { thicknessSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useEffect, useMemo } = React;

export function useThicknessState(design) {
    const [session, setField] = useWindowSession(thicknessSession, design);
    const { lambda, units, side, showTable } = session;
    const setSide = value => setField('side', value);

    const hasFront = (design?.frontLayers?.length ?? 0) > 0;
    const hasBack = (design?.backLayers?.length ?? 0) > 0;
    const availableSide = resolveAvailableSide(side, hasFront, hasBack);

    // Follows edits to the design, not just a change of design: emptying a side
    // while it is showing has to move the view to one that still has layers.
    useEffect(() => {
        if (availableSide !== side) setSide(availableSide);
    }, [availableSide, side]);

    // The environment the layers are listed in, Current or one the droplist
    // names: each layer as that environment deposits it. Every environment has
    // the layer list's layers, so the sides offered are the design's.
    const environment = useEnvironmentChoice(design);
    const shown = environment.views[0].design;
    const rows = useMemo(
        () => computeThicknessRows(shown, side, lambda),
        [shown, side, lambda],
    );
    const matColorMap = useMemo(
        () => (rows.length ? buildMatColorMap(shown, rows) : {}),
        [shown, rows],
    );

    return {
        lambda, units, side, showTable, rows, matColorMap, sideOffered: offeredSides(design),
        environment, shownDesign: shown,
        setLambda: value => setField('lambda', value),
        setUnits: value => setField('units', value),
        setShowTable: value => setField('showTable', value),
        setSide,
    };
}
