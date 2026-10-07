/**
 * Pulse Analysis: an ultrashort pulse sent off or through the coating, against
 * the Fourier-limited pulse of the same spectrum.
 *
 * The coating's full complex coefficient is applied at every frequency
 * (utils/physics/pulsePropagation.js), so the ripple that a GDD curve makes
 * look small reaches the output. The run happens in the analysis worker; a
 * new setting cancels the run in progress.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { uncoveredRegions } from '../../../../utils/materials/materialRange.js';
import { useMaterialRangeNotice } from '../../../materials/MaterialRangeNotice.js';
import { csvFromRows, ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { materialCoverageBands } from '../../../ui/chartOptions.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { AnalysisWindow, CenteredMessage, PlotArea } from '../chrome/layout.js';
import { PulseChart } from './PulseChart.js';
import { PulseControls } from './PulseControls.js';
import { usePulseAnalysis } from './usePulseAnalysis.js';
import { readoutParts, resultsTable } from './viewModel.js';

const { createElement: h, useEffect, useMemo, useState } = React;

const EMPTY_TABLE = { columns: [], rows: [] };

/** The words for a run the worker could not finish. */
function failureMessage(shown, text) {
    const message = text.errors[shown.reason];
    return typeof message === 'function' ? message(shown.detail || '') : (message || text.errors.failed);
}

/** Why there is no plot, or null when there is one to draw. The first that applies wins. */
function blankReason({ analysis, evaluation, shown, text }) {
    const reasons = [
        [!analysis.hasStack, () => text.noLayers],
        [analysis.problem, () => text.errors[analysis.problem]],
        [evaluation.error, () => text.errors.failed],
        // A stopped run never finished for the settings on screen, so the
        // previous plot would describe settings that are no longer there.
        [analysis.stopped, () => text.stopped],
        [shown && !shown.valid, () => failureMessage(shown, text)],
        [!shown, () => text.computing],
    ];
    const reason = reasons.find(([applies]) => applies);
    return reason ? reason[1]() : null;
}

function runNotices({ shown, side, text }) {
    if (!shown?.valid) return [];
    const notices = [];
    if (!shown.converged) {
        notices.push({
            label: text.unconverged,
            detail: text.unconvergedHint((100 * shown.guardEnergy).toPrecision(2)),
        });
    }
    if (side === 'whole' && Number.isFinite(shown.echoDelayFs)) {
        notices.push({ label: text.wholeEcho, detail: text.wholeEchoHint((shown.echoDelayFs / 1000).toPrecision(3)) });
    }
    return notices;
}

function Readout({ c, text, shown, busy }) {
    const parts = shown?.valid ? readoutParts(shown.metrics, text) : [];
    return h('div', {
        style: {
            display: 'flex', flexWrap: 'wrap', gap: '4px 18px', padding: '5px 12px',
            borderTop: `1px solid ${c.border}`, backgroundColor: c.panel,
            fontSize: 11, color: c.text, fontVariantNumeric: 'tabular-nums', flexShrink: 0,
        },
    },
        parts.map(part => h('span', { key: part }, part)),
        busy && h('span', { style: { color: c.textDim, marginLeft: 'auto' } }, text.computing),
    );
}

export function PulseAnalysis({ c, t }) {
    const text = t.pulseAnalysis;
    const dt = t.dataTable;
    const { design } = useDesign();
    const analysis = usePulseAnalysis(design);
    const curveColors = useAnalysisColors('pulseAnalysis');
    const { evaluation, session } = analysis;

    // The last finished run stays on screen while the next one computes, so a
    // changed setting does not blank the plot. It goes when nothing is asked.
    const [shown, setShown] = useState(null);
    useEffect(() => {
        if (!analysis.payload) setShown(null);
        else if (evaluation.data) setShown(evaluation.data);
    }, [analysis.payload, evaluation.data]);
    const busy = !!analysis.payload && evaluation.busy && !analysis.stopped;

    const band = shown?.valid ? shown.spectrum.bandNm : null;
    const rangeNotice = useMaterialRangeNotice(
        design, band?.[0] ?? session.centerWavelength, band?.[1] ?? session.centerWavelength, t);
    const materialBands = useMemo(
        () => (band ? materialCoverageBands(uncoveredRegions(design, band), t.materialRange.bandLabel) : []),
        [design, band, t],
    );
    const labels = useMemo(() => ({
        flp: text.legend.flp, input: text.legend.input, output: text.legend.output,
        inputSpectrum: text.legend.inputSpectrum, outputSpectrum: text.legend.outputSpectrum,
        coatingGdd: text.legend.coatingGdd, compensatingGdd: text.legend.compensatingGdd,
        timeAxis: text.axes.time, intensityAxis: text.axes.intensity,
        wavelengthAxis: text.axes.wavelength, spectralAxis: text.axes.spectral, gddAxis: text.axes.gdd,
    }), [text]);

    const blank = blankReason({ analysis, evaluation, shown, text });
    // The table, the readout and the export describe what the plot shows, so
    // they empty with it.
    const table = !blank && shown?.valid ? resultsTable(shown, text) : EMPTY_TABLE;
    const csv = useCsvExport(
        () => csvFromRows(table.columns, table.rows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_pulse.csv`,
    );
    const notices = [rangeNotice, ...runNotices({ shown: blank ? null : shown, side: session.side, text })]
        .filter(Boolean);

    return h(AnalysisWindow, { c },
        h(PulseControls, { c, t, text, analysis, notices, busy }),
        h(PlotArea, null,
            h('div', { style: { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' } },
                blank
                    ? h(CenteredMessage, { c, message: blank })
                    : h(PulseChart, {
                        view: shown, mode: session.domain, timeAxis: session.timeAxis,
                        labels, c, curveColors, materialBands,
                    }),
            ),
            h(Readout, { c, text, shown: blank ? null : shown, busy }),
            h(ResultsSection, {
                c, label: dt.results, count: table.rows.length, countLabel: dt.rowCount,
                open: session.showTable, setOpen: value => analysis.setField(
                    'showTable', typeof value === 'function' ? value(session.showTable) : value),
                actions: h(ExportMenu, {
                    c, enabled: table.rows.length > 0, ...csv,
                    labels: {
                        export: dt.export, copyCsv: dt.copyCsv, saveCsv: dt.saveCsv,
                        copied: dt.csvCopied, saved: dt.csvSaved,
                    },
                }),
            }, h(ResultsGrid, { columns: table.columns, rows: table.rows, c })),
        ),
    );
}
