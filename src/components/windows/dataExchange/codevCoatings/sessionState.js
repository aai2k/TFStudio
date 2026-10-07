import { createWindowSession } from '../../windowSession.js';

// The CODE V file read on the Import tab belongs to the file rather than to any
// design, so it stays loaded across design switches. The export settings that
// are named after the design or taken from it (title, SAV name, REF) are
// reseeded when another design is selected, and a preview built from the
// previous design is dropped. `panelWidth` is the Import tab's panel width once
// the divider has been dragged.
export const codevCoatingsSession = createWindowSession({
    tab: 'import',
    stack: null,
    fileName: '',
    filePath: '',
    side: 'front',
    title: '',
    saveName: '',
    refNm: 550,
    anglesDeg: [0],
    preview: '',
    exportWarnings: [],
    panelWidth: null,
}, {
    onDesignChange: (design) => ({
        title: design?.name || '',
        saveName: design?.name || '',
        refNm: design?.referenceWavelength || 550,
        preview: '',
        exportWarnings: [],
    }),
});
