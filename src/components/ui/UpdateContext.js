/**
 * Shares one update check between the title-bar badge and the notification
 * card. Mounted inside DesignProvider so it can suppress cards while an
 * optimization is running.
 */
import { useDesign } from '../../state/DesignContext.js';
import { useUpdateCheck } from './useUpdateCheck.js';
import { UpdateNotification } from './UpdateNotification.js';

const { createElement: h, createContext, useContext } = React;

const UpdateContext = createContext(null);

export const UpdateProvider = ({ enabled, ready, skippedVersion, onSkipVersion, appVersion, c, t, children }) => {
  const { isOptimizing } = useDesign();
  const update = useUpdateCheck({
    enabled, ready, skippedVersion, onSkipVersion, isOptimizing, appVersion,
  });

  return h(UpdateContext.Provider, { value: update },
    children,
    h(UpdateNotification, {
      decision: update.card,
      onOpen: update.openReleases,
      onSkip: update.skip,
      onRetry: update.checkNow,
      onClose: update.dismiss,
      c,
      t,
    }));
};

/** Null outside the provider, so the title bar still renders in isolation. */
export function useUpdate() {
  return useContext(UpdateContext);
}
