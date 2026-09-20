/**
 * Material Editor — the thermo-mechanical block of a draft.
 *
 * The form holds every constant as a string in the unit it shows, which for
 * the two temperature coefficients is not the unit the record stores. This is
 * the only place that difference lives, and the only place that decides what a
 * blank field means: unknown, never zero.
 */

import {
    MECHANICAL_FIELDS, mechanicalBoundViolation,
    mechanicalFromDisplay, mechanicalToDisplay, normalizeMechanical,
} from '../../../../utils/materials/mechanical.js';
import { parseNumberStrict } from '../../../../utils/misc/numberParsing.js';

/** One blank field per constant: the form state of a material carrying none. */
export function emptyMechanicalDraft() {
    return Object.fromEntries(MECHANICAL_FIELDS.map(field => [field, '']));
}

/** A stored block as the form shows it, blank where the material is silent. */
export function mechanicalToDraft(block) {
    const stored = normalizeMechanical(block) || {};
    return Object.fromEntries(MECHANICAL_FIELDS.map(field => [
        field,
        field in stored ? String(mechanicalToDisplay(field, stored[field])) : '',
    ]));
}

/** The typed fields as the record stores them, or undefined when none are. */
export function mechanicalFromDraft(block) {
    const stored = {};
    for (const field of MECHANICAL_FIELDS) {
        const typed = parseNumberStrict(block?.[field]);
        if (Number.isFinite(typed)) stored[field] = mechanicalFromDisplay(field, typed);
    }
    return normalizeMechanical(stored);
}

/**
 * Why the block cannot be saved, or null.
 *
 * A field holding something that is not a number is reported rather than
 * dropped: dropping it would save a material the user believes carries a value
 * it does not.
 */
export function validateMechanical(block, me) {
    const unreadable = MECHANICAL_FIELDS.find(field =>
        String(block?.[field] ?? '').trim() !== '' && !Number.isFinite(parseNumberStrict(block[field])));
    if (unreadable) return me.validationMechanicalNumber(me.mechanicalFields[unreadable]);
    const violated = mechanicalBoundViolation(mechanicalFromDraft(block));
    return violated
        ? me.validationMechanicalBound(me.mechanicalFields[violated.field], me.mechanicalBounds[violated.reason])
        : null;
}
