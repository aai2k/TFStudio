import { Checkbox } from '../../../ui/Checkbox.js';
import { CURVE_GROUPS } from './model.js';
import { FieldLabel, Divider, NumInput, CurveGroup } from './controls.js';

const { createElement: h } = React;

function EditTargetsButton({ c, oe, editMode, setEditMode }) {
    return h('button', {
            onClick: () => setEditMode(current => !current),
            title: editMode ? oe.editTargetsTooltipOn : oe.editTargetsTooltipOff,
            style: {
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '2px 7px', cursor: 'pointer', outline: 'none',
                border: `1px solid ${editMode ? c.accent : c.border}`,
                borderRadius: 3,
                backgroundColor: editMode ? c.accent + '22' : 'transparent',
                color: editMode ? c.accent : c.textDim,
                fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
                fontWeight: editMode ? 600 : 400,
            }
        }, '✎ ' + oe.editTargets);
}

function ShowTargetsButton({ c, oe, editMode, showTargets, setShowTargets, hasTargets }) {
    return h('button', {
            onClick: () => setShowTargets(current => !current),
            disabled: !hasTargets || editMode,
            title: hasTargets ? oe.targetsTooltipOn : oe.targetsTooltipOff,
            style: {
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '2px 7px', cursor: (hasTargets && !editMode) ? 'pointer' : 'default',
                outline: 'none',
                border: `1px solid ${(showTargets || editMode) ? '#ffd54f' : c.border}`,
                borderRadius: 3,
                backgroundColor: (showTargets || editMode) ? '#ffd54f22' : 'transparent',
                color: (showTargets || editMode) ? c.text : c.textDim,
                fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
                fontWeight: (showTargets || editMode) ? 600 : 400,
                opacity: (hasTargets && !editMode) ? 1 : 0.4
            }
        },
            h('div', { style: { width: 14, height: 0, borderTop: `2px dotted ${(showTargets || editMode) ? '#ffd54f' : c.textDim}` } }),
            oe.targets
        );
}

function TargetVisibilityControls(props) {
    return h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 } },
        h(EditTargetsButton, props),
        h(Divider, { c: props.c }),
        h(ShowTargetsButton, props)
    );
}

function YAxisControls(props) {
    const { c, oe, yAuto, setYAuto, yMin, setYMin, yMax, setYMax } = props;
    return h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'nowrap' } },
        h(FieldLabel, { c }, oe.yAxis),
        h('label', {
            style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', color: c.text, whiteSpace: 'nowrap' }
        },
            h(Checkbox, { c, checked: yAuto, onChange: event => setYAuto(event.target.checked) }),
            oe.yAuto
        ),
        !yAuto && h(NumInput, {
            value: yMin, min: -10, max: 200, step: 5, c, width: 48,
            onChange: value => setYMin(Math.min(value, yMax - 1))
        }),
        !yAuto && h('span', { style: { color: c.textDim, fontSize: 11 } }, '–'),
        !yAuto && h(NumInput, {
            value: yMax, min: -10, max: 200, step: 5, c, width: 48,
            onChange: value => setYMax(Math.max(value, yMin + 1))
        })
    );
}

export function CurveToolbar(props) {
    const { c, oe, showCurves, toggleCurve } = props;
    return h('div', {
        style: {
            display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            gap: 6, rowGap: 4,
            padding: '4px 10px', borderBottom: `1px solid ${c.border}`,
            backgroundColor: c.panel + 'aa', flexShrink: 0
        }
    },
        h(FieldLabel, { c }, oe.curves),
        CURVE_GROUPS.map((group, index) => [
            index > 0 ? h(Divider, { c, key: group.q + '-div' }) : null,
            h(CurveGroup, {
                key: group.q, group, showCurves, onToggle: toggleCurve, c,
                polLabels: { avg: oe.polAvg, s: oe.polSShort, p: oe.polPShort },
            }),
        ]),
        h(Divider, { c }),
        h(YAxisControls, props),
        h(TargetVisibilityControls, props)
    );
}
