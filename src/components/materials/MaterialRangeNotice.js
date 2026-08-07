/**
 * Warning shown when an analysis window evaluates outside the declared data
 * range of a material the design uses.
 *
 * Deliberately non-blocking, unlike MissingMaterialsNotice: an out-of-range
 * wavelength still produces a result, it just produces one from a clamped or
 * extrapolated optical constant. Gating the window would hide a spectrum the
 * user may well want to see; the banner says what part of it to distrust.
 */
import { designRangeCoverage } from '../../utils/materials/materialRange.js';

const { createElement: h, useMemo } = React;

const format = (value) => (Math.round(value * 10) / 10).toString();

function OffenderList({ offenders, c, t }) {
    const lines = offenders.map(({ id, name, rangeNm }) =>
        t.materialRange.materialLine(name || id, format(rangeNm[0]), format(rangeNm[1])));
    return h('div', {
        style: {
            color: c.textDim, fontSize: 11, lineHeight: 1.4,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        },
        title: lines.join('\n'),
    }, lines.join('   '));
}

export function MaterialRangeBanner({ offenders, evaluated, c, t }) {
    if (!offenders?.length) return null;
    const accent = c.warning || c.error;
    return h('div', {
        role: 'alert',
        'data-material-range': 'warning',
        style: {
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '6px 10px', flexShrink: 0,
            borderBottom: `1px solid ${accent}`,
            backgroundColor: accent + '14', color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif',
        },
    },
        h('span', { style: { color: accent, fontSize: 15, flexShrink: 0 } }, '⚠'),
        h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { fontSize: 12, fontWeight: 600 } },
                t.materialRange.banner(offenders.length,
                    format(evaluated[0]), format(evaluated[1]))),
            h(OffenderList, { offenders, c, t })),
    );
}

/**
 * The banner for one window, wired to the design. Renders nothing when every
 * material covers the range, or when no material declares one.
 *
 * @param {number} fromNm start of the evaluated range, in nm
 * @param {number} toNm   end of the evaluated range, in nm
 */
export function MaterialRangeWarning({ design, fromNm, toNm, c, t }) {
    const { offenders } = useMemo(
        () => designRangeCoverage(design, [fromNm, toNm]),
        [design, fromNm, toNm],
    );
    return h(MaterialRangeBanner, { offenders, evaluated: [fromNm, toNm], c, t });
}
