/**
 * Report section catalogue and dispatcher.
 *
 * One builder per section (see ./sections/). Each takes a context
 * { design, data, opts, tr } (tr = the `t.report` locale object) and returns an
 * HTML string for a single <section>; the template composes the ordered, enabled
 * sections. Numeric results come pre-computed from reportData.gatherDesignData —
 * builders only format. A builder that throws is caught here and rendered as a
 * small note, so one failure never aborts the report.
 */

import { sectionTitle, errNote, wrap } from './sections/format.js';
import { buildDesignSummary, buildOptical } from './sections/summaryOptical.js';
import {
  buildColor, buildIntegrals, buildQualifiers, buildMerit,
  buildRiProfile, buildEField, buildEllipsometry, buildNotes,
} from './sections/otherSections.js';

// ── Section catalogue (id → default order / title key) ──────────────────────
// `dataKey` names the gatherDesignData field a section consumes (if any).
export const REPORT_SECTIONS = [
  { id: 'cover',           dataKey: null,            defaultOn: true },
  { id: 'design-summary',  dataKey: 'summary',       defaultOn: true },
  { id: 'optical-eval',    dataKey: 'spectrum',      defaultOn: true },
  { id: 'color-eval',      dataKey: 'color',         defaultOn: false },
  { id: 'ri-profile',      dataKey: 'riProfile',     defaultOn: false },
  { id: 'efield',          dataKey: 'efield',        defaultOn: false },
  { id: 'ellipsometry',    dataKey: 'ellipsometry',  defaultOn: false },
  { id: 'integral-values', dataKey: 'integrals',     defaultOn: false },
  { id: 'qualifiers',      dataKey: 'qualifiers',    defaultOn: false },
  { id: 'merit-function',  dataKey: 'merit',         defaultOn: false },
  { id: 'notes',           dataKey: null,            defaultOn: false },
];

const BUILDERS = {
  'design-summary': buildDesignSummary,
  'optical-eval':   buildOptical,
  'color-eval':     buildColor,
  'integral-values':buildIntegrals,
  'qualifiers':     buildQualifiers,
  'merit-function': buildMerit,
  'ri-profile':     buildRiProfile,
  'efield':         buildEField,
  'ellipsometry':   buildEllipsometry,
  'notes':          buildNotes,
};

/** Build one section's HTML. Returns '' for unknown / cover (cover is template). */
export function buildSection(id, ctx) {
  const fn = BUILDERS[id];
  if (!fn) return '';
  try { return fn(ctx); }
  catch (e) { return wrap(id, sectionTitle(ctx.tr, id, id), errNote(e.message || String(e))); }
}
