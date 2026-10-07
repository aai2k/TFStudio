import { CodevParseError } from './parseError.js';

const notMul = () => new CodevParseError('notMul');

/**
 * A REAL as Fortran writes it. In a G field a three-digit exponent leaves no
 * room for the E, so 0.6133314552-153 is 0.6133314552E-153. D reads as E.
 */
export function fortranReal(text) {
    const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(?:[EeDd]([+-]?\d+)|([+-]\d+))?$/.exec(text);
    if (!match) return NaN;
    const exponent = match[2] ?? match[3];
    return Number(exponent === undefined ? match[1] : `${match[1]}e${exponent}`);
}

/**
 * The shortest decimal within `relTol` of x. The .mul holds most entered
 * values as float32 (1.519999981 for 1.52); this gives back the value as
 * entered whenever it had no more digits than a float32 carries.
 */
export function shortestNear(x, relTol) {
    if (!Number.isFinite(x) || x === 0) return x;
    for (let digits = 1; digits <= 15; digits++) {
        const value = Number(x.toPrecision(digits));
        if (Math.abs(value - x) <= relTol * Math.abs(x)) return value;
    }
    return x;
}

// Ten-character label fields after a ten-character count, going on to the
// next lines when one line does not hold them all.
function readLabels(nextLine) {
    const line = nextLine();
    const count = Number(line.slice(0, 10));
    if (!Number.isInteger(count) || count < 0) throw notMul();
    const labels = [];
    let rest = line.slice(10);
    while (labels.length < count) {
        if (!rest.trim()) rest = nextLine();
        labels.push(rest.slice(0, 10).trim());
        rest = rest.slice(10);
    }
    return labels;
}

/**
 * Line reader for a .mul. Each block of numbers starts on a new line and runs
 * over as many lines as it needs; a block that ends early, holds something
 * other than a number, or a file that ends first, is not a .mul.
 */
export function mulReader(text) {
    const lines = String(text ?? '').split(/\r\n|\r|\n/);
    let at = 0;
    const nextLine = () => {
        if (at >= lines.length) throw notMul();
        return lines[at++];
    };
    function block(count, parse) {
        const values = [];
        while (values.length < count) {
            const fields = nextLine().trim().split(/\s+/).filter(Boolean);
            if (!fields.length) throw notMul();
            values.push(...fields.map(parse));
        }
        if (values.length !== count || !values.every(Number.isFinite)) throw notMul();
        return values;
    }
    return {
        line: nextLine,
        ints: (count) => block(count, field => (/^[+-]?\d+$/.test(field) ? Number(field) : NaN)),
        reals: (count) => block(count, fortranReal),
        labels: () => readLabels(nextLine),
    };
}
