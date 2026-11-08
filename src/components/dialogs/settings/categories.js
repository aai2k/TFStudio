// The panes of the Preferences dialog, in the order its rail lists them. The
// logo menu lists the same panes, so both read them from here.
//
// Automation holds the live link for AI agents, which only the desktop app
// has; elsewhere, as in the web demo, the pane is left out.
const CATEGORY_IDS = ['appearance', 'quickAccess', 'language', 'performance', 'analysis', 'folders', 'automation'];

export const settingsCategoryIds = () =>
  CATEGORY_IDS.filter(id => id !== 'automation' || !!window.electronAPI?.setLiveBridge);
