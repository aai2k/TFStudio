/** Bulk-material phase, GD, GDD, and TOD for a user-selected path length. */

import { MaterialPicker } from '../../../ui/MaterialPicker.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { materialCoverageBands } from '../../../ui/chartOptions.js';
import { csvFromRows, ResultsGrid, ResultsSection } from '../../../ui/ResultsSection.js';
import { ChoiceGroup, NumInput, RangeField } from '../chrome/controls.js';
import { AnalysisWindow, CenteredMessage, ControlRow, PlotArea } from '../chrome/layout.js';
import { NoticeBadge, SettingRow, SettingsMenu } from '../chrome/popover.js';
import { GDChart } from '../gdGddEvaluation/GDChart.js';
import { knotSteps, stepAtKnots } from '../knots.js';
import { chromaticDispersionCoefficient } from '../../../../utils/physics/thinFilmMath.js';
import {
    materialDispersionSpectrum, materialDispersionTable,
} from '../../../../utils/materials/materialDispersionSpectrum.js';
import { uncoveredMaterialRegions } from '../../../../utils/materials/materialRange.js';
import { useMaterialsRangeNotice } from '../../../materials/MaterialRangeNotice.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { useDesign } from '../../../../state/DesignContext.js';
import { materialDispersionSession } from './sessionState.js';
import { useDispersionMaterial } from './useDispersionMaterial.js';
import { useWindowSession } from '../../windowSession.js';

const { createElement: h, useCallback, useMemo } = React;

// `tr` names the axis title in t.gdgdd, which the Group Delay / GDD window
// already carries for the same quantities. `knot` names the pair of one-sided
// values a knot sample holds for it; phase is continuous and has none. CDC is
// GDD taken against wavelength, so it shares GDD's order. `unitKey` names the
// unit in t.units.
const QUANTITIES = {
    phase: { key: 'phaseDeg', tr: 'phaseAxis', unit: '°', digits: 2, order: 0 },
    gd: { key: 'gdFs', knot: 'gd', tr: 'gdAxis', unitKey: 'fs', digits: 3, order: 1 },
    gdd: { key: 'gddFs2', knot: 'gdd', tr: 'gddAxis', unitKey: 'fs2', digits: 3, order: 2 },
    cdc: { key: 'cdc', knot: 'cdc', tr: 'cdcAxis', unitKey: 'fsPerNm', order: 2 },
    tod: { key: 'todFs3', knot: 'tod', tr: 'todAxis', unitKey: 'fs3', digits: 3, order: 3 },
};

// Slab thickness units, keyed as t.units names them.
const THICKNESS_UNITS = {
    nm: { perMm: 1e6 },
    um: { perMm: 1e3 },
    mm: { perMm: 1 },
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

function formatThickness(valueMm, unit, units) {
    const value = thicknessFromMm(valueMm, unit);
    return `${Number(value.toPrecision(6))} ${units[unit]}`;
}

function quantityValue(value, quantity, meta) {
    if (!value.valid) return NaN;
    if (quantity === 'phase') return value.phaseRad * 180 / Math.PI;
    if (quantity === 'cdc') return chromaticDispersionCoefficient(value.gddFs2, value.wavelengthNm);
    return value[meta.key];
}

// A table knot is drawn as a step through the value on each side of it, never
// as a gap; a gap here means the sample was masked and has no value at all.
function plotModel(spectrum, quantity, meta) {
    if (!spectrum) return null;
    const values = spectrum.values.map(value => quantityValue(value, quantity, meta));
    const sides = knotSteps(spectrum.knotSamples, meta.knot, {
        order: meta.order, continuousOrder: spectrum.phaseContinuousOrder,
    });
    return stepAtKnots(spectrum.lambda, values, sides);
}

// The notice text for samples that could not be computed. The reasons come
// from the dispersion engine as they are; `text` is t.gdgdd and `units` t.units.
export function invalidSummary(spectrum, thicknessUnit, text, units) {
    if (!spectrum?.invalid.length) return null;
    const count = spectrum.invalid.length;
    const reasons = [...new Set(spectrum.invalid.map(value => value.reason))];
    const limits = spectrum.invalid
        .map(value => value.maximumThicknessMm)
        .filter(Number.isFinite);
    const summary = reasons.length === 1
        ? text.maskedOneReason(count, reasons[0])
        : text.maskedReasons(count, reasons.length);
    return limits.length
        ? `${summary} ${text.maskedThicknessLimit(formatThickness(Math.min(...limits), thicknessUnit, units))}`
        : summary;
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
                { id: 'phase', label: text.phase || 'Phase', title: text.phaseTip },
                { id: 'gd', label: text.quantityShort.gd, title: text.gdTip },
                { id: 'gdd', label: text.quantityShort.gdd, title: text.gddTip },
                { id: 'cdc', label: text.quantityShort.cdc, title: text.cdcTip },
                { id: 'tod', label: text.quantityShort.tod, title: text.todTip },
            ],
        }),
    );
}

/** The slab the dispersion is computed for, and the range it is plotted over. */
function Setup({ state, c, t }) {
    return h(SettingsMenu, {
        c, t, windowId: 'materialDispersion', label: t.analysisChrome.settings, width: 300,
    },
        h(SettingRow, { c, label: t.gdgdd.slabThickness },
            h(NumInput, {
                value: state.thicknessValue,
                onChange: value => state.setThicknessMm(thicknessToMm(value, state.thicknessUnit)),
                min: thicknessFromMm(1e-9, state.thicknessUnit),
                max: thicknessFromMm(100000, state.thicknessUnit),
                step: thicknessStep(state.thicknessValue), width: 84, c,
            }),
            h(ChoiceGroup, {
                activeId: state.thicknessUnit, onSelect: state.setThicknessUnit, c,
                ariaLabel: t.gdgdd.thicknessUnit,
                items: Object.keys(THICKNESS_UNITS).map(id => ({ id, label: t.units[id] })),
            }),
        ),
        h(SettingRow, { c, label: 'λ' },
            h(RangeField, {
                c, unit: t.units.nm,
                from: { value: state.start, onChange: state.setStart, positive: true, step: 10 },
                to: { value: state.end, onChange: state.setEnd, positive: true, step: 10 },
            }),
        ),
    );
}

export function MaterialDispersionEvaluation({ c, t }) {
    const footerText = t.gdgdd || {};
    const { design } = useDesign();
    const [session, setField, patchSession] = useWindowSession(materialDispersionSession, design);
    const {
        materialId, thicknessMm, thicknessUnit, quantity, start, end, showTable,
    } = session;
    const curve = useAnalysisColors('materialDispersion');
    const { material, missing } = useDispersionMaterial(design, materialId);
    const spectrum = useMemo(
        () => materialDispersionSpectrum(material, start, end, thicknessMm),
        [material, start, end, thicknessMm],
    );
    const quantityMeta = QUANTITIES[quantity];
    const plotData = plotModel(spectrum, quantity, quantityMeta);
    const table = materialDispersionTable(
        spectrum, t.gdgdd, t.spectralAxis.lambdaShort, t.materialRange.outsideColumn);
    const csv = useCsvExport(
        () => csvFromRows(table.columns, table.rows),
        () => `${(material?.name || materialId).replace(/[^\w.-]+/g, '_')}_dispersion.csv`,
    );
    const masked = invalidSummary(spectrum, thicknessUnit, footerText, t.units);
    // This window plots one material rather than a design stack, and the edge of
    // its data is the whole reason to look at it here: the curve is drawn out
    // there and the band shaded, with the same helpers Optical Evaluation uses.
    const rangeMaterials = useMemo(() => [{ id: materialId, material }], [materialId, material]);
    const fixRange = useCallback(
        ([from, to]) => patchSession({ start: from, end: to }), [patchSession]);
    const rangeNotice = useMaterialsRangeNotice(rangeMaterials, start, end, t, fixRange);
    const materialBands = useMemo(
        () => materialCoverageBands(
            uncoveredMaterialRegions(rangeMaterials, [start, end]), t.materialRange.bandLabel),
        [rangeMaterials, start, end, t],
    );
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
    if (rangeNotice) notices.push(rangeNotice);
    if (masked) {
        notices.push({
            label: footerText.maskedShort(spectrum.invalid.length),
            detail: masked,
        });
    }

    // A material deleted from its catalog since it was picked has nothing to
    // plot; the window says so rather than leaving the plot empty.
    return h(AnalysisWindow, { c },
        h(Controls, { state, c, t, notices }),
        h(PlotArea, null, missing
            ? h(CenteredMessage, { c, message: t.materialResolution.pickedMissing(materialId) })
            : plotData && h(GDChart, {
                data: plotData,
                xLabel: t.spectralAxis.nm,
                materialBands,
                meta: {
                    label: t.gdgdd[quantityMeta.tr],
                    unit: quantityMeta.unitKey ? t.units[quantityMeta.unitKey] : quantityMeta.unit,
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
