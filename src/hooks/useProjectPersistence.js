/**
 * One path for every project change that has to reach the disk before it is
 * shown: run the write, commit the state change only if it succeeded, and tell
 * the user when it did not.
 */

import { persistThenCommit } from '../utils/io/projectPersistence.js';

const { useCallback } = React;

// `failureMessage` may be a function of the error the main process returned, for
// the cases where one operation can fail in more than one way worth telling
// apart, such as a folder path too long for the file system. A function that
// returns false has dealt with the failure itself (a save that asks before it
// overwrites a file changed on disk), and nothing more is shown.
export function useProjectPersistence(setMessageNotification, t) {
    return useCallback(async (operation, commit, failureMessage) => {
        const result = await persistThenCommit(operation, commit);
        if (!result.success) {
            const message = typeof failureMessage === 'function'
                ? failureMessage(result.error)
                : failureMessage;
            if (message === false) return result.success;
            setMessageNotification({
                type: 'error',
                message: message || t.dialogs.persistenceFailed,
            });
        }
        return result.success;
    }, [setMessageNotification, t]);
}
