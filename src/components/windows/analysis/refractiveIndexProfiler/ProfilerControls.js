import { ChoiceGroup, NumInput } from '../chrome/controls.js';
import { ControlRow } from '../chrome/layout.js';
import { NoticeBadge, SettingRow, SettingsMenu } from '../chrome/popover.js';

const { createElement: h } = React;

const SIDE_COLORS = { front: '#1e88e5', back: '#e53935', total: '#ab47bc' };

/** Which profile is plotted; the wavelength it is sampled at is a setting. */
export function ProfilerControls({ c, t, rp, state, notices }) {
    return h(ControlRow, {
        c,
        trailing: [
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            h(ProfilerSetup, { key: 'setup', c, t, rp, state }),
        ],
    },
        h(ChoiceGroup, {
            label: rp.quantity, activeId: state.quantity, onSelect: state.setQuantity, c,
            items: [
                { id: 'n', label: rp.qN },
                { id: 'k', label: rp.qK },
                { id: 'both', label: rp.qBoth },
            ],
        }),
        h(ChoiceGroup, {
            label: rp.side, ariaLabel: rp.side,
            activeId: state.side, onSelect: state.setSide, c,
            items: [
                { id: 'front', label: rp.front, color: SIDE_COLORS.front },
                { id: 'back', label: rp.back, color: SIDE_COLORS.back },
                { id: 'total', label: rp.total, color: SIDE_COLORS.total },
            ],
        }),
    );
}

function ProfilerSetup({ c, t, rp, state }) {
    return h(SettingsMenu, { c, label: t.analysisChrome.settings },
        h(SettingRow, { c, label: rp.wavelength },
            h(NumInput, {
                value: state.lambda, min: 100, max: 10000, step: 10, c, width: 72,
                onChange: state.setLambda,
            }),
        ),
    );
}
