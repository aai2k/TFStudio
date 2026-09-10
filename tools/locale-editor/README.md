# TFStudio Localization Editor

A small browser-based table editor for `src/constants/locales/`. Instead of
hand-editing a 4000-line nested-object file per language, you edit translations
in a grid with one textbox per language, like a Visual Studio resource editor.

## Run

```
npm run locale-editor
```

(or `node tools/locale-editor/server.js`), then open <http://localhost:4178>.

Stop with Ctrl-C. Use `PORT=5000 npm run locale-editor` to change the port.

## What it does

- Reads every `<code>.js` in the folder, listing each key as one row with a
  textbox per language. Columns come from `availableLocales` in `index.js`, so a
  new language appears as soon as its file and its entry exist.
- **Save** writes only the changed values back, using **surgical, offset-based
  AST edits**. Comments, formatting, and all 280+ function-valued entries
  (e.g. ``(n) => `Trial: ${n}` ``) are preserved untouched. A save touches only
  the languages you actually edited; the other files stay byte-identical.
- Every save first copies each file it is about to change to
  `tools/locale-editor/backups/<code>.<timestamp>.js`, and validates that all of
  them re-parse before writing any. Invalid edits are rejected.

## Features

| Feature | Notes |
|---|---|
| **Group by feature** | Collapsible sections per top-level namespace (`menu`, `toolbar`, …). |
| **Sortable columns** | Click any header (Status / Key / per-language) to sort; click again to reverse. |
| **Merge identical EN** | Collapses rows that share the same English text so you translate `"Save"`, `"Close"`, etc. **once** and apply to every key. Shows `×N` and the member keys; warns when members currently diverge. |
| **Filter** | All / Untranslated-or-empty / Missing / Functions only / Changed. |
| **Search** | Matches key path or any translation text. |
| **Missing-key insertion** | A key present in `en` but absent in another language shows a red box; typing a value **inserts** it into that language's file at the right place (creating nested parents if needed). |
| **Function values** | Marked with a `ƒ` badge and a monospace box. Edit the whole expression, but **keep the `(args) =>` signature**. |
| **Backups + validation** | Auto-backup before write; rejects any edit that wouldn't re-parse. |

## How writes stay safe

`locales-model.js` parses each language file with `acorn`, finds each value's
exact `[start, end)` byte range, and splices replacements into that file's own
source (highest offset first). Nothing outside an edited value is rewritten, so
the files stay diff-clean and the function entries are never re-serialised.
Array-valued entries (the tutorial step lists) are walked by index, so each
string inside one is its own row rather than a blob of raw JavaScript.

## Files

| File | Role |
|---|---|
| `server.js` | HTTP server: `/api/data`, `/api/save`. |
| `locales-model.js` | acorn parse of each language file → model; surgical `applyEdits` + `validateSource`. |
| `index.html` | Single-file UI (vanilla JS). |
