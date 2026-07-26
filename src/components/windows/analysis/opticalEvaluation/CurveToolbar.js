import { CURVE_GROUPS } from './model.js';
import { CurveGroup } from './controls.js';

const { createElement: h } = React;

function EditTargetsButton({ c, oe, editMode, setEditMode }) {
    const activeFill = c.accent + (c.light ? '20' : '38');
    return h('button', {
            onClick: () => setEditMode(current => !current),
            title: editMode ? oe.editTargetsTooltipOn : oe.editTargetsTooltipOff,
            'aria-pressed': editMode,
            style: {
                display: 'flex', alignItems: 'center', gap: 4,
                height: 28, padding: '0 9px', cursor: 'pointer', outline: 'none',
                border: `1px solid ${c.border}`, borderRadius: 6,
                backgroundColor: editMode ? activeFill : 'transparent',
                color: c.text,
                fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
                fontWeight: 500,
            }
        },
            h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none' },
                h('path', { d: 'M11 2l3 3-8 8H3v-3l8-8z', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' })),
            oe.editTargets);
}

function ShowTargetsButton({ c, oe, editMode, showTargets, setShowTargets, hasTargets }) {
    const active = showTargets || editMode;
    const activeFill = c.accent + (c.light ? '20' : '38');
    return h('button', {
            onClick: () => setShowTargets(current => !current),
            disabled: !hasTargets || editMode,
            title: hasTargets ? oe.targetsTooltipOn : oe.targetsTooltipOff,
            'aria-pressed': active,
            style: {
                display: 'flex', alignItems: 'center', gap: 4,
                height: 28, padding: '0 9px', cursor: (hasTargets && !editMode) ? 'pointer' : 'default',
                outline: 'none',
                border: `1px solid ${c.border}`, borderRadius: 6,
                backgroundColor: active ? activeFill : 'transparent',
                color: (active || hasTargets) ? c.text : c.textDim,
                fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
                fontWeight: 500,
                opacity: (!hasTargets && !editMode) ? 0.45 : 1
            }
        },
            h('div', { style: { width: 14, height: 0, borderTop: `2px dotted ${active ? c.accent : c.textDim}` } }),
            oe.targets
        );
}

function TargetVisibilityControls(props) {
    return h('div', {
        style: { display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto', flexShrink: 0 }
    },
        h(ShowTargetsButton, props),
        h(EditTargetsButton, props)
    );
}

export function CurveToolbar(props) {
    const { c, oe, showCurves, toggleCurve } = props;
    return h('div', {
        style: {
            display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            gap: 8, rowGap: 5,
            padding: '3px 14px 8px', borderBottom: `1px solid ${c.border}`,
            backgroundColor: c.panel, flexShrink: 0
        }
    },
        CURVE_GROUPS.map(group => h(CurveGroup, {
            key: group.q, group, showCurves, onToggle: toggleCurve, c,
            polLabels: { avg: oe.polAvg, s: oe.polSShort, p: oe.polPShort },
        })),
        h(TargetVisibilityControls, props)
    );
}
