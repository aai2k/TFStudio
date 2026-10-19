/**
 * SpecVerdict — a compact, reusable PASS/FAIL readout of the design
 * Specification (qualifiers) evaluated against a *given* design (or a set of
 * designs, worst-case merged). Shown in the tolerance windows so the user can
 * immediately see whether the requirements still hold:
 *
 *   • Layer Sensitivity     — the design under a uniform ±Δd probe (worst case),
 *                             so the verdict tracks the probe magnitude.
 *   • Systematic Deviations — the deviated design (does the spec survive the bias?)
 *   • Inhomogeneities: the design with its interlayers inserted
 *
 * Pass `design` for a single design, or `designs` (array) for a worst-case
 * check: a qualifier "passes" only if it passes for EVERY design in the set.
 * `deviation` or `interlayers` is the recipe the design is judged with
 * (toleranceSpecInputs.js).
 *
 * Every check is read at once at its default step on the window's thread,
 * and at its own Step on the analysis worker when a check has one; until the
 * worker answers, a result read at a default step is provisional and the
 * badge shows it faded, with ≈ before it. Under a cone of incidence the
 * worker answers alone, since even the default steps average many rays. While
 * an optimizer run goes the worker is not asked, as each design the run
 * reports would cancel the last evaluation before it ends.
 *
 * Renders an aggregate badge plus a chip per *failing* qualifier (all-pass just
 * shows the green badge); a tooltip lists every qualifier's value. Returns null
 * when the design has no qualifiers.
 *
 * Error Analysis uses its own per-trial *yield* readout instead (a distribution,
 * not a single design), so it does not use this component.
 */

import { evaluateQualifiers, aggregateVerdict, qualifierSummary, qualifierValueText, hasOwnStep } from '../utils/synthesis/qualifiers.js';
import { useFineSpecification, markProvisional } from './windows/design/specification/useSpecificationResults.js';
import { toleranceSpecInputs } from './windows/analysis/toleranceSpecInputs.js';
import { DesignContext } from '../state/DesignContext.js';
import { coneIsActive, makeConeSpec } from '../utils/physics/optimizer.js';

const { createElement: h, useContext, useMemo } = React;

const COARSE = Object.freeze({ coarse: true });

// One design's results at the checks' default steps, marked provisional where
// a check has a Step of its own.
function firstPass(design, quals, recipe) {
    try {
        const { design: judged, resolve } = toleranceSpecInputs(design, recipe);
        return markProvisional(quals, evaluateQualifiers(design.qualifiers || quals, judged, resolve, COARSE));
    } catch {
        return quals.map(() => ({ value: null, pass: null }));
    }
}

const pending = quals => quals.map(() => ({ value: null, pass: null }));
const underCone = designs => designs.some(d => coneIsActive(makeConeSpec(d?.cone || {})));

/**
 * Each design's Specification results, in the order of `designs`: the first
 * pass on this thread, replaced by the analysis worker's results at the
 * checks' own Steps when a check has one, and under a cone the worker's
 * alone. The worker is not asked while an optimizer run goes. A design the
 * worker cannot evaluate keeps its first pass. `recipe` must keep its identity
 * between renders.
 */
export function useSpecVerdictResults(designs, recipe) {
    const quals = designs[0]?.qualifiers || [];
    const cone = underCone(designs);
    const first = useMemo(() => {
        const checks = designs[0]?.qualifiers || [];
        return designs.map(d => (cone ? pending(checks) : firstPass(d, checks, recipe)));
    }, [designs, recipe, cone]);
    const optimizing = !!useContext(DesignContext)?.isOptimizing;
    const fine = useFineSpecification(designs, (cone || quals.some(hasOwnStep)) && !optimizing, recipe);
    return fine ? fine.map((results, i) => results || first[i]) : first;
}

// Merge per-qualifier as worst-case (pass only if it passes for all designs,
// e.g. both ±Δd perturbations). The value is the first design's; the summary
// speaks for the design that failed, when one did.
function mergeWorstCase(quals, per) {
    return quals.map((q, i) => {
        const base = per[0]?.[i] || {};
        let pass = true, anyNull = false, failRef = null, provisional = false;
        for (const res of per) {
            const r = res[i];
            if (r?.provisional) provisional = true;
            if (r?.pass === false) { pass = false; if (!failRef) failRef = r; }
            else if (r?.pass == null) anyNull = true;
        }
        return {
            ...base,
            pass: !pass ? false : (anyNull ? null : true),
            said: failRef || base,
            provisional,
        };
    });
}

const kindName = (ts, kind) => ts.kinds?.[kind];
const qualifierName = (q, i, ts) => q.label || kindName(ts, q.kind) || q.kind || `#${i + 1}`;
const provisionalMark = r => (r?.provisional ? '≈ ' : '');
const passMark = r => (r?.pass === true ? '✓' : r?.pass === false ? '✗' : '—');

// A chip of the badge, faded while its results are provisional.
function chip(txt, color, tip, key, provisional) {
    return h('span', {
        key, title: tip,
        style: {
            fontSize: 10, fontWeight: 600, color,
            padding: '1px 6px', borderRadius: 9,
            background: `${color}1a`, border: `1px solid ${color}55`,
            whiteSpace: 'nowrap', cursor: tip ? 'help' : 'default',
            opacity: provisional ? 0.6 : 1,
        }
    }, txt);
}

// The verdict chip and a chip per failing qualifier. A provisional result is
// marked ≈ and faded on its own chip and its line of the verdict's tooltip,
// which lists every qualifier; the verdict is marked while any result is.
function verdictChips({ qualifiers, results, verdict, c, t }) {
    const ts = (t && t.specification) || {};
    const { passing, total, allPass } = verdict;
    const col = total === 0 ? c.textDim : allPass ? c.success : c.error;
    const provisional = results.some(r => r.provisional);
    const fullTip = [
        ...(provisional ? [ts.provisionalTip] : []),
        ...qualifiers.map((q, i) => `${provisionalMark(results[i])}${passMark(results[i])} ${qualifierName(q, i, ts)}: ${qualifierValueText(results[i], t.units)}`),
    ].join('\n');
    const verdictText = allPass ? (ts.specPassBadge || 'Spec PASS') : `${total - passing}/${total} ${ts.failSuffix || 'fail'}`;
    const failChips = qualifiers
        .map((q, i) => ({ q, i, r: results[i] }))
        .filter(x => x.r?.pass === false)
        .map(x => chip(provisionalMark(x.r) + '✗ ' + qualifierName(x.q, x.i, ts), '#ef5350',
            (qualifierSummary(x.r.said, ts.summaries, t.units) || qualifierValueText(x.r, t.units)), x.q.id || x.i, x.r.provisional));
    return [chip((provisional ? '≈ ' : '') + verdictText, col, fullTip, 'verdict', provisional), ...failChips];
}

export function SpecVerdict({ design, designs, deviation, interlayers, c, t, label, style }) {
    const list = useMemo(() => ((designs && designs.length) ? designs : (design ? [design] : [])), [design, designs]);
    const recipe = useMemo(() => ({
        ...(deviation ? { deviation } : {}),
        ...(interlayers ? { interlayers } : {}),
    }), [deviation, interlayers]);
    const qualifiers = list[0]?.qualifiers || [];
    const per = useSpecVerdictResults(list, recipe);
    const results = useMemo(() => mergeWorstCase(qualifiers, per), [qualifiers, per]);
    const verdict = useMemo(() => aggregateVerdict(results), [results]);

    if (!qualifiers.length) return null;

    return h('div', {
        style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', ...(style || {}) }
    },
        label && h('span', { style: { fontSize: 11, color: c.textDim } }, label),
        ...verdictChips({ qualifiers, results, verdict, c, t }),
    );
}
