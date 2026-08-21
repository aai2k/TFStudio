import { ILLUMINANTS, OBSERVERS } from '../../../../utils/physics/colorimetry.js';
import { ChoiceGroup, NumInput, SelectField } from '../chrome/controls.js';
import { ControlRow } from '../chrome/layout.js';
import { NoticeBadge, SettingDivider, SettingRow, SettingsMenu } from '../chrome/popover.js';

const { createElement: h } = React;

/**
 * Which spectrum the colour is computed from. The observer, illuminant and the
 * geometry it is evaluated at are settings.
 */
export function ColorControls({ c, t, ce, state, notices }) {
    return h(ControlRow, {
        c,
        trailing: [
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            h(ColorSetup, { key: 'setup', c, t, ce, state }),
        ],
    },
        h(ChoiceGroup, {
            label: ce.characteristic, ariaLabel: ce.characteristic,
            activeId: state.characteristic, onSelect: state.setCharacteristic, c,
            items: [
                { id: 'R', label: ce.reflectance },
                { id: 'T', label: ce.transmittance },
            ],
        }),
    );
}

function ColorSetup({ c, t, ce, state }) {
    return h(SettingsMenu, {
        c, t, windowId: 'colorEvaluation', label: t.analysisChrome.settings, width: 320,
    },
        h(SettingRow, { c, label: ce.pol },
            h(ChoiceGroup, {
                ariaLabel: ce.pol, activeId: state.pol, onSelect: state.setPol, c,
                items: [
                    { id: 'avg', label: ce.polAvg },
                    { id: 's', label: 'S' },
                    { id: 'p', label: 'P' },
                ],
            }),
        ),
        h(SettingRow, { c, label: ce.aoi },
            h(NumInput, {
                value: state.theta, min: 0, max: 89, step: 1, c, width: 60,
                onChange: state.setTheta,
            }),
        ),
        h(SettingDivider, { c }),
        h(SettingRow, { c, label: ce.observer },
            h(SelectField, {
                value: state.observer, onChange: state.setObserver, c, width: 160,
                options: OBSERVERS,
            }),
        ),
        h(SettingRow, { c, label: ce.illuminant },
            h(SelectField, {
                value: state.illuminant, onChange: state.setIllum, c, width: 160,
                options: ILLUMINANTS,
            }),
        ),
        h(SettingRow, { c, label: ce.step },
            h(NumInput, {
                value: state.step, min: 1, max: 20, step: 1, c, width: 60,
                onChange: state.setStep,
            }),
        ),
        h(SettingDivider, { c }),
        h(SettingRow, { c, label: ce.exposure },
            h(SelectField, {
                value: state.exposure, onChange: state.setExposure, c, width: 130,
                options: [
                    { id: '1', label: ce.expAsIs },
                    { id: '10', label: '×10' },
                    { id: '50', label: '×50' },
                    { id: '200', label: '×200' },
                    { id: '1000', label: '×1000' },
                    { id: 'fit', label: ce.expFit },
                ],
            }),
        ),
        h('div', { style: { color: c.textDim, fontSize: 10, lineHeight: 1.5, padding: '6px 0 2px' } },
            ce.refNote),
    );
}
