/**
 * The Python a Script Console Python script runs in, and how it is started.
 * TFStudio ships no Python: a script runs in the user's own, the one whose
 * path Preferences > Automation names, or else the py launcher on Windows,
 * then python3, then python on PATH. A Python older than 3.8 is passed over,
 * since the tfstudio package the script works through is written for 3.8 and
 * newer.
 *
 * Python starts on the package's _console.py (python/tfstudio), the package
 * the app ships put first on Python's path: resources/python in an installed
 * app, the repo's python/ in a source checkout.
 *
 * CommonJS, Electron-free.
 */
const path = require('path');
const { execFile } = require('child_process');

// The oldest Python the package runs on, as [major, minor].
const OLDEST = [3, 8];

// How long a Python has to say its version. One starts in well under a second
// as a rule, but the first start after an install, or one an antivirus scan
// holds up, can take several.
const PROBE_TIMEOUT_MS = 15000;

// What a Python prints when asked: its version, and the executable it runs
// as, which is what a launcher such as py starts. Python 2 runs it too, so an
// old Python is told apart from no Python.
const PROBE = 'import json, sys; print(json.dumps([list(sys.version_info[:3]), sys.executable]))';

// { version, path } from what PROBE printed, or null for anything else.
function probeAnswer(stdout) {
  try {
    const [version, found] = JSON.parse(stdout.trim().split('\n').pop());
    return Array.isArray(version) && typeof found === 'string' && found ? { version, path: found } : null;
  } catch (_) {
    return null;
  }
}

/** { version: [major, minor, micro], path } of the Python `command` starts with `args`, or null when it is none. */
function probePython(command, args, env) {
  return new Promise((resolve) => {
    // A program Node does not start at all, such as a .bat or .cmd file on
    // Windows, throws here rather than calling back.
    try {
      execFile(command, [...args, '-c', PROBE], { env, timeout: PROBE_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' },
        (err, stdout) => resolve(err ? null : probeAnswer(stdout)));
    } catch (_) {
      resolve(null);
    }
  });
}

// The commands tried in turn, each as [command, arguments].
function candidates(setPath, platform) {
  if (setPath) return [[setPath, []]];
  const onPath = [['python3', []], ['python', []]];
  return platform === 'win32' ? [['py', ['-3']], ...onPath] : onPath;
}

const newEnough = ([major, minor]) => major > OLDEST[0] || (major === OLDEST[0] && minor >= OLDEST[1]);

/**
 * The Python to run in: { found: { path, version } }, `version` as "3.12.1",
 * or { missing } with what is missing:
 *   { reason: 'setPath', path }       the path set in Preferences > Automation
 *                                     does not run as Python
 *   { reason: 'old', path, version }  the first Python found is older than 3.8
 *   { reason: 'none' }                no Python was found
 * `setPath` is the path set in Preferences > Automation, '' for none, `env`
 * the environment the commands are looked for in, and `probe` how a Python is
 * asked its version (probePython), which a test stands in for.
 */
async function findPython({ setPath = '', platform = process.platform, env = process.env, probe = probePython } = {}) {
  const set = String(setPath || '').trim();
  let old = null;
  for (const [command, args] of candidates(set, platform)) {
    const answer = await probe(command, args, env);
    const version = answer?.version.join('.');
    if (answer && newEnough(answer.version)) return { found: { path: answer.path, version } };
    if (answer) old ??= { reason: 'old', path: answer.path, version };
  }
  if (old) return { missing: old };
  return { missing: set ? { reason: 'setPath', path: set } : { reason: 'none' } };
}

/**
 * How the Python `found` starts a run: { command, args, cwd, env }. It runs in
 * the folder of the script's file, as a script started from its folder does,
 * so its relative paths and imports find the files beside it; a script with
 * no file runs in the app's data folder (`dataDir`), which the user can write
 * to. `packageHome` is the folder the package is in. The environment is the
 * app's, with the package first on Python's path, the output in UTF-8, which
 * the output pane reads, and written as the script prints rather than when a
 * buffer fills.
 */
function pythonLaunch({ found, filePath, dataDir, packageHome, env = process.env }) {
  return {
    command: found.path,
    args: ['-m', 'tfstudio._console'],
    cwd: filePath ? path.dirname(filePath) : dataDir,
    env: {
      ...env,
      PYTHONPATH: [packageHome, env.PYTHONPATH].filter(Boolean).join(path.delimiter),
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
    },
  };
}

/** The folder the package the app ships is in. */
function packageHome({ isPackaged, resourcesDir, srcDir }) {
  return isPackaged ? path.join(resourcesDir, 'python') : path.join(srcDir, '..', 'python');
}

module.exports = { findPython, pythonLaunch, packageHome, probePython };
