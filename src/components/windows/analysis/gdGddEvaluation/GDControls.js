import { Checkbox } from '../../../ui/Checkbox.js';
import { designMaterialLookup } from '../../../../utils/materials/designMaterials.js';
import { FieldLabel, NumInput } from '../opticalEvaluation/controls.js';
import { gdGddTargetColor } from './gdTargets.js';

const { createElement: h } = React;

function choiceButtonStyle(c, active, color) {
    const activeColor = color || c.accent;
    return {
        height: 22, padding: '0 8px', display: 'inline-flex', alignItems: 'center', gap: 5,
        border: 'none', borderRadius: 4, outline: 'none', cursor: 'pointer',
        backgroundColor: active ? activeColor + (c.light ? '20' : '38') : 'transparent',
        color: active ? c.text : c.textDim,
        fontSize: 11, fontWeight: 500,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
}

export function ChoiceGroup({ label, items, activeId, onSelect, c, ariaLabel }) {
    return h('div', {
        role: 'group', 'aria-label': ariaLabel || label,
        style: {
            height: 28, display: 'inline-flex', alignItems: 'center', gap: 2,
            padding: label ? '0 3px 0 8px' : '0 3px',
            border: `1px solid ${c.border}`, borderRadius: 7,
            backgroundColor: c.bg, flexShrink: 0,
        },
    },
        label && h('span', {
            style: {
                marginRight: 3, color: c.text, fontSize: 11,
                fontWeight: 600, whiteSpace: 'nowrap',
            },
        }, label),
        items.map(item => {
            const active = item.id === activeId;
            return h('button', {
                key: item.id, type: 'button', title: item.title,
                onClick: () => onSelect(item.id), 'aria-pressed': active,
                style: choiceButtonStyle(c, active, item.color),
            },
                item.color && h('span', {
                    style: {
                        width: 7, height: 7, borderRadius: '50%',
                        backgroundColor: item.color, flexShrink: 0,
                    },
                }),
                item.label,
            );
        }),
    );
}

function SideAndAngleToolbar({ c, text, state }) {
    return h('div', {
        'data-gd-toolbar': 'primary',
        style: {
            display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            gap: 10, rowGap: 5, padding: '7px 14px 4px',
            backgroundColor: c.panel,
        },
    },
        h(ChoiceGroup, {
            label: text.side || 'Side', ariaLabel: text.side || 'Side',
            activeId: state.side, onSelect: state.setSide, c,
            items: [
                { id: 'front', label: text.front || 'Front', color: '#1e88e5' },
                { id: 'back', label: text.back || 'Back', color: '#e53935' },
                ...(state.target === 'T'
                    ? [{ id: 'total', label: text.total || 'Total', color: '#ab47bc' }]
                    : []),
            ],
        }),
        h('div', {
            style: { display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 },
        },
            h(FieldLabel, { c }, text.aoi),
            h(NumInput, {
                value: state.theta, min: 0, max: 89, step: 1, c, width: 48,
                onChange: state.setTheta,
            }),
        ),
    );
}

function CurveToolbar({ c, text, state }) {
    const hasTargets = state.targets.length > 0;
    const targetColor = gdGddTargetColor(state.target);
    return h('div', {
        'data-gd-toolbar': 'curves',
        style: {
            display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            gap: 8, rowGap: 5, padding: '3px 14px 8px',
            borderBottom: `1px solid ${c.border}`,
            backgroundColor: c.panel,
        },
    },
        h(ChoiceGroup, {
            label: text.quantity, activeId: state.quantity, onSelect: state.setQuantity, c,
            items: [
                { id: 'phase', label: text.phase },
                { id: 'gd', label: 'GD' },
                { id: 'gdd', label: 'GDD' },
                { id: 'tod', label: 'TOD' },
            ],
        }),
        h(ChoiceGroup, {
            activeId: state.target, onSelect: state.setTarget, c,
            ariaLabel: text.response || 'Response',
            items: [
                { id: 'R', label: text.reflection, color: '#ef5350' },
                { id: 'T', label: text.transmission, color: '#03a9f4' },
            ],
        }),
        h(ChoiceGroup, {
            label: text.pol, activeId: state.pol, onSelect: state.setPol, c,
            items: [
                { id: 'avg', label: text.avg || 'avg' },
                { id: 's', label: 's' },
                { id: 'p', label: 'p' },
            ],
        }),
        h('button', {
            type: 'button',
            disabled: !hasTargets,
            onClick: () => state.setShowTargets(current => !current),
            title: hasTargets
                ? (text.targetsTip || 'Show merit-function targets for this curve')
                : (text.noTargetsTip || 'No matching merit-function targets'),
            'aria-pressed': state.showTargets,
            style: {
                height: 28, padding: '0 9px', marginLeft: 'auto',
                display: 'inline-flex', alignItems: 'center', gap: 4,
                border: `1px solid ${c.border}`, borderRadius: 6,
                backgroundColor: state.showTargets && hasTargets
                    ? c.accent + (c.light ? '20' : '38')
                    : 'transparent',
                color: hasTargets ? c.text : c.textDim,
                opacity: hasTargets ? 1 : 0.45,
                cursor: hasTargets ? 'pointer' : 'default',
                fontSize: 11, fontFamily: 'inherit', fontWeight: 500,
            },
        },
            h('span', {
                style: {
                    width: 14, height: 0,
                    borderTop: `2px dotted ${hasTargets ? targetColor : c.textDim}`,
                },
            }),
            text.targets || 'Targets',
        ),
    );
}

export function GDControls({ c, text, state }) {
    return h('div', { style: { flexShrink: 0, backgroundColor: c.panel } },
        h(SideAndAngleToolbar, { c, text, state }),
        h(CurveToolbar, { c, text, state }),
    );
}

export function GDAxisPanel({ c, text, state }) {
    return h('div', {
        'data-gd-panel': 'axis',
        style: {
            display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            gap: 8, rowGap: 6, padding: '7px 12px',
            borderTop: `1px solid ${c.border}`,
            backgroundColor: c.panel, flexShrink: 0,
        },
    },
        h('div', {
            style: { display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 },
        },
            h(FieldLabel, { c }, 'λ'),
            h(NumInput, {
                value: state.lamStart, min: 100, max: 30000, step: 10, c, width: 62,
                onChange: state.setLamStart,
            }),
            h('span', { style: { color: c.textDim, fontSize: 11 } }, '–'),
            h(NumInput, {
                value: state.lamEnd, min: 100, max: 30000, step: 10, c, width: 62,
                onChange: state.setLamEnd,
            }),
            h('span', { style: { color: c.textDim, fontSize: 11 } }, 'nm'),
        ),
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 7,
                marginLeft: 'auto', flexShrink: 0,
            },
        },
            h('label', {
                style: {
                    display: 'flex', alignItems: 'center', gap: 5,
                    color: c.text, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
                },
            },
                h(Checkbox, {
                    c, checked: state.showRef,
                    onChange: event => state.setShowRef(event.target.checked),
                }),
                text.refLam,
            ),
            h(NumInput, {
                value: state.refLam, min: 100, max: 30000, step: 1, c, width: 58,
                onChange: state.setRefLam,
            }),
        ),
    );
}

function mediumName(design, id) {
    if (!id) return '';
    const material = designMaterialLookup(design)(id);
    if (material?.name) return material.name;
    const separator = id.indexOf(':');
    return separator >= 0 ? id.slice(separator + 1) : id;
}

export function GDFooter({ c, text, design, side, summary, raw, quantity }) {
    const sideLabel = side === 'total'
        ? (text.total || 'Total')
        : side === 'back' ? (text.back || 'Back') : (text.front || 'Front');
    const incidentId = side === 'back' ? design.exitMedium : design.incidentMedium;
    const finalId = side === 'total' ? design.exitMedium : design.substrate?.material;
    const media = `${mediumName(design, incidentId)} → ${mediumName(design, finalId)}`;
    const models = raw?.models?.join('; ') || '';
    const sampleSummary = raw
        ? `${raw.method}${raw.adaptivePointCount ? `, +${raw.adaptivePointCount} adaptive points` : ''}`
        : '';
    const quantityOrder = { phase: 0, gd: 1, gdd: 2, tod: 3 }[quantity] ?? 1;
    const piecewise = quantityOrder > (raw?.phaseContinuousOrder ?? 3)
        && raw?.discontinuityModels?.length;
    return h('div', {
        'data-gd-panel': 'footer',
        style: {
            minHeight: 38, padding: '4px 12px', borderTop: `1px solid ${c.border}`,
            backgroundColor: c.panel, flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 7,
            overflow: 'hidden', fontSize: 11, color: c.textDim,
        },
    },
        h('span', {
            style: {
                color: c.text, fontWeight: 600, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            },
        }, design.name),
        h('span', null, '·'),
        h('span', { style: { whiteSpace: 'nowrap' } }, sideLabel),
        h('span', null, '·'),
        h('span', { style: { whiteSpace: 'nowrap' } },
            `${text.layersLabel}: ${summary.layerCount}, ${summary.totalThickness.toFixed(1)} nm`,
        ),
        h('span', null, '·'),
        h('span', { style: { whiteSpace: 'nowrap' } }, media),
        sampleSummary && h('span', null, '·'),
        sampleSummary && h('span', {
            style: { whiteSpace: 'nowrap', color: c.accent },
        }, sampleSummary),
        piecewise && h('span', null, '·'),
        piecewise && h('span', {
            title: raw.discontinuityModels.join('; '),
            style: { whiteSpace: 'nowrap', color: c.warning || '#f59e0b' },
        }, text.tableKnotWarning || 'Piecewise table derivative; gaps mark data-knot jumps'),
        models && h('span', null, '·'),
        models && h('span', {
            title: models,
            style: {
                minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', color: c.textDim,
            },
        }, `${text.models || 'Models'}: ${models}`),
    );
}
