import { buildCurves } from './model.js';
import { activeFill, CurveToggleGroup } from '../chrome/controls.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { yScaleReadsQuantity } from './yScale.js';

const { createElement: h } = React;

export function CurveGroup({ group, showCurves, onToggle, c, polLabels, yScale, oe }) {
    // Swatches follow the configured curve colours so the toolbar matches the plot.
    const curveColors = useAnalysisColors('opticalEvaluation');
    const byKey = Object.fromEntries(buildCurves(curveColors).map(cv => [cv.key, cv]));
    // Optical density reads transmittance and nothing else, so the other two
    // groups are parked rather than left switching curves the plot will not draw.
    const disabled = !yScaleReadsQuantity(yScale, group.q);
    return h(CurveToggleGroup, {
        c,
        quantity: group.q,
        color: byKey[group.members[0].key].color,
        members: group.members.map(member => ({ ...member, title: byKey[member.key].label })),
        active: showCurves,
        onToggle,
        labels: polLabels,
        disabled,
        disabledTitle: oe.unitTransmittanceOnly,
    });
}

export function SegmentedButton({ item, activeId, onSelect, c, title }) {
    const active = activeId === item.id;
    return h('button', {
        onClick: () => onSelect(item.id),
        title: item.tip || title,
        'aria-pressed': active,
        style: {
            height: 24, padding: '0 8px', cursor: 'pointer', outline: 'none', border: 'none',
            borderRadius: 4,
            backgroundColor: active ? activeFill(c) : 'transparent',
            color: active ? c.text : c.textDim,
            fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: 500,
        }
    }, item.label);
}
