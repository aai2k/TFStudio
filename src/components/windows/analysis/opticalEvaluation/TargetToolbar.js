import { Checkbox } from '../../../ui/Checkbox.js';
import { curveColorFor } from './model.js';
import { FieldLabel, NumInput } from '../chrome/controls.js';
import { SegmentedButton } from './controls.js';
import { ModeRow } from '../chrome/layout.js';
import { yScaleOf, yScaleReadsQuantity } from './yScale.js';

const { createElement: h } = React;

function FamilyButton({ family, editCurve, setEditCurve, c, oe, disabled }) {
    const active = editCurve === family && !disabled;
    const activeFill = curveColorFor(family) + (c.light ? '20' : '38');
    return h('button', {
        onClick: () => setEditCurve(family),
        disabled,
        title: disabled ? oe.unitTransmittanceOnly : oe.editAsTooltip,
        'aria-pressed': active,
        style: {
            height: 24, padding: '0 8px', cursor: disabled ? 'default' : 'pointer',
            outline: 'none', border: 'none', borderRadius: 4,
            backgroundColor: active ? activeFill : 'transparent',
            color: active ? c.text : c.textDim,
            opacity: disabled ? 0.45 : 1,
            fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: 500,
        }
    }, family);
}

function ControlGroup({ c, children }) {
    return h('div', {
        style: {
            height: 30, display: 'inline-flex', alignItems: 'center', gap: 2,
            padding: '0 3px', border: `1px solid ${c.border}`,
            borderRadius: 7, backgroundColor: c.panel, flexShrink: 0
        }
    }, children);
}

// Rounding clears the dust a unit conversion leaves in the field.
const clean = value => Number(value.toPrecision(12));

/**
 * The level grid is entered in the unit the axis is ruled in: percentage points
 * on a linear axis, decibels or density on a logarithmic one. The logarithmic
 * step is stored in decades, so 5 dB and OD 0.5 are the same setting.
 */
function levelField(scale, oe, snapPct, setSnapPct, snapDecades, setSnapDecades) {
    if (!scale.log) return { value: snapPct, max: 50, step: 1, unit: oe.snapPctUnit, onChange: setSnapPct };
    const perDecade = 1 / scale.decadesPerUnit;
    return {
        value: clean(snapDecades * perDecade), max: 5 * perDecade, step: clean(0.1 * perDecade),
        unit: scale.short,
        onChange: value => setSnapDecades(clean(value / perDecade)),
    };
}

function SnapControls(props) {
    const {
        c, oe, snapOn, setSnapOn, snapNm, setSnapNm, snapPct, setSnapPct,
        snapDecades, setSnapDecades, yScale,
    } = props;
    const level = levelField(yScaleOf(yScale), oe, snapPct, setSnapPct, snapDecades, setSnapDecades);
    return h(ControlGroup, { c },
        h('label', {
            style: { display: 'flex', alignItems: 'center', gap: 4, padding: '0 5px', fontSize: 11, cursor: 'pointer', color: c.text, whiteSpace: 'nowrap' },
            title: oe.snapTip
        },
            h(Checkbox, { c, checked: snapOn, onChange: event => setSnapOn(event.target.checked) }),
            oe.snap
        ),
        snapOn && h(NumInput, { value: snapNm, min: 0, max: 100, step: 1, c, width: 40, onChange: setSnapNm }),
        snapOn && h('span', { style: { fontSize: 10, color: c.textDim } }, oe.snapNmUnit),
        snapOn && h(NumInput, {
            value: level.value, min: 0, max: level.max, step: level.step, c, width: 36, onChange: level.onChange,
        }),
        snapOn && h('span', { style: { fontSize: 10, color: c.textDim } }, level.unit)
    );
}

export function TargetToolbar(props) {
    const {
        c, oe, editMode, editTool, setEditTool, editKind, setEditKind,
        editCurve, setEditCurve, editPol, setEditPol, yScale,
    } = props;
    if (!editMode) return null;
    const tools = [
        { id: 'draw', label: oe.editToolDraw, tip: oe.editToolDrawTip },
        { id: 'delete', label: oe.editToolDelete, tip: oe.editToolDeleteTip },
    ];
    const kinds = [
        { id: 'average', label: oe.editKindAvg },
        { id: 'continuous', label: oe.editKindCont },
    ];
    const drawing = editTool === 'draw';
    return h(ModeRow, { c },
        h(ControlGroup, { c }, tools.map(item => h(SegmentedButton, {
            key: item.id, item, activeId: editTool, onSelect: setEditTool, c
        }))),
        drawing && h(FieldLabel, { c }, oe.editAs),
        drawing && h(ControlGroup, { c }, kinds.map(item => h(SegmentedButton, {
            key: item.id, item, activeId: editKind, onSelect: setEditKind, c,
            title: oe.editKindTooltip
        }))),
        // The same families the plot can draw in the chosen unit: optical
        // density parks R and A here as it does on the curve switches.
        drawing && h(ControlGroup, { c }, ['R', 'T', 'A'].map(family => h(FamilyButton, {
            key: family, family, editCurve, setEditCurve, c, oe,
            disabled: !yScaleReadsQuantity(yScale, family),
        }))),
        drawing && h('select', {
            value: editPol, onChange: event => setEditPol(event.target.value),
            title: oe.editPolTooltip,
            style: {
                height: 30, backgroundColor: c.panel, color: c.text,
                border: `1px solid ${c.border}`, borderRadius: 7,
                fontSize: 11, padding: '0 8px', outline: 'none'
            }
        },
            h('option', { value: 'avg' }, 'avg'),
            h('option', { value: 's' }, 's'),
            h('option', { value: 'p' }, 'p')
        ),
        drawing && h(SnapControls, props),
        h('span', {
            style: {
                flexBasis: '100%', padding: '5px 8px', borderRadius: 5,
                backgroundColor: c.panel, fontSize: 10, lineHeight: 1.4, color: c.textDim
            }
        }, editTool === 'delete' ? oe.editHintDelete : oe.editHintDraw)
    );
}
