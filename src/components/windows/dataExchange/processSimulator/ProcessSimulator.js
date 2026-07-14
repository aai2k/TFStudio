import { useDesign } from '../../../../state/DesignContext.js';
import { DepositionSidebar } from './DepositionSidebar.js';
import { SetupToolbar } from './SetupToolbar.js';
import { SpectraChart } from './SpectraChart.js';
import { SpectrumToolbar } from './SpectrumToolbar.js';
import { Timeline } from './Timeline.js';
import { useDepositionState } from './useDepositionState.js';
import { useProcessSave } from './useProcessSave.js';
import { useSetupState } from './useSetupState.js';
import { useSpectra } from './useSpectra.js';

const { createElement: h } = React;

export function ProcessSimulator({ c, t }) {
    const { design } = useDesign();
    const sp = t.processSim;
    const setup = useSetupState();
    const deposition = useDepositionState(design, setup);
    const spectra = useSpectra(design, setup, deposition);
    const save = useProcessSave(design, setup, deposition.N, sp);
    const hasActive = deposition.N > 0;
    const showOtherHint = setup.secondSurface === 'coated' && deposition.otherDep.length === 0;
    const chartData = {
        lambdas: spectra.lambdas,
        baseline: spectra.baselineSpec?.values,
        stepCurves: spectra.stepSpectra?.map(spectrum => spectrum.values),
        liveCurve: spectra.liveSpec?.values,
        currentStep: deposition.layerIdx,
        showSteps: setup.showSteps,
        quantity: setup.quantity,
    };

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            backgroundColor: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            overflow: 'hidden',
        },
    },
        h(SetupToolbar, { c, sp, setup, hasActive, save }),
        h(SpectrumToolbar, { c, sp, setup, statusMsg: save.statusMsg }),
        showOtherHint && h('div', {
            style: {
                padding: '4px 12px', fontSize: 11, color: c.textDim,
                backgroundColor: c.panel,
                borderBottom: `1px solid ${c.border}`,
            },
        }, sp.hintNoOtherLayers),
        h('div', { style: { display: 'flex', flex: 1, overflow: 'hidden' } },
            h(DepositionSidebar, { c, sp, setup, deposition }),
            h('div', { style: { flex: 1, position: 'relative', minWidth: 0, overflow: 'hidden' } },
                h(SpectraChart, { c, data: chartData, t }),
            ),
        ),
        h(Timeline, { c, sp, setup, deposition }),
    );
}
