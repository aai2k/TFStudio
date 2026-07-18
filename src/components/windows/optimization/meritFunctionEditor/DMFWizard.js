import {
    OPERAND_POLS, FILTER_CATEGORIES, FILTER_TYPES, defaultFilterParams,
} from '../../../../utils/physics/optimizer.js';
import { Checkbox } from '../../../ui/Checkbox.js';
import { buildWizardBlock, wizardAppendRow, wizardGenerationRows } from './meritOperandModel.js';

const { createElement: h, useState, useEffect, useCallback } = React;

const FIELD_UNITS = { rPct: '%', rsPct: '%', rpPct: '%', valuePct: '%', tStart: '', tEnd: '', points: '' };

function fieldUnit(key) {
    return Object.prototype.hasOwnProperty.call(FIELD_UNITS, key) ? FIELD_UNITS[key] : 'nm';
}

export function DMFWizard({ design, onGenerate, operandCount, c, t }) {
    const tw = t.meritFunctionEditor.wizard;
    const [catId, setCatId] = useState(FILTER_CATEGORIES[0].id);
    const [typeId, setTypeId] = useState(FILTER_CATEGORIES[0].types[0]);
    const [params, setParams] = useState(() => defaultFilterParams(FILTER_CATEGORIES[0].types[0]));
    const [aoi, setAoi] = useState(0);
    const [aoiEnd, setAoiEnd] = useState(0);
    const [aoiSteps, setAoiSteps] = useState(3);
    const [pol, setPol] = useState('avg');
    const [constraintsEnabled, setConstraintsEnabled] = useState(true);
    const [minThick, setMinThick] = useState(40);
    const [maxThick, setMaxThick] = useState(1000);
    const [totalEnabled, setTotalEnabled] = useState(false);
    const [maxTotal, setMaxTotal] = useState(3000);
    const [targetMode, setTargetMode] = useState('continuous');
    const [stepNm, setStepNm] = useState(1);
    const [startRow, setStartRow] = useState(wizardAppendRow(operandCount));
    useEffect(() => { setStartRow(wizardAppendRow(operandCount)); }, [design?.id]); // eslint-disable-line

    const typeDef = FILTER_TYPES[typeId];
    const cat = FILTER_CATEGORIES.find(entry => entry.id === catId) || FILTER_CATEGORIES[0];

    const switchType = useCallback((newTypeId) => {
        setTypeId(newTypeId);
        setParams(defaultFilterParams(newTypeId));
    }, []);

    const switchCategory = useCallback((newCatId) => {
        const newCat = FILTER_CATEGORIES.find(entry => entry.id === newCatId);
        if (!newCat) return;
        setCatId(newCatId);
        const firstType = newCat.types[0];
        setTypeId(firstType);
        setParams(defaultFilterParams(firstType));
    }, []);

    const updateParam = useCallback((key, value) => {
        setParams(prev => ({ ...prev, [key]: value }));
    }, []);

    const lbl = { fontSize: 11, color: c.textDim, whiteSpace: 'nowrap' };
    const inp = {
        background: c.bg, color: c.text, border: `1px solid ${c.border}`,
        borderRadius: 3, fontSize: 11, padding: '2px 5px', fontFamily: 'inherit',
        width: 62, outline: 'none'
    };
    const sel = { ...inp, width: 'auto', minWidth: 100 };
    const grp = { display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 };
    const pillBtn = (active) => ({
        padding: '2px 9px', fontSize: 11, fontFamily: 'inherit',
        border: `1px solid ${active ? c.accent : c.border}`, borderRadius: 11,
        background: active ? c.accent : c.bg,
        color: active ? '#fff' : c.text,
        cursor: 'pointer', fontWeight: active ? 600 : 400,
    });

    const handleGenerate = () => {
        const block = buildWizardBlock({
            tw, typeId, params, aoi, aoiEnd, aoiSteps, pol, targetMode, stepNm,
            constraintsEnabled, minThick, maxThick, totalEnabled, maxTotal,
        });
        const rows = wizardGenerationRows(startRow, block.length);
        onGenerate(block, rows.startRow);
        setStartRow(row => wizardGenerationRows(row, block.length).nextStartRow);
    };

    const discreteTarget = targetMode === 'discrete';
    const targetStepControls = discreteTarget ? [
        h('span', { key: 'step-label', style: lbl }, tw.stepNm + ':'),
        h('input', {
            key: 'step-input', type: 'number', value: stepNm, min: 0.1, step: 0.5,
            onChange: e => setStepNm(+e.target.value), style: { ...inp, width: 52 }
        }),
    ] : [false, false];

    return h('div', {
        style: {
            padding: '7px 10px', borderBottom: `1px solid ${c.border}`,
            background: c.panel, flexShrink: 0
        }
    },
        h('div', { style: { fontSize: 11, fontWeight: 600, color: c.textDim, marginBottom: 5, letterSpacing: '0.05em', textTransform: 'uppercase' } },
            tw.sectionTitle),

        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' } },
            h('span', { style: lbl }, tw.categoryLabel + ':'),
            FILTER_CATEGORIES.map(catEntry =>
                h('button', {
                    key: catEntry.id,
                    onClick: () => switchCategory(catEntry.id),
                    style: pillBtn(catEntry.id === catId),
                }, tw.categories[catEntry.id] || catEntry.id)
            )
        ),

        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' } },
            h('span', { style: lbl }, tw.typeLabel + ':'),
            cat.types.map(tId =>
                h('button', {
                    key: tId,
                    onClick: () => switchType(tId),
                    style: pillBtn(tId === typeId),
                    title: tw.types[tId]?.tip || tId,
                }, tw.types[tId]?.label || tId)
            )
        ),

        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 5 } },
            typeDef.fields.map(field => {
                const isSelect = field.kind === 'select';
                return h('div', { key: field.key, style: grp },
                    h('span', { style: lbl }, (tw.fields[field.key] || field.key) + ':'),
                    isSelect
                        ? h('select', {
                            value: params[field.key] ?? field.default,
                            onChange: e => updateParam(field.key, e.target.value),
                            style: { ...inp, width: 'auto', minWidth: 52 }
                        }, field.options.map(o => h('option', { key: o.value, value: o.value }, o.label)))
                        : h('input', {
                            type: 'number',
                            value: params[field.key] ?? field.default,
                            min: field.min, max: field.max, step: field.step ?? 1,
                            onChange: e => updateParam(field.key, +e.target.value),
                            style: { ...inp, width: 70 }
                        }),
                    !isSelect && fieldUnit(field.key) && h('span', { style: { ...lbl, color: c.textDim } }, fieldUnit(field.key))
                );
            })
        ),

        h('div', {
            style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 5, borderTop: `1px solid ${c.border}` }
        },
            h('div', { style: grp },
                h('span', { style: lbl }, tw.aoiRange + ':'),
                h('input', { type: 'number', value: aoi, min: 0, max: 89, onChange: e => setAoi(+e.target.value), style: { ...inp, width: 48 } }),
                h('span', { style: { ...lbl, color: c.text } }, '–'),
                h('input', { type: 'number', value: aoiEnd, min: 0, max: 89, onChange: e => setAoiEnd(+e.target.value), style: { ...inp, width: 48 } })
            ),

            aoi !== aoiEnd && h('div', { style: grp },
                h('span', { style: lbl }, tw.aoiSteps + ':'),
                h('input', { type: 'number', value: aoiSteps, min: 2, max: 20, onChange: e => setAoiSteps(+e.target.value), style: { ...inp, width: 40 } })
            ),

            h('div', { style: grp },
                h('span', { style: lbl }, tw.pol + ':'),
                h('select', { value: pol, onChange: e => setPol(e.target.value), style: sel },
                    OPERAND_POLS.map(p => h('option', { key: p, value: p }, p)))
            ),

            typeDef.supportsTargetMode && h('div', { style: grp },
                h('span', { style: lbl }, tw.targetMode + ':'),
                h('select', { value: targetMode, onChange: e => setTargetMode(e.target.value), style: sel },
                    h('option', { value: 'continuous' }, tw.targetContinuous),
                    h('option', { value: 'discrete' }, tw.targetDiscrete)
                ),
                ...targetStepControls
            )
        ),

        // Thickness constraints — grouped together, always directly under the
        // AOI / Pol / target-mode controls row.
        h('div', {
            style: { display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', paddingTop: 6 }
        },
            h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'nowrap' } },
                h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', userSelect: 'none' } },
                    h(Checkbox, {
                        c, checked: constraintsEnabled,
                        onChange: e => setConstraintsEnabled(e.target.checked),
                    }),
                    h('span', { style: { fontSize: 11, color: c.text, whiteSpace: 'nowrap' } }, tw.constraintsLabel)
                ),
                constraintsEnabled && h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
                    h('span', { style: lbl }, tw.minLabel + ':'),
                    h('input', { type: 'number', value: minThick, min: 0.01, step: 1, onChange: e => setMinThick(+e.target.value), style: { ...inp, width: 64 } }),
                    h('span', { style: lbl }, tw.maxLabel + ':'),
                    h('input', { type: 'number', value: maxThick, min: 0.01, step: 10, onChange: e => setMaxThick(+e.target.value), style: { ...inp, width: 72 } })
                )
            ),

            h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'nowrap' } },
                h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', userSelect: 'none' } },
                    h(Checkbox, {
                        c, checked: totalEnabled,
                        onChange: e => setTotalEnabled(e.target.checked),
                    }),
                    h('span', { style: { fontSize: 11, color: c.text, whiteSpace: 'nowrap' } }, tw.totalConstraintLabel)
                ),
                totalEnabled && h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
                    h('span', { style: lbl }, tw.maxTotalLabel + ':'),
                    h('input', { type: 'number', value: maxTotal, min: 1, step: 50, onChange: e => setMaxTotal(+e.target.value), style: { ...inp, width: 80 } })
                )
            )
        ),

        // Start row + Generate.
        h('div', {
            style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', paddingTop: 6 }
        },
            h('div', { style: { flex: 1 } }),

            h('div', { style: grp, title: tw.startRowTip },
                h('span', { style: lbl }, tw.startRow + ':'),
                h('input', {
                    type: 'number', value: startRow, min: 1, step: 1,
                    onChange: e => setStartRow(Math.max(1, Math.round(+e.target.value) || 1)),
                    style: { ...inp, width: 56 }
                })
            ),

            h('button', {
                onClick: handleGenerate,
                style: {
                    padding: '3px 14px', fontSize: 11, border: 'none', borderRadius: 3,
                    background: c.accent, color: '#fff', cursor: 'pointer', fontWeight: 600,
                    fontFamily: 'inherit', flexShrink: 0
                },
                title: tw.willReplace
            }, tw.generate)
        )
    );
}
