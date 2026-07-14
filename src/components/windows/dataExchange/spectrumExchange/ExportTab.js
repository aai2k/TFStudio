import { Btn, Check, FAMILY_COLOR, Label, Num, Seg } from './controls.js';

const { createElement: h } = React;

function ExportOptions({ controller, c, sx, section, rowFlex }) {
    const { expSource, setExpSource, expFormat, setExpFormat } = controller;
    return h('div', { style: section },
        h('div', { style: rowFlex },
            h(Label, { c }, sx.exportWhat),
            h('div', { style: { display: 'flex' } },
                h(Seg, { active: expSource === 'design', onClick: () => setExpSource('design'), c, position: 'first' }, sx.sourceDesign),
                h(Seg, { active: expSource === 'measured', onClick: () => setExpSource('measured'), c, position: 'last' }, sx.sourceMeasured),
            ),
        ),
        h('div', { style: rowFlex },
            h(Label, { c }, sx.formatLabel),
            h('div', { style: { display: 'flex' } },
                h(Seg, { active: expFormat === 'csv', onClick: () => setExpFormat('csv'), c, position: 'first' }, 'CSV'),
                h(Seg, { active: expFormat === 'jcamp', onClick: () => setExpFormat('jcamp'), c, position: 'last' }, 'JCAMP-DX'),
            ),
        ),
    );
}

function DesignExportPanel({ controller, c, sx, section, rowFlex }) {
    const {
        dStart, setDStart, dEnd, setDEnd, dStep, setDStep, dAoi, setDAoi,
        dQ, setDQ, dSP, setDSP, onExportDesign, evalMode,
    } = controller;
    return h('div', { style: section },
        h('span', { style: { fontSize: 11, color: c.textDim } }, sx.exportDesignDesc),
        h('div', { style: rowFlex },
            h(Label, { c }, sx.rangeLabel),
            h(Num, { value: dStart, onChange: setDStart, min: 100, max: 50000, step: 10, c }),
            h('span', { style: { color: c.textDim } }, '–'),
            h(Num, { value: dEnd, onChange: setDEnd, min: 100, max: 50000, step: 10, c }),
            h(Label, { c }, sx.stepLabel),
            h(Num, { value: dStep, onChange: setDStep, min: 0.1, max: 100, step: 0.5, c, width: 56 }),
        ),
        h('div', { style: rowFlex },
            h(Label, { c }, sx.aoiLabel),
            h('input', {
                value: dAoi, onChange: (e) => setDAoi(e.target.value),
                style: { background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11.5, padding: '4px 7px', outline: 'none', width: 120 },
            }),
        ),
        h('div', { style: rowFlex },
            h(Label, { c }, sx.quantitiesLabel),
            h(Check, { checked: dQ.T, onChange: (value) => setDQ((previous) => ({ ...previous, T: value })), c }, 'T'),
            h(Check, { checked: dQ.R, onChange: (value) => setDQ((previous) => ({ ...previous, R: value })), c }, 'R'),
            h(Check, { checked: dQ.A, onChange: (value) => setDQ((previous) => ({ ...previous, A: value })), c }, 'A'),
            h('span', { style: { width: 10 } }),
            h(Check, { checked: dSP, onChange: setDSP, c }, sx.includeSP),
        ),
        h('div', { style: rowFlex },
            h(Btn, { onClick: onExportDesign, c, primary: true }, sx.exportDesign),
            h('span', { style: { fontSize: 10.5, color: c.textDim } }, sx.exportDesignHint(evalMode)),
        ),
    );
}

function MeasuredExportPanel({ controller, c, sx, section, rowFlex }) {
    const { curves, onExport } = controller;
    return h('div', { style: section },
        h('span', { style: { fontSize: 11, color: c.textDim } }, sx.exportMeasuredDesc),
        !curves.length
            ? h('span', { style: { fontSize: 11.5, color: c.textDim, fontStyle: 'italic' } }, sx.noOverlays)
            : h(React.Fragment, null,
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
                    curves.map((curve) => h('div', { key: curve.id, style: { ...rowFlex, gap: 6 } },
                        h('span', { style: { width: 10, height: 10, borderRadius: 2, background: curve.color, display: 'inline-block', flexShrink: 0 } }),
                        h('span', { style: { fontSize: 11.5, color: c.text } }, curve.name),
                        h('span', { style: { fontSize: 10, color: '#fff', background: FAMILY_COLOR[curve.quantity] || '#888', borderRadius: 3, padding: '1px 5px' } }, curve.quantity),
                    )),
                ),
                h('div', { style: rowFlex },
                    h(Btn, { onClick: onExport, c, primary: true }, sx.exportMeasured),
                    h('span', { style: { fontSize: 10.5, color: c.textDim } }, sx.measuredCount(curves.length)),
                ),
            ),
    );
}

export function ExportTab({ controller, c, sx, section, rowFlex }) {
    return h(React.Fragment, null,
        h(ExportOptions, { controller, c, sx, section, rowFlex }),
        controller.expSource === 'design'
            ? h(DesignExportPanel, { controller, c, sx, section, rowFlex })
            : h(MeasuredExportPanel, { controller, c, sx, section, rowFlex }),
    );
}
