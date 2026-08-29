import {
    ActionButton, CheckField, ChoiceGroup, NumInput, RangeField, SelectField,
} from '../../analysis/chrome/controls.js';
import { SidePanel } from '../../analysis/chrome/layout.js';
import { measuredCurveData, X_UNITS } from '../../../../utils/io/spectrumTable.js';
import { SpectrumPreview } from './SpectrumPreview.js';
import { delimiterName } from './model.js';
import { FieldRow, PanelSection, textInputStyle } from '../chrome/panel.js';

const { createElement: h, useEffect, useState } = React;

const UNIT_ITEMS = [
    { id: X_UNITS.NM, label: 'nm' },
    { id: X_UNITS.UM, label: 'µm' },
    { id: X_UNITS.CM1, label: 'cm⁻¹' },
];

function MeasurementConditions({ controller, c, sx }) {
    const { aoi, setAoi, pol, setPol, side, setSide } = controller;
    return h(PanelSection, { c, title: sx.conditionsTitle },
        h(FieldRow, { c, label: sx.measurementAoiLabel },
            h(NumInput, { value: aoi, onChange: setAoi, min: 0, max: 90, step: 0.1, width: 64, c }),
            h('span', { style: { color: c.textDim, fontSize: 11 } }, '°'),
        ),
        h(FieldRow, { c, label: sx.polarizationLabel },
            h(ChoiceGroup, {
                c, activeId: pol, onSelect: setPol,
                items: [{ id: 'avg', label: sx.polAverage }, { id: 's', label: 's' }, { id: 'p', label: 'p' }],
            }),
        ),
        h(FieldRow, { c, label: sx.sideLabel },
            h(ChoiceGroup, {
                c, activeId: side, onSelect: setSide,
                items: [{ id: 'front', label: sx.sideFront }, { id: 'back', label: sx.sideBack }],
            }),
        ),
    );
}

function ConfigurePanel({ controller, c, sx }) {
    const {
        parsed, colIdx, setColIdx, name, setName, xUnit, setXUnit,
        quantity, yscale, setColOv, previewCurve, onAdd, onAddSelected,
    } = controller;
    const col = parsed?.columns?.[colIdx] || null;
    if (!parsed || !col) return null;
    return h(PanelSection, { c, title: sx.configure },
        h('div', { style: { color: c.textDim, fontSize: 10.5 } },
            sx.detected(delimiterName(parsed.delimiter, sx), parsed.nRows)),
        h(FieldRow, { c, label: sx.unitLabel },
            h(ChoiceGroup, { c, activeId: xUnit, onSelect: setXUnit, items: UNIT_ITEMS }),
        ),
        parsed.columns.length > 1 && h(FieldRow, { c, label: sx.columnLabel },
            h(SelectField, {
                c, value: String(colIdx), onChange: value => setColIdx(+value), width: 220,
                options: parsed.columns.map((column, index) => ({ id: String(index), label: column.name })),
            }),
        ),
        h(FieldRow, { c, label: sx.quantityLabel },
            h(ChoiceGroup, {
                c, activeId: quantity, onSelect: value => setColOv({ quantity: value }),
                items: ['T', 'R', 'A'].map(id => ({ id, label: id })),
            }),
        ),
        h(FieldRow, { c, label: sx.yscaleLabel },
            h(ChoiceGroup, {
                c, activeId: yscale, onSelect: value => setColOv({ yscale: value }),
                items: [
                    { id: 'percent', label: sx.percent },
                    { id: 'fraction', label: sx.fraction },
                    { id: 'absorbance', label: sx.absorbance },
                ],
            }),
        ),
        h(FieldRow, { c, label: sx.nameLabel },
            h('input', { value: name, onChange: event => setName(event.target.value), style: textInputStyle(c) }),
        ),
        yscale === 'absorbance' && h('div', { style: { color: c.textDim, fontSize: 10.5 } }, sx.absHint),
        h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h(ActionButton, {
                c, label: sx.addOverlay, onClick: onAddSelected, disabled: !previewCurve?.x.length,
            }),
            parsed.columns.length > 1 && h(ActionButton, {
                c, label: sx.addCurves, onClick: onAdd, disabled: !previewCurve?.x.length,
            }),
        ),
    );
}

function CurveEditorCard({ curve, selected, onSelect, controller, c, sx }) {
    const [draftName, setDraftName] = useState(curve.name);
    useEffect(() => setDraftName(curve.name), [curve.name]);
    const data = measuredCurveData(curve);
    const fullMin = curve.x[0];
    const fullMax = curve.x[curve.x.length - 1];
    const trimMin = Number.isFinite(curve.trimMin) ? curve.trimMin : fullMin;
    const trimMax = Number.isFinite(curve.trimMax) ? curve.trimMax : fullMax;
    const {
        updateCurve, setCurveScale, setCurveTrim, toggleCurve, removeCurve, openFitDialog,
    } = controller;
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
                onChange: () => toggleCurve(curve.id), title: sx.visibleLabel,
            }),
            h('input', {
                type: 'color', value: curve.color,
                onChange: event => updateCurve(curve.id, { color: event.target.value }),
                title: sx.colorLabel,
                style: { width: 24, height: 20, border: 'none', padding: 0, background: 'transparent' },
            }),
            h('input', {
                value: draftName, onChange: event => setDraftName(event.target.value),
                onBlur: () => {
                    const next = draftName.trim();
                    if (next && next !== curve.name) updateCurve(curve.id, { name: next });
                    else setDraftName(curve.name);
                },
                style: textInputStyle(c), title: sx.nameLabel,
            }),
            h(ActionButton, {
                c, label: sx.fitOpen, title: sx.fitCreateTip,
                onClick: () => openFitDialog(curve.id),
            }),
            h(ActionButton, { c, label: '×', title: sx.remove, onClick: () => removeCurve(curve.id) }),
        ),
        h(FieldRow, { c, label: sx.quantityLabel },
            h(ChoiceGroup, {
                c, activeId: curve.quantity,
                onSelect: value => updateCurve(curve.id, { quantity: value, ...(value === 'A' ? { pol: 'avg' } : {}) }),
                items: ['T', 'R', 'A'].map(id => ({ id, label: id })),
            }),
        ),
        h(FieldRow, { c, label: sx.sourceScaleLabel },
            h(ChoiceGroup, {
                c, activeId: curve.yWasPercent ? 'percent' : 'fraction',
                onSelect: value => setCurveScale(curve.id, value),
                items: [{ id: 'percent', label: sx.percent }, { id: 'fraction', label: sx.fraction }],
            }),
        ),
        h(FieldRow, { c, label: sx.measurementAoiLabel },
            h(NumInput, {
                c, value: curve.aoi ?? 0, min: 0, max: 90, step: 0.1, width: 60,
                onChange: value => updateCurve(curve.id, { aoi: value }),
            }),
            h('span', { style: { color: c.textDim, fontSize: 11 } }, '°'),
        ),
        h(FieldRow, { c, label: sx.polarizationLabel },
            curve.quantity === 'A'
                ? h('span', { style: { color: c.textDim, fontSize: 11 } }, sx.polAverage)
                : h(ChoiceGroup, {
                    c, activeId: curve.pol || 'avg',
                    onSelect: value => updateCurve(curve.id, { pol: value }),
                    items: [{ id: 'avg', label: sx.polAverage }, { id: 's', label: 's' }, { id: 'p', label: 'p' }],
                }),
        ),
        h(FieldRow, { c, label: sx.sideLabel },
            h(ChoiceGroup, {
                c, activeId: curve.side || 'front',
                onSelect: value => updateCurve(curve.id, { side: value }),
                items: [{ id: 'front', label: sx.sideFront }, { id: 'back', label: sx.sideBack }],
            }),
        ),
        h(FieldRow, { c, label: sx.trimLabel },
            h(RangeField, {
                c, width: 58, unit: 'nm',
                from: { value: trimMin, min: fullMin, max: trimMax, step: 1, onChange: value => setCurveTrim(curve.id, 'min', value) },
                to: { value: trimMax, min: trimMin, max: fullMax, step: 1, onChange: value => setCurveTrim(curve.id, 'max', value) },
            }),
        ),
        h('div', { style: { color: c.textDim, fontSize: 10.5 } },
            data.x.length ? sx.points(data.x.length, Math.round(data.x[0]), Math.round(data.x[data.x.length - 1])) : sx.noPoints),
    );
}

function ImportedCurves({ controller, c, sx }) {
    const { curves, selectedCurve, setSelectedCurveId, orphanFits, onRestoreFitCurves } = controller;
    return h('div', { style: { paddingTop: 2 } },
        h('div', {
            style: {
                padding: '8px 10px 6px', color: c.textDim, fontSize: 10,
                fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
            },
        }, sx.importedTitle),
        orphanFits.length > 0 && h('div', {
            style: {
                margin: '0 8px 8px', padding: 8, borderRadius: 6,
                backgroundColor: c.accent + (c.light ? '0d' : '16'),
                display: 'flex', flexDirection: 'column', gap: 6,
            },
        },
            h('div', { style: { color: c.textDim, fontSize: 10.5, lineHeight: 1.45 } },
                sx.orphanFits(orphanFits.length)),
            h(ActionButton, { c, label: sx.restoreFitCurves, onClick: onRestoreFitCurves }),
        ),
        !curves.length
            ? h('div', { style: { padding: '4px 10px 12px', color: c.textDim, fontSize: 11, fontStyle: 'italic' } }, sx.noOverlays)
            : curves.map(curve => h(CurveEditorCard, {
                key: curve.id, curve, selected: selectedCurve?.id === curve.id,
                onSelect: () => setSelectedCurveId(curve.id), controller, c, sx,
            })),
    );
}

export function ImportTab({ controller, c, sx }) {
    const { loading, onImport, fileName } = controller;
    return h('div', {
        className: 'tfs-spectrum-import-container',
        style: { flex: 1, minHeight: 0, minWidth: 0 },
    },
        h('div', { className: 'tfs-spectrum-import-layout' },
            h('div', { className: 'tfs-spectrum-import-sidebar' },
                h(SidePanel, { c, width: '100%' },
                    h(PanelSection, { c, title: sx.importTitle },
                        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                            h(ActionButton, {
                                c, label: loading ? sx.importing : sx.import,
                                onClick: onImport, disabled: loading,
                            }),
                            fileName && h('span', {
                                title: fileName,
                                style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: c.textDim, fontSize: 11 },
                            }, fileName),
                        ),
                        h('div', { style: { color: c.textDim, fontSize: 10.5, lineHeight: 1.45 } }, sx.importHint),
                    ),
                    h(MeasurementConditions, { controller, c, sx }),
                    h(ConfigurePanel, { controller, c, sx }),
                    h(ImportedCurves, { controller, c, sx }),
                ),
            ),
            h('div', { className: 'tfs-spectrum-import-preview' },
                h(SpectrumPreview, { controller, c, sx }),
            ),
        ),
    );
}
