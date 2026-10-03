/**
 * The merit function wizard's worst-case rows check their band as finely as
 * every other worst-case row.
 *
 * Worst-case T min and Worst-case R max used to write their TMN and RMX rows
 * with bandPoints 21 and pNorm 50, so the row looked at 21 wavelengths over
 * 400-700 nm, a 15 nm step a narrow dip falls between. The generators no longer
 * write either field, and a saved design carrying them has both dropped when it
 * is read, by the tree loader and by the file picker alike. A TMN row given its
 * own sample count, with no pNorm, keeps it.
 *
 * Run: node tests/worst_case_wizard_rows.mjs
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

import {
    ARGWAVE_DEFAULT_POINTS, defaultFilterParams, generateFilterOperands, operandSampleLambdas,
} from '../src/utils/physics/optimizer.js';

const require = createRequire(import.meta.url);
const projects = require('../src/main/ipc/projects.js');

// -- The generators -----------------------------------------------------------
for (const [typeId, type] of [['WORST_T_MIN', 'TMN'], ['WORST_R_MAX', 'RMX']]) {
    const rows = generateFilterOperands(typeId, defaultFilterParams(typeId), { pol: 'avg' });
    assert.equal(rows.length, 1, `${typeId} writes one row at one angle`);
    const [row] = rows;
    assert.equal(row.type, type);
    assert.ok(!('bandPoints' in row), `${typeId} stamps no sample count`);
    assert.ok(!('pNorm' in row), `${typeId} stamps no pNorm`);
    assert.equal(operandSampleLambdas(row).length, ARGWAVE_DEFAULT_POINTS,
        `${typeId} checks ${ARGWAVE_DEFAULT_POINTS} wavelengths`);
}

// -- Reading a saved design ---------------------------------------------------
const stamped = (type) => ({
    id: `${type}-row`, enabled: true, type, lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg',
    target: type === 'TMN' ? 0.99 : 0.01, weight: 1, pNorm: 50, bandPoints: 21,
});
const ownCount = {
    id: 'own', enabled: true, type: 'TMN', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg',
    target: 0.9, weight: 1, bandPoints: 51,
};
const design = {
    id: 'd1', name: 'Worst case', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: [], backLayers: [],
    meritOperands: [stamped('TMN'), stamped('RMX'), ownCount],
};

const files = new Map([
    ['/out/worst.tfs', JSON.stringify(design)],
    ['/p/My Designs/worst.tfs', JSON.stringify(design)],
]);
const dirs = new Map([['/p', ['My Designs']], ['/p/My Designs', ['worst.tfs']]]);
const ctx = {
    path: path.posix,
    projectsDir: '/p',
    fs: {
        readFileSync(f) { if (!files.has(f)) throw new Error(`ENOENT: ${f}`); return files.get(f); },
        readdirSync(d, opts) {
            const names = dirs.get(d) || [];
            if (!opts || !opts.withFileTypes) return names;
            return names.map(n => ({
                name: n,
                isFile: () => !dirs.has(`${d}/${n}`),
                isDirectory: () => dirs.has(`${d}/${n}`),
                isSymbolicLink: () => false,
            }));
        },
        statSync() { return { mtimeMs: 1 }; },
        existsSync(p) { return dirs.has(p) || files.has(p); },
    },
    log() {},
};
const handlers = new Map();
projects.register({ handle(channel, handler) { handlers.set(channel, handler); } }, ctx);

function checkRows(operands, reader) {
    for (const op of operands.slice(0, 2)) {
        assert.ok(!('pNorm' in op) && !('bandPoints' in op), `${reader}: ${op.type} loses both stamped fields`);
        assert.equal(operandSampleLambdas(op).length, ARGWAVE_DEFAULT_POINTS,
            `${reader}: ${op.type} checks ${ARGWAVE_DEFAULT_POINTS} wavelengths`);
    }
    assert.equal(operands[2].bandPoints, 51, `${reader}: a row with its own sample count keeps it`);
    assert.equal(operandSampleLambdas(operands[2]).length, 51);
}

const opened = await handlers.get('open-tfs-path')(null, '/out/worst.tfs');
assert.equal(opened.success, true);
checkRows(opened.design.meritOperands, 'file picker');

const tree = await handlers.get('load-folders')();
const loaded = tree.folders.find(f => f.id === 'My Designs').items[0].design;
checkRows(loaded.meritOperands, 'tree loader');

console.log('PASS: worst_case_wizard_rows');
