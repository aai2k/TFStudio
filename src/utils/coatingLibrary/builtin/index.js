/**
 * The coating library shipped with TFStudio.
 *
 * One file per coating family. Every entry uses materials that resolve on any
 * installation (built-in ids, or a definition embedded in the entry), records
 * where the design came from, and carries a specification that
 * tests/coating_library_builtin.mjs evaluates on every run, so a change in
 * material data or in the solver cannot spoil an entry unnoticed.
 *
 * Entry fields and the layer-order convention are documented in
 * ../entryModel.js.
 */
import { makeCoatingEntry } from '../entryModel.js';
import { ANTIREFLECTION } from './antireflection.js';
import { MIRRORS } from './mirrors.js';
import { EDGE_AND_NOTCH_FILTERS } from './edgeAndNotchFilters.js';
import { BANDPASS } from './bandpass.js';
import { BEAMSPLITTERS_AND_POLARIZERS } from './beamsplittersAndPolarizers.js';
import { DICHROICS } from './dichroics.js';
import { LOW_E } from './lowE.js';
import { CHIRPED } from './chirped.js';
import { OTHER } from './other.js';

export const BUILTIN_COATINGS = [
    ...ANTIREFLECTION,
    ...MIRRORS,
    ...EDGE_AND_NOTCH_FILTERS,
    ...BANDPASS,
    ...BEAMSPLITTERS_AND_POLARIZERS,
    ...DICHROICS,
    ...LOW_E,
    ...CHIRPED,
    ...OTHER,
].map(raw => Object.freeze(makeCoatingEntry(raw)));
