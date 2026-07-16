import { Check, NumField, AoiListField, inputStyle, smallBtn } from './ui.js';

const { createElement: h } = React;

function blockStyle(c) { return { borderBottom: `1px solid ${c.border}`, paddingBottom: 12 }; }
function blockHead(c, title) { return h('div', { style: { fontWeight: 600, color: c.text, marginBottom: 8 } }, title); }

export function DesignSummaryOptions({ c, W, title, opt, setOpt }) {
  return h('div', { style: blockStyle(c) }, blockHead(c, title),
    h('div', { style: { display: 'flex', gap: 18, flexWrap: 'wrap' } },
      h(Check, { c, checked: opt.optical, onChange: v => setOpt({ optical: v }), label: W.opticalCols || 'Optical-thickness columns (n, OT, QWOT, FWOT)' }),
      h(Check, { c, checked: opt.materialsTable, onChange: v => setOpt({ materialsTable: v }), label: W.materialsTable || 'Tabulate materials (n, k @ λref)' })));
}

export function OpticalEvalOptions({ c, W, title, opt, setOpt }) {
  return h('div', { style: blockStyle(c) }, blockHead(c, title),
    h('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' } },
      h(NumField, { c, label: W.lambdaStart || 'λ start', value: opt.lambdaStart, min: 100, max: 20000, step: 10, suffix: 'nm', onChange: v => setOpt({ lambdaStart: v }) }),
      h(NumField, { c, label: W.lambdaEnd || 'λ end', value: opt.lambdaEnd, min: 100, max: 20000, step: 10, suffix: 'nm', onChange: v => setOpt({ lambdaEnd: v }) }),
      h(NumField, { c, label: W.lambdaStep || 'step', value: opt.lambdaStep, min: 0.5, max: 50, step: 0.5, suffix: 'nm', onChange: v => setOpt({ lambdaStep: v }) }),
      h(AoiListField, { c, label: W.aoiList || 'AOI list (°)', thetas: opt.thetas, onChange: t => setOpt({ thetas: t }) })),
    h('div', { style: { display: 'flex', gap: 10, marginTop: 10, alignItems: 'center' } },
      h('span', { style: { fontSize: 12, color: c.textDim } }, W.curves || 'Curves'),
      ['T', 'R', 'A'].map(k => h('button', { key: k,
        onClick: () => setOpt({ curves: (opt.curves || []).includes(k) ? opt.curves.filter(x => x !== k) : [...(opt.curves || []), k] }),
        style: smallBtn(c, (opt.curves || []).includes(k)) }, k)),
      h('div', { style: { marginLeft: 12 } }, h(Check, { c, checked: opt.includeTable, onChange: v => setOpt({ includeTable: v }), label: W.includeTable || 'Include data table' }))));
}

export function ColorEvalOptions({ c, W, title, opt, setOpt }) {
  return h('div', { style: blockStyle(c) }, blockHead(c, title),
    h('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' } },
      h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim } },
        h('span', null, W.characteristic || 'Quantity'),
        h('select', { value: opt.characteristic, onChange: e => setOpt({ characteristic: e.target.value }), style: inputStyle(c, 110) },
          h('option', { value: 'R' }, 'R'), h('option', { value: 'T' }, 'T'))),
      h(NumField, { c, label: W.aoi || 'AOI', value: opt.theta ?? 0, min: 0, max: 89, step: 1, suffix: '°', onChange: v => setOpt({ theta: v }) }),
      h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim } },
        h('span', null, W.illuminant || 'Illuminant'),
        h('select', { value: opt.illuminant, onChange: e => setOpt({ illuminant: e.target.value }), style: inputStyle(c, 110) },
          ['D65', 'D50', 'A', 'C', 'E'].map(i => h('option', { key: i, value: i }, i))))));
}

export function EllipsometryOptions({ c, W, title, opt, setOpt }) {
  return h('div', { style: blockStyle(c) }, blockHead(c, title),
    h('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' } },
      h(NumField, { c, label: W.lambdaStart || 'λ start', value: opt.lambdaStart, min: 100, max: 20000, step: 10, suffix: 'nm', onChange: v => setOpt({ lambdaStart: v }) }),
      h(NumField, { c, label: W.lambdaEnd || 'λ end', value: opt.lambdaEnd, min: 100, max: 20000, step: 10, suffix: 'nm', onChange: v => setOpt({ lambdaEnd: v }) }),
      h(AoiListField, { c, label: W.aoiList || 'AOI list (°)', thetas: opt.thetas, fallback: 65, onChange: t => setOpt({ thetas: t }) }),
      h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim } },
        h('span', null, W.quantity || 'Show'),
        h('select', { value: opt.quantity, onChange: e => setOpt({ quantity: e.target.value }), style: inputStyle(c, 110) },
          h('option', { value: 'both' }, 'Ψ + Δ'), h('option', { value: 'psi' }, 'Ψ'), h('option', { value: 'delta' }, 'Δ')))));
}

export function RiProfileOptions({ c, W, title, opt, setOpt }) {
  return h('div', { style: blockStyle(c) }, blockHead(c, title),
    h('div', { style: { display: 'flex', gap: 12, alignItems: 'flex-end' } },
      h(NumField, { c, label: W.lambda || 'λ (blank = λref)', value: opt.lambda ?? '', min: 100, max: 20000, step: 10, suffix: 'nm', onChange: v => setOpt({ lambda: v || null }) })));
}

export function EfieldOptions({ c, W, title, opt, setOpt }) {
  return h('div', { style: blockStyle(c) }, blockHead(c, title),
    h('div', { style: { display: 'flex', gap: 12, alignItems: 'flex-end' } },
      h(NumField, { c, label: W.lambda || 'λ (blank = λref)', value: opt.lambda ?? '', min: 100, max: 20000, step: 10, suffix: 'nm', onChange: v => setOpt({ lambda: v || null }) }),
      h('label', { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: c.textDim } },
        h('span', null, W.pol || 'Polarization'),
        h('select', { value: opt.pol, onChange: e => setOpt({ pol: e.target.value }), style: inputStyle(c, 90) },
          h('option', { value: 's' }, 's'), h('option', { value: 'p' }, 'p')))));
}

export function NotesOptions({ c, W, title, opt, setOpt }) {
  return h('div', null, blockHead(c, title),
    h('textarea', { value: opt.text ?? '', placeholder: W.notesPlaceholder || 'Free-text notes / appendix (defaults to the design notes)',
      onChange: e => setOpt({ text: e.target.value }),
      style: { ...inputStyle(c, '100%'), height: 90, resize: 'vertical', fontFamily: 'inherit' } }));
}
