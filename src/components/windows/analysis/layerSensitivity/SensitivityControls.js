import { CheckField, ChoiceGroup, FieldLabel, NumInput } from '../chrome/controls.js';
import { ControlRow } from '../chrome/layout.js';
import { SettingDivider, SettingRow, SettingsMenu } from '../chrome/popover.js';

const { createElement: h } = React;

/** Which scale the bars are drawn on; the perturbation they measure is a setting. */
export function SensitivityControls({ c, t, state }) {
    const ls = t.layerSensitivity;
    return h(ControlRow, {
        c,
        trailing: h(SensitivitySetup, { c, t, state }),
    },
        h(ChoiceGroup, {
            ariaLabel: ls.scaleNormalized,
            activeId: state.scale, onSelect: state.setScale, c,
            items: [
                { id: 'normalized', label: ls.scaleNormalized, title: ls.scaleNormalizedTip },
                { id: 'absolute', label: ls.scaleAbsolute, title: ls.scaleAbsoluteTip },
            ],
        }),
    );
}

/**
 * The perturbation applied to every layer: either a fraction of its own
 * thickness or a fixed thickness. Both fields stay on the panel with the unused
 * one disabled, so switching between them does not resize it.
 */
function SensitivitySetup({ c, t, state }) {
    const ls = t.layerSensitivity;
    const relative = state.mode === 'relative';
    return h(SettingsMenu, {
        c, t, windowId: 'layerSensitivity', label: t.analysisChrome.settings, width: 260,
    },
        h(SettingRow, { c, label: ls.absLabel },
            h(ChoiceGroup, {
                ariaLabel: ls.absLabel, activeId: state.mode, onSelect: state.setMode, c,
                items: [
                    { id: 'relative', label: ls.modeRelative },
                    { id: 'absolute', label: ls.modeAbsolute },
                ],
            }),
        ),
        h(SettingRow, { c, label: ls.relLabel },
            h(NumInput, {
                value: state.relPct, min: 0.01, max: 100, step: 0.1, c, width: 68,
                disabled: !relative, onChange: state.setRelPct,
            }),
            h(FieldLabel, { c }, '%'),
        ),
        h(SettingRow, { c, label: ls.absLabel },
            h(NumInput, {
                value: state.absDeltaNm, min: 0.001, max: 1000, step: 0.1, c, width: 68,
                disabled: relative, onChange: state.setAbsDeltaNm,
            }),
            h(FieldLabel, { c }, 'nm'),
        ),
        h(SettingDivider, { c }),
        h(SettingRow, { c, label: '' },
            h(CheckField, {
                c, label: ls.includeLocked, checked: state.includeLocked,
                onChange: event => state.setIncludeLocked(event.target.checked),
            }),
        ),
    );
}
