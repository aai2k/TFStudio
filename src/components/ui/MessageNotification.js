/**
 * The notices in the bottom-right corner of the window (info, success, warning,
 * error), and the component that draws one. They stack, the latest on top.
 * Each closes itself after its `duration` in ms, 4 seconds unless given, or
 * stays until the user closes it when the duration is 0.
 */

import { tablerIcon } from './tablerIcons.js';

/**
 * The notices on screen, in the order they were raised. A notice raised while
 * others are open is shown at once, above them, with its own timer, so one that
 * stays until closed never holds back a later one such as a failed save. A
 * notice the same as one already on screen is not shown twice: a refresh raises
 * the notices of a load anew. A notice with no message is ignored, since it
 * would draw nothing and never close. `notify` shows one, `dismiss(id)` closes
 * it.
 */
export function useNoticeStack() {
  const { useState, useRef, useCallback } = React;
  const [notices, setNotices] = useState([]);
  const nextId = useRef(0);
  const notify = useCallback((notice) => {
    if (!notice?.message) return;
    setNotices(open => (open.some(n => n.type === notice.type && n.message === notice.message)
      ? open
      : [...open, { ...notice, id: ++nextId.current }]));
  }, []);
  const dismiss = useCallback(id => setNotices(open => open.filter(n => n.id !== id)), []);
  return { notices, notify, dismiss };
}

export function MessageNotification({ c, message, type = 'info', onClose, duration = 4000 }) {
  const { createElement: h, useState, useEffect, useRef } = React;
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  // Track the show/close timers so they can be cancelled on unmount. The 200 ms
  // close timer fires onClose(); if it ran AFTER unmount it would clear whatever
  // notification is currently shown — i.e. a NEWER message the parent has since
  // replaced this one with.
  const showTimerRef  = useRef(null);
  const closeTimerRef = useRef(null);

  useEffect(() => () => {
    if (showTimerRef.current)  clearTimeout(showTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  // Slide in animation on mount
  useEffect(() => {
    if (message) {
      showTimerRef.current = setTimeout(() => setIsVisible(true), 100);
      return () => { if (showTimerRef.current) clearTimeout(showTimerRef.current); };
    }
  }, [message]);

  // Auto-dismiss after duration
  useEffect(() => {
    if (isVisible && duration > 0) {
      const timer = setTimeout(() => {
        handleClose();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [isVisible, duration]);

  if (!message) {
    return null;
  }

  const handleClose = () => {
    setIsClosing(true);
    closeTimerRef.current = setTimeout(() => {
      setIsVisible(false);
      onClose();
    }, 200);
  };

  // Color scheme based on message type
  const getTypeColors = () => {
    switch (type) {
      case 'success':
        return {
          icon: '✓',
          iconColor: '#4ade80',
          borderColor: '#4ade80'
        };
      case 'error':
        return {
          icon: '✕',
          iconColor: '#f87171',
          borderColor: '#f87171'
        };
      case 'warning':
        return {
          icon: '⚠',
          iconColor: '#fbbf24',
          borderColor: '#fbbf24'
        };
      default: // info
        return {
          icon: 'ℹ',
          iconColor: c.accent,
          borderColor: c.accent
        };
    }
  };

  const typeColors = getTypeColors();

  // Placed by the stack it is drawn in (see AppModals).
  return h('div', {
    style: {
      width: '360px',
      backgroundColor: c.panel,
      border: `1px solid ${typeColors.borderColor}`,
      borderRadius: '8px',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
      transform: isClosing
        ? 'translateX(400px)'
        : isVisible
          ? 'translateX(0)'
          : 'translateX(400px)',
      opacity: isVisible && !isClosing ? 1 : 0,
      transition: 'transform 0.3s ease, opacity 0.3s ease',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      overflow: 'hidden'
    }
  },
    // Content
    h('div', {
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        padding: '16px',
        gap: '12px'
      }
    },
      // Icon
      h('div', {
        style: {
          fontSize: '20px',
          color: typeColors.iconColor,
          fontWeight: '600',
          lineHeight: '1',
          minWidth: '20px',
          textAlign: 'center'
        }
      }, typeColors.icon),

      // Message text
      h('div', {
        style: {
          flex: 1,
          color: c.text,
          fontSize: '14px',
          lineHeight: '1.5',
          wordBreak: 'break-word'
        }
      }, message),

      // Close button
      h('button', {
        onClick: handleClose,
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'none',
          border: 'none',
          color: c.textDim,
          cursor: 'pointer',
          padding: '0 4px',
          borderRadius: '4px',
          transition: 'background-color 0.15s, color 0.15s',
          minWidth: '20px'
        },
        onMouseEnter: (e) => {
          e.currentTarget.style.backgroundColor = c.hover;
          e.currentTarget.style.color = c.text;
        },
        onMouseLeave: (e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
          e.currentTarget.style.color = c.textDim;
        }
      }, tablerIcon('x', 16))
    )
  );
}
