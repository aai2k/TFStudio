# Contributing to TFStudio

The most useful things you can send are feedback and bug reports.

## Feedback and bug reports

Open an [issue](https://github.com/aai2k/TFStudio/issues). For a bug, say what you did, what you expected and what happened. If a number looks wrong, give the number and, if you have it, the value another program gets for the same design.

Questions, ideas and "is this supposed to work like that?" are welcome as issues too.

To share a coating for the built-in Coating Library, post it in the [Coatings](https://github.com/aai2k/TFStudio/discussions/new?category=coatings) discussion category or use **Share a coating…** in the Coating Library window.

## Pull requests

Small fixes are welcome without asking first: a bug fix, a typo, a translation, a docs correction.

For a large change or a new feature, open an issue first so we agree on it before you spend time on code.

Before you open a PR:

- `npm test` passes.
- A bug fix comes with a test that would have caught it.
- If the change moves a computed result, say what you checked it against (another program, a published result or an analytic case) and cite the source of any formula: book or paper, equation number.
- One change per PR.

## Setup

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
git clone --recursive https://github.com/aai2k/TFStudio.git
cd TFStudio
npm install
npm start
```

If you cloned without `--recursive`, run `git submodule update --init --recursive`.

The transfer-matrix kernel lives in [tmmcore](https://github.com/aai2k/tmmcore) and arrives prebuilt through `npm install`. Changes to the kernel belong in that repository.

## Where things are

| Path | Contents |
|---|---|
| `src/utils/physics/` | Spectra and what is computed from them: the stack handed to tmmcore, color, error analysis, stress, scattering, pulses |
| `src/utils/optimizers/`, `src/utils/refinement/` | Optimization methods and Refinement runs |
| `src/utils/synthesis/`, `src/utils/needle/`, `src/utils/gradualEvolution/` | Design synthesis: needle, gradual evolution, starting designs, cleanup |
| `src/utils/materials/` | Dispersion formulas, the built-in material library, catalogs |
| `src/utils/io/` | Design files, and import and export (Zemax, CODE V, JCAMP-DX, spectrum tables) |
| `src/utils/workers/` | Web Workers for long runs, so the window stays responsive |
| `src/components/windows/` | Tool windows, one folder per ribbon tab |
| `src/components/` | The rest of the UI: dialogs, docking, panels, shared controls |
| `src/constants/locales/` | All UI text, one file per language |
| `src/main/` | Electron main process |
| `src/api/` | Headless API: the app's calculations in Node, without the window |
| `src/apiServer/`, `python/` | The API over stdin and stdout, and the Python package that uses it |
| `src/mcp/` | MCP server: the API as tools for AI agents |
| `tests/` | Test suite; `tests/reference/` holds values from other programs to check against |
| `docs-site/` | User documentation (Astro Starlight) |
| `web/` | The web demo |

## Translations

UI text comes from `src/constants/locales/`, one file per language. Add a new string to every file; `npm test` fails on a missing key.

To edit translations in a table instead of in the files, run `npm run locale-editor` and open the address it prints (http://localhost:4178 by default). Each key is a row with a box per language. Filters show untranslated and missing keys, and typing into a missing one adds it to that language's file. Save writes only the values you changed, so the diff stays small.

To start a language the app does not have yet, pick it in the editor's draft language list: German, French, Spanish, Portuguese, Japanese or Korean. Its file is created on the first save, and a key you have not translated shows in English. The app does not offer a draft language until it is ready to ship. For a language not on the list, add it to `draftLocales` in `src/constants/locales/index.js`.

By contributing, you agree that your work is licensed under the project's [MIT license](./LICENSE).
