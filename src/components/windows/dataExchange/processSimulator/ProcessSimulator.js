import { useDesign } from '../../../../state/DesignContext.js';
import { AnalysisWindow, PlotArea } from '../../analysis/chrome/layout.js';
import { DepositionSidebar } from './DepositionSidebar.js';
import { ProcessControls } from './ProcessControls.js';
import { SpectraChart } from './SpectraChart.js';
import { Timeline } from './Timeline.js';
import { buildStepPoints } from './figure.js';
import { useDepositionState } from './useDepositionState.js';
import { useProcessSave } from './useProcessSave.js';
import { useSetupState } from './useSetupState.js';
import { useSpectra } from './useSpectra.js';

const { createElement: h, useMemo } = React;

/** What the spectrum on screen needs qualifying with. */
function buildNotices({ sp, setup, deposition }) {
    const notices = [];
    if (setup.secondSurface === 'coated' && deposition.otherDep.length === 0) {
        notices.push({ label: sp.hintNoOtherLayers });
    }
    if (!(setup.lambdaEnd > setup.lambdaStart && setup.lambdaStep > 0)) {
        notices.push({ label: sp.invalidRange, tone: 'error' });
    }
    return notices;
}

export function ProcessSimulator({ c, t }) {
    const { design } = useDesign();
    const sp = t.processSim;
    const setup = useSetupState();
    const deposition = useDepositionState(design, setup);
    const spectra = useSpectra(design, setup, deposition);
    const save = useProcessSave(design, setup, deposition.N, sp);

    // The finished-layer curves change with the design, not with the timeline,
    // so they are built once and reused across the frames of a run.
    const stepPoints = useMemo(
        () => buildStepPoints(spectra.lambdas, spectra.stepSpectra?.map(item => item.values)),
        [spectra.lambdas, spectra.stepSpectra],
    );
    const baselinePoints = useMemo(
        () => buildStepPoints(spectra.lambdas, spectra.baselineSpec && [spectra.baselineSpec.values])[0],
        [spectra.lambdas, spectra.baselineSpec],
    );
    const chartData = {
        lambdas: spectra.lambdas,
        baselinePoints,
        stepPoints,
        liveCurve: spectra.liveSpec?.values,
        // A held layer is what the chart follows; without one it follows the
        // layer being deposited, which is the one worth watching during a run.
        focusStep: deposition.pinnedStep ?? deposition.layerIdx,
        showAll: setup.showAll,
        quantity: setup.quantity,
    };

    return h(AnalysisWindow, { c },
        h(ProcessControls, {
            c, t, sp, setup, deposition, save,
            notices: buildNotices({ sp, setup, deposition }),
        }),
        h('div', { style: { display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' } },
            h(DepositionSidebar, { c, sp, setup, deposition }),
            h(PlotArea, null, h(SpectraChart, { c, data: chartData, t })),
        ),
        h(Timeline, { c, sp, setup, deposition }),
    );
}
