/**
 * Grouping of repeated periods in a layer list.
 *
 * Two layers match when their material and their thickness printed to the
 * given precision are equal, so a refined stack whose thicknesses differ in
 * the last printed digit still prints every layer. A period of one to four
 * layers repeated at least twice, covering at least four layers, becomes one
 * group; everything else stays a single row.
 */

const MAX_PERIOD = 4;
const MIN_COVERED = 4;

function samePeriod(keys, a, b, p) {
  for (let j = 0; j < p; j++) if (keys[a + j] !== keys[b + j]) return false;
  return true;
}

/** How many times the period of length `p` at `start` repeats back to back. */
function repeatsOf(keys, start, p) {
  let r = 1;
  while (start + (r + 1) * p <= keys.length && samePeriod(keys, start, start + r * p, p)) r++;
  return r;
}

/** The period at `start` covering the most layers, or null when none qualifies. */
function bestPeriod(keys, start) {
  let best = null;
  for (let p = 1; p <= MAX_PERIOD && start + 2 * p <= keys.length; p++) {
    const r = repeatsOf(keys, start, p);
    const qualifies = r >= 2 && r * p >= MIN_COVERED;
    if (qualifies && (!best || r * p > best.r * best.p)) best = { p, r };
  }
  return best;
}

/**
 * Consecutive layers merged into groups.
 *
 * @param {{ index, material, thickness }[]} rows  layers in table order
 * @param {number} prec  decimals the thickness is printed with
 * @returns {{ from, to, period: object[], repeats }[]}  `from`/`to` are layer numbers
 */
export function groupPeriods(rows, prec = 2) {
  const keys = rows.map(r => `${r.material}|${Number(r.thickness).toFixed(prec)}`);
  const out = [];
  let i = 0;
  while (i < rows.length) {
    const best = bestPeriod(keys, i) || { p: 1, r: 1 };
    const span = best.p * best.r;
    out.push({ from: rows[i].index, to: rows[i + span - 1].index, period: rows.slice(i, i + best.p), repeats: best.r });
    i += span;
  }
  return out;
}
