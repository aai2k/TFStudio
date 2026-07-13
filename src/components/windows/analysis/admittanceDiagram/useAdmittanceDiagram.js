import { buildDiagramData, buildMatColorMap, sideHasLayers, sideStackLayers } from './model.js';
import { buildAdmittanceTableRows, buildMaterialNames } from './tableModel.js';

const { useEffect, useMemo, useState } = React;

export function useAdmittanceDiagram(design) {
    const [lambda, setLambda] = useState(() => design?.referenceWavelength || 550);
    const [theta, setTheta] = useState(0);
    const [pol, setPol] = useState('avg');
    const [side, setSide] = useState('front');

    useEffect(() => {
        const hasFront = !!(design?.frontLayers?.length);
        const hasBack = !!(design?.backLayers?.length);
        if (side === 'front' && !hasFront && hasBack) setSide('back');
    }, [design?.id]);

    const hasData = sideHasLayers(design, side);

    useEffect(() => {
        if (design?.referenceWavelength) setLambda(design.referenceWavelength);
    }, [design?.id]);

    const colorLayers = useMemo(() => sideStackLayers(design, side), [design, side]);
    const matColorMap = useMemo(
        () => buildMatColorMap(colorLayers),
        [colorLayers.map(l => l.material).join(',')],
    );
    const [series, setSeries] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!hasData) { setSeries(null); setError(null); return; }
        try {
            const nextSeries = buildDiagramData(design, lambda, theta, pol, side);
            setSeries(nextSeries);
            setError(null);
        } catch (e) {
            setSeries(null);
            setError(e.message);
        }
    }, [design, lambda, theta, pol, side]);

    const validLayers = colorLayers.filter(l => l.thickness > 0);
    const matName = buildMaterialNames(validLayers);
    const Y0 = series?.[0]?.Y?.[0];
    const etaS = series?.[0]?.etaS;
    const tableRows = useMemo(() => buildAdmittanceTableRows(series, matName), [series]);

    return {
        lambda, setLambda, theta, setTheta, pol, setPol, side, setSide,
        hasData, series, error, validLayers, matColorMap, matName, Y0, etaS, tableRows,
    };
}
