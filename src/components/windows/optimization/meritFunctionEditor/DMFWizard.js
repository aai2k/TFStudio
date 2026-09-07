import {
    OPERAND_POLS, FILTER_CATEGORIES, FILTER_TYPES, defaultFilterParams,
} from '../../../../utils/physics/optimizer.js';
import { Checkbox } from '../../../ui/Checkbox.js';
import { useWindowSession } from '../../windowSession.js';
import { buildWizardBlock, wizardAppendRow, wizardGenerationRows } from './meritOperandModel.js';
import { meritWizardSession } from './sessionState.js';
import { WizardHeader } from './WizardHeader.js';
import {
    blockSummary, fieldDef, fieldRows, hasTargetMode, polIsFixed, wizardSummary,
} from './wizardModel.js';

const { createElement: h, useState, useEffect } = React;

const FIELD_UNITS = { rPct: '%', rsPct: '%', rpPct: '%', valuePct: '%', tStart: '', tEnd: '', points: '' };
const fieldUnit = key => (Object.prototype.hasOwnProperty.call(FIELD_UNITS, key) ? FIELD_UNITS[key] : 'nm');

// Every box has the same five rows, so switching type never moves a control.
const BOX_ROWS = 5;

function styles(c) {
    const control = {
        background: c.bg, color: c.text, border: `1px solid ${c.border}`,
        borderRadius: 3, fontSize: 11, padding: '2px 5px', fontFamily: 'inherit',
        height: 22, boxSizing: 'border-box', outline: 'none', whiteSpace: 'nowrap',
    };
    return {
        control,
        label: { fontSize: 11, color: c.textDim, whiteSpace: 'nowrap' },
        group: { display: 'flex', alignItems: 'center', gap: 4 },
        unit: { fontSize: 11, color: c.textDim },
    };
}

function numberInput(s, value, onChange, width, extra = {}) {
    const { disabled, ...rest } = extra;
    return h('input', {
        type: 'number', value, disabled: !!disabled,
        onChange: e => onChange(+e.target.value),
        style: { ...s.control, width, opacity: disabled ? 0.5 : 1 },
        ...rest,
    });
}

function select(s, value, onChange, options, width) {
    return h('select', { value, onChange: e => onChange(e.target.value), style: { ...s.control, width } },
        options.map(option => h('option', { key: option.value, value: option.value }, option.label)));
}

// A box never shrinks below the width its controls need: a pane narrower than
// the three boxes together wraps a whole box onto the next line, and the
// controls inside every box stay where they are.
function groupBox({ title, columns, rows, minWidth, c }) {
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, flex: `1 1 ${minWidth}px`, minWidth } },
        h('span', { style: { fontSize: 11, fontWeight: 600, color: c.textDim } }, title),
        h('div', {
            style: {
                border: `1px solid ${c.border}`, borderRadius: 3, background: c.panel,
                padding: '8px 10px', display: 'grid', gridTemplateColumns: columns,
                gridAutoRows: 22, rowGap: 6, columnGap: 6, alignItems: 'center',
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

// One field of a preset row: a select, or a number with its unit.
function fieldControl(ctx, key, width) {
    const { s, session, typeId, updateParam } = ctx;
    const def = fieldDef(typeId, key);
    if (!def) return null;
    const value = session.params[key] ?? def.default;
    if (def.kind === 'select') return select(s, value, v => updateParam(key, v), def.options, width || 'auto');
    return numberInput(s, value, v => updateParam(key, v), width || 62, { min: def.min, max: def.max, step: def.step ?? 1 });
}

function presetRow(ctx, row) {
    const { s, tw } = ctx;
    const keyL = row.label + '-l';
    const keyC = row.label + '-c';
    if (row.kind === 'pair') {
        const joiner = row.label === 'rsRp' ? '/' : '–';
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
                fieldControl(ctx, 'channel', 44), fieldControl(ctx, 'cmp', 44), fieldControl(ctx, 'valuePct', 52),
                h('span', { style: s.unit }, '%')),
        ];
    }
    const key = row.keys[0];
    const unit = fieldUnit(key);
    return [
        h('span', { key: keyL, style: s.label }, (tw.fields[key] || key) + ':'),
        h('div', { key: keyC, style: s.group }, fieldControl(ctx, key, 62), unit && h('span', { style: s.unit }, unit)),
    ];
}

function presetBox(ctx) {
    const { s, tw, c, session, patch } = ctx;
    const cat = FILTER_CATEGORIES.find(entry => entry.id === session.catId) || FILTER_CATEGORIES[0];
    const categories = FILTER_CATEGORIES.map(entry => ({ value: entry.id, label: tw.categories[entry.id] || entry.id }));
    const types = cat.types.map(id => ({ value: id, label: tw.types[id]?.label || id }));
    const switchCategory = id => {
        const next = FILTER_CATEGORIES.find(entry => entry.id === id);
        if (next) patch({ catId: id, typeId: next.types[0], params: defaultFilterParams(next.types[0]) });
    };
    const switchType = id => patch({ typeId: id, params: defaultFilterParams(id) });
    const rows = fieldRows(session.typeId);
    const cells = [
        h('span', { key: 'preset-l', style: s.label }, tw.presetLabel + ':'),
        h('span', { key: 'preset-c' }, select(s, session.catId, switchCategory, categories, '100%')),
        h('span', { key: 'type-l', style: s.label }, tw.typeLabel + ':'),
        h('span', { key: 'type-c', title: tw.types[session.typeId]?.tip || '' },
            select(s, session.typeId, switchType, types, '100%')),
        ...rows.flatMap(row => presetRow(ctx, row)),
    ];
    return groupBox({
        title: tw.presetBox, columns: '84px minmax(130px, 1fr)', minWidth: 244, c,
        rows: padRows(cells, 2, 2 + rows.length),
    });
}

function angleBox(ctx) {
    const { s, tw, c, session, setField, typeId } = ctx;
    const showPol = !polIsFixed(typeId);
    const showMode = hasTargetMode(typeId);
    const discrete = session.targetMode === 'discrete';
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
        h('span', { key: 'mode-l', style: s.label }, showMode ? tw.targetMode + ':' : ''),
        showMode ? h('div', { key: 'mode-c', style: s.group },
            select(s, session.targetMode, v => setField('targetMode', v), [
                { value: 'continuous', label: tw.targetContinuous },
                { value: 'discrete', label: tw.targetDiscrete },
            ], 112),
            discrete && h('span', { style: s.label }, tw.stepNm + ':'),
            discrete && numberInput(s, session.stepNm, v => setField('stepNm', v), 48, { min: 0.1, step: 0.5 }),
        ) : h('span', { key: 'mode-c' }),
    ];
    return groupBox({ title: tw.angleBox, columns: '64px minmax(116px, 1fr)', minWidth: 212, c, rows: padRows(cells, 2, 4) });
}

function limitRow(ctx, { key, checked, onToggle, name, label, value, onChange }) {
    const { s, c } = ctx;
    return [
        h('label', { key: key + '-check', style: { ...s.group, gap: 5, cursor: 'pointer', userSelect: 'none' } },
            h(Checkbox, { c, checked, onChange: e => onToggle(e.target.checked) }),
            h('span', { style: { fontSize: 11, color: c.text } }, name)),
        h('span', { key: key + '-l', style: s.label }, label + ':'),
        h('span', { key: key + '-c' }, numberInput(s, value, onChange, 64, { min: 0.01, disabled: !checked })),
    ];
}

function limitsBox(ctx) {
    const { s, tw, c, session, setField } = ctx;
    const cells = [
        ...limitRow(ctx, {
            key: 'min', checked: session.constraintsEnabled, onToggle: v => setField('constraintsEnabled', v),
            name: tw.layersLabel, label: tw.minLabel, value: session.minThick, onChange: v => setField('minThick', v),
        }),
        h('span', { key: 'max-pad' }),
        h('span', { key: 'max-l', style: s.label }, tw.maxLabel + ':'),
        h('span', { key: 'max-c' }, numberInput(s, session.maxThick, v => setField('maxThick', v), 64, {
            min: 0.01, step: 10, disabled: !session.constraintsEnabled,
        })),
        ...limitRow(ctx, {
            key: 'total', checked: session.totalEnabled, onToggle: v => setField('totalEnabled', v),
            name: tw.totalLabel, label: tw.maxTotalLabel, value: session.maxTotal, onChange: v => setField('maxTotal', v),
        }),
    ];
    return groupBox({ title: tw.limitsBox, columns: '70px 62px minmax(64px, 1fr)', minWidth: 232, c, rows: padRows(cells, 3, 3) });
}

function useStartRow(design, operandCount) {
    const [startRow, setStartRow] = useState(wizardAppendRow(operandCount));
    useEffect(() => { setStartRow(wizardAppendRow(operandCount)); }, [design?.id]); // eslint-disable-line
    return [startRow, setStartRow];
}

function bottomLine(ctx, block, startRow, setStartRow, onGenerate) {
    const { s, tw, c } = ctx;
    const summary = blockSummary(block);
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, height: 22 } },
        h('span', { style: s.label }, tw.preview(summary.count, summary.types.join(', '))),
        h('span', { style: { flex: 1 } }),
        h('span', { style: s.label, title: tw.startRowTip }, tw.startRow + ':'),
        numberInput(s, startRow, v => setStartRow(Math.max(1, Math.round(v) || 1)), 52, { min: 1, step: 1 }),
        h('button', {
            onClick: onGenerate, title: tw.willReplace,
            style: {
                marginLeft: 8, height: 22, padding: '0 14px', fontSize: 11, border: 'none', borderRadius: 3,
                background: c.accent, color: c.accentText, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit',
            },
        }, tw.generate));
}

export function DMFWizard({ design, onGenerate, operandCount, mf, omf, busy, c, t }) {
    const te = t.meritFunctionEditor;
    const tw = te.wizard;
    const [session, setField, patch] = useWindowSession(meritWizardSession, null);
    const [startRow, setStartRow] = useStartRow(design, operandCount);
    const typeId = FILTER_TYPES[session.typeId] ? session.typeId : FILTER_CATEGORIES[0].types[0];
    const updateParam = (key, value) => setField('params', prev => ({ ...prev, [key]: value }));
    const ctx = { s: styles(c), tw, c, session, setField, patch, typeId, updateParam };

    const block = buildWizardBlock({ tw, ...session, typeId });
    const generate = () => {
        const rows = wizardGenerationRows(startRow, block.length);
        onGenerate(block, rows.startRow);
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
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'stretch' } },
                presetBox(ctx), angleBox(ctx), limitsBox(ctx)),
            bottomLine(ctx, block, startRow, setStartRow, generate),
        ),
    );
}
