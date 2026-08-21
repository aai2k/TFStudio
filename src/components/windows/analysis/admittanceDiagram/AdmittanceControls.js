import { ChoiceGroup, NumInput } from '../chrome/controls.js';
import { ControlRow } from '../chrome/layout.js';
import { NoticeBadge, SettingRow, SettingsMenu } from '../chrome/popover.js';

const { createElement: h } = React;

// Front and back carry the same colours here as everywhere else a side is
// chosen, so the two windows can be read side by side.
const SIDE_COLORS = { front: '#1e88e5', back: '#e53935' };

/**
 * Which plane the loci are drawn in and for which polarization and side; the
 * wavelength and angle they are computed at are settings.
 */
export function AdmittanceControls({ c, t, state, notices }) {
    const ad = t.admittance;
    return h(ControlRow, {
        c,
        trailing: [
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            h(AdmittanceSetup, { key: 'setup', c, t, state }),
        ],
    },
        h(ChoiceGroup, {
            label: ad.plane, ariaLabel: ad.plane,
            activeId: state.view, onSelect: state.setView, c,
            items: [
                { id: 'admittance', label: 'Y', title: ad.planeY },
                { id: 'reflection', label: 'Γ', title: ad.planeGamma },
            ],
        }),
        h(ChoiceGroup, {
            label: ad.polarization, ariaLabel: ad.polarization,
            activeId: state.pol, onSelect: state.setPol, c,
            items: [
                { id: 'avg', label: ad.polAvg },
                { id: 's', label: ad.polS },
                { id: 'p', label: ad.polP },
            ],
        }),
        h(ChoiceGroup, {
            label: ad.side, ariaLabel: ad.side,
            activeId: state.side, onSelect: state.setSide, c,
            items: [
                { id: 'front', label: ad.front, color: SIDE_COLORS.front },
                { id: 'back', label: ad.back, color: SIDE_COLORS.back },
            ],
        }),
    );
}

function AdmittanceSetup({ c, t, state }) {
    const ad = t.admittance;
    return h(SettingsMenu, {
        c, t, windowId: 'admittanceDiagram', label: t.analysisChrome.settings,
    },
        h(SettingRow, { c, label: ad.wavelength },
            h(NumInput, {
                value: state.lambda, min: 100, max: 30000, step: 1, c, width: 72,
                onChange: state.setLambda,
            }),
        ),
        h(SettingRow, { c, label: ad.aoi },
            h(NumInput, {
                value: state.theta, min: 0, max: 89, step: 0.5, c, width: 60,
                onChange: state.setTheta,
            }),
        ),
    );
}
