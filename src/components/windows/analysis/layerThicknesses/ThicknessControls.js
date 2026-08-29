import { ChoiceGroup, NumInput } from '../chrome/controls.js';
import { ControlRow } from '../chrome/layout.js';
import { NoticeBadge, SettingRow, SettingsMenu } from '../chrome/popover.js';

const { createElement: h } = React;

const SIDE_COLORS = { front: '#1e88e5', back: '#e53935' };

/** The unit the bars read in and the coating they show; λ₀ is a setting. */
export function ThicknessControls({ c, t, lt, state, notices }) {
    return h(ControlRow, {
        c,
        trailing: [
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            h(ThicknessSetup, { key: 'setup', c, t, lt, state }),
        ],
    },
        h(ChoiceGroup, {
            label: lt.units, activeId: state.units, onSelect: state.setUnits, c,
            items: [
                { id: 'nm',   label: 'nm', title: lt.unitNmTip },
                { id: 'OT',   label: 'OT', title: lt.unitOtTip },
                { id: 'QWOT', label: 'QW', title: lt.unitQwotTip },
                { id: 'FWOT', label: 'FW', title: lt.unitFwotTip },
            ],
        }),
        h(ChoiceGroup, {
            label: lt.side, ariaLabel: lt.side,
            activeId: state.side, onSelect: state.setSide, c,
            items: [
                { id: 'front', label: lt.front, color: SIDE_COLORS.front },
                { id: 'back', label: lt.back, color: SIDE_COLORS.back },
            ],
        }),
    );
}

function ThicknessSetup({ c, t, lt, state }) {
    return h(SettingsMenu, {
        c, t, windowId: 'layerThicknesses', label: t.analysisChrome.settings,
    },
        h(SettingRow, { c, label: lt.wavelength },
            h(NumInput, {
                value: state.lambda, min: 100, max: 10000, step: 10, c, width: 72,
                onChange: state.setLambda,
            }),
        ),
    );
}
