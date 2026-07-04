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

import { getLocale } from '../../constants/locales.js';
import { gatherDesignData } from '../../utils/report/reportData.js';
import { composeReport } from '../../utils/report/template.js';
import { REPORT_SECTIONS } from '../../utils/report/sections.js';

const { createElement: h, useState, useEffect, useMemo, useCallback, useRef } = React;

// ── Style atoms (mirror MonoWizard / FilterDesignWizard) ────────────────────
function inputStyle(c, w) {
  return { width: w, padding: '5px 7px', fontSize: 13, backgroundColor: c.bg, color: c.text,
           border: `1px solid ${c.border}`, borderRadius: 4, outline: 'none', boxSizing: 'border-box' };
}
function TextField({ label, value, onChange, c, width = '100%', placeholder }) {
  return h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim, flex: 1 } },
    label && h('span', null, label),
    h('input', { type: 'text', value: value || '', placeholder: placeholder || '',
      onChange: (e) => onChange(e.target.value), style: inputStyle(c, width) }));
}
function NumField({ label, value, min, max, step, onChange, c, width = 90, suffix }) {
  return h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim } },
    label && h('span', null, label),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 5 } },
      h('input', { type: 'number', value, min, max, step: step ?? 'any',
        onChange: (e) => { const v = parseFloat(e.target.value); onChange(Number.isNaN(v) ? 0 : v); },
        style: inputStyle(c, width) }),
      suffix && h('span', { style: { fontSize: 12, color: c.textDim } }, suffix)));
}
// Comma/space-separated AOI list → number[] (0..89, deduped). Empty → [0].
function parseAoiList(str, fallback = 0) {
  const xs = String(str || '').split(/[,\s]+/).map(s => parseFloat(s))
    .filter(v => Number.isFinite(v) && v >= 0 && v < 90)
    .map(v => Math.round(v * 10) / 10);
  const out = [...new Set(xs)];
  return out.length ? out : [fallback];
}
function AoiListField({ label, thetas, onChange, c, fallback = 0, width = 150 }) {
  const [raw, setRaw] = useState((thetas || []).join(', '));
  useEffect(() => { setRaw((thetas || []).join(', ')); }, [JSON.stringify(thetas)]);
  const commit = () => onChange(parseAoiList(raw, fallback));
  return h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim } },
    label && h('span', null, label),
    h('input', { type: 'text', value: raw, placeholder: 'e.g. 0, 30, 45',
      onChange: (e) => setRaw(e.target.value), onBlur: commit,
      onKeyDown: (e) => { if (e.key === 'Enter') commit(); }, style: inputStyle(c, width) }));
}
function Check({ checked, onChange, label, c }) {
  return h('label', { style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: c.text, cursor: 'pointer' } },
    h('input', { type: 'checkbox', checked: !!checked, onChange: (e) => onChange(e.target.checked),
      style: { accentColor: c.accent, cursor: 'pointer' } }), label);
}
function btn(c, primary) {
  return { padding: '8px 18px', fontSize: 13, fontWeight: primary ? 600 : 400,
           background: primary ? c.accent : c.bg, color: primary ? '#fff' : c.text,
           border: primary ? 'none' : `1px solid ${c.border}`, borderRadius: 4, cursor: 'pointer' };
}
function smallBtn(c, on) {
  return { padding: '3px 9px', fontSize: 12, cursor: 'pointer',
           border: `1px solid ${on ? c.accent : c.border}`, borderRadius: 3,
           background: on ? c.accent + '22' : c.bg, color: on ? c.accent : c.text };
}

function todayISO() {
  // Renderer context — Date is available (this is not a workflow script).
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ── Component ────────────────────────────────────────────────────────────────
export function ReportGenerator({ c, t, onClose, designs = {}, activeDesignId, folderName }) {
  const R = t.report || {};
  const W = R.wizard || {};

  const designList = useMemo(() => Object.values(designs || {}), [designs]);
  const [step, setStep] = useState(1);

  // Scope
  const [scope, setScope] = useState('current'); // 'current' | 'selected'
  const [selectedIds, setSelectedIds] = useState(
    () => new Set(activeDesignId ? [activeDesignId] : []));

  // Sections (ordered) — start from the catalogue order honoring defaultOn.
  const [sections, setSections] = useState(
    () => REPORT_SECTIONS.map(s => ({ id: s.id, on: s.defaultOn })));

  // Per-section options
  const [perSection, setPerSection] = useState(() => ({
    'design-summary': { optical: false, materialsTable: false },
    'optical-eval': { curves: ['T', 'R'], includeTable: false,
                      lambdaStart: 400, lambdaEnd: 800, lambdaStep: 2, thetas: [0] },
    'color-eval':   { characteristic: 'R', observer: '2', illuminant: 'D65', step: 5 },
    'integral-values': { aoi: 0, pol: 'avg' },
    'ri-profile':   { lambda: null },
    'efield':       { pol: 's', lambda: null },
    'ellipsometry': { thetas: [65], lambdaStart: 400, lambdaEnd: 800, lambdaStep: 5, quantity: 'both' },
    'notes':        {},
  }));
  const setOpt = useCallback((secId, patch) =>
    setPerSection(prev => ({ ...prev, [secId]: { ...(prev[secId] || {}), ...patch } })), []);

  // Cover + branding
  const [cover, setCover] = useState(() => ({
    title: '', subtitle: '', customer: '', project: folderName || '',
    designer: '', date: todayISO(), logoDataUrl: null,
  }));
  const setCoverField = (k, v) => setCover(prev => ({ ...prev, [k]: v }));

  // Language / format
  const [lang, setLang] = useState('en');
  const [format, setFormat] = useState('html');

  // Presets
  const [presets, setPresets] = useState([]);
  const [presetName, setPresetName] = useState('');

  // Preview / generation
  const [previewHtml, setPreviewHtml] = useState('');
  const [status, setStatus] = useState(null); // { kind:'ok'|'err'|'busy', msg }

  useEffect(() => { const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey); }, [onClose]);

  // Load presets list on mount.
  useEffect(() => { (async () => {
    try { const r = await window.electronAPI?.listReportPresets?.();
      if (r?.success) setPresets(r.presets || []); } catch (_) {} })(); }, []);

  // ── Derived: which designs to render ──────────────────────────────────────
  const chosenDesigns = useMemo(() => {
    if (scope === 'current') {
      const d = designs[activeDesignId];
      return d ? [d] : (designList[0] ? [designList[0]] : []);
    }
    return designList.filter(d => selectedIds.has(d.id));
  }, [scope, designs, activeDesignId, designList, selectedIds]);

  // The locale object whose t.report drives the OUTPUT document strings.
  const reportTr = useMemo(() => {
    const loc = getLocale(lang) || {};
    const rep = loc.report || {};
    return { ...rep, kinds: (loc.specification && loc.specification.kinds) || {} };
  }, [lang]);

  const orderedSectionIds = useMemo(() =>
    sections.filter(s => s.on).map(s => s.id), [sections]);

  // ── Build the report document ─────────────────────────────────────────────
  const buildHtml = useCallback(() => {
    const renderList = chosenDesigns.map(design => ({
      design,
      data: gatherDesignData(design, orderedSectionIds, perSection),
    }));
    return composeReport({
      lang, tr: reportTr,
      sections: orderedSectionIds, perSection,
      cover: { ...cover },
      designs: renderList,
      meta: { appName: 'TFStudio', generatedAt: cover.date || todayISO() },
    });
  }, [chosenDesigns, orderedSectionIds, perSection, lang, reportTr, cover]);

  // Live-refresh the preview when on the final step.
  useEffect(() => {
    if (step !== 6) return;
    try { setPreviewHtml(buildHtml()); setStatus(null); }
    catch (e) { setStatus({ kind: 'err', msg: e.message || String(e) }); }
  }, [step, buildHtml]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const toggleSection = (id) =>
    setSections(prev => prev.map(s => s.id === id ? { ...s, on: !s.on } : s));
  const moveSection = (idx, dir) => setSections(prev => {
    const next = [...prev]; const j = idx + dir;
    if (j < 0 || j >= next.length) return prev;
    [next[idx], next[j]] = [next[j], next[idx]];
    return next;
  });

  const loadLogo = async () => {
    try {
      const r = await window.electronAPI?.loadReportLogo?.();
      if (r?.success && r.dataUrl) setCoverField('logoDataUrl', r.dataUrl);
      else if (r && !r.canceled && r.error) setStatus({ kind: 'err', msg: r.error });
    } catch (e) { setStatus({ kind: 'err', msg: e.message }); }
  };

  const presetPayload = () => ({
    name: presetName.trim(),
    sections, perSection, lang, format,
    cover: { ...cover, logoDataUrl: undefined }, // logo not stored in preset
  });
  const savePreset = async () => {
    if (!presetName.trim()) { setStatus({ kind: 'err', msg: W.presetNameRequired || 'Enter a preset name' }); return; }
    try {
      const r = await window.electronAPI?.saveReportPreset?.(presetPayload());
      if (r?.success) {
        setStatus({ kind: 'ok', msg: W.presetSaved || 'Preset saved' });
        const list = await window.electronAPI?.listReportPresets?.();
        if (list?.success) setPresets(list.presets || []);
      } else setStatus({ kind: 'err', msg: r?.error || 'save failed' });
    } catch (e) { setStatus({ kind: 'err', msg: e.message }); }
  };
  const loadPreset = async (name) => {
    if (!name) return;
    try {
      const r = await window.electronAPI?.loadReportPreset?.(name);
      if (r?.success && r.preset) {
        const p = r.preset;
        if (Array.isArray(p.sections)) setSections(p.sections);
        if (p.perSection) setPerSection(p.perSection);
        if (p.lang) setLang(p.lang);
        if (p.format) setFormat(p.format);
        if (p.cover) setCover(prev => ({ ...prev, ...p.cover, logoDataUrl: prev.logoDataUrl }));
        setPresetName(p.name || name);
        setStatus({ kind: 'ok', msg: W.presetLoaded || 'Preset loaded' });
      }
    } catch (e) { setStatus({ kind: 'err', msg: e.message }); }
  };

  const generate = async () => {
    setStatus({ kind: 'busy', msg: W.generating || 'Generating…' });
    let html;
    try { html = buildHtml(); }
    catch (e) { setStatus({ kind: 'err', msg: e.message || String(e) }); return; }
    const base = (cover.title || chosenDesigns[0]?.name || 'TFStudio_Report')
      .replace(/[^\w\-]+/g, '_').slice(0, 60);
    try {
      if (format === 'pdf') {
        const r = await window.electronAPI?.exportReportPdf?.(html, base + '.pdf');
        if (r?.success) setStatus({ kind: 'ok', msg: (W.savedTo || 'Saved') + ': ' + r.path });
        else if (r?.canceled) setStatus(null);
        else setStatus({ kind: 'err', msg: r?.error || 'PDF export unavailable' });
      } else {
        const r = await window.electronAPI?.saveReportHtml?.(html, base + '.html');
        if (r?.success) setStatus({ kind: 'ok', msg: (W.savedTo || 'Saved') + ': ' + r.path });
        else if (r?.canceled) setStatus(null);
        else setStatus({ kind: 'err', msg: r?.error || 'HTML save unavailable' });
      }
    } catch (e) { setStatus({ kind: 'err', msg: e.message || String(e) }); }
  };

  // ── Step bodies ───────────────────────────────────────────────────────────
  const sectionTitleOf = (id) =>
    (reportTr.sectionTitles && reportTr.sectionTitles[id]) || (W.sectionNames && W.sectionNames[id]) || id;

  const stepScope = () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
    h('div', { style: { display: 'flex', gap: 16 } },
      h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: c.text } },
        h('input', { type: 'radio', checked: scope === 'current', onChange: () => setScope('current'), style: { accentColor: c.accent } }),
        W.scopeCurrent || 'Current design'),
      h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: c.text } },
        h('input', { type: 'radio', checked: scope === 'selected', onChange: () => setScope('selected'), style: { accentColor: c.accent } }),
        W.scopeSelected || 'Selected designs (comparison)')),
    scope === 'current'
      ? h('div', { style: { color: c.textDim, fontSize: 13 } },
          (W.currentIs || 'Report will cover') + ': ',
          h('strong', { style: { color: c.text } }, designs[activeDesignId]?.name || designList[0]?.name || '—'))
      : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto',
            border: `1px solid ${c.border}`, borderRadius: 4, padding: 10 } },
          designList.length === 0 && h('div', { style: { color: c.textDim } }, W.noDesigns || 'No designs available.'),
          designList.map(d => h(Check, { key: d.id, c,
            checked: selectedIds.has(d.id),
            onChange: (on) => setSelectedIds(prev => { const n = new Set(prev); on ? n.add(d.id) : n.delete(d.id); return n; }),
            label: d.name }))),
    // Cover fields (shared across scopes)
    h('div', { style: { borderTop: `1px solid ${c.border}`, paddingTop: 12, marginTop: 4 } },
      h('div', { style: { fontSize: 12, color: c.textDim, marginBottom: 8 } }, W.coverFields || 'Cover page'),
      h('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap' } },
        h(TextField, { c, label: W.title || 'Title', value: cover.title, onChange: v => setCoverField('title', v), placeholder: R.defaultTitle || 'Optical Coating Report' }),
        h(TextField, { c, label: W.customer || 'Customer', value: cover.customer, onChange: v => setCoverField('customer', v) })),
      h('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 } },
        h(TextField, { c, label: W.project || 'Project', value: cover.project, onChange: v => setCoverField('project', v) }),
        h(TextField, { c, label: W.designer || 'Designer', value: cover.designer, onChange: v => setCoverField('designer', v) }),
        h(TextField, { c, label: W.date || 'Date', value: cover.date, onChange: v => setCoverField('date', v), width: 130 })),
      h('div', { style: { display: 'flex', gap: 12, alignItems: 'center', marginTop: 10 } },
        h('button', { onClick: loadLogo, style: smallBtn(c, false) }, W.loadLogo || 'Load logo…'),
        cover.logoDataUrl && h('img', { src: cover.logoDataUrl, alt: '', style: { height: 32, border: `1px solid ${c.border}`, borderRadius: 3 } }),
        cover.logoDataUrl && h('button', { onClick: () => setCoverField('logoDataUrl', null), style: smallBtn(c, false) }, W.clearLogo || 'Clear'))));

  const stepSections = () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
    h('div', { style: { fontSize: 12, color: c.textDim, marginBottom: 6 } }, W.sectionsHint || 'Pick sections and order them (▲/▼).'),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 360, overflowY: 'auto' } },
      sections.map((s, idx) => h('div', { key: s.id,
        style: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px',
          border: `1px solid ${c.border}`, borderRadius: 4, background: c.bg } },
        h(Check, { c, checked: s.on, onChange: () => toggleSection(s.id), label: sectionTitleOf(s.id) }),
        h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 4 } },
          h('button', { onClick: () => moveSection(idx, -1), disabled: idx === 0,
            style: { ...smallBtn(c, false), opacity: idx === 0 ? 0.4 : 1 } }, '▲'),
          h('button', { onClick: () => moveSection(idx, 1), disabled: idx === sections.length - 1,
            style: { ...smallBtn(c, false), opacity: idx === sections.length - 1 ? 0.4 : 1 } }, '▼'))))));

  const optOf = (id) => perSection[id] || {};
  const blockStyle = { borderBottom: `1px solid ${c.border}`, paddingBottom: 12 };
  const blockHead = (id) => h('div', { style: { fontWeight: 600, color: c.text, marginBottom: 8 } }, sectionTitleOf(id));
  const stepOptions = () => {
    const dsOpt = optOf('design-summary');
    const oOpt = optOf('optical-eval');
    const cOpt = optOf('color-eval');
    const eOpt = optOf('ellipsometry');
    const riOpt = optOf('ri-profile');
    const efOpt = optOf('efield');
    const enabled = (id) => sections.find(s => s.id === id)?.on;
    const anyOpt = ['design-summary', 'optical-eval', 'color-eval', 'ellipsometry', 'ri-profile', 'efield', 'notes'].some(enabled);
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', maxHeight: 390, paddingRight: 4 } },
      // Design summary
      enabled('design-summary') && h('div', { style: blockStyle }, blockHead('design-summary'),
        h('div', { style: { display: 'flex', gap: 18, flexWrap: 'wrap' } },
          h(Check, { c, checked: dsOpt.optical, onChange: v => setOpt('design-summary', { optical: v }), label: W.opticalCols || 'Optical-thickness columns (n, OT, QWOT, FWOT)' }),
          h(Check, { c, checked: dsOpt.materialsTable, onChange: v => setOpt('design-summary', { materialsTable: v }), label: W.materialsTable || 'Tabulate materials (n, k @ λref)' }))),
      // Optical
      enabled('optical-eval') && h('div', { style: blockStyle }, blockHead('optical-eval'),
        h('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' } },
          h(NumField, { c, label: W.lambdaStart || 'λ start', value: oOpt.lambdaStart, min: 100, max: 20000, step: 10, suffix: 'nm', onChange: v => setOpt('optical-eval', { lambdaStart: v }) }),
          h(NumField, { c, label: W.lambdaEnd || 'λ end', value: oOpt.lambdaEnd, min: 100, max: 20000, step: 10, suffix: 'nm', onChange: v => setOpt('optical-eval', { lambdaEnd: v }) }),
          h(NumField, { c, label: W.lambdaStep || 'step', value: oOpt.lambdaStep, min: 0.5, max: 50, step: 0.5, suffix: 'nm', onChange: v => setOpt('optical-eval', { lambdaStep: v }) }),
          h(AoiListField, { c, label: W.aoiList || 'AOI list (°)', thetas: oOpt.thetas, onChange: t => setOpt('optical-eval', { thetas: t }) })),
        h('div', { style: { display: 'flex', gap: 10, marginTop: 10, alignItems: 'center' } },
          h('span', { style: { fontSize: 12, color: c.textDim } }, W.curves || 'Curves'),
          ['T', 'R', 'A'].map(k => h('button', { key: k,
            onClick: () => setOpt('optical-eval', { curves: (oOpt.curves || []).includes(k) ? oOpt.curves.filter(x => x !== k) : [...(oOpt.curves || []), k] }),
            style: smallBtn(c, (oOpt.curves || []).includes(k)) }, k)),
          h('div', { style: { marginLeft: 12 } }, h(Check, { c, checked: oOpt.includeTable, onChange: v => setOpt('optical-eval', { includeTable: v }), label: W.includeTable || 'Include data table' })))),
      // Color
      enabled('color-eval') && h('div', { style: blockStyle }, blockHead('color-eval'),
        h('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' } },
          h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim } },
            h('span', null, W.characteristic || 'Quantity'),
            h('select', { value: cOpt.characteristic, onChange: e => setOpt('color-eval', { characteristic: e.target.value }), style: inputStyle(c, 110) },
              h('option', { value: 'R' }, 'R'), h('option', { value: 'T' }, 'T'))),
          h(NumField, { c, label: W.aoi || 'AOI', value: cOpt.theta ?? 0, min: 0, max: 89, step: 1, suffix: '°', onChange: v => setOpt('color-eval', { theta: v }) }),
          h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim } },
            h('span', null, W.illuminant || 'Illuminant'),
            h('select', { value: cOpt.illuminant, onChange: e => setOpt('color-eval', { illuminant: e.target.value }), style: inputStyle(c, 110) },
              ['D65', 'D50', 'A', 'C', 'E'].map(i => h('option', { key: i, value: i }, i)))))),
      // Ellipsometry
      enabled('ellipsometry') && h('div', { style: blockStyle }, blockHead('ellipsometry'),
        h('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' } },
          h(NumField, { c, label: W.lambdaStart || 'λ start', value: eOpt.lambdaStart, min: 100, max: 20000, step: 10, suffix: 'nm', onChange: v => setOpt('ellipsometry', { lambdaStart: v }) }),
          h(NumField, { c, label: W.lambdaEnd || 'λ end', value: eOpt.lambdaEnd, min: 100, max: 20000, step: 10, suffix: 'nm', onChange: v => setOpt('ellipsometry', { lambdaEnd: v }) }),
          h(AoiListField, { c, label: W.aoiList || 'AOI list (°)', thetas: eOpt.thetas, fallback: 65, onChange: t => setOpt('ellipsometry', { thetas: t }) }),
          h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim } },
            h('span', null, W.quantity || 'Show'),
            h('select', { value: eOpt.quantity, onChange: e => setOpt('ellipsometry', { quantity: e.target.value }), style: inputStyle(c, 110) },
              h('option', { value: 'both' }, 'Ψ + Δ'), h('option', { value: 'psi' }, 'Ψ'), h('option', { value: 'delta' }, 'Δ'))))),
      // RI profile
      enabled('ri-profile') && h('div', { style: blockStyle }, blockHead('ri-profile'),
        h('div', { style: { display: 'flex', gap: 12, alignItems: 'flex-end' } },
          h(NumField, { c, label: W.lambda || 'λ (blank = λref)', value: riOpt.lambda ?? '', min: 100, max: 20000, step: 10, suffix: 'nm', onChange: v => setOpt('ri-profile', { lambda: v || null }) }))),
      // E-field
      enabled('efield') && h('div', { style: blockStyle }, blockHead('efield'),
        h('div', { style: { display: 'flex', gap: 12, alignItems: 'flex-end' } },
          h(NumField, { c, label: W.lambda || 'λ (blank = λref)', value: efOpt.lambda ?? '', min: 100, max: 20000, step: 10, suffix: 'nm', onChange: v => setOpt('efield', { lambda: v || null }) }),
          h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim } },
            h('span', null, W.pol || 'Polarization'),
            h('select', { value: efOpt.pol, onChange: e => setOpt('efield', { pol: e.target.value }), style: inputStyle(c, 90) },
              h('option', { value: 's' }, 's'), h('option', { value: 'p' }, 'p'))))),
      // Notes
      enabled('notes') && h('div', null, blockHead('notes'),
        h('textarea', { value: optOf('notes').text ?? '', placeholder: W.notesPlaceholder || 'Free-text notes / appendix (defaults to the design notes)',
          onChange: e => setOpt('notes', { text: e.target.value }),
          style: { ...inputStyle(c, '100%'), height: 90, resize: 'vertical', fontFamily: 'inherit' } })),
      !anyOpt && h('div', { style: { color: c.textDim, fontSize: 13 } }, W.noOptions || 'Selected sections need no extra options.'));
  };

  const stepLanguage = () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
    h('div', { style: { fontSize: 13, color: c.textDim } }, W.langHint || 'Language of the generated report (axis labels, headings, tables).'),
    h('div', { style: { display: 'flex', gap: 16 } },
      [['en', 'English'], ['ru', 'Русский']].map(([code, name]) =>
        h('label', { key: code, style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: c.text } },
          h('input', { type: 'radio', checked: lang === code, onChange: () => setLang(code), style: { accentColor: c.accent } }), name))));

  const stepOutput = () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
    h('div', { style: { display: 'flex', gap: 16 } },
      [['html', W.formatHtml || 'HTML (single self-contained file)'],
       ['pdf', W.formatPdf || 'PDF (print-quality)']].map(([code, name]) =>
        h('label', { key: code, style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: c.text } },
          h('input', { type: 'radio', checked: format === code, onChange: () => setFormat(code), style: { accentColor: c.accent } }), name))),
    // Presets
    h('div', { style: { borderTop: `1px solid ${c.border}`, paddingTop: 12 } },
      h('div', { style: { fontSize: 12, color: c.textDim, marginBottom: 8 } }, W.presets || 'Report presets'),
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
        h('select', { value: '', onChange: e => loadPreset(e.target.value), style: inputStyle(c, 200) },
          h('option', { value: '' }, W.loadPreset || 'Load preset…'),
          presets.map(p => h('option', { key: p.name, value: p.name }, p.name))),
        h('input', { type: 'text', value: presetName, placeholder: W.presetName || 'Preset name',
          onChange: e => setPresetName(e.target.value), style: inputStyle(c, 180) }),
        h('button', { onClick: savePreset, style: smallBtn(c, false) }, W.savePreset || 'Save preset'))));

  const stepPreview = () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 } },
    h('div', { style: { fontSize: 12, color: c.textDim } },
      `${chosenDesigns.length} ${W.designsWord || 'design(s)'} · ${orderedSectionIds.length} ${W.sectionsWord || 'section(s)'} · ${lang.toUpperCase()} · ${format.toUpperCase()}`),
    h('iframe', { title: 'preview', srcDoc: previewHtml,
      style: { flex: 1, minHeight: 260, width: '100%', border: `1px solid ${c.border}`, borderRadius: 4, background: '#fff' } }),
    status && h('div', { style: { fontSize: 12,
      color: status.kind === 'err' ? c.error : status.kind === 'ok' ? c.success : c.textDim } }, status.msg));

  const bodies = [stepScope, stepSections, stepOptions, stepLanguage, stepOutput, stepPreview];
  const titles = [W.s1 || 'Scope', W.s2 || 'Sections', W.s3 || 'Options', W.s4 || 'Language', W.s5 || 'Output', W.s6 || 'Preview & Generate'];

  return h('div', { style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 } },
    h('div', { style: { background: c.panel, borderRadius: 8, padding: 20, width: 900, maxWidth: '96vw', height: 660, maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.45)', border: `1px solid ${c.border}` } },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottom: `1px solid ${c.border}`, marginBottom: 12 } },
        h('div', { style: { fontSize: 13, color: c.textDim } }, `${R.windowTitle || 'Report Generator'} — ${step}/6 · ${titles[step - 1]}`),
        h('button', { onClick: onClose, style: { background: 'transparent', color: c.textDim, border: 'none', cursor: 'pointer', fontSize: 18 } }, '×')),
      h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }, bodies[step - 1]()),
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: `1px solid ${c.border}`, marginTop: 12 } },
        h('div', { style: { display: 'flex', gap: 6 } }, [1, 2, 3, 4, 5, 6].map(s =>
          h('div', { key: s, style: { width: 8, height: 8, borderRadius: '50%', background: s === step ? c.accent : s < step ? c.accent + '88' : c.border } }))),
        h('div', { style: { display: 'flex', gap: 8 } },
          h('button', { onClick: () => setStep(s => Math.max(1, s - 1)), disabled: step === 1,
            style: { ...btn(c, false), opacity: step === 1 ? 0.4 : 1, cursor: step === 1 ? 'default' : 'pointer' } }, W.back || 'Back'),
          step < 6 && h('button', { onClick: () => setStep(s => Math.min(6, s + 1)), style: btn(c, true) }, W.next || 'Next'),
          step === 6 && h('button', { onClick: generate, disabled: status?.kind === 'busy' || chosenDesigns.length === 0 || orderedSectionIds.length === 0,
            style: { ...btn(c, true), opacity: (chosenDesigns.length === 0 || orderedSectionIds.length === 0) ? 0.5 : 1 } }, W.generate || 'Generate'),
          h('button', { onClick: onClose, style: btn(c, false) }, W.cancel || 'Cancel')))));
}
