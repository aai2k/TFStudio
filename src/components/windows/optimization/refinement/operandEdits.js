// Pure merit-operand list transforms used by the Refinement window's edit
// handlers. Each takes the current operand array and returns the next array (plus
// the id to select, where relevant) — no React, no refs — so the component's
// handlers stay thin wrappers and their branching doesn't roll up into the
// component's complexity.

import { makeOperand, isConstraint, isArgwave, isMath, mathTargetInPercent } from '../../../../utils/physics/optimizer.js';

const DEFAULT_OPERAND = { type: 'RAV', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, weight: 1 };

// Field set copied when cloning/seeding an operand from an existing one.
const seedFrom = (o) => ({
    type: o.type, lambdaStart: o.lambdaStart, lambdaEnd: o.lambdaEnd,
    aoi: o.aoi, pol: o.pol, target: o.target, weight: o.weight,
    targetEnd: o.targetEnd, rampPoints: o.rampPoints, comment: o.comment,
    enabled: o.enabled !== false,
});

export function editOperand(ops, id, key, value) {
    return ops.map(op => {
        if (op.id !== id) return op;
        if (key === '_patch') {
            // Bulk multi-field update (used by the *IW preset picker so all
            // four fields land in one re-render).
            return { ...op, ...value };
        }
        if (key === 'target') {
            const n = typeof value === 'number' ? value : parseFloat(value);
            // Constraint (nm), argwave (λ in nm) store raw. Math operands inherit
            // their reference's unit — if the ref returns a fraction T/R/A the
            // math row's target is also a fraction (entered as percent, stored as
            // /100), otherwise raw.
            const byId = new Map(ops.map(o => [o.id, o]));
            const mthPct = isMath(op.type) && mathTargetInPercent(op, byId);
            const storeRaw = isConstraint(op.type) || isArgwave(op.type)
                          || (isMath(op.type) && !mthPct);
            return { ...op, target: storeRaw ? n : n / 100 };
        }
        return { ...op, [key]: value };
    });
}

// Returns { next, selectId } or null when nothing was added.
export function addOperands(ops, data, atIndex) {
    const list = Array.isArray(data) ? data : [data];
    const created = list.map(d => makeOperand(d ?? DEFAULT_OPERAND));
    if (created.length === 0) return null;
    const pos = atIndex == null ? ops.length : Math.max(0, Math.min(atIndex, ops.length));
    return { next: [...ops.slice(0, pos), ...created, ...ops.slice(pos)], selectId: created[created.length - 1].id };
}

// Returns { next, selectId }.
export function insertOperandAt(ops, insertIdx, source) {
    const op = makeOperand(source ? seedFrom(source) : DEFAULT_OPERAND);
    const pos = Math.max(0, Math.min(insertIdx, ops.length));
    return { next: [...ops.slice(0, pos), op, ...ops.slice(pos)], selectId: op.id };
}

// Returns { next, selectId } or null when nothing was selected to duplicate.
export function duplicateOperands(ops, ids) {
    const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
    if (idSet.size === 0) return null;
    const out = [];
    let selectId = null;
    for (const op of ops) {
        out.push(op);
        if (idSet.has(op.id)) {
            const clone = makeOperand(seedFrom(op));
            out.push(clone);
            selectId = clone.id;
        }
    }
    return { next: out, selectId };
}

export function deleteOperands(ops, ids) {
    const set = new Set(Array.isArray(ids) ? ids : [ids]);
    return ops.filter(op => !set.has(op.id));
}

// Move the selected operand by `dir` (-1 up, +1 down). Returns the reordered
// array, or null if the move is a no-op (nothing selected / already at an edge).
export function moveOperand(ops, selectedId, dir) {
    if (!selectedId) return null;
    const i = ops.findIndex(op => op.id === selectedId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ops.length) return null;
    const a = ops.slice();
    [a[i], a[j]] = [a[j], a[i]];
    return a;
}
