/**
 * Witness-chip monitoring worksheet for the report, from the same engine the
 * Monitor Worksheet window uses. The chip plan, the monitoring wavelengths and
 * the monitor settings are the window's own for the design, so the report
 * prints the table the window shows; without the window's values the shipped
 * defaults apply. Rows are in deposition order, so the step number is the layer
 * number the report prints elsewhere.
 */

import { sessionDefaults } from '../../../constants/analysisDefaults.js';
import { assignChips, buildMonitorWorksheet } from '../../monitoring/monoSim.js';
import { designMaterialLookup } from '../../materials/designMaterials.js';
import { materialName } from './engines.js';

// A chip plan entered by hand only holds while it still has one entry per
// deposited layer; after the stack is edited the chip size takes over again.
function planForSteps(plan, stepCount) {
  return Array.isArray(plan) && plan.length === stepCount ? plan : null;
}

/**
 * @param {object} design
 * @param {object} [monitor]  the Monitor Worksheet window's values for the design, under
 *                            the window's own keys: `char`, `theta`, `polarization`,
 *                            `layersPerChip`, `witnessRatio`, `signalErrorPct`,
 *                            `absSignalErrorPct`, `maxTerminationErrPct`, `chipMaterial`,
 *                            `chipByStep`, `lambdaByStep`
 */
export function computeWorksheet(design, monitor) {
  const v = { ...sessionDefaults('monitorWorksheet'), ...(monitor || {}) };
  const stepCount = design?.frontLayers?.length || 0;
  const chipGlass = v.chipMaterial ? materialName(design, v.chipMaterial) : materialName(design, design?.substrate?.material);
  const settings = {
    char: v.char, theta: v.theta, pol: v.polarization, chipGlass, witnessRatio: v.witnessRatio,
    signalErrorPct: v.signalErrorPct, absSignalErrorPct: v.absSignalErrorPct, maxTerminationErrPct: v.maxTerminationErrPct,
  };
  if (!stepCount) return { rows: [], chips: [], settings };
  const resolveMat = designMaterialLookup(design);
  const out = buildMonitorWorksheet(design, resolveMat, {
    char: v.char, theta: v.theta, pol: v.polarization, chipMaterial: v.chipMaterial || null,
    witnessRatio: v.witnessRatio,
    chipByStep: planForSteps(v.chipByStep, stepCount) || assignChips(stepCount, v.layersPerChip),
    lambdaByStep: planForSteps(v.lambdaByStep, stepCount),
    signalErrorPct: v.signalErrorPct, absSignalErrorPct: v.absSignalErrorPct,
    maxTerminationErrPct: v.maxTerminationErrPct,
    withCurve: false,
  });
  return {
    rows: out.rows.map(row => ({ ...row, materialName: materialName(design, row.material) })),
    chips: out.chips, settings,
  };
}
