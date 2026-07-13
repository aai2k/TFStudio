import { EvalModeBadge } from '../../../SurfaceModeBar.js';
import { numField } from './controls.js';

const { createElement: h } = React;

export function RoughnessToolbar(props) {
    const {
        design, c, t, rs, calc, nIfaces, clearAll,
        lambdaStart, setLambdaStart, lambdaEnd, setLambdaEnd,
        lambdaStep, setLambdaStep, aoi, setAoi, pol, setPol, units, setUnits,
        labelStyle, inputStyle, segBtnStyle,
    } = props;
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
            numField(lambdaStart, setLambdaStart, { ...inputStyle, marginLeft: 4 }, { fallback: 0 }),
            h('span', { style: { margin: '0 2px' } }, '–'),
            numField(lambdaEnd, setLambdaEnd, inputStyle, { fallback: 0 }),
            h('span', { style: { marginLeft: 4 } }, 'nm'),
        ),
        h('label', { style: labelStyle }, rs.step || 'step',
            numField(lambdaStep, setLambdaStep, { ...inputStyle, width: 48, marginLeft: 4 }, { fallback: 1 })
        ),
        h('label', { style: labelStyle }, 'AOI',
            numField(aoi, setAoi, { ...inputStyle, width: 48, marginLeft: 4 }, { fallback: 0 }),
            h('span', null, '°'),
        ),
        h('label', { style: labelStyle }, 'pol',
            h('select', { value: pol, onChange: event => setPol(event.target.value), style: { ...inputStyle, width: 'auto', marginLeft: 4 } },
                ['avg', 's', 'p'].map(value => h('option', { key: value, value }, value)))
        ),
        h('div', { style: { width: 1, height: 20, background: c.border } }),
        h('div', { style: { display: 'flex', gap: 2 } },
            h('button', { onClick: () => setUnits('ppm'), style: segBtnStyle(units === 'ppm') }, 'ppm'),
            h('button', { onClick: () => setUnits('frac'), style: segBtnStyle(units === 'frac') }, 'frac'),
        ),
        h('div', { style: { width: 1, height: 20, background: c.border } }),
        h('button', {
            onClick: clearAll,
            style: {
                padding: '2px 8px', background: c.inputBg || c.hover, color: c.text,
                border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11, cursor: 'pointer',
            }
        }, rs.clear || 'Reset'),
        h('span', { style: { marginLeft: 'auto', color: c.textDim, fontSize: 11 } },
            calc ? `σ_eff = ${calc.sigmaEff.toFixed(2)} nm  ·  ${nIfaces} ${rs.interfaces || 'interfaces'}` : ''
        ),
    );
}
