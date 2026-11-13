// What a load checks and fixes in a parsed .tfs design: that it holds what the
// app reads without guarding, and the fixups every load applies. The desktop
// reads files through designFile.js, which applies these; the web demo's file
// import runs the same code, bundled for the browser by
// tools/webDesignLoad.mjs.
//
// CommonJS, with no Node or Electron dependency.
const { restoreRowSwitches } = require('./environmentRows');

// Check that a parsed design holds the parts the renderer dereferences without
// guarding them, and fill in the ones that have an unambiguous empty value.
// Returns an error string, or null when the design is usable.
//
// Only those parts are checked. A design missing `substrate.material` throws
// during render (the Design Editor's layer list and stack diagram and the
// Optical Evaluation and Integral Values spectra all read it directly), which
// unmounts the React tree and leaves a white window with nothing said. Missing
// layer arrays throw the same way through `.map` and `.length`. Requiring the
// rest of the shape would refuse older files that open correctly today.
//
// A substrate is refused rather than defaulted: standing in a material would
// silently change what the design computes. Absent layer arrays are filled in
// as empty, which is what a bare substrate is written as anyway.
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const namesMaterial = substrate => typeof substrate.material === 'string' && substrate.material.trim() !== '';

function validateDesign(design) {
  if (!isRecord(design)) return 'File is not a valid TFStudio design.';
  if (!isRecord(design.substrate) || !namesMaterial(design.substrate)) {
    return 'This design names no substrate material, so it cannot be evaluated.';
  }
  for (const side of ['frontLayers', 'backLayers']) {
    if (design[side] === undefined || design[side] === null) { design[side] = []; continue; }
    if (!Array.isArray(design[side])) return `This design's ${side} is not a list of layers.`;
    if (!design[side].every(isRecord)) return `This design has a layer in ${side} that is not a layer.`;
  }
  return validateEnvironments(design.environments);
}

// The environments list, when it holds any, is read without guarding: each
// entry is an object with an id of its own, and the first is environment 1.
// No list, or an empty one, is a design with one environment.
const isId = id => typeof id === 'string' && id !== '';
const isEnvironmentList = ids => ids[0] === 'base' && ids.every(isId) && new Set(ids).size === ids.length;

function validateEnvironments(list) {
  if (list === undefined || list === null || (Array.isArray(list) && list.length === 0)) return null;
  const ids = Array.isArray(list) && list.every(isRecord) ? list.map(env => env.id) : [];
  return isEnvironmentList(ids) ? null : "This design's environments are not a list of environments, environment 1 first.";
}

// The worst-case TMN and RMX rows the merit function wizard wrote up to 1.8.2
// carry bandPoints 21 and pNorm 50. A worst-case row searches its own grid and
// pNorm is read by nothing, so both go. pNorm is what tells these rows apart
// from a TMN or RMX row given its own sample count: nothing else wrote it.
function dropWizardWorstCaseSampling(design) {
  const operands = Array.isArray(design.meritOperands) ? design.meritOperands : [];
  for (const op of operands) {
    if (!op || typeof op !== 'object' || !('pNorm' in op)) continue;
    if (op.type !== 'TMN' && op.type !== 'RMX') continue;
    delete op.pNorm;
    delete op.bandPoints;
  }
}

// A DEL row records the sign of Δ it reads in `deltaConvention`, and a new row
// reads the Azzam-Bashara one. A stored DEL row without the field was written
// when every DEL row read 360° minus that, so it is given 'reversed' here: it
// scores as it did, and keeps that sign through the API, a copy and a save.
function stampStoredDelRows(design) {
  const operands = Array.isArray(design.meritOperands) ? design.meritOperands : [];
  for (const op of operands) {
    if (op && op.type === 'DEL' && op.deltaConvention === undefined) op.deltaConvention = 'reversed';
  }
}

// The fixups every load applies to a checked design.
function applyLoadFixups(design) {
  dropWizardWorstCaseSampling(design);
  stampStoredDelRows(design);
  restoreRowSwitches(design);
}

module.exports = { validateDesign, applyLoadFixups };
