// The first line an API server writes, which server.js documents. It is here
// rather than in server.js so that a server run as part of something else,
// such as the Script Console's for a Python script
// (src/scripts/pythonWorker.js), says it alike without loading server.js,
// which runs itself when it is the program started.

const HELLO = 'tfstudio-api';
// Raised when the messages change shape, so a client of another version is
// told at the hello rather than misread.
const PROTOCOL = 1;

/**
 * The hello of a server whose API started: `version` the TFStudio version,
 * `started` what the API's init answered, `live` whether app.* reach an app,
 * `calls` the API's calls by name.
 */
export function helloMessage({ version, started, live, calls }) {
    return { hello: HELLO, protocol: PROTOCOL, version, ...started, live, calls };
}

/** The hello of a server whose API could not start, `message` saying why. */
export function failedHello(message) {
    return { hello: HELLO, protocol: PROTOCOL, error: { message } };
}
