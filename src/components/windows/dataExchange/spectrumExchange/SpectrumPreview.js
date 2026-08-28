import { SpectrumChart } from '../../analysis/opticalEvaluation/SpectrumChart.js';
import { CenteredMessage, PlotArea } from '../../analysis/chrome/layout.js';

const { createElement: h } = React;

export function SpectrumPreview({ controller, c, sx }) {
    const {
        design, previewCurve, previewData, previewRange, previewShowCurves,
    } = controller;
    if (!previewCurve?.x?.length) {
        return h(CenteredMessage, { c, message: sx.previewEmpty });
    }
    const overlay = { ...previewCurve, visible: true };
    return h(PlotArea, null,
        h(SpectrumChart, {
            data: previewData,
            designId: design.id,
            showCurves: previewShowCurves,
            targets: [],
            showTargets: false,
            c,
            editMode: false,
            lamRange: previewRange,
            yRange: { auto: true, min: 0, max: 100 },
            yScale: 'percent',
            spectralUnit: 'nm',
            overlays: [overlay],
        }),
    );
}
