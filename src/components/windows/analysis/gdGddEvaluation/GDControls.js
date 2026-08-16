import { Checkbox } from '../../../ui/Checkbox.js';
import { ExportMenu } from '../../../ui/ExportMenu.js';
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

export function GDAxisPanel({ c, text, state, autoRange }) {
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
        h(YAxisControls, { c, text, state, autoRange }),
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0,
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

/**
 * Vertical range, mirroring Optical Evaluation. Auto is the robust range from
 * autoYRange, which excludes the divergence spikes at reflection minima; when it
 * does, the count of excluded samples is shown rather than left implicit.
 */
function YAxisControls({ c, text, state, autoRange }) {
    const effective = autoRange?.range || [0, 1];
    const shown = value => Number.isFinite(value) ? value : null;
    const low = shown(state.yMin) ?? effective[0];
    const high = shown(state.yMax) ?? effective[1];
    const step = Math.max(1e-6, Math.abs(high - low) / 20);
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 7,
            marginLeft: 'auto', flexShrink: 0,
        },
    },
        h(FieldLabel, { c }, 'Y'),
        !state.yAuto && h(NumInput, {
            value: Number(low.toPrecision(6)), step, c, width: 64,
            onChange: value => state.setYMin(value),
        }),
        !state.yAuto && h('span', { style: { color: c.textDim, fontSize: 11 } }, '–'),
        !state.yAuto && h(NumInput, {
            value: Number(high.toPrecision(6)), step, c, width: 64,
            onChange: value => state.setYMax(value),
        }),
        state.yAuto && autoRange?.outside > 0 && h('span', {
            title: text.offScaleHint,
            style: { color: c.warning || '#f59e0b', fontSize: 11, whiteSpace: 'nowrap' },
        }, text.offScale(autoRange.outside)),
        h('label', {
            style: {
                display: 'flex', alignItems: 'center', gap: 4,
                color: c.text, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
            },
        },
            h(Checkbox, {
                c, checked: state.yAuto,
                onChange: (event) => {
                    // Leaving Auto seeds the fields from what is on screen, so
                    // the range does not jump when the checkbox is cleared.
                    if (!event.target.checked) {
                        state.setYMin(Number(effective[0].toPrecision(6)));
                        state.setYMax(Number(effective[1].toPrecision(6)));
                    }
                    state.setYAuto(event.target.checked);
                },
            }),
            text.yAuto,
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

/**
 * A short label carrying its full explanation in the tooltip. The dispersion
 * model list and the piecewise-derivative note run to a sentence or more, which
 * a status bar cannot hold at any realistic window width; the label says the
 * condition exists and hovering gives the detail.
 */
export function FooterHint({ c, label, detail, color }) {
    return h('span', {
        title: detail,
        style: {
            whiteSpace: 'nowrap', flexShrink: 0, cursor: 'help',
            color: color || c.textDim,
            textDecoration: 'underline dotted', textUnderlineOffset: 2,
        },
    }, label);
}

export function GDFooter({ c, text, dataTable, design, side, summary, raw, quantity, csv }) {
    const sideLabel = side === 'total'
        ? (text.total || 'Total')
        : side === 'back' ? (text.back || 'Back') : (text.front || 'Front');
    const incidentId = side === 'back' ? design.exitMedium : design.incidentMedium;
    const finalId = side === 'total' ? design.exitMedium : design.substrate?.material;
    const media = `${mediumName(design, incidentId)} → ${mediumName(design, finalId)}`;
    const models = raw?.models || [];
    const sampleSummary = raw
        ? `${raw.method}${raw.adaptivePointCount ? `, +${raw.adaptivePointCount} adaptive points` : ''}`
        : '';
    const quantityOrder = { phase: 0, gd: 1, gdd: 2, tod: 3 }[quantity] ?? 1;
    const piecewise = quantityOrder > (raw?.phaseContinuousOrder ?? 3)
        && raw?.discontinuityModels?.length;
    // Narrowing the window clips the descriptive text, which is the part the
    // window title and the toolbars already say. The warnings and the export
    // control do not shrink, so they are still there in a docked window.
    return h('div', {
        'data-gd-panel': 'footer',
        style: {
            minHeight: 38, padding: '4px 12px', borderTop: `1px solid ${c.border}`,
            backgroundColor: c.panel, flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 7,
            fontSize: 11, color: c.textDim,
        },
    },
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 7,
                minWidth: 0, overflow: 'hidden',
            },
        },
            h('span', {
                title: design.name,
                style: {
                    color: c.text, fontWeight: 600, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
                },
            }, design.name),
            h('span', null, '·'),
            h('span', { style: { whiteSpace: 'nowrap' } }, sideLabel),
            h('span', null, '·'),
            h('span', { style: { whiteSpace: 'nowrap' } },
                `${text.layersLabel}: ${summary.layerCount}, ${summary.totalThickness.toFixed(1)} nm`,
            ),
            h('span', null, '·'),
            h('span', {
                title: media,
                style: {
                    minWidth: 0, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                },
            }, media),
            sampleSummary && h('span', null, '·'),
            sampleSummary && h('span', {
                style: { whiteSpace: 'nowrap', color: c.accent },
            }, sampleSummary),
        ),
        piecewise && h(FooterHint, {
            c, color: c.warning || '#f59e0b',
            label: text.piecewiseShort,
            detail: `${text.tableKnotWarning} (${raw.discontinuityModels.join('; ')})`,
        }),
        models.length > 0 && h(FooterHint, {
            c, label: text.models, detail: models.join('; '),
        }),
        h('div', { style: { marginLeft: 'auto' } }, h(ExportMenu, {
            c, enabled: csv.enabled,
            copied: csv.copied, copyCSV: csv.copyCSV,
            saved: csv.saved, saveCSV: csv.saveCSV,
            labels: {
                export: dataTable.export, copyCsv: dataTable.copyCsv,
                saveCsv: dataTable.saveCsv, copied: dataTable.csvCopied,
                saved: dataTable.csvSaved,
            },
        })),
    );
}
