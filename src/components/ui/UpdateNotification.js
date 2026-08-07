// Compact, non-modal update status card.
import { releaseHighlights } from '../../utils/updateCheck.js';
import { Checkbox } from './Checkbox.js';

const { createElement: h, useState } = React;

const cardStyle = (c) => ({
  position: 'fixed', right: '18px', bottom: '18px', zIndex: 900,
  width: '380px', maxWidth: 'calc(100vw - 36px)',
  backgroundColor: c.panel, color: c.text,
  border: `1px solid ${c.borderStrong || c.border}`, borderRadius: '8px',
  boxShadow: '0 16px 44px rgba(0, 0, 0, 0.34)',
  overflow: 'hidden', fontFamily: 'system-ui, -apple-system, sans-serif',
});

const contentStyle = { padding: '17px 18px 15px' };

const closeStyle = (c) => ({
  width: '18px', height: '18px', flexShrink: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  margin: '0', padding: 0,
  backgroundColor: 'transparent', color: c.textDim,
  border: 'none', borderRadius: 0, cursor: 'pointer', opacity: 0.72,
});

const buttonStyle = (c, primary) => ({
  height: '34px', padding: '0 14px',
  backgroundColor: primary ? c.accent : c.field,
  color: primary ? c.accentText : c.text,
  border: primary ? '1px solid transparent' : `1px solid ${c.border}`,
  borderRadius: '5px', cursor: 'pointer',
  fontSize: '12px', fontWeight: '600',
});

const CloseButton = ({ c, onClose, label }) =>
  h('button', {
    onClick: onClose,
    title: label,
    'aria-label': label,
    style: closeStyle(c),
    onMouseEnter: (e) => { e.currentTarget.style.color = c.text; e.currentTarget.style.opacity = 1; },
    onMouseLeave: (e) => { e.currentTarget.style.color = c.textDim; e.currentTarget.style.opacity = 0.72; },
  }, h('svg', { width: 10, height: 10, viewBox: '0 0 10 10', fill: 'none' },
    h('path', {
      d: 'M1.5 1.5l7 7m0-7l-7 7', stroke: 'currentColor',
      strokeWidth: 1.2, strokeLinecap: 'square',
    })));

const DownloadIcon = ({ c }) =>
  h('div', {
    style: {
      width: '34px', height: '34px', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: c.accent, backgroundColor: c.selected,
      border: `1px solid ${c.border}`, borderRadius: '5px',
    },
  }, h('svg', { width: 17, height: 17, viewBox: '0 0 18 18', fill: 'none' },
    h('path', {
      d: 'M9 3v8m0 0L5.75 7.75M9 11l3.25-3.25M4 14.5h10',
      stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
    })));

const StatusIcon = ({ c, kind }) => {
  const failed = kind === 'failed';
  return h('div', {
    style: {
      width: '30px', height: '30px', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: failed ? c.warning : c.success,
      border: `1px solid ${c.border}`, borderRadius: '4px',
      fontSize: '15px', fontWeight: '700',
    },
  }, failed ? '!' : '✓');
};

function Header({ c, icon, title, subtitle, onClose, closeLabel }) {
  return h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '11px' } },
    icon,
    h('div', { style: { flex: 1, minWidth: 0, paddingTop: '1px' } },
      h('div', { style: { fontSize: '14px', fontWeight: '700', lineHeight: 1.3, color: c.text } }, title),
      subtitle && h('div', { style: { marginTop: '3px', fontSize: '11px', lineHeight: 1.4, color: c.textDim } }, subtitle)),
    h(CloseButton, { c, onClose, label: closeLabel }));
}

function VersionFlow({ current, latest, c }) {
  const chip = (active) => ({
    padding: '4px 8px', borderRadius: '4px',
    backgroundColor: active ? c.selected : c.field,
    color: active ? c.accent : c.textDim,
    border: `1px solid ${active ? c.accent : c.border}`,
    fontSize: '11px', fontWeight: '650', fontVariantNumeric: 'tabular-nums',
  });
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: '7px', marginTop: '13px' } },
    h('span', { style: chip(false) }, current),
    h('svg', { width: 14, height: 10, viewBox: '0 0 14 10', fill: 'none', style: { color: c.textDim } },
      h('path', {
        d: 'M1 5h11m-3-3 3 3-3 3', stroke: 'currentColor', strokeWidth: 1.2,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      })),
    h('span', { style: chip(true) }, latest));
}

function Highlights({ notes, c }) {
  const items = releaseHighlights(notes);
  if (items.length === 0) return null;
  return h('div', {
    style: {
      marginTop: '13px', padding: '10px 11px',
      backgroundColor: c.bg, border: `1px solid ${c.border}`, borderRadius: '5px',
    },
  }, items.map((item, index) =>
    h('div', {
      key: index,
      style: {
        display: 'grid', gridTemplateColumns: '5px 1fr', gap: '8px',
        alignItems: 'start', marginTop: index ? '7px' : 0,
        color: c.textDim, fontSize: '11px', lineHeight: 1.42,
      },
    },
      h('span', {
        style: { width: '4px', height: '4px', marginTop: '6px', borderRadius: '50%', backgroundColor: c.accent },
      }),
      h('span', null, item))));
}

function ActionButton({ c, primary = false, onClick, children }) {
  return h('button', {
    onClick, style: buttonStyle(c, primary),
    onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = primary ? c.accentHover : c.hover; },
    onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = primary ? c.accent : c.field; },
  }, children);
}

function AvailableCard({ decision, onOpen, onSkip, onClose, c, t }) {
  const [skip, setSkip] = useState(false);
  const dismiss = () => {
    if (skip) onSkip(decision.latest);
    onClose();
  };
  return h('div', { style: cardStyle(c), role: 'status' },
    h('div', { style: { height: '3px', backgroundColor: c.accent } }),
    h('div', { style: contentStyle },
      h(Header, {
        c, icon: h(DownloadIcon, { c }),
        title: t.update.badgeAvailable(decision.latest),
        onClose: dismiss, closeLabel: t.update.close,
      }),
      h(VersionFlow, { current: decision.current, latest: decision.latest, c }),
      h(Highlights, { notes: decision.notes, c }),
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '14px' } },
        h(ActionButton, { c, primary: true, onClick: onOpen }, t.update.openReleases),
        h(ActionButton, { c, onClick: dismiss }, t.update.later)),
      h('label', {
        style: {
          display: 'flex', alignItems: 'center', gap: '8px',
          marginTop: '12px', paddingTop: '11px', borderTop: `1px solid ${c.border}`,
          color: c.textDim, cursor: 'pointer', fontSize: '11px',
        },
      },
        h(Checkbox, { c, checked: skip, onChange: (e) => setSkip(e.target.checked) }),
        h('span', null, t.update.ignoreVersion))));
}

function FailedCard({ decision, onRetry, onClose, c, t }) {
  return h('div', { style: cardStyle(c), role: 'status' },
    h('div', { style: contentStyle },
      h(Header, {
        c, icon: h(StatusIcon, { c, kind: 'failed' }), title: t.update.failedTitle,
        subtitle: t.update.failedReason(t.update.reasons[decision.reason] || decision.reason),
        onClose, closeLabel: t.update.close,
      }),
      h('div', { style: { marginTop: '14px' } },
        h(ActionButton, { c, primary: true, onClick: onRetry }, t.update.retry))));
}

function UpToDateCard({ decision, onClose, c, t }) {
  return h('div', { style: cardStyle(c), role: 'status' },
    h('div', { style: contentStyle },
      h(Header, {
        c, icon: h(StatusIcon, { c, kind: 'success' }), title: t.update.upToDateTitle,
        subtitle: t.update.upToDateBody(decision.current), onClose, closeLabel: t.update.close,
      })));
}

export function UpdateNotification({ decision, onOpen, onSkip, onRetry, onClose, c, t }) {
  if (!decision) return null;
  if (decision.state === 'available') return h(AvailableCard, { decision, onOpen, onSkip, onClose, c, t });
  if (decision.state === 'failed') return h(FailedCard, { decision, onRetry, onClose, c, t });
  if (decision.state === 'up-to-date') return h(UpToDateCard, { decision, onClose, c, t });
  return null;
}
