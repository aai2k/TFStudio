/**
 * Imports measured spectra as design overlays and exports measured or computed
 * spectra as CSV or JCAMP-DX.
 */

import { TabBtn } from './controls.js';
import { ExportTab } from './ExportTab.js';
import { ImportTab } from './ImportTab.js';
import { MeasuredFitDialog } from './MeasuredFitDialog.js';
import { useSpectrumExchange } from './useSpectrumExchange.js';
import { AnalysisWindow, ControlRow } from '../../analysis/chrome/layout.js';
import { NoticeBadge } from '../../analysis/chrome/popover.js';
import { useMaterialRangeNotice } from '../../../materials/MaterialRangeNotice.js';

const { createElement: h } = React;

export function SpectrumExchange({ c, t }) {
    const sx = t.spectrumExchange;
    const controller = useSpectrumExchange(sx);
    const range = controller.previewRange;
    const materialNotice = useMaterialRangeNotice(
        controller.design, range?.min ?? 0, range?.max ?? 0, t);
    const previewNotice = controller.previewError
        ? { label: sx.previewErrors[controller.previewError] || sx.previewErrors.evaluation, tone: 'error' }
        : null;
    const statusNotice = controller.status
        ? { label: controller.status.msg, tone: controller.status.type }
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
        statusNotice, previewNotice, fitErrorNotice, fitClipNotice, fitStepNotice,
        range ? materialNotice : null,
    ].filter(Boolean);
    const tabProps = { controller, c, sx };

    return h(AnalysisWindow, { c },
        h(ControlRow, {
            c,
            trailing: h(NoticeBadge, { c, notices, label: t.analysisChrome.notices }),
        },
            h(TabBtn, { active: controller.tab === 'import', onClick: () => controller.setTab('import'), c }, sx.tabImport),
            h(TabBtn, { active: controller.tab === 'export', onClick: () => controller.setTab('export'), c }, sx.tabExport),
        ),
        controller.tab === 'import'
            ? h(ImportTab, tabProps)
            : h(ExportTab, tabProps),
        controller.fitDialogCurve && h(MeasuredFitDialog, { controller, c, sx }),
    );
}
