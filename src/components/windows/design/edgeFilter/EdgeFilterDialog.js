/**
 * Edge Filter dialog.
 *
 * Builds a non-polarizing edge filter from two materials: it searches the
 * five-layer period (aA bB cA bB aA) whose s and p zone edges meet at the edge
 * wavelength at the angle of incidence (src/utils/synthesis/edgeFilter.js),
 * lists the periods it finds best first, previews the finished filter, and
 * hands the period to the design the way Stack Formula does (Replace, Append,
 * New design) or to Stack Formula itself as a formula.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { getCurrentLocale } from '../../../../constants/locales/index.js';
import { HelpButton } from '../../../ui/HelpButton.js';
import { tablerIcon } from '../../../ui/tablerIcons.js';
import { Footer } from '../stackFormula/Footer.js';
import { useEdgeFilter } from './useEdgeFilter.js';
import { InputsPanel } from './InputsPanel.js';
import { ResultsPanel } from './ResultsPanel.js';

const { createElement: h } = React;

export const EDGE_FILTER_HELP = 'design/edge-filter';

// Wide enough for the periods table's eight columns beside the inputs, in
// every language (tests/edge_filter_window.mjs).
export const DIALOG_WIDTH = 920;

export function EdgeFilterDialog({ onClose, onCreateNew, onOpenStackFormula, folderName, hasActiveDesign, c, t }) {
    const { design, updateDesign, checkpoint } = useDesign();
    const state = useEdgeFilter({ design, updateDesign, checkpoint, onClose, onCreateNew, onOpenStackFormula, t });
    const ef = state.ef;

    return h('div', {
        style: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
                 display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }
    },
        h('div', {
            style: { backgroundColor: c.panel, borderRadius: 8, padding: 20,
                     width: DIALOG_WIDTH, maxWidth: '96vw', maxHeight: '94vh',
                     display: 'flex', flexDirection: 'column',
                     boxShadow: '0 10px 40px rgba(0,0,0,0.4)', border: `1px solid ${c.border}` }
        },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                       paddingBottom: 12, borderBottom: `1px solid ${c.border}`, marginBottom: 12 } },
                h('h2', { style: { margin: 0, fontSize: 16, fontWeight: 700, color: c.text } }, ef.title),
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                    h(HelpButton, { c, anchor: EDGE_FILTER_HELP, locale: getCurrentLocale(), size: 18, title: ef.help }),
                    h('button', { onClick: onClose, title: t.windowChrome.close,
                                  style: { background: 'transparent', color: c.textDim,
                                  border: 'none', cursor: 'pointer', padding: '0 6px',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center' } }, tablerIcon('x', 16)),
                ),
            ),

            h('div', { style: { flex: 1, overflowY: 'auto', display: 'flex', gap: 16, minHeight: 300 } },
                h(InputsPanel, { state, c, t, ef, design }),
                h(ResultsPanel, { state, c, ef, design, lambdaAxis: t.spectralAxis.lambdaShort }),
            ),

            h(Footer, { state, c, sf: t.stackFormula, folderName, hasActiveDesign, onClose }),
        )
    );
}
