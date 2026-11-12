import { buildTableColumns } from './model.js';
import { formatYCell } from './yScale.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import { RESULT_ROW_HEIGHT } from '../../../ui/ResultsSection.js';
import { useSteadyColumns, useVirtualRows, virtualBody } from '../../../ui/virtualRows.js';
import {
    SPECTRAL_UNITS, fromNm, spectralDecimals, spectralSymbol,
} from '../../../../utils/physics/spectralAxis.js';

const { createElement: h } = React;

// One row per wavelength, drawn only while in view: nothing limits how many
// wavelengths a range and step ask for. The first column reads in the unit the
// plot is labelled in.
export function DataTable({ data, showCurves, yScale, spectralUnit, units, c, oe }) {
    const unit = SPECTRAL_UNITS[spectralUnit] ? spectralUnit : 'nm';
    const curveColors = useAnalysisColors('opticalEvaluation');
    const columns = buildTableColumns(data, showCurves, curveColors, yScale, oe.curveLabels);
    const view = useVirtualRows(data.lambda.length, RESULT_ROW_HEIGHT);
    const heading = oe.spectralColumn(spectralSymbol(unit), units[unit]);
    const widths = useSteadyColumns([heading, ...columns.map(column => column.label)]);
    const decimals = spectralDecimals(data.lambda.slice(0, 2).map(nm => fromNm(nm, unit)));
    const thBase = {
        padding: '3px 8px', fontWeight: 600, fontSize: 11,
        borderBottom: `1px solid ${c.border}`,
        position: 'sticky', top: 0, backgroundColor: c.panel,
        userSelect: 'none', whiteSpace: 'nowrap'
    };
    const tdBase = {
        padding: '2px 8px', fontSize: 11,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap'
    };
    const body = virtualBody(data.lambda, view, RESULT_ROW_HEIGHT, columns.length + 1, (lambda, index) =>
        h('tr', {
            key: index,
            style: { height: RESULT_ROW_HEIGHT, backgroundColor: index % 2 === 0 ? 'transparent' : c.panel + '55' }
        },
            h('td', { style: { ...tdBase, textAlign: 'left', color: c.textDim } },
                widths.fit(0, fromNm(lambda, unit).toFixed(decimals))),
            ...columns.map((column, columnIndex) =>
                h('td', { key: columnIndex, style: { ...tdBase, textAlign: 'right', color: c.text } },
                    widths.fit(columnIndex + 1, formatYCell(yScale, column.ys[index]))
                )
            )
        )
    );
    return h('div', {
        ref: view.paneRef, onScroll: view.onScroll,
        style: {
            height: 185, overflowY: 'auto', overflowX: 'auto',
            backgroundColor: c.bg,
            flexShrink: 0
        }
    },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'auto', fontSize: 11 } },
            widths.colgroup(),
            h('thead', null,
                h('tr', null,
                    h('th', { style: { ...thBase, textAlign: 'left', color: c.textDim } }, heading),
                    ...columns.map((column, index) =>
                        h('th', { key: index, style: { ...thBase, textAlign: 'right', color: column.color } }, column.label)
                    )
                )
            ),
            h('tbody', null, body)
        )
    );
}
