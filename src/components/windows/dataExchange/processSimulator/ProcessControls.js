/**
 * The window's control row and its settings panel.
 *
 * The row holds what defines the run and what is drawn: the side being
 * deposited, whether it goes on the part or on witness chips, the state of the
 * opposite surface, the quantity, and the layer curves. The monitor's geometry,
 * the spectral range, the export step and the output format are settings:
 * they are set once per instrument, and on the row they wrapped a docked window
 * twice over and moved every control on each resize.
 */

import {
    ActionButton, CheckField, ChoiceGroup, NumInput, RangeField,
} from '../../analysis/chrome/controls.js';
import { ControlRow } from '../../analysis/chrome/layout.js';
import {
    NoticeBadge, SettingDivider, SettingRow, SettingsMenu,
} from '../../analysis/chrome/popover.js';

const { createElement: h, Fragment } = React;

const SIDE_COLORS = { front: '#1e88e5', back: '#e53935' };
const FORMATS = ['res', 'csv', 'txt'];
const DELIMITERS = [
    { id: ',', key: 'delimComma' }, { id: ';', key: 'delimSemicolon' },
    { id: '\t', key: 'delimTab' }, { id: ' ', key: 'delimSpace' },
];

function StatusMessage({ c, status }) {
    const error = status.type === 'error';
    return h('div', {
        title: status.message,
        style: {
            fontSize: 11, height: 28, display: 'flex', alignItems: 'center',
            padding: '0 8px', borderRadius: 6,
            color: error ? c.error : c.success,
            backgroundColor: (error ? c.error : c.success) + (c.light ? '20' : '30'),
            maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        },
    }, status.message);
}

function ProcessSettings({ c, t, sp, setup }) {
    return h(SettingsMenu, { c, t, label: t.analysisChrome.settings, width: 300 },
        h(SettingRow, { c, label: sp.polarization },
            h(ChoiceGroup, {
                ariaLabel: sp.polarization, activeId: setup.polarization, onSelect: setup.setPolarization, c,
                items: [{ id: 'avg', label: sp.polAvg }, { id: 's', label: 's' }, { id: 'p', label: 'p' }],
            }),
        ),
        h(SettingRow, { c, label: sp.aoi },
            h(NumInput, { c, width: 68, value: setup.aoi, min: 0, max: 89, step: 1, onChange: setup.setAoi }),
        ),
        h(SettingRow, { c, label: 'λ' },
            h(RangeField, {
                c, unit: 'nm', width: 60,
                from: { value: setup.lambdaStart, positive: true, step: 10, onChange: setup.setLambdaStart },
                to: { value: setup.lambdaEnd, positive: true, step: 10, onChange: setup.setLambdaEnd },
            }),
        ),
        h(SettingRow, { c, label: sp.step },
            h(NumInput, {
                c, width: 68, value: setup.lambdaStep, positive: true, step: 0.5,
                onChange: setup.setLambdaStep,
            }),
        ),
        h(SettingDivider, { c }),
        h(SettingRow, { c, label: sp.exportStep },
            h(NumInput, {
                c, width: 68, title: sp.exportStepHint,
                value: setup.exportStep, positive: true, step: 0.1,
                onChange: setup.setExportStep,
            }),
        ),
        h(OutputSettings, { c, t, sp, setup }),
    );
}

// What a save writes. A .res file has one layout, so the rows under the format
// show for CSV and text only.
//
// A decimal comma in a comma-delimited row has to be quoted, and most readers,
// the spectrum importer among them, do not undo the quotes. The comma
// delimiter is not offered beside a decimal comma, and choosing the comma mark
// moves a comma delimiter to a semicolon.
function OutputSettings({ c, t, sp, setup }) {
    const { output, setOutputOption } = setup;
    const sx = t.spectrumExchange;
    const choice = (key, label, items, onSelect = id => setOutputOption(key, id)) => h(SettingRow, { c, label },
        h(ChoiceGroup, { ariaLabel: label, activeId: output[key], c, items, onSelect }),
    );
    const delimiters = output.decimalMark === ',' ? DELIMITERS.filter(({ id }) => id !== ',') : DELIMITERS;
    const pickDecimalMark = (id) => {
        setOutputOption('decimalMark', id);
        if (id === ',' && output.delimiter === ',') setOutputOption('delimiter', ';');
    };
    const format = choice('format', sp.fileFormat, FORMATS.map(id => ({ id, label: `.${id}` })));
    if (output.format === 'res') return format;
    return h(Fragment, null,
        format,
        choice('files', sp.filesLabel, [
            { id: 'step', label: sp.filesPerStep },
            { id: 'table', label: sp.filesTable, title: sp.filesTableHint },
        ]),
        choice('header', sp.headerLabel, [
            { id: 'layers', label: sp.headerLayers, title: sp.headerLayersHint },
            { id: 'conditions', label: sp.headerConditions, title: sp.headerConditionsHint },
            { id: 'none', label: sp.headerNone, title: sp.headerNoneHint },
        ]),
        choice('delimiter', sp.delimiterLabel, delimiters.map(({ id, key }) => ({ id, label: sx[key] }))),
        choice('scale', sx.exportScaleLabel, [
            { id: 'percent', label: sx.percent },
            { id: 'fraction', label: sx.fraction },
        ]),
        // Twelve, the decimals the shared writer keeps when no count is set:
        // a percentage held in double precision has no more to give.
        h(SettingRow, { c, label: sp.decimalsLabel },
            h(NumInput, {
                c, width: 68, value: output.decimals, min: 0, max: 12, step: 1,
                onChange: value => setOutputOption('decimals', Math.round(value)),
            }),
        ),
        // The marks are shown as the numbers they write.
        choice('decimalMark', sp.decimalMarkLabel, [{ id: '.', label: '0.5' }, { id: ',', label: '0,5' }], pickDecimalMark),
    );
}

function saveLabel(sp, save, ext) {
    if (!save.saving) return sp.saveBtn(ext);
    return save.progress ? sp.savingStep(save.progress.i, save.progress.total) : sp.saving;
}

export function ProcessControls({ c, t, sp, setup, deposition, save, notices, chipMode }) {
    const hasActive = deposition.N > 0;
    const ext = `.${setup.output.format}`;
    return h(ControlRow, {
        c,
        trailing: [
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            save.statusMsg && h(StatusMessage, { key: 'status', c, status: save.statusMsg }),
            h(ActionButton, {
                key: 'save', c, label: saveLabel(sp, save, ext),
                title: sp.saveBtn(ext), disabled: !hasActive || save.saving,
                onClick: save.handleSave,
            }),
            h(ProcessSettings, { key: 'settings', c, t, sp, setup }),
        ],
    },
        h(ChoiceGroup, {
            label: sp.activeSide, activeId: setup.activeSide, onSelect: setup.setActiveSide, c,
            items: [
                { id: 'front', label: sp.front, color: SIDE_COLORS.front },
                { id: 'back', label: sp.back, color: SIDE_COLORS.back },
            ],
        }),
        h(ChoiceGroup, {
            label: sp.depositOn, activeId: setup.mode, onSelect: setup.setMode, c,
            items: [
                { id: 'part', label: sp.modePart },
                { id: 'chips', label: sp.modeChips },
            ],
        }),
        // A witness chip's back face is always bare; the opposite-side choice
        // belongs to the part alone.
        !chipMode && h(ChoiceGroup, {
            label: sp.secondSurface, activeId: setup.secondSurface, onSelect: setup.setSecondSurface, c,
            items: [
                { id: 'bare', label: sp.bare },
                { id: 'coated', label: sp.coated },
            ],
        }),
        h(ChoiceGroup, {
            label: sp.quantity, activeId: setup.quantity, onSelect: setup.setQuantity, c,
            items: [{ id: 'T', label: 'T' }, { id: 'R', label: 'R' }, { id: 'A', label: 'A' }],
        }),
        h(CheckField, {
            c, label: sp.showAllLayers, title: sp.showAllHint,
            checked: setup.showAll,
            onChange: event => setup.setShowAll(event.target.checked),
        }),
    );
}
