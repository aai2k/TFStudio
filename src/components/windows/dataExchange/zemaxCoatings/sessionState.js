const { useCallback, useState } = React;

// Docking unmounts inactive tool windows. This cache keeps the loaded document
// and browsing selections alive until another file is loaded or the app exits.
const SESSION = {
    doc: null, fileName: '', tab: 'coatings', selCoating: -1,
    selMats: new Set(), thMode: 'absolute', scope: 'used',
    coatName: 'TFSTUDIO_DESIGN', preview: '',
};

export function useSession(key) {
    const [value, setValue] = useState(SESSION[key]);
    const set = useCallback((nextValue) => {
        SESSION[key] = typeof nextValue === 'function'
            ? nextValue(SESSION[key])
            : nextValue;
        setValue(SESSION[key]);
    }, [key]);
    return [value, set];
}
