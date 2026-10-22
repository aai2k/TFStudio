// Preferences → Automation: the switch that lets an AI agent that starts
// TFStudio with --mcp --live work on the designs open in the app, and whether
// the link it connects through is open.
import { Checkbox } from '../../ui/Checkbox.js';
import { Row, hintStyle } from './ui.js';

const { createElement: h } = React;

// The line under the switch while it is on: open, or why it could not open.
// Nothing while the app is still opening it.
function statusText(status, t) {
  if (status?.open) return t.settings.liveBridgeOn;
  return status?.error ? t.settings.liveBridgeFailed(status.error) : null;
}

export const AutomationPane = ({ liveBridge, setLiveBridge, liveBridgeStatus, c, t }) => {
  const status = liveBridge ? statusText(liveBridgeStatus, t) : null;
  return h('div', null,
    h(Row, { c, label: t.settings.liveBridge, hint: t.settings.liveBridgeHint },
      h(Checkbox, {
        c,
        checked: !!liveBridge,
        onChange: (e) => setLiveBridge && setLiveBridge(e.target.checked),
      }),
      status && h('span', { style: hintStyle(c), role: 'status' }, status)
    )
  );
};
