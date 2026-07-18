import { EvalModeBadge, ConeBadge } from '../../../SurfaceModeBar.js';
import { Checkbox } from '../../../ui/Checkbox.js';
import { FieldLabel } from './controls.js';
import { AoiChips } from './AoiChips.js';

const { createElement: h } = React;

export function EvaluationToolbar(props) {
    const {
        design, c, t, oe, params,
        setThetas, autoCalc, setAutoCalc, compute, computing,
    } = props;
    const fieldBlock = {
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '3px 8px', backgroundColor: c.bg,
        border: `1px solid ${c.border}`, borderRadius: 4, flexShrink: 0
    };
    return h('div', {
        style: {
            display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            gap: 8, rowGap: 6,
            padding: '6px 10px', borderBottom: `1px solid ${c.border}`,
            backgroundColor: c.panel, flexShrink: 0
        }
    },
        h(EvalModeBadge, { design, c, t }),
        h(ConeBadge, { design, c, t }),
        h('div', { style: fieldBlock },
            h(FieldLabel, { c }, oe.aoiDeg),
            h(AoiChips, { values: params.thetas, onChange: setThetas, c, oe })
        ),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto', flexShrink: 0 } },
            h('label', {
                style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', color: c.text }
            },
                h(Checkbox, { c, checked: autoCalc, onChange: event => setAutoCalc(event.target.checked) }),
                oe.autoLabel
            ),
            !autoCalc && h('button', {
                onClick: compute, disabled: computing,
                style: {
                    padding: '3px 12px', fontSize: 12, cursor: 'pointer',
                    border: `1px solid ${c.accent}`, borderRadius: 3,
                    backgroundColor: c.accent + '33', color: c.accent,
                    outline: 'none', fontFamily: 'system-ui'
                }
            }, computing ? oe.calculating : oe.calculate)
        )
    );
}
