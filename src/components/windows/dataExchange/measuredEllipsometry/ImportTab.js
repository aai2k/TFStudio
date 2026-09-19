import { ActionButton, ChoiceGroup, NumInput, SelectField } from '../../analysis/chrome/controls.js';
import { CenteredMessage, PlotArea, SidePanel } from '../../analysis/chrome/layout.js';
import { EllipsometryChart } from '../../analysis/ellipsometryEvaluation/EllipsometryChart.js';
import { X_UNITS } from '../../../../utils/io/spectrumTable.js';
import { FieldRow, ImportFilePanel, ImportLayout, PanelSection, textInputStyle } from '../chrome/panel.js';
import { deltaConventionItems } from './model.js';
import { CurveCard, QUANTITY_ITEMS } from './curveCards.js';

const { createElement: h, Fragment } = React;

const UNIT_ITEMS = [
    { id: X_UNITS.NM, label: 'nm' },
    { id: X_UNITS.UM, label: 'µm' },
    { id: X_UNITS.EV, label: 'eV' },
];

/**
 * What the file leaves unsaid, stored on the curve when it is added and
 * editable on its card afterwards.
 *
 * The angle is asked for only when the file states none: a curve measured at
 * normal incidence carries nothing about the film, and a file that states no
 * angle is the ordinary way to arrive there. It covers every column the file
 * leaves without one, not only the one being configured, because "Add all
 * typed columns" adds those columns too and they would otherwise be stamped
 * with a setting the panel never showed. The sign of Δ is asked for once the
 * file holds a Δ column, because no file states it and every Δ column takes
 * it. The side is asked for when the design has a coating on each face and the
 * header names neither.
 */
function ColumnConditions({ controller, c, mx }) {
    const {
        parsed, previewCurves, hasBackCoating,
        aoi, setAoi, side, setSide, deltaConvention, setDeltaConvention,
    } = controller;
    const anyColumnWithoutAngle = parsed.columns.some(column => !Number.isFinite(column.aoi));
    const hasDelta = (previewCurves || []).some(curve => curve.quantity === 'DEL');
    return h(Fragment, null,
        anyColumnWithoutAngle && h(FieldRow, { c, label: mx.aoiLabel },
            h(NumInput, { value: aoi, onChange: setAoi, min: 0, max: 89.9, step: 0.1, width: 64, c }),
            h('span', { style: { color: c.textDim, fontSize: 11 } }, '°'),
        ),
        anyColumnWithoutAngle && !(aoi > 0) && h('div', {
            role: 'alert', style: { color: c.error, fontSize: 10.5, lineHeight: 1.45 },
        }, mx.aoiRequired),
        hasDelta && h(FieldRow, { c, label: mx.deltaConventionLabel },
            h(ChoiceGroup, { c, activeId: deltaConvention, onSelect: setDeltaConvention, items: deltaConventionItems(mx) }),
        ),
        hasBackCoating && !parsed.side && h(FieldRow, { c, label: mx.sideLabel },
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
                c, value: String(colIdx), onChange: value => setColIdx(+value), width: '100%',
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
        h(ColumnConditions, { controller, c, mx }),
        h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h(ActionButton, {
                c, label: mx.addColumn, onClick: onAddSelected,
                disabled: !quantity || !previewColumn?.x.length,
            }),
            parsed.columns.length > 1 && h(ActionButton, { c, label: mx.addAll, onClick: onAddAll }),
        ),
    );
}

// Fit targets whose curves are not on the design, with the way to get them back.
function OrphanFits({ controller, c, mx }) {
    const { orphanFits, onRestoreFitCurves } = controller;
    if (!orphanFits.length) return null;
    return h('div', {
        style: {
            margin: '0 8px 8px', padding: 8, borderRadius: 6,
            backgroundColor: c.accent + (c.light ? '0d' : '16'),
            display: 'flex', flexDirection: 'column', gap: 6,
        },
    },
        h('div', { style: { color: c.textDim, fontSize: 10.5, lineHeight: 1.45 } },
            mx.orphanFits(orphanFits.length)),
        h(ActionButton, { c, label: mx.restoreFitCurves, onClick: onRestoreFitCurves }),
    );
}

/** What is on the design, one card per curve. */
function ImportedCurves({ controller, c, mx }) {
    const { curves, selectedCurve, setSelectedCurveId } = controller;
    return h('div', { style: { paddingTop: 2 } },
        h('div', {
            style: {
                padding: '8px 10px 6px', color: c.textDim, fontSize: 10,
                fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
            },
        }, mx.importedTitle),
        h(OrphanFits, { controller, c, mx }),
        curves.length
            ? curves.map(curve => h(CurveCard, {
                key: curve.id, curve, selected: selectedCurve?.id === curve.id,
                onSelect: () => setSelectedCurveId(curve.id), controller, c, mx,
            }))
            : h('div', {
                style: { padding: '0 10px 10px', color: c.textDim, fontSize: 11, fontStyle: 'italic' },
            }, mx.noCurves),
    );
}

export function ImportTab({ controller, c, mx }) {
    const { loading, onImport, fileName, preview, hasActiveDesign, panelWidth, setPanelWidth } = controller;
    // With no design selected there is nothing to import into.
    const noDesign = hasActiveDesign === false;
    return h(ImportLayout, { c, panelWidth, onPanelWidthChange: setPanelWidth },
        h(SidePanel, { c, width: '100%' },
            h(ImportFilePanel, {
                c, title: mx.importTitle, label: loading ? mx.importing : mx.import,
                onImport, loading, disabled: noDesign, fileName: noDesign ? '' : fileName,
                hint: noDesign ? mx.noDesign : mx.importHint,
            }),
            !noDesign && h(ConfigurePanel, { controller, c, mx }),
            !noDesign && h(ImportedCurves, { controller, c, mx }),
        ),
        h(PlotArea, null,
            preview && !noDesign
                ? h(EllipsometryChart, {
                    data: preview, c, xLabel: preview.xLabel,
                    show: { psi: preview.psi.length > 0, delta: preview.delta.length > 0 },
                })
                : h(CenteredMessage, { c, message: noDesign ? mx.noDesign : mx.previewEmpty }),
        ),
    );
}
