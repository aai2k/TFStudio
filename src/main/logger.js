// Main-process logger — buffered writer for app-debug.log.
//
// CommonJS (the Electron main process is not bundled). `init(exeDir)` must be
// called once at startup before flushLog(); log() buffers until then.
const fs = require('fs');
const path = require('path');

let logFile = null;
let logFileReady = false;
const logMessages = [];

function init(exeDir) {
  logFile = path.join(exeDir, 'app-debug.log');
}

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  if (logFileReady && logFile) {
    try { fs.appendFileSync(logFile, logMessage + '\n', 'utf-8'); } catch (_) {}
  } else {
    // Buffer ONLY until the file is ready. Previously every log() also pushed
    // here unconditionally, so the in-memory buffer grew without bound for the
    // whole session even after the log was being appended to disk.
    logMessages.push(logMessage + '\n');
  }
}

function flushLog() {
  if (logMessages.length > 0 && !logFileReady && logFile) {
    try {
      fs.writeFileSync(logFile, logMessages.join(''), 'utf-8');
      logFileReady = true;
      logMessages.length = 0;   // release the pre-flush buffer
    } catch (err) {
      try {
        const logDir = path.dirname(logFile);
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
          fs.writeFileSync(logFile, logMessages.join(''), 'utf-8');
          logFileReady = true;
          logMessages.length = 0;
        }
      } catch (_) {}
    }
  }
}

module.exports = { init, log, flushLog };
