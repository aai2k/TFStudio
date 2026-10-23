// The refusals a run (Refinement, Needle, Gradual Evolution, Structural, Deep
// Synthesis) makes of its settings. Each carries the code and fields of the
// API's own refusals (src/api/check.js refusal), so the object API words it in
// the names a script wrote, such as max_layers in Python. `run` begins the
// message, such as 'Needle settings'.

/** The refusal of `key`, a setting the run does not take; `known` holds the settings it takes. */
export function unknownSetting(run, key, known) {
    // The pool is the API call's own argument and history is the window's, so
    // neither is listed among the settings a script gives.
    const options = [...known].filter(name => name !== 'pool' && name !== 'history');
    return Object.assign(new Error(`${run}: unknown setting '${key}'`), { code: 'unknownOption', fields: { call: run, option: key, options } });
}

/** The refusal of `value`, which the setting `key` cannot take; `takes` says what it takes. */
export function badSetting(run, key, takes, value) {
    return Object.assign(new Error(`${run}: ${key} is ${takes}`), { code: 'badValue', fields: { call: run, option: key, takes, value } });
}
