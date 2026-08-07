/** Response-stream failures must settle the update request. */
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const https = require('https');
const { fetchLatestRelease } = require('../src/main/ipc/updates.js');

let passed = 0;
function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

async function simulateResponseFailure(eventName) {
  const originalGet = https.get;
  try {
    https.get = (_url, _options, callback) => {
      const request = new EventEmitter();
      request.setTimeout = () => {};
      request.destroy = (error) => {
        if (error) queueMicrotask(() => request.emit('error', error));
      };

      queueMicrotask(() => {
        const response = new EventEmitter();
        response.statusCode = 200;
        response.headers = {};
        response.setEncoding = () => {};
        response.resume = () => {};
        callback(response);
        response.emit('data', '{"tag_name":');
        response.emit(eventName, new Error('stream failed'));
      });
      return request;
    };

    return await Promise.race([
      fetchLatestRelease(),
      new Promise((resolve) => setTimeout(() => resolve('timed-out'), 100)),
    ]);
  } finally {
    https.get = originalGet;
  }
}

for (const eventName of ['aborted', 'error']) {
  const result = await simulateResponseFailure(eventName);
  ok(result !== 'timed-out', `response ${eventName} settles the request`);
  ok(result?.ok === false && result.reason === 'bad-response',
    `response ${eventName} is classified as a bad response`);
}

console.log(`update_ipc: ${passed} passed`);
