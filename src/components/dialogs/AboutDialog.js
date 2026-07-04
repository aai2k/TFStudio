/**
 * About dialog component
 * Displays application information, version, and author details
 */

// Build date baked into the bundle at build time by tools/build-renderer.mjs
// (esbuild `define`). In dev (raw ES modules, no bundler) the identifier is
// never defined → `typeof` is 'undefined' → no build date shown. This is the
// actual build date, NOT the runtime date (which was the old bug).
const BUILD_DATE = (typeof __TFS_BUILD_DATE__ !== 'undefined') ? __TFS_BUILD_DATE__ : null;

export function AboutDialog({ c, t, onClose }) {
  const { createElement: h, useState, useEffect } = React;
  const [version, setVersion] = useState('0.1.0');

  useEffect(() => {
    // Get version from electron API
    if (window.electronAPI && window.electronAPI.getAppVersion) {
      window.electronAPI.getAppVersion().then(v => setVersion(v));
    }
  }, []);

  return h('div', {
    style: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000
    },
    onClick: onClose
  },
    h('div', {
      style: {
        backgroundColor: c.panel,
        border: `1px solid ${c.border}`,
        borderRadius: '12px',
        padding: '32px',
        minWidth: '400px',
        maxWidth: '500px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        textAlign: 'center'
      },
      onClick: (e) => e.stopPropagation()
    },
      // App icon
      h('img', {
        src: '../icons/tfstudio-purple2.png',
        alt: 'TFStudio',
        style: {
          width: '144px',
          height: '144px',
          marginBottom: '16px',
          objectFit: 'contain'
        }
      }),

      // App name
      h('h2', {
        style: {
          margin: '0 0 8px 0',
          color: c.text,
          fontSize: '28px',
          fontWeight: '600',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }
      }, 'TFStudio'),

      // Version
      h('div', {
        style: {
          color: c.textDim,
          fontSize: '14px',
          marginBottom: '24px'
        }
      }, `${t.dialogs.about.version} ${version}`),

      // Build date (baked at build time; hidden in dev where it's unknown).
      BUILD_DATE && h('div', {
        style: {
          color: c.textDim,
          fontSize: '13px',
          marginBottom: '8px'
        }
      }, `${t.dialogs.about.build}: ${new Date(BUILD_DATE + 'T12:00:00').toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })}`),

      // Divider
      h('div', {
        style: {
          height: '1px',
          backgroundColor: c.border,
          margin: '24px 0'
        }
      }),


      // Website
      h('div', {
        style: {
          color: c.textDim,
          fontSize: '13px',
          marginBottom: '8px'
        }
      }, t.dialogs.about.website),

      h('a', {
        href: '#',
        onClick: (e) => {
          e.preventDefault();
          if (window.electronAPI && window.electronAPI.openExternal) {
            window.electronAPI.openExternal('https://github.com/aai2k/TFStudio');
          }
        },
        style: {
          color: c.accent,
          fontSize: '14px',
          textDecoration: 'none',
          display: 'block',
          marginBottom: '16px'
        },
        onMouseEnter: (e) => {
          e.target.style.textDecoration = 'underline';
        },
        onMouseLeave: (e) => {
          e.target.style.textDecoration = 'none';
        }
      }, 'GitHub'),

      // Contact email
      h('div', {
        style: {
          color: c.textDim,
          fontSize: '13px',
          marginBottom: '8px'
        }
      }, t.dialogs.about.contact),

      h('a', {
        href: '#',
        onClick: (e) => {
          e.preventDefault();
          if (window.electronAPI && window.electronAPI.openExternal) {
            window.electronAPI.openExternal('mailto:achapovskyai@gmail.com');
          }
        },
        style: {
          color: c.accent,
          fontSize: '14px',
          textDecoration: 'none',
          display: 'block',
          marginBottom: '24px'
        },
        onMouseEnter: (e) => {
          e.target.style.textDecoration = 'underline';
        },
        onMouseLeave: (e) => {
          e.target.style.textDecoration = 'none';
        }
      }, 'achapovskyai@gmail.com'),

      // Close button
      h('button', {
        onClick: onClose,
        style: {
          padding: '10px 32px',
          backgroundColor: c.accent,
          color: '#ffffff',
          border: 'none',
          borderRadius: '6px',
          fontSize: '14px',
          fontWeight: '500',
          cursor: 'pointer',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          transition: 'background-color 0.15s'
        },
        onMouseEnter: (e) => {
          e.target.style.backgroundColor = '#5ba0f2';
        },
        onMouseLeave: (e) => {
          e.target.style.backgroundColor = c.accent;
        }
      }, t.dialogs.about.close)
    )
  );
}
