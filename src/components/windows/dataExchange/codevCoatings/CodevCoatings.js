/**
 * Imports and exports CODE V MULTILAYER (MUL) coatings: the .seq command file
 * that enters a stack in MDA, and the .mul file CODE V saves from it. File
 * format conventions and conversions live in codevCoatingFile.js.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { useUnresolvedMaterials } from '../../../../utils/materials/useUnresolvedMaterials.js';
import { usePersistentNumber } from '../../../ui/usePersistentState.js';
import { useWindowSession } from '../../windowSession.js';
import { CodevLayout } from './CodevLayout.js';
import { codevCoatingsSession } from './sessionState.js';
import { useGenerateAction, useSaveAction } from './useExportActions.js';
import { useImportAction, useLoadAction } from './useImportActions.js';

const { createElement: h, useState } = React;

const SETTERS = {
    setTab: 'tab', setSide: 'side', setTitle: 'title', setSaveName: 'saveName',
    setRefNm: 'refNm', setAnglesDeg: 'anglesDeg',
};

export function CodevCoatings({ c, t }) {
    const z = t.codevCoatings;
    const { design, updateDesign, checkpoint } = useDesign();
    const missingMaterialIds = useUnresolvedMaterials(design);
    const [session, setField, patch] = useWindowSession(codevCoatingsSession, design);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState(null);
    const [gStart, setGStart] = usePersistentNumber('tfstudio-codev-gStart', 400);
    const [gEnd, setGEnd] = usePersistentNumber('tfstudio-codev-gEnd', 800);
    const [gStep, setGStep] = usePersistentNumber('tfstudio-codev-gStep', 10);
    const flash = (type, msg) => setStatus({ type, msg });
    const setters = Object.fromEntries(Object.entries(SETTERS).map(([name, key]) => [name, value => setField(key, value)]));

    const onLoad = useLoadAction({ z, flash, setLoading, setStatus, setFile: patch });
    const importCoating = useImportAction({
        z, flash, stack: session.stack, fileName: session.fileName, filePath: session.filePath,
        checkpoint, updateDesign,
    });
    const exportArgs = {
        ...session, z, flash, design, gStart, gEnd, gStep,
        setExport: (preview, exportWarnings) => patch({ preview, exportWarnings }),
    };
    const onGenerate = useGenerateAction(exportArgs);
    const onSave = useSaveAction(exportArgs);

    return h(CodevLayout, {
        ...session, ...setters, c, z, design, loading, status, missingMaterialIds,
        gStart, setGStart, gEnd, setGEnd, gStep, setGStep,
        onLoad, importCoating, onGenerate, onSave,
    });
}
