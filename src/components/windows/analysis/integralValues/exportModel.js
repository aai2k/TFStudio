/**
 * The results table as plain rows, for the export control. The table on screen
 * is rendered by ResultsTable; this is the same data in the shape `csvFromRows`
 * writes.
 */

function band(weighting, units) {
    return weighting.lamMin === weighting.lamMax
        ? ''
        : `${weighting.lamMin.toFixed(0)}-${weighting.lamMax.toFixed(0)} ${units.nm}`;
}

/** The CSV's columns; under All (`sets`) each row's environment follows the integral. */
export function exportColumns(t, sets = null) {
    const iv = t.integralValues;
    return [
        { key: 'label', label: iv.col_integral },
        ...(sets ? [{ key: 'env', label: t.environments.environment }] : []),
        { key: 'value', label: iv.col_value },
        { key: 'percent', label: '%' },
        { key: 'min', label: iv.col_min },
        { key: 'lamAtMin', label: `${iv.col_min} λ (${t.units.nm})` },
        { key: 'max', label: iv.col_max },
        { key: 'lamAtMax', label: `${iv.col_max} λ (${t.units.nm})` },
        { key: 'band', label: iv.col_band },
    ];
}

// A number the integral could not give, such as the value of a band the
// spectrum does not cover, is an empty cell rather than NaN.
const finiteOrNull = value => (Number.isFinite(value) ? value : null);

function exportRow(definition, result = {}, units) {
    const value = finiteOrNull(result.value);
    return {
        label: definition.label,
        value,
        percent: value === null ? null : value * 100,
        min: finiteOrNull(result.min),
        lamAtMin: finiteOrNull(result.lamAtMin),
        max: finiteOrNull(result.max),
        lamAtMax: finiteOrNull(result.lamAtMax),
        band: band(definition.weighting, units),
    };
}

/**
 * The rows: one per integral from `results`, or under All, when `results` is
 * the list of each environment's `{ env, results }`, one per integral and
 * environment, the environment's rows of an integral together.
 */
export function exportRows(integrals, results, units) {
    if (!results) return [];
    if (Array.isArray(results)) {
        return (integrals || []).flatMap(definition => results.map(set => ({
            ...exportRow(definition, set.results[definition.key], units), env: set.env.label,
        })));
    }
    return (integrals || []).map(definition => exportRow(definition, results[definition.key], units));
}
