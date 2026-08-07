// Slide-in card reporting the result of an update check.
//
// Never modal and never focus-stealing: it sits in the bottom-right corner and
// the app stays fully usable behind it. Downloading and installing are manual,
// so the primary action opens the Releases page in the user's browser.
import { truncateNotes } from '../../utils/updateCheck.js';
import { Checkbox } from './Checkbox.js';

const { createElement: h, useState } = React;

const cardStyle = (c) => ({
  position: 'fixed', right: '18px', bottom: '18px', zIndex: 900,
  width: '340px', maxWidth: 'calc(100vw - 36px)',
  backgroundColor: c.panel, color: c.text,
  border: `1px solid ${c.border}`, borderRadius: '8px',
  boxShadow: '0 8px 28px rgba(0, 0, 0, 0.35)',
  padding: '14px 16px',
  fontFamily: 'system-ui, -apple-system, sans-serif',
});

const titleStyle = (c) => ({ fontSize: '13px', fontWeight: '700', color: c.text });
const bodyStyle = (c) => ({ fontSize: '12px', color: c.textDim, marginTop: '6px', lineHeight: 1.45 });

const primaryButton = (c) => ({
  padding: '7px 14px', backgroundColor: c.accent, color: c.accentText,
  border: 'none', borderRadius: '6px', cursor: 'pointer',
  fontSize: '12px', fontWeight: '600',
});

const plainButton = (c) => ({
  padding: '7px 12px', backgroundColor: 'transparent', color: c.text,
  border: `1px solid ${c.border}`, borderRadius: '6px', cursor: 'pointer',
  fontSize: '12px', fontWeight: '600',
});

const CloseButton = ({ c, onClose, label }) =>
  h('button', {
    onClick: onClose,
    title: label,
    'aria-label': label,
    style: {
      background: 'transparent', border: 'none', color: c.textDim,
      cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '0 2px',
    },
  }, '×');

const Header = ({ c, title, onClose, closeLabel }) =>
  h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '8px' } },
    h('div', { style: { ...titleStyle(c), flex: 1 } }, title),
    h(CloseButton, { c, onClose, label: closeLabel }));

function AvailableCard({ decision, onOpen, onSkip, onClose, c, t }) {
  const [skip, setSkip] = useState(false);
  const dismiss = () => {
    if (skip) onSkip(decision.latest);
    onClose();
  };
  return h('div', { style: cardStyle(c), role: 'status' },
    h(Header, { c, title: t.update.availableTitle, onClose: dismiss, closeLabel: t.update.close }),
    h('div', { style: bodyStyle(c) }, t.update.versions(decision.current, decision.latest)),
    decision.notes && h('div', {
      style: {
        ...bodyStyle(c), maxHeight: '96px', overflow: 'auto',
        whiteSpace: 'pre-wrap', borderLeft: `2px solid ${c.border}`, paddingLeft: '8px',
      },
    }, truncateNotes(decision.notes)),
    h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } },
      h('button', { onClick: onOpen, style: primaryButton(c) }, t.update.openReleases),
      h('button', { onClick: dismiss, style: plainButton(c) }, t.update.later)),
    h('label', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', cursor: 'pointer' },
    },
      h(Checkbox, { c, checked: skip, onChange: (e) => setSkip(e.target.checked) }),
      h('span', { style: { fontSize: '11px', color: c.textDim } }, t.update.ignoreVersion))
  );
}

function FailedCard({ decision, onRetry, onClose, c, t }) {
  return h('div', { style: cardStyle(c), role: 'status' },
    h(Header, { c, title: t.update.failedTitle, onClose, closeLabel: t.update.close }),
    h('div', { style: bodyStyle(c) }, t.update.failedReason(t.update.reasons[decision.reason] || decision.reason)),
    h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } },
      h('button', { onClick: onRetry, style: primaryButton(c) }, t.update.retry))
  );
}

function UpToDateCard({ decision, onClose, c, t }) {
  return h('div', { style: cardStyle(c), role: 'status' },
    h(Header, { c, title: t.update.upToDateTitle, onClose, closeLabel: t.update.close }),
    h('div', { style: bodyStyle(c) }, t.update.upToDateBody(decision.current))
  );
}

export function UpdateNotification({ decision, onOpen, onSkip, onRetry, onClose, c, t }) {
  if (!decision) return null;
  if (decision.state === 'available') return h(AvailableCard, { decision, onOpen, onSkip, onClose, c, t });
  if (decision.state === 'failed') return h(FailedCard, { decision, onRetry, onClose, c, t });
  if (decision.state === 'up-to-date') return h(UpToDateCard, { decision, onClose, c, t });
  return null;
}
