/**
 * The web demo opens a design file as the desktop does: the same checks and
 * the same load fixups (src/main/designLoad.js), run by the demo shim's file
 * import from the browser script tools/webDesignLoad.mjs builds.
 *
 *   1. A file holding a merit row and a specification check of environment 2,
 *      written switched off as the desktop writes them, opens with both
 *      switched on, the design equal to the one the desktop reads.
 *   2. A file the desktop refuses is refused with the desktop's reason.
 *   3. The demo's page loads the script before the shim.
 *
 * Run: node tests/web_demo_import.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import designFile from '../src/main/designFile.js';
import { DESIGN_LOAD_SCRIPT, bundleDesignLoad } from '../tools/webDesignLoad.mjs';
import { threeEnvironmentDesign } from './_environmentDesign.mjs';

const shimSource = readFileSync(new URL('../web/demo-shim.js', import.meta.url), 'utf8');
const buildSource = readFileSync(new URL('../tools/build-web-demo.mjs', import.meta.url), 'utf8');

let pass = 0;
async function check(name, body) {
    await body();
    pass++;
    console.log(`  ok  ${name}`);
}

// The demo shim in a browser-like context, its file picker handing over `text`.
async function demoImport(text) {
    const window = { open() {} };
    const context = vm.createContext({ window, console, setTimeout, clearTimeout, fetch: async () => ({ ok: false }) });
    vm.runInContext(await bundleDesignLoad({ minify: false }), context);
    window.DemoDesignLoad = context.DemoDesignLoad;
    window.DemoStorage = { pickTextFile: async () => ({ text, fileName: 'Picked.tfs' }) };
    vm.runInContext(shimSource, context);
    return window.electronAPI.importTfs();
}

// The desktop's reading of the same text.
const desktopRead = text => designFile.readDesignFile({ readFileSync: () => Buffer.from(text, 'utf8') }, 'Picked.tfs');

const withEnvironmentTwo = () => ({
    ...threeEnvironmentDesign(),
    qualifiers: [{ id: 'q1', type: 'R', lambdaStart: 550, aoi: 30, pol: 'avg', op: '<=', target: 0.01, enabled: true, env: 'env2' }],
});

await check('rows and checks of environment 2 open switched on, as on the desktop', async () => {
    const text = designFile.serializeDesign(withEnvironmentTwo());
    const written = JSON.parse(text);
    assert.equal(written.meritOperands.find(op => op.id === 'r2').enabled, false, 'the file holds the row switched off');
    assert.equal(written.qualifiers[0].enabled, false, 'and the check');
    const opened = await demoImport(text);
    assert.equal(opened.success, true, opened.error);
    const row = opened.design.meritOperands.find(op => op.id === 'r2');
    assert.equal(row.enabled, true, 'the row is on');
    assert.ok(!('envEnabled' in row), 'its file switch is gone');
    assert.equal(opened.design.qualifiers[0].enabled, true, 'the check is on');
    assert.equal(opened.fileName, 'Picked');
    // Through JSON, as the shim's objects belong to the context it runs in.
    assert.deepEqual(JSON.parse(JSON.stringify(opened.design)), desktopRead(text).design, 'the design the desktop reads');
});

await check('a file the desktop refuses is refused with its reason', async () => {
    const bare = withEnvironmentTwo();
    delete bare.substrate;
    const text = JSON.stringify({ tfs_version: '1.3', ...bare });
    const opened = await demoImport(text);
    assert.equal(opened.success, false);
    assert.ok(desktopRead(text).error, 'the desktop refuses it');
    assert.equal(opened.error, desktopRead(text).error);
});

// The build runs on import, so its page is read from its source: the script
// tag it writes for the bundle, and that tag ahead of the shim's.
await check('the demo page loads the script before the shim', () => {
    const tag = buildSource.indexOf('<script src="${DESIGN_LOAD_SCRIPT}"></script>');
    const shim = buildSource.indexOf('<script src="demo-shim.js"></script>');
    assert.ok(tag > 0 && shim > tag, 'the injected tags put the bundle first');
    assert.match(buildSource, /writeFileSync\(path\.join\(outDir, DESIGN_LOAD_SCRIPT\), await bundleDesignLoad\(\)/, 'and the build writes it');
    assert.equal(DESIGN_LOAD_SCRIPT, 'demo-design-load.js', 'a demo- name, which the page stamps against stale caches');
});

console.log(`PASS: web_demo_import (${pass} checks)`);
