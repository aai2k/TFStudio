/**
 * Imports measured spectra as design overlays and exports measured or computed
 * spectra as CSV or JCAMP-DX.
 */

import { ReportAndNotices } from '../chrome/actionStatus.js';
import { TabBtn } from '../chrome/panel.js';
import { CurveEditor } from '../curveEditor/CurveEditor.js';
import { ExportTab } from './ExportTab.js';
import { ImportTab } from './ImportTab.js';
import { MeasuredFitDialog } from './MeasuredFitDialog.js';
import { useSpectrumExchange } from './useSpectrumExchange.js';
import { AnalysisWindow, ControlRow } from '../../analysis/chrome/layout.js';
import { useMaterialRangeNotice } from '../../../materials/MaterialRangeNotice.js';

const { createElement: h } = React;

export function SpectrumExchange({ c, t }) {
    const sx = t.spectrumExchange;
    const controller = useSpectrumExchange(sx, t.curveEditor);
    const range = controller.previewRange;
    const materialNotice = useMaterialRangeNotice(
        controller.design, range?.min ?? 0, range?.max ?? 0, t);
    const previewNotice = controller.previewError
        ? { label: sx.previewErrors[controller.previewError] || sx.previewErrors.evaluation, tone: 'error' }
        : null;
    const fit = controller.fitSnapshot;
    const fitErrorNotice = controller.fitDialogCurve && fit?.error
        ? { label: sx.fitErrors[fit.error] || sx.fitErrors.range, tone: 'error' }
        : null;
    const fitClipNotice = fit?.sampled?.clipped && fit.sampled.range
        ? { label: sx.fitClipped(fit.sampled.range[0], fit.sampled.range[1]), tone: 'warning' }
        : null;
    const fitStepNotice = fit?.sampled?.stepTooFine
        ? { label: sx.fitStepFine(fit.sampled.spacingNm), tone: 'warning' }
        : null;
    const notices = [
        previewNotice, fitErrorNotice, fitClipNotice, fitStepNotice,
        range ? materialNotice : null,
    ].filter(Boolean);
    const tabProps = { controller, c, sx, t };

    return h(AnalysisWindow, { c },
        h(ControlRow, { c },
            h(TabBtn, { active: controller.tab === 'import', onClick: () => controller.setTab('import'), c }, sx.tabImport),
            h(TabBtn, { active: controller.tab === 'export', onClick: () => controller.setTab('export'), c }, sx.tabExport),
            h(ReportAndNotices, { c, t, status: controller.status, notices }),
        ),
        controller.tab === 'import'
            ? h(ImportTab, tabProps)
            : h(ExportTab, tabProps),
        controller.fitDialogCurve && h(MeasuredFitDialog, { controller, c, sx }),
        controller.curveEditor.editorProps && h(CurveEditor, { ...controller.curveEditor.editorProps, c, t }),
    );
}
