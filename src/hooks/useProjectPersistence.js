/**
 * One path for every project change that has to reach the disk before it is
 * shown: run the write, commit the state change only if it succeeded, and tell
 * the user when it did not.
 */

import { persistThenCommit } from '../utils/io/projectPersistence.js';

const { useCallback } = React;

// `failureMessage` may be a function of the error the main process returned, for
// the cases where one operation can fail in more than one way worth telling
// apart, such as a folder path too long for the file system.
export function useProjectPersistence(setMessageNotification, t) {
    return useCallback(async (operation, commit, failureMessage) => {
        const result = await persistThenCommit(operation, commit);
        if (!result.success) {
            const message = typeof failureMessage === 'function'
                ? failureMessage(result.error)
                : failureMessage;
            setMessageNotification({
                type: 'error',
                message: message || t.dialogs.persistenceFailed,
            });
        }
        return result.success;
    }, [setMessageNotification, t]);
}
