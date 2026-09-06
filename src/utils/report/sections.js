/**
 * Block builders and their dispatcher.
 *
 * One builder per block type (see ./sections/). Each takes the block context
 * { design, data, block, settings, tr, designName } and returns the HTML for
 * one <section>; the template composes the ordered, enabled blocks. Numeric
 * results come pre-computed from reportData.gatherDesignData, keyed by block
 * id, so builders only format. A builder that throws is caught here and
 * rendered as a note, so one failure never aborts the report.
 *
 * Block types with a comparison form render once for several designs; the
 * rest render per design.
 */

import { blockTitle, errNote, wrap } from './sections/format.js';
import { buildFacts } from './sections/facts.js';
import { buildLayers } from './sections/layers.js';
import { buildMaterials } from './sections/materials.js';
import { buildSpectrum } from './sections/spectrum.js';
import { buildSpectrumComparison } from './sections/spectrumComparison.js';
import { buildEllipsometry } from './sections/ellipsometry.js';
import { buildGdGdd } from './sections/dispersion.js';
import { buildMonteCarlo } from './sections/monteCarlo.js';
import { buildWorksheet } from './sections/worksheet.js';
import {
  buildColor, buildIntegrals, buildQualifiers, buildMerit,
  buildRiProfile, buildEField, buildNotes, buildSignatures,
} from './sections/otherSections.js';
import {
  buildFactsComparison, buildLayersComparison, buildMaterialsComparison,
  buildQualifiersComparison, buildIntegralsComparison, buildColorComparison,
} from './sections/comparison.js';
import { withDefaults } from './blocks.js';

const BUILDERS = {
  facts: buildFacts,
  layers: buildLayers,
  materials: buildMaterials,
  spectrum: buildSpectrum,
  color: buildColor,
  integrals: buildIntegrals,
  qualifiers: buildQualifiers,
  merit: buildMerit,
  riProfile: buildRiProfile,
  efield: buildEField,
  ellipsometry: buildEllipsometry,
  gdGdd: buildGdGdd,
  monteCarlo: buildMonteCarlo,
  worksheet: buildWorksheet,
  notes: buildNotes,
  signatures: buildSignatures,
};

const COMPARISON_BUILDERS = {
  facts: buildFactsComparison,
  layers: buildLayersComparison,
  materials: buildMaterialsComparison,
  spectrum: buildSpectrumComparison,
  qualifiers: buildQualifiersComparison,
  integrals: buildIntegralsComparison,
  color: buildColorComparison,
};

// Rendered once whatever the number of designs.
const ONCE = new Set(['title', 'signatures']);

export function rendersOnce(type) { return ONCE.has(type); }
export function hasComparisonForm(type) { return type in COMPARISON_BUILDERS; }

/** One block's HTML for one design. Returns '' for the title, which is page furniture. */
export function buildBlock(block, ctx) {
  const fn = BUILDERS[block.type];
  if (!fn) return '';
  const settings = withDefaults(block.type, block.settings);
  try { return fn({ ...ctx, block, settings }); }
  catch (e) {
    return wrap(block.type, blockTitle(ctx.tr, block.type, block.type), errNote(e.message || String(e)));
  }
}

/** One block's HTML across several designs, or null when the type has no comparison form. */
export function buildComparisonBlock(block, ctx) {
  const fn = COMPARISON_BUILDERS[block.type];
  if (!fn) return null;
  const settings = withDefaults(block.type, block.settings);
  try { return fn({ ...ctx, block, settings }); }
  catch (e) {
    return wrap(block.type, blockTitle(ctx.tr, block.type, block.type), errNote(e.message || String(e)));
  }
}
