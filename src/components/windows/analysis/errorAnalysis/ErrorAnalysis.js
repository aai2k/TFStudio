/**
 * Monte-Carlo manufacturing-error analysis.
 *
 * Macleod, Thin-Film Optical Filters, 5th ed., section 13.7 describes
 * Monte-Carlo analysis as an established tolerance and yield method.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { ErrorChart } from './ErrorChart.js';
import { ErrorAnalysisStatus } from './ErrorAnalysisStatus.js';
import { DistributionNote, ErrorMagnitudeControls } from './ErrorMagnitudeControls.js';
import { PrimaryControls } from './PrimaryControls.js';
import { TrialsModal } from './TrialsModal.js';
import { hasPerturbableLayers } from './trialModel.js';
import { placeholder } from './ui.js';
import { useErrorAnalysis } from './useErrorAnalysis.js';

const { createElement: h } = React;

export function ErrorAnalysis({ c, t }) {
    const ea = t.errorAnalysis;
    const { design, evalMode, updateDesign, checkpoint } = useDesign();
    const controller = useErrorAnalysis({ design, evalMode });

    if (!design) return placeholder(c, ea.noDesign);
    if (!hasPerturbableLayers(design, evalMode)) return placeholder(c, ea.noLayers);

    const { result, error, running, corridorSigma, showEnvelope, showTrials, setShowTrials } = controller;
    const chart = error
        ? placeholder(c, `Error: ${error}`)
        : result
            ? h(ErrorChart, { result, char: controller.char, c, corridorSigma, showEnvelope })
            : placeholder(c, running ? ea.running : ea.clickRun);

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text, overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
        }
    },
        h(PrimaryControls, { controller, c, t, ea }),
        h(ErrorMagnitudeControls, { controller, c, ea }),
        h(DistributionNote, { distribution: controller.distribution, c, ea }),
        h('div', { style: { flex: 1, minHeight: 0, position: 'relative' } }, chart),
        h(ErrorAnalysisStatus, { controller, c, ea }),
        showTrials && result && result.trials && h(TrialsModal, {
            result, design, c, t, corridorSigma, updateDesign, checkpoint,
            onClose: () => setShowTrials(false),
        }),
    );
}
