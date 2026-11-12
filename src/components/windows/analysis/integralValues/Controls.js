import { tablerIcon } from '../../../ui/tablerIcons.js';
import { ActionButton, ChoiceGroup, NumInput, RangeField, SelectField } from '../chrome/controls.js';
import { ControlRow } from '../chrome/layout.js';
import { NoticeBadge, SettingRow, SettingsMenu } from '../chrome/popover.js';

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
            h(NewCustomButton, { key: 'custom', c, t, model }),
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
                c, unit: t.units.nm, width: 60,
                from: {
                    value: params.lambdaStart, positive: true, step: 10,
                    onChange: value => patch({ lambdaStart: value }),
                },
                to: {
                    value: params.lambdaEnd, positive: true, step: 10,
                    onChange: value => patch({ lambdaEnd: value }),
                },
            }),
        ),
        h(SettingRow, { c, label: iv.step },
            h(NumInput, {
                value: params.lambdaStep, positive: true, step: 0.5, c, width: 60,
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
                    { id: 'avg', label: iv.polAvg },
                    { id: 's', label: 's' },
                    { id: 'p', label: 'p' },
                ],
            }),
        ),
    );
}

/**
 * Opens the dialog a new weighted integral is defined in. Adding one puts it in
 * the results table alongside the built-ins and saves it with the presets.
 */
function NewCustomButton({ c, t, model }) {
    const iv = t.integralValues;
    return h(ActionButton, {
        c, label: iv.newCustom, title: iv.newCustomTip, onClick: model.openNewCustom,
    }, tablerIcon('plus', 13));
}
