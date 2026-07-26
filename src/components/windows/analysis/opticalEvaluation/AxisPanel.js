import { Checkbox } from '../../../ui/Checkbox.js';
import {
    SPECTRAL_UNITS, SPECTRAL_UNIT_IDS, spectralRangeControl, toNm,
} from '../../../../utils/physics/spectralAxis.js';
import { FieldLabel, NumInput } from './controls.js';

const { createElement: h } = React;

function SpectralAxisControls({ c, oe, params, setParams, spectralUnit, setSpectralUnit }) {
    const range = spectralRangeControl(spectralUnit, params.lambdaStart, params.lambdaEnd);
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 } },
        h(FieldLabel, { c }, range.symbol),
        h(NumInput, {
            value: range.start, min: range.min, max: range.max, step: range.step, c, width: 62,
            onChange: value => setParams(current => ({
                ...current, lambdaStart: toNm(value, spectralUnit)
            }))
        }),
        h('span', { style: { color: c.textDim, fontSize: 11 } }, '–'),
        h(NumInput, {
            value: range.end, min: range.min, max: range.max, step: range.step, c, width: 62,
            onChange: value => setParams(current => ({
                ...current, lambdaEnd: toNm(value, spectralUnit)
            }))
        }),
        h('select', {
            value: spectralUnit,
            onChange: event => setSpectralUnit(event.target.value),
            style: {
                height: 24, background: c.field, color: c.text, border: `1px solid ${c.border}`,
                borderRadius: 3, fontSize: 11, padding: '0 5px', cursor: 'pointer',
            }
        }, SPECTRAL_UNIT_IDS.map(id => h('option', { key: id, value: id }, SPECTRAL_UNITS[id].short))),
        h(FieldLabel, { c }, oe.stepNm),
        h(NumInput, {
            value: params.lambdaStep, min: 0.1, max: 100, step: 0.5, c, width: 50,
            onChange: value => setParams(current => ({ ...current, lambdaStep: value }))
        })
    );
}

function YAxisControls({ c, oe, yAuto, setYAuto, yMin, setYMin, yMax, setYMax }) {
    return h('div', {
        style: { display: 'flex', alignItems: 'center', gap: 7, marginLeft: 'auto', flexShrink: 0 }
    },
        h(FieldLabel, { c }, 'Y'),
        !yAuto && h(NumInput, {
            value: yMin, min: -10, max: 200, step: 5, c, width: 50,
            onChange: value => setYMin(Math.min(value, yMax - 1))
        }),
        !yAuto && h('span', { style: { color: c.textDim, fontSize: 11 } }, '–'),
        !yAuto && h(NumInput, {
            value: yMax, min: -10, max: 200, step: 5, c, width: 50,
            onChange: value => setYMax(Math.max(value, yMin + 1))
        }),
        !yAuto && h('span', { style: { color: c.textDim, fontSize: 11 } }, '%'),
        h('label', {
            style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', color: c.text, whiteSpace: 'nowrap' }
        },
            h(Checkbox, { c, checked: yAuto, onChange: event => setYAuto(event.target.checked) }),
            oe.yAuto
        )
    );
}

export function AxisPanel(props) {
    const { c } = props;
    return h('div', {
        style: {
            display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            gap: 8, rowGap: 6,
            padding: '7px 12px', borderTop: `1px solid ${c.border}`,
            backgroundColor: c.panel, flexShrink: 0
        }
    },
        h(SpectralAxisControls, props),
        h(YAxisControls, props)
    );
}
