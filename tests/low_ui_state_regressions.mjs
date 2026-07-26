import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { resolveAvailableSide } from '../src/components/windows/analysis/availableSide.js';
import {
    cleanup,
    resizeAdjacentSizes,
} from '../src/components/docking/treeUtils.js';
import { appendDistinctSnapshot } from '../src/utils/history.js';

const require = createRequire(import.meta.url);
const projects = require('../src/main/ipc/projects.js');
const appWindow = require('../src/main/ipc/appWindow.js');

// BH-04: a case-insensitive filesystem reports both casings as the same path,
// so the handler must rename through a temporary sibling.
{
    let storedPath = '/projects/Foo';
    const renameCalls = [];
    const fs = {
        existsSync(candidate) {
            return candidate.toLowerCase() === storedPath.toLowerCase();
        },
        renameSync(from, to) {
            assert.equal(from.toLowerCase(), storedPath.toLowerCase());
            renameCalls.push([from, to]);
            storedPath = to;
        },
    };
    const handlers = new Map();
    projects.register({ handle: (channel, handler) => handlers.set(channel, handler) }, {
        fs,
        path: path.posix,
        projectsDir: '/projects',
        safeName: String,
        safeFilePath: path.posix.join,
    });
    const result = await handlers.get('rename-folder')(null, 'Foo', 'foo');
    assert.equal(result.success, true);
    assert.equal(renameCalls.length, 2);
    assert.match(renameCalls[0][1], /Foo\.tmp_rename_\d+$/);
    assert.equal(storedPath, '/projects/foo');
}

// BH-07: switching between one-sided designs always selects the populated side.
assert.equal(resolveAvailableSide('front', false, true), 'back');
assert.equal(resolveAvailableSide('back', true, false), 'front');
assert.equal(resolveAvailableSide('total', true, false), 'total');

// BH-14: divider clamping preserves the pair total and the minimum pane size.
assert.deepEqual(resizeAdjacentSizes([50, 50], 0, 60), [95, 5]);
assert.deepEqual(resizeAdjacentSizes([20, 30, 50], 1, -80), [20, 5, 75]);

// BH-15: cleanup keeps unrelated split proportions and rescales surviving panes.
const tabs = (id, names) => ({
    type: 'tabs', id, activeTab: 0,
    tabs: names.map(name => ({ id: name, toolId: name, title: name })),
});
const intact = cleanup({
    type: 'split', id: 's1', direction: 'h', sizes: [30, 70],
    children: [tabs('g1', ['a']), tabs('g2', ['b', 'c'])],
});
assert.deepEqual(intact.sizes, [30, 70]);
const pruned = cleanup({
    type: 'split', id: 's2', direction: 'h', sizes: [20, 30, 50],
    children: [tabs('g3', ['a']), tabs('g4', []), tabs('g5', ['c'])],
});
assert.ok(Math.abs(pruned.sizes[0] / pruned.sizes[1] - 20 / 50) < 1e-12);
assert.ok(Math.abs(pruned.sizes[0] + pruned.sizes[1] - 100) < 1e-12);

// BH-16: a checkpoint followed by a committed update does not append the same
// design object twice, while a genuinely different state still creates history.
const oldDesign = { id: 'd1', name: 'Old' };
const checkpointed = appendDistinctSnapshot([], oldDesign, 50);
assert.strictEqual(appendDistinctSnapshot(checkpointed, oldDesign, 50), checkpointed);
assert.deepEqual(appendDistinctSnapshot(checkpointed, { ...oldDesign }, 50).length, 2);

// BH-20: web and email links are allowed; executable and malformed targets are not.
{
    const handlers = new Map();
    const opened = [];
    const ipcMain = {
        on: (channel, handler) => handlers.set(channel, handler),
        handle: (channel, handler) => handlers.set(channel, handler),
    };
    appWindow.register(ipcMain, {
        shell: { openExternal: url => opened.push(url) },
        app: { getVersion: () => 'test' },
        getMainWindow: () => null,
        devToolsAllowed: false,
        log() {},
    });
    const openExternal = handlers.get('open-external');
    openExternal(null, 'https://tfstudio.xyz');
    openExternal(null, 'http://127.0.0.1/help');
    openExternal(null, 'mailto:achapovskyai@gmail.com');
    openExternal(null, 'file:///tmp/secret');
    openExternal(null, 'not a url');
    assert.deepEqual(opened, [
        'https://tfstudio.xyz',
        'http://127.0.0.1/help',
        'mailto:achapovskyai@gmail.com',
    ]);
}

console.log('PASS: low_ui_state_regressions');
