import { Checkbox } from '../../../ui/Checkbox.js';
import { SPECTRAL_UNITS, SPECTRAL_UNIT_IDS } from '../../../../utils/physics/spectralAxis.js';
import { FieldLabel, NumInput } from './controls.js';

const { createElement: h } = React;

// Axis controls strip shown directly beneath the plot: the spectral (x) axis
// extent/step/unit and the y (%) axis scaling. Kept out of the top toolbars so
// the scale controls sit next to the axes they drive.

function fieldBlockStyle(c) {
    return {
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '3px 8px', backgroundColor: c.bg,
        border: `1px solid ${c.border}`, borderRadius: 4, flexShrink: 0
    };
}

function SpectralAxisControls({ c, oe, params, setParams, spectralUnit, setSpectralUnit }) {
    return h('div', { style: fieldBlockStyle(c) },
        h(FieldLabel, { c }, oe.wavelength),
        h(NumInput, {
            value: params.lambdaStart, min: 100, max: 20000, step: 10, c, width: 56,
            onChange: value => setParams(current => ({ ...current, lambdaStart: value }))
        }),
        h('span', { style: { color: c.textDim, fontSize: 11 } }, '–'),
        h(NumInput, {
            value: params.lambdaEnd, min: 100, max: 20000, step: 10, c, width: 56,
            onChange: value => setParams(current => ({ ...current, lambdaEnd: value }))
        }),
        h('span', { style: { width: 8 } }),
        h(FieldLabel, { c }, oe.step),
        h(NumInput, {
            value: params.lambdaStep, min: 0.1, max: 100, step: 0.5, c, width: 50,
            onChange: value => setParams(current => ({ ...current, lambdaStep: value }))
        }),
        h('span', { style: { width: 8 } }),
        h(FieldLabel, { c }, oe.axisUnit),
        h('select', {
            value: spectralUnit,
            onChange: event => setSpectralUnit(event.target.value),
            style: {
                background: c.bg, color: c.text, border: `1px solid ${c.border}`,
                borderRadius: 3, fontSize: 11, padding: '2px 4px', cursor: 'pointer',
            }
        }, SPECTRAL_UNIT_IDS.map(id => h('option', { key: id, value: id }, SPECTRAL_UNITS[id].short)))
    );
}

function YAxisControls({ c, oe, yAuto, setYAuto, yMin, setYMin, yMax, setYMax }) {
    return h('div', { style: fieldBlockStyle(c) },
        h(FieldLabel, { c }, oe.yAxis),
        h('label', {
            style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', color: c.text, whiteSpace: 'nowrap' }
        },
            h(Checkbox, { c, checked: yAuto, onChange: event => setYAuto(event.target.checked) }),
            oe.yAuto
        ),
        !yAuto && h(NumInput, {
            value: yMin, min: -10, max: 200, step: 5, c, width: 48,
            onChange: value => setYMin(Math.min(value, yMax - 1))
        }),
        !yAuto && h('span', { style: { color: c.textDim, fontSize: 11 } }, '–'),
        !yAuto && h(NumInput, {
            value: yMax, min: -10, max: 200, step: 5, c, width: 48,
            onChange: value => setYMax(Math.max(value, yMin + 1))
        })
    );
}

export function AxisPanel(props) {
    const { c } = props;
    return h('div', {
        style: {
            display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            gap: 8, rowGap: 6,
            padding: '5px 10px', borderTop: `1px solid ${c.border}`,
            backgroundColor: c.panel + 'aa', flexShrink: 0
        }
    },
        h(SpectralAxisControls, props),
        h(YAxisControls, props)
    );
}
