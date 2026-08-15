/**
 * Design-scoped material resolution and the .tfs `materials` block.
 *
 * The behaviour under test is what makes a design portable: a design that
 * references a catalog the recipient does not have must still resolve to the
 * author's dispersion data, and a material that resolves nowhere must be
 * reported rather than quietly evaluated as vacuum.
 */
import assert from 'node:assert/strict';
import { initCatalogs } from '../src/utils/materials/catalogManager.js';
import {
    designMaterialIds,
    designMaterialLookup,
    embedDesignMaterials,
    isBuiltinId,
    resolveDesignMaterial,
    UnresolvedDesignMaterialError,
    unresolvedMaterials,
} from '../src/utils/materials/designMaterials.js';
import { evaluateSpectrum } from '../src/utils/physics/thinFilmMath.js';

// A catalog of the kind that exists only on its author's machine: a Sellmeier
// entry, an absorbing entry with a k table, and a tabulated entry.
const AUTHOR_CATALOG = {
    id: 'user_lab', name: 'Lab materials', source: 'user',
    materials: {
        // Sellmeier-1 (formula 2) coefficients for fused silica (Malitson 1965).
        SiO2fit: {
            id: 'SiO2fit', name: 'Silica (lab fit)', formulaNum: 2,
            coefficients: [0.6961663, 0.0684043 ** 2, 0.4079426, 0.1162414 ** 2,
                0.8974794, 9.896161 ** 2],
            kTable: [],
        },
        // Same dispersion with absorption, to exercise the kTable path.
        SiO2lossy: {
            id: 'SiO2lossy', name: 'Silica (lossy)', formulaNum: 2,
            coefficients: [0.6961663, 0.0684043 ** 2, 0.4079426, 0.1162414 ** 2,
                0.8974794, 9.896161 ** 2],
            kTable: [{ lam_um: 0.4, k: 0.002 }, { lam_um: 0.8, k: 0.006 }],
        },
        // formulaNum -1 = tabulated [lam_nm, n, k].
        TiO2tab: {
            id: 'TiO2tab', name: 'Titania (measured)', formulaNum: -1,
            tabData: [[400, 2.55, 0.004], [550, 2.42, 0.001], [700, 2.36, 0.0004]],
        },
    },
};

const design = {
    id: 'design-portability', name: 'Portable design',
    incidentMedium: 'builtin:Air',
    exitMedium: 'builtin:Air',
    substrate: { material: 'builtin:BK7', thickness: 1 },
    frontLayers: [
        { id: 'f1', material: 'user_lab:TiO2tab', thickness: 60 },
        { id: 'f2', material: 'user_lab:SiO2fit', thickness: 95 },
        { id: 'f3', material: 'user_lab:SiO2lossy', thickness: 40 },
        { id: 'f4', material: 'builtin:MgF2', thickness: 100 },
    ],
    backLayers: [{ id: 'b1', material: 'user_lab:SiO2fit', thickness: 80 }],
};

const SPECTRUM_PARAMS = {
    lambdaStart: 420, lambdaEnd: 700, lambdaStep: 20, theta: 0, polarization: 'avg',
};

function spectrumUsing(d, resolve) {
    return evaluateSpectrum(
        SPECTRUM_PARAMS,
        resolve(d.incidentMedium),
        resolve(d.substrate.material),
        d.frontLayers.map(l => ({ material: resolve(l.material), thickness: l.thickness })),
    );
}

function spectrumOf(d) {
    return spectrumUsing(d, designMaterialLookup(d));
}

// ── Ids ───────────────────────────────────────────────────────────────────────

assert.deepEqual(designMaterialIds(design), [
    'builtin:Air', 'builtin:BK7',
    'user_lab:TiO2tab', 'user_lab:SiO2fit', 'user_lab:SiO2lossy', 'builtin:MgF2',
], 'media, substrate and both layer stacks are collected, deduplicated, in order');
assert.deepEqual(designMaterialIds(null), []);

assert.ok(isBuiltinId('builtin:SiO2'));
assert.ok(isBuiltinId('BK7'), 'a bare legacy id names a built-in material');
assert.ok(!isBuiltinId('user_lab:SiO2fit'));

// ── With the author's catalog present ─────────────────────────────────────────

initCatalogs({ user_lab: AUTHOR_CATALOG });

assert.deepEqual(unresolvedMaterials(design), [], 'everything resolves on the author machine');
assert.equal(resolveDesignMaterial(design, 'user_lab:SiO2fit').status, 'catalog');
assert.equal(resolveDesignMaterial(design, 'builtin:BK7').status, 'catalog');
assert.equal(resolveDesignMaterial(design, null).status, 'unset');

const authored = spectrumOf(design);
const embedded = embedDesignMaterials(design);

// Only the ids that cannot be assumed present travel with the file. Built-ins
// are library code on the recipient's side, not data, so embedding them would
// mean shipping a resampling of something they already hold exactly.
assert.deepEqual(Object.keys(embedded.materials).sort(),
    ['user_lab:SiO2fit', 'user_lab:SiO2lossy', 'user_lab:TiO2tab']);
assert.ok(!('getNK' in embedded.materials['user_lab:SiO2fit']),
    'the lazily attached getNK closure must not reach the file');
assert.equal(embedded.materials['user_lab:TiO2tab'].interp, 'pchip',
    'embedded tabular materials record their interpolation rule');
assert.equal(embedded.materials['user_lab:SiO2lossy'].interp, 'pchip',
    'embedded formula materials record the rule for their k table');
assert.deepEqual(
    JSON.parse(JSON.stringify(embedded)), embedded,
    'the embedded design must survive a JSON round-trip unchanged');

// A design that uses only built-ins stays as simple as it is today.
const builtinOnly = {
    ...design, materials: undefined,
    frontLayers: [{ id: 'f1', material: 'builtin:SiO2', thickness: 100 }],
    backLayers: [],
};
assert.ok(!('materials' in embedDesignMaterials(builtinOnly)),
    'no block is written for a design with nothing to embed');

// ── On a machine without the author's catalog ─────────────────────────────────

initCatalogs({});

assert.deepEqual(
    unresolvedMaterials(design),
    ['user_lab:TiO2tab', 'user_lab:SiO2fit', 'user_lab:SiO2lossy'],
    'the id-only design reports exactly what it cannot resolve');
assert.equal(resolveDesignMaterial(design, 'user_lab:SiO2fit').status, 'missing');

// The file as written by the author. Serialized and parsed so the test sees
// what a recipient's disk actually hands back.
const received = JSON.parse(JSON.stringify(embedded));

assert.deepEqual(unresolvedMaterials(received), [],
    'the embedded definitions resolve without the author catalog');
assert.equal(resolveDesignMaterial(received, 'user_lab:SiO2fit').status, 'embedded');

const reproduced = spectrumOf(received);
assert.deepEqual(reproduced.T, authored.T, 'transmittance must reproduce bit-for-bit');
assert.deepEqual(reproduced.R, authored.R, 'reflectance must reproduce bit-for-bit');
assert.deepEqual(reproduced.A, authored.A, 'absorptance must reproduce bit-for-bit');

assert.throws(
    () => spectrumOf(design),
    error => error instanceof UnresolvedDesignMaterialError
        && error.materialId === 'user_lab:TiO2tab',
    'evaluation refuses the first unresolved material instead of substituting Air');

// Pin the unsafe historical result as a different coating. The status-aware
// lookup above must remain the only path evaluation code uses.
const substituted = spectrumUsing(design, id => resolveDesignMaterial(design, id).material);
assert.ok(
    Math.max(...substituted.T.map((t, i) => Math.abs(t - authored.T[i]))) > 0.01,
    'air substitution must not be mistaken for a correct result');

// ── Precedence: the design wins over a local catalog sharing its ids ──────────

const localCatalog = {
    ...AUTHOR_CATALOG,
    materials: {
        ...AUTHOR_CATALOG.materials,
        // Same id, different data — a divergent local copy.
        SiO2fit: {
            id: 'SiO2fit', name: 'Silica (local)', formulaNum: 2,
            coefficients: [0.7, 0.005, 0.4, 0.014, 0.9, 98], kTable: [],
        },
    },
};
initCatalogs({ user_lab: localCatalog });

const { material, status } = resolveDesignMaterial(received, 'user_lab:SiO2fit');
assert.equal(status, 'embedded');
assert.equal(material.name, 'Silica (lab fit)', 'the design carries its author\'s definition');
assert.deepEqual(spectrumOf(received).T, authored.T,
    'a divergent local catalog cannot change what the file computes');

// Re-saving keeps the embedded definition rather than adopting the local one.
assert.equal(
    embedDesignMaterials(received).materials['user_lab:SiO2fit'].name, 'Silica (lab fit)');

// ── A material missing everywhere has nothing to embed ────────────────────────

initCatalogs({});
const broken = {
    ...design, materials: undefined,
    frontLayers: [{ id: 'f1', material: 'user_gone:Ta2O5', thickness: 50 }],
    backLayers: [],
};
assert.deepEqual(unresolvedMaterials(broken), ['user_gone:Ta2O5']);
assert.ok(!('materials' in embedDesignMaterials(broken)),
    'a design whose materials were never on this machine cannot embed them');

console.log('PASS: design_materials');
