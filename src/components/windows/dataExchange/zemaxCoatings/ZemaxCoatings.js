/**
 * Imports and exports Zemax OpticStudio COATING.DAT material and coating data.
 * File-format conventions and numerical conversions live in zemaxCoatingFile.js.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { useUnresolvedMaterials } from '../../../../utils/materials/useUnresolvedMaterials.js';
import { usePersistentNumber } from '../../../ui/usePersistentState.js';
import { zemaxCoatingsSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';
import {
    useCoatingImportAction, useLoadAction, useMaterialImportAction,
} from './useImportActions.js';
import { useGenerateAction, useSaveAction } from './useExportActions.js';
import { ZemaxLayout } from './ZemaxLayout.js';

const { createElement: h, useState } = React;

export function ZemaxCoatings({ c, t }) {
    const z = t.zemaxCoatings;
    const { design, updateDesign, checkpoint } = useDesign();
    const missingMaterialIds = useUnresolvedMaterials(design);
    const [session, setField] = useWindowSession(zemaxCoatingsSession, design);
    const { tab, doc, fileName, filePath, selCoating, selMats, thMode, scope, coatName, preview } = session;
    const setTab = value => setField('tab', value);
    const setDoc = value => setField('doc', value);
    const setFileName = value => setField('fileName', value);
    const setFilePath = value => setField('filePath', value);
    const setSelCoating = value => setField('selCoating', value);
    const setSelMats = value => setField('selMats', value);
    const setThMode = value => setField('thMode', value);
    const setScope = value => setField('scope', value);
    const setCoatName = value => setField('coatName', value);
    const setPreview = value => setField('preview', value);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState(null);
    const [refNm, setRefNm] = usePersistentNumber('tfstudio-zemax-refNm', 550);
    const [gStart, setGStart] = usePersistentNumber('tfstudio-zemax-gStart', 400);
    const [gEnd, setGEnd] = usePersistentNumber('tfstudio-zemax-gEnd', 800);
    const [gStep, setGStep] = usePersistentNumber('tfstudio-zemax-gStep', 25);
    const flash = (type, msg) => setStatus({ type, msg });

    const shared = { z, flash, doc, fileName, filePath, selCoating, selMats, refNm };
    const onLoad = useLoadAction({
        ...shared, setLoading, setStatus, setDoc, setFileName, setFilePath, setSelCoating, setSelMats,
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
        importMaterials, onGenerate, onSave, missingMaterialIds,
    });
}
