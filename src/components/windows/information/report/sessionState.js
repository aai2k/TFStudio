import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

/** The `lang` value that means the language the app is running in. */
export const APP_LANGUAGE = 'app';

/**
 * The Report window's state across remounts: which template it follows, the
 * block list, the document fields, paper, language and which designs it covers.
 *
 * `blocks` starts null and is filled from the template the first time the
 * window mounts. The paper and the document language are declared under
 * `report` in the analysis registry, so Settings sets what the window opens
 * with; the rest is session-only.
 */
export const reportSession = createWindowSession({
    ...sessionDefaults('report'),
    templateId: 'design-record',
    blocks: null,
    doc: { title: '', customer: '', docNo: '', revision: '', date: '', designer: '' },
    scope: 'current',
    selectedIds: [],
}, { id: 'report', savable: registryKeys('report') });
