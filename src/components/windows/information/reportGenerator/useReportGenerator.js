import {
  initialCover, initialPerSection, initialSections, resolveReportLocale,
  buildReportDocument, presetPayload, sectionTitleOf,
} from './model.js';

const { useCallback, useEffect, useMemo, useState } = React;

async function refreshPresetList(setPresets) {
  try {
    const r = await window.electronAPI?.listReportPresets?.();
    if (r?.success) setPresets(r.presets || []);
  } catch (_) {}
}

function toggleSectionIn(sections, id) {
  return sections.map(s => s.id === id ? { ...s, on: !s.on } : s);
}
function moveSectionIn(sections, idx, dir) {
  const next = [...sections]; const j = idx + dir;
  if (j < 0 || j >= next.length) return sections;
  [next[idx], next[j]] = [next[j], next[idx]];
  return next;
}

async function loadLogoAction({ setCoverField, setStatus }) {
  try {
    const r = await window.electronAPI?.loadReportLogo?.();
    if (r?.success && r.dataUrl) setCoverField('logoDataUrl', r.dataUrl);
    else if (r && !r.canceled && r.error) setStatus({ kind: 'err', msg: r.error });
  } catch (e) { setStatus({ kind: 'err', msg: e.message }); }
}

async function savePresetAction({ presetName, sections, perSection, lang, format, cover, W, setStatus, setPresets }) {
  if (!presetName.trim()) { setStatus({ kind: 'err', msg: W.presetNameRequired || 'Enter a preset name' }); return; }
  try {
    const r = await window.electronAPI?.saveReportPreset?.(
      presetPayload({ presetName, sections, perSection, lang, format, cover }));
    if (r?.success) {
      setStatus({ kind: 'ok', msg: W.presetSaved || 'Preset saved' });
      const list = await window.electronAPI?.listReportPresets?.();
      if (list?.success) setPresets(list.presets || []);
    } else setStatus({ kind: 'err', msg: r?.error || 'save failed' });
  } catch (e) { setStatus({ kind: 'err', msg: e.message }); }
}

async function loadPresetAction({ name, W, setters }) {
  if (!name) return;
  const { setSections, setPerSection, setLang, setFormat, setCover, setPresetName, setStatus } = setters;
  try {
    const r = await window.electronAPI?.loadReportPreset?.(name);
    if (!r?.success || !r.preset) return;
    const p = r.preset;
    if (Array.isArray(p.sections)) setSections(p.sections);
    if (p.perSection) setPerSection(p.perSection);
    if (p.lang) setLang(p.lang);
    if (p.format) setFormat(p.format);
    if (p.cover) setCover(prev => ({ ...prev, ...p.cover, logoDataUrl: prev.logoDataUrl }));
    setPresetName(p.name || name);
    setStatus({ kind: 'ok', msg: W.presetLoaded || 'Preset loaded' });
  } catch (e) { setStatus({ kind: 'err', msg: e.message }); }
}

async function saveReportOutput({ format, html, base, W, setStatus }) {
  const call = format === 'pdf' ? window.electronAPI?.exportReportPdf : window.electronAPI?.saveReportHtml;
  const suffix = format === 'pdf' ? '.pdf' : '.html';
  const failMsg = format === 'pdf' ? 'PDF export unavailable' : 'HTML save unavailable';
  const r = await call?.(html, base + suffix);
  if (r?.success) setStatus({ kind: 'ok', msg: (W.savedTo || 'Saved') + ': ' + r.path });
  else if (r?.canceled) setStatus(null);
  else setStatus({ kind: 'err', msg: r?.error || failMsg });
}

async function generateAction({ format, cover, chosenDesigns, buildHtml, W, setStatus }) {
  setStatus({ kind: 'busy', msg: W.generating || 'Generating…' });
  let html;
  try { html = buildHtml(); }
  catch (e) { setStatus({ kind: 'err', msg: e.message || String(e) }); return; }
  const base = (cover.title || chosenDesigns[0]?.name || 'TFStudio_Report')
    .replace(/[^\w\-]+/g, '_').slice(0, 60);
  try { await saveReportOutput({ format, html, base, W, setStatus }); }
  catch (e) { setStatus({ kind: 'err', msg: e.message || String(e) }); }
}

export function useReportGenerator({ designs, activeDesignId, folderName, W }) {
  const designList = useMemo(() => Object.values(designs || {}), [designs]);
  const [step, setStep] = useState(1);

  // Scope
  const [scope, setScope] = useState('current'); // 'current' | 'selected'
  const [selectedIds, setSelectedIds] = useState(
    () => new Set(activeDesignId ? [activeDesignId] : []));

  const [sections, setSections] = useState(initialSections);

  // Per-section options
  const [perSection, setPerSection] = useState(initialPerSection);
  const setOpt = useCallback((secId, patch) =>
    setPerSection(prev => ({ ...prev, [secId]: { ...(prev[secId] || {}), ...patch } })), []);

  // Cover + branding
  const [cover, setCover] = useState(() => initialCover(folderName));
  const setCoverField = useCallback((k, v) => setCover(prev => ({ ...prev, [k]: v })), []);

  // Language / format
  const [lang, setLang] = useState('en');
  const [format, setFormat] = useState('html');

  // Presets
  const [presets, setPresets] = useState([]);
  const [presetName, setPresetName] = useState('');

  // Preview / generation
  const [previewHtml, setPreviewHtml] = useState('');
  const [status, setStatus] = useState(null); // { kind:'ok'|'err'|'busy', msg }

  // Load presets list on mount.
  useEffect(() => { refreshPresetList(setPresets); }, []);

  // ── Derived: which designs to render ──────────────────────────────────────
  const chosenDesigns = useMemo(() => {
    if (scope === 'current') {
      const d = designs[activeDesignId];
      return d ? [d] : (designList[0] ? [designList[0]] : []);
    }
    return designList.filter(d => selectedIds.has(d.id));
  }, [scope, designs, activeDesignId, designList, selectedIds]);

  const reportTr = useMemo(() => resolveReportLocale(lang), [lang]);

  const orderedSectionIds = useMemo(() =>
    sections.filter(s => s.on).map(s => s.id), [sections]);

  const buildHtml = useCallback(() =>
    buildReportDocument({ chosenDesigns, orderedSectionIds, perSection, lang, reportTr, cover }),
    [chosenDesigns, orderedSectionIds, perSection, lang, reportTr, cover]);

  // Live-refresh the preview when on the final step.
  useEffect(() => {
    if (step !== 6) return;
    try { setPreviewHtml(buildHtml()); setStatus(null); }
    catch (e) { setStatus({ kind: 'err', msg: e.message || String(e) }); }
  }, [step, buildHtml]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const toggleSection = useCallback((id) =>
    setSections(prev => toggleSectionIn(prev, id)), []);
  const moveSection = useCallback((idx, dir) =>
    setSections(prev => moveSectionIn(prev, idx, dir)), []);

  const loadLogo = useCallback(() =>
    loadLogoAction({ setCoverField, setStatus }), [setCoverField]);

  const savePreset = useCallback(() => savePresetAction({
    presetName, sections, perSection, lang, format, cover, W, setStatus, setPresets,
  }), [presetName, sections, perSection, lang, format, cover, W]);

  const loadPreset = useCallback((name) => loadPresetAction({
    name, W, setters: { setSections, setPerSection, setLang, setFormat, setCover, setPresetName, setStatus },
  }), [W]);

  const generate = useCallback(() => generateAction({
    format, cover, chosenDesigns, buildHtml, W, setStatus,
  }), [format, cover, chosenDesigns, buildHtml, W]);

  const boundSectionTitleOf = useCallback((id) => sectionTitleOf(id, reportTr, W), [reportTr, W]);

  return {
    step, setStep,
    designs, activeDesignId, designList,
    scope, setScope, selectedIds, setSelectedIds,
    sections, perSection, setOpt,
    cover, setCoverField, loadLogo,
    lang, setLang, format, setFormat,
    presets, presetName, setPresetName, savePreset, loadPreset,
    previewHtml, status,
    chosenDesigns, orderedSectionIds,
    toggleSection, moveSection,
    generate,
    sectionTitleOf: boundSectionTitleOf,
  };
}
