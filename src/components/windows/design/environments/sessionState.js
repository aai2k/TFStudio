import { createWindowSession } from '../../windowSession.js';
import { BASE_ENVIRONMENT } from '../../../../utils/environments/environments.js';

// The current environment of each design (currentEnvironment.js): one slot per
// design, which every window reads and writes, starting on environment 1.
export const currentEnvironmentSession = createWindowSession(
    { current: BASE_ENVIRONMENT }, { scope: 'design', copies: 'shared' });
