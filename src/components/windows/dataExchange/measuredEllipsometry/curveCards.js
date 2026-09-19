/**
 * The measured Ψ and Δ on the design, one compact card each.
 *
 * Ψ and Δ are separate curves with separate conditions: a Ψ fits on its own,
 * and a Δ taken at another angle is another target. A card holds what the
 * curve is drawn with on its first line and the conditions it was measured
 * under on its second.
 */

import { ActionButton, CheckField, ChoiceGroup, NumInput } from '../../analysis/chrome/controls.js';
import { measuredCurveData } from '../../../../utils/io/spectrumTable.js';
import { textInputStyle } from '../chrome/panel.js';
import { deltaConventionItems } from './model.js';

const { createElement: h, useEffect, useState } = React;

export const QUANTITY_ITEMS = [{ id: 'PSI', label: 'Ψ' }, { id: 'DEL', label: 'Δ' }];

// The name is committed when the field is left, so a half-typed name never
// reaches the design.
function NameField({ curve, onRename, c, mx }) {
    const [draft, setDraft] = useState(curve.name);
    useEffect(() => setDraft(curve.name), [curve.name]);
    return h('input', {
        value: draft, onChange: event => setDraft(event.target.value),
        onBlur: () => {
            const next = draft.trim();
            if (next && next !== curve.name) onRename(next);
            else setDraft(curve.name);
        },
        style: textInputStyle(c), title: mx.nameLabel,
    });
}

function pointsText(curve, mx) {
    const data = measuredCurveData(curve);
    return data.x.length
        ? mx.points(data.x.length, Math.round(data.x[0]), Math.round(data.x[data.x.length - 1]))
        : mx.noPoints;
}

// What the curve is drawn with, and what can be done with it.
function CurveHeader({ curve, controller, c, mx }) {
    const { updateCurve, toggleCurve, removeCurve, openFitDialog } = controller;
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 5 } },
        h(CheckField, {
            c, label: '', checked: curve.visible !== false,
            onChange: () => toggleCurve(curve.id), title: mx.visibleLabel,
        }),
        h('input', {
            type: 'color', value: curve.color,
            onChange: event => updateCurve(curve.id, { color: event.target.value }),
            title: mx.colorLabel,
            style: { width: 22, height: 18, border: 'none', padding: 0, background: 'transparent', flexShrink: 0 },
        }),
        h(ChoiceGroup, {
            c, activeId: curve.quantity, items: QUANTITY_ITEMS, ariaLabel: mx.quantityLabel,
            onSelect: value => updateCurve(curve.id, { quantity: value }),
        }),
        h(NameField, { curve, c, mx, onRename: name => updateCurve(curve.id, { name }) }),
        h(ActionButton, { c, label: mx.fit, title: mx.fitTip, onClick: () => openFitDialog(curve) }),
        h(ActionButton, { c, label: '×', title: mx.remove, onClick: () => removeCurve(curve.id) }),
    );
}

// The conditions the curve was measured under, and its extent. The face it
// belongs to is shown when the design has a coating on each face, and on a
// curve already marked as the back one whatever the design now carries: the
// fit refuses a back-side curve, so hiding the control would leave nothing to
// undo it with.
function CurveConditions({ curve, controller, c, mx }) {
    const { updateCurve, hasBackCoating } = controller;
    const showSide = hasBackCoating || curve.side === 'back';
    return h('div', {
        style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingLeft: 21 },
    },
        h(NumInput, {
            c, value: curve.aoi ?? 0, min: 0, max: 89.9, step: 0.1, width: 52, title: mx.aoiLabel,
            onChange: value => updateCurve(curve.id, { aoi: value }),
        }),
        h('span', { style: { color: c.textDim, fontSize: 11 } }, '°'),
        showSide && h(ChoiceGroup, {
            c, activeId: curve.side || 'front', ariaLabel: mx.sideLabel,
            items: [
                { id: 'front', label: mx.sideFront, title: mx.sideLabel },
                { id: 'back', label: mx.sideBack, title: mx.sideLabel },
            ],
            onSelect: value => updateCurve(curve.id, { side: value }),
        }),
        curve.quantity === 'DEL' && h(ChoiceGroup, {
            c, activeId: curve.deltaConvention || 'azzam', ariaLabel: mx.deltaConventionLabel,
            items: deltaConventionItems(mx),
            onSelect: value => updateCurve(curve.id, { deltaConvention: value }),
        }),
        h('span', { style: { marginLeft: 'auto', color: c.textDim, fontSize: 10.5, whiteSpace: 'nowrap' } },
            pointsText(curve, mx)),
    );
}

/** One measured curve. Clicking the card puts it on the preview. */
export function CurveCard({ curve, selected, onSelect, controller, c, mx }) {
    return h('div', {
        onClick: onSelect,
        style: {
            margin: '0 8px 6px', padding: '4px 6px 6px', borderRadius: 6,
            border: `1px solid ${selected ? c.accent : c.border}`,
            backgroundColor: selected ? c.accent + (c.light ? '0d' : '16') : c.bg,
            display: 'flex', flexDirection: 'column', gap: 4, cursor: 'default',
        },
    },
        h(CurveHeader, { curve, controller, c, mx }),
        h(CurveConditions, { curve, controller, c, mx }),
    );
}
