import { PROFILE_IDS } from '../../../../utils/physics/inhomogeneity.js';
import { Checkbox } from '../../../ui/Checkbox.js';
import {
    ActionButton, ChoiceGroup, NumInput, RangeField, SelectField,
} from '../chrome/controls.js';
import { ControlRow, EditorBody, EditorGroupTitle } from '../chrome/layout.js';
import { NoticeBadge, SettingRow, SettingsMenu } from '../chrome/popover.js';

const { createElement: h } = React;

// One column set for the header and every row, so they stay aligned as the
// window is resized. The interface name takes whatever width is left over.
const COLUMNS = 'minmax(120px, 1fr) 70px 110px 60px 20px';

/**
 * Which spectrum is overlaid. The interlayers themselves are edited in the
 * strip below the plot: there is one row per interface, and a hundred-layer
 * stack has a hundred of them.
 */
export function InhomogeneityControls({ c, t, ih, state, notices }) {
    return h(ControlRow, {
        c,
        trailing: [
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            h(InhomogeneitySetup, { key: 'setup', c, t, ih, state }),
        ],
    },
        h(ChoiceGroup, {
            label: ih.channel, ariaLabel: ih.channel,
            activeId: state.channel, onSelect: state.setChannel, c,
            items: [
                { id: 'all', label: 'T+R+A' },
                { id: 'T', label: 'T' },
                { id: 'R', label: 'R' },
                { id: 'A', label: 'A' },
            ],
        }),
        h(ChoiceGroup, {
            label: ih.polarization, ariaLabel: ih.polarization,
            activeId: state.pol, onSelect: state.setPol, c,
            items: [
                { id: 'avg', label: 'avg' },
                { id: 's', label: 's' },
                { id: 'p', label: 'p' },
            ],
        }),
    );
}

function InhomogeneitySetup({ c, t, ih, state }) {
    return h(SettingsMenu, {
        c, t, windowId: 'inhomogeneities', label: t.analysisChrome.settings, width: 300,
    },
        h(SettingRow, { c, label: 'λ' },
            h(RangeField, {
                c, unit: 'nm', width: 56,
                from: {
                    value: state.lambdaStart, min: 100, max: 30000, step: 10,
                    onChange: state.setLambdaStart,
                },
                to: {
                    value: state.lambdaEnd, min: 100, max: 30000, step: 10,
                    onChange: state.setLambdaEnd,
                },
            }),
        ),
        h(SettingRow, { c, label: ih.step },
            h(NumInput, {
                value: state.lambdaStep, min: 0.1, max: 1000, step: 1, c, width: 60,
                onChange: value => state.setLambdaStep(value > 0 ? value : 1),
            }),
        ),
        h(SettingRow, { c, label: ih.aoi },
            h(NumInput, {
                value: state.aoi, min: 0, max: 89, step: 1, c, width: 60,
                onChange: state.setAoi,
            }),
        ),
    );
}

/** Clear, in the editor strip's header. */
export function InhomogeneityEditorActions({ c, ih, state }) {
    const hasInterlayers = !!(state.inh.interlayers?.length || state.inh.backInterlayers?.length);
    return h(ActionButton, {
        c, label: ih.clearAll, disabled: !hasInterlayers, onClick: state.clearAll,
    });
}

export function InhomogeneityEditor({ c, ih, state }) {
    return h(EditorBody, { c },
        state.activeSides
            .filter(side => side === 'front' || state.hasBack)
            .map(side => h(InterfaceList, {
                key: side, side, c, ih, state, ifaces: state.interfaces[side],
            })),
        h('div', { style: { color: c.textDim, fontSize: 10, lineHeight: 1.5, padding: '8px 0 0' } },
            ih.helpText),
    );
}

function listTitle(side, ih, sideCount) {
    if (side === 'back') return ih.backInterfacesTitle;
    return sideCount > 1 ? ih.frontInterfacesTitle : ih.interfaceListTitle;
}

function InterfaceList({ side, ifaces, c, ih, state }) {
    const sideCount = state.activeSides.filter(s => s === 'front' || state.hasBack).length;
    const head = {
        fontSize: 10, color: c.textDim, fontWeight: 600,
        textTransform: 'uppercase', letterSpacing: '0.04em',
    };
    return h('div', null,
        h(EditorGroupTitle, { c }, listTitle(side, ih, sideCount)),
        h('div', {
            style: {
                display: 'grid', gridTemplateColumns: COLUMNS, gap: 8,
                padding: '0 0 3px', position: 'sticky', top: 0,
                backgroundColor: c.bg, zIndex: 1,
            },
        },
            h('span', { style: head }, ih.interface),
            h('span', { style: head }, ih.thickness),
            h('span', { style: head }, ih.profile),
            h('span', { style: head }, ih.slices),
            h('span', null),
        ),
        ifaces.map(iface => h(InterfaceRow, {
            key: `${side}:${iface.afterIndex}`, side, iface, c, ih, state,
        })),
    );
}

/**
 * One interface: whether it is graded, how thick the graded region is, how the
 * index runs across it, and how many homogeneous sub-layers stand in for it.
 * Editing any field switches the interface on, since a value nobody can see the
 * effect of is not what was meant.
 */
function InterfaceRow({ side, iface, c, ih, state }) {
    const interlayer = state.findInterlayer(side, iface.afterIndex);
    const enabled = interlayer ? interlayer.enabled !== false : false;
    const set = patch => state.upsertInterlayer(side, iface.afterIndex, patch);
    return h('div', {
        style: {
            display: 'grid', gridTemplateColumns: COLUMNS, gap: 8,
            alignItems: 'center', padding: '1px 0', minHeight: 26,
        },
    },
        h('label', {
            title: iface.label,
            style: {
                minWidth: 0, display: 'flex', alignItems: 'center', gap: 5,
                color: c.text, fontSize: 11, cursor: 'pointer',
            },
        },
            h(Checkbox, {
                c, checked: enabled,
                onChange: event => set({ enabled: event.target.checked }),
            }),
            h('span', {
                style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
            }, iface.label),
        ),
        h(NumInput, {
            value: interlayer?.thickness ?? 5, min: 0, max: 1000, step: 1, c, width: 66,
            onChange: value => set({ thickness: Math.max(0, value), enabled: true }),
        }),
        h(SelectField, {
            value: interlayer?.profile ?? 'linear', c, width: 106,
            options: PROFILE_IDS.map(profile => ({ id: profile, label: profile })),
            onChange: profile => set({ profile, enabled: true }),
        }),
        h(NumInput, {
            value: interlayer?.slices ?? 10, min: 2, max: 500, step: 1, c, width: 56,
            onChange: value => set({ slices: Math.max(2, Math.floor(value)), enabled: true }),
        }),
        h('button', {
            type: 'button', title: ih.removeRow,
            disabled: !interlayer,
            onClick: () => state.removeInterlayer(side, iface.afterIndex),
            style: {
                width: 20, border: 'none', background: 'transparent',
                color: c.textDim, fontSize: 14, lineHeight: 1,
                cursor: interlayer ? 'pointer' : 'default',
                opacity: interlayer ? 1 : 0,
            },
        }, '×'),
    );
}
