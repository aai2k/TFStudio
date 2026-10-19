// Checks a tool call's arguments against the part of JSON Schema the tool
// definitions use: type (one or a list), properties, required,
// additionalProperties: false, enum and items. A misspelt argument is refused
// rather than ignored, so a call never runs on a default the caller did not
// mean.

const isRecord = v => !!v && typeof v === 'object' && !Array.isArray(v);

const TYPES = {
    object: isRecord,
    array: Array.isArray,
    string: v => typeof v === 'string',
    number: v => typeof v === 'number' && Number.isFinite(v),
    integer: Number.isInteger,
    boolean: v => typeof v === 'boolean',
    null: v => v === null,
};

function typeProblem(schema, value, at) {
    if (!schema.type) return null;
    const types = [].concat(schema.type);
    return types.some(type => TYPES[type](value)) ? null : `${at} is ${types.join(' or ')}, not ${JSON.stringify(value)}`;
}

function objectProblem(schema, value, at) {
    const properties = schema.properties || {};
    const missing = (schema.required || []).find(key => !Object.hasOwn(value, key));
    if (missing) return `${at}.${missing} is required`;
    if (schema.additionalProperties === false) {
        const unknown = Object.keys(value).find(key => !Object.hasOwn(properties, key));
        if (unknown) return `${at}.${unknown} is not an argument here; the arguments are ${Object.keys(properties).join(', ') || 'none'}`;
    }
    for (const [key, item] of Object.entries(value)) {
        const inner = (Object.hasOwn(properties, key) && properties[key]) || (isRecord(schema.additionalProperties) ? schema.additionalProperties : null);
        const problem = inner && problemAt(inner, item, `${at}.${key}`);
        if (problem) return problem;
    }
    return null;
}

function problemAt(schema, value, at) {
    const problem = typeProblem(schema, value, at);
    if (problem) return problem;
    if (schema.enum && !schema.enum.includes(value)) return `${at} is one of ${schema.enum.join(', ')}, not ${JSON.stringify(value)}`;
    if (isRecord(value)) return objectProblem(schema, value, at);
    if (Array.isArray(value) && schema.items) {
        for (let i = 0; i < value.length; i++) {
            const inner = problemAt(schema.items, value[i], `${at}[${i}]`);
            if (inner) return inner;
        }
    }
    return null;
}

/** The first way `args` do not fit `schema`, as a sentence, or null when they fit. */
export function checkArguments(schema, args) {
    return problemAt(schema, args, 'arguments');
}
