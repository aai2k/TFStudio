/**
 * The wavelength axis ruling of Optical Evaluation after a zoom. The option
 * rules the whole range (model.js); a box or wheel zoom shows part of it, and
 * that part is ruled afresh the same way, a 1, 2, 2.5 or 5 nm step for about
 * eight ticks, until the view is the whole range again.
 */
import { wavelengthRuling } from '../../../ui/chartOptions.js';

/**
 * The x axis ruling for a view of [left, right] nm on a chart built by
 * buildChartOption: the visible span ruled afresh after a zoom, or null while
 * the view is the whole range, which keeps the option's own ruling. Null too
 * for an axis not ruled in nm.
 */
export function wavelengthViewRuling(xAxis, left, right) {
    if (xAxis?.minInterval == null || !Number.isFinite(left) || !Number.isFinite(right)) return null;
    // A view read back through the axes lands a fraction of a pixel off the ends.
    const slack = (xAxis.max - xAxis.min) * 1e-3;
    if (Math.abs(left - xAxis.min) <= slack && Math.abs(right - xAxis.max) <= slack) return null;
    return wavelengthRuling(left, right);
}

/** The ruling the option itself carries, to put back once a zoom is undone. */
export function optionWavelengthRuling(xAxis) {
    if (xAxis?.minInterval == null) return null;
    const { showMinLabel, showMaxLabel } = xAxis.axisLabel || {};
    return { minInterval: xAxis.minInterval, maxInterval: xAxis.maxInterval, axisLabel: { showMinLabel, showMaxLabel } };
}
