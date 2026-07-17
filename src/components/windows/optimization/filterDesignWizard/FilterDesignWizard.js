/**
 * Filter Design Wizard — six-step narrow band-pass / WDM designer.
 *
 * Reworked from the old WDM wizard onto the new engine (`filterDesign.js` +
 * `filterDesignBuild.js`), with the pipeline:
 *   1 Materials    — H/L (+optional substrate/incident), oblique incidence
 *   2 Parameters   — λ₀, Δλ@89.13 %, Δλ@0.1 %, shape factor + prototype plot
 *   3 Cavities     — recommended count (Chebyshev) + override
 *   4 Prototype    — (m,k) equivalent family table + embedded preview
 *   5 Integer Search — Global Integer Search (Web Worker) + candidate list
 *   6 Adjust       — No-AR / 1-layer / 2-layer "V" coat + air preview → Finish
 *
 * The first five steps design in the EMBEDDED case (incident index = substrate
 * index); step 6 introduces the real incident medium with an AR coating. This
 * is what makes the generated design near-final immediately.
 *
 * Reference: example LEC25D9-1.
 */

import { getCurrentLocale } from '../../../../constants/locales.js';
import { useFilterDesign } from './useFilterDesign.js';
import { StepMaterials } from './StepMaterials.js';
import { StepParams } from './StepParams.js';
import { StepCavities } from './StepCavities.js';
import { StepPrototype } from './StepPrototype.js';
import { StepSearch } from './StepSearch.js';
import { StepAdjust } from './StepAdjust.js';

const { createElement: h } = React;

const STEPS = [StepMaterials, StepParams, StepCavities, StepPrototype, StepSearch, StepAdjust];

// ── Wizard shell ──────────────────────────────────────────────────────────────
export function FilterDesignWizard({ onClose, onGenerate, folderName, c, t }) {
    const T = t.filterDesign;
    const { p, set, step, canFinish, nextDisabled, finish, back, next } = useFilterDesign({ onClose, onGenerate, folderName, t });

    const Step = STEPS[step - 1];
    const body = h(Step, { p, set, c, t });

    return h('div', { style: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 } },
        h('div', { style: { backgroundColor: c.panel, borderRadius: 8, padding: 22, width: 860, maxWidth: '96vw', maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.4)', border: `1px solid ${c.border}` } },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottom: `1px solid ${c.border}`, marginBottom: 12 } },
                h('h2', { style: { margin: 0, fontSize: 17, fontWeight: 700, color: c.text } }, T.title),
                h('button', { onClick: onClose, style: { background: 'transparent', color: c.textDim, border: 'none', cursor: 'pointer', fontSize: 18 } }, '×')),
            h('div', { style: { flex: 1, overflowY: 'auto', minHeight: 400 } }, body),
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: `1px solid ${c.border}`, marginTop: 12 } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
                    h('button', { onClick: () => window.electronAPI?.openHelp?.({ anchor: 'synthesis/wdm-wizard', locale: getCurrentLocale() }), title: T.help,
                        style: { padding: '8px 16px', fontSize: 13, backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 4, cursor: 'pointer' } }, T.help),
                    h('div', { style: { display: 'flex', gap: 6 } }, [1, 2, 3, 4, 5, 6].map(s => h('div', { key: s, style: { width: 8, height: 8, borderRadius: '50%', backgroundColor: s === step ? c.accent : s < step ? c.accent + '88' : c.border } })))),
                !folderName && h('span', { style: { fontSize: 11, color: c.warning || '#ef9800' } }, T.noFolder),
                h('div', { style: { display: 'flex', gap: 8 } },
                    h('button', { onClick: back, disabled: step === 1, style: { padding: '8px 16px', fontSize: 13, backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 4, cursor: step === 1 ? 'default' : 'pointer', opacity: step === 1 ? 0.4 : 1 } }, T.back),
                    step < 6 && h('button', { onClick: next, disabled: nextDisabled, style: { padding: '8px 20px', fontSize: 13, fontWeight: 600, backgroundColor: nextDisabled ? c.border : c.accent, color: '#fff', border: 'none', borderRadius: 4, cursor: nextDisabled ? 'not-allowed' : 'pointer' } }, T.next),
                    step === 6 && h('button', { onClick: finish, disabled: !canFinish, style: { padding: '8px 22px', fontSize: 13, fontWeight: 600, backgroundColor: canFinish ? c.accent : c.border, color: '#fff', border: 'none', borderRadius: 4, cursor: canFinish ? 'pointer' : 'not-allowed' } }, T.finish)))));
}
