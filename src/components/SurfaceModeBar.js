/**
 * Surface / evaluation mode — the single, app-wide model.
 *
 * Two design fields fully describe what is optimized and what is evaluated:
 *   • design.surfaceMode — which stack(s) the optimizer moves:
 *       front_only | back_only | both_independent | symmetric
 *   • design.mfEvalMode  — for a single-side mode, whether the merit function is
 *       scored against one surface ('side', semi-infinite substrate) or the
 *       whole filter ('total'). both_independent / symmetric are always total.
 *
 * This module exposes:
 *   • SurfaceModeControl — the ONE editable control, lives in the Design Editor:
 *       a Front / Back / Both dropdown, a "Symmetric" sub-checkbox (under Both),
 *       and an "Ignore other side" checkbox (disabled under Both).
 *   • EvalModeBadge      — read-only "Eval: FRONT/BACK/TOTAL" pill shown in every
 *       window whose result depends on the evaluation target.
 *   • OptimizeBadge      — read-only "Optimize: FRONT/BACK/BOTH" pill shown in the
 *       optimizer windows (Refinement / Needle / GE).
 *
 * The viewer/analysis windows no longer carry their own front/back/total toggle;
 * they read resolveEvalMode(design) (optimizer.js) so what you see, what specs
 * score, and what tolerances perturb can never disagree.
 *
 * Switching to `symmetric` regenerates the back stack as the mirror of the front
 * (front is stored air→substrate, back substrate→exit, so an identical coating on
 * both sides means back = reverse(front)). applySurfaceMode centralizes that.
 */

import { mirrorLayers, resolveEvalMode, makeConeSpec, coneIsActive } from '../utils/physics/optimizer.js';

const { createElement: h } = React;

// surfaceMode → display metadata (used by OptimizeBadge).
export const SURFACE_INFO = {
    front_only:       { label: 'FRONT',      color: '#1e88e5' },
    back_only:        { label: 'BACK',       color: '#e53935' },
    both_independent: { label: 'BOTH',       color: '#7e57c2' },
    symmetric:        { label: 'BOTH (sym)', color: '#00acc1' },
};

// resolveEvalMode() result → badge metadata.
const EVAL_INFO = {
    front: { label: 'FRONT', color: '#1e88e5' },
    back:  { label: 'BACK',  color: '#e53935' },
    total: { label: 'TOTAL', color: '#7e57c2' },
};

// surfaceMode → the Front/Back/Both dropdown value.
function surfaceToDropdown(sm) {
    if (sm === 'back_only') return 'back';
    if (sm === 'both_independent' || sm === 'symmetric') return 'both';
    return 'front';
}

/**
 * Apply a surfaceMode change with its correctness side-effects.
 * (Pure-ish: only calls updateDesign.)
 */
export function applySurfaceMode(design, updateDesign, m) {
    if (m === 'symmetric') {
        const front = design?.frontLayers || [];
        updateDesign({ surfaceMode: m, backLayers: mirrorLayers(front) });
    } else {
        updateDesign({ surfaceMode: m });
    }
}

// Shared pill style.
function pill(color, cursor) {
    return {
        padding: '1px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
        background: `${color}33`, color, border: `1px solid ${color}66`,
        borderRadius: 11, whiteSpace: 'nowrap', cursor: cursor || 'default',
    };
}

/**
 * Read-only "Eval: FRONT/BACK/TOTAL" badge — shown in every window that
 * evaluates a spectrum, scores a spec, or perturbs a tolerance.
 */
export function EvalModeBadge({ design, c, t, style }) {
    const mb = (t && t.modeBar) || {};
    const mode = resolveEvalMode(design);
    const info = EVAL_INFO[mode] || EVAL_INFO.total;
    const label = (mb.evalBadge && mb.evalBadge[mode]) || info.label;
    return h('span', {
        title: mb.evalBadgeTip
            || 'What the spectra, Specification and tolerances are scored against (set in the Design Editor: Surface + Ignore other side).',
        style: { ...pill(info.color, 'help'), ...(style || {}) },
    }, (mb.evalBadgeLabel || 'Eval') + ': ' + label);
}

/**
 * Read-only "Cone ±Θ°" badge — shown on viewers/optimizers when cone-angle
 * averaging is active, so the user always knows the displayed/
 * scored R/T/A is averaged over an illumination cone rather than collimated.
 * Renders nothing when no cone is active. amber = "non-default evaluation".
 */
export function ConeBadge({ design, c, t, style }) {
    const spec = makeConeSpec(design?.cone || {});
    if (!coneIsActive(spec)) return null;
    const cc = (t && t.designEditor && t.designEditor.cone) || {};
    const distLabel = cc[spec.distribution] || spec.distribution;
    const half = Math.round(spec.halfAngleDeg * 10) / 10;
    return h('span', {
        title: cc.enableTip
            || 'R/T/A is averaged over an illumination cone (convergent/divergent beam) instead of a single collimated ray. Edit in the Design Editor.',
        style: { ...pill('#ef9800', 'help'), ...(style || {}) },
    }, `${cc.badge || 'Cone'} ±${half}° · ${distLabel}`);
}

/**
 * Read-only "Optimize: FRONT/BACK/BOTH" badge — shown in optimizer windows.
 */
export function OptimizeBadge({ design, c, t, style }) {
    const mb = (t && t.modeBar) || {};
    const sm = design?.surfaceMode || 'front_only';
    const info = SURFACE_INFO[sm] || SURFACE_INFO.front_only;
    const label = (mb.optimizeBadge && mb.optimizeBadge[sm]) || info.label;
    return h('span', {
        title: mb.optimizeBadgeTip || 'Which coating the optimizer is moving (set in the Design Editor).',
        style: { ...pill(info.color, 'help'), ...(style || {}) },
    }, (mb.optimizeBadgeLabel || 'Optimize') + ': ' + label);
}

/**
 * The editable control — Design Editor only.
 *
 * @param {object}   props
 * @param {object}   props.design
 * @param {Function} props.updateDesign
 * @param {object}   props.c               theme colors
 * @param {object}   [props.t]             locale root (uses t.modeBar.* with fallbacks)
 * @param {Function} [props.onModeChange]  (primarySide:'front'|'back') => void, fired
 *                                         after a change so the DE can follow with its
 *                                         active-tab selection.
 * @param {object}   [props.style]
 */
export function SurfaceModeControl({ design, updateDesign, c, t, onModeChange, style }) {
    const mb = (t && t.modeBar) || {};
    const surfMode   = design?.surfaceMode || 'front_only';
    const mfEvalMode = design?.mfEvalMode  || 'side';
    const dd         = surfaceToDropdown(surfMode);
    const isBoth     = dd === 'both';
    const isSymmetric = surfMode === 'symmetric';
    const ignoreOther = mfEvalMode === 'side';

    const container = {
        display: 'inline-flex', alignItems: 'center', gap: 12,
        flexWrap: 'wrap', rowGap: 4,
        fontSize: 11, color: c.textDim,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        ...(style || {}),
    };

    const selStyle = {
        background: c.bg, color: c.text, border: `1px solid ${c.border}`,
        borderRadius: 3, fontSize: 11, height: 22, padding: '2px 6px',
        fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
        flexShrink: 0, minWidth: 72,
    };

    const surfOpt = (k) => (mb.surface && mb.surface[k])
        || { front_only: 'Front', back_only: 'Back', both: 'Both' }[k];

    const onSurface = (e) => {
        const v = e.target.value;
        if (v === 'front') { applySurfaceMode(design, updateDesign, 'front_only'); onModeChange && onModeChange('front'); }
        else if (v === 'back') { applySurfaceMode(design, updateDesign, 'back_only'); onModeChange && onModeChange('back'); }
        else {
            // Switching to Both keeps the existing symmetric flag if one was set,
            // otherwise defaults to independent.
            applySurfaceMode(design, updateDesign, isSymmetric ? 'symmetric' : 'both_independent');
            onModeChange && onModeChange('front');
        }
    };

    const onSymmetric = (e) => {
        applySurfaceMode(design, updateDesign, e.target.checked ? 'symmetric' : 'both_independent');
    };

    const onIgnore = (e) => {
        updateDesign({ mfEvalMode: e.target.checked ? 'side' : 'total' });
    };

    const checkboxLabel = (checked, onChange, disabled, text, tip) => h('label', {
        title: tip,
        style: {
            display: 'inline-flex', alignItems: 'center', gap: 5,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.45 : 1,
        },
    },
        h('input', { type: 'checkbox', checked, onChange, disabled, style: { cursor: disabled ? 'not-allowed' : 'pointer' } }),
        h('span', { style: { whiteSpace: 'nowrap' } }, text),
    );

    return h('div', { style: container },
        // Surface dropdown
        h('label', {
            style: { display: 'inline-flex', alignItems: 'center', gap: 5 },
            title: mb.surfaceTip
                || 'Which coating you are designing and the optimizer moves:\nFront — front coating; Back — back coating; Both — optimize both stacks against the full-system merit.',
        },
            h('span', { style: { whiteSpace: 'nowrap' } }, (mb.surfaceLabel || 'Surface') + ':'),
            h('select', { value: dd, onChange: onSurface, style: selStyle },
                h('option', { value: 'front' }, surfOpt('front_only')),
                h('option', { value: 'back'  }, surfOpt('back_only')),
                h('option', { value: 'both'  }, surfOpt('both')),
            ),
        ),
        // Symmetric sub-checkbox — only under Both
        isBoth && checkboxLabel(
            isSymmetric, onSymmetric, false,
            mb.symmetricLabel || 'Symmetric (back = front)',
            mb.symmetricTip || 'Back coating is an exact mirror of the front; both sides optimized together as one identical stack.',
        ),
        // Ignore-other-side checkbox — disabled (forced full-system) under Both
        checkboxLabel(
            isBoth ? false : ignoreOther, onIgnore, isBoth,
            mb.ignoreLabel || 'Ignore other side',
            mb.ignoreTip
                || 'Checked: evaluate this surface alone on a semi-infinite substrate (no back-surface reflection) — the merit function, Specification and all analysis windows score this one side.\nUnchecked: evaluate the full system (front + substrate + back).\nDisabled for "Both" (always full system).',
        ),
    );
}
