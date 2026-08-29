/**
 * Imports measured Ψ and Δ from a spectroscopic ellipsometer, and exports
 * measured or calculated Ψ/Δ as CSV.
 *
 * Separate from Measured Spectra because an ellipsometric measurement is not a
 * photometric one: it has no percent scale, no polarization to pick, it is
 * meaningless without an angle of incidence, and its Δ carries a sign
 * convention that differs between instruments.
 */

import { ExportTab } from './ExportTab.js';
import { ImportTab } from './ImportTab.js';
import { useMeasuredEllipsometry } from './useMeasuredEllipsometry.js';
import { AnalysisWindow, ControlRow } from '../../analysis/chrome/layout.js';
import { NoticeBadge } from '../../analysis/chrome/popover.js';
import { TabBtn } from '../chrome/panel.js';

const { createElement: h } = React;

export function MeasuredEllipsometry({ c, t }) {
    const mx = t.measuredEllipsometry;
    const controller = useMeasuredEllipsometry(mx);
    const notices = [
        controller.status ? { label: controller.status.msg, tone: controller.status.type } : null,
        controller.cosDeltaCurve
            ? { label: mx.cosDeltaWarning(controller.cosDeltaCurve.name), tone: 'warning' }
            : null,
    ].filter(Boolean);
    const tabProps = { controller, c, mx };

    return h(AnalysisWindow, { c },
        h(ControlRow, {
            c,
            trailing: h(NoticeBadge, { c, notices, label: t.analysisChrome.notices }),
        },
            h(TabBtn, {
                active: controller.tab === 'import', c,
                onClick: () => controller.setTab('import'),
            }, mx.tabImport),
            h(TabBtn, {
                active: controller.tab === 'export', c,
                onClick: () => controller.setTab('export'),
            }, mx.tabExport),
        ),
        controller.tab === 'import' ? h(ImportTab, tabProps) : h(ExportTab, tabProps),
    );
}
