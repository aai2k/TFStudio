import assert from 'node:assert/strict';
import {
  designsEqual,
  persistThenCommit,
  updateDirtyDesigns,
} from '../src/utils/io/projectPersistence.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let passed = 0;
function ok(condition, message) {
  assert.ok(condition, message);
  passed++;
}

const failedGate = deferred();
let rendererName = 'Alpha';
const failedRename = persistThenCommit(
  () => failedGate.promise,
  () => { rendererName = 'Beta'; },
);
ok(rendererName === 'Alpha', 'a deferred rename does not mutate renderer state early');
failedGate.resolve({ success: false, error: 'collision' });
const failedRenameResult = await failedRename;
ok(failedRenameResult.success === false, 'a resolved IPC failure is reported as failure');
ok(rendererName === 'Alpha', 'a resolved IPC failure leaves renderer state unchanged');

let diskBaseline = { id: 'design-1', frontLayers: [{ d: 90 }] };
let saveDirtyState = { 'design-1': true };
const refusedSave = await persistThenCommit(
  async () => ({ success: false, error: 'write failed' }),
  () => {
    diskBaseline = { id: 'design-1', frontLayers: [{ d: 100 }] };
    saveDirtyState = {};
  },
);
ok(!refusedSave.success, 'a resolved save failure is not treated as persisted');
ok(diskBaseline.frontLayers[0].d === 90, 'a failed save does not replace the disk baseline');
ok(saveDirtyState['design-1'], 'a failed save does not clear dirty state');

const rejectedGate = deferred();
let folderVisible = true;
const rejectedDelete = persistThenCommit(
  () => rejectedGate.promise,
  () => { folderVisible = false; },
);
rejectedGate.reject(new Error('disk unavailable'));
const rejectedDeleteResult = await rejectedDelete;
ok(rejectedDeleteResult.success === false, 'a rejected IPC call is normalized to failure');
ok(rejectedDeleteResult.error === 'disk unavailable', 'a rejected IPC error is retained');
ok(folderVisible, 'a rejected delete leaves the folder visible');

const successfulGate = deferred();
let designVisible = false;
const successfulCreate = persistThenCommit(
  () => successfulGate.promise,
  () => { designVisible = true; },
);
ok(!designVisible, 'a deferred create is not shown before it reaches disk');
successfulGate.resolve({ success: true });
ok((await successfulCreate).success, 'a successful IPC response is reported as success');
ok(designVisible, 'a successful create commits renderer state');

const savedSnapshot = { id: 'design-1', name: 'D', frontLayers: [{ d: 100 }] };
const editedWhileSaving = { ...savedSnapshot, frontLayers: [{ d: 125 }] };
const dirtyAfterRace = updateDirtyDesigns({}, savedSnapshot.id, editedWhileSaving, savedSnapshot);
ok(dirtyAfterRace[savedSnapshot.id] === true,
  'edits made while a save is pending remain dirty after that save completes');

const dirtyBeforeCleanSave = { [savedSnapshot.id]: true };
const cleanAfterSave = updateDirtyDesigns(
  dirtyBeforeCleanSave,
  savedSnapshot.id,
  JSON.parse(JSON.stringify(savedSnapshot)),
  savedSnapshot,
);
ok(!cleanAfterSave[savedSnapshot.id], 'an unchanged successful save clears dirty state');
ok(designsEqual({ tfs_version: '1.0', ...savedSnapshot }, savedSnapshot),
  'disk metadata does not make an unchanged design dirty');

console.log(`project_persistence_failures: ${passed} passed`);
