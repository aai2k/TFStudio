// IPC: WASM TMM kernel bytes shipped by tmmcore. The renderer can't fetch
// a file:// asset under contextIsolation, so the main process reads it and hands
// the bytes to the renderer, which broadcasts them to its workers. Returns
// { success, bytes }; resolution/read failures are a clean miss to the JS path.
//
// CommonJS, Electron-free (deps via ctx).
function register(ipcMain, ctx) {
  const { fs, path, log, isPackaged, resourcesDir } = ctx;

  ipcMain.handle('wasm:load-kernel', async () => {
    try {
      const p = isPackaged
        ? path.join(resourcesDir, 'tmm_kernel.wasm')
        : require.resolve('tmmcore/tmm_kernel.wasm');
      const buf = fs.readFileSync(p);           // Node Buffer → Uint8Array in renderer
      log(`wasm:load-kernel OK (${buf.length} bytes from ${p})`);
      return { success: true, bytes: buf };
    } catch (err) {
      log(`wasm:load-kernel ERROR: ${err.message}`);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { register };
