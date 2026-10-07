import { createWindowSession } from '../../windowSession.js';

// The loaded COATING.DAT document and the browsing selections belong to the file
// rather than to any design, so one slot serves every design and the document
// stays loaded until another file replaces it. `selRows` holds positions in
// `doc.materials` rather than names, since a file can define one name twice.
// `panelWidth` is the import tabs' panel width once the divider has been dragged.
export const zemaxCoatingsSession = createWindowSession({
    doc: null,
    fileName: '',
    filePath: '',
    tab: 'coatings',
    selCoating: -1,
    selRows: new Set(),
    thMode: 'absolute',
    scope: 'used',
    coatName: 'TFSTUDIO_DESIGN',
    preview: '',
    panelWidth: null,
});
