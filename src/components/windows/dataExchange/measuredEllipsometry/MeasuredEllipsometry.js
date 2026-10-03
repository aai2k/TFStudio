/**
 * Imports measured Ψ and Δ from a spectroscopic ellipsometer, turns a pair
 * into merit targets the design can be fitted to, and exports measured or
 * calculated Ψ/Δ as CSV.
 *
 * Separate from Measured Spectra because an ellipsometric measurement is not a
 * photometric one: it has no percent scale, no polarization to pick, it is
 * meaningless without an angle of incidence, and its Δ carries a sign
 * convention that differs between instruments.
 */

import { ExportTab } from './ExportTab.js';
import { ImportTab } from './ImportTab.js';
import { fitDialogText } from './fitModel.js';
import { useMeasuredEllipsometry } from './useMeasuredEllipsometry.js';
import { MeasuredFitDialog } from '../spectrumExchange/MeasuredFitDialog.js';
import { AnalysisWindow, ControlRow } from '../../analysis/chrome/layout.js';
import { ReportAndNotices } from '../chrome/actionStatus.js';
import { TabBtn } from '../chrome/panel.js';
import { CurveEditor } from '../curveEditor/CurveEditor.js';

const { createElement: h, useMemo } = React;

export function MeasuredEllipsometry({ c, t }) {
    const mx = t.measuredEllipsometry;
    const fitText = useMemo(() => fitDialogText(t), [t]);
    const controller = useMeasuredEllipsometry(mx, t.spectralAxis.nm, fitText, t.curveEditor);
    const notices = controller.cosDeltaCurve
        ? [{ label: mx.cosDeltaWarning(controller.cosDeltaCurve.name), tone: 'warning' }]
        : [];
    const tabProps = { controller, c, mx, ce: t.curveEditor };

    return h(AnalysisWindow, { c },
        h(ControlRow, { c },
            h(TabBtn, {
                active: controller.tab === 'import', c,
                onClick: () => controller.setTab('import'),
            }, mx.tabImport),
            h(TabBtn, {
                active: controller.tab === 'export', c,
                onClick: () => controller.setTab('export'),
            }, mx.tabExport),
            h(ReportAndNotices, { c, t, status: controller.status, notices }),
        ),
        controller.tab === 'import' ? h(ImportTab, tabProps) : h(ExportTab, tabProps),
        controller.fitDialogCurve && h(MeasuredFitDialog, { controller, c, sx: fitText }),
        controller.curveEditor.editorProps && h(CurveEditor, { ...controller.curveEditor.editorProps, c, t }),
    );
}
