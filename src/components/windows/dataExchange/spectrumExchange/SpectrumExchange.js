/**
 * Imports measured spectra as design overlays and exports measured or computed
 * spectra as CSV or JCAMP-DX.
 */

import { TabBtn } from './controls.js';
import { ExportTab } from './ExportTab.js';
import { ImportTab } from './ImportTab.js';
import { makeLayoutStyles } from './styles.js';
import { useSpectrumExchange } from './useSpectrumExchange.js';

const { createElement: h } = React;

export function SpectrumExchange({ c, t }) {
    const sx = t.spectrumExchange;
    const controller = useSpectrumExchange(sx);
    const { wrap, section, rowFlex } = makeLayoutStyles(c);
    const tabProps = { controller, c, sx, section, rowFlex };

    return h('div', { style: wrap },
        h('div', { style: { display: 'flex', borderBottom: `1px solid ${c.border}`, background: c.panel } },
            h(TabBtn, { active: controller.tab === 'import', onClick: () => controller.setTab('import'), c }, sx.tabImport),
            h(TabBtn, { active: controller.tab === 'export', onClick: () => controller.setTab('export'), c }, sx.tabExport),
        ),
        controller.status && h('div', {
            style: {
                padding: '6px 14px', fontSize: 11.5,
                color: controller.status.type === 'error' ? c.error : controller.status.type === 'success' ? c.success : c.textDim,
                background: c.panel, borderBottom: `1px solid ${c.border}`,
            },
        }, controller.status.msg),
        h('div', { style: { flex: 1, overflow: 'auto' } },
            controller.tab === 'import'
                ? h(ImportTab, tabProps)
                : h(ExportTab, tabProps),
        ),
    );
}
