/**
 * What is wrong with the env option of a headless API result call, on the
 * design with three environments of _environmentDesign.mjs: without env, the
 * call on the design itself, as on the design without its environments; by
 * number and by id, each environment, the third switched off, the call on the
 * design that environment computes (environmentDesign), environment 2 not
 * environment 1; 'all', the two that are on, each the call on its design
 * beside its number, id and name; and an environment the design does not have
 * refused with unknownEnvironment.
 */
import { isDeepStrictEqual as same } from 'node:util';
import { environmentDesign, oneEnvironmentDesign } from '../src/utils/environments/environments.js';
import { threeEnvironmentDesign } from './_environmentDesign.mjs';

/**
 * The checks that fail for `api[call]` with `options`, each named; empty when
 * every one holds. `design` is the design with three environments, or one of
 * its kind whose environments are named and switched as its own are, for a
 * call that environment 2's sapphire alone leaves as it is.
 */
export function environmentWrong(api, call, options = {}, design = threeEnvironmentDesign()) {
    const asked = env => api[call](design, { ...options, env });
    const apart = id => api[call](environmentDesign(design, id), options);
    let refused = null;
    try { asked(4); } catch (err) { refused = err; }
    return [
        [same(api[call](design, options), api[call](oneEnvironmentDesign(design), options)), 'without env it is not the design without environments'],
        [['base', 'env2', 'env3'].every((id, i) => same(asked(i + 1), apart(id)) && same(asked(id), apart(id))), 'an environment by number or id is not its design'],
        [!same(asked(2), asked(1)), 'environment 2 is environment 1'],
        [same(asked('all'), { environments: [{ number: 1, id: 'base', name: 'BK7', ...apart('base') }, { number: 2, id: 'env2', name: 'Sapphire', ...apart('env2') }] }),
            "'all' is not the two environments that are on"],
        [refused?.code === 'unknownEnvironment' && refused.fields?.option === 'env' && refused.fields.environment === 4, 'an environment it does not have is not refused'],
    ].filter(([held]) => !held).map(([, what]) => `${call}: ${what}`);
}
