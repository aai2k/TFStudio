import { AnalysisWindow, ControlRow } from '../../analysis/chrome/layout.js';
import { ReportAndNotices } from '../chrome/actionStatus.js';
import { TabBtn } from '../chrome/panel.js';
import { SaveCoatingDialog } from '../../design/coatingLibrary/SaveCoatingDialog.js';
import { ExportTab } from './ExportTab.js';
import { ImportTab } from './ImportTab.js';
import { warningText } from './messages.js';

const { createElement: h } = React;

const TABS = [['import', 'tabImport'], ['export', 'tabExport']];

/**
 * The window's notices: on the Import tab what the reader noted about the file
 * shown there, on the Export tab what the writer noted about the preview.
 */
export function tabNotices({ z, tab, stack, exportWarnings }) {
    const warnings = (tab === 'export' ? exportWarnings : stack?.warnings) || [];
    return warnings.map(warning => ({ label: warningText(z, warning), tone: 'warning' }));
}

// The tabs, then what the last action did and the notices.
function Controls(props) {
    const { c, t, z, tab, setTab, status } = props;
    return h(ControlRow, { c },
        TABS.map(([id, label]) => h(TabBtn, { key: id, active: tab === id, onClick: () => setTab(id), c }, z[label])),
        h(ReportAndNotices, { c, t, status, notices: tabNotices(props) }),
    );
}

export function CodevLayout(props) {
    const { c, t, tab, library, closeLibrary, onLibrarySaved } = props;
    return h(AnalysisWindow, { c },
        h(Controls, props),
        h(tab === 'export' ? ExportTab : ImportTab, props),
        library && h(SaveCoatingDialog, { coating: library, c, t, onClose: closeLibrary, onSaved: onLibrarySaved }),
    );
}
