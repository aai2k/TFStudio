/**
 * Shared visual shell for the synthesis windows (Needle Variation, Gradual
 * Evolution, Structural Optimizer).
 *
 * All three present the same layout — a control bar, a material-pool + settings
 * sidebar, a merit-trend chart (upper 40 %), a history table (lower 60 %), and a
 * Pareto "top designs" panel at the bottom. Only the metrics readout, the
 * settings rows, and the underlying optimization engine differ between them.
 * This module owns the common frame; each window supplies its own slots
 * (metrics, settings rows, trend/table/top-designs elements) and drives its own
 * engine.
 */

import { OptimizeBadge, EvalModeBadge } from '../../../SurfaceModeBar.js';
import { MaterialPoolPanel, WARN_BADGE_STYLE } from './synthesisHelpers.js';
import { DebouncedInput } from '../../../ui/DebouncedInput.js';
import { Checkbox } from '../../../ui/Checkbox.js';
import { parseNumber } from '../../../../utils/misc/numberParsing.js';

const { createElement: h, useState } = React;

// Section header above the trend chart and the history table.
const sectionHeaderStyle = (c) => ({
    padding: '3px 8px', fontSize: 10, fontWeight: 700, color: c.textDim,
    textTransform: 'uppercase', letterSpacing: '0.05em',
    borderBottom: `1px solid ${c.border}`, flexShrink: 0,
});

// ── Control bar ─────────────────────────────────────────────────────────────
// Run/Stop/Reset/Best buttons + optimize/eval badges + a metrics readout + an
// optional status message. `metrics` is an array of readout children built by
// the window; `onResetSide` (when provided, in both_independent mode) adds the
// per-side ↺ Front / ↺ Back buttons.
export function SynthesisControlBar({
    running, canReset, onRun, onStop, onReset, onBest, onResetSide,
    design, labels, stopColor = '#ef5350', metrics, statusMsg, statusColor,
    noOperandsLabel, c, t,
}) {
    const btn = (label, color, onClick, disabled = false) =>
        h('button', {
            onClick, disabled,
            style: {
                padding: '3px 12px', fontSize: 12, border: 'none', borderRadius: 3,
                background: disabled ? c.border : color,
                color: disabled ? c.textDim : '#fff',
                cursor: disabled ? 'default' : 'pointer',
                fontWeight: 600, fontFamily: 'inherit', opacity: disabled ? 0.5 : 1,
            }
        }, label);
    const smallBtn = (label, onClick, disabled = false) =>
        h('button', {
            onClick, disabled,
            style: {
                padding: '2px 8px', fontSize: 11, borderRadius: 3,
                background: 'transparent', color: disabled ? c.textDim : c.text,
                border: `1px solid ${c.border}`,
                cursor: disabled ? 'default' : 'pointer',
                fontFamily: 'inherit', opacity: disabled ? 0.5 : 1,
            }
        }, label);

    const isBothInd = (design?.surfaceMode || 'front_only') === 'both_independent';

    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6,
            padding: '5px 8px', borderBottom: `1px solid ${c.border}`,
            background: c.panel, flexShrink: 0,
        }
    },
        running
            ? btn(`■ ${labels.stop}`, stopColor, onStop)
            : btn(`▶ ${labels.run}`,  c.success, onRun),
        btn(labels.reset, '#5c6bc0', onReset, !canReset),
        // Per-side resets in both_independent (Needle / GE): restore one side
        // from the saved snapshot, keep the other side's timeline untouched.
        onResetSide && isBothInd && smallBtn('↺ Front', () => onResetSide('front'), !canReset),
        onResetSide && isBothInd && smallBtn('↺ Back',  () => onResetSide('back'),  !canReset),
        btn(labels.best, '#0288d1', onBest, !canReset),
        // What's being optimized + what's evaluated (matches Refinement).
        h('span', { style: { marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 4 } },
            h(OptimizeBadge, { design, c, t }),
            h(EvalModeBadge, { design, c, t }),
        ),
        h('div', { style: { flex: 1 } }),
        h('span', { style: { fontSize: 11, color: c.textDim } }, ...metrics),
        statusMsg && h('span', {
            style: statusMsg === noOperandsLabel
                ? { ...WARN_BADGE_STYLE, marginLeft: 10 }
                : { fontSize: 11, marginLeft: 10, color: statusColor, fontStyle: 'italic' }
        }, statusMsg)
    );
}

// ── Sidebar frame ───────────────────────────────────────────────────────────
// Material-pool panel + a settings block with a collapsible Advanced section.
// `everyday` and `advanced` are arrays of already-built setting rows.
export function SynthesisSidebarFrame({ poolProps, settingsLabel, advancedLabel, everyday, advanced, c }) {
    const [advOpen, setAdvOpen] = useState(false);
    return h('div', {
        style: {
            width: 200, flexShrink: 0, borderRight: `1px solid ${c.border}`,
            display: 'flex', flexDirection: 'column', background: c.panel, overflow: 'hidden'
        }
    },
        h(MaterialPoolPanel, poolProps),
        h('div', { style: { padding: '6px 8px', flexShrink: 0, overflow: 'auto' } },
            h('div', {
                style: { fontSize: 10, fontWeight: 700, color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }
            }, settingsLabel),
            ...everyday,
            h('button', {
                onClick: () => setAdvOpen(o => !o),
                style: {
                    marginTop: 8, width: '100%', textAlign: 'left',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontSize: 10, fontWeight: 700, color: c.textDim,
                    textTransform: 'uppercase', letterSpacing: '0.05em', padding: 0,
                }
            }, `${advOpen ? '▾' : '▸'} ${advancedLabel}`),
            advOpen && h('div', { style: { marginTop: 6 } }, ...advanced)
        )
    );
}

// Setting-row helpers shared by the sidebars. `numWidth` is the numeric input
// width (unified at 58). A string 4th arg to numRow sets the row's tooltip.
export function makeRowHelpers({ c, running, numWidth = 58 }) {
    const numRow = (label, value, onChange, title) =>
        h('div', {
            title: typeof title === 'string' ? title : undefined,
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }
        },
            h('span', { style: { fontSize: 11, color: c.textDim } }, label),
            h(DebouncedInput, {
                value, disabled: running,
                // Commit on blur/Enter; free editing (incl. empty) meanwhile.
                onChange: (str) => onChange(parseNumber(str)),
                style: {
                    width: numWidth, padding: '1px 4px', fontSize: 11, textAlign: 'right',
                    background: c.bg, color: c.text,
                    border: `1px solid ${c.border}`, borderRadius: 2,
                    opacity: running ? 0.5 : 1,
                }
            })
        );

    // Stacked select row (label above, full-width select). Uncontrolled
    // (defaultValue) — reads the persisted value on mount, writes on change.
    const selRow = (label, getVal, setVal, options) =>
        h('div', { style: { marginBottom: 6 } },
            h('div', { style: { fontSize: 11, color: c.textDim, marginBottom: 2 } }, label),
            h('select', {
                defaultValue: getVal(), disabled: running,
                onChange: e => setVal(e.target.value),
                style: {
                    width: '100%', padding: '2px 4px', fontSize: 11,
                    background: c.bg, color: c.text,
                    border: `1px solid ${c.border}`, borderRadius: 2, opacity: running ? 0.5 : 1,
                }
            }, options.map(([v, lbl]) => h('option', { key: v, value: v }, lbl)))
        );

    // Uncontrolled checkbox row (defaultChecked).
    const chkRow = (label, getVal, setVal, title) =>
        h('label', {
            title,
            style: {
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
                cursor: running ? 'default' : 'pointer', fontSize: 11, color: c.text, userSelect: 'none',
            }
        },
            h(Checkbox, {
                c, defaultChecked: getVal(), disabled: running,
                onChange: e => setVal(e.target.checked),
            }),
            h('span', null, label));

    return { numRow, selRow, chkRow };
}

// ── Window layout ───────────────────────────────────────────────────────────
// Control bar on top, [sidebar | trend (40 %) + table (60 %)] in the middle,
// Pareto top-designs panel at the bottom.
export function SynthesisShell({ c, controlBar, sidebar, trend, table, topDesigns, trendLabel, tableLabel }) {
    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden',
        }
    },
        controlBar,
        h('div', { style: { flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 } },
            sidebar,
            h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
                // Merit-trend chart (upper 40%)
                h('div', {
                    style: {
                        flex: '0 0 40%', borderBottom: `1px solid ${c.border}`,
                        display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    }
                },
                    h('div', { style: sectionHeaderStyle(c) }, trendLabel),
                    h('div', { style: { flex: 1, overflow: 'hidden', position: 'relative' } }, trend)
                ),
                // History table (lower 60%)
                h('div', {
                    style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }
                },
                    h('div', { style: sectionHeaderStyle(c) }, tableLabel),
                    table
                )
            )
        ),
        topDesigns
    );
}
