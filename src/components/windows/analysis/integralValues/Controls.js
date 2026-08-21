import {
    BUILTIN_SOURCES,
    BUILTIN_DETECTORS,
} from '../../../../utils/physics/spectralWeightings.js';
import { ActionButton, ChoiceGroup, NumInput, RangeField, SelectField } from '../chrome/controls.js';
import { ControlRow } from '../chrome/layout.js';
import {
    NoticeBadge, PopoverButton, SettingDivider, SettingRow, SettingsMenu,
} from '../chrome/popover.js';

const { createElement: h } = React;

/**
 * Which integral the plot is drawn for. The others keep their values in the
 * results table; this only picks the one whose spectrum and weighting are shown.
 */
export function IntegralControls({ c, t, model, notices }) {
    const iv = t.integralValues;
    return h(ControlRow, {
        c,
        trailing: [
            h(CustomBuilder, { key: 'custom', c, t, model }),
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            h(EvaluationSettings, { key: 'setup', c, t, model }),
        ],
    },
        h(SelectField, {
            value: model.selected?.key || '', c, width: 220, title: iv.col_integral,
            options: model.integrals.map(integral => ({ id: integral.key, label: integral.label })),
            onChange: model.setSelKey,
        }),
    );
}

function EvaluationSettings({ c, t, model }) {
    const iv = t.integralValues;
    const { params, setParams } = model;
    const patch = patchValue => setParams(current => ({ ...current, ...patchValue }));
    return h(SettingsMenu, {
        c, t, windowId: 'integralValues', label: t.analysisChrome.settings, width: 320,
    },
        h(SettingRow, { c, label: iv.lambdaRange },
            h(RangeField, {
                c, unit: 'nm', width: 60,
                from: {
                    value: params.lambdaStart, min: 100, max: 30000, step: 10,
                    onChange: value => patch({ lambdaStart: value }),
                },
                to: {
                    value: params.lambdaEnd, min: 100, max: 30000, step: 10,
                    onChange: value => patch({ lambdaEnd: value }),
                },
            }),
        ),
        h(SettingRow, { c, label: iv.step },
            h(NumInput, {
                value: params.lambdaStep, min: 0.5, max: 50, step: 0.5, c, width: 60,
                onChange: value => patch({ lambdaStep: value > 0 ? value : 5 }),
            }),
        ),
        h(SettingRow, { c, label: iv.aoi },
            h(NumInput, {
                value: params.theta, min: 0, max: 89, step: 1, c, width: 60,
                onChange: value => patch({ theta: value }),
            }),
        ),
        h(SettingRow, { c, label: iv.pol },
            h(ChoiceGroup, {
                ariaLabel: iv.pol, activeId: params.polarization, c,
                onSelect: value => patch({ polarization: value }),
                items: [
                    { id: 'avg', label: 'avg' },
                    { id: 's', label: 's' },
                    { id: 'p', label: 'p' },
                ],
            }),
        ),
    );
}

function editTableLabel(iv, table) {
    return `${iv.editTable}${table?.length ? ` (${table.length})` : ''}`;
}

/**
 * Defines a new weighted integral: a channel, a source and detector to weight it
 * by, and the band to integrate over. Adding one puts it in the results table
 * alongside the built-ins and saves it with the presets.
 */
function CustomBuilder({ c, t, model }) {
    const iv = t.integralValues;
    const { builder, setBuilder } = model;
    return h(PopoverButton, { c, label: iv.customBuilderTitle, width: 330 },
        h(SettingRow, { c, label: iv.channel },
            h(ChoiceGroup, {
                ariaLabel: iv.channel, activeId: builder.char, c,
                onSelect: char => setBuilder({ ...builder, char }),
                items: [
                    { id: 'T', label: 'T' },
                    { id: 'R', label: 'R' },
                    { id: 'A', label: 'A' },
                ],
            }),
        ),
        h(SettingRow, { c, label: iv.source },
            h(SelectField, {
                value: builder.source.id, c, width: 180,
                options: BUILTIN_SOURCES.map(source => ({ id: source.id, label: source.label })),
                onChange: id => setBuilder({ ...builder, source: { ...builder.source, id } }),
            }),
        ),
        builder.source.id === 'blackbody' && h(SettingRow, { c, label: iv.sourceT },
            h(NumInput, {
                value: builder.source.T ?? 5778, min: 100, max: 30000, step: 50, c, width: 72,
                onChange: T => setBuilder({ ...builder, source: { ...builder.source, T } }),
            }),
            h('span', { style: { color: c.textDim, fontSize: 11 } }, iv.sourceT_K),
        ),
        builder.source.id === 'custom' && h(SettingRow, { c, label: '' },
            h(ActionButton, {
                c, label: editTableLabel(iv, builder.source.table),
                onClick: () => model.openEditor('source'),
            }),
        ),
        h(SettingRow, { c, label: iv.detector },
            h(SelectField, {
                value: builder.detector.id, c, width: 180,
                options: BUILTIN_DETECTORS.map(detector => ({
                    id: detector.id, label: detector.label,
                })),
                onChange: id => setBuilder({ ...builder, detector: { ...builder.detector, id } }),
            }),
        ),
        builder.detector.id === 'custom' && h(SettingRow, { c, label: '' },
            h(ActionButton, {
                c, label: editTableLabel(iv, builder.detector.table),
                onClick: () => model.openEditor('detector'),
            }),
        ),
        h(SettingRow, { c, label: iv.band },
            h(RangeField, {
                c, unit: iv.bandNm, width: 60,
                from: {
                    value: builder.bandMin, min: 0, max: 30000, step: 10,
                    onChange: bandMin => setBuilder({ ...builder, bandMin }),
                },
                to: {
                    value: builder.bandMax, min: 0, max: 30000, step: 10,
                    onChange: bandMax => setBuilder({ ...builder, bandMax }),
                },
            }),
        ),
        h(SettingDivider, { c }),
        h(SettingRow, { c, label: '' },
            h(ActionButton, {
                c, label: iv.addCustom, title: iv.addCustomTitle, onClick: model.onAddCustom,
            }),
        ),
    );
}
