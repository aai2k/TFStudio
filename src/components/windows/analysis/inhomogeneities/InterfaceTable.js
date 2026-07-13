import { Checkbox } from '../../../ui/Checkbox.js';
import { PROFILE_IDS } from '../../../../utils/physics/inhomogeneity.js';
import { controlStyles, numField } from './ui.js';

const { createElement: h } = React;

function InterfaceRow({ side, iface, c, ih, findInterlayer, upsertInterlayer, removeInterlayer }) {
    const { inputStyle } = controlStyles(c);
    const interlayer = findInterlayer(side, iface.afterIndex);
    const enabled = interlayer ? interlayer.enabled !== false : false;
    return h('tr', {
        style: { borderBottom: `1px solid ${c.border}`, fontSize: 11 }
    },
        h('td', { style: { padding: '4px 6px', whiteSpace: 'nowrap', color: c.text } },
            h(Checkbox, {
                c, checked: enabled,
                onChange: event => {
                    if (event.target.checked) {
                        upsertInterlayer(side, iface.afterIndex, { enabled: true });
                    } else if (interlayer) {
                        upsertInterlayer(side, iface.afterIndex, { enabled: false });
                    }
                },
                style: { marginRight: 6 },
            }),
            iface.label,
        ),
        h('td', { style: { padding: '4px 6px' } },
            numField(interlayer?.thickness ?? 5,
                value => upsertInterlayer(side, iface.afterIndex, {
                    thickness: Math.max(0, value), enabled: true,
                }),
                { ...inputStyle, width: 56 }, { fallback: 0 }),
            h('span', { style: { marginLeft: 2, color: c.textDim } }, 'nm'),
        ),
        h('td', { style: { padding: '4px 6px' } },
            h('select', {
                value: interlayer?.profile ?? 'linear',
                onChange: event => upsertInterlayer(side, iface.afterIndex, {
                    profile: event.target.value, enabled: true,
                }),
                style: { ...inputStyle, width: 100 },
            }, PROFILE_IDS.map(profile => h('option', { key: profile, value: profile }, profile))),
        ),
        h('td', { style: { padding: '4px 6px' } },
            numField(interlayer?.slices ?? 10,
                value => upsertInterlayer(side, iface.afterIndex, {
                    slices: Math.max(2, Math.floor(value)), enabled: true,
                }),
                { ...inputStyle, width: 48 }, { fallback: 2, int: true }),
        ),
        h('td', { style: { padding: '4px 6px' } },
            interlayer && h('button', {
                onClick: () => removeInterlayer(side, iface.afterIndex),
                title: ih.removeRow || 'Remove',
                style: {
                    padding: '0 6px', background: 'transparent', color: c.textDim,
                    border: 'none', cursor: 'pointer', fontSize: 14,
                }
            }, '×'),
        ),
    );
}

export function InterfaceTable(props) {
    const { side, ifaces, activeSides, c, ih } = props;
    const title = side === 'back'
        ? (ih.backInterfacesTitle || 'Back-stack interfaces')
        : (activeSides.length > 1
            ? (ih.frontInterfacesTitle || 'Front-stack interfaces')
            : (ih.interfaceListTitle || 'Front-stack interfaces'));
    const sectionTitle = {
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: 0.4, color: c.textDim, margin: '6px 8px 4px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    return h('div', null,
        h('div', { style: sectionTitle }, title),
        h('table', {
            style: {
                width: '100%', borderCollapse: 'collapse',
                background: c.bg, color: c.text, fontSize: 11,
                fontFamily: 'system-ui, -apple-system, sans-serif',
            }
        },
            h('thead', null,
                h('tr', {
                    style: {
                        background: c.panel, color: c.textDim, fontSize: 10,
                        textTransform: 'uppercase', letterSpacing: 0.3,
                    }
                },
                    h('th', { style: { padding: '4px 6px', textAlign: 'left' } }, ih.interface || 'Interface'),
                    h('th', { style: { padding: '4px 6px', textAlign: 'left' } }, ih.thickness || 'Thickness'),
                    h('th', { style: { padding: '4px 6px', textAlign: 'left' } }, ih.profile || 'Profile'),
                    h('th', { style: { padding: '4px 6px', textAlign: 'left' } }, ih.slices || 'Slices'),
                    h('th', { style: { padding: '4px 6px' } }, ''),
                ),
            ),
            h('tbody', null, ifaces.map(iface => h(InterfaceRow, {
                ...props, key: `${side}:${iface.afterIndex}`, iface,
            }))),
        ),
    );
}
