const { createElement: h } = React;

export function StepPreview({ g, c, W }) {
  const { chosenDesigns, orderedSectionIds, lang, format, previewHtml, status } = g;

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 } },
    h('div', { style: { fontSize: 12, color: c.textDim } },
      `${chosenDesigns.length} ${W.designsWord || 'design(s)'} · ${orderedSectionIds.length} ${W.sectionsWord || 'section(s)'} · ${lang.toUpperCase()} · ${format.toUpperCase()}`),
    h('iframe', { title: 'preview', srcDoc: previewHtml,
      style: { flex: 1, minHeight: 260, width: '100%', border: `1px solid ${c.border}`, borderRadius: 4, background: '#fff' } }),
    status && h('div', { style: { fontSize: 12,
      color: status.kind === 'err' ? c.error : status.kind === 'ok' ? c.success : c.textDim } }, status.msg));
}
