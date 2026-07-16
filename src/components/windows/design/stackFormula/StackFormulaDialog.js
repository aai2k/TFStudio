/**
 * Stack Formula dialog.
 *
 * Type a compact symbolic coating description (a design formula)
 * and generate a layer stack. See `src/utils/synthesis/stackFormula.js` for
 * the grammar and semantics (QWOT-multiplier coefficients, (…)^n groups,
 * single-char adjacency, media sides).
 *
 * Apply modes:
 *   • Replace — overwrite the active design's front stack (+ media if the
 *     formula specifies them); one undo checkpoint.
 *   • Append  — add the generated layers to the end of the active front stack.
 *   • New     — create a brand-new design from the formula.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { useStackFormula } from './useStackFormula.js';
import { FormulaPanel } from './FormulaPanel.js';
import { ResultsPanel } from './ResultsPanel.js';
import { Footer } from './Footer.js';

const { createElement: h } = React;

export function StackFormulaDialog({ onClose, onCreateNew, folderName, hasActiveDesign, c, t }) {
    const { design, updateDesign, checkpoint } = useDesign();
    const state = useStackFormula({ design, updateDesign, checkpoint, onClose, onCreateNew, t });
    const sf = state.sf;

    return h('div', {
        style: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
                 display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }
    },
        h('div', {
            style: { backgroundColor: c.panel, borderRadius: 8, padding: 20,
                     width: 860, maxWidth: '96vw', maxHeight: '94vh',
                     display: 'flex', flexDirection: 'column',
                     boxShadow: '0 10px 40px rgba(0,0,0,0.4)', border: `1px solid ${c.border}` }
        },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                       paddingBottom: 12, borderBottom: `1px solid ${c.border}`, marginBottom: 12 } },
                h('h2', { style: { margin: 0, fontSize: 16, fontWeight: 700, color: c.text } }, sf.title),
                h('button', { onClick: onClose, style: { background: 'transparent', color: c.textDim,
                              border: 'none', cursor: 'pointer', fontSize: 18, padding: '0 6px' } }, '×'),
            ),

            h('div', { style: { flex: 1, overflowY: 'auto', display: 'flex', gap: 16, minHeight: 300 } },
                h(FormulaPanel, { state, c, t, sf }),
                h(ResultsPanel, { state, c, sf }),
            ),

            h(Footer, { state, c, sf, folderName, hasActiveDesign, onClose }),
        )
    );
}
