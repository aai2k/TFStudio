import { materialLabel } from '../../../../utils/materials/catalogManager.js';
import {
    COATING_TAGS, bandsText, entrySpecResults, tagGroupOf, totalThickness,
} from '../../../../utils/coatingLibrary/entryModel.js';
import { entryMetrics } from '../../../../utils/coatingLibrary/entryProperties.js';
import { validateEntry } from '../../../../utils/coatingLibrary/validateEntry.js';
import { PreviewPlot } from './PreviewPlot.js';
import { StackStrip, entryMaterialColors } from './StackStrip.js';
import { Chip, KeyValue, SectionTitle, TAG_GROUP_COLORS, TypeBadge, angleText, percent } from './ui.js';

const { createElement: h, useMemo } = React;

function Swatch({ color, c }) {
    return h('span', {
        style: {
            display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 6,
            verticalAlign: 'middle', background: color || c.textDim, border: `1px solid ${c.border}`,
        },
    });
}

const cellStyle = (c, align = 'left') => ({
    padding: '3px 8px', fontSize: 12, textAlign: align, borderBottom: `1px solid ${c.border}`,
    fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
});

// Substrate at the top, layer 1 next, the incident medium at the bottom: the
// same orientation as the Design Editor.
function StackTable({ entry, c, ts }) {
    const colors = useMemo(() => entryMaterialColors(entry), [entry]);
    return h('table', { style: { borderCollapse: 'collapse', width: '100%', maxWidth: 420 } },
        h('thead', null, h('tr', null,
            h('th', { style: { ...cellStyle(c, 'right'), color: c.textDim, fontWeight: 500 } }, ts.layerNo),
            h('th', { style: { ...cellStyle(c), color: c.textDim, fontWeight: 500 } }, ts.material),
            h('th', { style: { ...cellStyle(c, 'right'), color: c.textDim, fontWeight: 500 } }, ts.thicknessNm))),
        h('tbody', null,
            h('tr', null,
                h('td', { style: cellStyle(c) }),
                h('td', { colSpan: 2, style: { ...cellStyle(c), color: c.textDim, fontStyle: 'italic' } },
                    h(Swatch, { color: colors.get(entry.substrate), c }),
                    `${ts.substrate}: ${materialLabel(entry.substrate)}`)),
            entry.layers.map((layer, i) => h('tr', { key: i },
                h('td', { style: { ...cellStyle(c, 'right'), color: c.textDim } }, i + 1),
                h('td', { style: cellStyle(c) },
                    h(Swatch, { color: colors.get(layer.material), c }),
                    materialLabel(layer.material)),
                h('td', { style: cellStyle(c, 'right') }, layer.thickness.toFixed(2)))),
            h('tr', null,
                h('td', { style: cellStyle(c) }),
                h('td', { colSpan: 2, style: { ...cellStyle(c), color: c.textDim, fontStyle: 'italic' } },
                    `${ts.incidentMedium}: ${materialLabel(entry.incidentMedium)}`))));
}

function Paragraph({ c, children }) {
    return h('div', { style: { fontSize: 12, lineHeight: 1.45, color: c.text, whiteSpace: 'pre-wrap' } }, children);
}

// "Rs avg", "T FWHM": the channel with its polarization, then the statistic.
function metricLabel(row, ts) {
    const channel = row.pol === 's' || row.pol === 'p' ? `${row.channel}${row.pol}` : row.channel;
    return `${channel} ${ts.stats[row.stat]}`;
}

function metricValue(row, value) {
    if (value == null || !Number.isFinite(value)) return '?';
    if (row.unit === '%') return percent(value);
    if (row.unit === 'nm') return `${value.toFixed(value < 100 ? 2 : 1)} nm`;
    return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} : 1`;
}

// The numbers that matter for this family (PROPERTY_SETS): one column per
// design band for the band statistics, then the whole-coating figures such as
// an edge wavelength or a passband width.
function Properties({ entry, metrics, c, ts }) {
    if (metrics.error) return null;
    const head = (key, text, align) => h('th', {
        key, style: { ...cellStyle(c, align), color: c.textDim, fontWeight: 500 },
    }, text);
    return h('div', null,
        h('table', { style: { borderCollapse: 'collapse', maxWidth: 520 } },
            h('thead', null, h('tr', null,
                head('metric', '', 'left'),
                metrics.bands.map((band, i) => head(i, `${band[0]}-${band[1]} nm`, 'right')))),
            h('tbody', null, metrics.rows.map((row, r) => h('tr', { key: r },
                h('td', { style: { ...cellStyle(c), color: c.textDim } }, metricLabel(row, ts)),
                row.values.map((value, i) => h('td', { key: i, style: cellStyle(c, 'right') }, metricValue(row, value))))))),
        h('div', { style: { maxWidth: 420, marginTop: 6 } },
            metrics.shape.map((row, i) => h(KeyValue, { key: i, label: metricLabel(row, ts), value: metricValue(row, row.value), c })),
            h(KeyValue, { label: ts.layerCount, value: String(entry.layers.length), c }),
            h(KeyValue, { label: ts.totalThickness, value: `${totalThickness(entry).toFixed(1)} nm`, c })));
}

function Tags({ entry, c }) {
    if (entry.tags.length === 0) return null;
    return h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 } },
        entry.tags.map(tag => h(Chip, {
            key: tag, label: tag, c, title: COATING_TAGS[tag] || tag,
            color: TAG_GROUP_COLORS[tagGroupOf(tag)] || TAG_GROUP_COLORS.context,
        })));
}

function SpecList({ spec, c, ts }) {
    if (spec.qualifiers.length === 0) {
        return h('div', { style: { fontSize: 12, color: c.textDim, fontStyle: 'italic' } }, ts.noSpec);
    }
    // Every claim states its own angle and polarization, since a beamsplitter
    // or polarizer is specified by s and p claims at one angle and a claim's
    // angle is what its number means.
    return h('div', { style: { maxWidth: 480 } }, spec.qualifiers.map((qualifier, i) => {
        const result = spec.results[i];
        const label = qualifier.label || `${qualifier.kind} ${qualifier.channel || ''}`.trim();
        return h('div', {
            key: qualifier.id,
            style: { display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 12, padding: '2px 0' },
        },
            h('span', {
                style: { color: result?.pass ? c.success : c.error, fontWeight: 600, minWidth: 34 },
            }, result?.pass ? ts.pass : ts.fail),
            h('span', { style: { color: c.textDim, flex: 1 } }, label),
            h('span', { style: { color: c.textDim, fontVariantNumeric: 'tabular-nums', minWidth: 44, textAlign: 'right' } },
                angleText(qualifier, ts)),
            h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, result?.summary || ''));
    }));
}

export function EntryDetail({ entry, c, ts }) {
    const problems = useMemo(() => validateEntry(entry), [entry]);
    const metrics = useMemo(() => (problems.length ? { error: problems[0] } : entryMetrics(entry)), [entry, problems]);
    const spec = useMemo(() => entrySpecResults(entry), [entry]);
    const pol = ts.pols[entry.polarization] || entry.polarization;

    return h('div', { style: { padding: '10px 14px 18px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            h('span', { style: { fontSize: 15, fontWeight: 600, color: c.text } }, entry.name),
            h(TypeBadge, { type: entry.type, ts })),
        h('div', { style: { fontSize: 12, color: c.text, marginTop: 4 } },
            h('span', { style: { color: c.textDim } }, `${ts.aoi} `),
            h('span', { style: { fontWeight: 600 } }, `${entry.aoi}°`),
            h('span', { style: { color: c.textDim } }, ` · ${ts.polarization} `),
            h('span', { style: { fontWeight: 600 } }, pol),
            h('span', { style: { color: c.textDim } },
                ` · ${ts.band} ${bandsText(entry)} · ${ts.layersShort(entry.layers.length)}`
                + ` · ${ts.referenceWavelength} ${entry.referenceWavelength} nm`)),
        h('div', { style: { margin: '8px 0 2px', maxWidth: 520 } }, h(StackStrip, { entry, c, height: 10 })),
        h(Tags, { entry, c }),

        problems.length > 0 && h('div', null,
            h(SectionTitle, { c }, ts.problemsHeading),
            problems.map((problem, i) => h('div', { key: i, style: { fontSize: 12, color: c.error } }, problem))),

        entry.use && h('div', null, h(SectionTitle, { c }, ts.useHeading), h(Paragraph, { c }, entry.use)),
        entry.limitations && h('div', null, h(SectionTitle, { c }, ts.limitationsHeading), h(Paragraph, { c }, entry.limitations)),

        h(SectionTitle, { c }, ts.previewHeading),
        h(PreviewPlot, { entry, c, ts }),

        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0 40px' } },
            h('div', null,
                h(SectionTitle, { c }, ts.stackHeading),
                h(StackTable, { entry, c, ts })),
            h('div', { style: { minWidth: 260, flex: 1 } },
                h(SectionTitle, { c }, `${ts.propertiesHeading} · ${angleText(entry, ts)}`),
                h(Properties, { entry, metrics, c, ts }),
                h(SectionTitle, { c }, ts.specHeading),
                h(SpecList, { spec, c, ts }))),

        entry.source && h('div', null, h(SectionTitle, { c }, ts.sourceHeading),
            h('div', { style: { fontSize: 11, color: c.textDim, lineHeight: 1.45, whiteSpace: 'pre-wrap' } }, entry.source)));
}
