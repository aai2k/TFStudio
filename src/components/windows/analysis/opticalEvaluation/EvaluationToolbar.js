import { EvalModeBadge, ConeBadge } from '../../../SurfaceModeBar.js';
import { FieldLabel } from './controls.js';
import { AoiChips } from './AoiChips.js';

const { createElement: h } = React;

function AutoUpdateSwitch({ checked, onChange, c, label }) {
    return h('button', {
        onClick: () => onChange(!checked), role: 'switch', 'aria-checked': checked,
        style: {
            height: 28, display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '0 2px', border: 'none', backgroundColor: 'transparent',
            color: c.text, cursor: 'pointer', outline: 'none',
            fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif'
        }
    },
        h('span', {
            style: {
                width: 28, height: 16, padding: 2, display: 'flex', alignItems: 'center',
                justifyContent: checked ? 'flex-end' : 'flex-start', borderRadius: 9,
                backgroundColor: checked ? c.accent : c.borderStrong,
                transition: 'background-color 0.15s'
            }
        }, h('span', {
            style: {
                width: 12, height: 12, borderRadius: '50%', backgroundColor: c.accentText,
                boxShadow: '0 1px 2px rgba(0,0,0,0.25)'
            }
        })),
        label
    );
}

export function EvaluationToolbar(props) {
    const {
        design, c, t, oe, params,
        setThetas, autoCalc, setAutoCalc, compute, computing,
    } = props;
    return h('div', {
        style: {
            display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            gap: 10, rowGap: 5,
            padding: '7px 14px 4px',
            backgroundColor: c.panel, flexShrink: 0
        }
    },
        h(EvalModeBadge, { design, c, t }),
        h(ConeBadge, { design, c, t }),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 } },
            h(FieldLabel, { c }, oe.aoi),
            h(AoiChips, { values: params.thetas, onChange: setThetas, c, oe })
        ),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto', flexShrink: 0 } },
            h(AutoUpdateSwitch, { checked: autoCalc, onChange: setAutoCalc, c, label: oe.autoLabel }),
            !autoCalc && h('button', {
                onClick: compute, disabled: computing,
                style: {
                    height: 26, padding: '0 12px', fontSize: 11, cursor: 'pointer',
                    border: `1px solid ${c.accent}`, borderRadius: 3,
                    backgroundColor: c.accent + '33', color: c.accent,
                    outline: 'none', fontFamily: 'system-ui'
                }
            }, computing ? oe.calculating : oe.calculate)
        )
    );
}
