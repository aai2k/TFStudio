import { Checkbox } from '../../../ui/Checkbox.js';
import { curveColorFor } from './model.js';
import { FieldLabel, Divider, NumInput, SegmentedButton } from './controls.js';

const { createElement: h } = React;

function FamilyButton({ family, editCurve, setEditCurve, c, oe }) {
    const active = editCurve === family;
    return h('button', {
        onClick: () => setEditCurve(family),
        title: oe.editAsTooltip,
        style: {
            padding: '2px 8px', cursor: 'pointer', outline: 'none',
            border: `1px solid ${active ? curveColorFor(family) : c.border}`,
            borderRadius: 3,
            backgroundColor: active ? curveColorFor(family) + '22' : 'transparent',
            color: active ? c.text : c.textDim,
            fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: active ? 600 : 400,
        }
    }, family);
}

function SnapControls(props) {
    const { c, oe, snapOn, setSnapOn, snapNm, setSnapNm, snapPct, setSnapPct } = props;
    return h('div', {
        style: { display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, flexWrap: 'nowrap' }
    },
        h('label', {
            style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', color: c.text, whiteSpace: 'nowrap' },
            title: oe.snapTip
        },
            h(Checkbox, { c, checked: snapOn, onChange: event => setSnapOn(event.target.checked) }),
            oe.snap
        ),
        snapOn && h(NumInput, { value: snapNm, min: 0, max: 100, step: 1, c, width: 40, onChange: setSnapNm }),
        snapOn && h('span', { style: { fontSize: 10, color: c.textDim } }, oe.snapNmUnit),
        snapOn && h(NumInput, { value: snapPct, min: 0, max: 50, step: 1, c, width: 36, onChange: setSnapPct }),
        snapOn && h('span', { style: { fontSize: 10, color: c.textDim } }, oe.snapPctUnit)
    );
}

export function TargetToolbar(props) {
    const {
        c, oe, editMode, editTool, setEditTool, editKind, setEditKind,
        editCurve, setEditCurve, editPol, setEditPol,
    } = props;
    if (!editMode) return null;
    const tools = [
        { id: 'draw', label: '✏ ' + oe.editToolDraw, tip: oe.editToolDrawTip },
        { id: 'delete', label: '🗑 ' + oe.editToolDelete, tip: oe.editToolDeleteTip },
    ];
    const kinds = [
        { id: 'average', label: oe.editKindAvg },
        { id: 'continuous', label: oe.editKindCont },
    ];
    const drawing = editTool === 'draw';
    return h('div', {
        style: {
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, rowGap: 4,
            padding: '4px 10px', borderBottom: `1px solid ${c.border}`,
            backgroundColor: c.panel, flexShrink: 0
        }
    },
        tools.map(item => h(SegmentedButton, { key: item.id, item, activeId: editTool, onSelect: setEditTool, c })),
        drawing && h(Divider, { c }),
        drawing && h(FieldLabel, { c }, oe.editAs),
        drawing && kinds.map(item => h(SegmentedButton, {
            key: item.id, item, activeId: editKind, onSelect: setEditKind, c, title: oe.editKindTooltip
        })),
        drawing && h(Divider, { c }),
        drawing && ['R', 'T', 'A'].map(family => h(FamilyButton, {
            key: family, family, editCurve, setEditCurve, c, oe
        })),
        drawing && h('select', {
            value: editPol, onChange: event => setEditPol(event.target.value),
            title: oe.editPolTooltip,
            style: {
                height: 22, backgroundColor: c.panel, color: c.text,
                border: `1px solid ${c.border}`, borderRadius: 3,
                fontSize: 11, padding: '0 4px', outline: 'none'
            }
        },
            h('option', { value: 'avg' }, 'avg'),
            h('option', { value: 's' }, 's'),
            h('option', { value: 'p' }, 'p')
        ),
        drawing && h(Divider, { c }),
        drawing && h(SnapControls, props),
        h('span', {
            style: { marginLeft: 'auto', fontSize: 11, color: c.textDim, fontStyle: 'italic' }
        }, editTool === 'delete' ? oe.editHintDelete : oe.editHintDraw)
    );
}
