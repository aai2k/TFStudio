/**
 * Imports and exports Zemax OpticStudio COATING.DAT material and coating data.
 * File-format conventions and numerical conversions live in zemaxCoatingFile.js.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { usePersistentNumber } from '../../../ui/usePersistentState.js';
import { useSession } from './sessionState.js';
import {
    useCoatingImportAction, useLoadAction, useMaterialImportAction,
} from './useImportActions.js';
import { useGenerateAction, useSaveAction } from './useExportActions.js';
import { ZemaxLayout } from './ZemaxLayout.js';

const { createElement: h, useState } = React;

export function ZemaxCoatings({ c, t }) {
    const z = t.zemaxCoatings;
    const { design, updateDesign, checkpoint } = useDesign();
    const [tab, setTab] = useSession('tab');
    const [doc, setDoc] = useSession('doc');
    const [fileName, setFileName] = useSession('fileName');
    const [selCoating, setSelCoating] = useSession('selCoating');
    const [selMats, setSelMats] = useSession('selMats');
    const [thMode, setThMode] = useSession('thMode');
    const [scope, setScope] = useSession('scope');
    const [coatName, setCoatName] = useSession('coatName');
    const [preview, setPreview] = useSession('preview');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState(null);
    const [refNm, setRefNm] = usePersistentNumber('tfstudio-zemax-refNm', 550);
    const [gStart, setGStart] = usePersistentNumber('tfstudio-zemax-gStart', 400);
    const [gEnd, setGEnd] = usePersistentNumber('tfstudio-zemax-gEnd', 800);
    const [gStep, setGStep] = usePersistentNumber('tfstudio-zemax-gStep', 25);
    const flash = (type, msg) => setStatus({ type, msg });

    const shared = { z, flash, doc, fileName, selCoating, selMats, refNm };
    const onLoad = useLoadAction({
        ...shared, setLoading, setStatus, setDoc, setFileName, setSelCoating, setSelMats,
    });
    const importCoating = useCoatingImportAction({
        ...shared, checkpoint, updateDesign,
    });
    const importMaterials = useMaterialImportAction(shared);
    const exportArgs = {
        z, flash, design, gStart, gEnd, gStep, scope, coatName, thMode,
        refNm, preview, setPreview,
    };
    const onGenerate = useGenerateAction(exportArgs);
    const onSave = useSaveAction(exportArgs);

    return h(ZemaxLayout, {
        c, z, design, tab, setTab, doc, fileName, selCoating, setSelCoating,
        selMats, setSelMats, thMode, setThMode, scope, setScope, coatName,
        setCoatName, preview, loading, status, refNm, setRefNm, gStart,
        setGStart, gEnd, setGEnd, gStep, setGStep, onLoad, importCoating,
        importMaterials, onGenerate, onSave,
    });
}
