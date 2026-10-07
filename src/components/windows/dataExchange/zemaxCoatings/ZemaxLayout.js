import { Divider, FieldLabel, NumInput } from '../../analysis/chrome/controls.js';
import { AnalysisWindow, ControlRow } from '../../analysis/chrome/layout.js';
import { ReportAndNotices } from '../chrome/actionStatus.js';
import { TabBtn } from '../chrome/panel.js';
import { SaveCoatingDialog } from '../../design/coatingLibrary/SaveCoatingDialog.js';
import { CoatingsTab } from './CoatingsTab.js';
import { ExportTab } from './ExportTab.js';
import { MaterialsTab } from './MaterialsTab.js';

const { createElement: h } = React;

const TABS = [['coatings', 'tabCoatings'], ['materials', 'tabMaterials'], ['export', 'tabExport']];
const TAB_BODY = { coatings: CoatingsTab, materials: MaterialsTab, export: ExportTab };

// The tabs, then λ₀, which converts relative thicknesses both ways and so
// belongs to no one tab, then what the last action did.
function Controls({ c, t, z, tab, setTab, refNm, setRefNm, status, notices }) {
    return h(ControlRow, { c },
        TABS.map(([id, label]) => h(TabBtn, { key: id, active: tab === id, onClick: () => setTab(id), c }, z[label])),
        h(Divider, { c }),
        h(FieldLabel, { c }, z.refWavelength),
        h(NumInput, { value: refNm, onChange: setRefNm, positive: true, step: 10, c, width: 64, title: z.refWaveHint }),
        h(ReportAndNotices, { c, t, status, notices }),
    );
}

export function ZemaxLayout(props) {
    const { c, t, tab, library, closeLibrary, onLibrarySaved } = props;
    return h(AnalysisWindow, { c },
        h(Controls, props),
        h(TAB_BODY[tab] || CoatingsTab, props),
        library && h(SaveCoatingDialog, { coating: library.coating, c, t, onClose: closeLibrary, onSaved: onLibrarySaved }),
    );
}
