import { inputStyle, smallBtn } from './ui.js';

const { createElement: h } = React;

export function StepOutput({ g, c, W }) {
  const { format, setFormat, presets, presetName, setPresetName, savePreset, loadPreset } = g;

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 16 } },
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
}
