import { paletteColors } from '../../../../constants/analysisDefaults.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { rangeMaterials } from '../../../../utils/materials/materialRange.js';
import { useEnvironmentChoice } from '../chrome/environmentChoice.js';
import { buildDiagramData, buildMatColorMap, sideHasLayers, sideStackLayers } from './model.js';
import { buildAdmittanceTableRows, buildMaterialNames } from './tableModel.js';
import { offeredSides, resolveAvailableSide } from '../availableSide.js';
import { admittanceSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useEffect, useMemo } = React;

/**
 * The loci of each environment the window shows, `{ env, design, series }`:
 * `env` the environment, `{ number, label }`, under All and null otherwise,
 * `design` the design it computes and `series` its loci (buildDiagramData).
 */
function environmentLoci(views, every, conditions) {
    return views.map(view => ({
        env: every ? { number: view.number, label: view.label } : null,
        design: view.design,
        series: buildDiagramData(view.design, conditions),
    }));
}

// The loci the chart draws: one environment's, or under All every
// environment's in turn, each naming its environment in `env`.
function drawnSeries(sets) {
    if (!sets) return null;
    return sets.flatMap(set => (set.env ? set.series.map(item => ({ ...item, env: set.env })) : set.series));
}

// The table: one environment's rows, or under All each environment's in turn,
// naming it in the Environment column.
function environmentRows(sets, matName) {
    return (sets || []).flatMap(set => {
        const rows = buildAdmittanceTableRows(set.series, matName, set.design);
        return set.env ? rows.map(row => ({ env: set.env.label, ...row })) : rows;
    });
}

export function useAdmittanceDiagram(design) {
    const [session, setField] = useWindowSession(admittanceSession, design);
    const { lambda, theta, pol, side, view } = session;
    const setLambda = value => setField('lambda', value);
    const setSide = value => setField('side', value);
    const environment = useEnvironmentChoice(design, { overlay: true });
    const { views, every } = environment;

    const hasFront = !!(design?.frontLayers?.length);
    const hasBack = !!(design?.backLayers?.length);
    const availableSide = resolveAvailableSide(side, hasFront, hasBack);

    useEffect(() => {
        if (availableSide !== side) setSide(availableSide);
    }, [availableSide, side]);

    const hasData = sideHasLayers(design, side);

    const configured = useAnalysisColors('admittanceDiagram');
    const palette = useMemo(() => paletteColors(configured, 'mat'), [configured]);
    // An environment can make a layer of another material, so the colours and
    // names follow the layers of the designs the window computes.
    const shown = views[0].design;
    const colorLayers = useMemo(() => sideStackLayers(shown, side), [shown, side]);
    const matColorMap = useMemo(
        () => buildMatColorMap(colorLayers, palette),
        [colorLayers.map(l => l.material).join(','), palette],
    );
    const matName = useMemo(() => Object.assign({}, ...views.map(one => buildMaterialNames(
        one.design, sideStackLayers(one.design, side).filter(l => l.thickness > 0)))), [views, side]);
    const materials = useMemo(() => views.flatMap(one => rangeMaterials(one.design, side)), [views, side]);
    const { sets, error } = useMemo(() => {
        if (!hasData) return { sets: null, error: null };
        try {
            return { sets: environmentLoci(views, every, { lambda_nm: lambda, theta_deg: theta, pol, side, view }), error: null };
        } catch (e) {
            return { sets: null, error: e.message };
        }
    }, [hasData, views, every, lambda, theta, pol, side, view]);

    const series = useMemo(() => drawnSeries(sets), [sets]);
    const tableRows = useMemo(() => environmentRows(sets, matName), [sets, matName]);

    return {
        lambda, setLambda, theta, setTheta: value => setField('theta', value),
        pol, setPol: value => setField('pol', value), side, setSide, sideOffered: offeredSides(design),
        view, setView: value => setField('view', value),
        showTable: session.showTable, setShowTable: value => setField('showTable', value),
        environment, materials,
        hasData, series, error, matColorMap, matName, tableRows,
    };
}
