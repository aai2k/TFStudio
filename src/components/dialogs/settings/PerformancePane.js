// Preferences → Performance: WASM transfer-matrix kernel toggle and update checks.
import { Checkbox } from '../../ui/Checkbox.js';
import { Row } from './ui.js';
import { UpdateCheckRow } from './UpdateCheckRow.js';

const { createElement: h } = React;

export const PerformancePane = ({ wasmTmm, setWasmTmm, updateCheckEnabled, setUpdateCheckEnabled, c, t }) =>
  h('div', null,
    h(Row, { c, label: t.settings.wasmAccel, hint: t.settings.wasmAccelHint },
      h(Checkbox, {
        c,
        checked: !!wasmTmm,
        onChange: (e) => setWasmTmm && setWasmTmm(e.target.checked),
      })
    ),
    h(UpdateCheckRow, { updateCheckEnabled, setUpdateCheckEnabled, c, t })
  );
