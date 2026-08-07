// Settings → Performance: WASM transfer-matrix kernel toggle.
import { Checkbox } from '../../ui/Checkbox.js';
import { Section } from './ui.js';

const { createElement: h } = React;

export const PerformancePane = ({ wasmTmm, setWasmTmm, updateCheckEnabled, setUpdateCheckEnabled, c, t }) =>
  h('div', null,
    h(Section, { c, title: t.settings.performance },
      h('label', { style: { display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' } },
        h(Checkbox, {
          c,
          checked: !!wasmTmm,
          onChange: (e) => setWasmTmm && setWasmTmm(e.target.checked),
          style: { marginTop: '2px' },
        }),
        h('span', { style: { fontSize: '13px', color: c.text } },
          h('span', { style: { fontWeight: '600' } }, t.settings.wasmAccel),
          h('span', { style: { display: 'block', fontSize: '12px', color: c.textDim, marginTop: '2px' } },
            t.settings.wasmAccelHint)
        )
      )
    ),
    h(Section, { c, title: t.settings.updates },
      h('label', { style: { display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' } },
        h(Checkbox, {
          c,
          checked: updateCheckEnabled !== false,
          onChange: (e) => setUpdateCheckEnabled && setUpdateCheckEnabled(e.target.checked),
          style: { marginTop: '2px' },
        }),
        h('span', { style: { fontSize: '13px', color: c.text } },
          h('span', { style: { fontWeight: '600' } }, t.settings.updateCheck),
          h('span', { style: { display: 'block', fontSize: '12px', color: c.textDim, marginTop: '2px' } },
            t.settings.updateCheckHint)
        )
      )
    )
  );
