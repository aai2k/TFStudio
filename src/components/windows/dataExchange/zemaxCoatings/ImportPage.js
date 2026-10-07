import { ImportPage as FileImportPage } from '../chrome/panel.js';

const { createElement: h } = React;

/**
 * A Zemax import tab. Both import tabs read the one loaded file, so each
 * carries the button that opens it.
 *
 *   section   the tab's panel section, under the file panel
 *   children  the right-hand side
 */
export function ImportPage({ c, z, loading, onLoad, fileName, panelWidth, setPanelWidth, section, children }) {
    return h(FileImportPage, {
        c, section, panelWidth, onPanelWidthChange: setPanelWidth,
        file: {
            title: z.fileTitle, label: loading ? z.loading : z.loadBtn,
            onImport: onLoad, loading, fileName, hint: z.fileHint,
        },
    }, children);
}
