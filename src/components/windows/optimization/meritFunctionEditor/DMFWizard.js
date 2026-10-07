import {
    OPERAND_POLS, FILTER_CATEGORIES, FILTER_TYPES,
} from '../../../../utils/physics/optimizer.js';
import { Checkbox } from '../../../ui/Checkbox.js';
import { NumInput, SelectField } from '../../analysis/chrome/controls.js';
import { requestTool } from '../../../../utils/misc/toolRequest.js';
import { useWindowSession } from '../../windowSession.js';
import { CurveEditor } from '../../dataExchange/curveEditor/CurveEditor.js';
import { pointsFromTable } from '../../dataExchange/curveEditor/curveApply.js';
import { tableFromPoints } from '../../dataExchange/curveEditor/curveTable.js';
import { curveWizardRows, gainCurveFromText, heldCurve, wizardCurveOptions } from './curveWizardModel.js';
import { buildWizardResult, wizardAppendRow, wizardGenerationRows } from './meritOperandModel.js';
import { meritWizardSession } from './sessionState.js';
import { WizardHeader } from './WizardHeader.js';
import {
    blockSummary, fieldRows, fieldView, hasTargetMode, paramsWithChange, polIsFixed, takesCurve,
    typeSwitch, wizardSummary, writesPointsOnly,
} from './wizardModel.js';

const { createElement: h, useState, useEffect } = React;

const FIELD_UNITS = {
    rPct: '%', rsPct: '%', rpPct: '%', valuePct: '%', tStart: '', tEnd: '', points: '',
    curveId: '', scale: '', input: '', gain: '', curvePol: '', curveAoi: '°',
    insertionLossDb: 'dB', ppefDb: 'dB',
};
const fieldUnit = key => (Object.prototype.hasOwnProperty.call(FIELD_UNITS, key) ? FIELD_UNITS[key] : 'nm');

// The Preset box holds a different set of fields for every filter type, up to
// five rows for a triple-band AR, and is padded to that height so switching type
// never moves the controls below it. The other two boxes hold a fixed set of
// rows and are stretched to match while they sit beside it, so padding them buys
// nothing there and shows only as empty space once one wraps onto its own line.
const BOX_ROWS = 5;

// Height of one row of controls, which is what NumInput and SelectField stand.
const CONTROL_H = 24;

function styles(c) {
    return {
        c,
        label: { fontSize: 11, color: c.textDim, whiteSpace: 'nowrap' },
        group: { display: 'flex', alignItems: 'center', gap: 4 },
        unit: { fontSize: 11, color: c.textDim },
    };
}

// The app's shared fields, so a wizard entry behaves like every other number in
// TFStudio: a dot is a dot whatever the machine's locale says, and the value is
// taken on blur rather than after each digit typed.
function numberInput(s, value, onChange, width, extra = {}) {
    const { disabled, min, max, positive, step, title } = extra;
    return h(NumInput, { value, onChange, min, max, positive, step, title, disabled, c: s.c, width });
}

function select(s, value, onChange, options, width) {
    return h(SelectField, {
        value, onChange, c: s.c, width,
        options: options.map(option => ({ id: option.value, label: option.label })),
    });
}

// A box never shrinks below the width its controls need: a pane narrower than
// the three boxes together wraps a whole box onto the next line, and the
// controls inside every box stay where they are.
//
// `grow` is for a box whose controls are all fixed width. Spare room does
// nothing for it, and taking a share of it is what makes a wrapped box span the
// pane with its controls stranded at one end.
function groupBox({ title, columns, rows, minWidth, grow = true, c }) {
    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', gap: 4, minWidth,
            flex: grow ? `1 1 ${minWidth}px` : `0 0 ${minWidth}px`,
        },
    },
        h('span', { style: { fontSize: 11, fontWeight: 600, color: c.textDim } }, title),
        h('div', {
            style: {
                border: `1px solid ${c.border}`, borderRadius: 3, background: c.panel,
                padding: '8px', display: 'grid', gridTemplateColumns: columns,
                gridAutoRows: CONTROL_H, rowGap: 6, columnGap: 5, alignItems: 'center',
                flex: 1,
            },
        }, rows));
}

function padRows(cells, perRow, used) {
    const out = [...cells];
    for (let i = used; i < BOX_ROWS; i++) {
        for (let j = 0; j < perRow; j++) out.push(h('span', { key: `pad-${i}-${j}` }));
    }
    return out;
}

// A curve field: the design's measured curves of the quantities it takes.
function curveControl(ctx, key, view) {
    const { s, tw, design, updateParam } = ctx;
    const curves = wizardCurveOptions(design, view.def.quantities);
    const held = heldCurve(curves, view.value);
    const options = [
        { value: '', label: tw.pickCurve },
        ...curves.map(curve => ({ value: curve.id, label: `${curve.name} (${curve.quantity})` })),
    ];
    return select(s, held ? held.id : '', v => updateParam(key, v || null), options, '100%');
}

function smallButton(c, label, onClick) {
    return h('button', {
        onClick,
        style: {
            height: 20, padding: '0 8px', fontSize: 11, border: `1px solid ${c.border}`, borderRadius: 3,
            background: c.panel, color: c.text, cursor: 'pointer', fontFamily: 'inherit',
        },
    }, label);
}

// A gain read from a file or typed into the curve editor, which the wizard
// holds until it is replaced; the design keeps the target derived from it, not
// the gain. The buttons come first and the gain's name shortens to fit after
// them, so a narrow box never pushes a button out of sight.
function gainControl(ctx, key, view) {
    const { s, tw, c, gainSource } = ctx;
    const { gainError, importGain, typeGain } = gainSource;
    const loaded = view.value?.x?.length ? `${view.value.name} (${view.value.x.length})` : tw.gainNone;
    const status = gainError ? tw.gainImportFailed : loaded;
    return h('div', { style: { ...s.group, minWidth: 0 } },
        smallButton(c, tw.gainImport, () => importGain(key)),
        smallButton(c, tw.gainType, () => typeGain(key, view.value)),
        h('span', {
            title: status,
            style: {
                ...s.label, color: gainError ? c.error : c.text,
                flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
            },
        }, status));
}

const FIELD_CONTROLS = { curve: curveControl, gainCurve: gainControl };

// One field of a preset row: a select, a curve, a gain, or a number with its unit.
function fieldControl(ctx, key, width) {
    const { s, tw, session, typeId, updateParam } = ctx;
    const view = fieldView(typeId, key, session.params);
    if (!view) return null;
    const { def } = view;
    if (FIELD_CONTROLS[def.kind]) return FIELD_CONTROLS[def.kind](ctx, key, view);
    if (def.kind === 'select') {
        const options = view.options.map(option => ({ ...option, label: tw.fieldOptions?.[key]?.[option.value] ?? option.label }));
        return select(s, view.value, v => updateParam(key, v), options, width || 'auto');
    }
    return numberInput(s, view.value, v => updateParam(key, v), width || 62,
        { min: view.min, max: view.max, positive: def.positive, step: view.step, title: tw.fieldTips?.[key] });
}

// What stands between the two fields of a pair row: a dash for a range.
const PAIR_JOINERS = { rsRp: '/' };

// Selects that name their choice in words, so they take the row's width.
const WIDE_FIELDS = ['input'];

function presetRow(ctx, row) {
    const { s, tw } = ctx;
    const keyL = row.label + '-l';
    const keyC = row.label + '-c';
    if (row.kind === 'pair') {
        const joiner = PAIR_JOINERS[row.label] ?? '–';
        return [
            h('span', { key: keyL, style: s.label }, tw.pairs[row.label] + ':'),
            h('div', { key: keyC, style: s.group },
                fieldControl(ctx, row.keys[0], 62), h('span', null, joiner), fieldControl(ctx, row.keys[1], 62)),
        ];
    }
    if (row.kind === 'statement') {
        return [
            h('span', { key: keyL, style: s.label }, tw.pairs.statement + ':'),
            h('div', { key: keyC, style: s.group },
                fieldControl(ctx, 'channel', 40), fieldControl(ctx, 'unit', 48),
                fieldControl(ctx, 'cmp', 40), fieldControl(ctx, 'valuePct', 52)),
        ];
    }
    const key = row.keys[0];
    const unit = fieldUnit(key);
    const width = WIDE_FIELDS.includes(key) ? '100%' : 62;
    return [
        h('span', { key: keyL, style: s.label, title: tw.fieldTips?.[key] }, (tw.fields[key] || key) + ':'),
        h('div', { key: keyC, style: s.group }, fieldControl(ctx, key, width), unit && h('span', { style: s.unit }, unit)),
    ];
}

function presetBox(ctx) {
    const { s, tw, c, session, patch } = ctx;
    const cat = FILTER_CATEGORIES.find(entry => entry.id === session.catId) || FILTER_CATEGORIES[0];
    const categories = FILTER_CATEGORIES.map(entry => ({ value: entry.id, label: tw.categories[entry.id] || entry.id }));
    const types = cat.types.map(id => ({ value: id, label: tw.types[id]?.label || id }));
    const switchCategory = id => {
        const next = FILTER_CATEGORIES.find(entry => entry.id === id);
        if (next) patch({ catId: id, ...typeSwitch(session.typeId, next.types[0]) });
    };
    const switchType = id => patch(typeSwitch(session.typeId, id));
    const rows = fieldRows(session.typeId, session.params);
    const cells = [
        h('span', { key: 'preset-l', style: s.label }, tw.presetLabel + ':'),
        h('span', { key: 'preset-c' }, select(s, session.catId, switchCategory, categories, '100%')),
        h('span', { key: 'type-l', style: s.label }, tw.typeLabel + ':'),
        h('span', { key: 'type-c', title: tw.types[session.typeId]?.tip || '' },
            select(s, session.typeId, switchType, types, '100%')),
        ...rows.flatMap(row => presetRow(ctx, row)),
    ];
    return groupBox({
        title: tw.presetBox, columns: '84px minmax(130px, 1fr)', minWidth: 238, c,
        rows: padRows(cells, 2, 2 + rows.length),
    });
}

// The target-mode row. A statement that writes point rows whatever the mode,
// T = a level in dB, shows only the step those points are written on.
function modeCells(ctx) {
    const { s, tw, session, setField, typeId } = ctx;
    const stepInput = () => numberInput(s, session.stepNm, v => setField('stepNm', v), 48, { positive: true, step: 0.5 });
    if (writesPointsOnly(typeId, session.params)) {
        return [
            h('span', { key: 'mode-l', style: s.label }, tw.stepNm + ':'),
            h('span', { key: 'mode-c' }, stepInput()),
        ];
    }
    if (!hasTargetMode(typeId)) return [h('span', { key: 'mode-l' }), h('span', { key: 'mode-c' })];
    const discrete = session.targetMode === 'discrete';
    return [
        h('span', { key: 'mode-l', style: s.label }, tw.targetMode + ':'),
        h('div', { key: 'mode-c', style: s.group },
            select(s, session.targetMode, v => setField('targetMode', v), [
                { value: 'continuous', label: tw.targetContinuous },
                { value: 'discrete', label: tw.targetDiscrete },
            ], 112),
            discrete && h('span', { style: s.label }, tw.stepNm + ':'),
            discrete && stepInput()),
    ];
}

// A curve type's Angle and target box: the angle and polarization a target
// derived from a gain is put at, and the values the filter is specified by. A
// type that reads a curve already on the design says its rows take that
// curve's conditions; the note goes last, where its wrapped second line has
// the box's spare room below it.
function curveAngleBox(ctx) {
    const { s, tw, c, session, typeId } = ctx;
    const rows = fieldRows(typeId, session.params, 'angle');
    const setsConditions = rows.some(row => row.keys.includes('curveAoi'));
    const cells = rows.flatMap(row => presetRow(ctx, row));
    if (!setsConditions) {
        cells.push(h('span', {
            key: 'curve-note', style: { ...s.label, whiteSpace: 'normal', gridColumn: '1 / -1' },
        }, tw.curveConditions));
    }
    return groupBox({ title: tw.angleBox, columns: 'auto minmax(62px, 1fr)', minWidth: 204, c, rows: cells });
}

function angleBox(ctx) {
    const { s, tw, c, session, setField, typeId } = ctx;
    if (takesCurve(typeId)) return curveAngleBox(ctx);
    const showPol = !polIsFixed(typeId);
    const cells = [
        h('span', { key: 'aoi-l', style: s.label }, tw.aoiRange + ':'),
        h('div', { key: 'aoi-c', style: s.group },
            numberInput(s, session.aoi, v => setField('aoi', v), 52, { min: 0, max: 89 }),
            h('span', null, '–'),
            numberInput(s, session.aoiEnd, v => setField('aoiEnd', v), 52, { min: 0, max: 89 })),
        h('span', { key: 'steps-l', style: s.label }, tw.aoiSteps + ':'),
        h('span', { key: 'steps-c' }, numberInput(s, session.aoiSteps, v => setField('aoiSteps', v), 44, {
            min: 2, max: 20, disabled: session.aoi === session.aoiEnd,
        })),
        h('span', { key: 'pol-l', style: s.label }, showPol ? tw.pol + ':' : ''),
        h('span', { key: 'pol-c' }, showPol
            ? select(s, session.pol, v => setField('pol', v), OPERAND_POLS.map(p => ({ value: p, label: p })), 64)
            : null),
        ...modeCells(ctx),
    ];
    return groupBox({ title: tw.angleBox, columns: '64px minmax(116px, 1fr)', minWidth: 204, c, rows: cells });
}

function limitRow(ctx, { key, checked, onToggle, name, label, value, onChange, step }) {
    const { s, c } = ctx;
    return [
        h('label', { key: key + '-check', style: { ...s.group, gap: 5, cursor: 'pointer', userSelect: 'none' } },
            h(Checkbox, { c, checked, onChange: e => onToggle(e.target.checked) }),
            h('span', { style: { fontSize: 11, color: c.text } }, name)),
        h('span', { key: key + '-l', style: s.label }, label + ':'),
        h('span', { key: key + '-c' }, numberInput(s, value, onChange, 64, { min: 0.01, step, disabled: !checked })),
    ];
}

// Each limit has its own checkbox, named for what it limits.
function limitsBox(ctx) {
    const { tw, c, session, setField } = ctx;
    const cells = [
        ...limitRow(ctx, {
            key: 'min', checked: session.minEnabled, onToggle: v => setField('minEnabled', v),
            name: tw.layersLabel, label: tw.minLabel, value: session.minThick, onChange: v => setField('minThick', v),
        }),
        ...limitRow(ctx, {
            key: 'max', checked: session.maxEnabled, onToggle: v => setField('maxEnabled', v),
            name: tw.layersLabel, label: tw.maxLabel, value: session.maxThick, onChange: v => setField('maxThick', v), step: 10,
        }),
        ...limitRow(ctx, {
            key: 'total', checked: session.totalEnabled, onToggle: v => setField('totalEnabled', v),
            name: tw.totalLabel, label: tw.maxTotalLabel, value: session.maxTotal, onChange: v => setField('maxTotal', v),
        }),
    ];
    return groupBox({
        title: tw.limitsBox, columns: '70px 62px minmax(64px, 1fr)', minWidth: 224,
        grow: false, c, rows: cells,
    });
}

function useStartRow(design, operandCount) {
    const [startRow, setStartRow] = useState(wizardAppendRow(operandCount));
    useEffect(() => { setStartRow(wizardAppendRow(operandCount)); }, [design?.id]); // eslint-disable-line
    return [startRow, setStartRow];
}

// The row count and the Generate button, which are the only things that need
// the block itself. Building it is what the whole form amounts to: an
// angle-swept preset in discrete mode runs to thousands of operands, so it is
// built here, inside the branch that only renders while the form is open.
function wizardResult(ctx) {
    const { tw, session, typeId, design } = ctx;
    const curveRows = takesCurve(typeId)
        ? curveWizardRows({ typeId, params: session.params, design, flatteningName: tw.flatteningName })
        : null;
    return buildWizardResult({ tw, ...session, typeId, curveRows });
}

// What the line under the boxes says: why the block cannot be generated, or
// how many rows of which types it adds.
function lineMessage(tw, result, noDesignText) {
    if (noDesignText) return noDesignText;
    if (result.error) return tw.curveErrors[result.error];
    const summary = blockSummary(result.block);
    return tw.preview(summary.count, summary.types.join(', '));
}

// The line wraps in a narrow pane: the message breaks over lines and Start at
// row with Generate moves under it, rather than running out of the window.
// With no design selected there is no table to generate into.
function bottomLine(ctx, startRow, setStartRow, onGenerate) {
    const { s, tw, c } = ctx;
    const result = wizardResult(ctx);
    const noDesign = ctx.hasActiveDesign === false;
    const blocked = !!result.error || noDesign;
    return h('div', {
        style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px', minHeight: CONTROL_H },
    },
        h('span', { style: { ...s.label, color: blocked ? c.error : s.label.color, whiteSpace: 'normal', flex: '1 1 160px' } },
            lineMessage(tw, result, noDesign ? ctx.noDesignText : null)),
        !noDesign && result.error === 'noCurves'
            && smallButton(c, tw.openMeasuredSpectra, () => requestTool('spectrum-exchange')),
        h('div', { style: { ...s.group, gap: 8, marginLeft: 'auto' } },
            h('span', { style: s.label, title: tw.startRowTip }, tw.startRow + ':'),
            numberInput(s, startRow, v => setStartRow(Math.max(1, Math.round(v) || 1)), 52, { min: 1, step: 1 }),
            h('button', {
                onClick: () => onGenerate(result.block, result.curves), disabled: blocked,
                title: noDesign ? ctx.noDesignText : tw.willReplace,
                style: {
                    height: CONTROL_H, padding: '0 14px', fontSize: 11, border: 'none', borderRadius: 3,
                    background: c.accent, color: c.accentText, cursor: blocked ? 'default' : 'pointer',
                    opacity: blocked ? 0.5 : 1, fontWeight: 600, fontFamily: 'inherit',
                },
            }, tw.generate)));
}

// Where the wizard's gain comes from: a file the user picks, read into the
// fields, or the curve editor, opened on the gain held now. A file that holds
// no table leaves the gain as it was and says so.
function useGainSource(updateParam, tw) {
    const [gainError, setGainError] = useState(false);
    const [editing, setEditing] = useState(null);
    const importGain = async (key) => {
        const picked = await window.electronAPI?.spectrumPickFile?.();
        if (!picked?.success) {
            if (!picked?.canceled) setGainError(true);
            return;
        }
        const gain = gainCurveFromText(picked.text, picked.fileName);
        setGainError(!gain);
        if (gain) updateParam(key, gain);
    };
    const typeGain = (key, gain) => setEditing({ key, gain });
    const applyTyped = (table) => {
        const points = pointsFromTable(table);
        const name = editing.gain?.name || tw.gainTyped;
        updateParam(editing.key, { name, x: points.map(point => point[0]), y: points.map(point => point[1]) });
        setGainError(false);
        setEditing(null);
    };
    return { gainError, importGain, typeGain, editing, applyTyped, cancelTyped: () => setEditing(null) };
}

// The curve editor on the gain, while it is open.
function gainEditor(gainSource, tw, c, t) {
    const { editing } = gainSource;
    if (!editing) return null;
    const points = editing.gain?.x?.map((x, index) => [x, editing.gain.y[index]]) || [];
    return h(CurveEditor, {
        title: t.curveEditor.titleGain(editing.gain?.name || tw.gainTyped),
        table: tableFromPoints('gain', points),
        design: null,
        onApply: gainSource.applyTyped,
        onCancel: gainSource.cancelTyped,
        c, t,
    });
}

export function DMFWizard({ design, hasActiveDesign, onGenerate, operandCount, mf, omf, busy, c, t }) {
    const te = t.meritFunctionEditor;
    const tw = te.wizard;
    const [session, setField, patch] = useWindowSession(meritWizardSession, null);
    const [startRow, setStartRow] = useStartRow(design, operandCount);
    const typeId = FILTER_TYPES[session.typeId] ? session.typeId : FILTER_CATEGORIES[0].types[0];
    const updateParam = (key, value) => setField('params', prev => paramsWithChange(typeId, prev, key, value));
    const gainSource = useGainSource(updateParam, tw);
    const ctx = {
        s: styles(c), tw, c, session, setField, patch, typeId, updateParam, design, hasActiveDesign, gainSource,
        noDesignText: te.noDesign,
    };

    // With no design selected the line under the boxes says so, and Start at
    // row stays where it is.
    const generate = (block, curves) => {
        if (hasActiveDesign === false) return;
        const rows = wizardGenerationRows(startRow, block.length);
        onGenerate(block, rows.startRow, curves);
        setStartRow(rows.nextStartRow);
    };
    const summary = wizardSummary({
        typeLabel: tw.types[typeId]?.label || typeId, params: session.params, aoi: session.aoi, aoiEnd: session.aoiEnd,
    });

    return h(React.Fragment, null,
        h(WizardHeader, {
            open: session.open, onToggle: () => setField('open', !session.open),
            summary, design, mf, omf, busy, c, t, te,
        }),
        session.open && h('div', {
            style: {
                display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px',
                background: c.bg, borderBottom: `1px solid ${c.border}`, flexShrink: 0,
            },
        },
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'stretch' } },
                presetBox(ctx), angleBox(ctx), limitsBox(ctx)),
            bottomLine(ctx, startRow, setStartRow, generate),
        ),
        gainEditor(gainSource, tw, c, t),
    );
}
