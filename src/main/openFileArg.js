// The design file a launch was asked to open: a double-click on a .tfs in the
// file manager, or `TFStudio design.tfs` from a shell.
//
// Windows and Linux both pass the path as a plain argument, but not at a fixed
// position. A packaged run gets it straight after the executable, `electron .`
// gets it after the project directory, and Chromium appends switches of its
// own, so the path is found by extension rather than by index. macOS delivers
// it through the 'open-file' event instead, which is unused while there is no
// macOS build.
//
// CommonJS, Electron-free.
const path = require('path');

const DESIGN_EXT = '.tfs';

// The first design path in `argv`, made absolute, or null when the launch named
// none. Switches are skipped so a value such as --log-file=old.tfs cannot be
// mistaken for a design.
function designFileFromArgv(argv) {
  for (const arg of (argv || []).slice(1)) {
    if (typeof arg !== 'string' || arg.startsWith('-')) continue;
    if (arg.toLowerCase().endsWith(DESIGN_EXT)) return path.resolve(arg);
  }
  return null;
}

module.exports = { designFileFromArgv };
