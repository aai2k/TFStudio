/** Bulk-material phase, GD, GDD, and TOD for a user-selected path length. */

import { MaterialPicker } from '../../../ui/MaterialPicker.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { csvFromRows, ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { ChoiceGroup, NumInput, RangeField } from '../chrome/controls.js';
import { AnalysisWindow, ControlRow, PlotArea } from '../chrome/layout.js';
import { NoticeBadge, SettingRow, SettingsMenu } from '../chrome/popover.js';
import { GDChart } from '../gdGddEvaluation/GDChart.js';
import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { materialPropagationDispersion } from '../../../../utils/materials/materialDispersion.js';
import { resolveDesignMaterial } from '../../../../utils/materials/designMaterials.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { useDesign } from '../../../../state/DesignContext.js';
import { materialDispersionSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { createElement: h, useMemo } = React;

const QUANTITIES = {
    phase: { key: 'phaseDeg', label: 'Phase (deg)', unit: '°', digits: 2, order: 0 },
    gd: { key: 'gdFs', label: 'Group Delay (fs)', unit: 'fs', digits: 3, order: 1 },
    gdd: { key: 'gddFs2', label: 'GDD (fs²)', unit: 'fs²', digits: 3, order: 2 },
    tod: { key: 'todFs3', label: 'TOD (fs³)', unit: 'fs³', digits: 3, order: 3 },
};

const THICKNESS_UNITS = {
    nm: { label: 'nm', perMm: 1e6 },
    um: { label: 'µm', perMm: 1e3 },
    mm: { label: 'mm', perMm: 1 },
};

function thicknessFromMm(valueMm, unit) {
    return valueMm * THICKNESS_UNITS[unit].perMm;
}

function thicknessToMm(value, unit) {
    return value / THICKNESS_UNITS[unit].perMm;
}

function thicknessStep(value) {
    if (!(value > 0)) return 1;
    return 10 ** (Math.floor(Math.log10(value)) - 1);
}

function formatThickness(valueMm, unit) {
    const value = thicknessFromMm(valueMm, unit);
    return `${Number(value.toPrecision(6))} ${THICKNESS_UNITS[unit].label}`;
}

function sampleWavelengths(start, end) {
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    const spacing = Math.max(0.2, (high - low) / 2000);
    const count = Math.floor((high - low) / spacing + 1e-12) + 1;
    const result = Array.from({ length: count }, (_, index) => low + index * spacing);
    if (high - result[result.length - 1] > 1e-9) result.push(high);
    return result;
}

function buildSpectrum(material, start, end, thicknessMm) {
    if (!material) return null;
    const lambda = sampleWavelengths(start, end);
    const values = lambda.map(wavelength =>
        materialPropagationDispersion(material, wavelength, thicknessMm));
    const continuityOrders = values
        .map(value => value.phaseContinuousOrder)
        .filter(Number.isFinite);
    return {
        lambda,
        values,
        invalid: values.filter(value => !value.valid),
        model: values.find(value => value.model)?.model || 'Unavailable',
        phaseModel: values.find(value => value.phaseModel)?.phaseModel || 'Unavailable',
        phaseContinuousOrder: continuityOrders.length ? Math.min(...continuityOrders) : 0,
    };
}

function quantityValue(value, quantity, meta) {
    if (!value.valid) return NaN;
    return quantity === 'phase' ? value.phaseRad * 180 / Math.PI : value[meta.key];
}

function plotModel(spectrum, quantity, meta) {
    if (!spectrum) return null;
    const lambda = [];
    const y = [];
    let previousSegment = null;
    for (let index = 0; index < spectrum.values.length; index++) {
        const value = spectrum.values[index];
        const segmentChanged = index > 0
            && value.knotSegment !== previousSegment
            && meta.order > value.phaseContinuousOrder;
        if (segmentChanged) {
            lambda.push(spectrum.lambda[index]);
            y.push(NaN);
        }
        lambda.push(spectrum.lambda[index]);
        y.push(quantityValue(value, quantity, meta));
        previousSegment = value.knotSegment;
    }
    return { lambda, y };
}

function invalidSummary(spectrum, thicknessUnit) {
    if (!spectrum?.invalid.length) return null;
    const reasons = [...new Set(spectrum.invalid.map(value => value.reason))];
    const limits = spectrum.invalid
        .map(value => value.maximumThicknessMm)
        .filter(Number.isFinite);
    const limit = limits.length
        ? ` Set thickness to ${formatThickness(Math.min(...limits), thicknessUnit)} or less for the full range.`
        : '';
    return (reasons.length === 1
        ? `${spectrum.invalid.length} samples masked: ${reasons[0]}`
        : `${spectrum.invalid.length} samples masked for ${reasons.length} reasons`) + limit;
}

function Controls({ state, c, t, notices }) {
    const text = t.gdgdd || {};
    return h(ControlRow, {
        c,
        trailing: [
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            h(Setup, { key: 'setup', state, c, t }),
        ],
    },
        h('div', { style: { width: 200 } }, h(MaterialPicker, {
            value: state.materialId, onChange: state.setMaterialId, c, t,
        })),
        h(ChoiceGroup, {
            label: text.quantity || 'Quantity',
            activeId: state.quantity,
            onSelect: state.setQuantity,
            c,
            items: [
                { id: 'phase', label: text.phase || 'Phase' },
                { id: 'gd', label: 'GD' },
                { id: 'gdd', label: 'GDD' },
                { id: 'tod', label: 'TOD' },
            ],
        }),
    );
}

/** The slab the dispersion is computed for, and the range it is plotted over. */
function Setup({ state, c, t }) {
    return h(SettingsMenu, {
        c, t, windowId: 'materialDispersion', label: t.analysisChrome.settings, width: 300,
    },
        h(SettingRow, { c, label: 'Thickness' },
            h(NumInput, {
                value: state.thicknessValue,
                onChange: value => state.setThicknessMm(thicknessToMm(value, state.thicknessUnit)),
                min: thicknessFromMm(1e-9, state.thicknessUnit),
                max: thicknessFromMm(100000, state.thicknessUnit),
                step: thicknessStep(state.thicknessValue), width: 84, c,
            }),
            h(ChoiceGroup, {
                activeId: state.thicknessUnit, onSelect: state.setThicknessUnit, c,
                ariaLabel: 'Thickness unit',
                items: Object.entries(THICKNESS_UNITS).map(([id, unit]) => ({ id, label: unit.label })),
            }),
        ),
        h(SettingRow, { c, label: 'λ' },
            h(RangeField, {
                c, unit: 'nm',
                from: { value: state.start, onChange: state.setStart, min: 100, max: 30000, step: 10 },
                to: { value: state.end, onChange: state.setEnd, min: 100, max: 30000, step: 10 },
            }),
        ),
    );
}

function tableModel(spectrum) {
    if (!spectrum) return { columns: [], rows: [] };
    const columns = [
        { key: 'lambda', label: 'λ (nm)', align: 'left', fmt: value => value.toFixed(2) },
        { key: 'phase', label: 'Phase (°)', fmt: value => value.toFixed(2) },
        { key: 'gd', label: 'GD (fs)', fmt: value => value.toFixed(3) },
        { key: 'gdd', label: 'GDD (fs²)', fmt: value => value.toFixed(3) },
        { key: 'tod', label: 'TOD (fs³)', fmt: value => value.toFixed(3) },
        { key: 'groupIndex', label: 'nᵧ', fmt: value => value.toFixed(6) },
    ];
    const rows = spectrum.values.map((value, index) => ({
        lambda: spectrum.lambda[index],
        phase: value.valid ? value.phaseRad * 180 / Math.PI : NaN,
        gd: value.valid ? value.gdFs : NaN,
        gdd: value.valid ? value.gddFs2 : NaN,
        tod: value.valid ? value.todFs3 : NaN,
        groupIndex: value.valid ? value.groupIndex : NaN,
    }));
    return { columns, rows };
}

export function MaterialDispersionEvaluation({ c, t }) {
    const footerText = t.gdgdd || {};
    // The picker offers the open design's own materials, including definitions
    // that travelled inside a .tfs and exist in no local catalog, so the id is
    // resolved against the design before the registry.
    const { design } = useDesign();
    const [session, setField] = useWindowSession(materialDispersionSession, design);
    const {
        materialId, thicknessMm, thicknessUnit, quantity, start, end, showTable,
    } = session;
    const curve = useAnalysisColors('materialDispersion');
    const resolved = resolveDesignMaterial(design, materialId);
    const material = resolved.status === 'missing'
        ? getMaterialById(materialId)
        : resolved.material;
    const spectrum = useMemo(
        () => buildSpectrum(material, start, end, thicknessMm),
        [material, start, end, thicknessMm],
    );
    const quantityMeta = QUANTITIES[quantity];
    const plotData = plotModel(spectrum, quantity, quantityMeta);
    const table = tableModel(spectrum);
    const csv = useCsvExport(
        () => csvFromRows(table.columns, table.rows),
        () => `${(material?.name || materialId).replace(/[^\w.-]+/g, '_')}_dispersion.csv`,
    );
    const discontinuous = quantityMeta.order > spectrum?.phaseContinuousOrder;
    const masked = invalidSummary(spectrum, thicknessUnit);
    const state = {
        materialId, setMaterialId: value => setField('materialId', value),
        thicknessMm, setThicknessMm: value => setField('thicknessMm', value),
        thicknessUnit, setThicknessUnit: value => setField('thicknessUnit', value),
        thicknessValue: thicknessFromMm(thicknessMm, thicknessUnit),
        quantity, setQuantity: value => setField('quantity', value),
        start, setStart: value => setField('start', value),
        end, setEnd: value => setField('end', value),
    };

    const notices = [];
    if (discontinuous) {
        notices.push({
            label: footerText.piecewiseShort,
            detail: footerText.piecewiseWarning(quantity.toUpperCase(), spectrum.phaseModel),
        });
    }
    if (masked) {
        notices.push({ label: footerText.maskedShort(spectrum.invalid.length), detail: masked });
    }

    return h(AnalysisWindow, { c },
        h(Controls, { state, c, t, notices }),
        h(PlotArea, null, plotData && h(GDChart, {
            data: plotData,
            meta: {
                label: quantityMeta.label,
                unit: quantityMeta.unit,
                color: curve.curve,
                dp: quantityMeta.digits,
            },
            showRef: false, c,
        })),
        h(ResultsSection, {
            c, label: t.dataTable.results, count: table.rows.length,
            countLabel: t.dataTable.rowCount,
            open: showTable, setOpen: value => setField('showTable', value),
            actions: h(ExportMenu, {
                c, enabled: table.rows.length > 0, ...csv,
                labels: {
                    export: t.dataTable.export, copyCsv: t.dataTable.copyCsv,
                    saveCsv: t.dataTable.saveCsv, copied: t.dataTable.csvCopied,
                    saved: t.dataTable.csvSaved,
                },
            }),
        }, h(ResultsGrid, { columns: table.columns, rows: table.rows, c })),
    );
}
