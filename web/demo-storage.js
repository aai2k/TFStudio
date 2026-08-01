// web/demo-storage.js — persistence and file I/O for the web demo.
//
// The desktop build keeps designs as .tfs files under Documents\TFStudio\Projects
// and reaches the filesystem over Electron IPC. A browser has neither, so:
//
//   • designs, folders and settings live in IndexedDB, keyed by folder and name
//     exactly as the desktop keys them by directory and filename, so a reload
//     restores the session instead of discarding it;
//   • import opens a transient <input type="file">; export builds a Blob and
//     clicks a download link. No server and no persistent file handles.
//
// Exposes window.DemoStorage. Loaded before demo-shim.js, which adapts these
// calls to the electronAPI surface the renderer expects.
//
// When IndexedDB is unavailable (private-browsing modes, blocked storage), every
// operation transparently falls back to an in-memory store: the session still
// works, it just does not survive a reload. `persistent()` reports which is live.

(function () {
  'use strict';

  const DB_NAME = 'tfstudio-demo';
  // v2 added catalogs, v3 added presets. The upgrade only creates missing
  // stores, so an existing visitor keeps their data across a bump.
  const DB_VERSION = 3;
  const STORE_FOLDERS = 'folders';
  const STORE_DESIGNS = 'designs';
  const STORE_CATALOGS = 'catalogs';
  const STORE_PRESETS = 'presets';
  const STORE_META = 'meta';

  // Designs are keyed by folder + name. NUL cannot occur in either, so it is a
  // safe separator that no user-visible string can forge.
  const key = (folder, name) => `${folder}\u0000${name}`;

  // ── Backing store ──────────────────────────────────────────────────────────
  let dbPromise = null;
  let usingMemory = false;
  const memory = {
    folders: new Map(), designs: new Map(), catalogs: new Map(),
    presets: new Map(), meta: new Map(),
  };

  // Opening must always settle. A second tab holding an older version blocks the
  // upgrade, and an open request that never resolves would leave every storage
  // call pending forever — the app then renders as though all saved work were
  // gone. Any failure to open degrades to the in-memory store instead.
  const OPEN_TIMEOUT_MS = 5000;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const settle = (db) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (!db) usingMemory = true;
        resolve(db);
      };

      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (_) {
        settle(null);
        return;
      }
      timer = setTimeout(() => settle(null), OPEN_TIMEOUT_MS);

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_FOLDERS)) db.createObjectStore(STORE_FOLDERS, { keyPath: 'name' });
        if (!db.objectStoreNames.contains(STORE_DESIGNS)) db.createObjectStore(STORE_DESIGNS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORE_CATALOGS)) db.createObjectStore(STORE_CATALOGS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_PRESETS)) db.createObjectStore(STORE_PRESETS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'k' });
      };
      req.onsuccess = () => {
        const db = req.result;
        // Release the database when another tab needs to upgrade it, so a stale
        // tab cannot block a newer one indefinitely. Dropping the cached promise
        // makes the next call reopen at the new version.
        db.onversionchange = () => {
          try { db.close(); } catch (_) {}
          dbPromise = null;
        };
        settle(db);
      };
      req.onerror = () => settle(null);
      req.onblocked = () => settle(null);
    });
    return dbPromise;
  }

  function memStore(storeName) {
    if (storeName === STORE_FOLDERS) return memory.folders;
    if (storeName === STORE_DESIGNS) return memory.designs;
    if (storeName === STORE_CATALOGS) return memory.catalogs;
    if (storeName === STORE_PRESETS) return memory.presets;
    return memory.meta;
  }

  function idKey(storeName, value) {
    if (storeName === STORE_FOLDERS) return value.name;
    if (storeName === STORE_DESIGNS) return value.key;
    if (storeName === STORE_CATALOGS) return value.id;
    if (storeName === STORE_PRESETS) return value.key;
    return value.k;
  }

  async function put(storeName, value) {
    const db = await openDb();
    if (!db) { memStore(storeName).set(idKey(storeName, value), value); return; }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function del(storeName, k) {
    const db = await openDb();
    if (!db) { memStore(storeName).delete(k); return; }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function getAll(storeName) {
    const db = await openDb();
    if (!db) return Array.from(memStore(storeName).values());
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function get(storeName, k) {
    const db = await openDb();
    if (!db) return memStore(storeName).get(k);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(k);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // ── Folders ────────────────────────────────────────────────────────────────
  const listFolders = () => getAll(STORE_FOLDERS);
  const createFolder = (name) => put(STORE_FOLDERS, { name, expanded: true });

  async function deleteFolder(name) {
    const designs = await getAll(STORE_DESIGNS);
    for (const d of designs) {
      if (d.folder === name) await del(STORE_DESIGNS, d.key);
    }
    await del(STORE_FOLDERS, name);
  }

  async function renameFolder(oldName, newName) {
    const designs = await getAll(STORE_DESIGNS);
    for (const d of designs) {
      if (d.folder !== oldName) continue;
      await del(STORE_DESIGNS, d.key);
      await put(STORE_DESIGNS, { key: key(newName, d.name), folder: newName, name: d.name, design: d.design, mtime: d.mtime });
    }
    const folder = await get(STORE_FOLDERS, oldName);
    await del(STORE_FOLDERS, oldName);
    await put(STORE_FOLDERS, { name: newName, expanded: folder ? folder.expanded : true });
  }

  // ── Designs ────────────────────────────────────────────────────────────────
  const listDesigns = () => getAll(STORE_DESIGNS);

  // Mirrors the desktop save path: refuse to overwrite an entry holding a
  // different design.id, then drop any stale entry in the same folder that
  // carries the id being saved (left behind by a rename that bypassed
  // renameDesign). Returns an error string, or null on success.
  async function putDesign(folder, design) {
    const k = key(folder, design.name);
    const existing = await get(STORE_DESIGNS, k);
    if (design.id && existing && existing.design && existing.design.id && existing.design.id !== design.id) {
      return `Another design is already saved as "${design.name}".`;
    }
    await put(STORE_DESIGNS, { key: k, folder, name: design.name, design, mtime: Date.now() });
    if (design.id) {
      const all = await getAll(STORE_DESIGNS);
      for (const d of all) {
        if (d.folder === folder && d.key !== k && d.design && d.design.id === design.id) {
          await del(STORE_DESIGNS, d.key);
        }
      }
    }
    return null;
  }

  const deleteDesign = (folder, name) => del(STORE_DESIGNS, key(folder, name));

  async function renameDesign(folder, oldName, newName) {
    const entry = await get(STORE_DESIGNS, key(folder, oldName));
    if (!entry) return 'File not found';
    if (await get(STORE_DESIGNS, key(folder, newName))) return 'A file with that name already exists';
    const design = Object.assign({}, entry.design, { name: newName });
    await del(STORE_DESIGNS, entry.key);
    await put(STORE_DESIGNS, { key: key(folder, newName), folder, name: newName, design, mtime: Date.now() });
    return null;
  }

  // ── Catalogs ───────────────────────────────────────────────────────────────
  // Stored whole, keyed by catalog.id, mirroring the desktop's one-file-per-
  // catalog layout. Designs reference materials through these, so a catalog that
  // failed to persist would leave a saved design unable to resolve its layers.
  const listCatalogs = () => getAll(STORE_CATALOGS);
  const putCatalog = (catalog) => put(STORE_CATALOGS, catalog);
  const deleteCatalog = (catalogId) => del(STORE_CATALOGS, catalogId);

  // ── Presets ────────────────────────────────────────────────────────────────
  // Integral, qualifier, merit-function and report presets are one file per
  // preset on the desktop, in four separate directories. `kind` stands in for
  // the directory, so the families cannot collide on a shared name.
  const presetKey = (kind, name) => `${kind}\u0000${name}`;
  const listPresets = async (kind) => (await getAll(STORE_PRESETS)).filter((r) => r.kind === kind);
  const getPreset = (kind, name) => get(STORE_PRESETS, presetKey(kind, name));
  const putPreset = (kind, name, preset) => put(STORE_PRESETS, { key: presetKey(kind, name), kind, name, preset });
  const deletePreset = (kind, name) => del(STORE_PRESETS, presetKey(kind, name));

  // ── Meta (settings, seed bookkeeping) ──────────────────────────────────────
  async function getMeta(k) {
    const row = await get(STORE_META, k);
    return row ? row.v : undefined;
  }
  const setMeta = (k, v) => put(STORE_META, { k, v });

  // ── File import / export ───────────────────────────────────────────────────
  // Instruments and Zemax both emit UTF-16 LE with a BOM, which decodes to
  // NUL-interleaved garbage if read as UTF-8. Matches the desktop readTextAuto.
  function decodeText(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
      return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
      return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }
    return new TextDecoder('utf-8').decode(bytes);
  }

  // Resolves { text, fileName } | { canceled: true } | { error }.
  function pickTextFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (accept) input.accept = accept;
      input.style.display = 'none';

      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('focus', onFocus, true);
        try { input.remove(); } catch (_) {}
        resolve(value);
      };

      // Older browsers fire no event when the dialog is dismissed. Regaining
      // window focus with nothing selected is the fallback signal; the delay
      // lets a real selection deliver its `change` event first.
      const onFocus = () => {
        setTimeout(() => {
          if (!input.files || input.files.length === 0) finish({ canceled: true });
        }, 500);
      };

      input.addEventListener('cancel', () => finish({ canceled: true }));
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) { finish({ canceled: true }); return; }
        file.arrayBuffer()
          .then((buf) => finish({ text: decodeText(buf), fileName: file.name }))
          .catch((e) => finish({ error: String((e && e.message) || e) }));
      });

      document.body.appendChild(input);
      window.addEventListener('focus', onFocus, true);
      input.click();
    });
  }

  function downloadText(text, fileName, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'download.txt';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { a.remove(); URL.revokeObjectURL(url); } catch (_) {}
    }, 0);
  }

  window.DemoStorage = {
    persistent: () => !usingMemory,
    listFolders, createFolder, deleteFolder, renameFolder,
    listDesigns, putDesign, deleteDesign, renameDesign,
    listCatalogs, putCatalog, deleteCatalog,
    listPresets, getPreset, putPreset, deletePreset,
    getMeta, setMeta,
    pickTextFile, downloadText,
  };
})();
