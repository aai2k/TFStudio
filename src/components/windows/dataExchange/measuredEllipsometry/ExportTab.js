import {
    ActionButton, CheckField, ChoiceGroup, FieldLabel, NumInput, RangeField,
} from '../../analysis/chrome/controls.js';
import { SidePanel } from '../../analysis/chrome/layout.js';
import { X_UNITS } from '../../../../utils/io/spectrumTable.js';
import { InlineRow, PanelSection } from '../chrome/panel.js';

const { createElement: h } = React;

const UNIT_ITEMS = [
    { id: X_UNITS.NM, label: 'nm' },
    { id: X_UNITS.UM, label: 'µm' },
    { id: X_UNITS.EV, label: 'eV' },
];

function MeasuredPanel({ controller, c, mx }) {
    const { curves, expSelected, setExpSelected, expXUnit, setExpXUnit, onExportMeasured } = controller;
    return h(PanelSection, { c, title: mx.sourceMeasured },
        curves.length === 0
            ? h('div', { style: { color: c.textDim, fontSize: 11, fontStyle: 'italic' } }, mx.noCurves)
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                ...curves.map(curve => h(CheckField, {
                    key: curve.id, c,
                    label: `${curve.name} (${curve.quantity === 'PSI' ? 'Ψ' : 'Δ'}, ${curve.aoi ?? 0}°)`,
                    checked: expSelected[curve.id] !== false,
                    onChange: event => setExpSelected(curve.id, event.target.checked),
                })),
            ),
        h(InlineRow, { c, label: mx.unitLabel },
            h(ChoiceGroup, { c, activeId: expXUnit, onSelect: setExpXUnit, items: UNIT_ITEMS }),
        ),
        h(InlineRow, { c },
            h(ActionButton, { c, label: mx.exportMeasured, onClick: onExportMeasured, disabled: !curves.length }),
        ),
    );
}

function CalculatedPanel({ controller, c, mx }) {
    const {
        expStart, setExpStart, expEnd, setExpEnd, expStep, setExpStep,
        expAoi, setExpAoi, expXUnit, setExpXUnit, onExportCalculated,
        deltaConvention, missingMaterialIds,
    } = controller;
    if (missingMaterialIds.length > 0) {
        return h(PanelSection, { c, title: mx.sourceCalculated },
            h('div', { role: 'alert', style: { color: c.error, fontSize: 11.5, lineHeight: 1.5 } },
                mx.errMaterials(missingMaterialIds.join(', '))),
        );
    }
    return h(PanelSection, { c, title: mx.sourceCalculated },
        h('div', { style: { fontSize: 11, color: c.textDim, lineHeight: 1.45 } }, mx.exportCalculatedDesc),
        h(InlineRow, { c, label: mx.rangeLabel },
            h(RangeField, {
                c, unit: 'nm',
                from: { value: expStart, onChange: setExpStart, min: 100, max: 50000, step: 10 },
                to: { value: expEnd, onChange: setExpEnd, min: 100, max: 50000, step: 10 },
            }),
            h(FieldLabel, { c }, mx.stepLabel),
            h(NumInput, { value: expStep, onChange: setExpStep, min: 0.1, max: 100, step: 0.5, c, width: 56 }),
        ),
        h(InlineRow, { c, label: mx.aoiLabel },
            h(NumInput, { value: expAoi, onChange: setExpAoi, min: 0, max: 89.9, step: 0.1, c, width: 64 }),
            h('span', { style: { color: c.textDim, fontSize: 11 } }, '°'),
        ),
        h(InlineRow, { c, label: mx.unitLabel },
            h(ChoiceGroup, { c, activeId: expXUnit, onSelect: setExpXUnit, items: UNIT_ITEMS }),
        ),
        h(InlineRow, { c },
            h(ActionButton, { c, label: mx.exportCalculated, onClick: onExportCalculated }),
            h('span', { style: { fontSize: 10.5, color: c.textDim } },
                mx.exportConventionHint(deltaConvention === 'azzam' ? mx.deltaAzzam : mx.deltaReversed)),
        ),
    );
}

export function ExportTab({ controller, c, mx }) {
    const { expSource, setExpSource } = controller;
    return h('div', {
        className: 'tfs-spectrum-import-container',
        style: { flex: 1, minHeight: 0, minWidth: 0 },
    },
        h(SidePanel, { c, width: '100%' },
            h(PanelSection, { c, title: mx.exportWhat },
                h(ChoiceGroup, {
                    c, activeId: expSource, onSelect: setExpSource,
                    items: [
                        { id: 'measured', label: mx.sourceMeasured },
                        { id: 'calculated', label: mx.sourceCalculated },
                    ],
                }),
            ),
            expSource === 'measured'
                ? h(MeasuredPanel, { controller, c, mx })
                : h(CalculatedPanel, { controller, c, mx }),
        ),
    );
}
