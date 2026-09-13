/**
 * Mounting point for every dockable tool window.
 *
 * `ToolContent` resolves a tool id through the window registry and renders that
 * window with its prop contract and an error boundary. `FloatToolHost` wraps it
 * for a torn-off window, adding the dialog hosts such a window needs.
 */

import { WindowCopyProvider } from '../windows/windowSession.js';
import { useDesign } from '../../state/DesignContext.js';
import { ReplaceMaterialsDialog } from '../dialogs/ReplaceMaterialsDialog.js';
import { InputDialog } from '../dialogs/InputDialog.js';
import { MaterialCalculationBlocked } from '../materials/MissingMaterialsNotice.js';
import { ErrorBoundary, WindowFailedPane } from '../ui/ErrorBoundary.js';
import { WINDOW_REGISTRY, TOOL_LABELS, windowTitle } from './windowRegistry.js';

const { createElement: h, useState } = React;

// ── Tool content — registry-driven dispatch ───────────────────────────────────
// Every window's component + prop contract lives in windowRegistry.js. The prop
// contract is preserved exactly: each window gets { c, t }; entries flagged
// `theme` also get `theme`; entries flagged `dialog` also get `setInputDialog`;
// entries flagged `createDesign` also get `onCreateDesign`.
// An id with no component (modal/wizard/stub) falls through to the placeholder.

export function ToolContent({ toolId, copyId = null, c, theme, t, setInputDialog, onCreateDesign,
  missingMaterialIds = [], onReplaceMaterials }) {
  // Every window, docked or torn off, is mounted here, so this is also where it
  // is told which of its open copies it is. Its session store keys the controls
  // on that, so two tabs of one tool hold two sets of them.
  const asCopy = body => h(WindowCopyProvider, { copyId }, body);
  const entry = WINDOW_REGISTRY[toolId];
  if (entry?.requiresResolvedMaterials && missingMaterialIds.length > 0) {
    return asCopy(h(MaterialCalculationBlocked, {
      ids: missingMaterialIds, c, t, onRepair: onReplaceMaterials,
    }));
  }
  if (entry && entry.component) {
    const props = { c, t };
    if (entry.theme)  props.theme = theme;
    if (entry.dialog) props.setInputDialog = setInputDialog;
    if (entry.createDesign) props.onCreateDesign = onCreateDesign;
    // Every window is mounted here, so this is the one place a boundary has to
    // go. What separates one mounted window from another is the tab it belongs
    // to, which this does not know, so the caller keys the element (see
    // `renderContent`): two tabs of the same tool would otherwise share a
    // boundary and one's failure would show on the other.
    return asCopy(h(ErrorBoundary, {
      label: toolId,
      fallback: (error, retry) => h(WindowFailedPane, {
        error, onReopen: retry, c, t, title: windowTitle(toolId, t),
      }),
    }, h(entry.component, props)));
  }

  return asCopy(h('div', {
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', color: c.textDim, fontSize: 13,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      textAlign: 'center', padding: 24
    }
  }, TOOL_LABELS[toolId] || toolId));
}

// A torn-off tool with the dialogs it can raise hosted beside it, so a name, a
// confirmation or the material repair it asks for opens over the window the user
// is working in. The app's own hosts live in the main window's tree: a dialog
// raised through one of those from a torn-off tool opens on the main window,
// behind the tool that asked for it.
export function FloatToolHost(props) {
  const { design, updateDesign } = useDesign();
  const [inputDialog, setInputDialog] = useState(null);
  const [repairMaterials, setRepairMaterials] = useState(false);
  return h(React.Fragment, null,
    h(ToolContent, {
      ...props, setInputDialog, onReplaceMaterials: () => setRepairMaterials(true),
    }),
    h(InputDialog, { inputDialog, c: props.c, t: props.t }),
    repairMaterials && h(ReplaceMaterialsDialog, {
      design, updateDesign, c: props.c, t: props.t,
      onClose: () => setRepairMaterials(false),
    }),
  );
}
