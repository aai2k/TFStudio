/**
 * The local server for the bundled help site (src/main/helpServer.js).
 *
 *   1. A directory route serves its index.html, a query string is ignored and
 *      a percent-encoded name is decoded.
 *   2. A path that resolves outside the help folder is refused, a bad
 *      percent escape is a bad request and a missing file is not found.
 *   3. Serving a request raises no deprecation warning: url.parse() is
 *      deprecated (DEP0169) and Node 24, the Node in Electron, warns on it.
 *
 * Run: node tests/help_server.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { startHelpServer, stopHelpServer, getHelpServerPort } = require('../src/main/helpServer.js');

const warnings = [];
process.on('warning', w => warnings.push(w));

// The unpackaged app serves <srcDir>/../docs-site/dist.
const base = mkdtempSync(join(tmpdir(), 'tfs-help-'));
const dist = join(base, 'docs-site', 'dist');
mkdirSync(join(dist, 'design', 'design-editor'), { recursive: true });
writeFileSync(join(dist, 'index.html'), 'home');
writeFileSync(join(dist, 'design', 'design-editor', 'index.html'), 'design editor');
writeFileSync(join(dist, 'a b.txt'), 'spaced');
writeFileSync(join(base, 'secret.txt'), 'outside');

const quiet = console.log;
console.log = () => {};
try {
    startHelpServer({ isPackaged: false, srcDir: join(base, 'src') });
    for (let i = 0; i < 100 && !getHelpServerPort(); i++) await new Promise(r => setTimeout(r, 20));
    const port = getHelpServerPort();
    assert.ok(port, 'the server listens');
    const get = async path => {
        const res = await fetch(`http://127.0.0.1:${port}${path}`);
        return { status: res.status, body: await res.text(), type: res.headers.get('content-type') };
    };

    // ── 1. Pages ─────────────────────────────────────────────────────────────
    const home = await get('/');
    assert.equal(home.status, 200);
    assert.equal(home.body, 'home');
    assert.match(home.type, /^text\/html/);
    const page = await get('/design/design-editor/?q=thickness#top');
    assert.equal(page.body, 'design editor', 'a directory route with a query serves its index.html');
    assert.equal((await get('/a%20b.txt')).body, 'spaced', 'a percent-encoded name is decoded');

    // ── 2. Refusals ──────────────────────────────────────────────────────────
    assert.equal((await get('/..%2fsecret.txt')).status, 403, 'an encoded ../ cannot leave the help folder');
    assert.equal((await get('/%E0%A4%A')).status, 400, 'a bad percent escape is a bad request');
    assert.equal((await get('/missing.html')).status, 404);
} finally {
    stopHelpServer();
    console.log = quiet;
    rmSync(base, { recursive: true, force: true });
}

// ── 3. No deprecation warning ───────────────────────────────────────────────
await new Promise(r => setImmediate(r));
assert.deepEqual(warnings.map(w => `${w.code}: ${w.message}`), [], 'serving help raises no warnings');

console.log('help_server: pages, refusals and no deprecation warning OK');
