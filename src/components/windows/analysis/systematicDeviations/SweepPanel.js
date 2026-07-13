import { defaultSweepRange, sweepOptions, sweepParamKind } from './model.js';
import { NumberInput, UnitSelect, controlStyles } from './ui.js';

const { createElement: h } = React;

export function SweepPanel({ controller, c, sd }) {
    const { sweep, setSweep, uniqueMats, runSweep, sweepRunning } = controller;
    const { sectionTitle, fieldRow, lbl, unit } = controlStyles(c);
    const options = sweepOptions(uniqueMats, sd);
    return h('div', {
        style: { padding: '6px 8px 10px', borderBottom: `1px solid ${c.border}`, flexShrink: 0 }
    },
        h('div', { style: sectionTitle }, sd.sweepSection || 'Parameter sweep'),
        h('div', { style: { marginBottom: 4 } },
            h('select', {
                value: sweep.param,
                onChange: (event) => {
                    const param = event.target.value;
                    setSweep(current => ({ ...current, param, ...defaultSweepRange(param, current.offsetUnit) }));
                },
                style: {
                    width: '100%', background: c.inputBg || c.hover, color: c.text,
                    border: `1px solid ${c.border}`, borderRadius: 3,
                    padding: '2px 4px', fontSize: 11,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                }
            }, options.map(option => h('option', { key: option.value, value: option.value }, option.label)))
        ),
        sweepParamKind(sweep.param) === 'offset' && h('div', {
            style: fieldRow, title: sd.sweepUnitTip || 'Unit for the swept offset range: nm / OT / QW / FW at the design reference λ₀.'
        },
            h('span', { style: lbl }, sd.sweepUnit || 'unit'),
            h(UnitSelect, { value: sweep.offsetUnit || 'nm',
                onChange: (value) => setSweep(current => ({ ...current, offsetUnit: value, ...defaultSweepRange(current.param, value) })), c }),
            h('span', { style: unit }, ''),
        ),
        h('div', { style: fieldRow },
            h('span', { style: lbl }, sd.from || 'from'),
            h(NumberInput, { value: sweep.from, step: 0.01,
                onChange: (value) => setSweep(current => ({ ...current, from: value })), c }),
            h('span', { style: unit }, ''),
        ),
        h('div', { style: fieldRow },
            h('span', { style: lbl }, sd.to || 'to'),
            h(NumberInput, { value: sweep.to, step: 0.01,
                onChange: (value) => setSweep(current => ({ ...current, to: value })), c }),
            h('span', { style: unit }, ''),
        ),
        h('div', { style: fieldRow },
            h('span', { style: lbl }, sd.steps || 'steps'),
            h(NumberInput, { value: sweep.steps, step: 1, min: 2, max: 200,
                onChange: (value) => setSweep(current => ({ ...current, steps: Math.max(2, Math.floor(value)) })), c }),
            h('span', { style: unit }, ''),
        ),
        h('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
            h('button', {
                onClick: runSweep, disabled: sweepRunning,
                style: {
                    flex: 1, padding: '4px 10px',
                    background: sweepRunning ? c.hover : c.accent,
                    color: '#fff', border: 'none', borderRadius: 3,
                    fontSize: 12, cursor: sweepRunning ? 'default' : 'pointer',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                }
            }, sweepRunning ? (sd.running || 'Running…') : (sd.runSweep || '▶ Run sweep')),
        ),
        h('div', {
            style: {
                marginTop: 8, fontSize: 10.5, lineHeight: 1.4, color: c.textDim,
                fontStyle: 'italic',
            }
        }, sd.sweepNote || 'Sweep varies only the parameter above, starting from the unperturbed design. To combine a fixed deviation with a sweep, set it up in Single mode.'),
    );
}
