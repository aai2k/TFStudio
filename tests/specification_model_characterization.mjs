import assert from 'node:assert/strict';
import { KIND_META, isPct } from '../src/components/windows/design/specification/model.js';
import { QUALIFIER_KINDS } from '../src/utils/synthesis/qualifiers.js';

// Every qualifier kind the utility layer knows about must have a row-editor
// entry, or QRow silently falls back to `{}` (hides every optional field).
for (const kind of QUALIFIER_KINDS) {
    assert.ok(KIND_META[kind], `KIND_META is missing an entry for ${kind}`);
}

// Field-visibility contract per kind — which optional fields QRow shows.
assert.deepEqual(KIND_META.T_AT,             { channelFixed: 'T', single: true, fmt: 'pct' });
assert.deepEqual(KIND_META.R_AT,             { channelFixed: 'R', single: true, fmt: 'pct' });
assert.deepEqual(KIND_META.A_AT,             { channelFixed: 'A', single: true, fmt: 'pct' });
assert.deepEqual(KIND_META.T_AVG,            { channelFixed: 'T', fmt: 'pct' });
assert.deepEqual(KIND_META.R_AVG,            { channelFixed: 'R', fmt: 'pct' });
assert.deepEqual(KIND_META.A_AVG,            { channelFixed: 'A', fmt: 'pct' });
assert.deepEqual(KIND_META.MIN_MAX,          { channelPick: true, direction: true, fmt: 'pct' });
// INTEGRAL takes no channelPick — the chosen integral preset fixes the T/R/A channel.
assert.deepEqual(KIND_META.INTEGRAL,         { integral: true, fmt: 'pct' });
assert.deepEqual(KIND_META.CENTRAL_LAMBDA,   { channelPick: true, direction: true, fmt: 'nm' });
assert.deepEqual(KIND_META.FWHM,             { channelPick: true, direction: true, level: true, fmt: 'nm' });
assert.deepEqual(KIND_META.EDGE_LAMBDA,      { channelPick: true, level: true, edgeSide: true, fmt: 'nm' });
assert.deepEqual(KIND_META.THICKNESS_BUDGET, { geomOnly: true, fmt: 'nm' });
assert.deepEqual(KIND_META.LAYER_COUNT,      { geomOnly: true, fmt: 'int' });

// isPct() — drives NumberField's %-vs-native-unit display for target/tol/lo/hi.
assert.equal(isPct(KIND_META.T_AT), true);
assert.equal(isPct(KIND_META.T_AVG), true);
assert.equal(isPct(KIND_META.MIN_MAX), true);
assert.equal(isPct(KIND_META.INTEGRAL), true);
assert.equal(isPct(KIND_META.CENTRAL_LAMBDA), false);
assert.equal(isPct(KIND_META.FWHM), false);
assert.equal(isPct(KIND_META.EDGE_LAMBDA), false);
assert.equal(isPct(KIND_META.THICKNESS_BUDGET), false);
assert.equal(isPct(KIND_META.LAYER_COUNT), false);
assert.equal(isPct(undefined), false);
assert.equal(isPct(null), false);
assert.equal(isPct({}), false);

console.log('PASS: specification_model_characterization');
