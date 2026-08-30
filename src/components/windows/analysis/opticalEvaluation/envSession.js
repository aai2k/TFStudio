import { createWindowSession } from '../../windowSession.js';

// Per-design session for the environment dropdown.
// scope 'design' keeps one slot per design id, so each design restores the
// environment it was last viewed with when it comes back (per-slot isolation).
// onDesignChange reseeds only when the stored selection is out of range for
// the new design (the environment list shrank or is empty); a selection that
// is still valid is kept, which is what lets a design round-trip restore it.
// The view lock is NOT stored here: it is transient UI state for the current
// window instance, held in local React state by useOpticalEvaluation, so it
// must not be shared across windows of the same design (a module-scoped store
// is shared by every mount and would go stale in multi-window comparison).
export const opticalEnvSession = createWindowSession({
  envIndex: -1,
}, {
  scope: 'design',
  onDesignChange: (design, current) => {
    const count = (design?.meritEnvironments || []).length;
    const valid = idx => idx === -1 || (idx >= 0 && idx < count);
    if (!valid(current.envIndex)) {
      return { envIndex: -1 };
    }
    return null;
  },
});
