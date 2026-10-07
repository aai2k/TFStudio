import { ActionButton } from '../../analysis/chrome/controls.js';
import { CenteredMessage } from '../../analysis/chrome/layout.js';
import { InlineRow, PanelSection } from '../chrome/panel.js';
import { Checkbox } from '../../../ui/Checkbox.js';
import { fileMaterialNames } from './catalogImport.js';
import { ImportPage } from './ImportPage.js';
import { td, th } from './ui.js';

const { createElement: h } = React;

// A name the file defines more than once: which record of it this row is, and
// the name the row is imported under.
function RepeatMark({ c, z, row }) {
    return h('span', {
        title: z.repeatedRowTip(row.name),
        style: { marginLeft: 6, color: c.warning, fontSize: 10.5, whiteSpace: 'nowrap' },
    }, z.repeatedRow(row.repeat.index, row.repeat.count));
}

// One MATE record. The selection holds its position in the file, so two
// records of one name are checked and imported one at a time.
function materialRow(material, index, { c, z, selRows, toggle, names }) {
    const low = material.points.length ? material.points[0][0] : 0;
    const high = material.points.length ? material.points[material.points.length - 1][0] : 0;
    const checked = selRows.has(index);
    return h('tr', {
        key: index, onClick: () => toggle(index),
        style: { cursor: 'pointer', background: checked ? c.accent + '18' : 'transparent' },
    },
        h('td', { style: { ...td(c), textAlign: 'center' } }, h(Checkbox, { c, checked, readOnly: true })),
        h('td', { style: td(c) }, material.name, names[index].repeat && h(RepeatMark, { c, z, row: names[index] })),
        h('td', { style: { ...td(c), textAlign: 'right', color: c.textDim } }, material.points.length),
        h('td', { style: { ...td(c), color: c.textDim } }, material.points.length ? `${low}–${high}` : ''),
    );
}

function MaterialTable({ c, z, doc, selRows, setSelRows }) {
    const toggle = (index) => {
        const next = new Set(selRows);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        setSelRows(next);
    };
    const names = fileMaterialNames(doc.materials);
    return h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
        h('thead', null, h('tr', null,
            h('th', { style: { ...th(c), width: 28 } }, ''),
            h('th', { style: th(c) }, z.colName),
            h('th', { style: { ...th(c), textAlign: 'right' } }, z.colPoints),
            h('th', { style: th(c) }, z.colRange),
        )),
        h('tbody', null, doc.materials.map((material, index) => materialRow(material, index, { c, z, selRows, toggle, names }))),
    );
}

function SelectionSection({ c, z, doc, setSelRows, importMaterials }) {
    return h(PanelSection, { c, title: z.tabMaterials },
        h(InlineRow, { c },
            h(ActionButton, { c, label: z.selectAll, onClick: () => setSelRows(new Set(doc.materials.keys())) }),
            h(ActionButton, { c, label: z.clearSel, onClick: () => setSelRows(new Set()) }),
        ),
        h(InlineRow, { c },
            h(ActionButton, { c, label: z.importSelected, onClick: () => importMaterials(false) }),
            h(ActionButton, { c, label: z.importAll, onClick: () => importMaterials(true) }),
        ),
    );
}

export function MaterialsTab(props) {
    const { c, z, doc } = props;
    const hasMaterials = doc?.materials.length > 0;
    const body = !doc ? h(CenteredMessage, { c, message: z.noFile })
        : !hasMaterials ? h(CenteredMessage, { c, message: z.noMaterials })
        : h(MaterialTable, props);
    return h(ImportPage, { ...props, section: hasMaterials ? h(SelectionSection, props) : null }, body);
}
