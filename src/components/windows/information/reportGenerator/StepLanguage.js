const { createElement: h } = React;

export function StepLanguage({ g, c, W }) {
  const { lang, setLang } = g;

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
    h('div', { style: { fontSize: 13, color: c.textDim } }, W.langHint || 'Language of the generated report (axis labels, headings, tables).'),
    h('div', { style: { display: 'flex', gap: 16 } },
      [['en', 'English'], ['ru', 'Русский']].map(([code, name]) =>
        h('label', { key: code, style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: c.text } },
          h('input', { type: 'radio', checked: lang === code, onChange: () => setLang(code), style: { accentColor: c.accent } }), name))));
}
