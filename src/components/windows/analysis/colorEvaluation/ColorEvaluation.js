/**
 * Color Evaluation — CIE color of the coating's reflectance / transmittance.
 *
 * The chromaticity diagram carries the window; the sample and reference-white
 * swatches sit on it, and the colorimetric coordinates are in the results strip.
 * The colorimetry itself is in colorModel.js.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { xyzToSRGB } from '../../../../utils/physics/colorimetry.js';
import { useMaterialRangeNotice } from '../../../materials/MaterialRangeNotice.js';
import { ConeBadge, EvalModeBadge } from '../../../SurfaceModeBar.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { csvFromRows, ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { AnalysisWindow, CenteredMessage, PlotArea } from '../chrome/layout.js';
import { ChromaticityChart } from './chartFigure.js';
import { ColorControls } from './ColorControls.js';
import {
    COLOR_RANGE_NM, computeColorReport, formatValue, readoutColumns, readoutTableRows,
} from './colorModel.js';
import { colorEvaluationSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { createElement: h, useState, useEffect, useMemo } = React;

function Swatch({ color, label, sub, c }) {
    return h('div', {
        style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 },
    },
        h('div', {
            style: {
                width: 56, height: 56, borderRadius: 6, background: color,
                border: `1px solid ${c.border}`,
                boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
            },
        }),
        h('div', { style: { fontSize: 10, color: c.text, fontWeight: 600 } }, label),
        sub && h('div', { style: { fontSize: 9, color: c.textDim } }, sub),
    );
}

/**
 * The colour itself, over the diagram's lower-left corner, which the spectrum
 * locus never reaches. A colour window has to show the colour, and this costs
 * the plot no height.
 */
function Swatches({ report, sampleRgb, state, ce, c }) {
    const exposureNote = state.exposure === 'fit' ? ce.expFit : `×${state.exposure}`;
    return h('div', {
        style: {
            position: 'absolute', left: 58, bottom: 58, zIndex: 2,
            display: 'flex', gap: 12, padding: 8,
            background: c.panel + 'dd', border: `1px solid ${c.border}`, borderRadius: 6,
        },
    },
        h(Swatch, {
            c, color: sampleRgb,
            label: state.characteristic === 'T' ? ce.swatchT : ce.swatchR,
            sub: state.exposure === '1'
                ? `Y = ${formatValue(report.XYZ.Y, 2)}`
                : `Y = ${formatValue(report.XYZ.Y, 2)} · ${exposureNote}`,
        }),
        h(Swatch, { c, color: 'rgb(255,255,255)', label: ce.refWhite, sub: state.illuminant }),
    );
}

function useColorState(design) {
    const [session, setField] = useWindowSession(colorEvaluationSession, design);
    return {
        ...session,
        setCharacteristic: value => setField('characteristic', value),
        setPol: value => setField('pol', value),
        setTheta: value => setField('theta', value),
        setObserver: value => setField('observer', value),
        setIllum: value => setField('illuminant', value),
        setStep: value => setField('step', value),
        setExposure: value => setField('exposure', value),
        setShowTable: value => setField('showTable', value),
    };
}

export function ColorEvaluation({ c, theme, t }) {
    const { design, evalMode } = useDesign();
    const ce = t.colorEval;
    const dt = t.dataTable;
    const state = useColorState(design);
    const [error, setError] = useState(null);

    useEffect(() => { setError(null); }, [evalMode]);

    const report = useMemo(
        () => computeColorReport({
            design, evalMode, setError,
            characteristic: state.characteristic, pol: state.pol, theta: state.theta,
            observer: state.observer, illuminant: state.illuminant, step: state.step,
        }),
        [design, evalMode, state.characteristic, state.pol, state.theta,
         state.observer, state.illuminant, state.step]);

    const columns = readoutColumns(ce);
    const rows = readoutTableRows(report, ce);
    const rangeNotice = useMaterialRangeNotice(design, COLOR_RANGE_NM[0], COLOR_RANGE_NM[1], t);
    const csv = useCsvExport(
        () => csvFromRows(columns, rows),
        () => `${(design?.name || 'design').replace(/[^\w.-]+/g, '_')}_color.csv`,
    );

    // Exposure only rescales the on-screen swatch; the colorimetric report and
    // its readout are unchanged. '1' reuses the report's reference-white swatch.
    const sampleRgb = report && (state.exposure === '1'
        ? report.rgb
        : xyzToSRGB(report.XYZ, report.white,
            state.exposure === 'fit' ? { fit: true } : { gain: Number(state.exposure) }));

    const notices = [
        error && { label: error, tone: 'error' },
        rangeNotice,
    ].filter(Boolean);

    return h(AnalysisWindow, { c },
        h(ColorControls, { c, t, ce, state, notices }),
        h(PlotArea, { relative: true },
            report
                ? h(React.Fragment, null,
                    h(ChromaticityChart, { report, observer: state.observer, c, theme }),
                    h(Swatches, { report, sampleRgb, state, ce, c }))
                : h(CenteredMessage, { c, message: ce.noData }),
        ),
        h(ResultsSection, {
            c, label: dt.results, count: rows.length, countLabel: dt.rowCount,
            open: state.showTable, setOpen: state.setShowTable,
            actions: h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                h(EvalModeBadge, { design, c, t }),
                h(ConeBadge, { design, c, t }),
                h(ExportMenu, {
                    c, enabled: rows.length > 0, ...csv,
                    labels: {
                        export: dt.export, copyCsv: dt.copyCsv, saveCsv: dt.saveCsv,
                        copied: dt.csvCopied, saved: dt.csvSaved,
                    },
                }),
            ),
        }, h(ResultsGrid, { columns, rows, c })),
    );
}
