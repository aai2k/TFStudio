/**
 * The cells of a measured-curve row.
 *
 * The row is a snapshot, not a set of fields: its wavelengths, targets, angle
 * and polarization came from the curve it was generated from, and editing them
 * here would describe a measurement nobody took. They are shown as text, and
 * only Enabled and Weight stay editable.
 */

const { createElement: h } = React;

// Every other row is as tall as the type picker's trigger. A measured row shows
// its type as plain text, so it has to ask for that height itself or it renders
// shorter than the rows around it.
const ROW_HEIGHT = 22;

function measuredTypeCell(ctx, colKey, width) {
    const { op, c, tdBase } = ctx;
    const points = op.sampleLambdas?.length || 0;
    return h('td', {
        key: colKey,
        title: `${op.curveName || 'Measured curve'} · ${op.quantity || 'R'} · ${points} points`,
        style: {
            ...tdBase(colKey, width), height: ROW_HEIGHT, color: c.text, fontWeight: 600,
            overflow: 'hidden', textOverflow: 'ellipsis',
        },
    }, 'MCURVE');
}

function measuredSnapshotCell(ctx, colKey, width) {
    const { op, c, tdBase } = ctx;
    let value = op[colKey];
    if (colKey === 'pol') value = op.pol || 'avg';
    if (colKey === 'aoi') value = Number.isFinite(op.aoi) ? op.aoi : 0;
    if (Number.isFinite(value) && colKey !== 'aoi') value = Number(value.toFixed(3));
    return h('td', {
        key: colKey,
        title: op.curveName || undefined,
        style: { ...tdBase(colKey, width), color: c.textDim, overflow: 'hidden', textOverflow: 'ellipsis' },
    }, value ?? '');
}

export { measuredTypeCell, measuredSnapshotCell };
