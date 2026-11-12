/**
 * Color Evaluation: CIE color of the coating's reflectance or transmittance.
 *
 * The diagram carries the window, with the colour at each angle on it as one
 * point filled with that colour, and under it a line per angle with a patch of
 * the colour and its main values. The results strip below holds the
 * colorimetric coordinates in every space, the differences between angles and
 * a patch of each colour. The colorimetry itself is in colorModel.js.
 *
 * On a design with environments, the Environment droplist under the diagram
 * picks the environment the colour is computed in, or All, which shows every
 * environment that is on, each path on the diagram in its own colour
 * (useColorReports.js).
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { COLOR_RANGE_NM } from '../../../../utils/physics/colorimetry.js';
import { useMaterialsRangeNotice } from '../../../materials/MaterialRangeNotice.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { csvFromRows, ResultsSection } from '../../../ui/ResultsSection.js';
import { BadgeRow } from '../chrome/badgeRow.js';
import { AnalysisWindow, CenteredMessage, PlotArea } from '../chrome/layout.js';
import { AngleLines } from './AngleLines.js';
import { ANGLE_CAP, windowAngles } from './angles.js';
import { CHART_MIN_HEIGHT, ChromaticityChart } from './chartFigure.js';
import { ColorControls, DiagramTabs } from './ColorControls.js';
import { exportTable, viewTable } from './resultsModel.js';
import { ResultsViews } from './ResultsViews.js';
import { colorEvaluationSession } from './sessionState.js';
import { useColorReports } from './useColorReports.js';
import { useWindowSession } from '../../windowSession.js';

const { createElement: h, useMemo } = React;

function useColorState(design) {
    const [session, setField] = useWindowSession(colorEvaluationSession, design);
    return {
        ...session,
        setCharacteristic: value => setField('characteristic', value),
        setPol: value => setField('pol', value),
        setThetas: value => setField('thetas', value),
        setAngleMode: value => setField('angleMode', value),
        setAngleStart: value => setField('angleStart', value),
        setAngleEnd: value => setField('angleEnd', value),
        setAngleStep: value => setField('angleStep', value),
        setObserver: value => setField('observer', value),
        setIllum: value => setField('illuminant', value),
        setStep: value => setField('step', value),
        setExposure: value => setField('exposure', value),
        setShowTable: value => setField('showTable', value),
        setDiagram: value => setField('diagram', value),
        setDisplay: (key, value) => setField(key, value),
        setResultsView: value => setField('resultsView', value),
        setTableSpace: value => setField('tableSpace', value),
    };
}

// The diagram with a line per angle under it, or a message in their place. The
// lines step aside while Results is open, whose tables hold the same values,
// so the diagram keeps its room. The diagram never goes below its least
// height; in a window too short for it and every line, the lines scroll, down
// to one line, and in one too short for the diagram and one line, the two
// scroll together, so no line is cut off out of reach.
function DiagramArea({ c, t, ce, state, reports, colors, busy }) {
    if (busy) return h(CenteredMessage, { c, message: t.analysisEvaluation.computing });
    if (!reports) return h(CenteredMessage, { c, message: ce.noData });
    return h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' } },
        h('div', { style: { flex: '1 1 0', minHeight: CHART_MIN_HEIGHT } },
            h(ChromaticityChart, {
                reports, observer: state.observer, diagram: state.diagram,
                exposure: state.exposure, display: state, c, tr: ce, units: t.units,
            })),
        !state.showTable && h(AngleLines, { reports, exposure: state.exposure, ce, units: t.units, c, colors }),
    );
}

export function ColorEvaluation({ c, t }) {
    const { design, evalMode } = useDesign();
    const ce = t.colorEval;
    const dt = t.dataTable;
    const state = useColorState(design);

    const angles = useMemo(() => windowAngles(state),
        [state.angleMode, state.thetas, state.angleStart, state.angleEnd, state.angleStep]);
    const options = useMemo(() => ({
        evalMode,
        characteristic: state.characteristic, pol: state.pol, thetas: angles.angles,
        observer: state.observer, illuminant: state.illuminant, step: state.step,
    }), [evalMode, state.characteristic, state.pol, angles,
        state.observer, state.illuminant, state.step]);
    const { environment, reports, materials, coneActive, busy, error } = useColorReports(design, options);
    const colors = useAnalysisColors('colorEvaluation');
    const rangeNotice = useMaterialsRangeNotice(materials, COLOR_RANGE_NM[0], COLOR_RANGE_NM[1], t);
    // The CSV holds everything the window reports, whichever view is open.
    // Under All its rows and the tables' start with the environment.
    const words = { ...ce, environmentColumn: t.environments.environment };
    const csv = useCsvExport(
        () => {
            const { columns, rows } = exportTable(reports, words, t.units);
            return csvFromRows(columns, rows);
        },
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_color.csv`,
    );

    // What the Table or Differences view shows; the header counts its rows. The
    // patches are no table, so the header gives no count over them.
    const table = reports?.length ? viewTable(reports, state, words, t.units) : null;
    const counted = table && state.resultsView !== 'patch';

    const notices = [
        error && {
            label: coneActive ? t.analysisEvaluation.failed : error,
            tone: 'error',
        },
        angles.total > ANGLE_CAP && { label: ce.anglesCapped(angles.total, ANGLE_CAP) },
        rangeNotice,
    ].filter(Boolean);

    return h(AnalysisWindow, { c },
        h(ColorControls, { c, t, ce, state, notices }),
        h(PlotArea, null,
            h(DiagramTabs, { c, ce, state }),
            h(DiagramArea, { c, t, ce, state, reports, colors, busy }),
        ),
        h(BadgeRow, { c, t, design, environment, cone: true }),
        h(ResultsSection, {
            c, label: dt.results, count: counted ? table.rows.length : 0, countLabel: counted ? dt.rowCount : null,
            open: state.showTable, setOpen: state.setShowTable,
            actions: h(ExportMenu, {
                c, enabled: !!reports?.length, ...csv,
                labels: {
                    export: dt.export, copyCsv: dt.copyCsv, saveCsv: dt.saveCsv,
                    copied: dt.csvCopied, saved: dt.csvSaved,
                },
            }),
        },reports?.length
            ? h(ResultsViews, { reports, table, state, ce, c, colors })
            : h(CenteredMessage, { c, message: ce.noData })),
    );
}
