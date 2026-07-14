import { Btn, FAMILY_COLOR, Label, Seg } from './controls.js';
import { MiniPlot } from './MiniPlot.js';
import { delimiterName } from './model.js';
import { X_UNITS } from '../../../../utils/io/spectrumTable.js';

const { createElement: h } = React;

function ConfigurePanel({ controller, c, sx, section, rowFlex }) {
    const {
        parsed, colIdx, setColIdx, name, setName, xUnit, setXUnit, quantity,
        yscale, setColOv, previewCurve, onAdd,
    } = controller;
    const col = parsed?.columns?.[colIdx] || null;
    if (!parsed || !col) return null;
    return h('div', { style: section },
        h(Label, { c }, sx.configure),
        h('div', { style: rowFlex },
            h('span', { style: { fontSize: 11, color: c.textDim } },
                sx.detected(delimiterName(parsed.delimiter, sx), parsed.nRows)),
        ),
        h('div', { style: rowFlex },
            h(Label, { c }, sx.unitLabel),
            h('div', { style: { display: 'flex' } },
                h(Seg, { active: xUnit === X_UNITS.NM, onClick: () => setXUnit(X_UNITS.NM), c, position: 'first' }, 'nm'),
                h(Seg, { active: xUnit === X_UNITS.UM, onClick: () => setXUnit(X_UNITS.UM), c, position: 'middle' }, 'µm'),
                h(Seg, { active: xUnit === X_UNITS.CM1, onClick: () => setXUnit(X_UNITS.CM1), c, position: 'last' }, 'cm⁻¹'),
            ),
        ),
        parsed.columns.length > 1 && h('div', { style: rowFlex },
            h(Label, { c }, sx.columnLabel),
            h('select', {
                value: colIdx,
                onChange: (e) => setColIdx(+e.target.value),
                style: { background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11, padding: '3px 6px', outline: 'none' },
            }, parsed.columns.map((column, index) => h('option', { key: index, value: index }, column.name))),
        ),
        h('div', { style: rowFlex },
            h(Label, { c }, sx.quantityLabel),
            h('div', { style: { display: 'flex' } },
                h(Seg, { active: quantity === 'T', onClick: () => setColOv({ quantity: 'T' }), c, position: 'first' }, 'T'),
                h(Seg, { active: quantity === 'R', onClick: () => setColOv({ quantity: 'R' }), c, position: 'middle' }, 'R'),
                h(Seg, { active: quantity === 'A', onClick: () => setColOv({ quantity: 'A' }), c, position: 'last' }, 'A'),
            ),
        ),
        h('div', { style: rowFlex },
            h(Label, { c }, sx.yscaleLabel),
            h('div', { style: { display: 'flex' } },
                h(Seg, { active: yscale === 'percent', onClick: () => setColOv({ yscale: 'percent' }), c, position: 'first' }, sx.percent),
                h(Seg, { active: yscale === 'fraction', onClick: () => setColOv({ yscale: 'fraction' }), c, position: 'middle' }, sx.fraction),
                h(Seg, { active: yscale === 'absorbance', onClick: () => setColOv({ yscale: 'absorbance' }), c, position: 'last' }, sx.absorbance),
            ),
        ),
        h('div', { style: rowFlex },
            h(Label, { c }, sx.nameLabel),
            h('input', {
                value: name, onChange: (e) => setName(e.target.value),
                style: { background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11.5, padding: '4px 7px', outline: 'none', minWidth: 180 },
            }),
            h(Btn, { onClick: onAdd, c, primary: true, disabled: !previewCurve?.x.length }, sx.addOverlay),
        ),
        previewCurve && h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
            h(Label, { c }, sx.preview + (yscale === 'absorbance' ? ` — ${sx.absHint}` : '')),
            h(MiniPlot, { curve: previewCurve, c }),
        ),
    );
}

function ImportedCurves({ controller, c, sx, section, rowFlex }) {
    const { curves, toggleCurve, removeCurve } = controller;
    return h('div', { style: section },
        h(Label, { c }, sx.importedTitle),
        !curves.length
            ? h('span', { style: { fontSize: 11.5, color: c.textDim, fontStyle: 'italic' } }, sx.noOverlays)
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                curves.map((curve) => h('div', {
                    key: curve.id,
                    style: { ...rowFlex, padding: '4px 6px', border: `1px solid ${c.border}`, borderRadius: 4, background: c.panel },
                },
                    h('span', { style: { width: 12, height: 12, borderRadius: 2, background: curve.color, display: 'inline-block', flexShrink: 0, opacity: curve.visible === false ? 0.3 : 1 } }),
                    h('span', { style: { fontSize: 11.5, color: curve.visible === false ? c.textDim : c.text, fontWeight: 500 } }, curve.name),
                    h('span', { style: { fontSize: 10, color: '#fff', background: FAMILY_COLOR[curve.quantity] || '#888', borderRadius: 3, padding: '1px 5px' } }, curve.quantity),
                    h('span', { style: { fontSize: 10.5, color: c.textDim } }, sx.points(curve.x.length, Math.round(curve.x[0]), Math.round(curve.x[curve.x.length - 1]))),
                    h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 4 } },
                        h(Btn, { onClick: () => toggleCurve(curve.id), c }, curve.visible === false ? sx.show : sx.hide),
                        h(Btn, { onClick: () => removeCurve(curve.id), c }, sx.remove),
                    ),
                )),
            ),
    );
}

export function ImportTab({ controller, c, sx, section, rowFlex }) {
    const { loading, onImport, fileName } = controller;
    return h(React.Fragment, null,
        h('div', { style: section },
            h(Label, { c }, sx.importTitle),
            h('div', { style: rowFlex },
                h(Btn, { onClick: onImport, c, primary: true, disabled: loading }, loading ? sx.importing : sx.import),
                fileName && h('span', { style: { fontSize: 11.5, color: c.textDim } }, fileName),
            ),
            h('span', { style: { fontSize: 10.5, color: c.textDim } }, sx.importHint),
        ),
        h(ConfigurePanel, { controller, c, sx, section, rowFlex }),
        h(ImportedCurves, { controller, c, sx, section, rowFlex }),
    );
}
