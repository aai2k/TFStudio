const { createElement: h, useState, useEffect } = React;

export function MenuBar({ c, onMenuAction, t, devAllowed = true }) {
  const [openMenu, setOpenMenu] = useState(null);
  const [menuPos,  setMenuPos]  = useState({ x: 0, y: 0 });

  // ── Menu structure (built from locale) ─────────────────────────────────────
  const menus = [
    {
      label: t.menu.file,
      items: [
        { label: t.menu.newDesign,    action: 'new-design',    shortcut: 'Ctrl+N' },
        { label: t.menu.openProject,  action: 'open-project',  shortcut: 'Ctrl+O' },
        { label: t.menu.save,         action: 'save',          shortcut: 'Ctrl+S' },
        { type: 'sep' },
        { label: t.menu.exportReport, action: 'export-report' },
        { type: 'sep' },
        { label: t.menu.settings,     action: 'open-settings', shortcut: 'Ctrl+,' }
      ]
    },
    {
      label: t.menu.edit,
      items: [
        { label: t.menu.undo, action: 'undo', shortcut: 'Ctrl+Z' },
        { label: t.menu.redo, action: 'redo', shortcut: 'Ctrl+Y' },
      ]
    },
    {
      label: t.menu.view,
      items: [
        { label: t.menu.layoutFilterDesign, action: 'layout-filter-design', shortcut: 'Ctrl+1' },
        { label: t.menu.layoutFullAnalysis, action: 'layout-full-analysis' },
        { label: t.menu.layoutSynthesis,    action: 'layout-synthesis'     },
        { type: 'sep' },
        { label: t.menu.saveLayout,         action: 'layout-save'          },
        { label: t.menu.restoreLayout,      action: 'layout-restore'       },
        { type: 'sep' },
        // Reload + DevTools + Optimizer Benchmark are dev-only: hidden in packaged builds (unless --debug).
        ...(devAllowed ? [
          { label: t.menu.reload,           action: 'reload',              shortcut: 'Ctrl+R' },
          { label: t.menu.toggleDevTools,   action: 'toggle-devtools',     shortcut: 'Ctrl+Shift+I' },
          { label: t.menu.optimizerBenchmark || 'Optimizer Benchmark…', action: 'tool:optimizer-benchmark' },
        ] : []),
        { label: t.menu.toggleFullscreen,   action: 'toggleFullscreen',    shortcut: 'F11' }
      ]
    },
    {
      label: t.menu.help,
      items: [
        { label: t.menu.welcome, action: 'welcome' },
        { label: t.menu.tutorials, action: 'tutorials' },
        { label: t.menu.documentation, action: 'help-docs', shortcut: 'F1' },
        { type: 'sep' },
        { label: t.menu.about, action: 'about' }
      ]
    }
  ];

  const close = () => setOpenMenu(null);

  const handleMenuBtn = (label, e) => {
    if (openMenu === label) { close(); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPos({ x: rect.left, y: rect.bottom });
    setOpenMenu(label);
  };

  const handleItem = (action) => {
    close();
    if (action === 'reload')          { window.location.reload(); return; }
    if (action === 'toggle-devtools') { window.electronAPI?.toggleDevTools?.(); return; }
    if (action === 'toggleFullscreen') {
      document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      return;
    }
    onMenuAction(action);
  };

  useEffect(() => {
    if (!openMenu) return;
    const handler = (e) => {
      if (!e.target.closest('.tf-menubar') && !e.target.closest('.tf-dropdown')) close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenu]);

  // ── Render helpers ──────────────────────────────────────────────────────────

  const renderDropdown = (items) =>
    h('div', {
      className: 'tf-dropdown',
      style: {
        position: 'fixed', left: menuPos.x, top: menuPos.y,
        backgroundColor: c.panel, border: `1px solid ${c.border}`,
        borderRadius: 5, boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
        minWidth: 220, padding: 4, zIndex: 10000
      }
    },
      items.map((item, i) =>
        item.type === 'sep'
          ? h('div', { key: i, style: { height: 1, backgroundColor: c.border, margin: '3px 8px' } })
          : h('div', {
              key: i,
              onClick: () => handleItem(item.action),
              style: {
                padding: '6px 12px', fontSize: 13, color: c.text,
                cursor: 'pointer', borderRadius: 4,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              },
              onMouseEnter: (e) => e.currentTarget.style.backgroundColor = c.hover,
              onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'transparent'
            },
              h('span', null, item.label),
              item.shortcut && h('span', { style: { color: c.textDim, fontSize: 11, marginLeft: 24 } }, item.shortcut)
            )
      )
    );

  return h('div', {
    className: 'tf-menubar',
    style: {
      display: 'flex', alignItems: 'center', height: 36,
      backgroundColor: c.panel, borderBottom: `1px solid ${c.border}`,
      padding: '0 8px', gap: 2, userSelect: 'none', flexShrink: 0,
      WebkitAppRegion: 'drag'
    }
  },
    // Logo + name
    h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 7, marginRight: 10,
        WebkitAppRegion: 'no-drag'
      }
    },
      h('img', {
        src: '../icons/tfstudio-purple2.png', alt: '',
        style: { width: 22, height: 22, objectFit: 'contain' }
      }),
      h('span', {
        style: { fontSize: 13, fontWeight: 700, color: c.text, letterSpacing: '-0.3px',
                 fontFamily: 'system-ui, -apple-system, sans-serif' }
      }, 'TFStudio')
    ),

    // Menu buttons
    menus.map(menu =>
      h('div', { key: menu.label, style: { position: 'relative', WebkitAppRegion: 'no-drag' } },
        h('button', {
          onClick: (e) => handleMenuBtn(menu.label, e),
          style: {
            padding: '3px 9px', backgroundColor: openMenu === menu.label ? c.hover : 'transparent',
            color: c.text, border: 'none', borderRadius: 3,
            cursor: 'pointer', fontSize: 13,
            fontFamily: 'system-ui, -apple-system, sans-serif', outline: 'none'
          },
          onMouseEnter: (e) => { if (openMenu && openMenu !== menu.label) { setMenuPos({ x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom }); setOpenMenu(menu.label); } e.currentTarget.style.backgroundColor = c.hover; },
          onMouseLeave: (e) => { if (openMenu !== menu.label) e.currentTarget.style.backgroundColor = 'transparent'; }
        }, menu.label),
        openMenu === menu.label && renderDropdown(menu.items)
      )
    )
  );
}
