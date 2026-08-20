import { paletteColors } from '../../../../constants/analysisDefaults.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { buildDiagramData, buildMatColorMap, sideHasLayers, sideStackLayers } from './model.js';
import { buildAdmittanceTableRows, buildMaterialNames } from './tableModel.js';
import { resolveAvailableSide } from '../availableSide.js';
import { admittanceSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useEffect, useMemo, useState } = React;

export function useAdmittanceDiagram(design) {
    const [session, setField] = useWindowSession(admittanceSession, design);
    const { lambda, theta, pol, side, view } = session;
    const setLambda = value => setField('lambda', value);
    const setSide = value => setField('side', value);

    const hasFront = !!(design?.frontLayers?.length);
    const hasBack = !!(design?.backLayers?.length);
    const availableSide = resolveAvailableSide(side, hasFront, hasBack);

    useEffect(() => {
        if (availableSide !== side) setSide(availableSide);
    }, [availableSide, side]);

    const hasData = sideHasLayers(design, side);

    const configured = useAnalysisColors('admittanceDiagram');
    const palette = useMemo(() => paletteColors(configured, 'mat'), [configured]);
    const colorLayers = useMemo(() => sideStackLayers(design, side), [design, side]);
    const matColorMap = useMemo(
        () => buildMatColorMap(colorLayers, palette),
        [colorLayers.map(l => l.material).join(','), palette],
    );
    const [series, setSeries] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!hasData) { setSeries(null); setError(null); return; }
        try {
            const nextSeries = buildDiagramData(design, {
                lambda_nm: lambda, theta_deg: theta, pol, side, view,
            });
            setSeries(nextSeries);
            setError(null);
        } catch (e) {
            setSeries(null);
            setError(e.message);
        }
    }, [design, lambda, theta, pol, side, view]);

    const validLayers = colorLayers.filter(l => l.thickness > 0);
    const matName = buildMaterialNames(design, validLayers);
    const Y0 = series?.[0]?.Y?.[0];
    const etaS = series?.[0]?.etaS;
    const tableRows = useMemo(() => buildAdmittanceTableRows(series, matName, design), [series]);

    return {
        lambda, setLambda, theta, setTheta: value => setField('theta', value),
        pol, setPol: value => setField('pol', value), side, setSide,
        view, setView: value => setField('view', value),
        hasData, series, error, validLayers, matColorMap, matName, Y0, etaS, tableRows,
    };
}
