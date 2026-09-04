import { CURVE_GROUPS } from './model.js';
import { CurveGroup } from './controls.js';
import { activeFill } from '../chrome/controls.js';
import { ControlRow } from '../chrome/layout.js';
import { NoticeBadge } from '../chrome/popover.js';
import { SetupPanel } from './SetupPanel.js';

const { createElement: h } = React;

function EditTargetsButton({ c, oe, editMode, setEditMode }) {
    return h('button', {
            onClick: () => setEditMode(current => !current),
            title: editMode ? oe.editTargetsTooltipOn : oe.editTargetsTooltipOff,
            'aria-pressed': editMode,
            style: {
                display: 'flex', alignItems: 'center', gap: 4,
                height: 28, padding: '0 9px', cursor: 'pointer', outline: 'none',
                border: `1px solid ${c.border}`, borderRadius: 6,
                backgroundColor: editMode ? activeFill(c) : 'transparent',
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
                backgroundColor: active ? activeFill(c) : 'transparent',
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

/**
 * The curves on the plot, the target overlay, and the way into the target
 * editor. The spectral range, the angles and the vertical range are settings
 * rather than switches, so they live in the Setup panel.
 */
export function ControlBar(props) {
    const { c, t, oe, showCurves, toggleCurve, notices, yScale } = props;
    return h(ControlRow, {
        c,
        trailing: [
            h(ShowTargetsButton, { key: 'targets', ...props }),
            h(EditTargetsButton, { key: 'edit', ...props }),
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            h(SetupPanel, { key: 'setup', ...props }),
        ],
    },
        CURVE_GROUPS.map(group => h(CurveGroup, {
            key: group.q, group, showCurves, onToggle: toggleCurve, c, yScale, oe,
            polLabels: { avg: oe.polAvg, s: oe.polSShort, p: oe.polPShort },
        })),
    );
}
