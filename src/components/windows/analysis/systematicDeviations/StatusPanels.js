import { SpecVerdict } from '../../../SpecVerdict.js';
import { paramLabel } from '../../../../utils/physics/systematicDeviations.js';
import { SpectrumPlot } from './SpectrumPlot.js';
import { SweepHeatmap } from './SweepHeatmap.js';

const { createElement: h } = React;

export function SpecificationStatus({ controller, c, t }) {
    const { design, mode, specDev } = controller;
    if (mode !== 'single' || !(design?.qualifiers?.length > 0)) return null;
    return h('div', {
        style: {
            padding: '4px 10px', borderBottom: `1px solid ${c.border}`,
            background: c.panel, display: 'flex', alignItems: 'center', gap: 8,
            flexShrink: 0, flexWrap: 'wrap',
        }
    },
        h(SpecVerdict, {
            design: specDev.design, resolveMat: specDev.resolve, c, t,
            label: (t.specification && t.specification.specLabel) || 'Spec:',
        })
    );
}

function SweepPlaceholder({ controller, c, sd }) {
    const message = controller.sweepRunning
        ? (sd.runningMsg || 'Computing sweep…')
        : (sd.sweepHint || `Choose a parameter, set range and click "Run sweep". Label: ${paramLabel(controller.sweep.param)}`);
    return h('div', {
        style: {
            width: '100%', height: '100%', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontStyle: 'italic',
            padding: 16, textAlign: 'center',
        }
    }, message);
}

export function ResultPanel({ controller, c, sd }) {
    const error = controller.computeError || controller.error;
    let content;
    if (controller.mode === 'single') {
        content = h(SpectrumPlot, {
            baseline: controller.baseline,
            deviated: controller.deviated,
            channel: controller.channel,
            showBaseline: controller.showBaseline,
            c,
        });
    } else if (controller.sweepResult) {
        content = h(SweepHeatmap, {
            sweepData: controller.sweepResult,
            channel: controller.sweepChannel,
            c,
        });
    } else {
        content = h(SweepPlaceholder, { controller, c, sd });
    }
    return h('div', { style: { flex: 1, minHeight: 0, position: 'relative' } },
        error && h('div', {
            style: {
                position: 'absolute', top: 8, left: 8, right: 8,
                padding: '6px 10px', background: '#5a1a1a', color: '#fff',
                border: '1px solid #a33', borderRadius: 4, fontSize: 11, zIndex: 5,
            }
        }, error),
        content,
    );
}
