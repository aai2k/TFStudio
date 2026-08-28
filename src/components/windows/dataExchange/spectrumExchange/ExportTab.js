import {
    ActionButton, CheckField, ChoiceGroup, FieldLabel, NumInput, RangeField,
} from '../../analysis/chrome/controls.js';
import { X_UNITS } from '../../../../utils/io/spectrumTable.js';
import { InlineRow, PanelSection } from './panelUi.js';

const { createElement: h } = React;

function ExportOptions({ controller, c, sx }) {
    const { expSource, setExpSource, expFormat, setExpFormat } = controller;
    return h(PanelSection, { c, title: sx.exportWhat },
        h(ChoiceGroup, {
            c, activeId: expSource, onSelect: setExpSource,
            items: [
                { id: 'design', label: sx.sourceDesign },
                { id: 'measured', label: sx.sourceMeasured },
            ],
        }),
        h(InlineRow, { c, label: sx.formatLabel },
            h(ChoiceGroup, {
                c, activeId: expFormat, onSelect: setExpFormat,
                items: [{ id: 'csv', label: 'CSV' }, { id: 'jcamp', label: 'JCAMP-DX' }],
            }),
        ),
    );
}

function DesignExportPanel({ controller, c, sx }) {
    const {
        dStart, setDStart, dEnd, setDEnd, dStep, setDStep, dAoi, setDAoi,
        dQ, setDQ, dSP, setDSP, onExportDesign, evalMode, missingMaterialIds,
    } = controller;
    if (missingMaterialIds.length > 0) {
        return h(PanelSection, { c, title: sx.sourceDesign },
            h('div', { role: 'alert', style: { color: c.error, fontSize: 11.5, lineHeight: 1.5 } },
                sx.designExportBlocked(missingMaterialIds.join(', '))),
        );
    }
    const textStyle = {
        width: 130, height: 24, boxSizing: 'border-box', background: c.field,
        color: c.text, border: `1px solid ${c.border}`, borderRadius: 3,
        fontSize: 11, padding: '0 5px', outline: 'none',
    };
    return h(PanelSection, { c, title: sx.sourceDesign },
        h('div', { style: { fontSize: 11, color: c.textDim, lineHeight: 1.45 } }, sx.exportDesignDesc),
        h(InlineRow, { c, label: sx.rangeLabel },
            h(RangeField, {
                c, unit: 'nm',
                from: { value: dStart, onChange: setDStart, min: 100, max: 50000, step: 10 },
                to: { value: dEnd, onChange: setDEnd, min: 100, max: 50000, step: 10 },
            }),
            h(FieldLabel, { c }, sx.stepLabel),
            h(NumInput, { value: dStep, onChange: setDStep, min: 0.1, max: 100, step: 0.5, c, width: 56 }),
        ),
        h(InlineRow, { c, label: sx.aoiLabel },
            h('input', { value: dAoi, onChange: event => setDAoi(event.target.value), style: textStyle }),
        ),
        h(InlineRow, { c, label: sx.quantitiesLabel },
            ...['T', 'R', 'A'].map(quantity => h(CheckField, {
                key: quantity, c, label: quantity, checked: dQ[quantity],
                onChange: event => setDQ(previous => ({ ...previous, [quantity]: event.target.checked })),
            })),
            h(CheckField, {
                c, label: sx.includeSP, checked: dSP,
                onChange: event => setDSP(event.target.checked),
            }),
        ),
        h(InlineRow, { c },
            h(ActionButton, { c, label: sx.exportDesign, onClick: onExportDesign }),
            h('span', { style: { fontSize: 10.5, color: c.textDim } }, sx.exportDesignHint(evalMode)),
        ),
    );
}

function MeasuredExportPanel({ controller, c, sx }) {
    const {
        curves, selectedExportCurves, setExportCurveSelected, selectAllExportCurves,
        expXUnit, setExpXUnit, expYScale, setExpYScale, onExport,
    } = controller;
    return h(PanelSection, { c, title: sx.sourceMeasured },
        h('div', { style: { fontSize: 11, color: c.textDim, lineHeight: 1.45 } }, sx.exportMeasuredDesc),
        !curves.length
            ? h('span', { style: { fontSize: 11.5, color: c.textDim, fontStyle: 'italic' } }, sx.noOverlays)
            : h(React.Fragment, null,
                h(InlineRow, { c },
                    h(ActionButton, { c, label: sx.selectAll, onClick: () => selectAllExportCurves(true) }),
                    h(ActionButton, { c, label: sx.selectNone, onClick: () => selectAllExportCurves(false) }),
                    h('span', { style: { color: c.textDim, fontSize: 10.5 } },
                        sx.selectedCount(selectedExportCurves.length, curves.length)),
                ),
                h('div', {
                    style: {
                        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                        gap: 5, maxHeight: 230, overflowY: 'auto', padding: 6,
                        border: `1px solid ${c.border}`, borderRadius: 5, background: c.bg,
                    },
                }, curves.map(curve => h('div', {
                    key: curve.id, style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
                },
                    h(CheckField, {
                        c, label: '', checked: selectedExportCurves.some(item => item.id === curve.id),
                        onChange: event => setExportCurveSelected(curve.id, event.target.checked),
                    }),
                    h('span', { style: { width: 9, height: 9, borderRadius: '50%', background: curve.color, flexShrink: 0 } }),
                    h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5 } }, curve.name),
                    h('span', { style: { marginLeft: 'auto', color: c.textDim, fontSize: 10 } }, curve.quantity),
                ))),
                h(InlineRow, { c, label: sx.exportUnitLabel },
                    h(ChoiceGroup, {
                        c, activeId: expXUnit, onSelect: setExpXUnit,
                        items: [
                            { id: X_UNITS.NM, label: 'nm' },
                            { id: X_UNITS.UM, label: 'µm' },
                            { id: X_UNITS.CM1, label: 'cm⁻¹' },
                        ],
                    }),
                ),
                h(InlineRow, { c, label: sx.exportScaleLabel },
                    h(ChoiceGroup, {
                        c, activeId: expYScale, onSelect: setExpYScale,
                        items: [{ id: 'percent', label: sx.percent }, { id: 'fraction', label: sx.fraction }],
                    }),
                ),
                h(InlineRow, { c },
                    h(ActionButton, {
                        c, label: sx.exportMeasured, onClick: onExport,
                        disabled: selectedExportCurves.length === 0,
                    }),
                ),
            ),
    );
}

export function ExportTab({ controller, c, sx }) {
    return h('div', { style: { flex: 1, minHeight: 0, overflow: 'auto' } },
        h(ExportOptions, { controller, c, sx }),
        controller.expSource === 'design'
            ? h(DesignExportPanel, { controller, c, sx })
            : h(MeasuredExportPanel, { controller, c, sx }),
    );
}
