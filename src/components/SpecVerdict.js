/**
 * SpecVerdict — a compact, reusable PASS/FAIL readout of the design
 * Specification (qualifiers) evaluated against a *given* design (or a set of
 * designs, worst-case merged) with a *given* material resolver. Shown in the
 * tolerance windows so the user can immediately see whether the requirements
 * still hold:
 *
 *   • Layer Sensitivity     — the design under a uniform ±Δd probe (worst case),
 *                             so the verdict tracks the probe magnitude.
 *   • Systematic Deviations — the deviated design (does the spec survive the bias?)
 *
 * Pass `design` for a single design, or `designs` (array) for a worst-case
 * check: a qualifier "passes" only if it passes for EVERY design in the set.
 *
 * Renders an aggregate badge plus a chip per *failing* qualifier (all-pass just
 * shows the green badge); a tooltip lists every qualifier's value. Returns null
 * when the design has no qualifiers.
 *
 * Error Analysis uses its own per-trial *yield* readout instead (a distribution,
 * not a single design), so it does not use this component.
 */

import { evaluateQualifiers, aggregateVerdict } from '../utils/synthesis/qualifiers.js';

const { createElement: h, useMemo } = React;

export function SpecVerdict({ design, designs, resolveMat, c, t, label, style }) {
    const ts = (t && t.specification) || {};

    // Evaluate every design and merge per-qualifier as worst-case (pass only if
    // it passes for all designs — e.g. both ±Δd perturbations).
    const { qualifiers, results } = useMemo(() => {
        const list = (designs && designs.length) ? designs : (design ? [design] : []);
        const quals = list[0]?.qualifiers || [];
        if (!quals.length) return { qualifiers: [], results: [] };

        const per = list.map(d => {
            try { return evaluateQualifiers(d.qualifiers || quals, d, resolveMat); }
            catch { return quals.map(() => ({ value: null, pass: null })); }
        });

        const merged = quals.map((q, i) => {
            const base = per[0]?.[i] || {};
            let pass = true, anyNull = false, failRef = null;
            for (const res of per) {
                const r = res[i];
                if (r?.pass === false) { pass = false; if (!failRef) failRef = r; }
                else if (r?.pass == null) anyNull = true;
            }
            return {
                ...base,
                pass: !pass ? false : (anyNull ? null : true),
                summary: failRef?.summary || base.summary,
            };
        });
        return { qualifiers: quals, results: merged };
    }, [design, designs, resolveMat]);

    const verdict = useMemo(() => aggregateVerdict(results), [results]);

    if (!qualifiers.length) return null;

    const { passing, total, allPass } = verdict;
    const col = total === 0 ? c.textDim : allPass ? c.success : c.error;

    const chip = (txt, color, tip, key) => h('span', {
        key, title: tip,
        style: {
            fontSize: 10, fontWeight: 600, color,
            padding: '1px 6px', borderRadius: 9,
            background: `${color}1a`, border: `1px solid ${color}55`,
            whiteSpace: 'nowrap', cursor: tip ? 'help' : 'default',
        }
    }, txt);

    const qLabel = (q, i) => q.label || (ts.kinds && ts.kinds[q.kind]) || q.kind || ('#' + (i + 1));

    const failChips = qualifiers
        .map((q, i) => ({ q, i, r: results[i] }))
        .filter(x => x.r?.pass === false)
        .map(x => chip('✗ ' + qLabel(x.q, x.i), '#ef5350',
            (x.r?.summary || x.r?.displayValue || ''), x.q.id || x.i));

    const fullTip = qualifiers.map((q, i) => {
        const r = results[i];
        const mark = r?.pass === true ? '✓' : r?.pass === false ? '✗' : '—';
        return `${mark} ${qLabel(q, i)}: ${r?.displayValue ?? '—'}`;
    }).join('\n');

    return h('div', {
        style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', ...(style || {}) }
    },
        label && h('span', { style: { fontSize: 11, color: c.textDim } }, label),
        chip(
            allPass ? (ts.specPassBadge || 'Spec PASS') : `${total - passing}/${total} ${ts.failSuffix || 'fail'}`,
            col, fullTip, 'verdict'
        ),
        ...failChips,
    );
}
