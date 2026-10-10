// Deleting the user's files by moving them to the Recycle Bin, where a delete
// confirmed by mistake can be restored.
//
// CommonJS, Electron-free (deps via ctx: `shell` is Electron's, absent in a
// run that has none).

/**
 * Move a file or folder to the Recycle Bin. Answers false, having logged why
 * under `label`, when there is no bin to move it to: no shell, or one that
 * refuses, as a Linux desktop without a trash does. The caller then deletes it
 * itself.
 */
async function movedToTrash(ctx, target, label) {
  if (!ctx.shell?.trashItem) return false;
  try {
    await ctx.shell.trashItem(target);
    return true;
  } catch (err) {
    ctx.log(`${label}: ${target} could not go to the Recycle Bin: ${err.message}`);
    return false;
  }
}

/** Delete one file: to the Recycle Bin, or for good where there is none. */
async function deleteFile(ctx, filePath, label) {
  if (!(await movedToTrash(ctx, filePath, label))) ctx.fs.unlinkSync(filePath);
}

module.exports = { movedToTrash, deleteFile };
