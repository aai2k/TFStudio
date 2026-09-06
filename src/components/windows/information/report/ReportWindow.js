/**
 * Report window.
 *
 * A docked window on the analysis frame: the control row carries the template,
 * the designs covered, the paper, the language, the document fields and the
 * branding profile; the rail on the left lists the blocks; the page fills the
 * rest and follows the design as it is edited; the strip below holds Export.
 *
 * The numbers come from the same validated engines as the analysis windows
 * (utils/report/reportData.js). The document is one self-contained HTML string
 * (utils/report/template.js) saved as .html or printed to PDF in a headless
 * window with a running header and footer.
 */

import { AnalysisWindow, ControlRow } from '../../analysis/chrome/layout.js';
import { Divider, FieldLabel, ChoiceGroup, SelectField } from '../../analysis/chrome/controls.js';
import { availableLocales } from '../../../../constants/locales.js';
import { PAPERS } from '../../../../utils/report/template.js';
import { useReportWindow } from './useReportWindow.js';
import { BlockRail } from './BlockRail.js';
import { BlockSettingsPanel } from './BlockSettings.js';
import { AddBlockMenu } from './AddBlockMenu.js';
import { TemplateControl, DesignsControl, DocumentPanel, BrandingPanel } from './controlRowPanels.js';
import { Preview } from './Preview.js';
import { ExportBar } from './ExportBar.js';

const { createElement: h, useState } = React;

const PAPER_ITEMS = Object.keys(PAPERS).map(id => ({ id, label: id }));
const LANG_OPTIONS = availableLocales.map(l => ({ id: l.code, label: l.name }));

export function ReportWindow({ c, t }) {
    const W = t.report.window;
    const r = useReportWindow({ t });
    const [selectedId, setSelectedId] = useState(null);
    const [addOpen, setAddOpen] = useState(false);

    const selectedIndex = r.blocks.findIndex(b => b.id === selectedId);
    const selected = selectedIndex >= 0 ? r.blocks[selectedIndex] : null;
    const onCount = r.blocks.filter(b => b.on).length;

    return h(AnalysisWindow, { c },
        h(ControlRow, {
            c,
            trailing: [
                h(DocumentPanel, { key: 'doc', c, W, doc: r.doc, onChange: r.setDoc }),
                h(BrandingPanel, { key: 'brand', c, t, W, branding: r.branding }),
            ],
        },
            h(TemplateControl, {
                c, W, templateId: r.templateId, savedTemplates: r.savedTemplates,
                onApply: r.applyTemplate, onSave: r.saveAsTemplate, onDelete: r.removeTemplate,
            }),
            h(Divider, { c }),
            h(DesignsControl, {
                c, W, designs: r.designList, folders: r.folders, activeDesignId: r.activeDesignId,
                scope: r.scope, selectedIds: r.selectedIds,
                onUseCurrent: r.useCurrentDesign, onSelect: r.setDesignSelected,
            }),
            h(Divider, { c }),
            h(FieldLabel, { c }, W.paper),
            h(ChoiceGroup, { c, items: PAPER_ITEMS, activeId: r.paper, onSelect: r.setPaper }),
            h(FieldLabel, { c }, W.language),
            h(SelectField, { c, value: r.lang, options: LANG_OPTIONS, width: 96, onChange: r.setLang }),
        ),
        h('div', { style: { flex: 1, minHeight: 0, display: 'flex', position: 'relative' } },
            h(BlockRail, {
                c, W, blocks: r.blocks, selectedId, addOpen,
                onSelect: id => { setSelectedId(id); setAddOpen(false); },
                onToggle: r.toggleBlock, onReorder: r.reorderBlock,
                onToggleAdd: () => { setAddOpen(open => !open); setSelectedId(null); },
            }),
            h(Preview, { c, W, html: r.html, error: r.error, paper: r.paper }),
            selected && h(BlockSettingsPanel, {
                c, W, t, block: selected, index: selectedIndex, count: r.blocks.length, design: r.design,
                onChange: r.setBlockSettings, onMove: r.moveBlock, onRemove: r.removeBlock,
                onClose: () => setSelectedId(null),
            }),
            addOpen && h(AddBlockMenu, { c, W, design: r.design, onAdd: r.addBlock, onClose: () => setAddOpen(false) }),
        ),
        h(ExportBar, {
            c, W, summary: W.status(onCount, r.chosen.length), status: r.status, enabled: !!r.html && !r.error,
            onPdf: r.exportPdf, onHtml: r.exportHtml, onCopy: r.copyTables,
        }),
    );
}
