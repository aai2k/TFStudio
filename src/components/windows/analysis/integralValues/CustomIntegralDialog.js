/**
 * The dialog a custom integral is made in, and opened again on to change it:
 * its name, then the channel, the source and detector it is weighted by, and
 * the band it is integrated over.
 *
 * The name comes first and starts as the short name of the choices below it,
 * selected so that typing replaces it; until it is typed in, it follows them.
 * A blank name cannot be added.
 */

import {
    BUILTIN_SOURCES,
    BUILTIN_DETECTORS,
    describedLabel,
} from '../../../../utils/physics/spectralWeightings.js';
import { textInputStyle } from '../../dataExchange/chrome/panel.js';
import { ActionButton, ChoiceGroup, NumInput, RangeField, SelectField } from '../chrome/controls.js';
import { DialogFrame } from '../chrome/dialog.js';
import { SettingRow } from '../chrome/popover.js';
import { draftName } from './integralModel.js';

const { createElement: h, useEffect, useRef } = React;

const CHANNELS = ['T', 'R', 'A'].map(id => ({ id, label: id }));

function editTableLabel(iv, table) {
    return `${iv.editTable}${table?.length ? ` (${table.length})` : ''}`;
}

function NameField({ c, value, onChange, onEnter }) {
    const ref = useRef(null);
    useEffect(() => { ref.current?.select(); }, []);
    return h('input', {
        ref, type: 'text', value, autoFocus: true,
        onChange: event => onChange(event.target.value),
        onKeyDown: event => { if (event.key === 'Enter') onEnter(); },
        style: textInputStyle(c),
    });
}

// The source, and under it what that source takes: a temperature for a
// blackbody, a table for a custom one.
function SourceRows({ c, iv, t, draft, setDraft, openEditor }) {
    const source = draft.source;
    const setSource = patch => setDraft({ ...draft, source: { ...source, ...patch } });
    return [
        h(SettingRow, { key: 'source', c, label: iv.source },
            h(SelectField, {
                value: source.id, c, width: 180,
                options: BUILTIN_SOURCES.map(entry => ({ id: entry.id, label: describedLabel(entry, t.illuminants) })),
                onChange: id => setSource({ id }),
            }),
        ),
        source.id === 'blackbody' && h(SettingRow, { key: 'T', c, label: iv.sourceT },
            h(NumInput, {
                value: source.T ?? 5778, min: 100, max: 30000, step: 50, c, width: 72,
                onChange: T => setSource({ T }),
            }),
            h('span', { style: { color: c.textDim, fontSize: 11 } }, iv.sourceT_K),
        ),
        source.id === 'custom' && h(SettingRow, { key: 'table', c, label: '' },
            h(ActionButton, { c, label: editTableLabel(iv, source.table), onClick: () => openEditor('source') }),
        ),
    ];
}

function DetectorRows({ c, iv, t, draft, setDraft, openEditor }) {
    const detector = draft.detector;
    return [
        h(SettingRow, { key: 'detector', c, label: iv.detector },
            h(SelectField, {
                value: detector.id, c, width: 180,
                options: BUILTIN_DETECTORS.map(entry => ({ id: entry.id, label: describedLabel(entry, t.illuminants) })),
                onChange: id => setDraft({ ...draft, detector: { ...detector, id } }),
            }),
        ),
        detector.id === 'custom' && h(SettingRow, { key: 'table', c, label: '' },
            h(ActionButton, { c, label: editTableLabel(iv, detector.table), onClick: () => openEditor('detector') }),
        ),
    ];
}

/**
 * `model` is useIntegralValues: `draft` is what the dialog shows, and
 * `commitCustom` adds it, or changes the integral it was opened on.
 */
export function CustomIntegralDialog({ c, t, model }) {
    const iv = t.integralValues;
    const { draft, setDraft } = model;
    const parts = iv.customParts;
    const name = draft.named ? draft.name : draftName(draft, parts, model.customDefs);
    const blank = !name.trim();
    const editing = draft.key != null;
    const commit = () => { if (!blank) model.commitCustom(parts); };
    const rowProps = { c, iv, t, draft, setDraft, openEditor: model.openEditor };
    const footer = [
        h(ActionButton, { key: 'cancel', c, label: t.dialogs.input.cancel, onClick: model.closeCustom }),
        h(ActionButton, {
            key: 'ok', c, disabled: blank, onClick: commit,
            label: editing ? t.dialogs.input.ok : iv.addCustom,
            title: blank ? iv.nameNeeded : (editing ? undefined : iv.addCustomTitle),
        }),
    ];
    return h(DialogFrame, {
        c, title: editing ? iv.editCustomTitle : iv.newCustomTitle,
        onClose: model.closeCustom, closeTitle: t.dialogs.input.cancel,
        width: 'min(440px, 96vw)', footer,
    }, h('div', { style: { padding: '10px 14px 12px', display: 'flex', flexDirection: 'column' } },
        h(SettingRow, { c, label: iv.name },
            h(NameField, {
                c, value: name, onEnter: commit,
                onChange: value => setDraft({ ...draft, name: value, named: true }),
            }),
        ),
        h(SettingRow, { c, label: iv.channel },
            h(ChoiceGroup, {
                ariaLabel: iv.channel, activeId: draft.char, c, items: CHANNELS,
                onSelect: char => setDraft({ ...draft, char }),
            }),
        ),
        h(SourceRows, rowProps),
        h(DetectorRows, rowProps),
        h(SettingRow, { c, label: iv.band },
            h(RangeField, {
                c, unit: iv.bandNm, width: 60,
                from: {
                    value: draft.bandMin, positive: true, step: 10,
                    onChange: bandMin => setDraft({ ...draft, bandMin }),
                },
                to: {
                    value: draft.bandMax, positive: true, step: 10,
                    onChange: bandMax => setDraft({ ...draft, bandMax }),
                },
            }),
        ),
    ));
}
