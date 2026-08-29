import {
    ActionButton, CheckField, ChoiceGroup, NumInput, SelectField,
} from '../../analysis/chrome/controls.js';
import { PlotArea, SidePanel } from '../../analysis/chrome/layout.js';
import { EllipsometryChart } from '../../analysis/ellipsometryEvaluation/EllipsometryChart.js';
import { measuredCurveData, X_UNITS } from '../../../../utils/io/spectrumTable.js';
import { FieldRow, PanelSection, textInputStyle } from '../chrome/panel.js';
import { curvePairs } from './model.js';

const { createElement: h, useEffect, useState } = React;

const UNIT_ITEMS = [
    { id: X_UNITS.NM, label: 'nm' },
    { id: X_UNITS.UM, label: 'µm' },
    { id: X_UNITS.EV, label: 'eV' },
];

const QUANTITY_ITEMS = [{ id: 'PSI', label: 'Ψ' }, { id: 'DEL', label: 'Δ' }];

function conventionItems(mx) {
    return [
        { id: 'azzam', label: mx.deltaAzzam, title: mx.deltaAzzamTip },
        { id: 'reversed', label: mx.deltaReversed, title: mx.deltaReversedTip },
    ];
}

/**
 * The conditions a Ψ/Δ pair means nothing without.
 *
 * The angle leads because it is the one an ellipsometer file most often fails
 * to state and the one the fit cannot proceed without: at normal incidence
 * there is no p/s distinction left to measure.
 */
function MeasurementConditions({ controller, c, mx }) {
    const { aoi, setAoi, side, setSide, deltaConvention, setDeltaConvention } = controller;
    return h(PanelSection, { c, title: mx.conditionsTitle },
        h(FieldRow, { c, label: mx.aoiLabel },
            h(NumInput, { value: aoi, onChange: setAoi, min: 0, max: 89.9, step: 0.1, width: 64, c }),
            h('span', { style: { color: c.textDim, fontSize: 11 } }, '°'),
        ),
        !(aoi > 0) && h('div', { role: 'alert', style: { color: c.error, fontSize: 10.5, lineHeight: 1.45 } },
            mx.aoiRequired),
        h(FieldRow, { c, label: mx.deltaConventionLabel },
            h(ChoiceGroup, { c, activeId: deltaConvention, onSelect: setDeltaConvention, items: conventionItems(mx) }),
        ),
        h(FieldRow, { c, label: mx.sideLabel },
            h(ChoiceGroup, {
                c, activeId: side, onSelect: setSide,
                items: [{ id: 'front', label: mx.sideFront }, { id: 'back', label: mx.sideBack }],
            }),
        ),
    );
}

function ConfigurePanel({ controller, c, mx }) {
    const {
        parsed, colIdx, setColIdx, name, setName, xUnit, setXUnit,
        quantity, setColQuantity, previewColumn, onAddSelected, onAddAll,
    } = controller;
    const column = parsed?.columns?.[colIdx] || null;
    if (!parsed || !column) return null;
    return h(PanelSection, { c, title: mx.configure },
        h('div', { style: { color: c.textDim, fontSize: 10.5 } }, mx.detected(parsed.nRows, parsed.columns.length)),
        h(FieldRow, { c, label: mx.unitLabel },
            h(ChoiceGroup, { c, activeId: xUnit, onSelect: setXUnit, items: UNIT_ITEMS }),
        ),
        parsed.columns.length > 1 && h(FieldRow, { c, label: mx.columnLabel },
            h(SelectField, {
                c, value: String(colIdx), onChange: value => setColIdx(+value), width: 220,
                options: parsed.columns.map((col, index) => ({ id: String(index), label: col.name })),
            }),
        ),
        h(FieldRow, { c, label: mx.quantityLabel },
            h(ChoiceGroup, { c, activeId: quantity || '', onSelect: setColQuantity, items: QUANTITY_ITEMS }),
        ),
        !quantity && h('div', { style: { color: c.textDim, fontSize: 10.5, lineHeight: 1.45 } }, mx.pickQuantity),
        h(FieldRow, { c, label: mx.nameLabel },
            h('input', { value: name, onChange: event => setName(event.target.value), style: textInputStyle(c) }),
        ),
        h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h(ActionButton, {
                c, label: mx.addColumn, onClick: onAddSelected,
                disabled: !quantity || !previewColumn?.x.length,
            }),
            parsed.columns.length > 1 && h(ActionButton, { c, label: mx.addAll, onClick: onAddAll }),
        ),
    );
}

function CurveCard({ curve, selected, onSelect, controller, c, mx }) {
    const [draftName, setDraftName] = useState(curve.name);
    useEffect(() => setDraftName(curve.name), [curve.name]);
    const { updateCurve, removeCurve } = controller;
    const data = measuredCurveData(curve);
    return h('div', {
        onClick: onSelect,
        style: {
            margin: '0 8px 8px', padding: 8, borderRadius: 6,
            backgroundColor: selected ? c.accent + (c.light ? '0d' : '16') : c.bg,
            display: 'flex', flexDirection: 'column', gap: 6, cursor: 'default',
        },
    },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h(CheckField, {
                c, label: '', checked: curve.visible !== false,
                onChange: () => updateCurve(curve.id, { visible: curve.visible === false }),
                title: mx.visibleLabel,
            }),
            h('input', {
                type: 'color', value: curve.color,
                onChange: event => updateCurve(curve.id, { color: event.target.value }),
                title: mx.colorLabel,
                style: { width: 24, height: 20, border: 'none', padding: 0, background: 'transparent' },
            }),
            h('input', {
                value: draftName, onChange: event => setDraftName(event.target.value),
                onBlur: () => {
                    const next = draftName.trim();
                    if (next && next !== curve.name) updateCurve(curve.id, { name: next });
                    else setDraftName(curve.name);
                },
                style: textInputStyle(c), title: mx.nameLabel,
            }),
            h(ActionButton, { c, label: '×', title: mx.remove, onClick: () => removeCurve(curve.id) }),
        ),
        h(FieldRow, { c, label: mx.quantityLabel },
            h(ChoiceGroup, {
                c, activeId: curve.quantity, items: QUANTITY_ITEMS,
                onSelect: value => updateCurve(curve.id, { quantity: value }),
            }),
        ),
        h(FieldRow, { c, label: mx.aoiLabel },
            h(NumInput, {
                c, value: curve.aoi ?? 0, min: 0, max: 89.9, step: 0.1, width: 60,
                onChange: value => updateCurve(curve.id, { aoi: value }),
            }),
            h('span', { style: { color: c.textDim, fontSize: 11 } }, '°'),
        ),
        curve.quantity === 'DEL' && h(FieldRow, { c, label: mx.deltaConventionLabel },
            h(ChoiceGroup, {
                c, activeId: curve.deltaConvention || 'azzam', items: conventionItems(mx),
                onSelect: value => updateCurve(curve.id, { deltaConvention: value }),
            }),
        ),
        h(FieldRow, { c, label: mx.sideLabel },
            h(ChoiceGroup, {
                c, activeId: curve.side || 'front',
                onSelect: value => updateCurve(curve.id, { side: value }),
                items: [{ id: 'front', label: mx.sideFront }, { id: 'back', label: mx.sideBack }],
            }),
        ),
        h('div', { style: { color: c.textDim, fontSize: 10.5 } },
            data.x.length
                ? mx.points(data.x.length, Math.round(data.x[0]), Math.round(data.x[data.x.length - 1]))
                : mx.noPoints),
    );
}

/** What is on the design, grouped so a Ψ without its Δ is visible as such. */
function ImportedCurves({ controller, c, mx }) {
    const { curves, selectedCurve, setSelectedCurveId } = controller;
    if (!curves.length) {
        return h(PanelSection, { c, title: mx.importedTitle },
            h('div', { style: { color: c.textDim, fontSize: 11, fontStyle: 'italic' } }, mx.noCurves));
    }
    return h('div', { style: { paddingTop: 2 } },
        h('div', {
            style: {
                padding: '8px 10px 6px', color: c.textDim, fontSize: 10,
                fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
            },
        }, mx.importedTitle),
        ...curvePairs(curves).map(pair => h('div', { key: `${pair.aoi}|${pair.side}` },
            h('div', {
                style: { padding: '2px 10px 6px', color: c.textDim, fontSize: 10.5 },
            }, pair.psi && pair.delta
                ? mx.pairComplete(pair.aoi)
                : mx.pairIncomplete(pair.aoi, pair.psi ? 'Δ' : 'Ψ')),
            ...[pair.psi, pair.delta].filter(Boolean).map(curve => h(CurveCard, {
                key: curve.id, curve, selected: selectedCurve?.id === curve.id,
                onSelect: () => setSelectedCurveId(curve.id), controller, c, mx,
            })),
        )),
    );
}

export function ImportTab({ controller, c, mx }) {
    const { loading, onImport, fileName, preview } = controller;
    return h('div', {
        className: 'tfs-spectrum-import-container',
        style: { flex: 1, minHeight: 0, minWidth: 0 },
    },
        h('div', { className: 'tfs-spectrum-import-layout' },
            h('div', { className: 'tfs-spectrum-import-sidebar' },
                h(SidePanel, { c, width: '100%' },
                    h(PanelSection, { c, title: mx.importTitle },
                        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                            h(ActionButton, {
                                c, label: loading ? mx.importing : mx.import,
                                onClick: onImport, disabled: loading,
                            }),
                            fileName && h('span', {
                                title: fileName,
                                style: {
                                    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap', color: c.textDim, fontSize: 11,
                                },
                            }, fileName),
                        ),
                        h('div', { style: { color: c.textDim, fontSize: 10.5, lineHeight: 1.45 } }, mx.importHint),
                    ),
                    h(MeasurementConditions, { controller, c, mx }),
                    h(ConfigurePanel, { controller, c, mx }),
                    h(ImportedCurves, { controller, c, mx }),
                ),
            ),
            h('div', { className: 'tfs-spectrum-import-preview' },
                preview
                    ? h(PlotArea, null, h(EllipsometryChart, {
                        data: preview, c,
                        show: { psi: preview.psi.length > 0, delta: preview.delta.length > 0 },
                    }))
                    : h(PlotArea, null, h('div', {
                        style: {
                            height: '100%', display: 'flex', alignItems: 'center',
                            justifyContent: 'center', color: c.textDim, fontSize: 11.5,
                        },
                    }, mx.previewEmpty)),
            ),
        ),
    );
}
