import { ActionButton, ChoiceGroup, FieldLabel, NumInput } from '../../analysis/chrome/controls.js';
import { ControlRow } from '../../analysis/chrome/layout.js';
import { SettingDivider, SettingRow, SettingsMenu } from '../../analysis/chrome/popover.js';
import { MaterialPicker } from '../../../ui/MaterialPicker.js';

const { createElement: h } = React;

/**
 * How many layers go on a chip is the one control the answer turns on, so it
 * sits on the row with the two buttons that re-plan the run. Everything about
 * the monitor itself is a setting.
 */
export function WorksheetControls({ c, t, state, trailing = [] }) {
    const mw = t.monitorWorksheet;
    const { session } = state;
    return h(ControlRow, {
        c,
        trailing: [...trailing, h(MonitorSetup, { key: 'setup', c, t, state })],
    },
        h(FieldLabel, { c }, mw.layersPerChip),
        h(NumInput, {
            value: session.layersPerChip, min: 1, max: 50, step: 1, c, width: 56,
            title: mw.layersPerChipTip, onChange: state.setLayersPerChip,
        }),
        h(ActionButton, {
            label: mw.autoLambda, c, title: mw.autoLambdaTip,
            disabled: !state.stepCount, onClick: state.autoLambda,
        }),
        h(FieldLabel, { c }, mw.bulkLambda),
        h(NumInput, {
            value: state.bulkLambda, min: 100, max: 30000, step: 10, c, width: 72,
            title: mw.setAllLambdaTip, onChange: state.setBulkLambda,
        }),
        h(ActionButton, {
            label: mw.setAllLambda, c, title: mw.setAllLambdaTip,
            disabled: !state.stepCount, onClick: state.applyLambdaToAll,
        }),
        h(ActionButton, {
            label: mw.resetPlan, c, title: mw.resetPlanTip,
            disabled: !state.planned, onClick: state.resetPlan,
        }),
    );
}

function MonitorSetup({ c, t, state }) {
    const mw = t.monitorWorksheet;
    const { session, setField } = state;
    return h(SettingsMenu, {
        c, t, windowId: 'monitorWorksheet', label: t.analysisChrome.settings, width: 300,
    },
        h(SettingRow, { c, label: mw.measured },
            h(ChoiceGroup, {
                ariaLabel: mw.measured, activeId: session.char, c,
                onSelect: value => setField('char', value),
                items: [{ id: 'T', label: 'T' }, { id: 'R', label: 'R' }],
            }),
        ),
        h(SettingRow, { c, label: mw.polarization },
            h(ChoiceGroup, {
                ariaLabel: mw.polarization, activeId: session.polarization, c,
                onSelect: value => setField('polarization', value),
                items: [
                    { id: 'avg', label: t.settings.analysis.fields.avg },
                    { id: 's', label: 's' },
                    { id: 'p', label: 'p' },
                ],
            }),
        ),
        h(SettingRow, { c, label: mw.aoi },
            h(NumInput, {
                value: session.theta, min: 0, max: 89, step: 1, c, width: 68,
                onChange: value => setField('theta', value),
            }),
            h(FieldLabel, { c }, '°'),
        ),
        // The witness chip's glass. It follows the design substrate until
        // another material is picked; the reset appears only while overridden.
        h(SettingRow, { c, label: mw.chipGlass },
            h('div', { style: { width: 150 }, title: mw.chipGlassTip },
                h(MaterialPicker, {
                    value: session.chipMaterial || state.design?.substrate?.material || 'builtin:BK7',
                    onChange: value => setField('chipMaterial', value),
                    c, t, compact: true,
                }),
            ),
            session.chipMaterial ? h(ActionButton, {
                label: mw.chipGlassReset, c, title: mw.chipGlassResetTip,
                onClick: () => setField('chipMaterial', null),
            }) : null,
        ),
        h(SettingRow, { c, label: mw.witnessRatio },
            h(NumInput, {
                value: session.witnessRatio, min: 0.05, max: 10, step: 0.01, c, width: 68,
                title: mw.witnessRatioTip, onChange: value => setField('witnessRatio', value),
            }),
        ),
        h(SettingDivider, { c }),
        h(SettingRow, { c, label: mw.layersInView },
            h(NumInput, {
                value: session.layersInView, min: 2, max: 200, step: 1, c, width: 68,
                title: mw.layersInViewTip, onChange: value => setField('layersInView', value),
            }),
        ),
        h(SettingDivider, { c }),
        h(SettingRow, { c, label: mw.signalError },
            h(NumInput, {
                value: session.signalErrorPct, min: 0.001, max: 50, step: 0.1, c, width: 68,
                title: mw.signalErrorTip, onChange: value => setField('signalErrorPct', value),
            }),
            h(FieldLabel, { c }, '%'),
        ),
        h(SettingRow, { c, label: mw.maxTermination },
            h(NumInput, {
                value: session.maxTerminationErrPct, min: 0.01, max: 100, step: 0.1, c, width: 68,
                title: mw.maxTerminationTip, onChange: value => setField('maxTerminationErrPct', value),
            }),
            h(FieldLabel, { c }, '%'),
        ),
    );
}
