/**
 * Imports and exports Zemax OpticStudio COATING.DAT material and coating data.
 * File-format conventions and numerical conversions live in zemaxCoatingFile.js.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { useUnresolvedMaterials } from '../../../../utils/materials/useUnresolvedMaterials.js';
import { usePersistentNumber } from '../../../ui/usePersistentState.js';
import { useActionStatus } from '../chrome/actionStatus.js';
import { fileMaterialNames } from './catalogImport.js';
import { zemaxCoatingsSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';
import {
    useCoatingImportAction, useLibraryAction, useLoadAction, useMaterialImportAction, warningsSuffix,
} from './useImportActions.js';
import { useGenerateAction, useSaveAction } from './useExportActions.js';
import { ZemaxLayout } from './ZemaxLayout.js';

const { createElement: h, useState } = React;

const SETTERS = {
    setTab: 'tab', setSelCoating: 'selCoating', setSelRows: 'selRows', setThMode: 'thMode',
    setScope: 'scope', setCoatName: 'coatName', setPreview: 'preview', setPanelWidth: 'panelWidth',
};

// A file that defines a material name more than once is ambiguous about which
// record a COAT layer of that name means, so the window says so.
function repeatedNameNotices(z, doc) {
    const names = fileMaterialNames(doc?.materials || [])
        .filter(({ repeat }) => repeat?.index === 1)
        .map(({ name }) => name);
    if (!names.length) return [];
    return [{ label: z.repeatedNames(names.length), detail: z.repeatedNamesDetail(names.join(', ')), tone: 'warning' }];
}

export function ZemaxCoatings({ c, t, setInputDialog }) {
    const z = t.zemaxCoatings;
    const { design, updateDesign, checkpoint } = useDesign();
    const missingMaterialIds = useUnresolvedMaterials(design);
    const [session, setField, patch] = useWindowSession(zemaxCoatingsSession, design);
    const [loading, setLoading] = useState(false);
    const [library, setLibraryCoating] = useState(null);
    const { status, flash, clear } = useActionStatus();
    const [refNm, setRefNm] = usePersistentNumber('tfstudio-zemax-refNm', 550);
    const [gStart, setGStart] = usePersistentNumber('tfstudio-zemax-gStart', 400);
    const [gEnd, setGEnd] = usePersistentNumber('tfstudio-zemax-gEnd', 800);
    const [gStep, setGStep] = usePersistentNumber('tfstudio-zemax-gStep', 25);
    const setters = Object.fromEntries(Object.entries(SETTERS).map(([name, key]) => [name, value => setField(key, value)]));

    const { doc, fileName, filePath, selCoating, selRows } = session;
    const shared = { z, flash, doc, fileName, filePath, selCoating, selRows, refNm };
    const onLoad = useLoadAction({ z, flash, clear, setLoading, setFile: patch });
    const importCoating = useCoatingImportAction({ ...shared, checkpoint, updateDesign });
    const saveToLibrary = useLibraryAction({ ...shared, design, setLibraryCoating });
    const importMaterials = useMaterialImportAction({ ...shared, setInputDialog });
    const exportArgs = { ...session, z, flash, design, gStart, gEnd, gStep, refNm, setPreview: setters.setPreview };
    const onGenerate = useGenerateAction(exportArgs);
    const onSave = useSaveAction(exportArgs);
    const onLibrarySaved = name => flash('success', t.coatingLibrary.saveDialog.saved(name) + warningsSuffix(z, library.warnings));

    return h(ZemaxLayout, {
        ...session, ...setters, c, t, z, design, loading, status, missingMaterialIds,
        notices: repeatedNameNotices(z, doc), refNm, setRefNm, gStart, setGStart, gEnd, setGEnd, gStep, setGStep,
        onLoad, importCoating, saveToLibrary, importMaterials, onGenerate, onSave,
        library, closeLibrary: () => setLibraryCoating(null), onLibrarySaved,
    });
}
