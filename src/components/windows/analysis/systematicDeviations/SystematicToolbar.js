import { EvalModeBadge } from '../../../SurfaceModeBar.js';
import { Checkbox } from '../../../ui/Checkbox.js';
import { isIdentityDeviation } from '../../../../utils/physics/systematicDeviations.js';
import { NumberInput, SegBtn, controlStyles } from './ui.js';

const { createElement: h } = React;

function ChannelButtons({ channel, setChannel, c }) {
    return h('div', { style: { display: 'flex', gap: 2 } },
        h(SegBtn, { active: channel === 'all', onClick: () => setChannel('all'), label: 'T+R+A', c }),
        h(SegBtn, { active: channel === 'T', onClick: () => setChannel('T'), label: 'T', c }),
        h(SegBtn, { active: channel === 'R', onClick: () => setChannel('R'), label: 'R', c }),
        h(SegBtn, { active: channel === 'A', onClick: () => setChannel('A'), label: 'A', c }),
    );
}

export function SystematicToolbar({ controller, c, t, sd }) {
    const state = controller;
    const { lbl } = controlStyles(c);
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: '5px 10px', borderBottom: `1px solid ${c.border}`,
            background: c.panel, flexShrink: 0, fontSize: 11,
        }
    },
        h('div', { style: { display: 'flex', gap: 2 } },
            h(SegBtn, { active: state.mode === 'single', onClick: () => state.setMode('single'), label: sd.modeSingle || 'Single', c }),
            h(SegBtn, { active: state.mode === 'sweep', onClick: () => state.setMode('sweep'), label: sd.modeSweep || 'Sweep', c }),
        ),
        h('div', { style: { width: 1, height: 20, background: c.border } }),
        h('label', { style: lbl }, 'λ',
            h(NumberInput, { value: state.lambdaStart, step: 10, onChange: state.setLambdaStart, c, width: 56 }),
            h('span', { style: { margin: '0 2px' } }, '–'),
            h(NumberInput, { value: state.lambdaEnd, step: 10, onChange: state.setLambdaEnd, c, width: 56 }),
            h('span', { style: { margin: '0 4px', color: c.textDim } }, 'nm'),
        ),
        h('label', { style: lbl }, sd.step || 'step',
            h(NumberInput, { value: state.lambdaStep, step: 1, min: 0.5, max: 50, onChange: state.setLambdaStep, c, width: 48 }),
        ),
        h('label', { style: lbl }, 'AOI',
            h(NumberInput, { value: state.aoi, step: 5, min: 0, max: 89, onChange: state.setAoi, c, width: 48 }),
            h('span', { style: { color: c.textDim, marginLeft: 2 } }, '°'),
        ),
        h('label', { style: lbl }, 'pol',
            h('select', {
                value: state.pol, onChange: (event) => state.setPol(event.target.value),
                style: {
                    background: c.inputBg || c.hover, color: c.text,
                    border: `1px solid ${c.border}`, borderRadius: 3,
                    padding: '1px 4px', fontSize: 11, marginLeft: 4,
                }
            }, ['avg', 's', 'p'].map(pol => h('option', { key: pol, value: pol }, pol)))
        ),
        h('div', { style: { width: 1, height: 20, background: c.border } }),
        state.mode === 'single' && h(ChannelButtons, { channel: state.channel, setChannel: state.setChannel, c }),
        state.mode === 'sweep' && h(ChannelButtons, { channel: state.sweepChannel, setChannel: state.setSweepChannel, c }),
        state.mode === 'single' && h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: c.text, fontSize: 11 } },
            h(Checkbox, {
                c, checked: state.showBaseline,
                onChange: (event) => state.setShowBaseline(event.target.checked),
            }),
            sd.baseline || 'baseline'
        ),
        state.mode === 'single' && h('button', {
            onClick: state.resetDeviation, disabled: isIdentityDeviation(state.dev),
            style: {
                padding: '2px 8px',
                background: c.inputBg || c.hover, color: c.text,
                border: `1px solid ${c.border}`, borderRadius: 3,
                fontSize: 11, cursor: isIdentityDeviation(state.dev) ? 'default' : 'pointer',
                opacity: isIdentityDeviation(state.dev) ? 0.4 : 1,
            }
        }, sd.reset || 'Reset deviations'),
        h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 } },
            h(EvalModeBadge, { design: state.design, c, t }),
        ),
    );
}
