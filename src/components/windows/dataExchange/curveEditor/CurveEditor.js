/**
 * The curve editor: a curve's points in a table on one side and plotted on
 * the other, split by a divider, over the window that opened it.
 *
 * Measured Spectra and Measured Ellipsometry open it for a new curve or for
 * one on the design, and Integral Values for a source or detector table. It
 * edits points only. A new curve's conditions, its angle, polarization, side
 * and Δ sign, are set on its card after Apply, as an imported curve's are.
 *
 * Props:
 *   title       the dialog's title
 *   table       the table it opens with (curveTable.js): emptyTable(kind) for
 *               a new curve, tableFromCurve(curve, kind) for one on the
 *               design, tableFromWeights(rows) for a weighting
 *   conditions  what the design's own curve is drawn at, the curve's own or
 *               NEW_CURVE_CONDITIONS (designBackdrop.js)
 *   design      the design drawn behind the points; none for a weighting
 *   blockCount  merit blocks built from the curve, which Apply offers to rebuild
 *   onApply(table, { rebuild })  the table, rows by wavelength; curveApply.js
 *               turns it into curves or a weighting
 *   onCancel()
 *
 * It does not close on a click outside it: a table typed by hand is not
 * something to lose to a stray click.
 */
import { SplitPane } from '../../../docking/SplitPane.js';
import { ExportMenu, useCsvExport } from '../../../ui/ExportMenu.js';
import { tablerIcon } from '../../../ui/tablerIcons.js';
import { useUnresolvedMaterials } from '../../../../utils/materials/useUnresolvedMaterials.js';
import { ActionButton, CheckField } from '../../analysis/chrome/controls.js';
import { CurveChart } from './CurveChart.js';
import { CurveGrid } from './CurveGrid.js';
import { backdropKey, designBackdrop } from './designBackdrop.js';
import { EditorToolbar } from './EditorToolbar.js';
import { editorLabels } from './editorLabels.js';
import { editorNotices } from './editorNotices.js';
import { tableCsv } from './tableText.js';
import { useCurveEditor } from './useCurveEditor.js';

const { createElement: h, useMemo } = React;

const SPLIT_CHILDREN = [{ id: 'curve-table' }, { id: 'curve-plot' }];

const TONE_COLOR = { error: c => c.error || '#ef5350', warning: c => c.warning || '#d9a441', info: c => c.textDim };

function Notices({ notices, c }) {
    return h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 } },
        notices.map((notice, index) => h('div', {
            key: index, role: notice.tone === 'error' ? 'alert' : 'status',
            style: { color: TONE_COLOR[notice.tone](c), fontSize: 11, lineHeight: 1.4 },
        }, notice.text)));
}

function Footer({ editor, props, notices, c, ce, dt }) {
    const csv = useCsvExport(() => tableCsv(editor.table), () => 'curve.csv');
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
            borderTop: `1px solid ${c.border}`, flexShrink: 0,
        },
    },
        h(ExportMenu, {
            c, enabled: editor.table.rows.length > 0, ...csv,
            labels: { export: dt.export, copyCsv: dt.copyCsv, saveCsv: dt.saveCsv, copied: dt.csvCopied, saved: dt.csvSaved },
        }),
        h(Notices, { notices, c }),
        props.blockCount > 0 && h(CheckField, {
            c, label: ce.rebuild(props.blockCount), title: ce.rebuildTip, checked: editor.rebuild,
            onChange: () => editor.setRebuild(on => !on),
        }),
        h(ActionButton, { c, label: ce.cancel, onClick: props.onCancel }),
        h(ActionButton, { c, label: ce.apply, onClick: editor.apply }),
    );
}

function TablePane({ editor, labels, c, ce }) {
    return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
        h(CurveGrid, { editor, labels, c, ce }),
        h('div', { style: { padding: '4px 8px', color: c.textDim, fontSize: 10, flexShrink: 0 } }, ce.hint),
    );
}

export function CurveEditor(props) {
    const { title, conditions, design, onApply, onCancel, c, t } = props;
    const ce = t.curveEditor;
    const editor = useCurveEditor({ initialTable: props.table, onApply, ce });
    const { table } = editor;
    const labels = editorLabels(t, table);
    const missing = useUnresolvedMaterials(design);
    const key = backdropKey(table);
    const backdrops = useMemo(
        () => designBackdrop(design, table, conditions, missing),
        [design, key, conditions, missing]);
    const notices = editorNotices({ editor, conditions, missing, t });

    return h('div', {
        role: 'dialog', 'aria-modal': true, 'aria-label': title,
        style: {
            position: 'fixed', inset: 0, zIndex: 1200, display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: 18,
            background: 'rgba(0,0,0,0.6)',
        },
    }, h('div', {
        style: {
            width: 'min(1320px, 96vw)', height: 'min(860px, 90vh)', display: 'flex', flexDirection: 'column',
            borderRadius: 8, border: `1px solid ${c.border}`, background: c.panel, color: c.text,
            boxShadow: '0 12px 42px rgba(0,0,0,.38)', overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
        },
    },
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                borderBottom: `1px solid ${c.border}`, flexShrink: 0,
            },
        },
            h('h2', { style: { margin: 0, fontSize: 15, flex: 1, minWidth: 0 } }, title),
            h(ActionButton, { c, title: ce.cancel, onClick: onCancel }, tablerIcon('x', 16)),
        ),
        h(EditorToolbar, { editor, labels, c, ce }),
        h('div', { style: { flex: 1, minHeight: 0, display: 'flex' } },
            h(SplitPane, {
                c, onSizesChange: editor.setSizes,
                node: { direction: 'h', sizes: editor.sizes, children: SPLIT_CHILDREN },
            },
                h(TablePane, { editor, labels, c, ce }),
                h(CurveChart, {
                    table, backdrops, labels, dragOn: editor.dragOn,
                    onDragPoint: editor.actions.dragPoint, c,
                }),
            ),
        ),
        h(Footer, { editor, props, notices, c, ce, dt: t.dataTable }),
    ));
}
