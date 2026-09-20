/**
 * Material Editor — the Mechanical page of the material form.
 *
 * The constants the stress calculations read, in the units the catalogs that
 * publish them use. Each is independent of the others: a material whose stress
 * was measured but whose modulus was never looked up carries the stress alone,
 * so every box stands on its own and an empty one means unknown, not zero.
 */

import { MECHANICAL_FIELDS, MECHANICAL_UNITS } from '../../../../utils/materials/mechanical.js';
import { unitLabel } from './materialEditorUI.js';

const { createElement: h } = React;

export function renderMechanicalTab({ draft, set, me, c, inputStyle, labelStyle }) {
    const block = draft.mechanical || {};
    return h('div', { style: { paddingTop: 8 } },
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 8px' } },
            MECHANICAL_FIELDS.map(field =>
                h('div', { key: field, style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                    h('span', { style: { ...labelStyle, whiteSpace: 'normal' } },
                        unitLabel(me.mechanicalFields[field], MECHANICAL_UNITS[field])),
                    h('input', {
                        type: 'text',
                        value: block[field] || '',
                        onChange: e => set('mechanical', { ...block, [field]: e.target.value }),
                        style: { ...inputStyle, width: '100%', boxSizing: 'border-box' },
                    })
                )
            )
        ),
        h('div', { style: { fontSize: 10, color: c.textDim, marginTop: 8, fontStyle: 'italic' } }, me.mechanicalHint)
    );
}
