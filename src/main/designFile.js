// The .tfs design file: reading one whatever encoding wrote it, checking that
// it holds what the app reads without guarding, the fixups a load applies, and
// writing one in this build's format. The main process's project handlers and
// the headless API read and write designs through these.
//
// CommonJS, Electron-free.
const { decodeText } = require('./paths');
const { guardRowSwitches, guardCheckSwitches, restoreRowSwitches } = require('./environmentRows');

// Format of the .tfs files this build writes.
//   1.0: material ids only; a design is readable only where its catalogs exist
//   1.1: adds the `materials` block defining the non-built-in materials used
//   1.2: adds `materials[id].mechanical` (the elastic, thermal and surface
//        constants the stress analysis reads), `stress` (the evaluation and
//        deposition temperatures) and `substrate.diameterMm`
//   1.3: adds `environments` and a merit row's and a specification check's
//        `env` and `envEnabled` (src/utils/environments/environments.js),
//        with an environment's `cone`, `mfEvalMode` and `temperatureC`; a
//        design with one environment holds none of them. Also the design's
//        own `temperatureC`, environment 1's, °C, written only when it is set
//
// Nothing is migrated in either direction. The reader checks the substrate and
// the layer lists and passes every other key through, so a 1.0 or 1.1 file
// reads as before and a newer file opens in an older build too. The losses:
// an older build re-saving a 1.2 design rebuilds the embedded materials from
// its own catalogs and drops the mechanical block where its copy lacks it, and
// re-saving a 1.3 design drops the copy of a material only another
// environment names (the id stays, and reads as missing where no catalog has it).
const TFS_VERSION = '1.3';

// The design a .tfs holds, whatever encoding wrote it: Notepad's UTF-8 with a
// byte order mark and the UTF-16 that PowerShell 5.1 writes read as the same
// JSON as the app's own files.
function parseDesignBuffer(buffer) {
  return JSON.parse(decodeText(buffer));
}

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

// The design in the .tfs at `filePath`, checked and with the load's fixups
// applied, as { design }, or { error } when it cannot be read or is not a
// usable design. The on-disk version key is dropped.
function readDesignFile(fs, filePath) {
  let design;
  try {
    design = parseDesignBuffer(fs.readFileSync(filePath));
  } catch (err) {
    return { error: `Could not read design: ${err.message}` };
  }
  const invalid = validateDesign(design);
  if (invalid) return { error: invalid };
  applyLoadFixups(design);
  delete design.tfs_version;
  return { design };
}

// Stamp the current format version and serialize, with the rows and checks of
// other environments written as environmentRows.js says. A design loaded
// from disk carries the version it was read with, so the stamp has to replace
// it rather than sit behind it in the spread.
function serializeDesign(design) {
  // eslint-disable-next-line no-unused-vars
  const { tfs_version, ...rest } = design;
  const written = {
    ...rest,
    ...(rest.meritOperands === undefined ? {} : { meritOperands: guardRowSwitches(rest.meritOperands) }),
    ...(rest.qualifiers === undefined ? {} : { qualifiers: guardCheckSwitches(rest.qualifiers) }),
  };
  return JSON.stringify({ tfs_version: TFS_VERSION, ...written }, null, 2);
}

module.exports = {
  TFS_VERSION, parseDesignBuffer, validateDesign, applyLoadFixups, readDesignFile, serializeDesign,
};
