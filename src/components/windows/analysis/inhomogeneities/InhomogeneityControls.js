import { EvalModeBadge } from '../../../SurfaceModeBar.js';
import { SpecVerdict } from '../../../SpecVerdict.js';
import { totalInterlayerThickness } from '../../../../utils/physics/inhomogeneity.js';
import { controlStyles, numField } from './ui.js';

const { createElement: h } = React;

export function InhomogeneityControls(props) {
    const {
        design, c, t, ih, inh, specInputs,
        channel, setChannel, lambdaStart, setLambdaStart,
        lambdaEnd, setLambdaEnd, lambdaStep, setLambdaStep,
        aoi, setAoi, pol, setPol, clearAll,
    } = props;
    const { inputStyle, labelStyle, segBtnStyle } = controlStyles(c);
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: '5px 10px', borderBottom: `1px solid ${c.border}`,
            background: c.panel, flexShrink: 0, fontSize: 11,
        }
    },
        h(EvalModeBadge, { design, c, t }),
        h('div', { style: { width: 1, height: 20, background: c.border } }),
        h('label', { style: labelStyle }, 'λ',
            numField(lambdaStart, setLambdaStart, { ...inputStyle, width: 56, marginLeft: 4 }, { fallback: 0 }),
            h('span', { style: { margin: '0 2px' } }, '–'),
            numField(lambdaEnd, setLambdaEnd, { ...inputStyle, width: 56 }, { fallback: 0 }),
            h('span', { style: { marginLeft: 4 } }, 'nm'),
        ),
        h('label', { style: labelStyle }, ih.step || 'step',
            numField(lambdaStep, value => setLambdaStep(value > 0 ? value : 1),
                { ...inputStyle, width: 48, marginLeft: 4 }, { fallback: 1 }),
        ),
        h('label', { style: labelStyle }, 'AOI',
            numField(aoi, setAoi, { ...inputStyle, width: 48, marginLeft: 4 }, { fallback: 0 }),
            h('span', null, '°'),
        ),
        h('label', { style: labelStyle }, 'pol',
            h('select', {
                value: pol, onChange: event => setPol(event.target.value),
                style: { ...inputStyle, marginLeft: 4 },
            }, ['avg', 's', 'p'].map(value => h('option', { key: value, value }, value))),
        ),
        h('div', { style: { width: 1, height: 20, background: c.border } }),
        h('div', { style: { display: 'flex', gap: 2 } },
            ['all', 'T', 'R', 'A'].map(key => h('button', {
                key, onClick: () => setChannel(key), style: segBtnStyle(channel === key),
            }, key === 'all' ? 'T+R+A' : key)),
        ),
        h('div', { style: { width: 1, height: 20, background: c.border } }),
        h('button', {
            onClick: clearAll, disabled: !(inh.interlayers?.length),
            style: {
                padding: '2px 8px', background: c.inputBg || c.hover, color: c.text,
                border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11,
                cursor: inh.interlayers?.length ? 'pointer' : 'default',
                opacity: inh.interlayers?.length ? 1 : 0.4,
            }
        }, ih.clearAll || 'Clear all'),
        (design?.qualifiers?.length > 0 && specInputs) && h('div', { style: { marginLeft: 'auto' } },
            h(SpecVerdict, {
                design: specInputs.specDesign, resolveMat: specInputs.resolve, c, t,
                label: (t.specification && t.specification.specLabel) || 'Spec:',
            }),
        ),
        h('span', {
            style: {
                marginLeft: design?.qualifiers?.length > 0 ? 12 : 'auto',
                color: c.textDim, fontSize: 11,
            }
        },
            `${[...(inh.interlayers || []), ...(inh.backInterlayers || [])].filter(il => il.enabled !== false).length} ${ih.activeInterlayers || 'active'} · `,
            `Σ ${totalInterlayerThickness(inh).toFixed(2)} nm`,
        ),
    );
}
