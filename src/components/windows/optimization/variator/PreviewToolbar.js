import { EvalModeBadge } from '../../../SurfaceModeBar.js';
import { Checkbox } from '../../../ui/Checkbox.js';

const { createElement: h } = React;

export function PreviewToolbar(props) {
    const {
        c, t, v, design, params, setParams,
        showTargets, setShowTargets, showBaseline, setShowBaseline,
    } = props;
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
            'AOI',
            h('input', {
                type: 'number', value: params.theta, min: 0, max: 89,
                onChange: (e) => setParams(p => ({ ...p, theta: parseFloat(e.target.value) || 0 })),
                style: { width: 45, height: 22, marginLeft: 4, backgroundColor: c.bg, color: c.text,
                         border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11, padding: '0 4px' }
            }),
            '°'
        ),
        // Targets toggle — disabled when the design has no operands.
        // Same yellow accent + dotted swatch as Optical Evaluation so
        // the two windows read the same.
        h('button', {
            onClick: () => setShowTargets(p => !p),
            disabled: !(design.meritOperands?.length),
            title: design.meritOperands?.length
                ? (v.targetsOn || 'Show merit function targets')
                : (v.targetsNone || 'No merit function targets defined'),
            style: {
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '2px 7px',
                cursor: design.meritOperands?.length ? 'pointer' : 'default',
                outline: 'none', marginLeft: 'auto',
                border: `1px solid ${showTargets ? '#ffd54f' : c.border}`,
                borderRadius: 3,
                backgroundColor: showTargets ? '#ffd54f22' : 'transparent',
                color: showTargets ? c.text : c.textDim,
                fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
                fontWeight: showTargets ? 600 : 400,
                opacity: design.meritOperands?.length ? 1 : 0.4
            }
        },
            h('div', { style: { width: 14, height: 0, borderTop: `2px dotted ${showTargets ? '#ffd54f' : c.textDim}` } }),
            v.targets || 'Targets'
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
