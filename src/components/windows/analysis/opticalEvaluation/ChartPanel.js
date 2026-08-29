import { SpectrumChart } from './SpectrumChart.js';
import { uncoveredRegions } from '../../../../utils/materials/materialRange.js';

const { createElement: h, useMemo } = React;

export function ChartPanel(props) {
    const {
        data, showCurves, design, showTargets, c, theme,
        editMode, editTool, editCurve, editPol, editKind, lamRange, yRange, yScale,
        spectralUnit, onCreateTarget, onEditTarget, onDeleteTarget,
        error, busy, showEmpty, oe, t,
    } = props;
    // Same coverage rule as the notices badge, so the bands and the notice
    // always agree on which wavelengths are extrapolated.
    const materialBands = useMemo(
        () => uncoveredRegions(design, [lamRange.min, lamRange.max]).map(region => ({
            x0: region.x0, x1: region.x1,
            label: t.materialRange.bandLabel(region.materials.join(', ')),
        })),
        [design, lamRange, t],
    );
    return h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        h('div', { style: { flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' } },
            h(SpectrumChart, {
                data, designId: design.id, showCurves, targets: design.meritOperands, showTargets, c, theme,
                editMode, editTool, editCurve, editPol, editKind, lamRange, yRange, yScale,
                spectralUnit, overlays: design.measuredCurves, materialBands,
                onCreateTarget, onEditTarget, onDeleteTarget,
            }),
            busy && h('div', {
                style: {
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: c.textDim, fontSize: 12, fontStyle: 'italic', background: c.bg,
                },
            }, t.analysisEvaluation.computing),
            (!busy && error) && h('div', {
                style: {
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#ef5350', fontSize: 12, padding: 16, textAlign: 'center',
                    background: c.bg
                }
            }, error === 'ANALYSIS_EVALUATION_FAILED' ? t.analysisEvaluation.failed : error),
            (!busy && !error && showEmpty) && h('div', {
                style: {
                    position: 'absolute', inset: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: c.textDim, fontSize: 12, fontStyle: 'italic',
                    background: c.bg
                }
            }, oe.noFrontLayers)
        )
    );
}
