/**
 * Custom title bar component
 * Replaces the default OS title bar with minimize, maximize, and close buttons
 */

export function TitleBar({ c, activeDesign, isDirty }) {
  const [isMaximized, setIsMaximized] = React.useState(false);

  React.useEffect(() => {
    // Listen for maximize/unmaximize events from main process
    if (window.electronAPI) {
      if (window.electronAPI.onWindowMaximized) {
        window.electronAPI.onWindowMaximized(() => setIsMaximized(true));
      }
      if (window.electronAPI.onWindowUnmaximized) {
        window.electronAPI.onWindowUnmaximized(() => setIsMaximized(false));
      }
    }
  }, []);

  const handleMinimize = () => {
    if (window.electronAPI && window.electronAPI.windowControl) window.electronAPI.windowControl('minimize');
  };

  const handleMaximize = () => {
    if (window.electronAPI && window.electronAPI.windowControl) window.electronAPI.windowControl('maximize');
  };

  const handleClose = () => {
    if (window.electronAPI && window.electronAPI.windowControl) window.electronAPI.windowControl('close');
  };

  return React.createElement('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: '32px',
      backgroundColor: c.bg,
      borderBottom: `1px solid ${c.border}`,
      WebkitAppRegion: 'drag',
      userSelect: 'none'
    }
  },
    // Left side - empty for now
    React.createElement('div', {
      style: { width: '48px' }
    }),

    // Center - Title
    React.createElement('div', {
      style: {
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        lineHeight: 1.2
      }
    },
      React.createElement('div', {
        style: { fontSize: '11px', fontWeight: '400', color: c.textDim, letterSpacing: '0.08em', textTransform: 'uppercase' }
      }, 'TFStudio'),
      activeDesign && React.createElement('div', {
        style: { fontSize: '12px', fontWeight: '600', color: c.text, display: 'flex', alignItems: 'center', gap: 3 }
      },
        activeDesign.name,
        isDirty && React.createElement('span', { style: { color: c.accent, fontSize: 14, lineHeight: 1 } }, '●')
      )
    ),

    // Right side - Window controls
    React.createElement('div', {
      style: {
        display: 'flex',
        height: '100%',
        WebkitAppRegion: 'no-drag'
      }
    },
      // Minimize button
      React.createElement('button', {
        onClick: handleMinimize,
        style: {
          width: '46px',
          height: '100%',
          border: 'none',
          backgroundColor: 'transparent',
          color: c.text,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background-color 0.15s',
          outline: 'none'
        },
        onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = c.hover; },
        onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = 'transparent'; }
      },
        React.createElement('svg', { width: 11, height: 11, viewBox: '0 0 11 11', fill: 'none' },
          React.createElement('path', { d: 'M1 5.5h9', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' })
        )
      ),

      // Maximize/Restore button
      React.createElement('button', {
        onClick: handleMaximize,
        style: {
          width: '46px',
          height: '100%',
          border: 'none',
          backgroundColor: 'transparent',
          color: c.text,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background-color 0.15s',
          outline: 'none'
        },
        onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = c.hover; },
        onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = 'transparent'; }
      },
        isMaximized
          ? // Restore icon: two overlapping squares (stroke-based)
            React.createElement('svg', { width: 11, height: 11, viewBox: '0 0 11 11', fill: 'none' },
              React.createElement('path', { d: 'M3.5 1.5h6v6', stroke: 'currentColor', strokeWidth: 1, strokeLinejoin: 'round' }),
              React.createElement('rect', { x: 0.5, y: 3.5, width: 7, height: 7, stroke: 'currentColor', strokeWidth: 1 })
            )
          : // Maximize icon: single square
            React.createElement('svg', { width: 11, height: 11, viewBox: '0 0 11 11', fill: 'none' },
              React.createElement('rect', { x: 0.5, y: 0.5, width: 10, height: 10, stroke: 'currentColor', strokeWidth: 1 })
            )
      ),

      // Close button
      React.createElement('button', {
        onClick: handleClose,
        style: {
          width: '46px',
          height: '100%',
          border: 'none',
          backgroundColor: 'transparent',
          color: c.text,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background-color 0.15s, color 0.15s',
          outline: 'none'
        },
        onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = '#e81123'; e.currentTarget.style.color = '#ffffff'; },
        onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = c.text; }
      },
        React.createElement('svg', { width: 11, height: 11, viewBox: '0 0 11 11', fill: 'none' },
          React.createElement('path', { d: 'M1 1l9 9M10 1L1 10', stroke: 'currentColor', strokeWidth: 1, strokeLinecap: 'round' })
        )
      )
    )
  );
}
