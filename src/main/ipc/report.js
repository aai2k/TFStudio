// IPC: Report Generator — self-contained HTML export, headless
// print-to-PDF (offscreen BrowserWindow), report-config presets
// (Documents\TFStudio\ReportPresets\<name>.tfsr) and branding-logo load.
//
// CommonJS, Electron-free (deps via ctx).
function register(ipcMain, ctx) {
  const { dialog, getMainWindow, BrowserWindow, app, fs, path, log, reportPresetsDir, brandingDir, safeName, writeFileAtomic } = ctx;

  ipcMain.handle('report:save-html', async (event, html, suggestedName) => {
    try {
      if (typeof html !== 'string' || !html) return { success: false, error: 'no html' };
      const res = await dialog.showSaveDialog(getMainWindow(), {
        title: 'Save report (HTML)',
        defaultPath: path.join(app.getPath('documents'), safeName(suggestedName || 'TFStudio_Report.html')),
        filters: [{ name: 'HTML', extensions: ['html'] }],
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      fs.writeFileSync(res.filePath, html, 'utf-8');
      return { success: true, path: res.filePath };
    } catch (err) {
      log(`report:save-html error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('report:export-pdf', async (event, html, suggestedName) => {
    let win = null;
    let tmpFile = null;
    try {
      if (typeof html !== 'string' || !html) return { success: false, error: 'no html' };
      const res = await dialog.showSaveDialog(getMainWindow(), {
        title: 'Export report (PDF)',
        defaultPath: path.join(app.getPath('documents'), safeName(suggestedName || 'TFStudio_Report.pdf')),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (res.canceled || !res.filePath) return { canceled: true };

      // Render the HTML in an offscreen window, then print to PDF. A temp file
      // (rather than a data: URL) avoids URL length limits and keeps relative
      // CSS/@page rules behaving like a normal document load.
      tmpFile = path.join(app.getPath('temp'), `tfstudio-report-${Date.now()}.html`);
      fs.writeFileSync(tmpFile, html, 'utf-8');

      win = new BrowserWindow({
        show: false,
        webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true },
      });
      await win.loadFile(tmpFile);
      // Give layout/SVG a tick to settle before printing.
      await new Promise(r => setTimeout(r, 250));
      const pdf = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { marginType: 'default' },
      });
      fs.writeFileSync(res.filePath, pdf);
      return { success: true, path: res.filePath };
    } catch (err) {
      log(`report:export-pdf error: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      try { if (win && !win.isDestroyed()) win.destroy(); } catch (_) {}
      try { if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    }
  });

  ipcMain.handle('report:list-presets', async () => {
    try {
      if (!fs.existsSync(reportPresetsDir)) return { success: true, presets: [] };
      const presets = [];
      for (const f of fs.readdirSync(reportPresetsDir)) {
        if (!f.toLowerCase().endsWith('.tfsr')) continue;
        try {
          const obj = JSON.parse(fs.readFileSync(path.join(reportPresetsDir, f), 'utf-8'));
          if (obj && obj.name) presets.push({ name: obj.name, file: f });
        } catch (err) { log(`report preset read error ${f}: ${err.message}`); }
      }
      return { success: true, presets };
    } catch (err) {
      log(`report:list-presets error: ${err.message}`);
      return { success: false, error: err.message, presets: [] };
    }
  });

  ipcMain.handle('report:load-preset', async (event, name) => {
    try {
      const base = String(name || '').replace(/\.tfsr$/i, '');
      const file = path.join(reportPresetsDir, safeName(base) + '.tfsr');
      if (!fs.existsSync(file)) return { success: false, error: 'not found' };
      return { success: true, preset: JSON.parse(fs.readFileSync(file, 'utf-8')) };
    } catch (err) {
      log(`report:load-preset error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('report:save-preset', async (event, preset) => {
    try {
      if (!preset?.name) return { success: false, error: 'preset.name required' };
      const out = { ver: 1, ...preset };
      const file = path.join(reportPresetsDir, safeName(preset.name) + '.tfsr');
      writeFileAtomic(file, JSON.stringify(out, null, 2), 'utf-8');
      return { success: true };
    } catch (err) {
      log(`report:save-preset error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('report:delete-preset', async (event, name) => {
    try {
      const base = String(name || '').replace(/\.tfsr$/i, '');
      const file = path.join(reportPresetsDir, safeName(base) + '.tfsr');
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return { success: true };
    } catch (err) {
      log(`report:delete-preset error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // Load a cover-page logo. Defaults to Documents\TFStudio\Branding\logo.png if
  // present, else prompts. Returns a data: URL for inline embedding.
  ipcMain.handle('report:load-logo', async () => {
    try {
      let file = path.join(brandingDir, 'logo.png');
      if (!fs.existsSync(file)) {
        const pick = await dialog.showOpenDialog(getMainWindow(), {
          title: 'Select cover logo',
          properties: ['openFile'],
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
        });
        if (pick.canceled || !pick.filePaths.length) return { canceled: true };
        file = pick.filePaths[0];
      }
      const ext = path.extname(file).toLowerCase().slice(1);
      const mime = ext === 'svg' ? 'image/svg+xml'
                 : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                 : `image/${ext || 'png'}`;
      const b64 = fs.readFileSync(file).toString('base64');
      return { success: true, dataUrl: `data:${mime};base64,${b64}` };
    } catch (err) {
      log(`report:load-logo error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { register };
