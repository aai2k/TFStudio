/**
 * Report Generator — 6-step report wizard.
 *
 *   Step 1  Scope        — current design or a multi-design comparison set
 *   Step 2  Sections     — multi-select + reorder (▲/▼)
 *   Step 3  Options      — per-section λ range / AOI / pol / data tables / color
 *   Step 4  Language     — EN / RU (drives t.report.* in the OUTPUT document)
 *   Step 5  Output       — self-contained HTML or print-to-PDF
 *   Step 6  Preview + Generate
 *
 * The numbers come from the same validated engines as the analysis windows
 * (see utils/report/reportData.js). The document is composed as a single
 * self-contained HTML string (utils/report/template.js) with inline-SVG plots,
 * then either saved as .html or rendered to PDF in a headless window
 * (main.js `report:export-pdf`). Cover fields + the section layout can be saved
 * as a preset (Documents\TFStudio\ReportPresets\).
 */

import { useReportGenerator } from './useReportGenerator.js';
import { StepScope } from './StepScope.js';
import { StepSections } from './StepSections.js';
import { StepOptions } from './StepOptions.js';
import { StepLanguage } from './StepLanguage.js';
import { StepOutput } from './StepOutput.js';
import { StepPreview } from './StepPreview.js';
import { btn } from './ui.js';

const { createElement: h, useEffect } = React;

const STEPS = [StepScope, StepSections, StepOptions, StepLanguage, StepOutput, StepPreview];

export function ReportGenerator({ c, t, onClose, designs = {}, activeDesignId, folderName }) {
  const R = t.report || {};
  const W = R.wizard || {};
  const g = useReportGenerator({ designs, activeDesignId, folderName, W });

  useEffect(() => { const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey); }, [onClose]);

  const titles = [W.s1 || 'Scope', W.s2 || 'Sections', W.s3 || 'Options', W.s4 || 'Language', W.s5 || 'Output', W.s6 || 'Preview & Generate'];
  const Body = STEPS[g.step - 1];

  return h('div', { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 } },
    h('div', { style: { background: c.panel, borderRadius: 8, padding: 20, width: 900, maxWidth: '96vw', height: 660, maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.45)', border: `1px solid ${c.border}` } },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottom: `1px solid ${c.border}`, marginBottom: 12 } },
        h('div', { style: { fontSize: 13, color: c.textDim } }, `${R.windowTitle || 'Report Generator'} — ${g.step}/6 · ${titles[g.step - 1]}`),
        h('button', { onClick: onClose, style: { background: 'transparent', color: c.textDim, border: 'none', cursor: 'pointer', fontSize: 18 } }, '×')),
      h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }, h(Body, { g, c, R, W })),
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: `1px solid ${c.border}`, marginTop: 12 } },
        h('div', { style: { display: 'flex', gap: 6 } }, [1, 2, 3, 4, 5, 6].map(s =>
          h('div', { key: s, style: { width: 8, height: 8, borderRadius: '50%', background: s === g.step ? c.accent : s < g.step ? c.accent + '88' : c.border } }))),
        h('div', { style: { display: 'flex', gap: 8 } },
          h('button', { onClick: () => g.setStep(s => Math.max(1, s - 1)), disabled: g.step === 1,
            style: { ...btn(c, false), opacity: g.step === 1 ? 0.4 : 1, cursor: g.step === 1 ? 'default' : 'pointer' } }, W.back || 'Back'),
          g.step < 6 && h('button', { onClick: () => g.setStep(s => Math.min(6, s + 1)), style: btn(c, true) }, W.next || 'Next'),
          g.step === 6 && h('button', { onClick: g.generate, disabled: g.status?.kind === 'busy' || g.chosenDesigns.length === 0 || g.orderedSectionIds.length === 0,
            style: { ...btn(c, true), opacity: (g.chosenDesigns.length === 0 || g.orderedSectionIds.length === 0) ? 0.5 : 1 } }, W.generate || 'Generate'),
          h('button', { onClick: onClose, style: btn(c, false) }, W.cancel || 'Cancel')))));
}
