import { setSizes, tabsIn, adoptTabIds } from './treeUtils.js';
import { SplitPane } from './SplitPane.js';
import { TabGroup } from './TabGroup.js';
import { useDesign } from '../../state/DesignContext.js';
import { useUnresolvedMaterials } from '../../utils/materials/useUnresolvedMaterials.js';
import { ReplaceMaterialsDialog } from '../dialogs/ReplaceMaterialsDialog.js';
import { MissingMaterialsBanner } from '../materials/MissingMaterialsNotice.js';
import { helpAnchorFor } from './windowRegistry.js';
import { ToolContent } from './ToolContent.js';
import { EmptyDropTarget, EmptyWorkspace } from './EmptyStates.js';
import { FloatWindows } from './FloatWindows.js';
import { LAYOUT_PRESETS, makePresetTree } from './layoutPresets.js';
import { saveLayout, loadSavedLayout } from './layoutStorage.js';
import { useDockTree } from './useDockTree.js';
import { useFloatWindows } from './useFloatWindows.js';
import { useTabDrag } from './useTabDrag.js';

// Re-export for any external consumer that historically imported these from here.
export { TOOL_CONFIGS, TOOL_LABELS, helpAnchorFor } from './windowRegistry.js';
export { ToolContent, FloatToolHost } from './ToolContent.js';
export { EmptyDropTarget } from './EmptyStates.js';
export { LAYOUT_PRESETS } from './layoutPresets.js';
export { hasNativeWindows, saveLayout, clampToScreen, loadSavedLayout } from './layoutStorage.js';
export { previewSize, startDragPreview } from './dragPreview.js';

const { createElement: h, useState, useEffect } = React;

// ── Recursive tree renderer ────────────────────────────────────────────────
//
// A plain function rather than a component, so the element tree it builds is
// exactly the tree the nodes describe. Wrapping each node in a component of its
// own would add a level to every pane, and what a pane must not do is remount:
// that is the chart clearing and redrawing on a design switch.

function renderNode(node, ctx) {
  if (!node) return null;

  if (node.type === 'split') {
    return h(SplitPane, {
      key:            node.id,
      node, c: ctx.c,
      onSizesChange:  (newSizes) => ctx.setTree(prev => setSizes(prev, node.id, newSizes))
    },
      ...node.children.map(child => renderNode(child, ctx))
    );
  }

  if (node.type === 'tabs') {
    return h(TabGroup, {
      key:             node.id,
      node, c: ctx.c,
      dragActive:      ctx.dragActive,
      dragSrcGroupId:  ctx.dragSrcGroupId,
      dragInsertRef:   ctx.dragInsertRef,
      dropTargetRef:   ctx.dropTargetRef,
      forcedZone:      ctx.forcedZone,
      onTabClick:      ctx.handleTabClick,
      onTabClose:      ctx.handleTabClose,
      onTabDragStart:  ctx.handleTabDragStart,
      onGroupFocus:    ctx.handleGroupFocus,
      // Keyed by the tab, not the tool: a group draws whichever of its tabs is
      // active, at one position in the tree, and two tabs can hold the same
      // tool. Unkeyed they share one mounted window and one error boundary.
      renderContent:   (tab) => h(ToolContent, {
        key: tab.id,
        copyId: tab.id,
        toolId: tab.toolId,
        c: ctx.c, theme: ctx.theme, t: ctx.t,
        setInputDialog: ctx.setInputDialog,
        onCreateDesign: ctx.onCreateDesign,
        missingMaterialIds: ctx.missingMaterialIds,
        onReplaceMaterials: ctx.onReplaceMaterials,
      }),
      helpAnchorFor,
      locale: ctx.locale, t: ctx.t, ribbonStyle: ctx.ribbonStyle
    });
  }

  return null;
}

// ── DockingLayout ─────────────────────────────────────────────────────────────

export function DockingLayout({ c, theme, toolRequests, onWindowListChange, layoutRequest, t, setInputDialog, locale, ribbonStyle = 'colorful', onCreateProject, onCreateDesign }) {
  const { design, updateDesign } = useDesign();
  const missingMaterialIds = useUnresolvedMaterials(design);
  const [dragActive, setDragActive]   = useState(false);
  const [dragSrcGroupId, setDragSrcGroupId] = useState(null);
  const [forcedZone, setForcedZone]   = useState(null); // zone lit by a drag from a float
  const [replaceMaterialsOpen, setReplaceMaterialsOpen] = useState(false);

  const {
    tree, setTree, treeRef, lastGroupRef, openTool, placeTab,
    handleTabClick, handleTabClose, handleGroupFocus,
  } = useDockTree();

  const {
    floats, setFloats, floatsRef, floatWinsRef, floatsWithBounds,
    tearOff, closeFloatWindow, dockFloat, handleFloatDragOver, handleFloatDrop,
  } = useFloatWindows({ setTree, placeTab, lastGroupRef, setDragActive, setForcedZone });

  const { dropTargetRef, dragInsertRef, handleTabDragStart } = useTabDrag({
    c, t, setTree, tearOff, setDragActive, setDragSrcGroupId,
  });

  useEffect(() => {
    if (!toolRequests?.length) return;
    const req = toolRequests[toolRequests.length - 1];
    openTool(req.toolId, { region: req.region, focusExisting: req.focusExisting });
  }, [toolRequests, openTool]);

  // ── Layout requests (presets / restore) ───────────────────────────────────
  useEffect(() => {
    if (!layoutRequest) return;
    // A rearranged layout builds fresh tabs, and a fresh tab is a fresh copy of
    // its tool holding none of the controls the user had set. Tools the new
    // layout keeps open therefore take over the ids they already had.
    const keepOpen = next => prev => adoptTabIds(next, [...tabsIn(prev), ...floatsRef.current]);
    if (layoutRequest.type === 'preset') {
      const preset = LAYOUT_PRESETS[layoutRequest.id];
      if (preset) { setTree(keepOpen(makePresetTree(preset.tools))); setFloats([]); }
    } else if (layoutRequest.type === 'restore') {
      const saved = loadSavedLayout();
      // The restored floats keep the ids `loadSavedLayout` drew for them: the
      // docked tree has already taken what was open, and one id on two windows
      // would put them both on one set of controls.
      if (saved) { setTree(keepOpen(saved.tree)); setFloats(saved.floats); }
    } else if (layoutRequest.type === 'save') {
      saveLayout(treeRef.current, floatsWithBounds());
    }
    // `treeRef` and `floatsWithBounds` read refs, so the effect needs neither
    // the tree nor the floats as a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutRequest]);

  // Report the list of open tools to the parent whenever the tree changes.
  // WITHOUT this, the parent's `openWindowIds` stays [] forever, so its
  // "auto-arrange the default preset only when nothing is open" guard is always
  // satisfied → EVERY design switch re-applies the filter-design preset, which
  // rebuilds the tree with fresh node ids and REMOUNTS every window. That remount
  // is the OE-plot flicker (the chart clears then redraws; the Design Editor
  // has no canvas so it looks fine). Reporting the real list keeps the layout
  // stable across switches.
  useEffect(() => {
    if (!onWindowListChange) return;
    // Torn-off tools are still open, so they belong on this list too. Leaving
    // them off would let the parent believe the workspace is empty and re-apply
    // a preset over a layout the user is using.
    onWindowListChange([...tabsIn(tree), ...floats].map(tab => tab.toolId));
  }, [tree, floats, onWindowListChange]);

  // Everything the tree renderer reads, gathered so the recursion carries one
  // argument rather than fifteen. Rebuilt per render on purpose: renderNode runs
  // during render and rebuilds the element tree anyway, so memoizing this would
  // save one object and cost a dependency list that has to stay in step with it.
  const nodeCtx = {
    c, theme, t, locale, ribbonStyle, setTree, setInputDialog, onCreateDesign,
    dragActive, dragSrcGroupId, dragInsertRef, dropTargetRef, forcedZone,
    handleTabClick, handleTabClose, handleTabDragStart, handleGroupFocus,
    missingMaterialIds,
    onReplaceMaterials: () => setReplaceMaterialsOpen(true),
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return h('div', {
    'data-tour': 'docking',
    style: {
      flex: 1, display: 'flex', flexDirection: 'column',
      overflow: 'hidden', backgroundColor: c.bg,
      position: 'relative'
    }
  },
    h(MissingMaterialsBanner, {
      ids: missingMaterialIds, c, t,
      onRepair: () => setReplaceMaterialsOpen(true),
    }),
    // Nothing docked, whether or not tools are floating: tearing the last window
    // out used to leave the workspace blank, with no pane and so no compass, and
    // that window could then only be brought back from its dock button.
    !tree
      ? h(EmptyWorkspace, { c, t, onCreateProject })
      : renderNode(tree, nodeCtx),
    !tree && dragActive && h(EmptyDropTarget, {
      c, t, lit: !!(forcedZone && forcedZone.zone === 'center'),
    }),
    replaceMaterialsOpen && h(ReplaceMaterialsDialog, {
      design, updateDesign, c, t, onClose: () => setReplaceMaterialsOpen(false),
    }),

    h(FloatWindows, {
      floats, c, theme, t, locale, ribbonStyle, onCreateDesign, missingMaterialIds,
      floatWinsRef,
      onDock: dockFloat,
      onClose: closeFloatWindow,
      onDragOver: handleFloatDragOver,
      onDrop: handleFloatDrop,
    })
  );
}
