import { createWindowSession } from '../../windowSession.js';

// Per-design session for the environment dropdown and the view lock.
// scope 'design' keeps one slot per design id, so each design restores the
// environment it was last viewed with when it comes back (per-slot isolation).
// onDesignChange reseeds only when the stored selection is out of range for
// the new design (the environment list shrank or is empty); a selection that
// is still valid is kept, which is what lets a design round-trip restore it.
export const opticalEnvSession = createWindowSession({
  envIndex: -1,
  locked: false,
  lockedEnvIndex: -1,
}, {
  scope: 'design',
  onDesignChange: (design, current) => {
    const count = (design?.meritEnvironments || []).length;
    const valid = idx => idx === -1 || (idx >= 0 && idx < count);
    if (!valid(current.envIndex) || !valid(current.lockedEnvIndex)) {
      return { envIndex: -1, locked: false, lockedEnvIndex: -1 };
    }
    return null;
  },
});
