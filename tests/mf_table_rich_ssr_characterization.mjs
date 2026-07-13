import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp, makeLocale, makeTheme, shimBrowserGlobals,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { MFTable } = await import('../src/components/windows/optimization/meritFunctionEditor/mfTable/MFTable.js');

const c = makeTheme();
const t = makeLocale();
const noop = () => {};
const base = (id, type, extra = {}) => ({
    id, type, enabled: true, lambdaStart: 400, lambdaEnd: 700,
    aoi: 0, pol: 'avg', target: 0.5, weight: 1, ...extra,
});
const operands = [
    base('dmfs', 'DMFS', { comment: 'Characterization block' }),
    base('blank', 'BLNK', { comment: 'Free text note' }),
    base('optical', 'R', { lambdaStart: 550, target: 0.1 }),
    base('average', 'TAV', { target: 0.8 }),
    base('ramp', 'RGT', { target: 0.1, targetEnd: 0.9 }),
    base('integral', 'TIW', { presetKey: 'Tvis', lambdaStart: 380, lambdaEnd: 780 }),
    base('tt', 'TT', { cmp: 'ge', target: 1200 }),
    base('mnt', 'MNT', { lambdaStart: 1, lambdaEnd: 4, target: 25 }),
    base('mxt', 'MXT', { lambdaStart: 2, lambdaEnd: 6, target: 300 }),
    base('arg', 'MXWT', { target: 550 }),
    base('single', 'OPGT', { refId: 'optical', target: 0.15 }),
    base('pair', 'DIFF', { refId1: 'optical', refId2: 'average', target: 0.02 }),
    base('stale', 'ABSO', { refId: 'deleted-id', target: 0 }),
    base('disabled', 'A', { enabled: false, target: 0.05 }),
];
const computed = [null, null, 0.12, 0.79, 0.03, 0.77, 1300, 24, 299, 545, 0.12, -0.67, 0, 0.04];
const props = {
    operands, computed, selectedId: 'ramp', noOperandsMsg: 'No test operands',
    onSelect: noop, onEdit: noop, onAdd: noop, onInsertAt: noop,
    onDuplicate: noop, onDelete: noop, onClear: noop,
    onMoveUp: noop, onMoveDown: noop, c, t,
};

const html = renderToStaticMarkup(React.createElement(MFTable, props));
assert.equal((html.match(/<tr/g) || []).length, operands.length + 1);
assert.ok(html.includes('▶ DMFS — Characterization block'));
assert.ok(html.includes('value="Free text note"'));
assert.ok(html.includes('>λ Start</th><th'));
assert.ok(html.includes('>λ End</th><th'));
assert.ok(html.includes('10.0→90.0'));
assert.ok(html.includes('80.00'));
assert.match(html, /<option(?=[^>]*selected="")(?=[^>]*value="Tvis")[^>]*>Tvis<\/option>/);
assert.ok(html.includes('Total thickness ≥ target (min)'));
assert.match(html, /<option(?=[^>]*selected="")(?=[^>]*value="ge")[^>]*>≥<\/option>/);
assert.ok(html.includes('>25.00</td>'));
assert.ok(html.includes('>300.00</td>'));
assert.ok(html.includes('>545.00 nm</td>'));
assert.match(html, /<option(?=[^>]*selected="")(?=[^>]*value="optical")[^>]*>#3 R<\/option>/);
assert.match(html, /<option(?=[^>]*selected="")(?=[^>]*value="average")[^>]*>#4 TAV<\/option>/);
assert.ok(html.includes('Referenced operand was deleted'));
assert.ok(html.includes('>(deleted)</option>'));
assert.ok(html.includes('opacity:0.45'));
assert.ok(html.includes('<button'));
assert.ok(html.includes('>Add</button>'));
assert.ok(html.includes('>Delete</button>'));
assert.ok(html.includes('Ctrl+C/V=copy/paste'));

const withoutToolbar = renderToStaticMarkup(React.createElement(MFTable, { ...props, showToolbar: false }));
assert.equal((withoutToolbar.match(/<tr/g) || []).length, operands.length + 1);
assert.ok(!withoutToolbar.includes('<button'));
assert.ok(!withoutToolbar.includes('Ctrl+C/V=copy/paste'));

const empty = renderToStaticMarkup(React.createElement(MFTable, {
    ...props, operands: [], computed: [], selectedId: null, showToolbar: false,
}));
assert.ok(empty.includes('No test operands'));

console.log('mf_table_rich_ssr_characterization: passed');
