// The plain calls' refusals (src/api) in the object API's words. A plain
// call's refusal names that call and its options, such as setMerit and
// lambdaStart, which a script using the objects never wrote. So each object
// method words the refusals of the calls it makes in its own names: from the
// code and fields a refusal carries (check.js refusal), or, for a refusal
// without them, by giving the method's name in place of the call's at the start.

import { shown } from '../check.js';

const OTHER_SIDE = { front: 'back', back: 'front' };
// What each call that takes env on an entry calls one: setMerit a row,
// setSpecification a check.
const ENTRY_OF = { setMerit: 'row', setSpecification: 'check' };

const orList = items => (items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`);

// A result call's env that names no environment of the design, in the words
// the plain call uses: env takes 'all' as well as an environment.
function unknownEnv(f) {
    const numbers = f.numbers.length === 1 ? '1' : `1 to ${f.numbers.length}`;
    return `env is 'all' or one of the design's environments by its number, ${numbers}, or its id, ${orList(f.ids)}; not ${shown(f.environment)}`;
}

// Each refusal code in the object API's words, from the refusal's fields `f`
// and the words `w` of the method that made the call (worded() below).
const WORDS = {
    unknownOption: (f, w) => `unknown option '${f.option}'; the options are ${[...f.options.filter(option => !w.hidden.includes(option)).map(w.name), ...w.extra].join(', ')}`,
    badValue: (f, w) => `${w.name(f.option)} is ${f.takes}, not ${shown(f.value)}`,
    noMerit: () => 'the design has no merit function; add a row with merit.add()',
    noPulseSpectrum: () => "the design holds no pulse spectrum with light in it; set one with setPulseSpectrum(), or take source 'model'",
    // checkSpecification takes a design whose checks are all disabled, and
    // estimateYield does not.
    noSpecification: f => (f.call === 'checkSpecification'
        ? 'the design has no specification check; add one with specification.add()'
        : 'the design has no enabled specification check; add one with specification.add()'),
    noLayers: f => (f.thin ? 'the design has no layer thicker than 0 nm' : 'the design has no layers; add them with layers.append() or stack()'),
    emptySide: f => `the ${f.side} has no ${['indexProfile', 'electricField', 'roughness'].includes(f.call) ? 'layer thicker than 0 nm' : 'layers'}`,
    noQwot: f => `${f.material} ${f.n === null ? 'resolves to nothing' : `has n = ${f.n} at ${f.wavelength} nm`}, so the layer has no quarter wave; set its thickness in nm`,
    closedSide: f => (f.surfaceMode === 'symmetric'
        ? 'the back of a symmetric design mirrors its front; edit the front'
        : `a design coated on the ${OTHER_SIDE[f.side]} alone and scored on that side does not evaluate the ${f.side}; to edit it, set sides to 'both', or scoreOn to 'whole part'`),
    wavelengthRange: () => 'start and end are wavelengths in nm, 0 < start < end',
    angleRange: f => `start and end are angles of incidence in degrees, 0 <= start < end <= ${f.max}`,
    bandOrder: f => `start ${f.start} is above end ${f.end}`,
    fileExists: f => `${f.path} exists; pass { overwrite: true } to write over it`,
    formulaMedia: () => "the formula names media; write the layers alone, such as '(HL)^5 H', and set the media with incidentMedium, exitMedium and substrate.material",
    unknownEnvironment: f => (f.option === 'env' ? unknownEnv(f)
        : `environment ${shown(f.environment)}: the design has ${f.numbers.length} environment${f.numbers.length === 1 ? '' : 's'}, numbered from 1`),
    baseEnvironment: (f, w) => (f.option
        ? `environment 1 is the design itself and takes name and enabled alone, not ${w.name(f.option)}; set the design's own media and substrate with design.incidentMedium, design.exitMedium and design.substrate`
        : 'environment 1 is the design itself and cannot be removed'),
    oneEnvironment: (f, w) => (Object.hasOwn(ENTRY_OF, f.call)
        ? `the design has one environment, so a ${ENTRY_OF[f.call]} takes no ${w.name(f.option)}; add another with design.environments.add()`
        : `the design has one environment, which holds no ${w.name(f.option)} until another is added; add one with design.environments.add()`),
};

// What the refusal `err` says in the words `w`, or null for an error that is
// no refusal of the call w.call.
function said(err, w) {
    if (Object.hasOwn(WORDS, err?.code) && err.fields) return WORDS[err.code](err.fields, w);
    const text = String(err?.message);
    return err instanceof Error && text.startsWith(`${w.call}: `) ? text.slice(w.call.length + 2) : null;
}

// The refusal `err` in the words `w`, at err's call frames. A promise's
// refusal is worded once the call that made it has returned, so a new error's
// own frames no longer reach the code that made the call, such as the line of
// a Script Console script.
function reworded(err, w) {
    const text = said(err, w);
    if (text === null) return err;
    const message = w.method ? `${w.method}: ${text}` : text;
    const fresh = new Error(message);
    const frames = String(err.stack).split('\n').filter(line => /^\s+at /.test(line));
    fresh.stack = [`Error: ${message}`, ...frames].join('\n');
    return fresh;
}

/**
 * What `run()` returns or resolves to, with a refusal it makes worded by the
 * object API. `words.call` is the plain call run() makes, as its refusals
 * begin, such as `'setLayer'`; `words.method` the object method's name, or
 * none for an attribute's setter, whose refusals name the attribute alone;
 * `words.names` the object's names for the call's options where they differ;
 * `words.hidden` the call's options the method takes as its arguments, which
 * it does not list among its options; `words.extra` the method's options the
 * call does not take, which it lists after the call's.
 */
export function worded(words, run) {
    const w = { method: '', hidden: [], extra: [], ...words, name: option => words.names?.[option] ?? option };
    let out;
    try { out = run(); } catch (err) { throw reworded(err, w); }
    return out instanceof Promise ? out.catch(err => { throw reworded(err, w); }) : out;
}
