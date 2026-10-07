import { TabBtn } from '../zemaxCoatings/ui.js';
import { ExportTab } from './ExportTab.js';
import { ImportTab } from './ImportTab.js';

const { createElement: h } = React;

function Header({ c, z }) {
    return h('div', { style: { padding: '8px 12px', borderBottom: `1px solid ${c.border}`, background: c.panel, flexShrink: 0 } },
        h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 2 } }, z.title),
        h('div', { style: { fontSize: 10.5, color: c.textDim, lineHeight: 1.4 } }, z.subtitle),
    );
}

function Tabs({ c, z, tab, setTab }) {
    return h('div', { style: { display: 'flex', borderBottom: `1px solid ${c.border}`, background: c.panel, flexShrink: 0 } },
        h(TabBtn, { active: tab === 'import', onClick: () => setTab('import'), c }, z.tabImport),
        h(TabBtn, { active: tab === 'export', onClick: () => setTab('export'), c }, z.tabExport),
    );
}

// One status line for both tabs, above the tab body.
function Status({ c, status }) {
    if (!status) return null;
    const error = status.type === 'error';
    return h('div', {
        role: error ? 'alert' : 'status',
        style: {
            padding: '6px 12px', fontSize: 11, flexShrink: 0,
            borderBottom: `1px solid ${c.border}`,
            background: error ? (c.error + '22') : (c.success + '22'),
            color: error ? c.error : c.text,
        },
    }, status.msg);
}

function Body(props) {
    const content = props.tab === 'export' ? h(ExportTab, props) : h(ImportTab, props);
    return h('div', { style: { flex: 1, overflow: 'auto', padding: 12 } }, content);
}

export function CodevLayout(props) {
    const { c, status } = props;
    return h('div', {
        style: { display: 'flex', flexDirection: 'column', height: '100%', background: c.bg, color: c.text, fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden' },
    },
        h(Header, props),
        h(Tabs, props),
        h(Status, { c, status }),
        h(Body, props),
    );
}
