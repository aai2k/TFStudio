import { ChoiceGroup, NumInput } from '../chrome/controls.js';
import { ControlRow } from '../chrome/layout.js';
import { NoticeBadge, SettingRow, SettingsMenu } from '../chrome/popover.js';

const { createElement: h } = React;

// Front and back carry the same colours here as everywhere else a side is
// chosen, so the two windows can be read side by side.
const SIDE_COLORS = { front: '#1e88e5', back: '#e53935' };

/** Which field is plotted; the wavelength and angle it is computed at are settings. */
export function EFieldControls({ c, t, ef, state, notices }) {
    return h(ControlRow, {
        c,
        trailing: [
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            h(EFieldSetup, { key: 'setup', c, t, ef, state }),
        ],
    },
        h(ChoiceGroup, {
            label: ef.polarization, activeId: state.pol, onSelect: state.setPol, c,
            items: [
                { id: 'avg', label: ef.polAvg },
                { id: 's', label: ef.polS },
                { id: 'p', label: ef.polP },
            ],
        }),
        h(ChoiceGroup, {
            label: ef.side, ariaLabel: ef.side,
            activeId: state.side, onSelect: state.setSide, c,
            items: [
                { id: 'front', label: ef.front, color: SIDE_COLORS.front },
                { id: 'back', label: ef.back, color: SIDE_COLORS.back },
            ],
        }),
    );
}

function EFieldSetup({ c, t, ef, state }) {
    return h(SettingsMenu, {
        c, t, windowId: 'eFieldEvaluation', label: t.analysisChrome.settings,
    },
        h(SettingRow, { c, label: ef.wavelength },
            h(NumInput, {
                value: state.lambda, min: 100, max: 10000, step: 10, c, width: 72,
                onChange: state.setLambda,
            }),
        ),
        h(SettingRow, { c, label: ef.aoi },
            h(NumInput, {
                value: state.theta, min: 0, max: 89, step: 1, c, width: 60,
                onChange: state.setTheta,
            }),
        ),
    );
}
