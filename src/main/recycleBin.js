// Deleting the user's files by moving them to the Recycle Bin, where a delete
// confirmed by mistake can be restored.
//
// CommonJS, Electron-free (deps via ctx: `shell` is Electron's, absent in a
// run that has none).

// The answer when the Recycle Bin refuses a file or folder, which is then left
// where it is: Windows has no bin on a network drive, a USB stick or a drive
// with the bin turned off. A code rather than a sentence: the renderer words
// it and asks whether to delete for good.
const NO_BIN = 'no-bin';

/**
 * Whether a delete goes to the Recycle Bin: there is a shell to move it with,
 * and `options.permanent` does not ask to delete for good. A run without a
 * shell deletes for good.
 */
function goesToBin(ctx, options) {
  return !options?.permanent && !!ctx.shell?.trashItem;
}

/**
 * Move a file or folder to the Recycle Bin. Answers null once it is there, and
 * NO_BIN, having logged why under `label`, when the bin refuses it.
 */
async function moveToTrash(ctx, target, label) {
  try {
    await ctx.shell.trashItem(target);
    return null;
  } catch (err) {
    ctx.log(`${label}: ${target} could not go to the Recycle Bin: ${err.message}`);
    return NO_BIN;
  }
}

/**
 * Delete one file: to the Recycle Bin, or for good where goesToBin says so.
 * Answers NO_BIN, the file left in place, when the bin refuses it, and null
 * once the file is gone.
 */
async function deleteFile(ctx, filePath, label, options) {
  if (goesToBin(ctx, options)) return moveToTrash(ctx, filePath, label);
  ctx.fs.unlinkSync(filePath);
  return null;
}

module.exports = { goesToBin, moveToTrash, deleteFile };
