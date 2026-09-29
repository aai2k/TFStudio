// Which parts of the method a run uses, and why the others are off, for the
// window's status line; and why a run cannot start at all. The lab's method
// assumes its own case (one surface, T and R targets, pass points, a floor);
// on any other merit function the run falls back part by part:
//   refine    full Newton needs the merit scored on one surface on its own
//             side, no cone and operands with exact curvature
//             (LSQEngine._fullNewtonSupported); otherwise Gauss-Newton;
//   halfWave  drop and half need pass points (T = 1 or R = 0);
//   comb      every optical operand a pass or stop target, at least two pass runs;
//   pairs     the pair repair and the floor deletion need a floor.
// Codes only; the window turns them into text.

import { isFullSystemEval } from '../../physics/optimizer/evalCore.js';
import { coneIsActive, makeConeSpec } from '../../physics/optimizer/coneAngle.js';
import { expandMeasuredCurveOperands } from '../../physics/optimizer/measuredCurveOperand.js';
import { _operandSupportsFullNewton } from '../../physics/optimizer/newtonAssembly.js';
import { resolveScanSide } from '../../physics/optimizer/scanners.js';
import { countsOptically, passIndices } from './points.js';
import { combApplies } from './comb.js';

// LSQEngine._fullNewtonSupported (lsqEngine.js 370-375) with the reason it
// fails: 'surface' (two-sided or full-system scoring), 'cone', 'operands'
// (an operand without exact curvature); null when full Newton applies.
function gaussNewtonWhy(ev) {
    const base = ev.spec.base;
    const sm = base.surfaceMode || 'front_only';
    const single = sm === 'front_only' || sm === 'back_only';
    if (!single || isFullSystemEval(sm, base.mfEvalMode || 'side')) return 'surface';
    if (coneIsActive(makeConeSpec(base.cone || {}))) return 'cone';
    return expandMeasuredCurveOperands(ev.operands).every(_operandSupportsFullNewton) ? null : 'operands';
}

const off = (on, why) => (on ? null : why);

// The parts of a run on ev: refine { engine, model: 'newton' | 'gaussNewton',
// why }, halfWave { on, why, passPoints }, comb { on, why, passRuns }, pairs
// { on, why }. why is null for a part that is on.
export function deepSynthesisParts(ev) {
    const why = gaussNewtonWhy(ev);
    const comb = combApplies(ev);
    const passPoints = passIndices(comb.points).length;
    return {
        refine: { engine: ev.engine, model: why ? 'gaussNewton' : 'newton', why },
        halfWave: { on: passPoints > 0, why: off(passPoints > 0, 'noPassPoints'), passPoints },
        comb: { on: comb.on, why: comb.why, passRuns: comb.passRuns },
        pairs: { on: ev.floor > 0, why: off(ev.floor > 0, 'noFloor') },
    };
}

// The codes of the parts in use, in a fixed order: the refinement's model,
// then 'halfWave', 'comb', 'pairs' when on.
export function statusParts(parts) {
    return [parts.refine.model, ...['halfWave', 'comb', 'pairs'].filter(key => parts[key].on)];
}

// Why a run on `design` cannot start, or null: 'locked' (a locked layer on the
// side the run works on; the moves delete and melt any layer), 'noPool' (no
// material to insert), 'noOperands' (nothing optical to design for).
export function blockedReason(design, { pool, operands }) {
    const side = resolveScanSide(design.surfaceMode || 'front_only', 'front');
    const layers = design[side === 'back' ? 'backLayers' : 'frontLayers'] || [];
    if (layers.some(l => l.locked)) return 'locked';
    if (!pool || pool.length === 0) return 'noPool';
    return (operands || []).some(countsOptically) ? null : 'noOperands';
}
