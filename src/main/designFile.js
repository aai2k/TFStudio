// The .tfs design file: reading one whatever encoding wrote it, with the checks
// and fixups a load applies (designLoad.js), and writing one in this build's
// format. The main process's project handlers and the headless API read and
// write designs through these.
//
// CommonJS, Electron-free.
const { decodeText } = require('./paths');
const { guardRowSwitches, guardCheckSwitches } = require('./environmentRows');
const { validateDesign, applyLoadFixups } = require('./designLoad');

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
