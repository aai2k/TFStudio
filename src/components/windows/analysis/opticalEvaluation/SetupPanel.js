import {
    SPECTRAL_UNITS, SPECTRAL_UNIT_IDS, spectralRangeControl, toNm,
} from '../../../../utils/physics/spectralAxis.js';
import { CheckField, NumInput, SelectField } from '../chrome/controls.js';
import { SettingDivider, SettingRow, SettingsMenu } from '../chrome/popover.js';
import { AoiChips } from './AoiChips.js';
import { Y_SCALE_IDS, yRangeControl, yScaleOf } from './yScale.js';

const { createElement: h } = React;

function SpectralRange({ c, oe, params, setParams, spectralUnit, setSpectralUnit }) {
    const range = spectralRangeControl(spectralUnit, params.lambdaStart, params.lambdaEnd);
    return h(React.Fragment, null,
        h(SettingRow, { c, label: range.symbol },
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
            h(SelectField, {
                c, value: spectralUnit, onChange: setSpectralUnit,
                options: SPECTRAL_UNIT_IDS.map(id => ({ id, label: SPECTRAL_UNITS[id].short })),
            }),
        ),
        h(SettingRow, { c, label: oe.stepNm },
            h(NumInput, {
                value: params.lambdaStep, min: 0.1, max: 100, step: 0.5, c, width: 62,
                onChange: value => setParams(current => ({ ...current, lambdaStep: value }))
            }),
        ),
    );
}

const Y_BOUNDS = { min: -10, max: 200 };

// The bounds stay in place while Auto is on, disabled rather than hidden, so
// ticking the box does not resize the panel under the pointer. They are stored
// as percentages whichever unit is selected, so the two ends of the range keep
// their meaning when the unit changes under them.
function VerticalRange({ c, oe, yAuto, setYAuto, yMin, setYMin, yMax, setYMax, yScale, setYScale }) {
    const range = yRangeControl(yScale, yMin, yMax, Y_BOUNDS);
    return h(SettingRow, { c, label: 'Y' },
        h(CheckField, {
            c, label: oe.yAuto, checked: yAuto,
            onChange: event => setYAuto(event.target.checked),
        }),
        h(NumInput, {
            value: range.start, min: range.min, max: range.max, step: range.step,
            c, width: 56, disabled: yAuto,
            onChange: value => setYMin(range.clampMin(value))
        }),
        h('span', { style: { color: c.textDim, fontSize: 11 } }, '–'),
        h(NumInput, {
            value: range.end, min: range.min, max: range.max, step: range.step,
            c, width: 56, disabled: yAuto,
            onChange: value => setYMax(range.clampMax(value))
        }),
        h(SelectField, {
            c, value: yScaleOf(yScale).id, onChange: setYScale,
            options: Y_SCALE_IDS.map(id => ({ id, label: yScaleOf(id).short })),
        }),
    );
}

/**
 * Everything the spectrum is computed and drawn over: the angles, the spectral
 * range and step, and the vertical range.
 */
export function SetupPanel(props) {
    const { c, t, oe, params, setThetas } = props;
    return h(SettingsMenu, {
        c, t, windowId: 'opticalEvaluation', label: t.analysisChrome.settings, width: 340,
    },
        h(SettingRow, { c, label: oe.aoi, wrap: true },
            h(AoiChips, { values: params.thetas, onChange: setThetas, c, oe }),
        ),
        h(SettingDivider, { c }),
        h(SpectralRange, props),
        h(VerticalRange, props),
    );
}
