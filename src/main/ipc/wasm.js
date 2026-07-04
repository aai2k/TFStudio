// IPC: WASM TMM kernel bytes (src/wasm/tmm_kernel.wasm). The renderer can't fetch
// a file:// asset under contextIsolation, so the main process reads it and hands
// the bytes to the renderer, which broadcasts them to its workers. Returns
// { success, bytes } — an absent artifact (not built) is a clean miss → JS path.
//
// CommonJS, Electron-free (deps via ctx).
function register(ipcMain, ctx) {
  const { fs, path, log, srcDir } = ctx;

  ipcMain.handle('wasm:load-kernel', async () => {
    try {
      const p = path.join(srcDir, 'wasm', 'tmm_kernel.wasm');
      if (!fs.existsSync(p)) { log(`wasm:load-kernel MISS (not found at ${p})`); return { success: false, error: 'not built' }; }
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
