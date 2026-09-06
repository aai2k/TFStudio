/**
 * Design facts block: one line of facts and the stack cross-section.
 *
 * The facts strip replaces a six-row key/value table. The stack diagram draws
 * the coating the way the Design Editor does, incident medium on the left, and
 * elides the middle of a long coating so the surviving blocks keep a readable
 * width and their material color.
 */

import { escapeHtml } from '../svgChart.js';
import { num, tt, blockTitle, errNote, wrap } from './format.js';

// Past this many layers a coating draws its first and last ELIDED_ENDS layers
// with one marker between, the same rule as the Design Editor's diagram.
const ELIDE_ABOVE = 20;
const ELIDED_ENDS = 8;

const LAYER_W = 9, GAP = 1, SUBSTRATE_W = 64, MARKER_W = 34, MEDIUM_W = 30, H = 26;

function coatingBlocks(layers) {
  if (layers.length <= ELIDE_ABOVE) return layers.map(l => ({ kind: 'layer', color: l.color }));
  const hidden = layers.length - 2 * ELIDED_ENDS;
  return [
    ...layers.slice(0, ELIDED_ENDS).map(l => ({ kind: 'layer', color: l.color })),
    { kind: 'marker', label: `+${hidden}` },
    ...layers.slice(-ELIDED_ENDS).map(l => ({ kind: 'layer', color: l.color })),
  ];
}

/**
 * Cross-section of the whole system as inline SVG: incident medium, front
 * coating (incident side first), substrate, back coating, exit medium.
 * `summary.front` is numbered from the substrate, so it is reversed for drawing.
 */
export function stackDiagramSVG(summary) {
  const items = [
    { kind: 'medium', label: summary.incidentMedium },
    ...coatingBlocks([...summary.front].reverse()),
    { kind: 'substrate', label: summary.substrate, color: summary.substrateColor },
    ...coatingBlocks(summary.back),
    { kind: 'medium', label: summary.exitMedium },
  ];
  const widthOf = item => item.kind === 'layer' ? LAYER_W : item.kind === 'marker' ? MARKER_W
    : item.kind === 'substrate' ? SUBSTRATE_W : MEDIUM_W;
  const total = items.reduce((sum, item) => sum + widthOf(item) + GAP, -GAP);
  const parts = [`<svg class="tf-stack" viewBox="0 0 ${total} ${H}" width="${total}" height="${H}" xmlns="http://www.w3.org/2000/svg">`];
  let x = 0;
  for (const item of items) {
    const w = widthOf(item);
    if (item.kind === 'layer') {
      parts.push(`<rect x="${x}" y="0" width="${w}" height="${H}" fill="${escapeHtml(item.color || '#999')}"></rect>`);
    } else if (item.kind === 'marker') {
      parts.push(`<rect x="${x + 0.5}" y="0.5" width="${w - 1}" height="${H - 1}" fill="none" stroke="#888" stroke-dasharray="3 2"></rect>`);
      parts.push(`<text x="${x + w / 2}" y="${H / 2 + 3.5}" text-anchor="middle" font-size="9" fill="#444">${escapeHtml(item.label)}</text>`);
    } else if (item.kind === 'substrate') {
      parts.push(`<rect x="${x}" y="0" width="${w}" height="${H}" fill="${escapeHtml(item.color || '#ccc')}" fill-opacity="0.3" stroke="#999"></rect>`);
      parts.push(`<text x="${x + w / 2}" y="${H / 2 + 3.5}" text-anchor="middle" font-size="9" fill="#333">${escapeHtml(String(item.label || '').slice(0, 10))}</text>`);
    } else {
      parts.push(`<text x="${x + w / 2}" y="${H / 2 + 3.5}" text-anchor="middle" font-size="9" fill="#777">${escapeHtml(String(item.label || '').slice(0, 6))}</text>`);
    }
    x += w + GAP;
  }
  parts.push('</svg>');
  return `<div class="tf-stackwrap">${parts.join('')}</div>`;
}

/** The facts strip: bold key, value, separated by dots, wrapping as needed. */
export function factsStrip(pairs) {
  return `<p class="tf-facts">` + pairs.map(([k, v]) =>
    `<span><b>${escapeHtml(k)}</b> ${v}</span>`).join('') + `</p>`;
}

export function factPairs(summary, evalMode, tr) {
  const L = tr || {};
  const modes = L.evalModes || {};
  const substrate = escapeHtml(summary.substrate)
    + (summary.substrateThickness != null ? `, ${num(summary.substrateThickness, 2)} mm` : '');
  const layers = `${summary.frontCount}${summary.backCount ? ' + ' + summary.backCount : ''}`;
  const total = summary.backCount
    ? `${num(summary.frontThickness, 1)} + ${num(summary.backThickness, 1)} nm`
    : `${num(summary.frontThickness, 1)} nm`;
  return [
    [tt(L, 'substrate', 'Substrate'), substrate],
    [tt(L, 'incidentMedium', 'Incident'), escapeHtml(summary.incidentMedium)],
    [tt(L, 'exitMedium', 'Exit'), escapeHtml(summary.exitMedium)],
    ['λref', `${num(summary.referenceWavelength, 0)} nm`],
    [tt(L, 'layerCount', 'Layers'), layers],
    [tt(L, 'totalThickness', 'Total'), total],
    [tt(L, 'evaluation', 'Evaluation'), escapeHtml(modes[evalMode] || evalMode)],
  ];
}

export function buildFacts({ data, settings, tr }) {
  const s = data.summary;
  const title = blockTitle(tr, 'facts', 'Design facts');
  if (!s) return wrap('facts', title, errNote('no design data'));
  const inner = factsStrip(factPairs(s, data.evalMode, tr))
    + (settings.stackDiagram ? stackDiagramSVG(s) : '');
  return wrap('facts', title, inner);
}
