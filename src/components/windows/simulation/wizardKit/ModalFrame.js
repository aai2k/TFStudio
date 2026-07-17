/**
 * Shared modal shell for the deposition-monitoring wizards (BBM / Mono).
 *
 * Header (title + "page X of 6" + evaluation-mode badge), scrollable body, and
 * footer (Help / step dots / Back / Next-or-Finish / Cancel). The two wizards
 * differ only in their help anchor, passed as `helpAnchor`.
 */

import { getCurrentLocale } from '../../../../constants/locales.js';
import { EvalModeBadge }    from '../../../SurfaceModeBar.js';

const { createElement: h } = React;

export function ModalFrame({ c, B, step, setStep, onClose, body, design, t, helpAnchor }) {
    return h('div', { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 } },
        h('div', { style: { background: c.panel, borderRadius: 8, padding: 20, width: 880, maxWidth: '96vw', height: 640, maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.45)', border: `1px solid ${c.border}` } },
            // Header
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottom: `1px solid ${c.border}`, marginBottom: 12 } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                    h('div', { style: { fontSize: 13, color: c.textDim } }, `${B.title} — ${B.pageLabel(step)}`),
                    design && h(EvalModeBadge, { design, c, t })),
                h('button', { onClick: onClose, style: { background: 'transparent', color: c.textDim, border: 'none', cursor: 'pointer', fontSize: 18 } }, '×')),
            // Body
            h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } }, body),
            // Footer
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: `1px solid ${c.border}`, marginTop: 12 } },
                h('button', { onClick: () => window.electronAPI?.openHelp?.({ anchor: helpAnchor, locale: getCurrentLocale() }), title: B.help,
                    style: { padding: '8px 16px', fontSize: 13, background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 4, cursor: 'pointer' } }, B.help),
                h('div', { style: { display: 'flex', gap: 6 } }, [1, 2, 3, 4, 5, 6].map(s => h('div', { key: s, style: { width: 8, height: 8, borderRadius: '50%', background: s === step ? c.accent : s < step ? c.accent + '88' : c.border } }))),
                h('div', { style: { display: 'flex', gap: 8 } },
                    h('button', { onClick: () => setStep(s => Math.max(1, s - 1)), disabled: step === 1,
                        style: { padding: '8px 16px', fontSize: 13, background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 4, cursor: step === 1 ? 'default' : 'pointer', opacity: step === 1 ? 0.4 : 1 } }, B.back),
                    step < 6 && h('button', { onClick: () => setStep(s => Math.min(6, s + 1)),
                        style: { padding: '8px 20px', fontSize: 13, fontWeight: 600, background: c.accent, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' } }, B.next),
                    step === 6 && h('button', { onClick: onClose,
                        style: { padding: '8px 22px', fontSize: 13, fontWeight: 600, background: c.accent, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' } }, B.finish),
                    h('button', { onClick: onClose,
                        style: { padding: '8px 16px', fontSize: 13, background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 4, cursor: 'pointer' } }, B.cancel)))));
}
