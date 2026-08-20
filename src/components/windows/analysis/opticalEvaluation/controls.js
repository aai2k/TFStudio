import { buildCurves } from './model.js';
import { activeFill } from '../chrome/controls.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h } = React;

export function CurveGroup({ group, showCurves, onToggle, c, polLabels }) {
    // Swatches follow the configured curve colours so the toolbar matches the plot.
    const curveColors = useAnalysisColors('opticalEvaluation');
    const byKey = Object.fromEntries(buildCurves(curveColors).map(cv => [cv.key, cv]));
    const groupColor = byKey[group.members[0].key].color;
    const fill = activeFill(c, groupColor);
    return h('div', {
        style: {
            display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0,
            height: 28, padding: '0 3px 0 8px', border: `1px solid ${c.border}`,
            borderRadius: 7, backgroundColor: c.bg
        }
    },
        h('span', { style: { width: 8, height: 8, borderRadius: '50%', backgroundColor: groupColor, marginRight: 3 } }),
        h('span', { style: { fontSize: 12, fontWeight: 700, color: c.text, marginRight: 2 } }, group.q),
        group.members.map(member => {
            const curve = byKey[member.key];
            const active = !!showCurves[member.key];
            return h('button', {
                key: member.key,
                onClick: () => onToggle(member.key),
                title: curve.label,
                'aria-pressed': active,
                style: {
                    height: 22, padding: '0 7px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', outline: 'none', border: 'none', lineHeight: 1,
                    borderRadius: 4, backgroundColor: active ? fill : 'transparent',
                    color: active ? c.text : c.textDim,
                    fontSize: 11, fontWeight: 500,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                },
            }, polLabels[member.pol]);
        }));
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
