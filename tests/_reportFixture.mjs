/**
 * The sample design the report tests share: a TiO2/SiO2 stack on BK7 with one
 * qualifier and one merit operand. Stored incident side first, so the locked
 * 90 nm layer is the one next to the substrate and prints as layer 1.
 */
export const REPORT_TEST_DESIGN = {
  id: 'd1', name: 'AR Test Stack',
  incidentMedium: 'Air',
  substrate: { material: 'BK7', thickness: 1.0 },
  exitMedium: 'Air',
  surfaceMode: 'front_only', mfEvalMode: 'side',
  referenceWavelength: 550,
  frontLayers: [
    { id: 'l1', material: 'TiO2', thickness: 116.7, locked: false },
    { id: 'l2', material: 'SiO2', thickness: 187.3, locked: false },
    { id: 'l3', material: 'TiO2', thickness: 90.0,  locked: true  },
  ],
  backLayers: [],
  notes: 'Sample design for report test.\nSecond line.',
  qualifiers: [
    { id: 'q1', enabled: true, kind: 'R_AVG', channel: 'R', pol: 'avg',
      lambdaStart: 450, lambdaEnd: 650, aoi: 0, cmp: 'le', target: 0.02, tol: 0 },
  ],
  meritOperands: [
    { id: 'o1', type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 },
  ],
};

/** Block settings that exercise the options the default template leaves off. */
export const REPORT_TEST_SETTINGS = {
  layers: { extended: true },
  materials: { table: true },
  spectrum: { lambdaStart: 400, lambdaEnd: 700, lambdaStep: 5, thetas: [0, 30], tableStep: 10 },
  ellipsometry: { lambdaStart: 400, lambdaEnd: 700, lambdaStep: 10, thetas: [65, 70] },
};
