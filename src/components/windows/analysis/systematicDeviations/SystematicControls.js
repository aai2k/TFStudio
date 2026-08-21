import { isIdentityDeviation } from '../../../../utils/physics/systematicDeviations.js';
import {
    ActionButton, CheckField, ChoiceGroup, NumInput, RangeField, SelectField,
} from '../chrome/controls.js';
import { ControlRow, EditorBody, EditorGroupTitle, FieldGrid } from '../chrome/layout.js';
import { NoticeBadge, SettingRow, SettingsMenu } from '../chrome/popover.js';
import { defaultSweepRange, sweepOptions, sweepParamKind } from './model.js';

const { createElement: h } = React;

const CHANNELS = [
    { id: 'all', label: 'T+R+A' },
    { id: 'T', label: 'T' },
    { id: 'R', label: 'R' },
    { id: 'A', label: 'A' },
];

const OFFSET_UNITS = [
    { id: 'nm', label: 'nm' },
    { id: 'ot', label: 'OT' },
    { id: 'qw', label: 'QW' },
    { id: 'fw', label: 'FW' },
];

/**
 * What is on screen: one deviated spectrum against the design, or a heat map of
 * one parameter swept across a range. The deviations themselves are edited in
 * the strip below the plot, where the per-material blocks have the window's
 * width to spread across.
 */
export function SystematicControls({ c, t, sd, state, notices }) {
    const single = state.mode === 'single';
    return h(ControlRow, {
        c,
        trailing: [
            !single && h(ActionButton, {
                key: 'run', c, disabled: state.sweepRunning,
                label: state.sweepRunning ? sd.running : sd.runSweep,
                onClick: state.runSweep,
            }),
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            h(SystematicSetup, { key: 'setup', c, t, sd, state }),
        ],
    },
        h(ChoiceGroup, {
            label: sd.mode, ariaLabel: sd.mode,
            activeId: state.mode, onSelect: state.setMode, c,
            items: [
                { id: 'single', label: sd.modeSingle },
                { id: 'sweep', label: sd.modeSweep },
            ],
        }),
        h(ChoiceGroup, {
            label: sd.channel, ariaLabel: sd.channel, c,
            activeId: single ? state.channel : state.sweepChannel,
            onSelect: single ? state.setChannel : state.setSweepChannel,
            items: CHANNELS,
        }),
        single && h(CheckField, {
            c, label: sd.baseline, checked: state.showBaseline,
            onChange: event => state.setShowBaseline(event.target.checked),
        }),
    );
}

function SystematicSetup({ c, t, sd, state }) {
    return h(SettingsMenu, {
        c, t, windowId: 'systematicDeviations', label: t.analysisChrome.settings, width: 300,
    },
        h(SettingRow, { c, label: 'λ' },
            h(RangeField, {
                c, unit: 'nm', width: 56,
                from: {
                    value: state.lambdaStart, min: 100, max: 30000, step: 10,
                    onChange: state.setLambdaStart,
                },
                to: {
                    value: state.lambdaEnd, min: 100, max: 30000, step: 10,
                    onChange: state.setLambdaEnd,
                },
            }),
        ),
        h(SettingRow, { c, label: sd.step },
            h(NumInput, {
                value: state.lambdaStep, min: 0.5, max: 50, step: 1, c, width: 60,
                onChange: state.setLambdaStep,
            }),
        ),
        h(SettingRow, { c, label: sd.aoi },
            h(NumInput, {
                value: state.aoi, min: 0, max: 89, step: 5, c, width: 60,
                onChange: state.setAoi,
            }),
        ),
        h(SettingRow, { c, label: sd.polarization },
            h(ChoiceGroup, {
                ariaLabel: sd.polarization, activeId: state.pol, onSelect: state.setPol, c,
                items: [
                    { id: 'avg', label: 'avg' },
                    { id: 's', label: 's' },
                    { id: 'p', label: 'p' },
                ],
            }),
        ),
    );
}

/** The editor strip's title and one-line summary, which follow the mode. */
export function systematicEditorHeader(state, sd) {
    if (state.mode !== 'single') {
        return { label: sd.sweepSection, summary: sweepSummary(state.sweep, sd) };
    }
    const touched = state.uniqueMats.filter(({ id }) => !isIdentityMaterial(state.dev, id)).length;
    return {
        label: sd.editorTitle,
        summary: isIdentityDeviation(state.dev)
            ? sd.noDeviation
            : `${touched} / ${state.uniqueMats.length} ${sd.materials}`,
    };
}

function isIdentityMaterial(dev, id) {
    const entry = dev.perMaterial?.[id];
    if (!entry) return true;
    return (entry.dScale ?? 1) === 1 && !entry.dOffset && !entry.dn && !entry.dk;
}

function sweepSummary(sweep, sd) {
    return `${sweep.from} – ${sweep.to} · ${sweep.steps} ${sd.steps}`;
}

/** Reset, in the editor strip's header. Sweep mode has nothing to reset. */
export function SystematicEditorActions({ c, sd, state }) {
    if (state.mode !== 'single') return null;
    return h(ActionButton, {
        c, label: sd.reset, disabled: isIdentityDeviation(state.dev),
        onClick: state.resetDeviation,
    });
}

export function SystematicEditor({ c, sd, state }) {
    return h(EditorBody, { c },
        state.mode === 'single'
            ? h(DeviationSettings, { c, sd, state })
            : h(SweepSettings, { c, sd, state }),
    );
}

function DeviationFields({ c, sd, values, onField }) {
    return h(FieldGrid, { minWidth: 230 },
        h(SettingRow, { c, label: sd.thkScale },
            h(NumInput, {
                value: values.scale, min: 0.5, max: 2, step: 0.005, c, width: 72,
                onChange: value => onField('scale', value),
            }),
            h('span', { style: { color: c.textDim, fontSize: 11 } }, '×'),
        ),
        h(SettingRow, { c, label: sd.thkOffset },
            h(NumInput, {
                value: values.offset, min: -1000, max: 1000, step: 1, c, width: 72,
                title: sd.thkOffsetTip,
                onChange: value => onField('offset', value),
            }),
            h(SelectField, {
                value: values.offsetUnit, options: OFFSET_UNITS, c, width: 62,
                title: sd.thkOffsetTip,
                onChange: unit => onField('offsetUnit', unit),
            }),
        ),
        h(SettingRow, { c, label: 'Δn' },
            h(NumInput, {
                value: values.dn, min: -2, max: 2, step: 0.005, c, width: 72,
                onChange: value => onField('dn', value),
            }),
        ),
        h(SettingRow, { c, label: 'Δk' },
            h(NumInput, {
                value: values.dk, min: -1, max: 1, step: 0.0005, c, width: 72,
                onChange: value => onField('dk', value),
            }),
        ),
    );
}

const GLOBAL_FIELD = {
    scale: 'globalThicknessScale',
    offset: 'globalThicknessOffset',
    offsetUnit: 'globalThicknessOffsetUnit',
    dn: 'globalDeltaN',
    dk: 'globalDeltaK',
};

const MATERIAL_FIELD = {
    scale: 'dScale', offset: 'dOffset', offsetUnit: 'dOffsetUnit', dn: 'dn', dk: 'dk',
};

function DeviationSettings({ c, sd, state }) {
    const { dev } = state;
    return h(React.Fragment, null,
        h(EditorGroupTitle, { c }, sd.globalSection),
        h(DeviationFields, {
            c, sd,
            values: {
                scale: dev.globalThicknessScale,
                offset: dev.globalThicknessOffset || 0,
                offsetUnit: dev.globalThicknessOffsetUnit || 'nm',
                dn: dev.globalDeltaN,
                dk: dev.globalDeltaK,
            },
            onField: (field, value) => state.updateGlobal(GLOBAL_FIELD[field], value),
        }),
        h(EditorGroupTitle, { c }, sd.perMaterialSection),
        state.uniqueMats.length === 0
            ? h('div', { style: { color: c.textDim, fontSize: 11 } }, sd.noMaterials)
            : state.uniqueMats.map(({ id, source }) => h('div', { key: id },
                h('div', { style: { fontSize: 11, fontWeight: 600, color: c.text, padding: '4px 0 0' } },
                    id,
                    h('span', { style: { fontWeight: 400, color: c.textDim, marginLeft: 4 } }, `(${source})`)),
                h(DeviationFields, {
                    c, sd,
                    values: {
                        scale: dev.perMaterial?.[id]?.dScale ?? 1,
                        offset: dev.perMaterial?.[id]?.dOffset || 0,
                        offsetUnit: dev.perMaterial?.[id]?.dOffsetUnit || 'nm',
                        dn: dev.perMaterial?.[id]?.dn || 0,
                        dk: dev.perMaterial?.[id]?.dk || 0,
                    },
                    onField: (field, value) => state.updateMat(id, MATERIAL_FIELD[field], value),
                }),
            )),
    );
}

/**
 * The sweep runs from the unperturbed design, so it takes a parameter and a
 * range rather than reading the deviations set in Single mode.
 */
function SweepSettings({ c, sd, state }) {
    const { sweep, setSweep } = state;
    const isOffset = sweepParamKind(sweep.param) === 'offset';
    return h(React.Fragment, null,
        h(FieldGrid, { minWidth: 260 },
            h(SettingRow, { c, label: sd.parameter },
                h(SelectField, {
                    value: sweep.param, c, width: 200,
                    options: sweepOptions(state.uniqueMats, sd)
                        .map(option => ({ id: option.value, label: option.label })),
                    onChange: param => setSweep(current => ({
                        ...current, param, ...defaultSweepRange(param, current.offsetUnit),
                    })),
                }),
            ),
            h(SettingRow, { c, label: sd.sweepUnit },
                h(SelectField, {
                    value: sweep.offsetUnit || 'nm', options: OFFSET_UNITS, c, width: 62,
                    disabled: !isOffset, title: sd.sweepUnitTip,
                    onChange: unit => setSweep(current => ({
                        ...current, offsetUnit: unit, ...defaultSweepRange(current.param, unit),
                    })),
                }),
            ),
            h(SettingRow, { c, label: `${sd.from} – ${sd.to}` },
                h(RangeField, {
                    c, width: 72,
                    from: {
                        value: sweep.from, step: 0.01,
                        onChange: value => setSweep(current => ({ ...current, from: value })),
                    },
                    to: {
                        value: sweep.to, step: 0.01,
                        onChange: value => setSweep(current => ({ ...current, to: value })),
                    },
                }),
            ),
            h(SettingRow, { c, label: sd.steps },
                h(NumInput, {
                    value: sweep.steps, min: 2, max: 200, step: 1, c, width: 72,
                    onChange: value => setSweep(current => ({
                        ...current, steps: Math.max(2, Math.floor(value)),
                    })),
                }),
            ),
        ),
        h('div', { style: { color: c.textDim, fontSize: 10, lineHeight: 1.5, padding: '6px 0 2px' } },
            sd.sweepNote),
    );
}
