// Settings → Updates: the startup toggle plus an on-demand check.
//
// The result of an on-demand check is reported inline here rather than through
// the notification card. The Settings dialog sits above the card's stacking
// context, so a card raised from this button would be hidden behind the dialog.
import { Checkbox } from '../../ui/Checkbox.js';
import { useUpdate } from '../../ui/UpdateContext.js';
import { buttonStyle } from './ui.js';

const { createElement: h } = React;

// A check that did not complete reports its reason, never "up to date".
function resultText(decision, t) {
  if (!decision) return null;
  if (decision.state === 'available') return t.update.badgeAvailable(decision.latest);
  if (decision.state === 'up-to-date') return t.update.upToDateBody(decision.current);
  if (decision.state === 'failed') return t.update.reasons[decision.reason] || decision.reason;
  return null;
}

const hint = (c) => ({ display: 'block', fontSize: '12px', color: c.textDim, marginTop: '2px' });

const linkStyle = (c) => ({
  background: 'transparent', border: 'none', padding: 0,
  color: c.accent, cursor: 'pointer', fontSize: '12px', fontWeight: '600',
});

export const UpdateCheckRow = ({ updateCheckEnabled, setUpdateCheckEnabled, c, t }) => {
  const update = useUpdate();
  const checking = update?.status === 'checking';
  const result = checking ? t.settings.updateChecking : resultText(update?.decision, t);

  return h('div', null,
    h('label', { style: { display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' } },
      h(Checkbox, {
        c,
        checked: updateCheckEnabled !== false,
        onChange: (e) => setUpdateCheckEnabled && setUpdateCheckEnabled(e.target.checked),
        style: { marginTop: '2px' },
      }),
      h('span', { style: { fontSize: '13px', color: c.text } },
        h('span', { style: { fontWeight: '600' } }, t.settings.updateCheck),
        h('span', { style: hint(c) }, t.settings.updateCheckHint))
    ),
    update && h('div', {
      style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px', flexWrap: 'wrap' },
    },
      h('button', {
        onClick: update.checkQuiet,
        disabled: checking,
        style: { ...buttonStyle(c), opacity: checking ? 0.6 : 1, cursor: checking ? 'default' : 'pointer' },
      }, t.settings.updateCheckNow),
      result && h('span', { style: { fontSize: '12px', color: c.textDim }, role: 'status' }, result),
      update.decision?.state === 'available' && h('button', {
        onClick: update.openReleases,
        style: linkStyle(c),
      }, t.update.openReleases)
    )
  );
};
