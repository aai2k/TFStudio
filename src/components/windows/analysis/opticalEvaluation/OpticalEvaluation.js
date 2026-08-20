import { useMaterialRangeNotice } from '../../../materials/MaterialRangeNotice.js';
import { ExportMenu } from '../../../ui/ExportMenu.js';
import { useOpticalEvaluation } from './useOpticalEvaluation.js';
import { ControlBar } from './ControlBar.js';
import { TargetToolbar } from './TargetToolbar.js';
import { ChartPanel } from './ChartPanel.js';
import { ResultsPanel } from './ResultsPanel.js';
import { AnalysisWindow } from '../chrome/layout.js';

const { createElement: h } = React;

export function OpticalEvaluation({ c, theme, t }) {
    const state = useOpticalEvaluation();
    const rangeNotice = useMaterialRangeNotice(
        state.design, state.params.lambdaStart, state.params.lambdaEnd, t);
    const oe = t.opticalEval;
    const exportMenu = h(ExportMenu, {
        c, enabled: !!state.data,
        copied: state.copied, copyCSV: state.copyCSV,
        saved: state.saved, saveCSV: state.saveCSV,
        labels: {
            export: oe.export, copyCsv: oe.copyCsv, saveCsv: oe.saveCsv,
            copied: oe.csvCopied, saved: oe.csvSaved,
        },
    });
    const props = {
        ...state, c, theme, t, oe,
        notices: [rangeNotice].filter(Boolean),
        exportMenu,
    };
    return h(AnalysisWindow, { c },
        h(ControlBar, props),
        h(TargetToolbar, props),
        h(ChartPanel, props),
        h(ResultsPanel, props),
    );
}
