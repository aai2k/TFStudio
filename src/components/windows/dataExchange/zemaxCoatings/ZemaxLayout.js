import { CoatingsTab } from './CoatingsTab.js';
import { ExportTab } from './ExportTab.js';
import { MaterialsTab } from './MaterialsTab.js';
import { Btn, Label, Num, TabBtn } from './ui.js';

const { createElement: h } = React;

function Header(props) {
    const { c, z, onLoad, loading, fileName, refNm, setRefNm } = props;
    return h('div', { style: { padding: '8px 12px', borderBottom: `1px solid ${c.border}`, background: c.panel, flexShrink: 0 } },
        h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 2 } }, z.title),
        h('div', { style: { fontSize: 10.5, color: c.textDim, lineHeight: 1.4, marginBottom: 8 } }, z.subtitle),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            h(Btn, { onClick: onLoad, c, primary: true, disabled: loading }, loading ? z.loading : z.loadBtn),
            fileName ? h('span', { style: { fontSize: 11, color: c.textDim } }, z.loadedFile(fileName)) : null,
            h('div', { style: { flex: 1 } }),
            h(Label, { c }, z.refWavelength),
            h(Num, { value: refNm, onChange: setRefNm, min: 100, max: 30000, step: 10, c, width: 70 }),
        ),
    );
}

function Tabs({ c, z, tab, setTab }) {
    return h('div', { style: { display: 'flex', borderBottom: `1px solid ${c.border}`, background: c.panel, flexShrink: 0 } },
        h(TabBtn, { active: tab === 'coatings', onClick: () => setTab('coatings'), c }, z.tabCoatings),
        h(TabBtn, { active: tab === 'materials', onClick: () => setTab('materials'), c }, z.tabMaterials),
        h(TabBtn, { active: tab === 'export', onClick: () => setTab('export'), c }, z.tabExport),
    );
}

function Body(props) {
    const { c, tab } = props;
    const content = tab === 'coatings' ? h(CoatingsTab, props)
        : tab === 'materials' ? h(MaterialsTab, props)
        : h(ExportTab, props);
    return h('div', { style: { flex: 1, overflow: 'auto', padding: 12 } }, content);
}

function Status({ c, status }) {
    if (!status) return null;
    return h('div', {
        style: {
            padding: '6px 12px', fontSize: 11, flexShrink: 0,
            borderTop: `1px solid ${c.border}`,
            background: status.type === 'error' ? (c.error + '22') : (c.success + '22'),
            color: status.type === 'error' ? c.error : c.text,
        },
    }, status.msg);
}

export function ZemaxLayout(props) {
    const { c, status } = props;
    return h('div', {
        style: { display: 'flex', flexDirection: 'column', height: '100%', background: c.bg, color: c.text, fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden' },
    },
        h(Header, props),
        h(Tabs, props),
        h(Body, props),
        h(Status, { c, status }),
    );
}
