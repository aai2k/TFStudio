import { createWindowSession } from '../../windowSession.js';

export const colorEvaluationSession = createWindowSession({
    characteristic: 'R',
    pol: 'avg',
    theta: 0,
    observer: '2',
    illuminant: 'D65',
    step: 5,
    exposure: '1',
});
