/**
 * The torn-off tools on screen. Each is a real OS window, but it renders inside
 * the main React tree, so the design and the run state behind it are the ones
 * the docked windows are using.
 */

import { FloatFrame } from './FloatFrame.js';
import { PopoutWindow } from './PopoutWindow.js';
import { FloatToolHost } from './ToolContent.js';
import { helpAnchorFor } from './windowRegistry.js';

const { createElement: h } = React;

export function FloatWindows({
  floats, c, theme, t, locale, ribbonStyle, onCreateDesign, missingMaterialIds,
  floatWinsRef, onDock, onClose, onDragOver, onDrop,
}) {
  return floats.map(f => {
    const title = (t && t.windowTitles && t.windowTitles[f.toolId]) || f.title;
    return h(PopoutWindow, {
      key: f.id,
      id: f.id,
      title,
      bounds: f.bounds,
      background: c.panel,
      onClose: () => onClose(f.id),
      onWindowReady: (win) => floatWinsRef.current.set(f.id, win),
    },
      (win) => h(FloatFrame, {
        c, t, locale, ribbonStyle, win,
        toolId: f.toolId,
        title,
        helpAnchor: helpAnchorFor(f.toolId),
        onDock: () => onDock(f.id, null),
        onClose: () => onClose(f.id),
        onDragOver,
        onDrop: (screenPoint) => onDrop(f.id, screenPoint),
      },
        h(FloatToolHost, {
          toolId: f.toolId, copyId: f.id, c, theme, t, onCreateDesign, missingMaterialIds,
        })
      )
    );
  });
}
