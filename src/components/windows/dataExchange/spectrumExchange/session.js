const SESSION = {
    parsed: null,
    fileName: '',
    colIdx: 0,
    name: '',
    tab: 'import',
    expSource: 'design',
    expFormat: 'csv',
};

const { useCallback, useState } = React;

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
