// ── Keeping one broken window from taking the app with it ─────────────────────
//
// React unmounts the entire tree when a render, a lifecycle method or a commit
// throws. With no boundary anywhere, a fault in a single tool window leaves a
// blank page that says nothing about what failed, and the only way out is to
// restart. A boundary confines the fault to the subtree it wraps and draws a
// replacement in its place.
//
// Only errors on the render path are caught. A rejected promise, a timer
// callback or an event handler that throws never reaches a boundary, and a
// torn-off tool is covered because it is a portal into this same tree rather
// than a second React root.

import { NoticePane } from './NoticePane.js';

const { createElement: h, Fragment } = React;

/**
 * `fallback(error, retry)` returns what to draw instead of the children.
 * `retry` clears the error and rebuilds the subtree from scratch: the children
 * are re-keyed, so no state from the failed attempt survives.
 *
 * `label` names the failing subtree in the console line, which is where the
 * stack is read from (DevTools is available in installed builds).
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    // `hasError` is separate from `error` because a thrown value may itself be
    // falsy. Gating the fallback on the value would re-render the children,
    // throw again, and end at the blank page this exists to prevent.
    this.state = { hasError: false, error: null, attempt: 0 };
    this.retry = () => this.setState((s) => ({
      hasError: false, error: null, attempt: s.attempt + 1,
    }));
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error(`[${this.props.label || 'renderer'}] render failed`, error, info && info.componentStack);
  }

  render() {
    if (this.state.hasError) return this.props.fallback(this.state.error, this.retry);
    return h(Fragment, { key: this.state.attempt }, this.props.children);
  }
}

// What a thrown value has to say for itself. Non-Error throws still carry
// something worth printing, and an Error with no message would print as nothing.
function errorText(error) {
  return (error && error.message) || String(error);
}

function Details({ c, text }) {
  return h('div', {
    style: {
      maxWidth: 560, padding: '8px 10px', borderRadius: 4,
      border: `1px solid ${c.border}`, backgroundColor: c.panel,
      color: c.textDim, fontSize: 11, lineHeight: 1.5, textAlign: 'left',
      fontFamily: 'ui-monospace, Consolas, monospace', overflowWrap: 'anywhere',
    },
  }, text);
}

function ActionButton({ c, label, onClick }) {
  return h('button', {
    onClick,
    style: {
      flexShrink: 0, padding: '6px 13px', borderRadius: 4,
      border: `1px solid ${c.accent}`, backgroundColor: c.accent,
      color: c.accentText, cursor: 'pointer', fontSize: 12, fontWeight: 600,
    },
  }, label);
}

/** Replaces the content of one docked or torn-off tool window that threw. */
export function WindowFailedPane({ error, onReopen, title, c, t }) {
  const we = t.windowError;
  return h(NoticePane, {
    c,
    'data-window-error': 'pane',
    title: we.paneTitle(title),
    body: we.paneBody,
    detail: h(Details, { c, text: errorText(error) }),
    action: h(ActionButton, { c, label: we.reopen, onClick: onReopen }),
  });
}

/**
 * The last resort: the app shell itself threw, so there is no window to keep.
 * Reloading is the only action left, and it is what the user would otherwise do
 * by restarting.
 */
export function AppFailedPage({ error, c, t }) {
  const we = t.windowError;
  return h(NoticePane, {
    c,
    'data-window-error': 'shell',
    title: we.appTitle,
    body: we.appBody,
    detail: h(Details, { c, text: errorText(error) }),
    action: h(ActionButton, {
      c, label: we.reload, onClick: () => window.location.reload(),
    }),
  });
}
