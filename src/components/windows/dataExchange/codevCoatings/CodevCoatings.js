/**
 * Imports and exports CODE V MULTILAYER (MUL) coatings: the .seq command file
 * that enters a stack in MDA, and the .mul file CODE V saves from it. File
 * format conventions and conversions live in codevCoatingFile.js.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { useUnresolvedMaterials } from '../../../../utils/materials/useUnresolvedMaterials.js';
import { usePersistentNumber } from '../../../ui/usePersistentState.js';
import { useWindowSession } from '../../windowSession.js';
import { useActionStatus } from '../chrome/actionStatus.js';
import { CodevLayout } from './CodevLayout.js';
import { codevCoatingsSession } from './sessionState.js';
import { useGenerateAction, useSaveAction } from './useExportActions.js';
import { useImportAction, useLibraryAction, useLoadAction } from './useImportActions.js';

const { createElement: h, useState } = React;

const SETTERS = {
    setTab: 'tab', setSide: 'side', setTitle: 'title', setSaveName: 'saveName',
    setRefNm: 'refNm', setAnglesDeg: 'anglesDeg', setPanelWidth: 'panelWidth',
};

export function CodevCoatings({ c, t }) {
    const z = t.codevCoatings;
    const { design, updateDesign, checkpoint, hasActiveDesign } = useDesign();
    const missingMaterialIds = useUnresolvedMaterials(design);
    const [session, setField, patch] = useWindowSession(codevCoatingsSession, design);
    const [loading, setLoading] = useState(false);
    const [library, setLibrary] = useState(null);
    const { status, flash, clear } = useActionStatus();
    const [gStart, setGStart] = usePersistentNumber('tfstudio-codev-gStart', 400);
    const [gEnd, setGEnd] = usePersistentNumber('tfstudio-codev-gEnd', 800);
    const [gStep, setGStep] = usePersistentNumber('tfstudio-codev-gStep', 10);
    const setters = Object.fromEntries(Object.entries(SETTERS).map(([name, key]) => [name, value => setField(key, value)]));

    const file = { z, flash, stack: session.stack, fileName: session.fileName, filePath: session.filePath };
    const onLoad = useLoadAction({ z, flash, clear, setLoading, setFile: patch });
    const importCoating = useImportAction({ ...file, checkpoint, updateDesign, hasActiveDesign });
    const saveToLibrary = useLibraryAction({ ...file, setLibrary });
    const exportArgs = {
        ...session, z, flash, design, gStart, gEnd, gStep,
        setExport: (preview, exportWarnings) => patch({ preview, exportWarnings }),
    };
    const onGenerate = useGenerateAction(exportArgs);
    const onSave = useSaveAction(exportArgs);
    const onLibrarySaved = name => flash('success', t.coatingLibrary.saveDialog.saved(name));

    return h(CodevLayout, {
        ...session, ...setters, c, t, z, design, hasActiveDesign, loading, status, missingMaterialIds,
        gStart, setGStart, gEnd, setGEnd, gStep, setGStep,
        onLoad, importCoating, saveToLibrary, onGenerate, onSave,
        library, closeLibrary: () => setLibrary(null), onLibrarySaved,
    });
}
