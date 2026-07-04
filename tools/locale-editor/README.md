# TFStudio Localization Editor

A small browser-based table editor for `src/constants/locales.js` — instead of
hand-editing a 3700-line nested-object file, you edit translations in a grid
with one textbox per language, like a Visual Studio resource editor.

## Run

```
npm run locale-editor
```

(or `node tools/locale-editor/server.js`), then open <http://localhost:4178>.

Stop with Ctrl-C. Use `PORT=5000 npm run locale-editor` to change the port.

## What it does

- Reads `locales.js`, lists every key as a row with a textbox for **en** and **ru**
  (columns are generated from `availableLocales`, so adding a 3rd language just works).
- **Save** writes only the changed values back into `locales.js` using
  **surgical, offset-based AST edits** — comments, formatting, and all 150+
  function-valued entries (e.g. ``(n) => `Trial — ${n}` ``) are preserved untouched.
- Every save first copies the file to `tools/locale-editor/backups/locales.<timestamp>.js`,
  then validates the result re-parses before writing. Invalid edits are rejected.

## Features

| Feature | Notes |
|---|---|
| **Group by feature** | Collapsible sections per top-level namespace (`menu`, `toolbar`, …). |
| **Sortable columns** | Click any header — Status / Key / per-language — to sort (click again to reverse). |
| **Merge identical EN** | Collapses rows that share the same English text so you translate `"Save"`, `"Close"`, etc. **once** and apply to every key. Shows `×N` and the member keys; warns when members currently diverge. |
| **Filter** | All / Untranslated-or-empty / Missing / Functions only / Changed. |
| **Search** | Matches key path or any translation text. |
| **Missing-key insertion** | A key present in `en` but absent in `ru` shows a red box; typing a value **inserts** it into the `ru` object at the right place (creating nested parents if needed). |
| **Function values** | Marked with a `ƒ` badge and a monospace box. Edit the whole expression — **keep the `(args) =>` signature**. |
| **Backups + validation** | Auto-backup before write; rejects any edit that wouldn't re-parse. |

## How writes stay safe

`locales-model.js` parses the file with `acorn`, finds each value's exact
`[start, end)` byte range, and splices replacements into the original source
(highest offset first). Nothing outside an edited value is rewritten, so the
file stays diff-clean and the function entries are never re-serialised.

## Files

| File | Role |
|---|---|
| `server.js` | HTTP server: `/api/data`, `/api/save`. |
| `locales-model.js` | acorn parse → model; surgical `applyEdits` + `validateSource`. |
| `index.html` | Single-file UI (vanilla JS). |
