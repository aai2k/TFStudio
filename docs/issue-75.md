# Issue #75: Feature proposal — one data folder with file move

- **URL:** https://github.com/aai2k/TFStudio/issues/75
- **State:** Open
- **Author:** @imyu37
- **Labels:** `enhancement`
- **Assignee:** @imyu37
- **Created:** 2026-09-02
- **Updated:** 2026-09-03

---

## Original proposal — folder path linkage

> Change "Preferences" to update all other folders automatically

### Motivation

When users need to move their TFStudio data to a new location (e.g., switching drives, reorganizing directories), they currently have to manually update each folder path individually in **Setup → Preferences → Folders**. This is tedious and error-prone — users often forget to update one or more folders, leading to scattered data across different locations.

The most natural workflow is: "I want all my TFStudio data under `D:\user\TFStudio`" — set the Preferences folder once, and have everything else follow.

### Proposed behavior

1. **Linkage by default (always on)** — When the user changes the **Preferences** folder path, all other folders (Projects, Materials, MeritFunctions, Qualifiers, Integrals, ReportPresets, Branding) automatically update to the same parent directory, preserving their subfolder names.

   - Example: Preferences changes from `D:\old\Preferences` → `D:\new\Preferences`
   - Result: Materials becomes `D:\new\Materials`, Branding becomes `D:\new\Branding`, etc.

2. **Individual override still works** — Any other folder can still be changed independently without affecting the linkage. The linkage only triggers when Preferences is modified.

3. **No toggle needed** — The linkage is always active. There is no on/off switch, keeping the UI simple.

4. **UI reorder** — Move the Preferences entry to the **top** of the folder list, since it is now the "master" path that drives the others.

### Implementation approach (core layer)

Modify `src/main/userPaths.js`:

- Reorder `FOLDER_SPECS` to put `preferences` first.
- Add a helper `getParentDir(filePath)` → `path.dirname(filePath)`.
- In `setPath()`, when `key === 'preferences'`, compute the new parent directory and call a `linkageUpdatePaths()` function that iterates over all other specs, computes each folder's subfolder name from its default path, and calls `setPath()` for each.

No UI code changes are required for the linkage logic itself — the existing `listFolders()` return value already reflects all overrides. The only UI change is reordering the rendered list in `FoldersPane.js`.

### Alternatives considered

- **UI-layer linkage**: Compute and apply paths in the React component. Rejected because it would duplicate logic and make the linkage invisible to the main-process registry.
- **IPC-layer linkage**: Batch-update via a new IPC call. Rejected because it adds interface complexity without benefit over the core-layer approach.
- **Toggle switch**: Add a checkbox to enable/disable linkage. Rejected as unnecessary — individual override already provides an escape hatch, and a toggle adds UI clutter for a rarely-needed escape.

### Questions

1. Should the linkage also apply when resetting Preferences to its default? (I lean toward yes — reset means "go back to Documents/TFStudio", so others should follow.)
2. Any concerns about the Performance or other settings panes that also reference folder paths?

---

## Comment #1 — @aai2k (Owner, 2026-09-02)

Yes, this is better than it is now. But I want to go one step further than linkage: drop the per-folder paths and keep one setting, the TFStudio data folder. Default stays Documents\TFStudio and the nine subfolders keep their fixed names under it. A change moves the files: the app copies the folder to the new place, switches to it, then removes the old one. Otherwise everything the user made disappears from view the moment they pick a new folder.

**Rules**

1. The new folder must be empty or not exist yet, and must not be inside the current folder or contain it.
2. Same drive: just a rename at the file-system level. Different drive: copy, check that file count and bytes match, then delete the old folder.
3. Order: copy, save the setting, delete. A failed copy removes the partial copy and keeps the old setting. A failed settings write removes the copy. A failed delete keeps the new setting and reports that the old folder is still there. The user always has one complete copy.
4. The app asks before starting, in its own confirm dialog, then shows "Moving…" with the buttons disabled until done. The unsaved-designs guard stays.
5. If the configured folder is unusable at startup (like an unplugged usb stick or a hard drive), the app runs from default Documents\TFStudio, re-seeds the bundled materials there, and the pane says why. A restart with the drive back uses the configured folder again; anything saved meanwhile stays in Documents\TFStudio.
6. Portable build: the path is stored relative to the exe folder when it is under it and resolved against the exe folder, so a stick that mounts under another drive letter keeps working.

Per-folder paths set in 1.5.0 to 1.7.1 are ignored with a log line and dropped on the next settings write.

Do you want to take this, or should I?

---

## Comment #2 — @imyu37 (2026-09-03)

@aai2k OK, I'll take it. Some technique information should be checked here with you.

---

## Comment #3 — @aai2k (Owner, 2026-09-03)

**Files to modify:**

### `src/main/dataFolderMove.js` (new, CommonJS, fs and path injected)

- `checkTarget(current, target)`: the rules from my first message apply.
- `moveTree(from, to)`: rename first; on EXDEV copy, verify, delete. Async fs so the window stays responsive; the RII mirror alone is 4000 files. Returns what it did and whether the old folder is still there.

### `src/main/userPaths.js`

- Keep `FOLDER_SPECS` and the keys. One optional root replaces the per-key overrides; every folder resolves as `root + subdir`; `userDocsDir` returns the root.
- `load(settings)`: read `folders.root`, resolve it against exeDir when relative, validate (absolute, mkdir + write probe), fall back to `Documents\TFStudio` and record the rejection when unusable. Other keys in the block (per-folder paths from 1.5 to 1.7) are ignored with one log line and dropped on the next write.
- `set(dir)`, `reset()`, `list()` with the root entry (path, defaultPath, overridden, rejected) and the nine resolved subfolder paths for display.
- `toSettings()`: `{ root }`, stored relative when under exeDir; `{}` when untouched, so a fresh install writes no folders block.

### `src/main/ipc/paths.js` and `src/preload.js`

- `paths:choose` only returns the picked path.
- `paths:set(dir)` runs `checkTarget`, `moveTree`, the existing `applyChange` transaction, then the delete.
- `paths:reset` is `set(defaultPath)`.
- `paths:reveal` keeps an optional key so Open works on the root and on a subfolder.

### `src/renderer.js`

- `handleUserPathChanged` reloads the design tree and the catalogs, no key. The unsaved-designs guard applies to every change.

### `src/components/dialogs/settings/FoldersPane.js` and `FolderRow.js`

One row: label, path, Browse, Reset, Open, with the default and rejected notes as now. Below it a read-only list of the nine subfolders with their paths. Browse: pick, confirm, move with a busy state. Errors and the old-folder-still-there notice show inline as now.

### `src/constants/locales.js` (en, ru, zh)

- `tabs.folders` and `folders.title` become "Data folder". Hint: where TFStudio keeps designs, materials, presets and preferences; the files move when the folder is changed. Strings for the confirm, the busy state, the refusal reasons and the leftover-folder notice. Chinese is yours; I will do the Russian.

### Docs and changelog

- `docs-site/design/coating-library.md` line 107 wording.
- One changelog line: one data folder replaces the per-folder paths and the files move with it; per-folder paths set in 1.5 to 1.7 are no longer read.
