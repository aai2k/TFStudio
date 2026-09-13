/**
 * Group delay and dispersion evaluation. Macleod, Thin-Film Optical Filters,
 * 5th ed., Eq. (11.17): GD = -dφ/dω and GDD = -d²φ/dω².
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { uncoveredRegions } from '../../../../utils/materials/materialRange.js';
import { useMaterialRangeNotice } from '../../../materials/MaterialRangeNotice.js';
import { csvFromRows } from '../../../ui/ResultsSection.js';
import { materialCoverageBands } from '../../../ui/chartOptions.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { AnalysisWindow, CenteredMessage } from '../chrome/layout.js';
import { GDControls } from './GDControls.js';
import { GDResults } from './GDResults.js';
import { GDTargetToolbar } from './GDTargetToolbar.js';
import { buildGdGddView } from './viewModel.js';
import { useGDGDDState } from './useGDGDDState.js';
import { useGdGddTargetEditor } from './useGdGddTargetEditor.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h, useMemo } = React;

/**
 * What the curve needs qualifying with: an optical constant taken from outside
 * a material's data range, samples the automatic vertical range left off the
 * plot. A table knot needs none: the curve steps through it, which is what the
 * material does there and all the reader has to see.
 */
function buildNotices({ autoRange, rangeNotice, text }) {
    const notices = [rangeNotice];
    if (autoRange?.outside > 0) {
        notices.push({ label: text.offScale(autoRange.outside), detail: text.offScaleHint });
    }
    return notices.filter(Boolean);
}

export function GDGDDEvaluation({ c, theme, t }) {
    const text = t.gdgdd;
    const dt = t.dataTable;
    const { design, updateDesign } = useDesign();
    const state = useGDGDDState(design);
    const curve = useAnalysisColors('gdGddEvaluation');
    const { setLamStart, setLamEnd } = state;
    const fixRange = ([from, to]) => {
        setLamStart(from);
        setLamEnd(to);
    };
    const rangeNotice = useMaterialRangeNotice(
        design, state.lamStart, state.lamEnd, t, fixRange);
    // The curve is drawn wherever a value exists, so an out-of-range wavelength
    // is shaded rather than left as a gap: a gap on this plot means there is no
    // value at all. Same helpers as Optical Evaluation, so the two windows
    // cannot disagree about where the data stops.
    const materialBands = useMemo(
        () => materialCoverageBands(
            uncoveredRegions(design, [state.lamStart, state.lamEnd]),
            t.materialRange.bandLabel),
        [design, state.lamStart, state.lamEnd, t],
    );

    // The view holds the chart series and axis range. Rebuilding it on every
    // render hands the chart new objects each time and forces a full re-plot of a
    // multi-thousand-point trace, so it is tied to the values it is built from.
    const view = useMemo(() => buildGdGddView(state.raw, {
        quantity: state.quantity,
        referenceLambda: state.refLam,
        showReference: state.showRef,
        outsideLabel: t.materialRange.outsideColumn,
    }, text, curve, t.spectralAxis.lambdaShort),
    [state.raw, state.quantity, state.refLam, state.showRef, text, curve, t]);
    // A fresh bounds array on every render counts as a changed chart input and
    // re-plots the trace, so it is held stable across renders that do not move
    // the axis. The target editor reads its level grid off the same bounds.
    const yRange = useMemo(
        () => state.yAuto ? view.autoRange?.range : [state.yMin, state.yMax],
        [state.yAuto, state.yMin, state.yMax, view.autoRange],
    );
    const editor = useGdGddTargetEditor({ design, updateDesign, state, yRange });
    const csv = useCsvExport(
        () => csvFromRows(view.tableColumns, view.tableRows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_dispersion.csv`,
    );

    if (!design) return h(CenteredMessage, { c, message: text.noDesign });

    const notices = buildNotices({
        autoRange: state.yAuto ? view.autoRange : null, rangeNotice, text,
    });
    const exportMenu = h(ExportMenu, {
        c, enabled: view.tableRows.length > 0, ...csv,
        labels: {
            export: dt.export, copyCsv: dt.copyCsv, saveCsv: dt.saveCsv,
            copied: dt.csvCopied, saved: dt.csvSaved,
        },
    });

    return h(AnalysisWindow, { c },
        h(GDControls, {
            c, t, text, state, raw: state.raw,
            autoRange: view.autoRange, notices, editor,
        }),
        h(GDTargetToolbar, { c, text, editor, unit: view.meta.unit }),
        h(GDResults, { c, t, text, state, view, exportMenu, yRange, editor, materialBands }),
    );
}
