/**
 * The window's one control row, and the sample settings behind it.
 *
 * On the row: which measurement is being characterized, what the plot is
 * showing, and the button that runs it. In the panel: everything that describes
 * the sample and the model, which is set once for a witness and then left alone.
 */

import { MaterialPicker } from '../../../ui/MaterialPicker.js';
import { PickerDropdown } from '../../../ui/PickerDropdown.js';
import {
    ActionButton, ChoiceGroup, FieldLabel, NumInput, SelectField,
} from '../../analysis/chrome/controls.js';
import { NoticeBadge, SettingRow, SettingsMenu } from '../../analysis/chrome/popover.js';
import { ControlRow } from '../../analysis/chrome/layout.js';
import { INDEX_MODELS } from '../../../../utils/materials/characterization/nkFit.js';
import { SAMPLE_GEOMETRIES } from '../../../../utils/materials/characterization/sampleSpectrum.js';
import { defaultSampleGeometry, thicknessSettingNm } from './model.js';

const { createElement: h } = React;

const NONE = '';

function curveOptions(curves, quantity, noneLabel) {
    return [
        { id: NONE, label: noneLabel },
        ...curves
            .filter(curve => curve.quantity === quantity)
            .map(curve => ({
                id: curve.id,
                label: `${curve.name} (${curve.aoi ?? 0}°, ${curve.side ?? 'front'})`,
            })),
    ];
}

/**
 * Curve names routinely contain the design and exported quantity, which is
 * wider than a docked toolbar. A native select on Windows lets that text paint
 * outside its box; PickerDropdown's closed trigger clips it reliably and keeps
 * the full name available in the list and tooltip.
 */
export function CurvePicker({ c, nk, curves, quantity, value, onChange, disabled }) {
    const options = curveOptions(curves, quantity, nk.noCurve);
    const selected = options.find(option => option.id === value) || options[0];
    const search = (query) => {
        const needle = query.toLowerCase().trim();
        return options
            .filter(option => !needle || option.label.toLowerCase().includes(needle))
            .map(option => ({ ...option, title: option.label }));
    };
    return h('div', {
        style: {
            width: '100%', minWidth: 0,
            opacity: disabled ? 0.5 : 1,
            pointerEvents: disabled ? 'none' : 'auto',
        },
    }, h(PickerDropdown, {
        c, compact: true, value, onChange,
        triggerLabel: selected.label,
        groups: [], search, sections: false,
        searchPlaceholder: nk.searchCurves,
        allLabel: '', emptyText: nk.noMatchingCurves,
        minDropWidth: 280,
    }));
}

/** The lazily rendered body of the settings popover. Exported for UI tests. */
export function SampleSettingsContent({ c, t, nk, state }) {
    const { settings, setField, design } = state;
    return h(React.Fragment, null,
        h(SettingRow, { c, label: nk.indexModel },
            h(SelectField, {
                c, width: 150, value: settings.indexModel,
                onChange: value => setField('indexModel', value),
                options: INDEX_MODELS.map(id => ({ id, label: nk.models[id] })),
            })),
        h(SettingRow, { c, label: nk.geometry },
            h(SelectField, {
                c, width: 150, value: settings.geometry || defaultSampleGeometry(design),
                onChange: value => setField('geometry', value),
                options: SAMPLE_GEOMETRIES.map(id => ({ id, label: nk.geometries[id] })),
            })),
        h(SettingRow, { c, label: nk.substrate },
            h('div', { style: { width: 150 } }, h(MaterialPicker, {
                c, t,
                value: settings.substrateId || design?.substrate?.material || 'BK7',
                onChange: value => setField('substrateId', value),
            }))),
        h(SettingRow, { c, label: nk.substrateThickness },
            h(NumInput, {
                c, width: 70, min: 0.01, max: 100, step: 0.1,
                value: Number(settings.substrateThicknessMm)
                    || (design?.substrate?.thickness ?? 1.0),
                onChange: value => setField('substrateThicknessMm', String(value)),
            }),
            h('span', { style: { color: c.textDim, marginLeft: 5 } }, 'mm')),
        h(SettingRow, { c, label: nk.range },
            h(NumInput, {
                c, width: 68, min: 1, max: 100000, step: 10,
                value: Number(settings.lambdaStart) || 0,
                onChange: value => setField('lambdaStart', String(value)),
            }),
            h('span', { style: { color: c.textDim, margin: '0 5px' } }, '–'),
            h(NumInput, {
                c, width: 68, min: 1, max: 100000, step: 10,
                value: Number(settings.lambdaEnd) || 0,
                onChange: value => setField('lambdaEnd', String(value)),
            })),
        h(SettingRow, { c, label: nk.thickness, wrap: true },
            h(ChoiceGroup, {
                c, activeId: settings.fixThickness ? 'hold' : 'solve',
                onSelect: id => setField('fixThickness', id === 'hold'),
                items: [
                    { id: 'solve', label: nk.thicknessSolve, title: nk.thicknessSolveHint },
                    { id: 'hold', label: nk.thicknessHold, title: nk.thicknessHoldHint },
                ],
            }),
            h(NumInput, {
                c, width: 74, min: 0, max: 1e6, step: 10, title: nk.thicknessHint,
                value: thicknessSettingNm(design, settings),
                onChange: value => setField('thicknessNm', String(value)),
            }),
            h('span', { style: { color: c.textDim, marginLeft: 5 } }, 'nm')),
    );
}

function SampleSettings({ c, t, nk, state }) {
    // No windowId: these settings describe one witness sample, not a way of
    // looking at a design, so there is nothing here worth saving as a default.
    return h(SettingsMenu, { c, t, label: t.analysisChrome.settings, width: 320 },
        h(SampleSettingsContent, { c, t, nk, state }));
}

export function CharacterizationControls({ c, t, nk, state, notices }) {
    const { curves, settings, setField, view, setViewField, running } = state;
    const noCurves = curves.length === 0;
    return h(ControlRow, {
        c,
        trailing: [
            h(NoticeBadge, { key: 'notices', c, notices }),
            h(SampleSettings, { key: 'settings', c, t, nk, state }),
        ],
    },
        // Keep the measurement pair together. The rest of the toolbar may wrap
        // on a narrow dock, but splitting T and R across separate rows makes the
        // pair much harder to scan and leaves either selector looking orphaned.
        h('div', {
            style: {
                display: 'grid',
                gridTemplateColumns: 'auto minmax(0, 1fr) auto minmax(0, 1fr)',
                alignItems: 'center', gap: 6,
                flex: '1 1 360px', minWidth: 260, maxWidth: 410,
            },
        },
            h(FieldLabel, { c }, 'T'),
            h(CurvePicker, {
                c, nk, curves, quantity: 'T', disabled: noCurves,
                value: settings.transmittanceId,
                onChange: value => setField('transmittanceId', value),
            }),
            h(FieldLabel, { c }, 'R'),
            h(CurvePicker, {
                c, nk, curves, quantity: 'R', disabled: noCurves,
                value: settings.reflectanceId,
                onChange: value => setField('reflectanceId', value),
            }),
        ),
        h(ActionButton, {
            c, label: running ? nk.running : nk.run, title: nk.runHint,
            disabled: running || (!settings.transmittanceId && !settings.reflectanceId),
            onClick: state.run,
        }),
        h(ChoiceGroup, {
            c, activeId: view.view,
            onSelect: id => setViewField('view', id),
            items: [
                { id: 'constants', label: nk.viewConstants },
                { id: 'fit', label: nk.viewFit },
                { id: 'residual', label: nk.viewResidual },
            ],
        }),
    );
}
