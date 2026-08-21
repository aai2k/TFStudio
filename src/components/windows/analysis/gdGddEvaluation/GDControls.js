import {
    CheckField, ChoiceGroup, NumInput, RangeField, ToggleButton,
} from '../chrome/controls.js';
import { ControlRow } from '../chrome/layout.js';
import { NoticeBadge, SettingDivider, SettingRow, SettingsMenu } from '../chrome/popover.js';
import { gdGddTargetColor } from './gdTargets.js';

const { createElement: h } = React;

/**
 * The switches that decide which curve is drawn. Everything that describes the
 * range or the geometry it is drawn over lives in the Setup panel.
 */
export function GDControls({ c, t, text, state, raw, autoRange, notices }) {
    const hasTargets = state.targets.length > 0;
    const targetColor = gdGddTargetColor(state.target);
    return h(ControlRow, {
        c,
        'data-gd-toolbar': 'curves',
        trailing: [
            h(ToggleButton, {
                key: 'targets',
                c, label: text.targets || 'Targets',
                active: state.showTargets && hasTargets,
                disabled: !hasTargets,
                onClick: () => state.setShowTargets(current => !current),
                title: hasTargets
                    ? (text.targetsTip || 'Show merit-function targets for this curve')
                    : (text.noTargetsTip || 'No matching merit-function targets'),
            },
                h('span', {
                    style: {
                        width: 14, height: 0,
                        borderTop: `2px dotted ${hasTargets ? targetColor : c.textDim}`,
                    },
                }),
            ),
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            h(GDSetup, { key: 'setup', c, t, text, state, raw, autoRange }),
        ],
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
    );
}

function GDSetup({ c, t, text, state, raw, autoRange }) {
    return h(SettingsMenu, {
        c, t, windowId: 'gdGddEvaluation', label: t.analysisChrome.settings, width: 300,
    },
        h(SettingRow, { c, label: text.side || 'Side' },
            h(ChoiceGroup, {
                ariaLabel: text.side || 'Side',
                activeId: state.side, onSelect: state.setSide, c,
                items: [
                    { id: 'front', label: text.front || 'Front', color: '#1e88e5' },
                    { id: 'back', label: text.back || 'Back', color: '#e53935' },
                    ...(state.target === 'T'
                        ? [{ id: 'total', label: text.total || 'Total', color: '#ab47bc' }]
                        : []),
                ],
            }),
        ),
        h(SettingRow, { c, label: text.aoi },
            h(NumInput, {
                value: state.theta, min: 0, max: 89, step: 1, c, width: 60,
                onChange: state.setTheta,
            }),
        ),
        h(SettingDivider, { c }),
        h(SettingRow, { c, label: 'λ' },
            h(RangeField, {
                c, unit: 'nm',
                from: {
                    value: state.lamStart, min: 100, max: 30000, step: 10,
                    onChange: state.setLamStart,
                },
                to: {
                    value: state.lamEnd, min: 100, max: 30000, step: 10,
                    onChange: state.setLamEnd,
                },
            }),
        ),
        h(YAxisSetting, { c, text, state, autoRange }),
        h(SettingRow, { c, label: text.refLam },
            h(CheckField, {
                c, label: '', checked: state.showRef,
                onChange: event => state.setShowRef(event.target.checked),
            }),
            h(NumInput, {
                value: state.refLam, min: 100, max: 30000, step: 1, c, width: 64,
                onChange: state.setRefLam,
            }),
        ),
        h(SettingDivider, { c }),
        h(SamplingNote, { c, text, raw }),
    );
}

/**
 * Vertical range. Auto is the robust range from autoYRange, which excludes the
 * divergence spikes at reflection minima; the count it excluded is reported in
 * the notice badge rather than here.
 */
function YAxisSetting({ c, text, state, autoRange }) {
    const effective = autoRange?.range || [0, 1];
    const shown = value => Number.isFinite(value) ? value : null;
    const low = shown(state.yMin) ?? effective[0];
    const high = shown(state.yMax) ?? effective[1];
    const step = Math.max(1e-6, Math.abs(high - low) / 20);
    return h(SettingRow, { c, label: 'Y' },
        h(CheckField, {
            c, label: text.yAuto, checked: state.yAuto,
            onChange: (event) => {
                // Leaving Auto seeds the fields from what is on screen, so the
                // range does not jump when the checkbox is cleared.
                if (!event.target.checked) {
                    state.setYMin(Number(effective[0].toPrecision(6)));
                    state.setYMax(Number(effective[1].toPrecision(6)));
                }
                state.setYAuto(event.target.checked);
            },
        }),
        h(NumInput, {
            value: Number(low.toPrecision(6)), step, c, width: 64, disabled: state.yAuto,
            onChange: value => state.setYMin(value),
        }),
        h('span', { style: { color: c.textDim, fontSize: 11 } }, '–'),
        h(NumInput, {
            value: Number(high.toPrecision(6)), step, c, width: 64, disabled: state.yAuto,
            onChange: value => state.setYMax(value),
        }),
    );
}

/** How the curve was sampled, and which dispersion models produced it. */
function SamplingNote({ c, text, raw }) {
    const models = raw?.models || [];
    const sampling = raw
        ? `${raw.method}${raw.adaptivePointCount ? `, +${raw.adaptivePointCount} adaptive points` : ''}`
        : null;
    if (!sampling && !models.length) return null;
    return h('div', { style: { color: c.textDim, fontSize: 10, lineHeight: 1.5 } },
        sampling && h('div', { style: { color: c.accent } }, sampling),
        models.length > 0 && h('div', null, `${text.models}: ${models.join('; ')}`),
    );
}
