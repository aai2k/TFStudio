import { Checkbox } from '../../../ui/Checkbox.js';
import { STORE } from './store.js';

const { createElement: h } = React;

// Shared checkbox+label control used throughout the config panel; disabled
// while a benchmark run is in progress (in addition to any per-control `dis`).
export function chk(c, label, val, set, dis) {
    return h('label', {
        style: { display: 'inline-flex', alignItems: 'center', gap: 5, marginRight: 14, fontSize: 12, color: dis ? c.textDim : c.text, cursor: dis ? 'default' : 'pointer', opacity: dis ? 0.6 : 1 },
    }, h(Checkbox, { c, checked: val, disabled: dis || STORE.running, onChange: (e) => set(e.target.checked) }), label);
}
