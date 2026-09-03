import { useDesign } from '../../../../state/DesignContext.js';
import { useMaterialsRangeNotice } from '../../../materials/MaterialRangeNotice.js';
import { AnalysisWindow, PlotArea, ProgressHairline } from '../../analysis/chrome/layout.js';
import { DepositionSidebar } from './DepositionSidebar.js';
import { ProcessControls } from './ProcessControls.js';
import { SpectraChart } from './SpectraChart.js';
import { Timeline } from './Timeline.js';
import { buildStepPoints } from './figure.js';
import { useChipPlan } from './useChipPlan.js';
import { useDepositionState } from './useDepositionState.js';
import { useProcessSave } from './useProcessSave.js';
import { useSetupState } from './useSetupState.js';
import { useSpectra } from './useSpectra.js';

const { createElement: h, useCallback, useMemo } = React;

/** What the spectrum on screen needs qualifying with. */
function buildNotices({ sp, setup, deposition, chipMode, rangeNotice }) {
    const notices = [];
    if (rangeNotice) notices.push(rangeNotice);
    if (!chipMode && setup.secondSurface === 'coated' && deposition.otherDep.length === 0) {
        notices.push({ label: sp.hintNoOtherLayers });
    }
    if (!(setup.lambdaEnd > setup.lambdaStart && setup.lambdaStep > 0)) {
        notices.push({ label: sp.invalidRange, tone: 'error' });
    }
    return notices;
}

// The chip plan is indexed over every layer of the side, zero-thickness ones
// included, the way the Monitor Worksheet indexes it.
function sideLayerCount(design, activeSide) {
    const layers = activeSide === 'front' ? design?.frontLayers : design?.backLayers;
    return layers?.length || 0;
}

export function ProcessSimulator({ c, t }) {
    const { design } = useDesign();
    const sp = t.processSim;
    const setup = useSetupState();
    const chipMode = setup.mode === 'chips';
    const chips = useChipPlan(design, sideLayerCount(design, setup.activeSide), chipMode);
    const deposition = useDepositionState(design, setup, chips.plan);
    const spectra = useSpectra(design, setup, deposition);
    const save = useProcessSave(design, setup, deposition.N, sp, chips.plan);

    // The chart and the .res files cover the same range, so one warning
    // serves both, and its fix pulls that range back onto measured data.
    const { setLambdaStart, setLambdaEnd } = setup;
    const fixRange = useCallback(([from, to]) => {
        setLambdaStart(from);
        setLambdaEnd(to);
    }, [setLambdaStart, setLambdaEnd]);
    const rangeNotice = useMaterialsRangeNotice(
        deposition.evaluatedMaterials, setup.lambdaStart, setup.lambdaEnd, t, fixRange);

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
    // Memoised so the chart effect only refires when a curve or the focus
    // actually changed, not on every render of the window.
    const liveCurve = spectra.liveSpec?.values;
    const focusStep = deposition.pinnedStep ?? deposition.layerIdx;
    const chartData = useMemo(() => ({
        lambdas: spectra.lambdas,
        baselinePoints,
        stepPoints,
        liveCurve,
        // A held layer is what the chart follows; without one it follows the
        // layer being deposited, which is the one worth watching during a run.
        focusStep,
        showAll: setup.showAll,
        quantity: setup.quantity,
    }), [spectra.lambdas, baselinePoints, stepPoints, liveCurve,
         focusStep, setup.showAll, setup.quantity]);

    const chipControls = chipMode ? chips : null;
    return h(AnalysisWindow, { c },
        h(ProcessControls, {
            c, t, sp, setup, deposition, save, chipMode,
            notices: buildNotices({ sp, setup, deposition, chipMode, rangeNotice }),
        }),
        save.progress && h(ProgressHairline, { c, progress: save.progress }),
        h('div', { style: { display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' } },
            h(DepositionSidebar, { c, t, sp, setup, deposition, design, chips: chipControls }),
            h(PlotArea, null, h(SpectraChart, { c, data: chartData, t })),
        ),
        h(Timeline, { c, sp, setup, deposition }),
    );
}
