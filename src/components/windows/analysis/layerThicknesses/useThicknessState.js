import { buildMatColorMap, computeThicknessRows } from './thicknessModel.js';
import { resolveAvailableSide } from '../availableSide.js';
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

    const rows = useMemo(
        () => (design ? computeThicknessRows(design, side, lambda) : []),
        [design, side, lambda],
    );
    const matColorMap = useMemo(
        () => (rows.length ? buildMatColorMap(design, rows) : {}),
        [design, rows],
    );

    return {
        lambda, units, side, showTable, rows, matColorMap,
        setLambda: value => setField('lambda', value),
        setUnits: value => setField('units', value),
        setShowTable: value => setField('showTable', value),
        setSide,
    };
}
