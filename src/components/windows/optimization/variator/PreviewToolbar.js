import { EvalModeBadge } from '../../../SurfaceModeBar.js';
import { Checkbox } from '../../../ui/Checkbox.js';
import { ToggleButton } from '../../analysis/chrome/controls.js';

const { createElement: h } = React;

export function PreviewToolbar(props) {
    const {
        c, t, v, design, params, setParams,
        showTargets, setShowTargets, showBaseline, setShowBaseline,
    } = props;
    const hasTargets = !!design.meritOperands?.length;
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '5px 10px', borderBottom: `1px solid ${c.border}`,
            backgroundColor: c.panel, flexShrink: 0
        }
    },
        h('span', { style: { fontWeight: 600, fontSize: 12 } }, v.preview || 'Preview'),
        // Evaluation target — read-only, set in the Design Editor.
        h(EvalModeBadge, { design, c, t }),
        h('div', { style: { width: 1, height: 18, background: c.border } }),
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: c.textDim } },
            'λ',
            h('input', {
                type: 'number', value: params.lambdaStart,
                onChange: (e) => setParams(p => ({ ...p, lambdaStart: parseFloat(e.target.value) || 0 })),
                style: { width: 60, height: 22, marginLeft: 4, backgroundColor: c.bg, color: c.text,
                         border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11, padding: '0 4px' }
            }),
            '–',
            h('input', {
                type: 'number', value: params.lambdaEnd,
                onChange: (e) => setParams(p => ({ ...p, lambdaEnd: parseFloat(e.target.value) || 0 })),
                style: { width: 60, height: 22, backgroundColor: c.bg, color: c.text,
                         border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11, padding: '0 4px' }
            }),
            'nm'
        ),
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: c.textDim } },
            t.opticalEval.aoi,
            h('input', {
                type: 'number', value: params.theta, min: 0, max: 89,
                onChange: (e) => setParams(p => ({ ...p, theta: parseFloat(e.target.value) || 0 })),
                style: { width: 45, height: 22, marginLeft: 4, backgroundColor: c.bg, color: c.text,
                         border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11, padding: '0 4px' }
            }),
            '°'
        ),
        // Targets toggle, drawn as Optical Evaluation draws its own so the two
        // windows read the same. Disabled when the design has no operands.
        h('div', { style: { marginLeft: 'auto' } },
            h(ToggleButton, {
                c, label: v.targets, active: showTargets && hasTargets, disabled: !hasTargets,
                title: hasTargets ? v.targetsOn : v.targetsNone,
                onClick: () => setShowTargets(p => !p),
            }, h('div', {
                style: {
                    width: 14, height: 0,
                    borderTop: `2px dotted ${showTargets && hasTargets ? c.accent : c.textDim}`,
                },
            })),
        ),
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11,
                               color: c.text, cursor: 'pointer' } },
            h(Checkbox, {
                c, checked: showBaseline,
                onChange: (e) => setShowBaseline(e.target.checked),
            }),
            v.showBaseline || 'Show baseline overlay'
        )
    );
}
